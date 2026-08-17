"""little haiti entre dans la liste

Revision ID: c99cdfb48e8c
Revises: e77b5e5492b3

**Écrite à la main, parce que l'autogénération ne voit pas ce changement.**
`neighborhood` est un `sa.Enum(..., native_enum=False)` : en base, ce n'est pas
un type mais une **contrainte de vérification** qui énumère les valeurs
acceptées. Alembic compare les colonnes et les contraintes par leur nom, pas
leur contenu : la contrainte s'appelle toujours `ck_business_neighborhood`, donc
il ne détecte rien, et `alembic check` reste muet. Une valeur ajoutée à
l'énumération Python sans cette migration serait refusée par la base à la
première écriture — un 500 sur une valeur que le schéma d'entrée accepte.

**On remplace, on ne complète pas.** Une contrainte de vérification ne s'étend
pas : on la supprime et on la repose avec la liste entière. La liste ci-dessous
est donc l'unique endroit où l'ordre des dix valeurs se lit en SQL, et elle doit
rester d'accord avec `Neighborhood`.

**Rien à remplir.** Aucun commerce n'est à Little Haiti aujourd'hui : la valeur
devient simplement acceptable. Le retour arrière la retire, et il échouerait si
un commerce s'y était déclaré entre-temps — c'est voulu, effacer silencieusement
le quartier de quelqu'un pour redescendre d'une version serait pire.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "c99cdfb48e8c"
down_revision: str | Sequence[str] | None = "e77b5e5492b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Le nom complet, tel qu'il existe en base.
#:
#: Passé par `op.f()` partout : sans lui, la convention de nommage du dépôt le
#: préfixe une seconde fois et produit `ck_business_ck_business_neighborhood`,
#: qui n'existe pas. La migration échoue alors au `DROP`, ce qui est le bon
#: moment pour le découvrir — mais seulement si on l'exécute.
CONTRAINTE = "ck_business_neighborhood"

#: Les dix, dans l'ordre de l'énumération Python.
AVEC_LITTLE_HAITI = (
    "wynwood",
    "brickell",
    "south_beach",
    "little_havana",
    "little_haiti",
    "design_district",
    "coral_gables",
    "midtown",
    "edgewater",
    "coconut_grove",
)

SANS_LITTLE_HAITI = tuple(q for q in AVEC_LITTLE_HAITI if q != "little_haiti")


def _condition(valeurs: tuple[str, ...]) -> str:
    liste = ", ".join(f"'{valeur}'" for valeur in valeurs)
    return f"neighborhood IN ({liste})"


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_constraint(op.f(CONTRAINTE), "business", type_="check")
    op.create_check_constraint(op.f(CONTRAINTE), "business", _condition(AVEC_LITTLE_HAITI))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(op.f(CONTRAINTE), "business", type_="check")
    op.create_check_constraint(op.f(CONTRAINTE), "business", _condition(SANS_LITTLE_HAITI))
