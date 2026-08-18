"""Machine à états de la réservation.

Le test central est celui qui parcourt **toutes** les paires d'états et vérifie
que seules celles du diagramme passent. Éprouver les transitions légales une par
une prouverait qu'elles fonctionnent, pas qu'aucune autre n'existe — et c'est la
transition qu'on a oublié d'interdire qui coûte cher.

Le reste porte sur ce qui décide de l'issue d'une annulation : le délai, jamais
l'intention de l'appelant.
"""

import itertools
import uuid
from datetime import UTC, datetime, timedelta

import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.integrations.geocoding import ManualGeocoder
from app.models import AuditLog, Booking, ReliabilityEvent
from app.models.enums import ActorKind, BookingStatus, BusinessCategory, UserRole
from app.schemas.business import BusinessCreate, CoordinatesPayload
from app.services import auth as auth_service
from app.services import availability, redemption
from app.services import booking_states as service
from app.services import business as business_service
from app.services.audit import Actor
from tests.test_booking_create import monter_le_decor, premier_creneau, reserver

#: Le diagramme de SPEC.md §4.1, recopié à la main **exprès**. Il sert d'oracle
#: à la table du service : si les deux divergent, c'est que l'une des deux a
#: changé sans l'autre, et c'est précisément ce qu'on veut voir.
DIAGRAMME = {
    # Deux portes depuis `held` : le commerce en automatique confirme tout de
    # suite, celui en validation reçoit la réservation en attente.
    ("held", "confirmed"),
    ("held", "awaiting_business"),
    ("held", "cancelled"),
    ("held", "expired"),
    # Ce que le commerce peut faire de ce qu'il a reçu, plus l'échéance.
    ("awaiting_business", "confirmed"),
    ("awaiting_business", "cancelled"),
    ("awaiting_business", "expired"),
    ("confirmed", "consumed"),
    # Deux appelants pour cette flèche : le créateur qui prévient à temps, et
    # le commerce qui se désiste. Qui a le droit de la prendre est une question
    # d'appelant, pas de forme.
    ("confirmed", "cancelled"),
    ("confirmed", "no_show"),
}


async def reservation(session: AsyncSession, **kwargs) -> tuple[Booking, dict]:
    decor = await monter_le_decor(session, **kwargs)
    creneau = (
        await premier_creneau(session, decor) if kwargs.get("requires_booking", True) else None
    )
    return await reserver(session, decor, starts_at=creneau), decor


def acteur(decor: dict) -> Actor:
    return Actor(kind=ActorKind.CREATOR, user_id=decor["createur"].id)


# --------------------------------------------------------------------------
# le diagramme, en entier
# --------------------------------------------------------------------------


def test_la_table_du_service_est_exactement_le_diagramme() -> None:
    """Recopié à la main d'un côté, déclaré de l'autre. Ils doivent coïncider.

    Dériver l'oracle de la table qu'il vérifie n'aurait aucun sens : il serait
    toujours d'accord avec elle, y compris le jour où quelqu'un y ajoute une
    flèche par erreur.
    """
    declarees = {
        (depuis.value, vers.value)
        for depuis, versions in service.TRANSITIONS.items()
        for vers in versions
    }
    assert declarees == DIAGRAMME


def test_tous_les_etats_figurent_dans_la_table() -> None:
    """Un état absent lèverait un `KeyError` au premier essai de transition,
    c'est-à-dire en production plutôt qu'ici."""
    assert set(service.TRANSITIONS) == set(BookingStatus)


@pytest.mark.parametrize(
    ("depuis", "vers"),
    [
        (a, b)
        for a, b in itertools.product(BookingStatus, repeat=2)
        if (a.value, b.value) not in DIAGRAMME
    ],
)
async def test_aucune_transition_hors_diagramme_ne_passe(
    depuis: BookingStatus, vers: BookingStatus, session: AsyncSession
) -> None:
    """Toutes les paires, y compris un état vers lui-même.

    Trente combinaisons interdites sur trente-six : les éprouver une par une est
    le seul moyen de savoir qu'aucune n'a été laissée ouverte.
    """
    ligne, decor = await reservation(session)
    # `awaiting_business` exige son échéance d'accord : une demande sans
    # échéance n'expirerait jamais, et la contrainte le refuse. On la calcule
    # avec la fonction du produit plutôt que de poser une date à la main — une
    # valeur posée ici masquerait la disparition du mécanisme.
    echeance = (
        service.echeance_d_accord(ligne) if depuis is BookingStatus.AWAITING_BUSINESS else None
    )
    await session.execute(
        sa.update(Booking)
        .where(Booking.id == ligne.id)
        .values(status=depuis, approval_expires_at=echeance)
    )
    await session.refresh(ligne)

    with pytest.raises(service.TransitionNotAllowed):
        await service.transitionner(
            session, booking=ligne, vers=vers, actor=acteur(decor), reason="essai"
        )

    # La session reste utilisable, et l'état n'a pas bougé.
    assert (
        await session.scalar(sa.select(Booking.status).where(Booking.id == ligne.id))
        == depuis.value
    )


# --------------------------------------------------------------------------
# confirmation
# --------------------------------------------------------------------------


async def test_la_confirmation_efface_le_garde(session: AsyncSession) -> None:
    """Le laisser en place ferait mentir toute lecture qui s'y fie, à commencer
    par le calcul de disponibilité."""
    ligne, decor = await reservation(session)

    await service.confirmer(session, booking=ligne, creator_id=decor["createur"].id)

    assert ligne.status is BookingStatus.CONFIRMED
    assert ligne.hold_expires_at is None


