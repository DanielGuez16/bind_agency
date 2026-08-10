"""Les médias qui appartiennent à la plateforme, et à aucun commerce.

Les six pastilles de catégorie de Discovery et la vidéo de l'écran d'accueil ne
sont la propriété de personne : aucune ligne de `business` ni de `catalog_item`
ne peut porter leur clé. Sans table, il n'y avait que de mauvaises réponses —
les recalculer à la volée est impossible, la clé étant une empreinte du
contenu ; les écrire en configuration mettrait une valeur produite par le dépôt
d'objets dans un fichier tenu à la main.

**Une table à deux colonnes, et un identifiant lisible.** `category/beauty`,
`home/video` : le slug est stable et se lit, là où la clé est une empreinte
illisible qui change à chaque fois que la photo change. C'est le slug que le
code cite, jamais la clé.
"""

from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class PlatformAsset(Base):
    __tablename__ = "platform_asset"

    #: `category/<valeur de BusinessCategory>`, `home/video`, `home/video-poster`.
    slug: Mapped[str] = mapped_column(sa.Text, primary_key=True)

    #: La clé dans le dépôt d'objets, à servir par `/media/{clé}`. Le préfixe
    #: dit déjà si le contenu est une vraie photo (`photos/category/…`) ou un
    #: dégradé de secours (`photos/genere/category/…`).
    object_key: Mapped[str] = mapped_column(sa.Text, nullable=False)

    #: `clock_timestamp()` et non `now()` : le semis repose les huit médias
    #: dans une seule transaction, et `now()` leur donnerait à tous le même
    #: instant — « le dernier reposé » n'aurait plus de réponse.
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("clock_timestamp()"),
        onupdate=sa.text("clock_timestamp()"),
    )
