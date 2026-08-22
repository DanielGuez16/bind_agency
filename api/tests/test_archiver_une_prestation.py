"""Archiver plutôt qu'effacer, et remplacer plutôt que réécrire.

**La donnée décide, pas le geste.** Une prestation jamais réservée se supprime
vraiment — un catalogue composé le premier jour contient des essais, et les
obliger à s'archiver laisserait des brouillons dans l'inventaire pour toujours.
Une prestation déjà réservée ne se supprime à aucune condition : supprimer
effacerait le texte d'un accord tenu.

**Archiver n'est pas fermer**, et c'est la distinction que `is_available` ne
pouvait pas porter. Un salon ferme une prestation pour l'été et la rouvre en
septembre ; il archive celle qu'il ne refera plus. Les deux valaient
`is_available: false`, et l'écran devait choisir entre sortir de la liste de
travail une prestation saisonnière et y laisser des archives pour toujours.

**Et la modification se coupe en deux.** La photo, l'orthographe et la
description s'éditent en place : elles ne changent rien à ce qui a été convenu.
La durée, le palier et la contrepartie sont l'accord — les changer crée une
nouvelle prestation et archive l'ancienne, parce que douze réservations citent
une prestation de quarante-cinq minutes et que la passer à soixante-quinze leur
ferait dire ce qui n'a pas eu lieu.
"""

import uuid

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.config import get_settings
from app.models.enums import UserRole
from tests.test_catalog import commerce, compte, item, reserve

PREFIX = get_settings().api_v1_prefix


async def _salon(client: AsyncClient):
    gerant = await compte(client, UserRole.BUSINESS_MEMBER)
    return gerant, await commerce(client, gerant)


# --------------------------------------------------------------------------
# supprimer, ou archiver : la donnée décide
# --------------------------------------------------------------------------


async def test_une_prestation_jamais_reservee_se_supprime_vraiment(
    client: AsyncClient,
) -> None:
    """Un catalogue composé le premier jour contient des essais.

    Les obliger à s'archiver laisserait des brouillons dans l'inventaire pour
    toujours, et l'archive cesserait de vouloir dire quelque chose.
    """
    gerant, salon = await _salon(client)
    essai = await item(client, gerant, salon, name="Essai")

    assert essai["reservations_count"] == 0

    efface = await client.delete(
        f"{PREFIX}/business/{salon}/catalog-items/{essai['id']}", headers=gerant["headers"]
    )
    assert efface.status_code == 204

    liste = (
        await client.get(f"{PREFIX}/business/{salon}/catalog-items", headers=gerant["headers"])
    ).json()
    assert essai["id"] not in [i["id"] for i in liste]


