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
import re
import sys
import unicodedata
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
from app.core.age import NAISSANCE_DES_JEUX_DE_DONNEES
from app.core.config import API_ROOT, get_settings
from app.integrations.geocoding import ManualGeocoder
from app.integrations.social import IdentiteSociale, JetonEchange, MetriquesProfil
from app.models import CatalogItem, Tier, User
from app.models.enums import ContentFormat, Locale, Neighborhood, Platform, UserRole
from app.schemas.business import BusinessCreate, BusinessUpdate, CoordinatesPayload
from app.schemas.capacity import CapacityExceptionCreate, CapacityRuleCreate
from app.schemas.catalog import CatalogItemCreate
from app.schemas.tier_offers import TierOfferCreate
from app.seed_demo import ResumePhotos
from app.services import auth as auth_service
from app.services import business as business_service
from app.services import capacity as capacity_service
from app.services import catalog as catalog_service
from app.services import eligibility
from app.services import metrics as metrics_service
from app.services import social_accounts as social_account_service
from app.services import tier_offers as tier_offer_service
from app.services.audit import Actor


async def _declarer_la_couverture(business) -> None:
    """Pose la clé de couverture avant l'activation.

    **La couverture bloque l'activation** depuis que le fil rend une carte par
    salon : un salon sans elle paraissait derrière un dégradé générique. Le
    semis créait ses commerces, les activait, et ne déposait leurs images
    qu'ensuite — donc il se refusait lui-même.

    La clé est déterministe et pointe où `seed_demo` déposera le fichier ; la
    phase des images la réécrit avec ce qu'elle a réellement déposé, vraie photo
    ou dégradé engendré. **Ce n'est pas un contournement de la règle** : un
    salon du semis a bien une couverture, elle arrive simplement en deux temps
    parce que les images se déposent après la base.
    """
    if business.cover_photo_key is None:
        business.cover_photo_key = f"photos/commerces/{business.id}/couverture"


async def _inscrire_verifie(session, **kwargs):
    """Un compte du jeu de démonstration, **adresse confirmée par le vrai chemin**.

    Sans confirmation, aucun de ces comptes ne peut réserver ni mettre son salon
    en ligne : le jeu entier s'arrêterait à la première réservation. Le jeton est
    émis et consommé plutôt que la date posée à la main — un semis qui écrirait
    `email_verified_at` directement produirait le même état sans jamais éprouver
    le mécanisme qui doit le produire.

    **La date de naissance a son défaut ici, et jamais dans `register`.** Le
    portail est requis côté service, sans valeur par défaut : un défaut là-bas
    ouvrirait un chemin de production qui le contourne, et ce serait celui qu'on
    emprunte sans y penser. Ici, il évite de reprendre soixante-trois décors qui
    n'ont rien à dire sur l'âge — et un décor qui veut éprouver le portail passe
    sa propre date, qui l'emporte.
    """
    from app.services import email_verification as _verif

    kwargs.setdefault("date_of_birth", NAISSANCE_DES_JEUX_DE_DONNEES)
    user = await auth_service.register(session, **kwargs)
    jeton = await _verif.emettre(session, user=user)
    await _verif.confirmer(session, jeton=jeton)
    return user


#: Environnements où l'effacement de la base est acceptable. Ailleurs, la
#: commande refuse : elle détruit tout avant d'écrire.
#:
#: **Liste fermée, et `production` n'y sera jamais ajoutée par inadvertance** :
#: un test vérifie son absence, et vérifie aussi qu'un environnement inconnu est
#: refusé — sans quoi la liste protégerait ce qu'elle nomme et rien d'autre.
ENVIRONNEMENTS_AUTORISES = frozenset({"local", "ci", "test", "demo"})

#: Les environnements dont la base est ailleurs que sur la machine qui lance la
#: commande. Pour eux, le nom de l'environnement ne suffit pas.
ENVIRONNEMENTS_DISTANTS = frozenset({"demo"})

#: Ce qui désigne la machine qui lance la commande. Un environnement déclaré
#: distant n'a rien à y faire — et c'est la forme qu'a l'accident : une variable
#: oubliée dans un shell, et la configuration retombe sur le `.env` du poste.
HOTES_LOCAUX = frozenset({"", "localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal"})

