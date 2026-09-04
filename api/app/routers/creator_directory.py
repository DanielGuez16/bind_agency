"""L'annuaire des créateurs, réservé aux commerces abonnés.

C'est ce que BIND vend : l'accès à un réseau. La barrière est donc la même que
la vente — un abonnement vivant — et non le simple fait d'être un commerce.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.dependencies import CurrentBusiness, SessionDep, require_role
from app.core.errors import ErrorCode
from app.models.enums import CentreDInteret, ContentFormat, Platform, UserRole
from app.schemas.directory import AnnuaireRead, CreateurVuRead
from app.schemas.reporting import PorteeLocaleRead
from app.services import directory as service
from app.services import portee_locale
from app.services import subscription as subscription_service


async def abonnement_vivant(business: CurrentBusiness, session: SessionDep) -> None:
    """L'abonnement vivant, exigé de l'annuaire comme de chaque fiche.

    **Portée par le routeur, et c'est tout l'intérêt de l'extraction.** La
    fiche ouvre exactement ce que la liste vend ; une route qui l'aurait
    oubliée aurait rendu à un salon non abonné, une par une, les créatrices
    que la liste lui refuse. Écrite en ligne dans chaque route, la condition
    finit par manquer à la suivante — c'est un oubli d'une ligne, et rien ne
    le signale.

    Le raisonnement du refus lui-même — pourquoi un 402 plutôt qu'une liste
    vide ou dégradée — est écrit sur `read_directory`, où il est né.
    """
    if await subscription_service.courant(session, business_id=business.id) is None:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=ErrorCode.SUBSCRIPTION_REQUIRED.value,
        )


router = APIRouter(
    prefix="/business/{business_id}/creators",
    tags=["directory"],
    dependencies=[
        Depends(require_role(UserRole.BUSINESS_MEMBER)),
        Depends(abonnement_vivant),
    ],
)


@router.get("", response_model=AnnuaireRead)
async def read_directory(
    business: CurrentBusiness,
    session: SessionDep,
    limite: Annotated[int, Query(ge=1, le=200)] = 50,
    decalage: Annotated[int, Query(ge=0)] = 0,
    palier: Annotated[list[ContentFormat] | None, Query()] = None,
    reseau: Annotated[Platform | None, Query()] = None,
    distance_max_metres: Annotated[int | None, Query(ge=0)] = None,
    interet: Annotated[list[CentreDInteret] | None, Query()] = None,
) -> AnnuaireRead:
    """La liste des créatrices joignables, filtrée et paginée par le serveur.

    **Sans abonnement, rien ne part.**

    Un refus, et non une liste dégradée. La différence n'est pas de sécurité —
    la donnée était déjà retenue par le service — elle est d'expérience : un
    salon non abonné recevait une grille de cartes sans nom et sans visage,
    sans une ligne qui explique pourquoi, parce que l'écran n'affiche son état
    « l'annuaire vient avec un abonnement » que sur un 402. Le chemin qui vend
    l'abonnement était mort.

    Une liste vidée que n'accompagne aucun écran ne vend rien et ne protège
    rien de plus qu'un refus. Le jour où l'état sans abonnement sera composé —
    le compte en grand, quelques aperçus floutés, ce que l'abonnement ouvre —
    la question se reposera, et la machinerie l'attend : le floutage serveur,
    la clé `@apercu` et son repli qui échoue plutôt que de servir la photo
    nette restent en place et éprouvés.

    **Un refus et non une liste vide** : le vide se lit « aucun créateur », ce
    qui est un mensonge et un argument contre le produit.

    L'abonnement est exigé par `abonnement_vivant`, au niveau du routeur, et
    nulle part ailleurs : laisser l'écran décider mettrait la vente derrière
    une condition d'affichage, et il suffirait de rappeler la route.
    """
    page = await service.annuaire(
        session,
        business=business,
        filtre=service.FiltreDAnnuaire(
            paliers=frozenset(palier or ()),
            reseau=reseau,
            distance_max_metres=distance_max_metres,
            interets=frozenset(interet or ()),
        ),
        limite=limite,
        decalage=decalage,
    )
    return AnnuaireRead(
        portee=PorteeLocaleRead.model_validate(
            await portee_locale.autour_du_commerce(session, business=business)
        ),
        createurs=[CreateurVuRead.model_validate(vu) for vu in page.createurs],
        total=page.total,
    )


@router.get("/{creator_id}", response_model=CreateurVuRead)
async def read_creator(
    business: CurrentBusiness,
    session: SessionDep,
    creator_id: uuid.UUID,
) -> CreateurVuRead:
    """Une créatrice de l'annuaire, ouverte depuis sa rangée.

    **Le geste manquait.** La liste ne menait qu'à Instagram — hors du produit,
    dans un onglet dont on ne revient pas. La fiche est la destination de la
    rangée ; le lien sortant y déménage, où il redevient un geste parmi
    d'autres plutôt que le seul.

    **404 et non 403 quand elle n'est pas visible d'ici.** Un salon n'a pas à
    apprendre qu'une créatrice existe hors de son rayon : la distinguer d'un
    identifiant inventé transformerait cette route en un moyen de sonder
    l'annuaire national, une requête à la fois. Le service rend `None` dans les
    deux cas, et c'est la même réponse.
    """
    vue = await service.creatrice(session, business=business, creator_id=creator_id)
    if vue is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorCode.NOT_FOUND.value,
        )
    return CreateurVuRead.model_validate(vue)
