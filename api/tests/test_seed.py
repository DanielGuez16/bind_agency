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
from datetime import UTC, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import psycopg
import pytest
import sqlalchemy as sa
from cryptography.fernet import Fernet
from psycopg import sql
from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy import make_url
from sqlalchemy.ext.asyncio import AsyncConnection, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app import seed
from app.core.config import API_ROOT, get_settings
from app.models import (
    AuditLog,
    Booking,
    Business,
    BusinessMember,
    CapacityException,
    CapacityRule,
    CatalogItem,
    Collaboration,
    CreatorProfile,
    Job,
    PlatformAsset,
    SocialAccount,
    SocialMetricsSnapshot,
    SubscriptionPlan,
    Tier,
    TierOffer,
    User,
)
from app.models.enums import (
    ActorKind,
    BillingInterval,
    BookingStatus,
    BusinessCategory,
    BusinessMemberRole,
    BusinessStatus,
    CollaborationStatus,
    JobStatus,
    SocialAccountStatus,
    UserRole,
    VerificationStatus,
)
from app.seed import (
    ENVIRONNEMENTS_AUTORISES,
    MOT_DE_PASSE,
    SeedRefused,
    verifier_la_cible,
)
from tests.conftest import _maintenance_dsn

#: Ce que le semis produit, **dérivé de lui** et non recopié.
#:
#: Ces tests comptaient « 4 commerces » et « 3 actifs ». Le jour où le jeu de
#: données est passé à vingt, huit d'entre eux sont tombés d'un coup sur des
#: nombres qui ne disaient plus rien de ce qu'ils protégeaient. Un compte écrit
#: en dur se périme au premier salon ajouté ; celui-ci suit.
#:
#: Les quatre écrits à la main, plus le marché. `Havana Glow` reste en
#: onboarding — c'est son rôle — donc les actifs sont un de moins.
COMMERCES = 4 + len(seed.MARCHE)
ACTIFS = COMMERCES - 1

#: Les offres des quatre écrits à la main, plus celles du marché.
OFFRES = 10 + sum(len(fiche.offres) for fiche in seed.MARCHE)

#: Un administrateur, un propriétaire par commerce, cinq créateurs.
COMPTES = 1 + COMMERCES + 5


@pytest.fixture(scope="module")
def base_jetable(test_database_url: str) -> str:
    """Une base à part, créée et détruite ici. Surtout pas celle de la suite.

    **Son nom dérive de la base de test**, il n'est pas fixe. Deux copies de
    travail sur le même Postgres — le cas normal quand deux personnes ou deux
    sessions avancent en parallèle — se détruisaient cette base l'une à
    l'autre : chacune commence par `DROP DATABASE ... WITH (FORCE)`, et la
    seconde emportait la sonde de la première entre sa création et son premier
    appel. L'échec ressortait en « database does not exist » sur du code qui
    n'avait pas bougé.

    Changer `TEST_DATABASE_URL` ne suffisait pas : ce nom-ci était en dur.
    """
    url = make_url(test_database_url)
    url = url.set(database=f"{url.database}_seed_probe")
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

    assert f"{COMMERCES} commerces" in resultat.stdout
    assert f"{OFFRES} offres" in resultat.stdout
    # Le résumé annonce aussi ce que la démonstration a produit : un jeu qui
    # poserait zéro contrepartie se verrait ici, pas trois écrans plus loin.
    assert "5 créateurs" in resultat.stdout
    assert "contreparties" in resultat.stdout
    assert MOT_DE_PASSE in resultat.stdout


def test_elle_distingue_les_vraies_photos_des_degrades(base_jetable: str) -> None:
    """Le décompte des deux, et les chemins de ce qui manque.

    Ce test tient dans les deux situations, et c'est voulu : ici les photos
    peuvent être présentes, en intégration continue elles ne le sont jamais.
    Ce qu'il vérifie, c'est que le semis **dit** dans quel cas il est — sans
    quoi personne ne saurait qu'il regarde des dégradés.
    """
    resultat = _lancer(base_jetable)

    assert "fournies" in resultat.stdout
    assert "générées faute de fichier" in resultat.stdout

    if "0 générées" not in resultat.stdout:
        # Le cas de l'intégration continue : chaque absence est nommée, avec un
        # chemin utilisable tel quel. Un décompte seul n'apprendrait pas quoi
        # aller chercher.
        assert "Fichiers absents de assets/photos/" in resultat.stdout
        assert ".jpg" in resultat.stdout


def test_aucun_media_n_est_trop_lourd(base_jetable: str) -> None:
    """Un média de quarante mégaoctets laisse l'écran vide sur un réseau mobile.

    Le semis ne refuse rien — il n'a pas à décider qu'une démonstration ne peut
    pas avoir lieu — mais il le dit, et ce test fait de ce signalement une
    condition et non une remarque à lire dans un journal.
    """
    resultat = _lancer(base_jetable)

    assert "Médias lourds" not in resultat.stdout, resultat.stdout


# --------------------------------------------------------------------------
# ce que le jeu contient
# --------------------------------------------------------------------------


async def test_les_commerces_sont_geolocalises_et_pas_tous_ouverts(
    seed_conn: AsyncConnection,
) -> None:
    """Trois commerces ouverts, un encore en inscription.

    Ce dernier est l'état de tout commerce le jour où il arrive : sans lui,
    l'écran d'activation, l'état vide du catalogue et le reporting à zéro
    n'avaient aucun sujet.
    """
    lignes = (
        await seed_conn.execute(
            sa.select(Business.name, Business.status, Business.currency, Business.timezone)
            .where(Business.geo.is_not(None))
            .order_by(Business.name)
        )
    ).all()

    assert len(lignes) == COMMERCES
    par_statut = {ligne.status for ligne in lignes}
    assert par_statut == {BusinessStatus.ACTIVE, BusinessStatus.ONBOARDING}
    assert sum(1 for ligne in lignes if ligne.status == BusinessStatus.ACTIVE) == ACTIFS

    for ligne in lignes:
        assert ligne.currency == "USD"
        assert ligne.timezone == "America/New_York"


