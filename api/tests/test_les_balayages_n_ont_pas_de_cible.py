"""Tout balayage planifié est déclaré sans cible, et réciproquement.

**Le défaut, et il se détruisait lui-même.** `SANS_CIBLE` recopiait
`scheduler.BALAYAGES` à la main et en avait perdu une entrée :
`ACCOUNT_DELETION_SWEEP`. Le balayage retombait donc sur
`session.get(SocialAccount, SENTINELLE)`, qui rend `None`, et l'exécuteur prend
une cible absente pour une cible disparue — il appelle
`deplanifier(target_id=…)`.

Or les huit balayages **partagent** cette sentinelle. Un passage effaçait donc
les huit ; le planificateur les recréait au suivant, qui les effaçait de
nouveau. Rien ne le disait, puisque la file se reconstituait entre deux tours :
seuls les traitements manquaient, en silence.
"""

from app.models.enums import JobType
from app.workers.handlers import SANS_CIBLE, TRAITEMENTS
from app.workers.scheduler import BALAYAGES


def test_les_deux_listes_disent_la_meme_chose() -> None:
    """La relation, pas une liste attendue.

    Écrire ici les huit noms serait la même faute un cran plus loin : une
    troisième copie à tenir à jour. Ce qui doit être vrai est que les deux
    listes du code coïncident, et c'est cela qu'on éprouve.
    """
    assert set(BALAYAGES) == set(SANS_CIBLE)


def test_chaque_balayage_a_son_traitement() -> None:
    """Le pendant. Un balayage planifié sans traitement tourne à vide et
    s'épuise ; l'exécuteur le dit, mais après trois passages perdus."""
    assert set(BALAYAGES) <= set(TRAITEMENTS)


def test_la_garde_regarde_bien_quelque_chose() -> None:
    """Sans elle, deux listes vides seraient « d'accord ».

    C'est la moitié qui manquait à trois gardes de ce dépôt en deux jours :
    celle des glyphes, celle du mono, et celle des liens suivis.
    """
    assert len(BALAYAGES) >= 8
    assert JobType.ACCOUNT_DELETION_SWEEP in SANS_CIBLE
