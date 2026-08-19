"""Enrichissement de démonstration : les états que le jeu de base ne produit pas.

Le jeu de départ pose trois commerces et trois créateurs. Il suffit à éprouver
les invariants, pas à parcourir le produit : tout écran de contrepartie y est
vide, le back office n'a rien à arbitrer, et aucun commerce ne sait ce que sa
participation lui a rapporté.

**Rien n'est posé à la main.** Chaque état est obtenu en appelant le service qui
le produit — réserver, confirmer, consommer, soumettre, contrôler. C'est la
règle du jeu de données depuis le premier jour, et c'est ce qui distingue une
démonstration d'une mise en scène : ce qu'on montre est ce que le produit fait.

Les rares exceptions sont **nommées** et portent leur raison : reculer un
horodatage pour qu'une échéance soit dépassée, ou vieillir un relevé pour
produire un compte périmé. Aucun service ne sait remonter le temps, et le seul
autre moyen serait d'attendre.

**Les dates sont relatives à aujourd'hui.** Un jeu figé au 3 août montre des
réservations passées en octobre, et la démonstration commence par une
explication.
"""

import re
import unicodedata
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

import httpx
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations import photos_reelles
from app.integrations.demo_images import COUVERTURE, PRESTATION, image
from app.integrations.object_store import get_object_store
from app.integrations.social_demo import DemoSocialProvider
from app.models import (
    Booking,
    Business,
    BusinessMember,
    CatalogItem,
    Collaboration,
    Job,
    SocialAccount,
    SocialMetricsSnapshot,
    SubscriptionPlan,
    Tier,
    TierOffer,
    User,
)
from app.models.enums import (
    BillingInterval,
    BookingStatus,
    BusinessCategory,
    BusinessStatus,
    JobStatus,
    JobType,
    Locale,
    Platform,
    SocialAccountStatus,
    UserRole,
    VerificationStatus,
)
from app.schemas.collaboration import MotifDeDecision
from app.services import auth as auth_service
from app.services import availability as availability_service
from app.services import booking as booking_service
from app.services import booking_states, business_menu, eligibility
from app.services import collaboration as collaboration_service
from app.services import creator_profile as profile_service
from app.services import metrics as metrics_service
from app.services import platform_assets as platform_asset_service
from app.services import proof as proof_service
from app.services import redemption as redemption_service
from app.services import reliability as reliability_service
from app.services import social_accounts as social_account_service
from app.services.audit import Actor
from app.services.storage import archiver_la_publication


async def _inscrire_verifie(session, **kwargs):
    """Un compte du jeu de démonstration, **adresse confirmée par le vrai chemin**.

    Sans confirmation, aucun de ces comptes ne peut réserver ni mettre son salon
    en ligne : le jeu entier s'arrêterait à la première réservation. Le jeton est
    émis et consommé plutôt que la date posée à la main — un semis qui écrirait
    `email_verified_at` directement produirait le même état sans jamais éprouver
    le mécanisme qui doit le produire.
    """
    from app.services import email_verification as _verif

    user = await auth_service.register(session, **kwargs)
    jeton = await _verif.emettre(session, user=user)
    await _verif.confirmer(session, jeton=jeton)
    return user


MOT_DE_PASSE = "orchidee-cuivre-2026"


@dataclass(frozen=True, slots=True)
class ResumeDemo:
    createurs: int
    reservations: int
    contreparties: int
    jobs: int
    photos: "ResumePhotos"
    plans: int
    abonnements: int


# --------------------------------------------------------------------------
# photos
# --------------------------------------------------------------------------


#: Le dossier de chaque commerce sous `assets/photos/commerces/`.
#:
#: Une table explicite, et non un `slugify` du nom. « Massage relaxant 60 min »
#: donnerait `massage-relaxant-60-min` là où le fichier demandé s'appelle
#: `massage-relaxant-60`, et « Wynwood Nails & Care » dépend de ce qu'on décide
#: de faire d'une esperluette. Une règle implicite qui se trompe range la photo
#: sous un nom que personne n'a déposé, et le semis annonce un fichier manquant
#: qui est pourtant là — le pire des symptômes, puisqu'il accuse l'humain.
#:
#: `Havana Glow` est **absent volontairement** : c'est le commerce qui n'a rien
#: composé, il ne doit avoir aucune photo.
#: Les trois salons qui ont composé quelque chose. `Havana Glow` n'en est pas,
#: et c'est délibéré : il porte le cas « zéro historique », celui de tout salon
#: qui vient de s'inscrire. Un jeu de données où chaque écran est plein ne
#: laisse jamais voir ce que voit un nouveau venu.
OCEAN = "Ocean Beauty Studio"
WYNWOOD = "Wynwood Nails & Care"
BRICKELL = "Brickell Spa Collective"

DOSSIER_DU_COMMERCE = {
    "Ocean Beauty Studio": "ocean-beauty-studio",
    "Wynwood Nails & Care": "wynwood-nails-care",
    "Brickell Spa Collective": "brickell-spa-collective",
}

#: La couverture **verticale** de chaque salon, dans `couvertures-portrait/`.
#:
#: **Dérivée du marché, pas recopiée.** Les seize salons du marché portent leur
#: numéro de couverture dans leur fiche ; le lire là plutôt que de tenir une
#: seconde liste évite qu'un salon renommé garde la photo d'un autre. Les trois
#: salons écrits à la main sont nommés ici parce qu'ils n'ont pas de fiche.
#:
#: `04` — le salon de beauté — n'est attribué à personne : il est réservé à
#: Havana Glow, qui reste vierge et n'apparaît donc dans aucun fil. Il attend le
#: jour où elle composera quelque chose.
#: Les trois salons écrits à la main. Les seize du marché portent leur numéro
#: dans leur propre fiche, et `couverture_portrait_du_commerce` les y lit.
COUVERTURE_PORTRAIT_ECRITE_A_LA_MAIN = {
    "Wynwood Nails & Care": "01",
    "Ocean Beauty Studio": "02",
    "Brickell Spa Collective": "03",
}


def _dossier_derive(nom: str) -> str:
    """Le dossier de photos d'un salon, tiré de son nom."""
    sans_accent = unicodedata.normalize("NFKD", nom).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", sans_accent.lower()).strip("-")


def couverture_portrait_du_commerce() -> dict[str, str]:
    """Le numéro de couverture verticale de chaque salon, nom par nom.

    **L'import est différé, et c'est le cycle qui l'impose** : `seed` importe
    `ResumePhotos` d'ici, donc ce module ne peut pas importer `seed` en tête de
    fichier. Le faire à l'appel est la façon la plus courte de le rompre, et
    elle vaut mieux que de recopier les seize numéros — une seconde liste
    finirait par donner à un salon renommé la photo d'un autre.
    """
    from app.seed import MARCHE

    return COUVERTURE_PORTRAIT_ECRITE_A_LA_MAIN | {fiche.nom: fiche.couverture for fiche in MARCHE}


#: Le fichier de chaque prestation, dans le dossier `prestations/` de son
#: commerce. Le parent d'une gamme n'y figure pas : il ne s'affiche jamais seul.
FICHIER_DE_LA_PRESTATION = {
    "Coloration racines": "coloration-racines",
    "Coloration longueurs": "coloration-longueurs",
    "Coloration + balayage": "coloration-balayage",
    "Brushing": "brushing",
    "Manucure classique": "manucure-classique",
    "Pose gel": "pose-gel",
    "Vernis semi-permanent à emporter": "vernis-semi-permanent-a-emporter",
    "Diagnostic ongles": "diagnostic-ongles",
    "Massage relaxant 60 min": "massage-relaxant-60",
    "Massage profond 90 min": "massage-profond-90",
    "Soin visage hydratant": "soin-visage-hydratant",
    "Rituel duo": "rituel-duo",
}


