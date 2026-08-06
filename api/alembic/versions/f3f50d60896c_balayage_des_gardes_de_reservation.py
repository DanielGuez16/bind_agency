"""balayage des gardes de reservation

Nouveau type de job. Les énumérations étant rendues en `VARCHAR` + `CHECK`, en
ajouter une valeur revient à réécrire la contrainte — pas à altérer un type
natif, ce qui était précisément la raison de ce choix.

`booking_hold_sweep` est un balayage global : sa cible est une sentinelle fixe,
pas une ligne. Un job par réservation coûterait une ligne par place tenue, pour
un travail qui se fait en une requête.

**La colonne est élargie en même temps.** SQLAlchemy dimensionne un
`sa.Enum(native_enum=False)` sur la plus longue valeur connue au moment de la
création — quinze caractères ici. Ajouter une valeur plus longue sans toucher au
type produit une troncature refusée par Postgres, et la contrainte réécrite
n'aurait rien changé à l'affaire. C'est la base qui l'a signalé, pas nous.

Revision ID: f3f50d60896c
Revises: 0dbdd008ad2e
Create Date: 2026-08-06 18:40:00.000000+00:00

"""

import sqlalchemy as sa
from alembic import op

revision: str = "f3f50d60896c"
down_revision: str | None = "0dbdd008ad2e"
branch_labels: str | None = None
depends_on: str | None = None

#: `op.f` marque le nom comme déjà complet : sans lui, la convention de nommage
#: y rajouterait son préfixe et chercherait `ck_job_ck_job_job_type`.
CONTRAINTE = "job_type"
ANCIENNES = ("token_refresh", "metrics_refresh")
NOUVELLES = (*ANCIENNES, "booking_hold_sweep")


def _remplacer(valeurs: tuple[str, ...]) -> None:
    op.drop_constraint(op.f(f"ck_job_{CONTRAINTE}"), "job", type_="check")
    op.alter_column(
        "job", "job_type", type_=sa.String(max(len(v) for v in valeurs)), existing_nullable=False
    )
    liste = ", ".join(f"'{v}'" for v in valeurs)
    op.create_check_constraint(CONTRAINTE, "job", f"job_type IN ({liste})")


def upgrade() -> None:
    _remplacer(NOUVELLES)


def downgrade() -> None:
    # Les jobs du type retiré partent avec lui : les garder ferait échouer la
    # contrainte reconstruite, et un downgrade qui échoue à mi-chemin est pire
    # qu'un downgrade qui perd des lignes reconstructibles — la planification
    # les recrée d'elle-même.
    op.execute("DELETE FROM job WHERE job_type = 'booking_hold_sweep'")
    _remplacer(ANCIENNES)
