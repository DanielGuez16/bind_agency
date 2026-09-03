"""Fil géolocalisé.

Deux propriétés, et les deux sont des absences.

Rien d'inaccessible n'apparaît : ni palier fermé, ni item désactivé, ni item
sans créneau. Un fil qui montre des choses indisponibles détruit la confiance en
deux jours.

Et un fil maigre dit pourquoi il l'est. Sans obstacle rendu à part, un créateur
qui n'accède à rien conclut qu'il n'y a aucun commerce à Miami — alors qu'il lui
manque mille abonnés.
"""

import uuid
from datetime import time

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.integrations.geocoding import Coordinates, ManualGeocoder
from app.models import BusinessMember, SocialAccount, TierOffer, User
from app.models.enums import (
    BookingStatus,
    BusinessCategory,
    Neighborhood,
    Platform,
    SocialAccountStatus,
    UserRole,
    VerificationStatus,
)
from app.schemas.business import BusinessCreate, CoordinatesPayload
from app.schemas.capacity import CapacityRuleCreate
from app.schemas.catalog import CatalogItemCreate
from app.schemas.tier_offers import TierOfferCreate
from app.services import business as business_service
from app.services import capacity as capacity_service
from app.services import catalog as catalog_service
from app.services import eligibility
from app.services import feed as service
from app.services import metrics as metrics_service
from app.services import tier_offers as tier_offer_service
from app.services.audit import Actor
from app.services.eligibility import RaisonRefus
from tests.conftest import inscrire_verifie
from tests.test_social_metrics import FauxFournisseur, metriques

PREFIX = get_settings().api_v1_prefix

#: Ocean Drive, Miami Beach. Le point de référence du fil dans ces tests.
ICI = Coordinates(longitude=-80.1300, latitude=25.7907)

STORY = uuid.UUID("8f9bfcd8-39ff-41a3-9b6b-f00e40f8774d")  # instagram/story, 1000 abonnés
REEL = uuid.UUID("a839969b-3965-4c7e-92b1-b6274f899162")  # instagram/reel, 10000 abonnés
POST = uuid.UUID("a0ee68db-f167-4af3-ba72-e3149469da4a")  # instagram/post


async def commerce(session: AsyncSession, *, longitude: float, latitude: float, **overrides):
    """Un commerce actif, avec ses horaires.

    `cover_photo_key=None` rend un salon actif **sans** couverture : une donnée
    d'avant la règle qui la rend bloquante, pas un commerce qu'on pourrait créer
    aujourd'hui. Elle est retirée après l'activation, puisque l'activation la
    refuserait — c'est ce qui rend ce cas fidèle à ce qui existe en base.
    """
    sans_couverture = overrides.pop("cover_photo_key", "") is None
    proprietaire = await inscrire_verifie(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password="tourbillon-cactus-91-vermeil",
        role=UserRole.BUSINESS_MEMBER,
    )
    payload = BusinessCreate(
        name=overrides.pop("name", "Salon d'essai"),
        category=overrides.pop("category", BusinessCategory.BEAUTY),
        currency="USD",
        address="1234 Ocean Dr, Miami Beach FL",
        coordinates=CoordinatesPayload(longitude=longitude, latitude=latitude),
        timezone="America/New_York",
        # La couverture bloque l'activation depuis que le fil rend une carte
        # par salon : un décor qui active sans elle se ferait refuser pour une
        # raison qu'il n'éprouve pas.
        cover_photo_key="photos/commerces/decor/couverture",
        **overrides,
    )
    b = await business_service.create_business(
        session, payload=payload, creator=proprietaire, geocoder=ManualGeocoder()
    )
    await business_service.activate_business(
        session, business=b, actor=Actor.from_user(proprietaire)
    )
    if sans_couverture:
        b.cover_photo_key = None
        await session.flush()
    # Ouvert tous les jours, largement : ce fichier n'éprouve pas la capacité.
    for jour in range(7):
        await capacity_service.create_rule(
            session,
            business_id=b.id,
            payload=CapacityRuleCreate(
                weekday=jour, start_time=time(8, 0), end_time=time(20, 0), concurrent_slots=3
            ),
        )
    return b


async def offre(session: AsyncSession, business, *, tier_id=STORY, prix=8000, **item_overrides):
    item = await catalog_service.create_item(
        session,
        business=business,
        payload=CatalogItemCreate(
            name=item_overrides.pop("name", "Soin visage"),
            price_cents=prix,
            duration_minutes=item_overrides.pop("duration_minutes", 60),
            **item_overrides,
        ),
    )
    ligne = await tier_offer_service.create_offer(
        session,
        business_id=business.id,
        payload=TierOfferCreate(tier_id=tier_id, catalog_item_id=item.id),
    )
    return item, ligne


