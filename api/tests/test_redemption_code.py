"""Code de retrait : dérivation, rotation, secours.

Ce que ces tests protègent tient en trois propriétés.

Le code affiché n'est **jamais** en base — vérifié par lecture SQL directe.
Il tourne, et la fenêtre précédente reste acceptée le temps qu'un écran passe
d'une main à l'autre. Et le code de secours est à usage unique, parce qu'il ne
tourne pas.
"""

from datetime import UTC, datetime, timedelta

import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Booking, RedemptionCode
from app.models.enums import BookingStatus
from app.services import booking_states
from app.services import redemption as service
from tests.test_booking_create import monter_le_decor, premier_creneau, reserver

ROTATION = get_settings().redemption_rotation_seconds


async def reservation_confirmee(session: AsyncSession, **kwargs):
    decor = await monter_le_decor(session, **kwargs)
    creneau = (
        await premier_creneau(session, decor) if kwargs.get("requires_booking", True) else None
    )
    ligne = await reserver(session, decor, starts_at=creneau)
    await booking_states.confirmer(session, booking=ligne, creator_id=decor["createur"].id)
    return ligne, decor


async def code_de(session: AsyncSession, booking: Booking) -> RedemptionCode:
    """Le code existe depuis la confirmation : on le lit, on ne le recrée pas."""
    code = await service.code_du_booking(session, booking=booking)
    assert code is not None, "la confirmation aurait dû créer le code"
    return code


# --------------------------------------------------------------------------
# dérivation
# --------------------------------------------------------------------------


async def test_le_code_affiche_n_est_jamais_en_base(session: AsyncSession) -> None:
    """Lu en SQL nu : un code stocké fuirait avec la base."""
    ligne, _ = await reservation_confirmee(session)
    code = await code_de(session, ligne)

    affiche = service.code_affiche(code)
    assert len(affiche) == service.LONGUEUR_CODE
    assert affiche.isdigit()

    contenu = (
        await session.execute(
            sa.text("SELECT secret, manual_code FROM redemption_code WHERE id = :i"),
            {"i": code.id},
        )
    ).one()
    assert affiche.encode() not in bytes(contenu.secret)
    assert affiche != contenu.manual_code


async def test_deux_reservations_n_affichent_pas_le_meme_code(session: AsyncSession) -> None:
    """Le `booking_id` entre dans le message : un code observé chez l'un ne vaut
    rien chez l'autre, même si les secrets se ressemblaient."""
    premiere, _ = await reservation_confirmee(session)
    seconde, _ = await reservation_confirmee(session)

    a = await code_de(session, premiere)
    b = await code_de(session, seconde)

    instant = datetime.now(UTC)
    assert service.code_affiche(a, maintenant=instant) != service.code_affiche(
        b, maintenant=instant
    )

    # Et le même secret sur deux réservations différentes donne quand même deux
    # codes différents : c'est le `booking_id` qui les sépare, pas le hasard.
    fenetre = int(instant.timestamp()) // ROTATION
    assert service.deriver(a.secret, premiere.id, fenetre) != service.deriver(
        a.secret, seconde.id, fenetre
    )


