"""Les quatre conditions qui rendent une contrepartie vérifiable.

`SPEC.md` — « Vérifiée, ou seulement attestée » — pose qu'une publication
appartient à une collaboration si elle est postée après la consommation, avant
l'échéance, sur le compte figé à la réservation, et au format exigé.

La décision est pure, donc éprouvable sur les cas qui comptent sans monter
d'infrastructure : la story publiée la veille de la consommation, le reel
soumis pour un palier post, la publication d'un autre compte.
"""

from datetime import UTC, datetime, timedelta

from app.integrations.social import PublicationVue
from app.models.enums import ContentFormat
from app.services import verification

CONSOMME = datetime(2026, 8, 10, 14, 0, tzinfo=UTC)
ECHEANCE = CONSOMME + timedelta(days=2)


def exigences(**over) -> verification.Exigences:
    valeurs = {
        "compte_externe": "ig-123",
        "consomme_a": CONSOMME,
        "echeance_a": ECHEANCE,
        "format_exige": ContentFormat.STORY,
    }
    return verification.Exigences(**{**valeurs, **over})


def publication(**over) -> PublicationVue:
    valeurs = {
        "media_id": "m-1",
        "author_external_id": "ig-123",
        "media_type": "STORY",
        "published_at": CONSOMME + timedelta(hours=3),
        "permalink": "https://example.test/p/1",
        "caption": None,
        "raw_payload": {},
    }
    return PublicationVue(**{**valeurs, **over})


def test_les_quatre_conditions_reunies_donnent_une_verification() -> None:
    assert verification.verdict(publication(), exigences()) == verification.Verdict(
        verifiee=True, raisons=()
    )


def test_publiee_avant_la_consommation() -> None:
    """Régler une contrepartie avec une publication qui existait déjà, c'est
    pouvoir la réutiliser ailleurs."""
    avant = publication(published_at=CONSOMME - timedelta(hours=1))

    verdict = verification.verdict(avant, exigences())
    assert verdict.verifiee is False
    assert verification.AVANT_LA_CONSOMMATION in verdict.raisons


def test_publiee_apres_l_echeance() -> None:
    tard = publication(published_at=ECHEANCE + timedelta(minutes=1))

    verdict = verification.verdict(tard, exigences())
    assert verdict.verifiee is False
    assert verification.APRES_L_ECHEANCE in verdict.raisons


def test_publiee_par_un_autre_compte() -> None:
    """La condition qu'aucun autre niveau ne peut vérifier, et celle qui rend
    une URL copiée sans valeur."""
    etrangere = publication(author_external_id="ig-999")

    verdict = verification.verdict(etrangere, exigences())
    assert verdict.verifiee is False
    assert verification.AUTRE_COMPTE in verdict.raisons


def test_le_format_ne_correspond_pas() -> None:
    reel = publication(media_type="REELS")

    verdict = verification.verdict(reel, exigences(format_exige=ContentFormat.STORY))
    assert verdict.verifiee is False
    assert verification.MAUVAIS_FORMAT in verdict.raisons


def test_un_type_inconnu_accuse_notre_table_pas_la_creatrice() -> None:
    """Une plateforme qui invente un type ne doit pas produire « mauvais
    format » : ce n'est pas la créatrice qui a tort."""
    inconnu = publication(media_type="LIVE_AUDIO_ROOM")

    verdict = verification.verdict(inconnu, exigences())
    assert verification.FORMAT_INCONNU in verdict.raisons
    assert verification.MAUVAIS_FORMAT not in verdict.raisons


def test_toutes_les_raisons_sont_rendues_pas_la_premiere() -> None:
    """Un créateur qui corrige un problème pour en découvrir un second à la
    soumission suivante recommencerait trois fois."""
    cumulee = publication(
        author_external_id="ig-999",
        media_type="REELS",
        published_at=CONSOMME - timedelta(days=1),
    )

    verdict = verification.verdict(cumulee, exigences())
    assert set(verdict.raisons) == {
        verification.AVANT_LA_CONSOMMATION,
        verification.AUTRE_COMPTE,
        verification.MAUVAIS_FORMAT,
    }


def test_le_vocabulaire_des_plateformes_se_traduit_une_fois() -> None:
    """La traduction vit ici, jamais dans les fournisseurs : sinon chaque
    implémentation deviendrait l'arbitre de ce qu'est un `ContentFormat`."""
    assert verification.format_du_media("FEED") is ContentFormat.POST
    assert verification.format_du_media("carousel_album") is ContentFormat.POST
    assert verification.format_du_media("  REELS ") is ContentFormat.REEL
    assert verification.format_du_media("QUOI") is None
