"""Emails transactionnels.

Deux propriétés portent le reste.

**La langue est celle du destinataire**, pas celle du déclencheur : un commerce
hispanophone qui refuse une preuve n'écrit pas l'email d'un créateur anglophone.

**Un envoi qui échoue ne défait rien.** Le service d'envoi est injoignable une
fois sur cent ; si cela annulait la contrepartie qu'il devait annoncer, le
créateur perdrait son droit pour une panne qui ne le regarde pas.

Aucun appel réseau : le fournisseur réel est éprouvé sur un transport simulé.
"""

import json
import pathlib
from datetime import UTC, datetime, timedelta

import httpx
import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import ConfigurationError, build_settings, get_settings
from app.integrations.email import (
    EmailError,
    LogEmailSender,
    Message,
    ResendSender,
    check_email_configuration,
)
from app.models import Collaboration, User
from app.models.enums import CollaborationStatus, Locale
from app.services import notifications
from tests.test_collaboration import contrepartie

CATALOGUES = pathlib.Path(__file__).resolve().parents[1] / "app" / "locales"


class FauxEnvoi:
    """Retient ce qu'on lui donne, ou lève."""

    def __init__(self, *, leve: Exception | None = None) -> None:
        self.leve = leve
        self.messages: list[Message] = []

    async def envoyer(self, message: Message) -> None:
        if self.leve is not None:
            raise self.leve
        self.messages.append(message)


# --------------------------------------------------------------------------
# les catalogues
# --------------------------------------------------------------------------


def test_les_deux_langues_portent_les_memes_cles() -> None:
    """Le plus important des tests de ce fichier : il échoue à la première clé
    oubliée, et une clé manquante ne se voit qu'au moment de l'envoi."""
    catalogues = {
        chemin.stem: json.loads(chemin.read_text(encoding="utf-8"))
        for chemin in CATALOGUES.glob("*.json")
    }

    assert set(catalogues) == {"en", "es"}
    assert sorted(catalogues["en"]) == sorted(catalogues["es"])


def test_aucun_gabarit_vide() -> None:
    for chemin in CATALOGUES.glob("*.json"):
        gabarits = json.loads(chemin.read_text(encoding="utf-8"))
        vides = [cle for cle, valeur in gabarits.items() if not valeur.strip()]
        assert vides == [], f"{chemin.name} : {vides}"


def test_les_deux_langues_attendent_les_memes_variables() -> None:
    """Une variable présente d'un côté seulement produirait un email amputé
    dans une langue et correct dans l'autre — le pire des deux."""
    import re

    def variables(texte: str) -> set[str]:
        return set(re.findall(r"\{(\w+)\}", texte))

    en = json.loads((CATALOGUES / "en.json").read_text(encoding="utf-8"))
    es = json.loads((CATALOGUES / "es.json").read_text(encoding="utf-8"))

    for cle in en:
        assert variables(en[cle]) == variables(es[cle]), cle


def test_une_cle_absente_leve_au_lieu_de_se_rendre_telle_quelle() -> None:
    """Un email dont le sujet est `collaboration.opened.subject` est pire qu'un
    email non envoyé."""
    with pytest.raises(KeyError):
        notifications.rendre("cle.qui.n.existe.pas", Locale.EN)


# --------------------------------------------------------------------------
# la langue du destinataire
# --------------------------------------------------------------------------


@pytest.mark.parametrize("locale", list(Locale))
async def test_l_email_suit_la_langue_du_destinataire(
    locale: Locale, session: AsyncSession
) -> None:
    ligne, s = await contrepartie(session)
    await session.execute(sa.update(User).where(User.id == s["createur"].id).values(locale=locale))
    await session.flush()

    envoi = FauxEnvoi()
    assert await notifications.envoyer_pour(
        session, collaboration=ligne, cle="collaboration.opened", sender=envoi
    )

    message = envoi.messages[0]
    assert message.locale is locale
    from app.core.i18n import translate

    assert message.sujet == translate(
        "collaboration.opened.subject", locale=locale, business="Salon d'essai"
    )


async def test_les_exigences_figurent_dans_le_message(session: AsyncSession) -> None:
    """Celles figées sur la contrepartie, pas celles de l'offre aujourd'hui."""
    ligne, _ = await contrepartie(session, required_mention="@salon.ocean", required_geotag=True)

    envoi = FauxEnvoi()
    await notifications.envoyer_pour(
        session, collaboration=ligne, cle="collaboration.opened", sender=envoi
    )

    corps = envoi.messages[0].corps
    assert "@salon.ocean" in corps
    assert "Salon d'essai" in corps
    assert "Soin visage" in corps


