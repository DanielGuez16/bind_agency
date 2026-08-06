"""Éligibilité aux paliers.

L'unité d'évaluation est le couple **(compte social, palier)**, jamais le
créateur seul. Les abonnés sont une propriété du compte, et `booking` fige le
compte sur lequel la contrepartie sera publiée : une réservation engage un
compte, donc l'éligibilité se prononce sur un compte.

Les conditions d'un palier mélangent deux niveaux : les abonnés viennent du
compte, le nombre de collaborations et le score de fiabilité viennent du
créateur. Un score dégradé plafonne donc tous ses comptes à la fois.

Le module est en deux morceaux. `evaluer` est pure — elle ne touche pas la base
et c'est là que vit la règle du cold start, ce qui rend ses tests instantanés.
`evaluer_createur` fait les trois requêtes et l'appelle.

Ce qui n'est jamais renvoyé : les paliers d'une autre plateforme, et les paliers
inactifs. Ni l'un ni l'autre n'est un refus. Un palier inactif n'existe pas du
point de vue du créateur, et le lui montrer lui apprendrait une décision interne
qui ne le concerne pas.
"""

import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import CreatorProfile, SocialAccount, SocialMetricsSnapshot, Tier
from app.models.enums import ContentFormat, Platform, SocialAccountStatus, VerificationStatus


class RaisonRefus(StrEnum):
    """Chaque raison correspond à une action différente pour le créateur.

    C'est le critère de découpage : deux situations qui appellent le même geste
    partagent une raison, deux situations qui en appellent des différents n'en
    partagent jamais.
    """

    #: Grandir. L'écart est chiffré.
    NOT_ENOUGH_FOLLOWERS = "not_enough_followers"
    #: Collaborer davantage.
    NOT_ENOUGH_COMPLETED_COLLABS = "not_enough_completed_collabs"
    #: Tenir ses engagements.
    RELIABILITY_SCORE_TOO_LOW = "reliability_score_too_low"
    #: Patienter, la première mesure arrive.
    NO_METRICS = "no_metrics"
    #: Reconnecter son compte : les chiffres sont trop vieux pour engager.
    METRICS_STALE = "metrics_stale"
    #: Reconnecter son compte : le jeton est expiré ou révoqué, et il ne se
    #: réparera pas tout seul.
    ACCOUNT_TOKEN_INVALID = "account_token_invalid"
    #: Patienter, un administrateur doit trancher.
    ACCOUNT_UNDER_REVIEW = "account_under_review"
    #: Nous écrire. Définitif, contrairement au précédent.
    ACCOUNT_REJECTED = "account_rejected"


class VerdictScore(StrEnum):
    """Trois issues, et deux façons distinctes d'être ignorée.

    Les deux nuls sont de nature différente — le palier n'exige rien, ou le
    créateur n'a pas d'historique — et les nommer séparément est ce qui empêche
    de « simplifier » l'un en croyant traiter l'autre.
    """

    IGNOREE_PALIER_SANS_CONDITION = "ignoree_palier_sans_condition"
    IGNOREE_CREATEUR_SANS_HISTORIQUE = "ignoree_createur_sans_historique"
    TENUE = "tenue"
    MANQUEE = "manquee"


def evaluer_score(minimum: Decimal | None, score: Decimal | None) -> VerdictScore:
    """Un `reliability_score` nul veut dire **neutre**, jamais zéro.

    L'ordre des branches est la garantie : les deux cas nuls sont traités avant
    toute comparaison, et aucune valeur de repli n'est fabriquée. Un `score or 0`
    écrit ici transformerait un créateur sans historique en créateur à zéro,
    c'est-à-dire l'inverse exact de la règle.
    """
    if minimum is None:
        return VerdictScore.IGNOREE_PALIER_SANS_CONDITION
    if score is None:
        return VerdictScore.IGNOREE_CREATEUR_SANS_HISTORIQUE
    return VerdictScore.TENUE if score >= minimum else VerdictScore.MANQUEE


# --------------------------------------------------------------------------
# ce que la fonction pure reçoit et rend
# --------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Obstacle:
    raison: RaisonRefus
    requis: Decimal | int | None = None
    constate: Decimal | int | None = None
    ecart: Decimal | int | None = None


@dataclass(frozen=True, slots=True)
class CompteEvalue:
    social_account_id: uuid.UUID
    platform: Platform
    status: SocialAccountStatus
    verification_status: VerificationStatus
    followers: int | None
    captured_at: datetime | None


@dataclass(frozen=True, slots=True)
class CreateurEvalue:
    creator_id: uuid.UUID
    reliability_score: Decimal | None
    completed_collabs: int


