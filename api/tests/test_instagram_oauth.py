"""Connexion OAuth Instagram.

Deux propriétés portent tout le reste. Un jeton n'est jamais lisible en base —
vérifié par lecture SQL directe, pas au travers de l'ORM qui déchiffrerait. Et
un état ne sert qu'une fois, à celui qui l'a demandé : un état devinable ou
rejouable, c'est le rattachement du compte social d'un inconnu au compte BIND
d'un créateur.

Aucun appel réseau. Le fournisseur réel est éprouvé sur un transport simulé, le
service sur un faux fournisseur.
"""

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import httpx
import pytest
import sqlalchemy as sa
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

from app.core import encryption
from app.core.config import ConfigurationError, get_settings
from app.core.security import TokenType, create_token
from app.integrations.instagram import InstagramProvider
from app.integrations.social import (
    IdentiteSociale,
    JetonEchange,
    SocialProviderError,
)
from app.models import OAuthState, SocialAccount
from app.models.enums import Platform, SocialAccountStatus, UserRole, VerificationStatus
from app.routers.social_accounts import get_instagram_provider
from tests.factories import new_creator

PREFIX = get_settings().api_v1_prefix

JETON = "IGQVJXY-un-jeton-de-longue-duree-tres-secret"


# --------------------------------------------------------------------------
# faux fournisseur
# --------------------------------------------------------------------------


class FauxInstagram:
    platform = Platform.INSTAGRAM
    #: Il tient la place du fournisseur réel : c'est ce qu'il déclare.
    mode = "live"

    def __init__(self, *, external_id: str = "17841400000000001", handle: str = "rebecca.miami"):
        self.external_id = external_id
        self.handle = handle
        self.codes: list[str] = []

    def authorization_url(self, *, state: str) -> str:
        return f"https://instagram.example/authorize?state={state}"

    async def exchange_code(self, code: str) -> JetonEchange:
        self.codes.append(code)
        return JetonEchange(access_token=JETON, expires_at=datetime.now(UTC) + timedelta(days=60))

    async def fetch_identity(self, access_token: str) -> IdentiteSociale:
        return IdentiteSociale(external_id=self.external_id, handle=self.handle)


@pytest.fixture
def instagram() -> FauxInstagram:
    return FauxInstagram()


@pytest.fixture
async def client_ig(client: AsyncClient, instagram: FauxInstagram) -> AsyncClient:
    """Le même client, avec le fournisseur remplacé."""
    application = client._transport.app  # noqa: SLF001 - accès assumé au harnais
    application.dependency_overrides[get_instagram_provider] = lambda: instagram
    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://test"
    ) as http:
        yield http


async def createur(client: AsyncClient) -> dict:
    email = f"{uuid.uuid4()}@example.com"
    password = "un-mot-de-passe-solide-42"
    created = await client.post(
        f"{PREFIX}/auth/register",
        json={"email": email, "password": password, "role": UserRole.CREATOR.value},
    )
    assert created.status_code == 201, created.text
    tokens = (
        await client.post(f"{PREFIX}/auth/login", json={"email": email, "password": password})
    ).json()
    return {
        "user_id": uuid.UUID(created.json()["id"]),
        "headers": {"Authorization": f"Bearer {tokens['access_token']}"},
    }


async def demarrer(client: AsyncClient, compte: dict) -> str:
    """Démarre un parcours et rend l'état contenu dans l'URL."""
    response = await client.post(
        f"{PREFIX}/me/social-accounts/instagram/connect", headers=compte["headers"]
    )
    assert response.status_code == 200, response.text
    return httpx.URL(response.json()["authorization_url"]).params["state"]


async def revenir(client: AsyncClient, state: str, code: str = "un-code-meta"):
    return await client.get(
        f"{PREFIX}/social-accounts/instagram/callback", params={"code": code, "state": state}
    )


