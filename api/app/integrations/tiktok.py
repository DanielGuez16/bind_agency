"""TikTok, en bac à sable.

**Le bac à sable n'est pas un mode de notre code**, c'est un état de
l'application côté TikTok : tant qu'elle n'est pas revue, elle ne sert que les
comptes explicitement inscrits comme testeurs. Les appels sont les vrais, les
adresses sont les vraies, les jetons sont les vrais. Ce qui change est la liste
des comptes qui peuvent répondre.

D'où le seul usage de `tiktok_sandbox` : quand la plateforme refuse un compte
non inscrit, elle rend un `access_denied` indistinct d'un vrai refus
d'autorisation. Le drapeau permet de dire « ce compte n'est pas inscrit au bac
à sable » plutôt que « échec » — sans lui, chaque essai de démonstration
ressemblerait à un défaut du produit.

**TikTok renouvelle avec un jeton de renouvellement séparé**, contrairement à
Meta. C'est précisément pour cela que l'interface porte les deux paramètres :
un seul aurait obligé l'une des deux implémentations à mentir sur ce qu'elle
reçoit.

**`fetch_media` n'existe pas encore** ici non plus. Le niveau 1 de la capture de
preuve l'attend, et il arrivera avec le relevé des publications — une tâche à
part, qui demande de savoir quelles publications appartiennent à quelle
collaboration.
"""

from datetime import UTC, datetime, timedelta

import httpx

from app.core.config import ConfigurationError, get_settings
from app.integrations.social import (
    IdentiteSociale,
    JetonEchange,
    MetriquesProfil,
    SocialAuthError,
    SocialProviderError,
)
from app.models.enums import Platform

AUTORISATION = "https://www.tiktok.com/v2/auth/authorize/"
JETON = "https://open.tiktokapis.com/v2/oauth/token/"
PROFIL = "https://open.tiktokapis.com/v2/user/info/"

#: Ce que TikTok sait rendre sur un profil, et que la base sait ranger.
#: `video_count` tient lieu de `media_count` : ce n'est pas la même chose qu'un
#: post Instagram, mais c'est le compteur de publications de la plateforme, et
#: le contrôle de cohérence n'en demande pas plus.
CHAMPS_PROFIL = "open_id,username,display_name,follower_count,following_count,video_count"


