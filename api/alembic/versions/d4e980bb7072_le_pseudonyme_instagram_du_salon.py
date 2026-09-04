"""le pseudonyme instagram du salon

**Distinct d'`instagram_url`, et ce n'est pas un doublon.** Le commentaire du
modele le dit depuis toujours : le salon donne l'adresse qu'il veut montrer,
« qui peut etre une page de marque et non un compte ». On ne peut donc pas
deriver le pseudonyme de l'adresse — `instagram.com/maison.rivage` peut mener a
une page dont le pseudonyme n'est pas `@maison.rivage`, et une creatrice qui
recopierait l'adresse citerait le mauvais compte.

**Aucun remplissage retroactif, volontairement.** Il n'existe aucune regle sure
pour deduire un pseudonyme d'une adresse, et une valeur devinee serait pire que
son absence : elle serait proposee au salon comme une valeur qu'il a donnee.
Les salons deja inscrits ont donc `NULL` et le renseignent quand ils composent.

**Instagram seul.** TikTok n'a pas d'integration (Phase 0) ; le jour ou il en
aura une, c'est une colonne de plus — la meme regle que les quatre liens.

Revision ID: d4e980bb7072
Revises: c7d4e1a90b52
Create Date: 2026-09-04 03:51:03.516295+00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d4e980bb7072"
down_revision: Union[str, Sequence[str], None] = "c7d4e1a90b52"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("business", sa.Column("instagram_handle", sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("business", "instagram_handle")
