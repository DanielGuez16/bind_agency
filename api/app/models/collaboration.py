"""Contrepartie attendue et preuve de publication."""

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAt, UUIDPrimaryKey, enum_column
from app.models.enums import CaptureMethod, CollaborationStatus, ContentFormat


class Collaboration(UUIDPrimaryKey, CreatedAt, Base):
    """Créée à la consommation d'une réservation, jamais avant.

    Il n'existe pas de statut `disputed` : la non conformité renvoie en
    `resubmit_requested`. `needs_human_review` est levé automatiquement à la
    troisième tentative et fait sortir le dossier de la boucle.
    """

    __tablename__ = "collaboration"

    booking_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("booking.id", ondelete="RESTRICT"), nullable=False
    )
    tier_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("tier.id", ondelete="RESTRICT"), nullable=False
    )
    required_format: Mapped[ContentFormat] = mapped_column(
        enum_column(ContentFormat, "content_format"), nullable=False
    )
    required_mention: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    required_geotag: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.text("false")
    )
    deadline_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    status: Mapped[CollaborationStatus] = mapped_column(
        enum_column(CollaborationStatus, "collaboration_status"),
        nullable=False,
        server_default=CollaborationStatus.PENDING.value,
    )
    attempts_count: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, server_default=sa.text("0")
    )
    needs_human_review: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.text("false")
    )
    approved_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)

    __table_args__ = (
        sa.UniqueConstraint("booking_id"),
        sa.CheckConstraint("attempts_count >= 0", name="attempts_count_positive"),
        # Job d'échéances.
        sa.Index("ix_collaboration_status_deadline_at", "status", "deadline_at"),
        # File de revue humaine côté admin.
        sa.Index("ix_collaboration_needs_human_review", "needs_human_review"),
    )


class Proof(UUIDPrimaryKey, Base):
    """Preuve archivée, jamais un simple lien.

    `submitted_at` est l'heure serveur : un horodatage fourni par le client
    n'est jamais utilisé comme preuve.
    """

    __tablename__ = "proof"

    collaboration_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("collaboration.id", ondelete="RESTRICT"), nullable=False
    )
    submitted_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("clock_timestamp()")
    )
    source_url: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    capture_method: Mapped[CaptureMethod] = mapped_column(
        enum_column(CaptureMethod, "capture_method"), nullable=False
    )
    media_key: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    screenshot_key: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    content_hash: Mapped[str] = mapped_column(sa.Text, nullable=False)
    platform_published_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    #: Ce que le créateur dit de sa soumission. **L'autre moitié du canal.**
    #:
    #: Le commerce refusait avec un code, le créateur resoumettait sans un mot,
    #: et un dossier arrivait en arbitrage après trois allers-retours sans
    #: qu'aucune phrase n'ait été échangée. Facultatif : une soumission
    #: conforme n'a rien à expliquer.
    note: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    # `metadata` est réservé par SQLAlchemy déclaratif : la colonne garde son
    # nom, l'attribut Python s'appelle `extra`.
    extra: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)

    __table_args__ = (
        # Une preuve sans aucun fichier archivé n'est pas une preuve.
        sa.CheckConstraint(
            "media_key IS NOT NULL OR screenshot_key IS NOT NULL", name="has_archived_file"
        ),
        # La même borne que sur le journal. En base et pas seulement dans le
        # schéma : un second appelant la contournerait.
        sa.CheckConstraint("note IS NULL OR length(note) <= 500", name="note_bornee"),
        sa.Index(
            "ix_proof_collaboration_id_submitted_at",
            "collaboration_id",
            sa.desc("submitted_at"),
        ),
        sa.Index("ix_proof_content_hash", "content_hash"),
    )
