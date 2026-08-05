"""Événements de fiabilité.

Le score n'est jamais écrit à la main : il est recalculé depuis ces événements
et mis en cache dans `creator_profile.reliability_score`. C'est ce qui rend un
ajustement de pondération rétroactif sans migration.
"""

import uuid
from datetime import datetime
from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPrimaryKey, enum_column
from app.models.enums import ReliabilityEventType


class ReliabilityEvent(UUIDPrimaryKey, Base):
    __tablename__ = "reliability_event"

    creator_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("creator_profile.user_id", ondelete="RESTRICT"), nullable=False
    )
    booking_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("booking.id", ondelete="RESTRICT"), nullable=True
    )
    type: Mapped[ReliabilityEventType] = mapped_column(
        enum_column(ReliabilityEventType, "reliability_event_type"), nullable=False
    )
    # Numeric et non flottant : le recalcul du score doit être reproductible.
    weight: Mapped[Decimal] = mapped_column(sa.Numeric(6, 3), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )

    __table_args__ = (
        sa.Index(
            "ix_reliability_event_creator_id_occurred_at",
            "creator_id",
            sa.desc("occurred_at"),
        ),
    )
