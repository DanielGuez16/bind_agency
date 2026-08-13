"""Schémas de la reprise d'un compte commerce."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class RepriseDemandee(BaseModel):
    """Ce qu'un administrateur doit dire pour entrer.

    Le motif est le seul champ, et il est obligatoire : c'est lui qui distingue
    une intervention d'une habitude, et c'est lui que le salon lira.
    """

    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=1, max_length=500)


class BusinessSupportAccessRead(BaseModel):
    """Une reprise, telle que l'administration et **le salon** la lisent.

    La même forme des deux côtés : ce que le salon voit de nous est ce que nous
    voyons de nous-mêmes. Rendre une version allégée au commerce demanderait de
    choisir ce qu'on lui cache, et il n'y a rien ici qui se cache.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    business_id: uuid.UUID
    admin_user_id: uuid.UUID
    reason: str
    started_at: datetime
    expires_at: datetime
    #: Nulle quand personne n'a refermé. **Une reprise échue n'est pas une
    #: reprise fermée** : l'expiration éteint sans rien écrire, et les deux ne
    #: se lisent pas pareil.
    ended_at: datetime | None
