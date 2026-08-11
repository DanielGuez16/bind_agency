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
from app.models import CreatorProfile, SocialAccount, Tier
from app.models.enums import (
    Platform,
    ReliabilityEventType,
    SocialAccountStatus,
    UserRole,
    VerificationStatus,
)
from app.services import auth as auth_service
from app.services import creator_tiers as service
from app.services import metrics as metrics_service
from app.services import reliability
from app.services.eligibility import RaisonRefus
from tests.test_social_metrics import FauxFournisseur, metriques

PREFIX = get_settings().api_v1_prefix

STORY = uuid.UUID("8f9bfcd8-39ff-41a3-9b6b-f00e40f8774d")  # instagram/story, 1000 abonnes
REEL = uuid.UUID("a839969b-3965-4c7e-92b1-b6274f899162")  # instagram/reel, 10000 abonnes


async def createur(session: AsyncSession):
    return await auth_service.register(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password="un-mot-de-passe-solide-42",
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
        email, password = f"{uuid.uuid4()}@example.com", "un-mot-de-passe-solide-42"
        await client.post(
            f"{PREFIX}/auth/register",
            json={"email": email, "password": password, "role": role.value},
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
    email, password = f"{uuid.uuid4()}@example.com", "un-mot-de-passe-solide-42"
    await client.post(
        f"{PREFIX}/auth/register",
        json={"email": email, "password": password, "role": UserRole.CREATOR.value},
    )
    jetons = (
        await client.post(f"{PREFIX}/auth/login", json={"email": email, "password": password})
    ).json()
    entetes = {"Authorization": f"Bearer {jetons['access_token']}"}

    corps = (await client.get(f"{PREFIX}/me/tiers", headers=entetes)).json()

    assert "fiabilite" in corps, "le champ se perd entre le service et la route"
    assert corps["fiabilite"] == {"reliability_score": None, "completed_collabs_count": 0}
