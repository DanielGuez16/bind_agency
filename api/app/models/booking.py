"""Capacité, réservations et codes de retrait."""

import uuid
from datetime import datetime, time

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAt, UUIDPrimaryKey, enum_column, money_column
from app.models.enums import BookingStatus


class CapacityRule(UUIDPrimaryKey, Base):
    """Horaires hebdomadaires et nombre de postes en parallèle."""

    __tablename__ = "capacity_rule"

    business_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("business.id", ondelete="CASCADE"), nullable=False
    )
    weekday: Mapped[int] = mapped_column(sa.SmallInteger, nullable=False)
    start_time: Mapped[time] = mapped_column(sa.Time, nullable=False)
    end_time: Mapped[time] = mapped_column(sa.Time, nullable=False)
    concurrent_slots: Mapped[int] = mapped_column(sa.Integer, nullable=False)

    __table_args__ = (
        sa.CheckConstraint("weekday BETWEEN 0 AND 6", name="weekday_range"),
        sa.CheckConstraint("start_time < end_time", name="start_before_end"),
        sa.CheckConstraint("concurrent_slots > 0", name="concurrent_slots_positive"),
        sa.Index("ix_capacity_rule_business_id_weekday", "business_id", "weekday"),
    )


class CapacityException(UUIDPrimaryKey, Base):
    """Fermetures exceptionnelles et ajustements ponctuels."""

    __tablename__ = "capacity_exception"

    business_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("business.id", ondelete="CASCADE"), nullable=False
    )
    date: Mapped[datetime] = mapped_column(sa.Date, nullable=False)
    is_closed: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.text("false")
    )
    start_time: Mapped[time | None] = mapped_column(sa.Time, nullable=True)
    end_time: Mapped[time | None] = mapped_column(sa.Time, nullable=True)
    concurrent_slots: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)

    __table_args__ = (
        sa.UniqueConstraint("business_id", "date"),
        sa.CheckConstraint(
            "(start_time IS NULL) = (end_time IS NULL)", name="time_window_both_or_neither"
        ),
        # Une exception sans horaires est une fermeture, et une fermeture n'a
        # pas d'horaires : les deux façons de le dire ne peuvent pas diverger.
        sa.CheckConstraint("is_closed = (start_time IS NULL)", name="closed_has_no_hours"),
        # Un jour fermé n'a pas de postes. Ajuster le nombre de postes d'une
        # journée suppose donc d'en redonner les horaires — l'exception remplace
        # la règle du jour, elle ne s'y ajoute pas.
        sa.CheckConstraint("NOT is_closed OR concurrent_slots IS NULL", name="closed_has_no_slots"),
        sa.CheckConstraint("start_time IS NULL OR start_time < end_time", name="start_before_end"),
        sa.CheckConstraint(
            "concurrent_slots IS NULL OR concurrent_slots > 0", name="concurrent_slots_positive"
        ),
    )


