"""Le cas inverse de l'absence : le créateur s'est déplacé pour rien.

**La garantie qui porte ce fichier : signaler ne coûte jamais rien.** Un recours
qui pénalise celui qui l'exerce n'est pas un recours, et c'est le seul défaut
qui rendrait ce dispositif pire que son absence — il apprendrait aux créateurs
à se taire.

Deux autres propriétés comptent presque autant. **Le signalement ferme la porte
à la représaille** : une fois posé, la réservation est terminale, et le commerce
ne peut plus marquer absent quelqu'un qu'il n'a pas reçu. Et **un signalement
est une allégation** : il ne compte contre le salon qu'une fois arbitré.
"""

import uuid
from datetime import timedelta

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import CreatorProfile, ReliabilityEvent, User, VenueReport
from app.models.enums import (
    BookingStatus,
    ReliabilityEventType,
    UserRole,
    VenueReportStatus,
)
from app.services import booking_states, reliability
from app.services import venue_report as service
from app.services.audit import Actor
from tests.conftest import inscrire_verifie
from tests.test_booking_create import monter_le_decor, premier_creneau, reserver

PREFIX = get_settings().api_v1_prefix
MOT_DE_PASSE = "tourbillon-cactus-91-vermeil"


async def confirmee(session: AsyncSession) -> tuple:
    """Une réservation confirmée, à l'heure de son créneau."""
    decor = await monter_le_decor(session, postes=2)
    creneau = await premier_creneau(session, decor)
    booking = await reserver(session, decor, starts_at=creneau)
    await booking_states.confirmer(session, booking=booking, creator_id=decor["createur"].id)
    # Le commerce accepte, s'il le fallait : on veut une réservation confirmée,
    # pas une en attente de décision.
    if booking.status is BookingStatus.AWAITING_BUSINESS:
        await booking_states.trancher(
            session,
            booking=booking,
            business_id=decor["business"].id,
            user_id=decor["proprietaire"].id,
            accepte=True,
        )
    await session.flush()
    return booking, decor


async def administrateur(session: AsyncSession) -> User:
    return await inscrire_verifie(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password=MOT_DE_PASSE,
        role=UserRole.ADMIN,
    )


# --------------------------------------------------------------------------
# signaler ne coûte jamais rien
# --------------------------------------------------------------------------


async def test_signaler_ne_penalise_jamais_le_createur(session: AsyncSession) -> None:
    """La garantie de fond. Un recours qui coûte n'est pas un recours.

    Vérifiée sur ce qui pénalise réellement — les événements de fiabilité —
    et pas seulement sur le statut de la réservation : c'est l'événement qui
    fait baisser le score, et c'est lui qu'il faut regarder.
    """
    booking, decor = await confirmee(session)
    createur = decor["createur"]

    await service.signaler(
        session,
        booking=booking,
        creator_id=createur.id,
        maintenant=booking.starts_at + timedelta(minutes=10),
    )

    types = list(
        await session.scalars(
            sa.select(ReliabilityEvent.type).where(ReliabilityEvent.creator_id == createur.id)
        )
    )
    assert ReliabilityEventType.NO_SHOW not in types
    assert types == [], "signaler n'écrit aucun événement sur celui qui signale"

    fiabilite = await reliability.rafraichir(session, creator_id=createur.id)
    # Nul veut dire neutre : aucun historique, donc pas de score. Surtout pas
    # un score dégradé.
    assert fiabilite.reliability_score is None


async def test_la_reservation_part_en_annulee_jamais_en_absence(
    session: AsyncSession,
) -> None:
    """`SPEC.md` §4.1 : toute défaillance qui ne vient pas du créateur mène à
    `cancelled`. Il s'est déplacé — c'est le contraire d'une absence."""
    booking, decor = await confirmee(session)

    await service.signaler(
        session,
        booking=booking,
        creator_id=decor["createur"].id,
        maintenant=booking.starts_at + timedelta(minutes=10),
    )

    assert booking.status is BookingStatus.CANCELLED


async def test_le_signalement_ferme_la_porte_a_la_represaille(
    session: AsyncSession,
) -> None:
    """Une fois signalé, le commerce ne peut plus marquer absent.

    Sans cela, le recours ouvrirait un risque au lieu d'en fermer un : le salon
    qui a oublié pourrait pénaliser celui qui l'a dit. `cancelled` est terminal,
    et c'est ce qui le garantit.
    """
    booking, decor = await confirmee(session)
    await service.signaler(
        session,
        booking=booking,
        creator_id=decor["createur"].id,
        maintenant=booking.starts_at + timedelta(minutes=10),
    )

    with pytest.raises(booking_states.TransitionNotAllowed):
        await booking_states.marquer_absent(
            session,
            booking=booking,
            actor=Actor.from_user(decor["proprietaire"]),
            reason="pas venue",
        )

    # La session reste utilisable après le refus.
    assert await session.scalar(sa.select(sa.func.count()).select_from(VenueReport)) == 1


