"""Éligibilité aux paliers.

Le test qui compte le plus est celui du cold start : deux cas côte à côte, un
score nul et un vrai zéro. Tant qu'ils passent ensemble, confondre les deux est
impossible — et c'est exactement ce qui tombe si quelqu'un écrit `score or 0`.

L'essentiel du fichier ne touche pas la base : la règle est une fonction pure,
ses tests n'ont besoin d'aucune fixture.
"""

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

from app.models import CreatorProfile, SocialAccount, SocialMetricsSnapshot, Tier
from app.models.enums import (
    ContentFormat,
    Platform,
    SocialAccountStatus,
    UserRole,
    VerificationStatus,
)
from app.services import eligibility
from app.services.eligibility import (
    CompteEvalue,
    CreateurEvalue,
    PalierEvalue,
    RaisonRefus,
    VerdictScore,
    evaluer,
    evaluer_score,
)
from tests.factories import new_user

MAINTENANT = datetime(2026, 8, 6, 12, 0, tzinfo=UTC)
AGE_MAX = timedelta(days=7)


def compte(**overrides) -> CompteEvalue:
    return CompteEvalue(
        **{
            "social_account_id": uuid.uuid4(),
            "platform": Platform.INSTAGRAM,
            "status": SocialAccountStatus.ACTIVE,
            "verification_status": VerificationStatus.VERIFIED,
            "followers": 50_000,
            "captured_at": MAINTENANT - timedelta(hours=2),
        }
        | overrides
    )


def createur(**overrides) -> CreateurEvalue:
    return CreateurEvalue(
        **{
            "creator_id": uuid.uuid4(),
            "reliability_score": Decimal("90.00"),
            "completed_collabs": 10,
        }
        | overrides
    )


def palier(**overrides) -> PalierEvalue:
    return PalierEvalue(
        **{
            "tier_id": uuid.uuid4(),
            "platform": Platform.INSTAGRAM,
            "content_format": ContentFormat.REEL,
            "min_followers": 10_000,
            "min_completed_collabs": 2,
            "min_reliability_score": Decimal("60.00"),
        }
        | overrides
    )


def evaluer_un(c=None, p=None, a=None):
    """Un créateur, un compte, un palier. Renvoie l'unique accès."""
    resultat = evaluer(
        c or createur(),
        [a or compte()],
        [p or palier()],
        maintenant=MAINTENANT,
        age_max=AGE_MAX,
    )
    assert len(resultat.acces) == 1
    return resultat.acces[0]


def raisons(acces) -> set[RaisonRefus]:
    return {obstacle.raison for obstacle in acces.obstacles}


# --------------------------------------------------------------------------
# le cold start neutre
# --------------------------------------------------------------------------


def test_un_score_nul_ne_ferme_aucun_palier() -> None:
    """Nul veut dire neutre : la condition est ignorée, pas échouée."""
    acces = evaluer_un(
        c=createur(reliability_score=None),
        p=palier(min_reliability_score=Decimal("60.00")),
    )

    assert acces.accessible is True
    assert RaisonRefus.RELIABILITY_SCORE_TOO_LOW not in raisons(acces)


def test_un_score_de_zero_ferme_le_palier() -> None:
    """Le pendant du précédent, et la paire qui rend la confusion impossible.

    Un zéro mérité n'est pas une absence d'historique. Si ces deux tests passent
    ensemble, aucun `score or 0` n'a pu se glisser dans le chemin.
    """
    acces = evaluer_un(
        c=createur(reliability_score=Decimal("0.00")),
        p=palier(min_reliability_score=Decimal("60.00")),
    )

    assert acces.accessible is False
    assert RaisonRefus.RELIABILITY_SCORE_TOO_LOW in raisons(acces)


@pytest.mark.parametrize(
    ("minimum", "score", "attendu"),
    [
        (None, None, VerdictScore.IGNOREE_PALIER_SANS_CONDITION),
        (None, Decimal("0.00"), VerdictScore.IGNOREE_PALIER_SANS_CONDITION),
        (Decimal("60.00"), None, VerdictScore.IGNOREE_CREATEUR_SANS_HISTORIQUE),
        (Decimal("60.00"), Decimal("60.00"), VerdictScore.TENUE),
        (Decimal("60.00"), Decimal("59.99"), VerdictScore.MANQUEE),
        (Decimal("0.00"), Decimal("0.00"), VerdictScore.TENUE),
    ],
)
def test_les_deux_nuls_sont_distincts(minimum, score, attendu) -> None:
    """Deux nuls de nature différente, même issue, jamais le même nom."""
    assert evaluer_score(minimum, score) is attendu


