"""Photos de couverture et d'article.

Ce que ces tests protègent n'est pas l'existence des colonnes, c'est le fait
qu'elles traversent réellement toute la chaîne — écriture, lecture, fil. Une
colonne ajoutée au modèle mais oubliée dans un schéma de sortie est invisible
jusqu'au jour où quelqu'un intègre l'écran et ne comprend pas pourquoi la photo
manque.

Et ce sont des **clés de stockage objet, jamais des URL** : une URL signée
expire, une URL publique fuit, et les deux se figeraient en base au changement
de fournisseur.
"""

import uuid

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Business, CatalogItem
from app.models.enums import UserRole
from app.services import feed as feed_service
from tests.test_feed import ICI, commerce, createur, offre

PREFIX = get_settings().api_v1_prefix

COUVERTURE = "commerces/ocean-beauty/couverture.jpg"
ARTICLE = "articles/soin-visage.jpg"


async def membre(client: AsyncClient) -> dict:
    email, password = f"{uuid.uuid4()}@example.com", "tourbillon-cactus-91-vermeil"
    cree = await client.post(
        f"{PREFIX}/auth/register",
        json={"email": email, "password": password, "role": UserRole.BUSINESS_MEMBER.value},
    )
    jetons = (
        await client.post(f"{PREFIX}/auth/login", json={"email": email, "password": password})
    ).json()
    return {
        "user_id": cree.json()["id"],
        "headers": {"Authorization": f"Bearer {jetons['access_token']}"},
    }


async def commerce_via_api(client: AsyncClient, entetes: dict, **extra) -> dict:
    reponse = await client.post(
        f"{PREFIX}/business",
        json={
            "name": "Salon Ocean",
            "category": "beauty",
            "currency": "usd",
            "address": "100 Ocean Drive, Miami, FL",
            "coordinates": {"longitude": -80.1918, "latitude": 25.7617},
            **extra,
        },
        headers=entetes["headers"],
    )
    assert reponse.status_code == 201, reponse.text
    return reponse.json()


# --------------------------------------------------------------------------
# écriture et lecture
# --------------------------------------------------------------------------


async def test_un_commerce_naît_sans_photo_et_peut_en_recevoir_une(
    client: AsyncClient,
) -> None:
    """Exiger une image avant de pouvoir s'inscrire perdrait des commerces sur
    une étape qui n'engage rien."""
    entetes = await membre(client)
    cree = await commerce_via_api(client, entetes)

    assert cree["cover_photo_key"] is None

    maj = await client.patch(
        f"{PREFIX}/business/{cree['id']}",
        json={"cover_photo_key": COUVERTURE},
        headers=entetes["headers"],
    )
    assert maj.status_code == 200, maj.text
    assert maj.json()["cover_photo_key"] == COUVERTURE

    relu = await client.get(f"{PREFIX}/business/{cree['id']}", headers=entetes["headers"])
    assert relu.json()["cover_photo_key"] == COUVERTURE


async def test_la_photo_de_couverture_se_retire(client: AsyncClient) -> None:
    entetes = await membre(client)
    cree = await commerce_via_api(client, entetes, cover_photo_key=COUVERTURE)
    assert cree["cover_photo_key"] == COUVERTURE

    maj = await client.patch(
        f"{PREFIX}/business/{cree['id']}",
        json={"cover_photo_key": None},
        headers=entetes["headers"],
    )
    assert maj.json()["cover_photo_key"] is None


async def test_un_article_porte_sa_photo(client: AsyncClient) -> None:
    entetes = await membre(client)
    cree = await commerce_via_api(client, entetes)

    item = await client.post(
        f"{PREFIX}/business/{cree['id']}/catalog-items",
        json={
            "name": "Soin visage",
            "price_cents": 8000,
            "duration_minutes": 60,
            "photo_key": ARTICLE,
        },
        headers=entetes["headers"],
    )
    assert item.status_code == 201, item.text
    assert item.json()["photo_key"] == ARTICLE

    sans = await client.post(
        f"{PREFIX}/business/{cree['id']}/catalog-items",
        json={"name": "Coupe", "price_cents": 4000, "duration_minutes": 30},
        headers=entetes["headers"],
    )
    # Un article sans photo reste parfaitement réservable : c'est l'affichage
    # qui s'en arrange, pas la réservation.
    assert sans.json()["photo_key"] is None
    assert sans.json()["requires_booking"] is True