@dataclass(frozen=True, slots=True)
class ResumePhotos:
    """Ce que le semis a rangé, et ce qu'il n'a pas trouvé.

    Le décompte seul ne sert à rien quand les photos arrivent par vagues : il
    faut les **chemins** de celles qui manquent, tels qu'ils s'écrivent dans
    `A-FOURNIR.md`, pour savoir quoi aller chercher.
    """

    reelles: int
    generees: int
    #: Chemins relatifs à `assets/photos/`, triés, prêts à être lus par un humain.
    manquantes: tuple[str, ...]
    #: Vrai quand Pillow n'est pas installé : les originaux sont déposés tels
    #: quels, plusieurs mégaoctets compris.
    sans_redimensionnement: bool
    #: Ce qui a été rangé au-delà de `SEUIL_DE_POIDS`, avec son poids en octets.
    trop_lourds: tuple[tuple[str, int], ...]

    @property
    def total(self) -> int:
        return self.reelles + self.generees


#: Au-delà, un média est signalé. Une couverture réduite pèse 150 Ko et une
#: pastille 30 Ko : ce seuil ne peut être franchi que par ce que le semis ne
#: sait pas réduire — la vidéo d'accueil — ou par des originaux déposés faute
#: de Pillow.
#:
#: Il ne refuse rien : le semis ne s'arrête jamais pour une question de poids,
#: il le dit. Trois mégaoctets se chargent sur un réseau mobile, quarante non,
#: et rien d'autre ne le ferait remarquer avant une démonstration au ralenti.
SEUIL_DE_POIDS = 8 * 1024 * 1024


async def _deposer_photo(
    depot,
    *,
    chemin: str,
    taille_reelle: tuple[int, int],
    graine: str,
    taille_generee: tuple[int, int],
    famille: str,
) -> tuple[str, bool, int]:
    """La vraie photo si elle est là, un dégradé sinon. Rend la clé, laquelle, et le poids.

    **Le préfixe porte la nature du contenu.** `photos/genere/business/…` pour
    un dégradé, `photos/business/…` pour une vraie photo. La clé étant renvoyée
    telle quelle par l'API, un commerce qui n'a pas fourni sa couverture se
    reconnaît dans n'importe quelle réponse, sans qu'aucun écran ait à porter
    un repère de développement qu'on oublierait d'enlever.
    """
    reelle = photos_reelles.lire(chemin, taille=taille_reelle)
    if reelle is not None:
        cle = await depot.deposer(reelle.contenu, prefixe=f"photos/{famille}")
        return cle, True, len(reelle.contenu)

    degrade = image(graine, taille_generee)
    cle = await depot.deposer(degrade, prefixe=f"photos/genere/{famille}")
    return cle, False, len(degrade)


async def poser_les_photos(session: AsyncSession) -> ResumePhotos:
    """Les photos de tout le jeu : commerces, prestations, catégories, accueil.

    Les vraies photos vivent dans `assets/photos/`, hors du dépôt git, et
    peuvent manquer — sur l'intégration continue elles manquent toujours. Le
    semis ne s'arrête donc jamais pour ça : il retombe sur un dégradé généré et
    dit lesquelles il n'a pas trouvées.

    Le parent d'une gamme ne reçoit pas de photo : il ne s'affiche jamais seul,
    et lui en donner une ferait apparaître une image que personne ne voit.

    Un commerce encore en inscription n'en reçoit pas non plus, et c'est la
    raison d'être du seul qui soit dans cet état : il montre ce qu'on voit le
    jour où l'on s'inscrit. Lui poser une couverture le rendait présentable, et
    l'écran d'activation n'avait plus rien à réclamer — alors que « ouvert mais
    invisible faute de photo » est précisément l'état qu'il doit expliquer.
    """
    depot = get_object_store()
    reelles = 0
    generees = 0
    manquantes: list[str] = []
    trop_lourds: list[tuple[str, int]] = []

    def compter(trouvee: bool, chemin: str, poids: int) -> None:
        nonlocal reelles, generees
        if trouvee:
            reelles += 1
        else:
            generees += 1
            manquantes.append(chemin)
        if poids > SEUIL_DE_POIDS:
            trop_lourds.append((chemin, poids))

    # --- couvertures des commerces ouverts
    portraits = couverture_portrait_du_commerce()
    actifs = await session.scalars(
        sa.select(Business).where(Business.status == BusinessStatus.ACTIVE)
    )
    for business in actifs.all():
        # **Dérivé quand il n'est pas nommé.** Les trois salons écrits à la main
        # ont leur dossier ; les seize du marché n'en ont pas, et leur en
        # inventer un à la main serait seize lignes à tenir d'accord avec seize
        # noms. Le chemin dérivé rejoint le mécanisme qui existe déjà : le
        # fichier absent devient un dégradé, et `A-FOURNIR.md` le réclame.
        dossier = DOSSIER_DU_COMMERCE.get(business.name) or _dossier_derive(business.name)
        chemin = f"commerces/{dossier}/cover.jpg"
        business.cover_photo_key, trouvee, poids = await _deposer_photo(
            depot,
            chemin=chemin,
            taille_reelle=photos_reelles.COUVERTURE,
            graine=business.name,
            taille_generee=COUVERTURE,
            famille="business",
        )
        compter(trouvee, chemin, poids)

        # --- la couverture verticale, pour le mur du fil
        #
        # **Un champ à part, et un fichier à part.** Le mur donne à un salon
        # toute la hauteur de l'écran : un 16:9 recadré n'y donne rien. Le
        # dépôt borne le grand côté à 2000, donc un 1600 × 2000 traverse sans
        # rien perdre. Un salon sans couverture verticale garde la sienne en
        # paysage — c'est l'app qui retombe dessus.
        numero = portraits.get(business.name)
        if numero is not None:
            portrait = f"couvertures-portrait/{numero}.jpg"
            business.cover_portrait_key, trouvee, poids = await _deposer_photo(
                depot,
                chemin=portrait,
                taille_reelle=photos_reelles.COUVERTURE_PORTRAIT,
                graine=f"{business.name}-portrait",
                taille_generee=COUVERTURE,
                famille="business",
            )
            compter(trouvee, portrait, poids)

    # --- la carte du restaurant qui laisse un choix
    #
    # **Le lien et les pages, ensemble.** `menu_url` suffit à rendre l'offre
    # publiable — c'est ce qui la rend publiable au semis, avant que la moindre
    # image existe. Les pages déposées montrent l'autre forme : un commerce peut
    # avoir les deux, et la fiche publique doit savoir les présenter. Sans elles,
    # ce mécanisme n'aurait aucun sujet dans la démonstration.
    a_choix = await session.scalar(sa.select(Business).where(Business.name == "La Mesa Larga"))
    if a_choix is not None:
        for page in (1, 2):
            chemin = f"cartes/la-mesa-larga/{page}.jpg"
            cle, trouvee, poids = await _deposer_photo(
                depot,
                chemin=chemin,
                taille_reelle=photos_reelles.PAGE_DE_CARTE,
                graine=f"carte-la-mesa-larga-{page}",
                taille_generee=PRESTATION,
                famille="cartes",
            )
            await business_menu.ajouter(session, business_id=a_choix.id, storage_key=cle)
            compter(trouvee, chemin, poids)

    # --- prestations
    #
    # Toutes celles qui s'affichent, et pas seulement les réservables : le
    # vernis à emporter de Wynwood est proposé au palier TikTok, il apparaît
    # donc dans le fil comme une autre. Seul le parent d'une gamme est écarté,
    # et il l'est par ce qu'il est — un item qui a des variantes — plutôt que
    # par un nom cité en dur.
    parents = sa.select(CatalogItem.parent_item_id).where(CatalogItem.parent_item_id.is_not(None))
    items = (
        await session.scalars(sa.select(CatalogItem).where(CatalogItem.id.not_in(parents)))
    ).all()
    for item in items:
        # **Un nom inconnu se dit, il ne fait pas tomber le semis.** Les deux
        # tables sont explicites, donc incomplètes par construction : composer
        # une prestation pour un commerce qui n'y figure pas — ce qui arrive au
        # premier salon ajouté — levait un `KeyError` au milieu du semis, sans
        # rien dire de ce qui manquait. C'est l'inverse de la règle que ce
        # module s'est donnée : il **annonce** ce qu'il écarte. Le fichier est
        # alors compté comme manquant, et le résumé le nomme.
        nom = await session.scalar(sa.select(Business.name).where(Business.id == item.business_id))
        dossier = DOSSIER_DU_COMMERCE.get(nom)
        fichier = FICHIER_DE_LA_PRESTATION.get(item.name)
        # **Un chemin dérivé plutôt qu'un item sans photo.** On passait notre
        # tour quand le nom n'était pas au catalogue des fichiers : l'item
        # partait alors dans le fil sans image du tout, et une carte sans image
        # se lit comme une carte qui n'a pas chargé. Les seize salons du marché
        # en ont fait vingt-huit d'un coup.
        #
        # Le chemin dérivé rejoint le mécanisme qui existe : le fichier absent
        # devient un dégradé, et `A-FOURNIR.md` le réclame nommément.
        dossier = dossier or _dossier_derive(nom)
        fichier = fichier or _dossier_derive(item.name)
        chemin = f"commerces/{dossier}/prestations/{fichier}.jpg"
        item.photo_key, trouvee, poids = await _deposer_photo(
            depot,
            chemin=chemin,
            taille_reelle=photos_reelles.PRESTATION,
            graine=item.name,
            taille_generee=PRESTATION,
            famille="item",
        )
        compter(trouvee, chemin, poids)

    # --- pastilles de catégorie
    #
    # Elles n'appartiennent à aucun commerce : leur clé se range dans
    # `platform_asset`, la seule table qui porte ce qui est à la plateforme.
    for categorie in BusinessCategory:
        chemin = f"categories/{categorie.value}.jpg"
        cle, trouvee, poids = await _deposer_photo(
            depot,
            chemin=chemin,
            taille_reelle=photos_reelles.CATEGORIE,
            graine=f"categorie-{categorie.value}",
            taille_generee=PRESTATION,
            famille="category",
        )
        await platform_asset_service.poser(
            session, slug=platform_asset_service.slug_de_categorie(categorie), object_key=cle
        )
        compter(trouvee, chemin, poids)

    # --- accueil, deux orientations
    #
    # L'écran d'accueil est en plein écran : une vidéo paysage sur un téléphone
    # tenu droit ne peut donner que des bandes noires ou un recadrage qui coupe
    # le sujet. Chaque orientation a donc la sienne, et son affiche — une
    # affiche 16:9 sous une vidéo 9:16 recadre au chargement, puis la vidéo
    # démarre sur un autre cadrage, et le saut se voit.
    #
    # Les affiches suivent le chemin des photos, redimensionnées comme elles.
    # Les vidéos se déposent telles quelles : les réencoder demanderait
    # `ffmpeg`, d'un autre ordre que Pillow pour deux fichiers.
    for chemin_affiche, slug, taille in (
        (
            "accueil/video-poster.jpg",
            platform_asset_service.AFFICHE_VIDEO,
            photos_reelles.COUVERTURE,
        ),
        (
            "accueil/video-portrait-poster.jpg",
            platform_asset_service.AFFICHE_PORTRAIT,
            photos_reelles.AFFICHE_PORTRAIT,
        ),
    ):
        cle, trouvee, poids = await _deposer_photo(
            depot,
            chemin=chemin_affiche,
            taille_reelle=taille,
            graine=f"accueil-{slug}",
            taille_generee=COUVERTURE,
            famille="home",
        )
        await platform_asset_service.poser(session, slug=slug, object_key=cle)
        compter(trouvee, chemin_affiche, poids)

    for chemin_video, slug in (
        ("accueil/video.mp4", platform_asset_service.VIDEO),
        ("accueil/video-portrait.mp4", platform_asset_service.VIDEO_PORTRAIT),
    ):
        video = photos_reelles.lire_telle_quelle(chemin_video)
        if video is None:
            # Aucune clé posée : l'app n'a pas cette orientation à jouer et se
            # replie sur l'autre. Une clé vers un objet absent ferait un lecteur
            # qui ne démarre jamais, ce qui se diagnostique bien plus mal.
            manquantes.append(chemin_video)
            continue
        await platform_asset_service.poser(
            session,
            slug=slug,
            object_key=await depot.deposer(video, prefixe="photos/home"),
        )
        reelles += 1
        if len(video) > SEUIL_DE_POIDS:
            trop_lourds.append((chemin_video, len(video)))

    await session.flush()
    return ResumePhotos(
        reelles=reelles,
        generees=generees,
        manquantes=tuple(sorted(manquantes)),
        sans_redimensionnement=reelles > 0 and not photos_reelles.pillow_disponible(),
        trop_lourds=tuple(sorted(trop_lourds)),
    )


