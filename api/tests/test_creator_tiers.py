"""Écran des paliers accessibles.

Le moteur d'éligibilité est éprouvé ailleurs. Ce fichier porte sur la mise en
forme : un palier vu une seule fois quel que soit le nombre de comptes, les
obstacles du compte le plus proche, et le cas du créateur sans compte social —
celui pour qui le moteur n'a rien à dire, et à qui il faut pourtant dire quelque
chose.
"""

import uuid

import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.integrations.geocoding import Coordinates
from app.models import CreatorProfile, SocialAccount, Tier
from app.models.enums import (
    ContentFormat,
    Neighborhood,
    Platform,
    ReliabilityEventType,
    SocialAccountStatus,
    UserRole,
    VerificationStatus,
)
from app.services import creator_tiers as service
from app.services import metrics as metrics_service
from app.services import reliability
from app.services.audit import Actor
from app.services.eligibility import RaisonRefus
from tests.conftest import inscrire_verifie
from tests.test_social_metrics import FauxFournisseur, metriques

PREFIX = get_settings().api_v1_prefix

STORY = uuid.UUID("8f9bfcd8-39ff-41a3-9b6b-f00e40f8774d")  # instagram/story, 1000 abonnes
REEL = uuid.UUID("a839969b-3965-4c7e-92b1-b6274f899162")  # instagram/reel, 10000 abonnes


async def createur(session: AsyncSession):
    return await inscrire_verifie(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password="tourbillon-cactus-91-vermeil",
        role=UserRole.CREATOR,
    )


async def compte(session: AsyncSession, user, *, followers: int, **overrides) -> SocialAccount:
    valeurs = {
        "creator_id": user.id,
        "platform": Platform.INSTAGRAM,
        "external_id": f"1784140{uuid.uuid4().int % 10**10}",
        "handle": "compte.dessai",
        "access_token_encrypted": "IGQVJXY-jeton",
        "status": SocialAccountStatus.ACTIVE,
        "verification_status": VerificationStatus.VERIFIED,
    }
    ligne = SocialAccount(**(valeurs | overrides))
    session.add(ligne)
    await session.flush()
    await metrics_service.refresh_profile_metrics(
        session,
        account=ligne,
        provider=FauxFournisseur(rend=metriques(followers_count=followers, media_count=208)),
    )
    return ligne


def palier(vue, tier_id):
    return next(p for p in vue.paliers if p.tier_id == tier_id)


async def test_un_palier_n_apparait_qu_une_fois_par_createur(session: AsyncSession) -> None:
    """Un créateur à trois comptes verrait sinon chaque palier trois fois."""
    user = await createur(session)
    for followers in (24_000, 8_600, 3_100):
        await compte(session, user, followers=followers)

    vue = await service.vue_des_paliers(session, user.id)

    identifiants = [p.tier_id for p in vue.paliers]
    assert len(identifiants) == len(set(identifiants))
    # Et tous les paliers actifs y sont, ouverts ou non : masquer les fermés
    # donnerait un écran vide à qui débute.
    actifs = await session.scalar(
        sa.select(sa.func.count()).select_from(Tier).where(Tier.is_active.is_(True))
    )
    assert len(vue.paliers) == actifs


async def test_un_palier_est_ouvert_des_qu_un_compte_l_ouvre(session: AsyncSession) -> None:
    user = await createur(session)
    await compte(session, user, followers=800)  # sous le seuil story
    await compte(session, user, followers=24_000)  # au-dessus en abonnés

    vue = await service.vue_des_paliers(session, user.id)

    assert palier(vue, STORY).accessible is True
    assert palier(vue, STORY).obstacles == ()


async def test_les_abonnes_ne_suffisent_pas_aux_paliers_hauts(session: AsyncSession) -> None:
    """Depuis le rétablissement des seuils de collaborations, le palier reel en
    exige deux. Un créateur sans historique reste dehors quel que soit son
    volume — c'est exactement ce que la condition doit produire, et ce qu'elle
    ne produisait pas tant que le compteur n'était alimenté par rien.
    """
    user = await createur(session)
    await compte(session, user, followers=24_000)

    reel = palier(await service.vue_des_paliers(session, user.id), REEL)

    assert reel.accessible is False
    manque = next(o for o in reel.obstacles if o.raison is RaisonRefus.NOT_ENOUGH_COMPLETED_COLLABS)
    assert (manque.requis, manque.constate) == (2, 0)
    # Et ce n'est pas le nombre d'abonnés qui bloque.
    assert RaisonRefus.NOT_ENOUGH_FOLLOWERS not in {o.raison for o in reel.obstacles}


