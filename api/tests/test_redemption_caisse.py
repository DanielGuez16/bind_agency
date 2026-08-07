"""Caisse : vérifier, puis consommer.

Deux routes et pas une, parce que la caisse doit voir ce qu'elle sert avant de
le déclarer servi — et que `consumed` est terminal.

Le test qui compte est celui du double scan : deux caisses, le même code, au
même instant. Une seule consomme.
"""

import asyncio
import uuid

import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.core.config import get_settings
from app.models import Booking, BusinessMember, RedemptionCode
from app.models.enums import BookingStatus, BusinessMemberRole, UserRole
from app.services import auth as auth_service
from app.services import booking_states
from app.services import redemption as service
from tests.test_booking_create import monter_le_decor, premier_creneau, reserver

PREFIX = get_settings().api_v1_prefix
MOT_DE_PASSE = "un-mot-de-passe-solide-42"


async def scene(session: AsyncSession, **kwargs) -> dict:
    """Une réservation confirmée, son code, et un membre du commerce connectable."""
    decor = await monter_le_decor(session, **kwargs)
    creneau = (
        await premier_creneau(session, decor) if kwargs.get("requires_booking", True) else None
    )
    booking = await reserver(session, decor, starts_at=creneau)
    await booking_states.confirmer(session, booking=booking, creator_id=decor["createur"].id)
    code = await service.code_du_booking(session, booking=booking)

    caissier = await auth_service.register(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password=MOT_DE_PASSE,
        role=UserRole.BUSINESS_MEMBER,
    )
    session.add(
        BusinessMember(
            business_id=decor["business"].id,
            user_id=caissier.id,
            role=BusinessMemberRole.STAFF,
        )
    )
    await session.flush()

    return {**decor, "booking": booking, "code": code, "caissier": caissier}


async def entetes(client: AsyncClient, user) -> dict:
    email = await client.post(
        f"{PREFIX}/auth/login", json={"email": user.email, "password": MOT_DE_PASSE}
    )
    return {"Authorization": f"Bearer {email.json()['access_token']}"}


# --------------------------------------------------------------------------
# vérifier
# --------------------------------------------------------------------------


async def test_la_caisse_voit_ce_qu_elle_doit_servir(
    client: AsyncClient, session: AsyncSession
) -> None:
    s = await scene(session)
    await session.commit()

    reponse = await client.post(
        f"{PREFIX}/redemptions/verify",
        json={"code": f"{s['code'].id}:{service.code_affiche(s['code'])}"},
        headers=await entetes(client, s["caissier"]),
    )

    assert reponse.status_code == 200, reponse.text
    corps = reponse.json()
    assert corps["booking_id"] == str(s["booking"].id)
    assert corps["item_name"] == "Soin visage"
    assert corps["creator_name"] == "Rebecca Alvarez"
    assert corps["par_secours"] is False

    # Rien n'a été consommé : c'est tout l'intérêt de séparer les deux routes.
    await session.refresh(s["booking"])
    assert s["booking"].consumed_at is None


async def test_le_code_de_secours_est_signale_a_la_caisse(
    client: AsyncClient, session: AsyncSession
) -> None:
    s = await scene(session)
    await session.commit()

    reponse = await client.post(
        f"{PREFIX}/redemptions/verify",
        json={"code": s["code"].manual_code},
        headers=await entetes(client, s["caissier"]),
    )

    assert reponse.json()["par_secours"] is True


