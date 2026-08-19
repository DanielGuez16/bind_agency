"""Création de réservation.

Le test qui compte est celui de la concurrence : deux réservations simultanées
sur la dernière place, une seule qui passe. Il ne se joue pas sur la transaction
partagée des autres tests — il lui faut deux connexions réelles, sinon le verrou
consultatif n'a rien à sérialiser et le test passerait sans rien prouver.

Le reste porte sur ce qui doit être refusé avant même d'atteindre le verrou.
"""

import asyncio
import uuid
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.integrations.geocoding import ManualGeocoder
from app.models import AuditLog, Booking, SocialAccount, TierOffer
from app.models.enums import (
    ActorKind,
    BookingStatus,
    BusinessCategory,
    Platform,
    SocialAccountStatus,
    UserRole,
    VerificationStatus,
)
from app.schemas.business import BusinessCreate, CoordinatesPayload
from app.schemas.capacity import CapacityRuleCreate
from app.schemas.catalog import CatalogItemCreate
from app.schemas.tier_offers import TierOfferCreate
from app.services import auth as auth_service
from app.services import availability as availability_service
from app.services import booking as service
from app.services import business as business_service
from app.services import capacity as capacity_service
from app.services import catalog as catalog_service
from app.services import creator_profile as profile_service
from app.services import metrics as metrics_service
from app.services import tier_offers as tier_offer_service
from app.services.audit import Actor
from tests.test_social_metrics import FauxFournisseur, metriques

MIAMI = ZoneInfo("America/New_York")
STORY = uuid.UUID("8f9bfcd8-39ff-41a3-9b6b-f00e40f8774d")
REEL = uuid.UUID("a839969b-3965-4c7e-92b1-b6274f899162")


# --------------------------------------------------------------------------
# harnais
# --------------------------------------------------------------------------


async def monter_le_decor(
    session: AsyncSession,
    *,
    postes: int = 1,
    tier_id: uuid.UUID = STORY,
    requires_booking: bool = True,
    followers: int = 24_000,
    avec_nom: bool = True,
    requires_booking_approval: bool = False,
) -> dict:
    """Un commerce ouvert, un item offert, un créateur éligible."""
    proprietaire = await auth_service.register(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password="tourbillon-cactus-91-vermeil",
        role=UserRole.BUSINESS_MEMBER,
    )
    business = await business_service.create_business(
        session,
        payload=BusinessCreate(
            name="Salon d'essai",
            category=BusinessCategory.BEAUTY,
            currency="USD",
            address="1234 Ocean Dr",
            coordinates=CoordinatesPayload(longitude=-80.1918, latitude=25.7617),
            timezone="America/New_York",
        ),
        creator=proprietaire,
        geocoder=ManualGeocoder(),
    )
    # **Validation du commerce désactivée par défaut dans ce décor.** Le
    # produit la met à vrai, et c'est bien ce qu'on veut : donner une prestation
    # à quelqu'un qu'on n'a pas regardé demande un accord explicite. Mais la
    # plupart des tests qui montent ce décor éprouvent ce qui se passe *après*
    # la confirmation — code, consommation, contrepartie — et les faire tous
    # passer par un accord du commerce n'éprouverait rien de plus.
    #
    # Le chemin avec validation est éprouvé pour lui-même, dans les deux sens,
    # et ce décor l'active sur demande.
    business.requires_booking_approval = requires_booking_approval
    await session.flush()

    await business_service.activate_business(
        session, business=business, actor=Actor.from_user(proprietaire)
    )
    for jour in range(7):
        await capacity_service.create_rule(
            session,
            business_id=business.id,
            payload=CapacityRuleCreate(
                weekday=jour, start_time=time(8, 0), end_time=time(20, 0), concurrent_slots=postes
            ),
        )

    item = await catalog_service.create_item(
        session,
        business=business,
        payload=CatalogItemCreate(
            name="Soin visage",
            price_cents=8000,
            duration_minutes=60 if requires_booking else None,
            requires_booking=requires_booking,
        ),
    )
    offre = await tier_offer_service.create_offer(
        session,
        business_id=business.id,
        payload=TierOfferCreate(tier_id=tier_id, catalog_item_id=item.id),
    )

    createur = await auth_service.register(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password="tourbillon-cactus-91-vermeil",
        role=UserRole.CREATOR,
    )
    if avec_nom:
        await profile_service.update_profile(
            session,
            user_id=createur.id,
            modifications={"first_name": "Rebecca", "last_name": "Alvarez"},
        )

    compte = SocialAccount(
        creator_id=createur.id,
        platform=Platform.INSTAGRAM,
        external_id=f"1784140{uuid.uuid4().int % 10**10}",
        handle="rebecca.miami",
        access_token_encrypted="IGQVJXY-jeton",
        status=SocialAccountStatus.ACTIVE,
        verification_status=VerificationStatus.VERIFIED,
    )
    session.add(compte)
    await session.flush()
    await metrics_service.refresh_profile_metrics(
        session,
        account=compte,
        provider=FauxFournisseur(rend=metriques(followers_count=followers, media_count=208)),
    )

    return {
        "business": business,
        # Le membre qui tranche : il faut un acteur pour l'accord du commerce
        # comme pour son annulation, et le décor le fabriquait déjà sans le
        # rendre.
        "proprietaire": proprietaire,
        "item": item,
        "offre": offre,
        "createur": createur,
        "compte": compte,
    }


