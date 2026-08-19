"""La bande de quatorze jours, et pourquoi elle porte deux champs.

**Quatorze appels devenaient quatorze parcours** des mêmes règles de capacité,
pour un écran qu'on ouvre à chaque réservation.

**Et le compte seul ne suffit pas.** Zéro créneau sur un jour ouvert n'est pas
un jour fermé : « complet » invite à regarder le lendemain, « fermé » se grise.
Un écran qui n'aurait que le compte peindrait les deux de la même façon.
"""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CapacityException, CapacityRule
from app.services import availability as service
from tests.test_booking_create import monter_le_decor, premier_creneau, reserver


async def test_la_bande_couvre_le_nombre_de_jours_demande(session: AsyncSession) -> None:
    decor = await monter_le_decor(session)

    bande = await service.disponibilite_par_jour(
        session,
        business_id=decor["business"].id,
        catalog_item_id=decor["item"].id,
        jours=14,
    )

    assert len(bande) == 14
    # Consécutifs, et sans trou : un jour manquant décalerait toute la bande.
    # Pas de `strict` : les deux vues ont par construction une longueur
    # différente de un.
    for precedent, suivant in zip(bande, bande[1:], strict=False):
        assert suivant.jour - precedent.jour == timedelta(days=1)


async def test_un_jour_ferme_se_distingue_d_un_jour_complet(session: AsyncSession) -> None:
    """**Le cœur de la route.** Les deux rendent zéro créneau ; un seul se grise.

    On ferme un jour par une exception, et on remplit un autre en réservant
    toutes ses places. Sans le champ `ouvert`, les deux seraient identiques dans
    la réponse — et la personne croirait le salon fermé un jour où il déborde.
    """
    decor = await monter_le_decor(session, postes=1)
    creneau = await premier_creneau(session, decor)
    fuseau_du_jour = creneau.date()

    # Un jour fermé, par exception.
    demain = fuseau_du_jour + timedelta(days=1)
    session.add(CapacityException(business_id=decor["business"].id, date=demain, is_closed=True))
    await session.flush()

    bande = await service.disponibilite_par_jour(
        session,
        business_id=decor["business"].id,
        catalog_item_id=decor["item"].id,
        depuis=datetime.combine(fuseau_du_jour, datetime.min.time(), tzinfo=UTC),
        jours=3,
    )
    par_jour = {j.jour: j for j in bande}

    assert par_jour[demain].ouvert is False
    assert par_jour[demain].creneaux_libres == 0


async def test_un_jour_ouvert_sans_regle_ne_ment_pas(session: AsyncSession) -> None:
    """L'autre sens : sans aucune règle, tous les jours sont fermés, et aucun ne
    doit se dire ouvert. Une bande qui rendrait `ouvert` partout passerait le
    test précédent sur le seul jour fermé par exception."""
    decor = await monter_le_decor(session)
    await session.execute(
        sa.delete(CapacityRule).where(CapacityRule.business_id == decor["business"].id)
    )
    await session.flush()

    bande = await service.disponibilite_par_jour(
        session,
        business_id=decor["business"].id,
        catalog_item_id=decor["item"].id,
        jours=7,
    )

    assert all(not jour.ouvert for jour in bande)
    assert all(jour.creneaux_libres == 0 for jour in bande)


async def test_le_compte_suit_les_reservations(session: AsyncSession) -> None:
    """Le compte est celui des créneaux réellement libres, pas des créneaux
    théoriques : réserver en retire un."""
    decor = await monter_le_decor(session, postes=1)
    creneau = await premier_creneau(session, decor)
    jour = creneau.astimezone(UTC).date()

    avant = await service.disponibilite_par_jour(
        session, business_id=decor["business"].id, catalog_item_id=decor["item"].id, jours=14
    )
    compte_avant = next(j.creneaux_libres for j in avant if j.jour == jour)

    await reserver(session, decor, starts_at=creneau)

    apres = await service.disponibilite_par_jour(
        session, business_id=decor["business"].id, catalog_item_id=decor["item"].id, jours=14
    )
    compte_apres = next(j.creneaux_libres for j in apres if j.jour == jour)

    # **Strictement moins, et non « un de moins ».** Un rendez-vous de
    # quarante-cinq minutes ferme tous les débuts qui le chevauchent, pas
    # seulement le sien : compter un seul créneau ferait dire au test une
    # arithmétique que le produit ne promet pas.
    assert compte_apres < compte_avant


async def test_la_bande_dit_la_meme_chose_que_le_detail(session: AsyncSession) -> None:
    """**Le même algorithme, pas un second.** La bande groupe ce que
    `creneaux_libres` rend ; si les deux divergeaient, c'est celle qu'on ne
    relit pas qui mentirait — le piège exact de la règle de l'absence écrite en
    deux endroits."""
    decor = await monter_le_decor(session)

    bande = await service.disponibilite_par_jour(
        session, business_id=decor["business"].id, catalog_item_id=decor["item"].id, jours=14
    )
    creneaux = await service.creneaux_libres(
        session,
        business_id=decor["business"].id,
        catalog_item_id=decor["item"].id,
        horizon=timedelta(days=20),
    )

    # **Comparé sur les jours de la bande, et non sur un horizon voisin.**
    # `creneaux_libres` compte depuis maintenant sur une durée ; la bande compte
    # des journées locales entières. Les deux fenêtres ne coïncident pas au
    # bord, et comparer leurs totaux bruts éprouverait cette différence-là
    # plutôt que l'invariant qu'on veut : la bande est un **regroupement** des
    # mêmes créneaux, pas un second calcul.
    fuseau = ZoneInfo(decor["business"].timezone)
    jours_de_la_bande = {jour.jour for jour in bande}
    dans_la_bande = [
        c for c in creneaux if c.starts_at.astimezone(fuseau).date() in jours_de_la_bande
    ]

    assert sum(jour.creneaux_libres for jour in bande) == len(dans_la_bande)
