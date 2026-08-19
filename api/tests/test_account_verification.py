"""Vérification de cohérence d'un compte social.

Deux propriétés portent le reste, et ce sont des propriétés d'**absence** :
aucun chemin automatique ne prononce `rejected`, et aucune réexécution ne
redescend un compte. Les tests les éprouvent en essayant de les faire échouer,
pas en constatant qu'elles tiennent sur le cas facile.

La troisième est plus discrète : un compte dont rien n'est mesurable ne passe
pas le contrôle par vacuité. « Aucun signal n'a échoué » serait vrai précisément
parce qu'aucun n'a été examiné.
"""

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import AuditLog, SocialAccount, SocialMetricsSnapshot
from app.models.enums import (
    ActorKind,
    Platform,
    SocialAccountStatus,
    UserRole,
    VerificationStatus,
)
from app.services import account_verification as service
from app.services import metrics as metrics_service
from app.services.audit import Actor
from tests.conftest import inscrire_verifie
from tests.test_social_metrics import FauxFournisseur, metriques

PREFIX = get_settings().api_v1_prefix

#: Un compte qui passe le seul signal jugeable aujourd'hui : assez de
#: publications, et un rapport abonnés/publications ordinaire.
SAIN = {"followers_count": 12_400, "media_count": 208}

#: Beaucoup d'abonnés, presque rien de publié. Signature du compte acheté.
ACHETE = {"followers_count": 90_000, "media_count": 14}


# --------------------------------------------------------------------------
# harnais
# --------------------------------------------------------------------------


async def creer_compte(session: AsyncSession, **overrides) -> SocialAccount:
    user = await inscrire_verifie(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password="tourbillon-cactus-91-vermeil",
        role=UserRole.CREATOR,
    )
    valeurs = {
        "creator_id": user.id,
        "platform": Platform.INSTAGRAM,
        "external_id": f"1784140{uuid.uuid4().int % 10**10}",
        "handle": "compte.dessai",
        "access_token_encrypted": "IGQVJXY-jeton",
        "status": SocialAccountStatus.ACTIVE,
        "verification_status": VerificationStatus.NEEDS_REVIEW,
    }
    compte = SocialAccount(**(valeurs | overrides))
    session.add(compte)
    await session.flush()
    return compte


async def relever(session: AsyncSession, compte: SocialAccount, **chiffres) -> None:
    """Passe par le service de métriques, qui enchaîne la vérification.

    C'est le vrai chemin : le contrôle s'exécute après un relevé réussi, jamais
    seul. Le déclencher à la main dans les tests laisserait l'enchaînement lui
    même hors couverture.
    """
    compte.last_synced_at = compte.last_sync_attempt_at = None
    await metrics_service.refresh_profile_metrics(
        session, account=compte, provider=FauxFournisseur(rend=metriques(**chiffres))
    )


async def vieillir_les_releves(session: AsyncSession, compte: SocialAccount, jours: int) -> None:
    """Recule le premier relevé pour ouvrir la fenêtre de régularité.

    Le temps est le seul ingrédient qu'un test ne peut pas attendre.
    """
    premier = await session.scalar(
        sa.select(SocialMetricsSnapshot.id)
        .where(SocialMetricsSnapshot.social_account_id == compte.id)
        .order_by(SocialMetricsSnapshot.captured_at)
        .limit(1)
    )
    await session.execute(
        sa.update(SocialMetricsSnapshot)
        .where(SocialMetricsSnapshot.id == premier)
        .values(captured_at=datetime.now(UTC) - timedelta(days=jours))
    )
    await session.flush()


def verdict_de(coherence: service.Coherence, signal: service.Signal) -> service.VerdictSignal:
    return next(c.verdict for c in coherence.constats if c.signal is signal)


# --------------------------------------------------------------------------
# la règle pure
# --------------------------------------------------------------------------


def compte_evalue(**overrides) -> service.CompteEvalue:
    releve = service.ReleveEvalue(
        followers_count=12_400,
        media_count=208,
        engagement_rate=None,
        captured_at=datetime.now(UTC),
    )
    valeurs = {
        "social_account_id": uuid.uuid4(),
        "handle": "compte.dessai",
        "dernier": releve,
        "premier": releve,
        "first_name": None,
        "last_name": None,
    }
    return service.CompteEvalue(**(valeurs | overrides))


def test_les_cinq_signaux_sont_tous_rendus() -> None:
    """Aucun n'est omis, même ceux que le produit ne sait pas mesurer. Un signal
    absent de la réponse serait indistinguable d'un signal oublié."""
    coherence = service.evaluer(compte_evalue(), get_settings())

    assert tuple(c.signal for c in coherence.constats) == tuple(service.Signal)


def test_un_compte_sans_rien_de_mesurable_n_est_pas_verifiable() -> None:
    """Le piège de l'ensemble vide.

    Sans relevé, les cinq signaux sont neutres. « Aucun signal manqué » est donc
    vrai — et ne prouve rien. Le compte reste en attente.
    """
    coherence = service.evaluer(compte_evalue(dernier=None, premier=None), get_settings())

    assert coherence.manques == ()
    assert coherence.juges == ()
    assert coherence.verifiable is False


def test_le_signal_du_nom_est_neutre_sans_nom_declare() -> None:
    """Aucun créateur ne peut renseigner son nom aujourd'hui. Nul veut dire
    ignoré, jamais manqué — comme la condition de score."""
    coherence = service.evaluer(compte_evalue(), get_settings())

    assert (
        verdict_de(coherence, service.Signal.NOM_DECLARE)
        is service.VerdictSignal.IGNORE_MECANISME_ABSENT
    )
    # Et il n'empêche pas la vérification, sans quoi personne ne passerait.
    assert coherence.verifiable is True


def test_le_signal_du_nom_compte_des_qu_un_nom_existe() -> None:
    """La comparaison est écrite avant la route qui l'alimentera : le jour où le
    profil s'écrit, le signal compte sans qu'une ligne change ici."""
    accorde = service.evaluer(
        compte_evalue(first_name="Rebecca", last_name="Alvarez", handle="rebecca.miami"),
        get_settings(),
    )
    discordant = service.evaluer(
        compte_evalue(first_name="Rebecca", last_name="Alvarez", handle="luxe.watches.deals"),
        get_settings(),
    )

    assert verdict_de(accorde, service.Signal.NOM_DECLARE) is service.VerdictSignal.TENU
    assert verdict_de(discordant, service.Signal.NOM_DECLARE) is service.VerdictSignal.MANQUE
    # Et le désaccord suffit à retenir le compte, sans le rejeter.
    assert discordant.verifiable is False


@pytest.mark.parametrize(
    ("prenom", "nom", "handle", "attendu"),
    [
        ("Rebecca", "Alvarez", "rebecca.miami", True),
        ("Rebecca", "Alvarez", "alvarez_studio", True),
        ("Ana", "Núñez", "nunez_mia", True),
        ("Jean-Pierre", "Dubois", "dubois.paris", True),
        ("Rebecca", "Alvarez", "luxe.watches.deals", False),
        # Un fragment de moins de trois lettres ne prouve rien et n'est pas
        # retenu : « li » se retrouverait dans un pseudonyme sur trois.
        ("Li", "Wang", "wang.food", True),
        ("Li", None, "polish.nails.mia", False),
        # Assumé : un fragment court peut se retrouver par hasard dans un mot
        # plus long. Le signal penche volontairement du côté permissif — il ne
        # rejette jamais, il retient — et une reconnaissance de trop coûte moins
        # cher qu'un vrai créateur envoyé en revue pour un pseudonyme de scène.
        ("Ana", None, "banana.official", True),
    ],
)
def test_reconnaissance_du_nom_dans_le_pseudonyme(
    prenom: str, nom: str | None, handle: str, attendu: bool
) -> None:
    assert service.nom_present_dans_handle(prenom, nom, handle) is attendu


