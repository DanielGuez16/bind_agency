"""Instagram, via « Instagram API with Instagram Login ».

Le parcours est en trois appels réseau, et c'est le deuxième qui surprend :

1. échange du code contre un jeton **de courte durée**, une heure
2. échange de ce jeton contre un jeton **de longue durée**, soixante jours
3. lecture de l'identifiant et du pseudonyme du compte

Sans la deuxième étape, la connexion expirerait dans l'heure. C'est aussi elle
qui donne l'échéance à surveiller par le job de renouvellement, tâche suivante.

Aucun appel n'est fait en test : le client HTTP est injecté.
"""

from datetime import UTC, datetime, timedelta

import httpx

from app.core.config import ConfigurationError, get_settings
from app.integrations.social import (
    IdentiteSociale,
    JetonEchange,
    MetriquesProfil,
    PublicationIntrouvable,
    PublicationVue,
    SocialAuthError,
    SocialProviderError,
)
from app.models.enums import Platform

AUTORISATION = "https://www.instagram.com/oauth/authorize"
JETON_COURT = "https://api.instagram.com/oauth/access_token"
JETON_LONG = "https://graph.instagram.com/access_token"
JETON_RENOUVELLE = "https://graph.instagram.com/refresh_access_token"
PROFIL = "https://graph.instagram.com/me"
INSIGHTS = "https://graph.instagram.com/{identifiant}/insights"

DELAI = httpx.Timeout(10.0)

#: Champs de profil demandés pour un relevé de métriques. `follows_count` est
#: le nom Instagram de ce que nous appelons `following_count`.
CHAMPS_METRIQUES = "followers_count,follows_count,media_count,profile_picture_url"

#: Les deux collections d'un compte. Les stories vivent à part et une story ne
#: figure jamais dans `/me/media` — les interroger toutes deux est la seule
#: façon de retrouver une publication quel que soit son format.
STORIES = "https://graph.instagram.com/me/stories"
MEDIAS = "https://graph.instagram.com/me/media"

#: Exactement ce que la vérification examine, et rien de plus. Demander des
#: champs inutilisés élargirait la portée de l'autorisation pour rien.
CHAMPS_MEDIA = "id,username,media_type,timestamp,permalink,caption"

#: Meta décline l'audience sur plusieurs axes, un appel par axe étant la seule
#: façon de les obtenir tous. On se limite à ceux que l'éligibilité regardera.
AXES_AUDIENCE = ("country", "city", "age", "gender")

#: Codes par lesquels Meta dit « ce jeton ne vaut plus rien ». 190 couvre le
#: jeton invalide, expiré ou révoqué par l'utilisateur ; 102 la session perdue.
CODES_AUTHENTIFICATION = {102, 190}


