"""Les repères du voisinage, et les deux choses qu'ils ne doivent jamais faire.

**Ce qu'ils réparent.** L'état vide du commerce disait « ajoutez une prestation »
et rien de plus. Un salon qui vient de s'inscrire ne sait pas combien en publier
ni combien de places ouvrir : il ouvre au hasard, se trouve invisible dans le
fil, et conclut que le produit ne marche pas.

**Les deux interdits, éprouvés ici.** Ne pas laisser lire le catalogue d'un
voisin — d'où le plancher d'effectif et les fourchettes plutôt que les extrêmes.
Et ne pas se compter soi-même : un salon au catalogue vide qui s'inclut lirait
« 0 à 0 » comme la norme du quartier, c'est-à-dire l'exact contraire du repère
cherché.
"""

import uuid
from datetime import time

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.integrations.geocoding import ManualGeocoder
from app.models.enums import BusinessCategory, UserRole
from app.schemas.business import BusinessCreate, CoordinatesPayload
from app.schemas.capacity import CapacityRuleCreate
from app.schemas.catalog import CatalogItemCreate
from app.services import business as business_service
from app.services import capacity as capacity_service
from app.services import catalog as catalog_service
from app.services import neighbourhood
from app.services.audit import Actor
from tests.conftest import inscrire_verifie

#: Ocean Drive. Le voisinage se dessine en décalant la longitude : à cette
#: latitude, un dix-millième de degré vaut une dizaine de mètres.
ANCRE = (-80.1918, 25.7617)


async def salon(
    session: AsyncSession,
    *,
    decalage: float = 0.0,
    prestations: int = 0,
    postes: int = 0,
    actif: bool = True,
):
    """Un salon à `decalage` degrés de l'ancre, avec ce qu'il publie."""
    proprietaire = await inscrire_verifie(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password="tourbillon-cactus-91-vermeil",
        role=UserRole.BUSINESS_MEMBER,
    )
    business = await business_service.create_business(
        session,
        payload=BusinessCreate(
            name=f"Salon {uuid.uuid4().hex[:6]}",
            category=BusinessCategory.BEAUTY,
            currency="USD",
            address="1234 Ocean Dr",
            coordinates=CoordinatesPayload(longitude=ANCRE[0] + decalage, latitude=ANCRE[1]),
            timezone="America/New_York",
        ),
        creator=proprietaire,
        geocoder=ManualGeocoder(),
    )

    for _ in range(prestations):
        await catalog_service.create_item(
            session,
            business=business,
            payload=CatalogItemCreate(
                name="Soin visage", price_cents=8000, duration_minutes=60, requires_booking=True
            ),
        )

    if postes:
        for jour in range(7):
            await capacity_service.create_rule(
                session,
                business_id=business.id,
                payload=CapacityRuleCreate(
                    weekday=jour,
                    start_time=time(8, 0),
                    end_time=time(20, 0),
                    concurrent_slots=postes,
                ),
            )

    if actif:
        await business_service.activate_business(
            session, business=business, actor=Actor.from_user(proprietaire)
        )
    await session.flush()
    return business


async def voisinage(session: AsyncSession, *, combien: int, prestations: int, postes: int):
    """`combien` salons identiques autour de l'ancre, tous à portée."""
    for rang in range(combien):
        await salon(
            session,
            decalage=0.0001 * (rang + 1),
            prestations=prestations,
            postes=postes,
        )


async def test_sous_le_plancher_aucune_fourchette_mais_le_compte(session: AsyncSession) -> None:
    """**L'interdit principal.** Une fourchette sur trois salons désigne des
    salons précis : un commerce lirait le catalogue de son voisin en s'inscrivant
    à côté de lui.

    Le compte est rendu quand même — « quatre salons autour de vous » est une
    information, un vide n'en est pas une et se lit comme une panne.
    """
    plancher = get_settings().neighbourhood_minimum_businesses
    await voisinage(session, combien=plancher - 1, prestations=5, postes=2)
    mien = await salon(session)

    reperes = await neighbourhood.reperes_du_voisinage(session, business=mien)

    assert reperes.commerces == plancher - 1
    assert reperes.prestations_publiees is None
    assert reperes.places_par_jour is None


