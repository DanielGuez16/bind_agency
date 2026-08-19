"""La force d'un mot de passe, et ce qu'on refuse vraiment.

**Pas de règle de composition, et c'est un choix motivé.** « Une majuscule, un
chiffre, un caractère spécial » accepte `Password1!` et refuse
`cheval correct pile agrafe` : elle mesure la présence de symboles, pas la
difficulté à deviner. C'est aussi ce que recommande le NIST depuis 2017 —
longueur et listes de refus, pas de classes imposées. La règle poussait au mot
de passe court, prévisible, et noté sur un papier.

**Ce qu'on refuse à la place, et qui attrape ce qu'une classe laisse passer :**

— les mots de passe **connus**, ceux qui ouvrent des comptes tous les jours ;
— ceux qui contiennent **l'adresse** ou le nom du produit — `bind` et le début
  de son courriel sont les deux premières choses qu'on essaie ;
— ceux qui n'ont **presque pas de variété** : douze fois la même lettre, une
  suite de clavier, une progression de chiffres. Douze caractères qui ne
  contiennent que quatre symboles distincts ne valent pas douze caractères.

Chacun de ces trois refus attrape des mots de passe qu'une règle de composition
accepterait — `Password1!`, `Aaaaaaaaaaa1`, `Azertyuiop1!` — et aucun ne refuse
une phrase de passe longue, qui est ce qu'on veut encourager.
"""

import re
import unicodedata

#: Douze, et c'est un plancher, pas une cible.
LONGUEUR_MINIMALE = 12
#: Au-delà, on ne hache plus : une entrée démesurée est un déni de service.
LONGUEUR_MAXIMALE = 256

#: Le nombre de caractères **distincts** exigés. Six sur douze : « aaaaaabbbbbb »
#: tombe, « chevalcorrect » passe. Mesuré sur des phrases de passe réelles — la
#: plus pauvre qu'on ait construite en essai en portait neuf.
VARIETE_MINIMALE = 6

#: Ce qui ouvre des comptes tous les jours. Courte à dessein : une liste de dix
#: millions d'entrées vit dans un service, pas dans un dépôt. Celle-ci arrête
#: les formes exactes qu'une règle de composition laisserait passer.
INTERDITS = frozenset(
    {
        "password",
        "motdepasse",
        "contrasena",
        "azerty",
        "qwerty",
        "qwertyuiop",
        "azertyuiop",
        "iloveyou",
        "admin",
        "welcome",
        "letmein",
        "changeme",
        "sunshine",
        "princess",
        "football",
        "baseball",
        "monkey",
        "dragon",
        "abc123",
        "123456",
        "1234567890",
        "bind",
        "bindagency",
        "miami",
    }
)


class MotDePasseFaible(ValueError):
    """Refus nommé. Le message est un **code**, pas une phrase : c'est
    l'interface qui le traduit, dans la langue de celui qui s'inscrit."""


def _reduire(valeur: str) -> str:
    """Minuscules, sans accents, sans séparateurs.

    `M0t-De_Passe` et `motdepasse` sont le même mot de passe pour qui devine ;
    les distinguer ferait de la liste de refus une décoration.
    """
    sans_accent = "".join(
        c for c in unicodedata.normalize("NFKD", valeur) if not unicodedata.combining(c)
    )
    remplace = sans_accent.lower().translate(str.maketrans("0134578", "oieastb"))
    return re.sub(r"[^a-z]", "", remplace)


def verifier(mot_de_passe: str, *, email: str | None = None) -> None:
    """Lève `MotDePasseFaible` avec son code, ou rend `None`.

    L'ordre des contrôles est celui de ce qu'on peut corriger : la longueur
    d'abord, qui se répare en tapant ; l'adresse ensuite ; la variété enfin.
    """
    if len(mot_de_passe) < LONGUEUR_MINIMALE:
        raise MotDePasseFaible("password_too_short")
    if len(mot_de_passe) > LONGUEUR_MAXIMALE:
        raise MotDePasseFaible("password_too_long")

    reduit = _reduire(mot_de_passe)

    for interdit in INTERDITS:
        if interdit in reduit:
            raise MotDePasseFaible("password_too_common")

    if email:
        # Le début de l'adresse, qui est ce qu'on essaie en premier. Trois
        # caractères au moins : « a@x.com » ne doit pas interdire tout mot de
        # passe contenant un « a ».
        local = _reduire(email.split("@", 1)[0])
        if len(local) >= 3 and local in reduit:
            raise MotDePasseFaible("password_contains_email")

    if len(set(mot_de_passe)) < VARIETE_MINIMALE:
        raise MotDePasseFaible("password_too_repetitive")

    if _suite_de_clavier(mot_de_passe):
        raise MotDePasseFaible("password_sequential")


#: Les rangées, dans les deux dispositions qu'on croise à Miami.
_RANGEES = (
    "azertyuiop",
    "qwertyuiop",
    "asdfghjkl",
    "qsdfghjklm",
    "zxcvbnm",
    "wxcvbn",
    "0123456789",
)


def _suite_de_clavier(mot_de_passe: str, longueur: int = 5) -> bool:
    """Cinq caractères consécutifs d'une rangée, dans un sens ou dans l'autre.

    Cinq et non quatre : « asdf » apparaît dans des mots de passe honnêtes,
    « asdfg » beaucoup moins. Les deux sens, parce que « poiuy » se tape aussi
    facilement que « yuiop ».
    """
    reduit = mot_de_passe.lower()
    for rangee in _RANGEES:
        for depart in range(len(rangee) - longueur + 1):
            morceau = rangee[depart : depart + longueur]
            if morceau in reduit or morceau[::-1] in reduit:
                return True
    return False
