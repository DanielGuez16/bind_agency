"""Deux genres pour les messages orphelins

Revision ID: e131756117a0
Revises: 69097f3c54f7
Create Date: 2026-08-13 16:59:08.187307+00:00

"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "e131756117a0"
down_revision: Union[str, Sequence[str], None] = "69097f3c54f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # **Deux contraintes cette fois, et non une.** Le genre d'une notification
    # apparaît dans la table des préférences et dans celle de la boîte d'envoi :
    # n'en réécrire qu'une laisserait la seconde refuser le premier message
    # déposé, au milieu d'une transaction qui vient d'écrire une décision.
    for table in ("notification_preference", "outbound_message"):
        op.drop_constraint("notification_kind", table, type_="check")
        op.create_check_constraint(
            "notification_kind",
            table,
            "kind IN ('booking_approved', 'booking_declined', 'booking_cancelled_by_business', 'publication_reminder', 'publication_approved', 'publication_resubmit', 'booking_to_review', 'subscription_grace_ending', 'subscription_ended', 'support_access_started', 'collaboration_opened', 'collaboration_unfulfilled')",
        )


def downgrade() -> None:
    """Downgrade schema."""
    for table in ("notification_preference", "outbound_message"):
        op.execute(
            f"DELETE FROM {table} WHERE kind IN "
            "('collaboration_opened', 'collaboration_unfulfilled')"
        )
        op.drop_constraint("notification_kind", table, type_="check")
        op.create_check_constraint(
            "notification_kind",
            table,
            "kind IN ('booking_approved', 'booking_declined', 'booking_cancelled_by_business', 'publication_reminder', 'publication_approved', 'publication_resubmit', 'booking_to_review', 'subscription_grace_ending', 'subscription_ended', 'support_access_started')",
        )
