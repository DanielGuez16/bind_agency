"""avis de favori et son reglage

Revision ID: 180a1f13cdbb
Revises: 353367c94661
Create Date: 2026-08-24 02:56:06.941224+00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "180a1f13cdbb"
down_revision: Union[str, Sequence[str], None] = "353367c94661"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


#: Les deux énumérations applicatives touchées, recopiées ici. Une contrainte
#: `CHECK` ne se relit pas depuis le code : `autogenerate` ne voit jamais une
#: valeur neuve, et une migration doit pouvoir se rejouer telle quelle dans dix
#: ans sur un code qui aura bougé.
GENRES = "'booking_approved', 'booking_declined', 'booking_cancelled_by_business', 'publication_reminder', 'publication_approved', 'publication_resubmit', 'collaboration_opened', 'collaboration_unfulfilled', 'account_verification', 'booking_to_review', 'subscription_grace_ending', 'subscription_ended', 'support_access_started', 'favorite_available'"
GENRES_AVANT = "'booking_approved', 'booking_declined', 'booking_cancelled_by_business', 'publication_reminder', 'publication_approved', 'publication_resubmit', 'collaboration_opened', 'collaboration_unfulfilled', 'account_verification', 'booking_to_review', 'subscription_grace_ending', 'subscription_ended', 'support_access_started'"
TRAVAUX = "'token_refresh', 'metrics_refresh', 'booking_hold_sweep', 'collaboration_deadline_sweep', 'collaboration_reminder_sweep', 'link_click_purge_sweep', 'subscription_grace_sweep', 'outbox_sweep', 'favorite_availability_sweep', 'account_deletion_sweep'"
TRAVAUX_AVANT = "'token_refresh', 'metrics_refresh', 'booking_hold_sweep', 'collaboration_deadline_sweep', 'collaboration_reminder_sweep', 'link_click_purge_sweep', 'subscription_grace_sweep', 'outbox_sweep', 'account_deletion_sweep'"


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "app_user",
        sa.Column(
            "favoris_me_previennent", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
    )
    op.add_column("creator_favorite", sa.Column("dernier_etat", sa.Text(), nullable=True))

    # **Écrites à la main, comme toutes les valeurs d'énumération applicative.**
    # Les noms sont **nus** : la convention du dépôt préfixe `ck_<table>_`, et
    # passer le nom complet le double — `ck_outbound_message_ck_outbound_message_…`,
    # que Postgres ne trouve pas.
    op.drop_constraint("notification_kind", "outbound_message", type_="check")
    op.create_check_constraint("notification_kind", "outbound_message", f"kind IN ({GENRES})")
    op.drop_constraint("job_type", "job", type_="check")
    op.create_check_constraint("job_type", "job", f"job_type IN ({TRAVAUX})")


def downgrade() -> None:
    """Downgrade schema.

    **Les lignes du genre neuf partent avant de restreindre.** Un avis de favori
    déposé ne se convertit pas en autre chose : il n'a pas d'équivalent d'avant,
    et le garder sous un genre voisin ferait partir un message qui parle d'une
    prestation à quelqu'un qui n'a rien mis en favori. Les jobs de balayage se
    retirent pour la même raison — le retour arrière rend un produit qui n'a
    pas cette fonction.
    """
    op.execute("DELETE FROM outbound_message WHERE kind = 'favorite_available'")
    op.execute("DELETE FROM job WHERE job_type = 'favorite_availability_sweep'")

    op.drop_constraint("job_type", "job", type_="check")
    op.create_check_constraint("job_type", "job", f"job_type IN ({TRAVAUX_AVANT})")
    op.drop_constraint("notification_kind", "outbound_message", type_="check")
    op.create_check_constraint("notification_kind", "outbound_message", f"kind IN ({GENRES_AVANT})")

    op.drop_column("creator_favorite", "dernier_etat")
    op.drop_column("app_user", "favoris_me_previennent")
