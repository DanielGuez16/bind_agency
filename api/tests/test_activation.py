"""Étapes d'activation du commerce.

Le service connaissait déjà ces conditions et ne les exposait pas : le
commerçant les apprenait en essayant, une à la fois.

Le test qui compte est celui du couplage. Une liste rendue par une route et des
conditions écrites une seconde fois dans `activate_business` diveraient au
premier ajout, et l'écran annoncerait « prêt » sur une activation que le service
refuse. Ici, on retire une étape bloquante et on vérifie que l'activation tombe
sur **cette** étape-là — pas sur une autre, pas sur un message générique.
"""

import uuid
from datetime import datetime, time

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.integrations.geocoding import ManualGeocoder
from app.models import Business, BusinessMember, CatalogItem, TierOffer, User
from app.models.enums import BusinessCategory, BusinessStatus, UserRole
from app.schemas.business import BusinessCreate, CoordinatesPayload
from app.schemas.capacity import CapacityRuleCreate
from app.schemas.catalog import CatalogItemCreate
from app.schemas.tier_offers import TierOfferCreate
from app.services import business as service
from app.services import capacity as capacity_service
from app.services import catalog as catalog_service
from app.services import composition as composition_service
from app.services import tier_offers as tier_offer_service
from app.services.audit import Actor
from tests.conftest import inscrire_verifie
from tests.test_booking_create import monter_le_decor
from tests.test_feed import STORY

PREFIX = get_settings().api_v1_prefix
MOT_DE_PASSE = "tourbillon-cactus-91-vermeil"


async def commerce_en_cours(session: AsyncSession, **overrides):
    """Un commerce créé mais pas activé, sans catalogue ni horaires."""
    proprietaire = await inscrire_verifie(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password=MOT_DE_PASSE,
        role=UserRole.BUSINESS_MEMBER,
    )
    business = await service.create_business(
        session,
        payload=BusinessCreate(
            name="Salon d'essai",
            category=BusinessCategory.BEAUTY,
            currency="USD",
            address=overrides.pop("address", "1234 Ocean Dr"),
            coordinates=CoordinatesPayload(longitude=-80.1918, latitude=25.7617),
            timezone="America/New_York",
        ),
        creator=proprietaire,
        geocoder=ManualGeocoder(),
    )
    return business, proprietaire


def par_cle(etapes) -> dict:
    return {etape.cle: etape for etape in etapes}


async def test_les_etapes_disent_ce_qui_est_fait_et_ce_qui_bloque(
    session: AsyncSession,
) -> None:
    business, _ = await commerce_en_cours(session)

    etapes = par_cle(await service.etapes_activation(session, business=business))

    assert set(etapes) == set(service.EtapeActivation)
    assert etapes[service.EtapeActivation.ADRESSE].done is True
    assert etapes[service.EtapeActivation.ADRESSE].blocking is True
    assert etapes[service.EtapeActivation.COORDONNEES].done is True
    # Rien de tout cela n'existe encore, et rien de tout cela ne bloque.
    for cle in (
        service.EtapeActivation.PHOTO_DE_COUVERTURE,
        service.EtapeActivation.CATALOGUE,
        service.EtapeActivation.OFFRE_DE_PALIER,
        service.EtapeActivation.HORAIRES,
    ):
        assert etapes[cle].done is False, cle
        assert etapes[cle].blocking is False, cle


async def test_une_etape_non_bloquante_n_empeche_pas_l_activation(
    session: AsyncSession,
) -> None:
    """La distinction n'est pas décorative.

    Présenter comme obligatoire une étape qui ne l'est pas ferait renoncer des
    commerces qui pouvaient déjà ouvrir.
    """
    business, proprietaire = await commerce_en_cours(session)

    await service.activate_business(session, business=business, actor=Actor.from_user(proprietaire))

    assert business.status is BusinessStatus.ACTIVE


async def test_l_activation_refuse_exactement_ce_que_les_etapes_marquent_bloquant(
    session: AsyncSession,
) -> None:
    """Le test de couplage.

    On retire l'adresse, on lit la liste, on vérifie qu'elle marque
    précisément cette étape non faite, puis que l'activation tombe sur elle.
    Si les deux se mettaient à diverger, l'écran dirait « prêt » et le service
    refuserait.
    """
    business, proprietaire = await commerce_en_cours(session)
    await session.execute(
        sa.update(Business).where(Business.id == business.id).values(address=None)
    )
    await session.refresh(business)

    etapes = par_cle(await service.etapes_activation(session, business=business))
    manquantes = {cle for cle, etape in etapes.items() if etape.blocking and not etape.done}
    assert manquantes == {service.EtapeActivation.ADRESSE}

    with pytest.raises(service.MissingAddress):
        await service.activate_business(
            session, business=business, actor=Actor.from_user(proprietaire)
        )


