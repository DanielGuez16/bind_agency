"""L'annuaire des créatrices, côté administration.

**Pourquoi une route et non celle du commerce.** `GET /business/{id}/creators`
existe et rend presque la même chose, mais elle est *située* : elle calcule une
distance depuis un salon, l'éligibilité à **ses** paliers, et elle exige un
abonnement vivant. Un administrateur n'a ni salon, ni rayon, ni abonnement — lui
servir cette route demanderait d'inventer un salon de référence, dont chaque
chiffre rendu serait faux d'une manière qu'on ne verrait pas.

**Ce qu'elle rend.** Le pseudonyme, la photo, les réseaux rattachés, le volume,
la ville, et **le score de fiabilité** — le seul chiffre qu'un commerce ne voit
jamais. Cette ligne disait l'inverse, et l'argument portait sur le *classement*
d'une liste, non sur la donnée : cet annuaire n'ordonne pas par note, il la pose
sur la ligne d'une personne qu'on est venu chercher par son pseudonyme. Ce que
la règle protège reste entier — un salon ne le lit pas, et le palier accessible
lui suffit puisqu'un score dégradé plafonne mécaniquement.

**Le volume vient du dernier relevé, pas du compte.** `SocialAccount` ne porte
aucun `followers_count` : il vit sur `SocialMetricsSnapshot`, une table en ajout
seul dont on prend la ligne la plus récente. La requête le lisait sur le compte
et levait donc à chaque appel — l'écran ne s'est jamais affiché. La sous-requête
est celle d'`eligibility`, partagée par trois autres lectures : deux façons de
dire « le dernier relevé » finiraient par donner deux chiffres différents pour
la même créatrice sur deux écrans.

**Le palier accessible et son compte, malgré leur coût.** Évaluer chaque
créatrice contre tous les paliers actifs coûtait trois requêtes **par
créatrice** avec `evaluer_createur` : cent lignes en auraient demandé trois
cents, et l'écran n'aurait jamais fini de charger. `evaluer_createurs` fait le
même calcul, sur le même ensemble de paliers lu une seule fois, en trois
requêtes pour toute la population — quatre au total avec la liste elle-même.
Le prix reste assumé : c'est ce qui rend `tier` et `peut_reserver` vrais plutôt
qu'estimés.
"""

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Annotated

import sqlalchemy as sa
from fastapi import APIRouter, Depends, Query

from app.core.dependencies import SessionDep, require_role
from app.models import CreatorProfile, SocialAccount, User
from app.models.enums import SocialAccountStatus, UserRole, UserStatus
from app.schemas.creator_admin import (
    AnnuaireAdminRead,
    CreateurAdminRead,
    PalierAccessibleRead,
    ReseauDuCreateurRead,
)
from app.services import eligibility
from app.services.directory import ORDRE_DES_FORMATS, lien_public

router = APIRouter(
    prefix="/admin/creators",
    tags=["admin"],
    dependencies=[Depends(require_role(UserRole.ADMIN))],
)

#: La borne de la page. Même valeur que l'annuaire des salons, et pour la même
#: raison : au-delà, on ne lit plus, on cherche — et la recherche par nom est
#: le geste qui répond à ça.
PLAFOND = 100


