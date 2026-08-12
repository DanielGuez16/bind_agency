"""Journal d'audit des transitions d'état.

Immuable au sens fort : un trigger posé par la migration lève une exception sur
tout UPDATE et tout DELETE. Sans lui, « immuable » ne serait qu'une intention.

`entity_id` n'est délibérément pas une clé étrangère. C'est ce qui garantit
qu'aucune suppression ailleurs dans le schéma ne peut emporter une ligne de
journal, et ce qui permet de journaliser n'importe quelle entité.
"""

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPrimaryKey, enum_column
from app.models.enums import ActorKind


class AuditLog(UUIDPrimaryKey, Base):
    __tablename__ = "audit_log"

    # `clock_timestamp()` et non `now()` : ce dernier renvoie l'heure de début de
    # transaction, identique pour toutes les lignes écrites dans la même. Le
    # journal serait alors incapable d'ordonner deux transitions atomiques — de
    # dire qu'un jeton a été révoqué *puis* un autre émis. L'horloge réelle,
    # elle, avance.
    occurred_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("clock_timestamp()"),
    )
    entity_type: Mapped[str] = mapped_column(sa.Text, nullable=False)
    entity_id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, nullable=False)
    from_status: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    to_status: Mapped[str] = mapped_column(sa.Text, nullable=False)
    # RESTRICT et non SET NULL : mettre la colonne à NULL serait un UPDATE, que
    # le trigger d'immuabilité refuse — les deux règles seraient incompatibles.
    # RESTRICT est aussi le comportement voulu : un utilisateur qui a agi ne
    # s'efface pas, il s'anonymise.
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("app_user.id", ondelete="RESTRICT"), nullable=True
    )
    actor_kind: Mapped[ActorKind] = mapped_column(
        enum_column(ActorKind, "actor_kind"), nullable=False
    )
    reason: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    #: Le texte libre qui accompagne le motif. **Jamais seul.**
    #:
    #: `SPEC.md` §4.2 interdisait le texte libre, et pour une raison qui tient
    #: toujours : une phrase ne se traduit pas à l'affichage, et elle ressort
    #: sur l'écran de l'arbitre dans la langue de qui l'a écrite. La règle
    #: change de forme plutôt que de disparaître — le **code reste obligatoire**
    #: et porte le sens traduisible, la note ajoute le détail qu'un code ne
    #: peut pas porter. La contrainte ci-dessous interdit qu'elle voyage seule.
    #:
    #: Écrite avec la ligne et immuable comme elle : le trigger qui refuse tout
    #: UPDATE vaut aussi pour ce champ. Une note ne se corrige pas après coup,
    #: on en écrit une autre.
    note: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    extra: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)

    __table_args__ = (
        # Une transition automatique n'a pas d'acteur utilisateur, et une
        # transition humaine en a forcément un. L'équivalence interdit les deux
        # incohérences : un « système » attribué à quelqu'un, et un acteur
        # humain anonyme dont on ne saura jamais qui il était.
        sa.CheckConstraint(
            "(actor_kind = 'system') = (actor_user_id IS NULL)",
            name="system_actor_has_no_user",
        ),
        # **Le texte libre ne voyage jamais seul.** C'est ce qui répond à
        # l'objection de `SPEC.md` §4.2 : le code porte le sens, il est
        # traduisible, et il reste obligatoire. La note ajoute le détail qu'un
        # code ne peut pas porter, et n'existe pas sans lui. Sans cette
        # contrainte, le journal redeviendrait un champ de saisie libre par la
        # bande — il suffirait d'un appelant.
        sa.CheckConstraint("note IS NULL OR reason IS NOT NULL", name="note_accompagne_un_motif"),
        # Une note est une explication, pas une lettre. La borne est en base et
        # pas seulement dans le schéma : un second appelant la contournerait.
        sa.CheckConstraint("note IS NULL OR length(note) <= 500", name="note_bornee"),
        sa.Index(
            "ix_audit_log_entity_type_entity_id_occurred_at",
            "entity_type",
            "entity_id",
            "occurred_at",
        ),
    )
