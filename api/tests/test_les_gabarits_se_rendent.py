"""Chaque gabarit d'email se rend avec ce que le code lui dépose.

**Deux défauts que rien ne disait, et tous deux au dernier moment.**

`collaboration.resubmit` écrit `{reason}` ; le code déposait `motif`. Le rendu
levait donc un `KeyError` — et c'est le message qui explique à quelqu'un ce
qu'on lui reproche.

`collaboration.closed_no_fault` était mappé dans `NOTIFICATION_PAR_ISSUE` et
dans `notifications.py`, et absent des deux catalogues. Une créatrice qui a
essayé trois fois n'était jamais prévenue que son dossier était clos sans faute.

**Pourquoi les tests existants ne pouvaient pas le voir** : ils vérifient qu'un
message est *déposé*, pas qu'il se *rend*. Le rendu a lieu à l'envoi, dans le
worker — hors du chemin qu'un test d'API traverse.
"""

import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.i18n import available_keys
from app.models import OutboundMessage
from app.models.enums import CollaborationStatus, Locale, MessageChannel
from app.services import collaboration as service
from app.services import email_render, notifications
from app.services.audit import Actor
from tests.test_collaboration import contrepartie
from tests.test_counterpart_queue import statut

#: Les quatre issues, et l'état d'où le produit les atteint.
ISSUES = [
    (CollaborationStatus.APPROVED, CollaborationStatus.SUBMITTED),
    (CollaborationStatus.RESUBMIT_REQUESTED, CollaborationStatus.SUBMITTED),
    (CollaborationStatus.UNFULFILLED, CollaborationStatus.SUBMITTED),
    (CollaborationStatus.CLOSED_NO_FAULT, CollaborationStatus.SUBMITTED),
]


@pytest.mark.parametrize(("issue", "depuis"), ISSUES)
async def test_chaque_issue_rend_son_message(
    session: AsyncSession, issue: CollaborationStatus, depuis: CollaborationStatus
) -> None:
    """**Le message est rendu depuis ce que le produit a réellement déposé.**

    Une première version de ce test écrivait les champs à la main — `creator`,
    `business`, `reason` — et passait donc quel que soit le nom que le code
    dépose. Elle a survécu à sa propre mutation : remettre `motif=` à l'appel
    ne la faisait pas tomber, parce qu'elle n'appelait jamais l'appelant.

    Ici le dossier est mené à l'issue par le service, et le rendu part de
    `ligne.values`, la colonne que le vidage relit. C'est le chemin de l'envoi.
    """
    ligne, scene = await contrepartie(session)
    await statut(session, ligne, depuis)
    acteur = Actor.from_user(scene["caissier"])
    if issue is CollaborationStatus.APPROVED:
        await service.approuver(session, collaboration=ligne, actor=acteur)
    elif issue is CollaborationStatus.RESUBMIT_REQUESTED:
        await service.demander_une_nouvelle_soumission(
            session, collaboration=ligne, actor=acteur, reason="missing_mention"
        )
    elif issue is CollaborationStatus.UNFULFILLED:
        await service.constater_non_honoree(
            session, collaboration=ligne, actor=acteur, reason="missing_mention"
        )
    else:
        await service.fermer_sans_faute(
            session, collaboration=ligne, actor=acteur, reason="missing_mention"
        )
    await session.flush()

    lignes = list(
        await session.scalars(
            sa.select(OutboundMessage).where(
                OutboundMessage.user_id == scene["createur"].id,
                OutboundMessage.channel == MessageChannel.EMAIL,
            )
        )
    )
    assert lignes, f"aucun message déposé pour {issue.value}"
    message = lignes[-1]

    for locale in (Locale.EN, Locale.ES):
        valeurs = notifications.valeurs_du_gabarit(locale, dict(message.values))
        for partie in ("subject", "body"):
            rendu = notifications.rendre(f"{message.template_key}.{partie}", locale, **valeurs)
            assert rendu, f"{message.template_key}.{partie} rend une chaîne vide"
            # Une variable non substituée reste entre accolades : c'est la forme
            # exacte qu'un gabarit prend quand il nomme un champ que le code ne
            # dépose pas — `{reason}` contre `motif=`.
            assert "{" not in rendu, f"{message.template_key}.{partie} : {rendu}"
            # Et la clé ressort telle quelle quand le catalogue ne la porte pas.
            assert message.template_key not in rendu, f"{message.template_key}.{partie} rend sa clé"

        # Le même dossier, réellement mené, rendu en HTML. Le sujet vient du
        # même calcul que le texte brut ci-dessus : les deux gabarits partagent
        # les mêmes valeurs, jamais deux rendus qui pourraient diverger.
        sujet = notifications.rendre(f"{message.template_key}.subject", locale, **valeurs)
        html = email_render.rendre_html(message.template_key, locale, sujet=sujet, valeurs=valeurs)
        corps_html = html.split("</head>", 1)[1]
        assert "{" not in corps_html, f"{message.template_key}/{locale.value} : accolade au corps"

        a_un_bouton = f"{message.template_key}.cta" in available_keys()
        porte_un_bouton = 'bgcolor="#F39120"' in html
        assert porte_un_bouton == a_un_bouton, (
            f"{message.template_key}/{locale.value} : bouton={porte_un_bouton}, "
            f".cta déclarée={a_un_bouton}"
        )


