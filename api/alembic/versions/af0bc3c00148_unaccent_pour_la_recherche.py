"""unaccent pour la recherche

Revision ID: af0bc3c00148
Revises: c99cdfb48e8c

**Miami est bilingue, et c'est tout l'argument.** « Panadería », « Galería »,
« Librería » se tapent sans accent sur un clavier anglais, et sur un clavier
espagnol on saisit rarement l'accent dans un champ de recherche. Sans cette
extension, la moitié du marché est introuvable au clavier — le défaut se
présente comme un fil vide, ce qui est la pire façon de le découvrir.

**Une extension, pas un moteur.** `unaccent` est une fonction que Postgres
applique à une chaîne ; elle ne construit ni index ni vocabulaire et n'a rien à
tenir à jour. C'est le même registre que PostGIS et `btree_gist`, déjà présents.

**Ce qui n'est pas fait ici, délibérément.** Aucun index. À vingt salons et
soixante prestations, la recherche est un balayage de quelques microsecondes, et
un index coûterait plus cher à maintenir qu'à ne pas exister. Le jour où ça
cesse d'être vrai, le correctif est une migration qui ajoute `pg_trgm` et un
index GIN **sur les mêmes expressions** : la forme de la requête ne change pas,
donc rien de ce qui est écrit aujourd'hui n'est à réécrire.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "af0bc3c00148"
down_revision: str | Sequence[str] | None = "c99cdfb48e8c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent")


def downgrade() -> None:
    """Downgrade schema.

    L'extension n'est **pas** retirée. Elle ne porte aucune donnée, sa présence
    ne coûte rien, et un `DROP EXTENSION` casserait toute autre migration ou
    vue qui s'y appuierait entre-temps. Redescendre d'une version ne doit pas
    retirer un outil partagé.
    """
