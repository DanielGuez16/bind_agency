"""Confirmer une adresse : émettre le lien, le consommer, le renvoyer.

**Ce que la vérification ferme, et ce qu'elle ne ferme pas.** Un compte non
vérifié entre, regarde le fil, connecte un réseau, prépare son profil. Il ne peut
pas **engager quelqu'un d'autre** : réserver une place chez un commerce, ou
mettre un commerce en ligne. La frontière est là et pas ailleurs — fermer la
porte d'entrée transformerait une adresse mal saisie en compte perdu, et fermer
plus tard laisserait un salon bloquer une place pour une adresse qui n'existe
pas.

**Le jeton n'est jamais stocké.** La base ne porte que son SHA-256, comme la
prise en main et les jetons de rafraîchissement : une fuite de la base ne donne
aucun lien utilisable.

**Un renvoi révoque le précédent.** Deux liens vivants pour une même adresse
feraient qu'un vieux courriel confirme aussi bien que le dernier — et un lien
qu'on croyait périmé rouvrirait la porte.
"""

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import EmailVerification, User
from app.models.enums import UserStatus
from app.services import outbox

#: Trente-deux octets, comme la prise en main. Le lien voyage dans un courriel,
#: qui n'est pas un canal sûr : ce qui le protège est sa durée et son usage
#: unique, pas son secret.
OCTETS_JETON = 32


class VerificationError(Exception):
    """Base des refus de vérification."""


class JetonInconnu(VerificationError):
    """Inconnu, expiré, déjà utilisé, ou révoqué par un renvoi.

    **Une seule erreur pour les quatre, et c'est délibéré.** Distinguer
    « expiré » de « inconnu » dirait à qui essaie des jetons lesquels ont
    existé. Ce que la personne doit faire est le même dans les quatre cas :
    demander un nouveau lien.
    """


class DejaVerifiee(VerificationError):
    """L'adresse est déjà confirmée. Rien à faire, et ce n'est pas un échec."""


def _empreinte(jeton: str) -> bytes:
    return hashlib.sha256(jeton.encode("utf-8")).digest()


async def emettre(session: AsyncSession, *, user: User) -> str:
    """Émet un lien de confirmation et dépose le courriel. Rend le jeton en clair.

    **Le jeton n'est rendu qu'ici, une seule fois.** C'est le seul instant où il
    existe en clair ; la base n'en garde que l'empreinte, et le relire est
    impossible par construction.

    **Le message part par la boîte d'envoi, pas directement.** Il est écrit dans
    la même transaction que le jeton : ou les deux existent, ou aucun. Un envoi
    direct laisserait un jeton sans courriel si le service d'envoi est
    injoignable — c'est-à-dire un compte qui attend un message qui ne viendra
    jamais.
    """
    if user.email is None:
        raise DejaVerifiee(str(user.id))
    if user.email_verified_at is not None:
        raise DejaVerifiee(str(user.id))

    # Le précédent est fermé : deux liens vivants pour une adresse feraient
    # qu'un vieux courriel confirme aussi bien que le dernier.
    await session.execute(
        sa.update(EmailVerification)
        .where(
            EmailVerification.user_id == user.id,
            EmailVerification.used_at.is_(None),
            EmailVerification.revoked_at.is_(None),
        )
        .values(revoked_at=sa.func.clock_timestamp())
    )

    jeton = secrets.token_urlsafe(OCTETS_JETON)
    ligne = EmailVerification(
        user_id=user.id,
        destination=user.email,
        token_hash=_empreinte(jeton),
        expires_at=datetime.now(UTC)
        + timedelta(seconds=get_settings().email_verification_ttl_seconds),
    )
    session.add(ligne)
    await session.flush()

    await outbox.deposer(
        session,
        user_id=user.id,
        cle="account.verification",
        # Le lien entier, construit là où l'adresse publique est connue. Le
        # gabarit ne compose pas d'URL : il en reçoit une.
        lien=_lien(jeton),
        heures=get_settings().email_verification_ttl_seconds // 3600,
    )
    return jeton


def _lien(jeton: str) -> str:
    """L'adresse à ouvrir. **Elle passe par l'API et non par l'app.**

    Un lien qui viserait l'application supposerait qu'elle est installée, ou
    qu'un navigateur sait ouvrir un schéma privé. L'API, elle, répond toujours :
    elle consomme le jeton et renvoie vers l'application quand elle le peut.
    """
    base = (get_settings().api_public_base_url or "").rstrip("/")
    return f"{base}{get_settings().api_v1_prefix}/auth/verify-email?token={jeton}"


async def confirmer(session: AsyncSession, *, jeton: str) -> User:
    """Consomme le jeton et date l'adresse. **Idempotent par le refus**, pas par
    le silence : un second passage lève `JetonInconnu`, ce qui est vrai — il a
    été consommé.
    """
    ligne = await session.scalar(
        sa.select(EmailVerification).where(EmailVerification.token_hash == _empreinte(jeton))
    )
    if ligne is None or ligne.used_at is not None or ligne.revoked_at is not None:
        raise JetonInconnu("jeton absent, consommé ou révoqué")
    if ligne.expires_at <= datetime.now(UTC):
        raise JetonInconnu("jeton expiré")

    user = await session.get(User, ligne.user_id)
    if user is None or user.status is not UserStatus.ACTIVE:
        # Suspendu ou anonymisé entre l'envoi et le clic : il n'y a personne à
        # vérifier, et dater l'adresse d'un compte fermé ne veut rien dire.
        raise JetonInconnu("compte absent ou fermé")

    # **L'adresse visée, pas l'adresse actuelle.** Quelqu'un qui a changé
    # d'adresse entre l'envoi et le clic ne confirme pas la nouvelle avec un
    # lien parti à l'ancienne.
    if user.email != ligne.destination:
        raise JetonInconnu("l'adresse a changé depuis l'envoi")

    ligne.used_at = sa.func.clock_timestamp()
    user.email_verified_at = sa.func.clock_timestamp()
    await session.flush()
    await session.refresh(user, ["email_verified_at"])
    return user


async def a_verifie(session: AsyncSession, user_id: uuid.UUID) -> bool:
    """Une lecture, pour les gardes. Rend faux sur un compte absent."""
    date = await session.scalar(sa.select(User.email_verified_at).where(User.id == user_id))
    return date is not None
