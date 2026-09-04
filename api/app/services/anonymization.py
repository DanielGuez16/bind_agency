"""Anonymisation d'un compte.

Effacement sur place, jamais suppression : les réservations, contreparties,
preuves et lignes de journal restent intactes et toujours rattachées. Un
commerce ne perd pas son historique parce qu'un créateur exerce un droit.

Ce qui disparaît est ce qui identifie. Ce qui reste est ce qui engage.

Comme tout le reste, la fonction n'ouvre ni ne committe de transaction : elle
écrit dans la session de l'appelant, qui committe une fois. Une anonymisation
à moitié committée serait pire que pas d'anonymisation du tout.
"""

import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    CreatorFavorite,
    CreatorProfile,
    SocialAccount,
    SocialMetricsSnapshot,
    User,
)
from app.models.enums import ActorKind, SocialAccountStatus, UserStatus
from app.services import auth as auth_service
from app.services import push as push_service
from app.services.audit import Actor, AuditedEntity, record_transition

REASON = "account_anonymized"


async def anonymize_account(session: AsyncSession, *, user: User, actor: Actor) -> bool:
    """Anonymise un compte. Renvoie faux s'il l'était déjà.

    Idempotente : rejouée sur un compte déjà anonymisé, elle ne fait rien et ne
    lève pas. C'est ce qui permet de la relancer après un incident sans avoir à
    savoir jusqu'où la précédente était allée.

    L'acteur est le créateur qui exerce son droit, ou l'administrateur qui le
    fait pour lui. Jamais le système : une anonymisation n'arrive pas toute
    seule, et le journal doit pouvoir dire qui l'a demandée.
    """
    if actor.kind is ActorKind.SYSTEM:
        raise ValueError("une anonymisation a toujours un demandeur, jamais le système")

    if user.status is UserStatus.ANONYMIZED:
        return False

    await _revoke_sessions(session, user.id, actor)
    # Les terminaux, comme les jetons sociaux et pour la même raison : un
    # compte anonymisé ne doit plus être joignable nulle part. Le service
    # d'envoi refuse déjà de servir un compte non actif ; ceci est la
    # transition ponctuelle, celui-là la garantie permanente, et les deux
    # existent parce que la première peut être oubliée sur un chemin nouveau.
    await push_service.revoquer_les_terminaux(session, user_id=user.id)
    await _strip_social_accounts(session, user.id, actor)
    # **Les favoris partent avec le compte, et ici plutôt qu'avec les réseaux.**
    # Ce sont des préférences personnelles : elles ne prouvent rien, personne ne
    # les relira, et une créatrice partie ne doit rien laisser qui dise ce
    # qu'elle regardait.
    #
    # Posé d'abord dans `_strip_social_accounts`, qui rend la main quand il n'y
    # a aucun compte social — une créatrice qui n'en a jamais connecté aurait
    # gardé les siens, c'est-à-dire précisément celle dont le compte contient le
    # moins de choses par ailleurs.
    #
    # La clé étrangère les emporterait à la **suppression** d'une ligne
    # `app_user` ; une anonymisation ne supprime pas cette ligne, donc rien ne
    # le ferait à sa place.
    await session.execute(sa.delete(CreatorFavorite).where(CreatorFavorite.creator_id == user.id))

    await _strip_creator_profile(session, user.id)
    await _strip_account(session, user, actor)

    return True


async def _revoke_sessions(session: AsyncSession, user_id: uuid.UUID, actor: Actor) -> None:
    await auth_service.revoke_all_for_user(session, user_id, actor=actor, reason=REASON)


async def _strip_social_accounts(session: AsyncSession, user_id: uuid.UUID, actor: Actor) -> None:
    """Vide les comptes sociaux sans les supprimer : les réservations les référencent.

    `external_id` et `handle` partent avec le reste — ce sont des identifiants
    personnels, pas des clés techniques. Un handle Instagram nomme quelqu'un.
    """
    accounts = (
        await session.scalars(sa.select(SocialAccount).where(SocialAccount.creator_id == user_id))
    ).all()

    if not accounts:
        return

    await session.execute(
        sa.delete(SocialMetricsSnapshot).where(
            SocialMetricsSnapshot.social_account_id.in_([account.id for account in accounts])
        )
    )

    for account in accounts:
        previous = account.status

        account.access_token_encrypted = None
        account.refresh_token_encrypted = None
        account.token_expires_at = None
        account.granted_scopes = None
        account.external_id = None
        account.handle = None
        # Un visage nomme quelqu'un autant qu'un pseudonyme. La clé part ; le
        # fichier lui-même est effacé par la purge du dépôt, qui ne garde rien
        # que plus aucune ligne ne désigne.
        account.avatar_key = None
        account.status = SocialAccountStatus.REVOKED

        await session.flush()
        await record_transition(
            session,
            entity=AuditedEntity.SOCIAL_ACCOUNT,
            entity_id=account.id,
            from_status=previous.value,
            to_status=SocialAccountStatus.REVOKED.value,
            actor=actor,
            reason=REASON,
        )


async def _strip_creator_profile(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Efface l'identité, garde ce qui engage.

    `completed_collabs_count` et `reliability_score` restent : ce sont des faits
    sur des collaborations qui ont eu lieu, pas des données identifiantes.
    """
    profile = await session.get(CreatorProfile, user_id)
    if profile is None:
        return

    profile.first_name = None
    profile.last_name = None
    profile.bio = None
    profile.city = None
    profile.geo = None
    # Déclaratif, donc identifiant : trois intérêts et un quartier suffisent
    # souvent à désigner une personne. Ils partent avec le reste.
    profile.interests = None
    profile.anonymized_at = datetime.now(UTC)


async def _strip_account(session: AsyncSession, user: User, actor: Actor) -> None:
    """En dernier : un trigger gèle la ligne dès qu'elle passe en `anonymized`.

    **La date de naissance part, la preuve qu'on l'a vérifiée reste.** C'est la
    même distinction que sur le profil, où `completed_collabs_count` et
    `reliability_score` survivent : un fait sur ce qui a eu lieu n'est pas une
    donnée identifiante. Effacer `age_verified_at` avec la date rendrait
    indémontrable qu'on a vérifié — c'est-à-dire effacerait exactement ce que le
    portail existe pour établir, en gardant le risque et en perdant la preuve.
    """
    previous = user.status

    user.email = None
    user.phone = None
    user.password_hash = None
    user.date_of_birth = None
    # **`display_name` partait déjà en théorie et restait en pratique.** Le
    # modèle le déclare nullable « pour que l'anonymisation puisse l'effacer » ;
    # cette ligne manquait. Trouvé par la garde de complétude écrite juste
    # au-dessus de ce chantier, qui compare les colonnes au lieu de recopier une
    # liste — c'est-à-dire par la seule chose qui pouvait le voir.
    user.display_name = None
    user.status = UserStatus.ANONYMIZED

    await session.flush()
    await record_transition(
        session,
        entity=AuditedEntity.APP_USER,
        entity_id=user.id,
        from_status=previous.value,
        to_status=UserStatus.ANONYMIZED.value,
        actor=actor,
        reason=REASON,
    )