# --------------------------------------------------------------------------
# le chiffrement
# --------------------------------------------------------------------------


def test_un_aller_retour_de_chiffrement_rend_le_texte() -> None:
    assert encryption.decrypt(encryption.encrypt(JETON)) == JETON


def test_deux_chiffrements_du_meme_texte_different() -> None:
    """Nonce tiré à chaque fois : deux jetons identiques ne se reconnaissent pas en base."""
    assert encryption.encrypt(JETON) != encryption.encrypt(JETON)


def test_le_binaire_porte_l_identifiant_de_cle() -> None:
    """Sans lui, changer de clé obligerait à tout redéchiffrer d'un coup."""
    blob = encryption.encrypt(JETON)
    longueur = blob[0]

    assert blob[1 : 1 + longueur].decode() == get_settings().token_encryption_key_id


def test_une_cle_inconnue_est_signalee_pas_devinee(monkeypatch: pytest.MonkeyPatch) -> None:
    blob = encryption.encrypt(JETON)
    altere = bytes([2]) + b"v9" + blob[1 + blob[0] :]

    with pytest.raises(encryption.DecryptionError, match="v9"):
        encryption.decrypt(altere)


def test_un_binaire_altere_est_refuse() -> None:
    """AES-GCM authentifie : une modification ne passe pas pour du texte valide."""
    blob = bytearray(encryption.encrypt(JETON))
    blob[-1] ^= 0xFF

    with pytest.raises(encryption.DecryptionError):
        encryption.decrypt(bytes(blob))


# --------------------------------------------------------------------------
# le parcours
# --------------------------------------------------------------------------


async def test_le_parcours_complet_rattache_le_compte(
    client_ig: AsyncClient, instagram: FauxInstagram, conn: AsyncConnection
) -> None:
    compte = await createur(client_ig)
    state = await demarrer(client_ig, compte)

    response = await revenir(client_ig, state)

    assert response.status_code == 200, response.text
    corps = response.json()
    assert corps["handle"] == instagram.handle
    assert corps["platform"] == Platform.INSTAGRAM.value
    assert corps["status"] == SocialAccountStatus.ACTIVE.value
    # La vérification de cohérence est une tâche à part : le compte arrive en
    # revue et ne réserve rien tant qu'elle n'a pas tranché.
    assert corps["verification_status"] == VerificationStatus.NEEDS_REVIEW.value


async def test_aucun_jeton_ne_sort_par_l_api(client_ig: AsyncClient) -> None:
    compte = await createur(client_ig)
    state = await demarrer(client_ig, compte)
    await revenir(client_ig, state)

    liste = await client_ig.get(f"{PREFIX}/me/social-accounts", headers=compte["headers"])

    assert liste.status_code == 200
    assert JETON not in liste.text
    assert "token" not in liste.text.replace("token_expires_at", "")


async def test_le_jeton_n_est_jamais_lisible_en_base(
    client_ig: AsyncClient, conn: AsyncConnection
) -> None:
    """Lecture SQL directe, sans l'ORM : c'est lui qui déchiffrerait."""
    compte = await createur(client_ig)
    state = await demarrer(client_ig, compte)
    await revenir(client_ig, state)

    brut = await conn.scalar(sa.text("SELECT access_token_encrypted FROM social_account LIMIT 1"))

    assert brut is not None
    assert isinstance(brut, bytes | memoryview)
    assert JETON.encode() not in bytes(brut)
    assert b"IGQVJ" not in bytes(brut)


async def test_l_orm_rend_le_jeton_en_clair(client_ig: AsyncClient, conn: AsyncConnection) -> None:
    """Le chiffrement est porté par le type : aucun code métier ne le voit."""
    compte = await createur(client_ig)
    state = await demarrer(client_ig, compte)
    await revenir(client_ig, state)

    lu = await conn.scalar(sa.select(SocialAccount.access_token_encrypted))

    assert lu == JETON


