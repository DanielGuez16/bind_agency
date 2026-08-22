"""Préparer une fiche sur le terrain, et la passer à celui qui l'assume.

**Le problème.** La fondatrice démarche en physique. L'inscription autonome
demande une demi-heure au comptoir — identité, adresse, horaires, carte des
prestations avec leurs durées, photos, mot de passe, moyen de paiement — et
personne ne la fait pendant qu'un client attend. La visite se termine sur
« je le ferai ce soir », et ce soir n'arrive pas.

**La ligne qui décide de tout : elle peut saisir des *faits*, jamais des
*engagements*.** Nom, adresse, horaires, carte, photos : elle les connaît aussi
bien que le salon, et c'est là que sont les trente minutes. Mot de passe,
acceptation des conditions, mise en ligne : si elle les pose, personne ne peut
dire qui a accepté quoi, elle détient les identifiants d'un tiers, et le premier
litige n'a aucune réponse. Un parcours entièrement assisté est plus rapide et
indéfendable.

**D'où deux moments.** Une fiche en `draft`, qu'elle remplit pendant la
démonstration, invisible de tout le produit et sans aucun membre. Puis une prise
en main, par un lien à usage unique, où le salon crée son compte, accepte les
conditions et devient propriétaire de sa fiche.

**Le jeton se révoque comme un jeton social.** Empreinte en base, jamais le
jeton ; un seul vivant par commerce ; expiration ; révocation. Émettre un
nouveau lien ferme le précédent — un lien renvoyé trois fois laisserait trois
portes ouvertes.

**Un refus ne dit pas laquelle des quatre raisons s'applique.** Inconnu, expiré,
déjà utilisé, révoqué : les distinguer apprendrait à qui tâtonne quels salons
ont été démarchés et lesquels ont déjà signé.
"""

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.integrations.geocoding import Geocoder
from app.models import (
    AuditLog,
    Business,
    BusinessHandover,
    BusinessMember,
    CapacityRule,
    CatalogItem,
    User,
)
from app.models.enums import (
    BusinessMemberRole,
    BusinessStatus,
    HandoverChannel,
    Locale,
    UserRole,
)
from app.schemas.business import BusinessCreate
from app.services import auth as auth_service
from app.services import business as business_service
from app.services.audit import Actor, AuditedEntity, record_transition

#: Motifs écrits au journal. Nommés ici, parce que ce sont eux qu'on relira
#: dans six mois pour mesurer le démarchage — et qu'un motif écrit à la main
#: dans trois fonctions finit par s'écrire de trois façons.
REASON_PREPAREE = "handover_prepared"
REASON_EMIS = "handover_issued"
REASON_REVOQUE = "handover_revoked"
REASON_PRISE_EN_MAIN = "handover_claimed"

#: Trente-deux octets tirés au hasard, rendus en URL. Le lien voyage dans un
#: SMS, un courriel, ou un QR : il doit se coller sans être réécrit.
OCTETS_JETON = 32


class HandoverError(Exception):
    """Base des refus de prise en main."""


class HandoverUnknown(HandoverError):
    """Jeton inconnu, expiré, déjà utilisé ou révoqué.

    **Les quatre partagent une erreur, et c'est délibéré.** Distinguer
    « expiré » de « inconnu » dirait à qui essaie des jetons au hasard quels
    salons existent ; distinguer « déjà utilisé » dirait lesquels ont signé.
    """


class NotADraft(HandoverError):
    """La fiche n'est plus une fiche préparée.

    Un commerce dont quelqu'un est déjà propriétaire ne se passe pas à un
    second par un lien : ce serait un changement de main, une autre décision,
    qui ne se prend pas à la sauvette au fond d'un salon.
    """


class TermsNotAccepted(HandoverError):
    """Les conditions n'ont pas été acceptées, ou pas dans leur version courante.

    Le second cas est réel : un lien ouvert la semaine dernière montre les
    conditions de la semaine dernière. Accepter cette version-là et écrire la
    version courante au journal serait écrire une preuve fausse.
    """


@dataclass(frozen=True, slots=True)
class LienRemis:
    """Ce qu'on rend à la fondatrice, **une seule fois**.

    Le jeton en clair n'existe qu'ici et dans la réponse : la base n'en garde
    que l'empreinte. Le perdre oblige à en émettre un nouveau, ce qui est le
    comportement voulu — un lien qu'on peut relire est un lien qu'on peut
    voler.

    **Des valeurs recopiées, pas la ligne.** Porter le modèle et en réexposer
    trois champs par des propriétés faisait une représentation de plus, posée
    en parallèle de la ligne et du schéma. `LienRemisRead` se construit
    maintenant de cette structure et de rien d'autre — ce que le garde-fou des
    schémas de lecture vérifie.
    """

    handover_id: uuid.UUID
    business_id: uuid.UUID
    channel: HandoverChannel
    expires_at: datetime
    jeton: str
    url: str


