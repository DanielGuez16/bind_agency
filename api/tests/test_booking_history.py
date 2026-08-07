"""Historique du créateur, journée du commerce.

Deux propriétés difficiles à voir à l'œil nu et faciles à casser.

Les compteurs d'onglets se comptent sur **tout** l'historique, pas sur la page :
un onglet qui annonce trois parce que la première page en contient trois ment
dès la seconde.

La journée du commerce se découpe dans **son** fuseau. Un serveur en UTC est
déjà demain quand il est 20 h à Miami ; sans conversion, la journée par défaut
sauterait chaque soir.
"""

import uuid
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Booking, BusinessMember
from app.models.enums import BookingStatus, BusinessMemberRole, UserRole
from app.services import auth as auth_service
from app.services import booking_history as service
from app.services import booking_states
from tests.test_booking_create import monter_le_decor, premier_creneau, reserver

PREFIX = get_settings().api_v1_prefix
MOT_DE_PASSE = "un-mot-de-passe-solide-42"


async def caissier(session: AsyncSession, business) -> object:
    membre = await auth_service.register(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password=MOT_DE_PASSE,
        role=UserRole.BUSINESS_MEMBER,
    )
    session.add(
        BusinessMember(business_id=business.id, user_id=membre.id, role=BusinessMemberRole.STAFF)
    )
    await session.flush()
    return membre


# --------------------------------------------------------------------------
# historique du créateur
# --------------------------------------------------------------------------


async def test_l_historique_rend_le_commerce_l_item_et_le_palier(session: AsyncSession) -> None:
    """Le palier vient de l'offre, pas de la contrepartie.

    C'est le point du test : une réservation à venir n'a pas de contrepartie, et
    passer par elle rendrait le palier nul sur exactement les lignes que le
    créateur regarde le plus.
    """
    decor = await monter_le_decor(session, postes=3)
    await reserver(session, decor, starts_at=await premier_creneau(session, decor))

    historique = await service.historique_du_createur(session, creator_id=decor["createur"].id)

    assert len(historique.items) == 1
    ligne = historique.items[0]
    assert ligne.business_name == "Salon d'essai"
    assert ligne.business_timezone == "America/New_York"
    assert ligne.item_name == "Soin visage"
    assert ligne.platform is not None
    assert ligne.content_format is not None
    assert ligne.contrepartie is None, "rien n'a été consommé"


async def test_les_compteurs_portent_sur_tout_l_historique_pas_sur_la_page(
    session: AsyncSession,
) -> None:
    # Cinq postes : les quatre réservations tiennent sur le même créneau, ce
    # que ce test n'éprouve pas — il éprouve les compteurs.
    decor = await monter_le_decor(session, postes=5)
    for _ in range(4):
        await reserver(session, decor, starts_at=await premier_creneau(session, decor))

    page = await service.historique_du_createur(session, creator_id=decor["createur"].id, limite=2)

    assert len(page.items) == 2, "la page est bien tronquée"
    assert page.compteurs[BookingStatus.HELD] == 4, "les compteurs ne le sont pas"


async def test_tous_les_statuts_sont_presents_a_zero(session: AsyncSession) -> None:
    """Un onglet vide reste un onglet.

    Rendre uniquement les statuts rencontrés obligerait l'app à connaître la
    liste pour compléter les manquants, et elle la connaîtrait mal.
    """
    decor = await monter_le_decor(session)
    historique = await service.historique_du_createur(session, creator_id=decor["createur"].id)

    assert set(historique.compteurs) == set(BookingStatus)
    assert all(valeur == 0 for valeur in historique.compteurs.values())


async def test_le_filtre_de_statut_ne_deplace_pas_les_compteurs(session: AsyncSession) -> None:
    """Un onglet ne se compte pas depuis le filtre d'un autre."""
    decor = await monter_le_decor(session, postes=3)
    booking = await reserver(session, decor, starts_at=await premier_creneau(session, decor))
    await booking_states.confirmer(session, booking=booking, creator_id=decor["createur"].id)
    await reserver(session, decor, starts_at=await premier_creneau(session, decor))

    filtre = await service.historique_du_createur(
        session,
        creator_id=decor["createur"].id,
        statuts=frozenset({BookingStatus.CONFIRMED}),
    )

    assert [i.booking_id for i in filtre.items] == [booking.id]
    assert filtre.compteurs[BookingStatus.HELD] == 1
    assert filtre.compteurs[BookingStatus.CONFIRMED] == 1