@dataclass(frozen=True, slots=True)
class PalierEvalue:
    tier_id: uuid.UUID
    platform: Platform
    content_format: ContentFormat
    min_followers: int
    min_completed_collabs: int
    min_reliability_score: Decimal | None


@dataclass(frozen=True, slots=True)
class AccesPalier:
    social_account_id: uuid.UUID
    tier_id: uuid.UUID
    platform: Platform
    content_format: ContentFormat
    accessible: bool
    obstacles: tuple[Obstacle, ...]


@dataclass(frozen=True, slots=True)
class Eligibilite:
    """Le résultat entier pour un créateur.

    Il n'existe volontairement **aucune** fonction qui prendrait une offre et
    répondrait pour elle. Une fonction qu'on peut appeler dans une boucle finira
    dans une boucle : qui veut savoir pour une offre interroge cet ensemble,
    déjà calculé.
    """

    creator_id: uuid.UUID
    acces: tuple[AccesPalier, ...]

    @property
    def couples_accessibles(self) -> frozenset[tuple[uuid.UUID, uuid.UUID]]:
        """Couples (compte, palier) accessibles. La forme utile au fil."""
        return frozenset(
            (acces.social_account_id, acces.tier_id) for acces in self.acces if acces.accessible
        )

    @property
    def paliers_accessibles(self) -> frozenset[uuid.UUID]:
        """Paliers accessibles par au moins un compte. Le filtre du fil."""
        return frozenset(acces.tier_id for acces in self.acces if acces.accessible)

    def obstacles_pour(
        self, social_account_id: uuid.UUID, tier_id: uuid.UUID
    ) -> tuple[Obstacle, ...]:
        for acces in self.acces:
            if (acces.social_account_id, acces.tier_id) == (social_account_id, tier_id):
                return acces.obstacles
        return ()


# --------------------------------------------------------------------------
# la règle, sans base de données
# --------------------------------------------------------------------------


def _obstacles_du_compte(
    compte: CompteEvalue, age_max: timedelta, maintenant: datetime
) -> list[Obstacle]:
    """Ce qui rend un compte inutilisable, indépendamment de tout palier."""
    obstacles: list[Obstacle] = []

    if compte.verification_status is VerificationStatus.REJECTED:
        obstacles.append(Obstacle(raison=RaisonRefus.ACCOUNT_REJECTED))
    elif compte.verification_status is VerificationStatus.NEEDS_REVIEW:
        obstacles.append(Obstacle(raison=RaisonRefus.ACCOUNT_UNDER_REVIEW))

    if compte.status is not SocialAccountStatus.ACTIVE:
        obstacles.append(Obstacle(raison=RaisonRefus.ACCOUNT_TOKEN_INVALID))

    if compte.captured_at is None or compte.followers is None:
        obstacles.append(Obstacle(raison=RaisonRefus.NO_METRICS))
    else:
        age = maintenant - compte.captured_at
        if age > age_max:
            obstacles.append(
                Obstacle(
                    raison=RaisonRefus.METRICS_STALE,
                    requis=int(age_max.total_seconds()),
                    constate=int(age.total_seconds()),
                    ecart=int((age - age_max).total_seconds()),
                )
            )

    return obstacles


def _obstacles_du_palier(
    palier: PalierEvalue, createur: CreateurEvalue, compte: CompteEvalue
) -> list[Obstacle]:
    """Les conditions chiffrées. Tous les manques sont renvoyés, jamais le premier.

    Un créateur à qui l'on dit « pas assez d'abonnés », qui en gagne, et à qui
    l'on dit ensuite « pas assez de collaborations », a été mal traité deux fois.
    """
    obstacles: list[Obstacle] = []

    # Sans relevé, la condition d'abonnés n'est pas *manquée*, elle est
    # indéterminable : c'est l'obstacle de métriques qui en tient lieu.
    if compte.followers is not None and compte.followers < palier.min_followers:
        obstacles.append(
            Obstacle(
                raison=RaisonRefus.NOT_ENOUGH_FOLLOWERS,
                requis=palier.min_followers,
                constate=compte.followers,
                ecart=palier.min_followers - compte.followers,
            )
        )

    if createur.completed_collabs < palier.min_completed_collabs:
        obstacles.append(
            Obstacle(
                raison=RaisonRefus.NOT_ENOUGH_COMPLETED_COLLABS,
                requis=palier.min_completed_collabs,
                constate=createur.completed_collabs,
                ecart=palier.min_completed_collabs - createur.completed_collabs,
            )
        )

    if (
        evaluer_score(palier.min_reliability_score, createur.reliability_score)
        is VerdictScore.MANQUEE
    ):
        obstacles.append(
            Obstacle(
                raison=RaisonRefus.RELIABILITY_SCORE_TOO_LOW,
                requis=palier.min_reliability_score,
                constate=createur.reliability_score,
                ecart=palier.min_reliability_score - createur.reliability_score,  # type: ignore[operator]
            )
        )

    return obstacles


