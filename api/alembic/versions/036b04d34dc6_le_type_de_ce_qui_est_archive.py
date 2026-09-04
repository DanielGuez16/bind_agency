"""le type de ce qui est archive

**Une cle ne dit pas ce qu'elle designe.** Elle est une empreinte et ne porte
pas d'extension — volontairement : se fier a une extension fournie par
l'appelant permettrait de faire servir n'importe quoi sous n'importe quel type.
La seule question qu'on savait donc poser d'une preuve etait « un fichier
existe-t-il ».

**Depuis que la video est acceptee, cette question ne suffit plus.** L'ecran des
publications lisait `bool(media_key or screenshot_key)` comme « il y a une
image » : une preuve MP4 y repondait oui, le repli vers la photo du service ne
se declenchait pas, et l'URL d'un MP4 partait vers un composant d'image. Le
champ promettait une image, il ne constatait qu'un depot.

Le type est donc releve **sur les octets**, a la soumission, au meme endroit et
au meme moment que l'empreinte — les deux repondent a « qu'est-ce qui a
reellement ete envoye », et les separer ferait relire l'objet deux fois.

**Aucune reprise retroactive, et `NULL` vaut image.** Jusqu'a l'acceptation de
la video, le selecteur comme le serveur ne prenaient que des images : toute
preuve anterieure en est une. C'est un fait d'histoire, pas une supposition, et
traiter ces lignes en inconnues ferait basculer sur la photo du service toutes
les publications deja archivees — un defaut remplace par une regression plus
large.

Revision ID: 036b04d34dc6
Revises: a1c7e4f92b30
Create Date: 2026-09-04 22:10:00.000000+00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "036b04d34dc6"
down_revision: str | Sequence[str] | None = "a1c7e4f92b30"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("proof", sa.Column("media_content_type", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("proof", "media_content_type")
