"""Rattachement d'un compte social.

Deux moments : on démarre un parcours, on le termine. Entre les deux, le
créateur est chez le fournisseur et nous n'avons plus la main — d'où l'état,
qui est la seule chose qui relie le retour au départ.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import InvalidToken, TokenType, create_token, decode_token
from app.integrations.social import SocialProvider
from app.models import OAuthState, SocialAccount, User
from app.models.enums import JobType, Platform, SocialAccountStatus, VerificationStatus
from app.services import jobs as job_service


class SocialAccountError(Exception):
    """Base des erreurs de rattachement."""


class InvalidOAuthState(SocialAccountError):
    """État absent, mal signé, expiré, déjà consommé, ou d'un autre utilisateur."""


class AccountTakenByAnotherCreator(SocialAccountError):
    """Ce compte social appartient déjà à quelqu'un d'autre."""


class AdresseDeRetourRefusee(Exception):
    """L'adresse de retour n'est pas d'un schéma autorisé.

    Refusée **à l'ouverture** et non au rappel : au rappel, la personne a déjà
    autorisé chez Meta, et lui dire à ce moment-là que son application ne
    convient pas laisse un compte à moitié rattaché et personne pour le voir.
    """


def _verifier_l_adresse_de_retour(retour: str) -> None:
    schema = urlsplit(retour).scheme.lower()
    # Le schéma d'Expo Go porte parfois un suffixe : `exp+bind://`.
    racine = schema.split("+", 1)[0]
    if racine not in get_settings().oauth_return_schemes:
        raise AdresseDeRetourRefusee(f"schéma non autorisé : {schema or 'aucun'}")


async def start_authorization(
    session: AsyncSession, *, user: User, provider: SocialProvider, retour: str | None = None
) -> str:
    """Ouvre un parcours et rend l'URL vers laquelle envoyer le créateur.

    `retour` est l'adresse de l'application, quand elle en a une. Le rappel
    d'autorisation arrive sur le serveur, pas sur le téléphone : sans elle, le
    parcours se termine sur une réponse JSON dans le navigateur, et l'app ne
    sait jamais que le compte a été rattaché.
    """
    settings = get_settings()
    duree = timedelta(seconds=settings.oauth_state_ttl_seconds)

    if retour is not None:
        _verifier_l_adresse_de_retour(retour)

    etat = OAuthState(
        user_id=user.id,
        platform=provider.platform,
        expires_at=datetime.now(UTC) + duree,
        return_url=retour,
    )
    session.add(etat)
    await session.flush()

    # Le `jti` du jeton signé est l'identifiant de la ligne : la signature
    # écarte les états fabriqués sans toucher la base, la ligne les rend à
    # usage unique.
    signe = create_token(
        subject=user.id,
        token_type=TokenType.OAUTH_STATE,
        token_id=etat.id,
        lifetime=duree,
    )
    return provider.authorization_url(state=signe)


async def _consommer_etat(session: AsyncSession, state: str, platform: Platform) -> OAuthState:
    try:
        claims = decode_token(state, expected_type=TokenType.OAUTH_STATE)
    except InvalidToken as error:
        raise InvalidOAuthState(str(error)) from error

    etat = await session.get(OAuthState, claims.token_id)

    # Les cinq refus partagent une seule erreur, volontairement : distinguer
    # « état inconnu » de « état déjà utilisé » renseignerait qui tâtonne.
    if etat is None or etat.platform is not platform:
        raise InvalidOAuthState("état inconnu")
    if etat.user_id != claims.subject:
        raise InvalidOAuthState("état d'un autre utilisateur")
    if etat.consumed_at is not None:
        raise InvalidOAuthState("état déjà consommé")
    if etat.expires_at <= datetime.now(UTC):
        raise InvalidOAuthState("état expiré")

    etat.consumed_at = datetime.now(UTC)
    await session.flush()
    return etat


@dataclass(frozen=True, slots=True)
class Rattachement:
    """Le compte rattaché, et où ramener la personne.

    L'adresse de retour voyage avec le résultat plutôt que d'être relue après
    coup : l'état est consommé, et le relire demanderait de le garder vivant
    plus longtemps que nécessaire.
    """

    compte: SocialAccount
    retour: str | None


