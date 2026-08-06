"""Jeu de données de départ.

Commande séparée, jamais exécutée automatiquement, et jamais posée dans une
migration : une migration décrit un schéma, pas son contenu.

Elle repart d'une base propre — `downgrade base` puis `upgrade head` — plutôt
que de tenter une mise à jour. C'est ce qui la rend rejouable sans réfléchir à
ce qu'une exécution précédente avait laissé.

Tout passe par les services, pas par des insertions directes. Le jeu obtenu est
donc exactement ce que l'API aurait produit, avec ses lignes de journal, et il
éprouve les invariants dans les deux couches : les règles de service d'abord,
les contraintes et triggers en dessous.

    python -m app.seed
"""

import asyncio
import sys
import uuid
from dataclasses import dataclass
from datetime import date

import psycopg
import sqlalchemy as sa
from alembic.config import Config
from sqlalchemy import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from alembic import command
from app.core.config import API_ROOT, get_settings
from app.integrations.geocoding import ManualGeocoder
from app.models import CatalogItem, CreatorProfile, SocialAccount, SocialMetricsSnapshot, Tier, User
from app.models.enums import (
    ContentFormat,
    Locale,
    Platform,
    SocialAccountStatus,
    UserRole,
    VerificationStatus,
)
from app.schemas.business import BusinessCreate, CoordinatesPayload
from app.schemas.capacity import CapacityExceptionCreate, CapacityRuleCreate
from app.schemas.catalog import CatalogItemCreate
from app.schemas.tier_offers import TierOfferCreate
from app.services import auth as auth_service
from app.services import business as business_service
from app.services import capacity as capacity_service
from app.services import catalog as catalog_service
from app.services import tier_offers as tier_offer_service
from app.services.audit import Actor

#: Environnements où l'effacement de la base est acceptable. Ailleurs, la
#: commande refuse : elle détruit tout avant d'écrire.
ENVIRONNEMENTS_AUTORISES = frozenset({"local", "ci", "test"})

#: Mot de passe unique et connu pour tous les comptes du jeu. Il n'a de sens que
#: sur une base jetable, ce que le garde-fou ci-dessus impose.
MOT_DE_PASSE = "bind-donnees-de-depart-2026"

LUNDI, MARDI, MERCREDI, JEUDI, VENDREDI, SAMEDI, DIMANCHE = range(7)


@dataclass(frozen=True, slots=True)
class Resume:
    commerces: int
    items: int
    plages: int
    exceptions: int
    offres: int
    createurs: int


class SeedRefused(RuntimeError):
    """La commande refuse de tourner là où elle effacerait des données réelles."""


async def _tier(session: AsyncSession, platform: Platform, format_: ContentFormat) -> Tier:
    """Les paliers viennent de la migration de référence, pas d'ici."""
    tier = await session.scalar(
        sa.select(Tier).where(Tier.platform == platform, Tier.content_format == format_)
    )
    if tier is None:  # pragma: no cover - la migration les pose toujours
        raise RuntimeError(f"palier absent : {platform} {format_}")
    return tier


async def _offrir(
    session: AsyncSession,
    business_id: uuid.UUID,
    couples: list[tuple[Platform, ContentFormat, CatalogItem]],
) -> int:
    """Compose les offres d'un commerce. Jamais un parent, seulement des variantes."""
    for platform, format_, item in couples:
        tier = await _tier(session, platform, format_)
        await tier_offer_service.create_offer(
            session,
            business_id=business_id,
            payload=TierOfferCreate(tier_id=tier.id, catalog_item_id=item.id),
        )
    return len(couples)


# --------------------------------------------------------------------------
# les trois commerces
# --------------------------------------------------------------------------


