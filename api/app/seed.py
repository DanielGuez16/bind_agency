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
from datetime import UTC, date, datetime, timedelta

import httpx
import psycopg
import sqlalchemy as sa
from alembic.config import Config
from sqlalchemy import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from alembic import command
from app import seed_demo
from app.core.config import API_ROOT, get_settings
from app.integrations.geocoding import ManualGeocoder
from app.integrations.social import IdentiteSociale, JetonEchange, MetriquesProfil
from app.models import CatalogItem, Tier, User
from app.models.enums import ContentFormat, Locale, Platform, UserRole
from app.schemas.business import BusinessCreate, CoordinatesPayload
from app.schemas.capacity import CapacityExceptionCreate, CapacityRuleCreate
from app.schemas.catalog import CatalogItemCreate
from app.schemas.tier_offers import TierOfferCreate
from app.services import auth as auth_service
from app.services import business as business_service
from app.services import capacity as capacity_service
from app.services import catalog as catalog_service
from app.services import eligibility
from app.services import metrics as metrics_service
from app.services import social_accounts as social_account_service
from app.services import tier_offers as tier_offer_service
from app.services.audit import Actor

#: Environnements où l'effacement de la base est acceptable. Ailleurs, la
#: commande refuse : elle détruit tout avant d'écrire.
ENVIRONNEMENTS_AUTORISES = frozenset({"local", "ci", "test"})

#: Mot de passe unique et connu pour tous les comptes du jeu. Il n'a de sens que
#: sur une base jetable, ce que le garde-fou ci-dessus impose.
MOT_DE_PASSE = "bind-donnees-de-depart-2026"

#: Le domaine des comptes du jeu. `.example` est réservé par la RFC 2606 —
#: personne ne le possédera jamais — et il passe la validation d'adresse.
#:
#: `.test` l'est aussi, mais `email-validator` le refuse comme « nom d'usage
#: spécial ». Le jeu de données l'employait, et les comptes ne pouvaient donc
#: pas se connecter par l'API : le service les créait sans passer par le
#: schéma. Le test qui prétendait le vérifier ne regardait que les empreintes
#: de mot de passe — il constatait un ensemble vide, sans jamais se connecter.
DOMAINE = "bind.example"

LUNDI, MARDI, MERCREDI, JEUDI, VENDREDI, SAMEDI, DIMANCHE = range(7)


@dataclass(frozen=True, slots=True)
class Resume:
    commerces: int
    items: int
    plages: int
    exceptions: int
    offres: int
    createurs: int
    reservations: int
    contreparties: int
    jobs: int
    photos: int
    plans: int
    abonnements: int
    #: Nombre de paliers auxquels au moins un créateur du jeu accède. À zéro,
    #: le jeu ne permet de démontrer aucun parcours créateur — c'est une donnée
    #: du résumé, pas un détail à découvrir en cherchant.
    paliers_accessibles: int


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

    # Le seul salon en automatique du jeu de données. Les autres valident, ce
    # qui est le défaut du produit ; il en faut un de chaque côté pour que la
    # démonstration montre les deux parcours.
    #
    # Wynwood et non Ocean Beauty : c'est Ocean Beauty qui accueille la
    # réservation laissée en attente, et l'y mettre en automatique revenait à
    # défaire l'un avec l'autre.
    business.requires_booking_approval = False
    await session.flush()

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


async def _little_havana(session: AsyncSession, owner: User) -> tuple[int, int, int, int]:
    """Un commerce inscrit qui n'a **rien** composé.

    Il n'a ni catalogue, ni horaires, ni offre — seulement une adresse. C'est
    l'état de tout commerce le jour de son inscription, et aucun jeu de données
    ne le montrait : l'écran d'activation, l'état vide du catalogue et le
    reporting à zéro n'avaient jamais de sujet.

    Il reste en `onboarding` : deux de ses six étapes sont faites, les quatre
    autres attendent, et le commerce n'apparaît dans aucun fil — ce qui est
    exactement ce que l'écran d'activation doit lui expliquer.
    """
    await business_service.create_business(
        session,
        payload=BusinessCreate(
            name="Havana Glow",
            category="beauty",
            currency="usd",
            address="1500 SW 8th St, Miami, FL 33135",
            coordinates=CoordinatesPayload(longitude=-80.2192, latitude=25.7650),
            timezone="America/New_York",
            default_locale=Locale.ES,
            phone="+13055550444",
        ),
        creator=owner,
        geocoder=ManualGeocoder(),
    )
    return 0, 0, 0, 0


# --------------------------------------------------------------------------
# créateurs
# --------------------------------------------------------------------------