async def test_chaque_commerce_a_son_owner(seed_conn: AsyncConnection) -> None:
    lignes = (
        await seed_conn.execute(sa.select(BusinessMember.business_id, BusinessMember.role))
    ).all()

    assert len(lignes) == COMMERCES
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


async def test_les_createurs_ne_sont_plus_tous_en_cold_start(
    seed_conn: AsyncConnection,
) -> None:
    """Ce test affirmait l'inverse, et il avait raison à ce moment-là.

    Il disait « tous les créateurs sont en démarrage à froid », parce que rien
    n'écrivait encore `reliability_score` ni `completed_collabs_count`. Le
    moteur de fiabilité existe depuis la phase 8, et la démonstration produit
    maintenant de vraies collaborations : le jeu doit changer, et ce test avec
    lui. C'était annoncé.

    Ce qui ne change pas : **un score nul veut dire neutre, jamais zéro**. Les
    créateurs sans historique en gardent un, et le moteur de paliers l'ignore
    au lieu de le comparer à un seuil.
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

    assert len(profils) == 5

    avec_score = [p for p in profils if p.reliability_score is not None]
    sans_score = [p for p in profils if p.reliability_score is None]

    # Les deux populations existent : sans historique, et avec.
    assert avec_score, "aucun créateur n'a de score : le moteur ne produit plus rien"
    assert sans_score, "aucun créateur en démarrage à froid : l'écran du débutant est vide"

    # Un bon et un dégradé, sinon l'effet du score ne se démontre pas.
    scores = sorted(p.reliability_score for p in avec_score)
    assert scores[-1] - scores[0] > 20

    assert any(p.completed_collabs_count > 0 for p in profils)
    assert all(p.completed_collabs_count == 0 for p in sans_score)


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

    # Les deux issues du contrôle, obtenues et non posées : la plupart des
    # comptes passent, un reste en revue parce qu'il lui manque un signal.
    assert statuts == {
        VerificationStatus.VERIFIED.value,
        VerificationStatus.NEEDS_REVIEW.value,
    }

    transitions = (
        await seed_conn.execute(
            sa.select(
                AuditLog.from_status, AuditLog.to_status, AuditLog.actor_kind, AuditLog.reason
            ).where(AuditLog.entity_type == "social_account")
        )
    ).all()

    assert transitions, "aucune transition journalisée : le contrôle ne prononce plus rien"
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

    # Quatre créations, trois activations — le commerce encore en inscription
    # n'en a pas — trois ouvertures de période de grâce, une par activation, et
    # deux souscriptions d'abonnement, journalisées sous la même entité.
    #
    # Les deux commerces qui souscrivent ont bien eu leur grâce ouverte
    # d'abord : le jeu de données les active avant de les abonner, comme un
    # vrai salon le ferait. Souscrire referme l'échéance sans effacer la trace
    # de son ouverture — le journal dit ce qui s'est passé, pas ce qui reste.
    assert par_entite["business"] == COMMERCES * 3
    # Un administrateur, quatre propriétaires, cinq créateurs.
    assert par_entite["app_user"] == COMPTES
    # Et les entités de la démonstration laissent aussi leurs traces : sans
    # elles, le jeu aurait posé des états sans passer par les services.
    assert par_entite["booking"] > 0
    assert par_entite["collaboration"] > 0


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
    """Et « se connecter » veut dire par l'API, pas « avoir une empreinte ».

    Ce test ne regardait que `password_hash` et concluait que les comptes
    étaient utilisables. Ils ne l'étaient pas : le jeu employait un domaine en
    `.test`, que la validation d'adresse refuse comme nom d'usage spécial, et
    les comptes créés par le service ne passaient jamais par le schéma. Le
    défaut ne s'est vu qu'en ouvrant le serveur à la main.

    Il vérifie maintenant que chaque adresse **franchit la validation d'entrée**
    — la seule porte par laquelle une connexion arrive.
    """
    sans_empreinte = await seed_conn.scalar(
        sa.select(sa.func.count())
        .select_from(User)
        .where(User.password_hash.is_(None), User.email.is_not(None))
    )
    assert sans_empreinte == 0

    adresses = list(await seed_conn.scalars(sa.select(User.email).where(User.email.is_not(None))))
    assert adresses

    validateur = TypeAdapter(EmailStr)
    refusees = []
    for adresse in adresses:
        try:
            validateur.validate_python(adresse)
        except ValidationError:
            refusees.append(adresse)

    assert refusees == []


async def test_aucun_identifiant_n_est_devinable(seed_conn: AsyncConnection) -> None:
    """Rien de séquentiel : les identifiants circulent dans des URL."""
    identifiants = list(await seed_conn.scalars(sa.select(Business.id)))

    assert len(identifiants) == COMMERCES
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

    assert len(par_commerce) == ACTIFS
    assert sum(par_commerce.values()) == OFFRES
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

    assert len(lignes) == 5
    for ligne in lignes:
        # Un compte est expiré : c'est un état voulu, pas un défaut.
        assert ligne.status in {
            SocialAccountStatus.ACTIVE.value,
            SocialAccountStatus.EXPIRED.value,
        }
        assert ligne.followers_count > 0
        assert ligne.audience_demographics is not None

    assert any(ligne.status == SocialAccountStatus.EXPIRED.value for ligne in lignes)

    # Le jeton, lui, se lit en SQL nu : passer par la colonne de l'ORM la ferait
    # déchiffrer au vol, et le test ne prouverait plus rien.
    jetons = list(
        await seed_conn.scalars(sa.text("SELECT access_token_encrypted FROM social_account"))
    )
    assert len(jetons) == 5
    for jeton in jetons:
        assert b"demo-instagram" not in bytes(jeton)


async def test_les_etats_oauth_du_jeu_sont_tous_consommes(seed_conn: AsyncConnection) -> None:
    """Le montage emprunte le vrai parcours, il en laisse donc les traces : un
    état par créateur, chacun consommé une fois."""
    restants = await seed_conn.scalar(
        sa.select(sa.func.count()).select_from(sa.table("oauth_state"))
    )
    consommes = await seed_conn.scalar(
        sa.text("SELECT count(*) FROM oauth_state WHERE consumed_at IS NOT NULL")
    )
    assert restants == 5
    assert consommes == 5


# --------------------------------------------------------------------------
# ce que la démonstration doit montrer
#
# Le jeu de départ éprouvait les invariants. Il doit maintenant permettre de
# parcourir le produit **sans qu'aucune étape ne soit vide ou cassée** : chaque
# test ci-dessous nomme un écran qui n'avait aucun sujet avant.
# --------------------------------------------------------------------------


async def test_les_createurs_couvrent_leurs_cinq_etats(seed_conn: AsyncConnection) -> None:
    """Cinq états, cinq écrans d'accueil différents.

    Sans eux, quatre de ces écrans ne se voient jamais — et ce sont ceux qu'on
    a le moins l'occasion de vérifier.
    """
    lignes = (
        await seed_conn.execute(
            sa.select(
                SocialAccount.status,
                SocialAccount.verification_status,
                CreatorProfile.reliability_score,
                SocialAccount.token_expires_at,
            ).join(CreatorProfile, CreatorProfile.user_id == SocialAccount.creator_id)
        )
    ).all()

    assert len(lignes) >= 5

    statuts = {ligne.status for ligne in lignes}
    verifications = {ligne.verification_status for ligne in lignes}
    scores = [ligne.reliability_score for ligne in lignes if ligne.reliability_score is not None]

    # Une autorisation expirée, un compte en contrôle, des comptes actifs.
    assert SocialAccountStatus.EXPIRED in statuts
    assert SocialAccountStatus.ACTIVE in statuts
    assert VerificationStatus.NEEDS_REVIEW in verifications
    assert VerificationStatus.VERIFIED in verifications

    # Un bon score et un score dégradé : les deux doivent exister, sinon
    # l'effet du score sur les paliers ne se démontre pas.
    assert len(scores) >= 2
    assert max(scores) - min(scores) > 20


async def test_les_reservations_couvrent_leurs_etats(seed_conn: AsyncConnection) -> None:
    """Y compris une absence et une annulation, qui ne se produisent qu'en
    remplissant leurs conditions — la règle des vingt-quatre heures transforme
    une annulation tardive en absence."""
    statuts = set((await seed_conn.execute(sa.select(Booking.status).distinct())).scalars().all())

    for attendu in (
        BookingStatus.HELD,
        BookingStatus.CONFIRMED,
        BookingStatus.CONSUMED,
        BookingStatus.CANCELLED,
        BookingStatus.NO_SHOW,
    ):
        assert attendu in statuts, attendu


async def test_les_contreparties_couvrent_leurs_etats(seed_conn: AsyncConnection) -> None:
    """Dont une en deuxième tentative et une en revue humaine.

    Ce sont les deux que le back office sert à traiter : sans elles, la file
    d'arbitrage est vide et l'écran ne se démontre pas.
    """
    lignes = (
        await seed_conn.execute(
            sa.select(
                Collaboration.status, Collaboration.attempts_count, Collaboration.needs_human_review
            )
        )
    ).all()

    statuts = {ligne.status for ligne in lignes}
    for attendu in (
        CollaborationStatus.PENDING,
        CollaborationStatus.SUBMITTED,
        CollaborationStatus.APPROVED,
        CollaborationStatus.RESUBMIT_REQUESTED,
        CollaborationStatus.UNFULFILLED,
    ):
        assert attendu in statuts, attendu

    assert any(ligne.attempts_count == 1 for ligne in lignes), "aucune deuxième tentative"
    assert any(ligne.needs_human_review for ligne in lignes), "aucun dossier à arbitrer"


async def test_un_job_epuise_attend_dans_le_back_office(seed_conn: AsyncConnection) -> None:
    """Obtenu en faisant échouer le job autant de fois que la configuration
    l'autorise, pas en posant son statut."""
    lignes = (await seed_conn.execute(sa.select(Job.status, Job.attempts))).all()

    epuises = [ligne for ligne in lignes if ligne.status == JobStatus.EXHAUSTED]
    assert epuises, "le back office n'a aucun job à montrer"
    assert epuises[0].attempts > 1, "un job épuisé sans tentative n'a pas été essayé"


