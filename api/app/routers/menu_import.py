"""Import de carte.

**Aucun item n'est créé sans validation explicite du commerce.** Le
téléversement enregistre, l'extraction propose, la relecture corrige, et seule
la validation écrit. Quatre gestes, et le dernier est le seul qui touche au
catalogue.
"""

import uuid
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, File, Path, UploadFile, status

from app.core.dependencies import CurrentBusiness, CurrentUser, SessionDep, require_role
from app.core.errors import ErrorCode, api_error
from app.integrations.menu_extraction import get_extractor
from app.integrations.object_store import get_object_store
from app.models.enums import UserRole
from app.schemas.menu_import import (
    LigneExtraiteRead,
    MenuImportCreate,
    MenuImportRead,
    ValidationDemande,
    ValidationRead,
)
from app.services import menu_import as service
from app.services import storage

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


#: Les signatures acceptées, et **le type déclaré n'est pas consulté** : il vient
#: de l'appelant, donc il ne prouve rien. Ce sont aussi les trois formats qu'un
#: modèle vision sait lire — envoyer autre chose reviendrait à payer un appel
#: pour un refus.
SIGNATURES: tuple[bytes, ...] = (b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n", b"RIFF")

#: Le type qu'on déclare au modèle, déduit de la signature et non de l'appelant.
TYPE_PAR_SIGNATURE = {
    b"\xff\xd8\xff": "image/jpeg",
    b"\x89PNG\r\n\x1a\n": "image/png",
    b"RIFF": "image/webp",
}

TRANCHE = 64 * 1024

#: Une photo de carte prise au téléphone, pas un scan d'imprimerie. Huit
#: mégaoctets suffisent largement, et au-delà c'est le réseau du salon qui
#: souffrirait avant nous.
PLAFOND = 8 * 1024 * 1024


@router.post("/uploads", status_code=status.HTTP_201_CREATED)
async def televerser(
    business: CurrentBusiness,
    fichier: Annotated[UploadFile, File()],
) -> dict[str, str]:
    """Dépose la photo de la carte et rend sa clé. Rien n'est encore lu.

    **C'est ce qui manquait pour que le mode terrain vaille son nom.** La
    création d'un import demande une clé de fichier, et aucune route ne
    permettait d'en obtenir une pour une carte : le dépôt objet ne recevait que
    des photos de galerie et des preuves. La fondatrice photographiait la carte
    au mur et n'avait nulle part où la mettre.

    Séparé de la création, comme pour la galerie et les preuves : déposer un
    fichier échoue pour des raisons — réseau, poids, format — qui n'ont rien à
    voir avec l'import.
    """
    morceaux: list[bytes] = []
    total = 0

    while tranche := await fichier.read(TRANCHE):
        total += len(tranche)
        if total > PLAFOND:
            # On s'arrête à la lecture : accepter le flux entier pour le refuser
            # après ferait dépendre la mémoire du serveur de ce qu'on envoie.
            raise api_error(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, ErrorCode.PROOF_TOO_LARGE)
        morceaux.append(tranche)

    contenu = b"".join(morceaux)
    if not contenu:
        raise api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, ErrorCode.VALIDATION_FAILED)

    signature = next((s for s in SIGNATURES if contenu.startswith(s)), None)
    if signature is None:
        raise api_error(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, ErrorCode.PROOF_UNSUPPORTED_TYPE)

    cle = await storage.deposer_une_image(contenu, prefixe=f"photos/cartes/{business.id}")
    return {"file_key": cle, "mime_type": TYPE_PAR_SIGNATURE[signature]}


@router.post("/{import_id}/extract", response_model=MenuImportRead)
async def extract(
    import_id: Annotated[uuid.UUID, Path()], business: CurrentBusiness, session: SessionDep
) -> MenuImportRead:
    """Lit la carte et remplit la charge. Ne crée aucun item.

    **Le contenu est relu depuis sa clé.** Il ne l'était pas : la route passait
    `b""` au modèle, avec un commentaire disant qu'on attendait le dépôt objet
    réel. Le dépôt existe depuis, et personne n'est revenu ici — en mode
    `manual` l'extraction rend une charge vide de toute façon, donc rien ne le
    signalait. Une photo de carte partait au modèle vide.
    """
    try:
        import_ = await service.du_commerce(session, import_id=import_id, business_id=business.id)
    except service.MenuImportError as error:
        raise _traduire(error) from error

    contenu = await get_object_store().lire(import_.file_key)
    if contenu is None:
        # La clé ne désigne plus rien : le dire plutôt que d'envoyer du vide au
        # modèle, qui répondrait « rien trouvé » et ferait valider une carte
        # blanche.
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)

    async with httpx.AsyncClient() as client:
        try:
            import_ = await service.extraire(
                session,
                import_=import_,
                contenu=contenu,
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