def evaluer(
    createur: CreateurEvalue,
    comptes: Iterable[CompteEvalue],
    paliers: Iterable[PalierEvalue],
    *,
    maintenant: datetime,
    age_max: timedelta,
) -> Eligibilite:
    """Évalue chaque couple (compte, palier) de même plateforme.

    Les paliers reçus sont supposés actifs — le tri est fait par l'appelant, et
    un palier inactif ne parvient jamais jusqu'ici.
    """
    paliers = list(paliers)
    acces: list[AccesPalier] = []

    for compte in comptes:
        obstacles_compte = _obstacles_du_compte(compte, age_max, maintenant)

        for palier in paliers:
            # Une autre plateforme n'est pas un refus, c'est hors de portée.
            if palier.platform is not compte.platform:
                continue

            obstacles = tuple(obstacles_compte + _obstacles_du_palier(palier, createur, compte))
            acces.append(
                AccesPalier(
                    social_account_id=compte.social_account_id,
                    tier_id=palier.tier_id,
                    platform=palier.platform,
                    content_format=palier.content_format,
                    accessible=not obstacles,
                    obstacles=obstacles,
                )
            )

    return Eligibilite(creator_id=createur.creator_id, acces=tuple(acces))


# --------------------------------------------------------------------------
# les trois requêtes
# --------------------------------------------------------------------------


def _dernier_releve() -> sa.Subquery:
    """Un seul relevé par compte, le plus récent.

    `DISTINCT ON` fait tenir en une requête ce qui serait sinon une requête par
    compte. L'index `(social_account_id, captured_at DESC)` sert exactement ça.
    """
    return (
        sa.select(
            SocialMetricsSnapshot.social_account_id,
            SocialMetricsSnapshot.followers_count,
            SocialMetricsSnapshot.captured_at,
        )
        .distinct(SocialMetricsSnapshot.social_account_id)
        .order_by(
            SocialMetricsSnapshot.social_account_id,
            SocialMetricsSnapshot.captured_at.desc(),
        )
        .subquery()
    )


async def evaluer_createur(
    session: AsyncSession, creator_id: uuid.UUID, *, maintenant: datetime | None = None
) -> Eligibilite:
    """Trois requêtes, quel que soit le nombre de comptes du créateur.

    Le résultat n'est pas mis en cache, et c'est délibéré : il dépend de l'âge
    des relevés, donc du moment. Le mettre en cache ressusciterait exactement les
    chiffres périmés que la fraîcheur cherche à écarter.
    """
    settings = get_settings()
    maintenant = maintenant or datetime.now(UTC)

    profil = (
        await session.execute(
            sa.select(
                CreatorProfile.user_id,
                CreatorProfile.reliability_score,
                CreatorProfile.completed_collabs_count,
            ).where(CreatorProfile.user_id == creator_id)
        )
    ).one_or_none()

    if profil is None:
        return Eligibilite(creator_id=creator_id, acces=())

    createur = CreateurEvalue(
        creator_id=profil.user_id,
        reliability_score=profil.reliability_score,
        completed_collabs=profil.completed_collabs_count,
    )

    releve = _dernier_releve()
    comptes = [
        CompteEvalue(
            social_account_id=ligne.id,
            platform=ligne.platform,
            status=ligne.status,
            verification_status=ligne.verification_status,
            followers=ligne.followers_count,
            captured_at=ligne.captured_at,
        )
        for ligne in (
            await session.execute(
                sa.select(
                    SocialAccount.id,
                    SocialAccount.platform,
                    SocialAccount.status,
                    SocialAccount.verification_status,
                    releve.c.followers_count,
                    releve.c.captured_at,
                )
                .outerjoin(releve, releve.c.social_account_id == SocialAccount.id)
                .where(SocialAccount.creator_id == creator_id)
            )
        ).all()
    ]

    paliers = [
        PalierEvalue(
            tier_id=ligne.id,
            platform=ligne.platform,
            content_format=ligne.content_format,
            min_followers=ligne.min_followers,
            min_completed_collabs=ligne.min_completed_collabs,
            min_reliability_score=ligne.min_reliability_score,
        )
        for ligne in (
            await session.execute(
                sa.select(
                    Tier.id,
                    Tier.platform,
                    Tier.content_format,
                    Tier.min_followers,
                    Tier.min_completed_collabs,
                    Tier.min_reliability_score,
                ).where(Tier.is_active.is_(True))
            )
        ).all()
    ]

    return evaluer(
        createur,
        comptes,
        paliers,
        maintenant=maintenant,
        age_max=timedelta(seconds=settings.metrics_max_age_seconds),
    )
