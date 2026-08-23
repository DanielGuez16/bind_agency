"""Reprendre un compte commerce, et la liste que le salon en lit.

**Deux côtés, et le second est ce qui rend le premier acceptable.**
L'administration ouvre et referme ; le commerce lit l'historique de ce qui a
été fait chez lui. Sans la seconde route, la première serait un accès de
support silencieux — et le jour où un commerçant découvrirait qu'on est entré
chez lui, ce qu'il retiendrait n'est pas qu'on l'a aidé.
"""

import uuid
from typing import Annotated

import sqlalchemy as sa
from fastapi import APIRouter, Depends, Path, status

from app.core.config import get_settings
from app.core.dependencies import BusinessMembership, CurrentUser, SessionDep, require_role
from app.core.errors import ErrorCode, api_error
from app.models import Business
from app.models.enums import UserRole
from app.schemas.support import (
    BusinessSupportAccessRead,
    CompteDesReprises,
    RepriseDemandee,
    RepriseOuverte,
)
from app.services import outbox
from app.services import support as service

admin_router = APIRouter(
    prefix="/admin/businesses",
    tags=["support"],
    dependencies=[Depends(require_role(UserRole.ADMIN))],
)

#: Côté commerce. L'appartenance est exigée : c'est **sa** liste, et le
#: résolveur ordinaire s'en charge.
business_router = APIRouter(prefix="/business", tags=["support"])

#: Ce que l'administration lit d'elle-même. **Sans identifiant de salon dans le
#: chemin**, et c'est tout l'intérêt : le compte doit exister avant qu'un salon
#: soit choisi, puisqu'il se lit pendant qu'on écrit encore le motif.
admin_me_router = APIRouter(
    prefix="/admin/me",
    tags=["support"],
    dependencies=[Depends(require_role(UserRole.ADMIN))],
)

_CODES = {
    service.NotAnAdmin: (status.HTTP_403_FORBIDDEN, ErrorCode.INSUFFICIENT_ROLE),
    service.ReasonRequired: (
        status.HTTP_422_UNPROCESSABLE_CONTENT,
        ErrorCode.SUPPORT_REASON_REQUIRED,
    ),
    service.AlreadyOpen: (status.HTTP_409_CONFLICT, ErrorCode.SUPPORT_ACCESS_ALREADY_OPEN),
    service.ScopeRequired: (
        status.HTTP_422_UNPROCESSABLE_CONTENT,
        ErrorCode.SUPPORT_SCOPE_REQUIRED,
    ),
}


def _traduire(erreur: Exception):
    http_status, code = _CODES[type(erreur)]
    return api_error(http_status, code)


@admin_router.post(
    "/{business_id}/support-access",
    response_model=RepriseOuverte,
    status_code=status.HTTP_201_CREATED,
)
async def open_support_access(
    business_id: Annotated[uuid.UUID, Path()],
    payload: RepriseDemandee,
    user: CurrentUser,
    session: SessionDep,
) -> RepriseOuverte:
    """Ouvre une reprise, et **prévient le salon**.

    L'avertissement est déposé dans la même transaction que la reprise : ou les
    deux existent, ou aucun. C'est ce qui distingue un accès déclaré d'un accès
    qu'on découvre — et ce qui empêche qu'une panne d'envoi laisse l'accès
    ouvert sans que personne ne l'ait dit.
    """
    business = await session.get(Business, business_id)
    if business is None:
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.BUSINESS_NOT_FOUND)

    try:
        acces = await service.ouvrir(
            session,
            business=business,
            admin=user,
            motif=payload.reason,
            portee=payload.scope,
            spontanee=payload.spontaneous,
        )
    except (
        service.NotAnAdmin,
        service.ReasonRequired,
        service.ScopeRequired,
        service.AlreadyOpen,
    ) as erreur:
        raise _traduire(erreur) from erreur

    await _prevenir_le_salon(session, business=business, motif=acces.reason)

    # Compté **avant** le commit et après le `flush` de l'ouverture : celle
    # qu'on vient d'ouvrir compte dans le total. La lire à zéro le jour de la
    # première serait exact et inutile — ce qu'on veut savoir est combien de
    # fois on est entré, celle-ci comprise.
    recentes = await service.reprises_recentes(session, admin_user_id=user.id)
    await session.commit()

    reglages = get_settings()
    return RepriseOuverte(
        **BusinessSupportAccessRead.model_validate(acces).model_dump(),
        reprises_recentes_de_l_appelant=recentes,
        fenetre_en_jours=reglages.support_access_recent_window_seconds // 86_400,
    )


@admin_router.delete("/{business_id}/support-access", status_code=status.HTTP_204_NO_CONTENT)
async def close_support_access(
    business_id: Annotated[uuid.UUID, Path()],
    user: CurrentUser,
    session: SessionDep,
) -> None:
    """Referme la reprise en cours. Sans erreur s'il n'y en avait pas.

    « Il n'y avait rien à fermer » est le résultat voulu quand on veut être sûr
    d'être ressorti.
    """
    acces = await service.en_cours(session, business_id=business_id, admin_user_id=user.id)
    if acces is not None:
        await service.fermer(session, acces=acces, acteur=user)
        await session.commit()


