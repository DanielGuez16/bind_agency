"""verification de l adresse email

**Les comptes existants sont réputés vérifiés.** `email_verified_at` arrive
nulle, ce qui veut dire « pas encore » et ferme la réservation. Appliquer ça
aux comptes déjà en base fermerait le produit à tout le monde du jour au
lendemain, pour une adresse que personne ne leur a jamais demandé de confirmer.
La migration les date donc à l'instant du déploiement : ils gardent ce qu'ils
avaient, et la règle ne vaut que pour ceux qui arrivent après.

C'est une décision, pas une commodité — et elle est réversible dans le mauvais
sens seulement : un compte marqué vérifié qui ne l'était pas garde l'accès. Le
contraire aurait coupé des gens qui n'ont rien fait.

Revision ID: 06414f7f41d4
Revises: b44aad4417a0
Create Date: 2026-08-19 13:41:43.643004+00:00

"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "06414f7f41d4"
down_revision: str | Sequence[str] | None = "b44aad4417a0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "email_verification",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("destination", sa.Text(), nullable=False),
        sa.Column("token_hash", sa.LargeBinary(), nullable=False),
        sa.Column(
            "issued_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("clock_timestamp()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "expires_at > issued_at", name=op.f("ck_email_verification_expire_apres_emission")
        ),
        sa.CheckConstraint(
            "used_at IS NULL OR revoked_at IS NULL",
            name=op.f("ck_email_verification_pas_utilise_et_revoque_a_la_fois"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["app_user.id"],
            name=op.f("fk_email_verification_user_id_app_user"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_email_verification")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_email_verification_token_hash")),
    )
    op.create_index(
        "ix_email_verification_user_id_issued_at",
        "email_verification",
        ["user_id", "issued_at"],
        unique=False,
    )
    op.add_column(
        "app_user", sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True)
    )

    # Les comptes déjà en base gardent leur accès : voir l'en-tête.
    op.execute("UPDATE app_user SET email_verified_at = now() WHERE email IS NOT NULL")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("app_user", "email_verified_at")
    op.drop_index("ix_email_verification_user_id_issued_at", table_name="email_verification")
    op.drop_table("email_verification")
