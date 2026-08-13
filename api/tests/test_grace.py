"""La période de grâce : ouvrir sans carte bancaire, et ce qui arrive au bout.

**La garantie qui porte ce fichier : une question de facturation ne défait
jamais une promesse déjà faite.** Un salon qui sort du fil garde son catalogue,
ses horaires, son historique — et **ses réservations sont honorées jusqu'au
code de retrait**. C'est le seul défaut qui rendrait ce dispositif pire que
d'exiger une carte au comptoir : il ferait perdre au créateur un rendez-vous
qu'il avait pris.

Deux autres propriétés comptent presque autant. **Le salon est prévenu avant**,
une seule fois — disparaître du fil sans l'avoir dit se lit comme une panne. Et
**souscrire ne réveille pas un salon en congés** : un paiement ne décide pas à
sa place de rouvrir.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

from app.core.config import get_settings
from app.integrations.billing import LogBillingProvider
from app.integrations.email import Message
from app.models import AuditLog, Business, BusinessMember, NotificationPreference, User
from app.models.business import SubscriptionPlan
from app.models.enums import (
    ActorKind,
    BillingInterval,
    BookingStatus,
    BusinessCategory,
    BusinessMemberRole,
    BusinessStatus,
    NotificationKind,
    SuspensionReason,
    UserRole,
)
from app.services import auth as auth_service
from app.services import booking_states, notifications
from app.services import business as business_service
from app.services import grace as service
from app.services import subscription as subscription_service
from app.services.audit import Actor
from tests.factories import new_business
from tests.test_activation import commerce_en_cours

MOT_DE_PASSE = "un-mot-de-passe-solide-42"


class EnvoyeurQuiNote:
    """Retient ce qui est parti. Un envoyeur muet ne prouverait pas l'envoi."""

    def __init__(self) -> None:
        self.messages: list[Message] = []

    async def envoyer(self, message: Message) -> None:
        self.messages.append(message)


async def ouvert(session: AsyncSession) -> tuple[Business, User]:
    """Un commerce activé, donc en période de grâce."""
    business, proprietaire = await commerce_en_cours(session)
    await business_service.activate_business(
        session, business=business, actor=Actor.from_user(proprietaire)
    )
    return business, proprietaire


async def plan(session: AsyncSession) -> SubscriptionPlan:
    ligne = SubscriptionPlan(
        category=BusinessCategory.BEAUTY,
        name="Essentiel",
        price_cents=9_900,
        currency="USD",
        billing_interval=BillingInterval.MONTHLY,
        features={},
    )
    session.add(ligne)
    await session.flush()
    return ligne


# --------------------------------------------------------------------------
# ouvrir sans carte bancaire
# --------------------------------------------------------------------------


async def test_ouvrir_ne_demande_aucune_carte_et_pose_l_echeance(
    session: AsyncSession,
) -> None:
    """Le salon ouvre, et voit sa date le jour même — pas au prochain balayage."""
    avant = datetime.now(UTC)
    business, _ = await ouvert(session)

    assert business.status is BusinessStatus.ACTIVE
    assert business.grace_ends_at is not None
    attendu = avant + timedelta(seconds=get_settings().subscription_grace_period_seconds)
    assert abs((business.grace_ends_at - attendu).total_seconds()) < 60
    assert await subscription_service.courant(session, business_id=business.id) is None


async def test_un_commerce_qui_paie_n_a_pas_d_echeance(session: AsyncSession) -> None:
    """Lui en poser une ferait sortir du fil un commerce qui paie."""
    business, proprietaire = await commerce_en_cours(session)
    tarif = await plan(session)
    await subscription_service.souscrire(
        session,
        business=business,
        plan_id=tarif.id,
        actor=proprietaire,
        provider=LogBillingProvider(),
    )

    await business_service.activate_business(
        session, business=business, actor=Actor.from_user(proprietaire)
    )

    assert business.grace_ends_at is None


# --------------------------------------------------------------------------
# ce qui arrive au bout
# --------------------------------------------------------------------------


async def test_la_fin_de_grace_retire_du_fil_sans_rien_effacer(
    session: AsyncSession,
) -> None:
    """Exactement la mise en pause, avec une autre raison."""
    business, _ = await ouvert(session)
    echeance = business.grace_ends_at

    ferme = await service.fermer(
        session, business=business, maintenant=echeance + timedelta(seconds=1)
    )

    assert ferme is True
    assert business.status is BusinessStatus.SUSPENDED
    assert business.suspended_reason is SuspensionReason.GRACE_EXPIRED
    entree = await session.scalar(
        sa.select(AuditLog).where(
            AuditLog.entity_id == business.id, AuditLog.reason == service.REASON_GRACE_ECHUE
        )
    )
    assert entree is not None
    assert entree.actor_kind is ActorKind.SYSTEM


