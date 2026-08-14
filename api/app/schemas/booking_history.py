"""Schémas des deux listes de réservations.

`value_cents_snapshot` n'y figure dans aucun des deux sens. Ce n'est pas un
oubli : la valeur d'une prestation ne s'affiche ni au créateur, pour qui elle
n'est pas un avoir, ni au commerce, dont l'écran de journée n'est pas un état
de caisse.
"""

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import (
    BookingStatus,
    BusinessCategory,
    CollaborationStatus,
    ContentFormat,
    Platform,
)


class ContrepartieBreveRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    collaboration_id: uuid.UUID
    status: CollaborationStatus
    deadline_at: datetime
    attempts_count: int
    needs_human_review: bool


class ReservationDuCreateurRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    booking_id: uuid.UUID
    status: BookingStatus
    starts_at: datetime | None
    ends_at: datetime | None
    valid_until: datetime
    created_at: datetime
    business_id: uuid.UUID
    business_name: str
    business_category: BusinessCategory
    business_address: str | None
    #: Le fuseau du commerce : c'est dans celui-là que l'heure s'affiche, pas
    #: dans celui du téléphone. Un rendez-vous se prend là où il a lieu.
    business_timezone: str
    business_cover_photo_key: str | None
    item_name: str
    item_photo_key: str | None
    duration_minutes: int | None
    platform: Platform
    content_format: ContentFormat
    #: Ce que la réservation a produit, une fois consommée. **C'est là et
    #: nulle part ailleurs que le créateur lit ses obligations** : les critères
    #: y sont figés à la création de la contrepartie, alors que ceux de l'offre
    #: suivent le commerce. Les rendre ici aussi donnerait une seconde source,
    #: qui dérive dès que le salon change ses exigences (SPEC §2.4).
    contrepartie: ContrepartieBreveRead | None


class HistoriqueDuCreateurRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    items: list[ReservationDuCreateurRead]
    #: Tous les statuts sont présents, à zéro s'il le faut : l'app affiche ses
    #: onglets sans connaître la liste, et un onglet vide reste un onglet.
    compteurs: dict[BookingStatus, int]


class ReservationDuCommerceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    booking_id: uuid.UUID
    status: BookingStatus
    starts_at: datetime | None
    ends_at: datetime | None
    valid_until: datetime
    creator_id: uuid.UUID
    creator_first_name: str | None
    creator_last_name: str | None
    creator_handle: str | None
    item_name: str
    duration_minutes: int | None
    platform: Platform
    content_format: ContentFormat
    #: Ce que la publication devra porter. Au comptoir, c'est ce qu'on vérifie,
    #: et c'est le seul écran où on le vérifie au moment de servir.
    required_mention: str | None
    required_geotag: bool
    contrepartie: ContrepartieBreveRead | None
    #: Quand le bouton « signaler une absence » s'ouvre. `None` : jamais — un
    #: item sans créneau n'a pas d'heure à laquelle ne pas se présenter.
    #:
    #: Rendu plutôt que déduit dans l'application : le délai est un réglage, et
    #: le recopier côté écran le ferait dériver au premier ajustement. L'écran
    #: s'en sert pour ouvrir le bouton et pour dire à quelle heure il s'ouvre ;
    #: c'est le serveur qui refuse, jamais l'horloge du téléphone.
    absence_signalable_a: datetime | None


class JourneeDuCommerceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    jour: date
    timezone: str
    #: Les bornes réellement utilisées, en UTC. Rendues pour que le commerce
    #: puisse vérifier ce qui a été compté comme « sa » journée.
    debut: datetime
    fin: datetime
    items: list[ReservationDuCommerceRead]
    #: Ce qui attend une décision, toutes dates confondues — pas seulement ce
    #: jour-là. Une réservation à trancher pour après-demain n'apparaîtrait
    #: dans aucune journée qu'on ouvre, et la créatrice attendrait une réponse
    #: que personne ne voit à donner.
    a_trancher: list[ReservationDuCommerceRead]
