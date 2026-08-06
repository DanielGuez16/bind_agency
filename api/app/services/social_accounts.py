"""Rattachement d'un compte social.

Deux moments : on démarre un parcours, on le termine. Entre les deux, le
créateur est chez le fournisseur et nous n'avons plus la main — d'où l'état,
qui est la seule chose qui relie le retour au départ.
"""

import uuid
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import InvalidToken, TokenType, create_token, decode_token
from app.integrations.social import SocialProvider
from app.models import OAuthState, SocialAccount, User
from app.models.enums import Platform, SocialAccountStatus, VerificationStatus


class SocialAccountError(Exception):
    """Base des erreurs de rattachement."""


class InvalidOAuthState(SocialAccountError):
    """État absent, mal signé, expiré, déjà consommé, ou d'un autre utilisateur."""


class AccountTakenByAnotherCreator(SocialAccountError):
    """Ce compte social appartient déjà à quelqu'un d'autre."""


async def start_authorization(
    session: AsyncSession, *, user: User, provider: SocialProvider
) -> str:
    """Ouvre un parcours et rend l'URL vers laquelle envoyer le créateur."""
    settings = get_settings()
    duree = timedelta(seconds=settings.oauth_state_ttl_seconds)

    etat = OAuthState(
        user_id=user.id,
        platform=provider.platform,
        expires_at=datetime.now(UTC) + duree,
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


async def complete_authorization(
    session: AsyncSession, *, state: str, code: str, provider: SocialProvider
) -> SocialAccount:
    """Termine le parcours : consomme l'état, échange le code, rattache le compte."""
    etat = await _consommer_etat(session, state, provider.platform)

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
        return existant

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
    return compte


async def list_accounts(session: AsyncSession, creator_id: uuid.UUID) -> list[SocialAccount]:
    statement = (
        sa.select(SocialAccount)
        .where(SocialAccount.creator_id == creator_id)
        .order_by(SocialAccount.connected_at)
    )
    return list(await session.scalars(statement))
