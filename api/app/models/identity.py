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
from app.models.types import EncryptedText


class User(UUIDPrimaryKey, CreatedAt, Base):
    """`user` est un mot réservé Postgres : la table s'appelle `app_user`.

    Voir DECISIONS.md. `email` et `phone` sont nullables pour que
    l'anonymisation d'un compte puisse les effacer sans buter sur un NOT NULL.
    """

    __tablename__ = "app_user"

    role: Mapped[UserRole] = mapped_column(enum_column(UserRole, "user_role"), nullable=False)
    email: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    phone: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    # Empreinte argon2id complète, paramètres compris. Nullable pour la même
    # raison que l'email : l'anonymisation doit pouvoir l'effacer.
    password_hash: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
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
        sa.CheckConstraint(
            "status = 'anonymized' OR password_hash IS NOT NULL",
            name="password_unless_anonymized",
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
    # Identifiants personnels, pas des clés techniques : un handle Instagram
    # nomme quelqu'un. Nullables pour que l'anonymisation puisse les effacer en
    # laissant la ligne en place — les réservations passées la référencent.
    external_id: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    handle: Mapped[str | None] = mapped_column(sa.Text, nullable=True)

    #: La photo de profil, **rangée chez nous et désignée par sa clé**.
    #:
    #: Jamais l'adresse de la plateforme : les deux fournisseurs servent des URL
    #: signées qui expirent en quelques heures. Stockée telle quelle, elle
    #: donnerait un annuaire dont les visages disparaissent entre deux relevés —
    #: le pire des affichages, parce qu'il ressemble à une panne de notre côté.
    #:
    #: Nulle tant qu'aucun relevé n'a abouti, et sur un compte sans photo. Elle
    #: s'efface avec l'anonymisation, comme le pseudonyme.
    avatar_key: Mapped[str | None] = mapped_column(sa.Text, nullable=True)

    # Chiffrés par le type de colonne, pas par un appel du service : il n'existe
    # aucun chemin qui écrirait un jeton en clair. Le `bytea` sous-jacent n'a pas
    # changé, seule la traversée l'a fait.
    access_token_encrypted: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    refresh_token_encrypted: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    token_expires_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    granted_scopes: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    #: Sous quel fournisseur ce compte a été rattaché : `demo` ou `live`.
    #:
    #: Un compte rattaché en démonstration porte un jeton qui n'existe chez
    #: personne. Le jour où le mode passe en réel, ce compte devient
    #: irrécupérable : ni relevé, ni renouvellement, ni reconnexion — et l'app
    #: proposait pourtant « reconnecter », ce qui mène à une impasse.
    #: Le savoir demande de l'avoir écrit au moment du rattachement ; rien dans
    #: la ligne ne permet de le deviner après coup.
    #:
    #: Nullable : les lignes antérieures à cette colonne ne le savent pas, et
    #: l'inventer serait pire que l'ignorer. Nul veut dire « on ne sait pas »,
    #: et on n'en tire aucune conclusion.
    provider_mode: Mapped[str | None] = mapped_column(sa.Text, nullable=True)

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

    # `list_accounts` trie dessus : à égalité, l'ordre rendu à l'app dépendait
    # du plan d'exécution.
    connected_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("clock_timestamp()")
    )
    last_synced_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    #: Dernière **tentative** de relevé, réussie ou non — à distinguer de
    #: `last_synced_at`, qui ne retient que les succès. Sans elle, un relevé qui
    #: échoue ne consommait rien et la borne de fréquence ne bornait plus rien :
    #: il suffisait d'échouer pour pouvoir recommencer aussitôt.
    last_sync_attempt_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        # Postgres accepte plusieurs NULL dans un index unique : deux comptes
        # anonymisés sur la même plateforme cohabitent sans conflit.
        sa.UniqueConstraint("platform", "external_id"),
        # Les deux identifiants s'effacent ensemble ou pas du tout.
        sa.CheckConstraint(
            "(external_id IS NULL) = (handle IS NULL)", name="identity_erased_together"
        ),
        # Un compte encore utilisable garde forcément son identité.
        sa.CheckConstraint(
            "external_id IS NOT NULL OR status = 'revoked'", name="identity_unless_revoked"
        ),
        sa.Index("ix_social_account_creator_id", "creator_id"),
    )


class SocialMetricsSnapshot(UUIDPrimaryKey, Base):
    """Historisé, jamais écrasé : l'éligibilité lit le dernier snapshot valide."""

    __tablename__ = "social_metrics_snapshot"

    social_account_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("social_account.id", ondelete="CASCADE"), nullable=False
    )
    # `clock_timestamp()` et non `now()` : deux relevés d'une même transaction
    # porteraient sinon la même heure, et « le dernier snapshot » n'aurait plus
    # de réponse. La table est en ajout seul, son ordre est sa seule structure.
    captured_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("clock_timestamp()"),
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
