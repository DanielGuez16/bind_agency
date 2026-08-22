"""Jusqu'à quand l'annulation ne coûte rien, et quand elle ne coûte jamais.

**L'écran disait qu'annuler tard pouvait coûter, sans pouvoir dire quand.** Le
seuil vit en configuration, et c'est exactement l'heure qui change la décision :
« gratuit jusqu'à 14 h 30 » fait annuler maintenant, « annuler tard coûte » fait
renoncer ou fait annuler trop tard.

Trois états ne coûtent **jamais** rien, et `None` les dit tous les trois : un
garde, où rien n'a été promis ; un droit sans créneau, qui ne bloque aucun
poste ; et une demande que le salon n'a pas acceptée. Le troisième vient d'une
correction — voir `SPEC.md` §4.1 — et il est éprouvé dans les deux sens ici :
l'échéance est nulle, **et** l'annulation aboutit sans écrire d'événement.
"""

from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import ReliabilityEvent
from app.models.enums import BookingStatus
from app.services import booking_states as service
from tests.test_booking_states import reservation


async def _lue(session: AsyncSession, decor, booking_id):
    from app.services import booking_history

    historique = await booking_history.historique_du_createur(
        session, creator_id=decor["createur"].id
    )
    return next(r for r in historique.items if r.booking_id == booking_id)


async def test_l_echeance_tombe_a_la_fenetre_avant_le_creneau(
    session: AsyncSession,
) -> None:
    """La fenêtre de configuration, retranchée de l'heure du rendez-vous.

    L'assertion porte sur l'écart et non sur un instant fixe : un décor figé à
    une date choisie a déjà coûté un test qui affirmait le contraire de la règle
    le jour où la date est passée.
    """
    ligne, decor = await reservation(session)
    await service.confirmer(session, booking=ligne, creator_id=decor["createur"].id)
    assert ligne.status is BookingStatus.CONFIRMED

    lue = await _lue(session, decor, ligne.id)

    attendue = ligne.starts_at - timedelta(seconds=get_settings().booking_free_cancellation_seconds)
    assert lue.annulation_sans_frais_jusqu_a == attendue
    # Et elle précède bien le créneau : une échéance postérieure se lirait
    # « gratuit jusqu'après le rendez-vous », ce qui n'a pas de sens.
    assert lue.annulation_sans_frais_jusqu_a < ligne.starts_at


async def test_une_demande_non_acceptee_n_a_pas_d_echeance(
    session: AsyncSession,
) -> None:
    """**Nulle veut dire « toujours libre »**, et le décor le prouve deux fois.

    Le rendez-vous est à moins d'une fenêtre — donc « tardif » au sens du
    délai — et l'annulation aboutit quand même, sans écrire d'événement. Sans
    cette seconde moitié, une échéance nulle pourrait cacher une annulation
    impossible, ce qui était précisément le défaut.
    """
    ligne, decor = await reservation(session, requires_booking_approval=True)
    await service.confirmer(session, booking=ligne, creator_id=decor["createur"].id)
    assert ligne.status is BookingStatus.AWAITING_BUSINESS

    fenetre = get_settings().booking_free_cancellation_seconds
    ligne.starts_at = datetime.now(UTC) + timedelta(seconds=fenetre - 3600)
    ligne.ends_at = ligne.starts_at + timedelta(minutes=60)
    await session.flush()

    lue = await _lue(session, decor, ligne.id)
    assert lue.annulation_sans_frais_jusqu_a is None

    await service.annuler(session, booking=ligne, creator_id=decor["createur"].id)
    assert ligne.status is BookingStatus.CANCELLED
    assert (
        list(
            await session.scalars(
                sa.select(ReliabilityEvent.type).where(
                    ReliabilityEvent.creator_id == decor["createur"].id
                )
            )
        )
        == []
    )


async def test_un_garde_n_a_pas_d_echeance_non_plus(session: AsyncSession) -> None:
    """Rien n'a été promis, et le garde serait tombé seul."""
    ligne, decor = await reservation(session)
    assert ligne.status is BookingStatus.HELD

    lue = await _lue(session, decor, ligne.id)

    assert lue.annulation_sans_frais_jusqu_a is None


async def test_un_droit_sans_creneau_n_a_pas_d_echeance(session: AsyncSession) -> None:
    """Il ne bloque aucun poste : il n'y a rien à rendre trop tard.

    **Le décor qui diverge du précédent** : celui-ci est confirmé, pas en
    garde. Une lecture qui ne regarderait que le statut rendrait une échéance
    ici, sur une réservation qui n'a pas d'heure.
    """
    ligne, decor = await reservation(session, requires_booking=False)
    await service.confirmer(session, booking=ligne, creator_id=decor["createur"].id)
    assert ligne.status is BookingStatus.CONFIRMED
    assert ligne.starts_at is None

    lue = await _lue(session, decor, ligne.id)

    assert lue.annulation_sans_frais_jusqu_a is None
