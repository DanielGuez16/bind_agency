"""Calcul de disponibilité à la volée.

Aucune ligne de créneau n'est matérialisée : la disponibilité est un calcul, pas
une table. Les tests portent donc sur le calcul, et sur les trois choses qui le
rendent faux si on les oublie — le fuseau du commerce, ce qui occupe réellement
une place, et l'effet d'une exception.
"""

import uuid
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.geocoding import ManualGeocoder
from app.models import Booking, CatalogItem
from app.models.enums import BookingStatus, BusinessCategory, UserRole
from app.schemas.business import BusinessCreate, CoordinatesPayload
from app.schemas.capacity import CapacityExceptionCreate, CapacityRuleCreate
from app.schemas.catalog import CatalogItemCreate
from app.services import auth as auth_service
from app.services import availability as service
from app.services import business as business_service
from app.services import capacity as capacity_service
from app.services import catalog as catalog_service
from app.services.audit import Actor

MIAMI = ZoneInfo("America/New_York")

#: Un lundi, pour que les règles hebdomadaires soient prévisibles.
LUNDI = date(2026, 9, 7)


async def commerce(session: AsyncSession, **overrides):
    proprietaire = await auth_service.register(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password="un-mot-de-passe-solide-42",
        role=UserRole.BUSINESS_MEMBER,
    )
    payload = BusinessCreate(
        name="Salon d'essai",
        category=BusinessCategory.BEAUTY,
        currency="USD",
        address="1234 Ocean Dr, Miami Beach FL",
        coordinates=CoordinatesPayload(longitude=-80.1918, latitude=25.7617),
        timezone="America/New_York",
        **overrides,
    )
    b = await business_service.create_business(
        session, payload=payload, creator=proprietaire, geocoder=ManualGeocoder()
    )
    await business_service.activate_business(
        session, business=b, actor=Actor.from_user(proprietaire)
    )
    return b


async def item(session: AsyncSession, business, *, minutes: int = 60, **overrides) -> CatalogItem:
    return await catalog_service.create_item(
        session,
        business=business,
        payload=CatalogItemCreate(
            name="Soin", price_cents=8000, duration_minutes=minutes, **overrides
        ),
    )


async def ouverture(
    session: AsyncSession,
    business,
    *,
    weekday: int = 0,
    postes: int = 1,
    debut: time = time(9, 0),
    fin: time = time(12, 0),
):
    return await capacity_service.create_rule(
        session,
        business_id=business.id,
        payload=CapacityRuleCreate(
            weekday=weekday, start_time=debut, end_time=fin, concurrent_slots=postes
        ),
    )


async def reserver(
    session: AsyncSession,
    business,
    catalog_item,
    *,
    debut: datetime,
    statut: BookingStatus = BookingStatus.CONFIRMED,
    garde: datetime | None = None,
):
    """Une réservation posée en direct : ce fichier éprouve le calcul, pas la
    création — qui a sa propre tâche et son propre verrou."""
    createur = await auth_service.register(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password="un-mot-de-passe-solide-42",
        role=UserRole.CREATOR,
    )
    from tests.factories import new_social_account, new_tier, new_tier_offer

    conn = await session.connection()
    compte = await new_social_account(conn, createur.id)
    tier = await new_tier(conn)
    # Une offre par (commerce, palier, item) : deux réservations sur le même
    # item partagent la leur.
    offre = await session.scalar(
        sa.text(
            "SELECT id FROM tier_offer WHERE business_id = :b AND tier_id = :t "
            "AND catalog_item_id = :i"
        ),
        {"b": business.id, "t": tier, "i": catalog_item.id},
    ) or await new_tier_offer(conn, business.id, tier, catalog_item.id)

    duree = catalog_item.duration_minutes
    reservation = Booking(
        creator_id=createur.id,
        business_id=business.id,
        tier_offer_id=offre,
        catalog_item_id=catalog_item.id,
        social_account_id=compte,
        requires_booking=True,
        duration_minutes=duree,
        starts_at=debut,
        ends_at=debut + timedelta(minutes=duree),
        valid_until=debut + timedelta(days=1),
        status=statut,
        hold_expires_at=garde,
        value_cents_snapshot=8000,
    )
    session.add(reservation)
    await session.flush()
    return reservation