async def test_avant_l_echeance_on_ne_ferme_rien(session: AsyncSession) -> None:
    """**La garde qui protège du balayage lui-même.**

    Trouvée par mutation : faire passer au fermeur la liste des commerces à
    prévenir ne changeait rien, parce que `fermer` refuse toute échéance encore
    à venir. Cette garde n'avait aucun test à elle — elle tenait, et rien ne
    l'aurait dit si elle avait sauté.
    """
    business, _ = await ouvert(session)
    veille = business.grace_ends_at - timedelta(days=1)

    assert await service.fermer(session, business=business, maintenant=veille) is False
    assert business.status is BusinessStatus.ACTIVE
    assert business.suspended_reason is None


async def test_la_fin_de_grace_ne_ferme_pas_un_commerce_qui_a_souscrit(
    session: AsyncSession,
) -> None:
    """L'échéance a traîné, le paiement est arrivé : on ne sort pas du fil
    quelqu'un qui paie parce qu'une colonne n'a pas été nettoyée."""
    business, proprietaire = await ouvert(session)
    echeance = business.grace_ends_at
    tarif = await plan(session)
    await subscription_service.souscrire(
        session,
        business=business,
        plan_id=tarif.id,
        actor=proprietaire,
        provider=LogBillingProvider(),
    )
    # On remet l'échéance comme si le nettoyage n'avait pas eu lieu.
    business.grace_ends_at = echeance
    await session.flush()

    ferme = await service.fermer(
        session, business=business, maintenant=echeance + timedelta(seconds=1)
    )

    assert ferme is False
    assert business.status is BusinessStatus.ACTIVE
    assert business.grace_ends_at is None


async def test_une_reservation_prise_avant_est_honoree_apres(
    session: AsyncSession,
) -> None:
    """**La garantie de fond**, et elle se vérifie jusqu'au bout du parcours.

    Pas seulement « la réservation existe encore » : le créateur doit pouvoir
    la consommer. Une promesse tenue à moitié n'est pas tenue.
    """
    from tests.test_booking_create import monter_le_decor, premier_creneau, reserver

    decor = await monter_le_decor(session, postes=2)
    creneau = await premier_creneau(session, decor)
    booking = await reserver(session, decor, starts_at=creneau)
    await booking_states.confirmer(session, booking=booking, creator_id=decor["createur"].id)

    business = decor["business"]
    business.grace_ends_at = datetime.now(UTC) - timedelta(seconds=1)
    await session.flush()
    assert await service.fermer(session, business=business) is True

    # Le salon a quitté le fil, et la réservation tient.
    await session.refresh(booking)
    assert business.status is BusinessStatus.SUSPENDED
    assert booking.status is BookingStatus.CONFIRMED

    # Et elle se consomme : c'est ce qui fait la différence entre une promesse
    # tenue et une ligne qui traîne en base.
    consommee = await booking_states.consommer(
        session,
        booking=booking,
        actor=Actor.from_user(decor["proprietaire"]),
    )
    assert consommee.status is BookingStatus.CONSUMED


# --------------------------------------------------------------------------
# prévenir avant
# --------------------------------------------------------------------------


async def test_on_previent_avant_l_echeance_et_une_seule_fois(
    session: AsyncSession,
) -> None:
    """Sans la date d'avertissement, le salon recevrait le même message toutes
    les heures pendant une semaine, et cesserait de lire les suivants."""
    business, _ = await ouvert(session)
    reglages = get_settings()
    juste_avant = business.grace_ends_at - timedelta(
        seconds=reglages.subscription_grace_warning_seconds - 60
    )

    assert await service.a_prevenir(session, maintenant=juste_avant) == [business.id]

    business.grace_warned_at = juste_avant
    await session.flush()

    assert await service.a_prevenir(session, maintenant=juste_avant) == []


async def test_on_ne_previent_pas_trop_tot(session: AsyncSession) -> None:
    """Un avertissement reçu trois semaines avant ne sera pas relu au bon moment."""
    business, _ = await ouvert(session)
    tot = datetime.now(UTC)

    assert business.id not in await service.a_prevenir(session, maintenant=tot)