class InstagramProvider:
    platform = Platform.INSTAGRAM
    #: Il parle à la vraie plateforme : les comptes qu'il rattache sont réels.
    mode = "live"

    def __init__(self, client: httpx.AsyncClient) -> None:
        settings = get_settings()

        # L'absence de configuration n'est pas un repli silencieux : le
        # fournisseur refuse d'exister plutôt que de partir avec des valeurs
        # vides et d'échouer plus loin, chez Meta, avec un message à eux.
        if not (
            settings.instagram_app_id
            and settings.instagram_app_secret
            and settings.instagram_redirect_uri
        ):
            raise ConfigurationError(
                "application Instagram non configurée : INSTAGRAM_APP_ID, "
                "INSTAGRAM_APP_SECRET et INSTAGRAM_REDIRECT_URI sont attendus"
            )

        self._client = client
        self._app_id = settings.instagram_app_id
        self._app_secret = settings.instagram_app_secret.get_secret_value()
        self._redirect_uri = settings.instagram_redirect_uri
        self._scopes = settings.instagram_scopes

    def authorization_url(self, *, state: str) -> str:
        parametres = httpx.QueryParams(
            {
                "client_id": self._app_id,
                "redirect_uri": self._redirect_uri,
                "scope": ",".join(self._scopes),
                "response_type": "code",
                "state": state,
            }
        )
        return f"{AUTORISATION}?{parametres}"

    async def exchange_code(self, code: str) -> JetonEchange:
        court = await self._poster(
            JETON_COURT,
            {
                "client_id": self._app_id,
                "client_secret": self._app_secret,
                "grant_type": "authorization_code",
                "redirect_uri": self._redirect_uri,
                # Meta renvoie parfois le code suffixé de « #_ » ; il ne fait
                # pas partie du code.
                "code": code.removesuffix("#_"),
            },
        )

        jeton_court = court.get("access_token")
        if not jeton_court:
            raise SocialProviderError("aucun jeton dans la réponse d'échange")

        long = await self._lire(
            JETON_LONG,
            {
                "grant_type": "ig_exchange_token",
                "client_secret": self._app_secret,
                "access_token": jeton_court,
            },
        )

        jeton_long = long.get("access_token")
        if not jeton_long:
            raise SocialProviderError("aucun jeton de longue durée dans la réponse")

        duree = long.get("expires_in")
        return JetonEchange(
            access_token=jeton_long,
            expires_at=(datetime.now(UTC) + timedelta(seconds=int(duree)) if duree else None),
        )

    async def refresh_token(
        self, *, access_token: str, refresh_token: str | None = None
    ) -> JetonEchange:
        """Meta renouvelle le jeton de longue durée avec lui-même.

        Il n'y a pas de jeton de renouvellement séparé chez Instagram, d'où le
        paramètre ignoré. Le jeton doit avoir plus de vingt-quatre heures et ne
        pas être déjà expiré — c'est ce qui rend le renouvellement *anticipé*
        obligatoire et non simplement prudent : passé l'échéance, il n'y a plus
        de renouvellement du tout, seulement une reconnexion par le créateur.
        """
        corps = await self._lire(
            JETON_RENOUVELLE,
            {"grant_type": "ig_refresh_token", "access_token": access_token},
        )

        jeton = corps.get("access_token")
        if not jeton:
            raise SocialProviderError("aucun jeton dans la réponse de renouvellement")

        duree = corps.get("expires_in")
        return JetonEchange(
            access_token=jeton,
            expires_at=(datetime.now(UTC) + timedelta(seconds=int(duree)) if duree else None),
        )

    async def fetch_identity(self, access_token: str) -> IdentiteSociale:
        profil = await self._lire(PROFIL, {"fields": "id,username", "access_token": access_token})

        identifiant, pseudonyme = profil.get("id"), profil.get("username")
        if not identifiant or not pseudonyme:
            raise SocialProviderError("profil incomplet dans la réponse")

        return IdentiteSociale(external_id=str(identifiant), handle=str(pseudonyme))

    async def fetch_profile_metrics(
        self, access_token: str, *, external_id: str
    ) -> MetriquesProfil:
        profil = await self._lire(
            PROFIL, {"fields": CHAMPS_METRIQUES, "access_token": access_token}
        )

        # Une clé absente et une clé à zéro ne se ressemblent pas : `get` seul
        # les confondrait, et un compte à zéro abonné est une donnée valide.
        manquants = [champ for champ in ("followers_count", "follows_count") if champ not in profil]
        if manquants:
            raise SocialProviderError(f"profil sans {', '.join(manquants)}")

        return MetriquesProfil(
            followers_count=int(profil["followers_count"]),
            following_count=int(profil["follows_count"]),
            # Un compte peut n'avoir jamais publié sans que Meta renvoie la clé.
            media_count=int(profil.get("media_count", 0)),
            # Absente si le compte n'a pas de photo, ou si la portée accordée
            # ne la couvre pas. Ni l'un ni l'autre n'est une panne.
            avatar_url=profil.get("profile_picture_url") or None,
            audience_demographics=await self._audience(access_token, external_id),
            raw_payload=profil,
        )

    async def fetch_media(self, access_token: str, *, permalink: str) -> PublicationVue:
        """La publication désignée par son adresse.

        **Meta n'offre aucun point d'entrée « média par permalien ».** On liste
        donc les publications récentes du compte et on cherche l'adresse. C'est
        le seul chemin disponible, et il porte deux conséquences qu'il vaut
        mieux nommer que découvrir : la recherche est bornée à ce que Meta rend
        sur une page, et une story de plus de vingt-quatre heures n'y est plus.

        Les deux collections sont interrogées — les stories vivent sur un point
        d'entrée séparé, et une story ne figure jamais dans `/me/media`. Les
        stories d'abord : c'est le format le plus fréquent et le plus fragile,
        et l'y trouver évite une seconde requête.

        Lève `PublicationIntrouvable` quand aucune des deux ne la contient : ce
        n'est pas une panne, c'est le cas normal d'une story expirée.
        """
        for collection in (STORIES, MEDIAS):
            page = await self._lire(
                collection, {"fields": CHAMPS_MEDIA, "access_token": access_token}
            )
            for media in page.get("data", []):
                if media.get("permalink") != permalink:
                    continue

                # `username` plutôt que l'identifiant : Basic Display ne rend pas
                # l'identifiant de l'auteur sur un média, et le pseudonyme est ce
                # que la même API rend sur le profil. Les deux se comparent donc.
                auteur = media.get("username")
                horodatage = media.get("timestamp")
                if not auteur or not horodatage:
                    # Sans auteur ni horodatage, il n'y a rien à vérifier — et
                    # rendre un objet à moitié rempli ferait passer l'absence
                    # pour une non-correspondance.
                    raise SocialProviderError("média sans auteur ni horodatage")

                return PublicationVue(
                    media_id=str(media["id"]),
                    author_external_id=str(auteur),
                    media_type=str(media.get("media_type", "")),
                    published_at=datetime.fromisoformat(horodatage.replace("Z", "+00:00")),
                    permalink=permalink,
                    caption=media.get("caption"),
                    raw_payload=media,
                )

        raise PublicationIntrouvable(permalink)

    async def _audience(self, access_token: str, external_id: str) -> dict | None:
        """L'audience est un supplément, jamais une condition.

        Meta la refuse pour un compte trop petit, pour un type de compte qui n'y
        a pas droit, ou pour une permission non accordée — trois situations
        normales. Faire échouer le relevé pour ça reviendrait à ne jamais rien
        enregistrer des comptes les plus nombreux.
        """
        repartitions: dict[str, dict[str, int]] = {}

        for axe in AXES_AUDIENCE:
            try:
                corps = await self._lire(
                    INSIGHTS.format(identifiant=external_id),
                    {
                        "metric": "follower_demographics",
                        "period": "lifetime",
                        "metric_type": "total_value",
                        "breakdown": axe,
                        "access_token": access_token,
                    },
                )
            except SocialProviderError:
                continue

            valeurs = self._depiler(corps)
            if valeurs:
                repartitions[axe] = valeurs

        return repartitions or None

    @staticmethod
    def _depiler(corps: dict) -> dict[str, int]:
        """Aplatit la réponse d'insights en « valeur → effectif ».

        Meta l'imbrique sur quatre niveaux pour permettre les croisements
        d'axes ; nous n'en demandons qu'un, donc chaque ligne n'a qu'une
        dimension.
        """
        resultat: dict[str, int] = {}

        for mesure in corps.get("data") or []:
            for repartition in (mesure.get("total_value") or {}).get("breakdowns") or []:
                for ligne in repartition.get("results") or []:
                    dimensions = ligne.get("dimension_values") or []
                    if len(dimensions) == 1 and isinstance(ligne.get("value"), int):
                        resultat[str(dimensions[0])] = ligne["value"]

        return resultat

    # ----------------------------------------------------------------------

    async def _poster(self, url: str, data: dict) -> dict:
        return self._corps(await self._appeler(self._client.post, url, data=data))

    async def _lire(self, url: str, params: dict) -> dict:
        return self._corps(await self._appeler(self._client.get, url, params=params))

    @staticmethod
    async def _appeler(methode, url: str, **kwargs) -> httpx.Response:
        """Une panne de réseau est un échec de la plateforme, pas une exception
        technique qui traverse le service jusqu'à la route."""
        try:
            return await methode(url, timeout=DELAI, **kwargs)
        except httpx.HTTPError as error:
            raise SocialProviderError(f"Instagram injoignable : {type(error).__name__}") from error

    @staticmethod
    def _corps(reponse: httpx.Response) -> dict:
        """Le message d'erreur de Meta n'est jamais renvoyé à l'appelant.

        Il parle de leur API, pas de ce que le créateur doit faire, et peut
        contenir des éléments de la requête. En revanche sa *nature* remonte,
        parce qu'elle décide de la suite : un jeton refusé fait basculer le
        compte, une panne ne fait rien.
        """
        if reponse.status_code >= 400:
            if InstagramProvider._est_authentification(reponse):
                raise SocialAuthError(f"Instagram a refusé le jeton ({reponse.status_code})")
            raise SocialProviderError(f"Instagram a répondu {reponse.status_code}")

        try:
            corps = reponse.json()
        except ValueError as error:
            raise SocialProviderError("réponse Instagram illisible") from error

        if not isinstance(corps, dict):
            raise SocialProviderError("réponse Instagram inattendue")
        return corps

    @staticmethod
    def _est_authentification(reponse: httpx.Response) -> bool:
        """Meta répond « 400 » à peu près à tout, y compris à un jeton mort.

        Le code HTTP seul ne suffit donc pas : c'est le corps qui distingue un
        jeton révoqué d'un paramètre mal formé. Sans cette lecture, ou bien on
        déconnecterait des comptes valides sur une faute de frappe, ou bien on
        laisserait indéfiniment actif un compte dont l'accès est perdu.
        """
        if reponse.status_code in (401, 403):
            return True

        try:
            erreur = reponse.json().get("error") or {}
        except (ValueError, AttributeError):
            return False

        return (
            erreur.get("type") == "OAuthException" or erreur.get("code") in CODES_AUTHENTIFICATION
        )
