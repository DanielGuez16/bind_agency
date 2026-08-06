"""Schémas de la vérification de cohérence."""

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.models.enums import Platform, VerificationStatus
from app.services.account_verification import Coherence, Signal, VerdictSignal


class ConstatRead(BaseModel):
    """Un signal et son verdict. Jamais un score agrégé.

    `requis` et `constate` sont rendus tels quels pour que l'administrateur voie
    l'écart, pas seulement le fait qu'il y en a un.
    """

    signal: Signal
    verdict: VerdictSignal
    requis: Decimal | int | None
    constate: Decimal | int | None


class CompteEnRevue(BaseModel):
    """Une ligne de la file d'administration."""

    social_account_id: uuid.UUID
    creator_id: uuid.UUID
    platform: Platform
    handle: str | None
    connected_at: datetime
    last_synced_at: datetime | None
    constats: list[ConstatRead]

    @classmethod
    def depuis(cls, account, coherence: Coherence) -> "CompteEnRevue":
        return cls(
            social_account_id=account.id,
            creator_id=account.creator_id,
            platform=account.platform,
            handle=account.handle,
            connected_at=account.connected_at,
            last_synced_at=account.last_synced_at,
            constats=[
                ConstatRead.model_validate(c, from_attributes=True) for c in coherence.constats
            ],
        )


class VerdictAdministrateur(BaseModel):
    """Décision prononcée à la main.

    `reason` est obligatoire : une décision qui ne dit pas pourquoi elle a été
    prise est indéfendable trois mois plus tard, et c'est encore plus vrai
    quand elle ferme la porte à quelqu'un.
    """

    status: VerificationStatus
    reason: str = Field(min_length=3, max_length=500)


class VerificationRead(BaseModel):
    social_account_id: uuid.UUID
    verification_status: VerificationStatus
    verification_reviewed_at: datetime | None
    constats: list[ConstatRead]
