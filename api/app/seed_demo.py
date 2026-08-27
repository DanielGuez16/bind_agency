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
from app.services import booking_states, business_menu, eligibility, storage
from app.services import collaboration as collaboration_service
from app.services import creator_profile as profile_service
from app.services import metrics as metrics_service
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
    favoris: int
    fiches: int
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
    replis: tuple[str, ...] = (),
) -> tuple[str, bool, int]:
    """La vraie photo si elle est là, un dégradé sinon. Rend la clé, laquelle, et le poids.

    **La vignette est rangée avec l'original, et elle ne l'était pas.** Le semis
    appelait le dépôt d'objets directement ; `deposer_une_image` est ce qui
    range les deux. Aucune image du jeu de démonstration n'avait donc de
    vignette — cent deux fichiers, zéro `@vignette` — et le mur, qui la demande,
    tombait à chaque fois sur le repli vers l'original : 169 Ko de moyenne au
    lieu d'une quinzaine, pour quatre-vingts cartes.

    Rien ne le disait. La route rend l'original quand la vignette manque, et ce
    repli existe pour de bonnes raisons — il a sauvé les images déposées avant
    que les vignettes existent. Ici il masquait leur absence totale : l'écran
    était juste, seulement lent.

    **Le préfixe porte la nature du contenu.** `photos/genere/business/…` pour
    un dégradé, `photos/business/…` pour une vraie photo. La clé étant renvoyée
    telle quelle par l'API, un commerce qui n'a pas fourni sa couverture se
    reconnaît dans n'importe quelle réponse, sans qu'aucun écran ait à porter
    un repère de développement qu'on oublierait d'enlever.

    **`replis` nomme les fichiers à essayer ensuite**, dans l'ordre. Une photo
    du bon sujet, même cadrée pour un autre format, vaut mieux qu'un dégradé :
    le dégradé ne dit rien du salon, et c'est précisément ce qu'une couverture
    doit dire. Le premier chemin reste celui qu'on réclame dans `A-FOURNIR.md`
    — un repli est une consolation, pas une réponse à la demande.
    """
    for candidat in (chemin, *replis):
        reelle = photos_reelles.lire(candidat, taille=taille_reelle)
        if reelle is not None:
            cle = await storage.deposer_une_image(
                reelle.contenu, prefixe=f"photos/{famille}", depot=depot
            )
            return cle, True, len(reelle.contenu)

    degrade = image(graine, taille_generee)
    cle = await storage.deposer_une_image(degrade, prefixe=f"photos/genere/{famille}", depot=depot)
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
        # **La couverture verticale sert de repli, et elle en a le droit.** Elle
        # a été déposée pour un mur qui n'existe plus : vingt photographies
        # réelles, une par salon, choisies sur le sujet — le barbier chez le
        # barbier, la poterie chez le potier. Seize salons n'ont aucun fichier
        # en paysage et recevaient donc un dégradé, c'est-à-dire une couverture
        # qui ne dit rien d'eux.
        #
        # Le recadrage est franc : un 2:3 ramené en 16:9 perd le haut et le bas.
        # Il garde le sujet, qui est au centre, et une photo du bon commerce
        # mal cadrée vaut mieux qu'un aplat qui n'est celle de personne.
        numero_de_repli = portraits.get(business.name)
        business.cover_photo_key, trouvee, poids = await _deposer_photo(
            depot,
            chemin=chemin,
            taille_reelle=photos_reelles.COUVERTURE,
            graine=business.name,
            taille_generee=COUVERTURE,
            famille="business",
            replis=(
                (f"couvertures-portrait/{numero_de_repli}.jpg",)
                if numero_de_repli is not None
                else ()
            ),
        )
        compter(trouvee, chemin, poids)

        # --- la couverture verticale, pour le mur du fil
        #
        # **Un champ à part, et un fichier à part.** Le mur donne à un salon
        # toute la hauteur de l'écran : un 16:9 recadré n'y donne rien. Le
        # dépôt borne le grand côté à 2000, donc un 1600 × 2000 traverse sans
        # rien perdre. Un salon sans couverture verticale garde la sienne en
        # paysage — c'est l'app qui retombe dessus.
        numero = numero_de_repli
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

    **Appelée après les parcours.** Elle l'était avant, et Nina ne pouvait alors
    rien réserver : son compte était déjà expiré au moment où le jeu composait
    l'historique. Son écran de paliers montrait donc un obstacle — jeton mort,
    relevé vieux de trois semaines — sur une créatrice qui n'avait jamais rien
    fait, ce qui ne se lit pas. Un compte se dégrade après avoir vécu.

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
    # **Une heure dépassée ne s'accepte pas, et le semis n'y fait pas exception.**
    # `trancher` lève `CreneauDepasse` — un accord ne rattrape pas une heure
    # passée — et c'est une garde du produit, pas un obstacle à contourner pour
    # remplir un écran. La réservation reste en attente : c'est l'état vrai
    # d'un rendez-vous que le salon n'a pas tranché à temps, et la journée
    # l'affiche comme tel.
    if booking.starts_at is not None and booking.starts_at <= datetime.now(UTC):
        return
    await booking_states.trancher(
        session,
        booking=booking,
        business_id=booking.business_id,
        user_id=membre_id,
        accepte=True,
    )