#: Les seize gabarits envoyés par le worker — voir la planche « BIND Emails -
#: Le gabarit v1 » (« Un gabarit, seize envois »). Une valeur par variable
#: attendue par l'un ou l'autre : le sweep n'invente rien, il couvre.
CLES_DES_SEIZE = (
    "account.verification",
    "booking.approved",
    "booking.declined",
    "booking.cancelledByBusiness",
    "collaboration.opened",
    "collaboration.reminder",
    "collaboration.approved",
    "collaboration.resubmit",
    "collaboration.unfulfilled",
    "collaboration.closed_no_fault",
    "favorite.available",
    "booking.toReview",
    "subscription.graceEnding",
    "subscription.ended",
    "support.accessOpened",
    "handover.invitation",
)

#: Les quatre gabarits sans bouton — la planche dit pourquoi : un bouton y
#: serait une invention, rien n'est à faire dans ces envois.
SANS_BOUTON = frozenset(
    {
        "collaboration.approved",
        "collaboration.unfulfilled",
        "collaboration.closed_no_fault",
        "support.accessOpened",
    }
)


def _valeurs_completes() -> dict[str, str]:
    """De quoi remplir n'importe lequel des seize sans lever de `KeyError`.

    Un sur-ensemble volontaire : `.format` ignore ce qu'un gabarit ne cite pas,
    et une seule table couvre les seize plutôt qu'une par clé.
    """
    return {
        "creator": "Rebecca",
        "business": "Ocean Beauty",
        "item": "Blow-dry",
        "format": "Reel",
        "deadline": "Thursday",
        "requirements": "Mention @oceanbeauty in your post.\nAdd the location to your post.",
        "motif": "The stylist for that service is out this week.",
        "quand": "",
        "quand_phrase": "",
        "reason": "The salon tag is missing from the post.",
        "lien": "https://bind.app/confirm/8f2ad1",
        "heures": "48",
        "echeance": "September 12",
        "expiration": "September 10",
        "prestation": "Blow-dry",
        "url": "https://bind.app/handover/8f2ad1",
    }


