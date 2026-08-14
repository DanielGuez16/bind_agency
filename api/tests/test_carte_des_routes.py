"""La carte de passation nomme des routes qui existent.

**Pourquoi ce fichier.** `design_handoff_bind/api-map.md` est ce sur quoi Claude
Design compose les écrans. Sa révision précédente datait de quarante PR plus
tôt : elle décrivait une quarantaine de routes sur cent dix-neuf, et **deux de
ses lignes nommaient des chemins qui n'ont jamais existé** — `POST
/merchant/pause`, et un arbitrage qui serait passé par la route du commerce.

Une carte périmée ne fait pas échouer de test : elle fait dessiner un écran
contre une route absente, et le défaut apparaît à l'intégration, une semaine
plus tard, chez quelqu'un d'autre.

**Le test vérifie les deux sens, et le second a été ajouté après coup.**

Il ne vérifiait d'abord que le premier : toute route citée doit exister. J'avais
écarté le second — toute route existante doit être citée — au motif qu'il ferait
tomber la CI à chaque route neuve avant qu'on ait eu le temps d'écrire ce
qu'elle sert.

C'était protéger la CI au prix d'une carte qui sous-décrit l'API, et cela a
coûté deux écrans : Claude Design en a composé deux en croyant absentes des
routes présentes depuis des semaines. Une route non citée est invisible, et
l'invisible se redemande ou se réinvente.

Le coût que je redoutais est réel mais petit : ajouter une route oblige à écrire
une ligne de carte dans la même PR. C'est le bon moment pour l'écrire — c'est le
seul où quelqu'un sait à quoi elle sert.
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
#: Chaque entrée dit pourquoi. Une liste qui s'allonge sans raison est le début
#: du contournement que ce test existe pour éviter.
TOLERES = {
    "/api/v1": "le préfixe lui-même, cité dans les conventions",
    "/admin": "un préfixe cité dans les conventions, pas une route",
    "/r/{slug}": "la redirection publique, montée hors du préfixe de version",
    # **Cité pour dire qu'il n'existe pas.** La carte ouvre sur un tableau des
    # corrections, et celle-ci nomme le chemin fautif à côté du bon. Le retirer
    # priverait le lecteur de ce qu'il doit désapprendre.
    "/merchant/pause": "cité dans le tableau des corrections comme n'ayant jamais existé",
}


#: Les routes que la carte n'a pas à décrire, et pourquoi.
#:
#: **La liste est courte et le restera.** Chaque exception est une route que
#: Claude Design ne verra jamais ; s'y glisse un jour une route d'écran, et
#: l'écran sera composé sans elle. Ajouter une entrée ici doit coûter une
#: phrase qu'on peut défendre.
HORS_CARTE = {
    "/api/v1/health": "sonde de déploiement : aucun écran ne la lit",
    "/api/v1/social-accounts/instagram/callback": (
        "rappel appelé par la plateforme, jamais par un écran"
    ),
    "/api/v1/social-accounts/tiktok/callback": "idem",
    "/api/v1/media/{cle:path}": (
        "servie à une balise d'image et non appelée : les écrans manipulent des"
        " clés, et la convention est décrite dans les conventions de la carte"
    ),
    "/api/v1/proofs/{proof_id}": (
        "idem : l'écran demande un droit de lecture, puis pose l'adresse rendue dans une balise"
    ),
    "/r/{slug}": "redirection publique ouverte hors de l'app, par un visiteur sans compte",
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


def test_chaque_route_existante_est_citee() -> None:
    """**Le second sens, et celui que la relecture ne voit pas.**

    Une route absente de la carte est une route invisible : Claude Design la
    redemande, ou compose l'écran sans elle. C'est arrivé deux fois — l'annuaire
    des créateurs et l'agrégat hebdomadaire des rapports étaient là depuis des
    semaines.
    """
    citees = {_normaliser(chemin) for chemin in _cites()}
    absentes = sorted(
        chemin
        for chemin in _routes_reelles()
        if chemin not in HORS_CARTE and _normaliser(chemin) not in citees
    )

    assert absentes == [], (
        f"routes servies et absentes de la carte de passation : {absentes}. "
        "Les y décrire — ce que l'écran en reçoit et les états qu'il doit rendre — "
        "ou les écrire dans HORS_CARTE avec leur raison."
    )


def test_les_exclusions_de_carte_disent_pourquoi() -> None:
    """Une raison vide est une case cochée, pas une décision."""
    assert [nom for nom, raison in HORS_CARTE.items() if not raison.strip()] == []


def test_les_exclusions_de_carte_servent_toutes_encore() -> None:
    """Une exclusion qui ne correspond plus à une route couvrirait un vrai oubli
    le jour où la route change de nom."""
    reelles = _routes_reelles()

    assert sorted(set(HORS_CARTE) - reelles) == []