#: Mot de passe unique et connu pour tous les comptes du jeu. Il n'a de sens que
#: sur une base jetable, ce que le garde-fou ci-dessus impose.
MOT_DE_PASSE = "orchidee-cuivre-2026"

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
    favoris: int
    fiches: int
    jobs: int
    photos: ResumePhotos
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
# le marché : seize salons de plus
# --------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class SalonDuMarche:
    """Un salon du marché, décrit plutôt que codé.

    **Une table et un semeur, pas seize fonctions.** Les quatre premiers salons
    sont écrits à la main parce qu'ils portent chacun un cas de démonstration —
    variantes profondes, items sans réservation, journée coupée, commerce vierge
    — et que ce cas *est* leur raison d'être. Les seize suivants portent une
    seule chose : le nombre. Les écrire à la main donnerait quatorze cents
    lignes où seuls des noms changeraient, et la première divergence entre deux
    d'entre eux passerait inaperçue.

    **Le catalogue et les offres varient délibérément.** Vingt salons à trois
    prestations et un palier ne font pas un marché : ils font le même salon
    vingt fois. Les tailles vont de deux à six prestations, les paliers couvrent
    les trois formats et les trois plateformes, et les durées vont du quart
    d'heure à deux heures.
    """

    nom: str
    categorie: str
    quartier: Neighborhood
    adresse: str
    longitude: float
    latitude: float
    #: Le numéro de la couverture portrait, dans `couvertures-portrait/`.
    couverture: str
    locale: Locale
    #: `(nom, prix en centimes, durée en minutes ou None[, description])`.
    #:
    #: **Le quatrième membre est facultatif, et c'est délibéré.** La description
    #: est une donnée de commerce : la plupart des salons n'en écrivent pas, et
    #: exiger un `None` sur quarante items pour en décrire cinq ferait du bruit
    #: là où il n'y a rien à dire. Un 3-uplet vaut « pas de description ».
    #:
    #: Elle est dans la langue du salon, comme le nom de la prestation : ce sont
    #: ses mots, pas les nôtres, et le produit ne les traduit pas.
    items: tuple[tuple[str, int, int | None] | tuple[str, int, int | None, str], ...]
    #: `(plateforme, format, index dans `items`)`.
    offres: tuple[tuple[Platform, ContentFormat, int], ...]
    ouverture: tuple[str, str] = ("09:00:00", "19:00:00")
    places: int = 2
    #: L'adresse d'une carte en ligne. Posée sur le restaurant qui laisse un
    #: choix : c'est elle qui rend son offre publiable.
    menu_url: str | None = None
    #: L'index de l'item qui laisse un choix, quand il y en a un.
    laisse_un_choix: int | None = None


def courriel_du_gerant(fiche: "SalonDuMarche") -> str:
    """L'adresse du gérant, dérivée du nom du salon.

    Dérivée plutôt que listée : une seconde liste à tenir à jour finit par
    diverger de la première, et l'écart se voit à la connexion — c'est-à-dire
    au pire moment d'une démonstration. Les accents et la ponctuation tombent,
    le reste devient un identifiant stable.
    """
    sans_accent = unicodedata.normalize("NFKD", fiche.nom).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", sans_accent.lower()).strip("-") + "@bind.example"


