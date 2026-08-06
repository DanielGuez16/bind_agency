"""photos de couverture et d article

Une photo de couverture par commerce, une photo par article de catalogue.

**Une clé de stockage objet, jamais une URL.** Une URL signée expire, une URL
publique fuit, et les deux se retrouveraient figées en base le jour d'un
changement de fournisseur. La clé ne dépend de personne : c'est au moment de
servir qu'on en fabrique un accès. Mêmes règles que les preuves de publication.

**Nullables toutes les deux.** Un commerce fraîchement inscrit n'a pas de
photo, et exiger une image avant de pouvoir s'inscrire perdrait des commerces
sur une étape qui n'engage rien. Un article sans photo reste parfaitement
réservable : c'est l'affichage qui s'en arrange, pas la réservation.

Revision ID: 753165dfdbd2
Revises: f3f50d60896c
Create Date: 2026-08-06 18:23:22.885752+00:00

"""

import sqlalchemy as sa
from alembic import op


revision: str = "753165dfdbd2"
down_revision: str | None = "f3f50d60896c"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column("business", sa.Column("cover_photo_key", sa.Text(), nullable=True))
    op.add_column("catalog_item", sa.Column("photo_key", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("catalog_item", "photo_key")
    op.drop_column("business", "cover_photo_key")