# --------------------------------------------------------------------------
# créateurs, à tous les états
# --------------------------------------------------------------------------


async def _creer(
    session: AsyncSession,
    *,
    email: str,
    handle: str,
    followers: int,
    locale: Locale = Locale.EN,
    prenom: str | None = None,
    nom: str | None = None,
    media_count: int | None = None,
    token_ttl: timedelta = timedelta(days=60),
) -> tuple[User, SocialAccount]:
    """Un créateur, par le parcours complet : inscription, OAuth, relevé."""
    user = await _inscrire_verifie(
        session, email=email, password=MOT_DE_PASSE, role=UserRole.CREATOR, locale=locale
    )
    if prenom or nom:
        # Le nom est exigé à la première réservation, et il sert au contrôle de
        # cohérence. Un créateur sans nom ne peut pas réserver : le poser ici,
        # par le service, évite d'avoir des profils qui bloquent en démonstration.
        await profile_service.update_profile(
            session, user_id=user.id, modifications={"first_name": prenom, "last_name": nom}
        )

    fournisseur = DemoSocialProvider(
        platform=Platform.INSTAGRAM,
        handle=handle,
        followers=followers,
        media_count=media_count,
        token_ttl=token_ttl,
    )
    url = await social_account_service.start_authorization(session, user=user, provider=fournisseur)
    rattachement = await social_account_service.complete_authorization(
        session,
        state=httpx.URL(url).params["state"],
        code=f"demo-{handle}",
        provider=fournisseur,
    )
    compte = rattachement.compte
    await metrics_service.refresh_profile_metrics(session, account=compte, provider=fournisseur)
    return user, compte


