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
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Business, CreatorProfile, SocialAccount, User
from app.models.enums import (
    CentreDInteret,
    ContentFormat,
    Platform,
    SocialAccountStatus,
    UserStatus,
)
from app.services import eligibility, portee_locale

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
class PalierAccessibleIci:
    """Le meilleur palier qu'elle ouvre **chez ce salon**.

    Le meilleur et non la liste : l'écran écrit « elle ouvre le reel » sur une
    ligne de grille, et une énumération y tiendrait mal. La liste complète reste
    dans `paliers_ouverts`, juste à côté.
    """

    tier_id: uuid.UUID
    platform: Platform
    content_format: ContentFormat


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
    #: Les formats qu'elle ouvre **chez ce salon**, du moins au plus exigeant.
    #:
    #: **Chez ce salon, et c'est un changement de sens.** L'annuaire évaluait
    #: l'éligibilité contre tous les paliers actifs du produit : la liste
    #: répondait « elle se qualifie quelque part », ce qu'un salon ne peut rien
    #: faire. Elle répond maintenant « elle peut réserver ce que vous avez
    #: ouvert », ce qui est la seule question qu'il se pose.
    paliers_ouverts: tuple[ContentFormat, ...]
    #: Vrai quand au moins un palier de ce salon lui est accessible. C'est le
    #: premier critère du tri, avant la distance : une créatrice joignable à
    #: douze kilomètres vaut mieux qu'une créatrice hors de portée d'en face.
    peut_reserver_ici: bool
    #: Le meilleur des paliers qu'elle ouvre ici. Nul quand elle n'en ouvre
    #: aucun — et l'écran a alors `peut_reserver_ici` à faux pour le dire.
    palier_accessible: PalierAccessibleIci | None
    #: Sa distance au salon, en mètres. **Nulle veut dire « on ne sait pas »**,
    #: jamais « loin » : une créatrice sans position renseignée existe, elle
    #: peut réserver, et le rayon ne peut rien dire d'elle. Elle passe en fin de
    #: tri plutôt que d'être écartée.
    distance_metres: int | None
    #: Ce qu'elle a déclaré vouloir couvrir, entre un et trois. Vide quand elle
    #: n'a rien déclaré — la majorité, tant que l'écran de saisie est neuf.
    #:
    #: **Exposé parce que la carte le montre.** C'est la règle du reste de ce
    #: fichier : ce qu'un écran ne montre pas ne part pas. Ici l'inverse vaut
    #: aussi — le salon qui filtre sur « ongles » doit voir sur quoi la ligne a
    #: répondu, sinon le filtre agit sans se justifier.
    interets: tuple[str, ...]
    #: Le volume cumulé des comptes rattachés. Un ordre de grandeur d'audience,
    #: jamais une portée atteinte — la même précaution que sur les rapports.
    audience_totale: int


#: L'ordre des formats, du moins au plus exigeant. Celui des jetons.
ORDRE_DES_FORMATS = (ContentFormat.STORY, ContentFormat.POST, ContentFormat.REEL)


@dataclass(frozen=True, slots=True)
class PageDAnnuaire:
    """Une page de l'annuaire, et de quoi savoir qu'il y en a d'autres.

    Le total accompagne la page parce qu'un écran qui pagine doit dire « 20 sur
    128 » : sans lui, il ne sait pas s'il montre tout ou le début, et une
    dernière page pleine se lit comme une liste tronquée.
    """

    createurs: tuple[CreateurVu, ...]
    total: int