async def test_la_pagination_par_avant_ne_saute_aucune_ligne(session: AsyncSession) -> None:
    """Sur `created_at`, la colonne du tri, et non sur un décalage numérique.

    Un décalage sauterait des lignes dès qu'une réservation est prise pendant
    la lecture.
    """
    decor = await monter_le_decor(session, postes=5)
    for _ in range(3):
        await reserver(session, decor, starts_at=await premier_creneau(session, decor))

    page1 = await service.historique_du_createur(session, creator_id=decor["createur"].id, limite=2)
    page2 = await service.historique_du_createur(
        session,
        creator_id=decor["createur"].id,
        limite=2,
        avant=page1.items[-1].created_at,
    )

    vus = [i.booking_id for i in page1.items] + [i.booking_id for i in page2.items]
    assert len(set(vus)) == 3, "les trois lignes sont vues, chacune une fois"


async def test_l_historique_ne_rend_aucun_montant(session: AsyncSession) -> None:
    """La prestation, pas sa valeur. Le champ existe en base et ne sort pas."""
    decor = await monter_le_decor(session, postes=2)
    await reserver(session, decor, starts_at=await premier_creneau(session, decor))
    await session.commit()

    historique = await service.historique_du_createur(session, creator_id=decor["createur"].id)
    champs = set(historique.items[0].__slots__)

    assert "value_cents_snapshot" not in champs
    assert not any("cents" in champ or "price" in champ for champ in champs)


async def test_un_createur_ne_voit_que_ses_reservations(session: AsyncSession) -> None:
    a = await monter_le_decor(session, postes=3)
    b = await monter_le_decor(session, postes=3)
    await reserver(session, a, starts_at=await premier_creneau(session, a))
    await reserver(session, b, starts_at=await premier_creneau(session, b))

    historique = await service.historique_du_createur(session, creator_id=a["createur"].id)

    assert len(historique.items) == 1
    assert historique.items[0].business_id == a["business"].id


# --------------------------------------------------------------------------
# journée du commerce
# --------------------------------------------------------------------------


async def test_la_journee_se_decoupe_dans_le_fuseau_du_commerce(session: AsyncSession) -> None:
    """La borne est minuit à Miami, pas minuit UTC.

    Le contrôle porte sur les bornes rendues : elles sont ce qui a réellement
    servi à filtrer, et une conversion fausse s'y lit directement.
    """
    decor = await monter_le_decor(session)
    fuseau = ZoneInfo("America/New_York")
    jour = datetime.now(fuseau).date()

    journee = await service.journee_du_commerce(session, business=decor["business"], jour=jour)

    assert journee.timezone == "America/New_York"
    assert journee.debut.astimezone(fuseau).hour == 0
    assert journee.fin - journee.debut == timedelta(days=1)
    # Le pendant : minuit UTC n'est pas minuit à Miami. Sans cette ligne, un
    # découpage fait sur l'horloge du serveur passerait le test.
    assert journee.debut != datetime(jour.year, jour.month, jour.day, tzinfo=UTC)


async def test_la_journee_rend_la_creatrice_et_son_compte(session: AsyncSession) -> None:
    decor = await monter_le_decor(session, postes=2)
    creneau = await premier_creneau(session, decor)
    await reserver(session, decor, starts_at=creneau)

    jour = creneau.astimezone(ZoneInfo("America/New_York")).date()
    journee = await service.journee_du_commerce(session, business=decor["business"], jour=jour)

    assert len(journee.items) == 1
    ligne = journee.items[0]
    assert ligne.creator_first_name == "Rebecca"
    assert ligne.creator_handle == "rebecca.miami"
    assert ligne.item_name == "Soin visage"


