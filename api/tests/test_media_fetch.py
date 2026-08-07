"""Récupération d'un média depuis une URL publique — niveau 2 de la preuve.

**C'est la seule fonction du produit qui va chercher une adresse fournie par un
tiers.** Sans garde-fous, elle transforme le serveur en client au service de qui
veut : falsification de requête côté serveur, et accès à ce que le réseau
interne expose — métadonnées d'hébergeur, bases sans mot de passe, API
d'administration.

Chaque garde-fou est éprouvé **dans les deux sens**. Un test qui ne constate
qu'un refus passe aussi bien sur une fonction qui refuse tout, et une fonction
qui refuse tout n'aurait jamais permis de découvrir qu'elle est cassée.

Le contournement le plus intéressant est celui des **redirections** : l'URL de
départ est irréprochable, la redirection ne l'est pas. C'est pour cela qu'elles
sont suivies à la main, une par une, avec revérification à chaque saut.
"""

import httpx
import pytest

from app.core.config import get_settings
from app.integrations import media_fetch
from app.integrations.media_fetch import AdresseRefusee, MediaFetchError

PIXEL = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def _client(gestionnaire) -> httpx.AsyncClient:
    """Un client dont le transport est une fonction : aucun réseau touché."""
    return httpx.AsyncClient(
        transport=httpx.MockTransport(gestionnaire), follow_redirects=False, timeout=2.0
    )


def _reponse(
    contenu: bytes = PIXEL, *, type_media: str = "image/png", status: int = 200, entetes=None
) -> httpx.Response:
    return httpx.Response(
        status,
        content=contenu,
        headers={"content-type": type_media, **(entetes or {})},
    )


# --------------------------------------------------------------------------
# adresses
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/media.png",
        "http://localhost/media.png",
        # Métadonnées d'hébergeur : la cible classique, et la seule qui suffise
        # à faire fuiter des identifiants de production.
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.5/media.png",
        "http://192.168.1.10/media.png",
        "http://172.16.0.1/media.png",
        "http://[::1]/media.png",
        # IPv4 mappée en IPv6 : ni privée ni de bouclage aux yeux d'`ipaddress`
        # tant qu'on ne la déballe pas. Exactement la forme qu'un contournement
        # prendrait.
        "http://[::ffff:127.0.0.1]/media.png",
        "http://0.0.0.0/media.png",
    ],
)
def test_les_adresses_internes_sont_refusees(url: str) -> None:
    with pytest.raises(AdresseRefusee):
        media_fetch.verifier_l_url(url)


def test_une_adresse_publique_passe() -> None:
    """Le pendant. Sans lui, une fonction qui refuse tout passerait tout ce qui
    précède sans rien garantir."""
    media_fetch.verifier_l_url("http://93.184.216.34/media.png")


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "gopher://127.0.0.1:6379/_INFO",
        "ftp://example.com/media.png",
        "data:image/png;base64,AAAA",
    ],
)
def test_les_schemas_hors_http_sont_refuses(url: str) -> None:
    with pytest.raises(AdresseRefusee):
        media_fetch.verifier_l_url(url)


# --------------------------------------------------------------------------
# redirections
# --------------------------------------------------------------------------


async def test_une_redirection_vers_le_reseau_interne_est_refusee() -> None:
    """Le contournement classique : le départ est propre, l'arrivée ne l'est pas.

    Laisser le client HTTP suivre les redirections ne contrôlerait que la
    première adresse — c'est-à-dire précisément celle qui est irréprochable.
    """

    def gestionnaire(requete: httpx.Request) -> httpx.Response:
        if requete.url.host == "93.184.216.34":
            return httpx.Response(302, headers={"location": "http://169.254.169.254/creds"})
        return _reponse()

    with pytest.raises(MediaFetchError):
        await media_fetch.recuperer("http://93.184.216.34/media.png", client=_client(gestionnaire))


async def test_une_redirection_vers_une_adresse_publique_aboutit() -> None:
    """Le pendant : les redirections ne sont pas interdites, elles sont vérifiées."""
    appels: list[str] = []

    def gestionnaire(requete: httpx.Request) -> httpx.Response:
        appels.append(str(requete.url))
        if requete.url.host == "93.184.216.34":
            return httpx.Response(302, headers={"location": "http://93.184.216.35/final.png"})
        return _reponse()

    media = await media_fetch.recuperer(
        "http://93.184.216.34/media.png", client=_client(gestionnaire)
    )

    assert media.contenu == PIXEL
    assert media.url_finale == "http://93.184.216.35/final.png"
    assert len(appels) == 2


