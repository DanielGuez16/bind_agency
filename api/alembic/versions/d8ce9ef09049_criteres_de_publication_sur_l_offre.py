"""criteres de publication sur l offre

`collaboration` porte `required_mention` et `required_geotag` depuis la phase 1,
mais rien ne les alimentait : ils n'avaient aucune source. Les critères affichés
au créateur auraient donc toujours été vides, et « les critères sont ceux figés
à la candidature » n'aurait rien garanti.

Ils vivent sur l'offre, là où un commerce exprime ce qu'il attend de la
publication, et sont recopiés sur la contrepartie à la consommation. Le format
ne s'y trouve pas : il vient du palier, qui est précisément défini par le couple
plateforme × format.

Revision ID: d8ce9ef09049
Revises: 4535077e0b9a
Create Date: 2026-08-06 19:02:08.183600+00:00

"""

import sqlalchemy as sa
from alembic import op


revision: str = "d8ce9ef09049"
down_revision: str | None = "4535077e0b9a"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column("tier_offer", sa.Column("required_mention", sa.Text(), nullable=True))
    op.add_column(
        "tier_offer",
        sa.Column("required_geotag", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("tier_offer", "required_geotag")
    op.drop_column("tier_offer", "required_mention")