async def test_les_obstacles_sont_ceux_du_compte_le_plus_proche(session: AsyncSession) -> None:
    """Montrer ceux du compte le plus faible ferait viser la mauvaise cible."""
    user = await createur(session)
    await compte(session, user, followers=500)
    await compte(session, user, followers=9_000)

    vue = await service.vue_des_paliers(session, user.id)
    reel = palier(vue, REEL)

    assert reel.accessible is False
    manque = next(o for o in reel.obstacles if o.raison is RaisonRefus.NOT_ENOUGH_FOLLOWERS)
    # 10 000 - 9 000, et non 10 000 - 500.
    assert manque.ecart == 1_000
    assert manque.constate == 9_000


async def test_un_createur_sans_compte_social_sait_quoi_faire(session: AsyncSession) -> None:
    """Le piège de l'ensemble vide : aucun couple à évaluer, donc aucun
    obstacle au sens du moteur. L'écran dirait « bloqué » sans dire pourquoi."""
    user = await createur(session)

    vue = await service.vue_des_paliers(session, user.id)

    assert vue.paliers, "aucun palier rendu : le créateur ne verrait rien du tout"
    for p in vue.paliers:
        assert p.accessible is False
        assert p.social_account_id is None
        assert [o.raison for o in p.obstacles] == [RaisonRefus.NO_SOCIAL_ACCOUNT]


async def test_le_badge_suit_l_absence_d_historique(session: AsyncSession) -> None:
    user = await createur(session)
    await compte(session, user, followers=24_000)

    vue = await service.vue_des_paliers(session, user.id)
    assert vue.is_new_creator is True

    # Le badge est calculé par la base depuis `reliability_score` : il ne peut
    # pas diverger de sa source.
    await session.execute(
        sa.update(CreatorProfile)
        .where(CreatorProfile.user_id == user.id)
        .values(reliability_score=82.5)
    )
    await session.flush()

    vue = await service.vue_des_paliers(session, user.id)
    assert vue.is_new_creator is False


async def test_un_compte_en_revue_bloque_avec_sa_propre_raison(session: AsyncSession) -> None:
    """Assez d'abonnés ne suffit pas : la raison doit dire d'attendre, pas de
    grandir."""
    user = await createur(session)
    await compte(
        session, user, followers=24_000, verification_status=VerificationStatus.NEEDS_REVIEW
    )
    # Le relevé fait basculer le compte en `verified` : on le remet en revue.
    await session.execute(
        sa.update(SocialAccount)
        .where(SocialAccount.creator_id == user.id)
        .values(verification_status=VerificationStatus.NEEDS_REVIEW)
    )
    await session.flush()

    vue = await service.vue_des_paliers(session, user.id)
    story = palier(vue, STORY)

    assert story.accessible is False
    assert RaisonRefus.ACCOUNT_UNDER_REVIEW in {o.raison for o in story.obstacles}
    assert RaisonRefus.NOT_ENOUGH_FOLLOWERS not in {o.raison for o in story.obstacles}


async def test_un_palier_inactif_n_est_pas_rendu(session: AsyncSession) -> None:
    user = await createur(session)
    await compte(session, user, followers=24_000)

    inactifs = set(await session.scalars(sa.select(Tier.id).where(Tier.is_active.is_(False))))
    assert inactifs, "aucun palier inactif dans les données de référence"

    vue = await service.vue_des_paliers(session, user.id)
    assert not ({p.tier_id for p in vue.paliers} & inactifs)


