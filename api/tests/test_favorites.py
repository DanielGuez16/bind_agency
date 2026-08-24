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

import uuid

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Business, CatalogItem, CreatorFavorite, TierOffer
from app.models.enums import BusinessStatus, NotificationKind, SuspensionReason
from app.schemas.tier_offers import TierOfferCreate
from app.services import favorites
from app.services import tier_offers as tier_offer_service
from tests.test_booking_create import REEL, monter_le_decor
from tests.test_outbox import FauxCourriel, FauxPush

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


async def test_une_prestation_qui_n_est_plus_offerte_nulle_part_est_fermee(
    session: AsyncSession,
) -> None:
    """**Fermée par le salon, et non hors de portée d'elle.**

    Le salon retire son unique offre sans archiver la prestation : l'article
    reste disponible, mais il n'est proposé à aucun palier. Ce n'est pas un
    problème de palier — il n'y a plus de palier du tout — et dire « hors
    palier » l'enverrait en gravir un pour rien.

    **Une mutation a survécu faute de ce décor.** Retirer la condition sur
    l'absence d'offre laissait tomber ce cas dans « hors palier », et aucun test
    ne s'en apercevait : tous mes décors gardaient au moins une offre active.
    """
    decor = await monter_le_decor(session)
    await favorites.ajouter(
        session, creator_id=decor["createur"].id, catalog_item_id=decor["item"].id
    )
    await session.execute(
        sa.update(TierOffer).where(TierOffer.id == decor["offre"].id).values(is_active=False)
    )
    await session.flush()

    liste = await favorites.lister(session, creator_id=decor["createur"].id)

    assert liste[0].etat is favorites.EtatDuFavori.FERMEE


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


async def test_le_compte_des_favoris_ne_se_borne_pas_au_fil(
    session: AsyncSession, client: AsyncClient
) -> None:
    """**Le compte porte sur tout ce qu'elle garde, pas sur ce que le fil rend.**

    La porte des favoris mène à la liste entière ; un compte borné par le rayon
    mettrait un chiffre faux juste à côté d'elle — et il changerait en marchant,
    ce qui est la pire façon de se tromper.

    **Le décor sépare les deux implémentations, et c'est le seul qui le fasse.**
    Il met en favori une prestation que le fil ne rendra pas — elle n'est
    ouverte qu'au reel, que cette créatrice n'atteint pas — et laisse dans le
    fil une prestation qui n'est pas en favori. Un compte dérivé des articles
    rendus répondrait zéro ; le bon répond un.
    """
    from app.schemas.catalog import CatalogItemCreate
    from app.services import catalog as catalog_service

    decor = await monter_le_decor(session)

    # Celle qu'elle garde : offerte au seul palier qu'elle n'ouvre pas, donc
    # absente du fil.
    gardee = await catalog_service.create_item(
        session,
        business=decor["business"],
        payload=CatalogItemCreate(
            name="Hors de son palier",
            price_cents=9000,
            duration_minutes=45,
            requires_booking=True,
        ),
    )
    await tier_offer_service.create_offer(
        session,
        business_id=decor["business"].id,
        payload=TierOfferCreate(tier_id=REEL, catalog_item_id=gardee.id),
    )
    await favorites.ajouter(session, creator_id=decor["createur"].id, catalog_item_id=gardee.id)
    await session.commit()

    reponse = await client.get(
        f"{PREFIX}/businesses",
        params={"longitude": -80.1918, "latitude": 25.7617},
        headers=await _jetons(client, decor["createur"].email),
    )

    assert reponse.status_code == 200, reponse.text
    corps = reponse.json()
    rendus = [item for commerce in corps["commerces"] for item in commerce["items"]]
    # Le fil rend bien quelque chose, et ce n'est pas ce qu'elle garde : sans
    # ces deux constats, le compte de un serait vrai par accident.
    assert rendus, "le décor doit rendre un fil non vide, sinon il ne sépare rien"
    assert str(gardee.id) not in {item["catalog_item_id"] for item in rendus}
    assert not any(item["est_favori"] for item in rendus)

    assert corps["favoris_total"] == 1


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


# --------------------------------------------------------------------------
# l'avis d'ouverture : le premier message que personne n'a déclenché
# --------------------------------------------------------------------------


