"""D'une adresse IP vers une géographie approximative, sans jamais la conserver.

**L'exigence tient en une phrase : l'adresse IP n'est jamais stockée.** Elle
entre dans ce module, en ressort une localisation grossière, et la variable
meurt avec la requête. Aucune table du produit ne porte de colonne d'adresse, et
aucune n'en portera : c'est une contrainte de conception, pas un réglage.

**D'où le refus d'un service hébergé.** Une API de géolocalisation, gratuite ou
non, exige d'*envoyer* l'adresse à un tiers — c'est-à-dire de faire exactement
ce qu'on s'interdit de faire soi-même, en s'en remettant à la politique de
rétention de quelqu'un d'autre. Un fichier local résout la question sans réseau,
sans clé, sans quota et sans confier quoi que ce soit à personne.

**Format retenu : MMDB**, lu par `maxminddb` (MIT). Deux bases publiques le
publient sous licence libre et sans abonnement — DB-IP Lite City (CC BY 4.0,
mensuelle, sans compte) et MaxMind GeoLite2 City (gratuite, compte requis). Le
lecteur est le même pour les deux : le choix de la base est une ligne de
configuration, pas une réécriture.

**La granularité s'arrête à la ville.** C'est ce dont le produit a besoin — un
créateur de Miami touche-t-il Miami — et c'est aussi la limite de ce que ces
bases savent dire honnêtement. Les coordonnées rendues sont **le centre de la
ville**, identique pour tous ses habitants : elles situent une ville, jamais
quelqu'un.

**Sans base, on ne devine pas.** Le résolveur absent rend `None`, et le clic est
enregistré sans géographie plutôt qu'avec une géographie inventée. L'intégration
continue tourne ainsi, aucun fichier de base n'étant versionné.
"""

from __future__ import annotations

import functools
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

from app.core.config import ConfigurationError, get_settings


@dataclass(frozen=True, slots=True)
class Localisation:
    """Ce qu'on retient d'un visiteur, et rien de plus.

    Les quatre champs sont nullables : une base peut connaître le pays sans la
    ville, et un réseau d'entreprise ne se résout parfois pas du tout. Un champ
    manquant se dit, il ne se comble pas.
    """

    #: Code ISO 3166-1 alpha-2, majuscules.
    country_code: str | None
    #: Subdivision de premier niveau — l'État aux États-Unis.
    region: str | None
    city: str | None
    #: Le **centre de la ville**, jamais la position du visiteur. Identique pour
    #: tous ceux qui s'y connectent, et c'est ce qui le rend anodin.
    longitude: float | None
    latitude: float | None

    @property
    def vide(self) -> bool:
        return self.country_code is None and self.city is None


@runtime_checkable
class GeoResolver(Protocol):
    def resolve(self, ip: str) -> Localisation | None:
        """Rend la localisation, ou `None` quand elle est inconnue.

        **Ne lève jamais.** Une base absente, corrompue ou muette sur une plage
        d'adresses ne doit pas faire échouer une redirection : le visiteur n'a
        rien demandé de tout cela, et il attend d'arriver sur la fiche du salon.
        """
        ...


class ResolveurAbsent:
    """Ne résout rien, et le dit.

    En service quand aucune base n'est configurée : développement, intégration
    continue, tests. Le clic est alors enregistré sans géographie — un manque
    visible vaut mieux qu'un pays inventé, qui contaminerait ensuite la part
    locale et le score d'impact.
    """

    def resolve(self, ip: str) -> Localisation | None:  # noqa: ARG002
        return None


class ResolveurMMDB:
    """Lit une base MMDB locale. Aucun réseau, aucune clé, aucun quota.

    Le lecteur est ouvert une fois et gardé : la base fait plusieurs dizaines de
    mégaoctets, et la rouvrir à chaque clic transformerait une redirection en
    lecture de fichier.
    """

    def __init__(self, chemin: Path) -> None:
        import maxminddb

        # `MODE_MEMORY` charge tout en mémoire : la base tient en quelques
        # dizaines de mégaoctets, et c'est le seul mode qui reste sûr quand
        # plusieurs requêtes lisent en parallèle.
        self._lecteur = maxminddb.open_database(str(chemin), mode=maxminddb.MODE_MEMORY)

    def resolve(self, ip: str) -> Localisation | None:
        try:
            brut = self._lecteur.get(ip)
        except (ValueError, OSError):
            # Adresse malformée, base illisible : on ne sait pas, on le dit.
            return None
        if not isinstance(brut, dict):
            return None
        return _lire(brut)


def _premier_nom(bloc: Any) -> str | None:
    """Le nom anglais d'une entité MMDB, ou le premier disponible.

    Les deux bases publient `names` en plusieurs langues et ne garantissent pas
    les mêmes. On préfère l'anglais — stable d'une base à l'autre — plutôt que
    la locale de l'appelant : c'est une donnée de reporting comparable entre
    salons, pas un libellé d'interface.
    """
    if not isinstance(bloc, dict):
        return None
    noms = bloc.get("names")
    if not isinstance(noms, dict) or not noms:
        return None
    valeur = noms.get("en") or next(iter(noms.values()))
    return str(valeur) if valeur else None


def _lire(brut: dict) -> Localisation:
    """Traduit un enregistrement MMDB, en tolérant les champs absents.

    Écrit défensivement à dessein : le schéma des bases libres varie d'un
    fournisseur à l'autre et d'une version à l'autre, et une `KeyError` ici
    casserait une redirection publique.
    """
    pays = brut.get("country") or brut.get("registered_country") or {}
    code = pays.get("iso_code") if isinstance(pays, dict) else None

    subdivisions = brut.get("subdivisions")
    region = None
    if isinstance(subdivisions, list) and subdivisions:
        region = _premier_nom(subdivisions[0])

    emplacement = brut.get("location") if isinstance(brut.get("location"), dict) else {}
    longitude = emplacement.get("longitude")
    latitude = emplacement.get("latitude")

    return Localisation(
        country_code=str(code).upper() if code else None,
        region=region,
        city=_premier_nom(brut.get("city")),
        longitude=float(longitude) if isinstance(longitude, (int, float)) else None,
        latitude=float(latitude) if isinstance(latitude, (int, float)) else None,
    )


@functools.lru_cache(maxsize=1)
def get_geo_resolver() -> GeoResolver:
    """Le résolveur en service, construit une fois.

    En cache : le lecteur MMDB charge sa base en mémoire, et le reconstruire à
    chaque requête coûterait plus cher que tout le reste de la redirection.
    """
    settings = get_settings()
    chemin = settings.geoip_database_path
    if chemin is None:
        return ResolveurAbsent()

    fichier = Path(chemin)
    if not fichier.is_file():
        # **On refuse de démarrer plutôt que de retomber en silence.** Une base
        # configurée mais absente est une erreur de déploiement ; la traiter
        # comme « pas de géographie » ferait tourner la production pendant des
        # semaines avec des clics sans pays, sans que rien ne le signale.
        raise ConfigurationError(
            f"base geoip introuvable : {fichier}. "
            "Retirer GEOIP_DATABASE_PATH pour tourner sans géographie."
        )
    return ResolveurMMDB(fichier)


def check_geoip_configuration() -> None:
    """Sonde de démarrage : la base configurée est lisible.

    Appelée au montage de l'application, comme les autres intégrations. Mieux
    vaut un refus de démarrer qu'une redirection qui perd sa géographie en
    silence.
    """
    get_geo_resolver()