class FournisseurLocal:
    """Instagram, sans Instagram.

    Le jeu de données ne peut pas appeler Meta : ni clé d'application, ni
    créateur devant un navigateur pour autoriser. Ce qu'il peut faire, en
    revanche, c'est emprunter **le même chemin** — démarrer un parcours,
    consommer l'état, échanger un code, relever les métriques — avec un
    fournisseur qui répond de mémoire au lieu de répondre du réseau.

    C'est la différence entre poser une ligne `social_account` à la main et
    obtenir celle que le produit aurait produite. La première dirait que tout
    va bien ; la seconde révèle ce qui manque encore.
    """

    platform = Platform.INSTAGRAM

    def __init__(self, *, handle: str, followers: int) -> None:
        self.handle = handle
        self.followers = followers
        self.etat: str | None = None

    def authorization_url(self, *, state: str) -> str:
        # Le seul détour du montage : le parcours réel passe l'état par le
        # navigateur du créateur, ici on le retient au vol pour le rendre au
        # rappel. L'état reste signé, à usage unique, et vérifié par le service.
        self.etat = state
        return f"https://instagram.local/authorize?state={state}"

    async def exchange_code(self, code: str) -> JetonEchange:
        return JetonEchange(
            access_token=f"jeton-local-{self.handle}",
            expires_at=datetime.now(UTC) + timedelta(days=60),
        )

    async def fetch_identity(self, access_token: str) -> IdentiteSociale:
        return IdentiteSociale(external_id=f"seed-{self.handle}", handle=self.handle)

    async def fetch_profile_metrics(
        self, access_token: str, *, external_id: str
    ) -> MetriquesProfil:
        return MetriquesProfil(
            followers_count=self.followers,
            following_count=max(self.followers // 10, 50),
            media_count=max(self.followers // 40, 12),
            audience_demographics={"country": {"US": self.followers}},
            raw_payload={"followers_count": self.followers, "source": "seed"},
        )


async def _creator(
    session: AsyncSession, *, email: str, locale: Locale, handle: str, followers: int
) -> User:
    """Un créateur, son compte social rattaché, et un premier relevé.

    Rien n'est posé à la main. Le profil est celui que `register` crée, le
    compte social celui que le parcours OAuth produit, le relevé celui que le
    service de métriques écrit — et c'est ce relevé qui déclenche le contrôle
    de cohérence, d'où le `verified` obtenu sans intervention.

    Ce que le produit ne sait pas encore fabriquer n'apparaît toujours pas :
    ni score de fiabilité, ni compteur de collaborations, ni nom. Voir la liste
    des trous dans `DECISIONS.md`.
    """
    user = await auth_service.register(
        session, email=email, password=MOT_DE_PASSE, role=UserRole.CREATOR, locale=locale
    )

    fournisseur = FournisseurLocal(handle=handle, followers=followers)

    url = await social_account_service.start_authorization(session, user=user, provider=fournisseur)
    rattachement = await social_account_service.complete_authorization(
        session,
        state=httpx.URL(url).params["state"],
        code=f"code-local-{handle}",
        provider=fournisseur,
    )
    compte = rattachement.compte

    await metrics_service.refresh_profile_metrics(session, account=compte, provider=fournisseur)
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
                email="admin@bind.example",
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
                    ("ocean@bind.example", Locale.EN),
                    ("wynwood@bind.example", Locale.ES),
                    ("brickell@bind.example", Locale.EN),
                    ("havana@bind.example", Locale.ES),
                )
            ]

            totaux = [
                await _ocean_beauty(session, proprietaires[0]),
                await _wynwood_nails(session, proprietaires[1]),
                await _brickell_spa(session, proprietaires[2]),
                await _little_havana(session, proprietaires[3]),
            ]

            # Les créateurs, les parcours, les contreparties et les jobs sont
            # posés par l'enrichissement de démonstration. Il vit à part parce
            # qu'il répond à une autre question : celle-ci pose ce qu'il faut
            # pour éprouver les invariants, celle-là ce qu'il faut pour
            # parcourir le produit sans tomber sur un écran vide.
            demo = await seed_demo.enrichir(session)
            await session.commit()

            # Sur les créateurs réellement en base, pas sur une liste tenue à
            # la main : c'est le seul moyen que le garde-fou porte sur ce que le
            # jeu contient et non sur ce qu'on croit y avoir mis.
            identifiants = list(
                (
                    await session.scalars(sa.select(User.id).where(User.role == UserRole.CREATOR))
                ).all()
            )
            paliers = {
                palier
                for identifiant in identifiants
                for palier in (
                    await eligibility.evaluer_createur(session, identifiant)
                ).paliers_accessibles
            }

        return Resume(
            commerces=len(totaux),
            items=sum(items for items, _, _, _ in totaux),
            plages=sum(plages for _, plages, _, _ in totaux),
            exceptions=sum(exceptions for _, _, exceptions, _ in totaux),
            offres=sum(offres for _, _, _, offres in totaux),
            createurs=demo.createurs,
            reservations=demo.reservations,
            contreparties=demo.contreparties,
            jobs=demo.jobs,
            photos=demo.photos,
            plans=demo.plans,
            abonnements=demo.abonnements,
            paliers_accessibles=len(paliers),
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
        f"{resume.createurs} créateurs, {resume.reservations} réservations, "
        f"{resume.contreparties} contreparties, {resume.jobs} jobs, "
        f"{resume.photos} photos, {resume.plans} plans, {resume.abonnements} abonnements."
    )
    print(f"Mot de passe de tous les comptes : {MOT_DE_PASSE}")

    if resume.paliers_accessibles == 0:
        # Garde-fou, pas constat : depuis que le contrôle de cohérence existe,
        # les trois créateurs accèdent à des paliers. Zéro voudrait dire qu'une
        # régression a refermé le côté créateur, et c'est le genre de chose qui
        # se découvre trois semaines plus tard si personne ne la crie.
        print(
            "Aucun créateur n'accède à un palier : le contrôle de cohérence ne "
            "prononce plus rien. Voir DECISIONS.md."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
