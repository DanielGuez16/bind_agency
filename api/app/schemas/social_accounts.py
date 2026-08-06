"""Schémas de rattachement d'un compte social."""

import uuid
from datetime import datetime
from decimal import Decimal

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


class SocialMetricsRead(BaseModel):
    """Un relevé, tel qu'il a été enregistré.

    `raw_payload` n'y figure pas : il est conservé pour qu'on puisse expliquer
    un chiffre plus tard, pas pour être servi. Il contient la forme brute de la
    réponse d'une plateforme, qui n'est ni stable ni de notre ressort.
    """

    id: uuid.UUID
    social_account_id: uuid.UUID
    captured_at: datetime
    followers_count: int
    following_count: int
    media_count: int
    #: Nuls tant que le relevé des publications n'existe pas. « Pas encore
    #: mesuré », donc, et non « zéro ».
    avg_views: int | None
    engagement_rate: Decimal | None
    audience_demographics: dict | None
