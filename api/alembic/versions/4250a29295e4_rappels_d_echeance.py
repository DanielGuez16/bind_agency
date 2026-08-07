"""rappels d echeance

Nouveau type de job, `collaboration_reminder_sweep`. Même traitement que les
précédents : la contrainte est réécrite et la colonne élargie, un
`sa.Enum(native_enum=False)` produisant un `VARCHAR` dimensionné une fois pour
toutes.

Revision ID: 4250a29295e4
Revises: 7e19cdbc6bf7
Create Date: 2026-08-06 22:10:00.000000+00:00

"""

import sqlalchemy as sa
from alembic import op

revision: str = "4250a29295e4"
down_revision: str | None = "7e19cdbc6bf7"
branch_labels: str | None = None
depends_on: str | None = None

CONTRAINTE = "job_type"
ANCIENNES = (
    "token_refresh",
    "metrics_refresh",
    "booking_hold_sweep",
    "collaboration_deadline_sweep",
)
NOUVELLES = (*ANCIENNES, "collaboration_reminder_sweep")


def _remplacer(valeurs: tuple[str, ...]) -> None:
    op.drop_constraint(op.f(f"ck_job_{CONTRAINTE}"), "job", type_="check")
    op.alter_column(
        "job", "job_type", type_=sa.String(max(len(v) for v in valeurs)), existing_nullable=False
    )
    liste = ", ".join(f"'{v}'" for v in valeurs)
    op.create_check_constraint(CONTRAINTE, "job", f"job_type IN ({liste})")


def upgrade() -> None:
    _remplacer(NOUVELLES)


def downgrade() -> None:
    op.execute("DELETE FROM job WHERE job_type = 'collaboration_reminder_sweep'")
    _remplacer(ANCIENNES)
