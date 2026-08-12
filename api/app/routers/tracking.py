"""La redirection publique, et les trois lectures de l'audience mesurée.

**La redirection est la seule route anonyme du produit qui écrit en base.** Elle
n'a ni jeton ni session : c'est un inconnu qui ouvre une story. Trois
conséquences tenues ici — elle ne lève jamais sur une adresse inconnue autrement
qu'en 404, elle ne renvoie aucune donnée, et elle ne fait jamais attendre.

**Elle vit hors de `/api/v1`.** Le lien va dans un sticker de story, où il se
lit et parfois se recopie à la main : `bind.example/r/k3f9x2` tient, pas
`bind.example/api/v1/tracking/redirect/k3f9x2`.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Request, status
from fastapi.responses import RedirectResponse

from app.core.config import get_settings
from app.core.dependencies import CurrentBusiness, CurrentUser, SessionDep, require_role
from app.core.errors import ErrorCode, api_error
from app.integrations.geoip import get_geo_resolver
from app.models.enums import UserRole
from app.schemas.tracking import AudienceArbitrableRead, AudienceDesLiensRead, LienRead
from app.services import impact as impact_service
from app.services import tracking as service

#: Hors préfixe : le lien doit rester court, il voyage dans une story.
redirect_router = APIRouter(tags=["tracking"])

creator_router = APIRouter(
    prefix="/me", tags=["tracking"], dependencies=[Depends(require_role(UserRole.CREATOR))]
)
business_router = APIRouter(prefix="/business", tags=["tracking"])
admin_router = APIRouter(
    prefix="/admin", tags=["tracking"], dependencies=[Depends(require_role(UserRole.ADMIN))]
)


def _adresse_du_visiteur(request: Request, forwarded: str | None) -> str | None:
    """L'adresse du client, derrière le répartiteur de l'hébergeur.

    **Le premier maillon de `X-Forwarded-For`, pas le dernier.** La liste se lit
    du client vers le proxy ; prendre le dernier géolocaliserait le répartiteur,
    et tous les clics viendraient du même centre de données.

    **Elle ne quitte pas cette fonction sans être consommée.** Le service la
    reçoit, en tire une ville et une empreinte, et n'en garde rien.
    """
    if forwarded:
        premier = forwarded.split(",")[0].strip()
        if premier:
            return premier
    return request.client.host if request.client else None


@redirect_router.get(
    "/r/{slug}",
    status_code=status.HTTP_302_FOUND,
    responses={404: {"description": ErrorCode.NOT_FOUND.value}},
)
@redirect_router.head("/r/{slug}", status_code=status.HTTP_302_FOUND)
async def suivre_le_lien(
    slug: str,
    request: Request,
    session: SessionDep,
    user_agent: Annotated[str | None, Header()] = None,
    referer: Annotated[str | None, Header()] = None,
    x_forwarded_for: Annotated[str | None, Header()] = None,
) -> RedirectResponse:
    """Enregistre le passage, puis envoie sur la fiche du salon.

    **L'enregistrement ne doit jamais retarder la redirection**, et il ne doit
    jamais l'empêcher : quelqu'un a touché un sticker, il attend d'arriver
    quelque part. Un échec de mesure se paie en donnée manquante, pas en page
    blanche.

    `HEAD` est accepté et enregistré comme préchargement : les plateformes
    l'utilisent pour construire un aperçu, et le refuser leur ferait croire le
    lien mort.
    """
    settings = get_settings()
    base = settings.link_redirect_base_url
    if base is None:
        # **On refuse plutôt que d'inventer une destination.** Une redirection
        # vers une adresse devinée enverrait le public d'un salon nulle part.
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)

    passage = service.Passage(
        ip=_adresse_du_visiteur(request, x_forwarded_for),
        user_agent=user_agent,
        referer=referer,
        entetes={nom.lower(): valeur for nom, valeur in request.headers.items()},
        methode=request.method,
    )

    try:
        lien, _ = await service.ouvrir(
            session, slug=slug, passage=passage, resolveur=get_geo_resolver()
        )
    except service.LienIntrouvable as absent:
        # Un lien mort ou désactivé. 404 sec : le visiteur n'a rien à corriger,
        # et distinguer « jamais existé » de « désactivé » dirait à qui essaie
        # des adresses au hasard laquelle a déjà servi.
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND) from absent
    business_id = await service.business_du_lien(session, lien)
    # **Sans validation explicite, le clic n'existe pas.** `get_session` ne
    # valide rien : chaque route le fait, et une route de mesure qui l'oublie
    # se comporte parfaitement — elle redirige — en ne comptant jamais rien.
    await session.commit()

    return RedirectResponse(
        url=f"{base.rstrip('/')}/{business_id}", status_code=status.HTTP_302_FOUND
    )


@creator_router.get("/collaborations/{collaboration_id}/link", response_model=LienRead)
async def read_my_link(
    collaboration_id: uuid.UUID, user: CurrentUser, session: SessionDep
) -> LienRead:
    """Le lien à coller dans le sticker, créé à la première demande.

    Réservé au créateur **de cette contrepartie** : le lien est le levier de sa
    mesure, et laisser un tiers l'obtenir laisserait fabriquer des clics sur
    une collaboration qui n'est pas la sienne.
    """
    try:
        lien = await service.lien_du_createur(
            session, collaboration_id=collaboration_id, creator_id=user.id
        )
    except service.ContrepartieIntrouvable as absente:
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.COLLABORATION_NOT_FOUND) from absente
    # Le lien est créé à la première demande : sans validation, il serait
    # retiré au créateur dès qu'il quitte l'écran, et retiré différent ensuite.
    await session.commit()
    return LienRead(
        collaboration_id=lien.collaboration_id,
        slug=lien.slug,
        url=service.url_du_lien(lien.slug),
        is_active=lien.is_active,
    )


@creator_router.get("/link-clicks", response_model=AudienceDesLiensRead)
async def read_my_audience(user: CurrentUser, session: SessionDep) -> AudienceDesLiensRead:
    """Ce que ses publications ont réellement apporté, toutes contreparties confondues.

    C'est le seul endroit du produit où un créateur lit une audience **mesurée**
    plutôt que déclarée par une plateforme.
    """
    vue = await impact_service.audience_du_createur(session, creator_id=user.id)
    return _rendre(vue)


@business_router.get("/{business_id}/link-clicks", response_model=AudienceDesLiensRead)
async def read_business_audience(
    business: CurrentBusiness, session: SessionDep
) -> AudienceDesLiensRead:
    """Ce que le salon a reçu. L'isolation vient du résolveur d'appartenance."""
    vue = await impact_service.audience_du_commerce(session, business_id=business.id)
    return _rendre(vue)


@admin_router.get("/link-clicks", response_model=AudienceArbitrableRead)
async def read_all_audience(session: SessionDep) -> AudienceArbitrableRead:
    """Tout, plus les doutes.

    **Les signaux ne sortent que là.** Un doute n'est pas un fait : le montrer
    au salon ferait refuser des publications sur une heuristique que personne
    n'a arbitrée.
    """
    vue = await impact_service.audience_totale(session)
    return AudienceArbitrableRead(
        **_rendre(vue).model_dump(),
        signaux=[
            {"code": signal.code, "constate": signal.constate, "seuil": signal.seuil}
            for signal in impact_service.signaux_de_fabrication(vue)
        ],
    )


def _rendre(vue: impact_service.AudienceDesLiens) -> AudienceDesLiensRead:
    """Une seule traduction pour les trois vues.

    Les propriétés calculées — part locale, score — ne sont pas des colonnes :
    les recopier dans chaque route les ferait diverger au premier ajustement.
    """
    return AudienceDesLiensRead(
        clics=vue.clics,
        clics_locaux=vue.clics_locaux,
        rayon_local_metres=vue.rayon_local_metres,
        part_locale=vue.part_locale,
        score_impact_local=vue.score_impact_local,
        par_pays=list(vue.par_pays),
        par_ville=list(vue.par_ville),
        par_terminal=list(vue.par_terminal),
        par_referent=list(vue.par_referent),
        ecartes=vue.ecartes,
    )