@pytest.mark.parametrize("cle", CLES_DES_SEIZE)
@pytest.mark.parametrize("locale", [Locale.EN, Locale.ES])
def test_les_seize_gabarits_se_rendent_en_html(cle: str, locale: Locale) -> None:
    """Aucun des seize ne lève, aucun n'oublie de substituer une variable."""
    valeurs = _valeurs_completes()
    sujet = notifications.rendre(f"{cle}.subject", locale, **valeurs)
    html = email_render.rendre_html(cle, locale, sujet=sujet, valeurs=valeurs)

    assert html.startswith("<!doctype html>")
    corps = html.split("</head>", 1)[1]
    assert "{" not in corps, f"{cle}/{locale.value} : variable non substituée"
    assert cle not in corps, f"{cle}/{locale.value} : la clé ressort telle quelle"


@pytest.mark.parametrize("cle", CLES_DES_SEIZE)
def test_le_bouton_n_apparait_que_declare(cle: str) -> None:
    """Les quatre sans `.cta` ne portent aucun bouton — jamais une invention."""
    valeurs = _valeurs_completes()
    html = email_render.rendre_html(cle, Locale.EN, sujet="x", valeurs=valeurs)
    porte_un_bouton = 'bgcolor="#F39120"' in html

    if cle in SANS_BOUTON:
        assert not porte_un_bouton, f"{cle} : bouton inventé"
    else:
        assert porte_un_bouton, f"{cle} : bouton attendu, absent"


def test_le_bouton_se_pose_ou_le_catalogue_l_a_mis() -> None:
    """Les deux seuls gabarits à lien en ligne : le bouton reste **entre** les
    deux paragraphes qui l'encadraient dans le corps, jamais rejeté au bout.

    C'est le cas qu'une première version de `email_render` ratait : elle
    plaçait le bouton après le dernier bloc de « salutation », et ni
    `account.verification` ni `handover.invitation` n'en portent un selon la
    définition de la planche — la ligne d'ouverture de l'un ne se termine pas
    par une virgule, celle de l'autre dépasse quarante caractères.
    """
    valeurs = _valeurs_completes()

    html = email_render.rendre_html("account.verification", Locale.EN, sujet="x", valeurs=valeurs)
    avant = html.index("so you can book services")
    bouton = html.index('bgcolor="#F39120"', avant)
    apres = html.index("The link works for", bouton)
    assert avant < bouton < apres

    html = email_render.rendre_html("handover.invitation", Locale.EN, sujet="x", valeurs=valeurs)
    avant = html.index("Nothing is visible to creators")
    bouton = html.index('bgcolor="#F39120"', avant)
    apres = html.index("The link works once", bouton)
    assert avant < bouton < apres


def test_le_html_echappe_ce_que_le_commerce_a_ecrit() -> None:
    """`{motif}` porte du texte saisi par un commerce, jamais un script.

    Un chevron non échappé casserait la mise en page ; une balise non échappée
    s'exécuterait dans le client de messagerie. Les deux sont une régression,
    pas seulement un défaut d'affichage.
    """
    valeurs = _valeurs_completes()
    valeurs["motif"] = '<script>alert(1)</script> & "quoted"'

    html = email_render.rendre_html("booking.declined", Locale.EN, sujet="x", valeurs=valeurs)

    assert "<script>" not in html
    assert "&lt;script&gt;" in html


def test_l_adresse_postale_est_optionnelle(monkeypatch: pytest.MonkeyPatch) -> None:
    """Vide par défaut, la ligne d'adresse ne s'affiche pas du tout — jamais un
    repère vide qui se lirait comme une adresse manquante."""
    from app.core.config import get_settings

    valeurs = _valeurs_completes()

    monkeypatch.setattr(get_settings(), "email_postal_address", "")
    sans = email_render.rendre_html("favorite.available", Locale.EN, sujet="x", valeurs=valeurs)
    assert "BIND AGENCY" not in sans

    monkeypatch.setattr(get_settings(), "email_postal_address", "BIND AGENCY · Miami, FL")
    avec = email_render.rendre_html("favorite.available", Locale.EN, sujet="x", valeurs=valeurs)
    assert "BIND AGENCY" in avec
