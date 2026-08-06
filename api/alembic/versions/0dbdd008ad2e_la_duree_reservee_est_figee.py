"""la duree reservee est figee

Décision différée en phase 2, tranchée ici : `booking` porte sa propre
`duration_minutes`, et la clé étrangère composite vers `catalog_item` l'inclut.

Le problème était qu'un commerce allongeant un soin de trente à soixante minutes
allongeait rétroactivement toutes les réservations déjà prises — le calcul de
disponibilité, qui lit la durée de l'item, aurait vu des occupations qui
n'avaient jamais été réservées ainsi.

La clé étrangère composite est le même mécanisme que pour `requires_booking` :
elle interdit de fait la modification de la durée d'un item déjà réservé. C'est
voulu — on ne réécrit pas la nature d'une réservation passée — et le service
doit intercepter le cas pour demander la création d'un nouvel item, plutôt que
de laisser une violation brute atteindre l'appelant.

Un trigger aurait pu porter la même règle. La clé étrangère est meilleure : elle
tient sans qu'on ait à décider *quand* la vérifier, et un chemin d'écriture en
masse en hérite gratuitement.

`ends_at = starts_at + duration_minutes` est vérifié en base : les trois façons
de dire la même chose ne peuvent pas diverger.

**L'ancienne clé à trois colonnes reste en place, et il le faut.** Postgres
n'applique pas une clé composite dès qu'une de ses colonnes est nulle, et
`duration_minutes` l'est pour un item sans créneau : la nouvelle clé ne
garantirait rien sur ces lignes-là, celles où la nature de l'item est justement
la seule chose à vérifier. Les deux clés se complètent, retirer l'une rouvre un
trou que l'autre ne couvre pas.

Revision ID: 0dbdd008ad2e
Revises: fd260f31365f
Create Date: 2026-08-06 16:20:00.000000+00:00

"""

import sqlalchemy as sa
from alembic import op

revision: str = "0dbdd008ad2e"
down_revision: str | None = "fd260f31365f"
branch_labels: str | None = None
depends_on: str | None = None

NOUVELLE_FK = "fk_booking_item_business_shape"
NOUVELLE_UQ = "uq_catalog_item_bookable_shape"


def upgrade() -> None:
    op.add_column("booking", sa.Column("duration_minutes", sa.Integer(), nullable=True))

    # Les réservations existantes tirent leur durée de leurs propres bornes :
    # c'est bien la durée qui a été réservée, et non celle que porte l'item
    # aujourd'hui. Toute la raison d'être de cette migration.
    op.execute(
        """
        UPDATE booking
           SET duration_minutes = (EXTRACT(EPOCH FROM (ends_at - starts_at)) / 60)::int
         WHERE starts_at IS NOT NULL
        """
    )

    op.create_unique_constraint(
        NOUVELLE_UQ,
        "catalog_item",
        ["id", "business_id", "requires_booking", "duration_minutes"],
    )

    # L'ancienne clé **reste**. Postgres n'applique pas une clé composite dès
    # qu'une de ses colonnes est nulle, et `duration_minutes` l'est pour un item
    # sans créneau : la nouvelle clé ne garantirait donc rien sur ces lignes,
    # celles où la nature de l'item est justement la seule chose à vérifier.
    # Un test existant l'a montré en cessant de refuser ce qu'il refusait avant.
    op.create_foreign_key(
        NOUVELLE_FK,
        "booking",
        "catalog_item",
        ["catalog_item_id", "business_id", "requires_booking", "duration_minutes"],
        ["id", "business_id", "requires_booking", "duration_minutes"],
        ondelete="RESTRICT",
    )

    op.create_check_constraint(
        "duration_matches_requires_booking",
        "booking",
        "(requires_booking AND duration_minutes IS NOT NULL)"
        " OR (NOT requires_booking AND duration_minutes IS NULL)",
    )
    op.create_check_constraint(
        "ends_at_follows_duration",
        "booking",
        "starts_at IS NULL OR ends_at = starts_at + make_interval(mins => duration_minutes)",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_booking_ends_at_follows_duration"), "booking", type_="check")
    op.drop_constraint(
        op.f("ck_booking_duration_matches_requires_booking"), "booking", type_="check"
    )
    op.drop_constraint(NOUVELLE_FK, "booking", type_="foreignkey")
    op.drop_constraint(NOUVELLE_UQ, "catalog_item", type_="unique")
    op.drop_column("booking", "duration_minutes")