# --------------------------------------------------------------------------
# l'état
# --------------------------------------------------------------------------


async def test_un_etat_fabrique_est_refuse(client_ig: AsyncClient) -> None:
    await createur(client_ig)

    response = await revenir(client_ig, "pas-un-etat")

    assert response.status_code == 400
    assert response.json()["detail"] == "oauth_state_invalid"


async def test_un_etat_deja_consomme_est_refuse(client_ig: AsyncClient) -> None:
    """Le rejeu est la prise de compte : rattacher son propre Instagram au BIND d'un autre."""
    compte = await createur(client_ig)
    state = await demarrer(client_ig, compte)
    premier = await revenir(client_ig, state)
    assert premier.status_code == 200

    rejeu = await revenir(client_ig, state)

    assert rejeu.status_code == 400
    assert rejeu.json()["detail"] == "oauth_state_invalid"


async def test_un_etat_expire_est_refuse(client_ig: AsyncClient, conn: AsyncConnection) -> None:
    compte = await createur(client_ig)
    state = await demarrer(client_ig, compte)
    await conn.execute(
        sa.update(OAuthState).values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
    )

    response = await revenir(client_ig, state)

    assert response.status_code == 400
    assert response.json()["detail"] == "oauth_state_invalid"


async def test_un_etat_signe_pour_un_autre_utilisateur_est_refuse(
    client_ig: AsyncClient, conn: AsyncConnection
) -> None:
    """La ligne dit qui a démarré, le jeton dit qui prétend revenir. Les deux doivent coïncider."""
    compte = await createur(client_ig)
    await demarrer(client_ig, compte)
    etat_id = await conn.scalar(sa.select(OAuthState.id))

    contrefait = create_token(
        subject=uuid.uuid4(),
        token_type=TokenType.OAUTH_STATE,
        token_id=etat_id,
        lifetime=timedelta(minutes=10),
    )
    response = await revenir(client_ig, contrefait)

    assert response.status_code == 400
    assert response.json()["detail"] == "oauth_state_invalid"


async def test_un_jeton_d_acces_ne_sert_pas_d_etat(client_ig: AsyncClient) -> None:
    """Le contrôle de type empêche de réutiliser un jeton de session comme état."""
    compte = await createur(client_ig)
    jeton = compte["headers"]["Authorization"].removeprefix("Bearer ")

    response = await revenir(client_ig, jeton)

    assert response.status_code == 400


async def test_un_etat_inexistant_en_base_est_refuse(client_ig: AsyncClient) -> None:
    """Signature valide, ligne absente : le jeton seul ne suffit pas."""
    compte = await createur(client_ig)
    orphelin = create_token(
        subject=compte["user_id"],
        token_type=TokenType.OAUTH_STATE,
        token_id=uuid.uuid4(),
        lifetime=timedelta(minutes=10),
    )

    response = await revenir(client_ig, orphelin)

    assert response.status_code == 400


# --------------------------------------------------------------------------
# reconnexion et reprise
# --------------------------------------------------------------------------


async def test_une_reconnexion_met_a_jour_sans_dupliquer(
    client_ig: AsyncClient, instagram: FauxInstagram, conn: AsyncConnection
) -> None:
    """Un jeton qui a expiré se reconnecte : c'est le geste normal, pas un conflit."""
    compte = await createur(client_ig)
    await revenir(client_ig, await demarrer(client_ig, compte))

    instagram.handle = "rebecca.miami.officiel"
    seconde = await revenir(client_ig, await demarrer(client_ig, compte))

    assert seconde.status_code == 200
    assert seconde.json()["handle"] == "rebecca.miami.officiel"

    combien = await conn.scalar(sa.select(sa.func.count()).select_from(SocialAccount))
    assert combien == 1