async def _planifier_le_suivi(session: AsyncSession, account_id: uuid.UUID) -> None:
    """Le premier relevé et le renouvellement de jeton, dès le rattachement.

    Ils étaient laissés à la réconciliation périodique — celle qui aligne la
    file sur l'état des comptes. Correct pour un compte de longue date, faux
    pour un compte qu'on vient de rattacher : tant qu'elle n'a pas tourné,
    aucun relevé n'existe, le moteur de paliers n'a aucun chiffre à juger, et
    le créateur voit un fil vide juste après avoir connecté son compte. C'est
    exactement le moment où il conclut que le produit ne marche pas.

    `planifier` ne touche pas un job existant : appelée à chaque reconnexion,
    elle ne repousse rien et ne réarme rien.
    """
    for travail in (JobType.TOKEN_REFRESH, JobType.METRICS_REFRESH):
        await job_service.planifier(session, job_type=travail, target_id=account_id)


async def adresse_de_retour(session: AsyncSession, *, state: str) -> str | None:
    """L'adresse de retour d'un parcours, même une fois l'état consommé.

    Sert aux échecs : l'état a déjà été consommé quand l'échange ou le
    rattachement échoue, et sans cette relecture un échec ne reviendrait pas
    dans l'application — elle attendrait un retour qui n'arrive jamais.

    Ne valide rien : la validation a eu lieu, ou elle a échoué et le parcours
    s'arrête de toute façon. Toute anomalie rend `None`, ce qui fait retomber
    l'appelant sur une erreur HTTP ordinaire.
    """
    try:
        claims = decode_token(state, expected_type=TokenType.OAUTH_STATE)
    except InvalidToken:
        return None
    etat = await session.get(OAuthState, claims.token_id)
    return etat.return_url if etat is not None else None


async def complete_authorization(
    session: AsyncSession, *, state: str, code: str, provider: SocialProvider
) -> Rattachement:
    """Termine le parcours : consomme l'état, échange le code, rattache le compte."""
    etat = await _consommer_etat(session, state, provider.platform)
    retour = etat.return_url

    jeton = await provider.exchange_code(code)
    identite = await provider.fetch_identity(jeton.access_token)

    existant = await session.scalar(
        sa.select(SocialAccount).where(
            SocialAccount.platform == provider.platform,
            SocialAccount.external_id == identite.external_id,
        )
    )

    if existant is not None and existant.creator_id != etat.user_id:
        # L'unicité (platform, external_id) l'interdirait de toute façon, mais
        # une violation brute ne dirait pas *pourquoi* c'est refusé.
        raise AccountTakenByAnotherCreator(identite.external_id)

    if existant is not None:
        # Reconnexion : on met à jour, on ne duplique pas. Ce n'est pas un
        # conflit — c'est le geste normal quand un jeton a expiré.
        existant.handle = identite.handle
        existant.access_token_encrypted = jeton.access_token
        existant.refresh_token_encrypted = jeton.refresh_token
        existant.token_expires_at = jeton.expires_at
        existant.status = SocialAccountStatus.ACTIVE
        existant.last_synced_at = None
        await session.flush()
        await _planifier_le_suivi(session, existant.id)
        return Rattachement(compte=existant, retour=retour)

    compte = SocialAccount(
        creator_id=etat.user_id,
        platform=provider.platform,
        external_id=identite.external_id,
        handle=identite.handle,
        access_token_encrypted=jeton.access_token,
        refresh_token_encrypted=jeton.refresh_token,
        token_expires_at=jeton.expires_at,
        status=SocialAccountStatus.ACTIVE,
        # La vérification de cohérence du profil est une tâche à part : le
        # compte arrive donc en revue, et ne réserve rien tant qu'elle n'a pas
        # tranché.
        verification_status=VerificationStatus.NEEDS_REVIEW,
    )
    session.add(compte)
    await session.flush()
    await _planifier_le_suivi(session, compte.id)
    return Rattachement(compte=compte, retour=retour)


async def list_accounts(session: AsyncSession, creator_id: uuid.UUID) -> list[SocialAccount]:
    statement = (
        sa.select(SocialAccount)
        .where(SocialAccount.creator_id == creator_id)
        .order_by(SocialAccount.connected_at)
    )
    return list(await session.scalars(statement))
