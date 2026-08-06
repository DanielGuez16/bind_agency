"""paliers de reference

Revision ID: ca6ed22e418a
Revises: aab5ee4557ff
Create Date: 2026-08-06 01:20:00.000000+00:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ca6ed22e418a"
down_revision: Union[str, Sequence[str], None] = "aab5ee4557ff"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Les paliers sont des données de référence, pas des données de test : ils
# doivent exister en production. Ils entrent donc par migration et non par la
# commande de jeu de données, qui ne tourne que sur des bases jetables.
#
# Les identifiants sont fixés en dur, pas générés à l'exécution : développement,
# CI, préproduction et production portent ainsi les mêmes, ce qui rend un
# `tier_id` lisible d'un environnement à l'autre.
#
# LES SEUILS SONT PROVISOIRES ET RESTENT À VALIDER. Ils sont modifiables par
# l'interface d'administration sans redéploiement — c'est la règle de
# configuration, ils ne sont ici que comme point de départ.
#
# Snapchat est posé mais inactif : l'accès partenaire n'est pas obtenu. Le
# palier existe pour que la bascule ne demande qu'un changement de `is_active`.
PALIERS = [
    # (id, plateforme, format, abonnés, collabs, score, ratio, ordre, actif)
    ("8f9bfcd8-39ff-41a3-9b6b-f00e40f8774d", "instagram", "story", 1000, 0, None, "1.000", 1, True),
    ("a0ee68db-f167-4af3-ba72-e3149469da4a", "instagram", "post", 5000, 1, None, "2.000", 2, True),
    (
        "a839969b-3965-4c7e-92b1-b6274f899162",
        "instagram",
        "reel",
        10000,
        2,
        "60.00",
        "3.000",
        3,
        True,
    ),
    ("f09a110c-0286-4d01-a643-19402e55ba71", "tiktok", "story", 1000, 0, None, "1.000", 1, True),
    ("c201c729-8aa9-4de8-bb35-3ef34e4c42a6", "tiktok", "post", 5000, 1, None, "2.000", 2, True),
    ("4b9e0c48-8b7d-4001-90e0-a78323903de9", "tiktok", "reel", 10000, 2, "60.00", "3.000", 3, True),
    ("44aa0033-a95a-4993-84d8-0be0354efd64", "snapchat", "story", 1000, 0, None, "1.000", 1, False),
]

_TIER = sa.table(
    "tier",
    sa.column("id", sa.Uuid),
    sa.column("platform", sa.String),
    sa.column("content_format", sa.String),
    sa.column("min_followers", sa.Integer),
    sa.column("min_completed_collabs", sa.Integer),
    sa.column("min_reliability_score", sa.Numeric),
    sa.column("value_ratio_hint", sa.Numeric),
    sa.column("display_order", sa.Integer),
    sa.column("is_active", sa.Boolean),
)


def upgrade() -> None:
    """Upgrade schema."""
    op.bulk_insert(
        _TIER,
        [
            {
                "id": identifiant,
                "platform": plateforme,
                "content_format": format_,
                "min_followers": abonnes,
                "min_completed_collabs": collabs,
                "min_reliability_score": score,
                "value_ratio_hint": ratio,
                # `display_order` est relatif à la plateforme : l'écran groupe
                # par réseau avant d'ordonner.
                "display_order": ordre,
                "is_active": actif,
            }
            for identifiant, plateforme, format_, abonnes, collabs, score, ratio, ordre, actif in PALIERS
        ],
    )


def downgrade() -> None:
    """Downgrade schema."""
    # Échoue volontairement si un palier est référencé par une offre ou une
    # contrepartie : effacer une donnée de référence encore utilisée serait pire
    # qu'un downgrade qui refuse.
    op.execute(_TIER.delete().where(_TIER.c.id.in_([palier[0] for palier in PALIERS])))