async def _ocean_beauty(session: AsyncSession, owner: User) -> tuple[int, int, int, int]:
    """Variantes profondes et journée coupée à midi."""
    business = await business_service.create_business(
        session,
        payload=BusinessCreate(
            name="Ocean Beauty Studio",
            category="beauty",
            currency="usd",
            address="1201 Ocean Drive, Miami Beach, FL 33139",
            coordinates=CoordinatesPayload(longitude=-80.1300, latitude=25.7825),
            timezone="America/New_York",
            default_locale=Locale.EN,
            phone="+13055550111",
        ),
        creator=owner,
        geocoder=ManualGeocoder(),
    )

    coloration = await catalog_service.create_item(
        session,
        business=business,
        payload=CatalogItemCreate(
            name="Coloration",
            description="Gamme de colorations, choisir la variante",
            price_cents=0,
            requires_booking=False,
            duration_minutes=None,
        ),
    )
    items = [coloration]
    variantes: dict[str, CatalogItem] = {}
    for nom, prix, duree in (
        ("Coloration racines", 9000, 60),
        ("Coloration longueurs", 14000, 120),
        ("Coloration + balayage", 19000, 180),
    ):
        variantes[nom] = await catalog_service.create_item(
            session,
            business=business,
            payload=CatalogItemCreate(
                name=nom,
                price_cents=prix,
                duration_minutes=duree,
                parent_item_id=coloration.id,
            ),
        )
        items.append(variantes[nom])

    brushing = await catalog_service.create_item(
        session,
        business=business,
        payload=CatalogItemCreate(name="Brushing", price_cents=5000, duration_minutes=45),
    )
    items.append(brushing)

    plages = 0
    for jour in (MARDI, MERCREDI, JEUDI, VENDREDI, SAMEDI):
        for debut, fin in (("09:00:00", "12:00:00"), ("14:00:00", "18:30:00")):
            await capacity_service.create_rule(
                session,
                business_id=business.id,
                payload=CapacityRuleCreate(
                    weekday=jour, start_time=debut, end_time=fin, concurrent_slots=2
                ),
            )
            plages += 1

    # Les trois formats Instagram, uniquement des variantes : le parent
    # « Coloration » ne se propose pas, c'est la variante qui se réserve.
    offres = await _offrir(
        session,
        business.id,
        [
            (Platform.INSTAGRAM, ContentFormat.STORY, brushing),
            (Platform.INSTAGRAM, ContentFormat.POST, variantes["Coloration racines"]),
            (Platform.INSTAGRAM, ContentFormat.REEL, variantes["Coloration + balayage"]),
        ],
    )

    await business_service.activate_business(
        session, business=business, actor=Actor.from_user(owner)
    )
    return len(items), plages, 0, offres


async def _wynwood_nails(session: AsyncSession, owner: User) -> tuple[int, int, int, int]:
    """Items sans réservation : on se présente quand on veut."""
    business = await business_service.create_business(
        session,
        payload=BusinessCreate(
            name="Wynwood Nails & Care",
            category="beauty",
            currency="usd",
            address="2250 NW 2nd Ave, Miami, FL 33127",
            coordinates=CoordinatesPayload(longitude=-80.1990, latitude=25.7990),
            timezone="America/New_York",
            default_locale=Locale.ES,
            phone="+13055550122",
        ),
        creator=owner,
        geocoder=ManualGeocoder(),
    )

    items = []
    sans_reservation: dict[str, CatalogItem] = {}
    for nom, prix in (("Vernis semi-permanent à emporter", 2500), ("Diagnostic ongles", 0)):
        sans_reservation[nom] = await catalog_service.create_item(
            session,
            business=business,
            payload=CatalogItemCreate(
                name=nom, price_cents=prix, requires_booking=False, duration_minutes=None
            ),
        )
        items.append(sans_reservation[nom])

    reservables: dict[str, CatalogItem] = {}
    for nom, prix, duree in (("Manucure classique", 4500, 50), ("Pose gel", 7000, 90)):
        reservables[nom] = await catalog_service.create_item(
            session,
            business=business,
            payload=CatalogItemCreate(name=nom, price_cents=prix, duration_minutes=duree),
        )
        items.append(reservables[nom])

    plages = 0
    for jour in (MARDI, MERCREDI, JEUDI, VENDREDI, SAMEDI):
        await capacity_service.create_rule(
            session,
            business_id=business.id,
            payload=CapacityRuleCreate(
                weekday=jour, start_time="10:00:00", end_time="19:00:00", concurrent_slots=1
            ),
        )
        plages += 1

    # Aucune offre au palier story : un créateur qui n'a accès qu'à celui-ci ne
    # doit rien voir chez ce commerce. C'est le cas que le fil de la phase 5
    # doit traiter sans tomber sur une liste vide mal gérée.
    # Et un item sans réservation se propose comme un autre.
    offres = await _offrir(
        session,
        business.id,
        [
            (Platform.INSTAGRAM, ContentFormat.POST, reservables["Manucure classique"]),
            (Platform.INSTAGRAM, ContentFormat.REEL, reservables["Pose gel"]),
            (
                Platform.TIKTOK,
                ContentFormat.POST,
                sans_reservation["Vernis semi-permanent à emporter"],
            ),
        ],
    )

    await business_service.activate_business(
        session, business=business, actor=Actor.from_user(owner)
    )
    return len(items), plages, 0, offres