@admin_me_router.get("/support-access/recent", response_model=CompteDesReprises)
async def read_recent_support_accesses(user: CurrentUser, session: SessionDep) -> CompteDesReprises:
    """Combien de reprises l'appelant a ouvertes, **tous salons confondus**.

    **Avant l'appui, et c'est toute la raison de cette route.** Le même nombre
    est déjà rendu par l'ouverture ; lu là, il retient pour la fois suivante,
    c'est-à-dire qu'il fait ce qu'un journal fait — et un journal enregistre un
    abus, il ne l'empêche pas. Ce qui retient est de se comparer à soi-même
    pendant qu'on écrit encore le motif, quand on peut encore ne pas le faire.

    **Sans identifiant de salon**, parce que le compte doit vivre avant qu'un
    salon soit choisi : l'écran le pose au-dessus du champ de motif, donc avant
    tout le reste. Le poser sur la route qui liste les reprises d'un salon
    aurait rendu un nombre tous salons confondus depuis une route qui parle
    d'un salon, ce qui se lit mal.

    Elle ne refuse rien et ne décide rien. Un seuil se contournerait en
    attendant un jour, et transformerait une mesure honnête en formalité.
    """
    reglages = get_settings()
    return CompteDesReprises(
        reprises_recentes_de_l_appelant=await service.reprises_recentes(
            session, admin_user_id=user.id
        ),
        fenetre_en_jours=reglages.support_access_recent_window_seconds // 86_400,
    )


@admin_router.get("/{business_id}/support-access", response_model=list[BusinessSupportAccessRead])
async def list_support_accesses(
    business_id: Annotated[uuid.UUID, Path()], session: SessionDep
) -> list[BusinessSupportAccessRead]:
    """L'historique, côté administration."""
    return [
        BusinessSupportAccessRead.model_validate(acces)
        for acces in await service.historique(session, business_id=business_id)
    ]


@business_router.get(
    "/{business_id}/support-access", response_model=list[BusinessSupportAccessRead]
)
async def list_my_support_accesses(
    business_id: Annotated[uuid.UUID, Path()],
    membership: BusinessMembership,
    session: SessionDep,
) -> list[BusinessSupportAccessRead]:
    """**Ce que le salon lit de nous.**

    La même forme que la route d'administration : ce que le salon voit de nous
    est ce que nous voyons de nous-mêmes. Rendre une version allégée
    demanderait de choisir ce qu'on lui cache, et il n'y a rien ici qui se
    cache.
    """
    del membership  # l'appartenance est la condition, pas une donnée
    return [
        BusinessSupportAccessRead.model_validate(acces)
        for acces in await service.historique(session, business_id=business_id)
    ]


@business_router.delete("/{business_id}/support-access", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_support_access(
    business_id: Annotated[uuid.UUID, Path()],
    membership: BusinessMembership,
    user: CurrentUser,
    session: SessionDep,
) -> None:
    """**Le salon met dehors, et n'a personne à convaincre.**

    « L'accès se ferme sans discussion » ne tenait pas : seule la porte
    d'administration savait se refermer, si bien que le gérant qui n'était pas
    d'accord n'avait qu'un numéro à appeler. Une garantie qui suppose qu'on
    décroche n'est pas une garantie.

    **Toutes celles qui courent, pas une.** Lui demander laquelle serait lui
    demander de savoir combien de personnes sont entrées ; la seule chose qu'il
    veuille est que plus personne n'y soit.

    Sans erreur quand il n'y en avait aucune : « il n'y avait rien à fermer »
    est le résultat voulu par quelqu'un qui veut être sûr que la porte est
    close. Et rien n'est effacé — la liste garde les reprises, avec leur motif
    et le nom de qui est entré.
    """
    del membership  # l'appartenance est la condition, pas une donnée
    ouvertes = await service.toutes_en_cours(session, business_id=business_id)
    for acces in ouvertes:
        await service.fermer(session, acces=acces, acteur=user)
    if ouvertes:
        await session.commit()


async def _prevenir_le_salon(session, *, business: Business, motif: str) -> None:
    """Dépose l'avertissement pour tous les membres, **avant le commit**.

    Le salon apprend qu'on est entré chez lui par le même chemin que tout le
    reste : la boîte d'envoi, vidée par le travail de fond. C'est aussi ce qui
    garantit qu'il l'apprendra — le message est écrit dans la transaction qui
    ouvre la reprise, et un processus qui meurt entre les deux ne peut plus
    faire disparaître l'avertissement en laissant l'accès.
    """
    from app.models import BusinessMember

    membres = await session.scalars(
        sa.select(BusinessMember.user_id).where(BusinessMember.business_id == business.id)
    )
    for user_id in membres:
        await outbox.deposer(
            session,
            user_id=user_id,
            cle="support.accessOpened",
            business=business.name,
            motif=motif,
        )
