"""L'annuaire est celui d'un salon, pas celui du produit.

**Le manque qui comptait le plus.** `annuaire()` ne prenait aucun commerce :
`paliers_ouverts` répondait « elle se qualifie quelque part », ce dont un salon
ne peut rien faire. Il répond maintenant « elle peut réserver ce que vous avez
ouvert », qui est la seule question qu'il se pose.

Chaque règle est éprouvée sur le décor où deux implémentations **divergent** :

— les paliers du salon, avec une créatrice qui se qualifie pour un palier que
  ce salon **n'offre pas**. Sans elle, « tous les paliers du produit » et
  « ceux de ce salon » rendraient la même liste ;
— le tri, avec une créatrice **proche et inéligible** et une **lointaine et
  éligible**. Trier par la seule distance les mettrait dans l'autre ordre ;
— la pagination, avec plus de créatrices que la page, et la vérification que
  les deux pages ne se recouvrent pas — une page stable est ce qu'un tri
  serveur achète.
"""

import uuid

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import CreatorProfile, SocialAccount
from app.models.enums import (
    ContentFormat,
    Platform,
    ReliabilityEventType,
    SocialAccountStatus,
    UserRole,
    VerificationStatus,
)
from app.schemas.tier_offers import TierOfferCreate
from app.services import directory, reliability
from app.services import metrics as metrics_service
from app.services import tier_offers as tier_offer_service
from tests.conftest import inscrire_verifie
from tests.test_booking_create import REEL, STORY, monter_le_decor
from tests.test_social_metrics import FauxFournisseur, metriques

PREFIX = get_settings().api_v1_prefix
MOT_DE_PASSE = "tourbillon-cactus-91-vermeil"

#: Le salon du décor est à Miami Beach.
TOUT_PRES = (-80.1900, 25.7630)
#: Environ six kilomètres au nord — dans le rayon, et nettement plus loin.
PLUS_LOIN = (-80.1850, 25.8150)
#: Fort Lauderdale, 40 km : dehors.
DEHORS = (-80.1373, 26.1224)


async def creatrice(
    session: AsyncSession,
    *,
    ou: tuple[float, float] | None,
    followers: int = 5_000,
    collabs: int = 0,
):
    user = await inscrire_verifie(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password=MOT_DE_PASSE,
        role=UserRole.CREATOR,
    )
    if ou is not None:
        await session.execute(
            sa.update(CreatorProfile)
            .where(CreatorProfile.user_id == user.id)
            .values(geo=sa.func.ST_SetSRID(sa.func.ST_MakePoint(*ou), 4326))
        )
    compte = SocialAccount(
        creator_id=user.id,
        platform=Platform.INSTAGRAM,
        external_id=f"1784140{uuid.uuid4().int % 10**10}",
        handle=f"c{uuid.uuid4().hex[:8]}",
        access_token_encrypted="IGQVJXY-jeton",
        status=SocialAccountStatus.ACTIVE,
        verification_status=VerificationStatus.VERIFIED,
    )
    session.add(compte)
    await session.flush()
    await metrics_service.refresh_profile_metrics(
        session,
        account=compte,
        provider=FauxFournisseur(rend=metriques(followers_count=followers, media_count=208)),
    )
    # Le compteur vient du mécanisme du produit, jamais posé à la main.
    for _ in range(collabs):
        await reliability.enregistrer(
            session, creator_id=user.id, type_=ReliabilityEventType.COLLAB_COMPLETED
        )
    return user


# --------------------------------------------------------------------------
# les paliers de ce salon
# --------------------------------------------------------------------------