async def test_la_route_est_reservee_aux_createurs(client: AsyncClient) -> None:
    async def connecte(role: UserRole) -> dict:
        email, password = f"{uuid.uuid4()}@example.com", "tourbillon-cactus-91-vermeil"
        await client.post(
            f"{PREFIX}/auth/register",
            json={
                "email": email,
                "password": password,
                "role": role.value,
                "date_of_birth": "1992-04-17",
            },
        )
        jetons = (
            await client.post(f"{PREFIX}/auth/login", json={"email": email, "password": password})
        ).json()
        return {"headers": {"Authorization": f"Bearer {jetons['access_token']}"}}

    commerce = await connecte(UserRole.BUSINESS_MEMBER)
    assert (await client.get(f"{PREFIX}/me/tiers", **commerce)).status_code == 403

    createur_connecte = await connecte(UserRole.CREATOR)
    reponse = await client.get(f"{PREFIX}/me/tiers", **createur_connecte)
    assert reponse.status_code == 200
    corps = reponse.json()
    assert corps["is_new_creator"] is True
    assert corps["paliers"]
    assert all(
        p["obstacles"][0]["raison"] == RaisonRefus.NO_SOCIAL_ACCOUNT.value for p in corps["paliers"]
    )


async def test_le_score_de_fiabilite_accompagne_les_paliers(session: AsyncSession) -> None:
    """La condition que l'écran citait sans jamais pouvoir la montrer.

    `reliability_score_too_low` ferme des paliers en nommant un seuil ; sans la
    valeur en face, le créateur lit une règle dont il ne peut pas savoir où il
    se situe. Les deux termes viennent des caches du profil, écrits par le
    service de fiabilité — jamais posés à la main ici, sinon le jeu de données
    prouverait que la vue recopie ce qu'on vient d'écrire, et rien de plus.
    """
    user = await createur(session)
    await compte(session, user, followers=24_000)

    vue = await service.vue_des_paliers(session, user.id)
    # Aucun événement : nul veut dire neutre. Zéro ferait d'un débutant
    # quelqu'un de peu fiable, et l'écran afficherait une barre vide.
    assert vue.fiabilite.reliability_score is None
    assert vue.fiabilite.completed_collabs_count == 0

    for _ in range(3):
        await reliability.enregistrer(
            session, creator_id=user.id, type_=ReliabilityEventType.COLLAB_COMPLETED
        )

    vue = await service.vue_des_paliers(session, user.id)
    attendu = await reliability.recalculer(session, user.id)
    assert vue.fiabilite.reliability_score == attendu.reliability_score
    assert vue.fiabilite.completed_collabs_count == 3
    # Le score et le badge sortent du même null : lus à deux instants, ils
    # pourraient se contredire, et l'écran annoncerait « nouveau créateur »
    # au-dessus d'un score de 92.
    assert vue.is_new_creator is False


async def test_la_route_rend_la_fiabilite(client: AsyncClient, session: AsyncSession) -> None:
    """Le service peut la calculer sans que la route la laisse passer.

    Le schéma est le seul endroit où un champ se perd en silence : l'appelant
    reçoit un 200 et un objet sans la clé.
    """
    email, password = f"{uuid.uuid4()}@example.com", "tourbillon-cactus-91-vermeil"
    await client.post(
        f"{PREFIX}/auth/register",
        json={
            "email": email,
            "password": password,
            "role": UserRole.CREATOR.value,
            "date_of_birth": "1992-04-17",
        },
    )
    jetons = (
        await client.post(f"{PREFIX}/auth/login", json={"email": email, "password": password})
    ).json()
    entetes = {"Authorization": f"Bearer {jetons['access_token']}"}

    corps = (await client.get(f"{PREFIX}/me/tiers", headers=entetes)).json()

    assert "fiabilite" in corps, "le champ se perd entre le service et la route"
    # **Le score nul et le compteur à zéro sont assertés champ par champ**, et
    # non par égalité du dictionnaire entier : la fiabilité a gagné les
    # composantes, et une égalité stricte ferait tomber ce test à chaque ajout
    # sans jamais rien dire de ce qu'il prétend garder — que le score traverse
    # la route.
    assert corps["fiabilite"]["reliability_score"] is None
    assert corps["fiabilite"]["completed_collabs_count"] == 0


# --------------------------------------------------------------------------
# ce qu'un palier ouvrirait
# --------------------------------------------------------------------------
#
# **Sans ce compte, une carte de palier fermé affiche un tiret** et ne peut plus
# dire ce qu'elle ouvrirait — ce qui était tout son intérêt. Le fil ne peut pas
# le fournir : il ne rend jamais une prestation d'un palier fermé.