async def premier_creneau(session: AsyncSession, decor: dict) -> datetime:
    creneaux = await availability_service.creneaux_libres(
        session,
        business_id=decor["business"].id,
        catalog_item_id=decor["item"].id,
        limite=1,
    )
    assert creneaux, "aucun créneau : le décor est mal monté"
    return creneaux[0].starts_at


async def reserver(session: AsyncSession, decor: dict, *, starts_at: datetime | None):
    return await service.creer(
        session,
        creator_id=decor["createur"].id,
        demande=service.DemandeDeReservation(
            tier_offer_id=decor["offre"].id,
            social_account_id=decor["compte"].id,
            starts_at=starts_at,
        ),
    )


# --------------------------------------------------------------------------
# le chemin nominal
# --------------------------------------------------------------------------


async def test_une_reservation_pose_un_held_et_fige_ce_qu_il_faut(
    session: AsyncSession,
) -> None:
    decor = await monter_le_decor(session)
    creneau = await premier_creneau(session, decor)

    reservation = await reserver(session, decor, starts_at=creneau)

    assert reservation.status is BookingStatus.HELD
    assert reservation.hold_expires_at is not None
    reste = reservation.hold_expires_at - datetime.now(UTC)
    assert timedelta(minutes=9) < reste <= timedelta(minutes=10)

    # La durée et le prix sont figés : le commerce peut changer sa carte
    # ensuite, la réservation ne bouge pas.
    assert reservation.duration_minutes == 60
    assert reservation.value_cents_snapshot == 8000
    assert reservation.ends_at == creneau + timedelta(minutes=60)
    # Le droit s'éteint avec le créneau : une réservation d'hier ne se consomme
    # pas aujourd'hui.
    assert reservation.valid_until == reservation.ends_at

    ligne = await session.scalar(sa.select(AuditLog).where(AuditLog.entity_id == reservation.id))
    assert ligne is not None
    assert ligne.to_status == BookingStatus.HELD.value
    assert ligne.actor_kind is ActorKind.CREATOR


async def test_le_creneau_reserve_disparait_de_la_disponibilite(
    session: AsyncSession,
) -> None:
    decor = await monter_le_decor(session, postes=1)
    creneau = await premier_creneau(session, decor)

    await reserver(session, decor, starts_at=creneau)

    libres = await availability_service.creneaux_libres(
        session, business_id=decor["business"].id, catalog_item_id=decor["item"].id
    )
    assert creneau not in {c.starts_at for c in libres}


async def test_un_item_sans_creneau_se_reserve_sur_une_fenetre(session: AsyncSession) -> None:
    decor = await monter_le_decor(session, requires_booking=False)

    reservation = await reserver(session, decor, starts_at=None)

    assert reservation.starts_at is None
    assert reservation.ends_at is None
    assert reservation.duration_minutes is None
    assert reservation.valid_until > datetime.now(UTC)
    assert reservation.status is BookingStatus.HELD


# --------------------------------------------------------------------------
# ce qui est refusé avant le verrou
# --------------------------------------------------------------------------


async def test_le_nom_est_exige_avant_la_premiere_reservation(session: AsyncSession) -> None:
    """Facultatif à l'inscription, obligatoire ici : le commerce reçoit
    quelqu'un et doit savoir qui."""
    decor = await monter_le_decor(session, avec_nom=False)
    creneau = await premier_creneau(session, decor)

    with pytest.raises(service.NameRequired):
        await reserver(session, decor, starts_at=creneau)

    # La session reste utilisable, et rien n'a été posé.
    assert await session.scalar(sa.select(sa.func.count()).select_from(Booking)) == 0

    # Le pendant : une fois le nom renseigné, la même demande passe.
    await profile_service.update_profile(
        session,
        user_id=decor["createur"].id,
        modifications={"first_name": "Rebecca", "last_name": "Alvarez"},
    )
    assert await reserver(session, decor, starts_at=creneau)


