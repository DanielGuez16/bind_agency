"""Les horaires sur la fiche publique.

**Ils n'étaient servis nulle part**, et l'écran ne pouvait donc pas dire
« ouvert jusqu'à 19 h ». C'est l'information la plus regardée d'une fiche de
salon, et la seule que la disponibilité ne remplace pas : savoir qu'il reste un
créneau à 15 h ne dit pas si l'on peut passer sans rendez-vous.
"""

from datetime import time

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Business, CapacityException, CapacityRule
from app.models.enums import BusinessStatus
from app.services import business_public
from tests.test_activation import commerce_en_cours


async def _en_ligne(session: AsyncSession):
    """Un commerce en ligne : la fiche publique n'existe que pour ceux-là."""
    business, proprietaire = await commerce_en_cours(session)
    await session.execute(
        sa.update(Business).where(Business.id == business.id).values(status=BusinessStatus.ACTIVE)
    )
    await session.flush()
    return business, proprietaire


async def test_la_fiche_rend_les_plages_du_lundi_au_dimanche(session: AsyncSession) -> None:
    business, proprietaire = await _en_ligne(session)
    session.add_all(
        [
            CapacityRule(
                business_id=business.id,
                weekday=2,
                start_time=time(9, 0),
                end_time=time(19, 0),
                concurrent_slots=1,
            ),
            CapacityRule(
                business_id=business.id,
                weekday=0,
                start_time=time(10, 0),
                end_time=time(18, 0),
                concurrent_slots=1,
            ),
        ]
    )
    await session.flush()

    vue = await business_public.fiche(session, business_id=business.id, creator_id=proprietaire.id)

    plages = [(p.weekday, p.start_time, p.end_time) for p in vue.horaires]
    assert (0, time(10, 0), time(18, 0)) in plages
    assert (2, time(9, 0), time(19, 0)) in plages
    # **Triées**, pour que l'écran n'ait pas à le refaire : une semaine rendue
    # dans l'ordre d'insertion se lit comme un désordre, et deux écrans qui
    # trieraient chacun de leur côté finiraient par diverger.
    assert plages == sorted(plages)


async def test_une_fermeture_ponctuelle_ne_change_pas_les_horaires(
    session: AsyncSession,
) -> None:
    """**Les règles, pas les exceptions.** Une fermeture ponctuelle appartient à
    la disponibilité, qui la porte déjà ; la mêler aux horaires ferait lire
    « fermé le mardi » à quelqu'un qui regarde un mardi férié."""
    from datetime import date, timedelta

    business, proprietaire = await _en_ligne(session)
    session.add(
        CapacityRule(
            business_id=business.id,
            weekday=1,
            start_time=time(9, 0),
            end_time=time(19, 0),
            concurrent_slots=1,
        )
    )
    await session.flush()

    avant = await business_public.fiche(
        session, business_id=business.id, creator_id=proprietaire.id
    )

    # Un mardi fermé, quelque part devant nous.
    jour = date.today()
    while jour.weekday() != 1:
        jour += timedelta(days=1)
    session.add(CapacityException(business_id=business.id, date=jour, is_closed=True))
    await session.flush()

    apres = await business_public.fiche(
        session, business_id=business.id, creator_id=proprietaire.id
    )

    assert apres.horaires == avant.horaires


async def test_un_commerce_sans_regle_rend_des_horaires_vides(session: AsyncSession) -> None:
    """Vide et non absent : l'écran doit pouvoir dire « horaires non renseignés »
    plutôt que de ne rien dessiner du tout."""
    business, proprietaire = await _en_ligne(session)
    await session.execute(sa.delete(CapacityRule).where(CapacityRule.business_id == business.id))
    await session.flush()

    vue = await business_public.fiche(session, business_id=business.id, creator_id=proprietaire.id)

    assert vue.horaires == ()
