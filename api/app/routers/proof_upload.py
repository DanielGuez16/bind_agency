"""Téléverser une capture de publication.

**Le maillon qui manquait.** La route de soumission attend une clé de stockage
déjà déposée ; rien ne permettait de déposer. La boucle s'arrêtait là : une
créatrice pouvait publier, et rien ne pouvait le prouver.

**Le poids se vérifie en lisant, pas sur l'en-tête déclaré.** `Content-Length`
est ce que l'appelant annonce ; un flux qui ment continue d'arriver. On lit par
tranches et on s'arrête net au dépassement — la mémoire du serveur ne dépend
alors pas de ce que quelqu'un veut bien annoncer.

**Le type vient du contenu.** Le nom du fichier et le type déclaré sont fournis
par l'appelant, donc ne prouvent rien. Les quatre premiers octets, si.

**Le dépôt va dans le compartiment privé**, par son préfixe. Rien à décider ici :
c'est le dépôt qui range, et `proofs/` n'est pas dans la liste des publics.
"""

from typing import Annotated

from fastapi import APIRouter, File, UploadFile, status
from pydantic import BaseModel

from app.core.config import get_settings
from app.core.dependencies import CurrentUser
from app.core.errors import ErrorCode, api_error
from app.integrations.object_store import ObjectStoreError, get_object_store
from app.models.enums import UserRole

router = APIRouter(tags=["proofs"])

#: Les signatures acceptées. Fermée : un format qu'on ne sait pas relire ne
#: sert pas de preuve, et l'accepter le ferait découvrir au contrôle.
SIGNATURES = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"RIFF", "image/webp"),
)

#: La taille des tranches de lecture. Assez grande pour ne pas multiplier les
#: allers-retours, assez petite pour que le dépassement se voie vite.
TRANCHE = 64 * 1024


class CaptureDeposee(BaseModel):
    """La clé à donner à la soumission. Jamais une adresse."""

    screenshot_key: str


@router.post(
    "/me/proof-uploads",
    response_model=CaptureDeposee,
    status_code=status.HTTP_201_CREATED,
)
async def televerser(
    user: CurrentUser,
    fichier: Annotated[UploadFile, File()],
) -> CaptureDeposee:
    """Dépose une capture et rend sa clé.

    Séparée de la soumission, et pas fusionnée avec elle : le téléversement peut
    échouer pour des raisons qui n'ont rien à voir avec la contrepartie —
    réseau, poids, format — et les mêler ferait remonter « preuve refusée » pour
    une image trop lourde.
    """
    if user.role is not UserRole.CREATOR:
        raise api_error(status.HTTP_403_FORBIDDEN, ErrorCode.INSUFFICIENT_ROLE)

    plafond = get_settings().proof_upload_max_bytes
    morceaux: list[bytes] = []
    total = 0

    while tranche := await fichier.read(TRANCHE):
        total += len(tranche)
        if total > plafond:
            # On s'arrête à la lecture, sans accumuler la suite : accepter le
            # flux entier pour le refuser après aurait fait dépendre la mémoire
            # du serveur de ce que l'appelant envoie.
            raise api_error(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, ErrorCode.PROOF_TOO_LARGE)
        morceaux.append(tranche)

    contenu = b"".join(morceaux)
    if not contenu:
        raise api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, ErrorCode.VALIDATION_FAILED)

    if not any(contenu.startswith(signature) for signature, _ in SIGNATURES):
        # Le type déclaré n'est pas consulté : il est fourni par l'appelant.
        raise api_error(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, ErrorCode.PROOF_UNSUPPORTED_TYPE)

    try:
        cle = await get_object_store().deposer(contenu, prefixe="proofs/upload")
    except ObjectStoreError as error:
        raise api_error(status.HTTP_502_BAD_GATEWAY, ErrorCode.PROOF_STORAGE_UNAVAILABLE) from error

    return CaptureDeposee(screenshot_key=cle)
