"""Le lien traqué : le créer, l'ouvrir, décider si le passage compte.

**Ce que ce module cherche à établir.** Une plateforme ne dit pas d'où vient
l'audience — TikTok jamais, Instagram seulement au-dessus d'un seuil. Un
créateur de Miami peut donc toucher l'Inde sans que rien ne le signale. Le lien
mesure ce que le nombre d'abonnés ne fait que suggérer.

**L'adresse IP ne sort pas de `enregistrer_un_passage`.** Elle sert à deux
choses — résoudre une ville, calculer une empreinte — et n'est écrite nulle
part. Aucune des trois tables n'a de colonne pour elle. Voir `models/tracking.py`.

**Trois filtres avant de compter, et chacun laisse une trace.** Un robot, un
préchargement, un doublon : le passage est enregistré avec la raison de son
rejet, et n'entre dans aucun agrégat. Les jeter effacerait le seul signal qui
dénonce une campagne fabriquée — la *forme* des rejets, pas leur nombre.

**On ne prétend pas distinguer un humain d'un programme.** Ce serait faux. On
écarte ce qui s'annonce, on déduplique ce qui se répète, et on garde de quoi
regarder le reste. Le jugement appartient à `services/impact.py`, qui rend des
signaux nommés et jamais un verdict.
"""

import hashlib
import hmac
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.integrations.geoip import GeoResolver, Localisation
from app.models import Collaboration, CollaborationLink, LinkClick, LinkClickSalt
from app.models.enums import ClickOutcome, DeviceFamily

#: L'alphabet de l'identifiant court. Sans O, 0, I, l ni 1 : le lien se lit à
#: voix haute et se recopie à la main depuis une story, où il n'est pas
#: cliquable. C'est le même choix que le code de secours en caisse.
ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"

#: Ce qui s'annonce comme un robot. Liste fermée, en minuscules, comparée par
#: inclusion. Elle n'attrape que ce qui se déclare — c'est son unique
#: prétention, et la plupart des robots sérieux se déclarent.
ROBOTS = (
    "bot",
    "crawler",
    "spider",
    "slurp",
    "curl",
    "wget",
    "python-requests",
    "httpx",
    "go-http-client",
    "java/",
    "okhttp",
    "headless",
    "phantomjs",
    "lighthouse",
    "pingdom",
    "uptimerobot",
    "facebookexternalhit",
    "whatsapp",
    "telegrambot",
    "discordbot",
    "slackbot",
    "twitterbot",
    "linkedinbot",
    "embedly",
    "preview",
    "monitoring",
)

#: Les en-têtes par lesquels un navigateur ou une plateforme annonce qu'il
#: **prépare** une visite. Personne n'a cliqué : c'est une page chargée à
#: l'avance, et la compter gonflerait chaque lien du même bruit.
#:
#: `Sec-Purpose` est la forme normalisée, les deux autres sont les anciennes de
#: Chrome et Firefox. Les trois vivent encore.
ENTETES_DE_PRECHARGEMENT = ("sec-purpose", "purpose", "x-moz")
VALEURS_DE_PRECHARGEMENT = ("prefetch", "preview", "prerender")


class LienIntrouvable(Exception):
    """Aucun lien actif pour cet identifiant court."""

    def __init__(self, slug: str) -> None:
        super().__init__(slug)
        self.slug = slug


class ContrepartieIntrouvable(Exception):
    """La contrepartie n'existe pas, ou n'appartient pas à ce créateur.

    **Un seul cas pour les deux.** « Elle existe mais pas à vous » dirait à un
    créateur quels identifiants appartiennent à quelqu'un d'autre — et sur un
    lien traqué, savoir qu'une contrepartie existe suffirait à chercher son
    slug.
    """

    def __init__(self, collaboration_id: uuid.UUID) -> None:
        super().__init__(str(collaboration_id))
        self.collaboration_id = collaboration_id


@dataclass(frozen=True, slots=True)
class Passage:
    """Ce qu'une requête HTTP apporte, une fois débarrassée du transport.

    **L'adresse est ici et nulle part ailleurs.** Elle entre, elle sert, elle
    part avec l'objet. Aucune fonction de ce module ne la range.
    """

    ip: str | None
    user_agent: str | None
    referer: str | None
    #: Les en-têtes qui pourraient annoncer un préchargement, en minuscules.
    entetes: dict[str, str]
    #: `HEAD` ne rend pas de page : c'est une inspection, jamais une visite.
    methode: str = "GET"


