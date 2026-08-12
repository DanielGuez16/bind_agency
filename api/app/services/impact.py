"""Ce que les clics disent : audience réelle, part locale, et doutes.

**La question à laquelle ce module répond.** Un salon de Miami offre une
prestation à une créatrice qui annonce quarante mille abonnés. Combien de ces
gens sont à Miami ? Aucune plateforme ne le dit — TikTok jamais, Instagram
seulement au-dessus d'un seuil — et le nombre d'abonnés ne le suggère même pas.
Les clics le disent, sur ceux qui ont bougé.

**La part locale se calcule, elle ne se stocke pas.** Le rayon est en
configuration ; un booléen figé au moment du clic cesserait d'être vrai le jour
où on le change. Le clic garde le centre de sa ville, la distance se refait à la
lecture. C'est la même règle que le score de fiabilité, recalculé depuis ses
événements plutôt qu'écrit à la main.

**Le score d'impact local pèse zéro, et c'est délibéré.** La mécanique existe,
se teste et s'expose ; son poids est en configuration et vaut zéro tant qu'aucune
donnée réelle n'a été observée. Livrer un score qui pèse dès le premier jour
reviendrait à calibrer une note sur des chiffres qu'on n'a pas encore vus.

**Les signaux de fabrication ne rendent pas de verdict.** On ne sait pas
distinguer un humain d'un programme, et prétendre le contraire ferait accuser
des créateurs honnêtes sur une heuristique. On nomme ce qui est anormal, on
l'expose à l'administration, et un humain tranche — comme pour la revue des
contreparties.
"""

import uuid
from dataclasses import dataclass
from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Booking, Business, Collaboration, CollaborationLink, LinkClick
from app.models.enums import ClickOutcome, DeviceFamily


@dataclass(frozen=True, slots=True)
class LigneDePays:
    country_code: str | None
    clics: int


@dataclass(frozen=True, slots=True)
class LigneDeVille:
    city: str | None
    region: str | None
    country_code: str | None
    clics: int


@dataclass(frozen=True, slots=True)
class LigneDeTerminal:
    device_family: DeviceFamily
    clics: int


@dataclass(frozen=True, slots=True)
class LigneDeReferent:
    referrer_host: str | None
    clics: int


@dataclass(frozen=True, slots=True)
class Ecartes:
    """Ce qui n'a pas compté, et pourquoi.

    Rendu plutôt que tu : un compteur qui n'avance pas s'explique mieux avec
    « quatre-vingts préchargements » qu'avec le silence.
    """

    robots: int
    prechargements: int
    doublons: int

    @property
    def total(self) -> int:
        return self.robots + self.prechargements + self.doublons


@dataclass(frozen=True, slots=True)
class AudienceDesLiens:
    """L'audience mesurée sur une sélection de contreparties."""

    clics: int
    #: Clics dont le centre de ville tombe dans le rayon local du commerce.
    clics_locaux: int
    #: Rayon appliqué, en mètres. Rendu pour que « 62 % locaux » soit lisible :
    #: sans lui, la part ne dit pas de quelle zone elle parle.
    rayon_local_metres: int
    par_pays: tuple[LigneDePays, ...]
    par_ville: tuple[LigneDeVille, ...]
    par_terminal: tuple[LigneDeTerminal, ...]
    par_referent: tuple[LigneDeReferent, ...]
    ecartes: Ecartes

    @property
    def part_locale(self) -> Decimal | None:
        """Part des clics venant de la zone du commerce.

        **Nulle et non zéro quand rien n'a été cliqué.** Zéro sur zéro n'est pas
        zéro : afficher « 0 % de local » à une créatrice dont la story vient
        d'être publiée serait un reproche pour quelque chose qui n'a pas encore
        eu lieu. C'est la même règle que le taux d'honoration.
        """
        if self.clics == 0:
            return None
        return (Decimal(self.clics_locaux) / Decimal(self.clics)).quantize(Decimal("0.0001"))

    @property
    def score_impact_local(self) -> Decimal | None:
        """Le score au poids en vigueur. **Propriété et non champ calculé
        ailleurs** : posé dans la route, il aurait échappé à la garde qui
        compare chaque schéma de lecture à ce que sa structure porte — et c'est
        elle qui l'a réclamé ici."""
        return score_d_impact_local(self)


def score_d_impact_local(
    audience: "AudienceDesLiens", poids: Decimal | None = None
) -> Decimal | None:
    """La part locale, ramenée à une note pondérée.

    **Le poids vaut zéro tant qu'aucune donnée réelle n'a été observée**, et le
    score vaut donc zéro. Ce n'est pas une mécanique morte : elle se teste, elle
    s'expose, et le jour où on la fera peser ce sera en changeant une ligne de
    configuration — sur des chiffres qu'on aura vus, pas sur une intuition.

    Rend `None` quand il n'y a rien à mesurer, pour la même raison que
    `part_locale` : sans clic, il n'y a pas de score bas, il n'y a pas de score.
    """
    part = audience.part_locale
    if part is None:
        return None
    effectif = get_settings().local_impact_weight if poids is None else poids
    return (part * effectif).quantize(Decimal("0.0001"))


