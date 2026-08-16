"""le delai d accord du commerce

Revision ID: 1e385c5a2f9e
Revises: a315f9a55e57
Create Date: 2026-08-16 13:54:18.009604+00:00

**L'ordre des trois opérations est le sujet de cette migration.** L'ébauche
produite par l'autogénération posait la contrainte avant de remplir la colonne :
sur une base portant la moindre demande en attente, la création de la contrainte
échouait, et le déploiement s'arrêtait là. Colonne, puis remplissage, puis
contrainte.

**Ce que le remplissage donne aux demandes déjà en vol.** Vingt-quatre heures à
compter du déploiement, bornées par le début du créneau. Leur donner l'échéance
qu'elles *auraient eue* si la règle avait toujours existé ferait expirer d'un
coup, au premier balayage, des demandes que des commerces sont peut-être en
train de regarder — et les créatrices en face liraient un refus qui n'a été
prononcé par personne.

`LEAST` ignore les valeurs nulles en Postgres : un droit sans créneau, dont
`starts_at` est nul, reçoit donc le délai plein, ce qui est exactement la règle
du service.

**Vingt-quatre heures écrites ici, alors que la règle vit en configuration.**
Une migration doit rendre le même résultat dans dix ans, sur une base dont on ne
sait rien : lire `booking_approval_seconds` la rendrait dépendante d'un réglage
qui aura bougé, et le remplissage d'hier ne serait plus reproductible. C'est une
donnée posée une fois, pas la règle — celle-ci reste dans `config.py`.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "1e385c5a2f9e"
down_revision: str | Sequence[str] | None = "a315f9a55e57"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "booking", sa.Column("approval_expires_at", sa.DateTime(timezone=True), nullable=True)
    )

    op.execute(
        """
        UPDATE booking
           SET approval_expires_at = LEAST(now() + interval '24 hours', starts_at)
         WHERE status = 'awaiting_business'
           AND approval_expires_at IS NULL
        """
    )

    op.create_index(
        "ix_booking_status_approval_expires_at",
        "booking",
        ["status", "approval_expires_at"],
        unique=False,
    )
    op.create_check_constraint(
        op.f("ck_booking_awaiting_business_has_approval_expiry"),
        "booking",
        "status <> 'awaiting_business' OR approval_expires_at IS NOT NULL",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        op.f("ck_booking_awaiting_business_has_approval_expiry"), "booking", type_="check"
    )
    op.drop_index("ix_booking_status_approval_expires_at", table_name="booking")
    op.drop_column("booking", "approval_expires_at")