def test_le_volume_distingue_ses_deux_facons_d_echouer() -> None:
    settings = get_settings()

    trop_peu = service.ReleveEvalue(
        followers_count=800, media_count=3, engagement_rate=None, captured_at=datetime.now(UTC)
    )
    achete = service.ReleveEvalue(
        followers_count=90_000, media_count=14, engagement_rate=None, captured_at=datetime.now(UTC)
    )

    maigre = service.evaluer(compte_evalue(dernier=trop_peu, premier=trop_peu), settings)
    suspect = service.evaluer(compte_evalue(dernier=achete, premier=achete), settings)

    assert verdict_de(maigre, service.Signal.VOLUME_DE_PUBLICATION) is service.VerdictSignal.MANQUE
    assert verdict_de(suspect, service.Signal.VOLUME_DE_PUBLICATION) is service.VerdictSignal.MANQUE
    # Le même verdict, mais pas le même constat : l'un compte des publications,
    # l'autre un rapport. La file doit pouvoir les distinguer.
    constat_maigre = next(
        c for c in maigre.constats if c.signal is service.Signal.VOLUME_DE_PUBLICATION
    )
    constat_suspect = next(
        c for c in suspect.constats if c.signal is service.Signal.VOLUME_DE_PUBLICATION
    )
    assert constat_maigre.constate == 3
    assert constat_suspect.constate == 90_000 // 14


def test_l_engagement_est_aberrant_dans_les_deux_sens() -> None:
    """Trop bas trahit des abonnés achetés, trop haut un pod d'engagement."""
    settings = get_settings()

    def avec(taux: Decimal | None) -> service.VerdictSignal:
        releve = service.ReleveEvalue(
            followers_count=12_400,
            media_count=208,
            engagement_rate=taux,
            captured_at=datetime.now(UTC),
        )
        return verdict_de(
            service.evaluer(compte_evalue(dernier=releve, premier=releve), settings),
            service.Signal.ENGAGEMENT,
        )

    assert avec(Decimal("0.04")) is service.VerdictSignal.TENU
    assert avec(Decimal("0.0001")) is service.VerdictSignal.MANQUE
    assert avec(Decimal("0.90")) is service.VerdictSignal.MANQUE
    # Nul veut dire « pas encore mesuré », jamais « zéro » — donc jamais manqué.
    assert avec(None) is service.VerdictSignal.IGNORE_MECANISME_ABSENT


# --------------------------------------------------------------------------
# la transition automatique
# --------------------------------------------------------------------------


async def test_un_compte_qui_passe_tous_les_signaux_devient_verified(
    session: AsyncSession,
) -> None:
    compte = await creer_compte(session)

    await relever(session, compte, **SAIN)

    assert compte.verification_status is VerificationStatus.VERIFIED
    assert compte.verification_reviewed_at is not None

    ligne = await session.scalar(
        sa.select(AuditLog).where(
            AuditLog.entity_id == compte.id, AuditLog.to_status == VerificationStatus.VERIFIED.value
        )
    )
    assert ligne is not None
    # Personne ne l'a demandé, le système l'a décidé — et il dit pourquoi.
    assert ligne.actor_kind is ActorKind.SYSTEM
    assert ligne.actor_user_id is None
    assert ligne.reason
    # Les constats du moment partent au journal : les seuils bougeront, la
    # décision doit rester explicable avec ceux qui l'ont prise.
    assert ligne.extra["signaux"]["volume_de_publication"]["verdict"] == "tenu"


async def test_un_compte_douteux_reste_en_revue_et_apparait_dans_la_file(
    session: AsyncSession,
) -> None:
    compte = await creer_compte(session)

    await relever(session, compte, **ACHETE)

    assert compte.verification_status is VerificationStatus.NEEDS_REVIEW
    # Aucune transition, donc aucune ligne de journal : le compte n'a pas changé
    # d'état, il attend toujours.
    assert (
        await session.scalar(
            sa.select(sa.func.count()).select_from(AuditLog).where(AuditLog.entity_id == compte.id)
        )
        == 0
    )

    file = await service.file_d_administration(session)
    en_attente = {c.id: coherence for c, coherence in file}
    assert compte.id in en_attente
    # La file dit pourquoi, elle ne se contente pas de lister.
    assert (
        verdict_de(en_attente[compte.id], service.Signal.VOLUME_DE_PUBLICATION)
        is service.VerdictSignal.MANQUE
    )


async def test_aucun_chemin_automatique_ne_produit_rejected(session: AsyncSession) -> None:
    """Un rejet prononcé par une heuristique sur un vrai créateur est une perte
    sèche que personne ne rattrape. On essaie donc de le provoquer.
    """
    catastrophiques = [
        {"followers_count": 500_000, "media_count": 1},
        {"followers_count": 0, "media_count": 0},
        {"followers_count": 99_999, "media_count": 12},
    ]

    for chiffres in catastrophiques:
        compte = await creer_compte(session)
        await relever(session, compte, **chiffres)
        assert compte.verification_status is VerificationStatus.NEEDS_REVIEW

    rejetes = await session.scalar(
        sa.select(sa.func.count())
        .select_from(SocialAccount)
        .where(SocialAccount.verification_status == VerificationStatus.REJECTED)
    )
    assert rejetes == 0


async def test_un_compte_reexamine_apres_amelioration_passe_en_verified(
    session: AsyncSession,
) -> None:
    """Un compte tout juste créé n'est pas condamné, il est ajourné."""
    compte = await creer_compte(session)

    await relever(session, compte, followers_count=90_000, media_count=14)
    assert compte.verification_status is VerificationStatus.NEEDS_REVIEW

    # Le créateur publie. Le relevé suivant le montre, sans intervention.
    await relever(session, compte, followers_count=92_000, media_count=60)

    assert compte.verification_status is VerificationStatus.VERIFIED


async def test_un_compte_verified_n_est_pas_redescendu_par_une_reexecution(
    session: AsyncSession,
) -> None:
    """Il en faudrait peu : un relevé qui chute suffirait à faire manquer le
    volume. Seule la file d'administration peut redescendre un compte."""
    compte = await creer_compte(session)
    await relever(session, compte, **SAIN)
    assert compte.verification_status is VerificationStatus.VERIFIED

    await relever(session, compte, followers_count=500_000, media_count=2)

    assert compte.verification_status is VerificationStatus.VERIFIED
    # Et le contrôle a bien vu la dégradation : il ne l'a simplement pas suivie.
    coherence = service.evaluer(await service.charger(session, compte), get_settings())
    assert coherence.verifiable is False


async def test_la_regularite_devient_jugeable_avec_le_temps(session: AsyncSession) -> None:
    """Le signal qui donne son sens à la réexécution.

    Avec un seul relevé il est neutre — faute d'historique, pas faute de
    mécanisme. La distinction est ce qui dit à l'administrateur que ce compte
    attend le temps, et pas nous.
    """
    compte = await creer_compte(session)
    await relever(session, compte, **SAIN)

    coherence = service.evaluer(await service.charger(session, compte), get_settings())
    assert (
        verdict_de(coherence, service.Signal.REGULARITE_DE_PUBLICATION)
        is service.VerdictSignal.IGNORE_HISTORIQUE_INSUFFISANT
    )

    fenetre = get_settings().verification_regularity_window_days
    await vieillir_les_releves(session, compte, fenetre + 1)
    await relever(session, compte, followers_count=13_000, media_count=230)

    coherence = service.evaluer(await service.charger(session, compte), get_settings())
    assert (
        verdict_de(coherence, service.Signal.REGULARITE_DE_PUBLICATION)
        is service.VerdictSignal.TENU
    )


async def test_une_progression_nulle_ne_bloque_jamais(session: AsyncSession) -> None:
    """La restriction qui protège notre cible principale.

    `media_count` ne compte pas les stories. Un créateur qui publie exclusivement
    en story — le profil même du palier d'entrée — a une progression nulle pour
    toujours. Si ce signal pouvait manquer, chaque réexécution le recondamnerait
    au lieu de le sauver.
    """
    compte = await creer_compte(session)
    await relever(session, compte, **SAIN)

    fenetre = get_settings().verification_regularity_window_days
    await vieillir_les_releves(session, compte, fenetre + 1)
    compte.verification_status = VerificationStatus.NEEDS_REVIEW
    # Mêmes chiffres qu'il y a trois semaines : rien n'a bougé côté `media_count`.
    await relever(session, compte, **SAIN)

    coherence = service.evaluer(await service.charger(session, compte), get_settings())
    constat = next(
        c for c in coherence.constats if c.signal is service.Signal.REGULARITE_DE_PUBLICATION
    )

    # Neutre, jamais manqué — et le constat dit quand même ce qui a été mesuré.
    assert constat.verdict is service.VerdictSignal.IGNORE_HISTORIQUE_INSUFFISANT
    assert constat.constate == 0
    assert coherence.manques == ()
    # Conséquence directe : le compte n'est pas retenu par ce signal-là.
    assert compte.verification_status is VerificationStatus.VERIFIED


def test_la_regularite_ne_manque_jamais_quelle_que_soit_la_progression() -> None:
    """Éprouvé sur toute la plage, y compris une régression du compteur.

    Un test qui ne montrerait que la progression nulle laisserait croire que
    seul ce cas est protégé.
    """
    settings = get_settings()
    ancien = datetime.now(UTC) - timedelta(days=settings.verification_regularity_window_days + 1)

    for depart, arrivee in ((208, 208), (208, 150), (208, 209), (0, 0)):
        premier = service.ReleveEvalue(
            followers_count=12_400, media_count=depart, engagement_rate=None, captured_at=ancien
        )
        dernier = service.ReleveEvalue(
            followers_count=12_400,
            media_count=arrivee,
            engagement_rate=None,
            captured_at=datetime.now(UTC),
        )
        coherence = service.evaluer(compte_evalue(premier=premier, dernier=dernier), settings)
        assert (
            verdict_de(coherence, service.Signal.REGULARITE_DE_PUBLICATION)
            is not service.VerdictSignal.MANQUE
        ), f"{depart} → {arrivee}"


async def test_un_relevé_echoue_ne_declenche_aucune_verification(session: AsyncSession) -> None:
    """Le contrôle s'accroche au relevé réussi, pas à la tentative."""
    from app.integrations.social import SocialProviderError

    compte = await creer_compte(session)

    with pytest.raises(SocialProviderError):
        await metrics_service.refresh_profile_metrics(
            session,
            account=compte,
            provider=FauxFournisseur(leve=SocialProviderError("panne")),
        )

    assert compte.verification_status is VerificationStatus.NEEDS_REVIEW
    assert compte.verification_reviewed_at is None


# --------------------------------------------------------------------------
# la file d'administration
# --------------------------------------------------------------------------


async def test_l_administrateur_prononce_rejected_et_la_transition_est_journalisee(
    session: AsyncSession,
) -> None:
    compte = await creer_compte(session)
    await relever(session, compte, **ACHETE)

    admin = await inscrire_verifie(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password="tourbillon-cactus-91-vermeil",
        role=UserRole.ADMIN,
    )

    await service.prononcer(
        session,
        account=compte,
        vers=VerificationStatus.REJECTED,
        actor=Actor.from_user(admin),
        reason="profil incohérent, abonnés manifestement achetés",
    )

    assert compte.verification_status is VerificationStatus.REJECTED

    ligne = await session.scalar(
        sa.select(AuditLog).where(
            AuditLog.entity_id == compte.id, AuditLog.to_status == VerificationStatus.REJECTED.value
        )
    )
    assert ligne is not None
    assert ligne.actor_kind is ActorKind.ADMIN
    assert ligne.actor_user_id == admin.id
    assert ligne.from_status == VerificationStatus.NEEDS_REVIEW.value
    assert "achetés" in ligne.reason


async def test_l_administrateur_peut_redescendre_un_compte_verified(
    session: AsyncSession,
) -> None:
    """Le seul chemin descendant du produit."""
    compte = await creer_compte(session)
    await relever(session, compte, **SAIN)
    assert compte.verification_status is VerificationStatus.VERIFIED

    admin = await inscrire_verifie(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password="tourbillon-cactus-91-vermeil",
        role=UserRole.ADMIN,
    )

    await service.prononcer(
        session,
        account=compte,
        vers=VerificationStatus.NEEDS_REVIEW,
        actor=Actor.from_user(admin),
        reason="signalement reçu, à réexaminer",
    )

    assert compte.verification_status is VerificationStatus.NEEDS_REVIEW
    file = {c.id for c, _ in await service.file_d_administration(session)}
    assert compte.id in file


async def test_prononcer_le_statut_courant_est_refuse(session: AsyncSession) -> None:
    compte = await creer_compte(session)
    admin = await inscrire_verifie(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password="tourbillon-cactus-91-vermeil",
        role=UserRole.ADMIN,
    )

    with pytest.raises(service.TransitionNotAllowed):
        await service.prononcer(
            session,
            account=compte,
            vers=VerificationStatus.NEEDS_REVIEW,
            actor=Actor.from_user(admin),
            reason="sans effet",
        )

    # La session reste utilisable, et rien n'a été journalisé.
    assert (
        await session.scalar(
            sa.select(sa.func.count()).select_from(AuditLog).where(AuditLog.entity_id == compte.id)
        )
        == 0
    )


async def test_un_compte_rejected_n_est_pas_relève_par_une_reexecution(
    session: AsyncSession,
) -> None:
    """Une réexécution ne défait pas la décision d'un administrateur."""
    compte = await creer_compte(session, verification_status=VerificationStatus.REJECTED)

    await relever(session, compte, **SAIN)

    assert compte.verification_status is VerificationStatus.REJECTED


# --------------------------------------------------------------------------
# les routes
# --------------------------------------------------------------------------


async def _connecte(client: AsyncClient, role: UserRole) -> dict:
    email, password = f"{uuid.uuid4()}@example.com", "tourbillon-cactus-91-vermeil"
    cree = await client.post(
        f"{PREFIX}/auth/register",
        json={"email": email, "password": password, "role": role.value},
    )
    assert cree.status_code == 201, cree.text
    jetons = (
        await client.post(f"{PREFIX}/auth/login", json={"email": email, "password": password})
    ).json()
    return {"headers": {"Authorization": f"Bearer {jetons['access_token']}"}}


async def test_la_file_est_reservee_aux_administrateurs(
    client: AsyncClient, session: AsyncSession
) -> None:
    createur = await _connecte(client, UserRole.CREATOR)

    refuse = await client.get(f"{PREFIX}/admin/social-accounts/review", **createur)
    assert refuse.status_code == 403

    admin = await _connecte(client, UserRole.ADMIN)
    accepte = await client.get(f"{PREFIX}/admin/social-accounts/review", **admin)
    assert accepte.status_code == 200


async def test_la_route_de_verdict_rend_les_constats(
    client: AsyncClient, session: AsyncSession
) -> None:
    compte = await creer_compte(session)
    await relever(session, compte, **ACHETE)
    await session.commit()

    admin = await _connecte(client, UserRole.ADMIN)

    en_attente = await client.get(f"{PREFIX}/admin/social-accounts/review", **admin)
    assert compte.id in {uuid.UUID(ligne["social_account_id"]) for ligne in en_attente.json()}

    reponse = await client.post(
        f"{PREFIX}/admin/social-accounts/{compte.id}/verification",
        json={"status": VerificationStatus.REJECTED.value, "reason": "abonnés achetés"},
        **admin,
    )

    assert reponse.status_code == 200, reponse.text
    corps = reponse.json()
    assert corps["verification_status"] == VerificationStatus.REJECTED.value
    assert corps["verification_reviewed_at"] is not None
    assert {c["signal"] for c in corps["constats"]} == {s.value for s in service.Signal}

    apres = await client.get(f"{PREFIX}/admin/social-accounts/review", **admin)
    assert compte.id not in {uuid.UUID(ligne["social_account_id"]) for ligne in apres.json()}


async def test_un_verdict_sans_motif_est_refuse(client: AsyncClient, session: AsyncSession) -> None:
    """Une décision qui ferme la porte à quelqu'un doit dire pourquoi."""
    compte = await creer_compte(session)
    await session.commit()
    admin = await _connecte(client, UserRole.ADMIN)

    reponse = await client.post(
        f"{PREFIX}/admin/social-accounts/{compte.id}/verification",
        json={"status": VerificationStatus.REJECTED.value, "reason": ""},
        **admin,
    )
    assert reponse.status_code == 422