#: Les deux formes qu'une clé de photo peut prendre. Le suffixe `genere/` dit
#: qu'aucun fichier n'a été trouvé et qu'un dégradé a pris la place — c'est
#: toujours le cas en intégration continue, où `assets/photos/` est vide.
def _clef_de_photo(cle: str, famille: str) -> bool:
    return cle.startswith((f"photos/{famille}/", f"photos/genere/{famille}/"))


async def test_les_photos_sont_posees_et_relisibles(seed_conn: AsyncConnection) -> None:
    """Une clé sans objet derrière laisserait un repli d'image partout."""
    couvertures = (
        (
            await seed_conn.execute(
                sa.select(Business.cover_photo_key).where(Business.cover_photo_key.is_not(None))
            )
        )
        .scalars()
        .all()
    )

    assert couvertures, "aucun commerce n'a de couverture"
    assert all(_clef_de_photo(cle, "business") for cle in couvertures)

    items = (
        (
            await seed_conn.execute(
                sa.select(CatalogItem.photo_key).where(CatalogItem.photo_key.is_not(None))
            )
        )
        .scalars()
        .all()
    )
    assert items, "aucune prestation n'a de photo"
    assert all(_clef_de_photo(cle, "item") for cle in items)


async def test_seule_la_gamme_parente_reste_sans_photo(seed_conn: AsyncConnection) -> None:
    """Tout ce qui s'affiche porte une image, et rien d'autre.

    Restreindre aux prestations réservables laissait sans photo le vernis à
    emporter de Wynwood — pourtant proposé au palier TikTok, donc bien présent
    dans le fil. Ce qui écarte le parent d'une gamme, c'est **ce qu'il est** :
    un item qui a des variantes, et qui ne s'affiche jamais seul.
    """
    parents = sa.select(CatalogItem.parent_item_id).where(CatalogItem.parent_item_id.is_not(None))

    sans_photo = (
        (
            await seed_conn.execute(
                sa.select(CatalogItem.name).where(
                    CatalogItem.photo_key.is_(None), CatalogItem.id.not_in(parents)
                )
            )
        )
        .scalars()
        .all()
    )
    assert not sans_photo, f"des prestations affichables n'ont pas de photo : {sans_photo}"

    gammes = (
        (
            await seed_conn.execute(
                sa.select(CatalogItem.photo_key).where(CatalogItem.id.in_(parents))
            )
        )
        .scalars()
        .all()
    )
    assert gammes, "le jeu n'a plus de gamme à variantes"
    assert all(cle is None for cle in gammes), "un parent de gamme a reçu une image invisible"


