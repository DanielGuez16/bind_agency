"""Schémas des files de contreparties : celle du commerce, celle de l'admin.

La même ligne des deux côtés. L'arbitre a besoin d'exactement ce que le
commerce voyait : lui rendre une vue plus pauvre l'obligerait à décider avec
moins d'information que celui dont il révise la décision.
"""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import (
    ActorKind,
    CaptureMethod,
    CollaborationStatus,
    ContentFormat,
    Platform,
)


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
    #: Ce que le créateur a écrit en soumettant.
    note: str | None


class TentativeRead(BaseModel):
    """Une demande de nouvelle soumission, telle que le journal l'a écrite."""

    model_config = ConfigDict(from_attributes=True)

    #: Un code du vocabulaire fermé, jamais une phrase : c'est le client qui
    #: l'écrit dans sa langue. Le champ reste large parce que le journal
    #: contient aussi les motifs d'avant ce changement.
    motif: str
    #: Ce que l'auteur a ajouté au code. **Rendu tel quel, jamais traduit** :
    #: c'est du contenu saisi, comme le nom d'un item de catalogue.
    note: str | None
    demandee_le: datetime
    par: ActorKind


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
    creator_handle: str | None
    #: La créatrice a fermé son compte. Un drapeau, pas une phrase : le texte
    #: se traduit côté écran, et un nom vide se lisait comme un bug.
    creator_partie: bool
    platform: Platform
    item_name: str
    #: Dérivé de `tentatives`, conservé pour l'écran du commerce qui n'affiche
    #: que la dernière demande.
    dernier_motif: str | None
    #: **L'historique complet.** C'est la répétition qui justifie l'escalade :
    #: trois fois le même reproche et trois reproches différents n'appellent
    #: pas la même décision, et l'arbitre ne voyait que le dernier.
    tentatives: list[TentativeRead]
    derniere_soumission: DerniereSoumissionRead | None