async def test_le_refus_nomme_la_seconde_condition_bloquante(session: AsyncSession) -> None:
    """Le pendant du test précédent.

    Sans lui, un `activate_business` qui lèverait toujours `MissingAddress`
    passerait le premier sans rien garantir.
    """
    business, proprietaire = await commerce_en_cours(session)
    await session.execute(sa.update(Business).where(Business.id == business.id).values(geo=None))
    await session.refresh(business)

    etapes = par_cle(await service.etapes_activation(session, business=business))
    assert etapes[service.EtapeActivation.COORDONNEES].done is False
    assert etapes[service.EtapeActivation.ADRESSE].done is True

    with pytest.raises(service.MissingCoordinates):
        await service.activate_business(
            session, business=business, actor=Actor.from_user(proprietaire)
        )


async def test_les_etapes_de_visibilite_se_cochent_quand_elles_sont_faites(
    session: AsyncSession,
) -> None:
    """Un commerce actif sans offre n'apparaît dans aucun fil.

    Le taire produirait un commerce « activé » que personne ne voit et dont
    personne ne comprend pourquoi.
    """
    business, _ = await commerce_en_cours(session)
    item = await catalog_service.create_item(
        session,
        business=business,
        payload=CatalogItemCreate(name="Soin visage", price_cents=8000, duration_minutes=60),
    )
    await tier_offer_service.create_offer(
        session,
        business_id=business.id,
        payload=TierOfferCreate(tier_id=STORY, catalog_item_id=item.id),
    )
    await capacity_service.create_rule(
        session,
        business_id=business.id,
        payload=CapacityRuleCreate(
            weekday=0, start_time=time(8, 0), end_time=time(20, 0), concurrent_slots=2
        ),
    )

    etapes = par_cle(await service.etapes_activation(session, business=business))

    assert etapes[service.EtapeActivation.CATALOGUE].done is True
    assert etapes[service.EtapeActivation.OFFRE_DE_PALIER].done is True
    assert etapes[service.EtapeActivation.HORAIRES].done is True
    assert etapes[service.EtapeActivation.PHOTO_DE_COUVERTURE].done is False


async def test_une_offre_retiree_decoche_l_etape(session: AsyncSession) -> None:
    """Le pendant : une étape qui se coche et ne se décoche jamais ne prouve rien."""
    business, _ = await commerce_en_cours(session)
    item = await catalog_service.create_item(
        session,
        business=business,
        payload=CatalogItemCreate(name="Soin visage", price_cents=8000, duration_minutes=60),
    )
    offre = await tier_offer_service.create_offer(
        session,
        business_id=business.id,
        payload=TierOfferCreate(tier_id=STORY, catalog_item_id=item.id),
    )
    assert par_cle(await service.etapes_activation(session, business=business))[
        service.EtapeActivation.OFFRE_DE_PALIER
    ].done

    await session.execute(
        sa.update(TierOffer).where(TierOffer.id == offre.id).values(is_active=False)
    )
    await session.flush()

    etapes = par_cle(await service.etapes_activation(session, business=business))
    assert etapes[service.EtapeActivation.OFFRE_DE_PALIER].done is False
    # Et l'item, lui, est toujours là : les deux étapes ne se confondent pas.
    assert etapes[service.EtapeActivation.CATALOGUE].done is True
    assert await session.scalar(sa.select(sa.func.count()).select_from(CatalogItem)) >= 1


async def test_la_route_exige_l_appartenance(client: AsyncClient, session: AsyncSession) -> None:
    a, _ = await commerce_en_cours(session)
    # `create_business` rattache déjà son créateur : l'ajouter à la main
    # violerait l'unicité, et c'est bien ce que le commerce veut dire.
    b, proprietaire_de_b = await commerce_en_cours(session)
    await session.commit()

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login",
            json={"email": proprietaire_de_b.email, "password": MOT_DE_PASSE},
        )
    ).json()
    entetes = {"Authorization": f"Bearer {jetons['access_token']}"}

    refuse = await client.get(f"{PREFIX}/business/{a.id}/activation", headers=entetes)
    assert refuse.status_code == 403
    assert refuse.json()["detail"] == "not_a_member"

    accepte = await client.get(f"{PREFIX}/business/{b.id}/activation", headers=entetes)
    assert accepte.status_code == 200, accepte.text
    corps = accepte.json()
    # Le statut accompagne les étapes : sans lui, l'écran proposait « ouvrir »
    # à un commerce ouvert depuis des semaines.
    assert corps["status"] in {"onboarding", "active", "suspended"}
    etapes = corps["etapes"]
    assert {e["cle"] for e in etapes} == {e.value for e in service.EtapeActivation}
    # Pas de pourcentage : « 2 étapes sur 4 » se comprend, « 50 % » ne dit pas
    # laquelle manque.
    assert all(set(e) == {"cle", "done", "blocking"} for e in etapes)


