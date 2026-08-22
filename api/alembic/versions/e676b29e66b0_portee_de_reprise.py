"""La portée d'une reprise, son auteur nommé, et sa spontanéité.

Revision ID: e676b29e66b0
Revises: 83b10e7d2ed3
Create Date: 2026-08-22 20:20:42.664539+00:00

**Le remplissage des lignes existantes est la seule décision de ce fichier.**
Les reprises déjà écrites n'avaient aucune portée, parce que rien ne les
bornait : elles ouvraient tout. Leur poser la liste complète des écrans dit
donc la vérité de ce qu'elles ont été, et non la règle qu'on installe. Leur
poser une portée étroite après coup ferait croire à une retenue qui n'a pas
existé.

`spontaneous` part à `true` pour la même raison : personne n'a jamais consigné
qu'un salon avait appelé, donc rien ne permet d'affirmer qu'il l'a fait. Le
défaut inconfortable est le seul honnête.

`admin_name` est recopié depuis le nom déclaré, et vaut « BIND » quand il n'y
en a pas — ce qui est le cas de tout le monde le jour de cette migration,
puisque la colonne naît ici.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e676b29e66b0"
down_revision: Union[str, Sequence[str], None] = "09b78b59127c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

#: Doublée depuis `PorteeDeReprise`, et volontairement : une migration doit
#: pouvoir se rejouer telle quelle dans dix ans, sur un code qui aura bougé.
PORTEES = ("fiche", "catalogue", "agenda", "contreparties", "annuaire", "abonnement", "chiffres")
_LISTE_SQL = ", ".join(f"'{p}'" for p in PORTEES)


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("app_user", sa.Column("display_name", sa.Text(), nullable=True))

    # Trois colonnes ajoutées nullables, remplies, puis resserrées : une table
    # qui porte des traces ne se vide pas pour accueillir une colonne.
    op.add_column("business_support_access", sa.Column("admin_name", sa.Text(), nullable=True))
    op.add_column("business_support_access", sa.Column("scope", sa.ARRAY(sa.Text()), nullable=True))
    op.add_column(
        "business_support_access",
        sa.Column("spontaneous", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )

    op.execute("UPDATE business_support_access SET admin_name = 'BIND' WHERE admin_name IS NULL")
    op.execute(
        f"UPDATE business_support_access SET scope = ARRAY[{_LISTE_SQL}]::text[] "
        "WHERE scope IS NULL"
    )

    op.alter_column("business_support_access", "admin_name", nullable=False)
    op.alter_column("business_support_access", "scope", nullable=False)

    op.create_check_constraint(
        "nom_non_vide", "business_support_access", "length(trim(admin_name)) > 0"
    )
    op.create_check_constraint(
        "portee_non_vide", "business_support_access", "cardinality(scope) > 0"
    )
    op.create_check_constraint(
        "portee_connue", "business_support_access", f"scope <@ ARRAY[{_LISTE_SQL}]::text[]"
    )


def downgrade() -> None:
    """Downgrade schema.

    Rien à convertir : ces colonnes n'ont pas d'équivalent avant elles, et les
    retirer rend exactement la table d'hier — une reprise sans portée, qui
    ouvrait tout.
    """
    op.drop_constraint("portee_connue", "business_support_access", type_="check")
    op.drop_constraint("portee_non_vide", "business_support_access", type_="check")
    op.drop_constraint("nom_non_vide", "business_support_access", type_="check")
    op.drop_column("business_support_access", "spontaneous")
    op.drop_column("business_support_access", "scope")
    op.drop_column("business_support_access", "admin_name")
    op.drop_column("app_user", "display_name")
