"""Schémas du profil créateur."""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints, field_validator

#: Une chaîne vide ou blanche vaut « pas renseigné ». Le validateur la ramène à
#: `None` plutôt que de la refuser : effacer un champ en envoyant `""` est un
#: geste naturel, et le rejeter obligerait l'app à traduire avant d'envoyer.
Texte = Annotated[str, StringConstraints(strip_whitespace=True)]


class CreatorProfileUpdate(BaseModel):
    """Mise à jour partielle. Ce qui n'est pas envoyé n'est pas touché.

    `extra="forbid"` : une charge utile qui porterait `reliability_score` ou
    `completed_collabs_count` est refusée, pas ignorée. Un champ silencieusement
    écarté ferait croire à l'appelant qu'il a été pris en compte.
    """

    model_config = ConfigDict(extra="forbid")

    first_name: Annotated[Texte, StringConstraints(max_length=100)] | None = None
    last_name: Annotated[Texte, StringConstraints(max_length=100)] | None = None
    city: Annotated[Texte, StringConstraints(max_length=120)] | None = None
    bio: Annotated[Texte, StringConstraints(max_length=1_000)] | None = None

    @field_validator("first_name", "last_name", "city", "bio")
    @classmethod
    def _vide_vaut_absent(cls, valeur: str | None) -> str | None:
        return valeur or None


class CreatorProfileRead(BaseModel):
    """Ce que le titulaire voit de son propre profil.

    `reliability_score`, `completed_collabs_count` et `is_new_creator` en font
    partie bien qu'ils ne soient pas modifiables : ce sont eux qui expliquent
    ses paliers, et les cacher rendrait l'éligibilité incompréhensible.
    """

    model_config = ConfigDict(from_attributes=True)

    first_name: str | None
    last_name: str | None
    city: str | None
    bio: str | None
    reliability_score: float | None
    completed_collabs_count: int
    is_new_creator: bool
    anonymized_at: object | None = None
