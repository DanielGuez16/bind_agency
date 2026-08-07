"""adresse de retour sur l etat oauth

Revision ID: 7325515d6c1a
Revises: c4639ddeb226
Create Date: 2026-08-07 20:09:32.080877+00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "7325515d6c1a"
down_revision: Union[str, Sequence[str], None] = "c4639ddeb226"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Nullable : un parcours ouvert depuis un navigateur n'a pas d'application
    # à rejoindre, et le rappel lui rend le compte en JSON. Une colonne non
    # nulle obligerait à inventer une adresse pour ce cas-là.
    op.add_column("oauth_state", sa.Column("return_url", sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("oauth_state", "return_url")