async def _messages_de_favori(session: AsyncSession, creator_id: uuid.UUID) -> list:
    """Les avis déposés, **un par annonce**.

    La boîte d'envoi dépose sur deux canaux : un avis fait deux lignes, et
    compter les lignes ferait lire « deux avis » là où il n'y en a qu'un. On
    ne garde que le courriel — le compte devient celui des annonces, qui est
    ce que ces tests parlent de.
    """
    from app.models import OutboundMessage
    from app.models.enums import MessageChannel

    return list(
        await session.scalars(
            sa.select(OutboundMessage).where(
                OutboundMessage.user_id == creator_id,
                OutboundMessage.template_key == "favorite.available",
                OutboundMessage.channel == MessageChannel.EMAIL,
            )
        )
    )


async def test_un_favori_qui_s_ouvre_depose_un_avis(session: AsyncSession) -> None:
    """**Ce qui donne son sens au cœur.**

    Elle met en favori une prestation qu'elle ne peut pas encore réserver ; le
    salon rouvre l'offre, et le produit le lui dit. Sans cet avis, le cœur ne
    sert qu'à retrouver ce qu'on savait déjà.

    Le décor part de `hors_palier` et non de rien : c'est la transition qu'on
    annonce, pas l'état. Un favori posé sur une prestation déjà réservable ne
    doit rien déclencher — elle vient de la voir.
    """
    decor = await monter_le_decor(session)
    await session.execute(
        sa.update(TierOffer).where(TierOffer.id == decor["offre"].id).values(is_active=False)
    )
    await session.flush()
    await favorites.ajouter(
        session, creator_id=decor["createur"].id, catalog_item_id=decor["item"].id
    )

    # Rien tant que rien ne bouge.
    await favorites.prevenir_les_ouvertures(session)
    assert await _messages_de_favori(session, decor["createur"].id) == []

    # Le salon rouvre.
    await session.execute(
        sa.update(TierOffer).where(TierOffer.id == decor["offre"].id).values(is_active=True)
    )
    await session.flush()
    annonces = await favorites.prevenir_les_ouvertures(session)

    assert annonces == 1
    messages = await _messages_de_favori(session, decor["createur"].id)
    assert messages, "aucun avis déposé alors que la prestation vient de s'ouvrir"
    assert messages[0].kind is NotificationKind.FAVORITE_AVAILABLE
    assert messages[0].values["prestation"] == decor["item"].name


async def test_un_favori_deja_reservable_ne_previent_de_rien(session: AsyncSession) -> None:
    """**On annonce une ouverture, jamais un état.**

    Sans l'état posé à la création, le premier balayage lirait « rien connu →
    réservable » et enverrait un message pour une prestation qu'elle vient de
    regarder. C'est le décor qui sépare les deux implémentations : ici, rien n'a
    changé entre la pose et le balayage.
    """
    decor = await monter_le_decor(session)
    await favorites.ajouter(
        session, creator_id=decor["createur"].id, catalog_item_id=decor["item"].id
    )

    assert await favorites.prevenir_les_ouvertures(session) == 0
    assert await _messages_de_favori(session, decor["createur"].id) == []


async def test_le_meme_favori_ne_previent_pas_deux_fois(session: AsyncSession) -> None:
    """Deux passages du balayage, un seul avis : c'est une transition.

    Sans le second passage, une implémentation qui annonce l'état à chaque
    tour rendrait le même verdict que la bonne — et enverrait le message
    toutes les quinze minutes en production.
    """
    decor = await monter_le_decor(session)
    await session.execute(
        sa.update(TierOffer).where(TierOffer.id == decor["offre"].id).values(is_active=False)
    )
    await session.flush()
    await favorites.ajouter(
        session, creator_id=decor["createur"].id, catalog_item_id=decor["item"].id
    )
    await favorites.prevenir_les_ouvertures(session)
    await session.execute(
        sa.update(TierOffer).where(TierOffer.id == decor["offre"].id).values(is_active=True)
    )
    await session.flush()

    await favorites.prevenir_les_ouvertures(session)
    await favorites.prevenir_les_ouvertures(session)

    assert len(await _messages_de_favori(session, decor["createur"].id)) == 1


