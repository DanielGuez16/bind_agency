"""L'annuaire des créatrices vu par l'administration."""

import uuid
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models.enums import Platform


class ReseauDuCreateurRead(BaseModel):
    """Un compte rattaché. Le réseau reste, ce qui l'identifie est le pseudonyme."""

    model_config = ConfigDict(from_attributes=True)

    platform: Platform
    handle: str | None
    #: Nul quand aucun relevé n'existe. Zéro serait un chiffre, et faux.
    followers: int | None
    #: La photo **par sa clé**, servie par `GET /media/{cle}` — jamais l'adresse
    #: de la plateforme, qui expire.
    avatar_key: str | None
    #: Le profil public, nul sur une plateforme qu'on ne sait pas rattacher.
    profil_url: str | None


class CreateurAdminRead(BaseModel):
    """Une créatrice, telle que l'administration la lit.

    **Aucun état civil.** La règle vient de l'annuaire du commerce et vaut ici
    pour la même raison : le pseudonyme est l'identité de ces écrans, et le nom
    civil arrive à la réservation, quand une créatrice a choisi ce salon.

    **Le score, en revanche, est servi ici — et cette ligne disait l'inverse.**
    Elle affirmait qu'« un classement de personnes par note ne devient pas
    acceptable parce que c'est un administrateur qui le lit ». L'argument
    portait sur le **classement**, et la conclusion l'a étendu à la **donnée** :
    l'annuaire n'ordonne pas par score, il l'affiche sur la ligne d'une
    personne qu'on est déjà venu chercher par son pseudonyme.

    Ce que la règle protège reste intact et n'a jamais concerné ce lecteur-ci :
    **un commerce ne voit jamais ce nombre.** C'est la promesse du produit, et
    ce qui la rend tenable est que le palier accessible *est* le signal — un
    score dégradé plafonne mécaniquement. L'administration, elle, arbitre des
    dossiers ; lui refuser le seul chiffre qui dit si une créatrice tient ses
    engagements revient à lui faire trancher sans le savoir.
    """

    model_config = ConfigDict(from_attributes=True)

    creator_id: uuid.UUID
    city: str | None
    reseaux: list[ReseauDuCreateurRead]
    audience_totale: int
    #: **Nul veut dire neutre, jamais zéro.** C'est la règle du moteur de
    #: paliers, et elle vaut à l'affichage : une créatrice sans historique n'a
    #: pas un mauvais score, elle n'en a pas. Rendre zéro la ferait lire comme
    #: la moins fiable de la liste alors qu'elle est seulement la plus récente.
    reliability_score: Decimal | None