async def _brickell_spa(session: AsyncSession, owner: User) -> tuple[int, int, int, int]:
    """Plusieurs postes en parallèle, une fermeture et une journée aménagée."""
    business = await business_service.create_business(
        session,
        payload=BusinessCreate(
            name="Brickell Spa Collective",
            category="beauty",
            currency="usd",
            address="1450 Brickell Ave, Miami, FL 33131",
            coordinates=CoordinatesPayload(longitude=-80.1918, latitude=25.7600),
            timezone="America/New_York",
            default_locale=Locale.EN,
            phone="+13055550133",
        ),
        creator=owner,
        geocoder=ManualGeocoder(),
    )

    items: dict[str, CatalogItem] = {}
    for nom, prix, duree in (
        ("Massage relaxant 60 min", 12000, 60),
        ("Massage profond 90 min", 17000, 90),
        ("Soin visage hydratant", 11000, 75),
        ("Rituel duo", 26000, 120),
    ):
        items[nom] = await catalog_service.create_item(
            session,
            business=business,
            payload=CatalogItemCreate(name=nom, price_cents=prix, duration_minutes=duree),
        )

    plages = 0
    for jour in (LUNDI, MARDI, MERCREDI, JEUDI, VENDREDI, SAMEDI, DIMANCHE):
        await capacity_service.create_rule(
            session,
            business_id=business.id,
            payload=CapacityRuleCreate(
                weekday=jour, start_time="08:00:00", end_time="20:00:00", concurrent_slots=5
            ),
        )
        plages += 1

    # Fermeture complète : pas d'horaires, donc pas de postes.
    await capacity_service.create_exception(
        session,
        business_id=business.id,
        payload=CapacityExceptionCreate(date=date(2026, 12, 25)),
    )
    # Journée aménagée : les horaires remplacent la règle du jour.
    await capacity_service.create_exception(
        session,
        business_id=business.id,
        payload=CapacityExceptionCreate(
            date=date(2026, 12, 24),
            start_time="09:00:00",
            end_time="13:00:00",
            concurrent_slots=2,
        ),
    )

    # « Soin visage » est placé à deux paliers : un créateur éligible aux deux
    # le verra deux fois. Ce n'est pas un doublon à écraser, c'est au fil de la
    # phase 5 de présenter le meilleur palier accessible.
    offres = await _offrir(
        session,
        business.id,
        [
            (Platform.INSTAGRAM, ContentFormat.STORY, items["Massage relaxant 60 min"]),
            (Platform.INSTAGRAM, ContentFormat.POST, items["Soin visage hydratant"]),
            (Platform.INSTAGRAM, ContentFormat.REEL, items["Massage profond 90 min"]),
            (Platform.TIKTOK, ContentFormat.STORY, items["Soin visage hydratant"]),
        ],
    )

    await business_service.activate_business(
        session, business=business, actor=Actor.from_user(owner)
    )
    return len(items), plages, 2, offres


# --------------------------------------------------------------------------
# créateurs
# --------------------------------------------------------------------------


