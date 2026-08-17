"""Archivage d'une publication, au meilleur niveau atteignable.

L'ordre de préférence de `SPEC.md` §5.3 est appliqué **ici et nulle part
ailleurs** : l'appelant ne choisit pas son niveau de preuve, sinon tout le monde
enverrait une capture d'écran. On tente le meilleur, on retombe sur le suivant.

1. lecture du média sur le compte connecté, via l'API de la plateforme
2. récupération depuis l'URL publique fournie
3. capture d'écran envoyée par le créateur

**Le dépôt d'objets est derrière une interface**, choisie par configuration :
mémoire pour les tests, disque pour le développement et la démonstration, S3 le
jour où les identifiants existent. Le service ne sait pas laquelle il tient, et
il n'existe aucune branche conditionnelle sur le mode.

**Le niveau 1 attend `fetch_media`** sur l'interface de plateforme. Il arrivera
avec le relevé des publications ; rendre `None` fait descendre au niveau
suivant, ce qui est le comportement correct et pas un contournement.
"""

import logging
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations import images, media_fetch
from app.integrations.object_store import ObjectStoreError, get_object_store
from app.integrations.providers import fournisseur_de
from app.integrations.social import SocialProviderError
from app.models import SocialAccount
from app.models.enums import CaptureMethod, SocialAccountStatus
from app.services.proof import MediaCapture

logger = logging.getLogger(__name__)


#: Le suffixe d'une vignette, accolé à la clé de son original.
#:
#: **Dérivée plutôt que stockée.** Une colonne de plus par table portant une
#: image — galerie, carte, prestation, couverture — se remplirait à la migration
#: et se désynchroniserait au premier dépôt qui échoue à mi-chemin. Le suffixe se
#: recompose partout à partir de la clé qu'on a déjà, et l'absence de vignette
#: est un cas prévu, pas une incohérence.
SUFFIXE_VIGNETTE = "@vignette"


def cle_de_vignette(cle: str) -> str:
    """La clé de la vignette d'une image. Pure : elle ne consulte aucun dépôt."""
    return f"{cle}{SUFFIXE_VIGNETTE}"


def cle_d_origine(cle: str) -> str:
    """L'inverse. Rend la clé telle quelle quand ce n'en est pas une vignette."""
    return cle.removesuffix(SUFFIXE_VIGNETTE)


async def deposer(contenu: bytes, *, prefixe: str) -> str:
    """Range le fichier chez le fournisseur déclaré et rend sa clé."""
    return await get_object_store().deposer(contenu, prefixe=prefixe)


async def deposer_une_image(contenu: bytes, *, prefixe: str) -> str:
    """Range l'image **et sa vignette**, et rend la clé de l'original.

    **Au dépôt, jamais au service.** Une photo de prestation partait vers le fil
    telle qu'elle sortait du téléphone : quatre mille pixels pour un cadre de
    cent cinquante points, à chaque affichage, pour tout le monde. Réduire une
    fois ici le paie une fois pour toutes ; réduire à la lecture demanderait un
    décodeur sur le chemin chaud, un cache, et une invalidation.

    **La vignette manquante n'échoue jamais.** Pillow absent, image illisible,
    dépôt qui refuse le second objet : dans les trois cas l'original est déjà
    rangé, et le refuser reviendrait à perdre une photo que le commerce vient
    d'envoyer pour une raison qui ne le regarde pas. La route des médias retombe
    sur l'original quand la vignette n'existe pas.
    """
    # **L'original est borné avant d'être rangé.** Il ne l'était pas : on
    # rangeait les quatre mille pixels du téléphone. Tant que le fil servait la
    # vignette, personne ne le payait ; le mur sert l'original, et trois salons
    # par écran à cette taille rendraient le défilement impraticable.
    #
    # **Seulement ce qui dépasse.** Réencoder une image déjà dans les clous la
    # dégraderait sans rien gagner — une page de carte en PNG net deviendrait un
    # JPEG, et ses prix s'y liraient moins bien. Ce qui passe la borne ressort
    # octet pour octet.
    #
    # Le repli est celui de la vignette, et pour la même raison : une image
    # illisible ou un Pillow absent rangent l'original tel quel plutôt que de
    # perdre une photo que le commerce vient d'envoyer.
    borne = images.borner_l_original(contenu) or contenu
    cle = await get_object_store().deposer(borne, prefixe=prefixe)

    reduite = images.vignette(borne)
    if reduite is None:
        return cle

    try:
        await get_object_store().deposer_sous(reduite, cle=cle_de_vignette(cle))
    except ObjectStoreError:
        # L'original est rangé : c'est ce qui compte. La vignette se
        # reconstruira au prochain dépôt de la même image, et d'ici là la route
        # des médias sert l'original.
        logger.warning("vignette non déposée", extra={"cle": cle})

    return cle


