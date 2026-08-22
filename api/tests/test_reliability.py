"""Fiabilité : événements, score, compteur de collaborations.

Le test central est celui de **non-divergence** : les deux caches sont
recalculés depuis les événements et comparés à ce qui est stocké. Un cache qu'on
ne sait pas reconstruire finit par diverger sans qu'on le sache, et le jour où
on s'en aperçoit il n'y a plus de référence pour trancher.

La seconde propriété est que les pondérations sont **rétroactives** : les
changer recalcule tout l'historique sans migration.
"""

import uuid
from decimal import Decimal

import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import build_settings, get_settings
from app.models import CreatorProfile, ReliabilityEvent, Tier
from app.models.enums import (
    BookingStatus,
    CollaborationStatus,
    ReliabilityEventType,
    UserRole,
)
from app.services import booking_states, collaboration
from app.services import proof as proof_service
from app.services import reliability as service
from app.services.audit import Actor
from app.services.eligibility import RaisonRefus
from tests.conftest import inscrire_verifie
from tests.test_collaboration import capture, contrepartie


async def createur_nu(session: AsyncSession):
    return await inscrire_verifie(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password="tourbillon-cactus-91-vermeil",
        role=UserRole.CREATOR,
    )


async def profil(session: AsyncSession, creator_id: uuid.UUID) -> CreatorProfile:
    session.expire_all()
    return await session.get(CreatorProfile, creator_id)


# --------------------------------------------------------------------------
# le cache doit être reconstructible — le test qui compte
# --------------------------------------------------------------------------


async def test_les_caches_se_recalculent_a_l_identique(session: AsyncSession) -> None:
    """Recalculé depuis les événements, comparé à ce qui est stocké.

    C'est la seule chose qui empêche un cache de diverger en silence. Sans ce
    test, `completed_collabs_count` pourrait s'écarter de son historique et
    personne ne le saurait avant qu'un créateur perde un palier sans raison.
    """
    ligne, s = await contrepartie(session)
    createur = s["createur"].id

    await proof_service.soumettre(
        session, collaboration=ligne, capture=capture(), actor=Actor.from_user(s["createur"])
    )
    await collaboration.approuver(
        session, collaboration=ligne, actor=Actor.from_user(s["caissier"])
    )

    stocke = await profil(session, createur)
    recalcule = await service.recalculer(session, createur)

    assert recalcule.reliability_score == stocke.reliability_score
    assert recalcule.completed_collabs_count == stocke.completed_collabs_count
    assert recalcule.completed_collabs_count == 1


async def test_un_cache_desaccorde_se_detecte_et_se_repare(session: AsyncSession) -> None:
    """Le pendant : si le recalcul rendait simplement ce qui est stocké, le test
    précédent ne prouverait rien. On désaccorde volontairement."""
    ligne, s = await contrepartie(session)
    createur = s["createur"].id
    await proof_service.soumettre(
        session, collaboration=ligne, capture=capture(), actor=Actor.from_user(s["createur"])
    )
    await collaboration.approuver(
        session, collaboration=ligne, actor=Actor.from_user(s["caissier"])
    )

    await session.execute(
        sa.update(CreatorProfile)
        .where(CreatorProfile.user_id == createur)
        .values(reliability_score=Decimal("99.99"), completed_collabs_count=42)
    )
    await session.flush()

    recalcule = await service.recalculer(session, createur)
    stocke = await profil(session, createur)
    assert recalcule.completed_collabs_count != stocke.completed_collabs_count

    # Et la réparation remet les deux d'accord, sans rien inventer.
    await service.rafraichir(session, creator_id=createur)
    repare = await profil(session, createur)
    assert repare.completed_collabs_count == recalcule.completed_collabs_count
    assert repare.reliability_score == recalcule.reliability_score


