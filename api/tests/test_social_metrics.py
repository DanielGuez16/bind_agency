"""Relevé et historisation des métriques sociales.

Aucun appel réseau. Le fournisseur réel est éprouvé sur un transport simulé
(`MockTransport`), le service sur un faux fournisseur programmable.

La propriété centrale n'est pas « on sait lire un JSON », c'est **ce qui reste
écrit quand ça se passe mal**. Un snapshot faux est pire qu'un snapshot absent :
l'éligibilité ne sait pas qu'un chiffre est douteux, elle le compare au seuil et
tranche. Chaque test d'échec vérifie donc deux choses — l'erreur remontée, et
l'absence de trace.
"""

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import httpx
import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.integrations.instagram import InstagramProvider
from app.integrations.social import (
    MetriquesProfil,
    SocialAuthError,
    SocialProviderError,
)
from app.models import SocialAccount, SocialMetricsSnapshot
from app.models.enums import Platform, SocialAccountStatus, UserRole, VerificationStatus
from app.routers.social_accounts import get_instagram_provider
from app.services import auth as auth_service
from app.services import eligibility
from app.services import metrics as service

PREFIX = get_settings().api_v1_prefix

PROFIL_COMPLET = {"followers_count": 12_400, "follows_count": 310, "media_count": 208}


# --------------------------------------------------------------------------
# harnais
# --------------------------------------------------------------------------


class FauxFournisseur:
    """Fournisseur programmable : ce qu'il rend, ou ce qu'il lève.

    Il compte ses appels. Plusieurs tests portent sur ce qui se passe **sans**
    appel — refus trop rapproché, compte inactif — et l'absence d'erreur ne
    prouverait rien si on ne vérifiait pas que la plateforme n'a pas été
    interrogée.
    """

    platform = Platform.INSTAGRAM
    #: Il tient la place d'un fournisseur réel.
    mode = "live"

    def __init__(self, *, rend: MetriquesProfil | None = None, leve: Exception | None = None):
        self.rend = rend
        self.leve = leve
        self.appels = 0

    def authorization_url(self, *, state: str) -> str:  # pragma: no cover - hors sujet ici
        return f"https://instagram.example/authorize?state={state}"

    async def exchange_code(self, code: str):  # pragma: no cover - hors sujet ici
        raise NotImplementedError

    async def fetch_identity(self, access_token: str):  # pragma: no cover - hors sujet ici
        raise NotImplementedError

    async def fetch_profile_metrics(
        self, access_token: str, *, external_id: str
    ) -> MetriquesProfil:
        self.appels += 1
        if self.leve is not None:
            raise self.leve
        assert self.rend is not None
        return self.rend


def metriques(**overrides) -> MetriquesProfil:
    valeurs = {
        "followers_count": 12_400,
        "following_count": 310,
        "media_count": 208,
        "audience_demographics": {"country": {"US": 9_800, "MX": 1_200}},
        "raw_payload": dict(PROFIL_COMPLET),
    }
    return MetriquesProfil(**(valeurs | overrides))


async def compte_actif(session: AsyncSession, **overrides) -> SocialAccount:
    """Un créateur et son compte social, par le service d'inscription.

    Le compte est posé directement ici, et pas par le parcours OAuth : ce
    fichier éprouve le relevé, pas le rattachement. C'est un montage de test,
    pas un jeu de données — la règle sur les valeurs posées à la main vise ce
    dernier.
    """
    user = await auth_service.register(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password="un-mot-de-passe-solide-42",
        role=UserRole.CREATOR,
    )

    valeurs = {
        "creator_id": user.id,
        "platform": Platform.INSTAGRAM,
        "external_id": f"1784140{uuid.uuid4().int % 10**10}",
        "handle": "compte.dessai",
        "access_token_encrypted": "IGQVJXY-jeton-de-longue-duree",
        "status": SocialAccountStatus.ACTIVE,
        "verification_status": VerificationStatus.VERIFIED,
    }
    compte = SocialAccount(**(valeurs | overrides))
    session.add(compte)
    await session.flush()
    return compte


async def compter_snapshots(session: AsyncSession, account_id: uuid.UUID) -> int:
    return await session.scalar(
        sa.select(sa.func.count())
        .select_from(SocialMetricsSnapshot)
        .where(SocialMetricsSnapshot.social_account_id == account_id)
    )


# --------------------------------------------------------------------------
# le chemin nominal
# --------------------------------------------------------------------------