async def test_une_reconnexion_remet_le_compte_en_actif(
    client_ig: AsyncClient, conn: AsyncConnection
) -> None:
    compte = await createur(client_ig)
    await revenir(client_ig, await demarrer(client_ig, compte))
    await conn.execute(sa.update(SocialAccount).values(status=SocialAccountStatus.EXPIRED))

    seconde = await revenir(client_ig, await demarrer(client_ig, compte))

    assert seconde.json()["status"] == SocialAccountStatus.ACTIVE.value


async def test_un_compte_lie_a_un_autre_createur_ne_se_reprend_pas(
    client_ig: AsyncClient, conn: AsyncConnection
) -> None:
    premier = await createur(client_ig)
    await revenir(client_ig, await demarrer(client_ig, premier))

    second = await createur(client_ig)
    response = await revenir(client_ig, await demarrer(client_ig, second))

    assert response.status_code == 409
    assert response.json()["detail"] == "social_account_taken"
    assert "violates" not in response.text

    # La session doit avoir survécu au refus.
    liste = await client_ig.get(f"{PREFIX}/me/social-accounts", headers=second["headers"])
    assert liste.status_code == 200
    assert liste.json() == []


# --------------------------------------------------------------------------
# accès
# --------------------------------------------------------------------------


async def test_seul_un_createur_demarre_un_parcours(client_ig: AsyncClient) -> None:
    email = f"{uuid.uuid4()}@example.com"
    password = "un-mot-de-passe-solide-42"
    await client_ig.post(
        f"{PREFIX}/auth/register",
        json={"email": email, "password": password, "role": UserRole.BUSINESS_MEMBER.value},
    )
    tokens = (
        await client_ig.post(f"{PREFIX}/auth/login", json={"email": email, "password": password})
    ).json()

    response = await client_ig.post(
        f"{PREFIX}/me/social-accounts/instagram/connect",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "insufficient_role"


async def test_un_createur_ne_voit_que_ses_comptes(
    client_ig: AsyncClient, conn: AsyncConnection
) -> None:
    voisin = await new_creator(conn)
    await conn.execute(
        sa.insert(SocialAccount).values(
            creator_id=voisin, platform=Platform.INSTAGRAM, external_id="autre", handle="voisin"
        )
    )
    compte = await createur(client_ig)
    await revenir(client_ig, await demarrer(client_ig, compte))

    liste = await client_ig.get(f"{PREFIX}/me/social-accounts", headers=compte["headers"])

    assert [ligne["handle"] for ligne in liste.json()] == ["rebecca.miami"]


# --------------------------------------------------------------------------
# le fournisseur réel, sur transport simulé
# --------------------------------------------------------------------------


def test_l_url_d_autorisation_porte_l_etat_et_les_droits(instagram_configure) -> None:
    provider = InstagramProvider(httpx.AsyncClient(transport=httpx.MockTransport(lambda r: None)))

    url = httpx.URL(provider.authorization_url(state="un-etat"))

    assert url.params["state"] == "un-etat"
    assert url.params["client_id"] == "1234567890"
    assert url.params["response_type"] == "code"
    assert "instagram_business_basic" in url.params["scope"]


async def test_l_echange_passe_par_le_jeton_de_longue_duree(
    instagram_configure, transport_meta
) -> None:
    """Sans la seconde étape, la connexion expirerait dans l'heure."""
    transport = transport_meta(
        {
            "api.instagram.com/oauth/access_token": httpx.Response(
                200, json={"access_token": "court", "user_id": 1}
            ),
            "graph.instagram.com/access_token": httpx.Response(
                200, json={"access_token": "long", "expires_in": 5_184_000}
            ),
        }
    )

    async with httpx.AsyncClient(transport=transport) as http:
        jeton = await InstagramProvider(http).exchange_code("un-code#_")

    assert jeton.access_token == "long"
    assert jeton.expires_at is not None
    assert (jeton.expires_at - datetime.now(UTC)).days > 55
    # Le suffixe que Meta accole parfois au code ne fait pas partie du code.
    envoye = transport.appels[0].content
    assert b"code=un-code" in envoye
    assert b"%23_" not in envoye


async def test_l_identite_est_lue_mais_aucune_metrique(instagram_configure, transport_meta) -> None:
    transport = transport_meta(
        {
            "graph.instagram.com/me": httpx.Response(
                200, json={"id": "178414", "username": "rebecca"}
            )
        }
    )

    async with httpx.AsyncClient(transport=transport) as http:
        identite = await InstagramProvider(http).fetch_identity("un-jeton")

    assert identite == IdentiteSociale(external_id="178414", handle="rebecca")
    assert transport.appels[0].url.params["fields"] == "id,username"


async def test_une_erreur_de_meta_ne_remonte_pas_telle_quelle(
    instagram_configure, transport_meta
) -> None:
    """Leur message parle de leur API, pas de ce que le créateur doit faire."""
    transport = transport_meta(
        {
            "api.instagram.com": httpx.Response(
                400, json={"error_message": "Invalid platform app", "error_type": "OAuthException"}
            )
        }
    )

    async with httpx.AsyncClient(transport=transport) as http:
        with pytest.raises(SocialProviderError) as excinfo:
            await InstagramProvider(http).exchange_code("un-code")

    assert "Invalid platform app" not in str(excinfo.value)


def test_sans_application_declaree_le_fournisseur_refuse_d_exister(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """L'absence de configuration n'est pas un repli : elle est signalée ici, pas chez Meta.

    L'absence est **posée**, pas empruntée au `.env` du poste : le test passait
    tant que personne n'avait déclaré d'application Meta en développement, et
    tombait le jour où quelqu'un en déclarait une.
    """
    from app.core import config as module_config
    from app.core import encryption
    from app.integrations import instagram as module_instagram

    sans_application = module_config.build_settings(
        _env_file=None,
        database_url=str(get_settings().database_url),
        jwt_secret_key="peu-importe-ici-mais-assez-longue-pour-hmac",
        token_encryption_key=encryption.generate_key(),
        instagram_app_id=None,
        instagram_app_secret=None,
        instagram_redirect_uri=None,
    )
    monkeypatch.setattr(module_instagram, "get_settings", lambda: sans_application)

    with pytest.raises(ConfigurationError, match="INSTAGRAM_APP_ID"):
        InstagramProvider(httpx.AsyncClient())


# --------------------------------------------------------------------------
# Le retour dans l'application
# --------------------------------------------------------------------------
#
# Le rappel arrive sur le serveur ; l'application est ailleurs — sur un
# téléphone, à une autre adresse. Sans redirection, le parcours se termine sur
# du JSON affiché dans un navigateur : le compte est rattaché, et l'application
# ne le sait jamais.


async def demarrer_avec_retour(client: AsyncClient, compte: dict, retour: str):
    return await client.post(
        f"{PREFIX}/me/social-accounts/instagram/connect",
        headers=compte["headers"],
        json={"return_url": retour},
    )


async def test_le_rappel_renvoie_dans_l_application(
    client_ig: AsyncClient, instagram: FauxInstagram
) -> None:
    compte = await createur(client_ig)
    retour = "exp://192.168.4.54:8081/--/oauth"

    ouverture = await demarrer_avec_retour(client_ig, compte, retour)
    assert ouverture.status_code == 200, ouverture.text
    state = httpx.URL(ouverture.json()["authorization_url"]).params["state"]

    reponse = await revenir(client_ig, state)

    assert reponse.status_code == 303
    destination = httpx.URL(reponse.headers["location"])
    assert str(destination).startswith(retour)
    assert destination.params["statut"] == "rattache"
    # Ni jeton ni code dans l'adresse : ils ont été échangés côté serveur, et
    # une adresse se dépose dans l'historique du navigateur et dans les
    # journaux du système.
    assert "access_token" not in str(destination)
    assert "code=" not in str(destination)


async def test_sans_adresse_de_retour_le_rappel_rend_le_compte(
    client_ig: AsyncClient, instagram: FauxInstagram
) -> None:
    """Un navigateur n'a pas d'application à rejoindre : le JSON reste juste."""
    compte = await createur(client_ig)
    state = await demarrer(client_ig, compte)

    reponse = await revenir(client_ig, state)

    assert reponse.status_code == 200
    assert reponse.json()["platform"] == Platform.INSTAGRAM.value


@pytest.mark.parametrize(
    "adresse",
    [
        "https://exemple-hostile.test/vole",
        # Une origine http non déclarée reste refusée : c'est la liste des
        # origines de confiance qui ouvre, pas le schéma.
        "http://exemple-hostile.test/vole",
        "javascript:alert(1)",
        "//exemple-hostile.test",
        "",
    ],
)
async def test_une_adresse_de_retour_etrangere_est_refusee(
    client_ig: AsyncClient, instagram: FauxInstagram, adresse: str
) -> None:
    """Une adresse fournie par le client et suivie sans contrôle est une

    redirection ouverte : de quoi faire aboutir un parcours d'autorisation BIND
    sur un site tiers. Refusée **à l'ouverture** — au rappel, la personne a
    déjà autorisé chez Meta, et il est trop tard pour faire quelque chose de
    propre.
    """
    compte = await createur(client_ig)

    reponse = await demarrer_avec_retour(client_ig, compte, adresse)

    assert reponse.status_code == 400
    assert reponse.json()["detail"] == "validation_failed"


@pytest.mark.parametrize(
    "adresse",
    [
        "exp://10.0.0.7:8081/--/oauth",
        "exp+bind://oauth",
        "bind://oauth",
        # Le web : l'adresse de retour est celle de la page, et son origine
        # figure déjà dans CORS_ORIGINS. Sans cette branche, le rattachement
        # était impossible dans un navigateur — et le refus revenait sous
        # « information manquante ou incorrecte », qui n'aide personne.
        "http://localhost:8081/oauth",
    ],
)
async def test_les_schemas_de_l_application_sont_acceptes(
    client_ig: AsyncClient, instagram: FauxInstagram, adresse: str
) -> None:
    """L'autre sens. Une liste qui refuserait tout passerait le test précédent

    sans rien garantir, et le retour ne marcherait jamais.
    """
    compte = await createur(client_ig)

    reponse = await demarrer_avec_retour(client_ig, compte, adresse)

    assert reponse.status_code == 200, reponse.text


async def test_un_echec_revient_aussi_dans_l_application(
    client_ig: AsyncClient, instagram: FauxInstagram, conn: AsyncConnection
) -> None:
    """Un rappel qui échouerait en silence laisserait l'application attendre.

    Le compte appartient déjà à quelqu'un d'autre : la redirection porte le
    code d'erreur, que l'application sait traduire.
    """
    premier = await createur(client_ig)
    await revenir(client_ig, await demarrer(client_ig, premier))

    second = await createur(client_ig)
    retour = "bind://oauth"
    ouverture = await demarrer_avec_retour(client_ig, second, retour)
    state = httpx.URL(ouverture.json()["authorization_url"]).params["state"]

    reponse = await revenir(client_ig, state)

    assert reponse.status_code == 303
    destination = httpx.URL(reponse.headers["location"])
    assert destination.params["statut"] == "erreur"
    assert destination.params["code"] == "social_account_taken"


async def test_le_rattachement_planifie_le_premier_releve(
    client_ig: AsyncClient, instagram: FauxInstagram, conn: AsyncConnection
) -> None:
    """Sans ça, le fil est vide juste après avoir connecté son compte.

    Les deux travaux étaient laissés à la réconciliation périodique. Tant
    qu'elle n'avait pas tourné, aucun relevé n'existait, le moteur de paliers
    n'avait aucun chiffre à juger, et le créateur concluait que le produit ne
    marchait pas — constaté sur un vrai compte Instagram.
    """
    compte = await createur(client_ig)
    await revenir(client_ig, await demarrer(client_ig, compte))

    lignes = await conn.execute(
        sa.text(
            "select j.job_type from job j"
            " join social_account sa on sa.id = j.target_id"
            " where sa.creator_id = :createur"
        ),
        {"createur": compte["user_id"]},
    )
    planifies = {ligne.job_type for ligne in lignes}

    assert planifies == {"token_refresh", "metrics_refresh"}


async def test_une_reconnexion_ne_replanifie_pas(
    client_ig: AsyncClient, instagram: FauxInstagram, conn: AsyncConnection
) -> None:
    """`planifier` ne touche pas un job existant : ni son échéance, ni son statut.

    Reconnecter un compte ne doit pas repousser un relevé déjà dû, ni réarmer
    un job épuisé — ce serait une façon de contourner l'épuisement en
    rebranchant son compte.
    """
    compte = await createur(client_ig)
    await revenir(client_ig, await demarrer(client_ig, compte))

    # `attempts` avec le statut : une contrainte en base refuse un job épuisé
    # sans tentative, et elle a raison — un épuisement sans essai ne veut rien
    # dire.
    await conn.execute(
        sa.text(
            "update job set status = 'exhausted', attempts = 5 where target_id in"
            " (select id from social_account where creator_id = :createur)"
        ),
        {"createur": compte["user_id"]},
    )
    await conn.commit()

    await revenir(client_ig, await demarrer(client_ig, compte))

    restants = await conn.execute(
        sa.text(
            "select j.status from job j join social_account sa on sa.id = j.target_id"
            " where sa.creator_id = :createur"
        ),
        {"createur": compte["user_id"]},
    )
    assert {ligne.status for ligne in restants} == {"exhausted"}


async def test_le_mode_du_fournisseur_est_ecrit_au_rattachement(
    client_ig: AsyncClient, instagram: FauxInstagram, conn: AsyncConnection
) -> None:
    """Rien dans la ligne ne permettrait de le retrouver après coup.

    Sans lui, un compte rattaché en démonstration est indiscernable d'un compte
    réel le jour où le mode change — et c'est exactement ce cas qu'il faut
    savoir nommer, parce qu'aucun geste du créateur ne le récupérera.
    """
    # Une identité à part : `FauxInstagram` en rend une seule, et un test plus
    # haut dans le fichier l'a déjà rattachée à un autre créateur. Réutiliser la
    # même ferait répondre 409, sans compte créé — et l'assertion tomberait sur
    # une ligne absente en accusant l'écriture du mode.
    instagram.external_id = "17841400000000042"
    compte = await createur(client_ig)
    await revenir(client_ig, await demarrer(client_ig, compte))

    mode = await conn.scalar(
        sa.text("select provider_mode from social_account where creator_id = :createur"),
        {"createur": compte["user_id"]},
    )

    # Comparé à ce que **le fournisseur** déclare, pas au réglage : les deux
    # divergent dès que le jeu de données construit ses propres fournisseurs
    # simulés alors que la configuration dit « live ».
    assert mode == instagram.mode


async def test_un_compte_d_un_autre_fournisseur_n_est_pas_reconnectable(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """La règle, dans les deux sens.

    Un mode inconnu ne conclut rien : les lignes antérieures à la colonne n'ont
    pas à être déclarées cassées sur une supposition.
    """
    from app.services import social_accounts as module

    for mode, attendu in (("demo", False), ("live", True), (None, True)):
        compte = SocialAccount(platform=Platform.INSTAGRAM, provider_mode=mode)
        monkeypatch.setattr(module, "get_settings", lambda: SimpleNamespace(social_provider="live"))
        assert module.reconnectable(compte) is attendu
