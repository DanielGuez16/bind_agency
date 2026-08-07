"""Schémas des files de contreparties : celle du commerce, celle de l'admin.

La même ligne des deux côtés. L'arbitre a besoin d'exactement ce que le
commerce voyait : lui rendre une vue plus pauvre l'obligerait à décider avec
moins d'information que celui dont il révise la décision.
"""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import CaptureMethod, CollaborationStatus, ContentFormat, Platform


class DerniereSoumissionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    proof_id: uuid.UUID
    submitted_at: datetime
    #: La méthode de capture, conservée depuis la phase 7 : c'est elle qui
    #: permettra plus tard de n'automatiser que les cas les plus fiables.
    capture_method: CaptureMethod
    source_url: str | None
    media_key: str | None
    screenshot_key: str | None
    platform_published_at: datetime | None


class LigneDeFileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    collaboration_id: uuid.UUID
    booking_id: uuid.UUID
    status: CollaborationStatus
    required_format: ContentFormat
    required_mention: str | None
    required_geotag: bool
    deadline_at: datetime
    attempts_count: int
    needs_human_review: bool
    created_at: datetime
    business_id: uuid.UUID
    business_name: str
    creator_id: uuid.UUID
    creator_first_name: str | None
    creator_last_name: str | None
    creator_handle: str | None
    platform: Platform
    item_name: str
    dernier_motif: str | None
    derniere_soumission: DerniereSoumissionRead | None