async def creer_les_createurs(session: AsyncSession) -> dict[str, tuple[User, SocialAccount]]:
    """Les cinq états qu'un créateur peut présenter à l'ouverture de l'app.

    Chacun rend un écran différent, et c'est le seul moyen de vérifier qu'aucun
    de ces écrans n'est vide ou cassé.
    """
    createurs: dict[str, tuple[User, SocialAccount]] = {}

    # 1. Débutante : sous le premier palier, aucun historique. L'écran des
    #    paliers doit l'orienter, pas lui montrer une porte sans serrure.
    createurs["debutante"] = await _creer(
        session,
        email="camila@bind.example",
        handle="camila.newcomer",
        followers=640,
        locale=Locale.ES,
        prenom="Camila",
        nom="Rojas",
    )

    # 2. Confirmée : tous les paliers ouverts, et c'est elle qui parcourra le
    #    fil et réservera pendant la démonstration.
    createurs["confirmee"] = await _creer(
        session,
        email="rebecca@bind.example",
        handle="rebecca.miami",
        followers=64_000,
        prenom="Rebecca",
        nom="Alvarez",
    )

    # 3. Plafonnée : l'audience ouvrirait tout, le score ferme le haut. Le score
    #    lui-même est produit plus bas, par des événements réels.
    createurs["plafonnee"] = await _creer(
        session,
        email="mateo@bind.example",
        handle="mateo.wynwood",
        followers=22_000,
        locale=Locale.ES,
        prenom="Mateo",
        nom="Duarte",
    )

    # 4. En vérification : l'écran persistant, daté, sans promesse de délai.
    createurs["en_controle"] = await _creer(
        session,
        email="sofia@bind.example",
        handle="sofia.brickell",
        followers=11_500,
        prenom="Sofía",
        nom="Iglesias",
        # Peu de publications pour un compte de cette taille : c'est le signal
        # de volume qui manque, et le contrôle de cohérence le relève de
        # lui-même. Rien n'est forcé.
        media_count=6,
    )

    # 5. Autorisation expirée : jeton déjà mort à l'échange. Le fournisseur le
    #    rend tel quel, le service l'enregistre, et le balayage des jetons le
    #    trouvera périmé — sans qu'aucune ligne soit écrite à la main.
    createurs["expiree"] = await _creer(
        session,
        email="nina@bind.example",
        handle="nina.design",
        followers=31_000,
        prenom="Nina",
        nom="Costa",
        token_ttl=timedelta(days=-2),
    )
    return createurs


async def marquer_les_etats_de_compte(session: AsyncSession, createurs: dict) -> None:
    """Les deux états qu'aucun service ne sait produire à la demande.

    `needs_review` est normalement prononcé par le contrôle de cohérence quand
    un signal manque, et il l'est effectivement pour `sofia` — on le vérifie
    plutôt que de le poser. L'expiration du jeton, elle, se constate : le
    fournisseur a rendu une échéance passée, et c'est le statut du compte qui
    doit suivre. C'est le balayage de fond qui le fait en production ; ici on
    l'applique directement, faute de pouvoir attendre son passage.
    """
    _, compte_expire = createurs["expiree"]
    await session.execute(
        sa.update(SocialAccount)
        .where(SocialAccount.id == compte_expire.id)
        .values(status=SocialAccountStatus.EXPIRED)
    )

    _, compte_controle = createurs["en_controle"]
    await session.refresh(compte_controle)
    if compte_controle.verification_status is not VerificationStatus.NEEDS_REVIEW:
        # Le contrôle n'a pas prononcé ce qu'on attendait : le dire plutôt que
        # de forcer la valeur, sinon la démonstration montrerait un écran que
        # le produit ne sait plus produire.
        raise RuntimeError(
            "sofia devait passer en revue de cohérence et ne l'a pas fait : "
            "le contrôle ne relève plus le signal de volume"
        )
    await session.flush()


# --------------------------------------------------------------------------
# réservations et contreparties
# --------------------------------------------------------------------------


async def _premier_creneau(
    session: AsyncSession,
    business_id: uuid.UUID,
    item_id: uuid.UUID,
    *,
    depuis: datetime | None = None,
) -> datetime | None:
    creneaux = await availability_service.creneaux_libres(
        session, business_id=business_id, catalog_item_id=item_id, depuis=depuis, limite=1
    )
    return creneaux[0].starts_at if creneaux else None


async def _reserver(
    session: AsyncSession,
    *,
    createur: User,
    compte: SocialAccount,
    offre: TierOffer,
    pas_avant: datetime | None = None,
) -> Booking | None:
    item = await session.get(CatalogItem, offre.catalog_item_id)
    if item is None:
        return None

    creneau = (
        await _premier_creneau(session, offre.business_id, item.id, depuis=pas_avant)
        if item.requires_booking
        else None
    )
    if item.requires_booking and creneau is None:
        return None

    try:
        return await booking_service.creer(
            session,
            creator_id=createur.id,
            demande=booking_service.DemandeDeReservation(
                tier_offer_id=offre.id, social_account_id=compte.id, starts_at=creneau
            ),
        )
    except booking_service.BookingError as erreur:
        # Palier fermé, créneau pris : la démonstration se passe de cette
        # ligne-là plutôt que de forcer le passage. Mais elle le **dit** — un
        # jeu de données qui saute la moitié de ce qu'il devait produire, en
        # silence, se découvre pendant la démonstration.
        print(f"  réservation écartée ({type(erreur).__name__}) : {erreur}")
        return None


async def _accepter_si_besoin(session, booking, *, membre_id) -> None:
    """Fait passer l'accord du commerce quand il est requis.

    Le jeu de données emprunte le chemin du produit plutôt que d'écrire l'état :
    depuis que la validation est le défaut, une réservation confirmée par le
    créateur s'arrête en attente, et poser `confirmed` à la main aurait produit
    un jeu de données qui ne ressemble à rien de ce que le produit fabrique.
    """
    if booking.status is not BookingStatus.AWAITING_BUSINESS:
        return
    await booking_states.trancher(
        session,
        booking=booking,
        business_id=booking.business_id,
        user_id=membre_id,
        accepte=True,
    )


async def _reculer(session: AsyncSession, booking: Booking, de: timedelta) -> None:
    """Vieillit une réservation. La seule façon de fabriquer du passé.

    Nommée, isolée, et sans effet sur les règles : ce qui bouge est
    l'horodatage de création, pas un statut. C'est ce qui permet au reporting
    de montrer autre chose qu'une seule journée.
    """
    await session.execute(
        sa.update(Booking)
        .where(Booking.id == booking.id)
        .values(created_at=booking.created_at - de)
    )


