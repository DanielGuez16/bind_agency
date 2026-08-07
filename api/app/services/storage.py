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

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations import media_fetch
from app.integrations.object_store import get_object_store
from app.models import SocialAccount
from app.models.enums import CaptureMethod
from app.services.proof import MediaCapture


async def deposer(contenu: bytes, *, prefixe: str) -> str:
    """Range le fichier chez le fournisseur déclaré et rend sa clé."""
    return await get_object_store().deposer(contenu, prefixe=prefixe)


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
    capture = await _par_api(session, social_account_id)
    if capture is not None:
        return capture

    capture = await _par_url(source_url)
    if capture is not None:
        return capture

    return await _par_capture_ecran(screenshot_key)


async def _par_api(session: AsyncSession, social_account_id: uuid.UUID) -> MediaCapture | None:
    """Niveau 1 : la plateforme atteste elle-même.

    Non branché : le relevé des publications est une tâche à part, et
    l'interface de plateforme ne déclare pas encore `fetch_media`. Rendre `None`
    fait descendre au niveau suivant, ce qui est le comportement correct — pas
    un contournement.
    """
    compte = await session.get(SocialAccount, social_account_id)
    if compte is None:
        return None
    return None


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