async def test_les_six_categories_ont_leur_pastille(seed_conn: AsyncConnection) -> None:
    """Elles n'appartiennent à aucun commerce : sans elles, Discovery n'a pas d'en-tête.

    Les six, et pas seulement celles du lancement : une catégorie sans commerce
    reste un filtre que l'écran propose.
    """
    posees = dict(
        (
            await seed_conn.execute(
                sa.select(PlatformAsset.slug, PlatformAsset.object_key).where(
                    PlatformAsset.slug.startswith("category/")
                )
            )
        ).all()
    )

    assert set(posees) == {f"category/{categorie.value}" for categorie in BusinessCategory}
    assert all(_clef_de_photo(cle, "category") for cle in posees.values())


async def test_l_accueil_a_au_moins_son_affiche(seed_conn: AsyncConnection) -> None:
    """La vidéo peut manquer, l'affiche jamais — c'est elle le substitut."""
    affiche = await seed_conn.scalar(
        sa.select(PlatformAsset.object_key).where(PlatformAsset.slug == "home/video-poster")
    )

    assert affiche is not None
    assert _clef_de_photo(affiche, "home")


async def test_un_commerce_n_a_rien_compose(seed_conn: AsyncConnection) -> None:
    """L'état de tout commerce le jour de son inscription.

    Sans lui, l'écran d'activation, l'état vide du catalogue et le reporting à
    zéro n'ont aucun sujet.
    """
    en_cours = (
        (
            await seed_conn.execute(
                sa.select(Business.id).where(Business.status == BusinessStatus.ONBOARDING)
            )
        )
        .scalars()
        .all()
    )

    assert len(en_cours) == 1
    sans_offre = await seed_conn.scalar(
        sa.select(sa.func.count())
        .select_from(TierOffer)
        .where(TierOffer.business_id == en_cours[0])
    )
    assert sans_offre == 0

    # Et pas de couverture non plus. Lui en poser une le rendait présentable, ce
    # qui contredit le seul état qu'il est là pour montrer : l'écran
    # d'activation lui réclame une photo, il ne peut pas déjà l'avoir.
    couverture = await seed_conn.scalar(
        sa.select(Business.cover_photo_key).where(Business.id == en_cours[0])
    )
    assert couverture is None


async def test_les_dates_sont_proches_d_aujourd_hui(seed_conn: AsyncConnection) -> None:
    """Un jeu figé montre des réservations passées trois mois plus tard, et la
    démonstration commence par une explication."""
    bornes = (
        await seed_conn.execute(
            sa.select(sa.func.min(Booking.created_at), sa.func.max(Booking.created_at))
        )
    ).one()

    maintenant = datetime.now(UTC)
    # **C'est cette moitié-là qui attrape un jeu figé.** Une base semée en mai
    # et regardée en août a forcément une réservation récente si le semis a
    # tourné ; sinon la plus récente a trois mois, et c'est ce qu'on refuse.
    assert (maintenant - bornes[1]) < timedelta(days=2), "la plus récente n'est pas récente"
    # Le plafond est passé de 45 à 100 jours en campagne 2. La série
    # hebdomadaire des rapports porte sur douze semaines : bornée à 45 jours,
    # l'histoire ne pouvait en remplir que six, et l'écran montrait la moitié
    # de ses barres vides quoi qu'on fasse. Le plafond reste — un jeu qui
    # dériverait d'un an se verrait ici — il est seulement mis à la mesure de
    # ce que les écrans doivent montrer.
    assert (maintenant - bornes[0]) < timedelta(days=100), "la plus ancienne est trop vieille"
    # Et elles s'étalent sur plusieurs semaines : un jeu tassé sur quinze jours
    # laissait onze des douze barres vides, ce que la campagne 2 a relevé comme
    # un défaut du graphique — c'en était un du jeu de données.
    assert (bornes[1] - bornes[0]) > timedelta(weeks=8)


async def test_des_plans_d_abonnement_existent(seed_conn: AsyncConnection) -> None:
    """Le back office des plans est le seul écran à montrer des montants ; sans
    plan, il est vide."""
    intervalles = set(
        (await seed_conn.execute(sa.select(SubscriptionPlan.billing_interval).distinct()))
        .scalars()
        .all()
    )
    # Les deux intervalles, pour que la mensualisation se voie à l'écran.
    assert intervalles == {BillingInterval.MONTHLY, BillingInterval.YEARLY}


