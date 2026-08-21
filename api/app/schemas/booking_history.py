"""Schémas des deux listes de réservations.

`value_cents_snapshot` n'y figure dans aucun des deux sens. Ce n'est pas un
oubli : la valeur d'une prestation ne s'affiche ni au créateur, pour qui elle
n'est pas un avoir, ni au commerce, dont l'écran de journée n'est pas un état
de caisse.
"""

import uuid
from datetime import date, datetime, time

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
    #: Ce que le salon a reproché à la dernière soumission. Nul quand rien n'a
    #: été refusé. Sans lui, une créatrice invitée à resoumettre renvoie la même
    #: chose et se fait refuser une seconde fois.
    dernier_motif: str | None
    needs_human_review: bool


class ReservationDuCreateurRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    booking_id: uuid.UUID
    status: BookingStatus
    starts_at: datetime | None
    ends_at: datetime | None
    valid_until: datetime
    #: Jusqu'à quand le commerce peut trancher. `None` hors d'`awaiting_business`.
    #:
    #: Rendue plutôt que déduite dans l'application : le délai est un réglage,
    #: et le recopier côté écran le ferait dériver au premier ajustement. C'est
    #: aussi ce qui permet à la créatrice de lire la même heure que le commerce,
    #: au lieu de deux comptes à rebours calculés séparément.
    approval_expires_at: datetime | None
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


class CompteDeLaCreatriceRead(BaseModel):
    """Un réseau rattaché, tel que le salon le voit sur une demande."""

    model_config = ConfigDict(from_attributes=True)

    platform: Platform
    handle: str | None
    #: Nul quand aucun relevé n'existe. Zéro serait un chiffre, et faux.
    followers: int | None


class ReservationDuCommerceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    booking_id: uuid.UUID
    status: BookingStatus
    starts_at: datetime | None
    ends_at: datetime | None
    valid_until: datetime
    #: Jusqu'à quand le commerce peut trancher. `None` hors d'`awaiting_business`.
    #:
    #: Rendue plutôt que déduite dans l'application : le délai est un réglage,
    #: et le recopier côté écran le ferait dériver au premier ajustement. C'est
    #: aussi ce qui permet à la créatrice de lire la même heure que le commerce,
    #: au lieu de deux comptes à rebours calculés séparément.
    approval_expires_at: datetime | None
    creator_id: uuid.UUID
    creator_first_name: str | None
    creator_last_name: str | None
    creator_handle: str | None
    #: La créatrice a fermé son compte. Un drapeau, pas une phrase : le texte
    #: se traduit côté écran, et un nom vide se lisait comme un bug.
    creator_partie: bool
    #: L'adresse du profil, dérivée du pseudonyme et du réseau de la demande.
    #: C'est la première chose qu'un salon cherche avant d'accorder : un
    #: pseudonyme sans lien oblige à le recopier dans une barre d'adresse.
    creator_profil_url: str | None
    item_name: str
    duration_minutes: int | None
    platform: Platform
    content_format: ContentFormat
    #: Ce que la publication devra porter. Au comptoir, c'est ce qu'on vérifie,
    #: et c'est le seul écran où on le vérifie au moment de servir.
    required_mention: str | None
    required_geotag: bool
    #: Tous les réseaux de la créatrice, pas seulement celui de cette demande.
    #: **L'absence est une information** : savoir qu'il n'y a pas de TikTok fait
    #: partie de la décision autant que le nombre d'abonnés Instagram.
    comptes: list[CompteDeLaCreatriceRead]
    contrepartie: ContrepartieBreveRead | None
    #: Quand le bouton « signaler une absence » s'ouvre. `None` : jamais — un
    #: item sans créneau n'a pas d'heure à laquelle ne pas se présenter.
    #:
    #: Rendu plutôt que déduit dans l'application : le délai est un réglage, et
    #: le recopier côté écran le ferait dériver au premier ajustement. L'écran
    #: s'en sert pour ouvrir le bouton et pour dire à quelle heure il s'ouvre ;
    #: c'est le serveur qui refuse, jamais l'horloge du téléphone.
    absence_signalable_a: datetime | None


class PlageDuJourRead(BaseModel):
    """Une plage d'ouverture de ce jour-là, en heures locales.

    Le fuseau est déjà sur la journée : le répéter ici inviterait à convertir,
    alors que « 9 h – 19 h » est ce que le salon affiche sur sa porte.
    """

    model_config = ConfigDict(from_attributes=True)

    debut: time
    fin: time
    #: Combien de prestations en parallèle. Rendu parce que la sous-ligne peut
    #: le vouloir, et qu'il vient sans coût — la fenêtre le porte déjà.
    postes: int


class JourneeDuCommerceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    jour: date
    timezone: str
    #: Les bornes réellement utilisées, en UTC. Rendues pour que le commerce
    #: puisse vérifier ce qui a été compté comme « sa » journée.
    debut: datetime
    fin: datetime
    #: Les plages d'ouverture de ce jour, exceptions comprises. **Vide veut dire
    #: fermé**, et c'est une information : une journée sans réservation ne se lit
    #: pas pareil selon qu'on était fermé ou que personne n'est venu.
    horaires: list[PlageDuJourRead]
    items: list[ReservationDuCommerceRead]
    #: Ce qui attend une décision, toutes dates confondues — pas seulement ce
    #: jour-là. Une réservation à trancher pour après-demain n'apparaîtrait
    #: dans aucune journée qu'on ouvre, et la créatrice attendrait une réponse
    #: que personne ne voit à donner.
    a_trancher: list[ReservationDuCommerceRead]