async def test_chaque_palier_dit_combien_de_prestations_il_ouvre(
    session: AsyncSession,
) -> None:
    """Le compte est **par palier**, et il vaut pour les fermés comme pour les
    ouverts."""
    from tests.test_feed import commerce, offre

    b = await commerce(session, longitude=-80.1301, latitude=25.7908)
    await offre(session, b, tier_id=STORY, name="Soin A")
    await offre(session, b, tier_id=STORY, name="Soin B")
    await offre(session, b, tier_id=REEL, name="Soin C")

    # Un créateur qui n'ouvre que le palier story : le palier reel lui est
    # fermé, et c'est justement celui dont le compte doit rester juste.
    user = await createur(session)
    await compte(session, user, followers=1_800)

    vue = await service.vue_des_paliers(session, user.id)
    par_palier = {p.tier_id: p for p in vue.paliers}

    assert par_palier[STORY].accessible is True
    assert par_palier[STORY].offres_disponibles == 2
    assert par_palier[REEL].accessible is False
    assert par_palier[REEL].offres_disponibles == 1, (
        "un palier fermé doit dire ce qu'il ouvrirait, sinon la carte n'a plus d'objet"
    )


async def test_un_palier_que_personne_n_a_compose_dit_zero(session: AsyncSession) -> None:
    """**Zéro est une réponse, pas une absence.** Un palier qu'aucun commerce
    n'a encore composé se dit, il ne se masque pas."""
    user = await createur(session)
    await compte(session, user, followers=1_800)

    vue = await service.vue_des_paliers(session, user.id)

    assert all(p.offres_disponibles == 0 for p in vue.paliers)


async def test_une_prestation_retiree_ne_compte_plus(session: AsyncSession) -> None:
    """Le compte suit l'état effectif, comme le fil : un item indisponible ne
    s'ouvre pas, et le promettre serait une impasse chiffrée."""
    from app.services import capacity as capacity_service
    from tests.test_feed import commerce, offre

    b = await commerce(session, longitude=-80.1301, latitude=25.7908)
    item, _ = await offre(session, b, tier_id=STORY, name="Soin retiré")
    user = await createur(session)
    await compte(session, user, followers=1_800)

    avant = {
        p.tier_id: p.offres_disponibles
        for p in (await service.vue_des_paliers(session, user.id)).paliers
    }
    # Un acteur humain : une transition décidée par le système doit dire
    # pourquoi, et retirer une prestation est une décision du commerce.
    membre = await inscrire_verifie(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password="tourbillon-cactus-91-vermeil",
        role=UserRole.BUSINESS_MEMBER,
    )
    await capacity_service.set_availability(
        session, item=item, is_available=False, actor=Actor.from_user(membre)
    )
    apres = {
        p.tier_id: p.offres_disponibles
        for p in (await service.vue_des_paliers(session, user.id)).paliers
    }

    assert avant[STORY] == 1
    assert apres[STORY] == 0


# --------------------------------------------------------------------------
# le compte dans le rayon
# --------------------------------------------------------------------------
#
# **La route ne dépend jamais d'une position, elle en tire parti quand elle est
# là.** Faire dépendre un écran d'identité d'une position avait été écarté à
# raison : les paliers d'un créateur ne changent pas parce qu'il a bougé. Mais
# rien n'interdit d'en tirer parti — et l'écran doit pouvoir écrire « douze au
# total, dont neuf à moins de quinze kilomètres ».


ICI_MIAMI = Coordinates(longitude=-80.19, latitude=25.79)


async def _createur_qui_ouvre_story(session: AsyncSession):
    user = await createur(session)
    await compte(session, user, followers=1_800)
    return user


async def test_sans_position_le_compte_est_nul_et_non_zero(session: AsyncSession) -> None:
    """**Une absence, pas un zéro.** L'écran doit distinguer « on n'a pas
    demandé » de « il n'y en a aucun autour de vous » : rendre zéro ferait
    afficher « aucun salon près d'ici » à quelqu'un dont on ignore où il est."""
    from tests.test_feed import commerce, offre

    b = await commerce(session, longitude=ICI_MIAMI.longitude, latitude=ICI_MIAMI.latitude)
    await offre(session, b, tier_id=STORY)
    user = await _createur_qui_ouvre_story(session)

    vue = await service.vue_des_paliers(session, user.id)

    assert all(p.commerces_dans_le_rayon is None for p in vue.paliers)
    assert all(p.offres_dans_le_rayon is None for p in vue.paliers)
    # Et le total, lui, reste rendu : la réponse d'avant, au champ près.
    assert palier(vue, STORY).offres_disponibles == 1


