"""La force d'un mot de passe, et ce qu'une règle de composition laisse passer.

**Pourquoi pas « une majuscule, un chiffre, un symbole ».** Elle accepte
`Password1!` et refuse `cheval correct pile agrafe` : elle mesure la présence de
symboles, pas la difficulté à deviner. C'est aussi ce que le NIST recommande
depuis 2017 — longueur et listes de refus, pas de classes imposées.

Chaque cas ci-dessous est un mot de passe **qu'une règle de composition
accepterait** et que celle-ci refuse. C'est la seule façon de montrer que le
remplacement vaut mieux que ce qu'il remplace.
"""

import pytest

from app.core.passwords import MotDePasseFaible, verifier


@pytest.mark.parametrize(
    ("mot_de_passe", "code"),
    [
        # Majuscule, chiffre, symbole : la règle de composition dirait oui.
        ("Password1234!", "password_too_common"),
        ("MotDePasse2026!", "password_too_common"),
        ("Azertyuiop123!", "password_too_common"),
        # Douze caractères, une majuscule, un chiffre — et six lettres en tout.
        ("Aaaaaaaaaa1!", "password_too_repetitive"),
        # Une rangée de clavier, qui se tape sans réfléchir.
        ("Qwertyuiop42!", "password_too_common"),
        ("Zxcvbnm-2026-x", "password_sequential"),
    ],
)
def test_refuse_ce_qu_une_regle_de_composition_accepterait(mot_de_passe: str, code: str) -> None:
    with pytest.raises(MotDePasseFaible) as refus:
        verifier(mot_de_passe)

    assert str(refus.value) == code


def test_refuse_un_mot_de_passe_qui_contient_l_adresse() -> None:
    """Le début de l'adresse est la première chose qu'on essaie."""
    with pytest.raises(MotDePasseFaible) as refus:
        verifier("daniel-guez-2026-x", email="danielguez@example.com")

    assert str(refus.value) == "password_contains_email"


@pytest.mark.parametrize(
    "mot_de_passe",
    [
        # **Ce qu'une règle de composition refuserait**, et qui est fort.
        "cheval correct pile agrafe",
        "orchidee cuivre tempete lune",
        # Et une forme classique, qui reste acceptée.
        "Tr0ub4dor&3xKq",
    ],
)
def test_accepte_ce_qui_est_reellement_solide(mot_de_passe: str) -> None:
    verifier(mot_de_passe, email="ocean@bind.example")


def test_la_longueur_reste_un_plancher() -> None:
    with pytest.raises(MotDePasseFaible) as refus:
        verifier("court-42")

    assert str(refus.value) == "password_too_short"
