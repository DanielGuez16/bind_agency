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
from app.models import Booking, BusinessMember, TierOffer
from app.models.enums import BookingStatus, BusinessMemberRole, UserRole
from app.services import booking_history as service
from app.services import booking_states
from tests.conftest import inscrire_verifie
from tests.test_booking_create import monter_le_decor, premier_creneau, reserver

PREFIX = get_settings().api_v1_prefix
MOT_DE_PASSE = "tourbillon-cactus-91-vermeil"


async def caissier(session: AsyncSession, business) -> object:
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


async def test_l_historique_repond_sur_la_route(client: AsyncClient, session: AsyncSession) -> None:
    """Le service rendait la bonne chose et la route levait quand même.

    `ReservationDuCreateurRead` exigeait `required_mention` et `required_geotag`,
    que la structure du service ne portait pas : la validation de réponse levait
    sur **chaque** appel. L'écran des réservations ne chargeait jamais, et comme
    l'exception passe hors de l'intergiciel CORS, l'app ne voyait qu'un refus de
    CORS et cherchait la panne du mauvais côté.

    Tous les autres tests de l'historique appellent le service directement.
    C'est exactement ce qui a laissé passer le défaut : le contrat de sortie
    n'était éprouvé nulle part.
    """
    decor = await monter_le_decor(session, postes=3)
    await reserver(session, decor, starts_at=await premier_creneau(session, decor))
    await session.commit()

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login",
            json={"email": decor["createur"].email, "password": MOT_DE_PASSE},
        )
    ).json()

    reponse = await client.get(
        f"{PREFIX}/me/bookings",
        headers={"Authorization": f"Bearer {jetons['access_token']}"},
    )

    assert reponse.status_code == 200, reponse.text
    corps = reponse.json()
    assert len(corps["items"]) == 1
    assert corps["items"][0]["business_name"] == "Salon d'essai"
    # Les compteurs de tous les onglets, y compris ceux à zéro.
    assert corps["compteurs"]["held"] == 1


async def test_l_historique_ne_rend_pas_les_criteres_de_l_offre(
    session: AsyncSession,
) -> None:
    """Le créateur lit ses obligations sur la contrepartie, pas sur l'offre.

    Les critères sont figés à la création de la contrepartie (SPEC §2.4) ; ceux
    de l'offre suivent le commerce et changent sous ses pieds. Les rendre ici
    donnerait une seconde source, qui dérive au premier changement d'exigence.
    """
    decor = await monter_le_decor(session, postes=2)
    await reserver(session, decor, starts_at=await premier_creneau(session, decor))

    historique = await service.historique_du_createur(session, creator_id=decor["createur"].id)
    champs = set(historique.items[0].__slots__)

    assert "required_mention" not in champs
    assert "required_geotag" not in champs


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
    # **Le pseudonyme, et rien de civil.** Le décor porte « Rebecca Alvarez » :
    # sans ce nom au décor, l'absence ne prouverait rien — il n'y aurait rien à
    # ne pas trouver.
    assert ligne.creator_handle == "rebecca.miami"
    assert not hasattr(ligne, "creator_first_name")
    assert not hasattr(ligne, "creator_last_name")
    assert ligne.item_name == "Soin visage"


async def test_la_journee_mene_au_profil_de_la_creatrice(session: AsyncSession) -> None:
    """**Le pseudonyme sans lien oblige à le recopier dans une barre
    d'adresse**, et c'est le geste qu'on abandonne — alors qu'un salon qui
    décide d'accorder regarde d'abord ce qu'elle publie.

    L'adresse est dérivée du pseudonyme et du réseau de **cette** demande, par
    la même fonction que l'annuaire. Dérivée et non rangée à côté : deux vérités
    dont une qu'on ne rafraîchit pas laisseraient un lien mort au premier
    changement de pseudonyme.
    """
    decor = await monter_le_decor(session, postes=2)
    creneau = await premier_creneau(session, decor)
    await reserver(session, decor, starts_at=creneau)

    jour = creneau.astimezone(ZoneInfo("America/New_York")).date()
    journee = await service.journee_du_commerce(session, business=decor["business"], jour=jour)

    ligne = journee.items[0]
    assert ligne.creator_profil_url == "https://www.instagram.com/rebecca.miami/"