# --------------------------------------------------------------------------
# la fenêtre
# --------------------------------------------------------------------------


async def test_on_ne_signale_pas_avant_l_heure_du_creneau(session: AsyncSession) -> None:
    """On ne s'est pas encore déplacé.

    Sans cette borne, on pourrait annuler une réservation en la déguisant en
    signalement — et échapper à la fenêtre de vingt-quatre heures qui départage
    un créateur qui prévient d'un créateur qui ne vient pas.
    """
    booking, decor = await confirmee(session)

    with pytest.raises(service.OutsideReportWindow):
        await service.signaler(
            session,
            booking=booking,
            creator_id=decor["createur"].id,
            maintenant=booking.starts_at - timedelta(minutes=1),
        )

    assert booking.status is BookingStatus.CONFIRMED, "rien n'a bougé"


async def test_on_ne_signale_plus_apres_la_fenetre(session: AsyncSession) -> None:
    """Au-delà, plus personne ne peut vérifier quoi que ce soit."""
    booking, decor = await confirmee(session)
    fenetre = get_settings().venue_report_window_seconds

    with pytest.raises(service.OutsideReportWindow):
        await service.signaler(
            session,
            booking=booking,
            creator_id=decor["createur"].id,
            maintenant=booking.starts_at + timedelta(seconds=fenetre + 60),
        )


async def test_la_fenetre_s_ouvre_bien_pendant_sa_duree(session: AsyncSession) -> None:
    """Le pendant. Une fenêtre qui refuserait tout passerait les deux tests
    précédents sans rien garantir."""
    booking, decor = await confirmee(session)
    fenetre = get_settings().venue_report_window_seconds

    signalement = await service.signaler(
        session,
        booking=booking,
        creator_id=decor["createur"].id,
        maintenant=booking.starts_at + timedelta(seconds=fenetre - 60),
    )

    assert signalement.status is VenueReportStatus.PENDING


async def test_un_droit_sans_creneau_ne_se_signale_pas(session: AsyncSession) -> None:
    """Il n'y a pas d'heure à laquelle on l'attendait.

    Le créateur se présente quand il veut avant l'échéance : « c'était fermé »
    ne se rattache alors à aucun rendez-vous qu'on puisse vérifier. Le cas est
    écarté explicitement plutôt que laissé au hasard d'un `None`.
    """
    decor = await monter_le_decor(session, requires_booking=False)
    booking = await reserver(session, decor, starts_at=None)
    await booking_states.confirmer(session, booking=booking, creator_id=decor["createur"].id)
    await session.flush()

    with pytest.raises(service.OutsideReportWindow):
        await service.signaler(session, booking=booking, creator_id=decor["createur"].id)


# --------------------------------------------------------------------------
# ce qu'on refuse
# --------------------------------------------------------------------------


async def test_on_ne_signale_pas_la_reservation_d_un_autre(session: AsyncSession) -> None:
    """Et le refus ne dit pas qu'elle existe.

    Dire « pas à vous » apprendrait quelles réservations existent — et le
    signalement les annule, ce qui en ferait une arme.
    """
    booking, _ = await confirmee(session)
    _, autre = await confirmee(session)

    with pytest.raises(service.BookingNotReportable):
        await service.signaler(
            session,
            booking=booking,
            creator_id=autre["createur"].id,
            maintenant=booking.starts_at + timedelta(minutes=10),
        )

    assert booking.status is BookingStatus.CONFIRMED


async def test_un_seul_signalement_par_reservation(session: AsyncSession) -> None:
    """Le compter deux fois fausserait tout compteur bâti dessus."""
    booking, decor = await confirmee(session)
    instant = booking.starts_at + timedelta(minutes=10)
    await service.signaler(
        session, booking=booking, creator_id=decor["createur"].id, maintenant=instant
    )

    with pytest.raises(service.VenueReportError):
        await service.signaler(
            session, booking=booking, creator_id=decor["createur"].id, maintenant=instant
        )


