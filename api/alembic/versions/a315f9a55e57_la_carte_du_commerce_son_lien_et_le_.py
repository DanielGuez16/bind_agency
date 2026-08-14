"""La carte du commerce, son lien, et le choix laisse au createur

Trois ajouts d'un seul tenant, parce qu'ils ne servent qu'ensemble : sans le
drapeau, la carte n'est exigee nulle part ; sans la carte ni le lien, le drapeau
fermerait des offres sans issue.

`leaves_choice` est faux par defaut. Une valeur par defaut vraie fermerait a la
migration toutes les offres deja ouvertes, sur un lancement en beaute ou une
prestation designe presque toujours quelque chose de precis.

Aucune colonne enumeree ici, donc aucune contrainte CHECK a reecrire a la main :
c'est le piege habituel de ce depot, et il ne se presente pas cette fois.

Revision ID: a315f9a55e57
Revises: 920c338b2626
Create Date: 2026-08-14 19:20:58.981613+00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a315f9a55e57"
down_revision: Union[str, Sequence[str], None] = "920c338b2626"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "business_menu_page",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("business_id", sa.Uuid(), nullable=False),
        sa.Column("storage_key", sa.Text(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("alt_text", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("clock_timestamp()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "position >= 0", name=op.f("ck_business_menu_page_business_menu_page_position_positive")
        ),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["business.id"],
            name=op.f("fk_business_menu_page_business_id_business"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_business_menu_page")),
        sa.UniqueConstraint(
            "business_id",
            "position",
            deferrable=True,
            initially="DEFERRED",
            name="uq_business_menu_page_position",
        ),
    )
    op.create_index(
        "ix_business_menu_page_business_position",
        "business_menu_page",
        ["business_id", "position"],
        unique=False,
    )
    op.add_column("business", sa.Column("menu_url", sa.Text(), nullable=True))
    op.add_column(
        "catalog_item",
        sa.Column("leaves_choice", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("catalog_item", "leaves_choice")
    op.drop_column("business", "menu_url")
    op.drop_index("ix_business_menu_page_business_position", table_name="business_menu_page")
    op.drop_table("business_menu_page")