async def test_le_code_tourne(session: AsyncSession) -> None:
    ligne, _ = await reservation_confirmee(session)
    code = await code_de(session, ligne)

    instant = datetime.now(UTC)
    maintenant = service.code_affiche(code, maintenant=instant)
    plus_tard = service.code_affiche(code, maintenant=instant + timedelta(seconds=ROTATION))

    assert maintenant != plus_tard
    # Et il ne bouge pas à l'intérieur d'une fenêtre.
    debut_fenetre = datetime.fromtimestamp(
        (int(instant.timestamp()) // ROTATION) * ROTATION, tz=UTC
    )
    assert service.code_affiche(code, maintenant=debut_fenetre) == service.code_affiche(
        code, maintenant=debut_fenetre + timedelta(seconds=ROTATION - 1)
    )


async def test_le_compte_a_rebours_est_rendu(session: AsyncSession) -> None:
    """Un écran qui change sans prévenir fait douter de ce qu'on montre."""
    ligne, _ = await reservation_confirmee(session)
    code = await code_de(session, ligne)

    debut = datetime.fromtimestamp(
        (int(datetime.now(UTC).timestamp()) // ROTATION) * ROTATION, tz=UTC
    )

    assert service.secondes_restantes(code, maintenant=debut) == ROTATION
    assert service.secondes_restantes(code, maintenant=debut + timedelta(seconds=ROTATION - 1)) == 1


# --------------------------------------------------------------------------
# vérification
# --------------------------------------------------------------------------


async def test_le_code_courant_est_reconnu(session: AsyncSession) -> None:
    ligne, _ = await reservation_confirmee(session)
    code = await code_de(session, ligne)

    verifie = await service.verifier(session, saisi=f"{code.id}:{service.code_affiche(code)}")

    assert verifie.booking_id == ligne.id
    assert verifie.business_id == ligne.business_id
    assert verifie.par_secours is False


async def test_la_fenetre_precedente_reste_acceptee(session: AsyncSession) -> None:
    """Le temps qu'un créateur montre son écran et qu'un commerce scanne, on
    franchit parfois une frontière de fenêtre. Refuser là serait
    incompréhensible."""
    ligne, _ = await reservation_confirmee(session)
    code = await code_de(session, ligne)

    instant = datetime.now(UTC)
    ancien = service.code_affiche(code, maintenant=instant - timedelta(seconds=ROTATION))

    verifie = await service.verifier(session, saisi=f"{code.id}:{ancien}", maintenant=instant)
    assert verifie.booking_id == ligne.id


async def test_une_fenetre_de_plus_est_refusee(session: AsyncSession) -> None:
    """Une tolérance, pas deux. Le pendant du test précédent : sans lui, une
    tolérance infinie passerait le test d'acceptation sans rien borner."""
    ligne, _ = await reservation_confirmee(session)
    code = await code_de(session, ligne)

    instant = datetime.now(UTC)
    trop_vieux = service.code_affiche(code, maintenant=instant - timedelta(seconds=2 * ROTATION))

    with pytest.raises(service.CodeUnknown):
        await service.verifier(session, saisi=f"{code.id}:{trop_vieux}", maintenant=instant)


async def test_un_code_du_futur_est_refuse(session: AsyncSession) -> None:
    """Personne ne scanne un code du futur : l'accepter doublerait la surface
    sans rendre service."""
    ligne, _ = await reservation_confirmee(session)
    code = await code_de(session, ligne)

    instant = datetime.now(UTC)
    futur = service.code_affiche(code, maintenant=instant + timedelta(seconds=ROTATION))

    with pytest.raises(service.CodeUnknown):
        await service.verifier(session, saisi=f"{code.id}:{futur}", maintenant=instant)


@pytest.mark.parametrize(
    "saisi",
    ["", "   ", "pas-un-code", "000000", "pas-un-uuid:123456", ":", "AAAAAAAA"],
)
async def test_une_saisie_absurde_est_refusee_sans_lever_autre_chose(
    saisi: str, session: AsyncSession
) -> None:
    ligne, _ = await reservation_confirmee(session)
    await code_de(session, ligne)

    with pytest.raises(service.CodeUnknown):
        await service.verifier(session, saisi=saisi)

    # La session reste utilisable : un refus n'est pas une transaction perdue.
    assert await session.scalar(sa.select(sa.func.count()).select_from(RedemptionCode)) >= 1


async def test_le_code_d_une_autre_reservation_ne_passe_pas(session: AsyncSession) -> None:
    premiere, _ = await reservation_confirmee(session)
    seconde, _ = await reservation_confirmee(session)
    a = await code_de(session, premiere)
    b = await code_de(session, seconde)

    with pytest.raises(service.CodeUnknown):
        await service.verifier(session, saisi=f"{a.id}:{service.code_affiche(b)}")


# --------------------------------------------------------------------------
# code de secours
# --------------------------------------------------------------------------


async def test_le_code_de_secours_est_reconnu_et_signale(session: AsyncSession) -> None:
    """Le commerce a le droit de savoir qu'il n'a pas scanné : c'est le chemin
    le moins fort des deux."""
    ligne, _ = await reservation_confirmee(session)
    code = await code_de(session, ligne)

    verifie = await service.verifier(session, saisi=code.manual_code)

    assert verifie.booking_id == ligne.id
    assert verifie.par_secours is True


async def test_le_code_de_secours_se_saisit_sans_casse(session: AsyncSession) -> None:
    ligne, _ = await reservation_confirmee(session)
    code = await code_de(session, ligne)

    verifie = await service.verifier(session, saisi=f"  {code.manual_code.lower()}  ")
    assert verifie.booking_id == ligne.id


def test_l_alphabet_de_secours_evite_les_caracteres_confondables() -> None:
    """Il se dicte à voix haute et se saisit à la main."""
    assert not set("IO01") & set(service.ALPHABET_SECOURS)
    assert len(service.ALPHABET_SECOURS) == 32


async def test_deux_reservations_ont_des_codes_de_secours_distincts(
    session: AsyncSession,
) -> None:
    premiere, _ = await reservation_confirmee(session)
    seconde, _ = await reservation_confirmee(session)

    a = await code_de(session, premiere)
    b = await code_de(session, seconde)

    assert a.manual_code != b.manual_code


# --------------------------------------------------------------------------
# consommation
# --------------------------------------------------------------------------


async def test_un_code_consomme_est_refuse_avec_sa_propre_raison(
    session: AsyncSession,
) -> None:
    """Distinct de « inconnu » : le commerce doit comprendre que la prestation a
    déjà été servie, pas que le code est faux."""
    ligne, decor = await reservation_confirmee(session)
    code = await code_de(session, ligne)

    await service.marquer_consomme(
        session, redemption_code_id=code.id, par_user_id=decor["createur"].id
    )

    with pytest.raises(service.CodeAlreadyConsumed):
        await service.verifier(session, saisi=f"{code.id}:{service.code_affiche(code)}")

    with pytest.raises(service.CodeAlreadyConsumed):
        await service.verifier(session, saisi=code.manual_code)


async def test_un_double_scan_ne_consomme_qu_une_fois(session: AsyncSession) -> None:
    """Le `WHERE consumed_at IS NULL` est la garantie : vérifier avant d'écrire
    laisserait passer les deux."""
    ligne, decor = await reservation_confirmee(session)
    code = await code_de(session, ligne)

    consomme = await service.marquer_consomme(
        session, redemption_code_id=code.id, par_user_id=decor["createur"].id
    )
    premier_instant = consomme.consumed_at

    with pytest.raises(service.CodeAlreadyConsumed):
        await service.marquer_consomme(
            session, redemption_code_id=code.id, par_user_id=decor["createur"].id
        )

    await session.refresh(code)
    # L'horodatage n'a pas bougé : la seconde tentative n'a rien réécrit.
    assert code.consumed_at == premier_instant


@pytest.mark.parametrize(
    "statut", [BookingStatus.HELD, BookingStatus.CANCELLED, BookingStatus.NO_SHOW]
)
async def test_une_reservation_hors_confirme_n_est_pas_consommable(
    statut: BookingStatus, session: AsyncSession
) -> None:
    ligne, _ = await reservation_confirmee(session)
    ligne.status = statut
    # `held` exige son échéance de garde : la base l'impose, et la remettre ici
    # évite d'éprouver le service sur une ligne qui ne pourrait pas exister.
    if statut is BookingStatus.HELD:
        ligne.hold_expires_at = datetime.now(UTC) + timedelta(minutes=10)
    await session.flush()

    with pytest.raises(service.BookingNotRedeemable):
        service.etat_reservation_consommable(ligne)


async def test_un_droit_expire_n_est_pas_consommable(session: AsyncSession) -> None:
    ligne, _ = await reservation_confirmee(session)
    ligne.valid_until = datetime.now(UTC) - timedelta(minutes=1)
    await session.flush()

    with pytest.raises(service.BookingNotRedeemable):
        service.etat_reservation_consommable(ligne)


async def test_une_reservation_confirmee_et_valide_est_consommable(
    session: AsyncSession,
) -> None:
    """Le pendant : une garde qui refuse tout passerait les tests de refus sans
    rien garantir."""
    ligne, _ = await reservation_confirmee(session)
    ligne.valid_until = datetime.now(UTC) + timedelta(hours=1)
    await session.flush()

    service.etat_reservation_consommable(ligne)


# --------------------------------------------------------------------------
# ce qui protège vraiment le code de secours
# --------------------------------------------------------------------------


def test_le_code_de_secours_tient_en_six_caracteres_groupes() -> None:
    """Il se dicte au téléphone et se tape sur un comptoir. Huit se perdaient
    au milieu."""
    assert service.LONGUEUR_SECOURS == 6
    assert service.secours_lisible("4H29KX") == "4H2 9KX"


async def test_le_code_de_secours_se_saisit_avec_ou_sans_groupement(
    session: AsyncSession,
) -> None:
    """Il arrive écrit de toutes les façons : groupé, collé, en minuscules."""
    ligne, _ = await reservation_confirmee(session)
    code = await code_de(session, ligne)

    for forme in (
        code.manual_code,
        service.secours_lisible(code.manual_code),
        code.manual_code.lower(),
        f"  {service.secours_lisible(code.manual_code).lower()}  ",
        "-".join([code.manual_code[:3], code.manual_code[3:]]),
    ):
        verifie = await service.verifier(session, saisi=forme)
        assert verifie.booking_id == ligne.id, forme


async def test_les_essais_rates_ferment_le_code(session: AsyncSession) -> None:
    """Ce n'est pas la longueur qui protège, c'est cette limite. Six caractères
    sur trente-deux symboles font un milliard de combinaisons ; on n'en approche
    jamais."""
    ligne, _ = await reservation_confirmee(session)
    code = await code_de(session, ligne)
    maximum = get_settings().redemption_max_failed_attempts

    for _ in range(maximum):
        with pytest.raises(service.CodeUnknown):
            await service.verifier(session, saisi=f"{code.id}:000000")

    # Le bon code lui-même ne passe plus : la porte est fermée, pas seulement
    # les mauvais essais.
    with pytest.raises(service.TooManyAttempts):
        await service.verifier(session, saisi=f"{code.id}:{service.code_affiche(code)}")
    with pytest.raises(service.TooManyAttempts):
        await service.verifier(session, saisi=code.manual_code)


async def test_le_compteur_survit_a_l_annulation_du_refus(session: AsyncSession) -> None:
    """L'appelant lève, donc sa transaction peut être annulée. Si le compteur
    partait avec, la limite ne limiterait rien."""
    ligne, _ = await reservation_confirmee(session)
    code = await code_de(session, ligne)

    with pytest.raises(service.CodeUnknown):
        await service.verifier(session, saisi=f"{code.id}:000000")

    compte = await session.scalar(
        sa.select(RedemptionCode.failed_attempts).where(RedemptionCode.id == code.id)
    )
    assert compte == 1


async def test_un_essai_qui_aboutit_remet_le_compteur_a_zero(session: AsyncSession) -> None:
    """Sans cela, un code parfaitement sain se fermerait après quelques scans
    ratés étalés sur plusieurs visites."""
    ligne, _ = await reservation_confirmee(session)
    code = await code_de(session, ligne)
    maximum = get_settings().redemption_max_failed_attempts

    for _ in range(maximum - 1):
        with pytest.raises(service.CodeUnknown):
            await service.verifier(session, saisi=f"{code.id}:000000")

    await service.verifier(session, saisi=f"{code.id}:{service.code_affiche(code)}")

    await session.refresh(code)
    assert code.failed_attempts == 0
    # Et la porte est bien rouverte pour de bon.
    for _ in range(maximum - 1):
        with pytest.raises(service.CodeUnknown):
            await service.verifier(session, saisi=f"{code.id}:000000")
    assert (await service.verifier(session, saisi=code.manual_code)).booking_id == ligne.id


# --------------------------------------------------------------------------
# le code naît à la confirmation
# --------------------------------------------------------------------------


async def test_le_code_existe_des_la_confirmation(session: AsyncSession) -> None:
    """Déterministe vaut mieux que paresseux : une réservation confirmée sans
    ligne de code serait un cas particulier qui ressortirait partout — en
    reporting, en support, et le jour où le téléphone du créateur est vide."""
    ligne, _ = await reservation_confirmee(session)

    code = await service.code_du_booking(session, booking=ligne)
    assert code is not None
    assert len(code.manual_code) == service.LONGUEUR_SECOURS


async def test_un_held_n_a_pas_encore_de_code(session: AsyncSession) -> None:
    """Le pendant : une réservation abandonnée avant confirmation n'a jamais eu
    besoin de code, et son secret n'a pas de raison d'exister."""
    from tests.test_booking_create import monter_le_decor, premier_creneau, reserver

    decor = await monter_le_decor(session)
    creneau = await premier_creneau(session, decor)
    ligne = await reserver(session, decor, starts_at=creneau)

    assert ligne.status is BookingStatus.HELD
    assert await service.code_du_booking(session, booking=ligne) is None


async def test_confirmer_deux_fois_ne_crée_pas_deux_codes(session: AsyncSession) -> None:
    ligne, decor = await reservation_confirmee(session)

    with pytest.raises(booking_states.TransitionNotAllowed):
        await booking_states.confirmer(session, booking=ligne, creator_id=decor["createur"].id)

    combien = await session.scalar(
        sa.select(sa.func.count())
        .select_from(RedemptionCode)
        .where(RedemptionCode.booking_id == ligne.id)
    )
    assert combien == 1
