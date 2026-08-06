"""instant de lecture du snapshot

`captured_at` datait de l'ouverture de la transaction, pas de la lecture :
`now()` est figé pour toute la transaction en Postgres. Deux relevés enregistrés
sans validation intermédiaire portaient donc la même heure, et « le dernier
snapshot » — la question que pose l'éligibilité — n'avait pas de réponse
déterminée.

`clock_timestamp()` avance à chaque appel. Même correction que pour
`audit_log.occurred_at`, et pour la même raison : une table en ajout seul n'a
que son ordre pour structure.

Revision ID: 595f223feafb
Revises: b37b395c9cbd
Create Date: 2026-08-06 03:21:21.968270+00:00

"""

import sqlalchemy as sa
from alembic import op

revision: str = "595f223feafb"
down_revision: str | None = "b37b395c9cbd"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.alter_column(
        "social_metrics_snapshot",
        "captured_at",
        server_default=sa.text("clock_timestamp()"),
    )


def downgrade() -> None:
    op.alter_column(
        "social_metrics_snapshot",
        "captured_at",
        server_default=sa.text("now()"),
    )
