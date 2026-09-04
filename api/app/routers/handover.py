"""La fiche préparée sur le terrain, et sa prise en main.

**Deux côtés, et ils n'ont pas les mêmes règles d'accès.** L'administration
prépare et émet ; le salon prend en main sans être connecté, sur la seule
possession du lien. Le second n'a donc aucune dépendance de rôle — et c'est
exactement pourquoi ses trois routes ne rendent jamais rien qu'on ne veuille
montrer à qui essaierait des jetons au hasard.
"""

import logging
import uuid
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, Path, status

from app.core.config import get_settings
from app.core.dependencies import CurrentUser, SessionDep, require_role
from app.core.errors import ErrorCode, api_error
from app.integrations.email import Message, get_sender
from app.integrations.geocoding import Geocoder, get_geocoder
from app.models import Business
from app.models.enums import HandoverChannel, UserRole
from app.routers.business import lire_le_commerce
from app.schemas.business import BusinessCreate, BusinessRead
from app.schemas.handover import (
    ApercuDeLaFiche,
    JetonACreer,
    LienRemisRead,
    LigneDeSuiviRead,
    PriseEnMain,
    RattachementDeCompte,
)
from app.services import auth as auth_service
from app.services import handover as service
from app.services import notifications

logger = logging.getLogger(__name__)

admin_router = APIRouter(
    prefix="/admin/prospects",
    tags=["handover"],
    dependencies=[Depends(require_role(UserRole.ADMIN))],
)

#: Sans rôle, et volontairement : c'est le salon qui vient, et il n'a pas
#: encore de compte. Le jeton fait toute l'autorisation.
public_router = APIRouter(prefix="/handover", tags=["handover"])

GeocoderDep = Annotated[Geocoder, Depends(get_geocoder)]

_CODES = {
    service.HandoverUnknown: (status.HTTP_404_NOT_FOUND, ErrorCode.HANDOVER_INVALID),
    service.NotADraft: (status.HTTP_409_CONFLICT, ErrorCode.HANDOVER_NOT_A_DRAFT),
    service.TermsNotAccepted: (status.HTTP_409_CONFLICT, ErrorCode.HANDOVER_TERMS_OUTDATED),
    auth_service.EmailAlreadyUsed: (status.HTTP_409_CONFLICT, ErrorCode.EMAIL_ALREADY_USED),
}


def _traduire(erreur: Exception):
    http_status, code = _CODES[type(erreur)]
    return api_error(http_status, code)


# ---------------------------------------------------------------------------
# Côté fondatrice : préparer, émettre, révoquer, suivre.
# ---------------------------------------------------------------------------


@admin_router.post("", response_model=BusinessRead, status_code=status.HTTP_201_CREATED)
async def prepare_prospect(
    payload: BusinessCreate,
    user: CurrentUser,
    session: SessionDep,
    geocoder: GeocoderDep,
) -> BusinessRead:
    """Crée la fiche en `draft`, sans membre et sans propriétaire.

    Ce que la fondatrice saisit au comptoir pendant la démonstration : des
    faits. Le reste — le compte, les conditions, la mise en ligne — appartient
    au salon et ne se prépare pas à sa place.
    """
    business = await service.preparer_la_fiche(
        session, payload=payload, prepare_par=user, geocoder=geocoder
    )
    await session.commit()
    return await lire_le_commerce(session, business)


@admin_router.get("", response_model=list[LigneDeSuiviRead])
async def list_prospects(session: SessionDep) -> list[LigneDeSuiviRead]:
    """Les fiches préparées et l'état de leur lien, la plus récente d'abord.

    C'est la mesure du démarchage : préparées, envoyées, assumées. Les fiches
    déjà assumées y restent — une liste qui ne montrerait que le reste à faire
    ne dirait jamais combien de visites ont abouti.
    """
    return [LigneDeSuiviRead.model_validate(ligne) for ligne in await service.suivi(session)]


@admin_router.post("/{business_id}/handover", response_model=LienRemisRead)
async def issue_handover(
    business_id: Annotated[uuid.UUID, Path()],
    payload: JetonACreer,
    user: CurrentUser,
    session: SessionDep,
) -> LienRemisRead:
    """Émet le lien, ferme le précédent, et l'envoie si un canal le demande.

    **L'adresse est rendue quoi qu'il arrive.** Un envoi qui échoue ne doit pas
    faire perdre le jeton : la fondatrice a l'adresse à l'écran, elle la montre
    en QR ou la dicte. Rendre une erreur l'obligerait à réémettre — donc à
    invalider un lien parfaitement valide.
    """
    business = await session.get(Business, business_id)
    if business is None:
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.BUSINESS_NOT_FOUND)

    try:
        emis = await service.emettre(
            session,
            business=business,
            emis_par=user,
            canal=payload.channel,
            destination=payload.destination,
        )
    except service.NotADraft as erreur:
        raise _traduire(erreur) from erreur
    await session.commit()

    if payload.channel is HandoverChannel.EMAIL and payload.destination:
        await _deposer_l_invitation(
            session,
            destinataire=payload.destination,
            business=business,
            url=emis.url,
            expiration=emis.expires_at.isoformat(timespec="minutes"),
        )

    return LienRemisRead.model_validate(emis)


@admin_router.delete("/{business_id}/handover", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_handover(
    business_id: Annotated[uuid.UUID, Path()],
    user: CurrentUser,
    session: SessionDep,
) -> None:
    """Ferme le lien en cours. Sans erreur s'il n'y en avait pas.

    « Il n'y avait rien à fermer » est le résultat voulu quand on veut être sûr
    que plus rien n'est ouvert : un 404 ferait douter, et ferait recommencer.
    """
    business = await session.get(Business, business_id)
    if business is None:
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.BUSINESS_NOT_FOUND)

    await service.revoquer(session, business=business, actor=user)
    await session.commit()


