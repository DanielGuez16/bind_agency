"""non chevauchement des plages de capacite

Revision ID: aab5ee4557ff
Revises: dc8a03ef1017
Create Date: 2026-08-06 00:55:00.000000+00:00

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "aab5ee4557ff"
down_revision: Union[str, Sequence[str], None] = "dc8a03ef1017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Migration écrite à la main.
#
# Le service vérifie déjà le chevauchement et renvoie `capacity_rule_overlap`.
# Cette contrainte ne le remplace pas : elle le double, pour le jour où des
# plages sont écrites en masse sans passer par le service — le jeu de données de
# départ, puis l'import de la phase 9.
#
# `&&` sur des plages est strict aux bornes : 09:00-12:00 et 12:00-18:00 ne se
# recouvrent pas. C'est exactement la sémantique du service, un commerce qui
# ferme et rouvre à midi reste cohérent.
#
# `btree_gist` est nécessaire pour mettre `business_id` et `weekday` — comparés
# par égalité — dans un index GiST aux côtés de la plage.
#
# Postgres n'a pas de type de plage sur `time` en standard, il faut le créer.
NON_CHEVAUCHEMENT = """
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$ BEGIN
    CREATE TYPE timerange AS RANGE (subtype = time);
EXCEPTION WHEN duplicate_object THEN
    NULL;
END $$;

ALTER TABLE capacity_rule
    ADD CONSTRAINT ex_capacity_rule_no_overlap
    EXCLUDE USING gist (
        business_id WITH =,
        weekday WITH =,
        timerange(start_time, end_time) WITH &&
    );
"""

# La contrainte est validée contre les lignes existantes : sur une base déjà
# peuplée de plages qui se chevauchent, il faudrait les corriger avant.
RETOUR = """
ALTER TABLE capacity_rule DROP CONSTRAINT IF EXISTS ex_capacity_rule_no_overlap;
DROP TYPE IF EXISTS timerange;
"""


def upgrade() -> None:
    """Upgrade schema."""
    op.execute(NON_CHEVAUCHEMENT)


def downgrade() -> None:
    """Downgrade schema."""
    # `btree_gist` n'est volontairement pas supprimée, comme `postgis` : une
    # extension peut être partagée avec d'autres schémas de la même base.
    op.execute(RETOUR)
