"""Schémas de la disponibilité."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class CreneauRead(BaseModel):
    """Un début possible, et ce qu'il reste de places.

    `places_restantes` est rendu plutôt que caché : l'app peut signaler
    « dernière place » sans redemander, et c'est une information que le créateur
    utilise pour décider.
    """

    model_config = ConfigDict(from_attributes=True)

    starts_at: datetime
    ends_at: datetime
    places_restantes: int


class JourDeDisponibiliteRead(BaseModel):
    """Un jour de la bande de quatorze.

    **Les deux champs, et non le seul compte.** Zéro créneau sur un jour ouvert
    n'est pas un jour fermé : « complet » invite à regarder le lendemain,
    « fermé » se grise. Un écran qui n'aurait que le compte peindrait les deux
    de la même façon, et la personne croirait le salon fermé un jour où il
    déborde.
    """

    model_config = ConfigDict(from_attributes=True)

    jour: date
    #: L'horaire du salon, indépendant de la prestation demandée.
    ouvert: bool
    #: Les débuts possibles pour cet item, ce jour-là.
    creneaux_libres: int