def nouveau_slug(longueur: int | None = None) -> str:
    """Un identifiant court, tiré au hasard et jamais dérivé.

    `secrets` et non `random` : un lien devinable laisserait fabriquer des
    clics sur la contrepartie de quelqu'un d'autre, et c'est exactement ce que
    ce module existe pour empêcher. Dix caractères dans un alphabet de trente et
    un valent près de cinquante bits.
    """
    taille = longueur or get_settings().link_slug_length
    return "".join(secrets.choice(ALPHABET) for _ in range(taille))


async def lien_de_la_contrepartie(
    session: AsyncSession, *, collaboration_id: uuid.UUID
) -> CollaborationLink:
    """Le lien de cette contrepartie, créé à la première demande.

    **Créé paresseusement plutôt qu'à la naissance de la contrepartie** : toutes
    les contreparties n'ont pas de lien à montrer — un item sans publication
    attendue n'en a que faire — et une table remplie de liens que personne
    n'ouvrira coûterait sans rien apprendre.

    Idempotent : deux appels concurrents ne créent pas deux liens. La contrainte
    d'unicité sur `collaboration_id` fait foi, et le conflit se relit.
    """
    existant = await session.scalar(
        sa.select(CollaborationLink).where(CollaborationLink.collaboration_id == collaboration_id)
    )
    if existant is not None:
        return existant

    resultat = await session.execute(
        pg_insert(CollaborationLink)
        .values(collaboration_id=collaboration_id, slug=nouveau_slug())
        .on_conflict_do_nothing(index_elements=["collaboration_id"])
        .returning(CollaborationLink)
    )
    cree = resultat.scalar_one_or_none()
    if cree is not None:
        return cree

    # Quelqu'un d'autre l'a créé entre-temps : on relit le sien plutôt que
    # d'insister avec un second identifiant.
    return await session.scalar(  # type: ignore[return-value]
        sa.select(CollaborationLink).where(CollaborationLink.collaboration_id == collaboration_id)
    )


def url_du_lien(slug: str) -> str:
    """L'adresse complète à coller dans un sticker.

    Assemblée par le serveur : l'app la recomposerait à partir d'une base
    qu'elle devrait connaître, et les deux divergeraient au premier changement
    de domaine.
    """
    base = get_settings().link_redirect_base_url
    if base is None:
        # Sans destination configurée, il n'y a pas d'adresse à donner. En
        # inventer une ferait coller dans une story un lien mort.
        raise LienIntrouvable(slug)
    return f"{base.rstrip('/')}/r/{slug}"


async def lien_du_createur(
    session: AsyncSession, *, collaboration_id: uuid.UUID, creator_id: uuid.UUID
) -> CollaborationLink:
    """Le lien de **sa** contrepartie, créé à la première demande.

    L'appartenance se vérifie par la réservation, seule à porter le créateur.
    Un tiers qui obtiendrait ce lien pourrait fabriquer des clics sur une
    collaboration qui n'est pas la sienne : c'est exactement ce que la mesure
    existe pour empêcher.
    """
    from app.models import Booking

    sienne = await session.scalar(
        sa.select(sa.literal(True))
        .select_from(Collaboration)
        .join(Booking, Booking.id == Collaboration.booking_id)
        .where(Collaboration.id == collaboration_id, Booking.creator_id == creator_id)
        .limit(1)
    )
    if not sienne:
        raise ContrepartieIntrouvable(collaboration_id)

    return await lien_de_la_contrepartie(session, collaboration_id=collaboration_id)


def est_un_robot(user_agent: str | None) -> bool:
    """Ce qui s'annonce comme un robot, et l'absence d'agent.

    **Un agent vide est traité comme un robot.** Tous les navigateurs en
    envoient un ; son absence désigne un client écrit à la main, ce qui est
    précisément ce qu'on ne compte pas.
    """
    if not user_agent or not user_agent.strip():
        return True
    minuscule = user_agent.lower()
    return any(marqueur in minuscule for marqueur in ROBOTS)


def est_un_prechargement(passage: Passage) -> bool:
    """Une page préparée à l'avance n'est pas une visite.

    `HEAD` compte ici : la méthode ne rend pas de corps, elle inspecte. La
    ranger dans les robots serait une accusation ; c'est un préchargement au
    sens propre — quelqu'un regarde si la page existe.
    """
    if passage.methode.upper() == "HEAD":
        return True
    for nom in ENTETES_DE_PRECHARGEMENT:
        valeur = (passage.entetes.get(nom) or "").lower()
        if any(marqueur in valeur for marqueur in VALEURS_DE_PRECHARGEMENT):
            return True
    return False


