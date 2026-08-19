"""Le jeton qui confirme une adresse.

**Une table et non une colonne de plus sur le compte.** Un jeton se renvoie :
il faut donc pouvoir en avoir plusieurs, savoir lequel a servi, et garder la
trace des précédents. Une colonne unique écraserait l'histoire à chaque renvoi,
et la question « combien de fois lui a-t-on écrit » n'aurait plus de réponse.

**L'empreinte, jamais le jeton.** Le même choix que la prise en main et les
jetons de rafraîchissement : la base ne porte que le SHA-256. Une fuite de la
base ne donne alors aucun lien utilisable, et l'adresse ne se confirme pas
depuis une sauvegarde volée.
"""

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPrimaryKey


class EmailVerification(UUIDPrimaryKey, Base):
    """« Confirmez votre adresse », et ce qu'il en est advenu."""

    __tablename__ = "email_verification"

    user_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("app_user.id", ondelete="CASCADE"), nullable=False
    )
    #: L'adresse visée **au moment de l'envoi**. Figée, comme la destination
    #: d'une prise en main : quelqu'un qui change d'adresse ne doit pas voir un
    #: jeton parti à l'ancienne confirmer la nouvelle.
    destination: Mapped[str] = mapped_column(sa.Text, nullable=False)

    token_hash: Mapped[bytes] = mapped_column(sa.LargeBinary, nullable=False)

    #: `clock_timestamp()` : un renvoi révoque le précédent dans la même
    #: transaction, et `now()` leur donnerait le même instant — le journal ne
    #: saurait plus lequel a remplacé l'autre. Même raison que la prise en main.
    issued_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("clock_timestamp()")
    )
    expires_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    #: À usage unique. Consommé, il ne confirme plus rien : un lien qui traîne
    #: dans une boîte mail ne doit pas rouvrir une porte des mois plus tard.
    used_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    #: Fermé par un renvoi. Deux liens vivants pour une même adresse feraient
    #: qu'un ancien courriel confirme aussi bien que le dernier.
    revoked_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)

    __table_args__ = (
        sa.UniqueConstraint("token_hash"),
        # Utilisé, révoqué : jamais les deux. Un jeton consommé puis « révoqué »
        # laisserait croire qu'on a fermé une porte déjà franchie.
        sa.CheckConstraint(
            "used_at IS NULL OR revoked_at IS NULL", name="pas_utilise_et_revoque_a_la_fois"
        ),
        sa.CheckConstraint("expires_at > issued_at", name="expire_apres_emission"),
        # Ce que le service lit : le jeton vivant d'un compte.
        sa.Index("ix_email_verification_user_id_issued_at", "user_id", "issued_at"),
    )