async def test_releve_ecrit_un_snapshot_complet(session: AsyncSession) -> None:
    compte = await compte_actif(session)

    snapshot = await service.refresh_profile_metrics(
        session, account=compte, provider=FauxFournisseur(rend=metriques())
    )

    assert snapshot.followers_count == 12_400
    assert snapshot.following_count == 310
    assert snapshot.media_count == 208
    assert snapshot.audience_demographics == {"country": {"US": 9_800, "MX": 1_200}}
    # Conservé tel quel : c'est ce qui permettra de recalculer sans redemander.
    assert snapshot.raw_payload == PROFIL_COMPLET
    # Ni l'un ni l'autre ne se déduit du profil. Zéro serait une mesure.
    assert snapshot.avg_views is None
    assert snapshot.engagement_rate is None

    assert compte.last_synced_at is not None
    assert compte.status is SocialAccountStatus.ACTIVE


# --------------------------------------------------------------------------
# ce qui reste écrit quand ça échoue
# --------------------------------------------------------------------------


async def test_echec_reseau_n_ecrit_rien_et_ne_bascule_rien(session: AsyncSession) -> None:
    compte = await compte_actif(session)

    with pytest.raises(SocialProviderError):
        await service.refresh_profile_metrics(
            session,
            account=compte,
            provider=FauxFournisseur(leve=SocialProviderError("Instagram injoignable")),
        )

    # La session reste utilisable : un refus n'est pas une transaction perdue.
    assert await compter_snapshots(session, compte.id) == 0
    assert compte.status is SocialAccountStatus.ACTIVE
    assert compte.last_synced_at is None


async def test_refus_d_authentification_bascule_le_compte_sans_ecrire(
    session: AsyncSession,
) -> None:
    compte = await compte_actif(session)

    with pytest.raises(service.SocialTokenExpired):
        await service.refresh_profile_metrics(
            session,
            account=compte,
            provider=FauxFournisseur(leve=SocialAuthError("jeton refusé")),
        )

    assert await compter_snapshots(session, compte.id) == 0
    # Le seul échec qui laisse une trace, et elle est durable : relue depuis la
    # base, pas seulement depuis l'objet en mémoire.
    assert (
        await session.scalar(sa.select(SocialAccount.status).where(SocialAccount.id == compte.id))
        == SocialAccountStatus.EXPIRED.value
    )
    assert compte.last_synced_at is None


async def test_reponse_sans_abonnes_n_ecrit_aucun_snapshot(
    session: AsyncSession, instagram_configure, transport_meta
) -> None:
    """Le refus vient du fournisseur, avant le service : un `MetriquesProfil`
    sans abonnés ne peut pas exister, c'est le type qui l'interdit.

    Le vrai `InstagramProvider` est employé ici, pas le faux : c'est lui qui
    décide qu'une réponse est incomplète, et c'est donc lui qu'il faut éprouver.
    """
    compte = await compte_actif(session)
    transport = transport_meta(
        {"graph.instagram.com/me": httpx.Response(200, json={"follows_count": 310})}
    )

    async with httpx.AsyncClient(transport=transport) as http:
        with pytest.raises(SocialProviderError, match="followers_count"):
            await service.refresh_profile_metrics(
                session, account=compte, provider=InstagramProvider(http)
            )

    assert await compter_snapshots(session, compte.id) == 0
    # Une réponse incomplète n'est pas un jeton refusé : le compte ne bascule pas.
    assert compte.status is SocialAccountStatus.ACTIVE


async def test_reponse_sans_demographie_ecrit_un_snapshot(session: AsyncSession) -> None:
    """L'audience est optionnelle : Meta la refuse aux petits comptes, et ce
    n'est pas une erreur. Un snapshot sans elle vaut mieux que pas de snapshot,
    parce que l'éligibilité ne regarde que les abonnés."""
    compte = await compte_actif(session)

    snapshot = await service.refresh_profile_metrics(
        session,
        account=compte,
        provider=FauxFournisseur(rend=metriques(audience_demographics=None)),
    )

    assert snapshot.audience_demographics is None
    assert snapshot.followers_count == 12_400
    assert await compter_snapshots(session, compte.id) == 1


# --------------------------------------------------------------------------
# ajout seul
# --------------------------------------------------------------------------


