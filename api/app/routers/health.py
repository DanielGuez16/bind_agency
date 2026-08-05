"""Sonde de disponibilité.

Un health check qui répond 200 alors que la base est morte ne sert à rien : on
renvoie 503 et le nom de la dépendance en défaut dans le corps.
"""

import logging
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.core.db import get_engine

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: Literal["ok", "unavailable"]
    dependencies: dict[str, str]
    failed: list[str]


@router.get(
    "/health",
    response_model=HealthResponse,
    responses={status.HTTP_503_SERVICE_UNAVAILABLE: {"model": HealthResponse}},
)
async def health(engine: Annotated[AsyncEngine, Depends(get_engine)]) -> JSONResponse:
    dependencies: dict[str, str] = {}

    try:
        async with engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
    except Exception:
        logger.exception("health: base de données injoignable")
        dependencies["database"] = "unavailable"
    else:
        dependencies["database"] = "ok"

    failed = sorted(name for name, state in dependencies.items() if state != "ok")
    payload = HealthResponse(
        status="unavailable" if failed else "ok",
        dependencies=dependencies,
        failed=failed,
    )
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE if failed else status.HTTP_200_OK,
        content=payload.model_dump(),
    )
