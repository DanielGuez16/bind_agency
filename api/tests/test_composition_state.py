"""Où en est la composition d'un commerce, en une seule lecture.

Le menu de configuration montrait trois portes sans rien dire de ce qu'il y
avait derrière. C'est le premier écran qu'ouvre un salon qui vient de
s'inscrire — celui où « zéro prestation » et « ouvert six jours » sont
exactement l'information qu'il cherche.

Ce qui est éprouvé ici est ce qu'un comptage peut se tromper à compter : le
parent d'une gamme, qui n'est pas une prestation ; les règles multiples d'un
même jour, qui n'ouvrent qu'un jour ; et la date de mise en ligne d'un commerce
rouvert après une pause, qui est la dernière, pas la première.
"""

from datetime import time

import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import CatalogItem
from app.models.enums import BusinessStatus
from app.schemas.capacity import CapacityRuleCreate
from app.schemas.catalog import CatalogItemCreate
from app.services import capacity as capacity_service
from app.services import catalog as catalog_service
from app.services import composition as service
from app.services.audit import Actor
from tests.test_activation import MOT_DE_PASSE, commerce_en_cours

PREFIX = get_settings().api_v1_prefix


async def test_un_commerce_neuf_n_a_rien_compose(session: AsyncSession) -> None:
    """Le cas de tout salon qui s'inscrit, et le premier qu'il voit."""
    business, _ = await commerce_en_cours(session)

    etat = await service.etat_de_la_composition(session, business.id)

    assert etat is not None
    assert (etat.prestations, etat.jours_ouverts) == (0, 0)
    # **Nulle, pas une date d'inscription.** Jamais mis en ligne n'est pas la
    # même chose que mis en pause, et l'écran ne doit pas les confondre.
    assert etat.status is BusinessStatus.ONBOARDING


async def test_le_parent_d_une_gamme_n_est_pas_une_prestation(session: AsyncSession) -> None:
    """Il ne se réserve pas et ne s'affiche jamais seul : le compter ferait dire
    au menu une prestation de plus que ce que le fil propose."""
    business, _ = await commerce_en_cours(session)

    parent = await catalog_service.create_item(
        session,
        business=business,
        payload=CatalogItemCreate(name="Coloration", price_cents=0, requires_booking=False),
    )
    for nom in ("Racines", "Longueurs"):
        await catalog_service.create_item(
            session,
            business=business,
            payload=CatalogItemCreate(
                name=nom, price_cents=6_000, duration_minutes=60, parent_item_id=parent.id
            ),
        )

    etat = await service.etat_de_la_composition(session, business.id)
    assert etat is not None
    assert etat.prestations == 2, "le parent de la gamme a été compté"


async def test_les_prestations_masquees_se_comptent_a_part(session: AsyncSession) -> None:
    """Douze dont trois éteintes n'est pas douze visibles, et c'est la moitié
    qu'on oublie en regardant un menu."""
    business, _ = await commerce_en_cours(session)
    for nom in ("Brushing", "Coupe"):
        await catalog_service.create_item(
            session,
            business=business,
            payload=CatalogItemCreate(name=nom, price_cents=5_000, duration_minutes=45),
        )
    await session.execute(
        sa.update(CatalogItem)
        .where(CatalogItem.business_id == business.id, CatalogItem.name == "Coupe")
        .values(is_available=False)
    )
    await session.flush()

    etat = await service.etat_de_la_composition(session, business.id)
    assert etat is not None
    assert (etat.prestations, etat.prestations_masquees) == (2, 1)


async def test_deux_regles_le_meme_jour_n_ouvrent_qu_un_jour(session: AsyncSession) -> None:
    """Un salon qui ferme entre midi et deux a deux règles le lundi. Les
    compter ferait dire au menu « ouvert huit jours »."""
    business, _ = await commerce_en_cours(session)
    for debut, fin in ((time(9, 0), time(12, 0)), (time(14, 0), time(19, 0))):
        await capacity_service.create_rule(
            session,
            business_id=business.id,
            payload=CapacityRuleCreate(
                weekday=0, start_time=debut, end_time=fin, concurrent_slots=2
            ),
        )
    await capacity_service.create_rule(
        session,
        business_id=business.id,
        payload=CapacityRuleCreate(
            weekday=1, start_time=time(9, 0), end_time=time(19, 0), concurrent_slots=2
        ),
    )

    etat = await service.etat_de_la_composition(session, business.id)
    assert etat is not None
    assert etat.jours_ouverts == 2, "les règles ont été comptées, pas les jours"


async def test_la_mise_en_ligne_est_la_derniere_pas_la_premiere(session: AsyncSession) -> None:
    """Un commerce rouvert après une pause a plusieurs transitions vers
    `active`. Afficher la première daterait sa mise en ligne d'avant sa pause,
    ce qui est faux et se remarque.

    La date a quitté la composition pour la vue d'activation, où la journée la
    charge déjà ; la règle, elle, n'a pas bougé, et c'est elle qu'on éprouve
    ici — au plus près de la requête, sans passer par un schéma."""
    from app.services import business as business_service

    business, proprietaire = await commerce_en_cours(session)
    acteur = Actor.from_user(proprietaire)

    await business_service.activate_business(session, business=business, actor=acteur)
    premiere = await service.derniere_mise_en_ligne(session, business.id)
    assert premiere is not None

    await business_service.pause_business(session, business=business, actor=acteur)
    await business_service.activate_business(session, business=business, actor=acteur)

    derniere = await service.derniere_mise_en_ligne(session, business.id)
    assert derniere is not None
    assert derniere > premiere, "la première ouverture est affichée"

    etat = await service.etat_de_la_composition(session, business.id)
    assert etat is not None
    assert etat.status is BusinessStatus.ACTIVE


async def test_la_route_rend_les_trois_nombres(client: AsyncClient, session: AsyncSession) -> None:
    """Le service peut les calculer sans que la route les laisse passer : le
    schéma est le seul endroit où un champ se perd en silence."""
    business, proprietaire = await commerce_en_cours(session)
    await session.commit()

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login",
            json={"email": proprietaire.email, "password": MOT_DE_PASSE},
        )
    ).json()
    entetes = {"Authorization": f"Bearer {jetons['access_token']}"}

    reponse = await client.get(f"{PREFIX}/business/{business.id}/composition", headers=entetes)

    assert reponse.status_code == 200
    corps = reponse.json()
    for cle in ("prestations", "prestations_masquees", "jours_ouverts"):
        assert cle in corps, f"{cle} se perd entre le service et la route"


async def test_la_route_refuse_un_commerce_qui_n_est_pas_le_sien(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Le menu dit combien de prestations un commerce propose : c'est une
    lecture de composition, pas une donnée publique."""
    business, _ = await commerce_en_cours(session)
    _, etranger = await commerce_en_cours(session)
    await session.commit()

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login", json={"email": etranger.email, "password": MOT_DE_PASSE}
        )
    ).json()
    entetes = {"Authorization": f"Bearer {jetons['access_token']}"}

    reponse = await client.get(f"{PREFIX}/business/{business.id}/composition", headers=entetes)
    assert reponse.status_code in (403, 404)
