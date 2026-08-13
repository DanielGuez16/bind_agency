"""Le journal des modifications de configuration.

**Pourquoi une table à part du journal d'audit.** Celui-ci décrit des
transitions : `from_status` vers `to_status`. Un seuil de palier qui passe de
mille à deux mille abonnés n'est pas une transition d'état, et le faire entrer
de force dans cette forme aurait produit des lignes qu'on ne saurait plus lire —
« to_status : 2000 » ne dit ni de quoi, ni depuis quoi.

**Ce que cette table existe pour répondre.** Un créateur perd l'accès à un
palier qu'il avait ; six semaines plus tard, personne ne sait si c'est son
audience qui a baissé ou le seuil qui a monté. Sans ces lignes, la seule façon
de trancher est de croire quelqu'un sur parole.

**Ce qui est écrit est ce qui a été écrit.** Les valeurs sont stockées en texte,
telles qu'elles ont été posées : un journal qui retypera un jour ses valeurs
selon la colonne d'origine se trompera le jour où la colonne change de type,
et c'est précisément ce jour-là qu'on viendra le relire.
"""

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPrimaryKey


class ConfigurationChange(UUIDPrimaryKey, Base):
    """Un champ de configuration modifié, et par qui."""

    __tablename__ = "configuration_change"

    #: Ce qui a changé — « tier », « subscription_plan ». Une chaîne et non une
    #: énumération : ce journal doit accepter demain une table qu'on n'a pas
    #: écrite, et refuser une valeur inconnue le rendrait muet là où il devrait
    #: parler.
    entity_type: Mapped[str] = mapped_column(sa.Text, nullable=False)
    #: Sans clé étrangère, pour la même raison que la cible d'un job : le
    #: journal vise plusieurs tables, et une clé polymorphe n'existe pas.
    entity_id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, nullable=False)

    field: Mapped[str] = mapped_column(sa.Text, nullable=False)
    #: Nuls quand la valeur l'était. C'est une information : un seuil de score
    #: qui passe de « aucun » à soixante n'est pas le même geste qu'un seuil
    #: qui monte de cinquante à soixante.
    value_before: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    value_after: Mapped[str | None] = mapped_column(sa.Text, nullable=True)

    #: RESTRICT : savoir qui a changé un seuil est tout l'objet de la table.
    #: Cet administrateur ne disparaît pas en silence.
    actor_user_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("app_user.id", ondelete="RESTRICT"), nullable=False
    )
    #: `clock_timestamp()` : plusieurs champs d'un même palier changent dans la
    #: même transaction, et `now()` leur donnerait le même instant — l'ordre des
    #: modifications deviendrait illisible, ce qui est déjà arrivé deux fois
    #: ailleurs dans ce dépôt.
    changed_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("clock_timestamp()")
    )

    __table_args__ = (
        # Une ligne qui ne change rien n'est pas une modification. Elle
        # remplirait le journal de bruit et ferait douter du reste.
        sa.CheckConstraint(
            "value_before IS DISTINCT FROM value_after",
            name="une_modification_change_quelque_chose",
        ),
        sa.CheckConstraint("length(trim(field)) > 0", name="champ_non_vide"),
        # Ce qu'on lit : l'histoire d'un objet, la plus récente d'abord.
        sa.Index("ix_configuration_change_entity_id_changed_at", "entity_id", "changed_at"),
    )
