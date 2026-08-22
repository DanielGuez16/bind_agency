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
from app.schemas.directory import CreateurVuRead
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


# --------------------------------------------------------------------------
# le filtrage, et le total qui va avec
# --------------------------------------------------------------------------


async def test_le_total_est_recalcule_sur_le_filtre(session: AsyncSession) -> None:
    """**Le champ sans lequel les trois autres induisent en erreur.**

    « 20 sur 128 » ment dès qu'un filtre est posé : l'écran annoncerait un
    marché qui n'existe pas. Le décor porte donc deux populations distinctes —
    trois créatrices qui n'ouvrent que le story, une qui ouvre aussi le reel —
    et vérifie que le total suit le filtre au lieu de rester le total du rayon.
    """
    decor = await monter_le_decor(session, tier_id=STORY)
    await tier_offer_service.create_offer(
        session,
        business_id=decor["business"].id,
        payload=TierOfferCreate(tier_id=REEL, catalog_item_id=decor["item"].id),
    )
    for _ in range(3):
        await creatrice(session, ou=TOUT_PRES, followers=5_000)
    await creatrice(session, ou=TOUT_PRES, followers=60_000, collabs=2)

    sans = await directory.annuaire(session, business=decor["business"])
    avec = await directory.annuaire(
        session,
        business=decor["business"],
        filtre=directory.FiltreDAnnuaire(paliers=frozenset({ContentFormat.REEL})),
    )

    # Le décor apporte sa propre créatrice : ce qui compte est l'écart entre les
    # deux totaux, pas un nombre absolu qui dépendrait du montage.
    assert sans.total >= 4
    assert avec.total == 1
    assert len(avec.createurs) == avec.total


async def test_le_filtre_de_palier_retient_au_moins_un_format(
    session: AsyncSession,
) -> None:
    """Au moins un, et non tous : exiger les deux répondrait à une autre
    question que celle que la planche pose."""
    decor = await monter_le_decor(session, tier_id=STORY)
    elle = await creatrice(session, ou=TOUT_PRES, followers=5_000)

    page = await directory.annuaire(
        session,
        business=decor["business"],
        filtre=directory.FiltreDAnnuaire(
            paliers=frozenset({ContentFormat.STORY, ContentFormat.REEL})
        ),
    )

    # Elle n'ouvre que le story, et le filtre demande story **ou** reel.
    assert elle.id in {v.creator_id for v in page.createurs}


async def test_le_filtre_de_reseau_ignore_un_compte_revoque(
    session: AsyncSession,
) -> None:
    """**Le décor qui diverge.**

    Elle a un compte TikTok, mais révoqué : ce n'est pas un réseau
    atteignable, et la liste de ses comptes ne le porte déjà pas. Deux règles
    différentes pour le même mot se contrediraient à l'écran — la fiche dirait
    « Instagram seulement » et le filtre la retiendrait sur TikTok.
    """
    decor = await monter_le_decor(session, tier_id=STORY)
    elle = await creatrice(session, ou=TOUT_PRES, followers=5_000)
    session.add(
        SocialAccount(
            creator_id=elle.id,
            platform=Platform.TIKTOK,
            external_id=f"tt{uuid.uuid4().int % 10**10}",
            handle="rebecca.tt",
            access_token_encrypted="TT-jeton",
            status=SocialAccountStatus.REVOKED,
            verification_status=VerificationStatus.VERIFIED,
        )
    )
    await session.flush()

    tiktok = await directory.annuaire(
        session,
        business=decor["business"],
        filtre=directory.FiltreDAnnuaire(reseau=Platform.TIKTOK),
    )
    instagram = await directory.annuaire(
        session,
        business=decor["business"],
        filtre=directory.FiltreDAnnuaire(reseau=Platform.INSTAGRAM),
    )

    assert tiktok.total == 0
    assert elle.id in {v.creator_id for v in instagram.createurs}


async def test_le_filtre_de_distance_ecarte_l_inconnue(session: AsyncSession) -> None:
    """**Le seul endroit où une position inconnue est écartée**, et c'est
    justifié.

    Le filtre demande « à moins de deux kilomètres », et on ne peut pas
    l'affirmer d'elle. Sans filtre elle reste, en fin de tri : l'inconnue n'est
    écartée que lorsqu'on demande une garantie qu'elle ne peut pas donner.
    """
    decor = await monter_le_decor(session, tier_id=STORY)
    proche = await creatrice(session, ou=TOUT_PRES, followers=5_000)
    loin = await creatrice(session, ou=PLUS_LOIN, followers=5_000)
    sans_position = await creatrice(session, ou=None, followers=5_000)

    sans = await directory.annuaire(session, business=decor["business"])
    avec = await directory.annuaire(
        session,
        business=decor["business"],
        filtre=directory.FiltreDAnnuaire(distance_max_metres=2_000),
    )

    vus = {v.creator_id for v in sans.createurs}
    assert {proche.id, loin.id, sans_position.id} <= vus

    retenus = {v.creator_id for v in avec.createurs}
    assert proche.id in retenus
    assert loin.id not in retenus
    assert sans_position.id not in retenus