async def acteur(session: AsyncSession) -> Actor:
    """Un membre de commerce quelconque : la bascule de disponibilité est un
    geste humain, le journal exige de dire qui."""
    user = await auth_service.register(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password="un-mot-de-passe-solide-42",
        role=UserRole.BUSINESS_MEMBER,
    )
    return Actor.from_user(user)


def lundi_a(heure: int, minute: int = 0) -> datetime:
    """Un instant, exprimé depuis l'heure locale du commerce."""
    return datetime.combine(LUNDI, time(heure, minute), tzinfo=MIAMI).astimezone(UTC)


async def creneaux(session, business, catalog_item, *, depuis=None, jours: int = 1):
    return await service.creneaux_libres(
        session,
        business_id=business.id,
        catalog_item_id=catalog_item.id,
        depuis=depuis or lundi_a(0),
        horizon=timedelta(days=jours),
    )


# --------------------------------------------------------------------------
# le calcul de base
# --------------------------------------------------------------------------


async def test_les_creneaux_suivent_les_horaires_et_la_duree(session: AsyncSession) -> None:
    b = await commerce(session)
    soin = await item(session, b, minutes=60)
    await ouverture(session, b, debut=time(9, 0), fin=time(12, 0))

    libres = await creneaux(session, b, soin)

    # 9h00 à 11h00 par pas de quinze minutes : le dernier départ possible est
    # 11h00, puisqu'un soin d'une heure doit finir avant la fermeture.
    debuts = [c.starts_at.astimezone(MIAMI).strftime("%H:%M") for c in libres]
    assert debuts == [
        "09:00",
        "09:15",
        "09:30",
        "09:45",
        "10:00",
        "10:15",
        "10:30",
        "10:45",
        "11:00",
    ]
    assert all(c.ends_at - c.starts_at == timedelta(minutes=60) for c in libres)


async def test_un_soin_plus_long_reduit_le_nombre_de_departs(session: AsyncSession) -> None:
    """Le pendant du précédent : la durée entre bien dans le calcul."""
    b = await commerce(session)
    long = await item(session, b, minutes=180)
    await ouverture(session, b, debut=time(9, 0), fin=time(12, 0))

    libres = await creneaux(session, b, long)

    assert [c.starts_at.astimezone(MIAMI).strftime("%H:%M") for c in libres] == ["09:00"]


async def test_plusieurs_plages_dans_la_journee(session: AsyncSession) -> None:
    """Un commerce ferme le midi. Les deux plages produisent leurs créneaux, et
    rien entre les deux."""
    b = await commerce(session)
    soin = await item(session, b, minutes=60)
    await ouverture(session, b, debut=time(9, 0), fin=time(12, 0))
    await ouverture(session, b, debut=time(14, 0), fin=time(17, 0))

    heures = {c.starts_at.astimezone(MIAMI).hour for c in await creneaux(session, b, soin)}

    assert 9 in heures and 14 in heures
    assert 12 not in heures and 13 not in heures


async def test_un_jour_sans_regle_ne_produit_rien(session: AsyncSession) -> None:
    b = await commerce(session)
    soin = await item(session, b, minutes=60)
    await ouverture(session, b, weekday=0)  # lundi seulement

    mardi = await creneaux(session, b, soin, depuis=lundi_a(0) + timedelta(days=1))

    assert mardi == []


# --------------------------------------------------------------------------
# ce qui occupe une place
# --------------------------------------------------------------------------


