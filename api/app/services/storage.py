"""Archivage d'une publication, au meilleur niveau atteignable.

L'ordre de préférence de `SPEC.md` §5.3 est appliqué **ici et nulle part
ailleurs** : l'appelant ne choisit pas son niveau de preuve, sinon tout le monde
enverrait une capture d'écran. On tente le meilleur, on retombe sur le suivant.

1. lecture du média sur le compte connecté, via l'API de la plateforme
2. récupération depuis l'URL publique fournie
3. capture d'écran envoyée par le créateur

**Le stockage objet réel n'est pas branché.** Cette phase pose l'ordre, la
descente de niveau, l'empreinte et l'horodatage ; le dépôt du fichier chez un
fournisseur compatible S3 est une tâche d'infrastructure qui viendra avec le
déploiement. En attendant, `deposer` rend une clé déterministe sans écrire
ailleurs qu'en base — et le jour où le fournisseur existe, cette fonction est la
seule à changer.
"""

import hashlib
import uuid
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import SocialAccount
from app.models.enums import CaptureMethod
from app.services.proof import MediaCapture


async def deposer(contenu: bytes, *, prefixe: str) -> str:
    """Dépose le fichier et rend sa clé.

    Clé dérivée du contenu : deux dépôts du même fichier partagent la leur, et
    le stockage ne double pas. Le préfixe range par nature, ce qui rend une
    politique de rétention écrivable plus tard sans relire les lignes.
    """
    empreinte = hashlib.sha256(contenu).hexdigest()
    jour = datetime.now(UTC).date().isoformat()
    return f"{prefixe}/{jour}/{empreinte}"


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
    """Niveau 2 : récupération depuis l'URL publique.

    Non branché non plus : télécharger un média depuis une URL fournie par un
    tiers demande des garde-fous — taille maximale, types acceptés, refus des
    adresses internes — qui appartiennent à la tâche d'infrastructure, pas à
    celle-ci. Le brancher à moitié ouvrirait une porte de requête côté serveur.
    """
    if not source_url:
        return None
    return None


async def _par_capture_ecran(screenshot_key: str | None) -> MediaCapture | None:
    """Niveau 3 : ce que le créateur a envoyé.

    Le seul niveau réellement disponible aujourd'hui. La capture est déjà
    déposée — le téléversement est un flux à part — et on n'en retient ici que
    la clé et de quoi calculer l'empreinte.
    """
    if not screenshot_key:
        return None

    # Le contenu n'est pas relu depuis le stockage : la clé le désigne, et
    # l'empreinte est calculée sur elle en attendant le fournisseur réel. C'est
    # une empreinte de désignation, pas de contenu — la distinction disparaît
    # dès que `deposer` écrit vraiment.
    return MediaCapture(
        capture_method=CaptureMethod.UPLOAD,
        contenu=screenshot_key.encode(),
        screenshot_key=screenshot_key,
    )
