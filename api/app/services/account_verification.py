"""Vérification de cohérence d'un compte social — `SPEC.md` §3.2.

C'est ce contrôle, et pas le moteur de paliers, qui protège du compte acheté ou
fraîchement créé. Le moteur de paliers dit « assez grand pour ce format » ; ici
on demande « est-ce un vrai compte ».

**Trois issues, et une seule s'obtient sans humain.** `verified` est prononcé
automatiquement quand tous les signaux jugeables passent. `rejected` ne l'est
**jamais** : un rejet définitif prononcé par une heuristique sur un vrai
créateur est une perte sèche que personne ne rattrape — il ne réessaiera pas.
Tout ce qui n'est pas net reste en `needs_review` et remonte dans la file
d'administration, qui seule prononce le rejet.

**Chaque signal produit un verdict nommé, pas un score agrégé.** Un score dirait
« 0,62 » et personne ne saurait quoi en faire. Cinq verdicts nommés disent
lequel a bloqué, donc quoi regarder. Même raison que pour les obstacles
d'éligibilité.

**Un signal sans donnée est neutre, pas manqué**, et les deux façons de manquer
de données sont nommées séparément parce qu'elles appellent des gestes
différents : ou bien le produit ne sait pas encore mesurer ce signal — c'est un
trou à combler chez nous — ou bien ce compte-ci n'a pas encore assez
d'historique — c'est au temps de faire son travail. Les confondre ferait
chercher un bug là où il n'y a que de la patience à avoir.

**Le contrôle est rejouable et ne descend jamais.** Il s'exécute après chaque
relevé de métriques réussi. Un compte tout juste connecté n'a rien à montrer et
reste en attente ; quelques semaines plus tard, les mêmes signaux le font
passer sans que personne n'intervienne. En sens inverse, un compte déjà
`verified` n'est jamais redescendu par une réexécution : seule la file
d'administration peut le faire.
"""

import re
import unicodedata
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.models import CreatorProfile, SocialAccount, SocialMetricsSnapshot
from app.models.enums import VerificationStatus
from app.services import audit


class Signal(StrEnum):
    """Les cinq signaux de `SPEC.md` §3.2, dans l'ordre où ils y figurent."""

    #: Ancienneté du compte et date de la première publication.
    ANCIENNETE = "anciennete"
    #: Nombre de publications rapporté au nombre d'abonnés.
    VOLUME_DE_PUBLICATION = "volume_de_publication"
    #: Régularité de publication sur les dernières semaines.
    REGULARITE_DE_PUBLICATION = "regularite_de_publication"
    #: Engagement rapporté au volume, aberrant dans un sens comme dans l'autre.
    ENGAGEMENT = "engagement"
    #: Cohérence entre le nom déclaré à l'inscription et le compte connecté.
    NOM_DECLARE = "nom_declare"


class VerdictSignal(StrEnum):
    """Quatre issues, dont deux façons distinctes de ne pas se prononcer.

    Les nommer séparément est ce qui empêche de « simplifier » l'une en croyant
    traiter l'autre — et ce qui permet de lire, dans la file d'administration,
    si un compte attend après nous ou après le temps.
    """

    TENU = "tenu"
    MANQUE = "manque"
    #: Le produit ne sait pas encore mesurer ce signal. Trou de notre côté.
    IGNORE_MECANISME_ABSENT = "ignore_mecanisme_absent"
    #: Le produit sait le mesurer, ce compte n'a pas encore de quoi. Trou du temps.
    IGNORE_HISTORIQUE_INSUFFISANT = "ignore_historique_insuffisant"


@dataclass(frozen=True, slots=True)
class Constat:
    signal: Signal
    verdict: VerdictSignal
    requis: Decimal | int | None = None
    constate: Decimal | int | None = None


@dataclass(frozen=True, slots=True)
class Coherence:
    """Le résultat entier pour un compte."""

    social_account_id: uuid.UUID
    constats: tuple[Constat, ...]

    @property
    def manques(self) -> tuple[Constat, ...]:
        return tuple(c for c in self.constats if c.verdict is VerdictSignal.MANQUE)

    @property
    def juges(self) -> tuple[Constat, ...]:
        """Les signaux sur lesquels on s'est effectivement prononcé."""
        return tuple(
            c for c in self.constats if c.verdict in (VerdictSignal.TENU, VerdictSignal.MANQUE)
        )

    @property
    def verifiable(self) -> bool:
        """Vrai si le compte peut passer `verified` sans intervention.

        Deux conditions, et la seconde est celle qu'on oublie : aucun signal
        manqué, **et au moins un signal jugé**. Sans elle, un compte dont rien
        n'est mesurable passerait le contrôle par vacuité — « aucun signal n'a
        échoué » serait vrai précisément parce qu'aucun n'a été examiné. Un
        ensemble vide n'est pas un succès, c'est un symptôme.
        """
        return not self.manques and bool(self.juges)


