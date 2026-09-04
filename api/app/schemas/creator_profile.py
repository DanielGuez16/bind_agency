"""Schémas du profil créateur."""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints, field_validator

from app.models.enums import CentreDInteret

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

    #: **Entre un et trois, ou rien.** `None` veut dire « pas envoyé, ne touche
    #: pas », comme partout ailleurs dans ce schéma. La liste vide est le geste
    #: par lequel on efface, et le validateur la ramène à `None` : c'est déjà
    #: ce que la chaîne vide fait aux champs texte juste au-dessus, et cela
    #: évite que « je n'ai rien déclaré » ait deux écritures en base.
    interests: list[CentreDInteret] | None = None

    @field_validator("first_name", "last_name", "city", "bio")
    @classmethod
    def _vide_vaut_absent(cls, valeur: str | None) -> str | None:
        return valeur or None

    @field_validator("interests")
    @classmethod
    def _un_a_trois_sans_doublon(
        cls, valeurs: list[CentreDInteret] | None
    ) -> list[CentreDInteret] | None:
        """Déduplique, puis borne à trois. Le vide vaut « pas renseigné ».

        La déduplication passe avant le compte, et non l'inverse : quatre
        valeurs dont deux identiques sont trois choix, pas une faute. Refuser
        là obligerait l'écran à dédupliquer avant d'envoyer pour obtenir le
        même résultat.
        """
        if valeurs is None:
            return None
        uniques = list(dict.fromkeys(valeurs))
        if len(uniques) > 3:
            raise ValueError("trois centres d'intérêt au plus")
        return uniques or None


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
    interests: list[str] | None
    reliability_score: float | None
    completed_collabs_count: int
    is_new_creator: bool
    anonymized_at: object | None = None