async def test_les_paliers_sont_ceux_de_ce_salon_et_non_ceux_du_produit(
    session: AsyncSession,
) -> None:
    """**Le test qui distingue les deux implémentations.**

    La créatrice a de quoi ouvrir le reel — soixante mille abonnés, deux
    collaborations — et le salon n'offre que le story. « Tous les paliers du
    produit » rendrait `[story, post, reel]` ; « ceux de ce salon » rend
    `[story]`. Sans une créatrice qui dépasse l'offre du salon, les deux
    rendraient la même liste.
    """
    decor = await monter_le_decor(session, tier_id=STORY)
    # **Un second salon offre le reel, et c'est lui qui fait diverger les deux
    # implémentations.** Avec un seul salon au décor, « tous les paliers
    # offerts » et « ceux de ce salon » sont le même ensemble : la mutation qui
    # retire le filtre par commerce survivait sans rien casser.
    await monter_le_decor(session, tier_id=REEL)

    elle = await creatrice(session, ou=TOUT_PRES, followers=60_000, collabs=2)

    page = await directory.annuaire(session, business=decor["business"])
    vue = {v.creator_id: v for v in page.createurs}[elle.id]

    assert vue.paliers_ouverts == (ContentFormat.STORY,)
    assert vue.peut_reserver_ici is True
    assert vue.palier_accessible is not None
    assert vue.palier_accessible.content_format is ContentFormat.STORY


async def test_le_meilleur_palier_est_le_plus_exigeant_des_ouverts(
    session: AsyncSession,
) -> None:
    """**Le sens inverse.** Un salon qui offre les deux doit rendre le reel.

    Sans ce test, une lecture qui rendrait toujours le premier palier trouvé
    passerait le précédent.
    """
    decor = await monter_le_decor(session, tier_id=STORY)
    await tier_offer_service.create_offer(
        session,
        business_id=decor["business"].id,
        payload=TierOfferCreate(tier_id=REEL, catalog_item_id=decor["item"].id),
    )
    elle = await creatrice(session, ou=TOUT_PRES, followers=60_000, collabs=2)

    page = await directory.annuaire(session, business=decor["business"])
    vue = {v.creator_id: v for v in page.createurs}[elle.id]

    assert set(vue.paliers_ouverts) == {ContentFormat.STORY, ContentFormat.REEL}
    assert vue.palier_accessible.content_format is ContentFormat.REEL


async def test_une_creatrice_hors_de_portee_reste_listee_sans_palier(
    session: AsyncSession,
) -> None:
    """Elle est là, elle n'ouvre rien. La liste ne la cache pas.

    L'écran a besoin de la voir pour dire « ouvrir le palier post la
    rendrait joignable » ; l'écarter ferait disparaître l'argument avec elle.
    """
    decor = await monter_le_decor(session, tier_id=REEL)
    elle = await creatrice(session, ou=TOUT_PRES, followers=1_500)

    page = await directory.annuaire(session, business=decor["business"])
    vue = {v.creator_id: v for v in page.createurs}[elle.id]

    assert vue.paliers_ouverts == ()
    assert vue.peut_reserver_ici is False
    assert vue.palier_accessible is None


# --------------------------------------------------------------------------
# la distance et le tri
# --------------------------------------------------------------------------


async def test_l_acces_passe_avant_la_proximite(session: AsyncSession) -> None:
    """**Le décor qui diverge : proche et inéligible, loin et éligible.**

    Trier par la seule distance mettrait la proche en tête. La planche demande
    l'inverse, et elle a raison : une créatrice joignable à six kilomètres vaut
    mieux qu'une créatrice hors de portée d'en face.
    """
    decor = await monter_le_decor(session, tier_id=REEL)
    proche = await creatrice(session, ou=TOUT_PRES, followers=1_500)
    loin = await creatrice(session, ou=PLUS_LOIN, followers=60_000, collabs=2)

    page = await directory.annuaire(session, business=decor["business"])
    ordre = [v.creator_id for v in page.createurs]

    assert ordre.index(loin.id) < ordre.index(proche.id)
    # Et la distance est bien celle qu'on croit : la lointaine est plus loin.
    par_id = {v.creator_id: v for v in page.createurs}
    assert par_id[loin.id].distance_metres > par_id[proche.id].distance_metres


