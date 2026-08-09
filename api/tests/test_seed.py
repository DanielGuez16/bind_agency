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
from datetime import UTC, datetime, timedelta

import psycopg
import pytest
import sqlalchemy as sa
from psycopg import sql
from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy import make_url
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine
from sqlalchemy.pool import NullPool

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

    assert "4 commerces" in resultat.stdout
    assert "10 offres" in resultat.stdout
    # Le résumé annonce aussi ce que la démonstration a produit : un jeu qui
    # poserait zéro contrepartie se verrait ici, pas trois écrans plus loin.
    assert "5 créateurs" in resultat.stdout
    assert "contreparties" in resultat.stdout
    assert MOT_DE_PASSE in resultat.stdout


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

    assert len(lignes) == 4
    par_statut = {ligne.status for ligne in lignes}
    assert par_statut == {BusinessStatus.ACTIVE, BusinessStatus.ONBOARDING}
    assert sum(1 for ligne in lignes if ligne.status == BusinessStatus.ACTIVE) == 3

    for ligne in lignes:
        assert ligne.currency == "USD"
        assert ligne.timezone == "America/New_York"


async def test_chaque_commerce_a_son_owner(seed_conn: AsyncConnection) -> None:
    lignes = (
        await seed_conn.execute(sa.select(BusinessMember.business_id, BusinessMember.role))
    ).all()

    assert len(lignes) == 4
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
    # n'en a pas — et deux souscriptions d'abonnement, journalisées sous la
    # même entité.
    assert par_entite["business"] == 9
    # Un administrateur, quatre propriétaires, cinq créateurs.
    assert par_entite["app_user"] == 10
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

    assert len(identifiants) == 4
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
    assert all(cle.startswith("photos/business/") for cle in couvertures)

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


async def test_les_dates_sont_proches_d_aujourd_hui(seed_conn: AsyncConnection) -> None:
    """Un jeu figé montre des réservations passées trois mois plus tard, et la
    démonstration commence par une explication."""
    bornes = (
        await seed_conn.execute(
            sa.select(sa.func.min(Booking.created_at), sa.func.max(Booking.created_at))
        )
    ).one()

    maintenant = datetime.now(UTC)
    assert (maintenant - bornes[1]) < timedelta(days=2), "la plus récente n'est pas récente"
    assert (maintenant - bornes[0]) < timedelta(days=45), "la plus ancienne est trop vieille"
    # Et elles s'étalent : un jeu où tout tombe le même jour ne montre aucun
    # reporting.
    assert (bornes[1] - bornes[0]) > timedelta(days=5)


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
    with pytest.raises(SeedRefused, match="base de développement"):
        verifier_la_cible(
            _reglages(
                environment="demo",
                # Une IPv6 se met entre crochets dans une URL ; sans eux,
                # l'analyse échoue avant même d'arriver au garde-fou.
                database_url=f"postgresql+psycopg://x:y@{'[' + hote + ']' if ':' in hote else hote}:5432/postgres",
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