async def test_une_refermeture_puis_une_reouverture_previennent_de_nouveau(
    session: AsyncSession,
) -> None:
    """**L'état se réécrit aussi à la fermeture, et c'est ce qui rend la
    seconde ouverture annonçable.**

    Sans cette écriture-là, une prestation qui s'ouvre, se ferme et se rouvre
    ne serait annoncée qu'une fois : le second retour trouverait `reservable`
    en mémoire et se tairait. Le décor fait le cycle complet, seul montage où
    les deux implémentations divergent.
    """
    decor = await monter_le_decor(session)
    offre_id = decor["offre"].id

    async def basculer(actif: bool) -> None:
        await session.execute(
            sa.update(TierOffer).where(TierOffer.id == offre_id).values(is_active=actif)
        )
        await session.flush()
        await favorites.prevenir_les_ouvertures(session)

    await basculer(False)
    await favorites.ajouter(
        session, creator_id=decor["createur"].id, catalog_item_id=decor["item"].id
    )
    await basculer(True)
    await basculer(False)
    await basculer(True)

    assert len(await _messages_de_favori(session, decor["createur"].id)) == 2


async def test_le_refus_ecarte_l_avis_au_moment_de_sortir(session: AsyncSession) -> None:
    """**La seule préférence du produit, et elle se relit à l'envoi.**

    Le message est déposé quand même : quelqu'un qui coupe l'avis entre le dépôt
    et le vidage doit être entendu, et c'est ce que la boîte d'envoi annonce
    depuis le début en rangeant un identifiant plutôt qu'une adresse. Ce qui est
    éprouvé ici est l'écart au moment de sortir, avec sa raison — distincte de
    « compte injoignable », qu'un refus ne doit pas se lire.
    """
    from app.services import outbox

    decor = await monter_le_decor(session)
    decor["createur"].favoris_me_previennent = False
    await session.execute(
        sa.update(TierOffer).where(TierOffer.id == decor["offre"].id).values(is_active=False)
    )
    await session.flush()
    await favorites.ajouter(
        session, creator_id=decor["createur"].id, catalog_item_id=decor["item"].id
    )
    await favorites.prevenir_les_ouvertures(session)
    await session.execute(
        sa.update(TierOffer).where(TierOffer.id == decor["offre"].id).values(is_active=True)
    )
    await session.flush()
    await favorites.prevenir_les_ouvertures(session)

    deposes = await _messages_de_favori(session, decor["createur"].id)
    assert deposes, "l'avis doit être déposé : le refus se lit à l'envoi, pas au dépôt"

    await outbox.vider(session, email_sender=FauxCourriel(), push_sender=FauxPush())
    await session.flush()
    for message in deposes:
        await session.refresh(message)
        assert message.sent_at is None
        assert message.skipped_reason == outbox.ECARTE_REFUSE


async def test_sans_refus_l_avis_part(session: AsyncSession) -> None:
    """Le sens inverse, et il compte autant : un écart qui écarterait tout
    passerait le test précédent sans rien garantir."""
    from app.services import outbox

    decor = await monter_le_decor(session)
    await session.execute(
        sa.update(TierOffer).where(TierOffer.id == decor["offre"].id).values(is_active=False)
    )
    await session.flush()
    await favorites.ajouter(
        session, creator_id=decor["createur"].id, catalog_item_id=decor["item"].id
    )
    await favorites.prevenir_les_ouvertures(session)
    await session.execute(
        sa.update(TierOffer).where(TierOffer.id == decor["offre"].id).values(is_active=True)
    )
    await session.flush()
    await favorites.prevenir_les_ouvertures(session)

    await outbox.vider(session, email_sender=FauxCourriel(), push_sender=FauxPush())
    await session.flush()
    for message in await _messages_de_favori(session, decor["createur"].id):
        await session.refresh(message)
        assert message.skipped_reason != outbox.ECARTE_REFUSE


async def test_la_fiche_porte_l_etat_du_coeur_ligne_par_ligne(
    session: AsyncSession, client: AsyncClient
) -> None:
    """**Le cœur vit sur la fiche depuis que la carte du fil est le salon.**

    Sans ce champ, chaque cœur s'ouvrirait vide et une prestation déjà gardée
    se présenterait comme non gardée.

    Le décor pose deux prestations et n'en met qu'une en favori : c'est le seul
    montage où une fiche qui rendrait `true` partout — ou `false` partout — se
    distingue de celle qui lit l'ensemble.
    """
    from app.schemas.catalog import CatalogItemCreate
    from app.services import business_public
    from app.services import catalog as catalog_service

    decor = await monter_le_decor(session)
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
    await session.flush()

    fiche = await business_public.fiche(
        session, business_id=decor["business"].id, creator_id=decor["createur"].id
    )

    par_article = {offre.catalog_item_id: offre.est_favori for offre in fiche.offres}
    assert par_article[decor["item"].id] is True
    assert par_article[autre.id] is False
