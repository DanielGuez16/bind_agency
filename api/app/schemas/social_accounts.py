"""Schémas de rattachement d'un compte social."""

import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models.enums import Platform, SocialAccountStatus, VerificationStatus


class AutorisationDemarree(BaseModel):
    """L'URL vers laquelle envoyer le créateur. L'état y est déjà."""

    authorization_url: str


class SocialAccountRead(BaseModel):
    """Aucun jeton n'y figure, ni chiffré ni en clair. Ils ne sortent jamais."""

    id: uuid.UUID
    platform: Platform
    handle: str | None
    status: SocialAccountStatus
    verification_status: VerificationStatus
    token_expires_at: datetime | None
    connected_at: datetime
