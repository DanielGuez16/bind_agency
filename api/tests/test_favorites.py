"""Le cœur d'une créatrice : sur quoi il tient, et ce que la liste dit ensuite.

**Le favori porte sur `catalog_item`, jamais sur `tier_offer`.** C'est la
décision que ce fichier éprouve, et le décor qui la sépare de l'autre est
celui où l'offre disparaît sans que la prestation bouge : le salon ferme un
palier, ou la créatrice en perd un. Avec un décor à un seul palier, les deux
implémentations rendraient exactement la même chose.

**Une prestation qui n'est plus réservable reste dans la liste, avec sa
raison.** La retirer sans un mot ferait croire à un mauvais appui, et les quatre
états appellent quatre conduites différentes.
"""

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Business, CatalogItem, CreatorFavorite, TierOffer
from app.models.enums import BusinessStatus, SuspensionReason
from app.schemas.tier_offers import TierOfferCreate
from app.services import favorites
from app.services import tier_offers as tier_offer_service
from tests.test_booking_create import REEL, monter_le_decor

PREFIX = get_settings().api_v1_prefix


async def _jetons(client: AsyncClient, email: str) -> dict[str, str]:
    reponse = await client.post(
        f"{PREFIX}/auth/login", json={"email": email, "password": "tourbillon-cactus-91-vermeil"}
    )
    return {"Authorization": f"Bearer {reponse.json()['access_token']}"}


# --------------------------------------------------------------------------
# ce sur quoi le cœur tient
# --------------------------------------------------------------------------


async def test_le_favori_survit_a_la_fermeture_d_un_palier(session: AsyncSession) -> None:
    """**Le test qui porte la décision.**

    La prestation est ouverte à deux paliers. Le salon en ferme un ; la
    prestation existe toujours, et le favori aussi. Un favori posé sur
    `tier_offer` aurait disparu avec l'offre fermée — c'est-à-dire pour une
    raison qui ne dit rien de la prestation.

    **Le second palier est ce qui fait diverger les deux implémentations.**
    Avec une seule offre, la fermer rend la prestation injoignable des deux
    côtés, et le test passerait sur l'implémentation qu'on écarte.
    """
    decor = await monter_le_decor(session)
    seconde = await tier_offer_service.create_offer(
        session,
        business_id=decor["business"].id,
        payload=TierOfferCreate(tier_id=REEL, catalog_item_id=decor["item"].id),
    )

    await favorites.ajouter(
        session, creator_id=decor["createur"].id, catalog_item_id=decor["item"].id
    )
    seconde.is_active = False
    await session.flush()

    liste = await favorites.lister(session, creator_id=decor["createur"].id)

    assert [favori.catalog_item_id for favori in liste] == [decor["item"].id]
    assert liste[0].etat is favorites.EtatDuFavori.RESERVABLE


async def test_un_favori_hors_de_portee_reste_et_le_dit(session: AsyncSession) -> None:
    """**Perdre un palier n'efface pas ce qu'on avait mis de côté.**

    Le décor ne laisse que le reel, que cette créatrice n'ouvre pas. La
    prestation est intacte, le salon est ouvert : ce qui manque est chez elle,
    et c'est le seul état sur lequel elle peut agir.
    """
    decor = await monter_le_decor(session)
    await favorites.ajouter(
        session, creator_id=decor["createur"].id, catalog_item_id=decor["item"].id
    )
    # On retire le palier qu'elle ouvre, on garde celui qu'elle n'ouvre pas.
    await tier_offer_service.create_offer(
        session,
        business_id=decor["business"].id,
        payload=TierOfferCreate(tier_id=REEL, catalog_item_id=decor["item"].id),
    )
    await session.execute(
        sa.update(TierOffer).where(TierOffer.id == decor["offre"].id).values(is_active=False)
    )
    await session.flush()

    liste = await favorites.lister(session, creator_id=decor["createur"].id)

    assert len(liste) == 1
    assert liste[0].etat is favorites.EtatDuFavori.HORS_PALIER


