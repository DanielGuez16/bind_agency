"""La quatrième issue de l'arbitrage : clore sans mettre au débit de personne.

Trois refus pour le **même** motif ne disent pas qu'une créatrice est de
mauvaise foi. Ils disent que la demande n'a jamais été comprise, et que la
liste fermée de motifs n'a pas su la porter. Trois motifs **différents** disent
l'inverse.

Ce qui est éprouvé, et chaque fois sur le cas où deux implémentations
divergent :

— **aucun événement de fiabilité n'est écrit.** Le test l'affirme en comparant
  avec `unfulfilled`, dans le même décor : sans cette moitié, un système où le
  mécanisme d'événements serait cassé passerait le test d'absence sans rien
  garantir ;
— **le score reste nul**, pas seulement inchangé. C'est la différence entre ne
  rien écrire et écrire un événement de poids nul : `evaluer` rend un score dès
  qu'un événement existe, et une créatrice dont l'unique événement serait cette
  clôture passerait de « pas encore de score » à un nombre comparable au seuil
  d'un palier ;
— **la répétition se compte de suite**, pas en tout. Le décor pose donc une
  séquence où les deux règles divergent — mention, format, mention — sans quoi
  compter les occurrences et compter la suite rendraient le même nombre.
"""

import uuid

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Collaboration, CreatorProfile, ReliabilityEvent
from app.models.enums import CollaborationStatus, UserRole
from app.services import collaboration as service
from app.services.audit import Actor
from tests.conftest import inscrire_verifie
from tests.test_collaboration import contrepartie
from tests.test_counterpart_queue import statut

PREFIX = get_settings().api_v1_prefix
MOT_DE_PASSE = "tourbillon-cactus-91-vermeil"


async def _evenements(session: AsyncSession, creator_id: uuid.UUID) -> list[str]:
    return [
        ligne
        for ligne in await session.scalars(
            sa.select(ReliabilityEvent.type).where(ReliabilityEvent.creator_id == creator_id)
        )
    ]


async def _refuser(session: AsyncSession, ligne, s, motif: str) -> None:
    """Un refus de plus, par le chemin réel."""
    await statut(session, ligne, CollaborationStatus.SUBMITTED)
    await service.demander_une_nouvelle_soumission(
        session,
        collaboration=ligne,
        actor=Actor.from_user(s["caissier"]),
        reason=motif,
    )


# --------------------------------------------------------------------------
# aucun événement, ni positif ni négatif
# --------------------------------------------------------------------------


async def test_fermer_sans_faute_n_ecrit_aucun_evenement(session: AsyncSession) -> None:
    """**Et la comparaison est ce qui le prouve.**

    Le même décor, deux issues : `unfulfilled` écrit un événement, la clôture
    sans faute n'en écrit aucun. Sans la première moitié, un mécanisme
    d'événements cassé passerait le test d'absence sans rien garantir.
    """
    ligne, s = await contrepartie(session)
    await statut(session, ligne, CollaborationStatus.SUBMITTED)
    await service.fermer_sans_faute(
        session,
        collaboration=ligne,
        actor=Actor.from_user(s["caissier"]),
        reason="missing_mention",
    )

    assert await _evenements(session, s["createur"].id) == []

    # Le même geste par l'autre issue, sur un second dossier : lui écrit.
    autre, autre_s = await contrepartie(session)
    await statut(session, autre, CollaborationStatus.SUBMITTED)
    await service.constater_non_honoree(
        session,
        collaboration=autre,
        actor=Actor.from_user(autre_s["caissier"]),
        reason="missing_mention",
    )
    assert await _evenements(session, autre_s["createur"].id) == ["unfulfilled"]


async def test_le_score_reste_nul_et_ne_devient_pas_un_nombre(
    session: AsyncSession,
) -> None:
    """**La différence entre ne rien écrire et écrire un poids nul.**

    `evaluer` rend un score dès qu'un événement existe, quel que soit son poids.
    Une créatrice dont l'unique événement serait cette clôture passerait donc de
    « pas encore de score » — neutre, condition ignorée par les paliers — à un
    nombre comparable au seuil d'un palier. C'est cette assertion qui écarte
    l'événement neutre, et pas la précédente.
    """
    ligne, s = await contrepartie(session)
    await statut(session, ligne, CollaborationStatus.SUBMITTED)
    await service.fermer_sans_faute(
        session,
        collaboration=ligne,
        actor=Actor.from_user(s["caissier"]),
        reason="missing_mention",
    )
    await session.flush()

    profil = await session.get(CreatorProfile, s["createur"].id)
    assert profil is not None
    assert profil.reliability_score is None
    assert profil.completed_collabs_count == 0