# --------------------------------------------------------------------------
# ce que la fonction pure reçoit
# --------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ReleveEvalue:
    followers_count: int
    media_count: int
    engagement_rate: Decimal | None
    captured_at: datetime


@dataclass(frozen=True, slots=True)
class CompteEvalue:
    social_account_id: uuid.UUID
    handle: str | None
    #: Le plus récent. Sans lui il n'y a rien à examiner.
    dernier: ReleveEvalue | None
    #: Le plus ancien relevé disponible, pour juger la progression.
    premier: ReleveEvalue | None
    first_name: str | None
    last_name: str | None


# --------------------------------------------------------------------------
# la règle, sans base de données
# --------------------------------------------------------------------------


def evaluer(compte: CompteEvalue, settings: Settings) -> Coherence:
    """Les cinq signaux, dans l'ordre de `SPEC.md` §3.2. Aucune agrégation."""
    return Coherence(
        social_account_id=compte.social_account_id,
        constats=(
            _anciennete(),
            _volume(compte.dernier, settings),
            _regularite(compte.premier, compte.dernier, settings),
            _engagement(compte.dernier, settings),
            _nom_declare(compte),
        ),
    )


def _anciennete() -> Constat:
    """Ni la date de création du compte ni celle de la première publication ne
    sont récupérées aujourd'hui : `/me` ne les donne pas, seul le relevé des
    publications les portera. Neutre, donc, et pas manqué — un compte n'a pas à
    être suspecté d'une donnée que nous n'avons pas demandée.
    """
    return Constat(signal=Signal.ANCIENNETE, verdict=VerdictSignal.IGNORE_MECANISME_ABSENT)


def _volume(dernier: ReleveEvalue | None, settings: Settings) -> Constat:
    """Le seul signal pleinement mesurable aujourd'hui.

    Deux façons d'échouer, et elles ne se ressemblent pas : trop peu de
    publications tout court, ou beaucoup d'abonnés pour très peu de
    publications. La seconde est la signature du compte acheté.
    """
    if dernier is None:
        return Constat(
            signal=Signal.VOLUME_DE_PUBLICATION,
            verdict=VerdictSignal.IGNORE_HISTORIQUE_INSUFFISANT,
        )

    minimum = settings.verification_min_media_count
    if dernier.media_count < minimum:
        return Constat(
            signal=Signal.VOLUME_DE_PUBLICATION,
            verdict=VerdictSignal.MANQUE,
            requis=minimum,
            constate=dernier.media_count,
        )

    plafond = settings.verification_max_followers_per_media
    ratio = dernier.followers_count // dernier.media_count
    return Constat(
        signal=Signal.VOLUME_DE_PUBLICATION,
        verdict=VerdictSignal.TENU if ratio <= plafond else VerdictSignal.MANQUE,
        requis=plafond,
        constate=ratio,
    )


def _regularite(
    premier: ReleveEvalue | None, dernier: ReleveEvalue | None, settings: Settings
) -> Constat:
    """Mesurée sur la progression du nombre de publications entre deux relevés.

    C'est une approximation assumée : la vraie régularité se lit sur les dates
    des publications, que seul le relevé des publications rapportera. Mais elle
    se calcule avec ce que nous avons, et c'est elle qui donne son sens à la
    réexécution — un compte examiné trop tôt n'est pas condamné, il est ajourné.
    """
    fenetre = timedelta(days=settings.verification_regularity_window_days)

    if premier is None or dernier is None or dernier.captured_at - premier.captured_at < fenetre:
        return Constat(
            signal=Signal.REGULARITE_DE_PUBLICATION,
            verdict=VerdictSignal.IGNORE_HISTORIQUE_INSUFFISANT,
        )

    minimum = settings.verification_min_media_in_window
    publiees = dernier.media_count - premier.media_count
    return Constat(
        signal=Signal.REGULARITE_DE_PUBLICATION,
        verdict=VerdictSignal.TENU if publiees >= minimum else VerdictSignal.MANQUE,
        requis=minimum,
        constate=publiees,
    )


