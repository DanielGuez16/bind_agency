"""L'annuaire des créatrices vu par l'administration."""

import uuid

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

    **Aucun état civil, aucun score.** La première règle vient de l'annuaire du
    commerce et vaut ici pour la même raison : le pseudonyme est l'identité de
    ces écrans. La seconde aussi — un classement de personnes par note ne
    devient pas acceptable parce que c'est un administrateur qui le lit.
    """

    model_config = ConfigDict(from_attributes=True)

    creator_id: uuid.UUID
    city: str | None
    reseaux: list[ReseauDuCreateurRead]
    audience_totale: int