async def test_une_reservation_confirmee_retire_le_chevauchement(session: AsyncSession) -> None:
    b = await commerce(session)
    soin = await item(session, b, minutes=60)
    await ouverture(session, b, postes=1, debut=time(9, 0), fin=time(12, 0))

    await reserver(session, b, soin, debut=lundi_a(10))

    debuts = {
        c.starts_at.astimezone(MIAMI).strftime("%H:%M") for c in await creneaux(session, b, soin)
    }

    # Tout ce qui recoupe [10h, 11h) tombe : de 9h15 à 10h45 inclus.
    assert "09:00" in debuts
    assert not ({"09:15", "09:30", "09:45", "10:00", "10:15", "10:30", "10:45"} & debuts)
    assert "11:00" in debuts


async def test_les_postes_multiples_laissent_de_la_place(session: AsyncSession) -> None:
    b = await commerce(session)
    soin = await item(session, b, minutes=60)
    await ouverture(session, b, postes=2, debut=time(9, 0), fin=time(12, 0))

    await reserver(session, b, soin, debut=lundi_a(10))

    libres = {
        c.starts_at.astimezone(MIAMI).strftime("%H:%M"): c for c in await creneaux(session, b, soin)
    }

    assert "10:00" in libres
    # Et le compte de places restantes le dit : une prise sur deux.
    assert libres["10:00"].places_restantes == 1
    assert libres["09:00"].places_restantes == 2


async def test_la_derniere_place_disparait(session: AsyncSession) -> None:
    b = await commerce(session)
    soin = await item(session, b, minutes=60)
    await ouverture(session, b, postes=2, debut=time(9, 0), fin=time(12, 0))

    await reserver(session, b, soin, debut=lundi_a(10))
    await reserver(session, b, soin, debut=lundi_a(10))

    debuts = {
        c.starts_at.astimezone(MIAMI).strftime("%H:%M") for c in await creneaux(session, b, soin)
    }
    assert "10:00" not in debuts


@pytest.mark.parametrize(
    "statut", [BookingStatus.CANCELLED, BookingStatus.EXPIRED, BookingStatus.NO_SHOW]
)
async def test_une_reservation_rendue_libere_la_place(
    statut: BookingStatus, session: AsyncSession
) -> None:
    """La place est rendue. Compter ces statuts ferait disparaître des créneaux
    que personne n'occupe."""
    b = await commerce(session)
    soin = await item(session, b, minutes=60)
    await ouverture(session, b, postes=1, debut=time(9, 0), fin=time(12, 0))

    await reserver(session, b, soin, debut=lundi_a(10), statut=statut)

    debuts = {
        c.starts_at.astimezone(MIAMI).strftime("%H:%M") for c in await creneaux(session, b, soin)
    }
    assert "10:00" in debuts


async def test_un_garde_encore_valide_occupe_la_place(session: AsyncSession) -> None:
    b = await commerce(session)
    soin = await item(session, b, minutes=60)
    await ouverture(session, b, postes=1, debut=time(9, 0), fin=time(12, 0))

    await reserver(
        session,
        b,
        soin,
        debut=lundi_a(10),
        statut=BookingStatus.HELD,
        garde=datetime.now(UTC) + timedelta(minutes=10),
    )

    debuts = {
        c.starts_at.astimezone(MIAMI).strftime("%H:%M") for c in await creneaux(session, b, soin)
    }
    # C'est tout l'intérêt du garde : sans cela la place serait vendue deux fois
    # pendant les dix minutes du parcours.
    assert "10:00" not in debuts


async def test_un_garde_expire_libere_la_place_sans_attendre_le_job(
    session: AsyncSession,
) -> None:
    """S'appuyer sur le seul statut ferait tenir la place d'une réservation
    abandonnée jusqu'au prochain balayage."""
    b = await commerce(session)
    soin = await item(session, b, minutes=60)
    await ouverture(session, b, postes=1, debut=time(9, 0), fin=time(12, 0))

    await reserver(
        session,
        b,
        soin,
        debut=lundi_a(10),
        statut=BookingStatus.HELD,
        garde=datetime.now(UTC) - timedelta(minutes=1),
    )

    debuts = {
        c.starts_at.astimezone(MIAMI).strftime("%H:%M") for c in await creneaux(session, b, soin)
    }
    assert "10:00" in debuts


