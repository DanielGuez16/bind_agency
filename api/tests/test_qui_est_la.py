"""Qui est autour du salon, depuis quand il existe, et qui frappe à sa porte.

Quatre données servies pour des écrans en cours de composition, et le même
souci dans chacune : le décor doit **diverger** de l'implémentation fautive,
sinon il ne prouve rien.

— la **portée locale** s'éprouve avec quelqu'un dehors. Sans lui, « compter
  toutes les créatrices » rendrait le même chiffre que « compter celles du
  rayon » ;
— la **première semaine** s'éprouve avec une fenêtre qui commence **après** la
  première réservation. Sans cet écart, « le plus ancien de la fenêtre » et
  « le plus ancien du salon » sont indiscernables ;
— les **comptes de la créatrice** s'éprouvent avec deux réseaux dont un seul
  porte la demande. Sans le second, servir « le compte de la demande » passerait
  le test ;
— les **horaires** s'éprouvent sur un jour aménagé. Sans exception au décor, la
  règle hebdomadaire et la fenêtre réelle disent la même chose.
"""

import uuid
from datetime import UTC, datetime, time, timedelta

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Booking, CapacityException, CreatorProfile, SocialAccount
from app.models.enums import (
    Platform,
    ReliabilityEventType,
    SocialAccountStatus,
    UserRole,
    VerificationStatus,
)
from app.services import booking_history, portee_locale, reliability, reporting
from tests.conftest import inscrire_verifie
from tests.test_booking_create import REEL, STORY, monter_le_decor, premier_creneau, reserver
from tests.test_feed import POST
from tests.test_social_metrics import FauxFournisseur, metriques

#: Le salon du décor. Tout se mesure depuis là.
SALON = (-80.1918, 25.7617)
#: À quelques centaines de mètres : dans le rayon de dix kilomètres.
TOUT_PRES = (-80.1900, 25.7630)
#: Fort Lauderdale, 40 km au nord. Dehors, et c'est le point du test.
LOIN = (-80.1373, 26.1224)
MOT_DE_PASSE = "tourbillon-cactus-91-vermeil"


async def _createur_situe(
    session: AsyncSession,
    *,
    ou: tuple[float, float] | None,
    followers: int | None = 5_000,
    platform: Platform = Platform.INSTAGRAM,
):
    """Une créatrice avec une position, et éventuellement un réseau mesuré."""
    user = await inscrire_verifie(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password=MOT_DE_PASSE,
        role=UserRole.CREATOR,
    )
    if ou is not None:
        await session.execute(
            sa.update(CreatorProfile)
            .where(CreatorProfile.user_id == user.id)
            .values(geo=sa.func.ST_SetSRID(sa.func.ST_MakePoint(*ou), 4326))
        )
    if followers is None:
        await session.flush()
        return user, None

    compte = SocialAccount(
        creator_id=user.id,
        platform=platform,
        external_id=f"1784140{uuid.uuid4().int % 10**10}",
        handle=f"c{uuid.uuid4().hex[:8]}",
        access_token_encrypted="IGQVJXY-jeton",
        status=SocialAccountStatus.ACTIVE,
        verification_status=VerificationStatus.VERIFIED,
    )
    session.add(compte)
    await session.flush()
    await metrics_service_refresh(session, compte, followers)
    return user, compte


async def metrics_service_refresh(session, compte, followers: int) -> None:
    from app.services import metrics as metrics_service

    await metrics_service.refresh_profile_metrics(
        session,
        account=compte,
        provider=FauxFournisseur(rend=metriques(followers_count=followers, media_count=208)),
    )


# --------------------------------------------------------------------------
# 1. qui est autour
# --------------------------------------------------------------------------


async def test_seules_les_creatrices_du_rayon_sont_comptees(session: AsyncSession) -> None:
    """**Le test qui distingue les deux implémentations.**

    Sans quelqu'un dehors, « toutes les créatrices » et « celles du rayon »
    rendent le même nombre, et le décor ne prouve rien.
    """
    decor = await monter_le_decor(session)
    await _createur_situe(session, ou=TOUT_PRES)
    await _createur_situe(session, ou=LOIN)

    portee = await portee_locale.autour_du_commerce(session, business=decor["business"])

    # La créatrice du décor n'a pas de position : elle n'est pas comptée non
    # plus. Seule celle de TOUT_PRES l'est.
    assert portee.createurs == 1
    assert portee.rayon_metres == get_settings().feed_radius_metres


async def test_une_creatrice_sans_position_n_est_pas_du_quartier(session: AsyncSession) -> None:
    """Elle existe, elle peut réserver, et le rayon ne peut rien dire d'elle.

    L'inclure ferait passer pour « autour de vous » quelqu'un qui est
    peut-être ailleurs — le mensonge qu'un chiffre de marché ne doit pas faire.
    """
    decor = await monter_le_decor(session)
    await _createur_situe(session, ou=None)

    portee = await portee_locale.autour_du_commerce(session, business=decor["business"])

    assert portee.createurs == 0