async def test_le_motif_du_commerce_n_est_pas_traduit(session: AsyncSession) -> None:
    """C'est du contenu saisi. On ne traduit pas ce qu'un commerce a écrit."""
    ligne, _ = await contrepartie(session)
    motif = "Falta la mención del salón"

    envoi = FauxEnvoi()
    await notifications.envoyer_pour(
        session,
        collaboration=ligne,
        cle="collaboration.resubmit",
        sender=envoi,
        reason=motif,
    )

    assert motif in envoi.messages[0].corps


async def test_l_echeance_est_rendue_dans_le_fuseau_du_commerce(
    session: AsyncSession,
) -> None:
    """Une échéance affichée en UTC à quelqu'un qui vit à Miami se lit à quatre
    heures près."""
    ligne, _ = await contrepartie(session)
    ligne.deadline_at = datetime(2026, 9, 7, 2, 0, tzinfo=UTC)
    await session.flush()

    envoi = FauxEnvoi()
    await notifications.envoyer_pour(
        session, collaboration=ligne, cle="collaboration.reminder", sender=envoi
    )

    # 02h00 UTC le 7 septembre, c'est 22h00 le 6 à Miami.
    assert "2026-09-06 22:00" in envoi.messages[0].corps


async def test_un_compte_anonymise_ne_recoit_rien(session: AsyncSession) -> None:
    ligne, s = await contrepartie(session)

    # Par le vrai service : forcer l'état à la main éprouverait le module sur
    # une ligne que la base refuse — l'adresse ne s'efface qu'avec le statut.
    from app.services import anonymization
    from app.services.audit import Actor

    createur = await session.get(User, s["createur"].id)
    await anonymization.anonymize_account(session, user=createur, actor=Actor.from_user(createur))

    envoi = FauxEnvoi()
    assert not await notifications.envoyer_pour(
        session, collaboration=ligne, cle="collaboration.opened", sender=envoi
    )
    assert envoi.messages == []


# --------------------------------------------------------------------------
# ce qu'un envoi raté ne défait pas
# --------------------------------------------------------------------------


async def test_une_erreur_d_envoi_remonte_au_lieu_d_etre_avalee(
    session: AsyncSession,
) -> None:
    """Une erreur avalée ici ferait croire à un envoi. C'est au job de la
    reporter, avec son délai croissant."""
    ligne, _ = await contrepartie(session)

    with pytest.raises(EmailError):
        await notifications.envoyer_pour(
            session,
            collaboration=ligne,
            cle="collaboration.opened",
            sender=FauxEnvoi(leve=EmailError("injoignable")),
        )

    # La contrepartie n'a pas bougé : l'email n'annule pas ce qu'il annonce.
    await session.refresh(ligne)
    assert ligne.status is CollaborationStatus.PENDING


# --------------------------------------------------------------------------
# rappels
# --------------------------------------------------------------------------


