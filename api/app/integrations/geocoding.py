"""Géocodage d'adresse.

Une seule opération : d'une adresse vers des coordonnées. Le reste du système ne
connaît que cette interface, jamais un fournisseur.

L'implémentation d'aujourd'hui ne résout rien : elle prend les coordonnées telles
qu'on les lui donne. Aucun appel réseau, aucune clé, aucune dépendance. C'est ce
qui permet à la phase 2 d'exister sans attendre le choix d'un fournisseur, tout
en gardant vraie la règle « un commerce n'est actif que géocodé ».

L'implémentation réelle est arrivée avec le fil géolocalisé, et elle a
effectivement remplacé `ManualGeocoder` sans que le service de commerce change
d'une ligne.

**Fournisseur retenu : Geocodio.** Les trois critères étaient : pas
d'abonnement, facturation à l'appel, pas de carte bancaire pour le quota
d'essai. Geocodio les tient tous les trois — et c'est rare, la plupart des
concurrents facturent au mois ou demandent une carte dès l'inscription. Sa
limite est d'être États-Unis et Canada seulement, ce qui convient à un
lancement à Miami et devra être revu le jour d'une ouverture ailleurs. Le
changement se fera dans ce fichier, nulle part ailleurs.
"""

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

import httpx

from app.core.config import ConfigurationError, get_settings

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
    """Ne résout rien : rend les coordonnées fournies, ignore l'adresse.

    Reste en service pour le développement, les tests et le jeu de données : ils
    n'ont ni clé ni réseau, et ne doivent pas en avoir besoin.
    """

    async def locate(
        self, address: str | None, *, declared: Coordinates | None = None
    ) -> Coordinates | None:
        return declared


GEOCODIO = "https://api.geocod.io/v1.7/geocode"


class GeocodioGeocoder:
    """Geocodio, un appel, une adresse.

    **Des coordonnées déclarées l'emportent toujours.** Un commerce qui s'est
    placé lui-même sur une carte sait mieux que nous où il est — un géocodeur
    place à la rue, pas à la porte, et une adresse de centre commercial tombe
    régulièrement sur le mauvais bâtiment. Sans cette priorité, corriger une
    résolution fausse serait impossible.

    **Une résolution imprécise est refusée comme une absence de résolution.**
    Un commerce placé à quarante kilomètres apparaîtrait dans le mauvais fil,
    et personne ne saurait pourquoi. Mieux vaut le laisser en onboarding avec
    une adresse à préciser : l'absence se voit, l'erreur non.
    """

    def __init__(self, client: httpx.AsyncClient) -> None:
        settings = get_settings()

        if settings.geocoding_api_key is None:
            raise ConfigurationError("GEOCODING_PROVIDER=geocodio exige GEOCODING_API_KEY")

        self._client = client
        self._cle = settings.geocoding_api_key.get_secret_value()
        self._precision_minimale = settings.geocoding_min_accuracy
        self._delai = httpx.Timeout(settings.geocoding_timeout_seconds)

    async def locate(
        self, address: str | None, *, declared: Coordinates | None = None
    ) -> Coordinates | None:
        if declared is not None:
            return declared
        if not address or not address.strip():
            return None

        # Toute erreur rend `None`. Un échec de résolution n'est pas une erreur
        # métier : le commerce reste en onboarding, son inscription aboutit
        # quand même. Faire échouer l'inscription parce que Geocodio est en
        # panne serait perdre un commerce pour une raison qui ne le regarde pas.
        try:
            reponse = await self._client.get(
                GEOCODIO,
                params={"q": address, "api_key": self._cle, "limit": 1},
                timeout=self._delai,
            )
            if reponse.status_code >= 400:
                return None
            corps = reponse.json()
        except (httpx.HTTPError, ValueError):
            return None

        return self._premier_resultat(corps)

    def _premier_resultat(self, corps: object) -> Coordinates | None:
        if not isinstance(corps, dict):
            return None

        resultats = corps.get("results") or []
        if not resultats:
            return None

        premier = resultats[0]
        if not isinstance(premier, dict):
            return None

        if float(premier.get("accuracy") or 0) < self._precision_minimale:
            return None

        lieu = premier.get("location") or {}
        longitude, latitude = lieu.get("lng"), lieu.get("lat")
        if longitude is None or latitude is None:
            return None

        try:
            return Coordinates(longitude=float(longitude), latitude=float(latitude))
        except ValueError:
            # Hors bornes : la réponse est inutilisable, pas le processus.
            return None


async def get_geocoder():
    """Dépendance FastAPI. Le fournisseur est choisi en configuration.

    Pas de repli silencieux : si `geocodio` est demandé sans clé, la
    construction lève, et le contrôle a déjà eu lieu au démarrage.
    """
    if get_settings().geocoding_provider != "geocodio":
        yield ManualGeocoder()
        return

    async with httpx.AsyncClient() as client:
        yield GeocodioGeocoder(client)


def check_geocoder_configuration() -> None:
    """Appelé au démarrage. Une configuration incohérente empêche de lancer.

    Découvrir au premier commerce créé que la clé manque signifierait un
    commerce placé nulle part, et personne pour s'en apercevoir.
    """
    settings = get_settings()
    if settings.geocoding_provider == "geocodio" and settings.geocoding_api_key is None:
        raise ConfigurationError("GEOCODING_PROVIDER=geocodio exige GEOCODING_API_KEY")