async def composer_les_parcours(session: AsyncSession, createurs: dict) -> tuple[int, int]:
    """Des réservations dans chaque état, et des contreparties dans chaque état.

    L'ordre suit le parcours réel : réserver, confirmer, consommer au comptoir,
    publier, contrôler. Chaque bifurcation — annulation, absence, non-conformité
    — part d'une réservation qui a suivi le même chemin jusque-là.
    """
    confirmee, compte_confirmee = createurs["confirmee"]
    plafonnee, compte_plafonnee = createurs["plafonnee"]

    async def offre_pour(createur: User, *, commerce: str | None = None) -> TierOffer | None:
        """Une offre que ce créateur peut **réellement** réserver, maintenant.

        Prendre une offre au hasard produisait quatre refus de suite : les
        paliers supérieurs demandent des collaborations achevées, et une
        créatrice sans historique n'y accède pas. C'est le produit qui a
        raison — le jeu de données doit s'y plier, et non l'inverse.

        L'éligibilité est réévaluée à chaque appel : la première contrepartie
        approuvée incrémente le compteur, ce qui ouvre le palier suivant. La
        démonstration montre donc une progression réelle, pas une liste posée.

        **`commerce` répartit.** Sans lui, l'ordre — palier le plus haut, puis
        la plus ancienne offre — désigne toujours la même ligne, donc toujours
        le même salon : tout l'historique de la démonstration s'entassait sur
        un seul commerce, et les trois autres écrans de journée étaient vides.
        Nommer le salon ne force rien : si le palier n'y est pas ouvert, la
        recherche ne rend rien et la ligne est écartée à voix haute, comme
        ailleurs.
        """
        verdict = await eligibility.evaluer_createur(session, createur.id)
        ouverts = verdict.paliers_accessibles
        if not ouverts:
            return None
        requete = (
            sa.select(TierOffer)
            .join(Tier, Tier.id == TierOffer.tier_id)
            .join(Business, Business.id == TierOffer.business_id)
            .where(
                TierOffer.is_active.is_(True),
                Tier.is_active.is_(True),
                TierOffer.tier_id.in_(ouverts),
            )
            .order_by(Tier.display_order.desc(), TierOffer.created_at)
            .limit(1)
        )
        if commerce is not None:
            requete = requete.where(Business.name == commerce)
        return await session.scalar(requete)

    premiere = await offre_pour(confirmee)
    if premiere is None:
        return 0, 0

    reservations = 0
    contreparties = 0
    proprietaire = Actor.system()

    async def membre_de(business_id: uuid.UUID) -> uuid.UUID | None:
        """L'identifiant du membre qui tranche. Nul quand il n'y en a pas."""
        membre = await session.scalar(
            sa.select(BusinessMember).where(BusinessMember.business_id == business_id).limit(1)
        )
        return membre.user_id if membre else None

    async def confirmer_jusqu_au_bout(booking, createur_id: uuid.UUID) -> None:
        """Confirmation créateur, puis accord du commerce si sa validation est
        active. Le jeu de données emprunte les deux portes du produit."""
        await booking_states.confirmer(session, booking=booking, creator_id=createur_id)
        membre_id = await membre_de(booking.business_id)
        if membre_id is not None:
            await _accepter_si_besoin(session, booking, membre_id=membre_id)

    async def caissier_de(business_id: uuid.UUID) -> Actor:
        """Le membre du commerce qui sert au comptoir."""
        from app.models import BusinessMember

        membre = await session.scalar(
            sa.select(BusinessMember).where(BusinessMember.business_id == business_id).limit(1)
        )
        if membre is None:
            return proprietaire
        user = await session.get(User, membre.user_id)
        return Actor.from_user(user) if user else proprietaire

    # --- 0. en attente du commerce --------------------------------------
    #
    # L'état neuf de la v0.5 : la créatrice a confirmé, le salon n'a pas encore
    # tranché. Sans lui, la file du commerce est vide à la démonstration et
    # personne ne voit à quoi sert le nouvel écran.
    booking = await _reserver(
        session,
        createur=confirmee,
        compte=compte_confirmee,
        offre=premiere,
        pas_avant=datetime.now(UTC) + timedelta(days=2),
    )
    if booking:
        await session.execute(
            sa.update(Business)
            .where(Business.id == booking.business_id)
            .values(requires_booking_approval=True)
        )
        await booking_states.confirmer(session, booking=booking, creator_id=confirmee.id)
        reservations += 1

    # --- 1. à venir, simplement confirmée -------------------------------
    booking = await _reserver(session, createur=confirmee, compte=compte_confirmee, offre=premiere)
    if booking:
        await confirmer_jusqu_au_bout(booking, confirmee.id)
        reservations += 1

    # --- 2. annulée par la créatrice ------------------------------------
    #
    # Le créneau doit être à plus de vingt-quatre heures : en deçà, la règle
    # transforme une annulation en absence, et c'est ce qu'elle a fait au
    # premier essai. Le jeu de données ne contourne pas la règle, il lui donne
    # les conditions qu'elle exige.
    booking = await _reserver(
        session,
        createur=confirmee,
        compte=compte_confirmee,
        offre=premiere,
        pas_avant=datetime.now(UTC) + timedelta(days=3),
    )
    if booking:
        await confirmer_jusqu_au_bout(booking, confirmee.id)
        await booking_states.annuler(session, booking=booking, creator_id=confirmee.id)
        await _reculer(session, booking, timedelta(days=9))
        reservations += 1

    # --- 3. absence constatée par le commerce ---------------------------
    pour_plafonnee = await offre_pour(plafonnee)
    booking = (
        await _reserver(session, createur=plafonnee, compte=compte_plafonnee, offre=pour_plafonnee)
        if pour_plafonnee
        else None
    )
    if booking:
        await confirmer_jusqu_au_bout(booking, plafonnee.id)
        # L'absence ne se constate qu'après l'heure prévue. Reculer le créneau
        # est le seul moyen de la produire sans attendre — et la fin se
        # recalcule depuis la durée figée, jamais choisie au jugé : une
        # contrainte de base vérifie que les trois façons de dire la même chose
        # coïncident.
        #
        # **De combien reculer se demande au service, jamais au souvenir.** Ces
        # lignes reculaient de trois heures, ce qui a suffi tant que l'absence
        # s'ouvrait vingt minutes après le créneau. Depuis qu'elle attend la
        # fermeture de la fenêtre de recours, trois heures ne suffisent plus et
        # le semis entier tombait — quarante-cinq erreurs pour un nombre écrit
        # une fois. Le recul se déduit maintenant de la règle : il suivra le
        # prochain ajustement sans que personne y pense.
        maintenant = datetime.now(UTC)
        ouverture = booking_states.ouverture_de_l_absence(maintenant)
        assert ouverture is not None
        debut = maintenant - (ouverture - maintenant) - timedelta(minutes=5)
        await session.execute(
            sa.update(Booking)
            .where(Booking.id == booking.id)
            .values(
                starts_at=debut,
                ends_at=debut + timedelta(minutes=booking.duration_minutes or 0),
            )
        )
        await session.refresh(booking)
        await booking_states.marquer_absent(
            session,
            booking=booking,
            actor=await caissier_de(booking.business_id),
            reason="la créatrice ne s'est pas présentée",
        )
        await _reculer(session, booking, timedelta(days=12))
        reservations += 1

    # --- 4 à 7. consommées, avec leurs quatre issues de contrepartie ----
    # Six issues, et les six existent réellement en base à la fin. `attendue`
    # est l'état d'une contrepartie qui vient de naître — celui qu'a le
    # créateur juste après avoir été servi.
    #
    # **Qui fait quoi n'est pas indifférent.** Les issues dégradées produisent
    # des événements de fiabilité, et les donner toutes à la même créatrice lui
    # ferait un score de quarante — alors que le jeu doit montrer une créatrice
    # vérifiée **avec un bon score**. Un premier essai l'avait fait, et cela
    # s'est vu au moment de vérifier le jeu obtenu.
    #
    # **L'âge s'étale sur douze semaines, et les salons alternent.** Deux
    # défauts relevés en campagne 2 tenaient au jeu de données et non aux
    # écrans : les rapports montraient une barre sur douze parce que tout
    # tenait dans les quinze derniers jours, et l'administration n'avait
    # qu'une revue humaine à trancher. Trois revues, réparties sur trois
    # salons, et de l'historique sur chaque semaine.
    #
    # `Havana Glow` n'apparaît nulle part : c'est le salon qui n'a rien
    # composé, et c'est le cas — zéro historique — que tout salon qui
    # s'inscrit doit pouvoir regarder.
    # **La colonne d'âge dit ce que la démonstration montre ; l'ordre des lignes
    # dit ce que le produit permet.** Les deux sont indépendants : chaque
    # parcours est mené à son terme puis reculé, si bien que sa date d'affichage
    # ne dépend pas de son rang ici.
    #
    # L'ordre compte quand même, et il a coûté une revue. Les issues dégradées
    # pèsent sur le score de « plafonnée », et le score est réévalué **à chaque
    # réservation** : une absence et une non-conformité placées avant ses trois
    # revues lui fermaient ses derniers paliers, et la dernière ligne était
    # écartée. Ses parcours sont donc menés du moins coûteux au plus coûteux.
    # Le score final est le même — il se recalcule sur tous les événements — et
    # c'est bien le produit qui a tranché, pas le semis qui l'a contourné.
    issues = (
        # Le trimestre écoulé : de quoi remplir la série hebdomadaire.
        ("approuvee", timedelta(weeks=11, days=2), "confirmee", OCEAN),
        ("approuvee", timedelta(weeks=10), "confirmee", WYNWOOD),
        ("approuvee", timedelta(weeks=9, days=1), "confirmee", BRICKELL),
        # Des réussites pour « plafonnée » **avant** ses issues dégradées.
        # Sans elles, son score touchait le plancher — zéro sur cent — et la
        # démonstration montrait une condamnation là où elle doit montrer un
        # plafond. Une créatrice qui plafonne a tenu des engagements ; c'est
        # justement pour cela qu'elle accède au bas de l'échelle.
        ("approuvee", timedelta(weeks=9, days=5), "plafonnee", OCEAN),
        ("approuvee", timedelta(weeks=9, days=3), "plafonnee", BRICKELL),
        ("approuvee", timedelta(weeks=9), "plafonnee", OCEAN),
        ("revue_humaine", timedelta(weeks=8, days=4), "plafonnee", OCEAN),
        ("approuvee", timedelta(weeks=7), "confirmee", WYNWOOD),
        # Chez Brickell et non chez Wynwood : Wynwood ne compose qu'aux
        # paliers hauts, que le score de « plafonnée » lui ferme après sa
        # première revue. Le semis ne force pas le passage — il place le
        # parcours là où le produit l'autorise, et le dit.
        ("revue_humaine", timedelta(weeks=4, days=3), "plafonnee", BRICKELL),
        ("approuvee", timedelta(weeks=5), "confirmee", OCEAN),
        ("revue_humaine", timedelta(weeks=1, days=2), "plafonnee", BRICKELL),
        ("approuvee", timedelta(weeks=3), "confirmee", BRICKELL),
        ("deuxieme_tentative", timedelta(weeks=2, days=1), "plafonnee", OCEAN),
        ("non_honoree", timedelta(weeks=6, days=2), "plafonnee", BRICKELL),
        # La semaine en cours, celle qu'on regarde pendant la démonstration.
        ("approuvee", timedelta(days=6), "confirmee", WYNWOOD),
        ("approuvee", timedelta(days=4), "confirmee", OCEAN),
        ("attendue", timedelta(days=1), "confirmee", BRICKELL),
        ("soumise", timedelta(hours=6), "confirmee", WYNWOOD),
        # **Une preuve à contrôler chez OCEAN, et c'est le point.** Il n'y en
        # avait qu'une dans tout le jeu, chez Wynwood. L'onglet « à examiner »
        # d'Ocean — le salon avec lequel on ouvre le produit — était donc vide
        # pendant que « attendues » portait deux lignes, ce qui se lit comme un
        # filtre cassé alors que le filtre est juste. Le même défaut que
        # l'abonnement pris par rang : le jeu de données place ailleurs l'état
        # que l'écran de démonstration doit montrer.
        ("soumise", timedelta(hours=3), "confirmee", OCEAN),
    )
    for issue, age, qui, commerce in issues:
        createur, compte = createurs[qui]
        offre = await offre_pour(createur, commerce=commerce)
        if offre is None:
            # **Le silence était le défaut.** `_reserver` annonce ce qu'il
            # écarte, mais il n'était jamais appelé quand aucune offre ne
            # convenait : la ligne disparaissait sans un mot, et le jeu rendait
            # deux revues humaines là où trois étaient demandées. Un semis qui
            # saute la moitié de ce qu'il devait produire, en silence, se
            # découvre pendant la démonstration.
            print(f"  parcours écarté : aucune offre ouverte à {qui} chez {commerce}")
            continue
        booking = await _reserver(session, createur=createur, compte=compte, offre=offre)
        if booking is None:
            continue

        await confirmer_jusqu_au_bout(booking, createur.id)
        code = await redemption_service.code_du_booking(session, booking=booking)
        caissier = await caissier_de(booking.business_id)
        if code is not None:
            await redemption_service.marquer_consomme(
                session, redemption_code_id=code.id, par_user_id=caissier.user_id
            )
        await booking_states.consommer(session, booking=booking, actor=caissier)
        reservations += 1

        contrepartie = await collaboration_service.du_booking(session, booking.id)
        if contrepartie is None:
            continue
        contreparties += 1

        await _mener(session, contrepartie, issue=issue, caissier=caissier, createur=createur)
        await _reculer(session, booking, age)

    # --- 8. en garde, non confirmée -------------------------------------
    #
    # L'état d'une réservation qui vient d'être prise et pas encore confirmée.
    # Elle expire toute seule au bout de dix minutes : c'est l'écran que voit
    # quelqu'un qui hésite, et le balayage la reprendra.
    offre = await offre_pour(confirmee)
    booking = (
        await _reserver(
            session,
            createur=confirmee,
            compte=compte_confirmee,
            offre=offre,
            pas_avant=datetime.now(UTC) + timedelta(days=5),
        )
        if offre
        else None
    )
    if booking:
        reservations += 1

    # --- une journée qui existe, dans chaque salon ------------------------
    reservations += await _une_reservation_aujourd_hui(
        session,
        createur=confirmee,
        compte=compte_confirmee,
        confirmer=confirmer_jusqu_au_bout,
    )

    await session.flush()
    return reservations, contreparties