async def test_deux_appels_font_deux_lignes(session: AsyncSession) -> None:
    """Même à chiffres identiques. « Rien n'a bougé » est une information, et
    l'écraser détruirait la seule preuve du relevé précédent."""
    compte = await compte_actif(session)
    provider = FauxFournisseur(rend=metriques())

    premier = await service.refresh_profile_metrics(session, account=compte, provider=provider)
    # Sans quoi le second appel serait refusé pour cause de fréquence : c'est
    # l'objet du test suivant, pas de celui-ci. Les deux dates comptent — la
    # borne se lit sur la dernière tentative autant que sur le dernier succès.
    compte.last_synced_at = compte.last_sync_attempt_at = None
    second = await service.refresh_profile_metrics(session, account=compte, provider=provider)

    assert premier.id != second.id
    assert premier.followers_count == second.followers_count
    assert await compter_snapshots(session, compte.id) == 2
    # `clock_timestamp()` et non `now()` : sans cela les deux lignes d'une même
    # transaction porteraient la même heure et « le dernier » n'aurait pas de
    # réponse.
    assert second.captured_at > premier.captured_at


# --------------------------------------------------------------------------
# fréquence
# --------------------------------------------------------------------------


async def test_releve_trop_rapproche_est_refuse(session: AsyncSession) -> None:
    compte = await compte_actif(session)
    provider = FauxFournisseur(rend=metriques())

    await service.refresh_profile_metrics(session, account=compte, provider=provider)

    with pytest.raises(service.RefreshTooSoon):
        await service.refresh_profile_metrics(session, account=compte, provider=provider)

    # Le refus est prononcé *avant* d'appeler la plateforme : c'est tout l'objet
    # de la limite. Un refus rendu après l'appel n'économiserait aucun quota.
    assert provider.appels == 1
    assert await compter_snapshots(session, compte.id) == 1


async def test_releve_repris_une_fois_le_delai_ecoule(session: AsyncSession) -> None:
    """Le pendant du test précédent. Une limite qui refuse toujours passerait
    le test de refus sans rien garantir."""
    compte = await compte_actif(session)
    provider = FauxFournisseur(rend=metriques())

    await service.refresh_profile_metrics(session, account=compte, provider=provider)

    intervalle = get_settings().metrics_min_refresh_interval_seconds
    passe = datetime.now(UTC) - timedelta(seconds=intervalle + 1)
    compte.last_synced_at = compte.last_sync_attempt_at = passe

    await service.refresh_profile_metrics(session, account=compte, provider=provider)
    assert await compter_snapshots(session, compte.id) == 2


async def test_compte_expire_n_est_pas_releve(session: AsyncSession) -> None:
    compte = await compte_actif(session, status=SocialAccountStatus.EXPIRED)
    provider = FauxFournisseur(rend=metriques())

    with pytest.raises(service.SocialAccountNotActive):
        await service.refresh_profile_metrics(session, account=compte, provider=provider)

    assert provider.appels == 0
    assert await compter_snapshots(session, compte.id) == 0


async def test_compte_d_un_autre_createur_est_introuvable(session: AsyncSession) -> None:
    compte = await compte_actif(session)
    autre = await compte_actif(session)

    with pytest.raises(service.SocialAccountNotFound):
        await service.get_owned_account(session, account_id=compte.id, creator_id=autre.creator_id)

    # Le sien reste accessible : le refus discrimine bien le propriétaire, il ne
    # refuse pas tout le monde.
    assert (
        await service.get_owned_account(session, account_id=compte.id, creator_id=compte.creator_id)
    ).id == compte.id


# --------------------------------------------------------------------------
# ce que l'historique sert à l'éligibilité
# --------------------------------------------------------------------------

#: Palier de référence le plus bas : instagram/story, 1000 abonnés, aucune
#: collaboration exigée, aucun score. Le seul dont un compte neuf peut relever.
STORY_INSTAGRAM = uuid.UUID("8f9bfcd8-39ff-41a3-9b6b-f00e40f8774d")