async def test_avec_une_position_chaque_palier_compte_ses_commerces(
    session: AsyncSession,
) -> None:
    """Des **commerces**, pas des prestations : un salon qui propose trois
    prestations au même palier ne compte qu'une fois. Compter des offres ferait
    dire « dont quatorze » d'un total de douze."""
    from tests.test_feed import commerce, offre

    proche = await commerce(session, longitude=ICI_MIAMI.longitude, latitude=ICI_MIAMI.latitude)
    await offre(session, proche, tier_id=STORY, name="Soin A")
    await offre(session, proche, tier_id=STORY, name="Soin B")
    user = await _createur_qui_ouvre_story(session)

    vue = await service.vue_des_paliers(session, user.id, autour_de=ICI_MIAMI)

    story = palier(vue, STORY)
    assert story.offres_disponibles == 2, "deux prestations au total"
    # **Les deux grandeurs, et c'est le point.** « Douze ouvertes, dont neuf à
    # moins de quinze kilomètres » compare deux fois des prestations ; « chez N
    # salons » compte des salons. Confondre les deux fait une phrase fausse que
    # personne ne remarque, parce que les deux nombres sont plausibles.
    assert story.offres_dans_le_rayon == 2, "les deux prestations sont à portée"
    assert story.commerces_dans_le_rayon == 1, "mais chez un seul salon"


async def test_le_rayon_ecarte_ce_qui_est_trop_loin(session: AsyncSession) -> None:
    """L'autre sens, et c'est celui qui donne son sens au champ : un compte qui
    rendrait le total quel que soit le rayon n'apprendrait rien."""
    from tests.test_feed import commerce, offre

    proche = await commerce(session, longitude=ICI_MIAMI.longitude, latitude=ICI_MIAMI.latitude)
    await offre(session, proche, tier_id=STORY)
    loin = await commerce(session, longitude=ICI_MIAMI.longitude + 0.5, latitude=ICI_MIAMI.latitude)
    await offre(session, loin, tier_id=STORY)
    user = await _createur_qui_ouvre_story(session)

    vue = await service.vue_des_paliers(session, user.id, autour_de=ICI_MIAMI, rayon_metres=5_000)

    story = palier(vue, STORY)
    assert story.offres_disponibles == 2, "les deux salons existent"
    assert story.offres_dans_le_rayon == 1, "une seule prestation est à portée"
    assert story.commerces_dans_le_rayon == 1, "chez un seul salon"


async def test_une_seule_coordonnee_est_refusee(client: AsyncClient) -> None:
    """Une longitude sans latitude est une erreur de l'appelant, pas une demande
    à moitié. L'accepter en silence ferait répondre « aucun commerce autour » à
    quelqu'un dont la latitude s'est perdue en route."""
    email = f"{uuid.uuid4()}@example.com"
    await client.post(
        f"{PREFIX}/auth/register",
        json={
            "email": email,
            "password": "tourbillon-cactus-91-vermeil",
            "role": "creator",
            "date_of_birth": "1992-04-17",
        },
    )
    jetons = (
        await client.post(
            f"{PREFIX}/auth/login",
            json={"email": email, "password": "tourbillon-cactus-91-vermeil"},
        )
    ).json()
    entetes = {"Authorization": f"Bearer {jetons['access_token']}"}

    refuse = await client.get(f"{PREFIX}/me/tiers?longitude=-80.19", headers=entetes)
    assert refuse.status_code == 422, refuse.text

    # La session reste utilisable : un refus ne doit pas la laisser inemployable.
    complet = await client.get(f"{PREFIX}/me/tiers", headers=entetes)
    assert complet.status_code == 200, complet.text


# --------------------------------------------------------------------------
# les offres d'un palier, sans borne de distance
# --------------------------------------------------------------------------