async def test_un_palier_inaccessible_est_refuse(session: AsyncSession) -> None:
    decor = await monter_le_decor(session, tier_id=REEL, followers=3_100)
    creneau = await premier_creneau(session, decor)

    with pytest.raises(service.TierNotAccessible):
        await reserver(session, decor, starts_at=creneau)

    assert await session.scalar(sa.select(sa.func.count()).select_from(Booking)) == 0


async def test_un_item_reservable_sans_creneau_demande_est_refuse(
    session: AsyncSession,
) -> None:
    decor = await monter_le_decor(session)

    with pytest.raises(service.SlotRequired):
        await reserver(session, decor, starts_at=None)


async def test_un_item_sans_creneau_avec_creneau_demande_est_refuse(
    session: AsyncSession,
) -> None:
    """Les deux refus sont distincts pour que l'app dise lequel s'applique."""
    decor = await monter_le_decor(session, requires_booking=False)

    with pytest.raises(service.SlotNotAllowed):
        await reserver(session, decor, starts_at=datetime.now(UTC) + timedelta(days=1))


async def test_une_offre_retiree_est_refusee(session: AsyncSession) -> None:
    decor = await monter_le_decor(session)
    creneau = await premier_creneau(session, decor)

    await session.execute(
        sa.update(TierOffer).where(TierOffer.id == decor["offre"].id).values(is_active=False)
    )
    await session.flush()

    with pytest.raises(service.OfferNotBookable):
        await reserver(session, decor, starts_at=creneau)


async def test_un_item_desactive_est_refuse(session: AsyncSession) -> None:
    decor = await monter_le_decor(session)
    creneau = await premier_creneau(session, decor)

    membre = await auth_service.register(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password="tourbillon-cactus-91-vermeil",
        role=UserRole.BUSINESS_MEMBER,
    )
    await capacity_service.set_availability(
        session, item=decor["item"], is_available=False, actor=Actor.from_user(membre)
    )

    with pytest.raises(service.OfferNotBookable):
        await reserver(session, decor, starts_at=creneau)


async def test_un_creneau_hors_ouverture_est_refuse(session: AsyncSession) -> None:
    """Le recompte ne se contente pas de compter : il vérifie que le créneau
    demandé fait bien partie des libres. Sinon un client pourrait réserver à
    trois heures du matin."""
    decor = await monter_le_decor(session)
    creneau = await premier_creneau(session, decor)

    with pytest.raises(service.SlotUnavailable):
        await reserver(
            session, decor, starts_at=creneau.replace(hour=6, minute=0, second=0, microsecond=0)
        )


async def test_un_creneau_deja_pris_est_refuse(session: AsyncSession) -> None:
    decor = await monter_le_decor(session, postes=1)
    creneau = await premier_creneau(session, decor)

    await reserver(session, decor, starts_at=creneau)

    with pytest.raises(service.SlotUnavailable):
        await reserver(session, decor, starts_at=creneau)

    assert await session.scalar(sa.select(sa.func.count()).select_from(Booking)) == 1


# --------------------------------------------------------------------------
# concurrence — le test qui compte
# --------------------------------------------------------------------------