async def test_une_creatrice_sans_reseau_n_offre_rien(session: AsyncSession) -> None:
    """Même règle que l'annuaire : un profil sans réseau ne se vend pas."""
    decor = await monter_le_decor(session)
    await _createur_situe(session, ou=TOUT_PRES, followers=None)

    portee = await portee_locale.autour_du_commerce(session, business=decor["business"])

    assert portee.createurs == 0


async def test_le_second_nombre_dit_qui_peut_deja_reserver(session: AsyncSession) -> None:
    """Et il est **plus petit** que le premier, ce qui est tout son intérêt.

    Le décor pose un palier haut — Reel, dix mille abonnés — et une créatrice à
    cinq mille. Elle est là, elle ne peut pas encore. Deux nombres égaux
    passeraient une implémentation qui rend deux fois le même.
    """
    decor = await monter_le_decor(session, tier_id=REEL)
    await _createur_situe(session, ou=TOUT_PRES, followers=5_000)

    portee = await portee_locale.autour_du_commerce(session, business=decor["business"])

    assert portee.createurs == 1
    assert portee.peuvent_reserver == 0


async def test_un_palier_a_sa_portee_ouvre_la_reservation(session: AsyncSession) -> None:
    """**Le sens inverse, et il compte autant.**

    Un compteur qui rendrait toujours zéro passerait le test précédent sans
    rien garantir.
    """
    decor = await monter_le_decor(session, tier_id=STORY)
    await _createur_situe(session, ou=TOUT_PRES, followers=5_000)

    portee = await portee_locale.autour_du_commerce(session, business=decor["business"])

    assert portee.createurs == 1
    assert portee.peuvent_reserver == 1


async def test_la_portee_accompagne_le_reporting(session: AsyncSession) -> None:
    """Le service peut la calculer sans que l'agrégat la laisse passer."""
    decor = await monter_le_decor(session)
    await _createur_situe(session, ou=TOUT_PRES)

    rapport = await reporting.pour_le_commerce(session, business=decor["business"])

    assert rapport.portee_locale.createurs == 1


# --------------------------------------------------------------------------
# 2. depuis quand
# --------------------------------------------------------------------------


async def test_aucune_activite_ne_donne_aucune_premiere_semaine(session: AsyncSession) -> None:
    """Nulle, et l'écran vide est alors le bon écran."""
    decor = await monter_le_decor(session)

    rapport = await reporting.pour_le_commerce(session, business=decor["business"])

    assert rapport.premiere_semaine is None


async def test_la_premiere_semaine_ignore_la_fenetre_demandee(session: AsyncSession) -> None:
    """**Le test qui compte.**

    La fenêtre commence après la première réservation. « Le plus ancien de la
    fenêtre » rendrait alors le début de la fenêtre — ce que l'appelant sait
    déjà — et « le plus ancien du salon » rend la vraie semaine. Sans cet
    écart, les deux sont indiscernables.
    """
    decor = await monter_le_decor(session)
    creneau = await premier_creneau(session, decor)
    booking = await reserver(session, decor, starts_at=creneau)

    il_y_a_longtemps = datetime.now(UTC) - timedelta(days=90)
    await session.execute(
        sa.update(Booking).where(Booking.id == booking.id).values(created_at=il_y_a_longtemps)
    )
    await session.flush()

    aujourd_hui = datetime.now(UTC).date()
    rapport = await reporting.pour_le_commerce(
        session,
        business=decor["business"],
        depuis=aujourd_hui - timedelta(days=7),
        jusqu_a=aujourd_hui,
    )

    assert rapport.premiere_semaine is not None
    assert rapport.premiere_semaine < rapport.debut.date()
    # Un lundi, comme les étiquettes de `par_semaine` : les deux doivent tomber
    # sur le même jour de la semaine, sinon l'échelle commence à côté.
    assert rapport.premiere_semaine.weekday() == 0
    assert abs((rapport.premiere_semaine - il_y_a_longtemps.date()).days) <= 6


# --------------------------------------------------------------------------
# 3. avec quoi elle frappe
# --------------------------------------------------------------------------


