"""Schémas de l'annuaire des créateurs.

**Aucun champ de score, et c'est structurel.** Le schéma est la dernière barrière
avant le réseau : une donnée absente ici ne peut pas fuir, quoi que le service
calcule par ailleurs. C'est le bon endroit pour tenir une promesse faite à
l'utilisateur — mieux qu'une consigne dans un écran, qu'on oublie au deuxième
composant qui lit la même réponse.
"""

import uuid

from pydantic import BaseModel, ConfigDict

from app.models.enums import ContentFormat, Platform
from app.schemas.reporting import PorteeLocaleRead


class CompteVuRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    platform: Platform
    handle: str | None
    #: Nul quand aucun relevé n'existe. Zéro serait un chiffre, et faux.
    followers: int | None
    #: La photo, **par sa clé** — servie par `GET /media/{cle}`, comme les
    #: photos de salon. Jamais l'adresse de la plateforme : elle expire.
    avatar_key: str | None
    #: L'adresse du profil public, dérivée du pseudonyme. Nulle sur une
    #: plateforme qu'on ne sait pas rattacher, ou sans pseudonyme : un lien qui
    #: mène à une page d'erreur est pire qu'un lien absent.
    profil_url: str | None


class CreateurVuRead(BaseModel):
    """Ce qu'un salon abonné voit d'une créatrice.

    Ni score de fiabilité, ni compteur de collaborations, ni historique de
    manquements. Le palier ouvert dit déjà qu'elle tient ses engagements — un
    score dégradé la plafonnerait à un palier plus bas — et il le dit sans
    livrer un nombre qui permettrait de classer.
    """

    model_config = ConfigDict(from_attributes=True)

    creator_id: uuid.UUID
    first_name: str | None
    last_name: str | None
    city: str | None
    bio: str | None
    comptes: list[CompteVuRead]
    paliers_ouverts: list[ContentFormat]
    audience_totale: int


class AnnuaireRead(BaseModel):
    """L'annuaire, et le compte qui le précède.

    **Le compte avant la liste.** À deux mille créatrices, un salon ne cherche
    pas et ne connaît aucun nom : ce qu'il lit d'abord est « 41 des 128 dans
    15 km peuvent réserver ce que vous avez ouvert ». Servi ici plutôt que sur
    une seconde route, parce qu'un écran qui ouvre deux appels pour une phrase
    en affiche la moitié pendant que l'autre charge.

    Une enveloppe et non une liste nue : c'est un changement de forme pour
    l'appelant, et il est assumé — la liste seule ne pouvait porter aucun total.
    """

    model_config = ConfigDict(from_attributes=True)

    portee: PorteeLocaleRead
    createurs: list[CreateurVuRead]
