"""Appartenance pour les ressources sans `business_id` dans le chemin.

Un test par type de ressource, et c'est le critère de fin : le résolveur existe
pour que la première route de réservation n'écrive pas son contrôle en ligne, et
la seule façon de s'en assurer est d'éprouver chaque chaîne séparément. Une
jointure qui remonterait au mauvais commerce pour un seul type passerait
inaperçue si un test générique couvrait les quatre.

La propriété est toujours la même : un membre du commerce A reçoit 403 sur une
ressource du commerce B, et le même 403 sur une ressource qui n'existe pas.
"""

import uuid

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.config import get_settings
from app.core.membership import CHEMINS_VERS_LE_COMMERCE
from app.models import Booking, Collaboration, Proof, RedemptionCode
from app.models.enums import (
    BusinessMemberRole,
    CaptureMethod,
    ContentFormat,
    UserRole,
)
from tests.factories import booking_insert, new_booking_graph, new_user

PREFIX = get_settings().api_v1_prefix

#: Le chemin de sonde par type. Le nom sert aussi de clé dans le résolveur : un
#: type ajouté là-bas sans sonde ici fait tomber le test de couverture.
SONDES = {
    "booking": "bookings",
    "collaboration": "collaborations",
    "proof": "proofs",
    "redemption_code": "redemption-codes",
}


async def membre(conn: AsyncConnection, business_id: uuid.UUID) -> uuid.UUID:
    """Un membre du commerce, avec son mot de passe connu de la fabrique."""
    user_id = await new_user(conn, role=UserRole.BUSINESS_MEMBER)
    await conn.execute(
        sa.text(
            "INSERT INTO business_member (id, business_id, user_id, role) VALUES (:i, :b, :u, :r)"
        ),
        {
            "i": uuid.uuid4(),
            "b": business_id,
            "u": user_id,
            "r": BusinessMemberRole.STAFF.value,
        },
    )
    return user_id


async def ressources(conn: AsyncConnection) -> dict:
    """Un commerce et une ressource de chaque type qui en relève."""
    graphe = await new_booking_graph(conn)
    booking_id = (await conn.execute(booking_insert(graphe).returning(Booking.id))).scalar_one()

    collaboration_id = (
        await conn.execute(
            sa.insert(Collaboration)
            .values(
                id=uuid.uuid4(),
                booking_id=booking_id,
                tier_id=graphe["tier_id"],
                required_format=ContentFormat.STORY,
                deadline_at=sa.text("clock_timestamp() + interval '7 days'"),
            )
            .returning(Collaboration.id)
        )
    ).scalar_one()

    proof_id = (
        await conn.execute(
            sa.insert(Proof)
            .values(
                id=uuid.uuid4(),
                collaboration_id=collaboration_id,
                capture_method=CaptureMethod.UPLOAD,
                content_hash="0" * 64,
                media_key="preuves/essai.jpg",
            )
            .returning(Proof.id)
        )
    ).scalar_one()

    code_id = (
        await conn.execute(
            sa.insert(RedemptionCode)
            .values(
                id=uuid.uuid4(),
                booking_id=booking_id,
                secret=b"un-secret",
                manual_code=str(uuid.uuid4())[:8],
            )
            .returning(RedemptionCode.id)
        )
    ).scalar_one()

    return {
        "business_id": graphe["business_id"],
        "booking": booking_id,
        "collaboration": collaboration_id,
        "proof": proof_id,
        "redemption_code": code_id,
    }


async def jeton(client: AsyncClient, conn: AsyncConnection, business_id: uuid.UUID) -> dict:
    """Un membre du commerce, connecté.

    Le mot de passe des fabriques est connu : elles insèrent une empreinte fixe.
    """
    from tests.factories import PASSWORD

    user_id = await membre(conn, business_id)
    email = await conn.scalar(sa.text("SELECT email FROM app_user WHERE id = :u"), {"u": user_id})
    jetons = (
        await client.post(f"{PREFIX}/auth/login", json={"email": email, "password": PASSWORD})
    ).json()
    return {"Authorization": f"Bearer {jetons['access_token']}"}


@pytest.mark.parametrize("ressource", sorted(SONDES))
async def test_un_membre_d_un_autre_commerce_recoit_403(
    ressource: str, client: AsyncClient, conn: AsyncConnection
) -> None:
    """La fuite classique entre locataires, éprouvée type par type."""
    a = await ressources(conn)
    b = await ressources(conn)

    entetes_a = await jeton(client, conn, a["business_id"])
    chemin = SONDES[ressource]

    # Sur la sienne : accès.
    sienne = await client.get(f"{PREFIX}/probe/{chemin}/{a[ressource]}", headers=entetes_a)
    assert sienne.status_code == 200, sienne.text
    assert sienne.json()["business_id"] == str(a["business_id"])

    # Sur celle d'en face : refus. Sans cette assertion, un résolveur qui
    # rendrait toujours le commerce de l'appelant passerait le test précédent.
    autre = await client.get(f"{PREFIX}/probe/{chemin}/{b[ressource]}", headers=entetes_a)
    assert autre.status_code == 403
    assert autre.json()["detail"] == "not_a_member"


@pytest.mark.parametrize("ressource", sorted(SONDES))
async def test_une_ressource_inexistante_donne_le_meme_403(
    ressource: str, client: AsyncClient, conn: AsyncConnection
) -> None:
    """Jamais 404. Distinguer « n'existe pas » de « pas à vous » ferait de la
    route un oracle d'existence pour le commerce d'en face."""
    a = await ressources(conn)
    entetes = await jeton(client, conn, a["business_id"])

    reponse = await client.get(
        f"{PREFIX}/probe/{SONDES[ressource]}/{uuid.uuid4()}", headers=entetes
    )

    assert reponse.status_code == 403
    assert reponse.json()["detail"] == "not_a_member"


@pytest.mark.parametrize("ressource", sorted(SONDES))
async def test_un_createur_ne_passe_pas_par_cette_porte(
    ressource: str, client: AsyncClient, conn: AsyncConnection
) -> None:
    """Le résolveur est celui du côté commerce. Un créateur accède aux mêmes
    ressources, mais par ses propres routes et avec sa propre règle — celle-ci
    ne doit pas lui ouvrir par accident."""
    a = await ressources(conn)

    email, password = f"{uuid.uuid4()}@example.com", "un-mot-de-passe-solide-42"
    await client.post(
        f"{PREFIX}/auth/register",
        json={"email": email, "password": password, "role": UserRole.CREATOR.value},
    )
    jetons = (
        await client.post(f"{PREFIX}/auth/login", json={"email": email, "password": password})
    ).json()

    reponse = await client.get(
        f"{PREFIX}/probe/{SONDES[ressource]}/{a[ressource]}",
        headers={"Authorization": f"Bearer {jetons['access_token']}"},
    )

    assert reponse.status_code == 403
    assert reponse.json()["detail"] == "insufficient_role"


def test_chaque_ressource_rattachee_a_sa_sonde() -> None:
    """Un type ajouté au résolveur sans test le rendrait couvert en apparence.

    C'est la même discipline que pour l'anonymisation : la liste vient du code,
    pas d'une copie qui serait toujours d'accord avec lui.
    """
    assert set(CHEMINS_VERS_LE_COMMERCE) == set(SONDES)
