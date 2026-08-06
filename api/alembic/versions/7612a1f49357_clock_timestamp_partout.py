"""clock_timestamp partout

Deuxième fois que `now()` mord, donc revue de toutes les colonnes concernées
plutôt qu'une correction de plus.

`now()` renvoie l'heure d'**ouverture de la transaction**. Toute ligne écrite
dans la même transaction reçoit donc le même instant, et une colonne censée
ordonner des événements n'ordonne plus rien. Deux cas l'avaient déjà montré :
`audit_log.occurred_at`, où « révoqué puis émis » devenait illisible, et
`social_metrics_snapshot.captured_at`, où « le dernier relevé » n'avait plus de
réponse.

Deux défauts présents en base au moment d'écrire cette migration, tous deux sur
des colonnes triées par un service :

- les dix `tier_offer` du jeu de données partageaient un seul `created_at`, et
  `list_offers` trie dessus ;
- les trois `social_account` du jeu partageaient un seul `connected_at`, et
  `list_accounts` trie dessus.

`catalog_item.updated_at` avait un troisième défaut, moins visible : une ligne
créée puis modifiée dans la même transaction se retrouvait avec un `updated_at`
antérieur à son `created_at`.

Aucune donnée existante n'est réécrite : les instants déjà enregistrés sont ce
qu'ils sont, seule la valeur par défaut change.

Revision ID: 7612a1f49357
Revises: 595f223feafb
Create Date: 2026-08-06 04:12:00.000000+00:00

"""

import sqlalchemy as sa
from alembic import op

revision: str = "7612a1f49357"
down_revision: str | None = "595f223feafb"
branch_labels: str | None = None
depends_on: str | None = None

#: Toutes les colonnes à défaut temporel serveur, hors les deux déjà corrigées.
COLONNES = [
    ("app_user", "created_at"),
    ("booking", "created_at"),
    ("business", "created_at"),
    ("catalog_item", "created_at"),
    ("catalog_item", "updated_at"),
    ("collaboration", "created_at"),
    ("creator_profile", "created_at"),
    ("menu_import", "created_at"),
    ("oauth_state", "created_at"),
    ("proof", "submitted_at"),
    ("refresh_token", "issued_at"),
    ("reliability_event", "occurred_at"),
    ("social_account", "connected_at"),
    ("tier_offer", "created_at"),
]


def upgrade() -> None:
    for table, colonne in COLONNES:
        op.alter_column(table, colonne, server_default=sa.text("clock_timestamp()"))


def downgrade() -> None:
    for table, colonne in COLONNES:
        op.alter_column(table, colonne, server_default=sa.text("now()"))