async def _creator(
    session: AsyncSession,
    *,
    email: str,
    prenom: str,
    nom: str,
    locale: Locale,
    handle: str,
    followers: int,
    score: float | None,
    collabs: int,
) -> User:
    """Un créateur avec son profil, son compte social et un premier relevé.

    `score` à `None` laisse `reliability_score` nul, donc `is_new_creator` vrai :
    c'est le cold start que le moteur de paliers devra traiter comme neutre.
    """
    user = await auth_service.register(
        session, email=email, password=MOT_DE_PASSE, role=UserRole.CREATOR, locale=locale
    )

    # `register` a déjà posé le profil : on le complète, on ne le recrée pas.
    await session.execute(
        sa.update(CreatorProfile)
        .where(CreatorProfile.user_id == user.id)
        .values(
            first_name=prenom,
            last_name=nom,
            city="Miami",
            reliability_score=score,
            completed_collabs_count=collabs,
        )
    )
    await session.flush()

    account = SocialAccount(
        creator_id=user.id,
        platform=Platform.INSTAGRAM,
        external_id=f"seed-{handle}",
        handle=handle,
        status=SocialAccountStatus.ACTIVE,
        verification_status=(
            VerificationStatus.VERIFIED if collabs else VerificationStatus.NEEDS_REVIEW
        ),
    )
    session.add(account)
    await session.flush()

    session.add(
        SocialMetricsSnapshot(
            social_account_id=account.id,
            followers_count=followers,
            following_count=max(followers // 10, 50),
            media_count=max(followers // 40, 12),
            raw_payload={"followers_count": followers, "source": "seed"},
        )
    )
    await session.flush()
    return user


# --------------------------------------------------------------------------
# orchestration
# --------------------------------------------------------------------------


#: Vide `public` de tout ce qui n'appartient pas à une extension — nos tables et
#: `alembic_version`. `spatial_ref_sys`, posée par PostGIS, est donc épargnée.
TABLE_RASE = """
DO $$
DECLARE cible record;
BEGIN
    FOR cible IN
        SELECT c.relname
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          LEFT JOIN pg_depend d ON d.objid = c.oid AND d.deptype = 'e'
         WHERE n.nspname = 'public' AND c.relkind = 'r' AND d.objid IS NULL
    LOOP
        EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', cible.relname);
    END LOOP;
END $$;
"""


def reset_schema() -> None:
    """Table rase, puis migrations. Jamais un `downgrade base`.

    Un `downgrade` remonte la chaîne dans l'ordre inverse, et le retour de la
    migration des paliers de référence refuse d'effacer un palier encore
    référencé par une offre — protection légitime, mais qui bloque une remise à
    zéro alors que les tables allaient de toute façon disparaître.

    Supprimer les tables directement est l'opération honnête : on ne demande pas
    à des migrations de défaire des données qu'on veut jeter.
    """
    url = make_url(str(get_settings().database_url)).set(drivername="postgresql")

    with psycopg.connect(url.render_as_string(hide_password=False), autocommit=True) as connexion:
        connexion.execute(TABLE_RASE)

    config = Config(str(API_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(API_ROOT / "alembic"))
    command.upgrade(config, "head")


async def populate() -> Resume:
    engine = create_async_engine(str(get_settings().database_url))
    factory = async_sessionmaker(bind=engine, expire_on_commit=False)

    try:
        async with factory() as session:
            await auth_service.register(
                session,
                email="admin@bind.test",
                password=MOT_DE_PASSE,
                role=UserRole.ADMIN,
                locale=Locale.EN,
            )

            proprietaires = [
                await auth_service.register(
                    session,
                    email=email,
                    password=MOT_DE_PASSE,
                    role=UserRole.BUSINESS_MEMBER,
                    locale=locale,
                )
                for email, locale in (
                    ("ocean@bind.test", Locale.EN),
                    ("wynwood@bind.test", Locale.ES),
                    ("brickell@bind.test", Locale.EN),
                )
            ]

            totaux = [
                await _ocean_beauty(session, proprietaires[0]),
                await _wynwood_nails(session, proprietaires[1]),
                await _brickell_spa(session, proprietaires[2]),
            ]

            createurs = [
                await _creator(
                    session,
                    email="rebecca@bind.test",
                    prenom="Rebecca",
                    nom="Alvarez",
                    locale=Locale.EN,
                    handle="rebecca.miami",
                    followers=24000,
                    score=82.5,
                    collabs=7,
                ),
                await _creator(
                    session,
                    email="mateo@bind.test",
                    prenom="Mateo",
                    nom="Ferrer",
                    locale=Locale.ES,
                    handle="mateo.wynwood",
                    followers=8600,
                    score=61.0,
                    collabs=2,
                ),
                # Sans historique : reliability_score nul, is_new_creator vrai.
                await _creator(
                    session,
                    email="nouvelle@bind.test",
                    prenom="Camila",
                    nom="Duarte",
                    locale=Locale.ES,
                    handle="camila.newcomer",
                    followers=3100,
                    score=None,
                    collabs=0,
                ),
            ]

            await session.commit()

        return Resume(
            commerces=len(totaux),
            items=sum(items for items, _, _, _ in totaux),
            plages=sum(plages for _, plages, _, _ in totaux),
            exceptions=sum(exceptions for _, _, exceptions, _ in totaux),
            offres=sum(offres for _, _, _, offres in totaux),
            createurs=len(createurs),
        )
    finally:
        await engine.dispose()


def main() -> int:
    settings = get_settings()

    if settings.environment not in ENVIRONNEMENTS_AUTORISES:
        raise SeedRefused(
            f"environnement « {settings.environment} » : la commande efface la base "
            f"avant d'écrire, elle ne tourne que sur {sorted(ENVIRONNEMENTS_AUTORISES)}"
        )

    reset_schema()
    resume = asyncio.run(populate())

    print(
        f"{resume.commerces} commerces, {resume.items} items, {resume.plages} plages, "
        f"{resume.exceptions} exceptions, {resume.offres} offres, "
        f"{resume.createurs} créateurs."
    )
    print(f"Mot de passe de tous les comptes : {MOT_DE_PASSE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
