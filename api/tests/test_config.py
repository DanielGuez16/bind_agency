"""Une configuration invalide doit dire quoi corriger, jamais ce qu'elle a lu.

Le message de démarrage est ce qu'on colle dans un ticket quand le déploiement
échoue. S'il porte la clé de signature ou le mot de passe de la base, ils sont
perdus au moment même où on demande de l'aide.
"""

import traceback

import pytest

from app.core.config import ConfigurationError, build_settings

VARIABLES = (
    "ENVIRONMENT",
    "DATABASE_URL",
    "TEST_DATABASE_URL",
    "JWT_SECRET_KEY",
    "JWT_ALGORITHM",
    "CORS_ORIGINS",
    "ACCESS_TOKEN_TTL_SECONDS",
    "REFRESH_TOKEN_TTL_SECONDS",
)

SECRET = "clef-qui-ne-doit-jamais-apparaitre-dans-une-trace-1234567890"
URL_INVALIDE = "ceci-nest-pas-une-url-de-base"


@pytest.fixture
def environnement_nu(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ni variables d'environnement, ni fichier .env : on part de rien."""
    for name in VARIABLES:
        monkeypatch.delenv(name, raising=False)


def test_une_variable_manquante_est_nommee(environnement_nu: None) -> None:
    with pytest.raises(ConfigurationError) as excinfo:
        build_settings(_env_file=None)

    message = str(excinfo.value)
    assert "database_url" in message
    assert "jwt_secret_key" in message
    assert "missing" in message
    assert "api/.env.example" in message


def test_aucune_valeur_recue_n_apparait_dans_le_message(
    environnement_nu: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("DATABASE_URL", URL_INVALIDE)
    monkeypatch.setenv("JWT_SECRET_KEY", SECRET)

    with pytest.raises(ConfigurationError) as excinfo:
        build_settings(_env_file=None)

    message = str(excinfo.value)
    assert "database_url" in message, "le champ fautif doit rester diagnosticable"
    assert URL_INVALIDE not in message
    assert SECRET not in message


def test_aucune_valeur_recue_n_apparait_dans_la_trace_complete(
    environnement_nu: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """C'est le vrai test : la ValidationError chaînée recracherait tout.

    Sans `raise ... from None`, la trace affichée par Python contient encore
    `input_value={...}` avec l'intégralité du dictionnaire d'entrée.
    """
    monkeypatch.setenv("DATABASE_URL", URL_INVALIDE)
    monkeypatch.setenv("JWT_SECRET_KEY", SECRET)

    with pytest.raises(ConfigurationError) as excinfo:
        build_settings(_env_file=None)

    trace = "".join(traceback.format_exception(excinfo.value))
    assert SECRET not in trace
    assert URL_INVALIDE not in trace
    assert "input_value" not in trace


def test_une_configuration_complete_se_charge(
    environnement_nu: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@localhost:5432/db")
    monkeypatch.setenv("JWT_SECRET_KEY", SECRET)

    settings = build_settings(_env_file=None)

    assert settings.jwt_secret_key.get_secret_value() == SECRET
    # SecretStr et repr=False : ni la clé ni l'URL ne sortent par un repr.
    assert SECRET not in repr(settings)
    assert "localhost:5432" not in repr(settings)