async def test_aucun_palier_de_reference_ne_ferme_sur_un_score_nul(
    conn: AsyncConnection,
) -> None:
    """Paramétré sur tous les paliers réels : ajouter un palier n'y échappe pas."""
    paliers = [
        PalierEvalue(
            tier_id=ligne.id,
            platform=ligne.platform,
            content_format=ligne.content_format,
            min_followers=0,
            min_completed_collabs=0,
            min_reliability_score=ligne.min_reliability_score,
        )
        for ligne in (
            await conn.execute(
                sa.select(
                    Tier.id, Tier.platform, Tier.content_format, Tier.min_reliability_score
                ).where(Tier.is_active.is_(True))
            )
        ).all()
    ]
    assert paliers

    comptes = [compte(platform=plateforme) for plateforme in {p.platform for p in paliers}]
    resultat = evaluer(
        createur(reliability_score=None, completed_collabs=0),
        comptes,
        paliers,
        maintenant=MAINTENANT,
        age_max=AGE_MAX,
    )

    assert resultat.acces
    for acces in resultat.acces:
        assert RaisonRefus.RELIABILITY_SCORE_TOO_LOW not in raisons(acces)


# --------------------------------------------------------------------------
# les conditions chiffrées
# --------------------------------------------------------------------------


def test_le_manque_d_abonnes_est_chiffre() -> None:
    acces = evaluer_un(a=compte(followers=7_500), p=palier(min_followers=10_000))

    obstacle = next(o for o in acces.obstacles if o.raison is RaisonRefus.NOT_ENOUGH_FOLLOWERS)
    assert (obstacle.requis, obstacle.constate, obstacle.ecart) == (10_000, 7_500, 2_500)


def test_le_manque_de_collaborations_est_chiffre() -> None:
    acces = evaluer_un(c=createur(completed_collabs=1), p=palier(min_completed_collabs=5))

    obstacle = next(
        o for o in acces.obstacles if o.raison is RaisonRefus.NOT_ENOUGH_COMPLETED_COLLABS
    )
    assert (obstacle.requis, obstacle.constate, obstacle.ecart) == (5, 1, 4)


def test_le_manque_de_score_est_chiffre() -> None:
    acces = evaluer_un(
        c=createur(reliability_score=Decimal("42.50")),
        p=palier(min_reliability_score=Decimal("60.00")),
    )

    obstacle = next(o for o in acces.obstacles if o.raison is RaisonRefus.RELIABILITY_SCORE_TOO_LOW)
    assert obstacle.ecart == Decimal("17.50")


def test_tous_les_obstacles_sont_renvoyes_pas_le_premier() -> None:
    """Corriger un manque pour découvrir le suivant, c'est être mal traité deux fois."""
    acces = evaluer_un(
        c=createur(reliability_score=Decimal("10.00"), completed_collabs=0),
        a=compte(followers=100),
        p=palier(min_followers=10_000, min_completed_collabs=5),
    )

    assert raisons(acces) == {
        RaisonRefus.NOT_ENOUGH_FOLLOWERS,
        RaisonRefus.NOT_ENOUGH_COMPLETED_COLLABS,
        RaisonRefus.RELIABILITY_SCORE_TOO_LOW,
    }


def test_la_borne_est_inclusive() -> None:
    acces = evaluer_un(
        a=compte(followers=10_000),
        c=createur(reliability_score=Decimal("60.00"), completed_collabs=2),
        p=palier(
            min_followers=10_000, min_completed_collabs=2, min_reliability_score=Decimal("60.00")
        ),
    )
    assert acces.accessible is True


# --------------------------------------------------------------------------
# fraîcheur des relevés
# --------------------------------------------------------------------------


def test_un_compte_sans_releve_n_ouvre_rien() -> None:
    acces = evaluer_un(a=compte(followers=None, captured_at=None))

    assert acces.accessible is False
    assert RaisonRefus.NO_METRICS in raisons(acces)
    assert RaisonRefus.NOT_ENOUGH_FOLLOWERS not in raisons(acces), (
        "sans relevé la condition d'abonnés est indéterminable, pas manquée"
    )