class EtatDeLaTournee(StrEnum):
    """Où en est une fiche préparée, du point de vue de la tournée.

    Le vocabulaire est celui de la conduite à tenir, pas celui de la base : ce
    que le démarcheur lit doit lui dire quoi faire, pas quel champ est nul.
    """

    #: Préparée, jamais remise. Il reste à passer.
    PREPAREE = "prepared"
    #: Remise, jamais ouverte. **Revisiter** : personne n'a rien vu, et une
    #: relance s'adresserait à un lien que nul ne regarde.
    JAMAIS_OUVERTE = "never_opened"
    #: Ouverte, abandonnée en route. **Relancer** : quelqu'un a regardé.
    ABANDONNEE = "opened_not_claimed"
    #: Ouverte, arrêtée sur l'engagement. Ni l'un ni l'autre : c'est le produit
    #: qui coince, et le démarchage n'y peut rien.
    BLOQUEE = "blocked_on_commitment"
    #: Assumée. La tournée a porté.
    ACTIVEE = "claimed"


@dataclass(frozen=True, slots=True)
class LigneDeSuivi:
    """Une fiche préparée et où elle en est.

    C'est la mesure du démarchage physique : combien de fiches préparées,
    combien de liens émis, combien assumées. Sans elle, la tournée ne se juge
    qu'au souvenir qu'on en a.
    """

    business_id: uuid.UUID
    name: str
    status: BusinessStatus
    address: str | None
    prepared_at: datetime
    #: Le dernier jeton émis, s'il y en a eu un.
    issued_at: datetime | None
    expires_at: datetime | None
    used_at: datetime | None
    revoked_at: datetime | None
    #: Par où le lien est parvenu au salon : le QR de la tablette — le décideur
    #: était là — ou un envoi, quand il ne l'était pas. C'est ce qui départage
    #: les deux méthodes de démarchage.
    channel: HandoverChannel | None
    #: Quand quelqu'un a ouvert le lien pour la première fois. Nulle : personne
    #: ne l'a jamais vu.
    opened_at: datetime | None
    #: Quand une prise en main a été tentée et refusée pour la dernière fois.
    blocked_at: datetime | None
    #: Qui a préparé la fiche, par son adresse.
    #:
    #: **Sans elle, la comparaison des deux méthodes ne tient qu'à une
    #: personne.** Le taux d'activation par voie ne dit rien si toutes les
    #: fiches remises au comptoir viennent d'une tournée et toutes celles
    #: envoyées d'une autre : on comparerait deux démarcheurs en croyant
    #: comparer deux méthodes.
    #:
    #: Relue du journal d'audit et non du lien, parce qu'elle existe pour
    #: **toutes** les fiches. `issued_by_user_id` est nul tant que rien n'a été
    #: remis, c'est-à-dire exactement sur les fiches préparées qui attendent
    #: qu'on passe — celles dont on a le plus besoin de savoir de qui elles
    #: sont.
    #:
    #: Une adresse et non un nom : un administrateur n'en a pas. Les noms
    #: vivent sur le profil créateur, et un compte d'équipe n'en a aucun. C'est
    #: un écran interne où chacun connaît déjà l'adresse des autres.
    prepared_by: str | None
    #: Qui a remis le lien, par son adresse. Nulle tant que rien n'a été remis.
    #:
    #: **Distincte de la précédente, et c'est le point.** La même personne fait
    #: souvent les deux dans la même visite, mais pas toujours : préparer
    #: quarante fiches au bureau et en remettre vingt en tournée sont deux
    #: gestes, et les confondre ferait mentir la comparaison qu'on cherche.
    remis_par: str | None

    @property
    def etat(self) -> "EtatDeLaTournee":
        """Où en est cette fiche, en un mot qui commande une conduite.

        **Trois états et non deux, parce qu'ils appellent trois gestes.** Une
        fiche jamais ouverte se **revisite** — personne n'a rien vu, et une
        relance par courriel s'adresse à un lien que nul ne regarde. Une fiche
        ouverte puis abandonnée se **relance** — quelqu'un a regardé et s'est
        arrêté. Une fiche bloquée sur l'engagement ne se règle par aucun des
        deux : c'est le produit qui coince, mot de passe ou conditions, et le
        démarchage n'y peut rien.

        Dérivé plutôt que stocké : trois dates disent déjà tout, et une colonne
        d'état finirait par les contredire.
        """
        if self.used_at is not None:
            return EtatDeLaTournee.ACTIVEE
        if self.issued_at is None:
            return EtatDeLaTournee.PREPAREE
        if self.blocked_at is not None:
            return EtatDeLaTournee.BLOQUEE
        if self.opened_at is None:
            return EtatDeLaTournee.JAMAIS_OUVERTE
        return EtatDeLaTournee.ABANDONNEE