async def _une_reservation_aujourd_hui(
    session: AsyncSession,
    *,
    createur: User,
    compte: SocialAccount,
    confirmer,
) -> int:
    """Au moins une réservation confirmée aujourd'hui, dans **chaque** salon actif.

    Sans elle, l'écran « Aujourd'hui » du commerce disait « rien de réservé »
    sur un jeu de données fraîchement semé — ce qui était exact et inutilisable.
    Les réservations tombaient sur le premier créneau libre à partir de
    maintenant, donc presque toujours demain, et toutes sur le même salon :
    `offre_pour` n'en rendait qu'une seule, la mieux classée. Trois salons sur
    quatre n'avaient jamais eu la moindre ligne.

    La conséquence dépassait l'affichage : la caisse ne s'atteignait que depuis
    une ligne de la journée, et un écran vide la rendait inaccessible. Aucun
    code ne pouvait être validé, la boucle du produit ne se fermait jamais.

    **Le créneau vient de la disponibilité réelle, jamais posé, et toujours à
    venir.** Quand la journée est finie — semé à 22 h, dans un salon fermé
    depuis longtemps — la réservation se pose au prochain créneau plutôt que
    d'échouer, et le résumé le dit.
    """
    posees = 0
    reportees = 0

    actifs = (
        await session.scalars(sa.select(Business).where(Business.status == BusinessStatus.ACTIVE))
    ).all()

    for business in actifs:
        offre = await session.scalar(
            sa.select(TierOffer)
            .join(Tier, Tier.id == TierOffer.tier_id)
            .join(CatalogItem, CatalogItem.id == TierOffer.catalog_item_id)
            .where(
                TierOffer.business_id == business.id,
                TierOffer.is_active.is_(True),
                Tier.is_active.is_(True),
                CatalogItem.requires_booking.is_(True),
                CatalogItem.is_available.is_(True),
            )
            .order_by(Tier.display_order, TierOffer.created_at)
            .limit(1)
        )
        if offre is None:
            continue

        choix = await prochain_creneau_reservable(
            session, business, offre.catalog_item_id, maintenant=datetime.now(UTC)
        )
        if choix is None:
            print(f"  aucune place à venir chez {business.name} : ses horaires font foi")
            continue

        creneau, aujourd_hui = choix

        try:
            booking = await booking_service.creer(
                session,
                creator_id=createur.id,
                demande=booking_service.DemandeDeReservation(
                    tier_offer_id=offre.id,
                    social_account_id=compte.id,
                    starts_at=creneau,
                ),
            )
        except booking_service.BookingError as erreur:
            print(f"  journée du jour écartée chez {business.name} ({type(erreur).__name__})")
            continue

        await confirmer(booking, createur.id)
        posees += 1
        if not aujourd_hui:
            reportees += 1
            quand = creneau.astimezone(ZoneInfo(business.timezone))
            print(
                f"  plus de place aujourd'hui chez {business.name} : "
                f"réservation posée au prochain créneau, le {quand:%d/%m à %H:%M}"
            )

    if reportees:
        print(
            f"  {reportees} réservation(s) reportée(s) au prochain créneau : "
            "semé après la fermeture, la journée du jour est derrière nous"
        )

    return posees


