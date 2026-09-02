"""L'annuaire des créatrices, côté administration.

**Pourquoi une route et non celle du commerce.** `GET /business/{id}/creators`
existe et rend presque la même chose, mais elle est *située* : elle calcule une
distance depuis un salon, l'éligibilité à **ses** paliers, et elle exige un
abonnement vivant. Un administrateur n'a ni salon, ni rayon, ni abonnement — lui
servir cette route demanderait d'inventer un salon de référence, dont chaque
chiffre rendu serait faux d'une manière qu'on ne verrait pas.

**Ce qu'elle rend, et ce qu'elle ne rend pas.** Le pseudonyme, la photo, les
réseaux rattachés, le volume, la ville. Pas de score de fiabilité, pas de
compteur de collaborations : la règle qui les tient hors de l'annuaire du
commerce ne vient pas du rôle de celui qui regarde, elle vient de ce qu'un
classement de personnes par note produit. L'administration a ses écrans pour
juger un dossier — l'arbitrage — et ils jugent un dossier, pas une personne.
"""

import uuid
from typing import Annotated

import sqlalchemy as sa
from fastapi import APIRouter, Depends, Query

from app.core.dependencies import SessionDep, require_role
from app.models import CreatorProfile, SocialAccount, User
from app.models.enums import SocialAccountStatus, UserRole, UserStatus
from app.schemas.creator_admin import CreateurAdminRead, ReseauDuCreateurRead
from app.services.directory import lien_public

router = APIRouter(
    prefix="/admin/creators",
    tags=["admin"],
    dependencies=[Depends(require_role(UserRole.ADMIN))],
)

#: La borne de la page. Même valeur que l'annuaire des salons, et pour la même
#: raison : au-delà, on ne lit plus, on cherche — et la recherche par nom est
#: le geste qui répond à ça.
PLAFOND = 100


@router.get("", response_model=list[CreateurAdminRead])
async def list_creators(
    session: SessionDep,
    recherche: Annotated[str | None, Query(max_length=100)] = None,
) -> list[CreateurAdminRead]:
    """Les créatrices inscrites, la plus récente d'abord.

    **Les anonymisées n'y sont pas.** Un compte supprimé a perdu son
    pseudonyme et sa photo ; le laisser dans la liste afficherait une ligne
    vide que personne ne peut relier à quoi que ce soit.
    """
    comptes = (
        sa.select(
            SocialAccount.creator_id,
            SocialAccount.platform,
            SocialAccount.handle,
            SocialAccount.avatar_key,
            SocialAccount.followers_count,
        )
        .where(SocialAccount.status == SocialAccountStatus.ACTIVE)
        .subquery()
    )

    requete = (
        sa.select(
            User.id,
            CreatorProfile.city,
            comptes.c.platform,
            comptes.c.handle,
            comptes.c.avatar_key,
            comptes.c.followers_count,
            User.created_at,
        )
        .join(CreatorProfile, CreatorProfile.user_id == User.id, isouter=True)
        .join(comptes, comptes.c.creator_id == User.id, isouter=True)
        .where(User.role == UserRole.CREATOR, User.status != UserStatus.ANONYMIZED)
        .order_by(User.created_at.desc(), User.id)
    )

    if recherche:
        # Sur le pseudonyme seul : c'est le seul nom que cet écran affiche, et
        # chercher sur un champ qu'on ne montre pas rendrait des lignes dont
        # rien n'expliquerait la présence.
        requete = requete.where(comptes.c.handle.ilike(f"%{recherche}%"))

    groupes: dict[uuid.UUID, dict] = {}
    for ligne in (await session.execute(requete)).all():
        vu = groupes.setdefault(
            ligne.id,
            {"creator_id": ligne.id, "city": ligne.city, "reseaux": [], "audience_totale": 0},
        )
        if ligne.platform is None:
            continue
        vu["reseaux"].append(
            ReseauDuCreateurRead(
                platform=ligne.platform,
                handle=ligne.handle,
                followers=ligne.followers_count,
                avatar_key=ligne.avatar_key,
                profil_url=lien_public(ligne.platform, ligne.handle),
            )
        )
        vu["audience_totale"] += ligne.followers_count or 0

    return [CreateurAdminRead(**vu) for vu in list(groupes.values())[:PLAFOND]]
