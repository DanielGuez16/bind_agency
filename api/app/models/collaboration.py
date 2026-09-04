"""Contrepartie attendue et preuve de publication."""

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAt, UUIDPrimaryKey, enum_column
from app.models.enums import CaptureMethod, CollaborationStatus, ContentFormat


class Collaboration(UUIDPrimaryKey, CreatedAt, Base):
    """Créée à la consommation d'une réservation, jamais avant.

    Il n'existe pas de statut `disputed` : la non conformité renvoie en
    `resubmit_requested`. `needs_human_review` est levé automatiquement à la
    troisième tentative et fait sortir le dossier de la boucle.
    """

    __tablename__ = "collaboration"

    booking_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("booking.id", ondelete="RESTRICT"), nullable=False
    )
    tier_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("tier.id", ondelete="RESTRICT"), nullable=False
    )
    required_format: Mapped[ContentFormat] = mapped_column(
        enum_column(ContentFormat, "content_format"), nullable=False
    )
    required_mention: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    required_geotag: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.text("false")
    )
    deadline_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    status: Mapped[CollaborationStatus] = mapped_column(
        enum_column(CollaborationStatus, "collaboration_status"),
        nullable=False,
        server_default=CollaborationStatus.PENDING.value,
    )
    attempts_count: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, server_default=sa.text("0")
    )
    needs_human_review: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.text("false")
    )
    approved_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)

    __table_args__ = (
        sa.UniqueConstraint("booking_id"),
        sa.CheckConstraint("attempts_count >= 0", name="attempts_count_positive"),
        # Job d'échéances.
        sa.Index("ix_collaboration_status_deadline_at", "status", "deadline_at"),
        # File de revue humaine côté admin.
        sa.Index("ix_collaboration_needs_human_review", "needs_human_review"),
    )


class Proof(UUIDPrimaryKey, Base):
    """Preuve archivée, jamais un simple lien.

    `submitted_at` est l'heure serveur : un horodatage fourni par le client
    n'est jamais utilisé comme preuve.
    """

    __tablename__ = "proof"

    collaboration_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("collaboration.id", ondelete="RESTRICT"), nullable=False
    )
    submitted_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("clock_timestamp()")
    )
    source_url: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    capture_method: Mapped[CaptureMethod] = mapped_column(
        enum_column(CaptureMethod, "capture_method"), nullable=False
    )
    media_key: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    screenshot_key: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    #: Le type MIME de ce qui est archivé, relevé **sur les octets** à la
    #: soumission.
    #:
    #: **Une clé ne dit pas ce qu'elle désigne.** Elle est une empreinte et ne
    #: porte pas d'extension — volontairement, se fier à une extension fournie
    #: par l'appelant permettrait de faire servir n'importe quoi. Sans cette
    #: colonne, la seule question qu'on savait poser était « un fichier
    #: existe-t-il », et la réponse valait « oui » pour une image comme pour une
    #: vidéo. L'écran des publications s'en servait comme d'un « il y a une
    #: image » et demandait la vignette d'un MP4 à un composant d'image.
    #:
    #: **Nul veut dire « avant que la question se pose ».** Aucune reprise
    #: rétroactive : jusqu'à l'acceptation de la vidéo, le sélecteur et le
    #: serveur ne prenaient que des images, donc toute preuve antérieure en est
    #: une. Les lecteurs traitent donc `NULL` comme une image plutôt que comme
    #: une inconnue — c'est un fait d'histoire, pas une supposition.
    media_content_type: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    content_hash: Mapped[str] = mapped_column(sa.Text, nullable=False)
    #: Les quatre champs qui rendent une contrepartie **vérifiable** plutôt
    #: qu'attestée. Ils ne peuvent venir que de la plateforme, et donc que d'une
    #: capture de niveau 1 : nuls partout ailleurs, et c'est cette nullité qui
    #: distingue les deux régimes. Voir `SPEC.md`, « Vérifiée, ou seulement
    #: attestée ».
    #:
    #: L'identifiant du média chez la plateforme. Unique : deux contreparties ne
    #: se règlent pas avec la même publication.
    platform_media_id: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    #: Le compte qui a publié, tel que la plateforme le désigne. Comparé au
    #: compte figé à la réservation — c'est le champ qui empêche de soumettre la
    #: publication d'un autre.
    platform_author_id: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    #: Le type dans le vocabulaire de la plateforme, conservé tel quel. La
    #: traduction vers `ContentFormat` vit dans le service ; garder le mot brut
    #: permet de rejuger un dossier si la correspondance change.
    platform_media_type: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    platform_published_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    #: Ce que le créateur dit de sa soumission. **L'autre moitié du canal.**
    #:
    #: Le commerce refusait avec un code, le créateur resoumettait sans un mot,
    #: et un dossier arrivait en arbitrage après trois allers-retours sans
    #: qu'aucune phrase n'ait été échangée. Facultatif : une soumission
    #: conforme n'a rien à expliquer.
    note: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    # `metadata` est réservé par SQLAlchemy déclaratif : la colonne garde son
    # nom, l'attribut Python s'appelle `extra`.
    extra: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)

    @property
    def verifiee(self) -> bool | None:
        """Le verdict rendu **au moment de la soumission**.

        Nul quand la question ne s'est pas posée — niveaux 2 et 3 — ce qui n'est
        pas la même chose qu'une vérification qui a échoué. Les deux se lisent
        autrement : l'une dit « attestée », l'autre « ne correspond pas ».

        Conservé plutôt que recalculé : le verdict est un fait daté. Recalculé
        six mois plus tard avec une table de correspondance qui a bougé, il
        pourrait contredire ce qui a été dit au commerce le jour même. Le type
        brut reste à côté pour permettre de **rejuger** délibérément, ce qui
        n'est pas la même chose que de dériver en silence.
        """
        verification = (self.extra or {}).get("verification")
        return None if verification is None else bool(verification.get("verifiee"))

    @property
    def raisons_de_non_verification(self) -> list[str]:
        verification = (self.extra or {}).get("verification") or {}
        return list(verification.get("raisons", []))

    __table_args__ = (
        # Une preuve sans aucun fichier archivé n'est pas une preuve.
        sa.CheckConstraint(
            "media_key IS NOT NULL OR screenshot_key IS NOT NULL", name="has_archived_file"
        ),
        # La même borne que sur le journal. En base et pas seulement dans le
        # schéma : un second appelant la contournerait.
        sa.CheckConstraint("note IS NULL OR length(note) <= 500", name="note_bornee"),
        sa.Index(
            "ix_proof_collaboration_id_submitted_at",
            "collaboration_id",
            sa.desc("submitted_at"),
        ),
        sa.Index("ix_proof_content_hash", "content_hash"),
        # **Une publication ne règle qu'une contrepartie.** Sans cette unicité,
        # la même story servirait deux collaborations chez deux salons — et
        # c'est la fraude la plus simple à tenter puisqu'elle ne demande aucun
        # faux. Partielle : les preuves de niveau 2 et 3 n'ont pas
        # d'identifiant, et une contrainte pleine les ferait toutes entrer en
        # collision sur `NULL`.
        sa.Index(
            "uq_proof_platform_media_id",
            "platform_media_id",
            unique=True,
            postgresql_where=sa.text("platform_media_id IS NOT NULL"),
        ),
    )