class Booking(UUIDPrimaryKey, CreatedAt, Base):
    """Réservation, ou droit de consommer sur une fenêtre pour un item sans créneau.

    `requires_booking` est une copie figée de la valeur portée par l'item. La
    clé étrangère composite vers `catalog_item` garantit qu'elle ne peut pas
    diverger : elle interdit aussi, de fait, qu'un commerce bascule
    `requires_booking` sur un item déjà réservé. C'est voulu, on ne réécrit pas
    la nature d'une réservation passée. Le service doit intercepter le cas et
    demander la création d'un nouvel item, pas laisser remonter la violation.
    """

    __tablename__ = "booking"

    creator_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("creator_profile.user_id", ondelete="RESTRICT"), nullable=False
    )
    business_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("business.id", ondelete="RESTRICT"), nullable=False
    )
    tier_offer_id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, nullable=False)
    catalog_item_id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, nullable=False)
    social_account_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("social_account.id", ondelete="RESTRICT"), nullable=False
    )

    requires_booking: Mapped[bool] = mapped_column(sa.Boolean, nullable=False)

    # Copie figée elle aussi, et pour la même raison que `requires_booking` :
    # un commerce qui allonge un soin de 30 à 60 minutes ne doit pas allonger
    # rétroactivement les réservations déjà prises. La clé étrangère composite
    # l'étend à `duration_minutes`, ce qui interdit de fait la modification de
    # la durée d'un item déjà réservé — le service intercepte le cas et demande
    # la création d'un nouvel item, comme pour la réservabilité.
    duration_minutes: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)

    starts_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    valid_until: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)

    status: Mapped[BookingStatus] = mapped_column(
        enum_column(BookingStatus, "booking_status"),
        nullable=False,
        server_default=BookingStatus.HELD.value,
    )
    hold_expires_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )

    #: Jusqu'à quand le commerce peut accepter ou refuser. Nul hors
    #: d'`awaiting_business`.
    #:
    #: **Une colonne distincte de `hold_expires_at`, et pas son prolongement.**
    #: Les deux comptent un temps d'attente, mais pas le même, et pas pour la
    #: même personne : le garde de dix minutes protège la place pendant qu'un
    #: créateur remplit son écran, celui-ci borne le temps de réflexion d'un
    #: commerce. Réutiliser la première colonne rendrait illisible toute lecture
    #: qui demande « depuis quand ce panier est-il ouvert », et la contrainte
    #: `held_has_hold_expiry` ne pourrait plus rien affirmer.
    approval_expires_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )

    # Prix figé à la réservation : le commerce peut changer sa carte ensuite,
    # l'historique ne bouge pas. Devise = celle du commerce.
    value_cents_snapshot: Mapped[int] = money_column(nullable=False)

    cancelled_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    consumed_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)

    __table_args__ = (
        sa.CheckConstraint(
            "(requires_booking AND starts_at IS NOT NULL AND ends_at IS NOT NULL)"
            " OR (NOT requires_booking AND starts_at IS NULL AND ends_at IS NULL)",
            name="slot_matches_requires_booking",
        ),
        sa.CheckConstraint("starts_at IS NULL OR ends_at > starts_at", name="ends_after_starts"),
        sa.CheckConstraint(
            "(requires_booking AND duration_minutes IS NOT NULL)"
            " OR (NOT requires_booking AND duration_minutes IS NULL)",
            name="duration_matches_requires_booking",
        ),
        # Les trois façons de dire la même chose ne peuvent pas diverger : la
        # durée réservée est exactement l'écart entre le début et la fin.
        sa.CheckConstraint(
            "starts_at IS NULL OR ends_at = starts_at + make_interval(mins => duration_minutes)",
            name="ends_at_follows_duration",
        ),
        sa.CheckConstraint(
            "status <> 'held' OR hold_expires_at IS NOT NULL", name="held_has_hold_expiry"
        ),
        # Le pendant pour l'accord du commerce. Sans elle, une demande sans
        # échéance n'expirerait jamais et garderait sa place indéfiniment —
        # exactement le défaut qu'on corrige, et il ne se verrait qu'au bout de
        # plusieurs jours, sur une place que personne ne comprend pourquoi elle
        # est prise.
        sa.CheckConstraint(
            "status <> 'awaiting_business' OR approval_expires_at IS NOT NULL",
            name="awaiting_business_has_approval_expiry",
        ),
        sa.CheckConstraint("value_cents_snapshot >= 0", name="value_cents_snapshot_positive"),
        # Nommée à la main : la convention produirait 67 caractères, au-delà de
        # la limite de 63 de Postgres, et le nom serait tronqué en silence.
        # Deux clés composites, et les deux sont nécessaires.
        #
        # Postgres n'applique pas une clé étrangère composite dès qu'une de ses
        # colonnes est nulle (MATCH SIMPLE). Or `duration_minutes` est nulle
        # pour un item sans créneau. La clé à quatre colonnes ne garantit donc
        # rien sur ces lignes-là — c'est-à-dire précisément celles où la nature
        # de l'item est la seule chose à vérifier.
        #
        # La première, à trois colonnes, s'applique toujours : elle interdit
        # qu'une réservation mente sur `requires_booking`. La seconde s'applique
        # quand une durée existe, c'est-à-dire exactement quand il y a une durée
        # à protéger. Retirer l'une des deux rouvre un trou que l'autre ne
        # couvre pas.
        sa.ForeignKeyConstraint(
            ["catalog_item_id", "business_id", "requires_booking"],
            [
                "catalog_item.id",
                "catalog_item.business_id",
                "catalog_item.requires_booking",
            ],
            name="fk_booking_item_business_requires_booking",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["catalog_item_id", "business_id", "requires_booking", "duration_minutes"],
            [
                "catalog_item.id",
                "catalog_item.business_id",
                "catalog_item.requires_booking",
                "catalog_item.duration_minutes",
            ],
            name="fk_booking_item_business_shape",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["tier_offer_id", "business_id"],
            ["tier_offer.id", "tier_offer.business_id"],
            name="fk_booking_offer_business",
            ondelete="RESTRICT",
        ),
        # Calcul de disponibilité.
        sa.Index("ix_booking_business_id_starts_at", "business_id", "starts_at"),
        # Job d'expiration des gardes.
        sa.Index("ix_booking_status_hold_expires_at", "status", "hold_expires_at"),
        # Le balayage des accords sans réponse cherche exactement ce couple, et
        # il tourne toutes les deux minutes sur toute la table.
        sa.Index("ix_booking_status_approval_expires_at", "status", "approval_expires_at"),
        # Historique côté créateur.
        sa.Index("ix_booking_creator_id_created_at", "creator_id", sa.desc("created_at")),
    )


class RedemptionCode(UUIDPrimaryKey, Base):
    """Le code affiché est dérivé côté serveur, jamais stocké tel quel.

    `secret` est la clé HMAC : bytea, même traitement que les jetons OAuth.
    """

    __tablename__ = "redemption_code"

    booking_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("booking.id", ondelete="RESTRICT"), nullable=False
    )
    secret: Mapped[bytes] = mapped_column(sa.LargeBinary, nullable=False)
    manual_code: Mapped[str] = mapped_column(sa.Text, nullable=False)
    rotation_seconds: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, server_default=sa.text("30")
    )
    consumed_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    consumed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("app_user.id", ondelete="SET NULL"), nullable=True
    )

    # Essais infructueux sur ce code. C'est cette limite, et non la longueur du
    # code de secours, qui rend le devinage impossible : quelques essais ratés
    # ferment la porte longtemps avant qu'on approche du milliard de
    # combinaisons. Remis à zéro dès qu'un essai aboutit.
    failed_attempts: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, server_default=sa.text("0")
    )

    __table_args__ = (
        sa.UniqueConstraint("booking_id"),
        sa.UniqueConstraint("manual_code"),
        sa.CheckConstraint("rotation_seconds > 0", name="rotation_seconds_positive"),
        sa.CheckConstraint("failed_attempts >= 0", name="failed_attempts_positive"),
    )
