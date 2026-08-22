"""De quel écran relève une requête, pour savoir si la reprise l'ouvre.

**Le problème que ce module résout.** Une reprise déclare une portée à
l'ouverture ; encore faut-il, à chaque requête, savoir à quelle portée cette
requête appartient. Le résolveur d'appartenance ne connaît qu'un identifiant de
commerce — il ne sait pas qu'il garde la carte plutôt que les chiffres.

**La correspondance passe par les étiquettes de routeur, pas par les chemins.**
Les étiquettes existent déjà, elles sont posées une fois par routeur, et elles
regroupent naturellement ce qui fait un écran. Une correspondance par chemin
demanderait un motif par route, se déferait au premier renommage, et personne
ne verrait qu'elle s'est défaite.

**Ce qui n'est pas dans la table n'est ouvert par aucune reprise.** Un routeur
neuf, une étiquette oubliée : le support est refusé, et il le voit à la première
tentative. Le sens inverse — laisser passer ce qu'on n'a pas classé — ouvrirait
une porte que personne n'a déclarée, et rien ne le dirait jamais.
"""

from fastapi import Request

from app.models.enums import PorteeDeReprise

#: Étiquette de routeur → écran. Plusieurs étiquettes par écran, jamais
#: l'inverse : un routeur qui relèverait de deux portées serait un routeur à
#: couper en deux.
DOMAINE_PAR_ETIQUETTE: dict[str, PorteeDeReprise] = {
    "business": PorteeDeReprise.FICHE,
    "business-photos": PorteeDeReprise.FICHE,
    "business-menu": PorteeDeReprise.FICHE,
    "menu-imports": PorteeDeReprise.FICHE,
    "catalog": PorteeDeReprise.CATALOGUE,
    "tier-offers": PorteeDeReprise.CATALOGUE,
    "tiers": PorteeDeReprise.CATALOGUE,
    "bookings": PorteeDeReprise.AGENDA,
    "capacity": PorteeDeReprise.AGENDA,
    "collaborations": PorteeDeReprise.CONTREPARTIES,
    "directory": PorteeDeReprise.ANNUAIRE,
    "subscription": PorteeDeReprise.ABONNEMENT,
    "reporting": PorteeDeReprise.CHIFFRES,
    "tracking": PorteeDeReprise.CHIFFRES,
    # `support` est absent volontairement. La liste des reprises faites chez un
    # salon est ce que **le salon** lit de nous ; l'administration a sa propre
    # route pour la même chose. Aucune portée ne l'ouvre donc côté commerce, et
    # une reprise ne sert jamais à relire ses propres traces.
}


def portee_de_la_requete(request: Request) -> PorteeDeReprise | None:
    """L'écran dont relève cette requête, si on l'a classé.

    `None` veut dire « non classé », et se lit comme un refus chez l'appelant —
    jamais comme une permission.
    """
    route = request.scope.get("route")
    for etiquette in getattr(route, "tags", ()) or ():
        domaine = DOMAINE_PAR_ETIQUETTE.get(etiquette)
        if domaine is not None:
            return domaine
    return None
