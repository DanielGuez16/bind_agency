"""Sert les fichiers de marque commis au dépôt.

**Un fichier commis, jamais un dépôt d'objets.** Le logo des emails ne change
pas d'un déploiement à l'autre et ne dépend d'aucun compte : le servir depuis
`app/assets/` évite de faire dépendre l'affichage de la marque d'un
compartiment S3 configuré, et lui donne la même adresse dans tous les
environnements — développement compris, où le dépôt d'objets tourne en
mémoire ou sur disque.

**Chargé une fois, au premier appel.** Le fichier ne bouge pas pendant la vie
du processus ; le relire à chaque requête coûterait un accès disque pour rien.
"""

from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, Response, status

from app.core.errors import ErrorCode, api_error

router = APIRouter(prefix="/assets", tags=["assets"])

_RACINE = Path(__file__).resolve().parent.parent / "assets"

#: Les seuls fichiers servis. Une liste fermée, comme celle des préfixes
#: publics du dépôt d'objets : un nom qui n'y figure pas rend 404, jamais un
#: accès qui devine un chemin sur le disque.
_FICHIERS = {
    "bind-logo-email.png": "image/png",
}


@lru_cache(maxsize=len(_FICHIERS))
def _lire(nom: str) -> bytes:
    return (_RACINE / nom).read_bytes()


@router.get("/{nom}")
async def read_asset(nom: str) -> Response:
    type_media = _FICHIERS.get(nom)
    if type_media is None:
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)

    return Response(
        content=_lire(nom),
        media_type=type_media,
        # Le nom est fixe et commis : le contenu ne change jamais sous lui
        # sans un déploiement, qui sert de nouveaux octets sous une nouvelle
        # image du processus — le cache long ne sert donc jamais un fichier
        # périmé.
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )
