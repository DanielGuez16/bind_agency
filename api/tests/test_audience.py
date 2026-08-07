"""Audience du créateur, statut de vérification, et dates sur les obstacles.

Trois manques du même ordre : des données que le serveur possédait et ne rendait
pas, chacune laissant le créateur devant un écran qui ne dit rien.

Ses abonnés n'apparaissaient nulle part. L'éligibilité s'en servait pour
trancher et ne les rendait qu'en creux, sous forme d'un écart à combler : qui
avait 1 800 abonnés lisait « il t'en manque 200 » sans jamais lire 1 800.

Le contrôle de cohérence ne se voyait pas non plus. Et les obstacles datés —
relevé périmé, jeton expiré — ne portaient qu'un écart en secondes, qui ne
s'affiche pas.
"""

import uuid
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import SocialAccount, SocialMetricsSnapshot
from app.models.enums import (
    Platform,
    SocialAccountStatus,
    UserRole,
    VerificationStatus,
)
from app.services import account_verification, eligibility
from app.services import audience as service
from app.services import auth as auth_service
from app.services.eligibility import RaisonRefus
from tests.test_feed import createur

PREFIX = get_settings().api_v1_prefix
MOT_DE_PASSE = "un-mot-de-passe-solide-42"


# --------------------------------------------------------------------------
# audience
# --------------------------------------------------------------------------


async def test_le_createur_lit_ses_abonnes_et_leur_date(session: AsyncSession) -> None:
    user, compte = await createur(session, followers=1_800)

    lignes = await service.audience(session, creator_id=user.id)

    assert len(lignes) == 1
    lue = lignes[0]
    assert lue.social_account_id == compte.id
    assert lue.followers_count == 1_800
    assert lue.handle == "compte.dessai"
    assert lue.captured_at is not None, "un chiffre sans date passerait pour celui du jour"


async def test_un_compte_sans_releve_rend_nul_et_non_zero(session: AsyncSession) -> None:
    """« Pas encore mesuré » n'est pas « zéro abonné ».

    Afficher zéro à quelqu'un qui en a douze mille est un défaut qu'il
    signalerait avant nous.
    """
    user = await auth_service.register(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password=MOT_DE_PASSE,
        role=UserRole.CREATOR,
    )
    compte = SocialAccount(
        creator_id=user.id,
        platform=Platform.INSTAGRAM,
        external_id=f"1784140{uuid.uuid4().int % 10**10}",
        handle="sans.releve",
        access_token_encrypted="IGQVJXY-jeton",
        status=SocialAccountStatus.ACTIVE,
        verification_status=VerificationStatus.NEEDS_REVIEW,
    )
    session.add(compte)
    await session.flush()

    lue = (await service.audience(session, creator_id=user.id))[0]

    assert lue.followers_count is None
    assert lue.captured_at is None


async def test_l_audience_vient_du_dernier_releve(session: AsyncSession) -> None:
    """Et non du premier, ni d'une moyenne.

    Sans ce test, une jointure sur n'importe quel relevé passerait tant qu'il
    n'y en a qu'un — c'est-à-dire tout le temps, jusqu'en production.
    """
    user, compte = await createur(session, followers=1_000)
    session.add(
        SocialMetricsSnapshot(
            social_account_id=compte.id,
            captured_at=datetime.now(UTC) + timedelta(minutes=1),
            followers_count=2_500,
            following_count=300,
            media_count=210,
            raw_payload={},
        )
    )
    await session.flush()

    lue = (await service.audience(session, creator_id=user.id))[0]

    assert lue.followers_count == 2_500


async def test_l_audience_est_celle_du_demandeur(session: AsyncSession) -> None:
    a, _ = await createur(session, followers=1_800)
    await createur(session, followers=90_000)

    lignes = await service.audience(session, creator_id=a.id)

    assert [ligne.followers_count for ligne in lignes] == [1_800]


# --------------------------------------------------------------------------
# vérification
# --------------------------------------------------------------------------


async def test_la_verification_rend_la_date_de_demarrage_et_les_signaux(
    session: AsyncSession,
) -> None:
    user, compte = await createur(session)

    lignes = await service.verification(session, creator_id=user.id)

    assert len(lignes) == 1
    lue = lignes[0]
    assert lue.started_at == compte.connected_at
    assert lue.verification_status is VerificationStatus.VERIFIED
    assert lue.signaux, "un compte relevé a des signaux jugés"
    assert {s.signal for s in lue.signaux} <= set(account_verification.Signal)


async def test_la_verification_ne_promet_aucun_delai(session: AsyncSession) -> None:
    """Aucun champ d'objectif, d'estimation ni d'échéance.

    Le test lit les champs réellement rendus : une promesse ajoutée demain le
    fait tomber. Une promesse tenue par une file d'attente humaine se brise le
    premier jour de charge, auprès de gens qui n'ont rien fait de mal.
    """
    user, _ = await createur(session)

    lue = (await service.verification(session, creator_id=user.id))[0]
    champs = set(lue.__slots__)

    assert not any(
        mot in champ for champ in champs for mot in ("sla", "eta", "expected", "estimated")
    )
    assert "deadline_at" not in champs


async def test_les_signaux_sont_recalcules_et_non_relus_d_un_cache(
    session: AsyncSession,
) -> None:
    """Un relevé qui change change le verdict.

    Un cache aurait vieilli pendant que les relevés bougent, et le créateur
    aurait lu un jugement porté sur des chiffres qui n'existent plus.
    """
    user, compte = await createur(session, followers=90_000)
    avant = (await service.verification(session, creator_id=user.id))[0]
    volume_avant = next(
        s for s in avant.signaux if s.signal is account_verification.Signal.VOLUME_DE_PUBLICATION
    )

    session.add(
        SocialMetricsSnapshot(
            social_account_id=compte.id,
            captured_at=datetime.now(UTC) + timedelta(minutes=1),
            followers_count=90_000,
            following_count=300,
            media_count=1,
            raw_payload={},
        )
    )
    await session.flush()

    apres = (await service.verification(session, creator_id=user.id))[0]
    volume_apres = next(
        s for s in apres.signaux if s.signal is account_verification.Signal.VOLUME_DE_PUBLICATION
    )

    assert volume_avant.constate != volume_apres.constate
    assert volume_apres.constate == 1


# --------------------------------------------------------------------------
# dates sur les obstacles
# --------------------------------------------------------------------------


async def test_un_releve_perime_porte_la_date_du_releve(session: AsyncSession) -> None:
    """Un écart en secondes ne s'affiche pas, une date si.

    « Il vous manque 431 200 secondes » ne veut rien dire ; « relevé du 3 août »
    se lit.
    """
    settings = get_settings()
    user, compte = await createur(session, followers=90_000)
    vieux = datetime.now(UTC) - timedelta(seconds=settings.metrics_max_age_seconds * 2)
    await session.execute(
        sa.update(SocialMetricsSnapshot)
        .where(SocialMetricsSnapshot.social_account_id == compte.id)
        .values(captured_at=vieux)
    )
    await session.flush()

    verdict = await eligibility.evaluer_createur(session, user.id)
    obstacles = [o for acces in verdict.acces for o in acces.obstacles]
    perime = next(o for o in obstacles if o.raison is RaisonRefus.METRICS_STALE)

    assert perime.depuis is not None
    assert abs((perime.depuis - vieux).total_seconds()) < 1


async def test_un_jeton_invalide_porte_son_echeance(session: AsyncSession) -> None:
    expire = datetime.now(UTC) - timedelta(days=2)
    user, compte = await createur(session, followers=90_000)
    await session.execute(
        sa.update(SocialAccount)
        .where(SocialAccount.id == compte.id)
        .values(status=SocialAccountStatus.EXPIRED, token_expires_at=expire)
    )
    await session.flush()

    verdict = await eligibility.evaluer_createur(session, user.id)
    obstacles = [o for acces in verdict.acces for o in acces.obstacles]
    invalide = next(o for o in obstacles if o.raison is RaisonRefus.ACCOUNT_TOKEN_INVALID)

    assert invalide.depuis is not None
    assert abs((invalide.depuis - expire).total_seconds()) < 1


async def test_un_compte_en_controle_porte_la_date_de_rattachement(
    session: AsyncSession,
) -> None:
    user, compte = await createur(session, followers=90_000)
    await session.execute(
        sa.update(SocialAccount)
        .where(SocialAccount.id == compte.id)
        .values(verification_status=VerificationStatus.NEEDS_REVIEW)
    )
    await session.flush()
    await session.refresh(compte)

    verdict = await eligibility.evaluer_createur(session, user.id)
    obstacles = [o for acces in verdict.acces for o in acces.obstacles]
    en_controle = next(o for o in obstacles if o.raison is RaisonRefus.ACCOUNT_UNDER_REVIEW)

    assert en_controle.depuis == compte.connected_at


async def test_un_obstacle_sans_date_n_en_invente_pas(session: AsyncSession) -> None:
    """Le pendant. Sans lui, un `depuis` rempli partout passerait les trois
    tests précédents sans rien dire de juste."""
    user, _ = await createur(session, followers=10)

    verdict = await eligibility.evaluer_createur(session, user.id)
    obstacles = [o for acces in verdict.acces for o in acces.obstacles]
    manque = next(o for o in obstacles if o.raison is RaisonRefus.NOT_ENOUGH_FOLLOWERS)

    assert manque.depuis is None
    assert manque.ecart is not None, "celui-là se chiffre, et c'est bien un écart"


# --------------------------------------------------------------------------
# routes
# --------------------------------------------------------------------------


async def test_les_routes_sont_reservees_aux_createurs(
    client: AsyncClient, session: AsyncSession
) -> None:
    user, _ = await createur(session, followers=1_800)
    commercant = await auth_service.register(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password=MOT_DE_PASSE,
        role=UserRole.BUSINESS_MEMBER,
    )
    # `createur` passe par `auth_service.register`, mot de passe connu.
    await session.commit()

    async def entetes(u) -> dict:
        jetons = (
            await client.post(
                f"{PREFIX}/auth/login", json={"email": u.email, "password": MOT_DE_PASSE}
            )
        ).json()
        return {"Authorization": f"Bearer {jetons['access_token']}"}

    for chemin in ("/me/audience", "/me/verification"):
        refuse = await client.get(f"{PREFIX}{chemin}", headers=await entetes(commercant))
        assert refuse.status_code == 403, chemin

        accepte = await client.get(f"{PREFIX}{chemin}", headers=await entetes(user))
        assert accepte.status_code == 200, accepte.text
        assert accepte.json(), chemin

    audience = (await client.get(f"{PREFIX}/me/audience", headers=await entetes(user))).json()
    assert audience[0]["followers_count"] == 1800
