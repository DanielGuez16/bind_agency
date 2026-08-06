"""Jetons de rafraîchissement.

Liste d'autorisation, pas liste de refus : un jeton n'est accepté que si sa
ligne existe, qu'elle n'est pas révoquée et qu'elle n'est pas expirée. C'est ce
qui permet de le révoquer côté serveur, ce qu'un jeton purement auto-porteur
interdit.

L'identifiant de la ligne sert directement de `jti` dans le jeton signé : pas
besoin de stocker le jeton lui-même, la signature prouve déjà son authenticité.
"""

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPrimaryKey


class RefreshToken(UUIDPrimaryKey, Base):
    __tablename__ = "refresh_token"

    # CASCADE : une session n'est pas de l'historique, elle se purge avec le
    # compte. Contrairement aux réservations, elle n'a rien à opposer.
    user_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("app_user.id", ondelete="CASCADE"), nullable=False
    )
    # La rotation révoque l'ancien jeton et en émet un nouveau dans la même
    # transaction : `now()` leur donnait le même instant, et le journal ne
    # savait plus lequel des deux précédait l'autre.
    issued_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("clock_timestamp()")
    )
    expires_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)

    __table_args__ = (
        # Révocation en masse des sessions d'un compte, et purge des expirées.
        sa.Index("ix_refresh_token_user_id_revoked_at", "user_id", "revoked_at"),
        sa.Index("ix_refresh_token_expires_at", "expires_at"),
    )