def _clics_comptes(filtre: sa.ColumnElement[bool]) -> sa.Select:
    """Les clics comptés d'une sélection, avec le commerce qui les a reçus.

    La jointure descend jusqu'au commerce parce que la part locale se mesure
    contre **son** point : deux contreparties de deux salons différents n'ont
    pas la même zone.
    """
    return (
        sa.select(LinkClick, Business.geo.label("business_geo"))
        .join(CollaborationLink, CollaborationLink.id == LinkClick.link_id)
        .join(Collaboration, Collaboration.id == CollaborationLink.collaboration_id)
        .join(Booking, Booking.id == Collaboration.booking_id)
        .join(Business, Business.id == Booking.business_id)
        .where(LinkClick.outcome == ClickOutcome.COUNTED, filtre)
    )


def _base(filtre: sa.ColumnElement[bool]) -> sa.Select:
    """Tous les passages d'une sélection, comptés ou non."""
    return (
        sa.select(LinkClick, Business.geo.label("business_geo"))
        .join(CollaborationLink, CollaborationLink.id == LinkClick.link_id)
        .join(Collaboration, Collaboration.id == CollaborationLink.collaboration_id)
        .join(Booking, Booking.id == Collaboration.booking_id)
        .join(Business, Business.id == Booking.business_id)
        .where(filtre)
    )


async def audience(session: AsyncSession, *, filtre: sa.ColumnElement[bool]) -> AudienceDesLiens:
    """Agrège une sélection de contreparties. Le filtre décide de la portée.

    Une seule fonction pour les trois vues — salon, créateur, administration.
    Trois requêtes séparées auraient divergé au premier champ ajouté, et c'est
    précisément le genre d'écart qui fait qu'un salon et une créatrice lisent
    deux chiffres différents de la même story.
    """
    rayon = get_settings().link_local_radius_metres
    lignes = (await session.execute(_base(filtre))).all()

    comptes = [ligne for ligne in lignes if ligne.LinkClick.outcome == ClickOutcome.COUNTED]

    # La distance se calcule en base : PostGIS sait le faire en mètres sur des
    # `geography`, et le refaire en Python demanderait de réimplémenter une
    # géodésique pour se tromper dessus.
    locaux = 0
    if comptes:
        locaux = (
            await session.scalar(
                sa.select(sa.func.count()).select_from(
                    _clics_comptes(filtre)
                    .where(
                        LinkClick.city_geo.is_not(None),
                        sa.func.ST_DWithin(LinkClick.city_geo, Business.geo, rayon),
                    )
                    .subquery()
                )
            )
            or 0
        )

    def grouper(cle) -> dict:
        totaux: dict = {}
        for ligne in comptes:
            valeur = cle(ligne.LinkClick)
            totaux[valeur] = totaux.get(valeur, 0) + 1
        return totaux

    pays = grouper(lambda clic: clic.country_code)
    villes = grouper(lambda clic: (clic.city, clic.region, clic.country_code))
    terminaux = grouper(lambda clic: clic.device_family)
    referents = grouper(lambda clic: clic.referrer_host)

    ecartes = {
        outcome: sum(1 for ligne in lignes if ligne.LinkClick.outcome == outcome)
        for outcome in (ClickOutcome.BOT, ClickOutcome.PREFETCH, ClickOutcome.DUPLICATE)
    }

    return AudienceDesLiens(
        clics=len(comptes),
        clics_locaux=locaux,
        rayon_local_metres=rayon,
        # Trié par volume décroissant : c'est l'ordre dans lequel on lit une
        # répartition, et un tri alphabétique mettrait l'Afghanistan devant
        # les États-Unis sur une audience de Miami.
        par_pays=tuple(
            LigneDePays(country_code=code, clics=nombre)
            for code, nombre in sorted(pays.items(), key=lambda item: (-item[1], str(item[0])))
        ),
        par_ville=tuple(
            LigneDeVille(city=ville, region=region, country_code=code, clics=nombre)
            for (ville, region, code), nombre in sorted(
                villes.items(), key=lambda item: (-item[1], str(item[0]))
            )
        ),
        par_terminal=tuple(
            LigneDeTerminal(device_family=famille, clics=nombre)
            for famille, nombre in sorted(
                terminaux.items(), key=lambda item: (-item[1], str(item[0]))
            )
        ),
        par_referent=tuple(
            LigneDeReferent(referrer_host=hote, clics=nombre)
            for hote, nombre in sorted(referents.items(), key=lambda item: (-item[1], str(item[0])))
        ),
        ecartes=Ecartes(
            robots=ecartes[ClickOutcome.BOT],
            prechargements=ecartes[ClickOutcome.PREFETCH],
            doublons=ecartes[ClickOutcome.DUPLICATE],
        ),
    )