async def prochain_creneau_reservable(
    session: AsyncSession,
    business: Business,
    catalog_item_id: uuid.UUID,
    *,
    maintenant: datetime,
) -> tuple[datetime, bool] | None:
    """Le prochain créneau libre, et s'il tombe encore aujourd'hui.

    **Toujours à venir.** Le choix se faisait en deux passes : ce qui reste à
    partir de maintenant, puis — à défaut — ce qui existait depuis l'ouverture.
    Cette seconde passe rendait un créneau déjà passé, que la réservation
    acceptait et que l'acceptation par le commerce refusait, à juste titre
    (`CreneauDepasse`). Le semis s'arrêtait au milieu de son écriture, et
    seulement à certaines heures : avant midi il n'y avait rien à rattraper,
    donc rien à casser.

    **Et jamais un échec quand la journée est finie.** Semé à 22 h, un salon
    fermé depuis longtemps n'a plus rien aujourd'hui ; rendre `None` là
    priverait la démonstration de toute réservation dans ce salon. On rend le
    prochain créneau, quel que soit son jour, et l'appelant le dit.

    `maintenant` est un argument et non `datetime.now()` : c'est ce qui permet
    d'éprouver le choix à six heures du matin comme à minuit moins une, sans
    attendre l'heure qu'il faut.
    """
    creneau = await _premier_creneau(session, business.id, catalog_item_id, depuis=maintenant)
    if creneau is None:
        return None

    fuseau = ZoneInfo(business.timezone)
    fin_du_jour = datetime.combine(
        maintenant.astimezone(fuseau).date(), time.min, tzinfo=fuseau
    ) + timedelta(days=1)
    return creneau, creneau < fin_du_jour


async def _mener(
    session: AsyncSession,
    contrepartie: Collaboration,
    *,
    issue: str,
    caissier: Actor,
    createur: User,
) -> None:
    """Conduit une contrepartie jusqu'à l'état voulu, par les services.

    `pending` reste tel quel : c'est déjà un état, celui d'une publication
    attendue, et il n'y a rien à faire pour l'obtenir.
    """
    if issue == "attendue":
        # Rien à faire : `pending` est déjà l'état d'une publication attendue.
        # C'est le seul cas où ne rien faire est la bonne action.
        return

    if issue == "non_honoree":
        # L'échéance dépassée fait tomber le dossier — par le balayage, pas à
        # la main. On recule l'échéance et on laisse le job faire son travail.
        await session.execute(
            sa.update(Collaboration)
            .where(Collaboration.id == contrepartie.id)
            .values(deadline_at=datetime.now(UTC) - timedelta(hours=2))
        )
        await collaboration_service.expirer_les_echeances(session)
        return

    await _soumettre(session, contrepartie, createur=createur, marque="1")
    await session.refresh(contrepartie)

    if issue == "soumise":
        # Soumise et pas encore contrôlée : c'est ce que le commerce voit dans
        # son onglet « à contrôler », et ce que la créatrice voit en attente.
        return

    if issue == "approuvee":
        await collaboration_service.approuver(session, collaboration=contrepartie, actor=caissier)
        return

    # Une première demande de nouvelle soumission : le dossier est en deuxième
    # tentative, exactement comme après un contrôle non conforme.
    await collaboration_service.demander_une_nouvelle_soumission(
        session,
        collaboration=contrepartie,
        actor=caissier,
        reason=MotifDeDecision.MENTION_MANQUANTE,
    )

    if issue != "revue_humaine":
        return

    # Trois passages lèvent le drapeau de revue humaine. On refait le tour
    # complet plutôt que d'incrémenter le compteur : c'est le compteur qui doit
    # être la conséquence, pas la cause.
    for rang, motif in enumerate(
        (MotifDeDecision.LIEU_MANQUANT, MotifDeDecision.FORMAT_INATTENDU), start=2
    ):
        await session.refresh(contrepartie)
        await _soumettre(session, contrepartie, createur=createur, marque=str(rang))
        await session.refresh(contrepartie)
        await collaboration_service.demander_une_nouvelle_soumission(
            session, collaboration=contrepartie, actor=caissier, reason=motif
        )


async def _soumettre(
    session: AsyncSession, contrepartie: Collaboration, *, createur: User, marque: str
) -> None:
    """Une soumission complète : dépôt de la capture, puis archivage.

    La capture est réellement déposée dans le dépôt d'objets, et le service
    d'archivage la relit pour calculer son empreinte. C'est le chemin de
    niveau 3, celui qui fonctionne aujourd'hui.

    **Avec l'adresse de la publication, qui manquait.** Le semis posait
    `source_url=None` sur toutes ses preuves : le commerce n'avait jamais que
    la capture, et le lien qu'il ouvre pour vérifier que la publication est en
    ligne n'existait dans aucune démonstration. Le champ était pourtant accepté
    du schéma jusqu'à l'écran — seul l'endroit qui le remplit manquait, des deux
    côtés.

    L'adresse est fabriquée depuis la contrepartie et porte le pseudonyme du
    compte : elle ne mène nulle part, comme le reste du jeu de démonstration,
    mais elle a la forme de ce qu'un créateur colle et le commerce voit ce qu'il
    verra en production.
    """
    cle = await get_object_store().deposer(
        image(f"preuve-{contrepartie.id}-{marque}", PRESTATION), prefixe="proofs/upload"
    )
    compte_id = await _compte_du_booking(session, contrepartie.booking_id)
    compte = await session.get(SocialAccount, compte_id)
    pseudonyme = (compte.handle if compte else None) or "bind.creator"
    capture = await archiver_la_publication(
        session,
        social_account_id=compte_id,
        source_url=f"https://www.instagram.com/p/{str(contrepartie.id)[:11]}/?taken-by={pseudonyme}",
        screenshot_key=cle,
    )
    if capture is None:
        return
    await proof_service.soumettre(
        session,
        collaboration=contrepartie,
        capture=capture,
        actor=Actor.from_user(createur),
    )


async def _compte_du_booking(session: AsyncSession, booking_id: uuid.UUID) -> uuid.UUID:
    booking = await session.get(Booking, booking_id)
    assert booking is not None  # noqa: S101 - la contrepartie référence sa réservation
    return booking.social_account_id


# --------------------------------------------------------------------------
# le reste : score, jobs, plans
# --------------------------------------------------------------------------


async def recalculer_les_scores(session: AsyncSession, createurs: dict) -> None:
    """Les scores viennent des événements, jamais d'un chiffre posé.

    Poser `reliability_score = 41` donnerait le même écran et ne prouverait
    rien : le jour où le calcul change, la démonstration mentirait. Ici
    l'absence, les resoumissions et la non-honoration ont déjà produit leurs
    événements ; on recalcule et on constate.

    Le résultat est **vérifié** : la créatrice confirmée doit finir au-dessus de
    la plafonnée. Si l'inverse se produit — c'est arrivé au premier essai, où
    toutes les issues dégradées lui étaient tombées dessus — le jeu de données
    ne montre plus ce qu'il annonce.
    """
    for user, _ in createurs.values():
        await reliability_service.rafraichir(session, creator_id=user.id)

    confirmee = await profile_service.get_profile(session, createurs["confirmee"][0].id)
    plafonnee = await profile_service.get_profile(session, createurs["plafonnee"][0].id)

    if confirmee.reliability_score is None or plafonnee.reliability_score is None:
        raise RuntimeError("aucun score calculé : le moteur de fiabilité ne produit plus rien")
    if confirmee.reliability_score <= plafonnee.reliability_score:
        raise RuntimeError(
            f"la créatrice confirmée ({confirmee.reliability_score}) n'est pas au-dessus de "
            f"la plafonnée ({plafonnee.reliability_score}) : le jeu ne montre pas ce qu'il annonce"
        )

    # **Plafonnée, pas anéantie.** Toutes les issues dégradées lui tombant
    # dessus, son score atteignait le plancher : zéro sur cent. C'est un chiffre
    # exact et une mauvaise démonstration — « plafonnée » veut dire qu'elle
    # accède au bas de l'échelle et pas au haut, pas qu'elle ne vaut rien, et un
    # zéro se lit comme une condamnation. Elle a aussi mené des collaborations à
    # terme : c'est ce que fait une créatrice qui plafonne.
    if plafonnee.reliability_score <= 0:
        raise RuntimeError(
            "la créatrice plafonnée est au plancher : le jeu montre une condamnation "
            "là où il doit montrer un plafond"
        )


