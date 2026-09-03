"""Reporting commerce.

C'est la première chose qu'un commerçant regarde après une démonstration, et le
produit ne savait pas y répondre.

Ce qui est éprouvé ici tient en trois idées. **Ce qui est compté est ce qui a
eu lieu** : une réservation annulée n'a rien coûté, une publication soumise
n'est pas une publication acceptée. **Le taux d'honoration est nul et non zéro
quand rien n'a été servi** : zéro sur zéro n'est pas zéro, et afficher 0 % à un
commerce qui n'a encore servi personne serait un reproche pour quelque chose
qu'il n'a pas fait. **La fenêtre est celle du commerce**, pas celle du serveur.
"""

import uuid
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Booking, BusinessMember, Collaboration
from app.models.enums import BookingStatus, BusinessMemberRole, CollaborationStatus, UserRole
from app.services import availability, booking_states
from app.services import collaboration as collaboration_service
from app.services import proof as proof_service
from app.services import reporting as service
from app.services.audit import Actor
from tests.conftest import inscrire_verifie
from tests.test_booking_create import monter_le_decor, premier_creneau, reserver
from tests.test_collaboration import capture

PREFIX = get_settings().api_v1_prefix
MOT_DE_PASSE = "tourbillon-cactus-91-vermeil"


async def _membre(session: AsyncSession, business):
    membre = await inscrire_verifie(
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


async def _consommer(session: AsyncSession, decor: dict) -> Booking:
    """Réserver, confirmer, servir au comptoir.

    L'acteur est un membre du commerce, jamais le système : une transition
    automatique doit dire pourquoi elle s'est déclenchée, et une consommation
    n'est pas automatique — quelqu'un a servi quelqu'un.
    """
    booking = await reserver(session, decor, starts_at=await premier_creneau(session, decor))
    await booking_states.confirmer(session, booking=booking, creator_id=decor["createur"].id)
    await booking_states.consommer(
        session, booking=booking, actor=Actor.from_user(await _membre(session, decor["business"]))
    )
    return booking


# --------------------------------------------------------------------------


async def test_rien_ne_s_est_passe_ne_produit_pas_un_reproche(session: AsyncSession) -> None:
    """Le taux est **nul**, pas zéro. Zéro sur zéro n'est pas zéro."""
    decor = await monter_le_decor(session)

    vue = await service.pour_le_commerce(session, business=decor["business"])

    assert vue.reservations == 0
    assert vue.consommations == 0
    assert vue.taux_d_honoration is None


async def test_le_taux_est_zero_quand_on_a_servi_sans_rien_recevoir(
    session: AsyncSession,
) -> None:
    """Le pendant : le nul ne doit pas masquer un vrai zéro, qui est une
    information — le commerce a donné et n'a rien reçu."""
    decor = await monter_le_decor(session, postes=3)
    await _consommer(session, decor)

    vue = await service.pour_le_commerce(session, business=decor["business"])

    assert vue.consommations == 1
    assert vue.taux_d_honoration == 0.0


async def test_une_publication_approuvee_compte_une_soumise_non(
    session: AsyncSession,
) -> None:
    """Une publication soumise n'est pas une publication acceptée."""
    decor = await monter_le_decor(session, postes=3)
    booking = await _consommer(session, decor)

    contrepartie = await session.scalar(
        sa.select(Collaboration).where(Collaboration.booking_id == booking.id)
    )
    assert contrepartie is not None

    await session.execute(
        sa.update(Collaboration)
        .where(Collaboration.id == contrepartie.id)
        .values(status=CollaborationStatus.SUBMITTED)
    )
    await session.flush()
    soumise = await service.pour_le_commerce(session, business=decor["business"])
    assert soumise.publications == 0
    assert soumise.publications_attendues == 1

    await session.execute(
        sa.update(Collaboration)
        .where(Collaboration.id == contrepartie.id)
        .values(status=CollaborationStatus.APPROVED, approved_at=datetime.now(UTC))
    )
    await session.flush()
    approuvee = await service.pour_le_commerce(session, business=decor["business"])
    assert approuvee.publications == 1
    assert approuvee.publications_attendues == 0
    assert approuvee.taux_d_honoration == 1.0


async def test_les_publications_se_repartissent_par_semaine(session: AsyncSession) -> None:
    """Un total ne dit pas s'il a été atteint régulièrement ou d'un seul coup.

    Deux publications la même semaine et une la semaine précédente donnent le
    même « 3 » qu'une par semaine sur trois semaines. C'est précisément ce que
    le graphique montre, et ce qu'aucun compteur ne peut dire.

    La semaine est celle du **fuseau du commerce** : groupée en UTC, une
    publication d'un dimanche soir à Miami tomberait dans la semaine suivante,
    où il est déjà lundi à Greenwich.
    """
    decor = await monter_le_decor(session, postes=3)

    # Trois publications approuvées : deux la même semaine, une trois semaines
    # plus tôt. Les instants sont posés à la main — aucun service ne sait
    # remonter le temps, et attendre trois semaines n'est pas une option.
    instants = [
        datetime(2026, 8, 5, 15, 0, tzinfo=UTC),
        # **Le cas qui discrimine.** 3 h UTC le lundi 10, c'est 23 h à Miami le
        # dimanche 9 : la semaine locale est encore celle du 3. Groupée en UTC,
        # cette publication basculerait dans la semaine du 10 — et le graphique
        # montrerait une barre là où le salon n'a rien fait.
        datetime(2026, 8, 10, 3, 0, tzinfo=UTC),
        datetime(2026, 7, 15, 15, 0, tzinfo=UTC),
    ]
    for instant in instants:
        booking = await _consommer(session, decor)
        await session.execute(
            sa.update(Collaboration)
            .where(Collaboration.booking_id == booking.id)
            .values(status=CollaborationStatus.APPROVED, approved_at=instant)
        )
    await session.flush()

    rapport = await service.pour_le_commerce(session, business=decor["business"])

    assert rapport.publications == 3
    par_semaine = {ligne.debut: ligne.publications for ligne in rapport.par_semaine}
    assert par_semaine == {date(2026, 8, 3): 2, date(2026, 7, 13): 1}

    # Et l'ordre est chronologique : un graphique dont les barres arrivent dans
    # l'ordre de la base ne raconte aucune évolution.
    assert [ligne.debut for ligne in rapport.par_semaine] == sorted(par_semaine)


async def test_la_valeur_offerte_ne_compte_que_le_consomme(session: AsyncSession) -> None:
    """Une réservation annulée n'a rien coûté au commerce.

    La compter gonflerait ce qu'il croit avoir donné, et fausserait la seule
    mise en regard qu'il a : tant de publications pour tant de prestations.
    """
    decor = await monter_le_decor(session, postes=5)
    await _consommer(session, decor)

    # Une seconde, annulée : elle existe, elle ne coûte rien.
    annulee = await reserver(session, decor, starts_at=await premier_creneau(session, decor))
    await session.execute(
        sa.update(Booking).where(Booking.id == annulee.id).values(status=BookingStatus.CANCELLED)
    )
    await session.flush()

    vue = await service.pour_le_commerce(session, business=decor["business"])

    assert vue.reservations == 2
    assert vue.annulations == 1
    # 8000 centimes : le prix de l'item du décor, une seule fois.
    assert vue.valeur_offerte_cents == 8000


async def test_les_absences_se_comptent_a_part(session: AsyncSession) -> None:
    """Une absence n'est pas une non-honoration : la prestation n'a pas été
    donnée, rien n'a été perdu qu'un créneau."""
    decor = await monter_le_decor(session, postes=3)
    booking = await reserver(session, decor, starts_at=await premier_creneau(session, decor))
    await session.execute(
        sa.update(Booking).where(Booking.id == booking.id).values(status=BookingStatus.NO_SHOW)
    )
    await session.flush()

    vue = await service.pour_le_commerce(session, business=decor["business"])

    assert vue.absences == 1
    assert vue.non_honorees == 0
    assert vue.valeur_offerte_cents == 0


async def test_la_fenetre_se_decoupe_dans_le_fuseau_du_commerce(
    session: AsyncSession,
) -> None:
    decor = await monter_le_decor(session)
    fuseau = ZoneInfo("America/New_York")
    jour = datetime.now(fuseau).date()

    vue = await service.pour_le_commerce(
        session, business=decor["business"], depuis=jour, jusqu_a=jour
    )

    assert vue.timezone == "America/New_York"
    assert vue.debut.astimezone(fuseau).hour == 0
    # Bornes inclusives : « du 1er au 1er » couvre une journée entière.
    assert vue.fin - vue.debut == timedelta(days=1)
    # Le pendant : minuit UTC n'est pas minuit à Miami.
    assert vue.debut != datetime(jour.year, jour.month, jour.day, tzinfo=UTC)


async def test_la_fenetre_ecarte_ce_qui_est_hors_bornes(session: AsyncSession) -> None:
    decor = await monter_le_decor(session, postes=3)
    await _consommer(session, decor)

    hier = datetime.now(ZoneInfo("America/New_York")).date() - timedelta(days=1)
    vue = await service.pour_le_commerce(
        session, business=decor["business"], depuis=hier - timedelta(days=5), jusqu_a=hier
    )

    assert vue.reservations == 0


async def test_le_detail_par_item_dit_ce_qui_part(session: AsyncSession) -> None:
    """La lecture qui change une décision : composer davantage de ce qui part."""
    decor = await monter_le_decor(session, postes=3)
    await _consommer(session, decor)

    vue = await service.pour_le_commerce(session, business=decor["business"])

    assert len(vue.par_item) == 1
    ligne = vue.par_item[0]
    assert ligne.name == "Soin visage"
    assert (ligne.reservations, ligne.consommations) == (1, 1)


async def test_le_reporting_est_isole_entre_commerces(
    client: AsyncClient, session: AsyncSession
) -> None:
    a = await monter_le_decor(session, postes=3)
    b = await monter_le_decor(session, postes=3)
    await _consommer(session, a)
    membre_de_b = await _membre(session, b["business"])
    await session.commit()

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login",
            json={"email": membre_de_b.email, "password": MOT_DE_PASSE},
        )
    ).json()
    entetes = {"Authorization": f"Bearer {jetons['access_token']}"}

    refuse = await client.get(f"{PREFIX}/business/{a['business'].id}/reporting", headers=entetes)
    assert refuse.status_code == 403
    assert refuse.json()["detail"] == "not_a_member"

    # Le pendant : sur son propre commerce, la requête passe et ne voit rien du
    # voisin.
    accepte = await client.get(f"{PREFIX}/business/{b['business'].id}/reporting", headers=entetes)
    assert accepte.status_code == 200, accepte.text
    assert accepte.json()["reservations"] == 0


