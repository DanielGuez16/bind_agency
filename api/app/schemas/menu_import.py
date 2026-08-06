"""Schémas de l'import de carte."""

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import MenuImportStatus


class MenuImportCreate(BaseModel):
    """Le fichier est déjà déposé : on enregistre sa clé, pas son contenu."""

    model_config = ConfigDict(extra="forbid")

    file_key: str = Field(min_length=1, max_length=500)
    mime_type: str = Field(min_length=3, max_length=100)


class LigneExtraiteRead(BaseModel):
    """Une ligne candidate. Pas un item : personne ne l'a encore validée.

    `duration_minutes` n'y figure pas, et c'est délibéré : l'extraction ne la
    fournit pas, et l'afficher vide donnerait l'impression d'un champ que le
    modèle aurait pu remplir.
    """

    name: str
    price_cents: int
    description: str | None
    #: Sert à ordonner ce que l'humain relit en premier, jamais à décider seul.
    confidence: Decimal


class MenuImportRead(BaseModel):
    id: uuid.UUID
    business_id: uuid.UUID
    status: MenuImportStatus
    mime_type: str
    #: Devise lue sur la carte, quand elle y figure. Jamais utilisée pour
    #: écrire — la devise d'un commerce est déclarée à sa création — mais
    #: rendue pour que la relecture signale une incohérence.
    currency: str | None
    lignes: list[LigneExtraiteRead]
    confiance_moyenne: Decimal | None
    reviewed_at: datetime | None
    created_at: datetime


class LigneRevueWrite(BaseModel):
    """Ce que le commerce a relu et corrigé.

    `duration_minutes` est **saisie ici**. Une carte affiche des prix, pas des
    temps de poste, et quand elle affiche une durée c'est celle annoncée au
    client — pas celle que le commerce bloque.
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    price_cents: int = Field(ge=0)
    description: str | None = Field(default=None, max_length=2000)
    duration_minutes: int | None = Field(default=None, gt=0)
    requires_booking: bool = True
    #: Faux pour écarter la ligne. Conservée dans la charge révisée : savoir ce
    #: qu'un commerce a refusé vaut autant que savoir ce qu'il a gardé.
    retenue: bool = True


class ValidationDemande(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lignes: list[LigneRevueWrite] = Field(min_length=1)


class ValidationRead(BaseModel):
    import_id: uuid.UUID
    status: MenuImportStatus
    items_crees: int
