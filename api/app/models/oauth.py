"""État d'un parcours OAuth.

Une ligne par parcours démarré. L'état envoyé au fournisseur est un jeton signé
dont le `jti` est l'identifiant de cette ligne : la signature écarte les états
fabriqués sans toucher la base, et la ligne les rend **à usage unique**.

Le jeton signé seul ne suffirait pas. Il resterait rejouable jusqu'à son
expiration, et quiconque intercepterait l'état d'un créateur pourrait finir le
parcours avec son propre compte social — c'est-à-dire rattacher son compte au
compte BIND de quelqu'un d'autre.
"""

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAt, UUIDPrimaryKey, enum_column
from app.models.enums import Platform


class OAuthState(UUIDPrimaryKey, CreatedAt, Base):
    __tablename__ = "oauth_state"

    user_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("app_user.id", ondelete="CASCADE"), nullable=False
    )
    platform: Mapped[Platform] = mapped_column(enum_column(Platform, "platform"), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    #: Où ramener la personne après l'autorisation. Nulle quand le parcours
    #: n'a pas d'application à rejoindre — le rappel rend alors le compte en
    #: JSON, ce qui suffit à un navigateur.
    return_url: Mapped[str | None] = mapped_column(sa.Text(), nullable=True)
    consumed_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)

    __table_args__ = (
        # Purge des états expirés par un job de fond.
        sa.Index("ix_oauth_state_expires_at", "expires_at"),
    )
