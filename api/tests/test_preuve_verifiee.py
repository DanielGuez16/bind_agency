"""La chaîne de niveau 1 : la plateforme atteste, et le verdict est gardé.

`SPEC.md` — « Vérifiée, ou seulement attestée » — pose que quatre conditions
font qu'une publication appartient à une collaboration, et que trois d'entre
elles ne sont vérifiables qu'au niveau 1.

Ce fichier éprouve ce que le module de règle ne peut pas dire seul : que les
champs de la plateforme arrivent bien jusqu'à la preuve, que le verdict y est
conservé, et qu'un dossier attesté se distingue d'un dossier dont la
vérification a échoué — ce sont deux choses différentes, et les confondre
punirait une créatrice d'un silence d'Instagram.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.social_demo import DemoSocialProvider
from app.models.enums import CaptureMethod, ContentFormat, Platform
from app.services import proof as proof_service
from app.services import verification
from app.services.audit import Actor
from tests.test_collaboration import capture, contrepartie


def capture_verifiee(**extra) -> proof_service.MediaCapture:
    """Ce que l'archivage de niveau 1 produit : le fichier **et** les trois
    champs que seule la plateforme peut donner."""
    valeurs = {
        "platform_media_id": "ig-media-1",
        "platform_author_id": "ig-123",
        "platform_media_type": "STORY",
        "raw": {"source": "test"},
    }
    return proof_service.MediaCapture(
        capture_method=CaptureMethod.API,
        contenu=b"le media",
        media_key="proofs/api/story.mp4",
        source_url="https://instagram.example/p/story",
        platform_published_at=datetime.now(UTC),
        extra={**valeurs, **extra},
    )


async def test_les_trois_champs_de_la_plateforme_atteignent_la_preuve(
    session: AsyncSession,
) -> None:
    """Sans eux, la preuve ne porte rien de comparable au compte ni au format,
    et la règle n'a rien à examiner."""
    ligne, s = await contrepartie(session)

    preuve = await proof_service.soumettre(
        session,
        collaboration=ligne,
        capture=capture_verifiee(),
        actor=Actor.from_user(s["createur"]),
    )

    assert preuve.platform_media_id == "ig-media-1"
    assert preuve.platform_author_id == "ig-123"
    assert preuve.platform_media_type == "STORY"


async def test_le_verdict_est_conserve_avec_la_preuve(session: AsyncSession) -> None:
    """Un fait daté. Recalculé six mois plus tard avec une correspondance qui a
    bougé, il pourrait contredire ce qui a été dit au commerce le jour même."""
    ligne, s = await contrepartie(session)

    preuve = await proof_service.soumettre(
        session,
        collaboration=ligne,
        capture=capture_verifiee(),
        actor=Actor.from_user(s["createur"]),
        verdict=verification.Verdict(verifiee=True, raisons=()),
    )

    assert preuve.verifiee is True
    assert preuve.raisons_de_non_verification == []


async def test_un_verdict_negatif_garde_ses_pieces(session: AsyncSession) -> None:
    """Un dossier rejeté sans ce qui a été examiné ne se rejuge pas."""
    ligne, s = await contrepartie(session)

    preuve = await proof_service.soumettre(
        session,
        collaboration=ligne,
        capture=capture_verifiee(platform_author_id="ig-999"),
        actor=Actor.from_user(s["createur"]),
        verdict=verification.Verdict(verifiee=False, raisons=(verification.AUTRE_COMPTE,)),
    )

    assert preuve.verifiee is False
    assert preuve.raisons_de_non_verification == [verification.AUTRE_COMPTE]
    # Ce que la plateforme a dit reste écrit, même si cela l'accuse.
    assert preuve.platform_author_id == "ig-999"


async def test_une_preuve_attestee_ne_dit_pas_que_la_verification_a_echoue(
    session: AsyncSession,
) -> None:
    """**La distinction qui compte.** Nul veut dire « la question ne s'est pas
    posée » ; faux veut dire « la publication ne correspond pas ». Les
    confondre accuserait la créatrice d'un silence de la plateforme."""
    ligne, s = await contrepartie(session)

    preuve = await proof_service.soumettre(
        session,
        collaboration=ligne,
        capture=capture(CaptureMethod.UPLOAD),
        actor=Actor.from_user(s["createur"]),
    )

    assert preuve.verifiee is None
    assert preuve.verifiee is not False
    assert preuve.platform_media_id is None


# --------------------------------------------------------------------------
# le fournisseur de démonstration
# --------------------------------------------------------------------------


async def test_la_demonstration_produit_une_publication_exploitable() -> None:
    """Elle doit pouvoir alimenter la règle, sinon la chaîne n'est éprouvable
    que contre un vrai réseau."""
    provider = DemoSocialProvider(platform=Platform.INSTAGRAM)

    vue = await provider.fetch_media("jeton", permalink="https://x.test/p/une-story")

    assert vue.media_type == "STORY"
    assert vue.author_external_id == await _identite(provider)
    assert vue.published_at <= datetime.now(UTC)


async def test_la_demonstration_sait_produire_une_story_expiree() -> None:
    """Sans ce cas, on n'éprouve que le chemin qui marche — et le cas normal
    d'une story de plus de vingt-quatre heures est justement l'autre."""
    from app.integrations.social import PublicationIntrouvable

    provider = DemoSocialProvider(platform=Platform.INSTAGRAM)

    try:
        await provider.fetch_media("jeton", permalink="https://x.test/p/story-expiree")
    except PublicationIntrouvable:
        return
    raise AssertionError("une adresse marquée expirée doit être introuvable")


async def test_la_regle_accepte_ce_que_la_demonstration_rend() -> None:
    """Le bout à bout, sans base : ce que le fournisseur produit satisfait les
    quatre conditions quand le dossier correspond."""
    provider = DemoSocialProvider(platform=Platform.INSTAGRAM)
    vue = await provider.fetch_media("jeton", permalink="https://x.test/p/une-story")

    verdict = verification.verdict(
        vue,
        verification.Exigences(
            compte_externe=vue.author_external_id,
            consomme_a=vue.published_at - timedelta(minutes=5),
            echeance_a=vue.published_at + timedelta(days=2),
            format_exige=ContentFormat.STORY,
        ),
    )

    assert verdict.verifiee is True


async def _identite(provider: DemoSocialProvider) -> str:
    identite = await provider.fetch_identity("jeton")
    return identite.external_id
