"""La galerie photos d'un commerce.

Le téléversement est **séparé** de l'ajout, comme pour les preuves : déposer un
fichier peut échouer pour des raisons qui n'ont rien à voir avec la galerie —
réseau, poids, format — et les mêler ferait remonter « galerie pleine » pour une
image trop lourde.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, File, UploadFile, status

from app.core.dependencies import CurrentBusiness, SessionDep, require_role
from app.core.errors import ErrorCode, api_error
from app.models.enums import UserRole
from app.schemas.business_photos import (
    OrdreDeLaGalerie,
    PhotoAjoutee,
    PhotoDuCommerceRead,
)
from app.services import business_photos as service
from app.services import storage

router = APIRouter(
    prefix="/business/{business_id}/photos",
    tags=["business-photos"],
    dependencies=[Depends(require_role(UserRole.BUSINESS_MEMBER))],
)

#: Les signatures acceptées. Le type déclaré par l'appelant n'est pas consulté :
#: il est fourni par l'appelant, donc il ne prouve rien.
SIGNATURES: tuple[bytes, ...] = (b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n", b"RIFF")

#: La taille des tranches de lecture, comme pour les preuves.
TRANCHE = 64 * 1024

#: Le plafond d'une photo de galerie. Plus généreux qu'une preuve — c'est une
#: image de vitrine, pas une capture d'écran — et assez bas pour qu'une photo
#: sortie d'un reflex ne passe pas telle quelle.
PLAFOND = 8 * 1024 * 1024


@router.get("", response_model=list[PhotoDuCommerceRead])
async def lister(business: CurrentBusiness, session: SessionDep) -> list[PhotoDuCommerceRead]:
    """La galerie, dans l'ordre choisi par le commerce."""
    return [
        PhotoDuCommerceRead.model_validate(photo)
        for photo in await service.lister(session, business.id)
    ]


@router.post("/uploads", status_code=status.HTTP_201_CREATED)
async def televerser(
    business: CurrentBusiness,
    fichier: Annotated[UploadFile, File()],
) -> dict[str, str]:
    """Dépose le fichier et rend sa clé. Rien n'est encore dans la galerie."""
    morceaux: list[bytes] = []
    total = 0

    while tranche := await fichier.read(TRANCHE):
        total += len(tranche)
        if total > PLAFOND:
            # On s'arrête à la lecture : accepter le flux entier pour le
            # refuser après ferait dépendre la mémoire du serveur de ce que
            # l'appelant envoie.
            raise api_error(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, ErrorCode.PROOF_TOO_LARGE)
        morceaux.append(tranche)

    contenu = b"".join(morceaux)
    if not contenu:
        raise api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, ErrorCode.VALIDATION_FAILED)
    if not contenu.startswith(SIGNATURES):
        raise api_error(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, ErrorCode.PROOF_UNSUPPORTED_TYPE)

    cle = await storage.deposer(contenu, prefixe=f"{service.PREFIXE}/{business.id}")
    return {"storage_key": cle}


@router.post("", response_model=PhotoDuCommerceRead, status_code=status.HTTP_201_CREATED)
async def ajouter(
    business: CurrentBusiness, session: SessionDep, payload: PhotoAjoutee
) -> PhotoDuCommerceRead:
    """Ajoute une photo déjà déposée, à la fin de la galerie."""
    try:
        photo = await service.ajouter(
            session,
            business_id=business.id,
            storage_key=payload.storage_key,
            alt_text=payload.alt_text,
        )
    except service.GaleriePleine:
        raise api_error(status.HTTP_409_CONFLICT, ErrorCode.GALLERY_FULL) from None

    await session.commit()
    return PhotoDuCommerceRead.model_validate(photo)


@router.put("/order", response_model=list[PhotoDuCommerceRead])
async def reordonner(
    business: CurrentBusiness, session: SessionDep, payload: OrdreDeLaGalerie
) -> list[PhotoDuCommerceRead]:
    """Impose l'ordre complet de la galerie."""
    try:
        photos = await service.reordonner(session, business_id=business.id, ordre=payload.photos)
    except service.PhotoIntrouvable:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, ErrorCode.VALIDATION_FAILED
        ) from None

    await session.commit()
    return [PhotoDuCommerceRead.model_validate(photo) for photo in photos]


@router.delete("/{photo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def retirer(business: CurrentBusiness, session: SessionDep, photo_id: str) -> None:
    """Retire une photo de la fiche. Le fichier, lui, reste au dépôt."""
    import uuid as _uuid

    try:
        await service.retirer(session, business_id=business.id, photo_id=_uuid.UUID(photo_id))
    except (service.PhotoIntrouvable, ValueError):
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.VALIDATION_FAILED) from None

    await session.commit()
