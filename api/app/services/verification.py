"""Une publication appartient-elle à cette collaboration ?

`SPEC.md` — « Vérifiée, ou seulement attestée » — pose quatre conditions :
postée **après la consommation**, **avant l'échéance**, sur le **compte figé à
la réservation**, et **au format exigé**. Ce module les applique, et lui seul.

**La décision est pure.** `verdict` ne touche ni la base ni le réseau : elle
reçoit ce que la plateforme a répondu et ce que le dossier exige, et rend un
avis. C'est ce qui permet de l'éprouver sur les cas qui comptent — la story
publiée la veille de la consommation, le reel soumis pour un palier post, la
publication d'un autre compte — sans monter d'infrastructure.

**Un échec de vérification n'est pas un refus de la preuve.** La contrepartie
reste soumise et le commerce la contrôle comme avant ; elle est simplement
**attestée et non vérifiée**. Confondre les deux ferait perdre sa place à une
créatrice dont la seule faute est d'avoir soumis vingt-cinq heures après avoir
publié.
"""

from dataclasses import dataclass
from datetime import datetime

from app.integrations.social import PublicationVue
from app.models.enums import ContentFormat

#: Le vocabulaire des plateformes, traduit une seule fois.
#:
#: La traduction vit ici et non dans les fournisseurs : sinon chaque
#: implémentation deviendrait l'arbitre de ce qu'est un `ContentFormat`, et deux
#: plateformes trancheraient différemment le jour où l'une invente un format.
#: Les clés sont en majuscules parce que Meta les écrit ainsi ; la comparaison
#: normalise.
FORMATS_DES_PLATEFORMES: dict[str, ContentFormat] = {
    "STORY": ContentFormat.STORY,
    "FEED": ContentFormat.POST,
    "IMAGE": ContentFormat.POST,
    "CAROUSEL_ALBUM": ContentFormat.POST,
    "REELS": ContentFormat.REEL,
    "VIDEO": ContentFormat.REEL,
}


class RaisonDeNonVerification(str):
    """Pourquoi la vérification n'a pas conclu. Un code, jamais une phrase."""


#: Les codes, fermés. Ils sont journalisés et pourront être affichés ; les
#: laisser libres ferait apparaître des phrases françaises dans une base.
AVANT_LA_CONSOMMATION = "published_before_redemption"
APRES_L_ECHEANCE = "published_after_deadline"
AUTRE_COMPTE = "published_by_another_account"
MAUVAIS_FORMAT = "wrong_media_type"
FORMAT_INCONNU = "unknown_media_type"


@dataclass(frozen=True, slots=True)
class Verdict:
    """Ce que la vérification conclut.

    `verifiee` vraie signifie que les quatre conditions sont réunies. Fausse,
    `raisons` dit lesquelles ont manqué — toutes, jamais la première : un
    créateur qui corrige un problème pour en découvrir un second à la
    soumission suivante recommencerait trois fois.
    """

    verifiee: bool
    raisons: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class Exigences:
    """Ce que le dossier attend, extrait avant l'appel réseau.

    Un objet plutôt que quatre paramètres : les trois instants se confondent
    facilement à l'appel, et une inversion entre l'échéance et la consommation
    donnerait une vérification qui approuve exactement ce qu'elle doit refuser.
    """

    #: L'identifiant du compte figé à la réservation, tel que la plateforme le
    #: désigne. Jamais l'identifiant interne : la plateforme ne le connaît pas.
    compte_externe: str
    consomme_a: datetime
    echeance_a: datetime
    format_exige: ContentFormat


def format_du_media(media_type: str) -> ContentFormat | None:
    """Le format du produit, depuis le mot de la plateforme.

    Nul quand le mot est inconnu — une plateforme qui invente un type ne doit
    pas faire échouer la vérification en silence sur « mauvais format » : ce
    n'est pas la créatrice qui a tort, c'est notre table qui a vieilli.
    """
    return FORMATS_DES_PLATEFORMES.get(media_type.strip().upper())


def verdict(publication: PublicationVue, exigences: Exigences) -> Verdict:
    """Les quatre conditions, dans l'ordre où `SPEC.md` les pose."""
    raisons: list[str] = []

    # **Après la consommation.** Publier avant d'avoir été servi, c'est régler
    # une contrepartie avec une publication qui existait déjà — et rien
    # n'empêchait de la réutiliser ailleurs.
    if publication.published_at < exigences.consomme_a:
        raisons.append(AVANT_LA_CONSOMMATION)

    # **Avant l'échéance.** Le balayage ferme les dossiers en retard, mais une
    # soumission peut arriver dans la même seconde : la comparaison est faite
    # sur la publication, pas sur l'instant de l'envoi.
    if publication.published_at > exigences.echeance_a:
        raisons.append(APRES_L_ECHEANCE)

    # **Le compte figé.** La condition qu'aucun autre niveau ne peut vérifier,
    # et celle qui rend une URL copiée sans valeur.
    if publication.author_external_id != exigences.compte_externe:
        raisons.append(AUTRE_COMPTE)

    # **Le format exigé.** Un mot inconnu se distingue d'un mauvais format :
    # le premier accuse notre table, le second la créatrice.
    format_vu = format_du_media(publication.media_type)
    if format_vu is None:
        raisons.append(FORMAT_INCONNU)
    elif format_vu is not exigences.format_exige:
        raisons.append(MAUVAIS_FORMAT)

    return Verdict(verifiee=not raisons, raisons=tuple(raisons))
