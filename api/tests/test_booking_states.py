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
    await session.execute(sa.update(Booking).where(Booking.id == ligne.id).values(status=depuis))
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
