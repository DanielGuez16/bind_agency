"""Regarder une preuve. Deux routes, et une seule façon d'y accéder.

**Demander le droit**, authentifié, puis **lire l'objet** avec ce droit. Le
partage en deux n'est pas une coquetterie : une balise `<img>` ne porte pas
d'en-tête d'autorisation, et une route de lecture qui exigerait le jeton de
session ne s'afficherait dans aucune image. Le droit voyage donc dans l'adresse,
et il est court.

**Rien n'est jamais public.** Le compartiment des preuves est privé, son nom
n'est pas révélé, et l'adresse rendue pointe sur l'API — pas sur le stockage.
Un fournisseur qui change ne change rien à ce que voit l'app.

**Le droit se vérifie deux fois** : à l'émission et à la lecture. Quelques
minutes suffisent à perdre l'appartenance qui l'a justifié.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Path, Query, Response, status
from pydantic import BaseModel

from app.core.dependencies import CurrentUser, SessionDep
from app.core.errors import ErrorCode, api_error
from app.integrations.object_store import get_object_store
from app.services import proof_access

router = APIRouter(tags=["proofs"])

#: Les signatures reconnues, comme pour les photos. Le type vient du contenu,
#: jamais de la clé — la clé est une empreinte, elle ne porte pas d'extension.
SIGNATURES = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"RIFF", "image/webp"),
)


class DroitDeLecture(BaseModel):
    """Où regarder, et combien de temps l'adresse vaut."""

    url: str
    expires_in: int


@router.get("/proofs/{proof_id}/access", response_model=DroitDeLecture)
async def demander_le_droit(
    proof_id: Annotated[uuid.UUID, Path()],
    user: CurrentUser,
    session: SessionDep,
) -> DroitDeLecture:
    """Le droit de regarder cette preuve, pour quelques minutes.

    Réservé au commerce concerné et à l'administration. Une preuve inconnue et
    une preuve qui ne vous regarde pas répondent la même chose : distinguer les
    deux dirait à qui tâtonne quels identifiants existent.
    """
    try:
        jeton, duree = await proof_access.droit_de_lecture(session, proof_id=proof_id, user=user)
    except proof_access.ProofNotFound as error:
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND) from error

    return DroitDeLecture(url=f"/proofs/{proof_id}?t={jeton}", expires_in=duree)


@router.get("/proofs/{proof_id}")
async def lire_la_preuve(
    proof_id: Annotated[uuid.UUID, Path()],
    t: Annotated[str, Query()],
    session: SessionDep,
) -> Response:
    """L'objet lui-même, si le droit l'ouvre.

    Volontairement hors du préfixe authentifié : c'est le jeton de l'adresse qui
    autorise, et lui seul. Il ne vaut que pour cette preuve, et il expire.
    """
    try:
        proof = await proof_access.preuve_lisible(session, proof_id=proof_id, jeton=t)
    except proof_access.ProofNotFound as error:
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND) from error

    cle = proof_access.cle_du_media(proof)
    if cle is None:
        # Une preuve sans objet existe : la capture de niveau 1 n'est pas
        # branchée, et certaines lignes ne portent qu'une adresse source.
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)

    contenu = await get_object_store().lire(cle)
    if contenu is None:
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)

    type_mime = next(
        (mime for signature, mime in SIGNATURES if contenu.startswith(signature)),
        "application/octet-stream",
    )
    return Response(
        content=contenu,
        media_type=type_mime,
        # `private` : une preuve n'a rien à faire dans un cache partagé. La
        # durée suit celle du droit — au-delà, l'adresse ne vaut plus rien.
        headers={"Cache-Control": "private, max-age=300"},
    )