async def test_le_lien_du_profil_suit_la_meme_regle_que_l_annuaire(
    session: AsyncSession,
) -> None:
    """La même fonction des deux côtés, et le test le tient.

    Deux dérivations écrites séparément finiraient par diverger — un `@` retiré
    d'un côté et pas de l'autre suffit à faire une page d'erreur, que le salon
    lit comme un compte supprimé.
    """
    from app.models.enums import Platform
    from app.services import directory

    decor = await monter_le_decor(session, postes=2)
    creneau = await premier_creneau(session, decor)
    await reserver(session, decor, starts_at=creneau)

    jour = creneau.astimezone(ZoneInfo("America/New_York")).date()
    journee = await service.journee_du_commerce(session, business=decor["business"], jour=jour)
    ligne = journee.items[0]

    assert ligne.creator_profil_url == directory.lien_public(
        Platform.INSTAGRAM, ligne.creator_handle
    )


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


async def test_la_journee_porte_les_criteres_de_publication(session: AsyncSession) -> None:
    """Ce que le salon devra vérifier, sous ses yeux au comptoir.

    La mention et le lieu attendus vivent sur l'offre de palier. Sans eux dans
    la journée, le comptoir sert sans savoir ce qu'il exigera ensuite — et il
    doit alors aller le chercher sur un autre écran, au moment précis où
    quelqu'un attend devant lui.
    """
    decor = await monter_le_decor(session)
    offre = await session.get(TierOffer, decor["offre"].id)
    offre.required_mention = "@velanailstudio"
    offre.required_geotag = True
    await session.flush()

    creneau = await premier_creneau(session, decor)
    booking = await reserver(session, decor, starts_at=creneau)
    await booking_states.confirmer(session, booking=booking, creator_id=decor["createur"].id)

    journee = await service.journee_du_commerce(
        session,
        business=decor["business"],
        jour=creneau.astimezone(ZoneInfo(decor["business"].timezone)).date(),
    )

    ligne = next(item for item in journee.items if item.booking_id == booking.id)
    assert ligne.required_mention == "@velanailstudio"
    assert ligne.required_geotag is True