async def test_les_offres_d_un_palier_ne_sont_pas_bornees_par_la_distance(
    session: AsyncSession,
) -> None:
    """**Ce que le fil ne peut pas rendre.** Il est borné par un rayon par
    construction ; la bascule « près de vous / les douze » a besoin des objets,
    et ses deux états doivent montrer deux listes différentes."""
    from tests.test_feed import commerce, offre

    pres = await commerce(session, longitude=ICI_MIAMI.longitude, latitude=ICI_MIAMI.latitude)
    await offre(session, pres, tier_id=STORY, name="Tout pres")
    loin = await commerce(session, longitude=ICI_MIAMI.longitude + 0.9, latitude=ICI_MIAMI.latitude)
    await offre(session, loin, tier_id=STORY, name="Tres loin")

    offres = await service.offres_du_palier(session, tier_id=STORY)

    assert {o.nom for o in offres} == {"Tout pres", "Tres loin"}


async def test_elles_sont_triees_par_quartier_puis_par_nom(session: AsyncSession) -> None:
    """**Le seul axe qui ne classe personne.** Trier par palier hiérarchiserait
    des prestations que la créatrice peut toutes réserver ; trier par salon
    supposerait un ordre entre eux. Le quartier est un fait, pas un jugement.

    Les salons sans quartier viennent en dernier : ils ne sont pas situés, pas
    relégués — et Postgres les mettrait en tête sans `nullslast`.
    """
    from tests.test_feed import commerce, offre

    wynwood = await commerce(
        session,
        longitude=ICI_MIAMI.longitude,
        latitude=ICI_MIAMI.latitude,
        neighborhood=Neighborhood.WYNWOOD,
    )
    await offre(session, wynwood, tier_id=STORY, name="Zebre")
    await offre(session, wynwood, tier_id=STORY, name="Abricot")
    brickell = await commerce(
        session,
        longitude=ICI_MIAMI.longitude,
        latitude=ICI_MIAMI.latitude,
        neighborhood=Neighborhood.BRICKELL,
    )
    await offre(session, brickell, tier_id=STORY, name="Melon")
    sans = await commerce(session, longitude=ICI_MIAMI.longitude, latitude=ICI_MIAMI.latitude)
    await offre(session, sans, tier_id=STORY, name="Ananas")

    offres = await service.offres_du_palier(session, tier_id=STORY)

    # `brickell` avant `wynwood` — l'ordre des valeurs de l'énumération — puis
    # alphabétique à l'intérieur, et le non-situé en dernier.
    assert [o.nom for o in offres] == ["Melon", "Abricot", "Zebre", "Ananas"]


async def test_la_position_ajoute_la_distance_sans_rien_borner(
    session: AsyncSession,
) -> None:
    """La position ne filtre pas : elle informe. `null` sans elle, ce qui
    distingue « loin » de « on ne sait pas d'où »."""
    from tests.test_feed import commerce, offre

    b = await commerce(session, longitude=ICI_MIAMI.longitude, latitude=ICI_MIAMI.latitude)
    await offre(session, b, tier_id=STORY)

    sans = await service.offres_du_palier(session, tier_id=STORY)
    avec = await service.offres_du_palier(session, tier_id=STORY, autour_de=ICI_MIAMI)

    assert [o.distance_metres for o in sans] == [None]
    assert avec[0].distance_metres is not None
    assert len(avec) == len(sans), "la position ne doit rien retirer"


async def test_une_prestation_desactivee_ne_figure_pas(session: AsyncSession) -> None:
    """Le même tamis que le compte : une liste de douze qui porterait onze
    lignes ne dirait pas laquelle manque."""
    from tests.test_feed import commerce, offre

    b = await commerce(session, longitude=ICI_MIAMI.longitude, latitude=ICI_MIAMI.latitude)
    item, _ligne = await offre(session, b, tier_id=STORY, name="Retiree")
    await offre(session, b, tier_id=STORY, name="Gardee")
    item.is_available = False
    await session.flush()

    offres = await service.offres_du_palier(session, tier_id=STORY)

    assert [o.nom for o in offres] == ["Gardee"]