async def test_une_prestation_fermee_pour_la_saison_reste_et_le_dit(
    session: AsyncSession,
) -> None:
    """Fermer n'est pas archiver : elle peut rouvrir en septembre."""
    decor = await monter_le_decor(session)
    await favorites.ajouter(
        session, creator_id=decor["createur"].id, catalog_item_id=decor["item"].id
    )
    await session.execute(
        sa.update(CatalogItem).where(CatalogItem.id == decor["item"].id).values(is_available=False)
    )
    await session.flush()

    liste = await favorites.lister(session, creator_id=decor["createur"].id)

    assert liste[0].etat is favorites.EtatDuFavori.FERMEE


async def test_un_salon_en_pause_prime_sur_le_palier(session: AsyncSession) -> None:
    """**L'ordre des questions est l'ordre de ce qu'on peut y faire.**

    Le décor suspend le salon **et** retire le palier qu'elle ouvre : les
    deux causes sont réunies, et une seule doit s'afficher. Dire « hors palier »
    d'une prestation que personne ne peut réserver l'enverrait monter un palier
    pour rien. Sans les deux causes ensemble, l'ordre ne se voit pas.
    """
    decor = await monter_le_decor(session)
    await favorites.ajouter(
        session, creator_id=decor["createur"].id, catalog_item_id=decor["item"].id
    )
    await session.execute(
        sa.update(TierOffer).where(TierOffer.id == decor["offre"].id).values(is_active=False)
    )
    await session.execute(
        sa.update(Business)
        .where(Business.id == decor["business"].id)
        # La base exige qu'un salon suspendu dise pourquoi : les deux vont
        # ensemble, et poser l'un sans l'autre est refusé par une contrainte.
        .values(status=BusinessStatus.SUSPENDED, suspended_reason=SuspensionReason.GRACE_EXPIRED)
    )
    await session.flush()

    liste = await favorites.lister(session, creator_id=decor["createur"].id)

    assert liste[0].etat is favorites.EtatDuFavori.SALON_INDISPONIBLE


# --------------------------------------------------------------------------
# le geste
# --------------------------------------------------------------------------


async def test_le_second_appui_ne_pose_pas_un_second_favori(session: AsyncSession) -> None:
    """Le cœur est un interrupteur, pas un compteur."""
    decor = await monter_le_decor(session)
    for _ in range(3):
        await favorites.ajouter(
            session, creator_id=decor["createur"].id, catalog_item_id=decor["item"].id
        )

    compte = await session.scalar(
        sa.select(sa.func.count())
        .select_from(CreatorFavorite)
        .where(CreatorFavorite.creator_id == decor["createur"].id)
    )
    assert compte == 1
    # La session reste saine : une violation d'unicité attrapée hors d'un point
    # de sauvegarde la laisserait inutilisable, et le défaut ressortirait
    # ailleurs, sous une erreur qui ne dit rien.
    assert await session.scalar(sa.select(sa.literal(1))) == 1


async def test_retirer_ce_qui_n_y_est_pas_ne_se_plaint_pas(session: AsyncSession) -> None:
    """« Il n'y avait rien à retirer » est le résultat voulu d'un cœur déjà vide."""
    decor = await monter_le_decor(session)

    await favorites.retirer(
        session, creator_id=decor["createur"].id, catalog_item_id=decor["item"].id
    )

    assert await favorites.lister(session, creator_id=decor["createur"].id) == ()


async def test_une_prestation_archivee_ne_se_met_pas_en_favori(session: AsyncSession) -> None:
    """Une archive ne se rouvre jamais : y poser un signet serait le poser sur
    une porte murée."""
    decor = await monter_le_decor(session)
    # **Posé sur l'objet et non par une écriture directe.** Le service relit la
    # prestation par la session ; une mise à jour en SQL laisserait l'objet en
    # mémoire tel qu'il était, et le test éprouverait alors une archive que le
    # code ne voit pas.
    decor["item"].archived_at = sa.func.clock_timestamp()
    await session.flush()
    await session.refresh(decor["item"])

    with pytest.raises(favorites.PrestationIntrouvable):
        await favorites.ajouter(
            session, creator_id=decor["createur"].id, catalog_item_id=decor["item"].id
        )

    assert await session.scalar(sa.select(sa.literal(1))) == 1


