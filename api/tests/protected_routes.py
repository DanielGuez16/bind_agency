"""Routes servant uniquement à éprouver les dépendances d'accès.

Elles ne sont montées que par la suite de tests, jamais par l'application : le
code de production n'a pas à porter des endpoints factices. Elles utilisent les
dépendances réelles, ce sont donc bien celles-ci qui sont testées.
"""

import uuid

from fastapi import APIRouter, Depends

from app.core.dependencies import BusinessMembership, CurrentUser, require_role
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
