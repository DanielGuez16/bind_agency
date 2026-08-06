"""table de jobs et compteur de tentatives

La table de jobs annoncée par `SPEC.md` §1 : Postgres tient déjà la transaction
et le verrou de ligne qu'un ordonnanceur demande, un courtier de messages
n'ajouterait qu'un second endroit où l'état peut diverger.

`UNIQUE (job_type, target_id)` porte l'idempotence de la planification : il ne
peut pas exister deux relevés quotidiens du même compte, quel que soit le nombre
de fois où la planification est relancée.

`social_account.last_sync_attempt_at` retient la dernière **tentative** de
relevé, réussie ou non, là où `last_synced_at` ne retenait que les succès. Sans
elle, la borne de fréquence des relevés à la demande ne bornait rien : un relevé
qui échoue ne consommait pas le quota, donc il suffisait d'échouer pour pouvoir
recommencer aussitôt.

Revision ID: 32248e23a751
Revises: 7612a1f49357
Create Date: 2026-08-06 12:38:04.296739+00:00

"""

import sqlalchemy as sa
from alembic import op

revision: str = "32248e23a751"
down_revision: str | None = "7612a1f49357"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "job",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "job_type",
            sa.Enum(
                "token_refresh",
                "metrics_refresh",
                name="job_type",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=False,
        ),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "pending", "exhausted", name="job_status", native_enum=False, create_constraint=True
            ),
            server_default="pending",
            nullable=False,
        ),
        sa.Column("attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column(
            "run_after",
            sa.DateTime(timezone=True),
            server_default=sa.text("clock_timestamp()"),
            nullable=False,
        ),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("clock_timestamp()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status <> 'exhausted' OR attempts > 0", name=op.f("ck_job_exhausted_implies_attempts")
        ),
        sa.CheckConstraint("attempts >= 0", name=op.f("ck_job_attempts_positive")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_job")),
        sa.UniqueConstraint("job_type", "target_id", name=op.f("uq_job_job_type_target_id")),
    )
    op.create_index("ix_job_status_run_after", "job", ["status", "run_after"], unique=False)
    op.add_column(
        "social_account",
        sa.Column("last_sync_attempt_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("social_account", "last_sync_attempt_at")
    op.drop_index("ix_job_status_run_after", table_name="job")
    op.drop_table("job")