class TestLeProchainPalier:
    """**Venu du fil, où plus rien ne le lisait.**

    Il y vivait parce que les paliers y vivaient ; ils sont partis sur l'écran
    d'audience, qui consulte cette route-ci, et le champ était resté derrière —
    servi à chaque chargement du fil, rendu nulle part.

    Le classement reste au serveur : c'est une règle de produit, et la recopier
    dans l'écran en ferait une seconde vérité.
    """

    async def test_il_classe_sur_le_nombre_de_conditions_pas_sur_leur_ampleur(
        self, session: AsyncSession
    ) -> None:
        """**Le cœur de la règle, et le seul cas qui la distingue.**

        Une première version triait sur l'écart brut : elle plaçait « une
        collaboration de plus » devant « cinq mille abonnés de plus » parce que
        1 < 5000. Ce sont deux grandeurs sans rapport.

        Le décor donne donc à l'un **deux** obstacles de petite ampleur et à
        l'autre **un seul** de grande : un tri sur l'ampleur les inverserait, un
        tri sur le nombre les range comme il faut.
        """
        from app.services import creator_tiers as module

        proche = _palier(obstacles=1, ecart=50_000, format_=ContentFormat.REEL)
        loin = _palier(obstacles=2, ecart=1, format_=ContentFormat.STORY)

        prochain = module._prochain_palier([loin, proche])

        assert prochain is not None
        assert prochain.tier_id == proche.tier_id

    async def test_a_egalite_l_echelle_du_produit_tranche(self, session: AsyncSession) -> None:
        """Story, puis post, puis reel. Sans ce départage, l'ordre viendrait de
        celui des lignes en base, qui ne veut rien dire."""
        from app.services import creator_tiers as module

        reel = _palier(obstacles=1, ecart=10, format_=ContentFormat.REEL)
        story = _palier(obstacles=1, ecart=10, format_=ContentFormat.STORY)

        prochain = module._prochain_palier([reel, story])

        assert prochain is not None
        assert prochain.content_format is ContentFormat.STORY

    async def test_un_palier_ouvert_n_est_jamais_le_prochain(self, session: AsyncSession) -> None:
        """Le pendant. Sans lui, une règle qui rendrait le premier palier venu
        passerait les deux tests précédents.

        **Ce test ne distingue pas les deux conditions du filtre, et c'est écrit
        plutôt que masqué.** Retirer `not palier.accessible` le laisse passer :
        un palier accessible ne porte pas d'obstacle, et la seconde condition
        l'écarte déjà. Fabriquer un palier accessible **avec** obstacles
        éprouverait un état que l'éligibilité ne produit pas — un décor qui ne
        prouve rien du produit d'aujourd'hui. La redondance est donc gardée et
        documentée dans le service, pas éprouvée ici.
        """
        from app.services import creator_tiers as module

        ouvert = _palier(obstacles=0, ecart=0, format_=ContentFormat.STORY, accessible=True)

        assert module._prochain_palier([ouvert]) is None

    async def test_le_compte_dans_le_rayon_reste_nul_sans_position(
        self, session: AsyncSession
    ) -> None:
        """`None` et non zéro : « aucun salon autour de vous » est faux quand on
        n'a rien demandé, et c'est la phrase que l'écran tairait à tort."""
        from app.services import creator_tiers as module

        ferme = _palier(obstacles=1, ecart=10, format_=ContentFormat.STORY)

        prochain = module._prochain_palier([ferme])

        assert prochain is not None
        assert prochain.commerces_dans_le_rayon is None


def _palier(*, obstacles: int, ecart: int, format_, accessible: bool = False):
    """Un palier vu, réduit à ce que le classement regarde."""
    from app.services import creator_tiers as module
    from app.services import eligibility

    return module.PalierVu(
        tier_id=uuid.uuid4(),
        platform=Platform.INSTAGRAM,
        content_format=format_,
        min_followers=0,
        min_completed_collabs=0,
        min_reliability_score=None,
        value_ratio_hint=None,
        display_order=0,
        accessible=accessible,
        social_account_id=None,
        obstacles=tuple(
            eligibility.Obstacle(
                raison=eligibility.RaisonRefus.NOT_ENOUGH_FOLLOWERS,
                requis=ecart,
                constate=0,
                ecart=ecart,
            )
            for _ in range(obstacles)
        ),
        offres_disponibles=0,
        offres_dans_le_rayon=None,
        commerces_dans_le_rayon=None,
    )
