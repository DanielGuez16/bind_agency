"""Code de retrait : dérivation, vérification, consommation.

**Le code affiché n'est jamais stocké.** Il est dérivé à la demande d'un secret
et de la fenêtre de temps courante. Un code stocké fuirait avec la base ; un
code dérivé ne vaut que trente secondes, et la base ne contient que de quoi le
recalculer.

**Une fenêtre de tolérance, pas deux.** Le créateur montre son écran, le
commerce scanne : entre les deux il s'écoule quelques secondes, parfois assez
pour franchir une frontière de fenêtre. Accepter la fenêtre précédente évite un
refus incompréhensible. Accepter la suivante ne servirait à rien — personne ne
scanne un code du futur — et doublerait la surface.

**`manual_code` est un chemin de premier rang, pas un secours dégradé.** Dans
un salon, une caméra sale ou un écran fissuré arrive tous les jours. Il se dicte
au téléphone et se tape sur un comptoir : six caractères, groupés trois par
trois.

Ce qui le protège n'est pas sa longueur. C'est qu'il est **lié à une
réservation**, à **usage unique**, à **durée courte** — il meurt avec le droit
de consommer — et **limité en tentatives**. Six caractères sur un alphabet de
trente-deux font un milliard de combinaisons ; quelques essais ratés ferment la
porte bien avant qu'on en approche.

**La comparaison est à temps constant.** Comparer deux codes avec `==` fuit leur
préfixe commun par le temps de retour ; sur un code à six chiffres qu'on peut
soumettre en boucle, c'est suffisant pour le reconstruire chiffre par chiffre.
"""

import hashlib
import hmac
import secrets
import string
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Booking, RedemptionCode
from app.models.enums import BookingStatus

#: Longueur du code affiché. Six chiffres : lisible d'un écran à l'autre, et la
#: rotation toutes les trente secondes rend le devinage sans objet.
LONGUEUR_CODE = 6

#: Alphabet du code de secours. Sans `I`, `O`, `0`, `1` : il se dicte à voix
#: haute et se saisit à la main, deux situations où ces caractères se
#: confondent. Le retirer coûte quatre symboles et évite des refus absurdes.
ALPHABET_SECOURS = "".join(c for c in string.ascii_uppercase + string.digits if c not in "IO01")

#: Six caractères, groupés trois par trois à l'affichage. Huit se dictaient mal
#: au téléphone et se saisissaient mal sur un comptoir — et la longueur n'est
#: pas ce qui protège ici.
LONGUEUR_SECOURS = 6
TAILLE_GROUPE = 3

#: Nombre d'octets du secret. Trente-deux : la clé d'un HMAC-SHA256.
OCTETS_SECRET = 32

#: Tirages avant d'abandonner sur collision de code de secours.
ESSAIS_DE_TIRAGE = 5


class RedemptionError(Exception):
    """Base des refus de retrait."""


class CodeUnknown(RedemptionError):
    """Code inconnu, mal formé, ou expiré.

    Les trois partagent une erreur : distinguer « inconnu » de « expiré »
    dirait à qui tâtonne quels identifiants existent.
    """


class CodeAlreadyConsumed(RedemptionError):
    """Déjà utilisé. Distingué du précédent, parce que le geste diffère : ici le
    commerce doit comprendre que la prestation a déjà été servie."""


class BookingNotRedeemable(RedemptionError):
    """La réservation n'est pas dans un état qui permette de consommer."""


class TooManyAttempts(RedemptionError):
    """Trop d'essais infructueux sur cette réservation.

    C'est cette limite, et non la longueur du code, qui rend le devinage
    impossible : quelques essais ratés ferment la porte longtemps avant qu'on
    approche du milliard de combinaisons.
    """


@dataclass(frozen=True, slots=True)
class CodeVerifie:
    redemption_code_id: uuid.UUID
    booking_id: uuid.UUID
    business_id: uuid.UUID
    #: Vrai si le code de secours a servi. Le commerce a le droit de savoir
    #: qu'il n'a pas scanné : c'est le chemin le moins fort des deux.
    par_secours: bool


def _fenetre(instant: datetime, rotation_seconds: int) -> int:
    return int(instant.timestamp()) // rotation_seconds


def deriver(secret: bytes, booking_id: uuid.UUID, fenetre: int) -> str:
    """Le code affiché pour une fenêtre donnée.

    Le `booking_id` entre dans le message : deux réservations qui partageraient
    par accident le même secret n'afficheraient pas le même code, et un code
    observé chez l'un ne vaut rien chez l'autre.
    """
    message = f"{booking_id}:{fenetre}".encode()
    empreinte = hmac.new(secret, message, hashlib.sha256).digest()

    # Troncature dynamique, comme dans TOTP : prendre les quatre premiers
    # octets biaiserait vers les bits de poids fort de l'empreinte.
    decalage = empreinte[-1] & 0x0F
    tronque = int.from_bytes(empreinte[decalage : decalage + 4], "big") & 0x7FFFFFFF

    return str(tronque % (10**LONGUEUR_CODE)).zfill(LONGUEUR_CODE)


