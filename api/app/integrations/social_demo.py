"""Plateformes sociales en mode démonstration.

**Aucun code de démonstration n'existe dans les services.** Ce fichier est une
implémentation de plus derrière `SocialProvider` — celle qui répond de mémoire
au lieu de répondre du réseau. Le service de rattachement, celui des métriques
et le contrôle de cohérence ne savent pas laquelle ils tiennent, et il n'existe
nulle part de branche conditionnelle sur le mode.

**Le chemin est le vrai chemin.** État signé, à usage unique, échangé contre un
jeton, identité relue, métriques relevées. Un raccourci — poser une ligne
`social_account` à la main — dirait que tout va bien sans avoir rien parcouru ;
c'est exactement ce que le jeu de données de départ évitait déjà.

**Le profil est dérivé du handle, de façon déterministe.** Deux exécutions du
jeu de données produisent les mêmes chiffres, sinon une démonstration ne se
rejoue pas et un test ne se reproduit pas. La dérivation est un simple hachage :
elle ne cherche pas à être réaliste, elle cherche à être stable et variée.

**Les états dégradés se déclarent, ils ne s'improvisent pas.** Un jeton déjà
expiré, un compte que la plateforme refuse : ce sont des paramètres du
fournisseur, pas des exceptions lancées au hasard. C'est ce qui permet au jeu de
données de produire un créateur « autorisation expirée » sans écrire une ligne
en base à la main.
"""

import hashlib
from datetime import UTC, datetime, timedelta

from app.integrations.social import (
    IdentiteSociale,
    JetonEchange,
    MetriquesProfil,
    PublicationIntrouvable,
    PublicationVue,
    SocialAuthError,
)
from app.models.enums import Platform


def _graine(handle: str) -> int:
    """Un entier stable tiré du handle. Même handle, même profil, toujours."""
    return int(hashlib.sha256(handle.encode()).hexdigest()[:12], 16)


class DemoSocialProvider:
    """Une plateforme qui répond de mémoire.

    `platform` est un paramètre : le même fournisseur sert Instagram et TikTok
    en démonstration, parce que du point de vue du produit ils ne diffèrent que
    par le nom qu'ils portent et les paliers qu'ils ouvrent.
    """

    def __init__(
        self,
        *,
        platform: Platform = Platform.INSTAGRAM,
        handle: str = "demo.creator",
        followers: int | None = None,
        media_count: int | None = None,
        #: Durée de vie du jeton. Négative pour produire un compte dont
        #: l'autorisation est **déjà** expirée — l'état que le créateur voit
        #: quand Instagram a atteint ses soixante jours.
        token_ttl: timedelta = timedelta(days=60),
        #: Refuse l'échange, comme une plateforme qui a révoqué l'application.
        refuse_l_echange: bool = False,
    ) -> None:
        self.platform = platform
        # Ce qu'il est, et non ce que la configuration déclare : le jeu de
        # données construit ce fournisseur même quand le mode dit « live ».
        self.mode = "demo"
        self.handle = handle
        self._graine = _graine(handle)
        # Entre 800 et 120 000 : assez bas pour qu'un créateur reste sous le
        # premier palier, assez haut pour qu'un autre les ouvre tous.
        self.followers = followers if followers is not None else 800 + self._graine % 119_200
        self.media_count = media_count if media_count is not None else 12 + self._graine % 400
        self._token_ttl = token_ttl
        self._refuse = refuse_l_echange
        #: Le dernier état émis. Le parcours réel le fait transiter par le
        #: navigateur du créateur ; ici on le retient au vol pour le rendre au
        #: rappel, sans court-circuiter sa signature ni son usage unique.
        self.etat: str | None = None

    def authorization_url(self, *, state: str) -> str:
        self.etat = state
        return f"https://{self.platform.value}.demo.bind/authorize?state={state}"

    async def exchange_code(self, code: str) -> JetonEchange:
        if self._refuse:
            raise SocialAuthError("la plateforme a refusé l'échange (démonstration)")
        return JetonEchange(
            access_token=f"demo-{self.platform.value}-{self.handle}",
            refresh_token=f"demo-refresh-{self.handle}",
            expires_at=datetime.now(UTC) + self._token_ttl,
        )

    async def refresh_token(
        self, *, access_token: str, refresh_token: str | None = None
    ) -> JetonEchange:
        if self._refuse:
            raise SocialAuthError("la plateforme a refusé le renouvellement (démonstration)")
        return JetonEchange(
            access_token=access_token,
            refresh_token=refresh_token,
            expires_at=datetime.now(UTC) + self._token_ttl,
        )

    async def fetch_identity(self, access_token: str) -> IdentiteSociale:
        return IdentiteSociale(
            external_id=f"demo-{self.platform.value}-{self._graine}", handle=self.handle
        )

    async def fetch_profile_metrics(
        self, access_token: str, *, external_id: str
    ) -> MetriquesProfil:
        # Ni `avg_views` ni `engagement_rate` : ils se calculent sur les
        # publications, pas sur le profil, et l'interface ne les porte pas. Les
        # inventer ici ferait passer pour mesuré un signal qui ne l'est pas —
        # exactement ce que le contrôle de cohérence doit pouvoir distinguer.
        return MetriquesProfil(
            followers_count=self.followers,
            following_count=max(self.followers // 12, 40),
            media_count=self.media_count,
            # **Le mode démonstration n'invente pas de photo.** Une adresse
            # fabriquée mènerait à un 404 que le relevé confondrait avec une
            # panne réseau, et l'annuaire montrerait un cadre vide en croyant
            # montrer quelqu'un.
            avatar_url=None,
            audience_demographics={"country": {"US": self.followers}},
            raw_payload={
                "followers_count": self.followers,
                "media_count": self.media_count,
                "source": "demo",
            },
        )

    async def fetch_media(self, access_token: str, *, permalink: str) -> PublicationVue:
        """La publication décrite depuis son adresse, sans réseau.

        **Le fournisseur de démonstration doit pouvoir produire les deux
        issues**, sinon la chaîne de vérification n'est éprouvable que dans le
        cas qui marche. L'adresse porte donc la consigne : elle contient
        `expiree` pour obtenir une `PublicationIntrouvable` — le cas normal
        d'une story de plus de vingt-quatre heures — et le mot d'un format
        (`story`, `post`, `reel`) pour choisir ce que la plateforme répond.

        C'est le même procédé que le reste de ce fournisseur : la démonstration
        se pilote par les données qu'on lui donne, jamais par un réglage caché.
        """
        if "expiree" in permalink:
            raise PublicationIntrouvable(permalink)

        # Le vocabulaire de **la plateforme**, pas celui du produit : c'est tout
        # l'intérêt du champ, et traduire ici masquerait le travail que la
        # correspondance doit faire au-dessus.
        mots = {"story": "STORY", "reel": "REELS", "post": "FEED"}
        type_media = next((valeur for mot, valeur in mots.items() if mot in permalink), "FEED")

        # Publiée à l'instant : la vérification compare cet horodatage à la
        # consommation et à l'échéance, et une date figée ferait échouer l'une
        # ou l'autre selon le jour où le test tourne.
        return PublicationVue(
            media_id=f"demo-media-{abs(hash(permalink)) % 10**10}",
            author_external_id=f"demo-{self.platform.value}-{self._graine}",
            media_type=type_media,
            published_at=datetime.now(UTC),
            permalink=permalink,
            caption=f"Merci {self.handle}",
            raw_payload={"permalink": permalink, "media_type": type_media, "source": "demo"},
        )