def _empreinte(jeton: str) -> bytes:
    return hashlib.sha256(jeton.encode("utf-8")).digest()


async def preparer_la_fiche(
    session: AsyncSession,
    *,
    payload: BusinessCreate,
    prepare_par: User,
    geocoder: Geocoder,
) -> Business:
    """Crée la fiche en `draft`. **Aucun membre, et c'est le point.**

    `create_business` rattache son appelant comme propriétaire : c'est juste
    quand un commerçant s'inscrit lui-même, et c'est exactement ce qu'il ne
    faut pas ici. Une fiche préparée n'appartient à personne tant que personne
    ne l'a assumée — surtout pas à la fondatrice.
    """
    resolved = await business_service.resoudre_la_position(
        geocoder,
        address=payload.address,
        declared=payload.coordinates,
    )

    business = Business(
        name=payload.name,
        category=payload.category,
        address=payload.address,
        geo=business_service.point(resolved) if resolved else None,
        timezone=payload.timezone,
        default_locale=payload.default_locale,
        phone=payload.phone,
        currency=payload.currency,
        cover_photo_key=payload.cover_photo_key,
        status=BusinessStatus.DRAFT,
    )
    session.add(business)
    await session.flush()

    await record_transition(
        session,
        entity=AuditedEntity.BUSINESS,
        entity_id=business.id,
        from_status=None,
        to_status=BusinessStatus.DRAFT.value,
        actor=Actor.from_user(prepare_par),
        reason=REASON_PREPAREE,
    )
    return business


async def jeton_vivant(
    session: AsyncSession, *, business_id: uuid.UUID, maintenant: datetime | None = None
) -> BusinessHandover | None:
    """Le lien encore ouvert sur cette fiche, s'il y en a un."""
    instant = maintenant or datetime.now(UTC)
    return await session.scalar(
        sa.select(BusinessHandover)
        .where(
            BusinessHandover.business_id == business_id,
            BusinessHandover.used_at.is_(None),
            BusinessHandover.revoked_at.is_(None),
            BusinessHandover.expires_at > instant,
        )
        .order_by(BusinessHandover.issued_at.desc())
        .limit(1)
    )


async def emettre(
    session: AsyncSession,
    *,
    business: Business,
    emis_par: User,
    canal: HandoverChannel,
    destination: str | None = None,
    maintenant: datetime | None = None,
) -> LienRemis:
    """Émet un lien de prise en main, et **ferme le précédent**.

    Le gérant qui a perdu le lien en redemande un ; s'il en restait deux
    valides, celui qui traîne dans une boîte resterait une porte que personne
    ne surveille.
    """
    if business.status is not BusinessStatus.DRAFT:
        raise NotADraft(business.status.value)

    reglages = get_settings()
    if not reglages.handover_base_url:
        # Même règle que le lien traqué : on refuse plutôt que de fabriquer une
        # adresse. Un lien mort est la seule impression que le gérant gardera.
        raise HandoverError("handover_base_url n'est pas configurée")

    instant = maintenant or datetime.now(UTC)

    precedent = await jeton_vivant(session, business_id=business.id, maintenant=instant)
    if precedent is not None:
        precedent.revoked_at = instant
        await session.flush()

    jeton = secrets.token_urlsafe(OCTETS_JETON)
    ligne = BusinessHandover(
        business_id=business.id,
        token_hash=_empreinte(jeton),
        channel=canal,
        destination=destination,
        issued_by_user_id=emis_par.id,
        expires_at=instant + timedelta(seconds=reglages.handover_token_ttl_seconds),
    )
    session.add(ligne)
    await session.flush()

    await record_transition(
        session,
        entity=AuditedEntity.BUSINESS,
        entity_id=business.id,
        to_status=BusinessStatus.DRAFT.value,
        actor=Actor.from_user(emis_par),
        reason=REASON_EMIS,
        # Le canal et non la destination : le journal d'audit se lit largement,
        # et l'adresse du gérant n'a rien à y faire. Elle reste sur la ligne de
        # prise en main, où le support la trouvera s'il la cherche.
        extra={"channel": canal.value, "remplace": str(precedent.id) if precedent else None},
    )

    return LienRemis(
        handover_id=ligne.id,
        business_id=ligne.business_id,
        channel=ligne.channel,
        expires_at=ligne.expires_at,
        jeton=jeton,
        url=f"{reglages.handover_base_url.rstrip('/')}/{jeton}",
    )