async def audience_du_commerce(session: AsyncSession, *, business_id: uuid.UUID):
    """Ce que le salon a reçu, toutes ses contreparties confondues."""
    return await audience(session, filtre=Booking.business_id == business_id)


async def audience_du_createur(session: AsyncSession, *, creator_id: uuid.UUID):
    """Ce que la créatrice a apporté, toutes ses contreparties confondues."""
    return await audience(session, filtre=Booking.creator_id == creator_id)


async def audience_totale(session: AsyncSession):
    """Tout, pour l'administration."""
    return await audience(session, filtre=sa.literal(True))


# --------------------------------------------------------------------------
# les doutes
# --------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Signal:
    """Un fait anormal, nommé, avec de quoi le vérifier.

    Ni score, ni verdict : un code que l'administration lit, et les deux
    nombres qui l'ont déclenché. Une note agrégée cacherait ce qui l'a produite,
    et c'est exactement ce qu'un arbitre a besoin de voir.
    """

    code: str
    constate: Decimal
    seuil: Decimal


#: Au-dessous, on ne dit rien. Sur douze clics, toutes les proportions sont
#: aberrantes et aucune ne signifie quoi que ce soit.
CLICS_MINIMUM = 30

#: Les seuils. En dur ici et non en configuration, **délibérément** : ce ne sont
#: pas des règles métier mais des bornes de lisibilité statistique, et les
#: exposer inviterait à les régler jusqu'à ce que le signal se taise.
SEUIL_UNE_SEULE_VILLE = Decimal("0.95")
SEUIL_UN_SEUL_TERMINAL = Decimal("0.98")
SEUIL_SANS_REFERENT = Decimal("0.90")
SEUIL_PART_ECARTEE = Decimal("0.70")


def signaux_de_fabrication(audience: AudienceDesLiens) -> tuple[Signal, ...]:
    """Ce qui ne ressemble pas à du trafic humain.

    **Aucun de ces signaux ne prouve quoi que ce soit isolément.** Une story
    très locale vue sur un seul modèle de téléphone existe. C'est leur
    accumulation qui interroge, et c'est un humain qui la lit.

    Les quatre retenus sont ceux qu'un trafic fabriqué a du mal à éviter :

    - **Une seule ville.** Une audience réelle, même très locale, s'étale sur
      plusieurs villes d'une agglomération. Un script tourne d'un endroit.
    - **Un seul type de terminal.** Une audience humaine mêle téléphones,
      tablettes et ordinateurs, dans des proportions déséquilibrées mais jamais
      pures.
    - **Aucun référent.** Un clic depuis une story porte l'hôte de la
      plateforme. Un appel direct n'en a pas — c'est la signature d'un client
      qui ne vient pas d'une page.
    - **Une majorité de coups écartés.** Beaucoup de robots ou de doublons pour
      peu de clics comptés désigne un générateur, pas un public.

    On ne regarde rien au-dessous de trente clics : sur douze, toutes les
    proportions sont aberrantes et aucune ne signifie quoi que ce soit.
    """
    if audience.clics < CLICS_MINIMUM:
        return ()

    total = Decimal(audience.clics)
    signaux: list[Signal] = []

    def part(nombre: int) -> Decimal:
        return (Decimal(nombre) / total).quantize(Decimal("0.0001"))

    if audience.par_ville:
        premiere = part(audience.par_ville[0].clics)
        if premiere >= SEUIL_UNE_SEULE_VILLE:
            signaux.append(
                Signal(code="une_seule_ville", constate=premiere, seuil=SEUIL_UNE_SEULE_VILLE)
            )

    if audience.par_terminal:
        premier = part(audience.par_terminal[0].clics)
        if premier >= SEUIL_UN_SEUL_TERMINAL:
            signaux.append(
                Signal(code="un_seul_terminal", constate=premier, seuil=SEUIL_UN_SEUL_TERMINAL)
            )

    sans_referent = sum(
        ligne.clics for ligne in audience.par_referent if ligne.referrer_host is None
    )
    if sans_referent:
        proportion = part(sans_referent)
        if proportion >= SEUIL_SANS_REFERENT:
            signaux.append(
                Signal(code="sans_referent", constate=proportion, seuil=SEUIL_SANS_REFERENT)
            )

    passages = audience.clics + audience.ecartes.total
    if passages:
        ecartee = (Decimal(audience.ecartes.total) / Decimal(passages)).quantize(Decimal("0.0001"))
        if ecartee >= SEUIL_PART_ECARTEE:
            signaux.append(
                Signal(code="majorite_ecartee", constate=ecartee, seuil=SEUIL_PART_ECARTEE)
            )

    return tuple(signaux)