async def test_le_recalcul_global_repare_tout_le_monde(session: AsyncSession) -> None:
    """Le geste qu'un changement de pondération demande."""
    createurs = []
    for _ in range(2):
        ligne, s = await contrepartie(session)
        await proof_service.soumettre(
            session, collaboration=ligne, capture=capture(), actor=Actor.from_user(s["createur"])
        )
        await collaboration.approuver(
            session, collaboration=ligne, actor=Actor.from_user(s["caissier"])
        )
        createurs.append(s["createur"].id)

    await session.execute(
        sa.update(CreatorProfile)
        .where(CreatorProfile.user_id.in_(createurs))
        .values(completed_collabs_count=0)
    )
    await session.flush()

    assert await service.rafraichir_tout(session) >= 2

    for createur in createurs:
        assert (await profil(session, createur)).completed_collabs_count == 1


# --------------------------------------------------------------------------
# le cold start reste neutre
# --------------------------------------------------------------------------


async def test_un_createur_sans_evenement_garde_un_score_nul(session: AsyncSession) -> None:
    """Nul veut dire neutre, jamais zéro. Écrire zéro ferait d'un débutant
    quelqu'un de peu fiable."""
    user = await createur_nu(session)

    fiabilite = await service.recalculer(session, user.id)

    assert fiabilite.reliability_score is None
    assert fiabilite.completed_collabs_count == 0
    assert (await profil(session, user.id)).is_new_creator is True


async def test_le_premier_evenement_donne_un_score(session: AsyncSession) -> None:
    user = await createur_nu(session)

    await service.enregistrer(
        session, creator_id=user.id, type_=ReliabilityEventType.COLLAB_COMPLETED
    )

    ligne = await profil(session, user.id)
    assert ligne.reliability_score is not None
    assert ligne.is_new_creator is False


# --------------------------------------------------------------------------
# les événements naissent des transitions
# --------------------------------------------------------------------------


async def test_une_contrepartie_approuvee_produit_ses_evenements(
    session: AsyncSession,
) -> None:
    ligne, s = await contrepartie(session)
    await proof_service.soumettre(
        session, collaboration=ligne, capture=capture(), actor=Actor.from_user(s["createur"])
    )
    await collaboration.approuver(
        session, collaboration=ligne, actor=Actor.from_user(s["caissier"])
    )

    types = set(
        await session.scalars(
            sa.select(ReliabilityEvent.type).where(ReliabilityEvent.creator_id == s["createur"].id)
        )
    )
    assert ReliabilityEventType.COLLAB_COMPLETED.value in types
    assert ReliabilityEventType.PUBLISHED_ON_TIME.value in types
    # Approuvée du premier coup : cela se distingue d'une approbation obtenue
    # au troisième essai.
    assert ReliabilityEventType.FIRST_PASS_COMPLIANT.value in types


async def test_une_approbation_apres_relance_n_est_pas_du_premier_coup(
    session: AsyncSession,
) -> None:
    ligne, s = await contrepartie(session)
    await proof_service.soumettre(
        session,
        collaboration=ligne,
        capture=capture(contenu=b"premiere"),
        actor=Actor.from_user(s["createur"]),
    )
    await collaboration.demander_une_nouvelle_soumission(
        session, collaboration=ligne, actor=Actor.from_user(s["caissier"]), reason="mention absente"
    )
    await proof_service.soumettre(
        session,
        collaboration=ligne,
        capture=capture(contenu=b"seconde"),
        actor=Actor.from_user(s["createur"]),
    )
    await collaboration.approuver(
        session, collaboration=ligne, actor=Actor.from_user(s["caissier"])
    )

    types = list(
        await session.scalars(
            sa.select(ReliabilityEvent.type).where(ReliabilityEvent.creator_id == s["createur"].id)
        )
    )
    assert ReliabilityEventType.RESUBMIT_REQUIRED.value in types
    assert ReliabilityEventType.FIRST_PASS_COMPLIANT.value not in types
    # La collaboration compte quand même : elle est allée à son terme.
    assert (await profil(session, s["createur"].id)).completed_collabs_count == 1


