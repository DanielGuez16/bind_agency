"""Relevé et historisation des métriques sociales.

Trois règles tiennent tout le reste.

**Ajout seul.** Un snapshot n'est jamais modifié ni supprimé. Deux relevés
successifs font deux lignes même à chiffres identiques, parce que « les chiffres
n'ont pas bougé entre lundi et mardi » est une information, et qu'écraser la
ligne de lundi la détruirait. C'est aussi ce qui rend l'historique opposable :
un créateur dont l'éligibilité change doit pouvoir voir sur quoi elle s'est
appuyée.

**Tout ou rien.** Un relevé qui échoue n'écrit pas de ligne. Pas de ligne
partielle, pas de zéro « en attendant » : un zéro se lit comme un compte vide,
et l'éligibilité le prendrait au mot. Une réponse incomplète est un échec, pas
un demi-succès — sauf pour ce que la table déclare nullable, qui a le droit de
manquer.

**Distinguer les échecs.** Un jeton refusé et un serveur en panne ne demandent
pas la même suite. Le premier fait basculer le compte en `expired` : l'accès est
perdu, seule une reconnexion le rétablira, et le laisser `active` afficherait au
créateur un compte qui ne rapporte plus rien. Le second ne touche à rien : la
panne passera, et déconnecter un compte à chaque hoquet réseau ferait
recommencer un parcours OAuth pour rien.
"""

import logging
import uuid
from datetime import UTC, datetime, timedelta

import httpx
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.integrations.social import SocialAuthError, SocialProvider, SocialProviderError
from app.models import SocialAccount, SocialMetricsSnapshot
from app.models.enums import SocialAccountStatus
from app.services import account_verification, social_accounts, storage

logger = logging.getLogger(__name__)

#: Court : la photo est un accessoire, et le relevé ne doit pas attendre.
DELAI_AVATAR = httpx.Timeout(5.0)


class MetricsError(Exception):
    """Base des refus de relevé."""


class SocialAccountNotFound(MetricsError):
    """Compte inexistant, ou appartenant à un autre créateur.

    Les deux cas partagent une erreur : répondre « il existe mais pas à vous »
    dirait à qui tâtonne quels identifiants sont attribués.
    """


class SocialAccountNotActive(MetricsError):
    """Compte expiré ou révoqué : il n'y a plus de jeton à présenter."""


class RefreshTooSoon(MetricsError):
    """Relevé déjà fait récemment pour ce compte."""


class SocialTokenExpired(MetricsError):
    """La plateforme a refusé le jeton. Le compte vient de basculer en expired."""


async def get_owned_account(
    session: AsyncSession, *, account_id: uuid.UUID, creator_id: uuid.UUID
) -> SocialAccount:
    compte = await session.get(SocialAccount, account_id)
    if compte is None or compte.creator_id != creator_id:
        raise SocialAccountNotFound(str(account_id))
    return compte


class SocialAccountFromOtherProvider(Exception):
    """Rattaché sous un autre fournisseur : rien ne le récupérera.

    Distinct de « compte inactif » parce que le geste diffère : un compte
    inactif se reconnecte, celui-ci ne se reconnecte pas — il faut en rattacher
    un autre.
    """


async def refresh_profile_metrics(
    session: AsyncSession, *, account: SocialAccount, provider: SocialProvider
) -> SocialMetricsSnapshot:
    """Interroge la plateforme et enregistre un snapshot, ou n'écrit rien."""
    settings = get_settings()

    if not social_accounts.reconnectable(account):
        # Le compte vient d'un autre fournisseur : son jeton n'existe chez
        # personne. Sans cette garde, on part interroger la vraie plateforme
        # avec un jeton de démonstration, et l'échec revient sous la forme
        # « la plateforme est indisponible » — ce qui accuse un tiers pour une
        # cause locale, et laisse chercher une panne qui n'existe pas.
        raise SocialAccountFromOtherProvider(str(account.id))

    if (
        account.status is not SocialAccountStatus.ACTIVE
        or account.external_id is None
        or account.access_token_encrypted is None
    ):
        # `external_id` nul signe un compte anonymisé, un jeton nul un compte
        # vidé. Le `status` devrait déjà le dire ; le relire ici évite surtout
        # d'envoyer `None` à la plateforme si jamais il ne le disait pas.
        raise SocialAccountNotActive(str(account.id))

    _refuser_si_trop_tot(account, settings.metrics_min_refresh_interval_seconds)

    # Posé **avant** l'appel, pas après : c'est la tentative qui consomme le
    # quota de la plateforme, pas son succès. L'appelant valide cette écriture
    # quelle que soit l'issue, sans quoi il suffirait d'échouer pour pouvoir
    # recommencer aussitôt.
    account.last_sync_attempt_at = datetime.now(UTC)
    await session.flush()

    try:
        metriques = await provider.fetch_profile_metrics(
            account.access_token_encrypted, external_id=account.external_id
        )
    except SocialAuthError as error:
        # Le seul cas où un échec laisse une trace. L'appelant devra valider la
        # transaction malgré l'erreur qu'il renvoie : le compte est réellement
        # inutilisable, l'oublier obligerait à le redécouvrir au relevé suivant.
        account.status = SocialAccountStatus.EXPIRED
        await session.flush()
        raise SocialTokenExpired(str(account.id)) from error

    snapshot = SocialMetricsSnapshot(
        social_account_id=account.id,
        followers_count=metriques.followers_count,
        following_count=metriques.following_count,
        media_count=metriques.media_count,
        # Ni l'un ni l'autre ne se déduit du profil : ils viendront du relevé
        # des publications. Nuls veut dire « pas encore mesuré », pas « zéro ».
        avg_views=None,
        engagement_rate=None,
        audience_demographics=metriques.audience_demographics,
        raw_payload=metriques.raw_payload,
    )
    session.add(snapshot)

    account.last_synced_at = datetime.now(UTC)
    await session.flush()
    await session.refresh(snapshot)

    # Le contrôle de cohérence s'exécute ici, et pas au rattachement du compte :
    # sans relevé il n'aurait rien à regarder. Ici plutôt que dans la route,
    # parce que le job planifié devra le déclencher aussi et qu'un enchaînement
    # posé dans une route ne vaut que pour cette route.
    # **Après le snapshot, et sans pouvoir le défaire.** La photo est un
    # accessoire de l'annuaire ; les compteurs ouvrent des paliers.
    await _ranger_l_avatar(session, account=account, adresse=metriques.avatar_url)

    await account_verification.verifier(session, account=account)
    return snapshot


