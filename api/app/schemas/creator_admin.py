"""L'annuaire des créatrices vu par l'administration."""

import uuid
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models.enums import ContentFormat, Platform


class PalierAccessibleRead(BaseModel):
    """Le palier le plus exigeant qu'elle ouvre, n'importe où sur le produit.

    **Le même principe que `PalierAccessibleIciRead` de l'annuaire du
    commerce, sans le salon.** Là-bas, les paliers évalués sont ceux qu'**un**
    salon offre ; ici, ce sont tous les paliers actifs du produit, toutes
    plateformes confondues — il n'y a pas de salon pour restreindre la
    question. Un nom distinct plutôt qu'une réutilisation : les deux répondent
    à des questions différentes, et les confondre ferait lire « ce qu'elle
    ouvre ici » sur un écran qui n'a pas de « ici ».
    """

    model_config = ConfigDict(from_attributes=True)

    tier_id: uuid.UUID
    platform: Platform
    content_format: ContentFormat


class ReseauDuCreateurRead(BaseModel):
    """Un compte rattaché. Le réseau reste, ce qui l'identifie est le pseudonyme."""

    model_config = ConfigDict(from_attributes=True)

    platform: Platform
    handle: str | None
    #: Nul quand aucun relevé n'existe. Zéro serait un chiffre, et faux.
    followers: int | None
    #: La photo **par sa clé**, servie par `GET /media/{cle}` — jamais l'adresse
    #: de la plateforme, qui expire.
    avatar_key: str | None
    #: Le profil public, nul sur une plateforme qu'on ne sait pas rattacher.
    profil_url: str | None


class CreateurAdminRead(BaseModel):
    """Une créatrice, telle que l'administration la lit.

    **Aucun état civil.** La règle vient de l'annuaire du commerce et vaut ici
    pour la même raison : le pseudonyme est l'identité de ces écrans, et le nom
    civil arrive à la réservation, quand une créatrice a choisi ce salon.

    **Le score, en revanche, est servi ici — et cette ligne disait l'inverse.**
    Elle affirmait qu'« un classement de personnes par note ne devient pas
    acceptable parce que c'est un administrateur qui le lit ». L'argument
    portait sur le **classement**, et la conclusion l'a étendu à la **donnée** :
    l'annuaire n'ordonne pas par score, il l'affiche sur la ligne d'une
    personne qu'on est déjà venu chercher par son pseudonyme.

    Ce que la règle protège reste intact et n'a jamais concerné ce lecteur-ci :
    **un commerce ne voit jamais ce nombre.** C'est la promesse du produit, et
    ce qui la rend tenable est que le palier accessible *est* le signal — un
    score dégradé plafonne mécaniquement. L'administration, elle, arbitre des
    dossiers ; lui refuser le seul chiffre qui dit si une créatrice tient ses
    engagements revient à lui faire trancher sans le savoir.
    """

    model_config = ConfigDict(from_attributes=True)

    creator_id: uuid.UUID
    city: str | None
    reseaux: list[ReseauDuCreateurRead]
    audience_totale: int
    #: **Nul veut dire neutre, jamais zéro.** C'est la règle du moteur de
    #: paliers, et elle vaut à l'affichage : une créatrice sans historique n'a
    #: pas un mauvais score, elle n'en a pas. Rendre zéro la ferait lire comme
    #: la moins fiable de la liste alors qu'elle est seulement la plus récente.
    reliability_score: Decimal | None
    #: **Absent tant que le lot d'éligibilité n'a pas tourné, jamais faux.**
    #:
    #: Calculé contre tous les paliers actifs du produit — `evaluer_createurs`,
    #: trois requêtes pour l'ensemble de la population, pas trois cents. Nul
    #: quand elle n'ouvre aucun palier ou qu'elle n'a aucun compte social : les
    #: deux se lisent pareil ici, la ligne « aucun réseau » du pseudonyme dit
    #: déjà laquelle des deux c'est.
    tier: PalierAccessibleRead | None


class AnnuaireAdminRead(BaseModel):
    """L'annuaire, et les quatre nombres qui situent ce qu'on y lit.

    **Une enveloppe, et non une liste nue.** La route borne à cent : sans total,
    « 128 sur BIND » ne s'écrit pas, et le plafond dit qu'on tronque sans dire de
    combien. C'est le manque que l'annuaire des salons avait déjà réglé, reposé
    ici un jour plus tard.

    **Les quatre nombres décrivent la recherche courante**, pas la population.
    Un chiffre qui ne bougerait pas en tapant ne dirait rien de ce qu'on
    cherche — c'est l'arbitrage rendu sur les salons, et il vaut tel quel. Sans
    recherche, la recherche courante *est* la population, qui est le cas que la
    tête décrit.
    """

    model_config = ConfigDict(from_attributes=True)

    items: list[CreateurAdminRead]
    #: Le total de la recherche, sans plafond. La liste, elle, s'arrête à cent.
    total: int
    #: Les comptes créés depuis sept jours. Dit si le produit grandit, ce
    #: qu'aucun total ne dit à lui seul.
    arrivees_cette_semaine: int
    #: La médiane des scores **qui existent**, jamais de l'ensemble.
    #:
    #: `null` signifie neutre et non zéro : compter les sans-historique comme des
    #: zéros écraserait la médiane à chaque inscription, et le chiffre baisserait
    #: précisément quand le produit grandit. Nulle quand aucun score n'existe
    #: encore — il n'y a alors pas de médiane, et zéro en serait une fausse.
    fiabilite_mediane: Decimal | None
    #: L'effectif de la médiane, et il ne se déduit pas de `total`. « 86 » sorti
    #: de trois scores n'est pas « 86 » sorti de cent vingt-huit ; c'est
    #: l'arbitrage déjà rendu sur les deux médianes d'abonnement.
    createurs_avec_score: int
    #: **Combien, sur cette recherche, ouvrent au moins un palier.**
    #:
    #: Le nombre qui manquait pour dire si la population sait déjà réserver ou
    #: si elle attend son premier compte social vérifié. Coûtait trois cents
    #: requêtes évalué créatrice par créatrice ; `evaluer_createurs` le rend en
    #: trois, sur l'ensemble.
    peut_reserver: int
