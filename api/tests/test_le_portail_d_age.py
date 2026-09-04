"""Le portail d'âge, et ce qu'une case à cocher ne prouve pas.

**Pourquoi une date et non « je certifie avoir 18 ans ».** La case suggère sa
propre bonne réponse et se recoche après un refus ; c'est la forme que la FTC a
sanctionnée. Une date se compare, et se compare **au jour près** — l'anniversaire
tombe le jour de sa date, pas quelques heures avant selon l'année bissextile.

Les cas ci-dessous sont écrits autour de ce jour-là : c'est le seul où deux
implémentations plausibles divergent, et donc le seul qui prouve quelque chose.
"""

from datetime import date

import pytest

from app.core.age import AGE_MINIMAL, AgeRefuse, age_revolu, verifier

#: Le jour depuis lequel on regarde. Figé : un test qui lit l'horloge de la
#: machine change de verdict au fil de l'année, et c'est le défaut que ce dépôt
#: a déjà payé une fois — un `valid_until` qui a fini par passer.
AUJOURDHUI = date(2026, 9, 4)


@pytest.mark.parametrize(
    ("naissance", "attendu"),
    [
        # La veille du dix-huitième anniversaire : encore mineur.
        (date(2008, 9, 5), 17),
        # Le jour même : majeur. C'est le cas qui fait diverger une comparaison
        # de trois-uplets d'une division par 365,25.
        (date(2008, 9, 4), 18),
        # Le lendemain, pour que le trio encadre le basculement.
        (date(2008, 9, 3), 18),
        # Un 29 février, dont l'anniversaire n'existe pas trois années sur
        # quatre : il tombe au 1er mars pour le calcul, jamais au 28.
        (date(2008, 2, 29), 18),
    ],
)
def test_l_age_se_compte_au_jour_pres(naissance: date, attendu: int) -> None:
    assert age_revolu(naissance, aujourdhui=AUJOURDHUI) == attendu


@pytest.mark.parametrize(
    ("naissance", "code"),
    [
        # La veille de ses dix-huit ans : refusé, et c'est la borne.
        (date(2008, 9, 5), "age_below_minimum"),
        (date(2015, 1, 1), "age_below_minimum"),
        # Une date à venir n'est pas un mineur, c'est une faute de frappe — et
        # lui répondre « trop jeune » enverrait corriger la mauvaise chose.
        (date(2027, 1, 1), "birth_date_in_future"),
        # Un siècle mal tapé : `1023` pour `1993`. Sans borne haute, la date
        # fausse entre dans le compte et y reste.
        (date(1023, 5, 12), "birth_date_implausible"),
    ],
)
def test_ce_que_le_portail_refuse(naissance: date, code: str) -> None:
    with pytest.raises(AgeRefuse) as refus:
        verifier(naissance, aujourdhui=AUJOURDHUI)
    assert str(refus.value) == code


@pytest.mark.parametrize(
    "naissance",
    [
        # Le jour même du dix-huitième anniversaire : accepté.
        date(2008, 9, 4),
        date(1990, 6, 15),
        # Juste sous la borne haute : une personne, pas une faute de frappe.
        date(1920, 1, 1),
    ],
)
def test_ce_que_le_portail_laisse_passer(naissance: date) -> None:
    """Le pendant, et sans lui rien n'est prouvé.

    Un portail qui refuserait **tout** passerait la table des refus sans rien
    garantir. Celle-ci contient le jour exact du basculement, qui est le seul
    endroit où « refuse tout » et « refuse les mineurs » ne se ressemblent pas.
    """
    verifier(naissance, aujourdhui=AUJOURDHUI)


def test_le_seuil_est_lisible_et_vaut_dix_huit() -> None:
    """Le seuil voyage avec chaque compte vérifié : il doit être une valeur.

    Écrit ici parce que `age_minimum_applique` le recopie sur le compte au
    moment de l'inscription — et qu'un seuil devenu implicite ferait mentir
    cette colonne le jour où il changerait.
    """
    assert AGE_MINIMAL == 18