async def revoquer(
    session: AsyncSession,
    *,
    business: Business,
    actor: User,
    maintenant: datetime | None = None,
) -> BusinessHandover | None:
    """Ferme le lien en cours. Rend `None` s'il n'y en avait pas.

    Pas une erreur : « il n'y avait rien à fermer » est le résultat voulu quand
    on veut être sûr que plus rien n'est ouvert.
    """
    instant = maintenant or datetime.now(UTC)
    ligne = await jeton_vivant(session, business_id=business.id, maintenant=instant)
    if ligne is None:
        return None

    ligne.revoked_at = instant
    await session.flush()

    await record_transition(
        session,
        entity=AuditedEntity.BUSINESS,
        entity_id=business.id,
        to_status=BusinessStatus.DRAFT.value,
        actor=Actor.from_user(actor),
        reason=REASON_REVOQUE,
    )
    return ligne


async def resoudre(
    session: AsyncSession, *, jeton: str, maintenant: datetime | None = None
) -> BusinessHandover:
    """Le lien vivant qui correspond à ce jeton, ou un refus indistinct.

    La recherche se fait sur l'empreinte : la base ne contient pas de quoi
    reconstituer un jeton, et une fuite de la table n'ouvre aucune fiche.
    """
    instant = maintenant or datetime.now(UTC)
    ligne = await session.scalar(
        sa.select(BusinessHandover).where(BusinessHandover.token_hash == _empreinte(jeton))
    )
    if (
        ligne is None
        or ligne.used_at is not None
        or ligne.revoked_at is not None
        or ligne.expires_at <= instant
    ):
        raise HandoverUnknown("jeton de prise en main invalide")
    return ligne


async def marquer_ouvert(session: AsyncSession, *, handover: BusinessHandover) -> None:
    """Note la première ouverture du lien. Idempotente.

    **La première et non la dernière.** Ce qu'on mesure est « quelqu'un
    a-t-il regardé », pas « quand pour la dernière fois » : un démarcheur qui
    rouvre le lien pour vérifier ne doit pas effacer la trace de la vraie
    visite, ni faire passer pour récent un intérêt qui date de trois semaines.

    Écrite depuis l'aperçu, qui est une lecture — et c'est assumé. Une route qui
    n'écrit rien ne peut pas dire qu'on l'a appelée, et c'est justement ce qu'on
    a besoin de savoir.
    """
    if handover.opened_at is not None:
        return
    handover.opened_at = sa.func.clock_timestamp()
    await session.flush()
    await session.refresh(handover, ["opened_at"])


async def marquer_bloque(session: AsyncSession, *, handover: BusinessHandover) -> None:
    """Note qu'une prise en main a été tentée et refusée.

    **La dernière et non la première** : ce qu'on veut savoir est si le blocage
    dure encore.

    C'est le troisième état de la tournée, et il se lit sans que l'écran ait
    rien à rapporter. Quelqu'un qui échoue à prendre la main est arrivé jusqu'à
    l'engagement — mot de passe, conditions — et s'est arrêté là. Ce n'est pas
    un problème de tournée, c'est un problème de produit : une fiche jamais
    ouverte se revisite, une fiche abandonnée en route se relance, et celle-ci
    ne se règle par aucun des deux.
    """
    handover.blocked_at = sa.func.clock_timestamp()
    await session.flush()
    await session.refresh(handover, ["blocked_at"])


@dataclass(frozen=True, slots=True)
class Apercu:
    """Ce que le salon voit avant de s'engager, sur la seule possession du lien."""

    business: Business
    prestations_preparees: int
    plages_preparees: int


