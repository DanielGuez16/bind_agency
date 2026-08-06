"""neutralise les seuils de collaborations

Revision ID: 92891b6f300e
Revises: 79e34186cf36
Create Date: 2026-08-06 03:00:00.000000+00:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "92891b6f300e"
down_revision: Union[str, Sequence[str], None] = "79e34186cf36"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# `creator_profile.completed_collabs_count` n'est alimenté par aucun code : les
# événements de fiabilité qui devraient l'incrémenter sont la phase 8. Le
# compteur reste donc à zéro pour tout créateur réel.
#
# Conséquence, avant cette migration : les paliers exigeant une ou deux
# collaborations étaient inatteignables. Personne n'aurait jamais dépassé
# `story`, et le blocage n'aurait rien eu à voir avec le mérite du créateur.
#
# Les seuils passent donc à zéro. La condition existe toujours dans le moteur
# d'éligibilité — elle est simplement satisfaite par tout le monde tant que rien
# ne la mesure. Elle se rallume d'un changement de configuration, sans code.
#
# Tâche de rétablissement inscrite en phase 8.
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
    """Upgrade schema."""
    op.execute(
        _TIER.update().where(_TIER.c.id.in_(list(SEUILS_D_ORIGINE))).values(min_completed_collabs=0)
    )


def downgrade() -> None:
    """Downgrade schema."""
    for identifiant, seuil in SEUILS_D_ORIGINE.items():
        op.execute(
            _TIER.update().where(_TIER.c.id == identifiant).values(min_completed_collabs=seuil)
        )
