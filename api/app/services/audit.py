"""Journal d'audit des transitions d'état.

Point de passage unique. Aucun routeur, aucun autre service n'écrit dans
`audit_log` directement : sans cette règle, la première transition oubliée
passe inaperçue et le journal cesse d'être opposable.

Ce module n'ouvre ni ne valide de transaction. Il écrit dans la session que
l'appelant lui donne, et c'est l'appelant qui committe — une fois, avec la
transition qu'il décrit. Une transition committée sans sa ligne de journal est
un bug, pas un cas dégradé.
"""

import uuid
from dataclasses import dataclass
from enum import StrEnum

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog, User
from app.models.enums import ActorKind, UserRole

_ACTOR_KIND_BY_ROLE = {
    UserRole.CREATOR: ActorKind.CREATOR,
    UserRole.BUSINESS_MEMBER: ActorKind.BUSINESS_MEMBER,
    UserRole.ADMIN: ActorKind.ADMIN,
}


class AuditedEntity(StrEnum):
    """Entités dont les transitions sont journalisées.

    Volontairement limité à ce qui existe : les états de réservation et de
    contrepartie arriveront avec leurs phases.
    """

    APP_USER = "app_user"
    REFRESH_TOKEN = "refresh_token"
    SOCIAL_ACCOUNT = "social_account"


@dataclass(frozen=True, slots=True)
class Actor:
    """Qui a provoqué la transition.

    Une transition automatique n'a pas d'acteur utilisateur, et c'est une
    information à part entière : `actor_kind = system` avec `actor_user_id`
    nul dit « personne ne l'a demandé, le système l'a décidé ». Ce n'est pas
    un trou dans la donnée.
    """

    kind: ActorKind
    user_id: uuid.UUID | None

    @classmethod
    def system(cls) -> "Actor":
        return cls(kind=ActorKind.SYSTEM, user_id=None)

    @classmethod
    def from_user(cls, user: User) -> "Actor":
        return cls(kind=_ACTOR_KIND_BY_ROLE[user.role], user_id=user.id)


async def record_transition(
    session: AsyncSession,
    *,
    entity: AuditedEntity,
    entity_id: uuid.UUID,
    to_status: str,
    actor: Actor,
    from_status: str | None = None,
    reason: str | None = None,
    extra: dict | None = None,
) -> AuditLog:
    """Écrit une ligne de journal dans la session de l'appelant, sans committer.

    `reason` doit être renseigné sur toute transition non nominale. La règle est
    vérifiée automatiquement pour les transitions déclenchées par le système :
    une décision automatique qui ne dit pas pourquoi elle s'est produite est
    indéfendable trois mois plus tard.
    """
    if actor.kind is ActorKind.SYSTEM and not reason:
        raise ValueError("une transition automatique doit dire pourquoi elle s'est déclenchée")

    entry = AuditLog(
        entity_type=entity.value,
        entity_id=entity_id,
        from_status=from_status,
        to_status=to_status,
        actor_kind=actor.kind,
        actor_user_id=actor.user_id,
        reason=reason,
        extra=extra,
    )
    session.add(entry)

    # Le flush place l'écriture dans la même transaction que la transition
    # décrite : elles seront committées ensemble, ou pas du tout.
    await session.flush()
    return entry