@dataclass(frozen=True, slots=True)
class FiltreDAnnuaire:
    """Ce que l'écran demande de retenir. Tout est facultatif.

    **Un objet plutôt que quatre paramètres** : ils voyagent ensemble depuis la
    route jusqu'au compte, et les passer un par un ferait que l'un d'eux serait
    oublié quelque part — c'est-à-dire que le total et la liste ne diraient plus
    la même chose.
    """

    #: Les formats retenus. Vide veut dire « tous », jamais « aucun ».
    #:
    #: Une créatrice est retenue si **au moins un** des formats demandés lui est
    #: accessible chez ce salon. Exiger qu'elle les ouvre tous répondrait à une
    #: autre question, et ce n'est pas celle que la planche pose.
    paliers: frozenset[ContentFormat] = frozenset()
    #: Le réseau retenu. Nul veut dire « tous ».
    #:
    #: Elle est retenue si elle a un compte **actif** sur ce réseau. Un compte
    #: révoqué n'est pas un réseau atteignable — même règle que la liste de ses
    #: comptes, et deux règles différentes se contrediraient à l'écran.
    reseau: Platform | None = None
    #: La distance maximale, en mètres. Nulle veut dire « le rayon entier ».
    #:
    #: **Une créatrice sans position est écartée dès que ce filtre est posé.**
    #: C'est le seul endroit où l'inconnue se traite ainsi, et c'est justifié :
    #: le filtre demande « à moins de trois kilomètres », et on ne peut pas
    #: l'affirmer d'elle. Sans filtre elle reste, en fin de tri — l'inconnue
    #: n'est écartée que lorsqu'on demande une garantie qu'elle ne peut pas
    #: donner.
    distance_max_metres: int | None = None
    #: Les centres d'intérêt retenus. Vide veut dire « tous », jamais « aucun ».
    #:
    #: **Au moins un en commun**, comme les paliers et pour la même raison :
    #: le salon qui coche « ongles » et « maquillage » cherche l'une ou
    #: l'autre, pas quelqu'un qui fait les deux.
    #:
    #: Celle qui n'a rien déclaré est écartée dès que ce filtre est posé —
    #: même règle que la distance inconnue : on ne peut pas affirmer d'elle
    #: qu'elle couvre ce qu'on demande. Sans filtre, elle reste.
    interets: frozenset[CentreDInteret] = frozenset()

    def __bool__(self) -> bool:
        return bool(self.paliers or self.reseau or self.distance_max_metres or self.interets)


def _retenue(vu: CreateurVu, filtre: FiltreDAnnuaire) -> bool:
    """Cette créatrice passe-t-elle le filtre.

    Écrite en Python et non en SQL : l'accès à un palier se calcule par
    `eligibility.evaluer`, qui est pure et ne se traduit pas en clause. Le
    filtre s'applique donc sur ce qui a déjà été évalué — ce qui est aussi ce
    qui garantit que le total et la liste sortent du même calcul.
    """
    if filtre.paliers and not (set(vu.paliers_ouverts) & filtre.paliers):
        return False
    if filtre.reseau and not any(compte.platform is filtre.reseau for compte in vu.comptes):
        return False
    if filtre.interets and not (set(vu.interets) & filtre.interets):
        return False
    # Inconnue écartée : le filtre demande une garantie qu'on ne peut pas donner
    # d'elle. Sans filtre, elle reste et passe en fin de tri.
    return filtre.distance_max_metres is None or (
        vu.distance_metres is not None and vu.distance_metres <= filtre.distance_max_metres
    )


