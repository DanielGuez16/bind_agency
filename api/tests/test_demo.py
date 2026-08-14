"""Le mode démonstration, et ce qu'il doit produire.

Deux familles de tests, et la première est celle qui porte la règle posée par
le passage : **aucun code de démonstration dans le produit**. Le mode est un
choix d'implémentation derrière des interfaces qui existent déjà, et un test
parcourt les services pour refuser tout retour de la question « suis-je en
démonstration ? » dans une règle métier.

La seconde vérifie les fournisseurs eux-mêmes : ils empruntent le même chemin
que les vrais, et ils savent produire les états dégradés que la démonstration
doit montrer — jeton expiré, plateforme qui refuse.
"""

import re
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest

from app.core.config import API_ROOT, ConfigurationError, get_settings
from app.integrations import providers
from app.integrations.demo_images import COUVERTURE, PRESTATION, image
from app.integrations.instagram import InstagramProvider
from app.integrations.social import SocialAuthError, SocialProvider
from app.integrations.social_demo import DemoSocialProvider
from app.integrations.tiktok import TikTokProvider
from app.models.enums import Platform

#: Les mots qui trahissent un mode qui aurait fui dans la logique métier.
INTERROGATIONS = (
    r"social_provider\s*==",
    r"object_store_provider\s*==",
    r"billing_provider\s*==",
    r"\bmode_demo\b",
    r"is_demo",
    r"if\s+.*\bdemo\b.*:",
)

#: Les seuls fichiers autorisés à interroger le mode : les fabriques, et la
#: configuration elle-même. C'est leur rôle.
FABRIQUES = {
    "app/integrations/providers.py",
    "app/integrations/object_store.py",
    "app/integrations/billing.py",
    "app/core/config.py",
}


def _sources(dossier: Path) -> list[Path]:
    return sorted(p for p in dossier.rglob("*.py") if "__pycache__" not in str(p))


# --------------------------------------------------------------------------
# la règle : aucun mode dans les services
# --------------------------------------------------------------------------


def test_aucun_service_ne_sait_qu_il_est_en_demonstration() -> None:
    """La règle posée pour ce passage, vérifiée mécaniquement.

    Si un service savait qu'il tourne en démonstration, il finirait par en
    tirer parti — et ce que la démonstration prouve ne serait plus ce que la
    production fait. Le mode se choisit dans une fabrique, une fois, et les
    services reçoivent une implémentation sans savoir laquelle.
    """
    fautifs: list[str] = []

    for chemin in _sources(API_ROOT / "app"):
        relatif = str(chemin.relative_to(API_ROOT))
        if relatif in FABRIQUES:
            continue
        source = chemin.read_text(encoding="utf-8")
        for motif in INTERROGATIONS:
            if re.search(motif, source):
                fautifs.append(f"{relatif} → {motif}")

    assert fautifs == []


def test_les_fabriques_sont_les_seules_a_le_savoir() -> None:
    """Le pendant : sans lui, un test qui ne trouve rien passerait aussi bien
    sur un produit où le mode n'existerait plus du tout."""
    trouvees = {
        relatif
        for relatif in FABRIQUES
        if any(
            re.search(motif, (API_ROOT / relatif).read_text(encoding="utf-8"))
            for motif in INTERROGATIONS
        )
    }
    # `config.py` déclare les modes sans les interroger : c'est normal.
    assert trouvees >= {
        "app/integrations/providers.py",
        "app/integrations/object_store.py",
        "app/integrations/billing.py",
    }


# --------------------------------------------------------------------------
# le fournisseur de démonstration
# --------------------------------------------------------------------------


def test_le_fournisseur_de_demonstration_respecte_l_interface() -> None:
    """Sans quoi il emprunterait un autre chemin que le vrai, et la
    démonstration cesserait de prouver quoi que ce soit."""
    assert isinstance(DemoSocialProvider(handle="x"), SocialProvider)


async def test_le_profil_est_stable_pour_un_meme_handle() -> None:
    """Deux exécutions du jeu de données produisent les mêmes chiffres.

    Sans stabilité, une démonstration ne se rejoue pas et un test ne se
    reproduit pas.
    """
    premier = await DemoSocialProvider(handle="rebecca.miami").fetch_profile_metrics(
        "jeton", external_id="x"
    )
    second = await DemoSocialProvider(handle="rebecca.miami").fetch_profile_metrics(
        "jeton", external_id="x"
    )

    assert premier.followers_count == second.followers_count
    assert premier.media_count == second.media_count


async def test_deux_handles_ne_partagent_pas_leur_profil() -> None:
    """Le pendant : un fournisseur qui rendrait toujours le même chiffre
    passerait le test précédent sans rien garantir."""
    a = await DemoSocialProvider(handle="rebecca.miami").fetch_profile_metrics(
        "jeton", external_id="x"
    )
    b = await DemoSocialProvider(handle="mateo.wynwood").fetch_profile_metrics(
        "jeton", external_id="x"
    )

    assert a.followers_count != b.followers_count


async def test_un_jeton_deja_expire_se_demande() -> None:
    """L'état « autorisation expirée » se déclare, il ne s'improvise pas.

    C'est ce qui permet au jeu de données de produire ce créateur-là sans
    écrire une ligne en base à la main.
    """
    jeton = await DemoSocialProvider(
        handle="nina.design", token_ttl=timedelta(days=-2)
    ).exchange_code("code")

    assert jeton.expires_at is not None
    assert jeton.expires_at < datetime.now(UTC)


