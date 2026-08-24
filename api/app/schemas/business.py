"""Schémas du profil commerce."""

import re
import uuid
from datetime import datetime
from zoneinfo import available_timezones

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.integrations.geocoding import LATITUDE_RANGE, LONGITUDE_RANGE
from app.models.enums import (
    BusinessCategory,
    BusinessStatus,
    ContentFormat,
    Locale,
    Neighborhood,
    Platform,
)

DEFAULT_TIMEZONE = "America/New_York"


# Calculé une fois : `available_timezones()` parcourt la base de fuseaux.
_TIMEZONES = frozenset(available_timezones())


def _check_timezone(value: str | None) -> str | None:
    """Le fuseau est déclaré, jamais déduit des coordonnées ni de l'adresse.

    Validé contre la base de fuseaux du système, pas contre une liste recopiée
    qui prendrait du retard au prochain changement politique.
    """
    if value is None:
        return None
    if value not in _TIMEZONES:
        raise ValueError(f"fuseau inconnu de la base de fuseaux : {value}")
    return value


class CoordinatesPayload(BaseModel):
    longitude: float = Field(ge=LONGITUDE_RANGE[0], le=LONGITUDE_RANGE[1])
    latitude: float = Field(ge=LATITUDE_RANGE[0], le=LATITUDE_RANGE[1])


#: Le format international, dit E.164 : un `+`, un indicatif, le numéro. Entre
#: huit et quinze chiffres — l'Union internationale des télécommunications borne
#: à quinze, et rien d'utile ne descend sous huit.
#:
#: **Un motif et non une bibliothèque.** Valider qu'un numéro *existe* demande
#: une table des plans de numérotation qui se périme ; ce qu'on veut ici est
#: qu'il soit **composable** depuis n'importe où, ce qui est exactement ce que
#: le `+` et l'indicatif garantissent. Le reste se découvre en appelant, et
#: aucune bibliothèque ne l'évite.
TELEPHONE = r"^\+[1-9]\d{7,14}$"


def _normaliser_le_telephone(valeur: str | None) -> str | None:
    """Retire ce qu'on tape pour lire, garde ce qui compose.

    **Un humain écrit `+1 (305) 555-0123`.** Refuser cette forme reviendrait à
    exiger une saisie de machine sur un formulaire d'inscription, et la première
    chose qu'on ferait serait de la contourner en retirant le `+`. On enlève donc
    les espaces, tirets, points et parenthèses, puis on exige ce qui reste :
    un `+`, un indicatif, huit à quinze chiffres.
    """
    if valeur is None:
        return None
    compact = re.sub(r"[\s().-]", "", valeur)
    if not re.match(TELEPHONE, compact):
        raise ValueError("phone_invalid")
    return compact


def _nom_non_vide(valeur: str) -> str:
    """**Espaces retirés avant de compter.** `min_length` compte les caractères,
    espaces compris : « &nbsp;&nbsp; » passait pour un nom de deux caractères, et
    un salon nommé de deux espaces se retrouve dans le fil sans qu'on puisse le
    nommer autrement qu'en base."""
    propre = valeur.strip()
    if len(propre) < 2:
        raise ValueError("name_too_short")
    return propre


class BusinessCreate(BaseModel):
    """`extra="forbid"` : un champ inconnu est refusé plutôt qu'ignoré en silence."""

    model_config = ConfigDict(extra="forbid")

    #: **Deux caractères au moins, et pas seulement des espaces.** `min_length=1`
    #: acceptait « . » et « &nbsp; » : un salon nommé d'un point apparaît dans le
    #: fil, et le seul moyen de le corriger est de le retrouver en base.
    name: str = Field(min_length=2, max_length=200)
    category: BusinessCategory
    currency: str = Field(min_length=3, max_length=3)
    #: L'adresse postale. **Dix caractères au moins** : « 12 » n'est pas une
    #: adresse, et une créatrice qui se déplace la lit avant de partir. Elle
    #: reste facultative à la création — une fiche préparée au comptoir n'a
    #: parfois que le nom — et devient obligatoire à la mise en ligne, que
    #: `etapes_activation` refuse sans elle.
    address: str | None = Field(default=None, min_length=10, max_length=500)
    #: Le quartier, choisi dans une liste fermée. `None` pour un salon hors
    #: des quartiers ouverts : il reste réservable, il n'apparaît simplement
    #: dans aucun groupe du fil.
    neighborhood: Neighborhood | None = None
    coordinates: CoordinatesPayload | None = None
    timezone: str = DEFAULT_TIMEZONE
    default_locale: Locale = Locale.EN
    #: Le téléphone, **au format international**. Voir `TELEPHONE` : sans
    #: indicatif, un numéro composé depuis un autre pays ne joint personne, et
    #: la moitié du marché de Miami appelle depuis l'étranger.
    phone: str | None = Field(default=None, max_length=25)
    #: Clé de stockage objet, jamais une URL : une URL signée expire, une URL
    #: publique fuit, et les deux se figeraient en base au changement de
    #: fournisseur. Envoyer `null` la retire.
    cover_photo_key: str | None = Field(default=None, max_length=500)
    #: La couverture verticale du mur. Un champ à part : la paysage sert
    #: encore la fiche et les listes. Envoyer `null` la retire.

    #: L'adresse de la carte du commerce, quand elle existe déjà en ligne.
    #: Envoyer `null` la retire. Alternative ou complément aux pages déposées :
    #: l'un ou l'autre suffit à ouvrir une offre à choix.
    menu_url: str | None = Field(default=None, max_length=1000)

    @field_validator("currency")
    @classmethod
    def _iso_4217(cls, value: str) -> str:
        if not value.isalpha():
            raise ValueError("code devise ISO 4217 attendu, trois lettres")
        return value.upper()

    @field_validator("timezone")
    @classmethod
    def _timezone_exists(cls, value: str) -> str:
        return _check_timezone(value)  # type: ignore[return-value]

    @field_validator("phone")
    @classmethod
    def _telephone_composable(cls, value: str | None) -> str | None:
        return _normaliser_le_telephone(value)

    @field_validator("name")
    @classmethod
    def _nom_reel(cls, value: str) -> str:
        return _nom_non_vide(value)