async def test_une_contrepartie_non_honoree_produit_son_evenement(
    session: AsyncSession,
) -> None:
    from datetime import UTC, datetime, timedelta

    from app.models import Collaboration

    ligne, s = await contrepartie(session)
    await session.execute(
        sa.update(Collaboration)
        .where(Collaboration.id == ligne.id)
        .values(deadline_at=datetime.now(UTC) - timedelta(minutes=1))
    )
    await session.flush()

    await collaboration.expirer_les_echeances(session)

    types = list(
        await session.scalars(
            sa.select(ReliabilityEvent.type).where(ReliabilityEvent.creator_id == s["createur"].id)
        )
    )
    assert ReliabilityEventType.UNFULFILLED.value in types
    # Et le score en souffre, sans que la collaboration compte.
    ligne_profil = await profil(session, s["createur"].id)
    assert ligne_profil.completed_collabs_count == 0
    assert ligne_profil.reliability_score < get_settings().reliability_base_score


async def test_une_absence_produit_son_evenement(session: AsyncSession) -> None:
    """L'événement naît de la transition, pas d'un appel qu'on pourrait oublier.
    Une absence non enregistrée serait une absence gratuite."""
    from tests.test_booking_create import monter_le_decor, premier_creneau, reserver

    decor = await monter_le_decor(session)
    creneau = await premier_creneau(session, decor)
    booking = await reserver(session, decor, starts_at=creneau)
    await booking_states.confirmer(session, booking=booking, creator_id=decor["createur"].id)

    await booking_states.marquer_absent(
        session,
        booking=booking,
        actor=Actor.system(),
        reason="ne s'est pas présenté",
        # Ce test porte sur l'événement de fiabilité, pas sur le délai : l'heure
        # est posée à l'ouverture pour que les deux règles restent éprouvées
        # séparément. Le délai a ses propres tests.
        #
        # **Lue du service et non recopiée.** Une heure fixe valait tant que
        # l'absence s'ouvrait vingt minutes après le créneau ; elle est tombée
        # dès que l'ouverture a reculé, et ce test-ci n'a rien à dire sur le
        # délai. Demander l'ouverture le rend indifférent au réglage.
        maintenant=booking_states.absence_signalable_a(booking),
    )

    assert booking.status is BookingStatus.NO_SHOW
    types = list(
        await session.scalars(
            sa.select(ReliabilityEvent.type).where(
                ReliabilityEvent.creator_id == decor["createur"].id
            )
        )
    )
    assert ReliabilityEventType.NO_SHOW.value in types


def test_chaque_issue_de_contrepartie_a_ses_evenements() -> None:
    """Déclaré plutôt que dispersé dans les branches : une issue ajoutée sans
    son événement se verrait ici, pas au troisième mois d'exploitation."""
    issues = set(collaboration.EVENEMENTS_PAR_ISSUE)

    assert CollaborationStatus.APPROVED in issues
    assert CollaborationStatus.UNFULFILLED in issues
    assert CollaborationStatus.RESUBMIT_REQUESTED in issues
    # Les états intermédiaires n'en produisent pas : soumettre n'est pas un
    # fait de fiabilité, c'est une étape.
    assert CollaborationStatus.SUBMITTED not in issues


# --------------------------------------------------------------------------
# les pondérations sont rétroactives
# --------------------------------------------------------------------------


