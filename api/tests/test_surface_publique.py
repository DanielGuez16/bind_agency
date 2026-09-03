"""La surface servie sans authentification, énumérée et fermée.

**Le défaut que ce fichier répare : rien n'inventoriait les routes publiques.**
Le produit en a quelques-unes, et chacune a sa raison — un salon qui prend sa
fiche en main n'a pas encore de compte, un visiteur qui clique sur un lien de
story n'en aura jamais. Mais rien n'empêchait qu'une quatrième le devienne par
accident, en oubliant une dépendance dans un routeur neuf. Une route d'écriture
ouverte par distraction ne se voit ni à la relecture ni à l'exécution : elle
marche.

**La liste est fermée et porte ses raisons.** Ajouter une route publique demande
d'écrire ici pourquoi elle l'est. C'est le seul moment où quelqu'un se posera la
question.

**Et le sens inverse compte autant.** Une route déclarée publique ici et qui ne
l'est plus doit faire tomber le test : une tolérance qui ne sert plus finit par
couvrir un vrai défaut le jour où le nom change.
"""

from fastapi.routing import APIRoute

from app.main import create_app

#: Les dépendances qui ferment une route. Leur nom, parce que c'est ce qu'on
#: peut lire d'un `Depends` : `current_user` identifie, les trois autres
#: autorisent. Une route qui n'en porte aucune est servie à qui la trouve.
GARDES = frozenset(
    {
        "current_user",
        # `require_role(...)` et `require_member_of(...)` rendent une fonction
        # interne ; c'est son nom qualifié qu'on lit.
        "require_role.<locals>.dependency",
        "require_business_member",
        "require_member_of.<locals>.dependency",
    }
)

#: Les routes servies sans authentification, et **pourquoi**.
#:
#: Chaque entrée est une décision qu'on peut défendre. Le jour où cette liste
#: s'allonge sans qu'on sache dire pourquoi, c'est qu'une dépendance a été
#: oubliée quelque part.
PUBLIQUES: dict[tuple[str, str], str] = {
    ("GET", "/api/v1/health"): "la sonde de déploiement, qui n'a pas de compte",
    ("POST", "/api/v1/auth/register"): "on ne demande pas de compte pour en créer un",
    ("POST", "/api/v1/auth/login"): "idem",
    ("POST", "/api/v1/auth/refresh"): "le jeton de rafraîchissement fait l'autorisation",
    ("GET", "/api/v1/auth/verify-email"): (
        "le lien s'ouvre depuis une boîte mail, dans un navigateur qui n'a "
        "aucune session. C'est le jeton du courriel qui fait l'autorisation, "
        "et il est à usage unique — exiger un compte connecté pour confirmer "
        "une adresse demanderait de se connecter avant de pouvoir se servir"
    ),
    ("POST", "/api/v1/auth/logout"): (
        "se déconnecter doit marcher même avec un jeton d'accès expiré ; "
        "l'inverse laisserait quelqu'un connecté sur un téléphone rendu"
    ),
    ("GET", "/api/v1/media/{cle:path}"): (
        "les photos publiques des salons, servies à une balise d'image, "
        "laquelle ne porte pas d'en-tête d'autorisation"
    ),
    ("GET", "/api/v1/assets/{nom}"): (
        "le logo des emails, servi à une balise <img> dans un client de "
        "messagerie, qui ne porte pas non plus d'en-tête d'autorisation"
    ),
    ("GET", "/r/{slug}"): (
        "la redirection d'un lien de story : le visiteur qui clique n'a pas de "
        "compte BIND et n'en aura jamais"
    ),
    ("GET", "/api/v1/handover/{jeton}"): (
        "le salon qui prend sa fiche en main n'a pas encore de compte — "
        "c'est le jeton qui autorise, et lui seul"
    ),
    ("POST", "/api/v1/handover/{jeton}/claim"): "idem : c'est l'appel qui crée son compte",
    ("GET", "/api/v1/social-accounts/instagram/callback"): (
        "c'est la plateforme qui appelle, pas le créateur : elle ne porte aucun "
        "jeton de session. L'état signé fait l'autorisation, et il expire"
    ),
    ("GET", "/api/v1/social-accounts/tiktok/callback"): "idem",
    ("GET", "/api/v1/proofs/{proof_id}"): (
        "l'objet se sert à une balise d'image, qui ne porte pas d'en-tête "
        "d'autorisation. Le droit voyage donc dans l'adresse : un jeton court, "
        "lié à cette preuve-là, obtenu par une route authentifiée — "
        "`/proofs/{{proof_id}}/access`, qui vérifie l'appartenance"
    ),
}