class CodeAlreadyExists(RedemptionError):
    """Cette réservation a déjà son code.

    Distingué d'une collision de code de secours : l'une se réessaie, l'autre
    signale qu'on appelle deux fois ce qui n'arrive qu'une. Les confondre ferait
    tirer cinq codes au hasard pour finir par un message qui ne dit rien.
    """


async def creer_code(session: AsyncSession, *, booking: Booking) -> RedemptionCode:
    """Le code d'une réservation, créé à sa confirmation.

    Le code de secours est tiré au hasard et retiré en cas de collision :
    l'unicité est en base, pas dans un pari sur l'entropie. Six caractères sur
    trente-deux symboles rendent la collision rare, pas impossible.
    """
    settings = get_settings()

    deja = await session.scalar(
        sa.select(RedemptionCode.id).where(RedemptionCode.booking_id == booking.id)
    )
    if deja is not None:
        raise CodeAlreadyExists(str(booking.id))

    for _ in range(ESSAIS_DE_TIRAGE):
        code = RedemptionCode(
            booking_id=booking.id,
            secret=secrets.token_bytes(OCTETS_SECRET),
            manual_code="".join(secrets.choice(ALPHABET_SECOURS) for _ in range(LONGUEUR_SECOURS)),
            rotation_seconds=settings.redemption_rotation_seconds,
        )
        try:
            async with session.begin_nested():
                session.add(code)
                await session.flush()
        except IntegrityError:
            continue
        return code

    raise RuntimeError(
        f"aucun code de secours libre en {ESSAIS_DE_TIRAGE} tirages — "
        "l'espace de codes est-il saturé ?"
    )


async def code_du_booking(session: AsyncSession, *, booking: Booking) -> RedemptionCode | None:
    """Le code de cette réservation. Il existe depuis la confirmation.

    Rien n'est créé ici : une réservation confirmée sans ligne de code serait un
    cas particulier qui ressortirait partout — en reporting, en support, et le
    jour où le téléphone du créateur est vide de batterie.
    """
    return await session.scalar(
        sa.select(RedemptionCode).where(RedemptionCode.booking_id == booking.id)
    )


async def booking_du_code(
    session: AsyncSession, *, redemption_code_id: uuid.UUID
) -> uuid.UUID | None:
    """La réservation visée, sans rien vérifier d'autre.

    Sert à établir l'appartenance **avant** de se prononcer sur le code : dire
    « déjà consommé » à une caisse qui n'a rien à voir avec la réservation lui
    apprendrait quelque chose sur le commerce d'en face.
    """
    return await session.scalar(
        sa.select(RedemptionCode.booking_id).where(RedemptionCode.id == redemption_code_id)
    )


def code_affiche(code: RedemptionCode, *, maintenant: datetime | None = None) -> str:
    """Ce que le créateur voit à l'instant présent."""
    maintenant = maintenant or datetime.now(UTC)
    return deriver(code.secret, code.booking_id, _fenetre(maintenant, code.rotation_seconds))


def secours_lisible(manual_code: str) -> str:
    """Le code de secours, groupé pour être lu à voix haute et recopié.

    `4H2 9KX` se dicte ; `4H29KX` se perd au milieu. Le groupement est un
    artefact d'affichage : la saisie l'accepte avec ou sans espace.
    """
    return " ".join(
        manual_code[i : i + TAILLE_GROUPE] for i in range(0, len(manual_code), TAILLE_GROUPE)
    )


def secondes_restantes(code: RedemptionCode, *, maintenant: datetime | None = None) -> int:
    """Combien de temps le code affiché reste valable.

    Rendu à l'app pour qu'elle anime le compte à rebours plutôt que de
    redemander : un écran qui change sans prévenir fait douter de ce qu'on
    montre.
    """
    maintenant = maintenant or datetime.now(UTC)
    ecoule = int(maintenant.timestamp()) % code.rotation_seconds
    return code.rotation_seconds - ecoule


def _correspond(code: RedemptionCode, saisi: str, maintenant: datetime) -> bool:
    """La fenêtre courante, et la précédente. Comparaison à temps constant."""
    fenetre = _fenetre(maintenant, code.rotation_seconds)
    return any(
        hmac.compare_digest(deriver(code.secret, code.booking_id, f), saisi)
        for f in (fenetre, fenetre - 1)
    )