def _vu_de(
    profil: Any,
    lignes: Sequence[Any],
    paliers: Sequence[Any],
    *,
    maintenant: datetime,
    age_max: timedelta,
) -> CreateurVu | None:
    """Ce qu'un salon voit d'une seule créatrice, sans aucune requête.

    **Extraite pour être appelée deux fois, et c'est la seule façon que la
    liste et la fiche disent la même chose.** Les tenir séparées ferait deux
    endroits où la règle peut diverger le jour où l'une des deux change —
    l'argument déjà rendu dans `eligibility` entre `evaluer_createur` et
    `evaluer_createurs`, sur cette donnée précisément.

    **Pure, et c'est ce qui garde le lot à trois requêtes.** Elle reçoit ce
    que l'appelant a déjà lu ; l'annuaire l'appelle dans sa boucle sans rien
    demander de plus, et la garde qui compte les requêtes reste verte par
    construction.

    Rend `None` quand la créatrice n'a aucun compte rattaché : pour la liste
    c'est une ligne qu'on saute, pour la fiche c'est un 404.
    """
    if not lignes:
        return None

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
        age_max=age_max,
    )

    accessibles = [palier for palier in paliers if palier.tier_id in verdict.paliers_accessibles]
    ouverts = {palier.content_format for palier in accessibles}
    # Le plus exigeant des paliers ouverts : c'est celui qui décrit le
    # mieux ce qu'elle peut faire ici, et le seul qui tienne sur une ligne.
    meilleur = max(
        accessibles,
        key=lambda palier: ORDRE_DES_FORMATS.index(palier.content_format),
        default=None,
    )

    return CreateurVu(
        creator_id=profil.user_id,
        city=profil.city,
        # **La biographie part avec le reste, et ce n'est pas de
        # l'excès de zèle.** C'est du texte libre : « écris-moi sur
        # @rebecca.miami » y tient très bien, et masquer le champ
        # `handle` en laissant passer la bio rendrait le pseudonyme par
        # l'autre porte. Une règle qui ferme les champs qu'on a nommés
        # et laisse ouverte la seule zone où l'utilisateur écrit ce
        # qu'il veut ne protège rien.
        bio=profil.bio,
        comptes=tuple(
            CompteVu(
                platform=ligne.platform,
                # Le réseau reste, ce qui l'identifie part. Savoir
                # qu'elle est sur TikTok ne dit pas qui elle est.
                handle=ligne.handle,
                followers=ligne.followers_count,
                avatar_key=ligne.avatar_key,
                profil_url=lien_public(ligne.platform, ligne.handle),
            )
            for ligne in lignes
            # Un compte révoqué ou refusé n'est pas un réseau atteignable.
            if ligne.status is SocialAccountStatus.ACTIVE
        ),
        paliers_ouverts=tuple(f for f in ORDRE_DES_FORMATS if f in ouverts),
        peut_reserver_ici=bool(accessibles),
        palier_accessible=(
            PalierAccessibleIci(
                tier_id=meilleur.tier_id,
                platform=meilleur.platform,
                content_format=meilleur.content_format,
            )
            if meilleur is not None
            else None
        ),
        distance_metres=(
            int(profil.distance_metres) if profil.distance_metres is not None else None
        ),
        interets=tuple(profil.interests or ()),
        audience_totale=sum(ligne.followers_count or 0 for ligne in lignes),
    )


def _portee_du_salon(business: Business) -> tuple[Any, list[Any]]:
    """Qui ce salon a le droit de voir, et à quelle distance.

    **Une seule écriture pour deux lectures.** L'annuaire liste, la fiche
    ouvre. Si chacune décidait de son côté qui est visible, l'écart ne se
    verrait pas comme un désaccord : il se lirait comme une rangée qui mène à
    une page vide — la créatrice est bien dans la liste, sa fiche répond
    « introuvable », et rien à l'écran ne l'explique.

    La distance est nulle quand l'une des deux positions manque : une fiche en
    préparation n'a pas de rayon, une créatrice sans position n'a pas de
    distance.

    **Le rayon n'écarte pas les sans-position.** Elles n'ont pas de distance,
    donc pas de preuve d'être loin ; les jeter serait décider à leur place.
    Elles passent en fin de tri, ce qui est le bon traitement d'une inconnue —
    visible, et jamais devant ce qu'on sait.
    """
    distance = (
        sa.func.ST_Distance(CreatorProfile.geo, business.geo)
        if business.geo is not None
        else sa.literal(None)
    )

    conditions = [CreatorProfile.anonymized_at.is_(None), User.status == UserStatus.ACTIVE]
    if business.geo is not None:
        conditions.append(
            sa.or_(
                CreatorProfile.geo.is_(None),
                sa.func.ST_DWithin(
                    CreatorProfile.geo, business.geo, get_settings().feed_radius_metres
                ),
            )
        )
    return distance, conditions