def test_un_releve_perime_n_ouvre_rien() -> None:
    """Une éligibilité calculée sur des chiffres de six mois n'est pas une éligibilité."""
    acces = evaluer_un(a=compte(captured_at=MAINTENANT - timedelta(days=8)))

    assert acces.accessible is False
    obstacle = next(o for o in acces.obstacles if o.raison is RaisonRefus.METRICS_STALE)
    assert obstacle.ecart == int(timedelta(days=1).total_seconds())


def test_un_releve_juste_dans_les_temps_passe() -> None:
    acces = evaluer_un(a=compte(captured_at=MAINTENANT - AGE_MAX))
    assert acces.accessible is True


def test_perime_et_reconnecter_sont_deux_raisons_differentes() -> None:
    """Dire de grandir à quelqu'un dont le jeton a expiré serait un contresens."""
    expire = evaluer_un(a=compte(status=SocialAccountStatus.EXPIRED))
    revoque = evaluer_un(a=compte(status=SocialAccountStatus.REVOKED))

    assert RaisonRefus.ACCOUNT_TOKEN_INVALID in raisons(expire)
    assert RaisonRefus.ACCOUNT_TOKEN_INVALID in raisons(revoque)
    assert expire.accessible is False
    assert revoque.accessible is False


# --------------------------------------------------------------------------
# vérification du compte
# --------------------------------------------------------------------------


def test_un_compte_en_revue_n_ouvre_rien() -> None:
    """Le fil ne doit pas montrer ce qui n'est pas réservable, et doit dire pourquoi."""
    acces = evaluer_un(a=compte(verification_status=VerificationStatus.NEEDS_REVIEW))

    assert acces.accessible is False
    assert RaisonRefus.ACCOUNT_UNDER_REVIEW in raisons(acces)


def test_un_compte_rejete_a_sa_propre_raison() -> None:
    """L'un est temporaire, l'autre non : le message ne peut pas être le même."""
    acces = evaluer_un(a=compte(verification_status=VerificationStatus.REJECTED))

    assert RaisonRefus.ACCOUNT_REJECTED in raisons(acces)
    assert RaisonRefus.ACCOUNT_UNDER_REVIEW not in raisons(acces)


# --------------------------------------------------------------------------
# portée
# --------------------------------------------------------------------------


def test_une_autre_plateforme_n_est_pas_un_refus() -> None:
    """Elle est hors de portée. La blâmer serait du bruit."""
    resultat = evaluer(
        createur(),
        [compte(platform=Platform.INSTAGRAM)],
        [palier(platform=Platform.TIKTOK)],
        maintenant=MAINTENANT,
        age_max=AGE_MAX,
    )

    assert resultat.acces == ()


def test_deux_comptes_de_la_meme_plateforme_peuvent_differer() -> None:
    """Le créateur choisit avec lequel il réserve."""
    gros = compte(followers=50_000)
    petit = compte(followers=500)
    exigeant = palier(min_followers=10_000)

    resultat = evaluer(
        createur(), [gros, petit], [exigeant], maintenant=MAINTENANT, age_max=AGE_MAX
    )

    par_compte = {acces.social_account_id: acces.accessible for acces in resultat.acces}
    assert par_compte == {gros.social_account_id: True, petit.social_account_id: False}
    assert resultat.couples_accessibles == {(gros.social_account_id, exigeant.tier_id)}
    assert resultat.paliers_accessibles == {exigeant.tier_id}


def test_l_ensemble_repond_pour_un_couple_sans_recalcul() -> None:
    """On interroge l'ensemble ; il n'existe aucune fonction à appeler par offre."""
    petit = compte(followers=500)
    exigeant = palier(min_followers=10_000)
    resultat = evaluer(createur(), [petit], [exigeant], maintenant=MAINTENANT, age_max=AGE_MAX)

    obstacles = resultat.obstacles_pour(petit.social_account_id, exigeant.tier_id)

    assert {o.raison for o in obstacles} == {RaisonRefus.NOT_ENOUGH_FOLLOWERS}
    assert resultat.obstacles_pour(uuid.uuid4(), exigeant.tier_id) == ()


def test_aucune_fonction_ne_prend_une_offre() -> None:
    """Une fonction qu'on peut appeler dans une boucle finira dans une boucle."""
    exposes = [nom for nom in dir(eligibility) if not nom.startswith("_")]
    assert not [nom for nom in exposes if "offer" in nom.lower() or "offre" in nom.lower()]


