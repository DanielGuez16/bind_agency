"""Le commerce tranche : accord, refus, désistement — SPEC.md §4.1.

Trois routes distinctes plutôt qu'une avec un verbe en corps. Elles n'ont ni les
mêmes conditions d'entrée, ni les mêmes exigences, ni les mêmes conséquences :
`/no-show` pénalise le créateur, `/cancel-by-business` non, et les confondre
ferait de la pénalité une case à cocher.

Ce fichier éprouve la route et ses droits. La règle métier — jamais de `no_show`
sur un désistement, motif obligatoire — est éprouvée sur le service, dans
`test_booking_states.py` : la vérifier ici seulement laisserait une seconde
route l'ignorer.
"""

import uuid

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import BusinessMember, ReliabilityEvent
from app.models.enums import (
    BookingStatus,
    BusinessMemberRole,
    NotificationKind,
    UserRole,
)
from app.services import booking_states, outbox, redemption
from tests.conftest import inscrire_verifie
from tests.test_booking_create import monter_le_decor, premier_creneau, reserver

PREFIX = get_settings().api_v1_prefix
MOT_DE_PASSE = "tourbillon-cactus-91-vermeil"


async def en_attente(session: AsyncSession) -> dict:
    """Une réservation confirmée par la créatrice, en attente du commerce."""
    decor = await monter_le_decor(session, requires_booking_approval=True)
    booking = await reserver(session, decor, starts_at=await premier_creneau(session, decor))
    await booking_states.confirmer(session, booking=booking, creator_id=decor["createur"].id)
    assert booking.status is BookingStatus.AWAITING_BUSINESS

    membre = await inscrire_verifie(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password=MOT_DE_PASSE,
        role=UserRole.BUSINESS_MEMBER,
    )
    session.add(
        BusinessMember(
            business_id=decor["business"].id,
            user_id=membre.id,
            role=BusinessMemberRole.STAFF,
        )
    )
    await session.flush()
    return {**decor, "booking": booking, "membre": membre}


async def entetes(client: AsyncClient, user) -> dict:
    reponse = await client.post(
        f"{PREFIX}/auth/login", json={"email": user.email, "password": MOT_DE_PASSE}
    )
    return {"Authorization": f"Bearer {reponse.json()['access_token']}"}


async def _evenements(session: AsyncSession, creator_id) -> list[str]:
    lignes = await session.execute(
        sa.select(ReliabilityEvent.type).where(ReliabilityEvent.creator_id == creator_id)
    )
    return [ligne[0] for ligne in lignes.all()]


# --------------------------------------------------------------------------
# accorder
# --------------------------------------------------------------------------


async def test_l_accord_confirme_et_ouvre_le_code(
    client: AsyncClient, session: AsyncSession
) -> None:
    scene = await en_attente(session)

    reponse = await client.post(
        f"{PREFIX}/bookings/{scene['booking'].id}/approve",
        headers=await entetes(client, scene["membre"]),
    )

    assert reponse.status_code == 200, reponse.text
    assert reponse.json()["status"] == BookingStatus.CONFIRMED.value
    # Le code naît de l'arrivée dans `confirmed`, quelle que soit la porte.
    await session.refresh(scene["booking"])
    assert await redemption.code_du_booking(session, booking=scene["booking"]) is not None


async def test_l_accord_ne_demande_aucun_motif(client: AsyncClient, session: AsyncSession) -> None:
    """Il n'y a rien à justifier à dire oui."""
    scene = await en_attente(session)

    reponse = await client.post(
        f"{PREFIX}/bookings/{scene['booking'].id}/approve",
        headers=await entetes(client, scene["membre"]),
    )

    assert reponse.status_code == 200, reponse.text


# --------------------------------------------------------------------------
# refuser
# --------------------------------------------------------------------------


@pytest.mark.parametrize("corps", [{}, {"reason": ""}, {"reason": "no"}])
async def test_un_refus_sans_motif_lisible_est_rejete(
    client: AsyncClient, session: AsyncSession, corps: dict
) -> None:
    """Le créateur lira ce motif. Trois caractères au moins, sinon « no » passe."""
    scene = await en_attente(session)

    reponse = await client.post(
        f"{PREFIX}/bookings/{scene['booking'].id}/decline",
        headers=await entetes(client, scene["membre"]),
        json=corps,
    )

    assert reponse.status_code == 422, reponse.text
    await session.refresh(scene["booking"])
    assert scene["booking"].status is BookingStatus.AWAITING_BUSINESS


async def test_un_refus_motive_annule_sans_penaliser(
    client: AsyncClient, session: AsyncSession
) -> None:
    scene = await en_attente(session)

    reponse = await client.post(
        f"{PREFIX}/bookings/{scene['booking'].id}/decline",
        headers=await entetes(client, scene["membre"]),
        json={"reason": "planning complet ce jour-là"},
    )

    assert reponse.status_code == 200, reponse.text
    assert reponse.json()["status"] == BookingStatus.CANCELLED.value
    assert await _evenements(session, scene["createur"].id) == []