async def test_a_acces_egal_la_plus_proche_passe_devant(session: AsyncSession) -> None:
    """**Le second critère, et sans lui le premier ne prouverait rien.**

    Un tri qui ignorerait la distance passerait le test précédent.
    """
    decor = await monter_le_decor(session, tier_id=STORY)
    proche = await creatrice(session, ou=TOUT_PRES, followers=60_000)
    loin = await creatrice(session, ou=PLUS_LOIN, followers=60_000)

    page = await directory.annuaire(session, business=decor["business"])
    ordre = [v.creator_id for v in page.createurs]

    assert ordre.index(proche.id) < ordre.index(loin.id)


async def test_une_creatrice_sans_position_passe_derriere_sans_etre_ecartee(
    session: AsyncSession,
) -> None:
    """Nulle veut dire « on ne sait pas », jamais « loin ».

    Elle existe et elle peut réserver : la jeter serait décider à sa place.
    Elle passe derrière ce qu'on sait, ce qui est le bon traitement d'une
    inconnue.
    """
    decor = await monter_le_decor(session, tier_id=STORY)
    situee = await creatrice(session, ou=PLUS_LOIN, followers=60_000)
    sans = await creatrice(session, ou=None, followers=60_000)

    page = await directory.annuaire(session, business=decor["business"])
    par_id = {v.creator_id: v for v in page.createurs}
    ordre = [v.creator_id for v in page.createurs]

    assert par_id[sans.id].distance_metres is None
    assert sans.id in par_id, "une position inconnue n'est pas une raison d'écarter"
    assert ordre.index(situee.id) < ordre.index(sans.id)


async def test_une_creatrice_hors_du_rayon_n_est_pas_listee(session: AsyncSession) -> None:
    """La même borne que le compte qui précède la liste.

    Sans elle, l'écran annoncerait « 128 créatrices autour de vous » au-dessus
    d'une liste qui en contient deux mille.
    """
    decor = await monter_le_decor(session, tier_id=STORY)
    dedans = await creatrice(session, ou=TOUT_PRES, followers=60_000)
    dehors = await creatrice(session, ou=DEHORS, followers=60_000)

    page = await directory.annuaire(session, business=decor["business"])
    identifiants = {v.creator_id for v in page.createurs}

    assert dedans.id in identifiants
    assert dehors.id not in identifiants


# --------------------------------------------------------------------------
# la pagination
# --------------------------------------------------------------------------


async def test_les_pages_ne_se_recouvrent_pas_et_le_total_les_depasse(
    session: AsyncSession,
) -> None:
    """**Ce qu'un tri serveur achète.**

    Deux pages disjointes, et un total qui dit qu'il en reste. Un tri fait dans
    le client se réordonne à chaque page — chaque page n'a que ses propres
    lignes à comparer — et une créatrice se retrouve alors deux fois ou jamais.
    """
    decor = await monter_le_decor(session, tier_id=STORY)
    for _ in range(5):
        await creatrice(session, ou=TOUT_PRES, followers=60_000)

    premiere = await directory.annuaire(session, business=decor["business"], limite=2)
    seconde = await directory.annuaire(session, business=decor["business"], limite=2, decalage=2)

    assert len(premiere.createurs) == 2
    assert len(seconde.createurs) == 2
    assert premiere.total == seconde.total >= 5
    assert premiere.total > len(premiere.createurs), "le total doit dire qu'il en reste"

    a = {v.creator_id for v in premiere.createurs}
    b = {v.creator_id for v in seconde.createurs}
    assert a.isdisjoint(b)


async def test_la_page_est_stable_entre_deux_appels(session: AsyncSession) -> None:
    """À égalité d'accès et de distance, l'ordre ne bouge pas.

    Le troisième critère du tri — l'identifiant — existe pour ça : sans lui,
    deux créatrices à égalité peuvent changer de place, et l'une des deux
    manque à la page suivante.
    """
    decor = await monter_le_decor(session, tier_id=STORY)
    for _ in range(4):
        await creatrice(session, ou=TOUT_PRES, followers=60_000)

    un = await directory.annuaire(session, business=decor["business"], limite=2)
    deux = await directory.annuaire(session, business=decor["business"], limite=2)

    assert [v.creator_id for v in un.createurs] == [v.creator_id for v in deux.createurs]