async def test_une_caisse_d_un_autre_commerce_est_refusee(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Sans ce contrôle, une caisse lirait ce que le commerce voisin s'apprête à
    servir en scannant un écran par-dessus une épaule."""
    s = await scene(session)
    autre = await scene(session)
    await session.commit()

    reponse = await client.post(
        f"{PREFIX}/redemptions/verify",
        json={"code": f"{s['code'].id}:{service.code_affiche(s['code'])}"},
        headers=await entetes(client, autre["caissier"]),
    )

    assert reponse.status_code == 403
    assert reponse.json()["detail"] == "not_a_member"


async def test_un_createur_ne_verifie_rien(client: AsyncClient, session: AsyncSession) -> None:
    s = await scene(session)
    await session.commit()

    reponse = await client.post(
        f"{PREFIX}/redemptions/verify",
        json={"code": s["code"].manual_code},
        headers=await entetes(client, s["createur"]),
    )
    assert reponse.status_code == 403


# --------------------------------------------------------------------------
# le code du créateur
# --------------------------------------------------------------------------


async def test_le_createur_obtient_sa_charge_de_qr(
    client: AsyncClient, session: AsyncSession
) -> None:
    """La charge est rendue prête à encoder : deux façons de la composer
    finiraient par diverger, et c'est le scanner qui refuserait sans dire
    pourquoi."""
    s = await scene(session)
    await session.commit()

    reponse = await client.get(
        f"{PREFIX}/bookings/{s['booking'].id}/code",
        headers=await entetes(client, s["createur"]),
    )

    assert reponse.status_code == 200, reponse.text
    corps = reponse.json()
    assert corps["payload"].endswith(corps["code"])
    assert len(corps["code"]) == service.LONGUEUR_CODE
    assert 0 < corps["seconds_remaining"] <= corps["rotation_seconds"]

    # La charge rendue est directement acceptée par la caisse.
    verifie = await client.post(
        f"{PREFIX}/redemptions/verify",
        json={"code": corps["payload"]},
        headers=await entetes(client, s["caissier"]),
    )
    assert verifie.status_code == 200


async def test_la_reservation_d_un_autre_createur_n_expose_pas_son_code(
    client: AsyncClient, session: AsyncSession
) -> None:
    s = await scene(session)
    autre = await scene(session)
    await session.commit()

    reponse = await client.get(
        f"{PREFIX}/bookings/{s['booking'].id}/code",
        headers=await entetes(client, autre["createur"]),
    )
    assert reponse.status_code == 404
    assert reponse.json()["detail"] == "booking_not_found"


# --------------------------------------------------------------------------
# consommer
# --------------------------------------------------------------------------


async def test_la_consommation_fait_passer_la_reservation(
    client: AsyncClient, session: AsyncSession
) -> None:
    s = await scene(session)
    await session.commit()

    reponse = await client.post(
        f"{PREFIX}/redemptions/consume",
        json={"redemption_code_id": str(s["code"].id)},
        headers=await entetes(client, s["caissier"]),
    )

    assert reponse.status_code == 200, reponse.text
    assert reponse.json()["status"] == BookingStatus.CONSUMED.value
    assert reponse.json()["consumed_at"] is not None

    booking_id = s["booking"].id
    session.expire_all()
    assert (
        await session.scalar(sa.select(Booking.status).where(Booking.id == booking_id))
        == BookingStatus.CONSUMED.value
    )


async def test_un_code_deja_consomme_est_refuse_avec_sa_raison(
    client: AsyncClient, session: AsyncSession
) -> None:
    s = await scene(session)
    await session.commit()
    entete = await entetes(client, s["caissier"])

    await client.post(
        f"{PREFIX}/redemptions/consume",
        json={"redemption_code_id": str(s["code"].id)},
        headers=entete,
    )
    seconde = await client.post(
        f"{PREFIX}/redemptions/consume",
        json={"redemption_code_id": str(s["code"].id)},
        headers=entete,
    )

    assert seconde.status_code == 409
    # `already_consumed` et non `transition_not_allowed` : la caisse doit
    # comprendre que la prestation a été servie, pas que le système refuse.
    assert seconde.json()["detail"] in {
        "redemption_code_already_consumed",
        "redemption_booking_not_redeemable",
    }


async def test_une_caisse_d_un_autre_commerce_ne_consomme_rien(
    client: AsyncClient, session: AsyncSession
) -> None:
    s = await scene(session)
    autre = await scene(session)
    await session.commit()

    reponse = await client.post(
        f"{PREFIX}/redemptions/consume",
        json={"redemption_code_id": str(s["code"].id)},
        headers=await entetes(client, autre["caissier"]),
    )

    assert reponse.status_code == 403
    booking_id = s["booking"].id
    session.expire_all()
    assert (
        await session.scalar(sa.select(Booking.status).where(Booking.id == booking_id))
        == BookingStatus.CONFIRMED.value
    )


# --------------------------------------------------------------------------
# double scan — le test qui compte
# --------------------------------------------------------------------------


async def test_deux_caisses_qui_scannent_au_meme_instant(engine: AsyncEngine) -> None:
    """Une seule consomme.

    Le `UPDATE … WHERE consumed_at IS NULL` est la barrière : la seconde
    transaction ne modifie aucune ligne et le sait. Vérifier avant d'écrire
    laisserait passer les deux, et le commerce servirait deux fois.

    Deux connexions réelles, sinon il n'y a rien à sérialiser.
    """
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    async with sessions() as amorce, amorce.begin():
        s = await scene(amorce)
    code_id, booking_id = s["code"].id, s["booking"].id
    business_id = s["business"].id

    async def consommer() -> str:
        async with sessions() as session, session.begin():
            try:
                await service.marquer_consomme(
                    session, redemption_code_id=code_id, par_user_id=s["caissier"].id
                )
                return "consomme"
            except service.CodeAlreadyConsumed:
                return "refuse"

    try:
        issues = sorted(await asyncio.gather(consommer(), consommer()))
        assert issues == ["consomme", "refuse"]

        async with sessions() as verif:
            code = await verif.get(RedemptionCode, code_id)
            assert code.consumed_at is not None
    finally:
        async with sessions() as menage, menage.begin():
            await menage.execute(sa.delete(RedemptionCode).where(RedemptionCode.id == code_id))
            await menage.execute(sa.delete(Booking).where(Booking.id == booking_id))
            for table in ("tier_offer", "capacity_rule", "catalog_item", "business_member"):
                await menage.execute(
                    sa.text(f"DELETE FROM {table} WHERE business_id = :b"), {"b": business_id}
                )
            await menage.execute(
                sa.text(
                    "DELETE FROM social_metrics_snapshot WHERE social_account_id IN "
                    "(SELECT id FROM social_account WHERE creator_id = :c)"
                ),
                {"c": s["createur"].id},
            )
            await menage.execute(
                sa.text("DELETE FROM social_account WHERE creator_id = :c"),
                {"c": s["createur"].id},
            )
            await menage.execute(sa.text("DELETE FROM business WHERE id = :b"), {"b": business_id})