async def test_le_dossier_est_bien_clos_et_ne_se_rouvre_pas(
    session: AsyncSession,
) -> None:
    """Terminal, comme les deux autres issues. Sans quoi ce serait un répit."""
    ligne, s = await contrepartie(session)
    await statut(session, ligne, CollaborationStatus.SUBMITTED)
    await service.fermer_sans_faute(
        session,
        collaboration=ligne,
        actor=Actor.from_user(s["caissier"]),
        reason="missing_mention",
    )

    assert ligne.status is CollaborationStatus.CLOSED_NO_FAULT
    assert service.TRANSITIONS[CollaborationStatus.CLOSED_NO_FAULT] == frozenset()

    with pytest.raises(service.TransitionNotAllowed):
        await service.approuver(session, collaboration=ligne, actor=Actor.from_user(s["caissier"]))

    # La session reste saine : on s'en sert encore après le refus.
    assert await session.get(Collaboration, ligne.id) is not None


async def test_la_creatrice_est_prevenue(session: AsyncSession) -> None:
    """Sans message, elle attend une réponse qui ne viendra jamais."""
    from app.models import OutboundMessage

    ligne, s = await contrepartie(session)
    await statut(session, ligne, CollaborationStatus.SUBMITTED)
    await service.fermer_sans_faute(
        session,
        collaboration=ligne,
        actor=Actor.from_user(s["caissier"]),
        reason="missing_mention",
    )
    await session.flush()

    cles = [
        c
        for c in await session.scalars(
            sa.select(OutboundMessage.template_key).where(
                OutboundMessage.user_id == s["createur"].id
            )
        )
    ]
    assert "collaboration.closed_no_fault" in cles


# --------------------------------------------------------------------------
# la répétition, comptée de suite
# --------------------------------------------------------------------------


async def test_la_repetition_se_compte_de_suite_et_non_en_tout(
    session: AsyncSession,
) -> None:
    """**Le décor qui diverge : mention, format, mention.**

    En tout, la mention a été opposée deux fois. De suite, une seule. Un dossier
    où deux choses clochaient n'est pas un dossier où la mention n'a jamais été
    comprise, et l'écran ne doit pas proposer de fermer sans faute.
    """
    ligne, s = await contrepartie(session)
    for motif in ("missing_mention", "wrong_format", "missing_mention"):
        await _refuser(session, ligne, s, motif)
    await session.flush()

    file = await service.lister_pour_le_commerce(session, business_id=s["business"].id)
    lue = next(f for f in file if f.collaboration_id == ligne.id)

    assert lue.dernier_motif == "missing_mention"
    assert lue.repetitions_du_dernier_motif == 1
    assert lue.meme_motif_repete is False


async def test_trois_fois_le_meme_motif_leve_le_drapeau(session: AsyncSession) -> None:
    """**Le sens inverse.** Un drapeau toujours faux passerait le test ci-dessus."""
    ligne, s = await contrepartie(session)
    for _ in range(get_settings().collaboration_max_attempts):
        await _refuser(session, ligne, s, "missing_mention")
    await session.flush()

    file = await service.lister_pour_le_commerce(session, business_id=s["business"].id)
    lue = next(f for f in file if f.collaboration_id == ligne.id)

    assert lue.repetitions_du_dernier_motif == get_settings().collaboration_max_attempts
    assert lue.meme_motif_repete is True


async def test_sans_refus_il_n_y_a_pas_de_repetition(session: AsyncSession) -> None:
    """Zéro, et le drapeau baissé. Le vide est ici le bon résultat."""
    ligne, s = await contrepartie(session)
    await session.flush()

    file = await service.lister_pour_le_commerce(session, business_id=s["business"].id)
    lue = next(f for f in file if f.collaboration_id == ligne.id)

    assert lue.repetitions_du_dernier_motif == 0
    assert lue.meme_motif_repete is False


# --------------------------------------------------------------------------
# ce que l'arbitrage nous apprend sur nous
# --------------------------------------------------------------------------


