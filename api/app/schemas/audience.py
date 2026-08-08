"""Schémas de l'audience et du statut de vérification, côté créateur."""

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models.enums import Platform, SocialAccountStatus, VerificationStatus
from app.services.account_verification import Signal, VerdictSignal


class AudienceDuCompteRead(BaseModel):
    """Ses abonnés, à lui, datés.

    Aucun de ces chiffres n'est un solde ni une valeur : ce sont les mesures de
    son propre compte, que l'éligibilité utilisait sans jamais les lui rendre.
    """

    model_config = ConfigDict(from_attributes=True)

    social_account_id: uuid.UUID
    platform: Platform
    handle: str | None
    status: SocialAccountStatus
    verification_status: VerificationStatus
    followers_count: int | None
    following_count: int | None
    media_count: int | None
    avg_views: int | None
    engagement_rate: Decimal | None
    #: Nulle quand aucun relevé n'existe. Un chiffre sans date serait pris pour
    #: celui d'aujourd'hui.
    captured_at: datetime | None
    #: Faux quand le compte vient d'un autre fournisseur que celui en service :
    #: rien ne le récupérera, et l'app doit le dire plutôt que de proposer une
    #: reconnexion qui créerait un autre compte à côté.
    reconnectable: bool


class SignalJugeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    signal: Signal
    verdict: VerdictSignal
    constate: Decimal | int | None
    requis: Decimal | int | None


class VerificationDuCompteRead(BaseModel):
    """L'état du contrôle, sans aucune promesse de délai.

    Il n'existe volontairement pas de champ d'objectif ni d'estimation : une
    promesse tenue par une file d'attente humaine se brise le premier jour de
    charge, auprès de gens qui n'ont rien fait de mal. La date de démarrage
    suffit à écrire « jour 2 ».
    """

    model_config = ConfigDict(from_attributes=True)

    social_account_id: uuid.UUID
    platform: Platform
    handle: str | None
    verification_status: VerificationStatus
    started_at: datetime
    reviewed_at: datetime | None
    signaux: list[SignalJugeRead]