async def test_la_demande_porte_tous_les_reseaux_et_pas_seulement_le_sien(
    session: AsyncSession,
) -> None:
    """**Deux réseaux, un seul sur la demande.**

    Servir « le compte de la demande » passerait un décor à un seul réseau. Le
    second est là pour que les deux implémentations divergent — et parce que
    c'est exactement l'information qui manquait : ce que la personne pèse en
    entier.
    """
    decor = await monter_le_decor(session)
    creneau = await premier_creneau(session, decor)
    await reserver(session, decor, starts_at=creneau)

    tiktok = SocialAccount(
        creator_id=decor["createur"].id,
        platform=Platform.TIKTOK,
        external_id=f"tt{uuid.uuid4().int % 10**10}",
        handle="rebecca.tt",
        access_token_encrypted="TT-jeton",
        status=SocialAccountStatus.ACTIVE,
        verification_status=VerificationStatus.VERIFIED,
    )
    session.add(tiktok)
    await session.flush()

    journee = await booking_history.journee_du_commerce(
        session, business=decor["business"], jour=creneau.date()
    )
    lignes = [*journee.items, *journee.a_trancher]
    la_notre = next(r for r in lignes if r.creator_id == decor["createur"].id)

    plateformes = {c.platform for c in la_notre.comptes}
    assert plateformes == {Platform.INSTAGRAM, Platform.TIKTOK}
    # Instagram est mesuré, TikTok vient d'être rattaché : nul, jamais zéro.
    par_reseau = {c.platform: c for c in la_notre.comptes}
    assert par_reseau[Platform.INSTAGRAM].followers is not None
    assert par_reseau[Platform.TIKTOK].followers is None
    assert par_reseau[Platform.TIKTOK].handle == "rebecca.tt"


async def test_l_absence_d_un_reseau_se_lit_a_son_absence(session: AsyncSession) -> None:
    """Une créatrice sans TikTok n'a pas de ligne TikTok.

    C'est l'écran qui sait quels réseaux il propose ; une ligne vide par réseau
    du produit remplirait chaque demande de riens, dont un YouTube que personne
    n'offre.
    """
    decor = await monter_le_decor(session)
    creneau = await premier_creneau(session, decor)
    await reserver(session, decor, starts_at=creneau)

    journee = await booking_history.journee_du_commerce(
        session, business=decor["business"], jour=creneau.date()
    )
    lignes = [*journee.items, *journee.a_trancher]
    la_notre = next(r for r in lignes if r.creator_id == decor["createur"].id)

    assert [c.platform for c in la_notre.comptes] == [Platform.INSTAGRAM]


# --------------------------------------------------------------------------
# 4. et à quelle heure c'est ouvert
# --------------------------------------------------------------------------


async def test_la_journee_porte_ses_horaires(session: AsyncSession) -> None:
    decor = await monter_le_decor(session)
    jour = datetime.now(UTC).date()

    journee = await booking_history.journee_du_commerce(
        session, business=decor["business"], jour=jour
    )

    assert len(journee.horaires) == 1
    assert journee.horaires[0].debut == time(8, 0)
    assert journee.horaires[0].fin == time(20, 0)


async def test_un_jour_amenage_montre_son_horaire_et_non_l_habituel(
    session: AsyncSession,
) -> None:
    """**Le décor qui diverge.**

    Sans exception, relire la règle hebdomadaire et appeler
    `fenetres_du_jour` donnent le même résultat. Avec elle, l'une dit 8 h – 20 h
    et l'autre 10 h – 14 h : c'est le seul cas où le test choisit.
    """
    decor = await monter_le_decor(session)
    jour = datetime.now(UTC).date()
    session.add(
        CapacityException(
            business_id=decor["business"].id,
            date=jour,
            is_closed=False,
            start_time=time(10, 0),
            end_time=time(14, 0),
            concurrent_slots=2,
        )
    )
    await session.flush()

    journee = await booking_history.journee_du_commerce(
        session, business=decor["business"], jour=jour
    )

    assert [(f.debut, f.fin) for f in journee.horaires] == [(time(10, 0), time(14, 0))]


async def test_un_jour_ferme_n_a_aucune_plage(session: AsyncSession) -> None:
    """Vide veut dire fermé, et c'est une information.

    Une journée sans réservation ne se lit pas pareil selon qu'on était fermé ou
    que personne n'est venu.
    """
    decor = await monter_le_decor(session)
    jour = datetime.now(UTC).date()
    session.add(CapacityException(business_id=decor["business"].id, date=jour, is_closed=True))
    await session.flush()

    journee = await booking_history.journee_du_commerce(
        session, business=decor["business"], jour=jour
    )

    assert journee.horaires == ()
    # Et la journée existe toujours : « fermé » n'est pas « pas de journée ».
    assert journee.jour == jour


# --------------------------------------------------------------------------
# ce qu'ouvrir un palier apporterait
# --------------------------------------------------------------------------


