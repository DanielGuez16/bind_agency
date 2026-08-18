"""le reglage des notifications part, les genres restent

Revision ID: b44aad4417a0
Revises: af0bc3c00148

**Le réglage part, les sept genres restent.** Ils portent le gabarit et la
langue de chaque message ; c'est le choix par personne qui disparaît, pas la
notion de genre.

**Ce que la table contenait.** Une ligne par refus explicite — l'absence valait
accord. Elle n'est donc pas une préférence perdue pour la plupart des comptes :
elle n'existait que pour ceux qui avaient coupé un genre. Ce qui change pour
eux : ils recevront de nouveau ce qu'ils avaient coupé. C'est la conséquence
assumée de la décision, et il n'y a pas de façon de la retirer à moitié.

**Le retour arrière recrée la table, vide.** Il ne peut pas faire mieux : les
refus ne sont copiés nulle part avant la suppression. Les recopier dans une
table d'archive serait garder la donnée qu'on a décidé de ne plus avoir, et
personne ne la relirait — un retour arrière rend alors un produit qui envoie
tout, ce qui est exactement l'état d'après cette migration.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b44aad4417a0"
down_revision: str | Sequence[str] | None = "af0bc3c00148"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_table("notification_preference")


def downgrade() -> None:
    """Downgrade schema."""
    op.create_table(
        "notification_preference",
        sa.Column("user_id", sa.UUID(), autoincrement=False, nullable=False),
        sa.Column("kind", sa.VARCHAR(length=29), autoincrement=False, nullable=False),
        sa.Column("enabled", sa.BOOLEAN(), autoincrement=False, nullable=False),
        sa.Column(
            "updated_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("clock_timestamp()"),
            autoincrement=False,
            nullable=False,
        ),
        sa.CheckConstraint(
            "kind::text = ANY (ARRAY['booking_approved'::character varying, 'booking_declined'::character varying, 'booking_cancelled_by_business'::character varying, 'publication_reminder'::character varying, 'publication_approved'::character varying, 'publication_resubmit'::character varying, 'booking_to_review'::character varying, 'subscription_grace_ending'::character varying, 'subscription_ended'::character varying, 'support_access_started'::character varying, 'collaboration_opened'::character varying, 'collaboration_unfulfilled'::character varying]::text[])",
            name=op.f("ck_notification_preference_notification_kind"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["app_user.id"],
            name=op.f("fk_notification_preference_user_id_app_user"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", "kind", name=op.f("pk_notification_preference")),
    )