async def poser_les_jobs(session: AsyncSession) -> int:
    """Des jobs, dont un épuisé, pour que le back office ne soit pas vide.

    L'épuisement s'obtient en faisant échouer le job autant de fois que la
    configuration l'autorise — par le service, boucle après boucle. Poser
    `status = exhausted` sauterait précisément la mécanique que l'écran
    d'administration sert à surveiller.
    """
    comptes = (await session.scalars(sa.select(SocialAccount).limit(3))).all()
    if not comptes:
        return 0

    from app.services import jobs as jobs_service

    poses = 0
    for compte in comptes:
        await jobs_service.planifier(
            session,
            job_type=JobType.TOKEN_REFRESH,
            target_id=compte.id,
            run_after=datetime.now(UTC) + timedelta(days=30),
        )
        poses += 1

    # Le dernier échoue jusqu'à l'épuisement.
    #
    # Un seul job doit être dû pendant la boucle. `reclamer` prend le prochain
    # dû, quel qu'il soit : depuis que le rattachement planifie lui-même deux
    # travaux par compte, les douze tentatives se répartissaient sur une
    # dizaine de jobs et aucun n'atteignait son épuisement. Le jeu de données
    # rendait alors un back office sans rien à montrer, sans que rien ne le
    # signale — c'est le test de l'épuisement qui l'a dit.
    await session.execute(sa.update(Job).values(run_after=datetime.now(UTC) + timedelta(days=30)))
    cible = await session.scalar(
        sa.select(Job.id).where(
            Job.target_id == comptes[-1].id, Job.job_type == JobType.TOKEN_REFRESH
        )
    )
    await session.execute(
        sa.update(Job).where(Job.id == cible).values(run_after=sa.func.clock_timestamp())
    )
    for _ in range(12):
        reclames = await jobs_service.reclamer(session, limite=1)
        if not reclames:
            break
        etat = await jobs_service.echouer(
            session, reclames[0], erreur="la plateforme a refusé le jeton (démonstration)"
        )
        if etat is JobStatus.EXHAUSTED:
            break
        await session.execute(
            sa.update(Job)
            .where(Job.id == reclames[0].id)
            .values(run_after=sa.func.clock_timestamp())
        )

    await session.flush()
    return poses


async def poser_les_plans(session: AsyncSession) -> int:
    """Trois plans, dont un annuel : l'écran d'administration a besoin des deux
    intervalles pour que la mensualisation se voie."""
    plans = (
        ("Essentiel", BusinessCategory.BEAUTY, 9_900, BillingInterval.MONTHLY),
        ("Studio", BusinessCategory.BEAUTY, 19_900, BillingInterval.MONTHLY),
        ("Essentiel annuel", BusinessCategory.BEAUTY, 106_900, BillingInterval.YEARLY),
    )
    for nom, categorie, prix, intervalle in plans:
        session.add(
            SubscriptionPlan(
                category=categorie,
                name=nom,
                price_cents=prix,
                currency="USD",
                billing_interval=intervalle,
                features={"slots_month": 20 if prix < 15_000 else 60},
            )
        )
    await session.flush()
    return len(plans)


async def abonner_les_commerces(session: AsyncSession) -> int:
    """Des commerces abonnés, d'autres non. Par le service, avec le fournisseur du mode.

    Sans abonnement, l'écran d'administration des plans affiche trois lignes à
    zéro et un revenu nul : il existe, il ne montre rien. Des abonnés **et** un
    plan que personne n'a pris donnent un chiffre à lire et la vraie question
    qu'on se pose devant cet écran.

    **Nommés, et non pris dans l'ordre alphabétique.** Ces lignes prenaient
    `actifs[:2]` : écrit quand le jeu comptait trois salons, où les deux
    premiers étaient forcément ceux qu'on regarde. Passé à vingt, `[:2]` a
    désigné « Bayside Play Loft » et « Brickell Highball » — deux salons du
    marché, tirés par leur initiale — et **Ocean Beauty Studio, le salon de la
    démonstration, s'est retrouvé sans abonnement**. L'annuaire des créateurs,
    qui est ce que BIND vend, répondait donc 402 au compte avec lequel on montre
    le produit. Trouvé en campagne, et personne ne l'aurait vu autrement : rien
    n'échoue, l'écran affiche « l'annuaire vient avec l'abonnement », et c'est
    exact.

    Le fournisseur est celui que la configuration déclare — `log` par défaut.
    Aucune clé, aucun appel réseau, et le même chemin qu'en production.
    """
    from app.integrations.billing import get_billing_provider
    from app.services import subscription as subscription_service

    plans = list(
        (
            await session.scalars(
                sa.select(SubscriptionPlan).order_by(SubscriptionPlan.price_cents)
            )
        ).all()
    )
    if not plans:
        return 0

    actifs = list(
        (
            await session.scalars(
                sa.select(Business)
                .where(Business.status == BusinessStatus.ACTIVE)
                .order_by(Business.name)
            )
        ).all()
    )

    #: Les salons qui portent un abonnement dans la démonstration. Nommés :
    #: c'est avec `OCEAN` qu'on ouvre le produit, et un abonnement tiré au rang
    #: se déplace chaque fois que le jeu de données grandit.
    #:
    #: Les autres n'en ont pas, et c'est voulu — l'écran des plans doit montrer
    #: un plan que personne n'a pris.
    abonnes = [b for b in actifs if b.name == OCEAN]
    abonnes += [b for b in actifs if b.name != OCEAN][:1]

    provider = get_billing_provider()
    poses = 0
    for rang, business in enumerate(abonnes):
        membre = await session.scalar(
            sa.select(BusinessMember).where(BusinessMember.business_id == business.id).limit(1)
        )
        if membre is None:
            continue
        acteur = await session.get(User, membre.user_id)
        if acteur is None:
            continue

        await subscription_service.souscrire(
            session,
            business=business,
            plan_id=plans[rang % len(plans)].id,
            actor=acteur,
            provider=provider,
        )
        poses += 1

    await session.flush()
    return poses


async def vieillir_un_releve(session: AsyncSession, createurs: dict) -> None:
    """Un relevé périmé, pour que l'obstacle daté se démontre.

    `metrics_stale` porte la date du dernier relevé, et c'est elle qui
    s'affiche. Sans un compte réellement périmé, cet écran ne se voit jamais.
    """
    _, compte = createurs["expiree"]
    await session.execute(
        sa.update(SocialMetricsSnapshot)
        .where(SocialMetricsSnapshot.social_account_id == compte.id)
        .values(captured_at=datetime.now(UTC) - timedelta(days=21))
    )


async def enrichir(session: AsyncSession) -> ResumeDemo:
    """Tout l'enrichissement, dans l'ordre où les dépendances l'imposent."""
    photos = await poser_les_photos(session)
    plans = await poser_les_plans(session)

    createurs = await creer_les_createurs(session)
    await marquer_les_etats_de_compte(session, createurs)

    reservations, contreparties = await composer_les_parcours(session, createurs)
    await recalculer_les_scores(session, createurs)
    await vieillir_un_releve(session, createurs)
    jobs = await poser_les_jobs(session)
    abonnements = await abonner_les_commerces(session)

    return ResumeDemo(
        createurs=len(createurs),
        reservations=reservations,
        contreparties=contreparties,
        jobs=jobs,
        photos=photos,
        plans=plans,
        abonnements=abonnements,
    )