# --------------------------------------------------------------------------
# le branchement à la base
# --------------------------------------------------------------------------


async def _createur_complet(
    conn: AsyncConnection,
    *,
    comptes: int = 1,
    followers: int = 50_000,
    score: Decimal | None = Decimal("90.00"),
    collabs: int = 10,
    plateforme: Platform = Platform.INSTAGRAM,
) -> uuid.UUID:
    user_id = await new_user(conn, role=UserRole.CREATOR)
    await conn.execute(
        sa.insert(CreatorProfile).values(
            user_id=user_id, reliability_score=score, completed_collabs_count=collabs
        )
    )

    for index in range(comptes):
        account_id = (
            await conn.execute(
                sa.insert(SocialAccount)
                .values(
                    creator_id=user_id,
                    platform=plateforme,
                    external_id=str(uuid.uuid4()),
                    handle=f"compte{index}",
                    verification_status=VerificationStatus.VERIFIED,
                )
                .returning(SocialAccount.id)
            )
        ).scalar_one()
        # Deux relevés : seul le plus récent doit compter.
        for jours, nombre in ((30, 1), (0, followers)):
            await conn.execute(
                sa.insert(SocialMetricsSnapshot).values(
                    social_account_id=account_id,
                    captured_at=datetime.now(UTC) - timedelta(days=jours),
                    followers_count=nombre,
                    following_count=100,
                    media_count=50,
                    raw_payload={},
                )
            )

    return user_id


async def test_seul_le_dernier_releve_compte(session: AsyncSession, conn: AsyncConnection) -> None:
    creator_id = await _createur_complet(conn, followers=50_000)

    resultat = await eligibility.evaluer_createur(session, creator_id)

    assert resultat.paliers_accessibles, "le vieux relevé à 1 abonné aurait tout fermé"


async def test_un_createur_sans_profil_ne_leve_pas(
    session: AsyncSession, conn: AsyncConnection
) -> None:
    resultat = await eligibility.evaluer_createur(session, uuid.uuid4())

    assert resultat.acces == ()
    assert resultat.paliers_accessibles == frozenset()


async def test_aucun_palier_inactif_n_est_renvoye(
    session: AsyncSession, conn: AsyncConnection
) -> None:
    """Un palier inactif n'existe pas du point de vue du créateur."""
    creator_id = await _createur_complet(conn, plateforme=Platform.SNAPCHAT)

    resultat = await eligibility.evaluer_createur(session, creator_id)

    assert resultat.acces == (), "Snapchat est inactif, il ne doit rien renvoyer du tout"


async def test_le_cold_start_tient_aussi_sur_la_base(
    session: AsyncSession, conn: AsyncConnection
) -> None:
    creator_id = await _createur_complet(conn, score=None, collabs=0, followers=50_000)

    resultat = await eligibility.evaluer_createur(session, creator_id)

    for acces in resultat.acces:
        assert RaisonRefus.RELIABILITY_SCORE_TOO_LOW not in {
            obstacle.raison for obstacle in acces.obstacles
        }


# --------------------------------------------------------------------------
# le coût
# --------------------------------------------------------------------------


@pytest.mark.parametrize("comptes", [1, 3], ids=["un compte", "trois comptes"])
async def test_toujours_trois_requetes(
    session: AsyncSession, conn: AsyncConnection, engine, comptes: int
) -> None:
    """La propriété tenue est l'indépendance au nombre de comptes.

    Un seul cas ne la démontrerait pas : c'est en comparant un compte et trois
    pour le même total qu'on prouve qu'aucune boucle ne s'est glissée.
    """
    creator_id = await _createur_complet(conn, comptes=comptes)

    executees: list[str] = []

    def compter(conn_, cursor, statement, parameters, context, executemany):  # noqa: ARG001
        if statement.lstrip().upper().startswith("SELECT"):
            executees.append(statement)

    sa.event.listen(engine.sync_engine, "before_cursor_execute", compter)
    try:
        resultat = await eligibility.evaluer_createur(session, creator_id)
    finally:
        sa.event.remove(engine.sync_engine, "before_cursor_execute", compter)

    assert len(executees) == 3, "\n---\n".join(executees)
    assert len({acces.social_account_id for acces in resultat.acces}) == comptes