# --------------------------------------------------------------------------
# se désister
# --------------------------------------------------------------------------


async def test_le_desistement_n_est_pas_une_absence(
    client: AsyncClient, session: AsyncSession
) -> None:
    """La route existe pour ne **pas** être `/no-show`.

    Une réservation déjà confirmée, à moins de vingt-quatre heures : par cette
    route-là, aucune pénalité. C'est toute la raison d'en avoir deux.
    """
    decor = await monter_le_decor(session)
    booking = await reserver(session, decor, starts_at=await premier_creneau(session, decor))
    await booking_states.confirmer(session, booking=booking, creator_id=decor["createur"].id)
    membre = await inscrire_verifie(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password=MOT_DE_PASSE,
        role=UserRole.BUSINESS_MEMBER,
    )
    session.add(
        BusinessMember(
            business_id=decor["business"].id,
            user_id=membre.id,
            role=BusinessMemberRole.STAFF,
        )
    )
    await session.flush()

    reponse = await client.post(
        f"{PREFIX}/bookings/{booking.id}/cancel-by-business",
        headers=await entetes(client, membre),
        json={"reason": "technicienne absente"},
    )

    assert reponse.status_code == 200, reponse.text
    assert reponse.json()["status"] == BookingStatus.CANCELLED.value
    assert await _evenements(session, decor["createur"].id) == []


# --------------------------------------------------------------------------
# les droits
# --------------------------------------------------------------------------


async def test_un_autre_commerce_ne_tranche_pas(client: AsyncClient, session: AsyncSession) -> None:
    """403, comme partout ailleurs derrière le résolveur d'appartenance.

    C'est lui qui décide du code, en un seul endroit, et ses propres tests le
    fixent. Le transcrire ici en dur créerait une seconde vérité ; l'assertion
    porte donc sur ce qui compte pour cette route : la réservation n'a pas
    bougé.
    """
    scene = await en_attente(session)
    autre = await en_attente(session)

    reponse = await client.post(
        f"{PREFIX}/bookings/{scene['booking'].id}/approve",
        headers=await entetes(client, autre["membre"]),
    )

    assert reponse.status_code == 403
    await session.refresh(scene["booking"])
    assert scene["booking"].status is BookingStatus.AWAITING_BUSINESS


async def test_la_creatrice_ne_tranche_pas_a_la_place_du_commerce(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Sinon la validation ne vaudrait rien : il suffirait de s'accorder l'accord."""
    scene = await en_attente(session)

    reponse = await client.post(
        f"{PREFIX}/bookings/{scene['booking'].id}/approve",
        headers=await entetes(client, scene["createur"]),
    )

    assert reponse.status_code in (403, 404)
    await session.refresh(scene["booking"])
    assert scene["booking"].status is BookingStatus.AWAITING_BUSINESS


# --------------------------------------------------------------------------
# ce que la décision annonce
# --------------------------------------------------------------------------


async def test_l_accord_depose_son_annonce_dans_la_meme_transaction(
    client: AsyncClient, session: AsyncSession
) -> None:
    """**La garantie que rien ne vérifiait.** Le créateur doit apprendre la
    décision, et il doit l'apprendre même si le processus meurt juste après.

    Le message est écrit par le commit qui écrit la décision : ou les deux
    existent, ou aucun. Vérifié sur la boîte d'envoi — la route ne parle plus à
    aucun service externe, et l'attendre pour répondre était le défaut.
    """
    scene = await en_attente(session)

    reponse = await client.post(
        f"{PREFIX}/bookings/{scene['booking'].id}/approve",
        headers=await entetes(client, scene["membre"]),
    )
    assert reponse.status_code == 200, reponse.text

    lignes = await outbox.pour(
        session,
        user_id=scene["createur"].id,
        kind=NotificationKind.BOOKING_APPROVED,
    )
    # Un dépôt par canal : la boîte pour la trace, l'écran pour l'urgence.
    assert len(lignes) == 2
    assert all(ligne.sent_at is None for ligne in lignes)
    assert {ligne.template_key for ligne in lignes} == {"booking.approved"}


async def test_le_refus_depose_son_motif(client: AsyncClient, session: AsyncSession) -> None:
    """Le motif du commerce voyage avec l'annonce. Sans lui, le créateur lit un
    refus sans savoir ce qu'on lui reproche."""
    scene = await en_attente(session)

    await client.post(
        f"{PREFIX}/bookings/{scene['booking'].id}/decline",
        json={"reason": "Complet ce jour-là"},
        headers=await entetes(client, scene["membre"]),
    )

    lignes = await outbox.pour(
        session,
        user_id=scene["createur"].id,
        kind=NotificationKind.BOOKING_DECLINED,
    )
    assert lignes
    assert all(ligne.values["motif"] == "Complet ce jour-là" for ligne in lignes)