async def verifier(
    session: AsyncSession, *, saisi: str, maintenant: datetime | None = None
) -> CodeVerifie:
    """Reconnaît un code, sans rien consommer.

    Deux formes acceptées : `identifiant:chiffres`, ce que porte le QR, et le
    code de secours seul, qui est unique et se suffit à lui-même.

    Séparé de la consommation à dessein : le commerce vérifie pour afficher ce
    qu'il doit servir, puis consomme quand c'est fait. Fondre les deux ferait
    consommer une réservation qu'on n'a pas encore honorée.
    """
    maintenant = maintenant or datetime.now(UTC)
    saisi = saisi.strip()

    code, par_secours = await _reconnaitre(session, saisi, maintenant)

    if code.consumed_at is not None:
        raise CodeAlreadyConsumed(str(code.id))

    # Le compteur est remis à zéro : cet essai a abouti. Le laisser courir
    # fermerait un code parfaitement sain après quelques scans ratés étalés sur
    # plusieurs visites.
    if code.failed_attempts:
        code.failed_attempts = 0
        await session.flush()

    booking = await session.get(Booking, code.booking_id)
    if booking is None:
        raise CodeUnknown(saisi)

    return CodeVerifie(
        redemption_code_id=code.id,
        booking_id=booking.id,
        business_id=booking.business_id,
        par_secours=par_secours,
    )


async def _reconnaitre(
    session: AsyncSession, saisi: str, maintenant: datetime
) -> tuple[RedemptionCode, bool]:
    if ":" in saisi:
        identifiant, _, chiffres = saisi.partition(":")
        try:
            code = await session.get(RedemptionCode, uuid.UUID(identifiant))
        except ValueError as error:
            raise CodeUnknown(saisi) from error

        if code is None:
            raise CodeUnknown(saisi)

        _refuser_si_epuise(code)
        if not _correspond(code, chiffres, maintenant):
            await _compter_un_echec(session, code)
            raise CodeUnknown(saisi)
        return code, False

    # Espaces et casse ignorés : le code est groupé à l'affichage et dicté à
    # voix haute, il arrive écrit de toutes les façons.
    normalise = saisi.replace(" ", "").replace("-", "").upper()
    code = await session.scalar(
        sa.select(RedemptionCode).where(RedemptionCode.manual_code == normalise)
    )
    if code is None:
        raise CodeUnknown(saisi)

    _refuser_si_epuise(code)
    return code, True


def _refuser_si_epuise(code: RedemptionCode) -> None:
    if code.failed_attempts >= get_settings().redemption_max_failed_attempts:
        raise TooManyAttempts(str(code.id))


async def _compter_un_echec(session: AsyncSession, code: RedemptionCode) -> None:
    """Incrémente en base, pas en mémoire.

    L'appelant va lever, donc sa transaction sera peut-être annulée : le
    compteur doit survivre au refus, sinon il ne compte rien. C'est à la route
    de valider cette écriture, comme pour la bascule d'un compte social expiré.
    """
    await session.execute(
        sa.update(RedemptionCode)
        .where(RedemptionCode.id == code.id)
        .values(failed_attempts=RedemptionCode.failed_attempts + 1)
    )
    await session.flush()


async def marquer_consomme(
    session: AsyncSession, *, redemption_code_id: uuid.UUID, par_user_id: uuid.UUID
) -> RedemptionCode:
    """Pose la consommation, à l'abri d'un double scan.

    Le `UPDATE … WHERE consumed_at IS NULL` est la garantie : deux caisses qui
    scannent le même code au même instant se disputent la même ligne, et la
    seconde ne modifie rien. Vérifier avant d'écrire laisserait passer les deux.
    """
    resultat = await session.execute(
        sa.update(RedemptionCode)
        .where(RedemptionCode.id == redemption_code_id, RedemptionCode.consumed_at.is_(None))
        .values(consumed_at=sa.func.clock_timestamp(), consumed_by_user_id=par_user_id)
        .returning(RedemptionCode.id)
    )
    if resultat.scalar_one_or_none() is None:
        raise CodeAlreadyConsumed(str(redemption_code_id))

    code = await session.get(RedemptionCode, redemption_code_id)
    await session.refresh(code)
    return code


def etat_reservation_consommable(booking: Booking) -> None:
    """Ce qui empêche de servir, en dehors du code lui-même."""
    if booking.status is not BookingStatus.CONFIRMED:
        raise BookingNotRedeemable(f"réservation en {booking.status.value}")
    if booking.valid_until <= datetime.now(UTC):
        raise BookingNotRedeemable("droit expiré")
