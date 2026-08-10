"""Le chemin complet du retrait, par les routes HTTP et rien d'autre.

Chaque maillon était testé, et la chaîne était cassée. Le code se dérive bien,
la caisse reconnaît bien ce qu'on lui donne, la consommation est bien atomique —
mais **personne n'avait relié le code que le créateur reçoit à celui que la
caisse vérifie**, et les deux ne se parlaient pas : l'app composait la charge du
QR à sa façon, avec l'identifiant de la réservation là où il fallait celui du
code. Un QR parfaitement lisible, refusé sans que rien ne dise pourquoi.

D'où ce fichier. Il ne teste aucune unité : il fait le parcours, dans l'ordre,
avec les deux jetons et les vraies routes. Ce qu'un service rend en interne ne
l'intéresse pas — seulement ce qui traverse.

Il répond aussi à une question que l'écran du créateur doit trancher : **lequel
des deux codes se saisit**. Le nombre à six chiffres ne désigne rien seul ; le
code de secours, oui. Le test le fixe pour que l'interface n'ait plus à le
deviner.
"""

import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Booking, Collaboration, RedemptionCode
from app.models.enums import BookingStatus
from tests.test_redemption_caisse import entetes, scene

PREFIX = get_settings().api_v1_prefix


async def test_du_code_montre_au_service_rendu(client: AsyncClient, session: AsyncSession) -> None:
    """Réservation confirmée, code obtenu, code vérifié, code consommé.

    Le parcours entier, sans raccourci : ce que la caisse envoie est **ce que
    l'API a donné au créateur**, jamais une valeur reconstituée par le test.
    C'est précisément ce recollage à la main qui manquait.
    """
    s = await scene(session)
    await session.commit()

    # 1. Le créateur ouvre sa réservation et reçoit de quoi la montrer.
    montre = await client.get(
        f"{PREFIX}/bookings/{s['booking'].id}/code",
        headers=await entetes(client, s["createur"]),
    )
    assert montre.status_code == 200, montre.text
    affiche = montre.json()

    # La charge du QR est formée par l'API, prête à encoder. L'app n'a pas à la
    # composer : c'est en la composant qu'elle s'est trompée d'identifiant.
    assert affiche["payload"].startswith(f"{s['code'].id}:")
    assert affiche["payload"].endswith(affiche["code"])

    # 2. La caisse vérifie ce que le QR porte, tel quel.
    caisse = await entetes(client, s["caissier"])
    vue = await client.post(
        f"{PREFIX}/redemptions/verify", json={"code": affiche["payload"]}, headers=caisse
    )
    assert vue.status_code == 200, vue.text
    reconnu = vue.json()
    assert reconnu["booking_id"] == str(s["booking"].id)
    assert reconnu["par_secours"] is False, "un QR n'est pas le chemin de secours"

    # Vérifier ne consomme rien : la caisse n'a pas encore servi.
    assert (
        await session.scalar(
            sa.select(RedemptionCode.consumed_at).where(RedemptionCode.id == s["code"].id)
        )
    ) is None

    # 3. Elle sert, puis le déclare.
    servi = await client.post(
        f"{PREFIX}/redemptions/consume",
        json={"redemption_code_id": reconnu["redemption_code_id"]},
        headers=caisse,
    )
    assert servi.status_code == 200, servi.text

    # 4. Et la boucle du produit se ferme : la réservation est consommée, et la
    #    contrepartie existe — sans elle, le créateur ne devrait rien.
    assert (
        await session.scalar(
            sa.select(RedemptionCode.consumed_at).where(RedemptionCode.id == s["code"].id)
        )
    ) is not None
    assert (
        await session.scalar(sa.select(Booking.status).where(Booking.id == s["booking"].id))
    ) == BookingStatus.CONSUMED
    assert (
        await session.scalar(
            sa.select(sa.func.count())
            .select_from(Collaboration)
            .where(Collaboration.booking_id == s["booking"].id)
        )
    ) == 1


async def test_le_code_de_secours_se_saisit_tel_qu_il_est_affiche(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Groupé trois par trois à l'écran, il se tape avec l'espace ou sans.

    C'est **le** code destiné à la saisie, et le seul. Un commerçant recopie ce
    qu'il voit ; s'il devait retirer l'espace lui-même, le refus tomberait sur
    lui sans qu'il comprenne.
    """
    s = await scene(session)
    await session.commit()

    affiche = (
        await client.get(
            f"{PREFIX}/bookings/{s['booking'].id}/code",
            headers=await entetes(client, s["createur"]),
        )
    ).json()
    assert " " in affiche["manual_code"], "le code de secours s'affiche groupé"

    caisse = await entetes(client, s["caissier"])
    for saisi in (affiche["manual_code"], affiche["manual_code"].replace(" ", "").lower()):
        vue = await client.post(
            f"{PREFIX}/redemptions/verify", json={"code": saisi}, headers=caisse
        )
        assert vue.status_code == 200, f"« {saisi} » refusé : {vue.text}"
        assert vue.json()["par_secours"] is True


async def test_les_six_chiffres_seuls_ne_se_saisissent_pas(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Ce que le créateur lit en premier n'est pas ce qu'on tape.

    Les chiffres tournent avec le temps et ne valent **qu'avec l'identifiant du
    code**, que porte le QR. Saisis seuls, ils ne désignent rien — et c'est
    exactement ce qu'un commerçant a essayé de faire.

    Le test fixe ce refus au lieu de le subir : tant qu'il tient, l'écran du
    créateur doit dire que ces chiffres ne se tapent pas, et c'est le code de
    secours qu'il doit mettre en avant pour la saisie.
    """
    s = await scene(session)
    await session.commit()

    affiche = (
        await client.get(
            f"{PREFIX}/bookings/{s['booking'].id}/code",
            headers=await entetes(client, s["createur"]),
        )
    ).json()

    refus = await client.post(
        f"{PREFIX}/redemptions/verify",
        json={"code": affiche["code"]},
        headers=await entetes(client, s["caissier"]),
    )

    assert refus.status_code == 404
    # Et le refus porte un code que l'app sait traduire : « ce code n'est pas
    # valide » plutôt que « quelque chose s'est mal passé ».
    assert refus.json()["detail"] == "redemption_code_unknown"


async def test_un_code_deja_servi_le_dit(client: AsyncClient, session: AsyncSession) -> None:
    """Le second passage doit être refusé **et nommé**.

    C'est le refus qu'un commerçant rencontrera le plus : le client revient, ou
    la caisse rescanne. « Quelque chose s'est mal passé » lui ferait redemander
    son code à quelqu'un qui a déjà été servi.
    """
    s = await scene(session)
    await session.commit()
    caisse = await entetes(client, s["caissier"])

    affiche = (
        await client.get(
            f"{PREFIX}/bookings/{s['booking'].id}/code",
            headers=await entetes(client, s["createur"]),
        )
    ).json()
    reconnu = (
        await client.post(
            f"{PREFIX}/redemptions/verify", json={"code": affiche["payload"]}, headers=caisse
        )
    ).json()
    await client.post(
        f"{PREFIX}/redemptions/consume",
        json={"redemption_code_id": reconnu["redemption_code_id"]},
        headers=caisse,
    )

    rejoue = await client.post(
        f"{PREFIX}/redemptions/verify", json={"code": affiche["payload"]}, headers=caisse
    )

    assert rejoue.status_code == 409
    assert rejoue.json()["detail"] == "redemption_code_already_consumed"