async def test_une_reservation_d_un_autre_commerce_n_occupe_rien(session: AsyncSession) -> None:
    a = await commerce(session)
    autre = await commerce(session)
    soin_a = await item(session, a, minutes=60)
    soin_b = await item(session, autre, minutes=60)
    await ouverture(session, a, postes=1, debut=time(9, 0), fin=time(12, 0))
    await ouverture(session, autre, postes=1, debut=time(9, 0), fin=time(12, 0))

    await reserver(session, autre, soin_b, debut=lundi_a(10))

    debuts = {
        c.starts_at.astimezone(MIAMI).strftime("%H:%M") for c in await creneaux(session, a, soin_a)
    }
    assert "10:00" in debuts


# --------------------------------------------------------------------------
# exceptions
# --------------------------------------------------------------------------


async def test_une_fermeture_exceptionnelle_vide_la_journee(session: AsyncSession) -> None:
    b = await commerce(session)
    soin = await item(session, b, minutes=60)
    await ouverture(session, b, debut=time(9, 0), fin=time(12, 0))
    await capacity_service.create_exception(
        session, business_id=b.id, payload=CapacityExceptionCreate(date=LUNDI)
    )

    assert await creneaux(session, b, soin) == []


async def test_une_journee_amenagee_remplace_la_regle(session: AsyncSession) -> None:
    """Elle ne s'y ajoute pas : sinon il faudrait deviner ce qui de la règle
    survit."""
    b = await commerce(session)
    soin = await item(session, b, minutes=60)
    await ouverture(session, b, debut=time(9, 0), fin=time(12, 0))
    await capacity_service.create_exception(
        session,
        business_id=b.id,
        payload=CapacityExceptionCreate(
            date=LUNDI, start_time=time(14, 0), end_time=time(16, 0), concurrent_slots=3
        ),
    )

    libres = await creneaux(session, b, soin)
    heures = {c.starts_at.astimezone(MIAMI).hour for c in libres}

    assert heures == {14, 15}
    assert all(c.places_restantes == 3 for c in libres)


# --------------------------------------------------------------------------
# ce qui n'a pas de créneaux du tout
# --------------------------------------------------------------------------


async def test_un_item_non_reservable_est_refuse(session: AsyncSession) -> None:
    """Il n'a pas de créneaux, il a une fenêtre de validité. Rendre une liste
    vide laisserait croire qu'il est complet."""
    b = await commerce(session)
    libre = await item(session, b, minutes=None, requires_booking=False)
    await ouverture(session, b)

    with pytest.raises(service.ItemNotBookable):
        await creneaux(session, b, libre)


async def test_un_item_desactive_ne_produit_aucun_creneau(session: AsyncSession) -> None:
    b = await commerce(session)
    soin = await item(session, b, minutes=60)
    await ouverture(session, b)

    # Par le service, pas par un UPDATE : c'est lui qui porte la bascule, et
    # il laisse la session cohérente.
    await capacity_service.set_availability(
        session, item=soin, is_available=False, actor=await acteur(session)
    )

    assert await creneaux(session, b, soin) == []


async def test_un_parent_desactive_ferme_ses_variantes(session: AsyncSession) -> None:
    """L'état n'est pas recopié sur les enfants, il est calculé : deux copies
    d'une même vérité finissent par diverger."""
    b = await commerce(session)
    parent = await catalog_service.create_item(
        session,
        business=b,
        payload=CatalogItemCreate(name="Coupe", price_cents=0, requires_booking=False),
    )
    variante = await item(session, b, minutes=60, parent_item_id=parent.id)
    await ouverture(session, b)

    assert await creneaux(session, b, variante)

    await capacity_service.set_availability(
        session, item=parent, is_available=False, actor=await acteur(session)
    )

    assert await creneaux(session, b, variante) == []