def _gardes(route: APIRoute) -> set[str]:
    """Toutes les dépendances de la route, transitivement.

    Transitivement, parce qu'une garde peut se cacher sous une autre :
    `current_business` dépend de `require_business_member`, et une route qui ne
    déclare que la première est pourtant fermée.
    """
    noms: set[str] = set()
    pile = list(route.dependant.dependencies)
    while pile:
        dependance = pile.pop()
        if dependance.call is not None:
            noms.add(getattr(dependance.call, "__qualname__", str(dependance.call)))
        pile.extend(dependance.dependencies)
    return noms


def _routes() -> list[tuple[str, str, APIRoute]]:
    """Chaque route de l'application, méthode par méthode.

    **L'arbre se parcourt, il ne se lit pas à plat.** `app.routes` ne rend plus
    des `APIRoute` mais des routeurs inclus, qui portent leur routeur d'origine
    et le préfixe sous lequel il a été monté. Lire `app.routes` directement rend
    une liste vide — et un test qui n'inspecte rien passe.
    """
    trouvees: list[tuple[str, str, APIRoute]] = []

    def parcourir(routeur, prefixe: str) -> None:
        for route in getattr(routeur, "routes", []):
            if isinstance(route, APIRoute):
                for methode in sorted(route.methods - {"HEAD", "OPTIONS"}):
                    trouvees.append((methode, prefixe + route.path, route))
                continue
            origine = getattr(route, "original_router", None)
            if origine is not None:
                contexte = getattr(route, "include_context", None)
                parcourir(origine, prefixe + (getattr(contexte, "prefix", "") or ""))

    parcourir(create_app(), "")
    return trouvees


ROUTES = _routes()


def test_il_y_a_bien_des_routes_a_inspecter() -> None:
    """Sans cette assertion, un parcours qui ne trouve plus rien rendrait le
    reste du fichier vert en n'inspectant aucune route.

    C'est arrivé à la première écriture : `app.routes` rendait des routeurs
    inclus et non des routes, la liste était vide, et tout passait.
    """
    assert len(ROUTES) > 80


def test_aucune_route_publique_qui_ne_soit_declaree() -> None:
    """**La garantie de ce fichier.**

    Une route d'écriture ouverte par distraction ne se voit ni à la relecture ni
    à l'exécution : elle marche. Elle se voit ici, et seulement ici.
    """
    ouvertes = {
        (methode, chemin) for methode, chemin, route in ROUTES if not (_gardes(route) & GARDES)
    }

    assert ouvertes <= set(PUBLIQUES), (
        "routes servies sans authentification et non déclarées : "
        f"{sorted(ouvertes - set(PUBLIQUES))}. "
        "Si c'est voulu, l'écrire dans PUBLIQUES avec sa raison."
    )


def test_les_declarations_servent_toutes_encore() -> None:
    """Une tolérance qui ne sert plus est une exception qu'on croit justifiée.

    Elle finit par couvrir un vrai défaut le jour où la route change de nom.
    """
    ouvertes = {
        (methode, chemin) for methode, chemin, route in ROUTES if not (_gardes(route) & GARDES)
    }

    assert set(PUBLIQUES) <= ouvertes, (
        f"déclarées publiques mais fermées ou disparues : {sorted(set(PUBLIQUES) - ouvertes)}"
    )


def test_chaque_route_publique_dit_pourquoi() -> None:
    """Une raison vide est une case cochée, pas une décision."""
    sans_raison = [route for route, raison in PUBLIQUES.items() if not raison.strip()]

    assert sans_raison == []