@router.get("", response_model=AnnuaireAdminRead)
async def list_creators(
    session: SessionDep,
    recherche: Annotated[str | None, Query(max_length=100)] = None,
) -> AnnuaireAdminRead:
    """Les créatrices inscrites, la plus récente d'abord.

    **Les anonymisées n'y sont pas.** Un compte supprimé a perdu son
    pseudonyme et sa photo ; le laisser dans la liste afficherait une ligne
    vide que personne ne peut relier à quoi que ce soit.
    """
    depuis_une_semaine = datetime.now(UTC) - timedelta(days=7)

    releve = eligibility._dernier_releve()
    comptes = (
        sa.select(
            SocialAccount.creator_id,
            SocialAccount.platform,
            SocialAccount.handle,
            SocialAccount.avatar_key,
            releve.c.followers_count,
        )
        # **En jointure externe** : un compte rattaché ce matin n'a pas encore
        # de relevé, et l'exclure ferait disparaître de l'annuaire la créatrice
        # qui vient d'arriver — précisément celle qu'on y cherche.
        .join(releve, releve.c.social_account_id == SocialAccount.id, isouter=True)
        .where(SocialAccount.status == SocialAccountStatus.ACTIVE)
        .subquery()
    )

    requete = (
        sa.select(
            User.id,
            CreatorProfile.city,
            CreatorProfile.reliability_score,
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
            {
                "creator_id": ligne.id,
                "city": ligne.city,
                "created_at": ligne.created_at,
                "reliability_score": ligne.reliability_score,
                "reseaux": [],
                "audience_totale": 0,
            },
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

    lignes = list(groupes.values())

    # **Sur `lignes`, pas sur la page.** `peut_reserver` décrit la même
    # population que les quatre autres nombres de tête — la recherche entière,
    # pas les cent lignes que le plafond laisse passer. Un total qui bouge sans
    # que ce compte bouge ferait douter du chiffre qui ment.
    eligibilites = await eligibility.evaluer_createurs(
        session, (ligne["creator_id"] for ligne in lignes)
    )
    for ligne in lignes:
        ligne["tier"] = _meilleur_palier(eligibilites[ligne["creator_id"]])

    # **Les quatre premiers nombres portent sur la recherche, pas sur la
    # population.** Un chiffre qui ne bougerait pas en tapant ne dirait rien de
    # ce qu'on cherche — c'est l'arbitrage rendu sur l'annuaire des salons. Sans
    # recherche, la recherche courante *est* la population, qui est le cas que
    # la tête décrit.
    #
    # Ils se comptent sur `lignes` et non par des requêtes séparées : la
    # jointure et le filtre sont déjà faits, et les refaire en requêtes à part
    # ferait autant d'occasions de diverger du contenu affiché.
    scores = [
        ligne["reliability_score"] for ligne in lignes if ligne["reliability_score"] is not None
    ]

    return AnnuaireAdminRead(
        # **Le plafond ne tombe que sur la liste.** Les nombres, eux, portent
        # sur tout ce que la recherche a trouvé : c'est précisément ce que le
        # plafond empêcherait de savoir.
        items=[CreateurAdminRead(**vu) for vu in lignes[:PLAFOND]],
        total=len(lignes),
        arrivees_cette_semaine=sum(
            1 for ligne in lignes if ligne["created_at"] >= depuis_une_semaine
        ),
        fiabilite_mediane=_mediane(scores),
        createurs_avec_score=len(scores),
        peut_reserver=sum(1 for ligne in lignes if ligne["tier"] is not None),
    )


def _meilleur_palier(eligibilite: eligibility.Eligibilite) -> PalierAccessibleRead | None:
    """Le plus exigeant des paliers accessibles, n'importe où.

    **Le même choix que l'annuaire du commerce fait pour « ici ».** Un seul
    palier tient sur une ligne de tableau ; la liste complète en dirait plus
    qu'une colonne ne peut lire, et ce n'est pas la question de cet écran —
    savoir *qui peut réserver*, pas *tout ce qu'elle ouvre*.
    """
    accessibles = [acces for acces in eligibilite.acces if acces.accessible]
    if not accessibles:
        return None
    meilleur = max(accessibles, key=lambda acces: ORDRE_DES_FORMATS.index(acces.content_format))
    return PalierAccessibleRead(
        tier_id=meilleur.tier_id,
        platform=meilleur.platform,
        content_format=meilleur.content_format,
    )


def _mediane(valeurs: list[Decimal]) -> Decimal | None:
    """La médiane, ou rien.

    **Nulle plutôt que zéro sur une liste vide.** Zéro serait une médiane, et
    fausse : elle placerait la population au plus bas de l'échelle alors
    qu'aucun score n'a encore été mesuré. C'est la même distinction que le score
    lui-même fait entre « neutre » et « zéro ».
    """
    if not valeurs:
        return None
    ordonnees = sorted(valeurs)
    milieu = len(ordonnees) // 2
    if len(ordonnees) % 2 == 1:
        return ordonnees[milieu]
    return (ordonnees[milieu - 1] + ordonnees[milieu]) / 2