def _engagement(dernier: ReleveEvalue | None, settings: Settings) -> Constat:
    """Aberrant dans un sens comme dans l'autre.

    Trop bas trahit des abonnés achetés, trop haut un pod d'engagement. La
    comparaison est écrite ici et fonctionnera telle quelle : `engagement_rate`
    est nul tant que le relevé des publications n'existe pas, et un taux nul
    veut dire « pas encore mesuré », jamais « zéro ».
    """
    if dernier is None or dernier.engagement_rate is None:
        return Constat(signal=Signal.ENGAGEMENT, verdict=VerdictSignal.IGNORE_MECANISME_ABSENT)

    plancher = settings.verification_min_engagement_rate
    plafond = settings.verification_max_engagement_rate
    taux = dernier.engagement_rate

    return Constat(
        signal=Signal.ENGAGEMENT,
        verdict=VerdictSignal.TENU if plancher <= taux <= plafond else VerdictSignal.MANQUE,
        constate=taux,
    )


def _nom_declare(compte: CompteEvalue) -> Constat:
    """Le nom déclaré se retrouve-t-il dans le pseudonyme du compte connecté.

    Aucun créateur ne peut renseigner son nom aujourd'hui : la tâche « Profil
    créateur en écriture » n'est pas faite. Le signal est donc neutre, comme la
    condition de score l'est pour un créateur sans historique — nul veut dire
    ignoré, jamais manqué. La comparaison ci-dessous est écrite et éprouvée
    malgré tout : le jour où le profil s'écrit, le signal compte sans qu'une
    ligne change ici.
    """
    if not (compte.first_name or compte.last_name) or not compte.handle:
        return Constat(signal=Signal.NOM_DECLARE, verdict=VerdictSignal.IGNORE_MECANISME_ABSENT)

    return Constat(
        signal=Signal.NOM_DECLARE,
        verdict=(
            VerdictSignal.TENU
            if nom_present_dans_handle(compte.first_name, compte.last_name, compte.handle)
            else VerdictSignal.MANQUE
        ),
    )


#: Longueur en deçà de laquelle un fragment de nom ne prouve rien : « li » se
#: retrouve dans à peu près n'importe quel pseudonyme.
FRAGMENT_MINIMUM = 3


def nom_present_dans_handle(first_name: str | None, last_name: str | None, handle: str) -> bool:
    """Un fragment du nom déclaré apparaît-il dans le pseudonyme.

    Volontairement permissif. Le signal sert à repérer l'usurpation grossière —
    un compte au nom d'une marque connue déclaré sous un nom quelconque — pas à
    imposer que le pseudonyme soit l'état civil. La plupart des créateurs ont un
    pseudonyme de scène, et les faire tous passer en revue rendrait la file
    inutilisable.
    """
    reference = _reduire(handle)
    fragments = [
        reduit
        for partie in (first_name or "", last_name or "")
        for morceau in re.split(r"[\s\-']+", partie)
        if len(reduit := _reduire(morceau)) >= FRAGMENT_MINIMUM
    ]
    return any(fragment in reference for fragment in fragments)


def _reduire(texte: str) -> str:
    """Minuscules, sans accents, sans ponctuation. « Núñez » et « nunez_mia »
    doivent se reconnaître."""
    sans_accent = unicodedata.normalize("NFKD", texte).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", sans_accent.lower())


# --------------------------------------------------------------------------
# la lecture et la transition
# --------------------------------------------------------------------------


class VerificationError(Exception):
    """Base des refus de vérification."""


class SocialAccountNotFound(VerificationError):
    """Compte inexistant."""


class TransitionNotAllowed(VerificationError):
    """Issue demandée impossible depuis l'état courant."""


