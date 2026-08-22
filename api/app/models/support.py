"""La reprise d'un compte commerce par l'administration.

**Pourquoi cette table existe.** La fondatrice prépare des fiches et accompagne
des salons qui découvrent le produit ; il arrivera qu'il faille entrer dans un
compte pour débloquer quelque chose. Un accès permanent est commode le premier
mois et ingérable au centième salon : personne ne saurait plus qui peut entrer
où, ni ce qui a été fait au nom de qui.

**Trois garanties, et elles ne se séparent pas.**

*Explicite* : la reprise s'ouvre par un geste, avec un motif écrit à la main.
Une raison obligatoire est ce qui distingue une intervention d'une habitude.

*Bornée* : elle expire. Une reprise qu'on oublie de fermer redevient un accès
permanent au bout de quelques semaines, et c'est exactement ce qu'on refuse.

*Visible du salon* : il est prévenu à l'ouverture, et il lit la liste des
reprises passées. Un accès de support silencieux est un accès dont personne ne
peut demander compte — et le jour où un commerçant découvrira qu'on est entré
chez lui, ce qu'il retiendra n'est pas qu'on l'a aidé.

**Rien ne s'efface.** Une reprise close reste, avec son motif, son auteur et ses
deux dates. Ce qui a été fait pendant, le journal d'audit le porte déjà : chaque
transition écrite pendant une reprise a `actor_kind = admin`.
"""

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPrimaryKey
from app.models.enums import PorteeDeReprise


class BusinessSupportAccess(UUIDPrimaryKey, Base):
    """Un droit d'agir au nom d'un commerce, borné et déclaré."""

    __tablename__ = "business_support_access"

    # RESTRICT des deux côtés : cette ligne est une trace de ce qu'on s'est
    # autorisé à faire chez quelqu'un. Elle ne part pas avec le ménage.
    business_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("business.id", ondelete="RESTRICT"), nullable=False
    )
    admin_user_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("app_user.id", ondelete="RESTRICT"), nullable=False
    )
    #: **Le nom, recopié à l'ouverture.** Pas une jointure : c'est le nom sous
    #: lequel on s'est présenté ce jour-là, et il ne doit pas changer parce que
    #: quelqu'un s'est renommé depuis. Un gérant qui relit une reprise de mars
    #: doit lire ce qu'il a lu en mars.
    admin_name: Mapped[str] = mapped_column(sa.Text, nullable=False)

    #: **Ce que la reprise ouvre, et rien d'autre.** Déclaré à l'ouverture,
    #: vérifié à chaque requête. Une durée se renouvelle — il suffit de rouvrir
    #: quand la précédente s'éteint — une portée non : celui qui est venu pour
    #: la carte n'entrera pas dans les chiffres, quel que soit le temps qu'il y
    #: passe.
    scope: Mapped[list[str]] = mapped_column(sa.ARRAY(sa.Text), nullable=False)

    #: Vrai quand aucune demande du salon ne précède la reprise. **C'est la
    #: distinction que le gérant lit en premier** : être entré parce qu'il l'a
    #: demandé et être entré de sa propre initiative ne se défendent pas de la
    #: même façon, et confondre les deux ferait passer la seconde pour la
    #: première.
    #:
    #: Déclaré par l'administration, faute d'un canal par lequel le salon
    #: écrive — il n'en existe aucun aujourd'hui. Le défaut est donc `true` :
    #: le silence vaut « de ma propre initiative », et c'est celui qui affirme
    #: avoir été appelé qui doit le dire. L'inverse laisserait toute reprise
    #: se présenter comme sollicitée sans que personne ne l'ait sollicitée.
    spontaneous: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.text("true")
    )

    #: Pourquoi. **Obligatoire, et écrit à la main.** Un motif en liste
    #: déroulante se choisit sans réfléchir ; une phrase demande de savoir ce
    #: qu'on va faire. C'est aussi ce que le salon lira.
    reason: Mapped[str] = mapped_column(sa.Text, nullable=False)

    #: `clock_timestamp()` : ouvrir une reprise peut en clore une autre dans la
    #: même transaction, et `now()` leur donnerait le même instant.
    started_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("clock_timestamp()")
    )
    expires_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    #: Fermée avant son terme. Nulle tant qu'elle court — l'expiration ne la
    #: remplit pas : une reprise échue n'a pas été refermée, elle s'est éteinte,
    #: et les deux ne se lisent pas pareil dans une liste.
    ended_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)

    __table_args__ = (
        sa.CheckConstraint("length(trim(reason)) > 0", name="motif_non_vide"),
        sa.CheckConstraint("length(trim(admin_name)) > 0", name="nom_non_vide"),
        # Une portée vide ouvrirait tout ou rien, et les deux sont mauvais.
        sa.CheckConstraint("cardinality(scope) > 0", name="portee_non_vide"),
        # Et rien qui ne soit un écran connu : une valeur inventée passerait
        # sinon la déclaration sans jamais ouvrir quoi que ce soit, ce qui se
        # lirait comme une panne du support plutôt que comme une faute de
        # frappe. La liste est doublée ici parce qu'une contrainte applicative
        # ne survit pas à un `INSERT` écrit à la main.
        sa.CheckConstraint(
            "scope <@ ARRAY[" + ", ".join(f"'{p.value}'" for p in PorteeDeReprise) + "]::text[]",
            name="portee_connue",
        ),
        sa.CheckConstraint("length(reason) <= 500", name="motif_borne"),
        sa.CheckConstraint("expires_at > started_at", name="expire_apres_ouverture"),
        sa.CheckConstraint(
            "ended_at IS NULL OR ended_at >= started_at", name="close_apres_ouverture"
        ),
        # Ce que le salon lit, et ce que le résolveur d'appartenance interroge à
        # chaque requête d'un administrateur : les deux passent par là.
        sa.Index("ix_business_support_access_business_id_started_at", "business_id", "started_at"),
    )
