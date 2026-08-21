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
from app.services import eligibility, storage

#: Où mène un pseudonyme, par plateforme.
#:
#: **Dérivé et non stocké.** Le pseudonyme est déjà en base ; ranger à côté une
#: adresse qu'on en déduit ferait deux vérités, et c'est celle qu'on ne
#: rafraîchit pas qui vieillirait — un créateur qui change de pseudonyme
#: laisserait un lien mort derrière lui.
#:
#: Snapchat et YouTube n'y figurent pas : aucune implémentation ne les rattache,
#: et fabriquer une adresse pour une plateforme qu'on ne sait pas lire
#: produirait un lien qu'on n'a jamais vu fonctionner.
PROFIL_PUBLIC = {
    Platform.INSTAGRAM: "https://www.instagram.com/{handle}/",
    Platform.TIKTOK: "https://www.tiktok.com/@{handle}",
}


def _apercu(avatar_key: str | None) -> str | None:
    """La clé de l'aperçu flouté, ou rien.

    Rien quand il n'y a pas de photo — et rien de plus à dire. Quand la photo
    existe mais que son aperçu n'a jamais été produit (une image d'avant ce
    changement), la clé est rendue quand même : la route des médias répondra
    404 et l'écran montrera un cadre vide. **C'est le bon sens de l'échec** —
    elle ne retombe pas sur l'original, et un aperçu manquant ne peut donc pas
    devenir une photo nette.
    """
    return storage.cle_d_apercu(avatar_key) if avatar_key else None


def lien_public(platform: Platform, handle: str | None) -> str | None:
    """L'adresse du profil, ou rien.

    Rien plutôt qu'une adresse partielle : un lien qui mène à une page d'erreur
    est pire qu'un lien absent — le salon croit que la créatrice a supprimé son
    compte.
    """
    gabarit = PROFIL_PUBLIC.get(platform)
    if gabarit is None or not handle:
        return None
    return gabarit.format(handle=handle.lstrip("@"))


@dataclass(frozen=True, slots=True)
class CompteVu:
    """Un réseau rattaché, tel que le salon le voit. Aucun jeton, aucun état
    technique : la poignée et le volume, qui sont ce qu'il vient chercher."""

    platform: Platform
    handle: str | None
    followers: int | None
    #: Le visage, par sa clé dans notre dépôt. Nulle tant qu'aucun relevé n'a
    #: abouti, et sur un compte qui n'a pas de photo.
    avatar_key: str | None
    #: Où le salon va la regarder. **C'est la première chose qu'il cherche** :
    #: un annuaire qui liste des pseudonymes sans y mener oblige à les recopier
    #: dans une barre d'adresse.
    profil_url: str | None


@dataclass(frozen=True, slots=True)
class CreateurVu:
    """Ce qu'un salon voit d'une créatrice dans l'annuaire.

    **Aucun nom d'état civil, et c'est un retrait.** L'écran titrait « Léa
    Martel » ; il titre `@lea.mrl`. Le pseudonyme est l'identité de cet écran —
    il suffit à ce que l'annuaire sert, reconnaître un compte et aller voir son
    travail — et le nom civil de cent vingt-huit personnes n'a rien à faire chez
    un salon qui ne les a jamais rencontrées.

    Le nom arrive à la réservation, quand une créatrice a choisi ce salon. Pas
    avant, et pas à tout le monde. C'est la même règle que le reste : ce qu'un
    écran ne montre pas ne doit pas partir.
    """

    creator_id: uuid.UUID
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


async def annuaire(
    session: AsyncSession, *, abonne: bool, limite: int = 200
) -> tuple[CreateurVu, ...]:
    """Les créateurs qu'un salon peut atteindre, complets ou en aperçu.

    **`abonne` change ce qui est lu, pas ce qui est affiché.** C'est toute la
    règle : ce qu'un écran prétend cacher doit être absent de la réponse. Un
    masque visuel n'est pas un contrôle d'accès — la donnée est partie, et il
    suffit d'ouvrir l'outil de développement, ou de rappeler la route sans
    l'application.

    Sans abonnement, la ligne perd le pseudonyme, le volume, le lien vers le
    profil et la photo nette. Restent les formes : la ville, les paliers
    ouverts, les réseaux rattachés et un aperçu flouté dont on ne peut plus
    tirer un visage. C'est assez pour donner envie, jamais assez pour se passer
    de payer — ce qui est exactement ce qu'un aperçu doit être.

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
                SocialAccount.avatar_key,
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
                city=profil.city,
                # **La biographie part avec le reste, et ce n'est pas de
                # l'excès de zèle.** C'est du texte libre : « écris-moi sur
                # @rebecca.miami » y tient très bien, et masquer le champ
                # `handle` en laissant passer la bio rendrait le pseudonyme par
                # l'autre porte. Une règle qui ferme les champs qu'on a nommés
                # et laisse ouverte la seule zone où l'utilisateur écrit ce
                # qu'il veut ne protège rien.
                bio=profil.bio if abonne else None,
                comptes=tuple(
                    CompteVu(
                        platform=ligne.platform,
                        # Le réseau reste, ce qui l'identifie part. Savoir
                        # qu'elle est sur TikTok ne dit pas qui elle est.
                        handle=ligne.handle if abonne else None,
                        followers=ligne.followers_count if abonne else None,
                        avatar_key=(ligne.avatar_key if abonne else _apercu(ligne.avatar_key)),
                        profil_url=(lien_public(ligne.platform, ligne.handle) if abonne else None),
                    )
                    for ligne in lignes
                    # Un compte révoqué ou refusé n'est pas un réseau atteignable.
                    if ligne.status is SocialAccountStatus.ACTIVE
                ),
                paliers_ouverts=tuple(f for f in ORDRE_DES_FORMATS if f in ouverts),
                # **Zéro plutôt qu'une somme.** Le volume est ce qui se vend :
                # le rendre à qui n'a pas payé viderait l'abonnement de sa
                # raison d'être, et l'écran qui le masque ne masquerait qu'aux
                # honnêtes.
                audience_totale=(
                    sum(ligne.followers_count or 0 for ligne in lignes) if abonne else 0
                ),
            )
        )

    return tuple(vus)
