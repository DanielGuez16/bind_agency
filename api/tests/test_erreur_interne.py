"""Un 500 sort par la porte, pas par le mur.

**Le défaut que ce fichier garde a coûté trois campagnes de test.** Une exception
non rattrapée remonte jusqu'à `ServerErrorMiddleware`, qui est *au-dessus* de
`CORSMiddleware` : sa réponse ne porte donc aucun en-tête d'origine. Le
navigateur n'y voit pas un 500 — il y voit une violation de CORS.

Trois fois, l'enquête est partie du mauvais côté : on a cherché une origine mal
configurée pendant que la vraie erreur dormait dans le journal du serveur. La
troisième fois, le rapport de campagne disait lui-même « le CORS est
probablement le symptôme d'une erreur serveur », ce qui est le signe qu'un outil
ment assez souvent pour qu'on cesse de le croire.

**Ce qu'on garde ici** : une exception produit un 500 lisible, avec ses en-têtes,
et **sans laisser fuir son message**.
"""

import pytest
from fastapi import APIRouter
from httpx import ASGITransport, AsyncClient

from app.core.config import get_settings
from app.main import create_app

PREFIX = get_settings().api_v1_prefix
ORIGINE = "http://localhost:8081"


class _RequeteFactice:
    """Le strict nécessaire : l'intercepteur ne lit que le chemin."""

    url = type("Url", (), {"path": "/sonde"})()


@pytest.fixture
def application_qui_leve():
    """Une application réelle, plus une route qui échoue.

    La route est ajoutée ici et non dans le code de production : celui-ci n'a
    pas à porter un point d'entrée qui casse. Tout le reste — middlewares,
    gestionnaires, ordre — est celui qui sert.
    """
    app = create_app()
    routeur = APIRouter()

    @routeur.get("/sonde-qui-leve")
    async def _lever() -> dict:
        raise RuntimeError("mot de passe = correct-horse-battery-staple")

    app.include_router(routeur, prefix=PREFIX)
    return app


async def _appeler(app, chemin: str):
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get(chemin, headers={"Origin": ORIGINE})


async def test_un_500_porte_ses_entetes_d_origine(application_qui_leve) -> None:
    """**La garantie de ce fichier.**

    Sans en-tête, le navigateur annonce une violation de CORS et l'appelant
    cherche la panne du mauvais côté.
    """
    reponse = await _appeler(application_qui_leve, f"{PREFIX}/sonde-qui-leve")

    assert reponse.status_code == 500
    assert reponse.headers.get("access-control-allow-origin") == ORIGINE


async def test_un_500_dit_un_code_du_catalogue(application_qui_leve) -> None:
    """`internal_error`, c'est peu — mais c'est vrai, et l'app sait le traduire."""
    reponse = await _appeler(application_qui_leve, f"{PREFIX}/sonde-qui-leve")

    assert reponse.json() == {"detail": "internal_error"}


async def test_un_500_ne_laisse_rien_fuir(application_qui_leve) -> None:
    """Le message d'une exception porte régulièrement une requête SQL, un
    identifiant, parfois une valeur reçue. Rien de tout cela ne sort."""
    reponse = await _appeler(application_qui_leve, f"{PREFIX}/sonde-qui-leve")

    assert "correct-horse-battery-staple" not in reponse.text
    assert "RuntimeError" not in reponse.text
    assert "Traceback" not in reponse.text


async def test_la_trace_part_bien_au_journal(monkeypatch) -> None:
    """**Sans elle, on aurait échangé un mur contre un silence.**

    Rendre un 500 propre et jeter la cause laisserait l'appelant avec un code et
    personne avec la raison.

    Éprouvé en remplaçant le journal du module, et non en collectant des
    enregistrements : sous pytest, l'enregistrement n'arrive ni à `caplog` ni à
    un collecteur posé sur le logger — hors pytest il arrive, ce qui rend une
    assertion sur la collecte verte ou rouge selon le harnais et non selon le
    code. Ce qu'on affirme ici est ce que la fonction fait : elle appelle
    `logger.exception`, avec un message, sur le chemin en cause.
    """
    from app import main as module

    appels: list[tuple[str, dict]] = []

    class JournalFactice:
        def exception(self, message: str, **reste: object) -> None:
            appels.append((message, reste))

    monkeypatch.setattr(module, "logger", JournalFactice())

    async def qui_leve(_):
        raise RuntimeError("correct-horse-battery-staple")

    reponse = await module._intercepter_les_erreurs(_RequeteFactice(), qui_leve)

    assert reponse.status_code == 500
    assert appels == [("erreur non rattrapée", {"extra": {"chemin": "/sonde"}})]


async def test_une_route_saine_repond_toujours(application_qui_leve) -> None:
    """Le sens qui passe. Un gestionnaire qui transformerait tout en 500 ferait
    passer les trois tests précédents en cassant le produit entier."""
    reponse = await _appeler(application_qui_leve, f"{PREFIX}/health")

    assert reponse.status_code == 200
    assert reponse.headers.get("access-control-allow-origin") == ORIGINE
