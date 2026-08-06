"""Import de carte.

**Aucun item n'est créé sans validation explicite du commerce.** Le
téléversement enregistre, l'extraction propose, la relecture corrige, et seule
la validation écrit. Quatre gestes, et le dernier est le seul qui touche au
catalogue.
"""

import uuid
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, Path, status

from app.core.dependencies import CurrentBusiness, CurrentUser, SessionDep, require_role
from app.core.errors import ErrorCode, api_error
from app.integrations.menu_extraction import get_extractor
from app.models.enums import UserRole
from app.schemas.menu_import import (
    LigneExtraiteRead,
    MenuImportCreate,
    MenuImportRead,
    ValidationDemande,
    ValidationRead,
)
from app.services import menu_import as service

router = APIRouter(
    prefix="/business/{business_id}/menu-imports",
    tags=["menu-imports"],
    dependencies=[Depends(require_role(UserRole.BUSINESS_MEMBER))],
)

_CODES = {
    service.ImportNotFound: (status.HTTP_404_NOT_FOUND, ErrorCode.MENU_IMPORT_NOT_FOUND),
    service.TransitionNotAllowed: (
        status.HTTP_409_CONFLICT,
        ErrorCode.MENU_IMPORT_TRANSITION_NOT_ALLOWED,
    ),
    service.DurationRequired: (
        status.HTTP_422_UNPROCESSABLE_CONTENT,
        ErrorCode.MENU_IMPORT_DURATION_REQUIRED,
    ),
}


def _traduire(error: service.MenuImportError):
    http_status, code = _CODES[type(error)]
    return api_error(http_status, code)


def _lire(import_) -> MenuImportRead:
    charge = import_.extracted_payload or {}
    return MenuImportRead(
        id=import_.id,
        business_id=import_.business_id,
        status=import_.status,
        mime_type=import_.mime_type,
        currency=charge.get("currency"),
        lignes=[LigneExtraiteRead(**ligne) for ligne in charge.get("lignes", [])],
        confiance_moyenne=service.confiance_moyenne(import_),
        reviewed_at=import_.reviewed_at,
        created_at=import_.created_at,
    )


@router.post("", response_model=MenuImportRead, status_code=status.HTTP_201_CREATED)
async def create_import(
    payload: MenuImportCreate, business: CurrentBusiness, session: SessionDep
) -> MenuImportRead:
    """Enregistre le téléversement. Rien n'est lu à ce stade."""
    import_ = await service.creer(
        session, business=business, file_key=payload.file_key, mime_type=payload.mime_type
    )
    await session.commit()
    return _lire(import_)


@router.post("/{import_id}/extract", response_model=MenuImportRead)
async def extract(
    import_id: Annotated[uuid.UUID, Path()], business: CurrentBusiness, session: SessionDep
) -> MenuImportRead:
    """Lit la carte et remplit la charge. Ne crée aucun item.

    Le contenu du fichier est relu depuis sa clé. En attendant le dépôt objet
    réel, le mode `manual` ne lit rien et rend une charge vide : le commerce
    saisit sa carte, ce qui reste le chemin de la phase 2.
    """
    try:
        import_ = await service.du_commerce(session, import_id=import_id, business_id=business.id)
    except service.MenuImportError as error:
        raise _traduire(error) from error

    async with httpx.AsyncClient() as client:
        try:
            import_ = await service.extraire(
                session,
                import_=import_,
                contenu=b"",
                extractor=get_extractor(client),
            )
        except service.MenuImportError as error:
            raise _traduire(error) from error

    await session.commit()
    return _lire(import_)


@router.get("/{import_id}", response_model=MenuImportRead)
async def read_import(
    import_id: Annotated[uuid.UUID, Path()], business: CurrentBusiness, session: SessionDep
) -> MenuImportRead:
    try:
        import_ = await service.du_commerce(session, import_id=import_id, business_id=business.id)
    except service.MenuImportError as error:
        raise _traduire(error) from error

    # Ouvrir l'écran de relecture est un geste, pas une lecture passive : il
    # dit que quelqu'un regarde.
    if import_.status.value == "extracted":
        await service.ouvrir_la_relecture(session, import_=import_)
        await session.commit()

    return _lire(import_)


@router.post("/{import_id}/validate", response_model=ValidationRead)
async def validate(
    import_id: Annotated[uuid.UUID, Path()],
    payload: ValidationDemande,
    business: CurrentBusiness,
    user: CurrentUser,
    session: SessionDep,
) -> ValidationRead:
    """Le seul geste qui touche au catalogue.

    Les items viennent des lignes **relues**, jamais de la charge extraite :
    valider en relisant la charge annulerait la relecture.
    """
    try:
        import_ = await service.du_commerce(session, import_id=import_id, business_id=business.id)
        crees = await service.valider(
            session,
            import_=import_,
            business=business,
            lignes=[
                service.LigneRevue(
                    name=ligne.name,
                    price_cents=ligne.price_cents,
                    description=ligne.description,
                    duration_minutes=ligne.duration_minutes,
                    requires_booking=ligne.requires_booking,
                    retenue=ligne.retenue,
                )
                for ligne in payload.lignes
            ],
            reviewed_by=user.id,
        )
    except service.MenuImportError as error:
        raise _traduire(error) from error

    await session.commit()
    return ValidationRead(import_id=import_.id, status=import_.status, items_crees=len(crees))
