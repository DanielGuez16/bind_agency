"""retablir les seuils de collaborations

Les seuils de collaborations avaient été mis à zéro en phase 3 : le compteur
`completed_collabs_count` n'était alimenté par rien, et la condition rendait les
paliers `post` et `reel` inatteignables pour tout le monde. Un seuil qui refuse
tout le monde n'est pas un seuil, c'est une porte fermée.

Le compteur est maintenant alimenté par les événements de fiabilité, à chaque
contrepartie approuvée, et il est entièrement recalculable depuis eux. La
condition peut donc être rallumée.

Les valeurs rétablies sont celles d'origine, reprises de la migration qui les
avait neutralisées — pas réinventées ici.

Revision ID: f05a2b2458c7
Revises: 4250a29295e4
Create Date: 2026-08-06 23:00:00.000000+00:00

"""

import sqlalchemy as sa
from alembic import op

revision: str = "f05a2b2458c7"
down_revision: str | None = "4250a29295e4"
branch_labels: str | None = None
depends_on: str | None = None

#: Repris tel quel de `92891b6f300e`, qui les avait mis à zéro.
SEUILS_D_ORIGINE = {
    "a0ee68db-f167-4af3-ba72-e3149469da4a": 1,  # instagram post
    "a839969b-3965-4c7e-92b1-b6274f899162": 2,  # instagram reel
    "c201c729-8aa9-4de8-bb35-3ef34e4c42a6": 1,  # tiktok post
    "4b9e0c48-8b7d-4001-90e0-a78323903de9": 2,  # tiktok reel
}

_TIER = sa.table(
    "tier",
    sa.column("id", sa.Uuid),
    sa.column("min_completed_collabs", sa.Integer),
)


def upgrade() -> None:
    for identifiant, seuil in SEUILS_D_ORIGINE.items():
        op.execute(
            _TIER.update()
            .where(_TIER.c.id == sa.cast(identifiant, sa.Uuid))
            .values(min_completed_collabs=seuil)
        )


def downgrade() -> None:
    op.execute(
        _TIER.update()
        .where(_TIER.c.id.in_([sa.cast(i, sa.Uuid) for i in SEUILS_D_ORIGINE]))
        .values(min_completed_collabs=0)
    )