async def test_une_reservation_consommee_ne_se_signale_pas(session: AsyncSession) -> None:
    """On a été servi. Le déplacement a produit ce qu'il devait produire."""
    booking, decor = await confirmee(session)
    await booking_states.consommer(
        session, booking=booking, actor=Actor.from_user(decor["proprietaire"])
    )
    await session.flush()

    with pytest.raises(service.BookingNotReportable):
        await service.signaler(
            session,
            booking=booking,
            creator_id=decor["createur"].id,
            maintenant=booking.starts_at + timedelta(minutes=10),
        )


# --------------------------------------------------------------------------
# l'arbitrage
# --------------------------------------------------------------------------


async def test_un_signalement_ne_compte_pas_tant_qu_il_n_est_pas_arbitre(
    session: AsyncSession,
) -> None:
    """C'est une allégation. Le salon n'a pas été entendu."""
    booking, decor = await confirmee(session)
    await service.signaler(
        session,
        booking=booking,
        creator_id=decor["createur"].id,
        maintenant=booking.starts_at + timedelta(minutes=10),
    )

    compte = await service.confirmes_du_commerce(session, business_id=decor["business"].id)

    assert compte == 0


async def test_un_signalement_retenu_compte_contre_le_salon(session: AsyncSession) -> None:
    booking, decor = await confirmee(session)
    signalement = await service.signaler(
        session,
        booking=booking,
        creator_id=decor["createur"].id,
        maintenant=booking.starts_at + timedelta(minutes=10),
    )
    arbitre = await administrateur(session)

    await service.arbitrer(session, signalement=signalement, retenu=True, arbitre=arbitre)

    assert signalement.status is VenueReportStatus.CONFIRMED
    assert await service.confirmes_du_commerce(session, business_id=decor["business"].id) == 1


async def test_un_signalement_retenu_ne_penalise_pas_le_createur(
    session: AsyncSession,
) -> None:
    """Il avait raison. Le lui faire payer serait absurde, et c'est le genre de
    branche qu'on oublie."""
    booking, decor = await confirmee(session)
    signalement = await service.signaler(
        session,
        booking=booking,
        creator_id=decor["createur"].id,
        maintenant=booking.starts_at + timedelta(minutes=10),
    )
    arbitre = await administrateur(session)

    await service.arbitrer(session, signalement=signalement, retenu=True, arbitre=arbitre)

    types = list(
        await session.scalars(
            sa.select(ReliabilityEvent.type).where(
                ReliabilityEvent.creator_id == decor["createur"].id
            )
        )
    )
    assert types == []


async def test_un_signalement_ecarte_ecrit_un_evenement_de_poids_nul(
    session: AsyncSession,
) -> None:
    """**Le mécanisme existe, il ne punit pas.**

    Un signalement écarté n'est pas un mensonge : c'est un arbitre qui ne l'a
    pas retenu. Le poids vaut zéro en configuration, et le restera tant qu'on
    n'aura pas vu de vrais abus — la décision se prendra sur des chiffres.
    """
    from decimal import Decimal

    booking, decor = await confirmee(session)
    signalement = await service.signaler(
        session,
        booking=booking,
        creator_id=decor["createur"].id,
        maintenant=booking.starts_at + timedelta(minutes=10),
    )
    arbitre = await administrateur(session)

    await service.arbitrer(session, signalement=signalement, retenu=False, arbitre=arbitre)

    types = list(
        await session.scalars(
            sa.select(ReliabilityEvent.type).where(
                ReliabilityEvent.creator_id == decor["createur"].id
            )
        )
    )
    assert types == [ReliabilityEventType.ABUSIVE_REPORT], "l'événement existe"
    assert get_settings().reliability_weights["abusive_report"] == Decimal("0")

    # Et il ne pèse rien : le score reste celui de quelqu'un sans historique.
    fiabilite = await reliability.rafraichir(session, creator_id=decor["createur"].id)
    profil = await session.get(CreatorProfile, decor["createur"].id)
    assert profil.reliability_score == fiabilite.reliability_score


async def test_un_arbitrage_ne_se_refait_pas(session: AsyncSession) -> None:
    booking, decor = await confirmee(session)
    signalement = await service.signaler(
        session,
        booking=booking,
        creator_id=decor["createur"].id,
        maintenant=booking.starts_at + timedelta(minutes=10),
    )
    arbitre = await administrateur(session)
    await service.arbitrer(session, signalement=signalement, retenu=True, arbitre=arbitre)

    with pytest.raises(service.ReportNotPending):
        await service.arbitrer(session, signalement=signalement, retenu=False, arbitre=arbitre)


