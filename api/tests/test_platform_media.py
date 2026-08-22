"""Les médias qui appartiennent à la plateforme, et à aucun commerce.

Six pastilles de catégorie et le média d'accueil. Aucune ligne de `business` ne
peut porter leur clé, d'où une table à part — et d'où ces tests, qui vérifient
surtout ce que la route rend quand **rien** n'a été posé : c'est l'état d'une
base fraîchement migrée, et celui de tout environnement où le semis n'a pas
tourné.
"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.enums import BusinessCategory, UserRole
from app.services import platform_assets as service

PREFIX = get_settings().api_v1_prefix


async def entetes(client: AsyncClient, role: UserRole = UserRole.CREATOR) -> dict:
    email, password = f"{uuid.uuid4()}@example.com", "tourbillon-cactus-91-vermeil"
    await client.post(
        f"{PREFIX}/auth/register",
        json={"email": email, "password": password, "role": role.value},
    )
    jetons = (
        await client.post(f"{PREFIX}/auth/login", json={"email": email, "password": password})
    ).json()
    return {"Authorization": f"Bearer {jetons['access_token']}"}


async def test_les_six_categories_repondent_meme_sans_photo(client: AsyncClient) -> None:
    """Le `None` est une réponse ; l'absence de ligne n'en serait pas une.

    Ne rendre que les catégories qui ont une image ferait disparaître les
    autres de Discovery parce qu'un fichier manque — un filtre qu'on ne peut
    plus choisir se serait évaporé sans que rien ne le dise.
    """
    reponse = await client.get(f"{PREFIX}/platform-media", headers=await entetes(client))

    assert reponse.status_code == 200
    categories = reponse.json()["categories"]
    assert [ligne["category"] for ligne in categories] == [c.value for c in BusinessCategory]
    assert all(ligne["photo_key"] is None for ligne in categories)


async def test_une_photo_posee_ressort_sur_sa_categorie(
    client: AsyncClient, session: AsyncSession
) -> None:
    await service.poser(
        session,
        slug=service.slug_de_categorie(BusinessCategory.FITNESS),
        object_key="photos/category/2026-08-10/abc",
    )
    await session.commit()

    reponse = await client.get(f"{PREFIX}/platform-media", headers=await entetes(client))

    par_categorie = {
        ligne["category"]: ligne["photo_key"] for ligne in reponse.json()["categories"]
    }
    assert par_categorie[BusinessCategory.FITNESS.value] == "photos/category/2026-08-10/abc"
    assert par_categorie[BusinessCategory.BEAUTY.value] is None


async def test_reposer_remplace_au_lieu_d_ajouter(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Le semis repose les huit médias à chaque exécution.

    Sans remplacement, la deuxième exécution violerait la clé primaire — et le
    jeu de données cesserait d'être rejouable, ce qui est sa première qualité.
    """
    slug = service.slug_de_categorie(BusinessCategory.MUSEUM)
    await service.poser(session, slug=slug, object_key="photos/category/2026-08-10/premiere")
    await service.poser(session, slug=slug, object_key="photos/category/2026-08-10/seconde")
    await session.commit()

    reponse = await client.get(f"{PREFIX}/platform-media", headers=await entetes(client))

    par_categorie = {
        ligne["category"]: ligne["photo_key"] for ligne in reponse.json()["categories"]
    }
    assert par_categorie[BusinessCategory.MUSEUM.value] == "photos/category/2026-08-10/seconde"


@pytest.mark.parametrize("role", [UserRole.CREATOR, UserRole.BUSINESS_MEMBER])
async def test_les_deux_cotes_du_produit_y_ont_acces(client: AsyncClient, role: UserRole) -> None:
    """Une pastille de catégorie peut s'afficher côté commerce comme côté créateur."""
    reponse = await client.get(f"{PREFIX}/platform-media", headers=await entetes(client, role))

    assert reponse.status_code == 200


async def test_sans_jeton_la_route_repond_quand_meme(client: AsyncClient) -> None:
    """**Les pastilles s'affichent avant la connexion**, et le choix de rôle
    en a besoin.

    Elle était derrière un jeton, au motif qu'elle ne concerne personne qui ne
    soit pas entré. C'était faux : exiger un jeton pour voir la première chose
    du produit est impossible par construction. Le média d'accueil qui motivait
    cette route à l'origine est parti avec la planche v3 ; les catégories
    restent, et la règle avec elles.
    """
    anonyme = await client.get(f"{PREFIX}/platform-media")

    assert anonyme.status_code == 200
    assert len(anonyme.json()["categories"]) == len(BusinessCategory)