async def apercu(session: AsyncSession, *, handover: BusinessHandover) -> Apercu:
    """La fiche préparée, telle qu'elle se montre à qui va l'assumer.

    **Des nombres, pas des listes.** Le gérant a besoin de reconnaître son
    salon — son nom, son adresse, « douze prestations relevées de votre
    carte » — pas de lire sa fiche entière depuis un lien qui circule dans un
    SMS. Ce qu'il veut vérifier en détail, il le verra une fois connecté.
    """
    business = await session.get(Business, handover.business_id)
    if business is None:
        raise HandoverUnknown(str(handover.business_id))

    prestations = await session.scalar(
        sa.select(sa.func.count())
        .select_from(CatalogItem)
        .where(CatalogItem.business_id == business.id)
    )
    plages = await session.scalar(
        sa.select(sa.func.count())
        .select_from(CapacityRule)
        .where(CapacityRule.business_id == business.id)
    )
    return Apercu(
        business=business,
        prestations_preparees=prestations or 0,
        plages_preparees=plages or 0,
    )


async def prendre_en_main(
    session: AsyncSession,
    *,
    handover: BusinessHandover,
    email: str,
    password: str,
    terms_version: str,
    locale: Locale = Locale.EN,
    maintenant: datetime | None = None,
) -> tuple[User, Business]:
    """Le salon crée son compte et devient propriétaire de sa fiche.

    Trois écritures qui ne se séparent pas : le compte, l'appartenance, et la
    sortie de `draft`. Un compte créé sans appartenance laisserait le gérant
    devant une application vide ; une fiche sortie de `draft` sans propriétaire
    serait un commerce que personne ne peut ouvrir.

    **La fiche passe en `onboarding`, pas en `active`.** Elle rejoint le
    parcours ordinaire, avec ses étapes et son activation explicite : c'est le
    salon qui décide de se montrer, et il le décide après avoir vu ce qui a été
    préparé en son nom.
    """
    instant = maintenant or datetime.now(UTC)
    business = await session.get(Business, handover.business_id)
    if business is None or business.status is not BusinessStatus.DRAFT:
        raise NotADraft(str(handover.business_id))

    _verifier_les_conditions(terms_version)

    utilisateur = await auth_service.register(
        session,
        email=email,
        password=password,
        role=UserRole.BUSINESS_MEMBER,
        locale=locale,
    )
    await _assumer(
        session,
        handover=handover,
        business=business,
        utilisateur=utilisateur,
        terms_version=terms_version,
        instant=instant,
    )
    return utilisateur, business


async def rattacher(
    session: AsyncSession,
    *,
    handover: BusinessHandover,
    utilisateur: User,
    terms_version: str,
    maintenant: datetime | None = None,
) -> Business:
    """Un compte qui existe déjà assume la fiche.

    **Le cas du deuxième salon.** Un propriétaire qui tient deux adresses a
    déjà un compte ; lui refuser le lien parce que son adresse électronique est
    connue l'obligerait à s'en inventer une seconde, et à tenir deux mots de
    passe pour deux salons de la même rue.
    """
    instant = maintenant or datetime.now(UTC)
    business = await session.get(Business, handover.business_id)
    if business is None or business.status is not BusinessStatus.DRAFT:
        raise NotADraft(str(handover.business_id))

    _verifier_les_conditions(terms_version)
    await _assumer(
        session,
        handover=handover,
        business=business,
        utilisateur=utilisateur,
        terms_version=terms_version,
        instant=instant,
    )
    return business


def _verifier_les_conditions(version: str) -> None:
    """La version acceptée doit être celle en vigueur.

    Un lien ouvert la semaine dernière montre les conditions de la semaine
    dernière. Enregistrer la version courante sur cette acceptation-là serait
    écrire au journal une preuve que personne n'a produite.
    """
    if version != get_settings().terms_version:
        raise TermsNotAccepted(version)


async def _assumer(
    session: AsyncSession,
    *,
    handover: BusinessHandover,
    business: Business,
    utilisateur: User,
    terms_version: str,
    instant: datetime,
) -> None:
    """Le cœur commun aux deux chemins : appartenance, jeton, transition."""
    session.add(
        BusinessMember(
            business_id=business.id,
            user_id=utilisateur.id,
            role=BusinessMemberRole.OWNER,
        )
    )

    handover.used_at = instant
    handover.used_by_user_id = utilisateur.id
    handover.accepted_terms_version = terms_version

    business.status = BusinessStatus.ONBOARDING
    await session.flush()

    # **La preuve de l'engagement vit ici**, et non sur la ligne de prise en
    # main : le journal d'audit est immuable et ne se supprime pas avec le
    # commerce. Qui, quand, sur quelle version — les trois choses qu'on
    # regardera le jour où quelqu'un contestera avoir accepté quoi que ce soit.
    await record_transition(
        session,
        entity=AuditedEntity.BUSINESS,
        entity_id=business.id,
        from_status=BusinessStatus.DRAFT.value,
        to_status=BusinessStatus.ONBOARDING.value,
        actor=Actor.from_user(utilisateur),
        reason=REASON_PRISE_EN_MAIN,
        extra={"terms_version": terms_version, "handover_id": str(handover.id)},
    )


