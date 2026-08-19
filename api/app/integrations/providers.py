"""La fabrique de fournisseurs sociaux.

Un seul endroit décide quelle implémentation répond, et il décide sur la
configuration. Avant, `InstagramProvider` était nommé dans le routeur : ajouter
TikTok demandait d'y écrire une seconde branche, et faire une démonstration
demandait de mentir sur les identifiants Meta.

**Aucun service ne connaît le mode.** Ils reçoivent un `SocialProvider` et
l'appellent. C'est la seule façon de garantir qu'une démonstration parcourt le
même chemin qu'un usage réel — si un service savait qu'il est en démonstration,
il finirait par en tirer parti, et ce que la démonstration prouverait ne serait
plus ce que la production fait.

**Une plateforme sans implémentation refuse, elle ne se tait pas.** Snapchat
n'a pas d'accès partenaire : le demander lève, et le routeur traduit en
`social_provider_unavailable`. Rendre un fournisseur qui ne fait rien
laisserait un créateur devant un parcours qui ne se termine jamais.
"""

from collections.abc import AsyncIterator

import httpx

from app.core.config import ConfigurationError, get_settings
from app.integrations.instagram import InstagramProvider
from app.integrations.social import SocialProvider
from app.integrations.social_demo import DemoSocialProvider
from app.integrations.tiktok import TikTokProvider
from app.models.enums import Platform

#: Les plateformes que le produit sait rattacher aujourd'hui. Snapchat est dans
#: `Platform` — la base et les paliers la connaissent — mais aucune
#: implémentation ne lui répond : l'accès partenaire n'existe pas.
PLATEFORMES_BRANCHEES = frozenset({Platform.INSTAGRAM, Platform.TIKTOK})


def creer(platform: Platform, client: httpx.AsyncClient) -> SocialProvider:
    """Le fournisseur de cette plateforme, selon le mode déclaré."""
    settings = get_settings()

    if platform not in PLATEFORMES_BRANCHEES:
        raise ConfigurationError(
            f"aucune implémentation pour {platform.value} : l'accès partenaire n'existe pas encore"
        )

    if settings.social_provider == "demo":
        # Le handle est provisoire : le parcours réel le reçoit de la
        # plateforme à l'échange. En démonstration, c'est le jeu de données qui
        # construit ses propres fournisseurs avec les handles qu'il veut ; ici
        # on sert le cas où quelqu'un appelle la route depuis l'app.
        #
        # **Le rappel se donne ici et nulle part ailleurs.** La fabrique est le
        # seul endroit du produit autorisé à savoir qu'on est en démonstration —
        # un test parcourt les services pour refuser la question partout
        # ailleurs. Le routeur qui réécrirait l'adresse « si le mode est demo »
        # ferait exactement ce que cette règle interdit.
        if settings.api_public_base_url is None:
            raise ConfigurationError(
                "SOCIAL_PROVIDER=demo exige API_PUBLIC_BASE_URL : sans elle, "
                "le parcours d'autorisation renvoie vers un domaine qui n'existe pas"
            )
        return DemoSocialProvider(
            platform=platform,
            rappel=settings.api_public_base_url.rstrip("/") + settings.api_v1_prefix,
        )

    if platform is Platform.INSTAGRAM:
        return InstagramProvider(client)
    return TikTokProvider(client)


def check_social_configuration() -> None:
    """Appelé au démarrage. **La seule intégration qui n'était pas vérifiée là.**

    Le géocodeur, le courriel, l'extraction, le dépôt objet, la facturation, la
    géolocalisation et les notifications refusent tous de démarrer mal
    configurés. Les plateformes sociales, non : la fabrique levait à la première
    requête, le routeur traduisait en 503, et l'app affichait « réseau
    indisponible ». Personne ne l'apprenait avant qu'une créatrice essaie.

    **Et c'est la panne la plus chère du produit.** Sans réseau rattaché, aucun
    relevé d'audience ; sans relevé, aucun palier ; sans palier, un fil vide.
    Une inscription qui ne mène nulle part, découverte une inscription à la
    fois. C'est ce qui s'est produit en campagne : `SOCIAL_PROVIDER=demo` sans
    `API_PUBLIC_BASE_URL`, les deux plateformes en 503, et rien nulle part pour
    le dire.

    On éprouve **chaque plateforme branchée**, et non la première : Instagram
    peut être configurée quand TikTok ne l'est pas, et un contrôle qui s'arrête
    au premier succès laisserait passer exactement la moitié du défaut.

    Le client HTTP passé aux constructeurs n'est pas utilisé par eux — ils
    valident et retiennent la configuration. On en fabrique un plutôt que de
    passer `None` : le jour où un constructeur s'en servirait, un `None` se
    découvrirait en production et non ici.
    """
    with httpx.Client() as sonde:
        client = httpx.AsyncClient()
        try:
            for platform in sorted(PLATEFORMES_BRANCHEES, key=lambda p: p.value):
                creer(platform, client)
        finally:
            # Ni l'un ni l'autre n'a servi : on les referme sans await, la
            # fermeture d'un client neuf ne fait rien d'asynchrone.
            del sonde, client


async def fournisseur_de(platform: Platform) -> AsyncIterator[SocialProvider]:
    """Un client HTTP par requête : pas d'état partagé entre parcours.

    Le client est ouvert même en mode démonstration, où il ne sert pas. C'est
    délibéré : deux chemins d'ouverture différents finiraient par diverger sur
    les délais ou les en-têtes, et la démonstration cesserait d'être le même
    parcours.
    """
    async with httpx.AsyncClient() as client:
        yield creer(platform, client)