async def test_l_avertissement_part_a_tous_les_membres_et_dit_l_essentiel(
    session: AsyncSession,
) -> None:
    """Tous : un comptoir se tient à plusieurs. Et le message dit ce que le
    salon demandera en premier — ce qu'il advient de ses réservations."""
    business, proprietaire = await ouvert(session)
    # **Un second membre, et il est indispensable au test.** Avec le seul
    # propriétaire, une fonction qui s'arrête au premier destinataire passerait
    # — la mutation l'a montré, et le test ne prouvait alors que « quelqu'un a
    # reçu quelque chose ».
    second = await auth_service.register(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password=MOT_DE_PASSE,
        role=UserRole.BUSINESS_MEMBER,
    )
    session.add(
        BusinessMember(business_id=business.id, user_id=second.id, role=BusinessMemberRole.STAFF)
    )
    await session.flush()
    envoyeur = EnvoyeurQuiNote()

    joints = await notifications.envoyer_au_commerce(
        session,
        business=business,
        cle="subscription.graceEnding",
        kind=NotificationKind.SUBSCRIPTION_GRACE_ENDING,
        sender=envoyeur,
        echeance="2026-09-12",
    )

    assert joints == 2
    assert {message.destinataire for message in envoyeur.messages} == {
        proprietaire.email,
        second.email,
    }
    assert "honoured" in envoyeur.messages[0].corps
    assert "2026-09-12" in envoyeur.messages[0].corps


async def test_un_membre_qui_a_coupe_le_genre_ne_recoit_rien(
    session: AsyncSession,
) -> None:
    """La préférence vaut pour la boîte comme pour l'écran verrouillé."""
    business, proprietaire = await ouvert(session)
    session.add(
        NotificationPreference(
            user_id=proprietaire.id,
            kind=NotificationKind.SUBSCRIPTION_GRACE_ENDING,
            enabled=False,
        )
    )
    await session.flush()
    envoyeur = EnvoyeurQuiNote()

    joints = await notifications.envoyer_au_commerce(
        session,
        business=business,
        cle="subscription.graceEnding",
        kind=NotificationKind.SUBSCRIPTION_GRACE_ENDING,
        sender=envoyeur,
        echeance="2026-09-12",
    )

    assert joints == 0
    assert envoyeur.messages == []


# --------------------------------------------------------------------------
# revenir en ligne
# --------------------------------------------------------------------------


async def test_souscrire_ramene_dans_le_fil(session: AsyncSession) -> None:
    """Le salon sorti pour non-paiement revient d'un geste."""
    business, proprietaire = await ouvert(session)
    business.grace_ends_at = datetime.now(UTC) - timedelta(seconds=1)
    await session.flush()
    await service.fermer(session, business=business)
    assert business.status is BusinessStatus.SUSPENDED

    tarif = await plan(session)
    await subscription_service.souscrire(
        session,
        business=business,
        plan_id=tarif.id,
        actor=proprietaire,
        provider=LogBillingProvider(),
    )

    assert business.status is BusinessStatus.ACTIVE
    assert business.suspended_reason is None
    assert business.grace_ends_at is None


async def test_souscrire_ne_reveille_pas_un_salon_en_conges(
    session: AsyncSession,
) -> None:
    """**Un paiement ne décide pas à sa place de rouvrir.**

    C'est ce que la raison du retrait sert à distinguer, et c'est la seule
    raison pour laquelle elle est une colonne.
    """
    business, proprietaire = await ouvert(session)
    await business_service.pause_business(
        session, business=business, actor=Actor.from_user(proprietaire)
    )
    assert business.suspended_reason is SuspensionReason.PAUSED_BY_BUSINESS

    tarif = await plan(session)
    await subscription_service.souscrire(
        session,
        business=business,
        plan_id=tarif.id,
        actor=proprietaire,
        provider=LogBillingProvider(),
    )

    assert business.status is BusinessStatus.SUSPENDED
    assert business.suspended_reason is SuspensionReason.PAUSED_BY_BUSINESS


async def test_rouvrir_efface_la_raison_du_retrait(session: AsyncSession) -> None:
    """Une raison qui traîne ferait croire à un retrait qui n'existe plus."""
    business, proprietaire = await ouvert(session)
    await business_service.pause_business(
        session, business=business, actor=Actor.from_user(proprietaire)
    )

    await business_service.activate_business(
        session, business=business, actor=Actor.from_user(proprietaire)
    )

    assert business.status is BusinessStatus.ACTIVE
    assert business.suspended_reason is None


# --------------------------------------------------------------------------
# le rattrapage
# --------------------------------------------------------------------------


async def test_un_commerce_ouvert_sans_echeance_ni_abonnement_est_rattrape(
    session: AsyncSession,
) -> None:
    """Ceux ouverts avant ce dispositif. Sans le rattrapage, ils resteraient
    visibles pour toujours sans que rien ne les regarde."""
    business, _ = await ouvert(session)
    business.grace_ends_at = None
    await session.flush()

    assert business.id in await service.sans_echeance_ni_abonnement(session)

    assert await service.ouvrir(session, business=business) is True
    assert business.grace_ends_at is not None
    assert business.id not in await service.sans_echeance_ni_abonnement(session)