def famille_de_terminal(user_agent: str | None) -> DeviceFamily:
    """Trois familles et un repli, déduits de l'agent utilisateur.

    On ne cherche ni la marque, ni le modèle, ni la version : un agent
    utilisateur ne les dit pas de façon fiable, et prétendre le contraire
    produirait une statistique fausse. La tablette est testée avant le mobile —
    « iPad » et « Android » cohabitent dans les mêmes chaînes.
    """
    if not user_agent:
        return DeviceFamily.UNKNOWN
    minuscule = user_agent.lower()

    if "ipad" in minuscule or "tablet" in minuscule:
        return DeviceFamily.TABLET
    # Android sans « mobile » désigne une tablette, par convention de Google.
    if "android" in minuscule and "mobile" not in minuscule:
        return DeviceFamily.TABLET
    if any(marqueur in minuscule for marqueur in ("iphone", "ipod", "mobile", "android")):
        return DeviceFamily.MOBILE
    if any(marqueur in minuscule for marqueur in ("windows", "macintosh", "x11", "linux")):
        return DeviceFamily.DESKTOP
    return DeviceFamily.UNKNOWN


def hote_du_referent(referer: str | None) -> str | None:
    """L'hôte seul, jamais l'adresse complète.

    Une URL de référent transporte un chemin et des paramètres qui n'ont rien à
    faire dans notre base — on veut savoir « depuis Instagram », pas depuis
    quelle page ni avec quel identifiant de session dans la requête.
    """
    if not referer:
        return None
    try:
        hote = urlsplit(referer).hostname
    except ValueError:
        return None
    return hote.lower() if hote else None


async def _sel_du_jour(session: AsyncSession, jour: datetime) -> bytes:
    """Le sel du jour, créé s'il n'existe pas.

    Tiré au hasard et **destiné à disparaître** : c'est sa destruction qui rend
    les empreintes définitivement incomparables. `ON CONFLICT DO NOTHING` parce
    que deux clics simultanés le premier jour ne doivent pas en créer deux.
    """
    cle = jour.astimezone(UTC).date()
    await session.execute(
        pg_insert(LinkClickSalt)
        .values(jour=cle, sel=secrets.token_bytes(32))
        .on_conflict_do_nothing(index_elements=["jour"])
    )
    return await session.scalar(  # type: ignore[return-value]
        sa.select(LinkClickSalt.sel).where(LinkClickSalt.jour == cle)
    )


def empreinte(sel: bytes, link_id: uuid.UUID, ip: str | None, user_agent: str | None) -> str:
    """De quoi reconnaître un même visiteur, sans savoir qui il est.

    **Le lien entre dans le calcul.** Sans lui, la même personne porterait la
    même empreinte sur toutes les contreparties de la plateforme, et recouper
    deux liens dirait « ces deux salons ont été vus par le même téléphone ».
    Avec lui, une empreinte ne vaut que dans sa contrepartie.

    Tronqué à seize octets : assez pour ne pas se heurter par hasard, trop peu
    pour servir d'identifiant durable — et de toute façon le sel disparaît.
    """
    message = b"|".join(
        [
            link_id.bytes,
            (ip or "").encode("utf-8"),
            (user_agent or "").encode("utf-8"),
        ]
    )
    return hmac.new(sel, message, hashlib.sha256).hexdigest()[:32]


async def _est_un_doublon(
    session: AsyncSession, *, link_id: uuid.UUID, trace: str, maintenant: datetime
) -> bool:
    """La même empreinte, sur le même lien, dans la fenêtre.

    Une personne qui rouvre une story trois fois en dix minutes n'a pas
    découvert le salon trois fois.
    """
    fenetre = timedelta(seconds=get_settings().link_click_dedup_seconds)
    return bool(
        await session.scalar(
            sa.select(sa.literal(True))
            .select_from(LinkClick)
            .where(
                LinkClick.link_id == link_id,
                LinkClick.fingerprint == trace,
                LinkClick.occurred_at >= maintenant - fenetre,
            )
            .limit(1)
        )
    )