async def test_le_gain_d_un_palier_ferme_compte_qui_il_apporterait(
    session: AsyncSession,
) -> None:
    """« Ouvrir le palier post toucherait 62 créatrices de plus. »

    Le décor pose un salon qui n'offre que le reel — dix mille abonnés — et
    deux créatrices à cinq mille, qui n'atteignent donc personne aujourd'hui.
    Le story, lui, s'ouvre à mille : c'est le chiffre que la phrase attend.
    """
    decor = await monter_le_decor(session, tier_id=REEL)
    await _createur_situe(session, ou=TOUT_PRES, followers=5_000)
    await _createur_situe(session, ou=TOUT_PRES, followers=5_000)

    portee = await portee_locale.autour_du_commerce(session, business=decor["business"])

    assert portee.peuvent_reserver == 0
    gains = {g.tier_id: g.createurs_en_plus for g in portee.gains_par_palier}
    assert gains[STORY] == 2

    # **Et le post reste à zéro, ce qui est l'assertion qui distingue.**
    # Il exige une collaboration terminée, que ces deux créatrices n'ont pas.
    # Évaluer tous les paliers fermés d'un bloc au lieu d'un par un créditerait
    # le post des créatrices que le story a rendues joignables : la phrase
    # promettrait alors du monde qu'ouvrir le post n'apporterait pas.
    assert gains[POST] == 0


async def test_un_palier_deja_ouvert_n_a_pas_de_gain(session: AsyncSession) -> None:
    """Il n'apparaît pas du tout : son gain est nul par construction, et une
    ligne à zéro se lirait comme un conseil inutile."""
    decor = await monter_le_decor(session, tier_id=STORY)
    await _createur_situe(session, ou=TOUT_PRES, followers=5_000)

    portee = await portee_locale.autour_du_commerce(session, business=decor["business"])

    assert STORY not in {g.tier_id for g in portee.gains_par_palier}
    assert REEL in {g.tier_id for g in portee.gains_par_palier}


async def test_celle_qui_peut_deja_reserver_n_est_pas_un_gain(
    session: AsyncSession,
) -> None:
    """**Le test qui distingue le gain du total.**

    La créatrice à cinquante mille abonnés passe déjà par le story que le salon
    offre. Ouvrir le reel ne l'apporterait pas : elle est là. Compter les
    totaux par palier la compterait deux fois, et la phrase promettrait
    quelqu'un qu'on a déjà.
    """
    decor = await monter_le_decor(session, tier_id=STORY)
    elle, _ = await _createur_situe(session, ou=TOUT_PRES, followers=50_000)

    # **Elle doit être éligible au reel sur tous les autres critères**, sinon le
    # décor ne diverge pas : une créatrice neuve n'a aucune collaboration
    # terminée, le reel en exige deux, et le gain serait nul quelle que soit
    # l'implémentation. Trouvé par mutation — le test passait au vert en
    # n'éprouvant rien.
    #
    # Le compteur est produit par le mécanisme du produit, jamais posé à la
    # main : c'est `reliability.rafraichir` qui l'écrit depuis les événements.
    for _ in range(2):
        await reliability.enregistrer(
            session,
            creator_id=elle.id,
            type_=ReliabilityEventType.COLLAB_COMPLETED,
        )

    portee = await portee_locale.autour_du_commerce(session, business=decor["business"])

    assert portee.peuvent_reserver == 1
    gains = {g.tier_id: g.createurs_en_plus for g in portee.gains_par_palier}
    assert gains[REEL] == 0


async def test_un_palier_hors_de_portee_n_apporte_personne(session: AsyncSession) -> None:
    """**Le sens inverse.**

    Un compteur qui rendrait toujours le nombre de créatrices du rayon
    passerait les tests précédents. Ici le reel exige dix mille abonnés et la
    créatrice en a cinq mille : l'ouvrir n'apporterait rien, et le dire est
    aussi utile que l'inverse.
    """
    decor = await monter_le_decor(session, tier_id=STORY)
    await _createur_situe(session, ou=TOUT_PRES, followers=5_000)

    portee = await portee_locale.autour_du_commerce(session, business=decor["business"])

    gains = {g.tier_id: g.createurs_en_plus for g in portee.gains_par_palier}
    assert gains[REEL] == 0
    # Et elle réserve bien par le story : le décor n'est pas vide.
    assert portee.peuvent_reserver == 1


async def test_le_gain_porte_le_format_et_non_un_identifiant_seul(
    session: AsyncSession,
) -> None:
    """L'écran écrit « le palier post », pas un UUID.

    Sans le format, il devrait recharger la grille des paliers pour composer
    une phrase — un second appel pour un mot.
    """
    decor = await monter_le_decor(session, tier_id=REEL)
    await _createur_situe(session, ou=TOUT_PRES, followers=5_000)

    portee = await portee_locale.autour_du_commerce(session, business=decor["business"])
    story = next(g for g in portee.gains_par_palier if g.tier_id == STORY)

    assert story.content_format is not None
    assert story.platform is not None