# --------------------------------------------------------------------------
# La clôture ne retire rien de ce que le salon a donné
# --------------------------------------------------------------------------


class TestUneReservationCloseResteUnePrestationServie:
    """`consumed` n'est plus le seul état d'une prestation livrée.

    **Le risque que cette classe couvre est silencieux, et c'est le pire.** Huit
    requêtes du rapport écrivaient `status == CONSUMED` pour dire « le salon a
    donné cette prestation ». Depuis qu'une réservation sort de `consumed` quand
    sa publication est tranchée, cette égalité fait **disparaître du rapport
    chaque échange qui se termine** : le salon voit fondre ce qu'il croit avoir
    donné, sans erreur nulle part, au fur et à mesure que ses dossiers se
    ferment. Un chiffre juste hier et faux aujourd'hui, que rien ne signale.

    Vérifié par mutation : en retirant `CLOSED` de `STATUTS_SERVIS`, les
    soixante-douze tests de rapport, de fil et de disponibilité restaient tous
    verts. Aucun ne passait par une réservation close, parce qu'aucune n'existait
    avant.
    """

    async def _servie_puis_close(self, session: AsyncSession, decor: dict) -> Booking:
        """Le parcours entier, par les services : servie, publiée, approuvée.

        Rien n'est posé à la main — surtout pas le statut. Une réservation
        marquée `closed` directement prouverait que la requête lit ce statut,
        pas que le produit y mène.
        """
        booking = await _consommer(session, decor)
        contrepartie = await session.scalar(
            sa.select(Collaboration).where(Collaboration.booking_id == booking.id)
        )
        membre = await _membre(session, decor["business"])
        await proof_service.soumettre(
            session,
            collaboration=contrepartie,
            capture=capture(),
            actor=Actor.from_user(decor["createur"]),
        )
        await collaboration_service.approuver(
            session, collaboration=contrepartie, actor=Actor.from_user(membre)
        )
        assert booking.status is BookingStatus.CLOSED
        return booking

    async def test_elle_compte_toujours_dans_les_consommations(
        self, session: AsyncSession
    ) -> None:
        decor = await monter_le_decor(session, postes=5)
        await self._servie_puis_close(session, decor)

        vue = await service.pour_le_commerce(session, business=decor["business"])

        assert vue.consommations == 1

    async def test_elle_compte_toujours_dans_la_valeur_offerte(
        self, session: AsyncSession
    ) -> None:
        """**Le chiffre qui compte le plus pour le salon.** C'est ce qu'il a
        donné ; le voir baisser parce qu'un dossier s'est bien terminé serait
        exactement le contraire de la vérité."""
        decor = await monter_le_decor(session, postes=5)
        await self._servie_puis_close(session, decor)

        vue = await service.pour_le_commerce(session, business=decor["business"])

        assert vue.valeur_offerte_cents == 8000

    async def test_le_detail_par_item_la_compte_aussi(self, session: AsyncSession) -> None:
        """Le rapport global et le détail par prestation sont deux requêtes
        distinctes : l'une corrigée et l'autre non passerait le test d'à côté."""
        decor = await monter_le_decor(session, postes=5)
        await self._servie_puis_close(session, decor)

        vue = await service.pour_le_commerce(session, business=decor["business"])

        (ligne,) = vue.par_item
        assert (ligne.reservations, ligne.consommations) == (1, 1)
        assert ligne.valeur_offerte_cents == 8000

    async def test_elle_occupe_toujours_son_creneau(self, session: AsyncSession) -> None:
        """**Sinon la place se revend.** Une réservation servie tient son
        créneau ; l'en retirer parce que sa publication a été acceptée rouvrirait
        à la réservation des heures déjà honorées."""
        assert BookingStatus.CLOSED in availability.STATUTS_OCCUPANTS