async def test_une_reservation_attend_le_commerce(seed_conn: AsyncConnection) -> None:
    """L'état neuf de la v0.5 doit être visible à la démonstration.

    Sans lui, la file du commerce est vide et personne ne voit à quoi sert
    l'écran de validation — c'est le genre d'écran qu'on croit cassé.
    """
    combien = await seed_conn.scalar(
        sa.select(sa.func.count())
        .select_from(Booking)
        .where(Booking.status == BookingStatus.AWAITING_BUSINESS)
    )

    assert combien >= 1, "aucune réservation en attente du commerce"


async def test_un_commerce_au_moins_valide_ses_reservations(
    seed_conn: AsyncConnection,
) -> None:
    """Et un autre au moins ne les valide pas : les deux modes se démontrent."""
    modes = set(
        (await seed_conn.execute(sa.select(Business.requires_booking_approval).distinct()))
        .scalars()
        .all()
    )

    assert modes == {True, False}


# --------------------------------------------------------------------------
# Le garde-fou de la cible
# --------------------------------------------------------------------------


def _reglages(**overrides):
    from app.core import config as module_config

    valeurs = {
        "_env_file": None,
        "database_url": "postgresql+psycopg://x:y@ailleurs.example/bind_demo",
        "jwt_secret_key": "peu-importe-ici-mais-assez-longue-pour-hmac",
        "token_encryption_key": "dGVzdC10ZXN0LXRlc3QtdGVzdC10ZXN0LXRlc3QtdGVzdC10ZXN0",
    }
    return module_config.build_settings(**(valeurs | overrides))


@pytest.mark.parametrize("environnement", ["production", "prod", "staging", "", "DEMO"])
def test_un_environnement_hors_liste_est_refuse(environnement: str) -> None:
    """La liste est fermée, et elle protège aussi ce qu'elle ne nomme pas.

    `production` en fait partie aujourd'hui : l'ouverture faite pour la
    démonstration ne doit pas l'avoir englobée d'avance. `DEMO` en majuscules
    aussi — une comparaison laxiste vaudrait une liste ouverte.
    """
    with pytest.raises(SeedRefused):
        verifier_la_cible(_reglages(environment=environnement))


def test_production_n_est_pas_dans_la_liste() -> None:
    """Dit une seconde fois, sur la liste elle-même.

    Le test précédent tomberait aussi si quelqu'un rendait la vérification
    permissive ; celui-ci tombe si quelqu'un ajoute la ligne.
    """
    assert "production" not in ENVIRONNEMENTS_AUTORISES
    assert "prod" not in ENVIRONNEMENTS_AUTORISES


def test_une_base_distante_sans_nom_declare_est_refusee() -> None:
    """Le nom de l'environnement dit ce que la configuration prétend être.

    Il ne dit pas quelle base est visée, et une variable mal posée suffirait à
    faire passer une base pour une autre.
    """
    with pytest.raises(SeedRefused, match="SEED_DATABASE_NAME"):
        verifier_la_cible(_reglages(environment="demo"))


def test_une_base_distante_qui_ne_correspond_pas_est_refusee() -> None:
    with pytest.raises(SeedRefused, match="refus d'effacer"):
        verifier_la_cible(
            _reglages(
                environment="demo",
                database_url="postgresql+psycopg://x:y@ailleurs.example/bind_production",
                seed_database_name="bind_demo",
            )
        )


def test_une_base_distante_declaree_et_correspondante_passe() -> None:
    """L'autre sens. Un garde qui refuserait tout passerait les tests

    précédents sans rien garantir, et la commande ne tournerait nulle part.
    """
    verifier_la_cible(
        _reglages(
            environment="demo",
            database_url="postgresql+psycopg://x:y@ailleurs.example/bind_demo",
            seed_database_name="bind_demo",
        )
    )


def test_le_local_ne_demande_rien_de_plus() -> None:
    """Le développement local ne change pas : sa base est sur la machine qui
    lance la commande, et lui demander de se nommer n'ajouterait rien."""
    verifier_la_cible(
        _reglages(
            environment="local",
            database_url="postgresql+psycopg://bind:bind@localhost:5434/bind",
        )
    )


@pytest.mark.parametrize(
    "hote", ["localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal"]
)
def test_un_environnement_distant_qui_vise_la_machine_locale_est_refuse(hote: str) -> None:
    """C'est la forme qu'a l'accident.

    Une variable oubliée dans un shell, et la configuration retombe sur le
    `.env` du poste : l'environnement dit « demo », la base est celle de
    développement. Le nom seul ne l'aurait pas vu — celui de Supabase est
    `postgres`, et une base locale peut porter le même.
    """
    # Une IPv6 se met entre crochets dans une URL ; sans eux, l'analyse échoue
    # avant même d'arriver au garde-fou, et le test passerait pour la mauvaise
    # raison.
    ecrit = f"[{hote}]" if ":" in hote else hote

    with pytest.raises(SeedRefused, match="base de développement"):
        verifier_la_cible(
            _reglages(
                environment="demo",
                database_url=f"postgresql+psycopg://x:y@{ecrit}:5432/postgres",
                seed_database_name="postgres",
            )
        )


def test_le_nom_seul_ne_suffit_pas_a_ouvrir() -> None:
    """Deux bases nommées `postgres`, l'une ici et l'autre ailleurs.

    Sans le contrôle d'hôte, la comparaison de noms les confondrait — et c'est
    exactement la configuration de Supabase, dont la base s'appelle `postgres`.
    """
    locale = _reglages(
        environment="demo",
        database_url="postgresql+psycopg://x:y@localhost:5432/postgres",
        seed_database_name="postgres",
    )
    distante = _reglages(
        environment="demo",
        database_url="postgresql+psycopg://x:y@db.projet.supabase.co:5432/postgres",
        seed_database_name="postgres",
    )

    with pytest.raises(SeedRefused):
        verifier_la_cible(locale)
    # L'autre sens : la distante passe, sinon le garde bloquerait tout et la
    # commande ne tournerait nulle part.
    verifier_la_cible(distante)