async def charger(session: AsyncSession, account: SocialAccount) -> CompteEvalue:
    """Deux requêtes : les relevés extrêmes du compte, et le profil du créateur.

    Le premier et le dernier relevé suffisent — juger la régularité sur toute la
    série n'apporterait rien tant que la mesure est une différence de compteurs.
    """
    bornes = (
        await session.execute(
            sa.select(
                SocialMetricsSnapshot.followers_count,
                SocialMetricsSnapshot.media_count,
                SocialMetricsSnapshot.engagement_rate,
                SocialMetricsSnapshot.captured_at,
            )
            .where(SocialMetricsSnapshot.social_account_id == account.id)
            .order_by(SocialMetricsSnapshot.captured_at)
        )
    ).all()

    releves = [
        ReleveEvalue(
            followers_count=ligne.followers_count,
            media_count=ligne.media_count,
            engagement_rate=ligne.engagement_rate,
            captured_at=ligne.captured_at,
        )
        for ligne in bornes
    ]

    profil = await session.get(CreatorProfile, account.creator_id)

    return CompteEvalue(
        social_account_id=account.id,
        handle=account.handle,
        dernier=releves[-1] if releves else None,
        premier=releves[0] if releves else None,
        first_name=profil.first_name if profil else None,
        last_name=profil.last_name if profil else None,
    )


async def verifier(session: AsyncSession, *, account: SocialAccount) -> Coherence:
    """Réexamine un compte et le fait passer `verified` s'il est net.

    Ne descend jamais : un compte `verified` garde son statut, un compte
    `rejected` aussi. Seule la file d'administration défait ces deux-là.
    """
    coherence = evaluer(await charger(session, account), get_settings())

    if account.verification_status is not VerificationStatus.NEEDS_REVIEW:
        return coherence

    if not coherence.verifiable:
        # Aucune transition, donc aucune ligne de journal : le compte n'a pas
        # changé d'état, il attend toujours. La file d'administration le voit.
        return coherence

    await _transitionner(
        session,
        account=account,
        vers=VerificationStatus.VERIFIED,
        actor=audit.Actor.system(),
        reason="tous les signaux de cohérence jugeables sont tenus",
        extra=_journalisable(coherence),
    )
    return coherence


async def prononcer(
    session: AsyncSession,
    *,
    account: SocialAccount,
    vers: VerificationStatus,
    actor: audit.Actor,
    reason: str,
) -> Coherence:
    """Verdict d'administration. Seul chemin vers `rejected`.

    Seul chemin, aussi, pour redescendre un compte `verified` : la
    réexécution automatique ne le fait jamais. Rend les constats du moment,
    ceux-là mêmes qui partent au journal.
    """
    if account.verification_status is vers:
        raise TransitionNotAllowed(f"le compte est déjà en {vers.value}")

    coherence = evaluer(await charger(session, account), get_settings())
    await _transitionner(
        session,
        account=account,
        vers=vers,
        actor=actor,
        reason=reason,
        extra=_journalisable(coherence),
    )
    return coherence


async def _transitionner(
    session: AsyncSession,
    *,
    account: SocialAccount,
    vers: VerificationStatus,
    actor: audit.Actor,
    reason: str,
    extra: dict,
) -> None:
    depuis = account.verification_status
    account.verification_status = vers
    account.verification_reviewed_at = datetime.now(UTC)

    await audit.record_transition(
        session,
        entity=audit.AuditedEntity.SOCIAL_ACCOUNT,
        entity_id=account.id,
        from_status=depuis.value,
        to_status=vers.value,
        actor=actor,
        reason=reason,
        extra=extra,
    )
    await session.flush()


def _journalisable(coherence: Coherence) -> dict:
    """Les constats tels qu'ils étaient au moment de la décision.

    Les seuils bougeront ; sans cette trace, une décision passée deviendrait
    inexplicable — on relirait la règle d'aujourd'hui en croyant relire celle
    qui a tranché.
    """
    return {
        "signaux": {
            constat.signal.value: {
                "verdict": constat.verdict.value,
                "requis": str(constat.requis) if constat.requis is not None else None,
                "constate": str(constat.constate) if constat.constate is not None else None,
            }
            for constat in coherence.constats
        }
    }


async def file_d_administration(session: AsyncSession) -> list[tuple[SocialAccount, Coherence]]:
    """Les comptes en attente, avec la raison de leur attente.

    Rendre la liste sans les constats obligerait l'administrateur à deviner ce
    qui coince, compte par compte. C'est précisément ce que les verdicts nommés
    évitent.
    """
    comptes = list(
        await session.scalars(
            sa.select(SocialAccount)
            .where(SocialAccount.verification_status == VerificationStatus.NEEDS_REVIEW)
            .order_by(SocialAccount.connected_at)
        )
    )

    settings = get_settings()
    return [(compte, evaluer(await charger(session, compte), settings)) for compte in comptes]