class TikTokProvider:
    platform = Platform.TIKTOK
    #: Il parle à la vraie plateforme : les comptes qu'il rattache sont réels.
    mode = "live"

    def __init__(self, client: httpx.AsyncClient) -> None:
        settings = get_settings()

        if not (
            settings.tiktok_client_key
            and settings.tiktok_client_secret
            and settings.tiktok_redirect_uri
        ):
            # Comme Instagram : refuser d'exister plutôt que partir avec des
            # valeurs vides et échouer plus loin, chez TikTok, avec un message
            # à eux que personne ici ne sait lire.
            raise ConfigurationError(
                "application TikTok non configurée : TIKTOK_CLIENT_KEY, "
                "TIKTOK_CLIENT_SECRET et TIKTOK_REDIRECT_URI sont attendus"
            )

        self._client = client
        self._cle = settings.tiktok_client_key
        self._secret = settings.tiktok_client_secret.get_secret_value()
        self._redirect_uri = settings.tiktok_redirect_uri
        self._scopes = settings.tiktok_scopes
        self._sandbox = settings.tiktok_sandbox

    # ----------------------------------------------------------------------

    def authorization_url(self, *, state: str) -> str:
        parametres = httpx.QueryParams(
            {
                "client_key": self._cle,
                "redirect_uri": self._redirect_uri,
                "scope": ",".join(self._scopes),
                "response_type": "code",
                "state": state,
            }
        )
        return f"{AUTORISATION}?{parametres}"

    async def exchange_code(self, code: str) -> JetonEchange:
        corps = await self._poster(
            {
                "client_key": self._cle,
                "client_secret": self._secret,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": self._redirect_uri,
            }
        )
        return self._jeton(corps)

    async def refresh_token(
        self, *, access_token: str, refresh_token: str | None = None
    ) -> JetonEchange:
        """TikTok exige le jeton de renouvellement, pas le jeton d'accès.

        Sans lui il n'y a rien à faire : le signaler comme un défaut
        d'autorisation plutôt que comme une panne évite au travailleur de fond
        de réessayer indéfiniment quelque chose qui ne peut pas aboutir.
        """
        if not refresh_token:
            raise SocialAuthError("TikTok exige un jeton de renouvellement")

        corps = await self._poster(
            {
                "client_key": self._cle,
                "client_secret": self._secret,
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
            }
        )
        return self._jeton(corps)

    async def fetch_identity(self, access_token: str) -> IdentiteSociale:
        donnees = await self._lire_le_profil(access_token)
        identifiant, pseudonyme = donnees.get("open_id"), donnees.get("username")
        if not identifiant or not pseudonyme:
            raise SocialProviderError("profil incomplet dans la réponse")
        return IdentiteSociale(external_id=str(identifiant), handle=str(pseudonyme))

    async def fetch_profile_metrics(
        self, access_token: str, *, external_id: str
    ) -> MetriquesProfil:
        donnees = await self._lire_le_profil(access_token)

        manquants = [
            champ
            for champ in ("follower_count", "following_count", "video_count")
            if donnees.get(champ) is None
        ]
        if manquants:
            # Jamais un objet à moitié rempli : mettre zéro pour « je ne sais
            # pas » inventerait un chiffre que personne ne pourrait distinguer
            # d'un vrai.
            raise SocialProviderError(f"compteurs absents : {', '.join(manquants)}")

        return MetriquesProfil(
            followers_count=int(donnees["follower_count"]),
            following_count=int(donnees["following_count"]),
            media_count=int(donnees["video_count"]),
            # TikTok ne donne pas de répartition d'audience sur cette portée.
            audience_demographics=None,
            raw_payload=donnees,
        )

    # ----------------------------------------------------------------------

    def _jeton(self, corps: dict) -> JetonEchange:
        acces = corps.get("access_token")
        if not acces:
            raise SocialProviderError("aucun jeton dans la réponse")

        duree = corps.get("expires_in")
        return JetonEchange(
            access_token=str(acces),
            refresh_token=corps.get("refresh_token"),
            expires_at=(datetime.now(UTC) + timedelta(seconds=int(duree)) if duree else None),
        )

    async def _poster(self, donnees: dict[str, str]) -> dict:
        try:
            reponse = await self._client.post(
                JETON,
                data=donnees,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        except httpx.HTTPError as error:
            raise SocialProviderError(str(error)) from error
        return self._corps(reponse)

    async def _lire_le_profil(self, access_token: str) -> dict:
        try:
            reponse = await self._client.get(
                PROFIL,
                params={"fields": CHAMPS_PROFIL},
                headers={"Authorization": f"Bearer {access_token}"},
            )
        except httpx.HTTPError as error:
            raise SocialProviderError(str(error)) from error

        corps = self._corps(reponse)
        # TikTok emboîte : `{"data": {"user": {...}}}`.
        return corps.get("data", {}).get("user", {})

    def _corps(self, reponse: httpx.Response) -> dict:
        try:
            corps = reponse.json()
        except ValueError as error:
            raise SocialProviderError("réponse illisible") from error

        # TikTok rend 200 avec une erreur dans le corps aussi souvent qu'un
        # code HTTP. Les deux mènent ici.
        erreur = corps.get("error")
        code = erreur.get("code") if isinstance(erreur, dict) else corps.get("error")

        if reponse.status_code >= 400 or (code and code != "ok"):
            message = (
                erreur.get("message")
                if isinstance(erreur, dict)
                else corps.get("error_description")
            ) or "erreur TikTok"

            if code in {"access_denied", "invalid_grant", "invalid_request"}:
                if self._sandbox:
                    # Le message qui évite de chercher un défaut là où il n'y en
                    # a pas : en bac à sable, un compte non inscrit produit
                    # exactement ce refus.
                    raise SocialAuthError(
                        f"{message} — application TikTok en bac à sable : "
                        "seuls les comptes inscrits comme testeurs sont servis"
                    )
                raise SocialAuthError(message)

            raise SocialProviderError(message)

        return corps
