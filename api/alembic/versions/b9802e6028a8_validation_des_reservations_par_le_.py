"""validation des reservations par le commerce

Revision ID: b9802e6028a8
Revises: fa1b037aa08e
Create Date: 2026-08-08 04:53:40.628159+00:00

Écrite à la main. L'autogénération proposait un simple `alter_column` élargissant
le VARCHAR : il aurait laissé la contrainte CHECK d'origine en place, laquelle
n'énumère pas `awaiting_business`. Le schéma aurait accepté la colonne et refusé
la valeur, à l'exécution, sur la première réservation confirmée.

L'ordre compte : on retire la contrainte **avant** d'élargir, sinon la
réécriture porte sur une colonne qui refuse déjà.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b9802e6028a8"
down_revision: str | Sequence[str] | None = "fa1b037aa08e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Le nom **court**. La convention de nommage du métadata le préfixe une
#: seconde fois ; le passer préfixé produirait `ck_booking_ck_booking_…`.
CONTRAINTE = "booking_status"

AVANT = ("held", "confirmed", "consumed", "cancelled", "no_show", "expired")
APRES = ("held", "awaiting_business", "confirmed", "consumed", "cancelled", "no_show", "expired")


def _check(valeurs: tuple[str, ...]) -> str:
    liste = ", ".join(f"'{valeur}'" for valeur in valeurs)
    return f"status IN ({liste})"


def upgrade() -> None:
    op.drop_constraint(CONTRAINTE, "booking", type_="check")
    op.alter_column(
        "booking",
        "status",
        existing_type=sa.VARCHAR(length=9),
        type_=sa.VARCHAR(length=17),
        existing_nullable=False,
        existing_server_default=sa.text("'held'::character varying"),
    )
    op.create_check_constraint(CONTRAINTE, "booking", _check(APRES))

    # Vrai pour tout le monde, y compris les commerces existants : la validation
    # devient la norme, et un commerce déjà inscrit doit être protégé par le
    # nouveau défaut plutôt que d'y échapper parce qu'il était là avant.
    op.add_column(
        "business",
        sa.Column(
            "requires_booking_approval",
            sa.Boolean(),
            server_default=sa.true(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("business", "requires_booking_approval")

    # Les réservations en attente du commerce n'ont pas d'équivalent en arrière :
    # elles retournent à `held`, l'état d'où elles venaient. Les laisser
    # violerait la contrainte reconstruite, et les supprimer perdrait une place
    # tenue.
    op.execute("UPDATE booking SET status = 'held' WHERE status = 'awaiting_business'")

    op.drop_constraint(CONTRAINTE, "booking", type_="check")
    op.alter_column(
        "booking",
        "status",
        existing_type=sa.VARCHAR(length=17),
        type_=sa.VARCHAR(length=9),
        existing_nullable=False,
        existing_server_default=sa.text("'held'::character varying"),
    )
    op.create_check_constraint(CONTRAINTE, "booking", _check(AVANT))