def test_la_commande_de_deploiement_ne_migre_pas_deux_fois(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Le jeu de données fait table rase puis migre lui-même.

    Migrer avant lui construisait un schéma pour le jeter à la ligne suivante :
    sans conséquence, mais deux fois plus long sur une base distante, et une
    sortie où la même chaîne défile deux fois ne se lit plus.
    """
    from scripts import deploiement

    appels: list[str] = []
    monkeypatch.setattr(deploiement, "migrer", lambda: appels.append("migrer"))
    monkeypatch.setattr(deploiement.seed, "main", lambda: appels.append("seed") or 0)
    monkeypatch.setattr(deploiement.seed, "verifier_l_hote", lambda _: None)
    monkeypatch.setattr(deploiement.seed, "verifier_la_cible", lambda _: None)
    monkeypatch.setattr(deploiement, "check_object_store_configuration", lambda: None)
    monkeypatch.setattr(sys, "argv", ["deploiement", "--avec-jeu-de-donnees"])

    assert deploiement.main() == 0
    assert appels == ["seed"], "la migration autonome fait doublon avec la table rase"


def test_la_commande_migre_seule_quand_on_ne_seme_pas(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """L'autre sens : sans le jeu de données, personne d'autre ne migre.

    C'est le chemin de chaque fusion sur `main`.
    """
    from scripts import deploiement

    appels: list[str] = []
    monkeypatch.setattr(deploiement, "migrer", lambda: appels.append("migrer"))
    monkeypatch.setattr(deploiement.seed, "main", lambda: appels.append("seed") or 0)
    monkeypatch.setattr(deploiement.seed, "verifier_l_hote", lambda _: None)
    monkeypatch.setattr(sys, "argv", ["deploiement"])

    assert deploiement.main() == 0
    assert appels == ["migrer"]


# --------------------------------------------------------------------------
# le fichier de configuration de la démonstration
# --------------------------------------------------------------------------


def test_un_fichier_absent_arrete_la_commande_et_se_nomme(tmp_path: Path) -> None:
    """Elle ne retombe jamais sur la configuration locale.

    Sans ce refus, viser la démonstration avec un fichier oublié aurait visé la
    base de développement — celle dont le nom, `bind`, ne déclenche aucun garde
    parce qu'elle est justement celle qu'on a le droit d'effacer.
    """
    from scripts import deploiement

    absent = tmp_path / ".env.demo"

    with pytest.raises(SystemExit) as refus:
        deploiement.charger(absent)

    assert str(absent) in str(refus.value)
    assert "BIND_ENV_FILE" not in os.environ


def test_une_variable_manquante_est_nommee_et_arrete_tout(tmp_path: Path) -> None:
    """Le comblement silencieux est la vraie sortie de route.

    Un fichier presque complet lisait le reste dans `api/.env` : la commande
    visait un mélange des deux configurations, qui ne correspond à aucun
    environnement réel, et rien ne le disait.
    """
    from scripts import deploiement

    (tmp_path / ".env.demo.example").write_text(
        "# modèle\nENVIRONMENT=\nDATABASE_URL=\nOBJECT_STORE_SECRET_KEY=\n", encoding="utf-8"
    )
    fichier = tmp_path / ".env.demo"
    fichier.write_text("ENVIRONMENT=demo\nDATABASE_URL=\n", encoding="utf-8")

    with pytest.raises(SystemExit) as refus:
        deploiement.charger(fichier)

    message = str(refus.value)
    assert "DATABASE_URL" in message and "OBJECT_STORE_SECRET_KEY" in message
    # Posée, elle n'est pas réclamée : le refus nomme ce qui manque, pas tout.
    assert "ENVIRONMENT" not in message.split(":", 1)[1]


def test_un_fichier_complet_remplace_la_configuration_locale(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Remplace, et non complète.

    C'est la propriété qui compte : les réglages construits ensuite lisent ce
    fichier-là et rien d'autre, quelle que soit la valeur posée dans `api/.env`.
    """
    from app.core import config
    from scripts import deploiement

    (tmp_path / ".env.demo.example").write_text("TOKEN_ENCRYPTION_KEY_ID=\n", encoding="utf-8")
    fichier = tmp_path / ".env.demo"
    fichier.write_text(
        f"DATABASE_URL={os.environ.get('TEST_DATABASE_URL', 'postgresql+psycopg://u:p@ailleurs:5432/postgres')}\n"
        "JWT_SECRET_KEY=une-cle-assez-longue-pour-hmac-256-au-moins\n"
        "TOKEN_ENCRYPTION_KEY=" + Fernet.generate_key().decode() + "\n"
        # Le témoin. Pas `ENVIRONMENT` : l'intégration continue l'exporte pour
        # de vrai, et une variable du shell l'emporte sur n'importe quel
        # fichier — le test aurait mesuré la précédence des sources plutôt que
        # le remplacement du fichier.
        "TOKEN_ENCRYPTION_KEY_ID=temoin-du-fichier\n",
        encoding="utf-8",
    )
    # Par `monkeypatch` : `charger` écrit dans l'environnement du processus, et
    # le laisser posé ferait lire ce fichier temporaire à tous les tests
    # suivants. Même classe de fuite que la transaction validée par erreur.
    monkeypatch.setenv("BIND_ENV_FILE", "")

    deploiement.charger(fichier)

    assert os.environ["BIND_ENV_FILE"] == str(fichier)
    assert config.fichier_de_configuration() == str(fichier)
    # Résolu à l'appel : posé dans une constante de module, il était figé par le
    # premier import venu, et la commande affichait `local` en visant `demo`.
    assert config.build_settings().token_encryption_key_id == "temoin-du-fichier"


def test_le_refus_du_garde_est_une_reponse_et_non_une_trace(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """Un refus attendu ne se lit pas comme une panne de la commande."""
    from scripts import deploiement

    def refuser(_settings):
        raise deploiement.seed.SeedRefused("la base visée n'est pas celle de démonstration")

    monkeypatch.setattr(deploiement.seed, "verifier_l_hote", refuser)
    monkeypatch.setattr(deploiement, "migrer", lambda: pytest.fail("rien ne doit être écrit"))
    monkeypatch.setattr(sys, "argv", ["deploiement", "--avec-jeu-de-donnees"])

    assert deploiement.main() == 2
    assert "refus" in capsys.readouterr().err


#: La réservation du jour peut basculer au lendemain, et jusqu'au prochain jour
#: d'ouverture : semé un samedi soir, un salon ouvert du mardi au samedi ne
#: rouvre que trois jours plus tard. Sept jours couvrent le pire cas sans
#: laisser passer une date lointaine.
FENETRE_DU_PROCHAIN_CRENEAU = timedelta(days=7)


async def test_chaque_commerce_ouvert_a_une_reservation_a_venir(
    seed_conn: AsyncConnection,
) -> None:
    """La propriété qui a lâché, et qui vidait l'écran du comptoir.

    Les réservations tombaient toutes sur le même salon, et rien n'était posé
    ailleurs. Semé un lundi, où trois salons sur quatre n'ouvraient pas, l'écran
    « Aujourd'hui » disait « rien de réservé » partout. C'était exact et
    inutilisable : la caisse ne s'atteignait que depuis une ligne de la journée,
    et aucun code ne pouvait être validé.

    **Ce que le semis promet, c'est le prochain créneau ouvrable** — aujourd'hui
    si la journée le permet, le prochain jour d'ouverture sinon. Ce test exigeait
    « aujourd'hui », ce que le produit ne promet pas : passé la dernière heure
    réservable d'un salon, il n'y a plus de place et le semis reporte, comme il
    le doit. Le test passait donc en journée et tombait le soir — et il n'a été
    trouvé que parce qu'une intégration continue a tourné à 17 h 50 heure de
    Miami. Une assertion qui dépend de l'heure qu'il est ne protège que
    certaines heures.

    Ce qu'il vérifie donc, et qui est vrai à toute heure : **chaque commerce
    ouvert a une réservation confirmée**, elle n'est **jamais derrière nous**, et
    elle est **proche**. La première condition attrape le défaut d'origine — plus
    aucune réservation nulle part — que les deux autres ne remplacent pas.
    """
    commerces = (
        await seed_conn.execute(
            sa.select(Business.id, Business.name, Business.timezone).where(
                Business.status == BusinessStatus.ACTIVE
            )
        )
    ).all()
    assert commerces, "aucun commerce actif : le jeu de données est vide"

    for business_id, nom, fuseau in commerces:
        zone = ZoneInfo(fuseau)
        # Le début de la journée locale, et non « maintenant » : une réservation
        # posée ce matin et déjà commencée reste celle du jour, et l'écran du
        # comptoir la montre encore.
        debut = datetime.combine(datetime.now(zone).date(), time.min, tzinfo=zone)

        creneaux = (
            (
                await seed_conn.execute(
                    sa.select(Booking.starts_at).where(
                        Booking.business_id == business_id,
                        Booking.status == BookingStatus.CONFIRMED,
                    )
                )
            )
            .scalars()
            .all()
        )

        assert creneaux, f"{nom} n'a aucune réservation confirmée"

        # Au moins une au prochain créneau ouvrable : aujourd'hui, ou le jour
        # d'ouverture suivant. Ni derrière nous, ni dans trois semaines.
        a_venir = [
            quand
            for quand in creneaux
            if debut <= quand.astimezone(zone) < debut + FENETRE_DU_PROCHAIN_CRENEAU
        ]
        assert a_venir, (
            f"{nom} n'a aucune réservation confirmée à venir : {[str(quand) for quand in creneaux]}"
        )


#: Avant l'ouverture, en pleine matinée, dans la coupure de midi, l'après-midi,
#: après la fermeture, et la dernière heure du jour. Les moments où le choix du
#: créneau change de branche.
HEURES = (0, 6, 9, 11, 13, 17, 20, 22, 23)


async def test_le_creneau_choisi_n_est_jamais_derriere_nous(
    seed_conn: AsyncConnection,
) -> None:
    """Le défaut ne se voyait qu'à certaines heures, donc jamais en intégration.

    Le choix se faisait en deux passes : ce qui reste à partir de maintenant,
    puis — à défaut — ce qui existait depuis l'ouverture. La seconde rendait un
    créneau déjà passé ; la réservation l'acceptait, l'acceptation par le
    commerce le refusait (`CreneauDepasse`), et le semis s'arrêtait au milieu de
    son écriture. Avant midi il n'y avait rien à rattraper, donc rien à casser :
    un test lancé le matin passait, et la commande échouait le soir.

    Même piège que la réservation posée à « maintenant moins trois heures », qui
    basculait sur la veille avant 3 h. L'heure est donc un paramètre, et le test
    la parcourt au lieu de subir celle du moment.
    """
    from app.seed_demo import prochain_creneau_reservable

    # Les heures se parcourent **dans** le test et non par paramétrage : le jeu
    # de données est posé par une fixture coûteuse, et neuf cas la rejouaient
    # neuf fois — neuf `DROP DATABASE … WITH (FORCE)` concurrents, jusqu'au
    # verrou mortel qui faisait tomber la suite entière.
    factory = async_sessionmaker(bind=seed_conn, expire_on_commit=False)

    async with factory() as session:
        commerces = (
            await session.scalars(
                sa.select(Business).where(Business.status == BusinessStatus.ACTIVE)
            )
        ).all()
        assert commerces, "aucun commerce actif : le jeu de données est vide"

        for business, heure in ((b, h) for b in commerces for h in HEURES):
            item_id = await session.scalar(
                sa.select(TierOffer.catalog_item_id)
                .join(CatalogItem, CatalogItem.id == TierOffer.catalog_item_id)
                .where(
                    TierOffer.business_id == business.id,
                    CatalogItem.requires_booking.is_(True),
                )
                .limit(1)
            )
            if item_id is None:
                continue

            fuseau = ZoneInfo(business.timezone)
            maintenant = datetime.now(fuseau).replace(hour=heure, minute=0, second=0, microsecond=0)

            choix = await prochain_creneau_reservable(
                session, business, item_id, maintenant=maintenant
            )
            assert choix is not None, (
                f"{business.name} n'a aucun créneau à venir à {heure} h : "
                "la démonstration n'aurait aucune réservation dans ce salon"
            )

            creneau, aujourd_hui = choix
            # La propriété qui manquait, et la seule qui compte : jamais
            # derrière nous. Un créneau passé se réserve encore et ne
            # s'accepte plus.
            assert creneau >= maintenant, (
                f"{business.name} à {heure} h : créneau choisi dans le passé"
            )
            # Et le drapeau dit la vérité sur le jour, celui du commerce.
            attendu = creneau.astimezone(fuseau).date() == maintenant.date()
            assert aujourd_hui is attendu


def test_un_modele_versionne_qui_porte_des_valeurs_arrete_tout(tmp_path: Path) -> None:
    """Deux noms qui ne diffèrent que par un suffixe, et un secret dans l'historique.

    `.env.demo.example` est versionné, `.env.demo` ne l'est pas. Remplir le
    premier au lieu du second emporte des identifiants dans le dépôt, d'où rien
    ne les sort — c'est arrivé. Le refus tombe avant la première écriture, donc
    avant le commit.
    """
    from scripts import deploiement

    (tmp_path / ".env.demo.example").write_text(
        "ENVIRONMENT=demo\nDATABASE_URL=postgresql+psycopg://u:secret@ailleurs/postgres\n",
        encoding="utf-8",
    )
    fichier = tmp_path / ".env.demo"
    fichier.write_text("ENVIRONMENT=demo\nDATABASE_URL=peu-importe\n", encoding="utf-8")

    with pytest.raises(SystemExit) as refus:
        deploiement.charger(fichier)

    message = str(refus.value)
    assert "versionné" in message
    assert "ENVIRONMENT" in message and "DATABASE_URL" in message
    # Et rien du secret lui-même : le message se recopie dans un terminal
    # partagé, il ne transporte que des noms.
    assert "secret" not in message


def test_le_modele_du_depot_ne_porte_aucune_valeur() -> None:
    """Le vrai fichier, pas un décor. C'est celui-là qui part dans l'historique."""
    from scripts import deploiement

    modele = API_ROOT / ".env.demo.example"
    assert modele.exists(), "le modèle versionné a disparu"

    portees = {nom: valeur for nom, valeur in deploiement._valeurs(modele).items() if valeur}
    assert not portees, f"le modèle versionné porte des valeurs : {sorted(portees)}"


async def test_plusieurs_revues_humaines_attendent_l_arbitrage(
    seed_conn: AsyncConnection,
) -> None:
    """Une seule ligne dans un tableau plein écran ne montre pas un tableau.

    Relevé en campagne 2 sur l'écran d'administration : « une ligne de tableau
    sur un écran entier ». Le défaut n'était pas l'écran, c'était le jeu — il
    ne produisait qu'un seul dossier en revue humaine. Le drapeau reste une
    **conséquence** : trois demandes de nouvelle soumission le lèvent, et c'est
    le service qui compte, jamais le semis qui l'écrit.
    """
    revues = list(
        await seed_conn.scalars(
            sa.select(Collaboration.id).where(Collaboration.needs_human_review.is_(True))
        )
    )
    assert len(revues) >= 3, f"une file d'arbitrage de {len(revues)} ne se compose pas"


async def test_l_histoire_ne_s_entasse_pas_sur_un_seul_salon(
    seed_conn: AsyncConnection,
) -> None:
    """Trois écrans de journée vides sur quatre, et un quatrième surchargé.

    L'ordre de recherche d'une offre — palier le plus haut, puis la plus
    ancienne — désignait toujours la même ligne, donc toujours le même salon.
    """
    par_salon = dict(
        (
            await seed_conn.execute(
                sa.select(Booking.business_id, sa.func.count()).group_by(Booking.business_id)
            )
        ).all()
    )

    assert len(par_salon) >= 3, f"{len(par_salon)} salon(s) avec une réservation"
    # Et aucun n'en concentre la moitié : trois salons dont un porte tout
    # reviendrait au même écran vide, avec une statistique en plus.
    total = sum(par_salon.values())
    assert max(par_salon.values()) <= total * 0.6, (
        f"un salon porte {max(par_salon.values())}/{total}"
    )


async def test_havana_glow_reste_vierge(seed_conn: AsyncConnection) -> None:
    """Le cas de tout salon qui vient de s'inscrire, et qu'il faut pouvoir voir.

    Un jeu de données où chaque écran est plein ne laisse jamais regarder ce
    que voit un nouveau venu — et c'est l'écran le plus important à réussir,
    puisque c'est le premier. Havana Glow n'a rien composé, et rien ne doit lui
    arriver par ricochet quand on enrichit le reste.
    """
    havana = await seed_conn.scalar(sa.select(Business.id).where(Business.name == "Havana Glow"))
    assert havana is not None, "le salon vierge a disparu du jeu de référence"

    for table, colonne in (
        (Booking, Booking.business_id),
        (CatalogItem, CatalogItem.business_id),
        (TierOffer, TierOffer.business_id),
    ):
        combien = await seed_conn.scalar(
            sa.select(sa.func.count()).select_from(table).where(colonne == havana)
        )
        assert combien == 0, f"{table.__name__} : {combien} ligne(s) sur le salon vierge"