async def createur(session: AsyncSession, *, followers: int = 24_000):
    user = await inscrire_verifie(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password="tourbillon-cactus-91-vermeil",
        role=UserRole.CREATOR,
    )
    compte = SocialAccount(
        creator_id=user.id,
        platform=Platform.INSTAGRAM,
        external_id=f"1784140{uuid.uuid4().int % 10**10}",
        handle="compte.dessai",
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
    return user, compte


async def fil(session, user, **kwargs):
    return await service.fil_du_createur(session, creator_id=user.id, autour_de=ICI, **kwargs)


# --------------------------------------------------------------------------
# ce que le fil montre
# --------------------------------------------------------------------------


async def test_le_fil_liste_des_commerces_pas_des_offres(session: AsyncSession) -> None:
    """Quinze soins du même salon feraient disparaître les autres commerces."""
    b = await commerce(session, longitude=-80.1301, latitude=25.7908)
    for nom in ("Soin A", "Soin B", "Soin C"):
        await offre(session, b, name=nom)
    user, _ = await createur(session)

    resultat = await fil(session, user)

    assert len(resultat.commerces) == 1
    assert len(resultat.commerces[0].items) == 3


async def test_les_commerces_sont_ordonnes_par_distance(session: AsyncSession) -> None:
    loin = await commerce(session, longitude=-80.2100, latitude=25.7907, name="Loin")
    proche = await commerce(session, longitude=-80.1305, latitude=25.7907, name="Proche")
    await offre(session, loin)
    await offre(session, proche)
    user, _ = await createur(session)

    resultat = await fil(session, user)

    assert [c.name for c in resultat.commerces] == ["Proche", "Loin"]
    assert resultat.commerces[0].distance_metres < resultat.commerces[1].distance_metres


async def test_le_rayon_ecarte_ce_qui_est_trop_loin(session: AsyncSession) -> None:
    proche = await commerce(session, longitude=-80.1305, latitude=25.7907, name="Proche")
    # Environ 8 km à l'ouest.
    loin = await commerce(session, longitude=-80.2100, latitude=25.7907, name="Loin")
    await offre(session, proche)
    await offre(session, loin)
    user, _ = await createur(session)

    restreint = await fil(session, user, rayon_metres=1_000)

    assert [c.name for c in restreint.commerces] == ["Proche"]
    # Le pendant : un rayon large les ramène tous les deux, sinon le filtre
    # passerait le test en n'écartant jamais rien de plus que la distance.
    large = await fil(session, user, rayon_metres=50_000)
    assert len(large.commerces) == 2


async def test_le_filtre_de_categorie(session: AsyncSession) -> None:
    beaute = await commerce(session, longitude=-80.1305, latitude=25.7907, name="Beauté")
    resto = await commerce(
        session,
        longitude=-80.1306,
        latitude=25.7907,
        name="Resto",
        category=BusinessCategory.RESTAURANT,
    )
    await offre(session, beaute)
    await offre(session, resto)
    user, _ = await createur(session)

    resultat = await fil(session, user, categorie=BusinessCategory.RESTAURANT)

    assert [c.name for c in resultat.commerces] == ["Resto"]


async def test_l_item_porte_le_compte_qui_ouvre_son_palier(session: AsyncSession) -> None:
    """La réservation se fait au nom d'un compte précis. Le renvoyer ici évite
    au créateur de choisir à l'aveugle."""
    b = await commerce(session, longitude=-80.1305, latitude=25.7907)
    await offre(session, b)
    user, compte = await createur(session)

    resultat = await fil(session, user)

    assert resultat.commerces[0].items[0].social_account_id == compte.id


async def test_le_ratio_de_valeur_est_rendu_sans_masquer(session: AsyncSession) -> None:
    """SPEC §3.3 demande de signaler une offre en deçà, pas de la masquer."""
    b = await commerce(session, longitude=-80.1305, latitude=25.7907)
    await offre(session, b, prix=100, name="Presque rien")
    user, _ = await createur(session)

    resultat = await fil(session, user)

    item = resultat.commerces[0].items[0]
    assert item.value_ratio is not None
    # Un dollar pour un palier dont la référence est 1.0 : très en dessous, et
    # pourtant présent.
    assert item.value_ratio < 2
    assert item.name == "Presque rien"


# --------------------------------------------------------------------------
# ce que le fil ne montre jamais
# --------------------------------------------------------------------------


async def test_un_palier_inaccessible_n_apparait_pas(session: AsyncSession) -> None:
    b = await commerce(session, longitude=-80.1305, latitude=25.7907)
    await offre(session, b, tier_id=STORY, name="Accessible")
    await offre(session, b, tier_id=REEL, name="Hors d'atteinte")
    # 3 100 abonnés : au-dessus de story (1 000), en dessous de reel (10 000).
    user, _ = await createur(session, followers=3_100)

    resultat = await fil(session, user)

    noms = {i.name for i in resultat.commerces[0].items}
    assert noms == {"Accessible"}


async def test_un_item_desactive_n_apparait_pas(session: AsyncSession) -> None:
    b = await commerce(session, longitude=-80.1305, latitude=25.7907)
    item, _ = await offre(session, b, name="Retiré")
    await offre(session, b, name="Visible")
    user, _ = await createur(session)

    membre = await inscrire_verifie(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password="tourbillon-cactus-91-vermeil",
        role=UserRole.BUSINESS_MEMBER,
    )
    await capacity_service.set_availability(
        session, item=item, is_available=False, actor=Actor.from_user(membre)
    )

    resultat = await fil(session, user)
    assert {i.name for i in resultat.commerces[0].items} == {"Visible"}


async def test_un_item_dont_le_parent_est_desactive_n_apparait_pas(
    session: AsyncSession,
) -> None:
    """L'état n'est pas recopié sur l'enfant : il est joint."""
    b = await commerce(session, longitude=-80.1305, latitude=25.7907)
    parent = await catalog_service.create_item(
        session,
        business=b,
        payload=CatalogItemCreate(name="Coupe", price_cents=0, requires_booking=False),
    )
    await offre(session, b, name="Variante", parent_item_id=parent.id)
    user, _ = await createur(session)

    assert (await fil(session, user)).commerces

    membre = await inscrire_verifie(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password="tourbillon-cactus-91-vermeil",
        role=UserRole.BUSINESS_MEMBER,
    )
    await capacity_service.set_availability(
        session, item=parent, is_available=False, actor=Actor.from_user(membre)
    )

    assert (await fil(session, user)).commerces == ()


async def test_un_item_sans_creneau_libre_n_apparait_pas(session: AsyncSession) -> None:
    """Le filtre le plus coûteux, et celui qui fait toute la différence : un fil
    qui propose un item complet fait perdre le créateur pour rien."""
    b = await commerce(session, longitude=-80.1305, latitude=25.7907)
    await offre(session, b, name="Sans horaires")
    user, _ = await createur(session)

    # On retire toutes les plages : plus aucun créneau, nulle part.
    await session.execute(sa.text("DELETE FROM capacity_rule WHERE business_id = :b"), {"b": b.id})
    await session.flush()

    assert (await fil(session, user)).commerces == ()


async def test_un_commerce_en_onboarding_n_apparait_pas(session: AsyncSession) -> None:
    proprietaire = await inscrire_verifie(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password="tourbillon-cactus-91-vermeil",
        role=UserRole.BUSINESS_MEMBER,
    )
    b = await business_service.create_business(
        session,
        payload=BusinessCreate(
            name="Pas encore ouvert",
            category=BusinessCategory.BEAUTY,
            currency="USD",
            address="1234 Ocean Dr",
            coordinates=CoordinatesPayload(longitude=-80.1305, latitude=25.7907),
            timezone="America/New_York",
            cover_photo_key="photos/commerces/decor/couverture",
        ),
        creator=proprietaire,
        geocoder=ManualGeocoder(),
    )
    await offre(session, b)
    user, _ = await createur(session)

    assert (await fil(session, user)).commerces == ()


async def test_une_offre_desactivee_n_apparait_pas(session: AsyncSession) -> None:
    b = await commerce(session, longitude=-80.1305, latitude=25.7907)
    _, ligne = await offre(session, b, name="Retirée")
    user, _ = await createur(session)

    await session.execute(
        sa.update(TierOffer).where(TierOffer.id == ligne.id).values(is_active=False)
    )
    await session.flush()

    assert (await fil(session, user)).commerces == ()


# --------------------------------------------------------------------------
# pourquoi le fil est maigre
# --------------------------------------------------------------------------


async def test_un_fil_vide_dit_pourquoi(session: AsyncSession) -> None:
    """Sans cela, un créateur conclut qu'il n'y a rien à Miami."""
    b = await commerce(session, longitude=-80.1305, latitude=25.7907)
    await offre(session, b, tier_id=REEL)
    user, _ = await createur(session, followers=800)

    resultat = await fil(session, user)

    assert resultat.commerces == ()
    raisons = {o.raison for o in resultat.obstacles}
    assert RaisonRefus.NOT_ENOUGH_FOLLOWERS in raisons
    # Et l'écart est chiffré : « il te manque tant d'abonnés ».
    manque = next(o for o in resultat.obstacles if o.raison is RaisonRefus.NOT_ENOUGH_FOLLOWERS)
    assert manque.ecart == 200  # 1 000 - 800, le palier le plus proche


async def test_les_obstacles_accompagnent_meme_un_fil_garni(session: AsyncSession) -> None:
    """Un créateur qui accède au palier story mais pas au reel doit savoir ce
    qui lui manque, sinon il croit avoir tout vu."""
    b = await commerce(session, longitude=-80.1305, latitude=25.7907)
    await offre(session, b, tier_id=STORY, name="Accessible")
    await offre(session, b, tier_id=REEL, name="Hors d'atteinte")
    user, _ = await createur(session, followers=3_100)

    resultat = await fil(session, user)

    assert resultat.commerces
    assert RaisonRefus.NOT_ENOUGH_FOLLOWERS in {o.raison for o in resultat.obstacles}


async def test_les_obstacles_sont_dedoublonnes_par_raison(session: AsyncSession) -> None:
    """Un créateur bloqué sur trois paliers pour la même raison n'a pas besoin
    de la lire trois fois : ce qu'il doit faire est le même."""
    user, _ = await createur(session, followers=800)

    resultat = await fil(session, user)

    raisons = [o.raison for o in resultat.obstacles]
    assert len(raisons) == len(set(raisons))


async def test_un_createur_sans_compte_social_a_un_fil_vide_et_explique(
    session: AsyncSession,
) -> None:
    b = await commerce(session, longitude=-80.1305, latitude=25.7907)
    await offre(session, b)
    user = await inscrire_verifie(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password="tourbillon-cactus-91-vermeil",
        role=UserRole.CREATOR,
    )

    resultat = await fil(session, user)

    assert resultat.commerces == ()
    # Le fil portait un fil vide **et** aucun obstacle : aucun couple à
    # évaluer, donc rien à reprocher. Le message était laissé à l'écran des
    # paliers.
    #
    # Démenti par un essai sur un vrai compte : le fil est le premier écran
    # qu'on ouvre, et il ne disait rien. Pire, la seule explication qui restait
    # à l'app était « rien autour de toi », qui est fausse et qui envoie
    # élargir un rayon dont la taille ne changera rien.
    assert [o.raison for o in resultat.obstacles] == [eligibility.RaisonRefus.NO_SOCIAL_ACCOUNT]


# --------------------------------------------------------------------------
# ce que chaque issue rapporterait
# --------------------------------------------------------------------------
#
# « Élargir à 5 km · 9 salons », « Retirer le filtre Spa · 34 salons ». La
# règle de la passation est qu'aucune issue ne se propose à l'aveugle — donc
# que le chiffre soit vrai. Un compte obtenu par un chemin plus court, sans le
# contrôle de disponibilité, promettrait des salons que l'écran suivant ne
# rendrait pas ; c'est le seul défaut que ces tests cherchent.


async def test_le_compte_d_une_categorie_est_celui_qu_elle_rend(session: AsyncSession) -> None:
    """La promesse et la livraison, comparées l'une à l'autre.

    Le fil sans filtre annonce ce que chaque pastille ouvrirait ; le fil filtré
    sur cette pastille doit rendre exactement cela. Deux chemins de calcul
    finiraient par diverger, et c'est ce chiffre-là qu'on lit avant de cliquer.
    """
    beaute = await commerce(session, longitude=-80.1305, latitude=25.7907, name="Beauté")
    spa_ouvert = await commerce(
        session,
        longitude=-80.1306,
        latitude=25.7907,
        name="Spa ouvert",
        category=BusinessCategory.FITNESS,
    )
    await offre(session, beaute, name="Soin A")
    await offre(session, beaute, name="Soin B")
    await offre(session, spa_ouvert, name="Séance")
    user, _ = await createur(session)

    sans_filtre = await fil(session, user)
    compte = {c.categorie: c for c in sans_filtre.categories}

    assert compte[BusinessCategory.FITNESS].commerces == 1
    assert compte[BusinessCategory.FITNESS].prestations == 1
    assert compte[BusinessCategory.BEAUTY].prestations == 2

    filtre = await fil(session, user, categorie=BusinessCategory.FITNESS)
    assert len(filtre.commerces) == compte[BusinessCategory.FITNESS].commerces
    assert filtre.total_prestations == compte[BusinessCategory.FITNESS].prestations


async def test_un_filtre_pose_ne_masque_pas_les_autres_pastilles(
    session: AsyncSession,
) -> None:
    """« Retirer le filtre Spa · 34 salons » se lit **depuis** le filtre Spa.

    Les comptes ignorent donc le filtre en vigueur. Appliqués à la requête, ils
    ne rendraient que la catégorie déjà choisie : les autres pastilles
    disparaîtraient au premier clic, et l'écran filtré n'aurait plus d'issue
    que le retour en arrière.
    """
    beaute = await commerce(session, longitude=-80.1305, latitude=25.7907, name="Beauté")
    resto = await commerce(
        session,
        longitude=-80.1306,
        latitude=25.7907,
        name="Resto",
        category=BusinessCategory.RESTAURANT,
    )
    await offre(session, beaute)
    await offre(session, resto)
    user, _ = await createur(session)

    filtre = await fil(session, user, categorie=BusinessCategory.RESTAURANT)

    proposees = {c.categorie for c in filtre.categories}
    assert proposees == {BusinessCategory.BEAUTY, BusinessCategory.RESTAURANT}
    # Et le total que « tout retirer » rendrait se lit sur la somme.
    assert sum(c.commerces for c in filtre.categories) == 2


async def test_une_categorie_sans_rien_de_reservable_n_est_pas_proposee(
    session: AsyncSession,
) -> None:
    """Une pastille qui ouvre sur du vide est une action impossible.

    Le commerce existe, il est actif, sa catégorie aussi, son item est
    disponible — il n'a simplement plus **aucun créneau**. C'est le seul filtre
    du fil qui ne s'exprime pas en SQL : compter sur la requête géographique
    seule aurait annoncé ce musée, et la pastille aurait mené à un écran vide.

    L'item indisponible ne servirait pas ici : la requête l'écarte déjà, et un
    compte pris avant le contrôle de créneau passerait quand même.
    """
    beaute = await commerce(session, longitude=-80.1305, latitude=25.7907, name="Beauté")
    musee = await commerce(
        session,
        longitude=-80.1306,
        latitude=25.7907,
        name="Musée",
        category=BusinessCategory.MUSEUM,
    )
    await offre(session, beaute)
    await offre(session, musee)
    await session.execute(
        sa.text("DELETE FROM capacity_rule WHERE business_id = :b"), {"b": musee.id}
    )
    await session.flush()
    user, _ = await createur(session)

    resultat = await fil(session, user)

    proposees = {c.categorie for c in resultat.categories}
    assert BusinessCategory.BEAUTY in proposees
    assert BusinessCategory.MUSEUM not in proposees


async def test_l_elargissement_ne_compte_que_le_reservable(session: AsyncSession) -> None:
    """Le pendant, sur l'autre issue.

    Le salon lointain n'a plus de créneau : l'annoncer dans « Élargir à 25 km »
    ferait élargir pour rien, et le créateur ne saurait pas pourquoi il ne
    trouve rien après avoir suivi un chiffre.
    """
    proche = await commerce(session, longitude=-80.1305, latitude=25.7907, name="Proche")
    loin = await commerce(session, longitude=-80.2100, latitude=25.7907, name="Loin")
    await offre(session, proche)
    await offre(session, loin)
    await session.execute(
        sa.text("DELETE FROM capacity_rule WHERE business_id = :b"), {"b": loin.id}
    )
    await session.flush()
    user, _ = await createur(session)

    resultat = await fil(session, user, rayon_metres=1_000)

    par_rayon = {r.rayon_metres: r.commerces for r in resultat.rayons}
    assert par_rayon[25_000] == 1, "le lointain n'a plus de créneau"


async def test_l_elargissement_annonce_ce_qu_il_ramene(session: AsyncSession) -> None:
    """Et il garde le rayon courant hors du compte : c'est un gain, pas un total.

    Le salon lointain est hors du rayon demandé et dans l'élargissement. Sans
    balayage plus large que le rayon, il n'aurait jamais été vu, et l'issue se
    serait proposée sans chiffre — ou avec le même que le fil courant.
    """
    proche = await commerce(session, longitude=-80.1305, latitude=25.7907, name="Proche")
    # Environ 8 km à l'ouest : hors de 1 km, dans les 25 km configurés.
    loin = await commerce(session, longitude=-80.2100, latitude=25.7907, name="Loin")
    await offre(session, proche)
    await offre(session, loin)
    user, _ = await createur(session)

    resultat = await fil(session, user, rayon_metres=1_000)

    assert [c.name for c in resultat.commerces] == ["Proche"]
    par_rayon = {r.rayon_metres: r.commerces for r in resultat.rayons}
    assert par_rayon[25_000] == 2, "les deux, à 25 km"
    assert par_rayon[3_000] == 1, "le lointain est à 8 km, pas à 3"

    # Ce que l'issue promet, le fil élargi le rend.
    elargi = await fil(session, user, rayon_metres=25_000)
    assert len(elargi.commerces) == par_rayon[25_000]


async def test_on_ne_propose_jamais_de_retrecir(session: AsyncSession) -> None:
    """Rétrécir n'est pas une issue à un fil maigre.

    Les rayons configurés vont de 3 à 25 km : demandé à 25, il n'en reste
    aucun à proposer, et la liste est vide plutôt que garnie de retours en
    arrière.
    """
    b = await commerce(session, longitude=-80.1305, latitude=25.7907)
    await offre(session, b)
    user, _ = await createur(session)

    large = await fil(session, user, rayon_metres=25_000)
    assert large.rayons == ()

    etroit = await fil(session, user, rayon_metres=1_000)
    assert all(r.rayon_metres > 1_000 for r in etroit.rayons)


async def test_l_elargissement_garde_le_filtre_de_categorie(session: AsyncSession) -> None:
    """Les deux issues ne se mélangent pas.

    « Élargir à 5 km » garde le filtre Spa, « Retirer le filtre Spa » garde le
    rayon. Compter l'un en relâchant l'autre annoncerait un total que ni l'une
    ni l'autre ne rend.
    """
    proche_beaute = await commerce(session, longitude=-80.1305, latitude=25.7907, name="Beauté")
    loin_resto = await commerce(
        session,
        longitude=-80.2100,
        latitude=25.7907,
        name="Resto lointain",
        category=BusinessCategory.RESTAURANT,
    )
    loin_beaute = await commerce(
        session, longitude=-80.2101, latitude=25.7907, name="Beauté lointaine"
    )
    await offre(session, proche_beaute)
    await offre(session, loin_resto)
    await offre(session, loin_beaute)
    user, _ = await createur(session)

    resultat = await fil(session, user, rayon_metres=1_000, categorie=BusinessCategory.BEAUTY)

    par_rayon = {r.rayon_metres: r.commerces for r in resultat.rayons}
    # Les deux salons de beauté, jamais le restaurant.
    assert par_rayon[25_000] == 2


async def test_le_fil_rend_le_rayon_qu_il_a_applique(session: AsyncSession) -> None:
    """L'app ne le devine pas : c'est lui qui s'écrit dans « rayon 3 km »."""
    b = await commerce(session, longitude=-80.1305, latitude=25.7907)
    await offre(session, b)
    user, _ = await createur(session)

    assert (await fil(session, user)).rayon_metres == get_settings().feed_radius_metres
    assert (await fil(session, user, rayon_metres=4_200)).rayon_metres == 4_200


async def test_un_fil_sans_compte_social_ne_propose_aucune_issue(
    session: AsyncSession,
) -> None:
    """Élargir n'y changerait rien, et le proposer enverrait chercher ailleurs.

    La cause est ici, et l'obstacle la nomme. Une issue chiffrée à côté d'elle
    ferait croire qu'il suffit d'élargir.
    """
    b = await commerce(session, longitude=-80.1305, latitude=25.7907)
    await offre(session, b)
    user = await inscrire_verifie(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password="tourbillon-cactus-91-vermeil",
        role=UserRole.CREATOR,
    )

    resultat = await fil(session, user)

    assert resultat.categories == ()
    assert resultat.rayons == ()
    assert resultat.total_prestations == 0


# --------------------------------------------------------------------------
# la route
# --------------------------------------------------------------------------


async def test_la_route_est_reservee_aux_createurs(client: AsyncClient) -> None:
    async def connecte(role: UserRole) -> dict:
        email, password = f"{uuid.uuid4()}@example.com", "tourbillon-cactus-91-vermeil"
        await client.post(
            f"{PREFIX}/auth/register",
            json={"email": email, "password": password, "role": role.value},
        )
        jetons = (
            await client.post(f"{PREFIX}/auth/login", json={"email": email, "password": password})
        ).json()
        return {"headers": {"Authorization": f"Bearer {jetons['access_token']}"}}

    parametres = {"longitude": -80.13, "latitude": 25.79}

    commerce_connecte = await connecte(UserRole.BUSINESS_MEMBER)
    refus = await client.get(f"{PREFIX}/businesses", params=parametres, **commerce_connecte)
    assert refus.status_code == 403

    createur_connecte = await connecte(UserRole.CREATOR)
    reponse = await client.get(f"{PREFIX}/businesses", params=parametres, **createur_connecte)
    assert reponse.status_code == 200
    # Le créateur de ce test n'a aucun compte social : le fil est vide, et il
    # en donne la raison plutôt que de se taire.
    corps = reponse.json()
    assert corps["commerces"] == []
    assert [o["raison"] for o in corps["obstacles"]] == ["no_social_account"]


@pytest.mark.parametrize(
    "parametres",
    [
        {"longitude": 200, "latitude": 25.79},
        {"longitude": -80.13, "latitude": 100},
        {"longitude": -80.13},
    ],
)
async def test_des_coordonnees_invalides_sont_refusees(
    parametres: dict, client: AsyncClient
) -> None:
    email, password = f"{uuid.uuid4()}@example.com", "tourbillon-cactus-91-vermeil"
    await client.post(
        f"{PREFIX}/auth/register",
        json={"email": email, "password": password, "role": UserRole.CREATOR.value},
    )
    jetons = (
        await client.post(f"{PREFIX}/auth/login", json={"email": email, "password": password})
    ).json()

    reponse = await client.get(
        f"{PREFIX}/businesses",
        params=parametres,
        headers={"Authorization": f"Bearer {jetons['access_token']}"},
    )
    assert reponse.status_code == 422


# --------------------------------------------------------------------------
# le quartier
# --------------------------------------------------------------------------


class TestLesQuartiersDuFil:
    """Le quartier, son compte de salons et sa distance.

    **Pourquoi une colonne et pas une lecture de l'adresse.** Le géocodeur ne
    rend que des coordonnées, et `ManualGeocoder` — celui de la démonstration,
    des tests et du jeu de données — ne résout rien du tout. Déduire le quartier
    d'une chaîne ne marcherait pas davantage : « 2250 NW 2nd Ave, Miami, FL
    33127 » est à Wynwood et ne le dit nulle part.
    """

    async def test_le_fil_groupe_les_salons_par_quartier(self, session: AsyncSession) -> None:
        """Deux salons d'un même quartier font un groupe, pas deux."""
        for _ in range(2):
            b = await commerce(
                session,
                longitude=ICI.longitude,
                latitude=ICI.latitude,
                neighborhood=Neighborhood.WYNWOOD,
            )
            await offre(session, b)
        ailleurs = await commerce(
            session,
            longitude=ICI.longitude,
            latitude=ICI.latitude,
            neighborhood=Neighborhood.BRICKELL,
        )
        await offre(session, ailleurs)
        user, _ = await createur(session)

        vue = await fil(session, user)

        par_quartier = {q.quartier: q for q in vue.quartiers}
        assert par_quartier[Neighborhood.WYNWOOD].commerces == 2
        assert par_quartier[Neighborhood.BRICKELL].commerces == 1

    async def test_la_distance_est_celle_du_salon_le_plus_proche(
        self, session: AsyncSession
    ) -> None:
        """**Jamais une moyenne.** Un quartier se choisit pour s'y rendre :
        « Wynwood · 1,2 km » doit désigner un salon qui existe vraiment à
        1,2 km. Une moyenne n'en désignerait aucun."""
        proche = await commerce(
            session,
            longitude=ICI.longitude,
            latitude=ICI.latitude,
            neighborhood=Neighborhood.WYNWOOD,
        )
        await offre(session, proche)
        loin = await commerce(
            session,
            longitude=ICI.longitude + 0.02,
            latitude=ICI.latitude,
            neighborhood=Neighborhood.WYNWOOD,
        )
        await offre(session, loin)
        user, _ = await createur(session)

        vue = await fil(session, user)

        [wynwood] = vue.quartiers
        distances = sorted(c.distance_metres for c in vue.commerces)
        assert wynwood.distance_metres == distances[0]
        # Et surtout : pas la moyenne, qui serait à mi-chemin des deux.
        assert wynwood.distance_metres < sum(distances) / len(distances)

    async def test_les_quartiers_sortent_du_plus_proche_au_plus_lointain(
        self, session: AsyncSession
    ) -> None:
        """C'est l'ordre dans lequel on choisit où aller."""
        loin = await commerce(
            session,
            longitude=ICI.longitude + 0.03,
            latitude=ICI.latitude,
            neighborhood=Neighborhood.CORAL_GABLES,
        )
        await offre(session, loin)
        proche = await commerce(
            session,
            longitude=ICI.longitude,
            latitude=ICI.latitude,
            neighborhood=Neighborhood.WYNWOOD,
        )
        await offre(session, proche)
        user, _ = await createur(session)

        vue = await fil(session, user)

        assert [q.quartier for q in vue.quartiers] == [
            Neighborhood.WYNWOOD,
            Neighborhood.CORAL_GABLES,
        ]

    async def test_un_salon_sans_quartier_reste_dans_le_fil(self, session: AsyncSession) -> None:
        """**L'autre sens, et il compte.** Un salon hors des quartiers ouverts
        est parfaitement réservable : le retirer du fil pour une donnée de
        navigation le rendrait invisible pour une raison qui ne le regarde
        pas. Il n'est simplement dans aucun groupe."""
        sans = await commerce(
            session, longitude=ICI.longitude, latitude=ICI.latitude, neighborhood=None
        )
        await offre(session, sans)
        user, _ = await createur(session)

        vue = await fil(session, user)

        assert len(vue.commerces) == 1
        assert vue.commerces[0].neighborhood is None
        assert vue.quartiers == ()

    async def test_le_compte_de_prestations_suit_le_fil_rendu(self, session: AsyncSession) -> None:
        """Compté sur la liste rendue, jamais sur une seconde requête : deux
        comptes calculés séparément divergent au premier filtre, et c'est le
        compte affiché qui aurait tort."""
        b = await commerce(
            session,
            longitude=ICI.longitude,
            latitude=ICI.latitude,
            neighborhood=Neighborhood.MIDTOWN,
        )
        await offre(session, b, name="Soin visage")
        await offre(session, b, name="Brushing")
        user, _ = await createur(session)

        vue = await fil(session, user)

        [midtown] = vue.quartiers
        assert midtown.commerces == 1
        assert midtown.prestations == 2
        assert midtown.prestations == sum(len(c.items) for c in vue.commerces)


async def _consommer_une_reservation(session: AsyncSession, business) -> None:
    """Une réservation réellement servie, posée par les services qui la produisent.

    Le jeu de données ne pose jamais à la main ce qu'un mécanisme doit produire :
    le compteur de popularité lit `consumed_at`, et l'écrire directement
    masquerait sa disparition le jour où le champ changerait de nom.
    """
    from app.services import availability as availability_service
    from app.services import booking as booking_service
    from app.services import booking_states
    from app.services import creator_profile as profile_service

    createur_local, compte_social = await createur(session)
    # Un nom est exigé pour réserver : c'est le service du profil qui le pose,
    # jamais une écriture directe sur la ligne.
    await profile_service.update_profile(
        session,
        user_id=createur_local.id,
        modifications={"first_name": "Rebecca", "last_name": "Alvarez"},
    )
    offre_id, item_id = (
        await session.execute(
            sa.select(TierOffer.id, TierOffer.catalog_item_id).where(
                TierOffer.business_id == business.id
            )
        )
    ).first()
    creneaux = await availability_service.creneaux_libres(
        session, business_id=business.id, catalog_item_id=item_id, limite=1
    )
    ligne = await booking_service.creer(
        session,
        creator_id=createur_local.id,
        demande=booking_service.DemandeDeReservation(
            tier_offer_id=offre_id,
            social_account_id=compte_social.id,
            starts_at=creneaux[0].starts_at if creneaux else None,
        ),
    )
    await booking_states.confirmer(session, booking=ligne, creator_id=createur_local.id)
    # La validation par le commerce est le comportement par défaut : la
    # confirmation mène alors à `awaiting_business`, pas à `confirmed`. On
    # emprunte le chemin réel plutôt que de forcer l'état.
    if ligne.status is BookingStatus.AWAITING_BUSINESS:
        proprietaire = await session.scalar(
            sa.select(User)
            .join(BusinessMember, BusinessMember.user_id == User.id)
            .where(BusinessMember.business_id == business.id)
            .limit(1)
        )
        await booking_states.trancher(
            session,
            booking=ligne,
            business_id=business.id,
            user_id=proprietaire.id,
            accepte=True,
        )
    await booking_states.transitionner(
        session,
        booking=ligne,
        vers=BookingStatus.CONSUMED,
        actor=Actor.system(),
        reason="servie au comptoir, pour le jeu de test de popularité",
    )


async def _reserver_sans_servir(session: AsyncSession, business) -> None:
    """Une réservation prise, jamais consommée. Elle ne doit rien peser."""
    from app.services import availability as availability_service
    from app.services import booking as booking_service
    from app.services import creator_profile as profile_service

    createur_local, compte_social = await createur(session)
    await profile_service.update_profile(
        session,
        user_id=createur_local.id,
        modifications={"first_name": "Mateo", "last_name": "Ferrer"},
    )
    offre_id, item_id = (
        await session.execute(
            sa.select(TierOffer.id, TierOffer.catalog_item_id).where(
                TierOffer.business_id == business.id
            )
        )
    ).first()
    creneaux = await availability_service.creneaux_libres(
        session, business_id=business.id, catalog_item_id=item_id, limite=1
    )
    await booking_service.creer(
        session,
        creator_id=createur_local.id,
        demande=booking_service.DemandeDeReservation(
            tier_offer_id=offre_id,
            social_account_id=compte_social.id,
            starts_at=creneaux[0].starts_at if creneaux else None,
        ),
    )


async def test_une_prestation_ouverte_a_deux_paliers_ne_compte_qu_une_fois(
    session: AsyncSession,
) -> None:
    """**Le fil rend une ligne par offre ; il annonce des prestations.**

    Un salon qui propose le même article au story et au reel en fait deux
    lignes — deux offres légitimes, avec deux contreparties différentes — mais
    une seule prestation. Les compter toutes deux annonçait « 4 services » là
    où il y en a trois, et au grain du salon la carte listerait le même nom
    deux fois.

    **Le décor est celui où les deux implémentations divergent** : la créatrice
    atteint **les deux** paliers. Avec un seul accessible, la seconde offre ne
    passe pas le tamis du fil et le double compte ne se produit jamais — c'est
    exactement pourquoi le jeu de démonstration ne le montrait pas : son
    doublon est sur un palier TikTok que personne n'atteint.
    """
    from app.models.enums import ReliabilityEventType
    from app.services import reliability
    from tests.test_booking_create import monter_le_decor

    decor = await monter_le_decor(session, tier_id=STORY, followers=60_000)
    # **Le reel demande deux collaborations tenues**, pas seulement des
    # abonnés. Elles viennent du mécanisme du produit : les poser à la main
    # masquerait l'absence de ce mécanisme et rendrait le décor inutile comme
    # test.
    for _ in range(2):
        await reliability.enregistrer(
            session,
            creator_id=decor["createur"].id,
            type_=ReliabilityEventType.COLLAB_COMPLETED,
        )
    # Le même article, une seconde fois, au reel — que ce décor ouvre aussi.
    await tier_offer_service.create_offer(
        session,
        business_id=decor["business"].id,
        payload=TierOfferCreate(tier_id=REEL, catalog_item_id=decor["item"].id),
    )
    await session.flush()

    fil = await service.fil_du_createur(
        session,
        creator_id=decor["createur"].id,
        autour_de=Coordinates(longitude=-80.1918, latitude=25.7617),
    )

    salon = next(c for c in fil.commerces if c.business_id == decor["business"].id)
    assert len(salon.items) == 2, (
        "les deux offres doivent être rendues : ce sont deux contreparties"
    )
    assert salon.prestations_ouvertes == 1
    assert fil.total_prestations == 1
    quartier = next((q for q in fil.quartiers if q.quartier == salon.neighborhood), None)
    if quartier is not None:
        assert quartier.prestations == 1


# --------------------------------------------------------------------------
# le fil sans position — trié par popularité
# --------------------------------------------------------------------------


async def test_le_fil_populaire_classe_par_consommations_et_ignore_la_distance(
    session: AsyncSession,
) -> None:
    """**Le décor où les deux tris divergent.** Le salon le plus loin est celui
    qui a servi une réservation ; s'il ressort en tête, le tri est bien la
    popularité et non une distance qu'aucune position ne pourrait fournir.
    """
    proche = await commerce(session, longitude=-80.1301, latitude=25.7908)
    loin = await commerce(session, longitude=-80.4000, latitude=26.1000)
    await offre(session, proche)
    await offre(session, loin)
    await _consommer_une_reservation(session, loin)

    user, _ = await createur(session, followers=60_000)
    resultat = await service.fil_populaire_du_createur(session, creator_id=user.id)

    assert [s.business_id for s in resultat.salons][:2] == [loin.id, proche.id]


async def test_le_fil_populaire_respecte_les_paliers_comme_le_fil_geolocalise(
    session: AsyncSession,
) -> None:
    """**Le même décor que `test_un_palier_inaccessible_n_apparait_pas`.** Le
    seul commerce du jeu n'offre qu'au palier reel ; à 3 100 abonnés, au-dessus
    du story mais en dessous du reel, la créatrice ne l'atteint pas. Un salon
    qui n'apparaît que grâce à un palier fermé serait une invite à réserver ce
    qu'elle ne peut pas prendre — pire qu'une liste plus courte.
    """
    b = await commerce(session, longitude=-80.1301, latitude=25.7908)
    await offre(session, b, tier_id=REEL)
    user, _ = await createur(session, followers=3_100)

    resultat = await service.fil_populaire_du_createur(session, creator_id=user.id)

    assert resultat.salons == ()