async def test_la_photo_d_un_article_se_modifie_et_se_retire(client: AsyncClient) -> None:
    entetes = await membre(client)
    cree = await commerce_via_api(client, entetes)
    item = (
        await client.post(
            f"{PREFIX}/business/{cree['id']}/catalog-items",
            json={"name": "Soin", "price_cents": 8000, "duration_minutes": 60},
            headers=entetes["headers"],
        )
    ).json()

    pose = await client.patch(
        f"{PREFIX}/business/{cree['id']}/catalog-items/{item['id']}",
        json={"photo_key": ARTICLE},
        headers=entetes["headers"],
    )
    assert pose.json()["photo_key"] == ARTICLE

    retire = await client.patch(
        f"{PREFIX}/business/{cree['id']}/catalog-items/{item['id']}",
        json={"photo_key": None},
        headers=entetes["headers"],
    )
    assert retire.json()["photo_key"] is None
    # Et le reste de l'article n'a pas bougé au passage.
    assert retire.json()["name"] == "Soin"
    assert retire.json()["duration_minutes"] == 60


# --------------------------------------------------------------------------
# la chaîne complète : jusqu'au fil
# --------------------------------------------------------------------------


async def test_les_photos_traversent_jusqu_au_fil(session: AsyncSession) -> None:
    """Le point de cette tâche. Une colonne ajoutée au modèle mais oubliée dans
    le fil ne se découvre qu'à l'intégration de l'écran."""
    b = await commerce(session, longitude=-80.1305, latitude=25.7907)
    item, _ = await offre(session, b, name="Soin visage")
    user, _ = await createur(session)

    await session.execute(
        sa.update(Business).where(Business.id == b.id).values(cover_photo_key=COUVERTURE)
    )
    await session.execute(
        sa.update(CatalogItem).where(CatalogItem.id == item.id).values(photo_key=ARTICLE)
    )
    await session.flush()

    fil = await feed_service.fil_du_createur(session, creator_id=user.id, autour_de=ICI)

    assert fil.commerces[0].cover_photo_key == COUVERTURE
    assert fil.commerces[0].items[0].photo_key == ARTICLE


async def test_le_fil_supporte_l_absence_de_photo(session: AsyncSession) -> None:
    """Le pendant : un commerce sans image apparaît quand même.

    **Une donnée d'avant la règle, pas un commerce qu'on pourrait créer
    aujourd'hui.** La couverture bloque désormais l'activation ; le fil doit
    pourtant tolérer une clé nulle, parce que les salons activés avant cette
    règle existent toujours en base. Le décor la pose donc à `None` sans passer
    par l'activation.
    """
    b = await commerce(session, longitude=-80.1305, latitude=25.7907, cover_photo_key=None)
    await offre(session, b)
    user, _ = await createur(session)

    fil = await feed_service.fil_du_createur(session, creator_id=user.id, autour_de=ICI)

    assert fil.commerces
    assert fil.commerces[0].cover_photo_key is None
    assert fil.commerces[0].items[0].photo_key is None


@pytest.mark.parametrize("champ", ["cover_photo_key"])
async def test_une_cle_trop_longue_est_refusee(champ: str, client: AsyncClient) -> None:
    """Borne de forme, pas de sécurité : une clé de stockage tient en quelques
    dizaines de caractères, une valeur de mille est un signe d'erreur."""
    entetes = await membre(client)
    cree = await commerce_via_api(client, entetes)

    reponse = await client.patch(
        f"{PREFIX}/business/{cree['id']}",
        json={champ: "x" * 600},
        headers=entetes["headers"],
    )
    assert reponse.status_code == 422