async def test_une_plateforme_qui_refuse_se_demande_aussi() -> None:
    fournisseur = DemoSocialProvider(handle="x", refuse_l_echange=True)

    with pytest.raises(SocialAuthError):
        await fournisseur.exchange_code("code")


def test_le_fournisseur_de_demonstration_ne_rend_ni_vues_ni_engagement() -> None:
    """Ils se calculent sur les publications, pas sur le profil.

    Les inventer ferait passer pour mesuré un signal qui ne l'est pas —
    exactement ce que le contrôle de cohérence doit pouvoir distinguer.
    """
    from app.integrations.social import MetriquesProfil

    champs = set(MetriquesProfil.__dataclass_fields__)
    assert "avg_views" not in champs
    assert "engagement_rate" not in champs


# --------------------------------------------------------------------------
# la fabrique
# --------------------------------------------------------------------------


def _en_mode(monkeypatch: pytest.MonkeyPatch, mode: str) -> None:
    """Fixe le mode déclaré, au lieu de le lire dans le `.env` du poste.

    Le test affirmait `settings.social_provider == "demo"` et prenait le fichier
    de développement pour une donnée du test : il est tombé le jour où ce
    fichier est passé en mode réel, en accusant la fabrique.
    """
    from app.core import config as module_config
    from app.core import encryption
    from app.integrations import instagram as module_instagram
    from app.integrations import tiktok as module_tiktok

    reglages = module_config.build_settings(
        _env_file=None,
        database_url=str(get_settings().database_url),
        jwt_secret_key="peu-importe-ici-mais-assez-longue-pour-hmac",
        token_encryption_key=encryption.generate_key(),
        social_provider=mode,
        # Le rappel du parcours de demonstration. Sans lui la fabrique refuse,
        # et c''est voulu : une adresse morte ne se decouvre qu''au clic.
        api_public_base_url="https://api.bind.test",
        instagram_app_id="1234567890",
        instagram_app_secret="un-secret-meta",
        instagram_redirect_uri="https://api.bind.test/callback",
        tiktok_client_key="une-cle",
        tiktok_client_secret="un-secret",
        tiktok_redirect_uri="https://api.bind.test/callback",
    )
    # Les trois modules lisent la configuration chacun de leur côté : ne
    # remplacer que celle de la fabrique laissait les fournisseurs réels
    # chercher leurs identifiants dans le `.env` du poste, et refuser d'exister.
    for module in (providers, module_instagram, module_tiktok):
        monkeypatch.setattr(module, "get_settings", lambda: reglages)


def test_la_fabrique_rend_le_fournisseur_du_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    _en_mode(monkeypatch, "demo")

    for platform in providers.PLATEFORMES_BRANCHEES:
        fournisseur = providers.creer(platform, client=None)  # type: ignore[arg-type]
        assert isinstance(fournisseur, DemoSocialProvider)
        assert fournisseur.platform is platform


def test_le_mode_reel_ne_rend_jamais_le_fournisseur_de_demonstration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """L'autre sens. Une fabrique qui rendrait toujours la démonstration

    passerait le test précédent sans rien garantir — et servirait des chiffres
    inventés à un vrai créateur.
    """
    _en_mode(monkeypatch, "live")

    for platform in providers.PLATEFORMES_BRANCHEES:
        fournisseur = providers.creer(platform, client=httpx.AsyncClient())  # type: ignore[arg-type]
        assert not isinstance(fournisseur, DemoSocialProvider)


def test_une_plateforme_non_branchee_refuse_plutot_que_de_se_taire() -> None:
    """Snapchat n'a pas d'accès partenaire.

    Rendre un fournisseur qui ne fait rien laisserait un créateur devant un
    parcours qui ne se termine jamais.
    """
    assert Platform.SNAPCHAT not in providers.PLATEFORMES_BRANCHEES

    with pytest.raises(ConfigurationError):
        providers.creer(Platform.SNAPCHAT, client=None)  # type: ignore[arg-type]


# --------------------------------------------------------------------------
# les images
# --------------------------------------------------------------------------


def test_les_images_sont_de_vrais_png() -> None:
    contenu = image("Ocean Beauty Studio", COUVERTURE)
    assert contenu.startswith(b"\x89PNG\r\n\x1a\n")
    assert contenu.endswith(b"IEND\xae\x42\x60\x82")


def test_deux_noms_donnent_deux_images() -> None:
    """Sinon une carte de salon paraîtrait n'avoir qu'une photo répétée."""
    assert image("Pose gel", PRESTATION) != image("Soin visage", PRESTATION)


def test_un_meme_nom_donne_la_meme_image() -> None:
    """La clé du dépôt est dérivée du contenu : une image instable créerait un
    nouvel objet à chaque exécution du jeu de données."""
    assert image("Pose gel", PRESTATION) == image("Pose gel", PRESTATION)


def test_les_images_restent_legeres() -> None:
    """Un jeu de données qui met vingt secondes à fabriquer ses images finit par
    ne plus être rejoué."""
    assert len(image("Ocean Beauty Studio", COUVERTURE)) < 200_000


def test_le_fournisseur_de_demonstration_se_declare_comme_tel() -> None:
    """Et non selon le mode configuré.

    Le jeu de données construit ses propres fournisseurs simulés quel que soit
    le réglage. Si le mode enregistré venait de la configuration, ses comptes
    seraient marqués « réels » un jour où `SOCIAL_PROVIDER=live` — soit
    exactement le cas qu'on cherche ensuite à détecter, rendu invisible.
    """
    assert DemoSocialProvider(platform=Platform.INSTAGRAM).mode == "demo"
    assert InstagramProvider.mode == "live"
    assert TikTokProvider.mode == "live"