async def test_un_item_d_un_autre_commerce_est_introuvable(session: AsyncSession) -> None:
    a = await commerce(session)
    autre = await commerce(session)
    soin = await item(session, autre, minutes=60)

    with pytest.raises(service.ItemNotFound):
        await creneaux(session, a, soin)


# --------------------------------------------------------------------------
# le fuseau
# --------------------------------------------------------------------------


async def test_les_horaires_sont_locaux_et_resistent_au_changement_d_heure(
    session: AsyncSession,
) -> None:
    """Un commerce ouvre à neuf heures des deux côtés du changement d'heure.

    Sans conversion au calcul, l'ouverture glisserait d'une heure deux fois par
    an, et le commerce recevrait des créneaux qu'il n'a jamais ouverts.
    """
    b = await commerce(session)
    soin = await item(session, b, minutes=60)
    # Dimanche : le changement d'heure américain tombe un dimanche de novembre.
    await ouverture(session, b, weekday=6, debut=time(9, 0), fin=time(11, 0))

    avant = datetime.combine(date(2026, 10, 25), time(0, 0), tzinfo=MIAMI).astimezone(UTC)
    apres = datetime.combine(date(2026, 11, 8), time(0, 0), tzinfo=MIAMI).astimezone(UTC)

    premiers = await creneaux(session, b, soin, depuis=avant)
    seconds = await creneaux(session, b, soin, depuis=apres)

    assert premiers and seconds
    assert premiers[0].starts_at.astimezone(MIAMI).hour == 9
    assert seconds[0].starts_at.astimezone(MIAMI).hour == 9
    # Et les instants absolus diffèrent bien d'une heure : c'est la preuve que
    # la conversion a lieu, et qu'on ne compare pas deux heures locales.
    assert premiers[0].starts_at.hour != seconds[0].starts_at.hour


async def test_un_creneau_deja_commence_n_est_pas_propose(session: AsyncSession) -> None:
    b = await commerce(session)
    soin = await item(session, b, minutes=60)
    await ouverture(session, b, debut=time(9, 0), fin=time(12, 0))

    libres = await creneaux(session, b, soin, depuis=lundi_a(10, 30))

    debuts = [c.starts_at.astimezone(MIAMI).strftime("%H:%M") for c in libres]
    assert debuts == ["10:30", "10:45", "11:00"]


class _CompteurDeRequetes:
    """Compte les requêtes SQL réellement parties, sur le moteur de la session.

    **Sur le moteur et non sur la session** : c'est là que passe chaque curseur,
    y compris ceux qu'un `flush` implicite déclenche. Compter ailleurs
    laisserait passer exactement les lectures qu'on cherche à supprimer.
    """

    def __init__(self, session: AsyncSession) -> None:
        # La session de test est liée à une connexion synchrone : son moteur
        # est déjà celui sur lequel les événements se posent.
        self._moteur = session.get_bind().engine
        self.total = 0

    def _noter(self, *_args, **_kwargs) -> None:
        self.total += 1

    def remettre(self) -> None:
        self.total = 0

    def __enter__(self) -> "_CompteurDeRequetes":
        sa.event.listen(self._moteur, "before_cursor_execute", self._noter)
        return self

    def __exit__(self, *_exc) -> None:
        sa.event.remove(self._moteur, "before_cursor_execute", self._noter)


# --------------------------------------------------------------------------
# la vérification groupée
# --------------------------------------------------------------------------