async def test_une_prestation_reservee_ne_se_supprime_a_aucune_condition(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    """Supprimer effacerait le texte d'un accord tenu."""
    gerant, salon = await _salon(client)
    soin = await item(client, gerant, salon)
    await reserve(conn, salon, soin["id"])

    efface = await client.delete(
        f"{PREFIX}/business/{salon}/catalog-items/{soin['id']}", headers=gerant["headers"]
    )

    assert efface.status_code == 409
    assert efface.json()["detail"] == "catalog_item_has_bookings"


async def test_le_compte_de_reservations_nomme_la_consequence(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    """« Archiver, deux réservations citent cette prestation » se décide.

    « Archiver » ne se décide pas. Le décor pose **deux** réservations et non
    une : un compteur qui rendrait un booléen déguisé passerait avec une seule.
    """
    gerant, salon = await _salon(client)
    soin = await item(client, gerant, salon, name="Soin visage")
    autre = await item(client, gerant, salon, name="Massage")
    await reserve(conn, salon, soin["id"])
    await reserve(conn, salon, autre["id"])

    liste = (
        await client.get(f"{PREFIX}/business/{salon}/catalog-items", headers=gerant["headers"])
    ).json()
    par_id = {i["id"]: i for i in liste}

    # **Chacun compte les siennes**, et pas celles du catalogue : un compteur
    # qui rendrait le total du salon passerait un décor à un seul item.
    assert par_id[soin["id"]]["reservations_count"] == 1
    assert par_id[autre["id"]]["reservations_count"] == 1


# --------------------------------------------------------------------------
# archiver n'est pas fermer
# --------------------------------------------------------------------------


async def test_archiver_et_fermer_ne_se_confondent_pas(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    """**Le test qui distingue les deux états.**

    La saisonnière est fermée et reste dans la liste de travail — le gérant la
    rouvrira. L'archivée en sort. Sans cette distinction, l'écran devait choisir
    entre perdre la première et garder la seconde pour toujours.
    """
    gerant, salon = await _salon(client)
    saisonniere = await item(client, gerant, salon, name="Soin d'été")
    retiree = await item(client, gerant, salon, name="Ancien forfait")
    await reserve(conn, salon, retiree["id"])

    # La fermeture passe par sa route dédiée : c'est une transition d'état, et
    # elle laisse une trace au journal.
    ferme = await client.put(
        f"{PREFIX}/business/{salon}/catalog-items/{saisonniere['id']}/availability",
        json={"is_available": False},
        headers=gerant["headers"],
    )
    assert ferme.status_code == 204, ferme.text
    archive = await client.post(
        f"{PREFIX}/business/{salon}/catalog-items/{retiree['id']}/archive",
        headers=gerant["headers"],
    )
    assert archive.status_code == 200, archive.text

    liste = (
        await client.get(f"{PREFIX}/business/{salon}/catalog-items", headers=gerant["headers"])
    ).json()
    identifiants = [i["id"] for i in liste]

    assert saisonniere["id"] in identifiants, "une prestation fermée se rouvre : elle reste"
    assert retiree["id"] not in identifiants

    # Les deux sont indisponibles, et c'est précisément pourquoi
    # `is_available` ne pouvait pas les distinguer.
    fermee = next(i for i in liste if i["id"] == saisonniere["id"])
    assert fermee["is_available"] is False
    assert fermee["archived_at"] is None


async def test_une_archive_reste_atteignable_et_se_lit_avec_les_archives(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    """Elle quitte la liste de travail, elle ne disparaît pas.

    C'est la raison pour laquelle on ne la supprime pas : la réservation qui la
    cite doit pouvoir la lire.
    """
    gerant, salon = await _salon(client)
    soin = await item(client, gerant, salon)
    await reserve(conn, salon, soin["id"])
    await client.post(
        f"{PREFIX}/business/{salon}/catalog-items/{soin['id']}/archive",
        headers=gerant["headers"],
    )

    lue = await client.get(
        f"{PREFIX}/business/{salon}/catalog-items/{soin['id']}", headers=gerant["headers"]
    )
    assert lue.status_code == 200
    assert lue.json()["archived_at"] is not None

    avec = (
        await client.get(
            f"{PREFIX}/business/{salon}/catalog-items?avec_archives=true",
            headers=gerant["headers"],
        )
    ).json()
    assert soin["id"] in [i["id"] for i in avec]


async def test_une_archive_ne_se_rouvre_pas(client: AsyncClient, conn: AsyncConnection) -> None:
    """Rouvrir ferait d'une trace un objet vivant, et les réservations qui la
    citent parleraient soudain d'autre chose."""
    gerant, salon = await _salon(client)
    soin = await item(client, gerant, salon)
    await reserve(conn, salon, soin["id"])
    await client.post(
        f"{PREFIX}/business/{salon}/catalog-items/{soin['id']}/archive",
        headers=gerant["headers"],
    )

    encore = await client.post(
        f"{PREFIX}/business/{salon}/catalog-items/{soin['id']}/archive",
        headers=gerant["headers"],
    )

    assert encore.status_code == 409
    assert encore.json()["detail"] == "catalog_item_already_archived"


# --------------------------------------------------------------------------
# la présentation s'édite, l'accord se remplace
# --------------------------------------------------------------------------


async def test_la_presentation_s_edite_en_place_meme_apres_reservation(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    """**La moitié qui ne crée rien.**

    La photo, l'orthographe et la description ne changent rien à ce qui a été
    convenu : les faire passer par un remplacement multiplierait les
    prestations pour une faute de frappe.
    """
    gerant, salon = await _salon(client)
    soin = await item(client, gerant, salon, name="Soin vissage")
    await reserve(conn, salon, soin["id"])

    corrige = await client.patch(
        f"{PREFIX}/business/{salon}/catalog-items/{soin['id']}",
        json={"name": "Soin visage", "description": "Une heure de soin"},
        headers=gerant["headers"],
    )

    assert corrige.status_code == 200, corrige.text
    assert corrige.json()["name"] == "Soin visage"
    assert corrige.json()["archived_at"] is None


async def test_changer_la_duree_d_une_prestation_reservee_est_refuse(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    """L'accord ne se réécrit pas en place.

    Douze réservations citent une prestation de quarante-cinq minutes ; la
    passer à soixante-quinze leur ferait dire ce qui n'a pas eu lieu.
    """
    gerant, salon = await _salon(client)
    soin = await item(client, gerant, salon, duration_minutes=60)
    await reserve(conn, salon, soin["id"])

    refuse = await client.patch(
        f"{PREFIX}/business/{salon}/catalog-items/{soin['id']}",
        json={"duration_minutes": 90},
        headers=gerant["headers"],
    )

    assert refuse.status_code == 409
    assert refuse.json()["detail"] == "catalog_item_locked_by_bookings"


async def test_remplacer_cree_la_neuve_et_archive_l_ancienne(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    """**Les deux gestes, ou aucun.**

    Séparer les deux appels laisserait un salon avec deux prestations vivantes
    s'il ferme l'écran entre les deux, ou aucune dans l'autre ordre.
    """
    gerant, salon = await _salon(client)
    ancienne = await item(client, gerant, salon, name="Soin visage", duration_minutes=60)
    await reserve(conn, salon, ancienne["id"])

    reponse = await client.post(
        f"{PREFIX}/business/{salon}/catalog-items/{ancienne['id']}/replace",
        json={
            "name": "Soin visage",
            "price_cents": 9000,
            "duration_minutes": 75,
            "requires_booking": True,
        },
        headers=gerant["headers"],
    )

    assert reponse.status_code == 201, reponse.text
    nouvelle = reponse.json()
    assert nouvelle["id"] != ancienne["id"]
    assert nouvelle["duration_minutes"] == 75
    assert nouvelle["archived_at"] is None

    # L'ancienne est archivée, et elle garde sa durée : c'est ce qui protège
    # l'histoire des réservations qui la citent.
    relue = (
        await client.get(
            f"{PREFIX}/business/{salon}/catalog-items/{ancienne['id']}",
            headers=gerant["headers"],
        )
    ).json()
    assert relue["archived_at"] is not None
    assert relue["duration_minutes"] == 60

    # La liste de travail ne porte que la neuve.
    liste = (
        await client.get(f"{PREFIX}/business/{salon}/catalog-items", headers=gerant["headers"])
    ).json()
    identifiants = [i["id"] for i in liste]
    assert nouvelle["id"] in identifiants
    assert ancienne["id"] not in identifiants


async def test_une_archive_cesse_d_etre_offerte(client: AsyncClient, conn: AsyncConnection) -> None:
    """Archiver ferme aussi la disponibilité, et ce n'est pas décoratif.

    Une archive laissée `is_available: true` se lirait « offerte » sur tout
    écran qui regarde cet interrupteur, et il y en a — la composition des
    offres de palier en est un.
    """
    gerant, salon = await _salon(client)
    soin = await item(client, gerant, salon)
    await reserve(conn, salon, soin["id"])

    await client.post(
        f"{PREFIX}/business/{salon}/catalog-items/{soin['id']}/archive",
        headers=gerant["headers"],
    )
    lue = (
        await client.get(
            f"{PREFIX}/business/{salon}/catalog-items/{soin['id']}", headers=gerant["headers"]
        )
    ).json()

    assert lue["archived_at"] is not None
    assert lue["is_available"] is False
    assert lue["is_effectively_available"] is False


async def test_une_archive_n_apparait_dans_aucun_fil(session) -> None:
    """La troisième moitié de la règle, et celle qui touche la créatrice.

    Le décor pose **deux** prestations dans le même salon : sans la seconde,
    un fil qui rendrait le salon vide et un fil qui l'écarte entièrement se
    ressembleraient, et le test ne dirait pas laquelle des deux règles il
    éprouve.
    """
    from app.models.enums import UserRole as Role
    from app.services import catalog as catalog_service
    from app.services.audit import Actor
    from tests.conftest import inscrire_verifie
    from tests.test_feed import ICI, commerce, createur, fil, offre

    salon = await commerce(session, longitude=ICI.longitude, latitude=ICI.latitude)
    retiree, _ = await offre(session, salon, name="Ancien forfait")
    gardee, _ = await offre(session, salon, name="Soin visage")
    createrice, _ = await createur(session)

    avant = await fil(session, createrice)
    noms_avant = {ligne.name for c in avant.commerces for ligne in c.items}
    assert {"Ancien forfait", "Soin visage"} <= noms_avant

    # Un acteur nommé : le journal refuse un administrateur sans identifiant, et
    # il a raison — « qui a archivé » est la première question qu'on posera.
    arbitre = await inscrire_verifie(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password="tourbillon-cactus-91-vermeil",
        role=Role.ADMIN,
    )
    await catalog_service.archiver(session, item=retiree, actor=Actor.from_user(arbitre))

    apres = await fil(session, createrice)
    noms_apres = {ligne.name for c in apres.commerces for ligne in c.items}
    assert "Ancien forfait" not in noms_apres
    assert "Soin visage" in noms_apres, "le salon reste dans le fil, seule l'archive en sort"