MARCHE: tuple[SalonDuMarche, ...] = (
    SalonDuMarche(
        nom="Calle Ocho Barber Co.",
        categorie="beauty",
        quartier=Neighborhood.LITTLE_HAVANA,
        adresse="1642 SW 8th St, Miami, FL 33135",
        longitude=-80.2231,
        latitude=25.7654,
        couverture="05",
        locale=Locale.ES,
        items=(
            ("Corte clásico", 4500, 30),
            ("Corte y barba", 6500, 45, "Corte, arreglo de barba y toalla caliente."),
            ("Afeitado", 3500, 20),
        ),
        offres=(
            (Platform.INSTAGRAM, ContentFormat.STORY, 0),
            (Platform.TIKTOK, ContentFormat.REEL, 1),
        ),
        ouverture=("10:00:00", "20:00:00"),
        places=3,
    ),
    SalonDuMarche(
        nom="Verre Skin Studio",
        categorie="beauty",
        quartier=Neighborhood.DESIGN_DISTRICT,
        adresse="140 NE 39th St, Miami, FL 33137",
        longitude=-80.1937,
        latitude=25.8130,
        couverture="06",
        locale=Locale.EN,
        items=(
            (
                "Signature facial",
                12000,
                60,
                "Cleanse, exfoliation and massage, adjusted to your skin on the day.",
            ),
            ("Deep cleanse", 9000, 45),
            ("LED add-on", 4000, 20),
            ("Peel", 15000, 75),
        ),
        offres=(
            (Platform.INSTAGRAM, ContentFormat.POST, 0),
            (Platform.INSTAGRAM, ContentFormat.STORY, 2),
        ),
    ),
    SalonDuMarche(
        nom="La Mesa Larga",
        categorie="restaurant",
        quartier=Neighborhood.LITTLE_HAITI,
        adresse="5900 NE 2nd Ave, Miami, FL 33137",
        longitude=-80.1930,
        latitude=25.8320,
        couverture="07",
        locale=Locale.ES,
        # **Le seul salon dont une prestation laisse un choix.** Le créateur ne
        # sait pas ce qu'il mangera : sans carte lisible il ne vient pas, et la
        # règle refuse d'ouvrir l'offre. `menu_url` la rend publiable ; le semis
        # des photos y ajoute des pages déposées, pour que les deux formes se
        # voient — l'une n'exclut pas l'autre.
        items=(("Menú del día", 3200, 75), ("Postre del día", 900, 15)),
        offres=((Platform.INSTAGRAM, ContentFormat.REEL, 0),),
        ouverture=("12:00:00", "22:00:00"),
        places=6,
        menu_url="https://lamesalarga.example/carta",
        laisse_un_choix=0,
    ),
    SalonDuMarche(
        nom="Edgewater Coffee House",
        categorie="restaurant",
        quartier=Neighborhood.EDGEWATER,
        adresse="3401 Biscayne Blvd, Miami, FL 33137",
        longitude=-80.1893,
        latitude=25.8072,
        couverture="08",
        locale=Locale.EN,
        items=(
            ("Latte art class", 3500, 45),
            ("Flat white", 500, None),
            ("Cold brew", 600, None),
            ("Affogato", 800, None),
        ),
        offres=((Platform.INSTAGRAM, ContentFormat.STORY, 0),),
        ouverture=("07:00:00", "17:00:00"),
        places=8,
    ),
    SalonDuMarche(
        nom="Panadería del Sol",
        categorie="restaurant",
        quartier=Neighborhood.LITTLE_HAVANA,
        adresse="2306 SW 8th St, Miami, FL 33135",
        longitude=-80.2348,
        latitude=25.7652,
        couverture="09",
        locale=Locale.ES,
        items=(
            ("Taller de pastelería", 5500, 60),
            ("Pastelito de guayaba", 350, None),
            ("Café con leche", 400, None),
        ),
        # **Les deux plateformes.** Avec TikTok seul, ce salon n'apparaissait
        # dans aucun fil de la démonstration : Rebecca n'a qu'Instagram, et un
        # salon que personne ne voit ne démontre rien. Les obstacles de palier
        # sont déjà représentés ailleurs, par des comptes qui les rencontrent.
        offres=(
            (Platform.INSTAGRAM, ContentFormat.STORY, 0),
            (Platform.TIKTOK, ContentFormat.STORY, 1),
        ),
        ouverture=("06:30:00", "15:00:00"),
        places=10,
    ),
    SalonDuMarche(
        nom="Brickell Highball",
        categorie="restaurant",
        quartier=Neighborhood.BRICKELL,
        adresse="900 S Miami Ave, Miami, FL 33130",
        longitude=-80.1932,
        latitude=25.7663,
        couverture="10",
        locale=Locale.EN,
        items=(("Signature cocktail", 1800, None), ("Tasting flight", 3600, 45)),
        offres=(
            (Platform.INSTAGRAM, ContentFormat.REEL, 1),
            (Platform.INSTAGRAM, ContentFormat.POST, 0),
        ),
        ouverture=("17:00:00", "23:30:00"),
        places=4,
    ),
    SalonDuMarche(
        nom="Midtown Brunch Club",
        categorie="restaurant",
        quartier=Neighborhood.MIDTOWN,
        adresse="3252 NE 1st Ave, Miami, FL 33137",
        longitude=-80.1926,
        latitude=25.8058,
        couverture="11",
        locale=Locale.EN,
        items=(
            ("Brunch plate", 2400, 60),
            ("Pancake stack", 1600, 30),
            ("Fresh juice", 700, None),
        ),
        offres=((Platform.INSTAGRAM, ContentFormat.POST, 0),),
        ouverture=("08:00:00", "15:00:00"),
        places=6,
    ),
    SalonDuMarche(
        nom="Wynwood Strength",
        categorie="fitness",
        quartier=Neighborhood.WYNWOOD,
        adresse="250 NW 24th St, Miami, FL 33127",
        longitude=-80.1985,
        latitude=25.7995,
        couverture="12",
        locale=Locale.EN,
        items=(
            ("Drop-in session", 3000, 60, "One class, no membership. Mats and bands provided."),
            (
                "Personal training",
                8000,
                60,
                "One hour with a coach, on your goals. Say what you are training for.",
            ),
            ("Assessment", 5000, 45),
        ),
        offres=(
            (Platform.INSTAGRAM, ContentFormat.REEL, 1),
            (Platform.TIKTOK, ContentFormat.REEL, 0),
        ),
        ouverture=("06:00:00", "21:00:00"),
        places=4,
    ),
    SalonDuMarche(
        nom="Coconut Grove Yoga",
        categorie="fitness",
        quartier=Neighborhood.COCONUT_GROVE,
        adresse="3390 Mary St, Miami, FL 33133",
        longitude=-80.2439,
        latitude=25.7285,
        couverture="13",
        locale=Locale.EN,
        items=(("Vinyasa class", 2500, 75), ("Restorative class", 2200, 60)),
        offres=((Platform.INSTAGRAM, ContentFormat.STORY, 0),),
        ouverture=("07:00:00", "20:00:00"),
        places=12,
    ),
    SalonDuMarche(
        nom="Gables Pilates Room",
        categorie="fitness",
        quartier=Neighborhood.CORAL_GABLES,
        adresse="270 Giralda Ave, Coral Gables, FL 33134",
        longitude=-80.2585,
        latitude=25.7508,
        couverture="14",
        locale=Locale.ES,
        items=(
            ("Reformer privado", 7500, 55),
            ("Clase en grupo", 3200, 55),
            ("Evaluación postural", 4500, 40),
            ("Bono de tres clases", 8800, 55),
        ),
        offres=(
            (Platform.INSTAGRAM, ContentFormat.POST, 1),
            (Platform.INSTAGRAM, ContentFormat.REEL, 0),
        ),
        places=3,
    ),
    SalonDuMarche(
        nom="Galería Sur",
        categorie="museum",
        quartier=Neighborhood.LITTLE_HAITI,
        adresse="7218 NW 2nd Ave, Miami, FL 33150",
        longitude=-80.2003,
        latitude=25.8420,
        couverture="15",
        locale=Locale.ES,
        items=(
            (
                "Visita guiada",
                1500,
                60,
                "Una hora por la colección con alguien del equipo. Grupos de seis como máximo.",
            ),
            ("Entrada general", 900, None),
        ),
        offres=((Platform.INSTAGRAM, ContentFormat.POST, 0),),
        ouverture=("11:00:00", "19:00:00"),
        places=15,
    ),
    SalonDuMarche(
        nom="Clay & Co. Studio",
        categorie="family_activity",
        quartier=Neighborhood.DESIGN_DISTRICT,
        adresse="4141 NE 2nd Ave, Miami, FL 33137",
        longitude=-80.1928,
        latitude=25.8155,
        couverture="16",
        locale=Locale.EN,
        items=(
            ("Wheel throwing", 6500, 120),
            ("Hand-building class", 4500, 90),
            ("Open studio hour", 2000, 60),
        ),
        offres=((Platform.INSTAGRAM, ContentFormat.REEL, 0),),
        ouverture=("10:00:00", "20:00:00"),
    ),
    SalonDuMarche(
        nom="Bayside Play Loft",
        categorie="family_activity",
        quartier=Neighborhood.EDGEWATER,
        adresse="601 NE 36th St, Miami, FL 33137",
        longitude=-80.1873,
        latitude=25.8098,
        couverture="17",
        locale=Locale.EN,
        items=(("Birthday hour", 12000, 90), ("Day pass", 2200, None)),
        offres=((Platform.INSTAGRAM, ContentFormat.STORY, 0),),
        ouverture=("09:30:00", "18:30:00"),
        places=20,
    ),
    SalonDuMarche(
        nom="Objet Concept Store",
        categorie="other",
        quartier=Neighborhood.MIDTOWN,
        adresse="3401 N Miami Ave, Miami, FL 33127",
        longitude=-80.1958,
        latitude=25.8078,
        couverture="18",
        locale=Locale.EN,
        items=(
            ("Styling session", 5000, 45),
            ("Gift wrapping", 800, 15),
            ("Personal shopping", 9000, 90),
            ("Scent bar", 3000, 30),
            ("Alteration", 2500, 30),
        ),
        offres=(
            (Platform.INSTAGRAM, ContentFormat.POST, 0),
            (Platform.INSTAGRAM, ContentFormat.STORY, 3),
        ),
        ouverture=("11:00:00", "20:00:00"),
    ),
    SalonDuMarche(
        nom="Fleur de Biscayne",
        categorie="other",
        quartier=Neighborhood.SOUTH_BEACH,
        adresse="1656 Meridian Ave, Miami Beach, FL 33139",
        longitude=-80.1372,
        latitude=25.7906,
        couverture="19",
        locale=Locale.EN,
        items=(("Seasonal bouquet", 4500, 20), ("Arrangement workshop", 7500, 90)),
        offres=((Platform.INSTAGRAM, ContentFormat.POST, 0),),
        ouverture=("09:00:00", "19:00:00"),
    ),
    SalonDuMarche(
        nom="Librería Aurora",
        categorie="other",
        quartier=Neighborhood.CORAL_GABLES,
        adresse="265 Aragon Ave, Coral Gables, FL 33134",
        longitude=-80.2591,
        latitude=25.7495,
        couverture="20",
        locale=Locale.ES,
        items=(
            ("Club de lectura", 1200, 90),
            ("Recomendación personal", 0, 20),
            ("Café y libro", 1500, None),
            ("Firma de autor", 0, 60),
            ("Taller de escritura", 5500, 120),
            ("Envoltura de regalo", 600, 10),
        ),
        # L'offre Instagram porte un item **réservable** : elle portait « Café
        # y libro », qui n'a pas de durée, donc aucune place — le salon
        # n'apparaissait dans aucune journée et le semis écartait sa
        # réservation.
        offres=(
            (Platform.INSTAGRAM, ContentFormat.STORY, 0),
            (Platform.TIKTOK, ContentFormat.STORY, 2),
        ),
        ouverture=("10:00:00", "21:00:00"),
        places=10,
    ),
)