async def annuaire(
    session: AsyncSession,
    *,
    business: Business,
    filtre: FiltreDAnnuaire | None = None,
    limite: int = 50,
    decalage: int = 0,
) -> PageDAnnuaire:
    """Les créateurs qu'un salon peut atteindre, complets ou en aperçu.

    **Elle ne sert qu'un salon abonné.** La route refuse avant d'arriver ici, et
    c'est la bonne place pour ce refus : une fonction de lecture qui devrait
    aussi décider qui a le droit de lire finirait par être appelée d'ailleurs,
    sans le contrôle.

    Le mode dégradé — pseudonyme, volume et photo retirés, aperçu flouté à la
    place — a existé et a été retiré : il n'avait aucun écran pour
    l'accompagner. La machinerie du floutage reste, elle, et attend le jour où
    l'on voudra montrer un aperçu.

    **Seulement ceux qui ont un compte rattaché.** Un profil sans réseau n'offre
    rien à un commerce : ni volume, ni palier, ni publication possible. L'y
    faire figurer gonflerait l'annuaire de lignes vides, ce qui est exactement
    la mauvaise façon de vendre un réseau.

    ## L'annuaire de **ce** salon

    Les paliers évalués sont ceux que ce commerce offre réellement, pas tous
    ceux du produit. C'est ce qui fait dire à `paliers_ouverts` « elle peut
    réserver ce que vous avez ouvert » au lieu de « elle se qualifie quelque
    part » — la seconde phrase n'appelle aucun geste.

    ## Le tri, et pourquoi il est ici

    Accès d'abord, proximité ensuite. Une créatrice joignable à douze
    kilomètres vaut mieux qu'une créatrice hors de portée d'en face, et c'est
    l'ordre que la planche demande.

    **Trié par le serveur, et c'est structurel** : une liste paginée qu'on
    trierait dans le client se réordonne à chaque page, puisque chaque page
    n'a que ses propres lignes à comparer.

    ## Le filtre, et le total qui va avec

    **Le total est recalculé sur le filtre**, et c'est le champ sans lequel les
    trois autres induisent en erreur : « 20 sur 128 » ment dès qu'un filtre est
    posé, et l'écran annoncerait un marché qui n'existe pas.

    Le filtre s'applique **avant** la page et après le tri, pour la même raison
    que le tri est ici : filtrer une page n'est pas filtrer la liste. La page
    suivante rendrait un autre sous-ensemble, et une créatrice se retrouverait
    deux fois ou jamais.

    ## Le rayon

    La même borne que le compte qui précède la liste — `feed_radius_metres`.
    Sans elle, l'écran annoncerait « 128 créatrices autour de vous » au-dessus
    d'une liste qui en contient deux mille.
    """
    settings = get_settings()
    maintenant = datetime.now(UTC)

    distance, conditions = _portee_du_salon(business)

    profils = (
        await session.execute(
            sa.select(
                CreatorProfile.user_id,
                CreatorProfile.city,
                CreatorProfile.bio,
                CreatorProfile.interests,
                CreatorProfile.reliability_score,
                CreatorProfile.completed_collabs_count,
                distance.label("distance_metres"),
            )
            .join(User, User.id == CreatorProfile.user_id)
            .where(*conditions)
            # Le tri final se fait en Python — l'accès ne se calcule pas en SQL
            # — mais l'ordre de lecture doit rester déterministe : deux appels
            # sur la même page doivent rendre les mêmes lignes.
            .order_by(CreatorProfile.user_id)
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

    # **Les paliers de ce salon, pas ceux du produit.** Relus par la fonction
    # qui sert déjà le compte qui précède la liste : deux lectures de « ce que
    # ce commerce offre » finiraient par ne plus dire la même chose, et l'écart
    # se lirait comme une ligne qui promet un palier qu'on ne peut pas réserver.
    paliers = await portee_locale.paliers_ouverts_du_commerce(session, business_id=business.id)

    par_createur: dict[uuid.UUID, list] = {}
    for ligne in comptes:
        par_createur.setdefault(ligne.creator_id, []).append(ligne)

    vus: list[CreateurVu] = []
    for profil in profils:
        vu = _vu_de(
            profil,
            par_createur.get(profil.user_id, []),
            paliers,
            maintenant=maintenant,
            age_max=timedelta(seconds=settings.metrics_max_age_seconds),
        )
        if vu is not None:
            vus.append(vu)

    # **Le tri, puis la page.** Accès d'abord, proximité ensuite, identifiant en
    # dernier — sans ce troisième critère, deux créatrices à égalité pourraient
    # changer de place entre deux appels et l'une des deux manquerait à la
    # page suivante.
    #
    # `float("inf")` pour une distance inconnue : elle passe derrière tout ce
    # qu'on sait, sans être écartée.
    if filtre:
        vus = [vu for vu in vus if _retenue(vu, filtre)]

    vus.sort(
        key=lambda vu: (
            not vu.peut_reserver_ici,
            vu.distance_metres if vu.distance_metres is not None else float("inf"),
            str(vu.creator_id),
        )
    )
    return PageDAnnuaire(
        createurs=tuple(vus[decalage : decalage + limite]),
        # Le total avant la page : « 20 sur 128 » demande de savoir combien il y
        # en a, et une page pleine ne dit pas s'il en reste.
        total=len(vus),
    )


async def creatrice(
    session: AsyncSession,
    *,
    business: Business,
    creator_id: uuid.UUID,
) -> CreateurVu | None:
    """Une créatrice de l'annuaire, lue seule.

    **Elle rend exactement ce que la rangée montrait**, en plus complet : même
    portée, mêmes conditions, mêmes paliers de ce salon. Le type est celui de
    la liste — `CreateurVu` — et pas un cousin qui lui ressemblerait. Deux
    formes du même objet finissent par ne plus s'accorder, et le désaccord se
    lit à l'écran comme un volume qui change en ouvrant la fiche.

    **`None` quand elle n'est pas visible d'ici**, et la route en fait un 404.
    Trois façons de ne pas l'être, toutes déjà celles de la liste : le profil
    n'existe pas ou il est anonymisé, le compte n'est plus actif, la créatrice
    est hors du rayon de ce salon. La quatrième est dans `_vu_de` : aucun
    réseau rattaché, donc rien à montrer à un commerce.

    **Un identifiant ne donne pas le droit de lire.** La portée est celle du
    salon qui demande, jamais celle du salon d'à côté : reprendre l'identifiant
    vu depuis un autre commerce ne rend rien de plus qu'une créatrice hors de
    portée — « introuvable », et non « voici, puisque vous avez l'adresse ».
    C'est aussi pourquoi ce service prend le `business` et non son seul rayon.

    **Le refus d'abonnement reste sur la route**, comme pour la liste. Une
    fonction de lecture qui déciderait aussi qui a le droit de lire finirait
    par être appelée d'ailleurs, sans le contrôle.
    """
    settings = get_settings()
    maintenant = datetime.now(UTC)

    distance, conditions = _portee_du_salon(business)

    profil = (
        await session.execute(
            sa.select(
                CreatorProfile.user_id,
                CreatorProfile.city,
                CreatorProfile.bio,
                CreatorProfile.interests,
                CreatorProfile.reliability_score,
                CreatorProfile.completed_collabs_count,
                distance.label("distance_metres"),
            )
            .join(User, User.id == CreatorProfile.user_id)
            .where(*conditions, CreatorProfile.user_id == creator_id)
        )
    ).first()
    if profil is None:
        return None

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
            .where(SocialAccount.creator_id == creator_id)
        )
    ).all()

    paliers = await portee_locale.paliers_ouverts_du_commerce(session, business_id=business.id)

    return _vu_de(
        profil,
        list(comptes),
        paliers,
        maintenant=maintenant,
        age_max=timedelta(seconds=settings.metrics_max_age_seconds),
    )