async def test_un_commerce_qui_paie_n_est_pas_rattrape(session: AsyncSession) -> None:
    """Le sens inverse. Une requête qui prendrait tout le monde passerait le
    test précédent sans rien garantir."""
    business, proprietaire = await ouvert(session)
    business.grace_ends_at = None
    await session.flush()
    tarif = await plan(session)
    await subscription_service.souscrire(
        session,
        business=business,
        plan_id=tarif.id,
        actor=proprietaire,
        provider=LogBillingProvider(),
    )

    assert business.id not in await service.sans_echeance_ni_abonnement(session)
    assert await service.ouvrir(session, business=business) is False
    assert business.grace_ends_at is None


# --------------------------------------------------------------------------
# la contrainte, éprouvée en SQL direct
# --------------------------------------------------------------------------


async def test_la_base_accepte_les_deux_formes_coherentes(conn: AsyncConnection) -> None:
    """**Le sens qui passe.** Une contrainte qui refuse tout passerait les deux
    refus suivants sans rien garantir."""
    await new_business(
        conn,
        status=BusinessStatus.SUSPENDED,
        suspended_reason=SuspensionReason.PAUSED_BY_BUSINESS,
    )
    await new_business(conn, status=BusinessStatus.ACTIVE, suspended_reason=None)


@pytest.mark.parametrize(
    "champs",
    [
        pytest.param(
            {"status": BusinessStatus.SUSPENDED, "suspended_reason": None},
            id="suspendu sans raison",
        ),
        pytest.param(
            {
                "status": BusinessStatus.ACTIVE,
                "suspended_reason": SuspensionReason.GRACE_EXPIRED,
            },
            id="une raison sans être suspendu",
        ),
    ],
)
async def test_la_base_refuse_les_formes_incoherentes(conn: AsyncConnection, champs: dict) -> None:
    with pytest.raises(IntegrityError) as echec:
        async with conn.begin_nested():
            await new_business(conn, **champs)
    assert echec.value.orig.diag.constraint_name == "ck_business_suspendu_dit_pourquoi"

    # La transaction reste utilisable après le refus.
    assert await conn.scalar(sa.select(sa.literal(1))) == 1


# --------------------------------------------------------------------------
# le balayage, qui enchaîne les trois gestes
# --------------------------------------------------------------------------


async def test_le_balayage_previent_puis_ferme(session: AsyncSession) -> None:
    """**L'ordre compte, et il se vérifie sur deux passages.**

    Un salon dont l'échéance approche est prévenu et **reste dans le fil** :
    c'est l'erreur qu'on ferait en fermant tout ce que le balayage regarde.
    Une fois l'échéance passée, le même balayage le ferme.
    """
    from app.workers import handlers

    business, _ = await ouvert(session)
    business.grace_ends_at = datetime.now(UTC) + timedelta(days=1)
    await session.flush()

    await handlers.balayer_les_periodes_de_grace(session, account=None, provider=None)

    assert business.grace_warned_at is not None
    assert business.status is BusinessStatus.ACTIVE

    business.grace_ends_at = datetime.now(UTC) - timedelta(seconds=1)
    await session.flush()

    await handlers.balayer_les_periodes_de_grace(session, account=None, provider=None)

    assert business.status is BusinessStatus.SUSPENDED
    assert business.suspended_reason is SuspensionReason.GRACE_EXPIRED


async def test_le_balayage_ouvre_ce_qui_n_a_pas_d_echeance(session: AsyncSession) -> None:
    """Le rattrapage, par le chemin réel."""
    from app.workers import handlers

    business, _ = await ouvert(session)
    business.grace_ends_at = None
    await session.flush()

    await handlers.balayer_les_periodes_de_grace(session, account=None, provider=None)

    assert business.grace_ends_at is not None
    assert business.status is BusinessStatus.ACTIVE


async def test_l_ouverture_ne_se_confond_pas_avec_l_activation(
    session: AsyncSession,
) -> None:
    """**Deux lignes de journal, deux états distincts.**

    L'ouverture de la grâce écrivait le statut du commerce — `active` — la même
    valeur que la transition d'activation elle-même. Un test qui cherchait « la
    ligne qui mène à active » en trouvait alors deux et tombait. Le journal
    décrit des transitions ; une ouverture de grâce est un événement, et elle se
    nomme comme tel.
    """
    business, _ = await ouvert(session)

    vers_actif = (
        await session.scalars(
            sa.select(AuditLog.reason).where(
                AuditLog.entity_id == business.id,
                AuditLog.to_status == BusinessStatus.ACTIVE.value,
            )
        )
    ).all()
    ouverture = await session.scalar(
        sa.select(AuditLog).where(
            AuditLog.entity_id == business.id,
            AuditLog.to_status == service.ETAT_GRACE_OUVERTE,
        )
    )

    assert list(vers_actif) == [business_service.REASON_ACTIVATION]
    assert ouverture is not None
    assert ouverture.extra["grace_ends_at"] == business.grace_ends_at.isoformat()
