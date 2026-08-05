"""Codes d'erreur et catalogue serveur.

L'API ne renvoie jamais de texte destiné à l'affichage. Le contrat avec
l'application est une liste de codes stables, et c'est cette liste qui doit être
protégée de la dérive : un code inventé dans un routeur n'a aucun message en
face de lui, et l'utilisateur voit un libellé générique là où il devrait
comprendre ce qui s'est passé.
"""

import ast
import json

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.config import API_ROOT, get_settings
from app.core.errors import ErrorCode
from app.core.i18n import DEFAULT_LOCALE, LOCALES_DIR, available_keys, translate, translate_for
from app.models.enums import Locale, UserRole
from app.models.identity import User
from tests.factories import PASSWORD, new_user

PREFIX = get_settings().api_v1_prefix
CODES = {code.value for code in ErrorCode}


# --------------------------------------------------------------------------
# le catalogue de codes est la source de vérité
# --------------------------------------------------------------------------


def test_aucun_code_d_erreur_ecrit_a_la_main_dans_le_code() -> None:
    """Un `detail="..."` littéral court-circuite le catalogue et personne ne le voit."""
    hors_catalogue: list[str] = []

    for path in sorted((API_ROOT / "app").rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.keyword) or node.arg != "detail":
                continue
            if not isinstance(node.value, ast.Constant) or not isinstance(node.value.value, str):
                continue
            if node.value.value not in CODES:
                hors_catalogue.append(
                    f"{path.relative_to(API_ROOT)}:{node.lineno} → {node.value.value!r}"
                )

    assert hors_catalogue == [], "codes absents de ErrorCode"


@pytest.mark.parametrize(
    ("methode", "chemin", "payload", "statut"),
    [
        ("post", "/auth/login", {"email": "a@b.co", "password": "un-mot-de-passe-42"}, 401),
        ("post", "/auth/refresh", {"refresh_token": "pas-un-jeton"}, 401),
        ("post", "/auth/logout", {"refresh_token": "pas-un-jeton"}, 401),
        (
            "post",
            "/auth/register",
            {"email": "pas-une-adresse", "password": "x", "role": "creator"},
            422,
        ),
        ("get", "/me", None, 401),
        ("get", "/probe/creator-only", None, 401),
    ],
)
async def test_toute_erreur_renvoyee_est_dans_le_catalogue(
    client: AsyncClient, methode: str, chemin: str, payload: dict | None, statut: int
) -> None:
    call = getattr(client, methode)
    response = (
        await call(f"{PREFIX}{chemin}", json=payload)
        if payload
        else await call(f"{PREFIX}{chemin}")
    )

    assert response.status_code == statut
    assert response.json()["detail"] in CODES


async def test_les_erreurs_de_role_et_d_appartenance_sont_dans_le_catalogue(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    email = "catalogue@example.com"
    await new_user(conn, email=email, role=UserRole.CREATOR)
    tokens = (
        await client.post(f"{PREFIX}/auth/login", json={"email": email, "password": PASSWORD})
    ).json()
    entete = {"Authorization": f"Bearer {tokens['access_token']}"}

    interdit = await client.get(f"{PREFIX}/probe/admin-only", headers=entete)
    assert interdit.status_code == 403
    assert interdit.json()["detail"] in CODES


async def test_un_422_ne_renvoie_jamais_la_valeur_rejetee(client: AsyncClient) -> None:
    """La réponse par défaut de FastAPI contient `input` : un mot de passe repartait tel quel."""
    mot_de_passe = "trop-court-mais-identifiable"

    response = await client.post(
        f"{PREFIX}/auth/register",
        json={"email": "x@example.com", "password": mot_de_passe[:5], "role": "creator"},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == ErrorCode.VALIDATION_FAILED.value
    assert mot_de_passe[:5] not in response.text
    assert "input" not in response.text


# --------------------------------------------------------------------------
# catalogue serveur
# --------------------------------------------------------------------------


def test_les_catalogues_serveur_ont_exactement_les_memes_cles() -> None:
    """Une clé présente d'un seul côté est un message qui manquera dans une langue."""
    par_locale = {
        locale: set(json.loads((LOCALES_DIR / f"{locale.value}.json").read_text(encoding="utf-8")))
        for locale in Locale
    }

    reference = par_locale[DEFAULT_LOCALE]
    for locale, cles in par_locale.items():
        assert cles == reference, f"écart de clés sur {locale.value} : {cles ^ reference}"


@pytest.mark.parametrize(
    ("locale", "attendu"),
    [(Locale.EN, "Welcome to BIND"), (Locale.ES, "Te damos la bienvenida a BIND")],
)
def test_le_message_est_rendu_dans_la_langue_demandee(locale: Locale, attendu: str) -> None:
    assert translate("account.welcome.subject", locale=locale) == attendu


def test_une_cle_inconnue_leve_plutot_que_de_rendre_une_chaine_vide() -> None:
    with pytest.raises(KeyError):
        translate("cle.qui.nexiste.pas")


def test_la_langue_est_celle_du_destinataire_pas_celle_de_l_appelant() -> None:
    destinataire = User(role=UserRole.CREATOR, email="es@example.com", locale=Locale.ES)

    assert translate_for(destinataire, "account.welcome.subject").startswith("Te damos")


def test_toutes_les_cles_du_catalogue_sont_exposees() -> None:
    assert available_keys() == {"account.welcome.subject"}


# --------------------------------------------------------------------------
# la locale du compte
# --------------------------------------------------------------------------


async def test_la_locale_est_posee_a_l_inscription(client: AsyncClient) -> None:
    response = await client.post(
        f"{PREFIX}/auth/register",
        json={
            "email": "espagnol@example.com",
            "password": "un-mot-de-passe-solide-42",
            "role": "creator",
            "locale": "es",
        },
    )

    assert response.status_code == 201
    assert response.json()["locale"] == Locale.ES.value


async def test_la_locale_par_defaut_est_l_anglais(client: AsyncClient) -> None:
    response = await client.post(
        f"{PREFIX}/auth/register",
        json={
            "email": "defaut@example.com",
            "password": "un-mot-de-passe-solide-42",
            "role": "creator",
        },
    )

    assert response.json()["locale"] == Locale.EN.value


async def test_la_locale_est_modifiable_par_le_compte(client: AsyncClient) -> None:
    email = "bascule@example.com"
    password = "un-mot-de-passe-solide-42"
    await client.post(
        f"{PREFIX}/auth/register",
        json={"email": email, "password": password, "role": "creator"},
    )
    tokens = (
        await client.post(f"{PREFIX}/auth/login", json={"email": email, "password": password})
    ).json()
    entete = {"Authorization": f"Bearer {tokens['access_token']}"}

    modifie = await client.patch(f"{PREFIX}/me", json={"locale": "es"}, headers=entete)
    assert modifie.status_code == 200
    assert modifie.json()["locale"] == Locale.ES.value

    relu = await client.get(f"{PREFIX}/me", headers=entete)
    assert relu.json()["locale"] == Locale.ES.value


async def test_une_locale_inconnue_est_refusee(client: AsyncClient) -> None:
    response = await client.post(
        f"{PREFIX}/auth/register",
        json={
            "email": "klingon@example.com",
            "password": "un-mot-de-passe-solide-42",
            "role": "creator",
            "locale": "kl",
        },
    )
    assert response.status_code == 422
