"""devise de commerce immuable

Revision ID: 80575dec6775
Revises: 89f621c1f80f
Create Date: 2026-08-05 23:54:52.104116+00:00

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "80575dec6775"
down_revision: Union[str, Sequence[str], None] = "89f621c1f80f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Migration entièrement écrite à la main : aucun changement de modèle à
# détecter, seulement une garantie que le schéma seul peut porter.
#
# La devise est déclarée à la création et ne bouge plus. Tous les montants du
# commerce — prix de catalogue, `value_cents_snapshot` figé sur des réservations
# passées — sont libellés dans cette devise sans la porter eux-mêmes. La changer
# ne convertirait rien : elle réinterpréterait l'historique.
#
# Le schéma d'API ne permet pas de l'envoyer, mais un schéma protège une route,
# pas une table.
DEVISE_IMMUABLE = """
CREATE OR REPLACE FUNCTION business_reject_currency_change() RETURNS trigger AS $$
BEGIN
    IF NEW.currency <> OLD.currency THEN
        RAISE EXCEPTION 'la devise d''un commerce ne change pas : % vers %',
            OLD.currency, NEW.currency
            USING ERRCODE = 'restrict_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER business_currency_is_immutable
    BEFORE UPDATE ON business
    FOR EACH ROW EXECUTE FUNCTION business_reject_currency_change();
"""


def upgrade() -> None:
    """Upgrade schema."""
    op.execute(DEVISE_IMMUABLE)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP FUNCTION IF EXISTS business_reject_currency_change() CASCADE")