class BusinessUpdate(BaseModel):
    """La devise n'y figure pas, et `extra="forbid"` fait que l'envoyer est une erreur.

    Elle est déclarée à la création et ne bouge plus : des montants historiques
    changeraient de sens. Un trigger le garantit aussi côté base.
    """

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=200)
    category: BusinessCategory | None = None
    address: str | None = Field(default=None, max_length=500)
    #: Le quartier, choisi dans une liste fermée. `None` pour un salon hors
    #: des quartiers ouverts : il reste réservable, il n'apparaît simplement
    #: dans aucun groupe du fil.
    neighborhood: Neighborhood | None = None
    coordinates: CoordinatesPayload | None = None
    timezone: str | None = None
    default_locale: Locale | None = None
    #: Le téléphone, **au format international**. Voir `TELEPHONE` : sans
    #: indicatif, un numéro composé depuis un autre pays ne joint personne, et
    #: la moitié du marché de Miami appelle depuis l'étranger.
    phone: str | None = Field(default=None, max_length=25)
    #: Clé de stockage objet, jamais une URL : une URL signée expire, une URL
    #: publique fuit, et les deux se figeraient en base au changement de
    #: fournisseur. Envoyer `null` la retire.
    cover_photo_key: str | None = Field(default=None, max_length=500)
    #: La couverture verticale du mur. Un champ à part : la paysage sert
    #: encore la fiche et les listes. Envoyer `null` la retire.

    #: L'adresse de la carte du commerce, quand elle existe déjà en ligne.
    #: Envoyer `null` la retire. Alternative ou complément aux pages déposées :
    #: l'un ou l'autre suffit à ouvrir une offre à choix.
    menu_url: str | None = Field(default=None, max_length=1000)

    @field_validator("timezone")
    @classmethod
    def _timezone_exists(cls, value: str | None) -> str | None:
        return _check_timezone(value)


class CommerceDeLAppartenance(BaseModel):
    """Un commerce de la liste d'appartenance, avec ce qui fait choisir.

    **Un schéma à part et non un champ de plus sur `BusinessRead`.** Le compte
    des décisions n'a de sens que dans le sélecteur : sur la fiche d'un salon
    qu'on regarde déjà, il répète ce que la journée affiche à côté. Le poser sur
    le schéma commun l'aurait servi partout, y compris là où personne ne le lit.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    timezone: str
    #: Combien de réservations attendent une décision de ce salon.
    #:
    #: **C'est ce qui fait basculer un gérant qui ne savait pas qu'on
    #: l'attendait.** Sans lui la liste reste utilisable et perd sa raison
    #: d'être ouverte : deux noms de salons ne disent pas lequel a besoin de
    #: vous ce matin.
    #:
    #: Le même compte que la file « à trancher » de la journée, et non un compte
    #: du jour : une demande d'avant-hier attend toujours, et l'écarter du
    #: compteur ferait disparaître précisément celle qui a le plus attendu.
    decisions_en_attente: int


class BusinessRead(BaseModel):
    id: uuid.UUID
    name: str
    category: BusinessCategory
    address: str | None
    neighborhood: Neighborhood | None
    coordinates: CoordinatesPayload | None
    timezone: str
    default_locale: Locale
    phone: str | None
    currency: str
    cover_photo_key: str | None
    menu_url: str | None
    status: BusinessStatus
    #: Quand la période de grâce se ferme, et le salon quitte le fil.
    #:
    #: **Sans elle le bandeau n'a qu'un état au lieu de trois.** Abonné, il ne
    #: s'affiche pas ; en grâce, il dit combien de jours restent ; la grâce
    #: passée, il dit que le salon n'est plus visible et pourquoi. `status`
    #: seul ne les distingue pas : un salon en grâce et un salon abonné sont
    #: tous deux `active`.
    #:
    #: **Nulle quand un abonnement vivant existe** : il n'y a alors plus
    #: d'échéance à surveiller, et c'est le premier des trois états. Nulle aussi
    #: sur une fiche qui n'a jamais été activée — la grâce s'ouvre à
    #: l'activation, pas à la préparation.
    #:
    #: Servie ici et non sur l'abonnement, parce que la route de l'abonnement
    #: rend `null` quand il n'y en a pas — c'est-à-dire exactement dans les deux
    #: états où le bandeau a quelque chose à dire.
    grace_ends_at: datetime | None
    created_at: datetime


class EtatDeLaCompositionRead(BaseModel):
    """Où en est la composition, pour le menu de configuration.

    Trois nombres et une date, en une lecture. Les demander séparément ferait
    trois requêtes pour un menu, dont l'une arriverait toujours en dernier — et
    le menu se recomposerait sous les yeux de qui le lit.
    """

    model_config = ConfigDict(from_attributes=True)

    business_id: uuid.UUID
    prestations: int
    prestations_masquees: int
    jours_ouverts: int
    #: Nulle tant que le commerce n'a jamais été mis en ligne. Ce n'est pas la
    #: même chose qu'une mise en pause, et l'écran ne doit pas les confondre.
    en_ligne_depuis: datetime | None
    status: BusinessStatus


class PalierLePlusOffertRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    platform: Platform
    content_format: ContentFormat
