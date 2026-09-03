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

from app.models.enums import Locale
from app.services import notifications
from app.services.collaboration import NOTIFICATION_PAR_ISSUE

#: Ce que `_deposer_pour_le_createur` dépose, à la lettre. Recopié d'un seul
#: endroit : le jour où il dépose un champ de plus, ce test le réclame.
CHAMPS = {
    "creator": "Rebecca",
    "business": "Ocean Beauty Studio",
    "item": "Gel manicure",
    "format": "story",
    "deadline": "12 September",
    "requirements": "Mention @ocean.",
    "reason": "The mention was missing.",
}


@pytest.mark.parametrize("cle", sorted(set(NOTIFICATION_PAR_ISSUE.values())))
@pytest.mark.parametrize("locale", [Locale.EN, Locale.ES])
@pytest.mark.parametrize("partie", ["subject", "body"])
def test_chaque_issue_rend_son_message(cle: str, locale: Locale, partie: str) -> None:
    """Les quatre issues, les deux langues, le sujet et le corps.

    On ne compare aucun texte : ce qui est éprouvé est que le rendu **aboutit**
    et ne laisse aucune accolade derrière lui.
    """
    rendu = notifications.rendre(f"{cle}.{partie}", locale, **CHAMPS)

    assert rendu, f"{cle}.{partie} rend une chaîne vide"
    # Une variable non substituée reste entre accolades : c'est la forme exacte
    # qu'un gabarit prendrait s'il nommait un champ que le code ne dépose pas.
    assert "{" not in rendu, f"{cle}.{partie} garde une variable : {rendu}"
    # Et la clé elle-même ne doit pas ressortir — c'est ce que rend un
    # catalogue qui ne la porte pas.
    assert cle not in rendu, f"{cle}.{partie} rend sa clé au lieu de son texte"
