"""Catalogue : items, variantes et imports de carte."""

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAt, UUIDPrimaryKey, enum_column, money_column
from app.models.enums import CatalogItemSource, MenuImportStatus


class CatalogItem(UUIDPrimaryKey, CreatedAt, Base):
    """Item de catalogue.

    `requires_booking` traduit le « si pertinent pour l'activité » de la spec :
    un soin en salon se réserve, une entrée de musée non. La durée n'a de sens
    que dans le premier cas, et la contrainte est vérifiée en base.

    Aucune colonne de devise : le montant est en centimes de la devise du
    commerce propriétaire.
    """

    __tablename__ = "catalog_item"

    business_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("business.id", ondelete="CASCADE"), nullable=False
    )
    parent_item_id: Mapped[uuid.UUID | None] = mapped_column(sa.Uuid, nullable=True)

    name: Mapped[str] = mapped_column(sa.Text, nullable=False)
    description: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    price_cents: Mapped[int] = money_column(nullable=False)
    duration_minutes: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    requires_booking: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.text("true")
    )
    is_available: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.text("true")
    )
    source: Mapped[CatalogItemSource] = mapped_column(
        enum_column(CatalogItemSource, "catalog_item_source"),
        nullable=False,
        server_default=CatalogItemSource.MANUAL.value,
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
        onupdate=sa.func.now(),
    )

    __table_args__ = (
        sa.CheckConstraint(
            "(requires_booking AND duration_minutes IS NOT NULL)"
            " OR (NOT requires_booking AND duration_minutes IS NULL)",
            name="duration_matches_requires_booking",
        ),
        sa.CheckConstraint(
            "duration_minutes IS NULL OR duration_minutes > 0",
            name="duration_minutes_positive",
        ),
        sa.CheckConstraint("price_cents >= 0", name="price_cents_positive"),
        # Cibles des clés étrangères composites : elles rendent structurellement
        # impossible qu'une offre ou une réservation pointe l'item d'un autre
        # commerce, et que la copie de requires_booking sur booking diverge.
        sa.UniqueConstraint("id", "business_id"),
        sa.UniqueConstraint("id", "business_id", "requires_booking"),
        # Une variante appartient forcément au commerce de son parent.
        sa.ForeignKeyConstraint(
            ["parent_item_id", "business_id"],
            ["catalog_item.id", "catalog_item.business_id"],
            name="fk_catalog_item_parent_business",
            ondelete="CASCADE",
        ),
        sa.Index("ix_catalog_item_business_id_is_available", "business_id", "is_available"),
    )


class MenuImport(UUIDPrimaryKey, CreatedAt, Base):
    """Une extraction ne crée jamais d'item : elle remplit une charge à valider."""

    __tablename__ = "menu_import"

    business_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("business.id", ondelete="CASCADE"), nullable=False
    )
    file_key: Mapped[str] = mapped_column(sa.Text, nullable=False)
    mime_type: Mapped[str] = mapped_column(sa.Text, nullable=False)
    status: Mapped[MenuImportStatus] = mapped_column(
        enum_column(MenuImportStatus, "menu_import_status"),
        nullable=False,
        server_default=MenuImportStatus.UPLOADED.value,
    )
    extracted_payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("app_user.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)

    __table_args__ = (sa.Index("ix_menu_import_business_id_status", "business_id", "status"),)