async def test_seules_les_echeances_proches_sont_rappelees(session: AsyncSession) -> None:
    avance = get_settings().collaboration_reminder_lead_seconds

    proche, _ = await contrepartie(session)
    proche.deadline_at = datetime.now(UTC) + timedelta(seconds=avance // 2)
    lointaine, _ = await contrepartie(session)
    lointaine.deadline_at = datetime.now(UTC) + timedelta(seconds=avance * 5)
    await session.flush()

    identifiants = await notifications.echeances_a_rappeler(session, avance_secondes=avance)

    assert proche.id in identifiants
    assert lointaine.id not in identifiants


async def test_une_echeance_depassee_n_est_plus_rappelee(session: AsyncSession) -> None:
    """Le rappel n'a plus d'objet : c'est le balayage d'expiration qui prend la
    suite."""
    ligne, _ = await contrepartie(session)
    ligne.deadline_at = datetime.now(UTC) - timedelta(minutes=1)
    await session.flush()

    identifiants = await notifications.echeances_a_rappeler(
        session, avance_secondes=get_settings().collaboration_reminder_lead_seconds
    )
    assert ligne.id not in identifiants


async def test_une_contrepartie_deja_soumise_n_est_pas_rappelee(
    session: AsyncSession,
) -> None:
    """Rappeler à quelqu'un qui a déjà répondu le ferait douter de ce qu'il a
    envoyé."""
    ligne, _ = await contrepartie(session)
    await session.execute(
        sa.update(Collaboration)
        .where(Collaboration.id == ligne.id)
        .values(
            status=CollaborationStatus.SUBMITTED,
            deadline_at=datetime.now(UTC) + timedelta(minutes=30),
        )
    )
    await session.flush()

    identifiants = await notifications.echeances_a_rappeler(
        session, avance_secondes=get_settings().collaboration_reminder_lead_seconds
    )
    assert ligne.id not in identifiants


# --------------------------------------------------------------------------
# le fournisseur
# --------------------------------------------------------------------------


def test_resend_sans_cle_empeche_de_demarrer(monkeypatch: pytest.MonkeyPatch) -> None:
    """Découvrir la clé manquante au premier rappel signifierait des créateurs
    sans avertissement, et des dossiers qui tombent sans que personne n'ait
    rien dit."""
    from app.core import encryption
    from app.integrations import email as module

    reglages = build_settings(
        _env_file=None,
        database_url=str(get_settings().database_url),
        jwt_secret_key="peu-importe-ici-mais-assez-longue-pour-hmac",
        token_encryption_key=encryption.generate_key(),
        email_provider="resend",
    )
    monkeypatch.setattr(module, "get_settings", lambda: reglages)

    with pytest.raises(ConfigurationError, match="EMAIL_API_KEY"):
        check_email_configuration()


def test_le_mode_journal_ne_demande_rien() -> None:
    """Le pendant : la configuration par défaut doit démarrer sans clé, sinon
    ni les tests ni le jeu de données ne tourneraient."""
    check_email_configuration()


async def test_le_mode_journal_n_envoie_rien() -> None:
    await LogEmailSender().envoyer(
        Message(destinataire="a@b.test", sujet="s", corps="c", locale=Locale.EN)
    )


@pytest.fixture
def resend_configure(monkeypatch: pytest.MonkeyPatch):
    from app.core import encryption
    from app.integrations import email as module

    reglages = build_settings(
        _env_file=None,
        database_url=str(get_settings().database_url),
        jwt_secret_key="peu-importe-ici-mais-assez-longue-pour-hmac",
        token_encryption_key=encryption.generate_key(),
        email_provider="resend",
        email_api_key="une-cle-resend",
        email_from="BIND <bonjour@bind.test>",
    )
    monkeypatch.setattr(module, "get_settings", lambda: reglages)
    return reglages


async def test_un_envoi_reussi_ne_leve_pas(resend_configure) -> None:
    appels: list[httpx.Request] = []

    def repondre(request: httpx.Request) -> httpx.Response:
        appels.append(request)
        return httpx.Response(200, json={"id": "msg_1"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(repondre)) as http:
        await ResendSender(http).envoyer(
            Message(destinataire="a@b.test", sujet="Sujet", corps="Corps", locale=Locale.EN)
        )

    assert appels[0].headers["Authorization"] == "Bearer une-cle-resend"
    assert b"bonjour@bind.test" in appels[0].content


@pytest.mark.parametrize(
    "reponse",
    [
        httpx.Response(401, json={"message": "invalid api key"}),
        httpx.Response(429, json={"message": "rate limited"}),
        httpx.Response(500, text="down"),
    ],
)
async def test_un_refus_du_fournisseur_leve_sans_repeter_son_message(
    reponse: httpx.Response, resend_configure
) -> None:
    """Son message parle de son API et peut contenir l'adresse du destinataire."""
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: reponse)) as http:
        with pytest.raises(EmailError) as excinfo:
            await ResendSender(http).envoyer(
                Message(destinataire="a@b.test", sujet="s", corps="c", locale=Locale.EN)
            )

    assert "a@b.test" not in str(excinfo.value)
    assert "invalid api key" not in str(excinfo.value)


async def test_le_reseau_coupe_leve_une_erreur_d_envoi(resend_configure) -> None:
    def couper(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refusé", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(couper)) as http:
        with pytest.raises(EmailError):
            await ResendSender(http).envoyer(
                Message(destinataire="a@b.test", sujet="s", corps="c", locale=Locale.EN)
            )


def test_les_identifiants_ne_sont_pas_lisibles_dans_les_reglages(resend_configure) -> None:
    """`SecretStr` : une clé d'API qui apparaît dans un journal d'erreur fuit."""
    assert "une-cle-resend" not in repr(resend_configure)
    assert "une-cle-resend" not in str(resend_configure)