async def test_au_plancher_les_fourchettes_apparaissent(session: AsyncSession) -> None:
    """Le sens inverse, et il compte autant : une garde qui ne rendrait jamais
    de fourchette passerait le test ci-dessus sans rien garantir, et l'écran
    dirait « pas assez de salons » dans un quartier plein."""
    plancher = get_settings().neighbourhood_minimum_businesses
    await voisinage(session, combien=plancher, prestations=5, postes=2)
    mien = await salon(session)

    reperes = await neighbourhood.reperes_du_voisinage(session, business=mien)

    assert reperes.commerces == plancher
    assert reperes.prestations_publiees == neighbourhood.Fourchette(bas=5, haut=5)
    assert reperes.places_par_jour == neighbourhood.Fourchette(bas=2, haut=2)


async def test_le_commerce_ne_se_compte_pas_lui_meme(session: AsyncSession) -> None:
    """**Le second interdit.** Un salon au catalogue vide qui s'inclut tire la
    fourchette vers sa propre valeur et lit « 0 à 0 » comme la norme du
    quartier — c'est-à-dire l'exact contraire du repère cherché.
    """
    plancher = get_settings().neighbourhood_minimum_businesses
    await voisinage(session, combien=plancher, prestations=6, postes=3)
    mien = await salon(session, prestations=0, postes=0)

    reperes = await neighbourhood.reperes_du_voisinage(session, business=mien)

    assert reperes.commerces == plancher
    assert reperes.prestations_publiees.bas == 6
    assert reperes.places_par_jour.bas == 3


async def test_un_salon_hors_du_rayon_ne_compte_pas(session: AsyncSession) -> None:
    """Le rayon est ce qui remplace le quartier. S'il ne filtrait rien, on
    comparerait un salon de Wynwood à tout Miami — et le repère cesserait d'en
    être un sans que rien ne le signale."""
    plancher = get_settings().neighbourhood_minimum_businesses
    await voisinage(session, combien=plancher, prestations=5, postes=2)
    # Un degré de longitude vaut une centaine de kilomètres : bien au-delà.
    await salon(session, decalage=1.0, prestations=99, postes=99)
    mien = await salon(session)

    reperes = await neighbourhood.reperes_du_voisinage(session, business=mien)

    assert reperes.commerces == plancher
    assert reperes.prestations_publiees.haut < 99


async def test_un_salon_qui_n_a_rien_publie_compte_pour_zero(session: AsyncSession) -> None:
    """**Le piège du `GROUP BY`.** Il ne rend que les commerces qui ont au moins
    une ligne : sans remplissage, un voisinage où la moitié des salons n'a rien
    publié rendrait la fourchette des seuls salons actifs. Un salon neuf lirait
    qu'il est très en retard alors qu'il est dans la moyenne."""
    plancher = get_settings().neighbourhood_minimum_businesses
    await voisinage(session, combien=plancher, prestations=0, postes=0)
    await voisinage(session, combien=plancher, prestations=10, postes=5)
    mien = await salon(session)

    reperes = await neighbourhood.reperes_du_voisinage(session, business=mien)

    assert reperes.commerces == 2 * plancher
    # La moitié basse du voisinage est à zéro : la fourchette doit le dire.
    assert reperes.prestations_publiees.bas == 0
    assert reperes.places_par_jour.bas == 0


async def test_un_commerce_sans_point_n_a_pas_de_voisinage(session: AsyncSession) -> None:
    """Un commerce jamais activé n'a pas de coordonnées — la contrainte
    `active_requires_geo` le garantit. Comparer au monde entier serait pire que
    ne rien rendre."""
    plancher = get_settings().neighbourhood_minimum_businesses
    await voisinage(session, combien=plancher, prestations=5, postes=2)

    proprietaire = await inscrire_verifie(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password="tourbillon-cactus-91-vermeil",
        role=UserRole.BUSINESS_MEMBER,
    )
    sans_point = await business_service.create_business(
        session,
        payload=BusinessCreate(
            name="Sans adresse", category=BusinessCategory.BEAUTY, currency="USD"
        ),
        creator=proprietaire,
        geocoder=ManualGeocoder(),
    )

    reperes = await neighbourhood.reperes_du_voisinage(session, business=sans_point)

    assert reperes.commerces == 0
    assert reperes.prestations_publiees is None


@pytest.mark.parametrize(
    ("valeurs", "attendu"),
    [
        # Les extrêmes sont écartés : ils désignent un salon précis, et ils
        # sautent dès qu'un seul ouvre ou ferme.
        ([0, 4, 5, 6, 40], (4, 6)),
        ([3, 3, 3, 3], (3, 3)),
        ([7], (7, 7)),
    ],
)
def test_la_fourchette_ecarte_les_extremes(valeurs, attendu) -> None:
    fourchette = neighbourhood._fourchette(valeurs)
    assert (fourchette.bas, fourchette.haut) == attendu
