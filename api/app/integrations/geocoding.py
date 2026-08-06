"""Géocodage d'adresse.

Une seule opération : d'une adresse vers des coordonnées. Le reste du système ne
connaît que cette interface, jamais un fournisseur.

L'implémentation d'aujourd'hui ne résout rien : elle prend les coordonnées telles
qu'on les lui donne. Aucun appel réseau, aucune clé, aucune dépendance. C'est ce
qui permet à la phase 2 d'exister sans attendre le choix d'un fournisseur, tout
en gardant vraie la règle « un commerce n'est actif que géocodé ».

L'implémentation réelle arrive en phase 5, quand le fil géolocalisé en a
réellement besoin. Elle remplacera `ManualGeocoder` sans que le service de
commerce change d'une ligne.
"""

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

LONGITUDE_RANGE = (-180.0, 180.0)
LATITUDE_RANGE = (-90.0, 90.0)


@dataclass(frozen=True, slots=True)
class Coordinates:
    longitude: float
    latitude: float

    def __post_init__(self) -> None:
        if not LONGITUDE_RANGE[0] <= self.longitude <= LONGITUDE_RANGE[1]:
            raise ValueError(f"longitude hors bornes : {self.longitude}")
        if not LATITUDE_RANGE[0] <= self.latitude <= LATITUDE_RANGE[1]:
            raise ValueError(f"latitude hors bornes : {self.latitude}")

    def as_wkt(self) -> str:
        """PostGIS attend l'ordre longitude puis latitude, l'inverse de l'usage courant."""
        return f"POINT({self.longitude} {self.latitude})"


@runtime_checkable
class Geocoder(Protocol):
    async def locate(
        self, address: str | None, *, declared: Coordinates | None = None
    ) -> Coordinates | None:
        """Résout une adresse. Renvoie `None` quand elle ne l'est pas.

        Un échec de résolution n'est pas une erreur : le commerce reste en
        onboarding, son inscription n'est pas bloquée pour autant.
        """
        ...


class ManualGeocoder:
    """Ne résout rien : rend les coordonnées fournies, ignore l'adresse."""

    async def locate(
        self, address: str | None, *, declared: Coordinates | None = None
    ) -> Coordinates | None:
        return declared


def get_geocoder() -> Geocoder:
    """Dépendance FastAPI. Le jour où un fournisseur existe, cette ligne change, et elle seule."""
    return ManualGeocoder()
