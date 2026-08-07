"""Récupération d'un média depuis une URL publique — niveau 2 de la preuve.

**L'URL vient d'un tiers.** C'est la seule fonction du produit qui prend une
adresse fournie par un utilisateur et va la chercher. Sans garde-fous, elle
transforme le serveur en client au service de qui veut : c'est la falsification
de requête côté serveur, et elle se paie en accès à ce que le réseau interne
expose — métadonnées d'hébergeur, bases sans mot de passe, API d'administration.

Les cinq garde-fous, et ce que chacun empêche :

1. **Schéma limité à `http` et `https`.** Sans cela, `file:///etc/passwd` et
   `gopher://` deviennent des lectures locales.
2. **Refus des adresses privées, de bouclage, lien-local et réservées** — y
   compris IPv6 et les adresses IPv4 mappées en IPv6. C'est le cœur : un nom de
   domaine public peut parfaitement résoudre vers `169.254.169.254`.
3. **Refus des redirections vers ces adresses.** C'est le contournement
   classique : l'URL de départ est irréprochable, la redirection ne l'est pas.
   On suit les redirections **soi-même**, une par une, en revérifiant à chaque
   saut. Laisser le client HTTP les suivre reviendrait à ne contrôler que la
   première.
4. **Taille maximale, appliquée pendant le téléchargement.** Se fier à
   `Content-Length` ne protège de rien : il est déclaratif, et un serveur
   hostile annonce mille octets puis en envoie dix gigaoctets.
5. **Types acceptés, et délai maximal.** Une liste fermée, et un délai qui
   couvre l'ensemble de l'échange, pas chaque lecture.

Aucune de ces limites n'est écrite dans le code : elles viennent de la
configuration, parce qu'une limite qu'on ne peut pas régler sans redéployer
finit par être contournée dans l'urgence.
"""

import ipaddress
import socket
from dataclasses import dataclass

import httpx

from app.core.config import get_settings

SCHEMAS_AUTORISES = frozenset({"http", "https"})


class MediaFetchError(Exception):
    """La récupération n'a pas abouti. Jamais un refus métier."""


class AdresseRefusee(MediaFetchError):
    """L'URL vise le réseau interne, directement ou par redirection."""


@dataclass(frozen=True, slots=True)
class MediaRecupere:
    contenu: bytes
    content_type: str
    #: L'URL réellement atteinte, après redirections. Conservée parce qu'elle
    #: peut différer de celle qu'on a demandée, et que c'est elle qui atteste.
    url_finale: str


def _est_publique(adresse: str) -> bool:
    """Vrai si l'adresse IP est routable sur l'Internet public.

    On refuse tout le reste, et non seulement les plages privées : les adresses
    de bouclage, lien-local, multicast et réservées sont autant de portes vers
    des services qui ne s'attendent pas à recevoir une requête.
    """
    try:
        ip = ipaddress.ip_address(adresse)
    except ValueError:
        return False

    # Une IPv4 mappée en IPv6 — `::ffff:127.0.0.1` — n'est ni privée ni de
    # bouclage aux yeux d'`ipaddress` tant qu'on ne la déballe pas. C'est
    # exactement la forme qu'un contournement prendrait.
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped

    return not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def _resoudre(hote: str) -> list[str]:
    """Toutes les adresses derrière un nom, IPv4 et IPv6."""
    try:
        infos = socket.getaddrinfo(hote, None)
    except OSError as error:
        raise MediaFetchError(f"nom introuvable : {hote}") from error
    return [info[4][0] for info in infos]


def verifier_l_url(url: str) -> None:
    """Refuse tout ce qui ne vise pas l'Internet public.

    **Toutes** les adresses du nom sont vérifiées, pas la première : un nom qui
    résout vers une adresse publique et une adresse interne serait accepté sur
    la publique puis atteint sur l'interne, selon l'ordre que le résolveur
    choisit à cet instant.
    """
    decoupee = httpx.URL(url)

    if decoupee.scheme not in SCHEMAS_AUTORISES:
        raise AdresseRefusee(f"schéma refusé : {decoupee.scheme}")

    hote = decoupee.host
    if not hote:
        raise AdresseRefusee("URL sans hôte")

    for adresse in _resoudre(hote):
        if not _est_publique(adresse):
            raise AdresseRefusee(f"adresse non publique : {hote} → {adresse}")


async def recuperer(url: str, *, client: httpx.AsyncClient | None = None) -> MediaRecupere:
    """Télécharge le média, ou lève.

    Les redirections sont suivies **à la main**, une par une, avec une
    revérification de l'adresse à chaque saut. C'est la seule façon de tenir la
    promesse : laisser `httpx` les suivre ne contrôlerait que la première.
    """
    settings = get_settings()
    if not settings.proof_fetch_enabled:
        raise MediaFetchError("récupération par URL désactivée par configuration")

    ferme = client is None
    client = client or httpx.AsyncClient(
        follow_redirects=False, timeout=settings.proof_fetch_timeout_seconds
    )

    try:
        courante = url
        for _ in range(settings.proof_fetch_max_redirects + 1):
            verifier_l_url(courante)
            reponse = await client.get(courante, follow_redirects=False)

            if reponse.is_redirect:
                suivante = reponse.headers.get("location")
                if not suivante:
                    raise MediaFetchError("redirection sans destination")
                # Une redirection relative se résout sur l'URL courante, pas
                # sur celle de départ.
                courante = str(httpx.URL(courante).join(suivante))
                await reponse.aclose()
                continue

            return await _lire(reponse, courante, settings)

        raise MediaFetchError("trop de redirections")
    except httpx.HTTPError as error:
        raise MediaFetchError(str(error)) from error
    finally:
        if ferme:
            await client.aclose()


async def _lire(reponse: httpx.Response, url: str, settings) -> MediaRecupere:
    if reponse.status_code >= 400:
        raise MediaFetchError(f"réponse {reponse.status_code}")

    # Le type d'abord : inutile de télécharger quinze mégaoctets de HTML.
    content_type = (reponse.headers.get("content-type") or "").split(";")[0].strip().lower()
    if content_type not in settings.proof_fetch_allowed_types:
        raise MediaFetchError(f"type refusé : {content_type or 'absent'}")

    # `Content-Length` sert à refuser tôt quand il est honnête. Il ne sert à
    # rien d'autre : c'est une déclaration, pas une garantie.
    annonce = reponse.headers.get("content-length")
    if annonce and annonce.isdigit() and int(annonce) > settings.proof_fetch_max_bytes:
        raise MediaFetchError("média trop volumineux (annoncé)")

    morceaux = bytearray()
    async for morceau in reponse.aiter_bytes():
        morceaux.extend(morceau)
        # La vraie limite, appliquée pendant la lecture : on arrête dès le
        # dépassement plutôt que de tout charger puis de mesurer.
        if len(morceaux) > settings.proof_fetch_max_bytes:
            await reponse.aclose()
            raise MediaFetchError("média trop volumineux")

    if not morceaux:
        raise MediaFetchError("média vide")

    return MediaRecupere(contenu=bytes(morceaux), content_type=content_type, url_finale=url)