async def test_l_eligibilite_lit_le_dernier_releve(session: AsyncSession) -> None:
    """Le second relevé est **plus bas** que le premier, et sous le seuil.

    C'est ce qui rend le test concluant : lire le premier, le plus élevé, ou
    n'importe quel agrégat rendrait le créateur éligible. Seule la lecture du
    dernier le refuse. Un compte qui perd des abonnés doit perdre l'accès, sans
    quoi l'historique servirait de plancher permanent.
    """
    compte = await compte_actif(session)

    await service.refresh_profile_metrics(
        session, account=compte, provider=FauxFournisseur(rend=metriques(followers_count=12_400))
    )
    verdict = await eligibility.evaluer_createur(session, compte.creator_id)
    assert STORY_INSTAGRAM in verdict.paliers_accessibles

    compte.last_synced_at = compte.last_sync_attempt_at = None
    await service.refresh_profile_metrics(
        session, account=compte, provider=FauxFournisseur(rend=metriques(followers_count=800))
    )

    verdict = await eligibility.evaluer_createur(session, compte.creator_id)
    assert STORY_INSTAGRAM not in verdict.paliers_accessibles

    obstacles = verdict.obstacles_pour(compte.id, STORY_INSTAGRAM)
    raisons = {obstacle.raison for obstacle in obstacles}
    assert eligibility.RaisonRefus.NOT_ENOUGH_FOLLOWERS in raisons
    # Et l'écart est chiffré sur le dernier relevé, pas sur le plus favorable.
    manque = next(o for o in obstacles if o.raison is eligibility.RaisonRefus.NOT_ENOUGH_FOLLOWERS)
    assert manque.constate == 800


# --------------------------------------------------------------------------
# le fournisseur réel, sur transport simulé
# --------------------------------------------------------------------------


async def test_le_profil_demande_les_trois_compteurs(instagram_configure, transport_meta) -> None:
    transport = transport_meta(
        {
            "graph.instagram.com/me": httpx.Response(
                200, json={"followers_count": 12_400, "follows_count": 310, "media_count": 208}
            ),
            "/insights": httpx.Response(400, json={"error": {"code": 100, "type": "GraphMethod"}}),
        }
    )

    async with httpx.AsyncClient(transport=transport) as http:
        mesure = await InstagramProvider(http).fetch_profile_metrics("un-jeton", external_id="178")

    assert mesure.followers_count == 12_400
    # `follows_count` chez Meta, `following_count` chez nous. La traduction est
    # ici, elle ne remonte pas jusqu'au modèle.
    assert mesure.following_count == 310
    assert mesure.media_count == 208
    assert transport.appels[0].url.params["fields"] == "followers_count,follows_count,media_count"


async def test_un_compte_a_zero_abonne_n_est_pas_un_compte_sans_mesure(
    instagram_configure, transport_meta
) -> None:
    """Zéro est une valeur, pas une absence. Les confondre refuserait de mesurer
    exactement les comptes qui viennent de démarrer."""
    transport = transport_meta(
        {
            "graph.instagram.com/me": httpx.Response(
                200, json={"followers_count": 0, "follows_count": 0, "media_count": 0}
            ),
            "/insights": httpx.Response(400, json={"error": {"code": 100}}),
        }
    )

    async with httpx.AsyncClient(transport=transport) as http:
        mesure = await InstagramProvider(http).fetch_profile_metrics("un-jeton", external_id="178")

    assert mesure.followers_count == 0


async def test_l_audience_est_aplatie_par_axe(instagram_configure, transport_meta) -> None:
    transport = transport_meta(
        {
            "graph.instagram.com/me": httpx.Response(
                200, json={"followers_count": 12_400, "follows_count": 310, "media_count": 208}
            ),
            "/insights": httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "name": "follower_demographics",
                            "total_value": {
                                "breakdowns": [
                                    {
                                        "dimension_keys": ["country"],
                                        "results": [
                                            {"dimension_values": ["US"], "value": 9_800},
                                            {"dimension_values": ["MX"], "value": 1_200},
                                        ],
                                    }
                                ]
                            },
                        }
                    ]
                },
            ),
        }
    )

    async with httpx.AsyncClient(transport=transport) as http:
        mesure = await InstagramProvider(http).fetch_profile_metrics("un-jeton", external_id="178")

    assert mesure.audience_demographics is not None
    assert mesure.audience_demographics["country"] == {"US": 9_800, "MX": 1_200}


async def test_une_audience_refusee_ne_fait_pas_echouer_le_releve(
    instagram_configure, transport_meta
) -> None:
    """Meta refuse l'audience aux comptes en dessous de cent abonnés, et à ceux
    dont le type ne l'autorise pas. C'est la majorité des créateurs au
    lancement : faire échouer le relevé pour ça ne mesurerait personne."""
    transport = transport_meta(
        {
            "graph.instagram.com/me": httpx.Response(
                200, json={"followers_count": 84, "follows_count": 310, "media_count": 12}
            ),
            "/insights": httpx.Response(
                400, json={"error": {"code": 10, "message": "not enough followers"}}
            ),
        }
    )

    async with httpx.AsyncClient(transport=transport) as http:
        mesure = await InstagramProvider(http).fetch_profile_metrics("un-jeton", external_id="178")

    assert mesure.audience_demographics is None
    assert mesure.followers_count == 84


