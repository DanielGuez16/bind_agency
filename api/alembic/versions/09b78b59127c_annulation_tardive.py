"""annulation tardive

Revision ID: 09b78b59127c
Revises: 83b10e7d2ed3
Create Date: 2026-08-22 19:54:37.788773+00:00

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "09b78b59127c"
down_revision: Union[str, Sequence[str], None] = "83b10e7d2ed3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """L'annulation tardive entre dans le vocabulaire de la fiabilité.

    **Écrite à la main : l'autogénération ne compare pas les listes.** Une
    énumération applicative se rend en VARCHAR + CHECK, et ajouter une valeur ne
    change aucune colonne. Sans ces lignes, la première annulation tardive
    serait refusée par la base — et le défaut ne se verrait qu'en exploitation,
    au moment précis où quelqu'un fait ce qu'on lui demande de faire.
    """
    op.drop_constraint(
        op.f("ck_reliability_event_reliability_event_type"), "reliability_event", type_="check"
    )
    op.create_check_constraint(
        "reliability_event_type",
        "reliability_event",
        sa.column("type").in_(
            [
                "collab_completed",
                "published_on_time",
                "published_late",
                "first_pass_compliant",
                "resubmit_required",
                "no_show",
                "unfulfilled",
                "business_rating",
                "abusive_report",
                "cancelled_late",
            ]
        ),
    )


def downgrade() -> None:
    """Les annulations tardives redeviennent des absences.

    **Une conversion et non une suppression.** L'événement a coûté à quelqu'un ;
    l'effacer lui rendrait un score qu'il n'a pas, et laisserait un dossier
    annulé sans trace de l'avoir été tardivement. `no_show` est le plus proche
    voisin — c'est d'ailleurs ce qu'elles étaient avant — au prix d'une sévérité
    qu'elles ne méritaient pas. Le journal d'audit garde la vérité.
    """
    op.execute("UPDATE reliability_event SET type = 'no_show' WHERE type = 'cancelled_late'")
    op.drop_constraint(
        op.f("ck_reliability_event_reliability_event_type"), "reliability_event", type_="check"
    )
    op.create_check_constraint(
        "reliability_event_type",
        "reliability_event",
        sa.column("type").in_(
            [
                "collab_completed",
                "published_on_time",
                "published_late",
                "first_pass_compliant",
                "resubmit_required",
                "no_show",
                "unfulfilled",
                "business_rating",
                "abusive_report",
            ]
        ),
    )
