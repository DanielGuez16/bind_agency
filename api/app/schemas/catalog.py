"""Schémas du catalogue.

Les noms et descriptions sont saisis par le commerce, dans sa langue. Ils ne
sont jamais traduits, ni ici ni côté application.
"""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import CatalogItemSource


class CatalogItemCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    price_cents: int = Field(ge=0)
    duration_minutes: int | None = Field(default=None, gt=0)
    requires_booking: bool = True
    is_available: bool = True
    parent_item_id: uuid.UUID | None = None


class CatalogItemUpdate(BaseModel):
    """`parent_item_id` n'y figure pas : reparenter un item n'a pas de sens ici.

    Une variante rattachée ailleurs changerait de commerce ou de niveau, et
    l'item reste réservé sous son ancien parent dans les réservations passées.
    Créer un nouvel item est la bonne réponse.

    `is_available` n'y figure pas non plus : c'est une transition d'état, elle
    passe par sa propre route et laisse une trace au journal. Deux chemins pour
    la même transition finiraient par diverger sur ce point.
    """

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    price_cents: int | None = Field(default=None, ge=0)
    duration_minutes: int | None = Field(default=None, gt=0)
    requires_booking: bool | None = None


class CatalogItemRead(BaseModel):
    id: uuid.UUID
    business_id: uuid.UUID
    parent_item_id: uuid.UUID | None
    name: str
    description: str | None
    price_cents: int
    duration_minutes: int | None
    requires_booking: bool
    source: CatalogItemSource

    #: L'interrupteur propre à l'item, celui que le commerce manipule.
    is_available: bool
    #: Calculé, jamais stocké : un parent désactivé rend ses variantes
    #: indisponibles sans que leur propre interrupteur ne bouge.
    is_effectively_available: bool

    created_at: datetime
    updated_at: datetime