async def test_le_motif_qui_boucle_est_compte_pour_l_administration(
    session: AsyncSession,
) -> None:
    """Un dossier qui boucle compte **une fois**, pas trois.

    Ce sont des dossiers qu'on compte, pas des refus : « la mention a bouclé sur
    douze dossiers » se décide, « trente-six refus de mention » ne se décide
    pas.
    """
    seuil = get_settings().collaboration_max_attempts
    ligne, s = await contrepartie(session)
    for _ in range(seuil):
        await _refuser(session, ligne, s, "missing_mention")

    # Un second dossier où le même motif ne boucle pas : il compte dans
    # « touchés » et pas dans « bouclés », et c'est l'écart qui informe.
    autre, autre_s = await contrepartie(session)
    await _refuser(session, autre, autre_s, "missing_mention")
    await session.flush()

    lignes = {m.motif: m for m in await service.motifs_qui_reviennent(session)}

    assert lignes["missing_mention"].dossiers == 1
    assert lignes["missing_mention"].dossiers_touches == 2
    # Un motif qui n'a jamais bouclé n'apparaît pas : une liste de zéros ne se
    # lit pas.
    assert "low_quality" not in lignes


async def test_les_motifs_alternes_ne_bouclent_pas(session: AsyncSession) -> None:
    """**Le sens inverse, et il est le cœur de la règle.**

    Trois refus, trois motifs différents : rien ne boucle. Un compteur qui
    additionnerait les refus rendrait trois, et l'administration chercherait une
    exigence mal formulée là où il n'y en a pas.
    """
    ligne, s = await contrepartie(session)
    for motif in ("missing_mention", "wrong_format", "missing_location"):
        await _refuser(session, ligne, s, motif)
    await session.flush()

    assert await service.motifs_qui_reviennent(session) == ()


# --------------------------------------------------------------------------
# la route
# --------------------------------------------------------------------------


async def test_l_arbitre_peut_fermer_sans_faute(client: AsyncClient, session: AsyncSession) -> None:
    ligne, s = await contrepartie(session)
    for _ in range(get_settings().collaboration_max_attempts):
        await _refuser(session, ligne, s, "missing_mention")
    assert ligne.needs_human_review is True

    admin = await inscrire_verifie(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password=MOT_DE_PASSE,
        role=UserRole.ADMIN,
    )
    await session.commit()

    avant_decision = await _evenements(session, s["createur"].id)
    assert avant_decision, "sans refus au décor, le delta ne prouverait rien"

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login", json={"email": admin.email, "password": MOT_DE_PASSE}
        )
    ).json()
    reponse = await client.post(
        f"{PREFIX}/admin/collaborations/{ligne.id}/decision",
        json={"issue": "close_no_fault", "reason": "missing_mention"},
        headers={"Authorization": f"Bearer {jetons['access_token']}"},
    )

    assert reponse.status_code == 200, reponse.text
    assert reponse.json()["status"] == "closed_no_fault"

    # **Un delta, pas un total.** Les trois refus du décor ont chacun écrit un
    # `resubmit_required` : exiger une liste vide éprouverait le décor et non la
    # clôture. Ce qui compte est que la décision n'ajoute rien.
    assert await _evenements(session, s["createur"].id) == avant_decision


def test_le_commerce_n_a_pas_cette_issue_dans_son_vocabulaire() -> None:
    """C'est le produit qu'elle met en cause, et ce n'est pas au salon de le
    constater.

    Sa décision est un booléen — approuver ou redemander — et n'a aucun champ
    par où l'issue pourrait entrer. L'assertion porte sur les champs du schéma
    plutôt que sur une exception : une liste fermée qui refuserait pour une
    autre raison rendrait le même verdict, et le test n'éprouverait plus ce
    qu'il annonce.
    """
    from app.schemas.collaboration import DecisionCommerce, IssueDArbitrage

    assert set(DecisionCommerce.model_fields) == {"approuve", "reason", "note"}
    # Et l'issue existe bien du côté de l'arbitre : sans cette moitié, un
    # vocabulaire vide des deux côtés passerait la première assertion.
    assert IssueDArbitrage.FERMER_SANS_FAUTE.value == "close_no_fault"


async def test_un_dossier_refuse_plus_que_le_seuil_reste_un_dossier(
    session: AsyncSession,
) -> None:
    """**Le décor qui diverge, et il n'est pas gratuit.**

    À exactement trois refus, « atteint le seuil » et « a dépassé le seuil »
    rendent le même compte. Au quatrième, le second compte le dossier une
    seconde fois — et l'administration lirait deux dossiers là où il n'y en a
    qu'un, sur le chiffre même qui décide de réécrire une exigence.
    """
    seuil = get_settings().collaboration_max_attempts
    ligne, s = await contrepartie(session)
    for _ in range(seuil + 1):
        await _refuser(session, ligne, s, "missing_mention")
    await session.flush()

    lignes = {m.motif: m for m in await service.motifs_qui_reviennent(session)}

    assert lignes["missing_mention"].dossiers == 1
    assert lignes["missing_mention"].dossiers_touches == 1
