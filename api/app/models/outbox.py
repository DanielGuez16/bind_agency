"""La boîte d'envoi : ce qu'on doit dire, écrit avec ce qui l'a provoqué.

**Le défaut que cette table répare.** Une décision de réservation, une prise en
main, une ouverture de reprise envoyaient leur courriel et leur push *avant de
répondre*. Chaque envoi est borné par sa configuration, donc la requête ne pend
pas indéfiniment — mais elle peut attendre vingt secondes pour deux messages
dont l'appelant n'a rien à faire. Et si le processus meurt entre le commit et
l'envoi, personne n'est prévenu et rien ne le rattrape.

**Pourquoi une table à part, et non un type de job.** La table de jobs porte
« une ligne par travail, pour toujours » : `UNIQUE (job_type, target_id)`, un
relevé quotidien par compte, reprogrammé plutôt que consommé. Un message est
l'inverse — une occurrence, qui arrive une fois et disparaît. Deux reprises
ouvertes sur le même salon sont deux messages ; les forcer dans la table de jobs
casserait son invariant, ou en perdrait un.

**Le dépôt est dans la transaction de l'événement.** C'est tout l'intérêt : le
commit qui écrit la décision écrit le message. Ou les deux existent, ou aucun —
il n'y a plus de fenêtre où quelqu'un est refusé sans jamais l'apprendre.

**Ce qu'on stocke, ce sont les valeurs, pas le texte.** La langue du
destinataire se lit à l'envoi, et le gabarit peut avoir été corrigé entre-temps.
Figer le texte figerait aussi une faute de frappe.
"""

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAt, UUIDPrimaryKey, enum_column
from app.models.enums import MessageChannel, NotificationKind


class OutboundMessage(UUIDPrimaryKey, CreatedAt, Base):
    """Un message à dire, et ce qu'il faut pour le dire."""

    __tablename__ = "outbound_message"

    #: Par où. Les deux canaux vivent dans la même boîte : ils disent la même
    #: chose à deux endroits, et les séparer ferait deux mécaniques de report.
    channel: Mapped[MessageChannel] = mapped_column(
        enum_column(MessageChannel, "message_channel"), nullable=False
    )
    #: À qui. **L'identifiant et non l'adresse** : la préférence et le statut du
    #: compte se relisent à l'envoi, et quelqu'un qui coupe une notification
    #: entre le dépôt et l'envoi doit être entendu.
    user_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("app_user.id", ondelete="CASCADE"), nullable=False
    )
    #: Le genre, qui dit quelle préférence commande ce message.
    kind: Mapped[NotificationKind] = mapped_column(
        enum_column(NotificationKind, "notification_kind"), nullable=False
    )
    #: La clé du gabarit, dans le catalogue serveur.
    template_key: Mapped[str] = mapped_column(sa.Text, nullable=False)
    #: Ce que le gabarit attend. Rendu à l'envoi, dans la langue du
    #: destinataire — laquelle peut avoir changé depuis le dépôt.
    values: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=sa.text("'{}'"))

    #: Rien ne part avant. C'est à la fois le départ immédiat — le défaut — et
    #: le report d'un envoi en échec : un seul mécanisme, comme pour les jobs.
    run_after: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("clock_timestamp()")
    )
    attempts: Mapped[int] = mapped_column(sa.Integer, nullable=False, server_default=sa.text("0"))
    last_error: Mapped[str | None] = mapped_column(sa.Text, nullable=True)

    #: Parti. **Nul aussi quand il n'y avait rien à envoyer** — compte suspendu,
    #: genre refusé, aucun terminal : `skipped_reason` dit alors pourquoi, et
    #: les deux ensemble distinguent « pas encore » de « jamais ».
    sent_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    #: Pourquoi il ne partira pas. Un message écarté n'est ni un échec à
    #: réessayer ni un succès : le confondre avec l'un ou l'autre ferait soit
    #: marteler un compte suspendu, soit croire qu'il a reçu.
    skipped_reason: Mapped[str | None] = mapped_column(sa.Text, nullable=True)

    __table_args__ = (
        # Parti et écarté : jamais les deux. Un message qu'on a envoyé n'a pas
        # de raison de ne pas partir.
        sa.CheckConstraint(
            "sent_at IS NULL OR skipped_reason IS NULL",
            name="pas_parti_et_ecarte",
        ),
        sa.CheckConstraint("attempts >= 0", name="tentatives_positives"),
        # Ce que le balayage lit : les messages qui attendent, dans l'ordre.
        # Partiel, parce que la boîte grossit sans fin et que ce qui est parti
        # n'est plus jamais relu par lui.
        sa.Index(
            "ix_outbound_message_en_attente",
            "run_after",
            postgresql_where=sa.text("sent_at IS NULL AND skipped_reason IS NULL"),
        ),
    )
