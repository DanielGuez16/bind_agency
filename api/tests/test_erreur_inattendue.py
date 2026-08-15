"""Un 500 reste une réponse, et le navigateur doit pouvoir la lire.

**Ce que ça répare.** Une exception non rattrapée remontait jusqu'à uvicorn, qui
répond `Internal Server Error` en texte brut, hors de toute la pile
d'intergiciels — donc sans en-tête CORS. Le navigateur ne voyait plus une
réponse mais une origine interdite, `fetch` levait `TypeError: Failed to fetch`,
et l'app affichait « réessayez dans un instant ». Le fil créateur est resté
bloqué une journée sur cette phrase pendant qu'on cherchait du côté des jetons.

**Les trois choses éprouvées, dans l'ordre d'importance.**

1. La réponse porte l'en-tête CORS. C'est *elle* qui manquait ; sans elle,
   l'app ne voit pas de réponse du tout et ne peut rien dire de juste.
2. Le corps porte un code du catalogue, que l'app sait traduire. Un corps en
   texte brut donnerait le message générique et perdrait la nature de la panne.
3. Aucune trace d'appels ne part vers l'appelant : elle nomme des fichiers, des
   tables et des versions.

**L'intergiciel est éprouvé sur une application montée ici, pas sur la vraie.**
Provoquer une exception dans une vraie route demanderait de casser un service,
et le test dirait alors autant de choses sur ce service que sur l'intergiciel.
Une route qui ne fait que lever isole ce qu'on veut vérifier.
"""

import logging

import httpx
import pytest
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.main import ErreurInattendueEnJson

ORIGINE = "https://app.exemple.test"
SECRET = "mot de passe de la base : hunter2"


class _Collecteur(logging.Handler):
    """Garde les enregistrements tels quels, sans les formater."""

    def __init__(self) -> None:
        super().__init__()
        self.enregistrements: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.enregistrements.append(record)


def _application() -> FastAPI:
    """La même composition que `create_app` : l'intergiciel d'abord, CORS ensuite."""
    application = FastAPI()
    application.add_middleware(ErreurInattendueEnJson)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[ORIGINE],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @application.get("/boum")
    async def boum() -> None:
        raise RuntimeError(SECRET)

    @application.get("/calme")
    async def calme() -> dict[str, bool]:
        return {"ok": True}

    return application


@pytest.fixture
async def client() -> httpx.AsyncClient:
    transport = httpx.ASGITransport(app=_application(), raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def test_un_500_porte_l_en_tete_cors(client: httpx.AsyncClient) -> None:
    """**Le cœur du correctif.** Sans cet en-tête, le navigateur jette la
    réponse et l'app croit à une panne de réseau."""
    reponse = await client.get("/boum", headers={"Origin": ORIGINE})

    assert reponse.status_code == 500
    assert reponse.headers.get("access-control-allow-origin") == ORIGINE


async def test_un_500_porte_un_code_du_catalogue(client: httpx.AsyncClient) -> None:
    """`internal_error` est traduit dans les deux langues de l'app. Un corps en
    texte brut lui ferait afficher le message générique."""
    reponse = await client.get("/boum", headers={"Origin": ORIGINE})

    assert reponse.headers["content-type"].startswith("application/json")
    assert reponse.json() == {"detail": "internal_error"}


async def test_la_trace_ne_part_pas_vers_l_appelant(client: httpx.AsyncClient) -> None:
    """Le message de l'exception nomme ici un secret ; la réponse ne doit en
    porter aucune trace, pas plus que le nom du fichier qui a levé."""
    reponse = await client.get("/boum", headers={"Origin": ORIGINE})

    assert SECRET not in reponse.text
    assert "RuntimeError" not in reponse.text
    assert "Traceback" not in reponse.text


async def test_l_exception_est_journalisee_entiere(client: httpx.AsyncClient) -> None:
    """Taire la réponse ne doit pas taire la panne : sans cette trace côté
    serveur, un 500 muet ne se diagnostique plus du tout.

    **Un collecteur posé à la main plutôt que `caplog`.** La fixture ne capture
    rien dans cette suite — vérifié sur un `logging.error` direct, synchrone,
    hors de tout intergiciel : zéro enregistrement. Un test écrit dessus serait
    passé vert le jour où le journal disparaîtrait.
    """
    collecteur = _Collecteur()
    journal = logging.getLogger("app.main")
    journal.addHandler(collecteur)
    try:
        await client.get("/boum", headers={"Origin": ORIGINE})
    finally:
        journal.removeHandler(collecteur)

    assert [e.getMessage() for e in collecteur.enregistrements] == [
        "exception non rattrapée sur GET /boum"
    ]
    # Le formatage est explicite : `exc_text` reste nul tant qu'aucun formateur
    # n'est passé, et l'assertion aurait échoué sur un journal pourtant complet.
    trace = logging.Formatter().format(collecteur.enregistrements[0])
    assert SECRET in trace
    assert "RuntimeError" in trace


async def test_une_reponse_normale_traverse_sans_changer(client: httpx.AsyncClient) -> None:
    """**La contrainte se teste dans les deux sens.** Un intergiciel qui
    répondrait 500 à tout passerait les quatre tests ci-dessus sans rien
    garantir."""
    reponse = await client.get("/calme", headers={"Origin": ORIGINE})

    assert reponse.status_code == 200
    assert reponse.json() == {"ok": True}
    assert reponse.headers.get("access-control-allow-origin") == ORIGINE
