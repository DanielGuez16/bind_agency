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
        return DemoSocialProvider(platform=platform)

    if platform is Platform.INSTAGRAM:
        return InstagramProvider(client)
    return TikTokProvider(client)


async def fournisseur_de(platform: Platform) -> AsyncIterator[SocialProvider]:
    """Un client HTTP par requête : pas d'état partagé entre parcours.

    Le client est ouvert même en mode démonstration, où il ne sert pas. C'est
    délibéré : deux chemins d'ouverture différents finiraient par diverger sur
    les délais ou les en-têtes, et la démonstration cesserait d'être le même
    parcours.
    """
    async with httpx.AsyncClient() as client:
        yield creer(platform, client)