async def test_les_filtres_se_combinent(session: AsyncSession) -> None:
    """Trois filtres posés ensemble se conjuguent, jamais ne s'annulent."""
    decor = await monter_le_decor(session, tier_id=STORY)
    proche = await creatrice(session, ou=TOUT_PRES, followers=5_000)
    await creatrice(session, ou=PLUS_LOIN, followers=5_000)

    page = await directory.annuaire(
        session,
        business=decor["business"],
        filtre=directory.FiltreDAnnuaire(
            paliers=frozenset({ContentFormat.STORY}),
            reseau=Platform.INSTAGRAM,
            distance_max_metres=2_000,
        ),
    )

    retenus = {v.creator_id for v in page.createurs}
    assert proche.id in retenus
    assert page.total < (await directory.annuaire(session, business=decor["business"])).total


async def test_un_filtre_vide_ne_filtre_rien(session: AsyncSession) -> None:
    """**Le sens inverse.** Un filtre qui écarterait tout passerait les autres.

    Vide veut dire « tous », jamais « aucun » : c'est l'état par défaut de
    l'écran, et le confondre viderait la liste à l'ouverture.
    """
    decor = await monter_le_decor(session, tier_id=STORY)
    await creatrice(session, ou=TOUT_PRES, followers=5_000)

    page = await directory.annuaire(
        session, business=decor["business"], filtre=directory.FiltreDAnnuaire()
    )
    sans = await directory.annuaire(session, business=decor["business"])

    assert page.total == sans.total
    assert page.total > 0, "un filtre vide qui vide la liste est le défaut qu'on cherche"


async def test_le_filtre_s_applique_a_la_liste_et_non_a_la_page(
    session: AsyncSession,
) -> None:
    """**Le défaut que le filtre existe pour éviter, et le seul décor qui le
    montre.**

    Filtrer une page n'est pas filtrer la liste. Le décor place les créatrices
    qui **ne** passent **pas** le filtre en tête du tri — elles sont plus
    proches — et demande une page de deux. Filtrer après la page ne rendrait
    alors personne, alors que deux créatrices correspondent ; et la page
    suivante rendrait un autre sous-ensemble, si bien qu'une créatrice se
    retrouverait deux fois ou jamais.

    Sans ce décor, filtrer avant et filtrer après rendent le même résultat :
    c'est ce qui a laissé la mutation survivre.
    """
    decor = await monter_le_decor(session, tier_id=STORY)
    await tier_offer_service.create_offer(
        session,
        business_id=decor["business"].id,
        payload=TierOfferCreate(tier_id=REEL, catalog_item_id=decor["item"].id),
    )

    # Trois proches qui n'ouvrent que le story : elles passent en tête du tri.
    for _ in range(3):
        await creatrice(session, ou=TOUT_PRES, followers=5_000)
    # Deux lointaines qui ouvrent le reel : elles passent le filtre.
    for _ in range(2):
        await creatrice(session, ou=PLUS_LOIN, followers=60_000, collabs=2)

    page = await directory.annuaire(
        session,
        business=decor["business"],
        filtre=directory.FiltreDAnnuaire(paliers=frozenset({ContentFormat.REEL})),
        limite=2,
    )

    assert page.total == 2
    assert len(page.createurs) == 2, (
        "la page est vide ou incomplète : le filtre a été appliqué après la "
        "découpe, et il n'a vu que les créatrices que la page contenait"
    )
    assert all(ContentFormat.REEL in v.paliers_ouverts for v in page.createurs)


# --------------------------------------------------------------------------
# ce qui ne part jamais vers un salon
# --------------------------------------------------------------------------


async def test_l_etat_civil_ne_part_pas_vers_un_salon(session: AsyncSession) -> None:
    """**La garantie était tenue par une absence, et rien ne la tenait.**

    Le pseudonyme est l'identité de cet écran : c'est ce qu'un salon reconnaît,
    et c'est ce qui suffit pour aller voir son travail. L'état civil de cent
    vingt-huit personnes n'a rien à faire chez quelqu'un qui ne les a jamais
    rencontrées — il arrive à la réservation, quand une créatrice a choisi ce
    salon.

    Le retrait a eu lieu ; **aucun test ne l'éprouvait**. Ajouter `first_name`
    au schéma « pour la commodité de l'écran » aurait rendu la donnée à tout
    salon abonné sans faire tomber quoi que ce soit.

    **Le décor pose un vrai nom, et c'est ce qui le rend probant.** Un profil
    sans prénom passerait ce test quelle que soit l'implémentation : c'est le
    décor qui pourrait être produit par le code fautif, et il ne prouverait
    rien. Le pseudonyme est distinct du nom pour la même raison — un handle qui
    contiendrait le prénom rendrait les deux assertions indiscernables.
    """
    decor = await monter_le_decor(session, tier_id=STORY)
    elle = await creatrice(session, ou=TOUT_PRES, followers=60_000, collabs=2)
    await session.execute(
        sa.update(CreatorProfile)
        .where(CreatorProfile.user_id == elle.id)
        .values(first_name="Amandine", last_name="Belrose")
    )
    await session.flush()

    page = await directory.annuaire(session, business=decor["business"])

    vue = next(v for v in page.createurs if v.creator_id == elle.id)
    rendu = CreateurVuRead.model_validate(vue).model_dump_json()

    assert "Amandine" not in rendu
    assert "Belrose" not in rendu
    # **Et le pseudonyme est bien là.** Sans cette ligne, un annuaire qui ne
    # rendrait rien du tout — une fiche vide, un champ supprimé par erreur —
    # passerait les deux assertions ci-dessus en ne garantissant rien.
    handle = vue.comptes[0].handle
    assert handle
    assert handle in rendu