async def test_un_droit_sans_creneau_figure_dans_la_journee(session: AsyncSession) -> None:
    """Il se présente au comptoir ce jour-là comme les autres.

    L'omettre ferait arriver quelqu'un qui n'est sur aucune liste.
    """
    decor = await monter_le_decor(session, requires_booking=False)
    booking = await reserver(session, decor, starts_at=None)
    assert booking.starts_at is None

    jour = datetime.now(ZoneInfo("America/New_York")).date()
    journee = await service.journee_du_commerce(session, business=decor["business"], jour=jour)

    assert [i.booking_id for i in journee.items] == [booking.id]


async def test_la_journee_ecarte_les_autres_jours(session: AsyncSession) -> None:
    decor = await monter_le_decor(session, postes=2)
    creneau = await premier_creneau(session, decor)
    await reserver(session, decor, starts_at=creneau)

    fuseau = ZoneInfo("America/New_York")
    jour = creneau.astimezone(fuseau).date()

    assert (
        await service.journee_du_commerce(session, business=decor["business"], jour=jour)
    ).items, "le jour du créneau la contient"
    veille = await service.journee_du_commerce(
        session, business=decor["business"], jour=jour - timedelta(days=1)
    )
    assert veille.items == (), "la veille ne la contient pas"


async def test_la_journee_est_isolee_entre_commerces(
    client: AsyncClient, session: AsyncSession
) -> None:
    """L'isolation est vérifiée sur la route, où le résolveur s'applique."""
    a = await monter_le_decor(session, postes=2)
    b = await monter_le_decor(session, postes=2)
    await reserver(session, a, starts_at=await premier_creneau(session, a))
    membre_de_b = await caissier(session, b["business"])
    await session.commit()

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login",
            json={"email": membre_de_b.email, "password": MOT_DE_PASSE},
        )
    ).json()
    entetes = {"Authorization": f"Bearer {jetons['access_token']}"}

    refuse = await client.get(f"{PREFIX}/business/{a['business'].id}/bookings", headers=entetes)
    assert refuse.status_code == 403
    assert refuse.json()["detail"] == "not_a_member"

    # Le pendant : sur son propre commerce, la même requête passe. Sans lui,
    # une route cassée passerait le test d'isolation en refusant tout.
    accepte = await client.get(f"{PREFIX}/business/{b['business'].id}/bookings", headers=entetes)
    assert accepte.status_code == 200, accepte.text
    assert accepte.json()["timezone"] == "America/New_York"


async def test_le_jour_par_defaut_est_celui_du_commerce(session: AsyncSession) -> None:
    """Pas celui du serveur.

    Le test vaut surtout entre 20 h et minuit à Miami, où les deux dates
    diffèrent. Il vérifie l'égalité avec la date locale, ce qui est faux dès
    qu'on retombe sur `datetime.now(UTC).date()`.
    """
    decor = await monter_le_decor(session)
    attendu = datetime.now(ZoneInfo("America/New_York")).date()

    assert service.aujourd_hui(decor["business"]) == attendu


async def test_une_reservation_annulee_reste_dans_la_journee(session: AsyncSession) -> None:
    """Le comptoir doit voir qu'une place s'est libérée, pas voir un trou.

    La masquer ferait disparaître de l'écran une ligne dont quelqu'un se
    souvient, et le commerce chercherait ce qu'il a mal fait.
    """
    decor = await monter_le_decor(session, postes=2)
    creneau = await premier_creneau(session, decor)
    booking = await reserver(session, decor, starts_at=creneau)
    await session.execute(
        sa.update(Booking)
        .where(Booking.id == booking.id)
        .values(status=BookingStatus.CANCELLED, cancelled_at=datetime.now(UTC))
    )
    await session.flush()

    jour = creneau.astimezone(ZoneInfo("America/New_York")).date()
    journee = await service.journee_du_commerce(session, business=decor["business"], jour=jour)

    assert [i.status for i in journee.items] == [BookingStatus.CANCELLED]
