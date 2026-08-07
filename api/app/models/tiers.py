"""Paliers et composition des offres par commerce."""

import uuid
from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAt, UUIDPrimaryKey, enum_column
from app.models.enums import ContentFormat, Platform


class Tier(UUIDPrimaryKey, Base):
    """Configuration globale de la plateforme, jamais modifiée par un commerce.

    Un palier est identifié par le couple plateforme + format. Deux paliers
    `story` sur Instagram n'ont pas de sens dans le modèle actuel ; si des sous
    niveaux deviennent nécessaires, ce sera une colonne `level` et une
    modification assumée de cette unicité.
    """

    __tablename__ = "tier"

    platform: Mapped[Platform] = mapped_column(enum_column(Platform, "platform"), nullable=False)
    content_format: Mapped[ContentFormat] = mapped_column(
        enum_column(ContentFormat, "content_format"), nullable=False
    )
    min_followers: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    min_reliability_score: Mapped[Decimal | None] = mapped_column(sa.Numeric(5, 2), nullable=True)
    min_completed_collabs: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, server_default=sa.text("0")
    )
    value_ratio_hint: Mapped[Decimal | None] = mapped_column(sa.Numeric(6, 3), nullable=True)
    display_order: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    is_active: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.text("true")
    )

    __table_args__ = (
        sa.UniqueConstraint("platform", "content_format"),
        sa.CheckConstraint("min_followers >= 0", name="min_followers_positive"),
        sa.CheckConstraint("min_completed_collabs >= 0", name="min_completed_collabs_positive"),
    )


class TierOffer(UUIDPrimaryKey, CreatedAt, Base):
    """Ce que le commerce place à quel palier. Un item peut viser plusieurs paliers."""

    __tablename__ = "tier_offer"

    business_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("business.id", ondelete="CASCADE"), nullable=False
    )
    tier_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("tier.id", ondelete="RESTRICT"), nullable=False
    )
    catalog_item_id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, nullable=False)
    is_active: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.text("true")
    )

    # Ce que le commerce exige de la publication. Recopié sur la contrepartie à
    # la consommation et figé là : sans source ici, les critères affichés au
    # créateur seraient toujours vides, et « les critères sont ceux figés à la
    # candidature » ne garantirait rien.
    #
    # Le format, lui, ne s'exprime pas ici : il vient du palier, qui est
    # précisément défini par le couple plateforme × format.
    required_mention: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    required_geotag: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.text("false")
    )

    __table_args__ = (
        sa.UniqueConstraint("business_id", "tier_id", "catalog_item_id"),
        # Cible de la clé étrangère composite de booking.
        sa.UniqueConstraint("id", "business_id"),
        # L'item offert appartient forcément au commerce qui compose l'offre.
        sa.ForeignKeyConstraint(
            ["catalog_item_id", "business_id"],
            ["catalog_item.id", "catalog_item.business_id"],
            name="fk_tier_offer_item_business",
            ondelete="CASCADE",
        ),
        sa.Index("ix_tier_offer_tier_id_is_active", "tier_id", "is_active"),
    )
