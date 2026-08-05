"""Identité : utilisateurs, profils créateurs, comptes sociaux et métriques."""

import uuid
from datetime import datetime
from decimal import Decimal

import sqlalchemy as sa
from geoalchemy2 import Geography
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAt, UUIDPrimaryKey, enum_column
from app.models.enums import (
    Locale,
    Platform,
    SocialAccountStatus,
    UserRole,
    UserStatus,
    VerificationStatus,
)


class User(UUIDPrimaryKey, CreatedAt, Base):
    """`user` est un mot réservé Postgres : la table s'appelle `app_user`.

    Voir DECISIONS.md. `email` et `phone` sont nullables pour que
    l'anonymisation d'un compte puisse les effacer sans buter sur un NOT NULL.
    """

    __tablename__ = "app_user"

    role: Mapped[UserRole] = mapped_column(enum_column(UserRole, "user_role"), nullable=False)
    email: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    phone: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    locale: Mapped[Locale] = mapped_column(
        enum_column(Locale, "locale"), nullable=False, server_default=Locale.EN.value
    )
    status: Mapped[UserStatus] = mapped_column(
        enum_column(UserStatus, "user_status"),
        nullable=False,
        server_default=UserStatus.ACTIVE.value,
    )
    last_login_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        # `email` n'est nullable que pour permettre l'anonymisation : hors ce
        # cas, un compte sans adresse serait un compte sans moyen de connexion.
        sa.CheckConstraint(
            "status = 'anonymized' OR email IS NOT NULL", name="email_unless_anonymized"
        ),
        # Unicité insensible à la casse : deux comptes ne peuvent pas différer
        # par la seule casse de leur adresse.
        sa.Index("uq_app_user_email_lower", sa.text("lower(email)"), unique=True),
    )


class CreatorProfile(CreatedAt, Base):
    __tablename__ = "creator_profile"

    user_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("app_user.id", ondelete="CASCADE"), primary_key=True
    )

    # Champs personnels nullables : l'anonymisation les efface sur place, elle
    # ne supprime pas la ligne — l'historique d'un commerce doit survivre.
    first_name: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    last_name: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    city: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    geo: Mapped[object | None] = mapped_column(
        Geography(geometry_type="POINT", srid=4326, spatial_index=False), nullable=True
    )
    bio: Mapped[str | None] = mapped_column(sa.Text, nullable=True)

    reliability_score: Mapped[Decimal | None] = mapped_column(
        sa.Numeric(5, 2),
        nullable=True,
        comment=(
            "NULL signifie neutre, pas zéro : la condition de score du moteur de "
            "paliers est ignorée, pas échouée. Recalculé depuis reliability_event, "
            "jamais écrit à la main."
        ),
    )
    completed_collabs_count: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, server_default=sa.text("0")
    )

    # Dérivé, donc généré par la base : ne peut pas diverger de sa source.
    is_new_creator: Mapped[bool] = mapped_column(
        sa.Boolean,
        sa.Computed("reliability_score IS NULL", persisted=True),
        nullable=False,
    )

    anonymized_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        sa.CheckConstraint("completed_collabs_count >= 0", name="completed_collabs_count_positive"),
        sa.Index("ix_creator_profile_geo", "geo", postgresql_using="gist"),
    )


class SocialAccount(UUIDPrimaryKey, Base):
    __tablename__ = "social_account"

    creator_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("creator_profile.user_id", ondelete="CASCADE"), nullable=False
    )
    platform: Mapped[Platform] = mapped_column(enum_column(Platform, "platform"), nullable=False)
    external_id: Mapped[str] = mapped_column(sa.Text, nullable=False)
    handle: Mapped[str] = mapped_column(sa.Text, nullable=False)

    # bytea dès maintenant : le chiffrement au repos arrive en phase 4, le type
    # ne doit pas changer à ce moment-là.
    access_token_encrypted: Mapped[bytes | None] = mapped_column(sa.LargeBinary, nullable=True)
    refresh_token_encrypted: Mapped[bytes | None] = mapped_column(sa.LargeBinary, nullable=True)
    token_expires_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    granted_scopes: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    status: Mapped[SocialAccountStatus] = mapped_column(
        enum_column(SocialAccountStatus, "social_account_status"),
        nullable=False,
        server_default=SocialAccountStatus.ACTIVE.value,
    )

    # SPEC.md §3.2 : un compte en needs_review ne peut pas réserver.
    verification_status: Mapped[VerificationStatus] = mapped_column(
        enum_column(VerificationStatus, "verification_status"),
        nullable=False,
        server_default=VerificationStatus.NEEDS_REVIEW.value,
    )
    verification_reviewed_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )

    connected_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )
    last_synced_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        sa.UniqueConstraint("platform", "external_id"),
        sa.Index("ix_social_account_creator_id", "creator_id"),
    )


class SocialMetricsSnapshot(UUIDPrimaryKey, Base):
    """Historisé, jamais écrasé : l'éligibilité lit le dernier snapshot valide."""

    __tablename__ = "social_metrics_snapshot"

    social_account_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("social_account.id", ondelete="CASCADE"), nullable=False
    )
    captured_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )
    followers_count: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    following_count: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    media_count: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    avg_views: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    engagement_rate: Mapped[Decimal | None] = mapped_column(sa.Numeric(6, 4), nullable=True)
    audience_demographics: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)

    __table_args__ = (
        sa.CheckConstraint("followers_count >= 0", name="followers_count_positive"),
        sa.Index(
            "ix_social_metrics_snapshot_account_captured",
            "social_account_id",
            sa.desc("captured_at"),
        ),
    )
