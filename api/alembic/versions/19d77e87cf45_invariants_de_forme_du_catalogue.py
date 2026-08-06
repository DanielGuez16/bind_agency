"""invariants de forme du catalogue

Revision ID: 19d77e87cf45
Revises: 80575dec6775
Create Date: 2026-08-06 00:20:00.000000+00:00

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "19d77e87cf45"
down_revision: Union[str, Sequence[str], None] = "80575dec6775"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Migration écrite à la main : deux invariants de forme que le service tenait
# seul, et que le premier import en masse de la phase 9 contournerait sans que
# personne ne relise.
#
# Ils demandent de regarder les lignes voisines — le parent, les enfants — ce
# qu'un CHECK ne peut pas faire. D'où le trigger.
#
# La clé étrangère composite `fk_catalog_item_parent_business` garantit déjà que
# variante et parent appartiennent au même commerce. Elle ne dit rien de la
# nature du parent ni de la profondeur.
FORME_DU_CATALOGUE = """
CREATE OR REPLACE FUNCTION catalog_item_enforce_shape() RETURNS trigger AS $$
DECLARE
    parent_requires_booking boolean;
    parent_has_parent boolean;
BEGIN
    IF NEW.parent_item_id IS NOT NULL THEN
        -- Borne au meme commerce : un parent d'ailleurs n'est pas notre affaire,
        -- c'est fk_catalog_item_parent_business qui le refuse, et son message
        -- est le bon. Sans ce filtre, le trigger repondrait a sa place.
        SELECT requires_booking, parent_item_id IS NOT NULL
          INTO parent_requires_booking, parent_has_parent
          FROM catalog_item
         WHERE id = NEW.parent_item_id
           AND business_id = NEW.business_id;

        IF FOUND THEN
            -- Profondeur d'abord : sur une variante reservable, c'est le
            -- diagnostic utile, l'autre regle ne ferait que le masquer.
            IF parent_has_parent THEN
                RAISE EXCEPTION 'une variante ne peut pas avoir de variantes'
                    USING ERRCODE = 'restrict_violation';
            END IF;

            -- Un parent regroupe des variantes : c'est la variante qui se reserve.
            IF parent_requires_booking THEN
                RAISE EXCEPTION 'un item qui a des variantes ne peut pas etre reservable'
                    USING ERRCODE = 'restrict_violation';
            END IF;
        END IF;

        -- La meme chaine de trois niveaux, construite par l'autre bout.
        IF EXISTS (SELECT 1 FROM catalog_item WHERE parent_item_id = NEW.id) THEN
            RAISE EXCEPTION 'une variante ne peut pas avoir de variantes'
                USING ERRCODE = 'restrict_violation';
        END IF;
    END IF;

    -- Le sens inverse de la seconde regle : rendre reservable un item qui a
    -- deja des variantes.
    IF NEW.requires_booking
       AND EXISTS (SELECT 1 FROM catalog_item WHERE parent_item_id = NEW.id) THEN
        RAISE EXCEPTION 'un item qui a des variantes ne peut pas etre reservable'
            USING ERRCODE = 'restrict_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER catalog_item_shape
    BEFORE INSERT OR UPDATE ON catalog_item
    FOR EACH ROW EXECUTE FUNCTION catalog_item_enforce_shape();
"""


def upgrade() -> None:
    """Upgrade schema."""
    op.execute(FORME_DU_CATALOGUE)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP FUNCTION IF EXISTS catalog_item_enforce_shape() CASCADE")