async def _semer_un_salon(
    session: AsyncSession, owner: User, fiche: SalonDuMarche
) -> tuple[int, int, int, int]:
    """Un salon du marché, de sa création à son activation.

    Ouvert **tous les jours** sur une seule plage : un jeu de données ne peut
    pas dépendre du jour où on le sème, et la journée coupée reste la
    particularité d'Ocean Beauty plutôt qu'un motif recopié seize fois.
    """
    business = await business_service.create_business(
        session,
        payload=BusinessCreate(
            name=fiche.nom,
            category=fiche.categorie,
            currency="usd",
            address=fiche.adresse,
            neighborhood=fiche.quartier,
            coordinates=CoordinatesPayload(longitude=fiche.longitude, latitude=fiche.latitude),
            timezone="America/New_York",
            default_locale=fiche.locale,
            menu_url=fiche.menu_url,
        ),
        creator=owner,
        geocoder=ManualGeocoder(),
    )

    items: list[CatalogItem] = []
    for rang, item in enumerate(fiche.items):
        nom, prix, duree, *reste = item
        items.append(
            await catalog_service.create_item(
                session,
                business=business,
                payload=CatalogItemCreate(
                    name=nom,
                    description=reste[0] if reste else None,
                    price_cents=prix,
                    duration_minutes=duree,
                    requires_booking=duree is not None,
                    leaves_choice=rang == fiche.laisse_un_choix,
                ),
            )
        )

    plages = 0
    debut, fin = fiche.ouverture
    for jour in range(7):
        await capacity_service.create_rule(
            session,
            business_id=business.id,
            payload=CapacityRuleCreate(
                weekday=jour, start_time=debut, end_time=fin, concurrent_slots=fiche.places
            ),
        )
        plages += 1

    offres = await _offrir(
        session,
        business.id,
        [(plateforme, format_, items[rang]) for plateforme, format_, rang in fiche.offres],
    )

    await _declarer_la_couverture(business)
    await business_service.activate_business(
        session, business=business, actor=Actor.from_user(owner)
    )
    return len(items), plages, 0, offres


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
            neighborhood=Neighborhood.SOUTH_BEACH,
            coordinates=CoordinatesPayload(longitude=-80.1300, latitude=25.7825),
            timezone="America/New_York",
            default_locale=Locale.EN,
            phone="+13055550111",
        ),
        creator=owner,
        geocoder=ManualGeocoder(),
    )

    # **Les liens publics, posés par le service qui les écrit.** Les quatre
    # colonnes existaient, la carte de réservation et la fiche du salon les
    # rendent depuis toujours, et **aucun salon du jeu n'en portait un seul** :
    # le bloc se taisait partout, sur les quatre onglets comme sur la fiche, et
    # se lisait comme un écran incomplet. Trois salons, trois compositions
    # différentes, pour que les variantes du composant se voient.
    await business_service.update_business(
        session,
        business=business,
        payload=BusinessUpdate(
            instagram_url="https://www.instagram.com/oceanbeautystudio",
            instagram_handle="@oceanbeautystudio",
            tiktok_url="https://www.tiktok.com/@oceanbeauty",
            website_url="https://oceanbeautystudio.example",
        ),
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

    # **Ouvert tous les jours.** Le salon fermait du dimanche au lundi : semé un
    # lundi, il n'avait aucune place, l'écran « Aujourd'hui » disait « rien de
    # réservé » et la caisse — atteignable seulement depuis une ligne de la
    # journée — devenait inaccessible. Un jeu de démonstration ne peut pas
    # dépendre du jour où on le sème. La journée coupée à midi, elle, reste :
    # c'est ce qui distingue ce salon, et elle vaut tous les jours.
    plages = 0
    for jour in (LUNDI, MARDI, MERCREDI, JEUDI, VENDREDI, SAMEDI, DIMANCHE):
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

    await _declarer_la_couverture(business)
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
            neighborhood=Neighborhood.WYNWOOD,
            coordinates=CoordinatesPayload(longitude=-80.1990, latitude=25.7990),
            timezone="America/New_York",
            default_locale=Locale.ES,
            phone="+13055550122",
        ),
        creator=owner,
        geocoder=ManualGeocoder(),
    )

    # **Les liens publics, posés par le service qui les écrit.** Les quatre
    # colonnes existaient, la carte de réservation et la fiche du salon les
    # rendent depuis toujours, et **aucun salon du jeu n'en portait un seul** :
    # le bloc se taisait partout, sur les quatre onglets comme sur la fiche, et
    # se lisait comme un écran incomplet. Trois salons, trois compositions
    # différentes, pour que les variantes du composant se voient.
    await business_service.update_business(
        session,
        business=business,
        payload=BusinessUpdate(
            instagram_url="https://www.instagram.com/wynwoodnails",
            instagram_handle="@wynwoodnails",
        ),
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

    # Tous les jours, même raison : un salon fermé le jour du semis vide la
    # journée du comptoir et enterre la caisse avec elle.
    plages = 0
    for jour in (LUNDI, MARDI, MERCREDI, JEUDI, VENDREDI, SAMEDI, DIMANCHE):
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

    await _declarer_la_couverture(business)
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
            neighborhood=Neighborhood.BRICKELL,
            coordinates=CoordinatesPayload(longitude=-80.1918, latitude=25.7600),
            timezone="America/New_York",
            default_locale=Locale.EN,
            phone="+13055550133",
        ),
        creator=owner,
        geocoder=ManualGeocoder(),
    )

    # **Les liens publics, posés par le service qui les écrit.** Les quatre
    # colonnes existaient, la carte de réservation et la fiche du salon les
    # rendent depuis toujours, et **aucun salon du jeu n'en portait un seul** :
    # le bloc se taisait partout, sur les quatre onglets comme sur la fiche, et
    # se lisait comme un écran incomplet. Trois salons, trois compositions
    # différentes, pour que les variantes du composant se voient.
    await business_service.update_business(
        session,
        business=business,
        payload=BusinessUpdate(
            instagram_url="https://www.instagram.com/brickellspa",
            instagram_handle="@brickellspa",
            facebook_url="https://www.facebook.com/brickellspacollective",
        ),
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

    await _declarer_la_couverture(business)
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
            neighborhood=Neighborhood.LITTLE_HAVANA,
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
            avatar_url=None,
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
    user = await _inscrire_verifie(
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
            await _inscrire_verifie(
                session,
                email="admin@bind.example",
                password=MOT_DE_PASSE,
                role=UserRole.ADMIN,
                locale=Locale.EN,
            )

            proprietaires = [
                await _inscrire_verifie(
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

            # **Le marché.** Seize salons de plus, un propriétaire chacun :
            # partager un compte entre plusieurs commerces ferait de la
            # démonstration un cas que le produit ne connaît pas encore.
            for fiche in MARCHE:
                gerant = await _inscrire_verifie(
                    session,
                    email=courriel_du_gerant(fiche),
                    password=MOT_DE_PASSE,
                    role=UserRole.BUSINESS_MEMBER,
                    locale=fiche.locale,
                )
                totaux.append(await _semer_un_salon(session, gerant, fiche))

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
            favoris=demo.favoris,
            fiches=demo.fiches,
            jobs=demo.jobs,
            photos=demo.photos,
            plans=demo.plans,
            abonnements=demo.abonnements,
            paliers_accessibles=len(paliers),
        )
    finally:
        await engine.dispose()


def verifier_l_hote(settings) -> None:
    """Ce qui se vérifie avant **toute** écriture, migration comprise.

    Séparé du reste parce qu'il s'applique plus tôt : migrer une base ne la
    détruit pas, mais migrer *la mauvaise* base reste une écriture, et un
    environnement déclaré distant qui vise la machine locale est une
    contradiction quoi qu'on s'apprête à faire.
    """
    if settings.environment not in ENVIRONNEMENTS_DISTANTS:
        return

    hote = make_url(str(settings.database_url)).host or ""
    if hote in HOTES_LOCAUX:
        raise SeedRefused(
            f"environnement « {settings.environment} » déclaré distant, mais la "
            f"base visée est sur « {hote or 'aucun hôte'} » : c'est la base "
            "de développement. Rien n'a été touché."
        )


def verifier_la_cible(settings) -> None:
    """Deux conditions, toutes deux nécessaires, avant d'effacer quoi que ce soit.

    **Le nom de l'environnement.** Il dit ce que la configuration prétend être.
    C'est nécessaire et ce n'est pas suffisant : une variable mal posée suffit à
    faire passer une base pour ce qu'elle n'est pas, et cette commande détruit
    tout avant d'écrire.

    **L'hôte.** Un environnement déclaré distant qui vise `localhost` est une
    contradiction, et c'est la forme qu'a l'accident : une variable d'
    environnement oubliée dans un shell, et la commande retombe sur le `.env`
    du poste — donc sur la base de développement. Elle refuse.

    **Le nom de la base.** Sur un environnement distant, la commande exige que
    `SEED_DATABASE_NAME` soit posé **et** corresponde à la base réellement
    visée. Viser une autre base demande alors deux gestes délibérés — mentir sur
    l'environnement, puis nommer la base à détruire — au lieu d'un seul oubli.

    Le nom seul ne suffirait pas : celui de Supabase est `postgres`, le plus
    répandu qui soit, et une base locale portant ce nom passerait la
    comparaison. C'est l'hôte qui écarte ce cas, et le nom qui écarte de viser
    une autre base distante.

    Le jour où `production` existera, elle n'est ni dans la liste des
    environnements, ni dans celle des distants : l'ouverture faite ici pour la
    démonstration ne l'englobe pas d'avance.
    """
    if settings.environment not in ENVIRONNEMENTS_AUTORISES:
        raise SeedRefused(
            f"environnement « {settings.environment} » : la commande efface la base "
            f"avant d'écrire, elle ne tourne que sur {sorted(ENVIRONNEMENTS_AUTORISES)}"
        )

    if settings.environment not in ENVIRONNEMENTS_DISTANTS:
        return

    verifier_l_hote(settings)
    cible = make_url(str(settings.database_url)).database

    if not settings.seed_database_name:
        raise SeedRefused(
            f"environnement « {settings.environment} » : la base est distante, "
            "SEED_DATABASE_NAME doit nommer explicitement celle qu'on accepte "
            f"de détruire (ici : « {cible} »)"
        )

    if cible != settings.seed_database_name:
        raise SeedRefused(
            f"la commande vise « {cible} » et SEED_DATABASE_NAME nomme "
            f"« {settings.seed_database_name} » : refus d'effacer une base qui "
            "n'est pas celle qu'on a déclarée"
        )


def annoncer_les_photos(photos: ResumePhotos) -> None:
    """Ce qui a été rangé, et surtout ce qui manque — **nommément**.

    Les photos arrivent par vagues, et un « 6 photos générées » n'apprend pas
    lesquelles aller chercher : il faut les chemins, dans la forme exacte où ils
    s'écrivent dans `assets/photos/A-FOURNIR.md`, prêts à être comparés à ce
    qu'on a déjà déposé.
    """
    print(f"Photos : {photos.reelles} fournies, {photos.generees} générées faute de fichier.")

    if photos.manquantes:
        print("Fichiers absents de assets/photos/ (un dégradé les remplace) :")
        for chemin in photos.manquantes:
            print(f"  - {chemin}")

    if photos.trop_lourds:
        # Ni un refus ni une erreur : ce qui est rangé s'affiche. Mais un média
        # de quarante mégaoctets sur un réseau mobile laisse l'écran vide le
        # temps du téléchargement, et rien d'autre ne le ferait remarquer avant
        # une démonstration au ralenti devant quelqu'un.
        print("Médias lourds, à réduire avant une démonstration sur réseau mobile :")
        for chemin, poids in photos.trop_lourds:
            print(f"  - {chemin} : {poids / 1024 / 1024:.0f} Mo")

    if photos.sans_redimensionnement:
        # Le semis a marché, mais il a rangé des originaux de plusieurs
        # mégaoctets. Le dire : servir ça à un fil mobile est précisément ce
        # que le redimensionnement évite, et rien d'autre ne le signalerait.
        print(
            "Pillow n'est pas installé : les photos ont été déposées telles quelles, "
            "sans être réduites. `pip install -e '.[dev]'` pour y remédier."
        )


def main() -> int:
    settings = get_settings()

    verifier_la_cible(settings)

    reset_schema()
    resume = asyncio.run(populate())

    print(
        f"{resume.commerces} commerces, {resume.items} items, {resume.plages} plages, "
        f"{resume.exceptions} exceptions, {resume.offres} offres, "
        f"{resume.createurs} créateurs, {resume.reservations} réservations, "
        f"{resume.contreparties} contreparties, {resume.favoris} favoris, "
        f"{resume.fiches} fiches de terrain, {resume.jobs} jobs, "
        f"{resume.photos.total} photos, {resume.plans} plans, {resume.abonnements} abonnements."
    )
    print(f"Mot de passe de tous les comptes : {MOT_DE_PASSE}")

    annoncer_les_photos(resume.photos)

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
