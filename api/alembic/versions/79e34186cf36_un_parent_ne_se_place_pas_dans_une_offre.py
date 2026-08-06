"""un parent ne se place pas dans une offre

Revision ID: 79e34186cf36
Revises: ca6ed22e418a
Create Date: 2026-08-06 02:05:00.000000+00:00

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "79e34186cf36"
down_revision: Union[str, Sequence[str], None] = "ca6ed22e418a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Migration écrite à la main. Prolongement de `catalog_item_shape` : un parent
# regroupe des variantes, c'est la variante qui se réserve, donc c'est elle qui
# se propose.
#
# La règle a deux sens et il faut les deux, sinon elle se contourne en changeant
# l'ordre des opérations :
#   1. placer dans une offre un item qui a déjà des variantes ;
#   2. donner une variante à un item déjà placé dans une offre, ce qui le
#      transforme en parent après coup.
#
# Une fonction, deux triggers, un sur chaque table concernée. Aucune clé
# étrangère ne peut le faire : « être un parent » n'est pas une colonne, c'est
# l'existence d'une autre ligne.
UN_PARENT_NE_S_OFFRE_PAS = """
CREATE OR REPLACE FUNCTION tier_offer_reject_parent() RETURNS trigger AS $$
BEGIN
    IF TG_TABLE_NAME = 'tier_offer' THEN
        IF EXISTS (SELECT 1 FROM catalog_item WHERE parent_item_id = NEW.catalog_item_id) THEN
            RAISE EXCEPTION 'un item qui a des variantes ne se place pas dans une offre'
                USING ERRCODE = 'restrict_violation';
        END IF;
    ELSIF NEW.parent_item_id IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM tier_offer WHERE catalog_item_id = NEW.parent_item_id) THEN
            RAISE EXCEPTION 'cet item est deja place dans une offre, il ne peut pas devenir un parent'
                USING ERRCODE = 'restrict_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tier_offer_holds_no_parent
    BEFORE INSERT OR UPDATE ON tier_offer
    FOR EACH ROW EXECUTE FUNCTION tier_offer_reject_parent();

CREATE TRIGGER catalog_item_offered_stays_leaf
    BEFORE INSERT OR UPDATE ON catalog_item
    FOR EACH ROW EXECUTE FUNCTION tier_offer_reject_parent();
"""


def upgrade() -> None:
    """Upgrade schema."""
    op.execute(UN_PARENT_NE_S_OFFRE_PAS)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP FUNCTION IF EXISTS tier_offer_reject_parent() CASCADE")
