"""Retrait : ce que montre le créateur, ce que fait la caisse.

**Vérifier et consommer sont deux routes.** La caisse vérifie pour afficher ce
qu'elle doit servir, puis consomme quand c'est fait. Les fondre ferait consommer
une réservation qu'on n'a pas encore honorée — et il n'y a pas de retour en
arrière : `consumed` est terminal et crée la contrepartie.

**L'appartenance est vérifiée sur les deux.** Le code arrive dans le corps, pas
dans le chemin : la dépendance de résolution ne peut pas le lire, donc le
contrôle est appelé explicitement. Sans lui, une caisse consommerait les
réservations du commerce voisin — et pourrait même lire ce qu'il s'apprête à
servir en scannant un écran par-dessus une épaule.
"""

import uuid
from typing import Annotated

import sqlalchemy as sa
from fastapi import APIRouter, Depends, Path, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import CurrentUser, SessionDep, require_role
from app.core.errors import ErrorCode, api_error
from app.models import Booking, BusinessMember, CatalogItem, CreatorProfile, User
from app.models.enums import UserRole
from app.schemas.redemption import (
    CodeAffiche,
    ConsommationDemande,
    ConsommationRead,
    VerificationDemande,
    VerificationRead,
)
from app.services import booking_states
from app.services import redemption as service
from app.services.audit import Actor

router = APIRouter(tags=["redemption"])

_CODES = {
    service.CodeUnknown: (status.HTTP_404_NOT_FOUND, ErrorCode.REDEMPTION_CODE_UNKNOWN),
    service.CodeAlreadyConsumed: (
        status.HTTP_409_CONFLICT,
        ErrorCode.REDEMPTION_CODE_ALREADY_CONSUMED,
    ),
    service.BookingNotRedeemable: (
        status.HTTP_409_CONFLICT,
        ErrorCode.REDEMPTION_BOOKING_NOT_REDEEMABLE,
    ),
    service.TooManyAttempts: (
        status.HTTP_429_TOO_MANY_REQUESTS,
        ErrorCode.REDEMPTION_TOO_MANY_ATTEMPTS,
    ),
}


def _traduire(error: service.RedemptionError):
    http_status, code = _CODES[type(error)]
    return api_error(http_status, code)


async def _exiger_appartenance(session: AsyncSession, user: User, business_id: uuid.UUID) -> None:
    membre = await session.scalar(
        sa.select(BusinessMember).where(
            BusinessMember.business_id == business_id, BusinessMember.user_id == user.id
        )
    )
    if membre is None:
        raise api_error(status.HTTP_403_FORBIDDEN, ErrorCode.NOT_A_MEMBER)


@router.get(
    "/bookings/{booking_id}/code",
    response_model=CodeAffiche,
    dependencies=[Depends(require_role(UserRole.CREATOR))],
)
async def read_code(
    booking_id: Annotated[uuid.UUID, Path()], user: CurrentUser, session: SessionDep
) -> CodeAffiche:
    """Le code du créateur, dérivé à la demande.

    Créé au premier appel plutôt qu'à la réservation : une réservation annulée
    avant confirmation n'a jamais besoin de code, et le secret d'un code jamais
    montré n'a pas de raison d'exister.
    """
    booking = await session.get(Booking, booking_id)
    if booking is None or booking.creator_id != user.id:
        # Même réponse pour « inconnue » et « pas à vous » : distinguer les deux
        # dirait à un créateur quels identifiants appartiennent à un autre.
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.BOOKING_NOT_FOUND)

    try:
        service.etat_reservation_consommable(booking)
    except service.BookingNotRedeemable as error:
        raise _traduire(error) from error

    code = await service.code_du_booking(session, booking=booking)
    if code is None:
        # Ne devrait pas arriver : le code naît à la confirmation, et cette
        # route exige une réservation confirmée. Le dire vaut mieux que rendre
        # une réponse à moitié vide.
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.REDEMPTION_CODE_UNKNOWN)

    affiche = service.code_affiche(code)
    return CodeAffiche(
        booking_id=booking.id,
        payload=f"{code.id}:{affiche}",
        code=affiche,
        manual_code=service.secours_lisible(code.manual_code),
        seconds_remaining=service.secondes_restantes(code),
        rotation_seconds=code.rotation_seconds,
    )


@router.post(
    "/redemptions/verify",
    response_model=VerificationRead,
    dependencies=[Depends(require_role(UserRole.BUSINESS_MEMBER))],
)
async def verify(
    payload: VerificationDemande, user: CurrentUser, session: SessionDep
) -> VerificationRead:
    """Reconnaît un code sans rien consommer."""
    try:
        verifie = await service.verifier(session, saisi=payload.code)
    except service.RedemptionError as error:
        # L'essai raté est compté, et le compte doit survivre au refus : sans
        # cette validation, la limite ne limiterait rien. Même règle que pour la
        # bascule d'un compte social dont le jeton est refusé.
        await session.commit()
        raise _traduire(error) from error

    await _exiger_appartenance(session, user, verifie.business_id)

    booking = await session.get(Booking, verifie.booking_id)
    try:
        service.etat_reservation_consommable(booking)
    except service.BookingNotRedeemable as error:
        raise _traduire(error) from error

    item = await session.get(CatalogItem, booking.catalog_item_id)
    profil = await session.get(CreatorProfile, booking.creator_id)
    nom = " ".join(filter(None, [profil.first_name, profil.last_name])) if profil else None

    return VerificationRead(
        booking_id=booking.id,
        redemption_code_id=verifie.redemption_code_id,
        creator_name=nom or None,
        item_name=item.name,
        item_photo_key=item.photo_key,
        starts_at=booking.starts_at,
        valid_until=booking.valid_until,
        status=booking.status,
        par_secours=verifie.par_secours,
    )


@router.post(
    "/redemptions/consume",
    response_model=ConsommationRead,
    dependencies=[Depends(require_role(UserRole.BUSINESS_MEMBER))],
)
async def consume(
    payload: ConsommationDemande, user: CurrentUser, session: SessionDep
) -> ConsommationRead:
    """Consomme le code, puis fait passer la réservation en `consumed`.

    Dans cet ordre, et il compte : la consommation du code est la barrière
    contre le double scan — un `UPDATE … WHERE consumed_at IS NULL` que la
    seconde caisse perd. Basculer la réservation d'abord ferait passer les deux
    avant que l'une ne s'aperçoive de rien.
    """
    booking_id = await service.booking_du_code(
        session, redemption_code_id=payload.redemption_code_id
    )
    if booking_id is None:
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.REDEMPTION_CODE_UNKNOWN)

    booking = await session.get(Booking, booking_id)
    await _exiger_appartenance(session, user, booking.business_id)

    try:
        service.etat_reservation_consommable(booking)
        await service.marquer_consomme(
            session, redemption_code_id=payload.redemption_code_id, par_user_id=user.id
        )
        await booking_states.consommer(session, booking=booking, actor=Actor.from_user(user))
    except service.RedemptionError as error:
        raise _traduire(error) from error
    except booking_states.BookingStateError as error:
        raise api_error(
            status.HTTP_409_CONFLICT, ErrorCode.BOOKING_TRANSITION_NOT_ALLOWED
        ) from error

    await session.commit()
    return ConsommationRead(
        booking_id=booking.id, status=booking.status, consumed_at=booking.consumed_at
    )
