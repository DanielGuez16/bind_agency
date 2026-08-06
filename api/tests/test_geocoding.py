"""Géocodage réel.

Aucun appel réseau : le fournisseur est éprouvé sur un transport simulé.

La propriété qui compte n'est pas « on sait lire un JSON », c'est **ce qui
arrive quand la résolution rate**. Un échec de géocodage ne doit jamais bloquer
une inscription : perdre un commerce parce que Geocodio est en panne serait le
perdre pour une raison qui ne le regarde pas. Et une résolution imprécise est
refusée comme une absence, parce qu'un commerce placé au mauvais endroit
apparaît dans le mauvais fil sans que personne ne s'en aperçoive.
"""

import httpx
import pytest

from app.core.config import ConfigurationError, build_settings, get_settings
from app.integrations.geocoding import (
    Coordinates,
    GeocodioGeocoder,
    ManualGeocoder,
    check_geocoder_configuration,
)

MIAMI = {"lat": 25.7617, "lng": -80.1918}


@pytest.fixture
def geocodio_configure(monkeypatch: pytest.MonkeyPatch):
    from app.core import encryption
    from app.integrations import geocoding as module

    reglages = build_settings(
        _env_file=None,
        database_url=str(get_settings().database_url),
        jwt_secret_key="peu-importe-ici-mais-assez-longue-pour-hmac",
        token_encryption_key=encryption.generate_key(),
        geocoding_provider="geocodio",
        geocoding_api_key="une-cle-geocodio",
    )
    monkeypatch.setattr(module, "get_settings", lambda: reglages)
    return reglages


def transport(reponse: httpx.Response) -> httpx.MockTransport:
    appels: list[httpx.Request] = []

    def repondre(request: httpx.Request) -> httpx.Response:
        appels.append(request)
        return reponse

    t = httpx.MockTransport(repondre)
    t.appels = appels  # type: ignore[attr-defined]
    return t


def resultat(*, accuracy: float = 0.95, location: dict | None = MIAMI) -> httpx.Response:
    ligne: dict = {"accuracy": accuracy, "accuracy_type": "rooftop"}
    if location is not None:
        ligne["location"] = location
    return httpx.Response(200, json={"results": [ligne]})


async def resoudre(reponse: httpx.Response, adresse: str = "1234 Ocean Dr, Miami Beach FL"):
    t = transport(reponse)
    async with httpx.AsyncClient(transport=t) as http:
        return await GeocodioGeocoder(http).locate(adresse), t


# --------------------------------------------------------------------------
# configuration
# --------------------------------------------------------------------------


def test_geocodio_sans_cle_empeche_de_demarrer(monkeypatch: pytest.MonkeyPatch) -> None:
    """Découvrir au premier commerce créé que la clé manque signifierait un
    commerce placé nulle part, et personne pour s'en apercevoir."""
    from app.integrations import geocoding as module

    reglages = build_settings(
        _env_file=None,
        database_url=str(get_settings().database_url),
        jwt_secret_key="peu-importe-ici-mais-assez-longue-pour-hmac",
        token_encryption_key="x" * 43 + "=",
        geocoding_provider="geocodio",
    )
    monkeypatch.setattr(module, "get_settings", lambda: reglages)

    with pytest.raises(ConfigurationError, match="GEOCODING_API_KEY"):
        check_geocoder_configuration()


def test_le_mode_manuel_ne_demande_rien(monkeypatch: pytest.MonkeyPatch) -> None:
    """Le pendant : la configuration par défaut doit démarrer sans clé, sinon
    ni les tests ni le jeu de données ne tourneraient."""
    check_geocoder_configuration()


async def test_le_geocodeur_manuel_rend_ce_qu_on_lui_donne() -> None:
    declarees = Coordinates(longitude=-80.1918, latitude=25.7617)
    manuel = ManualGeocoder()

    assert await manuel.locate("une adresse", declared=declarees) == declarees
    assert await manuel.locate("une adresse") is None


# --------------------------------------------------------------------------
# résolution
# --------------------------------------------------------------------------


async def test_une_adresse_resolue_rend_ses_coordonnees(geocodio_configure) -> None:
    coordonnees, t = await resoudre(resultat())

    assert coordonnees == Coordinates(longitude=-80.1918, latitude=25.7617)
    assert t.appels[0].url.params["q"] == "1234 Ocean Dr, Miami Beach FL"
    # La clé part en paramètre, pas en en-tête : c'est ce qu'attend Geocodio.
    assert t.appels[0].url.params["api_key"] == "une-cle-geocodio"


async def test_des_coordonnees_declarees_l_emportent(geocodio_configure) -> None:
    """Un commerce qui s'est placé lui-même sait mieux que nous où il est. Sans
    cette priorité, corriger une résolution fausse serait impossible."""
    declarees = Coordinates(longitude=-80.19, latitude=25.79)
    t = transport(resultat())

    async with httpx.AsyncClient(transport=t) as http:
        obtenues = await GeocodioGeocoder(http).locate("une adresse", declared=declarees)

    assert obtenues == declarees
    # Et l'appel n'a pas eu lieu : on ne paie pas pour une réponse qu'on ignore.
    assert t.appels == []


# --------------------------------------------------------------------------
# ce qui arrive quand ça rate
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("cas", "reponse"),
    [
        ("aucun résultat", httpx.Response(200, json={"results": []})),
        ("réponse illisible", httpx.Response(200, text="pas du json")),
        ("clé refusée", httpx.Response(403, json={"error": "invalid api key"})),
        ("quota dépassé", httpx.Response(429, json={"error": "over quota"})),
        ("panne du fournisseur", httpx.Response(503, text="down")),
        ("résultat sans coordonnées", resultat(location=None)),
    ],
)
async def test_un_echec_de_resolution_rend_none_sans_lever(
    cas: str, reponse: httpx.Response, geocodio_configure
) -> None:
    """Aucun de ces cas n'est une erreur métier. Le commerce reste en
    onboarding, son inscription aboutit."""
    coordonnees, _ = await resoudre(reponse)
    assert coordonnees is None, cas


async def test_le_reseau_coupe_ne_leve_pas(geocodio_configure) -> None:
    def couper(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connexion refusée", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(couper)) as http:
        assert await GeocodioGeocoder(http).locate("une adresse") is None


async def test_une_resolution_imprecise_est_refusee(geocodio_configure) -> None:
    """Un commerce placé à quarante kilomètres apparaîtrait dans le mauvais fil.
    L'absence se voit, l'erreur non."""
    sous_le_seuil, _ = await resoudre(resultat(accuracy=0.3))
    assert sous_le_seuil is None

    # Le pendant : un seuil qui refuserait tout passerait le test précédent
    # sans rien garantir.
    au_dessus, _ = await resoudre(resultat(accuracy=0.9))
    assert au_dessus is not None


async def test_une_adresse_vide_n_appelle_personne(geocodio_configure) -> None:
    t = transport(resultat())
    async with httpx.AsyncClient(transport=t) as http:
        geocodeur = GeocodioGeocoder(http)
        assert await geocodeur.locate(None) is None
        assert await geocodeur.locate("   ") is None

    assert t.appels == []
