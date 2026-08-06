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

**`manual_code` est un secours, pas un raccourci.** La caméra tombe en panne,
l'écran du créateur est cassé, la lumière est mauvaise : sans lui le commerce
renvoie quelqu'un. Il est à usage unique et beaucoup plus long à deviner que six
chiffres, parce qu'il ne tourne pas.

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
LONGUEUR_SECOURS = 8

#: Nombre d'octets du secret. Trente-deux : la clé d'un HMAC-SHA256.
OCTETS_SECRET = 32


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


async def creer_code(session: AsyncSession, *, booking: Booking) -> RedemptionCode:
    """Un code par réservation, créé une fois.

    Le code de secours est retiré au hasard et réessayé en cas de collision :
    l'unicité est en base, pas dans un pari sur l'entropie.
    """
    settings = get_settings()

    for _ in range(5):
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

    raise RuntimeError("impossible de tirer un code de secours libre en cinq essais")


async def code_du_booking(session: AsyncSession, *, booking: Booking) -> RedemptionCode:
    """Le code de cette réservation, créé au premier appel.

    Créé à la demande plutôt qu'à la réservation : une réservation annulée avant
    confirmation n'a jamais besoin de code, et le secret d'un code que personne
    n'a montré n'a pas de raison d'exister.
    """
    existant = await session.scalar(
        sa.select(RedemptionCode).where(RedemptionCode.booking_id == booking.id)
    )
    return existant if existant is not None else await creer_code(session, booking=booking)


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

        if code is None or not _correspond(code, chiffres, maintenant):
            raise CodeUnknown(saisi)
        return code, False

    code = await session.scalar(
        sa.select(RedemptionCode).where(RedemptionCode.manual_code == saisi.upper())
    )
    if code is None:
        raise CodeUnknown(saisi)
    return code, True


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
