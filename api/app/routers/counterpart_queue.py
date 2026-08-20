"""Les deux files de contreparties : celle du commerce, celle de l'arbitre.

**L'arbitre tranche dans le vocabulaire du commerce**, plus une issue qui
n'appartient qu'à lui. Approuver et redemander disent exactement la même chose
des deux côtés : lui donner un second langage obligerait chacun à traduire.
Clore en non honoré, en revanche, n'est qu'à lui — c'est la seule décision du
produit qui ne se rouvre pas, et le commerce ne doit jamais pouvoir la prendre.

**Sans cette décision, un dossier sorti de la boucle automatique y reste pour
toujours.** À la troisième tentative, `needs_human_review` se lève et la
mécanique s'arrête sans trancher. Si personne ne peut trancher ensuite, le
drapeau devient une impasse : le créateur attend, le commerce attend, et rien
ne bouge.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, status

from app.core.dependencies import CurrentBusiness, CurrentUser, SessionDep, require_role
from app.core.errors import ErrorCode, api_error
from app.models import Collaboration
from app.models.enums import UserRole
from app.schemas.collaboration import (
    CollaborationRead,
    DecisionAdministrateur,
    IssueDArbitrage,
)
from app.schemas.counterpart_queue import LigneDeFileRead
from app.services import collaboration as service
from app.services import proof as proof_service
from app.services.audit import Actor

business_router = APIRouter(prefix="/business", tags=["collaborations"])

admin_router = APIRouter(
    prefix="/admin/collaborations",
    tags=["admin"],
    dependencies=[Depends(require_role(UserRole.ADMIN))],
)


@business_router.get("/{business_id}/collaborations", response_model=list[LigneDeFileRead])
async def list_for_business(
    business: CurrentBusiness,
    session: SessionDep,
    filtre: Annotated[service.FiltreDeContrepartie | None, Query()] = None,
    limite: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[LigneDeFileRead]:
    """Les contreparties du commerce, triées par échéance.

    L'isolation ne tient pas à un filtre écrit ici : `business` vient du
    résolveur d'appartenance, qui a déjà refusé un membre d'un autre commerce.

    Sans `filtre`, la liste rend tout. C'est délibéré : les trois onglets ne
    couvrent pas `unfulfilled`, et lier la lecture aux onglets ferait
    disparaître de l'interface un statut qui existe en base.
    """
    lignes = await service.lister_pour_le_commerce(
        session, business_id=business.id, filtre=filtre, limite=limite
    )
    return [LigneDeFileRead.model_validate(ligne) for ligne in lignes]


@admin_router.get("/review", response_model=list[LigneDeFileRead])
async def list_human_review(
    session: SessionDep,
    limite: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[LigneDeFileRead]:
    """Les dossiers sortis de la boucle automatique, échéance la plus proche en tête."""
    lignes = await service.file_de_revue_humaine(session, limite=limite)
    return [LigneDeFileRead.model_validate(ligne) for ligne in lignes]


@admin_router.post("/{collaboration_id}/decision", response_model=CollaborationRead)
async def arbitrer(
    collaboration_id: Annotated[uuid.UUID, Path()],
    payload: DecisionAdministrateur,
    user: CurrentUser,
    session: SessionDep,
) -> CollaborationRead:
    """Trancher un dossier sorti de la boucle automatique.

    **Uniquement un dossier marqué en revue humaine.** Sans cette borne,
    l'administrateur deviendrait un commerce fantôme, capable de décider à la
    place de celui qui a donné la prestation. Ce qu'on arbitre, c'est ce que la
    mécanique a refusé de trancher toute seule.

    Le motif est obligatoire sur tout ce qui n'est pas une approbation, comme
    côté commerce : la note est lue par les deux parties.
    """
    ligne = await session.get(Collaboration, collaboration_id)
    if ligne is None:
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.COLLABORATION_NOT_FOUND)

    if not ligne.needs_human_review:
        raise api_error(status.HTTP_409_CONFLICT, ErrorCode.COLLABORATION_NOT_IN_REVIEW)

    motif = (payload.reason or "").strip()
    if payload.issue is not IssueDArbitrage.APPROUVER and not motif:
        raise api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, ErrorCode.VALIDATION_FAILED)

    # Vidée de ses espaces : une note faite d'un seul retour à la ligne
    # occuperait une place à l'écran sans rien dire, et la contrainte de base
    # l'accepterait.
    note = (payload.note or "").strip() or None
    acteur = Actor.from_user(user)
    try:
        if payload.issue is IssueDArbitrage.APPROUVER:
            await service.approuver(session, collaboration=ligne, actor=acteur)
        elif payload.issue is IssueDArbitrage.REDEMANDER:
            await service.demander_une_nouvelle_soumission(
                session, collaboration=ligne, actor=acteur, reason=motif, note=note
            )
        else:
            await service.constater_non_honoree(
                session, collaboration=ligne, actor=acteur, reason=motif, note=note
            )
    except service.TransitionNotAllowed as error:
        raise api_error(
            status.HTTP_409_CONFLICT, ErrorCode.COLLABORATION_TRANSITION_NOT_ALLOWED
        ) from error

    await session.commit()
    await session.refresh(ligne)
    tentative = await service.derniere_tentative(session, ligne.id)
    return CollaborationRead.assembler(
        ligne,
        await proof_service.preuves_de(session, ligne.id),
        dernier_motif=tentative.motif if tentative else None,
        contexte=await service.contexte_de(session, ligne.id),
    )
