"""tentatives sur le code de retrait

Le code de secours passe de huit à six caractères, groupés trois par trois : il
se dicte au téléphone et se tape sur un comptoir, deux gestes qu'une chaîne de
huit rendait pénibles.

Ce n'est pas la longueur qui protège. C'est que le code est lié à une
réservation, à usage unique, à durée courte — il meurt avec le droit de
consommer — et désormais **limité en tentatives**. Six caractères sur trente-deux
symboles font un milliard de combinaisons ; quelques essais ratés ferment la
porte bien avant qu'on en approche.

Le compteur porte sur le code, pas sur la réservation : c'est la même chose ici,
`redemption_code` étant unique par `booking_id`, et c'est la ligne qu'on tient
déjà en main au moment de refuser.

Revision ID: 4535077e0b9a
Revises: 753165dfdbd2
Create Date: 2026-08-06 18:42:40.585361+00:00

"""

import sqlalchemy as sa
from alembic import op


revision: str = "4535077e0b9a"
down_revision: str | None = "753165dfdbd2"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column(
        "redemption_code",
        sa.Column("failed_attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    op.create_check_constraint(
        op.f("ck_redemption_code_failed_attempts_positive"),
        "redemption_code",
        "failed_attempts >= 0",
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("ck_redemption_code_failed_attempts_positive"), "redemption_code", type_="check"
    )
    op.drop_column("redemption_code", "failed_attempts")