async def test_une_boucle_de_redirections_s_arrete() -> None:
    def gestionnaire(requete: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "http://93.184.216.34/encore"})

    with pytest.raises(MediaFetchError, match="redirections"):
        await media_fetch.recuperer("http://93.184.216.34/media.png", client=_client(gestionnaire))


async def test_une_redirection_relative_se_resout_sur_l_url_courante() -> None:
    """Et non sur celle de départ : sinon deux sauts relatifs viseraient la
    mauvaise adresse, et la vérification porterait sur autre chose que ce qui
    est réellement demandé."""
    vues: list[str] = []

    def gestionnaire(requete: httpx.Request) -> httpx.Response:
        vues.append(str(requete.url))
        if requete.url.path == "/a/depart.png":
            return httpx.Response(302, headers={"location": "arrivee.png"})
        return _reponse()

    await media_fetch.recuperer("http://93.184.216.34/a/depart.png", client=_client(gestionnaire))
    assert vues[-1] == "http://93.184.216.34/a/arrivee.png"


# --------------------------------------------------------------------------
# taille et type
# --------------------------------------------------------------------------


async def test_la_taille_est_verifiee_pendant_la_lecture() -> None:
    """`Content-Length` est déclaratif : un serveur hostile annonce mille octets
    puis en envoie dix gigaoctets. C'est la lecture qui décide."""
    settings = get_settings()
    trop = b"\x89PNG\r\n\x1a\n" + b"\x00" * (settings.proof_fetch_max_bytes + 1)

    def gestionnaire(requete: httpx.Request) -> httpx.Response:
        # Annonce honnête impossible : on ment volontairement, comme le ferait
        # un serveur qui cherche à passer.
        return _reponse(trop, entetes={"content-length": "42"})

    with pytest.raises(MediaFetchError, match="volumineux"):
        await media_fetch.recuperer("http://93.184.216.34/media.png", client=_client(gestionnaire))


async def test_une_taille_annoncee_trop_grande_est_refusee_tot() -> None:
    """Inutile de télécharger quinze mégaoctets quand l'annonce suffit."""
    settings = get_settings()

    def gestionnaire(requete: httpx.Request) -> httpx.Response:
        return _reponse(PIXEL, entetes={"content-length": str(settings.proof_fetch_max_bytes + 1)})

    with pytest.raises(MediaFetchError, match="annoncé"):
        await media_fetch.recuperer("http://93.184.216.34/media.png", client=_client(gestionnaire))


@pytest.mark.parametrize("type_media", ["text/html", "application/json", ""])
async def test_les_types_hors_liste_sont_refuses(type_media: str) -> None:
    def gestionnaire(requete: httpx.Request) -> httpx.Response:
        return _reponse(b"<html>", type_media=type_media)

    with pytest.raises(MediaFetchError, match="type"):
        await media_fetch.recuperer("http://93.184.216.34/media.png", client=_client(gestionnaire))


async def test_les_types_de_la_liste_passent() -> None:
    """Le pendant. La liste vient de la configuration : la figer ici en ferait
    une seconde vérité."""
    settings = get_settings()
    for type_media in settings.proof_fetch_allowed_types:

        def gestionnaire(requete: httpx.Request, attendu=type_media) -> httpx.Response:
            return _reponse(PIXEL, type_media=attendu)

        media = await media_fetch.recuperer(
            "http://93.184.216.34/media.png", client=_client(gestionnaire)
        )
        assert media.content_type == type_media


async def test_un_media_vide_est_refuse() -> None:
    """Zéro octet archivé serait une preuve qui ne prouve rien."""

    def gestionnaire(requete: httpx.Request) -> httpx.Response:
        return _reponse(b"")

    with pytest.raises(MediaFetchError, match="vide"):
        await media_fetch.recuperer("http://93.184.216.34/media.png", client=_client(gestionnaire))


async def test_une_erreur_du_serveur_distant_est_une_erreur() -> None:
    def gestionnaire(requete: httpx.Request) -> httpx.Response:
        return _reponse(b"", status=404)

    with pytest.raises(MediaFetchError):
        await media_fetch.recuperer("http://93.184.216.34/media.png", client=_client(gestionnaire))
