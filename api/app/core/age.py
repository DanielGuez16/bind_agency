"""La majorité de qui s'inscrit, et pourquoi on la demande ainsi.

**Une date de naissance, jamais une case à cocher.** « Je certifie avoir 18 ans
ou plus » coûte une colonne booléenne et ne prouve rien : la case suggère sa
propre bonne réponse, et se recoche après un refus. La FTC a sanctionné
exactement cette forme — un portail doit être **neutre**, c'est-à-dire demander
la date sans annoncer ce qu'on en fera, et ne pas laisser ressaisir après un
refus.

**Pourquoi le produit a besoin de le savoir.** BIND fait consommer une
prestation contre une publication. C'est une contrepartie de valeur, donc un
contrat — et un mineur peut annuler un contrat pendant toute sa minorité et un
délai raisonnable après sa majorité, *en totalité* : il ne peut pas garder le
bénéfice en rejetant l'obligation. Traduit dans le produit : le salon a coiffé,
la publication peut disparaître, et rien ne rattrape la prestation. Ce n'est pas
un risque de conformité abstrait, c'est un trou dans le mécanisme même de la
contrepartie.

**Dix-huit, et le seuil est écrit plutôt que supposé.** Il vaut pour Miami,
marché de lancement. S'il devait bouger — un marché où la majorité contractuelle
diffère — la marque posée sur le compte porte le seuil appliqué ce jour-là :
sans elle, un compte vérifié sous l'ancien seuil deviendrait faux en silence.
C'est le même raisonnement que la version des conditions acceptée à la prise en
main : « il a accepté » ne vaut rien si l'on ne sait pas quoi.

**Ce module ne dit pas la règle à l'utilisateur.** Il lève un code ; c'est
l'interface qui traduit, dans sa langue. Et le libellé du champ, lui, ne
l'annonce pas non plus — c'est le seul champ du formulaire dont l'aide ne dit
pas sa contrainte, et c'est ce qui rend le portail neutre.
"""

from datetime import date

#: L'âge minimal pour s'inscrire, en années révolues.
#:
#: **Ce nombre est écrit ici et nulle part ailleurs**, et il voyage avec chaque
#: compte vérifié (`age_minimum_applique`). Le comparer à une constante recopiée
#: dans un écran ferait deux vérités, et c'est celle qu'on ne relit pas qui
#: dériverait.
AGE_MINIMAL = 18

#: L'âge au-delà duquel une date est une faute de frappe plutôt qu'une personne.
#:
#: **Une borne haute, et elle sert la personne qui saisit.** Sans elle, `1023`
#: tapé pour `1993` passe le portail sans rien dire, et la date fausse reste
#: dans le compte pour toujours. Cent vingt : au-dessus de la doyenne de
#: l'humanité, en dessous de toute erreur de siècle plausible.
AGE_MAXIMAL_PLAUSIBLE = 120


#: La date de naissance des comptes des jeux de données.
#:
#: **Ici et non dans un seed, parce que les deux la lisent.** `seed` importe
#: `seed_demo`, donc la poser dans l'un des deux ferait un cycle. Elle appartient
#: de toute façon au portail : c'est une date qui doit le franchir, pas une
#: donnée de démonstration.
#:
#: **Une seule pour tous, et c'est assumé.** Le jeu ne raconte rien sur l'âge —
#: aucun palier, aucune règle du produit n'en dépend — et cinq dates
#: différentes suggéreraient le contraire.
NAISSANCE_DES_JEUX_DE_DONNEES = date(1992, 4, 17)


class AgeRefuse(ValueError):
    """Refus nommé. Le message est un **code**, pas une phrase : c'est
    l'interface qui le traduit, dans la langue de celui qui s'inscrit."""


def age_revolu(naissance: date, *, aujourdhui: date | None = None) -> int:
    """L'âge en années révolues, au jour près.

    **Pas une division par 365,25.** Un anniversaire tombe le jour de sa date,
    pas quelques heures avant ou après ; l'approximation fait basculer les
    inscriptions du jour même dans un sens ou dans l'autre selon l'année, et le
    seul jour où ça compte est précisément celui du dix-huitième anniversaire.

    La comparaison de trois-uplets fait le travail : le mois et le quantième
    disent si l'anniversaire est passé cette année.
    """
    reference = aujourdhui or date.today()
    ecoule = reference.year - naissance.year
    if (reference.month, reference.day) < (naissance.month, naissance.day):
        ecoule -= 1
    return ecoule


def verifier(naissance: date, *, aujourdhui: date | None = None) -> None:
    """Lève `AgeRefuse` avec son code, ou rend `None`.

    L'ordre des contrôles est celui de ce qu'on peut corriger : la date
    impossible d'abord — c'est une faute de frappe, elle se répare en tapant —
    puis l'âge, qui ne se répare pas.
    """
    reference = aujourdhui or date.today()

    # **Le futur d'abord.** Une date à venir n'est pas un mineur, c'est une
    # erreur de saisie ; la traiter comme un refus d'âge dirait à quelqu'un
    # qu'il est trop jeune alors qu'il s'est trompé de siècle.
    if naissance > reference:
        raise AgeRefuse("birth_date_in_future")

    age = age_revolu(naissance, aujourdhui=reference)
    if age > AGE_MAXIMAL_PLAUSIBLE:
        raise AgeRefuse("birth_date_implausible")
    if age < AGE_MINIMAL:
        raise AgeRefuse("age_below_minimum")