async def test_un_jeton_refuse_se_distingue_d_une_panne(
    instagram_configure, transport_meta
) -> None:
    """Toute la bascule en `expired` tient sur cette distinction. Meta répond
    400 dans les deux cas ; seul le corps les sépare."""
    jeton_mort = transport_meta(
        {
            "graph.instagram.com/me": httpx.Response(
                400, json={"error": {"type": "OAuthException", "code": 190}}
            )
        }
    )
    panne = transport_meta({"graph.instagram.com/me": httpx.Response(503, text="upstream down")})

    async with httpx.AsyncClient(transport=jeton_mort) as http:
        with pytest.raises(SocialAuthError):
            await InstagramProvider(http).fetch_profile_metrics("mort", external_id="178")

    async with httpx.AsyncClient(transport=panne) as http:
        with pytest.raises(SocialProviderError) as excinfo:
            await InstagramProvider(http).fetch_profile_metrics("bon", external_id="178")

    assert not isinstance(excinfo.value, SocialAuthError)


async def test_le_reseau_coupe_ne_traverse_pas_le_fournisseur(instagram_configure) -> None:
    """Une `httpx.ConnectError` nue remonterait jusqu'à la route en 500. Elle
    doit sortir d'ici comme un échec de plateforme, transitoire."""

    def couper(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connexion refusée", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(couper)) as http:
        with pytest.raises(SocialProviderError) as excinfo:
            await InstagramProvider(http).fetch_profile_metrics("un-jeton", external_id="178")

    assert not isinstance(excinfo.value, SocialAuthError)


# --------------------------------------------------------------------------
# la route
# --------------------------------------------------------------------------


async def _createur_connecte(client: AsyncClient) -> dict:
    email, password = f"{uuid.uuid4()}@example.com", "un-mot-de-passe-solide-42"
    cree = await client.post(
        f"{PREFIX}/auth/register",
        json={"email": email, "password": password, "role": UserRole.CREATOR.value},
    )
    assert cree.status_code == 201, cree.text
    jetons = (
        await client.post(f"{PREFIX}/auth/login", json={"email": email, "password": password})
    ).json()
    return {
        "user_id": uuid.UUID(cree.json()["id"]),
        "headers": {"Authorization": f"Bearer {jetons['access_token']}"},
    }


@pytest.fixture
def client_avec(client: AsyncClient):
    """Le même client, avec le fournisseur de son choix."""

    def monter(provider) -> AsyncClient:
        application = client._transport.app  # noqa: SLF001 - accès assumé au harnais
        application.dependency_overrides[get_instagram_provider] = lambda: provider
        return client

    return monter


async def test_la_route_rend_le_snapshot_cree(
    client: AsyncClient, client_avec, session: AsyncSession
) -> None:
    createur = await _createur_connecte(client)
    compte = await compte_actif(session, creator_id=createur["user_id"])
    await session.commit()

    http = client_avec(FauxFournisseur(rend=metriques()))
    reponse = await http.post(
        f"{PREFIX}/me/social-accounts/{compte.id}/metrics/refresh", headers=createur["headers"]
    )

    assert reponse.status_code == 201, reponse.text
    corps = reponse.json()
    assert corps["followers_count"] == 12_400
    # Le payload brut est conservé, pas servi : il porte la forme interne d'une
    # plateforme, qui n'est ni stable ni de notre ressort.
    assert "raw_payload" not in corps


async def test_la_route_conserve_la_bascule_en_expired(
    client: AsyncClient, client_avec, session: AsyncSession
) -> None:
    """La seule erreur dont la transaction est validée.

    L'annuler renverrait bien l'erreur au créateur, mais laisserait le compte
    affiché comme actif — et le relevé suivant irait redécouvrir la même chose
    chez Meta.
    """
    createur = await _createur_connecte(client)
    compte = await compte_actif(session, creator_id=createur["user_id"])
    await session.commit()

    http = client_avec(FauxFournisseur(leve=SocialAuthError("jeton refusé")))
    reponse = await http.post(
        f"{PREFIX}/me/social-accounts/{compte.id}/metrics/refresh", headers=createur["headers"]
    )

    assert reponse.status_code == 409
    assert reponse.json()["detail"] == "social_token_expired"

    statut = await session.scalar(
        sa.select(SocialAccount.status).where(SocialAccount.id == compte.id)
    )
    assert statut == SocialAccountStatus.EXPIRED.value


async def test_la_route_ignore_le_compte_d_un_autre(
    client: AsyncClient, client_avec, session: AsyncSession
) -> None:
    createur = await _createur_connecte(client)
    autre = await compte_actif(session)
    await session.commit()

    provider = FauxFournisseur(rend=metriques())
    http = client_avec(provider)
    reponse = await http.post(
        f"{PREFIX}/me/social-accounts/{autre.id}/metrics/refresh", headers=createur["headers"]
    )

    # 404 et non 403 : « il existe mais pas à vous » renseignerait qui tâtonne.
    assert reponse.status_code == 404
    assert reponse.json()["detail"] == "social_account_not_found"
    assert provider.appels == 0


async def test_le_renouvellement_repousse_l_echeance(instagram_configure, transport_meta) -> None:
    """Meta renouvelle le jeton de longue durée avec lui-même : il n'y a pas de
    jeton de renouvellement séparé chez Instagram."""
    transport = transport_meta(
        {
            "refresh_access_token": httpx.Response(
                200, json={"access_token": "jeton-neuf", "expires_in": 5_184_000}
            )
        }
    )

    async with httpx.AsyncClient(transport=transport) as http:
        jeton = await InstagramProvider(http).refresh_token(access_token="jeton-ancien")

    assert jeton.access_token == "jeton-neuf"
    assert (jeton.expires_at - datetime.now(UTC)).days > 55
    assert transport.appels[0].url.params["grant_type"] == "ig_refresh_token"


async def test_un_renouvellement_sur_jeton_mort_se_distingue_d_une_panne(
    instagram_configure, transport_meta
) -> None:
    """C'est cette distinction qui décide si le compte bascule en `expired`."""
    mort = transport_meta(
        {
            "refresh_access_token": httpx.Response(
                400, json={"error": {"type": "OAuthException", "code": 190}}
            )
        }
    )
    panne = transport_meta({"refresh_access_token": httpx.Response(500, text="oops")})

    async with httpx.AsyncClient(transport=mort) as http:
        with pytest.raises(SocialAuthError):
            await InstagramProvider(http).refresh_token(access_token="jeton-mort")

    async with httpx.AsyncClient(transport=panne) as http:
        with pytest.raises(SocialProviderError) as excinfo:
            await InstagramProvider(http).refresh_token(access_token="jeton-bon")

    assert not isinstance(excinfo.value, SocialAuthError)


async def test_un_compte_d_un_autre_fournisseur_ne_se_releve_pas(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Son jeton n'existe chez personne : partir l'interroger accuse un tiers.

    Un compte rattaché en démonstration porte un jeton qui n'a de sens que pour
    le fournisseur simulé. Le jour où le mode passe en réel, l'interroger chez
    Meta échoue — et l'échec revenait sous « la plateforme est indisponible »,
    ce qui envoie chercher une panne chez eux pour une cause locale.
    """
    from app.services import social_accounts as module_comptes

    compte = await compte_actif(session, provider_mode="demo")
    monkeypatch.setattr(
        module_comptes, "get_settings", lambda: SimpleNamespace(social_provider="live")
    )

    with pytest.raises(service.SocialAccountFromOtherProvider):
        await service.refresh_profile_metrics(
            session, account=compte, provider=object()  # type: ignore[arg-type]
        )

    # Et rien n'est écrit : la tentative n'a pas eu lieu, elle n'a consommé
    # aucun quota.
    assert await compter_snapshots(session, compte.id) == 0
    assert compte.last_sync_attempt_at is None


async def test_un_compte_du_meme_fournisseur_se_releve(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """L'autre sens. Une garde qui refuserait tout passerait le test précédent

    sans rien garantir, et plus aucun relevé n'aurait lieu.
    """
    from app.services import social_accounts as module_comptes

    compte = await compte_actif(session, provider_mode="live")
    monkeypatch.setattr(
        module_comptes, "get_settings", lambda: SimpleNamespace(social_provider="live")
    )

    snapshot = await service.refresh_profile_metrics(
        session,
        account=compte,
        provider=FauxFournisseur(rend=metriques(followers_count=12_000)),
    )

    assert snapshot.followers_count == 12_000
