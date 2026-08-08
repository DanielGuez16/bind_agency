"""Ce que le créateur lit de son propre compte : son audience, et son contrôle.

**Ses abonnés sont sa donnée.** Ils n'apparaissaient nulle part : l'éligibilité
s'en servait pour trancher et ne les rendait qu'en creux, sous forme d'un écart
à combler. Un créateur qui a mille huit cents abonnés voyait « il t'en manque
deux cents » sans jamais voir mille huit cents. Le chiffre vient du dernier
relevé et il est **daté** — un chiffre non daté serait pris pour l'instantané
d'aujourd'hui, alors qu'il peut avoir une semaine.

**Le statut de vérification ne promet aucun délai.** Ni objectif, ni estimation,
ni « sous 72 heures ». Une promesse tenue par une file d'attente humaine se
brise le premier jour de charge, et elle se brise auprès de gens qui n'ont rien
fait de mal. On rend la date de démarrage, le compteur de jours se calcule côté
app, et les signaux jugés sont montrés tels quels.

**Les signaux sont recalculés à la lecture, jamais relus d'un cache.** Ils sont
purs — mêmes entrées, même verdict — et le stockage aurait créé une copie qui
vieillit pendant que les relevés bougent.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import SocialAccount, SocialMetricsSnapshot
from app.models.enums import Platform, SocialAccountStatus, VerificationStatus
from app.services import account_verification


@dataclass(frozen=True, slots=True)
class AudienceDuCompte:
    social_account_id: uuid.UUID
    platform: Platform
    handle: str | None
    status: SocialAccountStatus
    verification_status: VerificationStatus
    #: Nuls tant qu'aucun relevé n'existe. « Pas encore mesuré », et non zéro :
    #: afficher zéro abonné à quelqu'un qui en a douze mille serait un défaut
    #: qu'il signalerait avant nous.
    followers_count: int | None
    following_count: int | None
    media_count: int | None
    avg_views: int | None
    engagement_rate: Decimal | None
    #: La date du relevé. Sans elle, le chiffre est illisible.
    captured_at: datetime | None
    #: Faux quand le compte a été rattaché sous un autre fournisseur. Son jeton
    #: n'existe alors chez personne : ni relevé, ni renouvellement, ni
    #: reconnexion. Rendu à l'app pour qu'elle le dise, au lieu de proposer un
    #: geste qui ne mène nulle part.
    reconnectable: bool


@dataclass(frozen=True, slots=True)
class SignalJuge:
    signal: account_verification.Signal
    verdict: account_verification.VerdictSignal
    #: La valeur constatée et le seuil, quand le signal en a. Rendus pour que
    #: l'app puisse dire ce qui a été regardé, pas seulement le verdict.
    constate: Decimal | int | None
    requis: Decimal | int | None


@dataclass(frozen=True, slots=True)
class VerificationDuCompte:
    social_account_id: uuid.UUID
    platform: Platform
    handle: str | None
    verification_status: VerificationStatus
    #: Le contrôle démarre au rattachement du compte.
    started_at: datetime
    #: L'instant où un humain a tranché. Nul tant que personne n'a regardé.
    reviewed_at: datetime | None
    signaux: tuple[SignalJuge, ...]


async def audience(session: AsyncSession, *, creator_id: uuid.UUID) -> tuple[AudienceDuCompte, ...]:
    dernier = (
        sa.select(
            SocialMetricsSnapshot.social_account_id,
            sa.func.max(SocialMetricsSnapshot.captured_at).label("captured_at"),
        )
        .group_by(SocialMetricsSnapshot.social_account_id)
        .subquery()
    )
    releve = (
        sa.select(SocialMetricsSnapshot)
        .join(
            dernier,
            sa.and_(
                dernier.c.social_account_id == SocialMetricsSnapshot.social_account_id,
                dernier.c.captured_at == SocialMetricsSnapshot.captured_at,
            ),
        )
        .subquery()
    )

    lignes = (
        await session.execute(
            sa.select(
                SocialAccount.id,
                SocialAccount.platform,
                SocialAccount.handle,
                SocialAccount.status,
                SocialAccount.verification_status,
                releve.c.followers_count,
                releve.c.following_count,
                releve.c.media_count,
                releve.c.avg_views,
                releve.c.engagement_rate,
                releve.c.captured_at,
                SocialAccount.provider_mode,
            )
            .outerjoin(releve, releve.c.social_account_id == SocialAccount.id)
            .where(SocialAccount.creator_id == creator_id)
            .order_by(SocialAccount.connected_at, SocialAccount.id)
        )
    ).all()

    return tuple(
        AudienceDuCompte(
            social_account_id=ligne.id,
            platform=ligne.platform,
            handle=ligne.handle,
            status=ligne.status,
            verification_status=ligne.verification_status,
            followers_count=ligne.followers_count,
            following_count=ligne.following_count,
            media_count=ligne.media_count,
            avg_views=ligne.avg_views,
            engagement_rate=ligne.engagement_rate,
            captured_at=ligne.captured_at,
            reconnectable=(
                ligne.provider_mode is None or ligne.provider_mode == get_settings().social_provider
            ),
        )
        for ligne in lignes
    )


async def verification(
    session: AsyncSession, *, creator_id: uuid.UUID
) -> tuple[VerificationDuCompte, ...]:
    """L'état du contrôle de cohérence, tel que le créateur peut le lire.

    Les mêmes signaux que ceux de la file d'administration, sans la décision.
    Ne rien montrer laisserait quelqu'un attendre devant un écran qui ne dit
    rien, et supposer le pire.
    """
    settings = get_settings()
    comptes = (
        await session.scalars(
            sa.select(SocialAccount)
            .where(SocialAccount.creator_id == creator_id)
            .order_by(SocialAccount.connected_at, SocialAccount.id)
        )
    ).all()

    resultat = []
    for compte in comptes:
        coherence = account_verification.evaluer(
            await account_verification.charger(session, compte), settings
        )
        resultat.append(
            VerificationDuCompte(
                social_account_id=compte.id,
                platform=compte.platform,
                handle=compte.handle,
                verification_status=compte.verification_status,
                started_at=compte.connected_at,
                reviewed_at=compte.verification_reviewed_at,
                signaux=tuple(
                    SignalJuge(
                        signal=constat.signal,
                        verdict=constat.verdict,
                        constate=constat.constate,
                        requis=constat.requis,
                    )
                    for constat in coherence.constats
                ),
            )
        )
    return tuple(resultat)
