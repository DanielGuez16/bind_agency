"""Interface commune aux plateformes sociales.

`SPEC.md` §5.1 prévoit quatre opérations : `authorize`, `refresh`,
`fetch_profile_metrics`, `fetch_media`. Seules celles dont cette tâche a besoin
sont déclarées ici — les autres arriveront avec la leur, avec la connaissance de
ce qu'elles doivent vraiment porter.

Le reste du système ne connaît que cette interface, jamais un réseau.

**Deux familles d'échec, pas une.** L'appelant ne peut pas réagir pareil à
« la plateforme nous a refusé le jeton » et à « la plateforme n'a pas répondu ».
Le premier est définitif et se règle en reconnectant le compte, le second passe
tout seul. C'est au fournisseur de trancher, parce que lui seul lit la réponse ;
plus haut, il ne resterait qu'un code HTTP à interpréter à l'aveugle.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol, runtime_checkable

from app.models.enums import Platform


class SocialProviderError(Exception):
    """L'échange n'a pas abouti, mais rien ne dit que le compte est en cause.

    Réseau coupé, plateforme en panne, réponse illisible : c'est passager, on
    réessaiera. Aucun état local ne change.
    """


class SocialAuthError(SocialProviderError):
    """La plateforme a refusé notre jeton : révoqué, expiré, ou périmé.

    Réessayer ne servira à rien tant que le créateur n'aura pas reconnecté son
    compte. Hérite de `SocialProviderError` pour qu'un appelant qui ne fait pas
    la distinction reste correct — il traite juste le cas moins finement.
    """


@dataclass(frozen=True, slots=True)
class JetonEchange:
    access_token: str
    #: Meta délivre des jetons de longue durée à échéance connue. Une plateforme
    #: qui n'en donnerait pas laisse ce champ nul.
    expires_at: datetime | None = None
    refresh_token: str | None = None


@dataclass(frozen=True, slots=True)
class IdentiteSociale:
    """Le strict nécessaire pour rattacher le compte.

    Ce n'est pas de la métrique : sans identifiant ni pseudonyme, il n'y a
    simplement rien à enregistrer. Les abonnés et les vues sont la tâche
    suivante.
    """

    external_id: str
    handle: str


@dataclass(frozen=True, slots=True)
class MetriquesProfil:
    """Ce qu'une lecture de profil rapporte, et rien d'autre.

    Les trois compteurs sont obligatoires parce que la table les déclare
    obligatoires : mettre zéro pour « je ne sais pas » inventerait un chiffre
    que personne ne pourrait distinguer d'un vrai. Ce qui est nullable en base
    l'est ici aussi, et peut donc manquer sans empêcher d'enregistrer.

    `avg_views` et `engagement_rate` n'y figurent pas : ils se calculent sur les
    publications, pas sur le profil. Ils viendront avec `fetch_media`.
    """

    followers_count: int
    following_count: int
    media_count: int
    #: L'adresse de la photo de profil chez la plateforme, quand elle la donne.
    #:
    #: **Une adresse, et pas une clé** : c'est ce que la plateforme répond. Elle
    #: expire — les deux fournisseurs servent des URL signées — et c'est
    #: précisément pourquoi elle ne se range jamais telle quelle. Le relevé la
    #: télécharge et n'en garde qu'une clé dans notre dépôt.
    avatar_url: str | None
    #: Répartition de l'audience, quand la plateforme la donne.
    audience_demographics: dict | None
    #: Conservé tel quel : quand un chiffre surprendra, c'est la seule preuve
    #: de ce que la plateforme a réellement répondu ce jour-là.
    raw_payload: dict


@dataclass(frozen=True, slots=True)
class PublicationVue:
    """Une publication, telle que la plateforme la décrit.

    **C'est l'objet qui rend une contrepartie vérifiable.** `SPEC.md` pose que
    quatre conditions font qu'une publication appartient à une collaboration :
    postée après la consommation, avant l'échéance, sur le compte figé à la
    réservation, et au format exigé. Aux niveaux 2 et 3, `proof` ne porte rien
    de comparable au compte ni au format — une URL est copiable, un fichier
    ré-téléversé ne prouve pas son format. Les quatre champs ci-dessous sont
    exactement ce qui manquait.

    **`author_external_id` est le champ décisif**, et il vient de la plateforme,
    jamais de nous. C'est lui qu'on compare à l'identifiant du compte figé à la
    réservation : sans lui, rien n'empêche de soumettre la publication d'un
    autre.

    **`media_type` reste dans le vocabulaire de la plateforme.** Meta dit
    `STORY`, `FEED`, `REELS` ; une autre dira autre chose. Le traduire dans le
    fournisseur ferait de chaque implémentation l'arbitre de ce qu'est un
    `ContentFormat`, et deux plateformes trancheraient différemment le jour où
    l'une invente un format. La traduction se fait une fois, au-dessus.
    """

    #: L'identifiant de la publication chez la plateforme. Ce qui permet de la
    #: retrouver, et de refuser deux preuves pour le même média.
    media_id: str
    #: Le compte qui a publié, tel que la plateforme le désigne. Comparé à
    #: `social_account.external_id`, figé à la réservation.
    author_external_id: str
    #: Le type, dans les mots de la plateforme. Traduit plus haut, jamais ici.
    media_type: str
    #: L'horodatage de la plateforme. Le seul qui puisse prouver l'antériorité :
    #: celui lu sur une page est écrit par la page.
    published_at: datetime
    #: L'adresse permanente, quand elle existe. Une story n'en a pas.
    permalink: str | None
    #: La légende, pour vérifier la mention exigée. Nulle quand il n'y en a pas.
    caption: str | None
    #: Conservé tel quel : quand une vérification surprendra, c'est la seule
    #: preuve de ce que la plateforme a réellement répondu.
    raw_payload: dict


class PublicationIntrouvable(SocialProviderError):
    """La plateforme ne connaît pas cette publication, ou ne la rend plus.

    **Le cas normal d'une story de plus de vingt-quatre heures**, pas une
    panne. L'appelant retombe alors sur le niveau inférieur : la contrepartie
    est attestée et non vérifiée, ce qui est un résultat et non un échec.

    Distincte de `SocialProviderError`, dont elle hérite pour qu'un appelant qui
    ne fait pas la différence reste correct : réessayer ne la fera pas
    apparaître, et une story expirée ne reviendra jamais.
    """


@runtime_checkable
class SocialProvider(Protocol):
    platform: Platform

    #: Ce que ce fournisseur est : `demo` ou `live`.
    #:
    #: Porté par le fournisseur et non lu dans la configuration, parce que les
    #: deux peuvent diverger : le jeu de données construit ses propres
    #: fournisseurs simulés quel que soit le mode déclaré. Enregistrer le
    #: réglage du jour marquerait ses comptes comme réels, exactement dans le
    #: cas qu'on cherche ensuite à détecter.
    mode: str

    def authorization_url(self, *, state: str) -> str:
        """URL vers laquelle envoyer le créateur pour qu'il autorise."""
        ...

    async def exchange_code(self, code: str) -> JetonEchange:
        """Transforme le code de retour en jeton utilisable."""
        ...

    async def fetch_identity(self, access_token: str) -> IdentiteSociale:
        """Qui est ce compte. Rien de plus."""
        ...

    async def refresh_token(
        self, *, access_token: str, refresh_token: str | None = None
    ) -> JetonEchange:
        """Repousse l'échéance du jeton, avant qu'elle n'arrive.

        Les deux paramètres parce que les plateformes ne s'accordent pas :
        Meta renouvelle le jeton d'accès avec lui-même, d'autres exigent un
        jeton de renouvellement distinct. Un seul paramètre obligerait la
        moitié des implémentations à mentir sur ce qu'elles reçoivent.

        Lève `SocialAuthError` si la plateforme refuse le jeton — il n'y a plus
        rien à renouveler — et `SocialProviderError` pour tout le reste.
        """
        ...

    async def fetch_profile_metrics(
        self, access_token: str, *, external_id: str
    ) -> MetriquesProfil:
        """Les chiffres du profil à l'instant de l'appel.

        Lève `SocialAuthError` si la plateforme refuse le jeton,
        `SocialProviderError` pour tout le reste. Ne rend jamais un résultat
        partiel : sans les compteurs obligatoires, c'est une erreur, pas un
        objet à moitié rempli.
        """
        ...

    async def fetch_media(self, access_token: str, *, permalink: str) -> PublicationVue:
        """La publication désignée par son adresse, telle que la plateforme la
        décrit.

        **Interrogée à la soumission, jamais par un balayage.** Un balayage
        périodique sur toutes les collaborations en attente heurterait les
        limites d'appel de Meta pour n'apprendre, la plupart du temps, que rien
        n'a changé. La soumission épouse le geste réel — on publie, puis on
        soumet — et une story soumise dans les vingt-quatre heures est encore
        là.

        Lève `PublicationIntrouvable` quand la plateforme ne la rend plus : ce
        n'est pas une panne, c'est le cas normal d'une story expirée, et
        l'appelant retombe alors sur le niveau inférieur. `SocialAuthError` si
        le jeton est refusé, `SocialProviderError` pour le reste.
        """
        ...