# --------------------------------------------------------------------------
# ce que le fil en dit, et ce que les autres n'en voient pas
# --------------------------------------------------------------------------


async def test_le_fil_porte_l_etat_du_coeur(session: AsyncSession, client: AsyncClient) -> None:
    """**Quatre-vingts cartes ne demandent pas leur cœur une par une.**

    Le décor pose deux prestations et n'en met qu'une en favori : c'est le seul
    montage où un fil qui rendrait `true` partout — ou `false` partout — se
    distingue de celui qui lit vraiment l'ensemble.
    """
    decor = await monter_le_decor(session)
    from app.schemas.catalog import CatalogItemCreate
    from app.services import catalog as catalog_service

    autre = await catalog_service.create_item(
        session,
        business=decor["business"],
        payload=CatalogItemCreate(
            name="Une autre prestation",
            price_cents=4000,
            duration_minutes=30,
            requires_booking=True,
        ),
    )
    await tier_offer_service.create_offer(
        session,
        business_id=decor["business"].id,
        payload=TierOfferCreate(tier_id=decor["offre"].tier_id, catalog_item_id=autre.id),
    )
    await favorites.ajouter(
        session, creator_id=decor["createur"].id, catalog_item_id=decor["item"].id
    )
    await session.commit()

    reponse = await client.get(
        f"{PREFIX}/businesses",
        params={"longitude": -80.1918, "latitude": 25.7617},
        headers=await _jetons(client, decor["createur"].email),
    )

    assert reponse.status_code == 200, reponse.text
    items = [item for commerce in reponse.json()["commerces"] for item in commerce["items"]]
    par_article = {item["catalog_item_id"]: item["est_favori"] for item in items}
    assert par_article[str(decor["item"].id)] is True
    assert par_article[str(autre.id)] is False


async def test_les_favoris_d_une_creatrice_ne_sont_qu_a_elle(
    session: AsyncSession, client: AsyncClient
) -> None:
    """**Une préférence personnelle, et personne d'autre ne la lit.**

    Le décor pose un favori chez la première, et interroge avec la seconde.
    Sans la première, une route qui rendrait tous les favoris du produit
    rendrait une liste vide elle aussi, et le test ne dirait rien.
    """
    premiere = await monter_le_decor(session)
    seconde = await monter_le_decor(session)
    await favorites.ajouter(
        session, creator_id=premiere["createur"].id, catalog_item_id=premiere["item"].id
    )
    await session.commit()

    reponse = await client.get(
        f"{PREFIX}/me/favorites", headers=await _jetons(client, seconde["createur"].email)
    )

    assert reponse.status_code == 200, reponse.text
    assert reponse.json() == []


async def test_un_commerce_ne_lit_pas_les_favoris(
    session: AsyncSession, client: AsyncClient
) -> None:
    """Savoir qui vous garde sous la main sans vous avoir réservé changerait la
    nature du geste."""
    decor = await monter_le_decor(session)
    await session.commit()

    reponse = await client.get(
        f"{PREFIX}/me/favorites", headers=await _jetons(client, decor["proprietaire"].email)
    )

    assert reponse.status_code == 403, reponse.text


async def test_l_anonymisation_emporte_les_favoris(session: AsyncSession) -> None:
    """**Une créatrice partie ne laisse rien qui dise ce qu'elle regardait.**

    La clé étrangère les emporterait à la suppression d'une ligne `app_user` ;
    une anonymisation ne supprime pas cette ligne. Sans un effacement explicite,
    ils survivraient exactement à ce qui devait les faire disparaître.
    """
    from app.services import anonymization
    from app.services.audit import Actor

    decor = await monter_le_decor(session)
    await favorites.ajouter(
        session, creator_id=decor["createur"].id, catalog_item_id=decor["item"].id
    )
    await session.flush()

    await anonymization.anonymize_account(
        session, user=decor["createur"], actor=Actor.from_user(decor["createur"])
    )

    reste = await session.scalar(
        sa.select(sa.func.count())
        .select_from(CreatorFavorite)
        .where(CreatorFavorite.creator_id == decor["createur"].id)
    )
    assert reste == 0