class TestLaVerificationGroupee:
    """`couples_avec_creneau` : une requête pour tout l'ensemble.

    **Ce que ça répare.** Le fil vérifiait la disponibilité couple par couple :
    dix-neuf salons coûtaient **cent vingt et une requêtes**, dont l'essentiel
    n'était que six lectures répétées vingt fois. Après groupement : neuf.

    **Le test central est l'accord avec `creneaux_libres`.** Une seconde
    implémentation du calcul de disponibilité divergerait de la première au
    premier changement, et c'est la divergence qu'on ne verrait pas : les deux
    répondraient, l'une aurait tort. On compare donc les deux verdicts sur les
    mêmes données, cas par cas.
    """

    async def _verdicts_concordent(self, session: AsyncSession, couples) -> None:
        """Les deux implémentations disent la même chose sur chaque couple."""
        groupe = await service.couples_avec_creneau(session, couples)
        for business_id, item_id in couples:
            try:
                un_par_un = bool(
                    await service.creneaux_libres(
                        session, business_id=business_id, catalog_item_id=item_id, limite=1
                    )
                )
            except (service.ItemNotBookable, service.ItemNotFound):
                un_par_un = False
            assert ((business_id, item_id) in groupe) is un_par_un, (
                f"désaccord sur {business_id}/{item_id} : "
                f"groupé={((business_id, item_id) in groupe)}, un par un={un_par_un}"
            )

    async def test_elle_accorde_avec_le_calcul_un_par_un(self, session: AsyncSession) -> None:
        """Deux commerces, quatre items, des situations différentes."""
        ouvert = await commerce(session)
        for jour in range(7):
            await ouverture(session, ouvert, weekday=jour)
        libre = await item(session, ouvert)
        long_ = await item(session, ouvert, minutes=600)

        ferme = await commerce(session)
        sans_horaire = await item(session, ferme)

        await self._verdicts_concordent(
            session,
            [
                (ouvert.id, libre.id),
                (ouvert.id, long_.id),
                (ferme.id, sans_horaire.id),
            ],
        )

    async def test_elle_accorde_quand_un_item_est_desactive(self, session: AsyncSession) -> None:
        """`is_available` du parent désactive ses variantes sans le dupliquer :
        le groupement doit lire l'état du parent comme le fait le calcul un par
        un, sinon il propose une variante d'une gamme retirée."""
        b = await commerce(session)
        for jour in range(7):
            await ouverture(session, b, weekday=jour)
        parent = await catalog_service.create_item(
            session,
            business=b,
            payload=CatalogItemCreate(name="Gamme", price_cents=0, requires_booking=False),
        )
        variante = await item(session, b, parent_item_id=parent.id)
        seul = await item(session, b)

        parent.is_available = False
        await session.flush()

        await self._verdicts_concordent(session, [(b.id, variante.id), (b.id, seul.id)])
        # Et le sens du verdict, pas seulement son accord : la variante est
        # écartée, l'item indépendant reste.
        groupe = await service.couples_avec_creneau(session, [(b.id, variante.id), (b.id, seul.id)])
        assert (b.id, variante.id) not in groupe
        assert (b.id, seul.id) in groupe

    async def test_elle_ne_lit_pas_la_base_par_couple(self, session: AsyncSession) -> None:
        """**Le cœur du changement, et il se mesure.** Le nombre de requêtes ne
        doit pas dépendre du nombre de couples : c'est exactement ce qui faisait
        cent vingt et une requêtes pour dix-neuf salons."""
        b = await commerce(session)
        for jour in range(7):
            await ouverture(session, b, weekday=jour, postes=4)
        items = [await item(session, b) for _ in range(6)]
        couples = [(b.id, i.id) for i in items]

        await session.flush()
        compte = _CompteurDeRequetes(session)

        with compte:
            await service.couples_avec_creneau(session, couples[:1])
        pour_un = compte.total

        compte.remettre()
        with compte:
            await service.couples_avec_creneau(session, couples)
        pour_six = compte.total

        assert pour_six == pour_un, (
            f"six couples ont coûté {pour_six} requêtes contre {pour_un} pour un seul : "
            "la lecture n'est pas groupée"
        )

    async def test_un_ensemble_vide_ne_lit_rien(self, session: AsyncSession) -> None:
        """L'autre sens : sans couple, aucune requête et aucun résultat. Une
        version qui interrogerait quand même paierait le fil vide, qui est
        précisément celui qu'on veut rapide."""
        compte = _CompteurDeRequetes(session)
        with compte:
            assert await service.couples_avec_creneau(session, []) == set()
        assert compte.total == 0
