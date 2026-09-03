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

from app.models import OutboundMessage
from app.models.enums import CollaborationStatus, Locale, MessageChannel
from app.services import collaboration as service
from app.services import notifications
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
