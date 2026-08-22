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
    #: Clé de stockage objet, jamais une URL. Un article sans photo reste
    #: parfaitement réservable : c'est l'affichage qui s'en arrange.
    photo_key: str | None = Field(default=None, max_length=500)
    #: La prestation laisse-t-elle un choix au créateur.
    #:
    #: « Un menu contre une story » en laisse un ; « Brushing 45 min » n'en
    #: laisse aucun. **C'est le commerce qui le pose** — le déduire d'un nom
    #: marcherait sur les exemples qu'on a en tête et se tromperait sur « Menu
    #: signature du chef », qui est un plat précis.
    #:
    #: Une prestation à choix ne s'ouvre pas tant que le commerce n'a ni carte
    #: ni lien : la règle est vérifiée à l'ouverture de l'offre, pas ici.
    leaves_choice: bool = False


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
    #: Envoyer `null` retire la photo. C'est le seul champ de ce schéma dont
    #: l'effacement explicite a un sens — les autres décrivent l'article.
    photo_key: str | None = Field(default=None, max_length=500)
    #: Le drapeau se change : un restaurant peut décider qu'une formule devient
    #: un plat précis. La règle d'ouverture s'appliquera au prochain geste.
    leaves_choice: bool | None = None


class CatalogItemRead(BaseModel):
    id: uuid.UUID
    business_id: uuid.UUID
    parent_item_id: uuid.UUID | None
    name: str
    description: str | None
    price_cents: int
    duration_minutes: int | None
    requires_booking: bool
    photo_key: str | None
    leaves_choice: bool
    source: CatalogItemSource

    #: L'interrupteur propre à l'item, celui que le commerce manipule.
    is_available: bool
    #: Calculé, jamais stocké : un parent désactivé rend ses variantes
    #: indisponibles sans que leur propre interrupteur ne bouge.
    is_effectively_available: bool
    #: Quand la prestation a été retirée pour de bon. Nulle : elle est vivante.
    #:
    #: **À ne pas confondre avec `is_available` à faux.** Celui-ci dit « pas en
    #: ce moment » — la prestation saisonnière qu'on rouvrira ; celle-là dit
    #: « plus jamais ». Sans la distinction, l'écran sort de la liste de travail
    #: ce qu'on comptait rouvrir, ou y laisse des archives pour toujours.
    archived_at: datetime | None
    #: Combien de réservations citent cette prestation.
    #:
    #: **Pour que le bouton nomme sa conséquence** : « archiver, douze
    #: réservations citent cette prestation » se décide, « archiver » ne se
    #: décide pas. C'est aussi ce qui dit lequel des deux gestes est offert —
    #: à zéro, la suppression est vraie ; au-delà, elle n'existe pas.
    reservations_count: int

    created_at: datetime
    updated_at: datetime