def _refuser_si_trop_tot(account: SocialAccount, intervalle_secondes: int) -> None:
    """La fréquence est bornée par compte, pas par créateur ni globalement.

    Le quota que cela protège est celui de la plateforme, qui le compte par
    compte. Une limite par créateur punirait celui qui en a trois ; une limite
    globale ferait qu'un créateur actif empêche les autres de se relever.

    La borne se lit sur la dernière **tentative**, pas sur le dernier succès.
    S'appuyer sur le succès seul laissait une porte ouverte : un relevé qui
    échoue ne consommait rien, donc échouer permettait de recommencer aussitôt,
    en boucle, ce qui est exactement le comportement contre lequel la borne
    existe.
    """
    dernier = max(
        (d for d in (account.last_synced_at, account.last_sync_attempt_at) if d is not None),
        default=None,
    )
    if dernier is None:
        return

    if datetime.now(UTC) < dernier + timedelta(seconds=intervalle_secondes):
        raise RefreshTooSoon(str(account.id))


async def latest_snapshot(
    session: AsyncSession, account_id: uuid.UUID
) -> SocialMetricsSnapshot | None:
    statement = (
        sa.select(SocialMetricsSnapshot)
        .where(SocialMetricsSnapshot.social_account_id == account_id)
        .order_by(SocialMetricsSnapshot.captured_at.desc())
        .limit(1)
    )
    return await session.scalar(statement)


__all__ = [
    "MetricsError",
    "RefreshTooSoon",
    "SocialAccountNotActive",
    "SocialAccountNotFound",
    "SocialProviderError",
    "SocialTokenExpired",
    "get_owned_account",
    "latest_snapshot",
    "refresh_profile_metrics",
]


#: Où sont rangées les photos de profil. Sous `photos/`, donc dans le
#: compartiment public : un visage d'annuaire se sert à une balise d'image, qui
#: ne porte pas d'en-tête d'autorisation.
PREFIXE_AVATAR = "photos/avatars"

#: Au-delà, on ne range pas. Une photo de profil pèse quelques dizaines de
#: kilooctets ; un mégaoctet signale qu'on télécharge autre chose qu'un avatar,
#: et le dépôt n'est pas l'endroit où s'en apercevoir.
AVATAR_MAX_OCTETS = 1_000_000


async def _ranger_l_avatar(
    session: AsyncSession, *, account: SocialAccount, adresse: str | None
) -> None:
    """Télécharge la photo de profil et n'en garde qu'une clé.

    **Jamais l'adresse de la plateforme.** Les deux fournisseurs servent des URL
    signées qui expirent en quelques heures : rangée telle quelle, elle donnerait
    un annuaire dont les visages disparaissent entre deux relevés — et cela
    ressemblerait à une panne de notre côté.

    **Un échec ne fait pas échouer le relevé.** Les compteurs sont ce qui ouvre
    des paliers ; perdre un relevé d'audience parce qu'un réseau de diffusion a
    hoqueté serait échanger l'essentiel contre l'accessoire. La photo précédente
    reste alors en place, ce qui est le bon repli : elle est vieille, pas fausse.
    """
    if not adresse:
        return

    try:
        async with httpx.AsyncClient(timeout=DELAI_AVATAR) as client:
            reponse = await client.get(adresse, follow_redirects=True)
            reponse.raise_for_status()
            contenu = reponse.content
    except Exception:
        logger.warning("photo de profil non relevée", extra={"social_account_id": str(account.id)})
        return

    if not contenu or len(contenu) > AVATAR_MAX_OCTETS:
        return

    try:
        # **Par le dépôt d'avatar et non par le dépôt brut** : c'est lui qui
        # produit l'aperçu flouté, sans lequel un salon non abonné n'aurait
        # rien à voir — ou pire, verrait la photo nette.
        account.avatar_key = await storage.deposer_un_avatar(contenu, prefixe=PREFIXE_AVATAR)
        await session.flush()
    except Exception:
        logger.warning("photo de profil non rangée", extra={"social_account_id": str(account.id)})