async def _adresses(session: AsyncSession, ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
    """Les adresses de ces comptes, en une requête."""
    if not ids:
        return {}
    return {
        identifiant: email
        for identifiant, email in await session.execute(
            sa.select(User.id, User.email).where(User.id.in_(set(ids)))
        )
        if email is not None
    }


async def _preparateurs(
    session: AsyncSession, business_ids: list[uuid.UUID]
) -> dict[uuid.UUID, str]:
    """Qui a préparé chaque fiche, par son adresse, depuis le journal d'audit.

    Le journal est la seule source qui couvre **toutes** les fiches : la
    préparation y est écrite avec son acteur, alors que rien ne la porte sur la
    ligne du commerce. Le lien, lui, n'existe qu'une fois la fiche remise.
    """
    if not business_ids:
        return {}
    return {
        entity_id: email
        for entity_id, email in await session.execute(
            sa.select(AuditLog.entity_id, User.email)
            .join(User, User.id == AuditLog.actor_user_id)
            .where(
                AuditLog.entity_type == AuditedEntity.BUSINESS.value,
                AuditLog.entity_id.in_(set(business_ids)),
                AuditLog.reason == REASON_PREPAREE,
            )
        )
        if email is not None
    }


async def suivi(
    session: AsyncSession, *, limite: int = 100, maintenant: datetime | None = None
) -> tuple[LigneDeSuivi, ...]:
    """Les fiches préparées, la plus récente d'abord, avec l'état de leur lien.

    **Elles ne disparaissent pas de la liste une fois assumées.** Une liste qui
    ne montrerait que ce qui reste à faire ne dirait jamais combien de visites
    ont abouti, et c'est le seul chiffre qui juge la tournée.
    """
    del maintenant  # l'état se lit sur les dates, pas sur un instant de lecture

    # Le dernier jeton de chaque fiche : le précédent a été révoqué à
    # l'émission du suivant, et afficher les deux ferait lire deux liens là où
    # il n'y en a qu'un.
    dernier = (
        sa.select(
            BusinessHandover.business_id,
            sa.func.max(BusinessHandover.issued_at).label("issued_at"),
        )
        .group_by(BusinessHandover.business_id)
        .subquery()
    )

    lignes = (
        await session.execute(
            sa.select(Business, BusinessHandover)
            .outerjoin(dernier, dernier.c.business_id == Business.id)
            .outerjoin(
                BusinessHandover,
                sa.and_(
                    BusinessHandover.business_id == Business.id,
                    BusinessHandover.issued_at == dernier.c.issued_at,
                ),
            )
            .where(
                Business.id.in_(sa.select(BusinessHandover.business_id).distinct())
                | (Business.status == BusinessStatus.DRAFT)
            )
            .order_by(Business.created_at.desc())
            .limit(max(1, min(limite, 500)))
        )
    ).all()

    # Deux lectures de plus, jamais une par fiche : les préparateurs viennent
    # du journal en une requête, les adresses des remettants en une autre.
    preparateurs = await _preparateurs(session, [b.id for b, _ in lignes])
    adresses = await _adresses(
        session, [lien.issued_by_user_id for _, lien in lignes if lien is not None]
    )

    return tuple(
        LigneDeSuivi(
            business_id=business.id,
            name=business.name,
            status=business.status,
            address=business.address,
            prepared_at=business.created_at,
            issued_at=lien.issued_at if lien else None,
            expires_at=lien.expires_at if lien else None,
            used_at=lien.used_at if lien else None,
            revoked_at=lien.revoked_at if lien else None,
            channel=lien.channel if lien else None,
            opened_at=lien.opened_at if lien else None,
            blocked_at=lien.blocked_at if lien else None,
            prepared_by=preparateurs.get(business.id),
            remis_par=adresses.get(lien.issued_by_user_id) if lien else None,
        )
        for business, lien in lignes
    )
