"""Le signalement d'un déplacement pour rien.

**Le cas inverse de l'absence, et il n'existait pas.** Un créateur qui ne vient
pas est pénalisé — `no_show` produit son événement de fiabilité. Un salon fermé,
ou qui a oublié, ne l'était pas : le créateur perdait son créneau, sa place, et
son déplacement, sans aucun recours. Pire, la réservation restait `confirmed`,
si bien que le commerce pouvait encore le marquer absent — le pénaliser pour
n'être pas venu là où personne ne l'attendait.

**Un signalement est une allégation, jamais un verdict.** Il ne compte contre le
salon qu'une fois arbitré. C'est la même règle que la revue humaine des
contreparties : la mécanique s'arrête et un humain tranche, plutôt que de
transformer une parole en sanction automatique.

**Un seul par réservation.** La contrainte d'unicité le dit : signaler deux fois
le même déplacement n'ajoute rien, et compter deux fois le même fait gonflerait
n'importe quel compteur qu'on bâtira dessus.
"""

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPrimaryKey, enum_column
from app.models.enums import VenueReportStatus


class VenueReport(UUIDPrimaryKey, Base):
    """« Je me suis déplacé, c'était fermé. »"""

    __tablename__ = "venue_report"

    booking_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("booking.id", ondelete="RESTRICT"), nullable=False
    )
    #: Recopiés depuis la réservation à la création. **Figés là**, comme le
    #: prix d'un item : un compteur par salon doit rester juste même si la
    #: réservation change de main, et l'arbitrage se lit des mois plus tard.
    creator_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("app_user.id", ondelete="RESTRICT"), nullable=False
    )
    business_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("business.id", ondelete="RESTRICT"), nullable=False
    )

    #: L'heure serveur, jamais celle du client. Un signalement hors fenêtre se
    #: refuse sur cette heure-là, et un horodatage fourni par l'appelant
    #: rendrait la fenêtre décorative.
    reported_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("clock_timestamp()")
    )
    #: Ce que le créateur a vu. Facultatif, borné, rendu tel quel : c'est du
    #: contenu saisi, et il accompagne un statut qui, lui, se traduit.
    note: Mapped[str | None] = mapped_column(sa.Text, nullable=True)

    status: Mapped[VenueReportStatus] = mapped_column(
        enum_column(VenueReportStatus, "venue_report_status"),
        nullable=False,
        server_default=VenueReportStatus.PENDING.value,
    )
    decided_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    decided_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("app_user.id", ondelete="RESTRICT"), nullable=True
    )

    __table_args__ = (
        # Un seul signalement par réservation : signaler deux fois le même
        # déplacement n'ajoute rien, et le compter deux fois fausserait tout
        # compteur bâti dessus.
        sa.UniqueConstraint("booking_id"),
        # Un signalement tranché porte sa date et son arbitre ; un signalement
        # en attente n'a ni l'une ni l'autre. Sans l'équivalence, « confirmé »
        # finirait par exister sans qu'on sache par qui — et c'est la seule
        # chose qu'on aura à regarder le jour où un salon contestera.
        sa.CheckConstraint(
            "(status = 'pending') = (decided_at IS NULL AND decided_by_user_id IS NULL)",
            name="decide_a_un_arbitre_et_une_date",
        ),
        sa.CheckConstraint("note IS NULL OR length(note) <= 500", name="note_bornee"),
        # La file d'arbitrage, et le compteur par salon.
        sa.Index("ix_venue_report_status_reported_at", "status", "reported_at"),
        sa.Index("ix_venue_report_business_id_status", "business_id", "status"),
    )