# ---------------------------------------------------------------------------
# Côté salon : voir, puis assumer.
# ---------------------------------------------------------------------------


@public_router.get("/{jeton}", response_model=ApercuDeLaFiche)
async def preview_handover(jeton: str, session: SessionDep) -> ApercuDeLaFiche:
    """Ce qui a été préparé, avant de s'engager à quoi que ce soit.

    **Une lecture qui écrit une fois**, et c'est assumé : elle note la première
    ouverture du lien. Une route qui n'écrirait rien ne pourrait pas dire qu'on
    l'a appelée, et c'est exactement ce que la tournée a besoin de savoir — un
    lien jamais vu se revisite, un lien vu puis abandonné se relance.
    """
    try:
        lien = await service.resoudre(session, jeton=jeton)
        vue = await service.apercu(session, handover=lien)
        await service.marquer_ouvert(session, handover=lien)
    except service.HandoverUnknown as erreur:
        raise _traduire(erreur) from erreur

    await session.commit()
    return ApercuDeLaFiche(
        business_name=vue.business.name,
        address=vue.business.address,
        phone=vue.business.phone,
        prestations_preparees=vue.prestations_preparees,
        plages_preparees=vue.plages_preparees,
        terms_version=get_settings().terms_version,
    )


@public_router.post("/{jeton}/claim", response_model=BusinessRead)
async def claim_handover(
    jeton: str,
    payload: PriseEnMain,
    session: SessionDep,
) -> BusinessRead:
    """Le salon crée son compte et devient propriétaire de sa fiche.

    Il ne repart pas connecté : il se connecte ensuite, avec le mot de passe
    qu'il vient de choisir. Émettre une session ici ferait du lien un moyen
    d'ouvrir une session, alors qu'il n'est qu'un moyen d'assumer une fiche.
    """
    try:
        lien = await service.resoudre(session, jeton=jeton)
        _, business = await service.prendre_en_main(
            session,
            handover=lien,
            email=payload.email,
            password=payload.password,
            terms_version=payload.terms_version,
            date_of_birth=payload.date_of_birth,
            locale=payload.locale,
        )
    except (
        service.HandoverUnknown,
        service.NotADraft,
        service.TermsNotAccepted,
        auth_service.EmailAlreadyUsed,
    ) as erreur:
        # **Le refus se note, et il note un état de tournée, pas une erreur.**
        # Quelqu'un est arrivé jusqu'à l'engagement et s'est arrêté là : c'est
        # un problème de produit, qui ne se règle ni en revisitant ni en
        # relançant. `HandoverUnknown` est exclu — un jeton inconnu n'a pas de
        # ligne à marquer, et une expiration n'est pas un blocage.
        if not isinstance(erreur, service.HandoverUnknown):
            await service.marquer_bloque(session, handover=lien)
            await session.commit()
        raise _traduire(erreur) from erreur

    await session.commit()
    return await lire_le_commerce(session, business)


@public_router.post("/{jeton}/attach", response_model=BusinessRead)
async def attach_handover(
    jeton: str,
    payload: RattachementDeCompte,
    user: CurrentUser,
    session: SessionDep,
) -> BusinessRead:
    """Un compte commerce qui existe déjà assume la fiche.

    Le cas du propriétaire de deux adresses : lui refuser le lien parce que son
    adresse électronique est connue l'obligerait à s'en inventer une seconde.
    """
    if user.role is not UserRole.BUSINESS_MEMBER:
        raise api_error(status.HTTP_403_FORBIDDEN, ErrorCode.INSUFFICIENT_ROLE)

    try:
        lien = await service.resoudre(session, jeton=jeton)
        business = await service.rattacher(
            session, handover=lien, utilisateur=user, terms_version=payload.terms_version
        )
    except (service.HandoverUnknown, service.NotADraft, service.TermsNotAccepted) as erreur:
        raise _traduire(erreur) from erreur

    await session.commit()
    return await lire_le_commerce(session, business)


async def _deposer_l_invitation(
    session, *, destinataire: str, business: Business, url: str, expiration: str
) -> None:
    """Dépose l'invitation, **si le destinataire a un compte**.

    C'est ici que la boîte d'envoi ne suffit pas, et il faut le dire : elle
    écrit à un utilisateur, et le gérant qu'on invite n'en est pas encore un —
    c'est précisément ce que le lien existe pour changer. L'invitation part
    donc directement, comme avant.

    **Et c'est défendable ici.** L'adresse est rendue à l'écran quoi qu'il
    arrive : la fondatrice a le QR sous les yeux, elle n'attend pas ce courriel
    pour continuer, et un envoi qui traîne ne lui coûte que le temps de la
    requête d'émission — pas la perte de l'information.
    """
    del session

    try:
        async with httpx.AsyncClient() as client:
            await get_sender(client).envoyer(
                Message(
                    destinataire=destinataire,
                    sujet=notifications.rendre(
                        "handover.invitation.subject",
                        business.default_locale,
                        business=business.name,
                    ),
                    corps=notifications.rendre(
                        "handover.invitation.body",
                        business.default_locale,
                        business=business.name,
                        url=url,
                        expiration=expiration,
                    ),
                    locale=business.default_locale,
                )
            )
    except Exception:
        logger.exception(
            "invitation de prise en main non envoyée", extra={"business_id": str(business.id)}
        )
