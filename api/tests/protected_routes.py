"""Routes servant uniquement à éprouver les dépendances d'accès.

Elles ne sont montées que par la suite de tests, jamais par l'application : le
code de production n'a pas à porter des endpoints factices. Elles utilisent les
dépendances réelles, ce sont donc bien celles-ci qui sont testées.
"""

import uuid

from fastapi import APIRouter, Depends

from app.core.dependencies import BusinessMembership, CurrentUser, require_role
from app.core.membership import MembershipFor
from app.models.enums import UserRole

router = APIRouter(prefix="/probe", tags=["probe"])


@router.get("/any-authenticated")
async def any_authenticated(user: CurrentUser) -> dict:
    return {"user_id": str(user.id)}


@router.get("/creator-only", dependencies=[Depends(require_role(UserRole.CREATOR))])
async def creator_only() -> dict:
    return {"ok": True}


@router.get("/admin-only", dependencies=[Depends(require_role(UserRole.ADMIN))])
async def admin_only() -> dict:
    return {"ok": True}


@router.get(
    "/staff-or-admin",
    dependencies=[Depends(require_role(UserRole.BUSINESS_MEMBER, UserRole.ADMIN))],
)
async def staff_or_admin() -> dict:
    return {"ok": True}


@router.get("/businesses/{business_id}/resource")
async def business_resource(business_id: uuid.UUID, membership: BusinessMembership) -> dict:
    """La ressource d'un commerce : le bon rôle ne suffit pas, l'appartenance compte."""
    return {"business_id": str(business_id), "membership_role": membership.role}


# --------------------------------------------------------------------------
# ressources sans `business_id` dans le chemin
# --------------------------------------------------------------------------
#
# Un endpoint par type, avec la dépendance réelle. Les routes métier de ces
# ressources n'existent pas encore ; le résolveur, lui, doit exister avant
# elles — sinon la première écrira son contrôle en ligne et les suivantes le
# recopieront.


@router.get("/bookings/{booking_id}")
async def probe_booking(
    booking_id: uuid.UUID, membership: MembershipFor("booking", param="booking_id")
) -> dict:
    return {"business_id": str(membership.business_id)}


@router.get("/collaborations/{collaboration_id}")
async def probe_collaboration(
    collaboration_id: uuid.UUID,
    membership: MembershipFor("collaboration", param="collaboration_id"),
) -> dict:
    return {"business_id": str(membership.business_id)}


@router.get("/proofs/{proof_id}")
async def probe_proof(
    proof_id: uuid.UUID, membership: MembershipFor("proof", param="proof_id")
) -> dict:
    return {"business_id": str(membership.business_id)}


@router.get("/redemption-codes/{code_id}")
async def probe_redemption_code(
    code_id: uuid.UUID, membership: MembershipFor("redemption_code", param="code_id")
) -> dict:
    return {"business_id": str(membership.business_id)}