async def test_un_garde_expire_ne_se_confirme_plus(session: AsyncSession) -> None:
    """Entre l'échéance et le balayage, la place est déjà rendue : le calcul de
    disponibilité la propose à quelqu'un d'autre. Confirmer là vendrait deux
    fois la même place."""
    ligne, decor = await reservation(session)
    ligne.hold_expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await session.flush()

    with pytest.raises(service.HoldExpired):
        await service.confirmer(session, booking=ligne, creator_id=decor["createur"].id)

    assert ligne.status is BookingStatus.HELD


async def test_la_reservation_d_un_autre_ne_se_confirme_pas(session: AsyncSession) -> None:
    ligne, _ = await reservation(session)
    autre = await auth_service.register(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password="un-mot-de-passe-solide-42",
        role=UserRole.CREATOR,
    )

    with pytest.raises(service.NotYours):
        await service.confirmer(session, booking=ligne, creator_id=autre.id)


# --------------------------------------------------------------------------
# annulation : c'est le délai qui décide
# --------------------------------------------------------------------------


async def test_un_held_s_annule_toujours_sans_penalite(session: AsyncSession) -> None:
    """Rien n'a encore été promis, et le garde serait tombé tout seul."""
    ligne, decor = await reservation(session)
    # Créneau imminent : hors fenêtre, et pourtant sans pénalité.
    ligne.starts_at = datetime.now(UTC) + timedelta(minutes=30)
    ligne.ends_at = ligne.starts_at + timedelta(minutes=60)
    await session.flush()

    await service.annuler(session, booking=ligne, creator_id=decor["createur"].id)

    assert ligne.status is BookingStatus.CANCELLED


async def test_une_annulation_a_temps_est_sans_penalite(session: AsyncSession) -> None:
    ligne, decor = await reservation(session)
    await service.confirmer(session, booking=ligne, creator_id=decor["createur"].id)

    fenetre = get_settings().booking_free_cancellation_seconds
    ligne.starts_at = datetime.now(UTC) + timedelta(seconds=fenetre + 3600)
    ligne.ends_at = ligne.starts_at + timedelta(minutes=60)
    await session.flush()

    await service.annuler(session, booking=ligne, creator_id=decor["createur"].id)

    assert ligne.status is BookingStatus.CANCELLED
    assert ligne.cancelled_at is not None


async def test_une_annulation_tardive_devient_une_absence(session: AsyncSession) -> None:
    """Le commerce a bloqué un poste qu'il ne remplira plus."""
    ligne, decor = await reservation(session)
    await service.confirmer(session, booking=ligne, creator_id=decor["createur"].id)

    fenetre = get_settings().booking_free_cancellation_seconds
    ligne.starts_at = datetime.now(UTC) + timedelta(seconds=fenetre - 3600)
    ligne.ends_at = ligne.starts_at + timedelta(minutes=60)
    await session.flush()

    await service.annuler(session, booking=ligne, creator_id=decor["createur"].id)

    assert ligne.status is BookingStatus.NO_SHOW
    # Et le journal dit pourquoi : la pénalité doit être explicable.
    ligne_journal = await session.scalar(
        sa.select(AuditLog).where(
            AuditLog.entity_id == ligne.id,
            AuditLog.to_status == BookingStatus.NO_SHOW.value,
        )
    )
    assert ligne_journal is not None
    assert ligne_journal.reason


async def test_un_item_sans_creneau_s_annule_toujours_sans_penalite(
    session: AsyncSession,
) -> None:
    """`no_show` n'a pas de sens sans heure à laquelle ne pas se présenter."""
    ligne, decor = await reservation(session, requires_booking=False)
    await service.confirmer(session, booking=ligne, creator_id=decor["createur"].id)

    await service.annuler(session, booking=ligne, creator_id=decor["createur"].id)

    assert ligne.status is BookingStatus.CANCELLED


async def test_une_absence_sur_un_item_sans_creneau_est_refusee(
    session: AsyncSession,
) -> None:
    """Évite qu'un commerce pénalise un créateur pour une absence qui n'existe
    pas. L'expiration suffit."""
    ligne, decor = await reservation(session, requires_booking=False)
    await service.confirmer(session, booking=ligne, creator_id=decor["createur"].id)

    with pytest.raises(service.NoShowNotApplicable):
        await service.marquer_absent(session, booking=ligne, actor=acteur(decor), reason="absent")

    assert ligne.status is BookingStatus.CONFIRMED


# --------------------------------------------------------------------------
# le délai avant qu'une absence puisse être constatée
# --------------------------------------------------------------------------


async def test_une_absence_avant_le_delai_est_refusee(session: AsyncSession) -> None:
    """**Le défaut que ce délai répare.** Rien n'empêchait un salon de marquer
    absente une créatrice à l'heure pile — pendant qu'elle poussait la porte.
    L'événement de fiabilité que la transition écrit, lui, ne se retire pas.

    L'instant est passé explicitement : lire l'horloge dans le test rendrait le
    résultat dépendant de la seconde à laquelle il tourne.
    """
    ligne, decor = await reservation(session)
    await service.confirmer(session, booking=ligne, creator_id=decor["createur"].id)
    delai = get_settings().no_show_delai_minutes

    with pytest.raises(service.AbsenceTropTot):
        await service.marquer_absent(
            session,
            booking=ligne,
            actor=acteur(decor),
            reason="pas là",
            maintenant=ligne.starts_at + timedelta(minutes=delai - 1),
        )

    assert ligne.status is BookingStatus.CONFIRMED
    # Et aucune pénalité n'a été écrite au passage : un refus qui laisserait
    # l'événement derrière lui serait pire que pas de refus du tout.
    evenements = await session.scalars(
        sa.select(ReliabilityEvent).where(ReliabilityEvent.booking_id == ligne.id)
    )
    assert list(evenements) == []


