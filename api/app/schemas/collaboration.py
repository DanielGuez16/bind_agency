"""Schémas de la contrepartie."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import CaptureMethod, CollaborationStatus, ContentFormat


class PreuveSoumise(BaseModel):
    """Ce que le créateur envoie.

    `platform_published_at` est accepté mais n'est **jamais** la référence :
    c'est `submitted_at`, posé côté serveur, qui décide si l'échéance est
    tenue. Un horodatage fourni par le client n'est pas une preuve.
    """

    model_config = ConfigDict(extra="forbid")

    #: L'URL publique de la publication, quand elle en a une. Elle sert à
    #: tenter le niveau 2 ; elle n'est jamais conservée seule.
    source_url: str | None = Field(default=None, max_length=1000)
    #: Une capture d'écran déjà téléversée, pour le niveau 3. Clé de stockage
    #: objet, jamais une URL.
    screenshot_key: str | None = Field(default=None, max_length=500)


class PreuveRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    submitted_at: datetime
    #: Le niveau réellement employé. C'est lui qui permettra d'automatiser
    #: uniquement les cas de niveau 1.
    capture_method: CaptureMethod
    content_hash: str
    source_url: str | None
    platform_published_at: datetime | None


class CollaborationRead(BaseModel):
    """Les critères sont ceux figés à la candidature, pas ceux d'aujourd'hui."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    booking_id: uuid.UUID
    tier_id: uuid.UUID
    required_format: ContentFormat
    required_mention: str | None
    required_geotag: bool
    deadline_at: datetime
    status: CollaborationStatus
    attempts_count: int
    needs_human_review: bool
    approved_at: datetime | None
    proofs: list[PreuveRead]


class DecisionCommerce(BaseModel):
    """Approuver, ou redemander. Jamais « rejeter » : il n'existe pas de statut
    de litige, et un refus rouvre avec une nouvelle échéance."""

    model_config = ConfigDict(extra="forbid")

    approuve: bool
    #: Obligatoire quand on redemande : le créateur doit savoir quoi corriger.
    reason: str | None = Field(default=None, max_length=500)