@pytest.mark.ecrit_pour_de_bon(
    "deux transactions réellement concurrentes sur un verrou consultatif : la "
    "transaction annulée des autres tests les rendrait invisibles l'une à "
    "l'autre, et il n'y aurait plus rien à sérialiser. Le décor est retiré à la "
    "main dans le `finally` ; seuls restent les comptes, que le journal d'audit "
    "immuable retient."
)
async def test_deux_reservations_simultanees_sur_la_derniere_place(
    engine: AsyncEngine,
) -> None:
    """Deux créateurs, un poste, le même créneau, au même instant. Une seule passe.

    Le déroulé est forcé : la première transaction prend le verrou puis attend
    un signal. La seconde démarre à ce moment-là et doit se bloquer sur le même
    verrou — pas échouer, pas passer. On relâche, et c'est le **recompte** de la
    seconde, exécuté après l'obtention du verrou, qui la refuse.

    Sans le verrou, les deux recomptes verraient la place libre en même temps et
    les deux réservations seraient écrites. Sans le recompte *après* le verrou,
    la seconde écrirait sur la foi d'une lecture périmée. Il faut les deux.
    """
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    async with sessions() as amorce, amorce.begin():
        decor = await monter_le_decor(amorce, postes=1)
        second = await auth_service.register(
            amorce,
            email=f"{uuid.uuid4()}@example.com",
            password="tourbillon-cactus-91-vermeil",
            role=UserRole.CREATOR,
        )
        await profile_service.update_profile(
            amorce,
            user_id=second.id,
            modifications={"first_name": "Mateo", "last_name": "Ferrer"},
        )
        compte_second = SocialAccount(
            creator_id=second.id,
            platform=Platform.INSTAGRAM,
            external_id=f"1784140{uuid.uuid4().int % 10**10}",
            handle="mateo.wynwood",
            access_token_encrypted="IGQVJXY-jeton",
            status=SocialAccountStatus.ACTIVE,
            verification_status=VerificationStatus.VERIFIED,
        )
        amorce.add(compte_second)
        await amorce.flush()
        await metrics_service.refresh_profile_metrics(
            amorce,
            account=compte_second,
            provider=FauxFournisseur(rend=metriques(followers_count=24_000, media_count=208)),
        )
        creneau = await premier_creneau(amorce, decor)

    identifiants = {
        "business": decor["business"].id,
        "item": decor["item"].id,
        "offre": decor["offre"].id,
        "createurs": [decor["createur"].id, second.id],
        "comptes": [decor["compte"].id, compte_second.id],
    }

    entree = asyncio.Event()
    liberer = asyncio.Event()

    async def tenter(index: int, *, attendre: bool) -> str:
        async with sessions() as s, s.begin():
            try:
                if attendre:
                    # Le verrou est pris à l'intérieur de `creer`. Pour
                    # forcer le chevauchement, on le prend nous-mêmes
                    # d'abord, sur la même clé — la seconde transaction
                    # bloquera dessus.
                    await service._verrouiller(  # noqa: SLF001 - déroulé forcé
                        s, business_id=identifiants["business"], instant=creneau
                    )
                    entree.set()
                    await liberer.wait()

                await service.creer(
                    s,
                    creator_id=identifiants["createurs"][index],
                    demande=service.DemandeDeReservation(
                        tier_offer_id=identifiants["offre"],
                        social_account_id=identifiants["comptes"][index],
                        starts_at=creneau,
                    ),
                )
                return "passee"
            except service.SlotUnavailable:
                return "refusee"

    try:
        premiere = asyncio.create_task(tenter(0, attendre=True))
        await asyncio.wait_for(entree.wait(), timeout=10)

        seconde = asyncio.create_task(tenter(1, attendre=False))
        # La seconde est bloquée sur le verrou : elle ne peut pas avoir fini.
        await asyncio.sleep(0.3)
        assert not seconde.done(), "la seconde n'a pas été sérialisée par le verrou"

        liberer.set()
        issues = sorted(await asyncio.wait_for(asyncio.gather(premiere, seconde), timeout=15))

        assert issues == ["passee", "refusee"]

        async with sessions() as verif:
            combien = await verif.scalar(
                sa.select(sa.func.count())
                .select_from(Booking)
                .where(Booking.business_id == identifiants["business"])
            )
            assert combien == 1, "la dernière place a été vendue deux fois"
    finally:
        # Ce test écrit pour de bon : tout le décor est retiré, sans quoi le
        # commerce resterait visible du fil et fausserait ses tests. Seuls
        # subsistent les comptes utilisateurs, retenus par le journal d'audit
        # qui est immuable — et qui ne gêne personne.
        async with sessions() as menage, menage.begin():
            business_id = identifiants["business"]
            await menage.execute(sa.delete(Booking).where(Booking.business_id == business_id))
            for table, colonne in (
                ("tier_offer", "business_id"),
                ("capacity_rule", "business_id"),
                ("capacity_exception", "business_id"),
                ("catalog_item", "business_id"),
                ("business_member", "business_id"),
            ):
                await menage.execute(
                    sa.text(f"DELETE FROM {table} WHERE {colonne} = :b"), {"b": business_id}
                )
            await menage.execute(
                sa.text(
                    "DELETE FROM social_metrics_snapshot WHERE social_account_id IN "
                    "(SELECT id FROM social_account WHERE creator_id = ANY(:c))"
                ),
                {"c": identifiants["createurs"]},
            )
            await menage.execute(
                sa.text("DELETE FROM social_account WHERE creator_id = ANY(:c)"),
                {"c": identifiants["createurs"]},
            )
            await menage.execute(sa.text("DELETE FROM business WHERE id = :b"), {"b": business_id})