async def _deplacer_le_creneau(session: AsyncSession, booking: Booking, vers: datetime) -> None:
    """Repose une réservation menée à son terme sur une heure déjà passée.

    **La seule façon de fabriquer une journée qui a eu lieu.** Le produit refuse
    d'accorder une demande dont l'heure est dépassée — `trancher` lève
    `CreneauDepasse` — et c'est une garde qu'on ne contourne pas. Une
    réservation posée directement sur un créneau du matin restait donc « en
    attente » chez tout salon qui valide : la journée montrait dix-neuf lignes
    à trancher dont aucune ne se tranchait.

    Le parcours est donc mené **sur un créneau à venir**, par les services et
    dans l'ordre — confirmer, accorder, marquer le code, consommer — puis la
    ligne est reposée sur l'heure qu'elle aurait dû avoir. Ce qui bouge est
    l'horodatage, jamais un statut : l'état obtenu est celui que le produit a
    fabriqué, et il l'a fabriqué à l'endroit où le produit l'autorise.

    Sœur de `_reculer`, qui vieillit la création. Celle-ci déplace le rendez-vous.
    """
    if booking.starts_at is None:
        return
    # **Les deux bornes, du même écart.** `ck_booking_ends_at_follows_duration`
    # lie la fin au début et à la durée de la prestation : déplacer le seul
    # début fait une réservation de sept heures, et la base la refuse — ce qui
    # est exactement ce qu'on attend d'une contrainte.
    ecart = vers - booking.starts_at
    await session.execute(
        sa.update(Booking)
        .where(Booking.id == booking.id)
        .values(starts_at=vers, ends_at=booking.ends_at + ecart)
    )
    await session.refresh(booking)


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
        # **Le trimestre écoulé, en courbe plutôt qu'en plateau.** Un parcours
        # par semaine donnait une série de 1 : les rapports montraient douze
        # barres identiques, ce qui ne dit rien d'une progression. Le volume
        # monte donc — un ou deux au début, trois à quatre récemment — et il
        # monte **pour de vrai** : ce sont des parcours réellement menés, pas un
        # chiffre posé sur une courbe.
        ("approuvee", timedelta(weeks=11, days=2), "confirmee", OCEAN),
        ("approuvee", timedelta(weeks=10), "confirmee", WYNWOOD),
        ("approuvee", timedelta(weeks=10, days=4), "confirmee", BRICKELL),
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
        # Les trois dernières semaines montent : c'est la pente que les
        # rapports doivent montrer.
        ("approuvee", timedelta(weeks=2, days=5), "confirmee", WYNWOOD),
        ("approuvee", timedelta(weeks=2, days=2), "confirmee", OCEAN),
        ("approuvee", timedelta(weeks=1, days=5), "confirmee", OCEAN),
        ("approuvee", timedelta(weeks=1, days=4), "confirmee", BRICKELL),
        ("approuvee", timedelta(weeks=1), "confirmee", WYNWOOD),
        # La semaine en cours, celle qu'on regarde pendant la démonstration.
        # **Les quatre stades y sont tous**, et récents : l'arbitrage le plus
        # frais datait de neuf jours, ce qui se lit comme une file abandonnée.
        ("approuvee", timedelta(days=6), "confirmee", WYNWOOD),
        ("approuvee", timedelta(days=5), "confirmee", BRICKELL),
        ("approuvee", timedelta(days=4), "confirmee", OCEAN),
        ("revue_humaine", timedelta(days=2), "plafonnee", OCEAN),
        ("deuxieme_tentative", timedelta(days=3), "confirmee", WYNWOOD),
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
        # **Une histoire pour celles dont l'obstacle doit se lire.** Nina a un
        # jeton mort et un relevé de trois semaines ; sans passé, son écran de
        # paliers montrait un refus sur une créatrice qui n'avait jamais rien
        # fait — un obstacle sans histoire ne s'explique pas. Deux
        # collaborations tenues, avant que son compte se dégrade : c'est la
        # chronologie réelle, et `marquer_les_etats_de_compte` passe après.
        ("approuvee", timedelta(weeks=6), "expiree", WYNWOOD),
        ("approuvee", timedelta(weeks=4, days=2), "expiree", OCEAN),
        # Sofia est en revue de cohérence, pas en faute : une collaboration
        # tenue le dit mieux qu'un écran vide.
        ("approuvee", timedelta(weeks=5, days=4), "en_controle", BRICKELL),
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
    reservations += await _la_journee_de_chaque_salon(
        session,
        createurs=createurs,
        confirmer=confirmer_jusqu_au_bout,
        caissier_de=caissier_de,
    )

    await session.flush()
    return reservations, contreparties


