"""La carte d'un commerce : ses pages, déposées par lui.

**Ce n'est pas la galerie.** La galerie montre le lieu, la carte se consulte :
deux gestes différents, donc deux routes différentes. Le mécanisme est le même —
téléverser, ajouter, ordonner, retirer — et il est recopié plutôt que partagé,
pour la raison écrite dans le service : un plafond relevé pour l'une n'a aucune
raison de bouger pour l'autre.

Le téléversement est **séparé** de l'ajout, comme pour la galerie et les
preuves : déposer un fichier peut échouer pour des raisons qui n'ont rien à voir
avec la carte — réseau, poids, format — et les mêler ferait remonter « carte
pleine » pour une image trop lourde.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, File, UploadFile, status

from app.core.dependencies import CurrentBusiness, SessionDep, require_role
from app.core.errors import ErrorCode, api_error
from app.models.enums import UserRole
from app.schemas.business_menu import (
    OrdreDeLaCarte,
    PageAjoutee,
    PageDeLaCarteRead,
)
from app.services import business_menu as service
from app.services import storage

router = APIRouter(
    prefix="/business/{business_id}/menu",
    tags=["business-menu"],
    dependencies=[Depends(require_role(UserRole.BUSINESS_MEMBER))],
)

#: Les signatures acceptées. Le type déclaré par l'appelant n'est pas consulté :
#: il est fourni par l'appelant, donc il ne prouve rien.
SIGNATURES: tuple[bytes, ...] = (b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n", b"RIFF")

#: La taille des tranches de lecture, comme pour les preuves.
TRANCHE = 64 * 1024

#: Le plafond d'une page de carte. Le même que la galerie : c'est la même
#: photo prise avec le même téléphone, et deux plafonds différents pour deux
#: dépôts identiques ne se retiendraient pas.
PLAFOND = 8 * 1024 * 1024


@router.get("", response_model=list[PageDeLaCarteRead])
async def lister(business: CurrentBusiness, session: SessionDep) -> list[PageDeLaCarteRead]:
    """La carte, dans l'ordre où elle se lit."""
    return [
        PageDeLaCarteRead.model_validate(page)
        for page in await service.lister(session, business.id)
    ]


@router.post("/uploads", status_code=status.HTTP_201_CREATED)
async def televerser(
    business: CurrentBusiness,
    fichier: Annotated[UploadFile, File()],
) -> dict[str, str]:
    """Dépose le fichier et rend sa clé. Rien n'est encore dans la carte."""
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


@router.post("", response_model=PageDeLaCarteRead, status_code=status.HTTP_201_CREATED)
async def ajouter(
    business: CurrentBusiness, session: SessionDep, payload: PageAjoutee
) -> PageDeLaCarteRead:
    """Ajoute une page déjà déposée, à la fin de la carte."""
    try:
        page = await service.ajouter(
            session,
            business_id=business.id,
            storage_key=payload.storage_key,
            alt_text=payload.alt_text,
        )
    except service.CartePleine:
        raise api_error(status.HTTP_409_CONFLICT, ErrorCode.MENU_FULL) from None

    await session.commit()
    return PageDeLaCarteRead.model_validate(page)


@router.put("/order", response_model=list[PageDeLaCarteRead])
async def reordonner(
    business: CurrentBusiness, session: SessionDep, payload: OrdreDeLaCarte
) -> list[PageDeLaCarteRead]:
    """Impose l'ordre complet de la carte."""
    try:
        pages = await service.reordonner(session, business_id=business.id, ordre=payload.pages)
    except service.PageIntrouvable:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, ErrorCode.VALIDATION_FAILED
        ) from None

    await session.commit()
    return [PageDeLaCarteRead.model_validate(page) for page in pages]


@router.delete("/{page_id}", status_code=status.HTTP_204_NO_CONTENT)
async def retirer(business: CurrentBusiness, session: SessionDep, page_id: str) -> None:
    """Retire une page de la carte. Le fichier, lui, reste au dépôt.

    Retirer la dernière page ne referme aucune offre : la règle se vérifie à
    l'ouverture, et refermer derrière le commerce pendant qu'il réorganise sa
    carte lui ferait perdre sa composition sans un mot.
    """
    import uuid as _uuid

    try:
        await service.retirer(session, business_id=business.id, page_id=_uuid.UUID(page_id))
    except (service.PageIntrouvable, ValueError):
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.VALIDATION_FAILED) from None

    await session.commit()
