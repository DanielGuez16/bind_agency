"""Catalogue : items, variantes et imports de carte."""

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAt, UUIDPrimaryKey, enum_column, money_column
from app.models.enums import CatalogItemSource, MenuImportStatus


class CatalogItem(UUIDPrimaryKey, CreatedAt, Base):
    """Item de catalogue.

    `requires_booking` traduit le « si pertinent pour l'activité » de la spec :
    un soin en salon se réserve, une entrée de musée non. La durée n'a de sens
    que dans le premier cas, et la contrainte est vérifiée en base.

    Aucune colonne de devise : le montant est en centimes de la devise du
    commerce propriétaire.
    """

    __tablename__ = "catalog_item"

    business_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("business.id", ondelete="CASCADE"), nullable=False
    )
    parent_item_id: Mapped[uuid.UUID | None] = mapped_column(sa.Uuid, nullable=True)
    #: Quand la prestation a été retirée du catalogue **pour de bon**.
    #:
    #: **Archiver n'est pas fermer, et `is_available` ne peut pas dire les
    #: deux.** Un salon ferme une prestation pour l'été et la rouvre en
    #: septembre ; il archive celle qu'il ne refera plus. Les deux valaient
    #: `is_available = false`, et l'écran ne pouvait pas les distinguer : ou
    #: bien il sortait de la liste de travail une prestation saisonnière que le
    #: gérant compte rouvrir, ou bien il y laissait traîner des archives pour
    #: toujours.
    #:
    #: **Une archive ne se supprime jamais et ne se rouvre jamais.** Supprimer
    #: effacerait le texte d'un accord tenu — douze réservations citent cette
    #: prestation, et leur histoire est écrite avec ses mots. Rouvrir ferait
    #: d'une trace un objet vivant, et le salon en a un autre pour ça : la
    #: prestation qui l'a remplacée.
    #:
    #: Elle quitte la liste que le salon travaille, reste atteignable depuis la
    #: réservation qui la cite, et n'apparaît dans aucun fil.
    archived_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)

    name: Mapped[str] = mapped_column(sa.Text, nullable=False)
    description: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    price_cents: Mapped[int] = money_column(nullable=False)
    duration_minutes: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    requires_booking: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.text("true")
    )
    # Une photo par item, même stockage et mêmes règles que la couverture du
    # commerce. Un item sans photo reste parfaitement réservable : l'affichage
    # s'en arrange, pas la réservation.
    photo_key: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    #: La prestation laisse-t-elle un choix au créateur.
    #:
    #: « Un menu contre une story » en laisse un : le créateur ne sait pas ce
    #: qu'il va manger, et sans carte il ne vient pas. « Brushing 45 min » n'en
    #: laisse aucun : la prestation se désigne elle-même.
    #:
    #: **C'est le commerce qui le pose, et ça ne se devine pas d'un nom.**
    #: Le déduire d'un mot — « menu », « formule », « au choix » — marcherait
    #: sur les exemples qu'on a en tête et se tromperait sur « Menu signature
    #: du chef », qui est un plat précis, comme sur « Soin visage » d'un salon
    #: qui en propose quatre.
    #:
    #: Faux par défaut : le lancement est en beauté, où une prestation désigne
    #: presque toujours quelque chose de précis. Une valeur par défaut vraie
    #: fermerait toutes les offres existantes à la migration.
    leaves_choice: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.text("false")
    )

    is_available: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.text("true")
    )
    source: Mapped[CatalogItemSource] = mapped_column(
        enum_column(CatalogItemSource, "catalog_item_source"),
        nullable=False,
        server_default=CatalogItemSource.MANUAL.value,
    )
    # `clock_timestamp()` des deux côtés. Avec `now()`, une ligne créée puis
    # modifiée dans la même transaction se retrouvait avec `updated_at`
    # antérieur à son `created_at` : l'heure d'ouverture de la transaction est
    # forcément avant celle de l'instruction qui a créé la ligne.
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("clock_timestamp()"),
        onupdate=sa.text("clock_timestamp()"),
    )

    __table_args__ = (
        sa.CheckConstraint(
            "(requires_booking AND duration_minutes IS NOT NULL)"
            " OR (NOT requires_booking AND duration_minutes IS NULL)",
            name="duration_matches_requires_booking",
        ),
        sa.CheckConstraint(
            "duration_minutes IS NULL OR duration_minutes > 0",
            name="duration_minutes_positive",
        ),
        sa.CheckConstraint("price_cents >= 0", name="price_cents_positive"),
        # Cibles des clés étrangères composites : elles rendent structurellement
        # impossible qu'une offre ou une réservation pointe l'item d'un autre
        # commerce, et que la copie de requires_booking sur booking diverge.
        sa.UniqueConstraint("id", "business_id"),
        sa.UniqueConstraint("id", "business_id", "requires_booking"),
        # Une variante appartient forcément au commerce de son parent.
        sa.ForeignKeyConstraint(
            ["parent_item_id", "business_id"],
            ["catalog_item.id", "catalog_item.business_id"],
            name="fk_catalog_item_parent_business",
            ondelete="CASCADE",
        ),
        # Cible de la clé étrangère composite de `booking`. `duration_minutes`
        # y figure pour que la durée réservée ne puisse pas être réécrite
        # après coup — même mécanisme que pour `requires_booking`.
        sa.UniqueConstraint(
            "id",
            "business_id",
            "requires_booking",
            "duration_minutes",
            name="uq_catalog_item_bookable_shape",
        ),
        sa.Index("ix_catalog_item_business_id_is_available", "business_id", "is_available"),
    )


class MenuImport(UUIDPrimaryKey, CreatedAt, Base):
    """Une extraction ne crée jamais d'item : elle remplit une charge à valider."""

    __tablename__ = "menu_import"

    business_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("business.id", ondelete="CASCADE"), nullable=False
    )
    file_key: Mapped[str] = mapped_column(sa.Text, nullable=False)
    mime_type: Mapped[str] = mapped_column(sa.Text, nullable=False)
    status: Mapped[MenuImportStatus] = mapped_column(
        enum_column(MenuImportStatus, "menu_import_status"),
        nullable=False,
        server_default=MenuImportStatus.UPLOADED.value,
    )
    extracted_payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("app_user.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)

    __table_args__ = (sa.Index("ix_menu_import_business_id_status", "business_id", "status"),)