async def archiver_la_publication(
    session: AsyncSession,
    *,
    social_account_id: uuid.UUID,
    source_url: str | None,
    screenshot_key: str | None,
) -> MediaCapture | None:
    """Tente les trois niveaux dans l'ordre, rend le premier qui aboutit.

    Rend `None` quand aucun n'aboutit : c'est un échec d'archivage, pas un refus
    métier, et l'appelant doit le distinguer — le créateur n'a rien fait de mal,
    il faut lui demander autre chose.
    """
    capture = await _par_api(session, social_account_id, source_url)
    if capture is not None:
        return capture

    capture = await _par_url(source_url)
    if capture is not None:
        return capture

    return await _par_capture_ecran(screenshot_key)


async def _par_api(
    session: AsyncSession, social_account_id: uuid.UUID, source_url: str | None = None
) -> MediaCapture | None:
    """Niveau 1 : la plateforme atteste elle-même.

    **Il faut une adresse pour désigner la publication.** Sans elle, on ne sait
    pas quoi demander à la plateforme — c'est pourquoi le niveau 1 dépend de ce
    que le créateur fournit au niveau 2, et non l'inverse. Une capture d'écran
    seule ne pourra jamais être vérifiée : elle ne désigne rien.

    **Une publication introuvable descend d'un niveau, sans bruit.** C'est le
    cas normal d'une story de plus de vingt-quatre heures, pas une panne. Un
    jeton refusé aussi : la contrepartie sera attestée, et le compte expiré se
    traite ailleurs, sur son propre écran.
    """
    compte = await session.get(SocialAccount, social_account_id)
    if (
        compte is None
        or source_url is None
        or compte.status is not SocialAccountStatus.ACTIVE
        or compte.access_token_encrypted is None
    ):
        return None

    try:
        async with fournisseur_de(compte.platform) as provider:
            publication = await provider.fetch_media(
                compte.access_token_encrypted, permalink=source_url
            )
    except SocialProviderError:
        # `PublicationIntrouvable` et `SocialAuthError` en héritent toutes deux.
        # Aucune n'est un défaut du créateur, et aucune ne justifie de refuser
        # la preuve : on descend, et le dossier sera attesté.
        return None

    # Le fichier reste celui du niveau 2 : la vérification prouve **qui** a
    # publié **quoi** et **quand**, elle ne dispense pas d'archiver le contenu.
    # Sans archive, un dossier rouvert dans six mois n'a plus rien à montrer.
    # Le même téléchargement que le niveau 2, à dessein : ce qui distingue les
    # deux niveaux n'est pas la façon d'obtenir le fichier, c'est ce que la
    # plateforme a confirmé à côté.
    try:
        media = await media_fetch.recuperer(publication.permalink or source_url)
    except media_fetch.MediaFetchError:
        return None

    return MediaCapture(
        capture_method=CaptureMethod.API,
        contenu=media.contenu,
        media_key=await deposer(media.contenu, prefixe="proofs/api"),
        source_url=media.url_finale,
        platform_published_at=publication.published_at,
        extra={
            "platform_media_id": publication.media_id,
            "platform_author_id": publication.author_external_id,
            "platform_media_type": publication.media_type,
            "raw": publication.raw_payload,
        },
    )


async def _par_url(source_url: str | None) -> MediaCapture | None:
    """Niveau 2 : récupération depuis l'URL publique fournie par le créateur.

    **Un échec ne remonte pas.** Une URL morte, un type refusé, une adresse
    interne : dans tous les cas on descend au niveau 3. Le créateur a peut-être
    envoyé une capture, et le faire échouer parce que son lien a expiré le
    punirait de la mécanique.

    Une adresse refusée est journalisée comme tout le reste — c'est une
    tentative, pas forcément une attaque, et la distinguer demanderait de la
    voir se répéter.
    """
    if not source_url:
        return None

    try:
        media = await media_fetch.recuperer(source_url)
    except media_fetch.MediaFetchError:
        return None

    cle = await deposer(media.contenu, prefixe="proofs/url")
    return MediaCapture(
        capture_method=CaptureMethod.URL_FETCH,
        contenu=media.contenu,
        media_key=cle,
        source_url=media.url_finale,
    )


async def _par_capture_ecran(screenshot_key: str | None) -> MediaCapture | None:
    """Niveau 3 : ce que le créateur a envoyé.

    Le seul niveau réellement disponible aujourd'hui. La capture est déjà
    déposée — le téléversement est un flux à part — et on n'en retient ici que
    la clé et de quoi calculer l'empreinte.
    """
    if not screenshot_key:
        return None

    # Le contenu est relu depuis le dépôt : l'empreinte porte alors sur ce qui
    # a réellement été envoyé, et non sur la clé qui le désigne. Quand la
    # relecture échoue — clé inconnue, dépôt injoignable — on retombe sur la
    # clé : une preuve archivée avec une empreinte de désignation vaut mieux
    # qu'une soumission refusée pour une panne de stockage.
    contenu = await get_object_store().lire(screenshot_key)
    return MediaCapture(
        capture_method=CaptureMethod.UPLOAD,
        contenu=contenu if contenu is not None else screenshot_key.encode(),
        screenshot_key=screenshot_key,
    )