async def test_changer_une_ponderation_recalcule_tout_l_historique(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Sans migration : c'est tout l'intérêt de ne pas stocker le score comme
    une valeur écrite à la main."""
    user = await createur_nu(session)
    createur_id = user.id
    for _ in range(3):
        await service.enregistrer(
            session, creator_id=createur_id, type_=ReliabilityEventType.COLLAB_COMPLETED
        )

    createur_id = user.id
    avant = (await profil(session, createur_id)).reliability_score

    from app.core import encryption
    from app.services import reliability as module

    reglages = build_settings(
        _env_file=None,
        database_url=str(get_settings().database_url),
        jwt_secret_key="peu-importe-ici-mais-assez-longue-pour-hmac",
        token_encryption_key=encryption.generate_key(),
    )
    reglages.reliability_weights["collab_completed"] = Decimal("1")
    monkeypatch.setattr(module, "get_settings", lambda: reglages)

    apres = await service.rafraichir(session, creator_id=createur_id)

    assert apres.reliability_score < avant
    # Le poids figé sur les lignes n'a pas bougé : il dit ce que l'événement
    # valait quand il s'est produit, pas ce qu'il vaut aujourd'hui.
    poids_figes = set(
        await session.scalars(
            sa.select(ReliabilityEvent.weight).where(ReliabilityEvent.creator_id == createur_id)
        )
    )
    assert poids_figes == {Decimal("5.000")}


def test_le_score_reste_borne() -> None:
    """Un créateur ne descend pas sous zéro ni ne dépasse cent, quel que soit
    l'historique : les seuils des paliers s'expriment dans cette échelle."""
    tres_bon = service.evaluer([(ReliabilityEventType.COLLAB_COMPLETED, Decimal("5"))] * 100)
    tres_mauvais = service.evaluer([(ReliabilityEventType.UNFULFILLED, Decimal("-30"))] * 100)

    assert tres_bon.reliability_score == service.SCORE_MAX
    assert tres_mauvais.reliability_score == service.SCORE_MIN


# --------------------------------------------------------------------------
# les seuils rallumés
# --------------------------------------------------------------------------


async def test_les_seuils_de_collaborations_sont_retablis(session: AsyncSession) -> None:
    """Ils avaient été mis à zéro faute de compteur alimenté. Le compteur
    existe, la condition est rallumée."""
    seuils = dict(
        ((platform, content_format), minimum)
        for platform, content_format, minimum in (
            await session.execute(
                sa.select(Tier.platform, Tier.content_format, Tier.min_completed_collabs)
            )
        ).all()
    )

    assert seuils[("instagram", "post")] == 1
    assert seuils[("instagram", "reel")] == 2
    # Le palier d'entrée reste ouvert à qui n'a aucun historique : c'est le
    # seul par lequel on peut commencer.
    assert seuils[("instagram", "story")] == 0


# --------------------------------------------------------------------------
# l'effet du score sur les paliers accessibles
# --------------------------------------------------------------------------


async def test_un_score_degrade_plafonne_le_createur(session: AsyncSession) -> None:
    """Le palier reel exige un score minimal. Un créateur qui ne tient pas ses
    engagements le perd, même s'il garde ses abonnés — c'est tout l'objet du
    score, et sans cet effet il ne serait qu'un chiffre décoratif.
    """
    from app.services import creator_tiers
    from tests.test_creator_tiers import REEL, STORY, compte, createur

    user = await createur(session)
    createur_id = user.id
    await compte(session, user, followers=24_000)

    # Assez de collaborations pour ouvrir le palier reel par le volume.
    for _ in range(3):
        await service.enregistrer(
            session, creator_id=createur_id, type_=ReliabilityEventType.COLLAB_COMPLETED
        )

    seuil = await session.scalar(sa.select(Tier.min_reliability_score).where(Tier.id == REEL))
    assert seuil is not None, "le palier reel n'a pas de condition de score à éprouver"

    avant = await creator_tiers.vue_des_paliers(session, createur_id)
    reel_avant = next(p for p in avant.paliers if p.tier_id == REEL)
    assert reel_avant.accessible is True

    # Deux absences : le score tombe sous le seuil.
    for _ in range(2):
        await service.enregistrer(
            session, creator_id=createur_id, type_=ReliabilityEventType.NO_SHOW
        )

    apres = await creator_tiers.vue_des_paliers(session, createur_id)
    reel_apres = next(p for p in apres.paliers if p.tier_id == REEL)

    assert reel_apres.accessible is False
    raisons = {o.raison for o in reel_apres.obstacles}
    assert RaisonRefus.RELIABILITY_SCORE_TOO_LOW in raisons

    # Le palier d'entrée reste ouvert : le plafonnement n'est pas une
    # exclusion. Un créateur qui a mal fait doit pouvoir remonter.
    story_apres = next(p for p in apres.paliers if p.tier_id == STORY)
    assert story_apres.accessible is True


async def test_un_score_nul_n_est_pas_un_mauvais_score(session: AsyncSession) -> None:
    """Le pendant : le cold start reste neutre. Si un score nul échouait à la
    condition, aucun débutant n'accéderait à rien."""
    from app.services import creator_tiers
    from tests.test_creator_tiers import STORY, compte, createur

    user = await createur(session)
    createur_id = user.id
    await compte(session, user, followers=24_000)

    assert (await profil(session, createur_id)).reliability_score is None

    vue = await creator_tiers.vue_des_paliers(session, createur_id)
    story = next(p for p in vue.paliers if p.tier_id == STORY)

    assert story.accessible is True
    assert vue.is_new_creator is True


# --------------------------------------------------------------------------
# prévenir coûte moins que disparaître
# --------------------------------------------------------------------------


def test_l_annulation_tardive_coute_moins_que_l_absence() -> None:
    """**L'écart est l'incitation.** Le réduire l'affaiblit, l'annuler la supprime.

    Éprouvé sur les poids et non sur un score : c'est la grille qui porte la
    règle, et deux poids égaux la videraient sans qu'aucun scénario ne tombe.
    """
    assert service.poids(ReliabilityEventType.CANCELLED_LATE) > service.poids(
        ReliabilityEventType.NO_SHOW
    )
    assert service.poids(ReliabilityEventType.CANCELLED_LATE) < 0, (
        "à zéro, annuler à la dernière minute deviendrait gratuit"
    )


def test_une_seule_annulation_tardive_laisse_le_haut_de_l_echelle_ouvert() -> None:
    """**Le cas que le seuil frôlait, et c'est ce test qui l'a fait bouger.**

    À -10, le compte tombait sur 70 - 10 = 60, c'est-à-dire **exactement** le
    minimum du reel : une créatrice qui avait prévenu n'y passait que parce que
    la comparaison est `>=`, et un point sur n'importe lequel des trois réglages
    lui fermait le haut de l'échelle. C'était l'inverse de ce que cet événement
    existe pour faire.

    Le poids est donc descendu à -5. La marge est écrite en toutes lettres
    ci-dessous, et non déduite : le prochain réglage se décidera sur un nombre
    qu'on lit, pas sur un souvenir.
    """
    from app.services.eligibility import VerdictScore, evaluer_score

    caches = service.evaluer([(ReliabilityEventType.CANCELLED_LATE, Decimal("0"))])

    assert caches.reliability_score == Decimal("65.00")
    assert evaluer_score(Decimal("60.00"), caches.reliability_score) is VerdictScore.TENUE
    # **Cinq points de marge, affirmés.** Sans cette ligne le test resterait
    # vert à 60,01 comme à 65, et ne dirait plus rien de ce qui reste avant le
    # seuil — c'est-à-dire plus rien du tout.
    assert caches.reliability_score - Decimal("60") == Decimal("5.00")
    # Et une absence, elle, ferme : c'est la différence qu'on achète.
    absente = service.evaluer([(ReliabilityEventType.NO_SHOW, Decimal("0"))])
    assert evaluer_score(Decimal("60.00"), absente.reliability_score) is VerdictScore.MANQUEE


def test_une_creatrice_sans_evenement_garde_un_score_nul() -> None:
    """**Le piège déjà nommé, revérifié.** Un événement fait exister un score.

    Celui-ci n'est pas neutre, donc il doit en faire exister un — mais la
    créatrice qui n'a rien fait ne doit toujours pas en avoir : un score nul est
    une condition ignorée, un score bas est une condition manquée, et les deux
    ne ferment pas les mêmes paliers.
    """
    assert service.evaluer([]).reliability_score is None