async def ouvrir(
    session: AsyncSession,
    *,
    slug: str,
    passage: Passage,
    resolveur: GeoResolver,
    maintenant: datetime | None = None,
) -> tuple[CollaborationLink, LinkClick]:
    """Enregistre le passage et rend le lien vers lequel rediriger.

    L'ordre compte : on écarte d'abord ce qui ne demande aucun calcul — robot,
    préchargement — et on ne résout une géographie que pour ce qui pourrait
    compter. Résoudre pour un robot ferait payer une lecture de base à chaque
    passage d'un moteur d'indexation.
    """
    instant = maintenant or datetime.now(UTC)

    lien = await session.scalar(
        sa.select(CollaborationLink).where(
            CollaborationLink.slug == slug, CollaborationLink.is_active.is_(True)
        )
    )
    if lien is None:
        raise LienIntrouvable(slug)

    famille = famille_de_terminal(passage.user_agent)
    referent = hote_du_referent(passage.referer)

    async def enregistrer(
        outcome: ClickOutcome,
        localisation: Localisation | None = None,
        trace: str | None = None,
    ) -> LinkClick:
        clic = LinkClick(
            link_id=lien.id,
            outcome=outcome,
            device_family=famille,
            referrer_host=referent,
            fingerprint=trace,
            country_code=localisation.country_code if localisation else None,
            region=localisation.region if localisation else None,
            city=localisation.city if localisation else None,
            city_geo=(
                f"SRID=4326;POINT({localisation.longitude} {localisation.latitude})"
                if localisation
                and localisation.longitude is not None
                and localisation.latitude is not None
                else None
            ),
        )
        session.add(clic)
        await session.flush()
        return clic

    if est_un_prechargement(passage):
        return lien, await enregistrer(ClickOutcome.PREFETCH)
    if est_un_robot(passage.user_agent):
        return lien, await enregistrer(ClickOutcome.BOT)

    # **L'adresse ne sert qu'ici.** Deux usages, aucun stockage : une ville, une
    # empreinte. Elle disparaît avec `passage` à la fin de la requête.
    localisation = resolveur.resolve(passage.ip) if passage.ip else None
    sel = await _sel_du_jour(session, instant)
    trace = empreinte(sel, lien.id, passage.ip, passage.user_agent)

    if await _est_un_doublon(session, link_id=lien.id, trace=trace, maintenant=instant):
        return lien, await enregistrer(ClickOutcome.DUPLICATE, localisation, trace)

    return lien, await enregistrer(ClickOutcome.COUNTED, localisation, trace)


async def business_du_lien(session: AsyncSession, lien: CollaborationLink) -> uuid.UUID:
    """Le commerce vers lequel rediriger, par la contrepartie et sa réservation."""
    from app.models import Booking

    return await session.scalar(  # type: ignore[return-value]
        sa.select(Booking.business_id)
        .join(Collaboration, Collaboration.booking_id == Booking.id)
        .where(Collaboration.id == lien.collaboration_id)
    )


async def purger(session: AsyncSession, *, maintenant: datetime | None = None) -> dict[str, int]:
    """Efface ce qui n'a plus d'usage : empreintes, sels, coups écartés.

    **Trois effacements, et le premier est le seul qui compte vraiment.** Passé
    la fenêtre de déduplication, une empreinte ne sert plus à rien et ne doit
    plus exister — et le sel qui l'a produite non plus, ce qui la rend
    définitivement incalculable.

    Les coups écartés partent plus tard : ils ne comptent dans aucun agrégat,
    mais leur forme est le signal d'une campagne fabriquée, et l'observer
    demande de les garder le temps d'une campagne.
    """
    settings = get_settings()
    instant = maintenant or datetime.now(UTC)
    echeance = instant - timedelta(seconds=settings.link_click_dedup_seconds)

    empreintes = await session.execute(
        sa.update(LinkClick)
        .where(LinkClick.fingerprint.is_not(None), LinkClick.occurred_at < echeance)
        .values(fingerprint=None)
    )
    sels = await session.execute(
        sa.delete(LinkClickSalt).where(LinkClickSalt.jour < echeance.astimezone(UTC).date())
    )
    ecartes = await session.execute(
        sa.delete(LinkClick).where(
            LinkClick.outcome != ClickOutcome.COUNTED,
            LinkClick.occurred_at
            < instant - timedelta(days=settings.link_click_rejected_retention_days),
        )
    )

    return {
        "empreintes_effacees": empreintes.rowcount or 0,
        "sels_effaces": sels.rowcount or 0,
        "ecartes_effaces": ecartes.rowcount or 0,
    }
