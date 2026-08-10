"""Service des médias déposés.

**Seules les photos sont servies ici, jamais les preuves.** Le préfixe est
vérifié, et pas seulement documenté : une preuve de publication est la propriété
d'une collaboration, elle se lit par la route de contrepartie qui sait qui a le
droit de la voir. Une route de média qui servirait tout laisserait n'importe
quel porteur de jeton lire n'importe quelle preuve en devinant une clé — et les
clés sont des empreintes, donc devinables par quiconque possède le fichier.

**Publique, et c'est ce qui la rend utilisable.** Une photo de couverture est
montrée dans le fil à tout créateur : elle n'est pas confidentielle. L'exiger
authentifiée obligeait le composant image à porter un en-tête `Authorization`,
ce que `Image` ne sait faire ni sur le web ni uniformément sur mobile — et les
photos ne s'affichaient nulle part. Une route protégée dont personne ne peut se
servir ne protège rien, elle casse.

Ce qui reste protégé, ce sont les **preuves**, par le filtre de préfixe :
`proofs/api`, `proofs/url`, `proofs/upload` sont hors de portée de cette route
quel que soit le porteur. Les clés sont des empreintes de contenu — donc
devinables par quiconque possède déjà le fichier, jamais énumérables.

**Une clé absente rend 404, jamais 500.** Un dépôt qui a perdu un fichier n'est
pas une panne du produit : l'app affiche son repli d'image, qui existe pour
cela.
"""

from typing import Annotated

from fastapi import APIRouter, Path, Response, status

from app.core.errors import ErrorCode, api_error
from app.integrations.object_store import ObjectStoreError, get_object_store

router = APIRouter(prefix="/media", tags=["media"])

#: Les seuls préfixes servis. Tout le reste — `proofs/api`, `proofs/url`,
#: `proofs/upload` — est hors de portée de cette route.
PREFIXES_PUBLICS = ("photos/",)

#: Le type est déduit du contenu, jamais de la clé : la clé est une empreinte,
#: elle ne porte pas d'extension, et se fier à une extension fournie par
#: l'appelant permettrait de faire servir un script comme une image.
SIGNATURES = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"RIFF", "image/webp"),
)

#: MP4, dont la signature ne commence pas au premier octet : les quatre
#: premiers portent la taille de la boîte, `ftyp` vient ensuite. Sans cette
#: reconnaissance, la vidéo d'accueil partait en `application/octet-stream` et
#: aucun lecteur ne la jouait — le fichier était pourtant bien servi.
SIGNATURE_MP4 = (4, b"ftyp", "video/mp4")


def _type_du_contenu(contenu: bytes) -> str:
    for signature, mime in SIGNATURES:
        if contenu.startswith(signature):
            return mime

    decalage, motif, mime = SIGNATURE_MP4
    if contenu[decalage : decalage + len(motif)] == motif:
        return mime

    return "application/octet-stream"


@router.get("/{cle:path}")
async def read_media(cle: Annotated[str, Path()]) -> Response:
    if not cle.startswith(PREFIXES_PUBLICS):
        # 404 et non 403 : dire « existe mais interdit » apprendrait qu'une
        # preuve porte cette clé, ce qui est déjà trop.
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)

    try:
        contenu = await get_object_store().lire(cle)
    except ObjectStoreError as error:
        raise api_error(status.HTTP_503_SERVICE_UNAVAILABLE, ErrorCode.INTERNAL_ERROR) from error

    if contenu is None:
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)

    type_media = _type_du_contenu(contenu)
    return Response(
        content=contenu,
        media_type=type_media,
        # La clé est une empreinte du contenu : le même octet ne changera
        # jamais sous la même clé, et le cache peut être long sans risque.
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )
