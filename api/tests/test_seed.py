"""Jeu de données de départ.

La commande est lancée pour de vrai, dans un sous-processus, contre une base
jetable qui n'est pas celle de la suite : elle efface tout avant d'écrire, la
faire tourner sur la base de test emporterait le schéma sous les autres tests.

Ce qu'on vérifie surtout, c'est que le jeu obtenu satisfait les invariants sans
exception ni contournement — c'est leur premier vrai test à l'échelle.
"""

import os
import subprocess
import sys
import uuid

import psycopg
import pytest
import sqlalchemy as sa
from psycopg import sql
from sqlalchemy import make_url
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import API_ROOT, get_settings
from app.models import (
    AuditLog,
    Business,
    BusinessMember,
    CapacityException,
    CapacityRule,
    CatalogItem,
    CreatorProfile,
    SocialAccount,
    SocialMetricsSnapshot,
    Tier,
    TierOffer,
    User,
)
from app.models.enums import (
    ActorKind,
    BusinessMemberRole,
    BusinessStatus,
    SocialAccountStatus,
    UserRole,
    VerificationStatus,
)
from app.seed import MOT_DE_PASSE, SeedRefused
from tests.conftest import _maintenance_dsn


@pytest.fixture(scope="module")
def base_jetable(test_database_url: str) -> str:
    """Une base à part, créée et détruite ici. Surtout pas celle de la suite."""
    url = make_url(test_database_url).set(database="bind_seed_probe")
    dsn = _maintenance_dsn(url)
    drop = sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(url.database))

    with psycopg.connect(dsn, autocommit=True) as connection:
        connection.execute(drop)
        connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(url.database)))

    yield url.render_as_string(hide_password=False)

    with psycopg.connect(dsn, autocommit=True) as connection:
        connection.execute(drop)


def _lancer(database_url: str, *, environnement: str = "test") -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "app.seed"],
        cwd=API_ROOT,
        env={
            **os.environ,
            "DATABASE_URL": database_url,
            "ENVIRONMENT": environnement,
            "JWT_SECRET_KEY": get_settings().jwt_secret_key.get_secret_value(),
        },
        capture_output=True,
        text=True,
        check=False,
    )


@pytest.fixture(scope="module")
def jeu_pose(base_jetable: str) -> str:
    """La commande est lancée deux fois : la seconde prouve qu'elle est rejouable."""
    premier = _lancer(base_jetable)
    assert premier.returncode == 0, premier.stderr

    second = _lancer(base_jetable)
    assert second.returncode == 0, second.stderr

    return base_jetable


@pytest.fixture
async def seed_conn(jeu_pose: str) -> AsyncConnection:
    engine = create_async_engine(jeu_pose, poolclass=NullPool)
    async with engine.connect() as connection:
        yield connection
    await engine.dispose()


# --------------------------------------------------------------------------
# la commande
# --------------------------------------------------------------------------


def test_la_commande_refuse_hors_environnement_jetable(base_jetable: str) -> None:
    """Elle efface la base avant d'écrire : ailleurs qu'en local, elle ne tourne pas."""
    resultat = _lancer(base_jetable, environnement="production")

    assert resultat.returncode != 0
    assert "production" in resultat.stderr
    assert SeedRefused.__name__ in resultat.stderr


def test_la_commande_est_rejouable(jeu_pose: str) -> None:
    """Le double passage de la fixture suffit : elle repart d'une base propre."""
    assert jeu_pose


def test_elle_annonce_ce_qu_elle_a_pose(base_jetable: str) -> None:
    resultat = _lancer(base_jetable)

    assert "3 commerces" in resultat.stdout
    assert "10 offres" in resultat.stdout
    assert MOT_DE_PASSE in resultat.stdout


# --------------------------------------------------------------------------
# ce que le jeu contient
# --------------------------------------------------------------------------


async def test_trois_commerces_actifs_et_geolocalises(seed_conn: AsyncConnection) -> None:
    lignes = (
        await seed_conn.execute(
            sa.select(Business.name, Business.status, Business.currency, Business.timezone)
            .where(Business.geo.is_not(None))
            .order_by(Business.name)
        )
    ).all()

    assert len(lignes) == 3
    for ligne in lignes:
        assert ligne.status == BusinessStatus.ACTIVE
        assert ligne.currency == "USD"
        assert ligne.timezone == "America/New_York"


async def test_chaque_commerce_a_son_owner(seed_conn: AsyncConnection) -> None:
    lignes = (
        await seed_conn.execute(sa.select(BusinessMember.business_id, BusinessMember.role))
    ).all()

    assert len(lignes) == 3
    assert {ligne.role for ligne in lignes} == {BusinessMemberRole.OWNER}


async def test_les_trois_commerces_different_sur_ce_qui_compte(
    seed_conn: AsyncConnection,
) -> None:
    """Un jeu uniforme ne révélerait rien en phase 5."""
    avec_variantes = await seed_conn.scalar(
        sa.select(sa.func.count(sa.distinct(CatalogItem.business_id))).where(
            CatalogItem.parent_item_id.is_not(None)
        )
    )
    assert avec_variantes == 1

    sans_reservation = await seed_conn.scalar(
        sa.select(sa.func.count(sa.distinct(CatalogItem.business_id))).where(
            CatalogItem.requires_booking.is_(False), CatalogItem.parent_item_id.is_(None)
        )
    )
    assert sans_reservation >= 1

    postes_max = await seed_conn.scalar(sa.select(sa.func.max(CapacityRule.concurrent_slots)))
    assert postes_max > 1

    avec_exception = await seed_conn.scalar(
        sa.select(sa.func.count(sa.distinct(CapacityException.business_id)))
    )
    assert avec_exception == 1


async def test_une_journee_est_coupee_a_midi(seed_conn: AsyncConnection) -> None:
    par_jour = (
        await seed_conn.execute(
            sa.select(CapacityRule.business_id, CapacityRule.weekday, sa.func.count())
            .group_by(CapacityRule.business_id, CapacityRule.weekday)
            .having(sa.func.count() > 1)
        )
    ).all()

    assert par_jour, "aucun commerce n'a de journée en deux plages"


async def test_une_fermeture_et_une_journee_amenagee(seed_conn: AsyncConnection) -> None:
    exceptions = (
        await seed_conn.execute(
            sa.select(
                CapacityException.is_closed,
                CapacityException.start_time,
                CapacityException.concurrent_slots,
            ).order_by(CapacityException.date)
        )
    ).all()

    assert len(exceptions) == 2
    amenagee, fermeture = exceptions
    assert fermeture.is_closed is True
    assert (fermeture.start_time, fermeture.concurrent_slots) == (None, None)
    assert amenagee.is_closed is False
    assert amenagee.start_time is not None
    assert amenagee.concurrent_slots is not None


async def test_tous_les_createurs_sont_en_cold_start(seed_conn: AsyncConnection) -> None:
    """Et ce n'est pas un choix de mise en scène : c'est le seul état que le
    produit sache produire aujourd'hui.

    Ce test affirmait auparavant l'inverse — « au moins un créateur a un
    historique » — et il passait, parce que le jeu de données posait les scores
    à la main. Il validait une fiction. Rien n'écrit encore `reliability_score`
    ni `completed_collabs_count` : c'est la phase 8.

    Il échouera le jour où le mécanisme arrivera, et c'est voulu : ce jour-là,
    le jeu de données doit changer.
    """
    profils = (
        await seed_conn.execute(
            sa.select(
                CreatorProfile.reliability_score,
                CreatorProfile.completed_collabs_count,
                CreatorProfile.is_new_creator,
            )
        )
    ).all()

    assert len(profils) == 3
    for profil in profils:
        # Nul veut dire neutre, jamais zéro : le moteur de paliers l'ignore au
        # lieu de le comparer à un seuil.
        assert profil.reliability_score is None
        assert profil.completed_collabs_count == 0
        assert profil.is_new_creator is True


async def test_chaque_compte_est_verifie_par_le_mecanisme(seed_conn: AsyncConnection) -> None:
    """Ce test disait l'inverse à la tâche précédente, et c'était le bon constat
    à ce moment-là : rien ne faisait passer un compte en `verified`, donc aucun
    créateur n'accédait à rien.

    Le contrôle de cohérence existe maintenant, et il s'enchaîne au relevé de
    métriques. Le statut n'est toujours pas posé par le jeu de données — il est
    obtenu — et la preuve est la ligne de journal : acteur `system`, avec son
    motif.
    """
    statuts = set(await seed_conn.scalars(sa.select(SocialAccount.verification_status).distinct()))
    assert statuts == {VerificationStatus.VERIFIED.value}

    transitions = (
        await seed_conn.execute(
            sa.select(
                AuditLog.from_status, AuditLog.to_status, AuditLog.actor_kind, AuditLog.reason
            ).where(AuditLog.entity_type == "social_account")
        )
    ).all()

    assert len(transitions) == 3
    for transition in transitions:
        assert transition.from_status == VerificationStatus.NEEDS_REVIEW.value
        assert transition.to_status == VerificationStatus.VERIFIED.value
        # Personne ne l'a demandé, le système l'a décidé — et il dit pourquoi.
        assert transition.actor_kind == ActorKind.SYSTEM.value
        assert transition.reason


async def test_un_compte_administrateur_existe(seed_conn: AsyncConnection) -> None:
    combien = await seed_conn.scalar(
        sa.select(sa.func.count()).select_from(User).where(User.role == UserRole.ADMIN)
    )
    assert combien == 1


async def test_les_transitions_sont_journalisees(seed_conn: AsyncConnection) -> None:
    """Le jeu passe par les services : il produit les mêmes traces que l'API."""
    par_entite = dict(
        (
            await seed_conn.execute(
                sa.select(AuditLog.entity_type, sa.func.count()).group_by(AuditLog.entity_type)
            )
        ).all()
    )

    # Trois créations plus trois activations.
    assert par_entite["business"] == 6
    # Un administrateur, trois propriétaires, trois créateurs.
    assert par_entite["app_user"] == 7


# --------------------------------------------------------------------------
# les invariants tiennent sur le jeu obtenu
# --------------------------------------------------------------------------


async def test_aucun_parent_n_est_reservable(seed_conn: AsyncConnection) -> None:
    reservables = await seed_conn.scalar(
        sa.select(sa.func.count())
        .select_from(CatalogItem)
        .where(
            CatalogItem.requires_booking.is_(True),
            CatalogItem.id.in_(
                sa.select(CatalogItem.parent_item_id).where(CatalogItem.parent_item_id.is_not(None))
            ),
        )
    )
    assert reservables == 0


async def test_aucune_variante_de_variante(seed_conn: AsyncConnection) -> None:
    petits_enfants = await seed_conn.scalar(
        sa.select(sa.func.count())
        .select_from(CatalogItem)
        .where(
            CatalogItem.parent_item_id.in_(
                sa.select(CatalogItem.id).where(CatalogItem.parent_item_id.is_not(None))
            )
        )
    )
    assert petits_enfants == 0


async def test_aucune_plage_ne_se_chevauche(seed_conn: AsyncConnection) -> None:
    """La contrainte d'exclusion l'aurait refusé, ce test le dit à l'endroit du jeu."""
    gauche = sa.orm.aliased(CapacityRule)
    droite = sa.orm.aliased(CapacityRule)

    chevauchements = await seed_conn.scalar(
        sa.select(sa.func.count())
        .select_from(gauche)
        .join(
            droite,
            sa.and_(
                gauche.business_id == droite.business_id,
                gauche.weekday == droite.weekday,
                gauche.id != droite.id,
                gauche.start_time < droite.end_time,
                gauche.end_time > droite.start_time,
            ),
        )
    )
    assert chevauchements == 0


async def test_toute_duree_suit_la_reservabilite(seed_conn: AsyncConnection) -> None:
    incoherents = await seed_conn.scalar(
        sa.select(sa.func.count())
        .select_from(CatalogItem)
        .where(CatalogItem.requires_booking != CatalogItem.duration_minutes.is_not(None))
    )
    assert incoherents == 0


async def test_tous_les_comptes_peuvent_se_connecter(seed_conn: AsyncConnection) -> None:
    sans_empreinte = await seed_conn.scalar(
        sa.select(sa.func.count())
        .select_from(User)
        .where(User.password_hash.is_(None), User.email.is_not(None))
    )
    assert sans_empreinte == 0


async def test_aucun_identifiant_n_est_devinable(seed_conn: AsyncConnection) -> None:
    """Rien de séquentiel : les identifiants circulent dans des URL."""
    identifiants = list(await seed_conn.scalars(sa.select(Business.id)))

    assert len(identifiants) == 3
    for identifiant in identifiants:
        assert isinstance(identifiant, uuid.UUID)
        assert identifiant.version == 4


# --------------------------------------------------------------------------
# les offres composées
# --------------------------------------------------------------------------


async def test_chaque_commerce_compose_ses_offres(seed_conn: AsyncConnection) -> None:
    par_commerce = dict(
        (
            await seed_conn.execute(
                sa.select(TierOffer.business_id, sa.func.count()).group_by(TierOffer.business_id)
            )
        ).all()
    )

    assert len(par_commerce) == 3
    assert sum(par_commerce.values()) == 10
    assert len(set(par_commerce.values())) > 1, "des offres identiques ne révèlent rien"


async def test_un_commerce_ne_propose_rien_au_palier_story(seed_conn: AsyncConnection) -> None:
    """Un créateur limité à ce palier ne doit rien voir chez lui."""
    story = sa.select(Tier.id).where(Tier.content_format == "story")
    avec_story = set(
        await seed_conn.scalars(
            sa.select(TierOffer.business_id).where(TierOffer.tier_id.in_(story))
        )
    )
    tous = set(await seed_conn.scalars(sa.select(TierOffer.business_id)))

    assert len(tous - avec_story) >= 1


async def test_un_item_est_propose_a_deux_paliers(seed_conn: AsyncConnection) -> None:
    """Le fil de la phase 5 devra présenter le meilleur palier accessible."""
    doublons = (
        await seed_conn.execute(
            sa.select(TierOffer.catalog_item_id, sa.func.count())
            .group_by(TierOffer.catalog_item_id)
            .having(sa.func.count() > 1)
        )
    ).all()

    assert doublons, "aucun item n'est proposé à plusieurs paliers"


async def test_un_item_sans_reservation_est_propose(seed_conn: AsyncConnection) -> None:
    combien = await seed_conn.scalar(
        sa.select(sa.func.count())
        .select_from(TierOffer)
        .join(CatalogItem, CatalogItem.id == TierOffer.catalog_item_id)
        .where(CatalogItem.requires_booking.is_(False))
    )
    assert combien >= 1


async def test_aucune_offre_ne_porte_un_parent(seed_conn: AsyncConnection) -> None:
    """L'invariant du catalogue se prolonge dans la composition."""
    parents = sa.select(CatalogItem.parent_item_id).where(CatalogItem.parent_item_id.is_not(None))
    combien = await seed_conn.scalar(
        sa.select(sa.func.count())
        .select_from(TierOffer)
        .where(TierOffer.catalog_item_id.in_(parents))
    )
    assert combien == 0


async def test_aucune_offre_sur_un_palier_inactif(seed_conn: AsyncConnection) -> None:
    inactifs = sa.select(Tier.id).where(Tier.is_active.is_(False))
    combien = await seed_conn.scalar(
        sa.select(sa.func.count()).select_from(TierOffer).where(TierOffer.tier_id.in_(inactifs))
    )
    assert combien == 0


async def test_chaque_createur_a_un_compte_social_et_un_releve(
    seed_conn: AsyncConnection,
) -> None:
    """Obtenus par le parcours OAuth et le service de métriques, pas posés.

    C'est ce qui donne sa valeur au test précédent : si le compte social était
    inséré directement, son `verification_status` ne dirait rien du produit.
    """
    lignes = (
        await seed_conn.execute(
            sa.select(
                SocialAccount.handle,
                SocialAccount.status,
                SocialMetricsSnapshot.followers_count,
                SocialMetricsSnapshot.audience_demographics,
            ).join(
                SocialMetricsSnapshot,
                SocialMetricsSnapshot.social_account_id == SocialAccount.id,
            )
        )
    ).all()

    assert len(lignes) == 3
    for ligne in lignes:
        assert ligne.status == SocialAccountStatus.ACTIVE.value
        assert ligne.followers_count > 0
        assert ligne.audience_demographics is not None

    # Le jeton, lui, se lit en SQL nu : passer par la colonne de l'ORM la ferait
    # déchiffrer au vol, et le test ne prouverait plus rien.
    jetons = list(
        await seed_conn.scalars(sa.text("SELECT access_token_encrypted FROM social_account"))
    )
    assert len(jetons) == 3
    for jeton in jetons:
        assert b"jeton-local" not in bytes(jeton)


async def test_les_etats_oauth_du_jeu_sont_tous_consommes(seed_conn: AsyncConnection) -> None:
    """Le montage emprunte le vrai parcours, il en laisse donc les traces : un
    état par créateur, chacun consommé une fois."""
    restants = await seed_conn.scalar(
        sa.select(sa.func.count()).select_from(sa.table("oauth_state"))
    )
    consommes = await seed_conn.scalar(
        sa.text("SELECT count(*) FROM oauth_state WHERE consumed_at IS NOT NULL")
    )
    assert restants == 3
    assert consommes == 3