async def _la_journee_de_chaque_salon(
    session: AsyncSession,
    *,
    createurs: dict,
    confirmer,
    caissier_de,
) -> int:
    """Une journée qui se raconte, dans **chaque** salon actif.

    **Ce que remplaçait une seule ligne.** L'écran « Aujourd'hui » montrait une
    réservation par salon : exact, et illisible comme démonstration — on n'y
    voit ni ce qui vient d'arriver, ni ce qui reste à trancher, ni ce qui est
    déjà fait. Une journée de salon n'est pas une ligne.

    **Ce qu'elle contient maintenant**, dans l'ordre des créneaux réels du jour :

    - les créneaux **déjà passés** portent ce qui a eu lieu — des prestations
      consommées au comptoir, et une annulation ;
    - les créneaux **à venir** portent ce qui attend — des confirmées, et chez
      un salon qui valide, des demandes **à trancher**.

    **Les décisions se posent sur l'avenir, jamais sur le passé.** Une demande
    dont l'heure est dépassée ne s'accepte pas — `trancher` lève
    `CreneauDepasse`, et c'est une garde du produit. Semé à 22 h, l'ancien jeu
    posait ses demandes derrière nous : elles s'affichaient « à trancher » et
    aucun bouton ne fonctionnait. La journée montrait un écran sur lequel on ne
    peut rien faire, ce qui est pire qu'un écran vide.

    **Le salon d'ouverture est plus fourni que les autres.** C'est celui qu'on
    montre ; les trois autres portent de quoi ne pas être vides, sans faire
    croire que tous les salons de Miami sont pleins.

    **Les créneaux viennent de la disponibilité, jamais posés.** Le nombre de
    lignes s'adapte donc à ce que le salon ouvre vraiment : un salon qui ferme
    tôt en porte moins, et c'est vrai.
    """
    posees = 0
    maintenant = datetime.now(UTC)

    actifs = (
        await session.scalars(
            sa.select(Business)
            .where(Business.status == BusinessStatus.ACTIVE)
            .order_by(Business.name)
        )
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

        fuseau = ZoneInfo(business.timezone)
        debut_du_jour = datetime.combine(
            maintenant.astimezone(fuseau).date(), time.min, tzinfo=fuseau
        )
        creneaux = [
            c.starts_at
            for c in await availability_service.creneaux_libres(
                session,
                business_id=business.id,
                catalog_item_id=offre.catalog_item_id,
                depuis=debut_du_jour,
                horizon=timedelta(days=1),
            )
        ]
        if not creneaux:
            print(f"  aucun créneau aujourd'hui chez {business.name} : ses horaires font foi")
            continue

        passes = [c for c in creneaux if c < maintenant]
        a_venir = [c for c in creneaux if c >= maintenant]
        if not passes and not a_venir:
            print(f"  aucun créneau aujourd'hui chez {business.name}")
            continue

        # Le salon d'ouverture porte la journée qu'on montre ; les autres, de
        # quoi ne pas être vides. `ampleur` s'applique aux deux moitiés.
        ampleur = 4 if business.name == OCEAN else 1

        # **Le passé, étalé plutôt que groupé.** Prendre les premiers créneaux
        # mettrait tout à l'ouverture ; on prélève à intervalle régulier pour
        # que la journée se lise comme une journée.
        def _repartir(source: list[datetime], combien: int) -> list[datetime]:
            if not source or combien <= 0:
                return []
            combien = min(combien, len(source))
            pas = max(1, len(source) // combien)
            return source[::pas][:combien]

        # **Les deux moitiés se servent dans les créneaux à venir.** Ce qui a
        # « déjà eu lieu » est mené devant nous puis reposé sur une heure du
        # matin : le produit refuse d'accorder une heure dépassée, et c'est
        # cette garde qui laissait la journée pleine de demandes intranchables.
        # **Ce qui a déjà eu lieu se mène sur les créneaux de demain.**
        #
        # Les mener sur ceux d'aujourd'hui liait la journée à l'heure du semis :
        # semé à 18 h il ne restait que trois créneaux, les trois partaient en
        # « déjà eu lieu », et l'écran n'avait plus rien à trancher. Semé à 9 h
        # l'inverse. Une démonstration ne peut pas dépendre de l'heure à
        # laquelle on la prépare.
        #
        # Demain a toujours une journée entière. Les lignes y sont menées à leur
        # terme puis reposées sur les heures d'aujourd'hui — voir
        # `_deplacer_le_creneau`, et la garde qu'il contourne sans la casser.
        demain = debut_du_jour + timedelta(days=1)
        creneaux_de_demain = [
            c.starts_at
            for c in await availability_service.creneaux_libres(
                session,
                business_id=business.id,
                catalog_item_id=offre.catalog_item_id,
                depuis=demain,
                horizon=timedelta(days=1),
            )
        ]
        heures_passees = _repartir(passes, ampleur)
        menes_sur = _repartir(creneaux_de_demain, len(heures_passees))

        # **Ce qui attend se prend sur demain quand aujourd'hui est fini.** La
        # file « à trancher » de la journée porte les décisions **toutes dates
        # confondues** — une demande pour demain s'y lit et s'y tranche. Sans ce
        # repli, un jeu semé après la fermeture n'avait aucune décision à rendre,
        # et l'écran perdait ce qui fait sa raison d'être. Les créneaux de demain
        # servent après ceux qu'on a déjà pris pour le passé.
        restants = [c for c in creneaux_de_demain if c not in menes_sur]
        attendues = _repartir(a_venir, ampleur) or _repartir(restants, ampleur)

        posees += await _poser_ce_qui_a_eu_lieu(
            session,
            business=business,
            offre=offre,
            menes_sur=menes_sur,
            reposes_sur=heures_passees,
            createurs=createurs,
            confirmer=confirmer,
            caissier_de=caissier_de,
        )
        posees += await _poser_les_a_venir(
            session,
            business=business,
            offre=offre,
            creneaux=attendues,
            createurs=createurs,
            confirmer=confirmer,
        )

    return posees


async def _poser_ce_qui_a_eu_lieu(
    session: AsyncSession,
    *,
    business: Business,
    offre: TierOffer,
    menes_sur: list[datetime],
    reposes_sur: list[datetime],
    createurs: dict,
    confirmer,
    caissier_de,
) -> int:
    """Ce que la journée a déjà vu : des prestations servies, et une annulation.

    La consommation passe par le comptoir — code marqué, puis `consommer` —,
    donc chaque ligne ouvre une contrepartie réelle. C'est ce qui alimente
    l'onglet des publications sans rien y poser à la main.

    **Menée sur un créneau à venir, puis reposée sur l'heure qu'elle aurait
    eue.** Voir `_deplacer_le_creneau` : le produit refuse d'accorder une heure
    dépassée, donc une ligne posée directement dans le matin resterait « à
    trancher » et ne se trancherait pas.
    """
    posees = 0
    roulement = [createurs["confirmee"], createurs["plafonnee"]]

    for rang, creneau in enumerate(menes_sur):
        createur, compte = roulement[rang % len(roulement)]
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
            print(f"  journée écartée chez {business.name} ({type(erreur).__name__})")
            continue

        await confirmer(booking, createur.id)
        posees += 1

        # **La dernière du matin est annulée**, et une seule : une journée sans
        # aucune annulation ne montre pas comment elle se lit, deux de suite
        # feraient croire à un salon qu'on fuit.
        if rang == len(menes_sur) - 1 and len(menes_sur) > 1:
            await booking_states.annuler(session, booking=booking, creator_id=createur.id)
        else:
            code = await redemption_service.code_du_booking(session, booking=booking)
            caissier = await caissier_de(business.id)
            if code is not None:
                await redemption_service.marquer_consomme(
                    session, redemption_code_id=code.id, par_user_id=caissier.user_id
                )
                await booking_states.consommer(session, booking=booking, actor=caissier)

        await _deplacer_le_creneau(session, booking, vers=reposes_sur[rang])

    return posees


async def _poser_les_a_venir(
    session: AsyncSession,
    *,
    business: Business,
    offre: TierOffer,
    creneaux: list[datetime],
    createurs: dict,
    confirmer,
) -> int:
    """Ce qui attend : des confirmées, et chez un salon qui valide, des
    décisions à rendre.

    **Sur des créneaux à venir, et c'est tout le point.** Une demande dont
    l'heure est passée s'affiche « à trancher » et refuse les deux boutons ;
    posée devant nous, elle se tranche vraiment pendant la démonstration.
    """
    posees = 0
    roulement = [createurs["confirmee"], createurs["plafonnee"]]

    for rang, creneau in enumerate(creneaux):
        createur, compte = roulement[rang % len(roulement)]
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
            print(f"  créneau à venir écarté chez {business.name} ({type(erreur).__name__})")
            continue

        # **La première reste à trancher chez un salon qui valide.** On confirme
        # côté créatrice — ce qui la met en attente du commerce — et on n'accorde
        # pas. Chez un salon sans validation, la même confirmation la place
        # directement en `confirmed` : c'est le produit qui décide, pas le semis.
        if rang == 0 and business.requires_booking_approval:
            await booking_states.confirmer(session, booking=booking, creator_id=createur.id)
        else:
            await confirmer(booking, createur.id)
        posees += 1

    return posees


async def prochain_creneau_reservable(
    session: AsyncSession,
    business: Business,
    catalog_item_id: uuid.UUID,
    *,
    maintenant: datetime,
) -> tuple[datetime, bool] | None:
    """Le prochain créneau libre, et s'il tombe encore aujourd'hui.

    **La journée courante d'abord, même derrière nous.** Le choix ne regardait
    qu'en avant : semé à 22 h, tous les salons de Miami sont fermés, et
    dix-neuf réservations sur vingt tombaient au lendemain. L'écran
    « Aujourd'hui » — le premier qu'on ouvre en démonstration — était donc vide
    à l'heure où on le montre.

    On prend maintenant le prochain créneau **du jour**, et à défaut le dernier
    créneau **déjà passé du même jour**. Une réservation dans le passé proche
    n'est pas un artifice : c'est ce qu'une journée de salon contient à 22 h.

    **Ce qu'un créneau passé empêche, et ce qu'il n'empêche pas.** La
    réservation se crée et la créatrice la confirme ; seul l'accord du commerce
    refuse une heure dépassée, à juste titre — `trancher` lève `CreneauDepasse`,
    et c'est une garde du produit qu'on ne contourne pas pour faire joli. Chez
    un salon en validation, la ligne reste donc en attente : c'est un état vrai,
    que la journée affiche, et qui montre exactement ce qui arrive quand on ne
    tranche pas à temps.

    **Jamais de repli sur demain.** Un salon sans le moindre créneau
    aujourd'hui — fermé ce jour-là — rend `None`, et l'appelant le dit. Poser
    une réservation au lendemain remplissait une journée que personne ne
    regarde en démonstration.

    `maintenant` est un argument et non `datetime.now()` : c'est ce qui permet
    d'éprouver le choix à six heures du matin comme à minuit moins une, sans
    attendre l'heure qu'il faut.
    """
    fuseau = ZoneInfo(business.timezone)
    debut_du_jour = datetime.combine(maintenant.astimezone(fuseau).date(), time.min, tzinfo=fuseau)
    fin_du_jour = debut_du_jour + timedelta(days=1)

    a_venir = await _premier_creneau(session, business.id, catalog_item_id, depuis=maintenant)
    if a_venir is not None and a_venir < fin_du_jour:
        return a_venir, True

    # La journée est finie chez ce salon : on redescend à ce qu'elle contenait.
    # `limite` n'est pas posée — il faut le **dernier** créneau d'avant
    # maintenant, donc les parcourir tous, et une journée en fait quelques
    # dizaines.
    passes = [
        creneau.starts_at
        for creneau in await availability_service.creneaux_libres(
            session,
            business_id=business.id,
            catalog_item_id=catalog_item_id,
            depuis=debut_du_jour,
            horizon=fin_du_jour - debut_du_jour,
        )
        if creneau.starts_at < maintenant
    ]
    if not passes:
        return None
    return max(passes), True


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


async def poser_les_favoris(session: AsyncSession, createurs: dict) -> int:
    """Des cœurs posés, dont un devenu irréservable.

    **Une liste de favoris vide ne montre pas l'écran**, elle montre son état
    vide — qui existe déjà ailleurs dans le jeu. Ce que la liste doit montrer,
    ce sont ses quatre états et surtout celui qui appelle une conduite : la
    prestation gardée qui n'est plus à portée.

    **L'irréservable s'obtient en retirant l'offre**, pas en posant un état. Le
    salon ferme le palier par lequel la prestation était ouverte ; le favori
    reste, et l'écran le rend `hors_palier` avec le palier qui le rouvrirait.
    C'est le mécanisme du produit qui produit l'état, comme partout ailleurs.

    Deux créatrices, parce qu'une liste qui n'appartient qu'à une seule ne dit
    pas si l'écran lit bien celle qui regarde.
    """
    from app.services import favorites as favorites_service

    confirmee, _ = createurs["confirmee"]
    plafonnee, _ = createurs["plafonnee"]

    async def articles_de(nom_du_salon: str, combien: int) -> list[CatalogItem]:
        return list(
            await session.scalars(
                sa.select(CatalogItem)
                .join(Business, Business.id == CatalogItem.business_id)
                .join(TierOffer, TierOffer.catalog_item_id == CatalogItem.id)
                .where(
                    Business.name == nom_du_salon,
                    CatalogItem.is_available.is_(True),
                    CatalogItem.archived_at.is_(None),
                    TierOffer.is_active.is_(True),
                )
                .order_by(CatalogItem.created_at)
                .distinct()
                .limit(combien)
            )
        )

    poses = 0
    for salon, combien, qui in (
        (OCEAN, 2, confirmee),
        (BRICKELL, 1, confirmee),
        (WYNWOOD, 1, plafonnee),
    ):
        for article in await articles_de(salon, combien):
            await favorites_service.ajouter(session, creator_id=qui.id, catalog_item_id=article.id)
            poses += 1

    # **Celui qui n'est plus à portée.** Le salon retire l'offre du palier par
    # lequel l'article était ouvert : c'est un geste que le produit permet, et
    # c'est lui qui produit l'état — jamais une valeur posée sur le favori.
    #
    # **L'état obtenu est `fermee`, pas `hors_palier`**, et la nuance compte :
    # retirer toutes les offres d'un article, c'est le salon qui le ferme, et
    # `_etat` le dit dans cet ordre-là. `hors_palier` demanderait un article
    # encore offert, à un palier que la créatrice n'atteint pas — le jeu en
    # produit par ailleurs, chez les salons qui ne composent qu'en haut.
    #
    # Les deux disent « gardée, plus réservable » et appellent deux conduites
    # différentes : attendre la réouverture, ou monter d'un palier. C'est ce que
    # la liste doit montrer, et elle montre les deux.
    a_fermer = (await articles_de(WYNWOOD, 2))[-1:]
    for article in a_fermer:
        await favorites_service.ajouter(
            session, creator_id=confirmee.id, catalog_item_id=article.id
        )
        poses += 1
        await session.execute(
            sa.update(TierOffer)
            .where(TierOffer.catalog_item_id == article.id)
            .values(is_active=False)
        )
        print(f"  favori devenu irréservable : « {article.name} », offre retirée par le salon")

    await session.flush()
    return poses


async def poser_les_fiches_de_terrain(session: AsyncSession) -> int:
    """Des fiches à tous les stades, et les deux voies de remise.

    **C'est l'écran de la fondatrice**, celui qu'elle ouvre après une tournée.
    Il était vide : aucune fiche, donc aucun des quatre états, et surtout aucune
    comparaison entre les deux méthodes de remise.

    Les quatre stades, et ce que chacun demande comme geste :

    - **préparée, jamais ouverte** — le lien n'a pas été suivi. Revisiter ;
    - **ouverte, non activée** — le salon a regardé et n'a pas franchi le pas.
      Relancer, et c'est l'état qui coûte le plus cher à ignorer ;
    - **bloquée** — quelqu'un a buté sur l'engagement. Rien à relancer ;
    - **activée** — le salon a son compte, la visite a abouti.

    **Les deux canaux, pour que l'écart se voie.** Le QR se scanne devant le
    décideur présent ; le lien par courriel part quand le propriétaire n'est pas
    là. Un taux d'activation par voie ne compare deux méthodes que si les deux
    existent — sinon il compare une méthode à rien.

    Tout passe par les services : préparer, émettre, ouvrir, bloquer, prendre en
    main. Poser les colonnes à la main sauterait précisément la mécanique que
    cet écran sert à surveiller.
    """
    from app.core.config import get_settings
    from app.integrations.geocoding import ManualGeocoder
    from app.models import BusinessHandover
    from app.models.enums import HandoverChannel
    from app.schemas.business import BusinessCreate, CoordinatesPayload
    from app.services import handover as handover_service

    if get_settings().handover_base_url is None:
        # **Elle n'a jamais été posée, et c'est pourquoi cet écran était vide.**
        # Le lien de prise en main a besoin d'une adresse publique ; sans elle,
        # `emettre` refuse — à juste titre, un lien sans adresse ne mène nulle
        # part. Le semis le dit et continue plutôt que de tomber : le reste du
        # jeu ne dépend pas de cette variable.
        print(
            "  HANDOVER_BASE_URL absente : aucune fiche de terrain. "
            "L'écran de tournée restera vide — voir .env.example."
        )
        return 0

    admin = await session.scalar(sa.select(User).where(User.role == UserRole.ADMIN).limit(1))
    if admin is None:
        print("  aucun administrateur : pas de fiche de terrain")
        return 0

    fiches = (
        ("Sunset Nails Bar", HandoverChannel.QR, "preparee", None),
        ("Little Havana Barbers", HandoverChannel.EMAIL, "ouverte", "hola@havana.example"),
        ("Coral Way Massage", HandoverChannel.EMAIL, "bloquee", "info@coralway.example"),
        ("Design District Spa", HandoverChannel.QR, "activee", None),
    )

    posees = 0
    for rang, (nom, canal, stade, destination) in enumerate(fiches):
        fiche = await handover_service.preparer_la_fiche(
            session,
            payload=BusinessCreate(
                name=nom,
                category=BusinessCategory.BEAUTY,
                currency="USD",
                address=f"{700 + rang * 11} Coral Way, Miami FL",
                coordinates=CoordinatesPayload(longitude=-80.24 + rang / 100, latitude=25.75),
                timezone="America/New_York",
            ),
            prepare_par=admin,
            geocoder=ManualGeocoder(),
        )
        lien = await handover_service.emettre(
            session, business=fiche, emis_par=admin, canal=canal, destination=destination
        )
        posees += 1
        remise = await session.get(BusinessHandover, lien.handover_id)
        assert remise is not None

        if stade == "preparee":
            continue

        await handover_service.marquer_ouvert(session, handover=remise)
        if stade == "ouverte":
            continue

        if stade == "bloquee":
            await handover_service.marquer_bloque(session, handover=remise)
            continue

        await handover_service.prendre_en_main(
            session,
            handover=remise,
            email=f"terrain{rang}@bind.example",
            password=MOT_DE_PASSE,
            terms_version=get_settings().terms_version,
        )

    await session.flush()
    return posees


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

    reservations, contreparties = await composer_les_parcours(session, createurs)
    # **Après les parcours, et c'est la chronologie réelle.** Nina a eu un compte
    # qui marchait avant que son jeton meure ; l'ordre inverse lui interdisait de
    # réserver quoi que ce soit, et son écran de paliers montrait une créatrice
    # sans aucune histoire — un obstacle sans passé ne s'explique pas. La
    # dégradation se constate donc sur un compte qui a vécu.
    await marquer_les_etats_de_compte(session, createurs)
    await recalculer_les_scores(session, createurs)
    await vieillir_un_releve(session, createurs)
    favoris = await poser_les_favoris(session, createurs)
    fiches = await poser_les_fiches_de_terrain(session)
    jobs = await poser_les_jobs(session)
    abonnements = await abonner_les_commerces(session)

    return ResumeDemo(
        createurs=len(createurs),
        reservations=reservations,
        contreparties=contreparties,
        favoris=favoris,
        fiches=fiches,
        jobs=jobs,
        photos=photos,
        plans=plans,
        abonnements=abonnements,
    )