async def test_la_journee_porte_les_criteres_jusqu_a_la_reponse(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Le service les portait, le schéma de sortie ne les déclarait pas.

    Ils étaient tombés du mauvais côté : déclarés sur la lecture du créateur —
    où ils faisaient lever la route — et absents de celle du commerce, qui est
    la seule à en avoir l'usage. Le comptoir les affichait donc vides, sans
    erreur, sur un écran qui prétend dire ce qu'on exigera de la publication.
    """
    decor = await monter_le_decor(session)
    offre = await session.get(TierOffer, decor["offre"].id)
    offre.required_mention = "@velanailstudio"
    offre.required_geotag = True
    await session.flush()

    creneau = await premier_creneau(session, decor)
    booking = await reserver(session, decor, starts_at=creneau)
    await booking_states.confirmer(session, booking=booking, creator_id=decor["createur"].id)
    membre = await caissier(session, decor["business"])
    await session.commit()

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login",
            json={"email": membre.email, "password": MOT_DE_PASSE},
        )
    ).json()

    jour = creneau.astimezone(ZoneInfo(decor["business"].timezone)).date()
    reponse = await client.get(
        f"{PREFIX}/business/{decor['business'].id}/bookings",
        params={"jour": jour.isoformat()},
        headers={"Authorization": f"Bearer {jetons['access_token']}"},
    )

    assert reponse.status_code == 200, reponse.text
    ligne = next(item for item in reponse.json()["items"] if item["booking_id"] == str(booking.id))
    assert ligne["required_mention"] == "@velanailstudio"
    assert ligne["required_geotag"] is True


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


async def test_la_file_a_trancher_ignore_la_date(session: AsyncSession) -> None:
    """Une décision en attente pour après-demain doit rester visible aujourd'hui.

    Bornée à la journée, elle n'apparaissait dans aucune page qu'on ouvre : la
    créatrice attendait une réponse que personne ne voyait à donner. C'est une
    file, pas un planning.
    """
    decor = await monter_le_decor(session, requires_booking_approval=True)
    booking = await reserver(session, decor, starts_at=await premier_creneau(session, decor))
    # Poussé à après-demain : c'est la date qui doit cesser de compter, et le
    # créneau du jour ne le prouverait pas.
    booking.starts_at = booking.starts_at + timedelta(days=2)
    booking.ends_at = booking.ends_at + timedelta(days=2)
    await session.flush()
    await booking_states.confirmer(session, booking=booking, creator_id=decor["createur"].id)

    # Le jour du commerce, jamais celui du serveur — c'est ce que le test
    # voisin exige du service, et l'écrire autrement ici le contredisait.
    journee = await service.journee_du_commerce(
        session, business=decor["business"], jour=service.aujourd_hui(decor["business"])
    )

    assert [ligne.booking_id for ligne in journee.a_trancher] == [booking.id]
    # Et elle n'est pas dans le planning du jour : elle n'y est pas.
    assert booking.id not in [ligne.booking_id for ligne in journee.items]


async def test_la_file_ne_contient_que_ce_qui_attend(session: AsyncSession) -> None:
    """L'autre sens. Une file qui contiendrait tout ferait trancher des

    réservations déjà tranchées, et le bouton d'accord échouerait sans qu'on
    comprenne pourquoi.
    """
    decor = await monter_le_decor(session)
    creneau = await premier_creneau(session, decor)
    booking = await reserver(session, decor, starts_at=creneau)
    await booking_states.confirmer(session, booking=booking, creator_id=decor["createur"].id)

    # **Le jour du créneau, pas celui de l'horloge.** La date UTC n'est pas
    # celle du commerce entre 20 h et minuit à New York, et le premier créneau
    # libre bascule au lendemain passé la fermeture. Les deux se produisent le
    # soir, et l'assertion tombait alors sur un planning vide — un test vert en
    # journée, rouge en soirée, pour un produit qui n'avait rien.
    journee = await service.journee_du_commerce(
        session,
        business=decor["business"],
        jour=creneau.astimezone(ZoneInfo(decor["business"].timezone)).date(),
    )

    assert journee.a_trancher == ()
    assert booking.id in [ligne.booking_id for ligne in journee.items]


# --------------------------------------------------------------------------
# du chemin réel jusqu'à la journée du comptoir
# --------------------------------------------------------------------------


async def test_une_reservation_confirmee_aujourd_hui_apparait_dans_la_journee(
    session: AsyncSession,
) -> None:
    """Le chemin complet : réserver, confirmer, puis lire la journée du commerce.

    Rien n'était posé à la main et rien ne l'est ici non plus. Ce qui manquait,
    c'est un test qui parte d'une réservation **réelle** et aille jusqu'à
    l'écran : la journée se lisait sur des lignes fabriquées, et le jour où le
    jeu de données a cessé d'en produire pour aujourd'hui — trois salons sur
    quatre fermés le lundi — rien n'a bronché. Le comptoir affichait « rien de
    réservé », et la caisse, qu'on n'atteignait que depuis une ligne de la
    journée, devenait inaccessible.
    """
    decor = await monter_le_decor(session)
    business = decor["business"]

    creneau = await premier_creneau(session, decor)
    booking = await reserver(session, decor, starts_at=creneau)
    await booking_states.confirmer(session, booking=booking, creator_id=decor["createur"].id)

    # Le jour du créneau, chez le commerce — pas chez le serveur.
    jour = creneau.astimezone(ZoneInfo(business.timezone)).date()
    journee = await service.journee_du_commerce(session, business=business, jour=jour)

    lignes = [ligne for ligne in journee.items if ligne.booking_id == booking.id]
    assert lignes, "une réservation confirmée n'apparaît pas dans la journée de son commerce"
    assert lignes[0].status is BookingStatus.CONFIRMED
    # Ce que le comptoir lit sur la ligne : qui vient, pour quoi, et combien de
    # temps. Une ligne sans ça n'aide personne à servir.
    assert lignes[0].item_name
    assert lignes[0].creator_handle or lignes[0].creator_first_name

    # Et le lendemain ne la montre pas : la journée est une journée.
    demain = await service.journee_du_commerce(
        session, business=business, jour=jour + timedelta(days=1)
    )
    assert all(ligne.booking_id != booking.id for ligne in demain.items)


# --------------------------------------------------------------------------
# le motif du dernier refus, descendu jusqu'à la créatrice
# --------------------------------------------------------------------------


async def test_le_motif_du_refus_descend_jusqu_a_la_creatrice(session: AsyncSession) -> None:
    """**Sans lui, elle renvoie la même chose.**

    Une créatrice invitée à resoumettre sans qu'on lui dise ce qui manquait ne
    peut pas corriger : elle se fait refuser une seconde fois, et le dossier
    part en arbitrage sans qu'aucune phrase ait été échangée. Le motif existait
    depuis toujours sur la file d'arbitrage ; il ne descendait pas jusqu'à elle.
    """
    from app.services import collaboration as collaboration_service
    from app.services import proof as proof_service
    from app.services.audit import Actor
    from tests.test_collaboration import capture, contrepartie

    ligne, decor = await contrepartie(session)
    await proof_service.soumettre(
        session, collaboration=ligne, capture=capture(), actor=Actor.from_user(decor["createur"])
    )
    await collaboration_service.demander_une_nouvelle_soumission(
        session,
        collaboration=ligne,
        actor=Actor.from_user(decor["caissier"]),
        reason="location_tag_missing",
    )

    historique = await service.historique_du_createur(session, creator_id=decor["createur"].id)
    contre = historique.items[0].contrepartie

    assert contre is not None
    assert contre.dernier_motif == "location_tag_missing"


async def test_le_motif_est_le_dernier_pas_le_premier(session: AsyncSession) -> None:
    """Elle a une chose à corriger, pas trois.

    C'est la différence avec l'arbitrage, qui garde l'historique entier parce
    que la répétition y justifie l'escalade. Lui montrer les reproches
    précédents la ferait corriger ce qui l'est déjà.
    """
    from app.services import collaboration as collaboration_service
    from app.services import proof as proof_service
    from app.services.audit import Actor
    from tests.test_collaboration import capture, contrepartie

    ligne, decor = await contrepartie(session)
    for rang, motif in enumerate(("mention_missing", "location_tag_missing"), start=1):
        await proof_service.soumettre(
            session,
            collaboration=ligne,
            capture=capture(contenu=f"media {rang}".encode()),
            actor=Actor.from_user(decor["createur"]),
        )
        await collaboration_service.demander_une_nouvelle_soumission(
            session,
            collaboration=ligne,
            actor=Actor.from_user(decor["caissier"]),
            reason=motif,
        )

    historique = await service.historique_du_createur(session, creator_id=decor["createur"].id)

    assert historique.items[0].contrepartie.dernier_motif == "location_tag_missing"


async def test_aucun_motif_quand_rien_n_a_ete_refuse(session: AsyncSession) -> None:
    """Nul, et pas une chaîne vide : une soumission en cours de contrôle n'a
    rien à corriger, et un encart vide ferait chercher un reproche."""
    from tests.test_collaboration import contrepartie

    _ligne, decor = await contrepartie(session)

    historique = await service.historique_du_createur(session, creator_id=decor["createur"].id)

    assert historique.items[0].contrepartie.dernier_motif is None


async def test_le_motif_ne_coute_pas_une_requete_par_ligne(session: AsyncSession) -> None:
    """Le journal se lit **une fois pour la page**. Une requête par réservation
    sur un écran qui en affiche vingt se paie à chaque ouverture."""
    from app.services import collaboration as collaboration_service
    from app.services import proof as proof_service
    from app.services.audit import Actor
    from tests.test_collaboration import capture, contrepartie

    ligne, decor = await contrepartie(session)
    await proof_service.soumettre(
        session, collaboration=ligne, capture=capture(), actor=Actor.from_user(decor["createur"])
    )
    await collaboration_service.demander_une_nouvelle_soumission(
        session,
        collaboration=ligne,
        actor=Actor.from_user(decor["caissier"]),
        reason="mention_missing",
    )

    # La fonction interne prend une liste et rend une table : c'est cette forme
    # qui garantit l'appel unique, et elle se vérifie sans compter les requêtes.
    motifs = await service._derniers_motifs(session, [ligne.id, None, ligne.id])
    assert motifs == {ligne.id: "mention_missing"}
    assert await service._derniers_motifs(session, [None]) == {}


async def test_la_journee_porte_la_reprise_qui_court_et_elle_seule(session: AsyncSession) -> None:
    """**Le bandeau de reprise n'a plus sa propre requête.**

    Il la demandait à part, ce qui coûtait un aller-retour sur l'écran le plus
    ouvert du produit pour une donnée absente dans la quasi-totalité des cas.
    Une ligne ou nulle ne pèse rien.

    Le décor pose **quatre** reprises, dont deux mortes. C'est ce qui le rend
    divergent : sur un salon qui n'en a qu'une, « la plus récente vivante », « la
    première venue » et « la dernière écrite » rendent la même ligne, et le test
    ne prouverait rien.

    - une refermée, une échue : une implémentation qui lirait la table sans les
      deux conditions de vie rendrait l'une d'elles, et le salon lirait qu'on
      est chez lui alors que personne n'y est ;
    - deux vivantes de deux administrateurs — le service ne refuse que la
      seconde du *même* — dont c'est **la plus récemment ouverte** qui porte le
      bandeau. Prendre l'autre nommerait quelqu'un qui est entré avant.
    """
    from app.models import BusinessSupportAccess
    from app.models.enums import PorteeDeReprise
    from app.services import support
    from tests.test_support_access import administrateur

    decor = await monter_le_decor(session)
    business = decor["business"]
    jour = datetime.now(ZoneInfo(business.timezone)).date()

    async def ouvrir(motif: str):
        return await support.ouvrir(
            session,
            business=business,
            admin=await administrateur(session),
            motif=motif,
            portee=[PorteeDeReprise.FICHE],
        )

    async def vieillir(acces, *, de: timedelta, echue: bool = False) -> None:
        """Recule une reprise dans le temps, ouverture **et** terme.

        `ouvrir` accepte un `maintenant`, mais il ne sert qu'à son propre
        contrôle : `started_at` est écrit par `clock_timestamp()` côté Postgres,
        donc naître vieux est impossible — la contrainte
        `expire_apres_ouverture` refuse une échéance antérieure à une ouverture
        qui, elle, reste à l'instant présent. On fait donc passer le temps
        après coup, ce qu'aucun mécanisme du produit ne sait faire.
        """
        await session.execute(
            sa.update(BusinessSupportAccess)
            .where(BusinessSupportAccess.id == acces.id)
            .values(
                started_at=acces.started_at - de,
                **({"expires_at": acces.started_at - de + timedelta(days=1)} if echue else {}),
            )
        )
        await session.refresh(acces)

    refermee = await ouvrir("celle qu'on a refermée")
    await support.fermer(session, acces=refermee, acteur=await administrateur(session))

    echue = await ouvrir("celle qui s'est éteinte toute seule")
    await vieillir(echue, de=timedelta(days=30), echue=True)
    assert echue.expires_at < datetime.now(UTC), "le décor n'a pas expiré ce qu'il annonce"
    assert echue.ended_at is None, "une reprise échue n'est pas une reprise fermée"

    ancienne = await ouvrir("entrée en premier")
    await vieillir(ancienne, de=timedelta(hours=2))
    assert ancienne.expires_at > datetime.now(UTC), "la plus ancienne doit rester vivante"

    recente = await ouvrir("entrée en dernier")
    await session.flush()
    assert ancienne.started_at < recente.started_at, (
        "les deux vivantes sont nées dans le même ordre que leur nom : sinon "
        "le décor ne dit plus laquelle le bandeau doit nommer"
    )

    journee = await service.journee_du_commerce(session, business=business, jour=jour)

    assert journee.reprise_en_cours is not None, "le bandeau ne saurait rien"
    assert journee.reprise_en_cours.id == recente.id, (
        f"reprise « {journee.reprise_en_cours.reason} » portée au lieu de « {recente.reason} »"
    )


async def test_sans_reprise_la_journee_le_dit_par_une_absence(session: AsyncSession) -> None:
    """L'autre bord. Un champ qui porterait toujours une ligne allumerait le
    bandeau chez les milliers de salons où personne n'est jamais entré — et
    c'est le bandeau le plus grave du produit."""
    decor = await monter_le_decor(session)
    jour = datetime.now(ZoneInfo(decor["business"].timezone)).date()

    journee = await service.journee_du_commerce(session, business=decor["business"], jour=jour)

    assert journee.reprise_en_cours is None
