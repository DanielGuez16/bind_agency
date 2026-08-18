"""La configuration sociale, vérifiée au démarrage.

**La seule intégration qui ne l'était pas.** Le géocodeur, le courriel,
l'extraction, le dépôt objet, la facturation, la géolocalisation et les
notifications refusent tous de démarrer mal configurés. Les plateformes
sociales, non : la fabrique levait à la première requête, le routeur traduisait
en 503, et l'app affichait « réseau indisponible ».

**Et c'est la panne la plus chère du produit.** Sans réseau rattaché, aucun
relevé d'audience ; sans relevé, aucun palier ; sans palier, un fil vide. Une
inscription qui ne mène nulle part, découverte une inscription à la fois.
"""

import pytest

from app.core.config import ConfigurationError, build_settings
from app.integrations import providers
from app.models.enums import Platform

BASE = {
    "database_url": "postgresql+psycopg://bind:bind@localhost:5434/rien",
    "environment": "local",
    "jwt_secret_key": "une-cle-de-signature-assez-longue-pour-la-validation-48",
    "token_encryption_key": "MjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM=",
}


@pytest.fixture
def reglages(monkeypatch: pytest.MonkeyPatch):
    """Pose une configuration complète, sans lire le `.env` de la machine."""

    def poser(**extra):
        valeurs = build_settings(**{**BASE, **extra})
        monkeypatch.setattr(providers, "get_settings", lambda: valeurs)
        return valeurs

    return poser


def test_la_demonstration_sans_adresse_publique_refuse_de_demarrer(reglages) -> None:
    """**La configuration exacte de la campagne.**

    `SOCIAL_PROVIDER=demo` sans `API_PUBLIC_BASE_URL` : les deux plateformes
    répondaient 503, et rien nulle part ne le disait avant qu'une créatrice
    essaie.
    """
    reglages(social_provider="demo", api_public_base_url=None)

    with pytest.raises(ConfigurationError) as refus:
        providers.check_social_configuration()

    assert "API_PUBLIC_BASE_URL" in str(refus.value)


def test_une_demonstration_complete_demarre(reglages) -> None:
    """L'autre sens. Une garde qui refuserait toujours passerait le test
    ci-dessus sans rien garantir, et empêcherait toute mise en service."""
    reglages(social_provider="demo", api_public_base_url="https://api.example")

    providers.check_social_configuration()


def test_le_mode_reel_sans_identifiants_refuse_de_demarrer(reglages) -> None:
    """L'autre façon d'obtenir un 503, et elle est silencieuse de la même
    manière : des identifiants absents en production."""
    reglages(
        social_provider="live",
        instagram_app_id=None,
        instagram_app_secret=None,
        instagram_redirect_uri=None,
        tiktok_client_key=None,
        tiktok_client_secret=None,
        tiktok_redirect_uri=None,
    )

    with pytest.raises(ConfigurationError):
        providers.check_social_configuration()


def test_chaque_plateforme_branchee_est_eprouvee(reglages) -> None:
    """**Et non la première.** Instagram peut être configurée quand TikTok ne
    l'est pas : un contrôle qui s'arrêterait au premier succès laisserait passer
    exactement la moitié du défaut — celle qu'on ne verrait qu'en production, sur
    la plateforme qu'on regarde le moins."""
    reglages(
        social_provider="live",
        instagram_app_id="ig-id",
        instagram_app_secret="ig-secret",
        instagram_redirect_uri="https://api.example/ig",
        tiktok_client_key=None,
        tiktok_client_secret=None,
        tiktok_redirect_uri=None,
    )

    with pytest.raises(ConfigurationError) as refus:
        providers.check_social_configuration()

    assert "TikTok" in str(refus.value)


def test_les_deux_plateformes_branchees_sont_bien_celles_qu_on_eprouve() -> None:
    """Snapchat est dans `Platform` et n'a aucune implémentation : l'exiger au
    démarrage empêcherait de démarrer pour une plateforme qu'on ne prétend pas
    servir."""
    assert set(providers.PLATEFORMES_BRANCHEES) == {Platform.INSTAGRAM, Platform.TIKTOK}
    assert Platform.SNAPCHAT not in providers.PLATEFORMES_BRANCHEES
