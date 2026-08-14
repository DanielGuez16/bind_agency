"""La carte de passation nomme des routes qui existent.

**Pourquoi ce fichier.** `design_handoff_bind/api-map.md` est ce sur quoi Claude
Design compose les écrans. Sa révision précédente datait de quarante PR plus
tôt : elle décrivait une quarantaine de routes sur cent dix-neuf, et **deux de
ses lignes nommaient des chemins qui n'ont jamais existé** — `POST
/merchant/pause`, et un arbitrage qui serait passé par la route du commerce.

Une carte périmée ne fait pas échouer de test : elle fait dessiner un écran
contre une route absente, et le défaut apparaît à l'intégration, une semaine
plus tard, chez quelqu'un d'autre.

**Ce test ne vérifie qu'un sens, et c'est le sens qui coûte cher.** Toute route
citée doit exister. L'inverse — toute route existante doit être citée — ferait
tomber la CI à chaque route neuve avant qu'on ait eu le temps d'écrire ce
qu'elle sert, ce qui apprendrait surtout à contourner le test.
"""

import pathlib
import re

from fastapi.routing import APIRoute

from app.core.config import API_ROOT
from app.main import create_app

CARTE = API_ROOT.parent / "design_handoff_bind" / "api-map.md"

#: Les chemins cités dans la carte se lisent dans du texte : `GET /me/tiers`,
#: `POST /bookings/{id}/confirm`, parfois avec des paramètres accolés. On
#: retient le chemin et on jette le reste.
CHEMIN = re.compile(r"`(?:GET|POST|PATCH|PUT|DELETE)?\s*(/[a-zA-Z0-9_{}/.:-]+)")

#: Ce que la carte nomme sans que ce soit une route de l'API.
#:
#: Deux entrées, et chacune dit pourquoi. Une liste qui s'allonge sans raison
#: est le début du contournement que ce test existe pour éviter.
TOLERES = {
    "/api/v1": "le préfixe lui-même, cité dans les conventions",
    "/admin": "un préfixe cité dans les conventions, pas une route",
    "/r/{slug}": "la redirection publique, montée hors du préfixe de version",
    # **Cité pour dire qu'il n'existe pas.** La carte ouvre sur un tableau des
    # corrections, et celle-ci nomme le chemin fautif à côté du bon. Le retirer
    # priverait le lecteur de ce qu'il doit désapprendre.
    "/merchant/pause": "cité dans le tableau des corrections comme n'ayant jamais existé",
}


def _routes_reelles() -> set[str]:
    """Les chemins servis, préfixe compris.

    L'arbre se parcourt : `app.routes` rend des routeurs inclus et non des
    routes, et le lire à plat rendrait un ensemble vide — donc un test vert qui
    n'inspecte rien.
    """
    trouvees: set[str] = set()

    def parcourir(routeur, prefixe: str) -> None:
        for route in getattr(routeur, "routes", []):
            if isinstance(route, APIRoute):
                trouvees.add(prefixe + route.path)
                continue
            origine = getattr(route, "original_router", None)
            if origine is not None:
                contexte = getattr(route, "include_context", None)
                parcourir(origine, prefixe + (getattr(contexte, "prefix", "") or ""))

    parcourir(create_app(), "")
    return trouvees


def _normaliser(chemin: str) -> str:
    """Le chemin, avec ses paramètres ramenés à une forme comparable.

    La carte écrit `/bookings/{id}/code` là où la route déclare
    `/bookings/{booking_id}/code` : le nom du paramètre est une commodité de
    lecture, pas une donnée. On compare la forme, pas les mots.
    """
    chemin = chemin.rstrip("/.,;:")
    if not chemin.startswith("/api/v1") and not chemin.startswith("/r/"):
        chemin = "/api/v1" + chemin
    return re.sub(r"\{[^}]*\}", "{}", chemin)


def _cites() -> set[str]:
    texte = pathlib.Path(CARTE).read_text(encoding="utf-8")
    return {m.group(1) for m in CHEMIN.finditer(texte)}


def test_la_carte_existe_et_cite_des_routes() -> None:
    """Sans cette assertion, une carte vidée ou déplacée rendrait le fichier
    vert en n'ayant plus rien à comparer."""
    assert pathlib.Path(CARTE).exists()
    assert len(_cites()) > 60


def test_chaque_route_citee_existe() -> None:
    """**La garantie de ce fichier.**

    Une route citée et absente fait dessiner un écran contre du vide, et le
    défaut apparaît une semaine plus tard chez quelqu'un d'autre.
    """
    reelles = {_normaliser(chemin) for chemin in _routes_reelles()}
    inconnues = sorted(
        chemin
        for chemin in _cites()
        if chemin not in TOLERES and _normaliser(chemin) not in reelles
    )

    assert inconnues == [], (
        f"chemins cités par la carte de passation et inexistants : {inconnues}. "
        "Corriger la carte, ou l'écrire dans TOLERES avec sa raison."
    )


def test_les_tolerances_disent_pourquoi() -> None:
    """Une raison vide est une case cochée, pas une décision."""
    assert [nom for nom, raison in TOLERES.items() if not raison.strip()] == []
