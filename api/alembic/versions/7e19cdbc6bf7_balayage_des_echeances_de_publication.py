"""balayage des echeances de publication

Nouveau type de job, `collaboration_deadline_sweep`. Comme pour le balayage des
gardes de réservation, la valeur ajoutée est plus longue que la plus longue
connue à la création de la table : la colonne est élargie en même temps que la
contrainte est réécrite — un `sa.Enum(native_enum=False)` produit un `VARCHAR`
dimensionné une fois pour toutes, et le seul fait de réécrire la contrainte
laisserait une troncature refusée par Postgres.

Revision ID: 7e19cdbc6bf7
Revises: d8ce9ef09049
Create Date: 2026-08-06 21:30:00.000000+00:00

"""

import sqlalchemy as sa
from alembic import op

revision: str = "7e19cdbc6bf7"
down_revision: str | None = "d8ce9ef09049"
branch_labels: str | None = None
depends_on: str | None = None

CONTRAINTE = "job_type"
ANCIENNES = ("token_refresh", "metrics_refresh", "booking_hold_sweep")
NOUVELLES = (*ANCIENNES, "collaboration_deadline_sweep")


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
    # Les jobs du type retiré partent avec lui : la planification les recrée
    # d'elle-même, et un downgrade qui échoue à mi-chemin serait pire.
    op.execute("DELETE FROM job WHERE job_type = 'collaboration_deadline_sweep'")
    _remplacer(ANCIENNES)