async def test_une_absence_au_delai_exact_passe(session: AsyncSession) -> None:
    """Le sens inverse, et il compte autant.

    Une garde qui refuserait *toute* absence passerait le test de refus sans
    rien garantir — et le mode terrain se découvrirait inutilisable un samedi.
    La borne est inclusive : à la minute pile, l'attente a été tenue.
    """
    ligne, decor = await reservation(session)
    await service.confirmer(session, booking=ligne, creator_id=decor["createur"].id)
    # **L'ouverture n'est plus le seul délai de retard.** Elle est le plus tard
    # des deux — retard tenu et fenêtre de signalement fermée — et c'est cette
    # borne-là qui doit être inclusive. La lire du service plutôt que de la
    # recalculer ici : un test qui recopie la formule ne vérifie que sa propre
    # arithmétique.
    ouverture = service.absence_signalable_a(ligne)
    assert ouverture is not None

    await service.marquer_absent(
        session,
        booking=ligne,
        actor=acteur(decor),
        reason="pas là",
        maintenant=ouverture,
    )

    assert ligne.status is BookingStatus.NO_SHOW


async def test_le_delai_vient_de_la_configuration_et_non_du_code(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Un seuil recopié en dur se découvre le jour où on l'ajuste et où rien ne
    bouge. On le déplace, et le comportement doit suivre.

    **C'est la fenêtre de signalement qu'on déplace, et non le délai de
    retard.** Depuis que l'ouverture est le plus tard des deux, allonger le seul
    délai de retard ne change plus rien tant qu'il reste sous la fenêtre — ce
    test passait alors sans éprouver quoi que ce soit d'utile. On déplace donc
    celui des deux qui décide, et le second est éprouvé à part, sur le cas où il
    reprend la main.
    """
    from app.services import booking_states as module

    reglages = get_settings().model_copy(update={"venue_report_window_seconds": 6 * 3600})
    monkeypatch.setattr(module, "get_settings", lambda: reglages)

    ligne, decor = await reservation(session)
    await service.confirmer(session, booking=ligne, creator_id=decor["createur"].id)

    # Quatre heures suffisaient avant : avec le nouveau réglage, plus.
    with pytest.raises(service.AbsenceTropTot):
        await service.marquer_absent(
            session,
            booking=ligne,
            actor=acteur(decor),
            reason="pas là",
            maintenant=ligne.starts_at + timedelta(hours=4),
        )

    assert service.absence_signalable_a(ligne) == ligne.starts_at + timedelta(hours=6)


async def test_un_item_sans_creneau_n_ouvre_jamais_l_absence(session: AsyncSession) -> None:
    """`None` et non une date lointaine : l'écran doit pouvoir ne pas dessiner
    le bouton du tout, pas le dessiner grisé pour toujours."""
    ligne, _ = await reservation(session, requires_booking=False)

    assert service.absence_signalable_a(ligne) is None


# --------------------------------------------------------------------------
# journal
# --------------------------------------------------------------------------


async def test_chaque_transition_ecrit_sa_ligne(session: AsyncSession) -> None:
    """Une réservation qui change d'état sans qu'on sache qui l'a décidé n'est
    pas opposable — et c'est exactement ce qu'un commerce contestera."""
    ligne, decor = await reservation(session)
    await service.confirmer(session, booking=ligne, creator_id=decor["createur"].id)
    await service.consommer(session, booking=ligne, actor=acteur(decor))

    lignes = (
        await session.execute(
            sa.select(AuditLog.from_status, AuditLog.to_status)
            .where(AuditLog.entity_id == ligne.id)
            .order_by(AuditLog.occurred_at)
        )
    ).all()

    # Création comprise : trois écritures pour trois changements d'état.
    assert [(ligne_journal.from_status, ligne_journal.to_status) for ligne_journal in lignes] == [
        (None, "held"),
        ("held", "confirmed"),
        ("confirmed", "consumed"),
    ]
    assert ligne.consumed_at is not None


# --------------------------------------------------------------------------
# expiration des gardes
# --------------------------------------------------------------------------


async def test_le_balayage_expire_les_gardes_depasses(session: AsyncSession) -> None:
    ligne, _ = await reservation(session)
    ligne.hold_expires_at = datetime.now(UTC) - timedelta(minutes=1)
    await session.flush()

    combien = await service.expirer_les_gardes_depasses(session)

    assert combien == 1
    await session.refresh(ligne)
    assert ligne.status is BookingStatus.EXPIRED
    assert ligne.hold_expires_at is None

    journal = await session.scalar(
        sa.select(AuditLog).where(
            AuditLog.entity_id == ligne.id, AuditLog.to_status == BookingStatus.EXPIRED.value
        )
    )
    assert journal is not None
    # Personne ne l'a demandé, le système l'a décidé — et il dit pourquoi.
    assert journal.actor_kind is ActorKind.SYSTEM
    assert journal.reason


async def test_le_balayage_epargne_un_garde_encore_valide(session: AsyncSession) -> None:
    """Le pendant. Un balayage qui expirerait tout passerait le test précédent
    sans rien garantir."""
    ligne, _ = await reservation(session)

    assert await service.expirer_les_gardes_depasses(session) == 0
    await session.refresh(ligne)
    assert ligne.status is BookingStatus.HELD


async def test_le_balayage_ignore_ce_qui_n_est_plus_held(session: AsyncSession) -> None:
    ligne, decor = await reservation(session)
    await service.confirmer(session, booking=ligne, creator_id=decor["createur"].id)
    # Une échéance dépassée qui traînerait ne doit rien déclencher.
    ligne.hold_expires_at = datetime.now(UTC) - timedelta(hours=1)
    await session.flush()

    assert await service.expirer_les_gardes_depasses(session) == 0
    assert ligne.status is BookingStatus.CONFIRMED


async def test_la_place_expiree_redevient_disponible(session: AsyncSession) -> None:
    """La boucle complète : une place tenue puis abandonnée revient au fil."""
    from app.services import availability

    decor = await monter_le_decor(session, postes=1)
    creneau = await premier_creneau(session, decor)
    ligne = await reserver(session, decor, starts_at=creneau)

    ligne.hold_expires_at = datetime.now(UTC) - timedelta(minutes=1)
    await session.flush()
    await service.expirer_les_gardes_depasses(session)

    libres = await availability.creneaux_libres(
        session, business_id=decor["business"].id, catalog_item_id=decor["item"].id
    )
    assert creneau in {c.starts_at for c in libres}


async def test_une_reservation_expiree_ne_se_confirme_plus(session: AsyncSession) -> None:
    ligne, decor = await reservation(session)
    ligne.hold_expires_at = datetime.now(UTC) - timedelta(minutes=1)
    await session.flush()
    await service.expirer_les_gardes_depasses(session)

    with pytest.raises(service.TransitionNotAllowed):
        await service.confirmer(session, booking=ligne, creator_id=decor["createur"].id)


async def test_une_reservation_consommee_est_terminale(session: AsyncSession) -> None:
    ligne, decor = await reservation(session)
    await service.confirmer(session, booking=ligne, creator_id=decor["createur"].id)
    await service.consommer(session, booking=ligne, actor=acteur(decor))

    for vers in BookingStatus:
        with pytest.raises(service.TransitionNotAllowed):
            await service.transitionner(
                session, booking=ligne, vers=vers, actor=acteur(decor), reason="essai"
            )


# --------------------------------------------------------------------------
# La validation par le commerce, et son annulation
# --------------------------------------------------------------------------


class TestValidationParLeCommerce:
    """SPEC.md §4.1. La validation est le défaut, pas l'option."""

    async def test_le_defaut_du_produit_est_la_validation(self, session: AsyncSession) -> None:
        """Un commerce créé sans rien dire valide ses réservations.

        Passe par le service de création, sans toucher au réglage : le décor des
        tests le désactive — c'est un montage — et l'interroger là aurait
        vérifié ce que le décor pose, pas ce que le produit décide. La première
        version de ce test faisait exactement cela, et elle survivait à
        l'inversion du défaut.
        """
        proprietaire = await auth_service.register(
            session,
            email=f"{uuid.uuid4()}@example.com",
            password="un-mot-de-passe-solide-42",
            role=UserRole.BUSINESS_MEMBER,
        )
        business = await business_service.create_business(
            session,
            payload=BusinessCreate(
                name="Salon sans réglage",
                category=BusinessCategory.BEAUTY,
                currency="USD",
                address="1234 Ocean Dr",
                coordinates=CoordinatesPayload(longitude=-80.1918, latitude=25.7617),
                timezone="America/New_York",
            ),
            creator=proprietaire,
            geocoder=ManualGeocoder(),
        )

        assert business.requires_booking_approval is True

    async def test_la_confirmation_s_arrete_en_attente(self, session: AsyncSession) -> None:
        decor = await monter_le_decor(session, requires_booking_approval=True)
        ligne = await reserver(session, decor, starts_at=await premier_creneau(session, decor))

        await service.confirmer(session, booking=ligne, creator_id=decor["createur"].id)

        assert ligne.status is BookingStatus.AWAITING_BUSINESS
        # Et aucun code n'existe : un code qui circulerait avant l'accord du
        # commerce serait consommable au comptoir sans qu'il ait rien accepté.
        assert await redemption.code_du_booking(session, booking=ligne) is None

    async def test_l_accord_confirme_et_fait_naitre_le_code(self, session: AsyncSession) -> None:
        decor = await monter_le_decor(session, requires_booking_approval=True)
        ligne = await reserver(session, decor, starts_at=await premier_creneau(session, decor))
        await service.confirmer(session, booking=ligne, creator_id=decor["createur"].id)

        await service.trancher(
            session,
            booking=ligne,
            business_id=decor["business"].id,
            user_id=decor["proprietaire"].id,
            accepte=True,
        )

        assert ligne.status is BookingStatus.CONFIRMED
        # Le code naît de l'arrivée dans `confirmed`, quelle que soit la porte.
        assert await redemption.code_du_booking(session, booking=ligne) is not None

    async def test_un_refus_sans_motif_est_refuse(self, session: AsyncSession) -> None:
        """Le créateur lit ce motif. Une décision sans raison ne se conteste pas."""
        decor = await monter_le_decor(session, requires_booking_approval=True)
        ligne = await reserver(session, decor, starts_at=await premier_creneau(session, decor))
        await service.confirmer(session, booking=ligne, creator_id=decor["createur"].id)

        for vide in (None, "", "   "):
            with pytest.raises(service.MotifRequis):
                await service.trancher(
                    session,
                    booking=ligne,
                    business_id=decor["business"].id,
                    user_id=decor["proprietaire"].id,
                    accepte=False,
                    motif=vide,
                )

        # La session reste saine, et la réservation n'a pas bougé.
        assert ligne.status is BookingStatus.AWAITING_BUSINESS

    async def test_un_refus_motive_annule_sans_penaliser(self, session: AsyncSession) -> None:
        decor = await monter_le_decor(session, requires_booking_approval=True)
        ligne = await reserver(session, decor, starts_at=await premier_creneau(session, decor))
        await service.confirmer(session, booking=ligne, creator_id=decor["createur"].id)

        await service.trancher(
            session,
            booking=ligne,
            business_id=decor["business"].id,
            user_id=decor["proprietaire"].id,
            accepte=False,
            motif="planning complet ce jour-là",
        )

        assert ligne.status is BookingStatus.CANCELLED
        assert await _evenements_de_fiabilite(session, decor["createur"].id) == []

    async def test_la_place_reste_tenue_pendant_l_attente(self, session: AsyncSession) -> None:
        """La relâcher permettrait de vendre deux fois le même créneau."""
        assert BookingStatus.AWAITING_BUSINESS in availability.STATUTS_OCCUPANTS


class TestAnnulationParLeCommerce:
    """Technicienne absente, fermeture imprévue."""

    async def _confirmee(self, session: AsyncSession) -> tuple:
        decor = await monter_le_decor(session)
        ligne = await reserver(session, decor, starts_at=await premier_creneau(session, decor))
        await service.confirmer(session, booking=ligne, creator_id=decor["createur"].id)
        return ligne, decor

    async def test_elle_ne_degrade_jamais_le_score(self, session: AsyncSession) -> None:
        """Même à moins de vingt-quatre heures.

        La fenêtre départage un créateur qui prévient d'un créateur qui ne vient
        pas ; elle n'a rien à dire quand c'est le commerce qui se désiste. Lui
        appliquer la même règle ferait porter au créateur la conséquence d'une
        décision qui n'est pas la sienne.
        """
        ligne, decor = await self._confirmee(session)
        # Le rendez-vous est dans l'heure : pour une annulation du créateur,
        # ce serait une absence. `ends_at` suit — une contrainte en base exige
        # qu'il découle de la durée, et elle a raison de le vérifier.
        ligne.starts_at = datetime.now(UTC) + timedelta(minutes=30)
        ligne.ends_at = ligne.starts_at + timedelta(minutes=ligne.duration_minutes)
        await session.flush()

        await service.annuler_par_le_commerce(
            session,
            booking=ligne,
            business_id=decor["business"].id,
            user_id=decor["proprietaire"].id,
            motif="technicienne absente",
        )

        assert ligne.status is BookingStatus.CANCELLED
        assert await _evenements_de_fiabilite(session, decor["createur"].id) == []

    async def test_le_motif_est_obligatoire(self, session: AsyncSession) -> None:
        ligne, decor = await self._confirmee(session)

        with pytest.raises(service.MotifRequis):
            await service.annuler_par_le_commerce(
                session,
                booking=ligne,
                business_id=decor["business"].id,
                user_id=decor["proprietaire"].id,
                motif="   ",
            )

        assert ligne.status is BookingStatus.CONFIRMED

    async def test_le_motif_est_journalise(self, session: AsyncSession) -> None:
        """C'est ce que le créateur lira, et ce qu'un litige relira."""
        ligne, decor = await self._confirmee(session)

        await service.annuler_par_le_commerce(
            session,
            booking=ligne,
            business_id=decor["business"].id,
            user_id=decor["proprietaire"].id,
            motif="fermeture imprévue",
        )

        motif = await session.scalar(
            sa.select(AuditLog.reason)
            .where(AuditLog.entity_id == ligne.id, AuditLog.to_status == "cancelled")
            .order_by(AuditLog.occurred_at.desc())
            .limit(1)
        )
        assert motif == "fermeture imprévue"

    async def test_un_autre_commerce_ne_peut_pas_annuler(self, session: AsyncSession) -> None:
        ligne, decor = await self._confirmee(session)
        autre = await monter_le_decor(session)

        with pytest.raises(service.NotYourBusiness):
            await service.annuler_par_le_commerce(
                session,
                booking=ligne,
                business_id=autre["business"].id,
                user_id=autre["proprietaire"].id,
                motif="pas le mien",
            )

        assert ligne.status is BookingStatus.CONFIRMED


async def _evenements_de_fiabilite(session: AsyncSession, creator_id) -> list[str]:
    lignes = await session.execute(
        sa.select(ReliabilityEvent.type).where(ReliabilityEvent.creator_id == creator_id)
    )
    return [ligne[0] for ligne in lignes.all()]


class TestLEcheanceDAccord:
    """Le temps laissé au commerce pour trancher.

    **Ce que ça répare.** Rien ne bornait ce temps. Un balayage existait bien,
    mais il n'expirait qu'à l'heure du rendez-vous : une demande posée trois
    semaines à l'avance pouvait dormir trois semaines, un droit sans créneau
    trente jours — en **tenant la place** tout du long, puisque
    `awaiting_business` compte dans la capacité. `SPEC.md` §4.1 prescrivait la
    transition « sans réponse dans le délai » depuis le début ; elle n'avait
    jamais été construite.
    """

    async def test_l_echeance_se_pose_en_entrant_en_attente(self, session: AsyncSession) -> None:
        """Sans elle, la demande n'expire jamais et garde sa place."""
        decor = await monter_le_decor(session, requires_booking_approval=True)
        ligne = await reserver(session, decor, starts_at=await premier_creneau(session, decor))
        avant = datetime.now(UTC)

        await service.confirmer(session, booking=ligne, creator_id=decor["createur"].id)

        assert ligne.status is BookingStatus.AWAITING_BUSINESS
        assert ligne.approval_expires_at is not None
        assert ligne.approval_expires_at > avant

    async def test_l_echeance_ne_depasse_jamais_le_creneau(self, session: AsyncSession) -> None:
        """**Le bornage, et c'est le cœur de la règle.** Promettre une réponse
        pour demain sur une prestation qui commence dans trois heures ferait
        croire au commerce qu'il a encore le temps alors que la créatrice serait
        déjà passée devant la porte."""
        decor = await monter_le_decor(session, requires_booking_approval=True)
        ligne = await reserver(session, decor, starts_at=await premier_creneau(session, decor))
        # Un créneau dans deux heures, bien avant les vingt-quatre du délai.
        ligne.starts_at = datetime.now(UTC) + timedelta(hours=2)
        ligne.ends_at = ligne.starts_at + timedelta(minutes=ligne.duration_minutes)
        await session.flush()

        await service.confirmer(session, booking=ligne, creator_id=decor["createur"].id)

        assert ligne.approval_expires_at == ligne.starts_at

    async def test_un_droit_sans_creneau_recoit_le_delai_plein(self, session: AsyncSession) -> None:
        """**L'autre sens.** `starts_at` est nul : rien ne borne, et un bornage
        qui rendrait `None` laisserait la demande sans échéance — ce que la
        contrainte refuse, mais bien plus loin, sous une erreur d'intégrité."""
        decor = await monter_le_decor(
            session, requires_booking=False, requires_booking_approval=True
        )
        ligne = await reserver(session, decor, starts_at=None)
        avant = datetime.now(UTC)

        await service.confirmer(session, booking=ligne, creator_id=decor["createur"].id)

        assert ligne.starts_at is None
        attendu = avant + timedelta(seconds=get_settings().booking_approval_seconds)
        assert ligne.approval_expires_at is not None
        assert abs((ligne.approval_expires_at - attendu).total_seconds()) < 60

    async def test_l_echeance_s_efface_quand_le_commerce_tranche(
        self, session: AsyncSession
    ) -> None:
        """La laisser en place ferait mentir toute lecture qui s'y fie — à
        commencer par le balayage, qui expirerait une réservation acceptée."""
        decor = await monter_le_decor(session, requires_booking_approval=True)
        ligne = await reserver(session, decor, starts_at=await premier_creneau(session, decor))
        await service.confirmer(session, booking=ligne, creator_id=decor["createur"].id)
        assert ligne.approval_expires_at is not None

        await service.trancher(
            session,
            booking=ligne,
            business_id=decor["business"].id,
            user_id=decor["proprietaire"].id,
            accepte=True,
        )

        assert ligne.status is BookingStatus.CONFIRMED
        assert ligne.approval_expires_at is None

    async def test_le_balayage_expire_la_demande_sans_reponse(self, session: AsyncSession) -> None:
        """**Le cas que rien ne couvrait.** Créneau la semaine prochaine,
        échéance d'accord dépassée : l'ancien balayage attendait l'heure du
        rendez-vous et laissait la place tenue six jours de plus."""
        decor = await monter_le_decor(session, requires_booking_approval=True)
        ligne = await reserver(session, decor, starts_at=await premier_creneau(session, decor))
        ligne.starts_at = datetime.now(UTC) + timedelta(days=7)
        ligne.ends_at = ligne.starts_at + timedelta(minutes=ligne.duration_minutes)
        await session.flush()
        await service.confirmer(session, booking=ligne, creator_id=decor["createur"].id)
        # Le délai s'est écoulé ; le créneau, lui, est encore loin devant.
        ligne.approval_expires_at = datetime.now(UTC) - timedelta(minutes=1)
        await session.flush()

        combien = await service.expirer_les_attentes_depassees(session)

        assert combien == 1
        assert ligne.status is BookingStatus.EXPIRED
        # Personne n'a manqué à rien : un commerce qui ne répond pas n'a rien
        # promis, et la créatrice n'a rien manqué non plus.
        assert await _evenements_de_fiabilite(session, decor["createur"].id) == []

    async def test_le_balayage_epargne_la_demande_encore_dans_les_temps(
        self, session: AsyncSession
    ) -> None:
        """**La contrainte se teste dans les deux sens.** Un balayage qui
        expirerait tout viderait la file avant que le commerce l'ait lue, et
        passerait le test ci-dessus sans rien garantir."""
        decor = await monter_le_decor(session, requires_booking_approval=True)
        ligne = await reserver(session, decor, starts_at=await premier_creneau(session, decor))
        await service.confirmer(session, booking=ligne, creator_id=decor["createur"].id)

        assert await service.expirer_les_attentes_depassees(session) == 0
        assert ligne.status is BookingStatus.AWAITING_BUSINESS


class TestUneAttenteDepassee:
    """Il est 11 h 35, la demande porte sur 10 h 45 : il n'y a plus rien à accepter."""

    async def _en_attente_depassee(self, session: AsyncSession) -> tuple:
        decor = await monter_le_decor(session, requires_booking_approval=True)
        ligne = await reserver(session, decor, starts_at=await premier_creneau(session, decor))
        await service.confirmer(session, booking=ligne, creator_id=decor["createur"].id)
        # L'heure est passée. `ends_at` suit : une contrainte en base exige
        # qu'il découle de la durée.
        ligne.starts_at = datetime.now(UTC) - timedelta(minutes=50)
        ligne.ends_at = ligne.starts_at + timedelta(minutes=ligne.duration_minutes)
        # **L'échéance d'accord suit le créneau**, parce qu'elle en découle :
        # elle vaut le délai plein *borné par* `starts_at`. La recalculer par la
        # fonction du produit, et non poser une date choisie ici, est ce qui
        # fait que ce montage éprouve encore la règle le jour où elle change.
        ligne.approval_expires_at = service.echeance_d_accord(ligne)
        await session.flush()
        return ligne, decor

    async def test_l_accord_est_refuse(self, session: AsyncSession) -> None:
        """Accepter produirait une réservation confirmée pour un rendez-vous qui
        n'aura pas lieu, et un code de retrait pour un créneau écoulé."""
        ligne, decor = await self._en_attente_depassee(session)

        with pytest.raises(service.CreneauDepasse):
            await service.trancher(
                session,
                booking=ligne,
                business_id=decor["business"].id,
                user_id=decor["proprietaire"].id,
                accepte=True,
            )

        assert ligne.status is BookingStatus.AWAITING_BUSINESS

    async def test_le_refus_reste_possible(self, session: AsyncSession) -> None:
        """Un commerce qui répond en retard dit quand même ce qu'il en était,
        et la créatrice lit son motif."""
        ligne, decor = await self._en_attente_depassee(session)

        await service.trancher(
            session,
            booking=ligne,
            business_id=decor["business"].id,
            user_id=decor["proprietaire"].id,
            accepte=False,
            motif="personne n'était là",
        )

        assert ligne.status is BookingStatus.CANCELLED

    async def test_le_balayage_l_expire_sans_penaliser(self, session: AsyncSession) -> None:
        """Une attente dépassée tient une place et bloque une créatrice qui ne
        peut rien faire d'autre. Personne n'a manqué à rien."""
        ligne, decor = await self._en_attente_depassee(session)

        combien = await service.expirer_les_attentes_depassees(session)

        assert combien == 1
        assert ligne.status is BookingStatus.EXPIRED
        assert await _evenements_de_fiabilite(session, decor["createur"].id) == []

    async def test_le_balayage_ne_touche_pas_ce_qui_est_a_venir(
        self, session: AsyncSession
    ) -> None:
        """L'autre sens. Un balayage qui expirerait tout viderait la file avant
        que le commerce ait eu le temps de la lire."""
        decor = await monter_le_decor(session, requires_booking_approval=True)
        ligne = await reserver(session, decor, starts_at=await premier_creneau(session, decor))
        await service.confirmer(session, booking=ligne, creator_id=decor["createur"].id)

        assert await service.expirer_les_attentes_depassees(session) == 0
        assert ligne.status is BookingStatus.AWAITING_BUSINESS


class TestUnDossierSousArbitrageEtUneAbsence:
    """**Les deux ne peuvent pas coexister, et c'est structurel.**

    La règle demandée était « un dossier qu'un arbitre a en main ne se décide
    plus côté commerce », telle qu'elle vient d'être posée sur les décisions de
    contrepartie. Portée au bouton d'absence, elle donnerait une condition qui
    ne peut jamais être vraie — un garde-fou décoratif, c'est-à-dire un
    garde-fou qui fait croire que la question est réglée.

    La démonstration tient en deux maillons, et ces tests les tiennent chacun :

    1. `no_show` n'est atteignable que depuis `confirmed` ;
    2. une contrepartie — le seul objet qui porte `needs_human_review` — n'est
       créée qu'à la consommation, et `consumed` est terminal.

    Une réservation qu'on peut marquer absente n'a donc **jamais** de
    contrepartie, donc jamais d'arbitre. Ces tests existent pour que la
    conclusion tombe le jour où l'une des deux prémisses change : ajouter une
    flèche vers `no_show` depuis un état consommé, ou ouvrir une contrepartie
    plus tôt, les fait échouer tous les deux.
    """

    def test_l_absence_ne_s_atteint_que_depuis_une_place_confirmee(self) -> None:
        depuis = {
            etat for etat, vers in service.TRANSITIONS.items() if BookingStatus.NO_SHOW in vers
        }

        assert depuis == {BookingStatus.CONFIRMED}

    def test_une_place_consommee_ne_devient_jamais_une_absence(self) -> None:
        """Le maillon qui compte : c'est `consumed` qui porte la contrepartie."""
        assert service.TRANSITIONS[BookingStatus.CONSUMED] == frozenset()

    async def test_une_contrepartie_ouverte_ferme_l_absence(self, session: AsyncSession) -> None:
        """Le même énoncé, éprouvé par le produit et non par sa table.

        Une table relue par un test qui la recopie ne prouve rien ; celui-ci
        passe par le service, sur une vraie réservation consommée.
        """
        decor = await monter_le_decor(session)
        ligne = await reserver(session, decor, starts_at=await premier_creneau(session, decor))
        await service.confirmer(session, booking=ligne, creator_id=decor["createur"].id)
        await service.consommer(
            session, booking=ligne, actor=Actor.from_user(decor["proprietaire"])
        )
        assert ligne.status is BookingStatus.CONSUMED

        with pytest.raises(service.TransitionNotAllowed):
            await service.marquer_absent(
                session,
                booking=ligne,
                actor=Actor.from_user(decor["proprietaire"]),
                reason="elle n'est pas venue",
            )

        # La session reste saine : un refus attrapé hors point de sauvegarde la
        # laisserait inutilisable, et le défaut n'apparaîtrait qu'ailleurs.
        assert await session.scalar(sa.select(sa.literal(1))) == 1

    async def test_un_deplacement_signale_ferme_l_absence(self, session: AsyncSession) -> None:
        """L'autre porte, et c'est celle de la représaille.

        Un créateur qui signale s'être déplacé pour rien voit sa réservation
        passer en `cancelled` dans la même transaction. Sans cela, le salon
        pourrait répondre au signalement en marquant absent celui qu'il n'a pas
        reçu — et le recours coûterait un événement de fiabilité à qui l'exerce.
        """
        from app.services import venue_report

        decor = await monter_le_decor(session)
        ligne = await reserver(session, decor, starts_at=await premier_creneau(session, decor))
        await service.confirmer(session, booking=ligne, creator_id=decor["createur"].id)

        await venue_report.signaler(
            session,
            booking=ligne,
            creator_id=decor["createur"].id,
            note="c'était fermé",
            maintenant=ligne.starts_at + timedelta(minutes=5),
        )
        assert ligne.status is BookingStatus.CANCELLED

        with pytest.raises(service.TransitionNotAllowed):
            await service.marquer_absent(
                session,
                booking=ligne,
                actor=Actor.from_user(decor["proprietaire"]),
                reason="elle n'est pas venue",
            )

        assert await session.scalar(sa.select(sa.literal(1))) == 1


class TestLaPorteDeLaRepresaille:
    """**Fermée dans les deux sens, et c'est le second qui manquait.**

    Le premier sens était tenu : une créatrice qui signale s'être déplacée pour
    rien voit sa réservation passer en `cancelled`, terminal, donc le salon ne
    peut plus la marquer absente.

    Le second ne l'était pas. `signaler` exige `confirmed` et `no_show` est
    terminal : il suffisait au salon de marquer l'absence **avant** qu'elle ne
    signale pour lui fermer sa seule porte — en lui coûtant vingt-cinq points au
    passage. Et les vingt premières minutes, celles où l'absence s'ouvrait déjà
    et où elle est encore sur la route, étaient exactement les siennes.

    L'absence ne s'ouvre donc plus qu'à la fermeture de la fenêtre de
    signalement. Le coût pour un salon honnête est d'attendre ; le coût pour une
    créatrice était son recours.
    """

    async def _confirmee(self, session: AsyncSession):
        decor = await monter_le_decor(session)
        ligne = await reserver(session, decor, starts_at=await premier_creneau(session, decor))
        await service.confirmer(session, booking=ligne, creator_id=decor["createur"].id)
        return ligne, decor

    async def test_l_absence_est_refusee_tant_que_le_signalement_est_ouvert(
        self, session: AsyncSession
    ) -> None:
        """Le cœur de la correction, à l'instant précis où le trou existait."""
        ligne, decor = await self._confirmee(session)
        reglages = get_settings()

        # Vingt minutes après le créneau : l'ancien seuil d'absence est passé,
        # la fenêtre de signalement est grande ouverte.
        pendant = ligne.starts_at + timedelta(minutes=reglages.no_show_delai_minutes)

        with pytest.raises(service.AbsenceTropTot):
            await service.marquer_absent(
                session,
                booking=ligne,
                actor=Actor.from_user(decor["proprietaire"]),
                reason="elle n'est pas venue",
                maintenant=pendant,
            )

        assert ligne.status is BookingStatus.CONFIRMED
        assert await session.scalar(sa.select(sa.literal(1))) == 1

    async def test_l_absence_s_ouvre_quand_le_signalement_se_ferme(
        self, session: AsyncSession
    ) -> None:
        """L'autre sens : la porte se ferme, elle ne se condamne pas.

        Une règle qui refuserait toujours passerait le test ci-dessus sans rien
        garantir — c'est le cas que le dépôt s'impose de vérifier des deux côtés.
        """
        ligne, decor = await self._confirmee(session)
        reglages = get_settings()

        apres = ligne.starts_at + timedelta(seconds=reglages.venue_report_window_seconds + 1)
        await service.marquer_absent(
            session,
            booking=ligne,
            actor=Actor.from_user(decor["proprietaire"]),
            reason="elle n'est pas venue",
            maintenant=apres,
        )

        assert ligne.status is BookingStatus.NO_SHOW

    async def test_l_ouverture_de_l_absence_est_la_fermeture_du_signalement(
        self, session: AsyncSession
    ) -> None:
        """**Les deux règles vivent dans deux modules, et doivent s'accorder.**

        `booking_states` ne peut pas importer `venue_report`, qui dépend déjà de
        lui : il relit le même réglage. Un commentaire ne tiendrait pas cet
        accord — celui-ci le fait, et tombe le jour où l'un des deux dérive.
        """
        from app.services import venue_report

        ligne, _ = await self._confirmee(session)
        ouverture = service.absence_signalable_a(ligne)
        assert ouverture is not None

        # Juste avant, la fenêtre est encore ouverte ; à l'ouverture, elle est
        # fermée. C'est la même frontière, lue des deux côtés.
        assert venue_report.fenetre_ouverte(ligne, ouverture - timedelta(seconds=1))
        assert not venue_report.fenetre_ouverte(ligne, ouverture)

    async def test_le_retard_reste_un_plancher_si_la_fenetre_raccourcit(
        self, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Les deux délais ne protègent pas la même chose, et le `max` le dit.

        Si la fenêtre de signalement passait sous le délai de retard, une
        créatrice de trois minutes en retard redeviendrait absente. Le plancher
        tient ce cas, et sans lui le `max` serait décoratif.
        """
        ligne, _ = await self._confirmee(session)
        reglages = get_settings()

        court = reglages.model_copy(update={"venue_report_window_seconds": 60})
        monkeypatch.setattr("app.services.booking_states.get_settings", lambda: court)

        ouverture = service.absence_signalable_a(ligne)
        assert ouverture == ligne.starts_at + timedelta(minutes=court.no_show_delai_minutes)
