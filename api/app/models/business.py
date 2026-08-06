"""Commerce, membres, plans et abonnements."""

import uuid
from datetime import datetime

import sqlalchemy as sa
from geoalchemy2 import Geography
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAt, UUIDPrimaryKey, enum_column, money_column
from app.models.enums import (
    BillingInterval,
    BusinessCategory,
    BusinessMemberRole,
    BusinessStatus,
    Locale,
    SubscriptionStatus,
)


class Business(UUIDPrimaryKey, CreatedAt, Base):
    __tablename__ = "business"

    name: Mapped[str] = mapped_column(sa.Text, nullable=False)
    category: Mapped[BusinessCategory] = mapped_column(
        enum_column(BusinessCategory, "business_category"), nullable=False
    )
    # Nullables pendant l'onboarding : un géocodage peut échouer, adresse mal
    # saisie ou service indisponible, et l'inscription ne doit pas se bloquer
    # là-dessus. La garantie est reportée au passage en `active`, ci-dessous.
    address: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    geo: Mapped[object | None] = mapped_column(
        Geography(geometry_type="POINT", srid=4326, spatial_index=False), nullable=True
    )
    timezone: Mapped[str] = mapped_column(
        sa.Text, nullable=False, server_default=sa.text("'America/New_York'")
    )
    default_locale: Mapped[Locale] = mapped_column(
        enum_column(Locale, "locale"), nullable=False, server_default=Locale.EN.value
    )
    phone: Mapped[str | None] = mapped_column(sa.Text, nullable=True)

    # Seule et unique devise du commerce. Aucun montant de son catalogue ni de
    # ses réservations ne porte la sienne : c'est celle-ci qui fait foi.
    currency: Mapped[str] = mapped_column(sa.String(3), nullable=False)

    # Clé dans le stockage objet, jamais une URL. Une URL signée expire, une URL
    # publique fuit, et les deux se retrouveraient figées dans la base le jour
    # où l'on change de fournisseur. La clé, elle, ne dépend de personne : c'est
    # au moment de servir qu'on en fabrique un accès. Mêmes règles que les
    # preuves de publication.
    #
    # Nullable : un commerce fraîchement inscrit n'a pas encore de photo, et
    # exiger une image avant de pouvoir s'inscrire perdrait des commerces sur
    # une étape qui n'engage rien.
    cover_photo_key: Mapped[str | None] = mapped_column(sa.Text, nullable=True)

    status: Mapped[BusinessStatus] = mapped_column(
        enum_column(BusinessStatus, "business_status"),
        nullable=False,
        server_default=BusinessStatus.ONBOARDING.value,
    )

    __table_args__ = (
        # Un commerce ne devient actif, donc visible dans le fil créateur, que
        # localisable. Tant qu'il est en onboarding, il peut rester incomplet.
        sa.CheckConstraint("status <> 'active' OR geo IS NOT NULL", name="active_requires_geo"),
        sa.CheckConstraint(
            "status <> 'active' OR address IS NOT NULL", name="active_requires_address"
        ),
        sa.Index("ix_business_geo", "geo", postgresql_using="gist"),
        sa.Index("ix_business_category_status", "category", "status"),
    )


class BusinessMember(UUIDPrimaryKey, Base):
    __tablename__ = "business_member"

    business_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("business.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("app_user.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[BusinessMemberRole] = mapped_column(
        enum_column(BusinessMemberRole, "business_member_role"), nullable=False
    )

    __table_args__ = (sa.UniqueConstraint("business_id", "user_id"),)


class SubscriptionPlan(UUIDPrimaryKey, Base):
    """Tarification en données, jamais en constantes dans le code.

    Porte sa propre devise : les plans sont au niveau plateforme, ils ne sont
    rattachés à aucun commerce.
    """

    __tablename__ = "subscription_plan"

    category: Mapped[BusinessCategory] = mapped_column(
        enum_column(BusinessCategory, "business_category"), nullable=False
    )
    name: Mapped[str] = mapped_column(sa.Text, nullable=False)
    price_cents: Mapped[int] = money_column(nullable=False)
    currency: Mapped[str] = mapped_column(sa.String(3), nullable=False)
    billing_interval: Mapped[BillingInterval] = mapped_column(
        enum_column(BillingInterval, "billing_interval"), nullable=False
    )
    features: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=sa.text("'{}'"))
    is_active: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.text("true")
    )

    __table_args__ = (sa.CheckConstraint("price_cents >= 0", name="price_cents_positive"),)


class Subscription(UUIDPrimaryKey, Base):
    __tablename__ = "subscription"

    # RESTRICT : un abonnement est une trace de facturation, il ne disparaît pas
    # avec le commerce.
    business_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("business.id", ondelete="RESTRICT"), nullable=False
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("subscription_plan.id", ondelete="RESTRICT"), nullable=False
    )
    status: Mapped[SubscriptionStatus] = mapped_column(
        enum_column(SubscriptionStatus, "subscription_status"), nullable=False
    )
    current_period_end: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    stripe_customer_id: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    stripe_subscription_id: Mapped[str | None] = mapped_column(sa.Text, nullable=True)

    __table_args__ = (
        sa.UniqueConstraint("stripe_subscription_id"),
        sa.Index("ix_subscription_business_id", "business_id"),
    )
