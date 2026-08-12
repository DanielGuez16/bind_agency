"""L'annuaire des créateurs, tel qu'un salon abonné le lit.

C'est ce que BIND vend à un commerce : l'accès à un réseau. L'annuaire le rend
visible avant la première réservation — sans lui, un salon paie un abonnement
pour un fil qui ne montre que ce qui est déjà réservable autour de lui.

**Le score de fiabilité n'y figure pas, et n'y figurera pas.** Le produit promet
à la créatrice, sur son propre écran et dans les deux langues, qu'il n'est
« jamais comparé entre créatrices, jamais montré à un commerce ». Un annuaire
qui l'afficherait casserait les deux moitiés de cette phrase d'un seul coup : il
le montrerait à un commerce, et il alignerait les créatrices côte à côte, ce qui
est la définition de les comparer.

**Le palier accessible porte déjà l'information, sans la divulguer.** Un score
dégradé plafonne la créatrice à un palier inférieur — c'est le moteur
d'éligibilité qui le fait, pas une règle d'affichage. Un salon qui lit
« accessible au palier reel » sait donc qu'elle tient ses engagements, sans
connaître le nombre et sans pouvoir classer qui que ce soit. L'interface le dit
en une ligne, sinon un salon cherchera une note qu'il ne trouvera pas.

**Une évaluation en mémoire, pas une requête par créatrice.** `eligibility.
evaluer` est une fonction pure : on charge les profils, les comptes et les
paliers en trois requêtes, puis on évalue chaque créatrice sans retourner en
base. Appeler `evaluer_createur` dans une boucle aurait donné trois requêtes par
ligne d'annuaire — le genre de N+1 qui ne se voit pas à dix créatrices et qui
fait tomber la page à trois cents.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import CreatorProfile, SocialAccount, Tier, User
from app.models.enums import ContentFormat, Platform, SocialAccountStatus
from app.services import eligibility


@dataclass(frozen=True, slots=True)
class CompteVu:
    """Un réseau rattaché, tel que le salon le voit. Aucun jeton, aucun état
    technique : la poignée et le volume, qui sont ce qu'il vient chercher."""

    platform: Platform
    handle: str | None
    followers: int | None


@dataclass(frozen=True, slots=True)
class CreateurVu:
    creator_id: uuid.UUID
    first_name: str | None
    last_name: str | None
    city: str | None
    bio: str | None
    comptes: tuple[CompteVu, ...]
    #: Les formats ouverts, du moins au plus exigeant. C'est ce qui remplace le
    #: score : un palier haut ne s'obtient pas sans tenir ses engagements.
    paliers_ouverts: tuple[ContentFormat, ...]
    #: Le volume cumulé des comptes rattachés. Un ordre de grandeur d'audience,
    #: jamais une portée atteinte — la même précaution que sur les rapports.
    audience_totale: int


#: L'ordre des formats, du moins au plus exigeant. Celui des jetons.
ORDRE_DES_FORMATS = (ContentFormat.STORY, ContentFormat.POST, ContentFormat.REEL)


async def annuaire(session: AsyncSession, *, limite: int = 200) -> tuple[CreateurVu, ...]:
    """Les créateurs qu'un salon abonné peut atteindre.

    **Seulement ceux qui ont un compte rattaché.** Un profil sans réseau n'offre
    rien à un commerce : ni volume, ni palier, ni publication possible. L'y
    faire figurer gonflerait l'annuaire de lignes vides, ce qui est exactement
    la mauvaise façon de vendre un réseau.
    """
    settings = get_settings()
    maintenant = datetime.now(UTC)

    profils = (
        await session.execute(
            sa.select(
                CreatorProfile.user_id,
                CreatorProfile.first_name,
                CreatorProfile.last_name,
                CreatorProfile.city,
                CreatorProfile.bio,
                CreatorProfile.reliability_score,
                CreatorProfile.completed_collabs_count,
            )
            .join(User, User.id == CreatorProfile.user_id)
            # Un compte fermé ou anonymisé ne se propose pas : il n'y a personne
            # au bout.
            .where(CreatorProfile.anonymized_at.is_(None))
            .order_by(CreatorProfile.user_id)
            .limit(limite)
        )
    ).all()

    releve = eligibility._dernier_releve()
    comptes = (
        await session.execute(
            sa.select(
                SocialAccount.id,
                SocialAccount.creator_id,
                SocialAccount.platform,
                SocialAccount.handle,
                SocialAccount.status,
                SocialAccount.verification_status,
                SocialAccount.connected_at,
                SocialAccount.token_expires_at,
                releve.c.followers_count,
                releve.c.captured_at,
            )
            .outerjoin(releve, releve.c.social_account_id == SocialAccount.id)
            .where(SocialAccount.creator_id.in_([p.user_id for p in profils]))
        )
    ).all()

    paliers = [
        eligibility.PalierEvalue(
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

    par_createur: dict[uuid.UUID, list] = {}
    for ligne in comptes:
        par_createur.setdefault(ligne.creator_id, []).append(ligne)

    vus: list[CreateurVu] = []
    for profil in profils:
        lignes = par_createur.get(profil.user_id, [])
        if not lignes:
            continue

        evalues = [
            eligibility.CompteEvalue(
                social_account_id=ligne.id,
                platform=ligne.platform,
                status=ligne.status,
                verification_status=ligne.verification_status,
                followers=ligne.followers_count,
                captured_at=ligne.captured_at,
                connected_at=ligne.connected_at,
                token_expires_at=ligne.token_expires_at,
            )
            for ligne in lignes
        ]

        verdict = eligibility.evaluer(
            eligibility.CreateurEvalue(
                creator_id=profil.user_id,
                reliability_score=profil.reliability_score,
                completed_collabs=profil.completed_collabs_count,
            ),
            evalues,
            paliers,
            maintenant=maintenant,
            age_max=timedelta(seconds=settings.metrics_max_age_seconds),
        )

        ouverts = {
            palier.content_format
            for palier in paliers
            if palier.tier_id in verdict.paliers_accessibles
        }

        vus.append(
            CreateurVu(
                creator_id=profil.user_id,
                first_name=profil.first_name,
                last_name=profil.last_name,
                city=profil.city,
                bio=profil.bio,
                comptes=tuple(
                    CompteVu(
                        platform=ligne.platform,
                        handle=ligne.handle,
                        followers=ligne.followers_count,
                    )
                    for ligne in lignes
                    # Un compte révoqué ou refusé n'est pas un réseau atteignable.
                    if ligne.status is SocialAccountStatus.ACTIVE
                ),
                paliers_ouverts=tuple(f for f in ORDRE_DES_FORMATS if f in ouverts),
                audience_totale=sum(ligne.followers_count or 0 for ligne in lignes),
            )
        )

    return tuple(vus)