async def test_la_file_porte_de_quoi_juger_la_repetition(session: AsyncSession) -> None:
    """Trois signalements écartés d'affilée ne se lisent pas comme un premier.

    C'est le seul chiffre qui parle d'abus, et il est **rendu à l'arbitre**
    plutôt qu'appliqué automatiquement.
    """
    arbitre = await administrateur(session)

    # Deux signalements du même créateur, dont un déjà écarté.
    premier, decor = await confirmee(session)
    signalement = await service.signaler(
        session,
        booking=premier,
        creator_id=decor["createur"].id,
        maintenant=premier.starts_at + timedelta(minutes=10),
    )
    await service.arbitrer(session, signalement=signalement, retenu=False, arbitre=arbitre)

    second = await reserver(session, decor, starts_at=await premier_creneau(session, decor))
    await booking_states.confirmer(session, booking=second, creator_id=decor["createur"].id)
    if second.status is BookingStatus.AWAITING_BUSINESS:
        await booking_states.trancher(
            session,
            booking=second,
            business_id=decor["business"].id,
            user_id=decor["proprietaire"].id,
            accepte=True,
        )
    await session.flush()
    await service.signaler(
        session,
        booking=second,
        creator_id=decor["createur"].id,
        maintenant=second.starts_at + timedelta(minutes=10),
    )

    file = await service.file_d_arbitrage(session)
    ligne = next(entree for entree in file if entree.booking_id == second.id)

    assert ligne.signalements_ecartes_du_createur == 1
    assert ligne.signalements_confirmes_du_salon == 0


# --------------------------------------------------------------------------
# les routes
# --------------------------------------------------------------------------


async def test_le_parcours_complet_sur_la_route(client: AsyncClient, session: AsyncSession) -> None:
    """Signaler, puis arbitrer. Le créateur ne voit jamais la file."""
    booking, decor = await confirmee(session)
    # On place la réservation dans la fenêtre : la route lit l'heure serveur.
    # Les deux bornes ensemble : une contrainte de base lie `ends_at` à
    # `starts_at` et à la durée, et déplacer l'une seule la viole.
    await session.execute(
        sa.text(
            """
            UPDATE booking
            SET starts_at = now() - interval '10 minutes',
                ends_at = now() - interval '10 minutes' + (duration_minutes * interval '1 minute')
            WHERE id = :b
            """
        ),
        {"b": booking.id},
    )
    arbitre = await administrateur(session)
    await session.commit()

    createur = (
        await client.post(
            f"{PREFIX}/auth/login",
            json={"email": decor["createur"].email, "password": MOT_DE_PASSE},
        )
    ).json()
    entetes = {"Authorization": f"Bearer {createur['access_token']}"}

    signale = await client.post(
        f"{PREFIX}/bookings/{booking.id}/venue-report",
        json={"note": "Rideau baissé, personne, j'ai attendu vingt minutes."},
        headers=entetes,
    )
    assert signale.status_code == 200, signale.text
    assert signale.json()["status"] == "pending"

    # Le créateur n'arbitre pas.
    refus = await client.get(f"{PREFIX}/admin/venue-reports", headers=entetes)
    assert refus.status_code == 403

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login", json={"email": arbitre.email, "password": MOT_DE_PASSE}
        )
    ).json()
    admin = {"Authorization": f"Bearer {jetons['access_token']}"}

    file = await client.get(f"{PREFIX}/admin/venue-reports", headers=admin)
    assert file.status_code == 200
    assert len(file.json()) == 1
    assert "Rideau baissé" in file.json()[0]["note"]

    tranche = await client.post(
        f"{PREFIX}/admin/venue-reports/{signale.json()['id']}/decision",
        json={"retenu": True},
        headers=admin,
    )
    assert tranche.status_code == 200
    assert tranche.json()["status"] == "confirmed"


async def test_hors_fenetre_la_route_dit_pourquoi(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Un code nommé, jamais un 409 muet : « quelque chose s'est mal passé » à
    quelqu'un qui vient de se déplacer serait le pire message du produit."""
    booking, decor = await confirmee(session)
    await session.commit()

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login",
            json={"email": decor["createur"].email, "password": MOT_DE_PASSE},
        )
    ).json()

    reponse = await client.post(
        f"{PREFIX}/bookings/{booking.id}/venue-report",
        json={},
        headers={"Authorization": f"Bearer {jetons['access_token']}"},
    )

    assert reponse.status_code == 409
    assert reponse.json()["detail"] == "venue_report_outside_window"
