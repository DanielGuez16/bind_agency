"""Jetons de terminal et préférences de notification.

**Pourquoi ces tables existent.** Le produit ne savait prévenir que par email.
Un créateur dont la réservation est acceptée l'apprenait en ouvrant sa boîte ;
un salon qui reçoit une demande à valider ne l'apprenait qu'en ouvrant
l'application. Sur un produit où une place se tient dix minutes et où une story
vit vingt-quatre heures, c'est un manque de fond.

**Un jeton de terminal se révoque comme un jeton social**, et pour les mêmes
raisons : il cesse de valoir sans nous prévenir — application désinstallée,
notifications coupées dans les réglages, terminal réinitialisé — et c'est le
fournisseur qui nous l'apprend, au moment où l'on essaie de s'en servir. Il se
marque, il ne se supprime pas : effacé, le même jeton se réinscrirait à la
première ouverture et on ne saurait jamais qu'il avait cessé de valoir.

**Une préférence absente vaut « oui ».** Écrire une ligne par genre et par
utilisateur à l'inscription ferait sept lignes pour tout le monde, dont
personne ne changera jamais aucune. La table ne porte que les refus explicites,
et le service traite l'absence comme un accord — ce qui est aussi le
comportement qu'on attend d'un produit dont on vient d'installer l'application.
"""

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAt, UUIDPrimaryKey, enum_column
from app.models.enums import DevicePlatform, DeviceTokenStatus, NotificationKind


class DeviceToken(UUIDPrimaryKey, CreatedAt, Base):
    """Où joindre quelqu'un. Un par terminal, plusieurs par personne.

    **Le jeton est unique dans toute la table**, pas seulement par utilisateur :
    un téléphone prêté puis reconnecté sous un autre compte porterait le même
    jeton, et les deux comptes recevraient les notifications de l'autre. La
    contrainte fait que le second enregistrement reprend le jeton au premier.
    """

    __tablename__ = "device_token"

    user_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("app_user.id", ondelete="CASCADE"), nullable=False
    )
    #: Le jeton Expo, tel que l'app le rend. Opaque : on ne le lit pas, on ne
    #: le dérive de rien, on le rend au fournisseur qui l'a émis.
    token: Mapped[str] = mapped_column(sa.Text, nullable=False)
    platform: Mapped[DevicePlatform] = mapped_column(
        enum_column(DevicePlatform, "device_platform"), nullable=False
    )
    status: Mapped[DeviceTokenStatus] = mapped_column(
        enum_column(DeviceTokenStatus, "device_token_status"),
        nullable=False,
        server_default=DeviceTokenStatus.ACTIVE.value,
    )
    #: Dernière fois que l'app l'a réaffirmé. Sert à distinguer un terminal
    #: qu'on n'a plus vu depuis six mois d'un qui a ouvert l'app ce matin.
    last_seen_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("clock_timestamp()")
    )
    revoked_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)

    __table_args__ = (
        sa.UniqueConstraint("token"),
        # Les jetons actifs d'une personne, à chaque envoi.
        sa.Index("ix_device_token_user_id_status", "user_id", "status"),
        # Un jeton révoqué porte sa date, un jeton actif n'en a pas. Sans
        # l'équivalence, « révoqué » finirait par exister sans qu'on sache
        # quand — et c'est la seule chose qu'on aura à regarder le jour où
        # quelqu'un dira ne plus rien recevoir.
        sa.CheckConstraint(
            "(status = 'revoked') = (revoked_at IS NOT NULL)",
            name="revoked_has_date",
        ),
    )


class NotificationPreference(Base):
    """Ce que quelqu'un a explicitement refusé. **Rien d'autre.**

    Une ligne n'existe que pour dire « non ». L'absence vaut « oui », et c'est
    le service qui l'interprète : la table ne se remplit pas à l'inscription,
    et une personne qui n'a jamais touché à ses réglages n'y a aucune ligne.
    """

    __tablename__ = "notification_preference"

    user_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("app_user.id", ondelete="CASCADE"), primary_key=True
    )
    kind: Mapped[NotificationKind] = mapped_column(
        enum_column(NotificationKind, "notification_kind"), primary_key=True
    )
    enabled: Mapped[bool] = mapped_column(sa.Boolean, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("clock_timestamp()")
    )