async def test_la_vue_date_la_mise_en_ligne_et_c_est_la_derniere(
    client: AsyncClient, session: AsyncSession
) -> None:
    """**Depuis quand, et non depuis la première fois.**

    La date vivait sur la composition, dont plus rien ne lit la réponse. La
    journée charge cette vue-ci : elle arrive donc sans requête de plus, sur
    l'écran du matin — le seul où un salon en ligne depuis huit jours a des
    questions qu'un salon en ligne depuis huit mois n'a plus.

    Le décor ouvre, met en pause, **puis rouvre**. C'est le seul montage où
    « la dernière » et « la première » divergent : sur un commerce ouvert une
    seule fois les deux implémentations rendent la même date, et le test ne
    prouverait rien.

    Le commerce jamais ouvert tient l'autre bord. Sans lui, une vue qui rendrait
    n'importe quelle date passerait — et « jamais en ligne » n'est pas « en
    pause », que l'écran ne doit surtout pas confondre.
    """
    business, proprietaire = await commerce_en_cours(session)
    acteur = Actor.from_user(proprietaire)

    await service.activate_business(session, business=business, actor=acteur)
    premiere = await composition_service.derniere_mise_en_ligne(session, business.id)
    assert premiere is not None
    await service.pause_business(session, business=business, actor=acteur)
    await service.activate_business(session, business=business, actor=acteur)

    jamais, proprietaire_de_jamais = await commerce_en_cours(session)
    await session.commit()

    async def vue(email: str, business_id) -> dict:
        jetons = (
            await client.post(
                f"{PREFIX}/auth/login",
                json={"email": email, "password": MOT_DE_PASSE},
            )
        ).json()
        reponse = await client.get(
            f"{PREFIX}/business/{business_id}/activation",
            headers={"Authorization": f"Bearer {jetons['access_token']}"},
        )
        assert reponse.status_code == 200, reponse.text
        return reponse.json()

    rouvert = await vue(proprietaire.email, business.id)
    assert rouvert["en_ligne_depuis"] is not None, "la date ne traverse pas le schéma"
    assert datetime.fromisoformat(rouvert["en_ligne_depuis"]) > premiere, (
        "la première ouverture est affichée, celle d'avant la pause"
    )

    neuf = await vue(proprietaire_de_jamais.email, jamais.id)
    assert neuf["en_ligne_depuis"] is None, "un commerce jamais ouvert porte une date"


async def test_la_portee_locale_accompagne_la_date_puis_s_arrete(
    client: AsyncClient, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """**Ce qui complète « en ligne depuis trois jours ».**

    La date seule est vraie et ne rassure personne. « Et 41 créatrices peuvent
    vous réserver » est ce qu'un salon qui vient d'apparaître veut savoir.

    **Le même salon, lu sous deux fenêtres.** C'est le seul montage qui fait
    diverger « toujours servir » de « servir dans la fenêtre » : sur un salon
    publié aujourd'hui les deux rendent le même nombre, et vieillir sa mise en
    ligne est impossible — le journal d'audit refuse les `UPDATE`, ce qui est
    une garde du produit qu'on ne contourne pas pour faire joli. C'est donc la
    fenêtre qui bouge.

    Le nombre servi doit être **non nul** : une portée qui rendrait zéro partout
    passerait aussi bien un décor qui se contente de « pas nul ».
    """
    from tests.test_qui_est_la import TOUT_PRES, _createur_situe

    decor = await monter_le_decor(session)
    business = decor["business"]
    # Une créatrice **située** : la portée ne compte que celles dont on connaît
    # la position, et `monter_le_decor` n'en pose aucune. Sans elle le compte
    # vaut zéro, et « zéro » passerait un décor qui se contente de « pas nul ».
    await _createur_situe(session, ou=TOUT_PRES)
    proprietaire_id = await session.scalar(
        sa.select(BusinessMember.user_id).where(BusinessMember.business_id == business.id).limit(1)
    )
    proprietaire = await session.get(User, proprietaire_id)
    assert proprietaire is not None
    await session.commit()

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login",
            json={"email": proprietaire.email, "password": MOT_DE_PASSE},
        )
    ).json()
    entetes = {"Authorization": f"Bearer {jetons['access_token']}"}

    async def vue() -> dict:
        reponse = await client.get(f"{PREFIX}/business/{business.id}/activation", headers=entetes)
        assert reponse.status_code == 200, reponse.text
        return reponse.json()

    dedans = await vue()
    assert dedans["confirmation_jours"] == get_settings().activation_confirmation_days
    assert dedans["createurs_qui_peuvent_reserver"] is not None, "la portée n'est pas servie"
    assert dedans["createurs_qui_peuvent_reserver"] >= 1, (
        "le décor pose une créatrice éligible : zéro voudrait dire qu'on ne compte rien"
    )

    # La fenêtre se referme. Rien d'autre ne change — même salon, même
    # créatrice, même mise en ligne.
    fermee = get_settings().model_copy(update={"activation_confirmation_days": 0})
    monkeypatch.setattr("app.routers.business.get_settings", lambda: fermee)

    dehors = await vue()
    assert dehors["confirmation_jours"] == 0
    assert dehors["createurs_qui_peuvent_reserver"] is None, (
        "hors fenêtre, le nombre est servi — et donc calculé pour rien"
    )
    assert dehors["en_ligne_depuis"] is not None, "la date, elle, reste"
