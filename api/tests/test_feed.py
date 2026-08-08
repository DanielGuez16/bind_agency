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
from app.models import SocialAccount, TierOffer
from app.models.enums import (
    BusinessCategory,
    Platform,
    SocialAccountStatus,
    UserRole,
    VerificationStatus,
)
from app.schemas.business import BusinessCreate, CoordinatesPayload
from app.schemas.capacity import CapacityRuleCreate
from app.schemas.catalog import CatalogItemCreate
from app.schemas.tier_offers import TierOfferCreate
from app.services import auth as auth_service
from app.services import business as business_service
from app.services import capacity as capacity_service
from app.services import catalog as catalog_service
from app.services import eligibility
from app.services import feed as service
from app.services import metrics as metrics_service
from app.services import tier_offers as tier_offer_service
from app.services.audit import Actor
from app.services.eligibility import RaisonRefus
from tests.test_social_metrics import FauxFournisseur, metriques

PREFIX = get_settings().api_v1_prefix

#: Ocean Drive, Miami Beach. Le point de référence du fil dans ces tests.
ICI = Coordinates(longitude=-80.1300, latitude=25.7907)

STORY = uuid.UUID("8f9bfcd8-39ff-41a3-9b6b-f00e40f8774d")  # instagram/story, 1000 abonnés
REEL = uuid.UUID("a839969b-3965-4c7e-92b1-b6274f899162")  # instagram/reel, 10000 abonnés


async def commerce(session: AsyncSession, *, longitude: float, latitude: float, **overrides):
    proprietaire = await auth_service.register(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password="un-mot-de-passe-solide-42",
        role=UserRole.BUSINESS_MEMBER,
    )
    payload = BusinessCreate(
        name=overrides.pop("name", "Salon d'essai"),
        category=overrides.pop("category", BusinessCategory.BEAUTY),
        currency="USD",
        address="1234 Ocean Dr, Miami Beach FL",
        coordinates=CoordinatesPayload(longitude=longitude, latitude=latitude),
        timezone="America/New_York",
        **overrides,
    )
    b = await business_service.create_business(
        session, payload=payload, creator=proprietaire, geocoder=ManualGeocoder()
    )
    await business_service.activate_business(
        session, business=b, actor=Actor.from_user(proprietaire)
    )
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
    user = await auth_service.register(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password="un-mot-de-passe-solide-42",
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

    membre = await auth_service.register(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password="un-mot-de-passe-solide-42",
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

    membre = await auth_service.register(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password="un-mot-de-passe-solide-42",
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
    proprietaire = await auth_service.register(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password="un-mot-de-passe-solide-42",
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
    user = await auth_service.register(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password="un-mot-de-passe-solide-42",
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
# la route
# --------------------------------------------------------------------------


async def test_la_route_est_reservee_aux_createurs(client: AsyncClient) -> None:
    async def connecte(role: UserRole) -> dict:
        email, password = f"{uuid.uuid4()}@example.com", "un-mot-de-passe-solide-42"
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
    email, password = f"{uuid.uuid4()}@example.com", "un-mot-de-passe-solide-42"
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
