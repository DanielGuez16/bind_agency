"""Le lien traqué : un identifiant court par contrepartie, et ses clics.

**Pourquoi ces tables existent.** TikTok ne rend pas la composition
géographique d'une audience, et Instagram ne la rend qu'au-dessus d'un seuil
d'abonnés. Un créateur peut donc être à Miami et toucher l'Inde, sans que rien
dans le produit ne le dise. On cesse de le prédire à partir du nombre
d'abonnés : on le mesure, sur les gens qui ont réellement cliqué.

**Aucune colonne ne porte d'adresse IP, et aucune n'en portera.** L'adresse
entre dans le service de redirection, sert à résoudre une ville et à calculer
une empreinte, puis disparaît avec la requête. C'est une contrainte de
conception : il n'y a pas de champ à oublier de purger, parce qu'il n'y a pas
de champ.

**L'empreinte n'est pas une identité, et elle ne survit pas à sa fenêtre.**
Elle sert à ne pas compter deux fois la même personne qui rouvre une story. Son
sel est tiré au hasard chaque jour et **détruit** avec les empreintes : une fois
le sel parti, plus rien ne permet de relier deux clics — ni à un tiers, ni à
nous, ni avec l'adresse d'origine en main.

**Les coups écartés sont conservés, sans être comptés.** Un robot, un
préchargement ou un doublon ne figure dans aucun agrégat, mais la trace de son
rejet reste un temps : c'est la forme des rejets qui révèle une campagne
fabriquée, et la jeter reviendrait à s'aveugler sur le seul signal qui la
dénonce.
"""

import uuid
from datetime import date, datetime

import sqlalchemy as sa
from geoalchemy2 import Geography
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAt, UUIDPrimaryKey, enum_column
from app.models.enums import ClickOutcome, DeviceFamily


class CollaborationLink(UUIDPrimaryKey, CreatedAt, Base):
    """Le lien d'une contrepartie. Un seul, pour toute sa vie.

    **Un par contrepartie et non un par soumission** : le créateur le place dans
    son sticker au moment de publier, et une nouvelle demande de publication ne
    doit pas invalider un lien déjà en ligne. La contrainte d'unicité le dit.
    """

    __tablename__ = "collaboration_link"

    collaboration_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("collaboration.id", ondelete="CASCADE"), nullable=False
    )
    #: L'identifiant court qui circule. Tiré au hasard, jamais dérivé de
    #: l'identifiant de la contrepartie : un lien devinable laisserait fabriquer
    #: des clics sur la collaboration de quelqu'un d'autre.
    slug: Mapped[str] = mapped_column(sa.Text, nullable=False)
    #: Un lien se désactive, il ne se supprime pas : les clics déjà comptés
    #: restent rattachés à quelque chose.
    is_active: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.text("true")
    )

    __table_args__ = (
        sa.UniqueConstraint("collaboration_id"),
        sa.UniqueConstraint("slug"),
    )


class LinkClickSalt(Base):
    """Le sel du jour, tiré au hasard et destiné à disparaître.

    **C'est lui qui rend l'oubli définitif.** L'empreinte d'un clic est un HMAC
    de ce sel ; le sel effacé, l'empreinte n'est plus recalculable par personne,
    même en possession de l'adresse d'origine. Une clé de configuration, elle,
    resterait — et avec elle la possibilité de relier rétroactivement.

    Une ligne par jour, purgée avec les empreintes qu'elle a servi à produire.
    """

    __tablename__ = "link_click_salt"

    #: Le jour UTC. Clé primaire : il n'y a qu'un sel par jour, et deux
    #: requêtes simultanées ne doivent pas en créer deux.
    jour: Mapped[date] = mapped_column(sa.Date, primary_key=True)
    sel: Mapped[bytes] = mapped_column(sa.LargeBinary, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("clock_timestamp()")
    )


class LinkClick(UUIDPrimaryKey, Base):
    """Un passage sur un lien. Compté, ou écarté en disant pourquoi.

    `occurred_at` en `clock_timestamp()` : deux clics d'une même transaction —
    cas rare mais réel sous rafale — doivent s'ordonner entre eux, et `now()`
    les figerait au même instant.
    """

    __tablename__ = "link_click"

    link_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("collaboration_link.id", ondelete="CASCADE"), nullable=False
    )
    occurred_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("clock_timestamp()")
    )
    #: `compte` seul entre dans les agrégats. Les autres disent pourquoi ils
    #: n'y entrent pas, ce qui vaut mieux que de disparaître sans trace.
    outcome: Mapped[ClickOutcome] = mapped_column(
        enum_column(ClickOutcome, "click_outcome"), nullable=False
    )

    country_code: Mapped[str | None] = mapped_column(sa.String(2), nullable=True)
    region: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    city: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    #: **Le centre de la ville résolue, jamais la position du visiteur.**
    #: Identique pour tous ses habitants, et c'est ce qui le rend anodin. Stocké
    #: plutôt que réduit à un booléen « local » : le rayon est en configuration,
    #: et un booléen figé cesserait d'être vrai le jour où on le change.
    city_geo: Mapped[object | None] = mapped_column(
        # `Geography` comme `business.geo`, et `spatial_index=False` comme
        # elle : l'index implicite de GeoAlchemy2 échappe à la convention de
        # nommage du dépôt, et se retrouve créé deux fois en migration.
        Geography(geometry_type="POINT", srid=4326, spatial_index=False),
        nullable=True,
    )

    device_family: Mapped[DeviceFamily] = mapped_column(
        enum_column(DeviceFamily, "device_family"), nullable=False
    )
    #: **L'hôte du référent, jamais l'adresse complète.** Une URL de référent
    #: transporte des chemins et des paramètres qui n'ont rien à faire ici ; on
    #: veut savoir « depuis Instagram », pas depuis quelle page.
    referrer_host: Mapped[str | None] = mapped_column(sa.Text, nullable=True)

    #: L'empreinte de déduplication. **Nullable, et vidée à l'échéance** par la
    #: purge : passé la fenêtre, elle n'a plus d'usage et ne doit plus exister.
    fingerprint: Mapped[str | None] = mapped_column(sa.Text, nullable=True)

    __table_args__ = (
        # L'agrégat par contrepartie, et la purge par date.
        sa.Index("ix_link_click_link_id_occurred_at", "link_id", "occurred_at"),
        # La recherche de doublon : même lien, même empreinte, fenêtre récente.
        sa.Index("ix_link_click_link_id_fingerprint", "link_id", "fingerprint"),
        # Le balayage des coups écartés.
        sa.Index("ix_link_click_outcome_occurred_at", "outcome", "occurred_at"),
        # La part locale : distance entre le centre de la ville et le salon.
        sa.Index("ix_link_click_city_geo", "city_geo", postgresql_using="gist"),
    )
