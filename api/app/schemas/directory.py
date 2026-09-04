"""Schémas de l'annuaire des créateurs.

**Aucun champ de score, et c'est structurel.** Le schéma est la dernière barrière
avant le réseau : une donnée absente ici ne peut pas fuir, quoi que le service
calcule par ailleurs. C'est le bon endroit pour tenir une promesse faite à
l'utilisateur — mieux qu'une consigne dans un écran, qu'on oublie au deuxième
composant qui lit la même réponse.
"""

import uuid

from pydantic import BaseModel, ConfigDict

from app.models.enums import CentreDInteret, ContentFormat, Platform
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


class PalierAccessibleIciRead(BaseModel):
    """Le meilleur palier qu'elle ouvre chez ce salon."""

    model_config = ConfigDict(from_attributes=True)

    tier_id: uuid.UUID
    platform: Platform
    content_format: ContentFormat


class CreateurVuRead(BaseModel):
    """Ce qu'un salon abonné voit d'une créatrice.

    **Ni nom, ni prénom.** Le pseudonyme est l'identité de cet écran ; l'état
    civil arrive à la réservation, quand une créatrice a choisi ce salon.

    Ni score de fiabilité, ni compteur de collaborations, ni historique de
    manquements. Le palier ouvert dit déjà qu'elle tient ses engagements — un
    score dégradé la plafonnerait à un palier plus bas — et il le dit sans
    livrer un nombre qui permettrait de classer.
    """

    model_config = ConfigDict(from_attributes=True)

    creator_id: uuid.UUID
    city: str | None
    bio: str | None
    #: Ce qu'elle a déclaré vouloir couvrir, entre un et trois. Vide tant
    #: qu'elle n'a rien déclaré. La carte les montre : un filtre qui trie sans
    #: dire sur quoi il a trié se lit comme une liste tronquée au hasard.
    interets: list[CentreDInteret]
    comptes: list[CompteVuRead]
    #: Les formats qu'elle ouvre **chez ce salon**. L'annuaire évaluait
    #: l'éligibilité contre tous les paliers du produit : la liste répondait
    #: « elle se qualifie quelque part », ce dont un salon ne peut rien faire.
    paliers_ouverts: list[ContentFormat]
    #: Vrai quand au moins un palier de ce salon lui est accessible. Premier
    #: critère du tri, avant la distance.
    peut_reserver_ici: bool
    palier_accessible: PalierAccessibleIciRead | None
    #: Distance au salon, en mètres. **Nulle veut dire « on ne sait pas »**,
    #: jamais « loin » : elle passe en fin de tri sans être écartée.
    distance_metres: int | None
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
    #: Triés par le serveur : accès d'abord, proximité ensuite. Une liste
    #: paginée qu'on trierait dans le client se réordonne à chaque page,
    #: puisque chaque page n'a que ses propres lignes à comparer.
    createurs: list[CreateurVuRead]
    #: Combien il y en a en tout, dans le rayon. « 20 sur 128 » demande de le
    #: savoir : une page pleine ne dit pas s'il en reste.
    total: int
