"""Le semis de démonstration replanté par le service de fond, une fois par nuit.

**Ce que ces tests protègent est la même chose, par plusieurs bouts** : ce semis
détruit tout — `reset_schema` supprime chaque table avant de migrer —, il ne
doit donc ni partir de lui-même, ni partir sur une base qu'on n'a pas nommée, ni
partir deux fois, ni partir en plein jour.

Le choix de l'instant est tenu par deux fonctions pures, éprouvées ici sans
horloge ni base : une date calculée depuis l'heure de la machine rendrait ces
cas verts ou rouges selon le moment où la suite tourne.
"""

from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from app.core import config as module_config
from app.core.config import Settings
from app.seed import SeedRefused
from app.workers import __main__ as service


def _reglages(**overrides):
    """Des réglages construits, **jamais lus du `.env` de la machine**.

    `_env_file=None` est le point qui compte : un test de configuration qui lit
    le fichier du poste passe chez qui porte les identifiants et tombe en
    intégration continue. Même forme que dans `test_seed.py`.
    """
    valeurs = {
        "_env_file": None,
        "database_url": "postgresql+psycopg://x:y@ailleurs.example/bind_demo",
        "jwt_secret_key": "peu-importe-ici-mais-assez-longue-pour-hmac",
        "token_encryption_key": "dGVzdC10ZXN0LXRlc3QtdGVzdC10ZXN0LXRlc3QtdGVzdC10ZXN0",
    }
    return module_config.build_settings(**(valeurs | overrides))


def test_le_semis_automatique_est_inerte_par_defaut() -> None:
    """Vide, et lu sur le **défaut du champ** et non sur des réglages construits.

    La différence n'est pas cosmétique : `build_settings()` retombe sur
    l'environnement du processus, où la variable peut être posée. C'est le
    défaut du code qu'un environnement neuf emporte, et c'est lui qu'on éprouve.
    """
    assert Settings.model_fields["demo_reseed_hour"].default is None


#: Une nuit de Miami, et le jour d'avant. Fixes : une date calculée depuis
#: l'horloge de la machine rendrait ces cas verts ou rouges selon l'heure à
#: laquelle la suite tourne.
NUIT = datetime(2026, 9, 4, 4, 30, tzinfo=ZoneInfo("America/New_York"))
VEILLE = date(2026, 9, 3)


@pytest.mark.parametrize(
    ("maintenant", "heure", "dernier_jour", "attendu", "cas"),
    [
        (NUIT, 4, VEILLE, True, "l'heure est venue et la nuit n'a pas été semée"),
        (
            NUIT,
            4,
            NUIT.date(),
            False,
            "déjà semé cette nuit : on ne recommence pas au tour suivant",
        ),
        (NUIT, 5, VEILLE, False, "l'heure n'est pas encore venue"),
        (NUIT, None, VEILLE, False, "aucune heure posée : le semis n'a jamais lieu"),
        (NUIT.replace(hour=23), 4, VEILLE, True, "le soir compte pour le jour, pas pour la nuit"),
    ],
)
def test_quand_la_nuit_est_venue(maintenant, heure, dernier_jour, attendu, cas) -> None:
    """**Les deux conditions, et le fait qu'aucune ne suffit seule.**

    Le deuxième cas est celui qui compte : l'heure passée reste vraie pendant
    l'heure entière, et la boucle repasse toutes les trente secondes. Une
    implémentation qui ne regarde que l'heure sèmerait cent vingt fois de suite,
    ce que le premier cas ne distinguerait pas d'une bonne.
    """
    assert service._doit_semer(maintenant, heure=heure, dernier_jour=dernier_jour) is attendu


@pytest.mark.parametrize(
    ("heure_de_demarrage", "attendu", "cas"),
    [
        (
            6,
            date(2026, 9, 4),
            "démarré après l'heure : la nuit compte pour semée, on attend demain",
        ),
        (3, date(2026, 9, 3), "démarré avant l'heure : on sème le jour même, une heure plus tard"),
    ],
)
def test_ce_que_le_demarrage_considere_comme_deja_seme(heure_de_demarrage, attendu, cas) -> None:
    """**Un redéploiement ne doit pas semer, et ne doit pas non plus faire sauter
    une nuit.**

    Les deux cas divergent — c'est tout l'intérêt. Poser `aujourd'hui` dans les
    deux ferait attendre vingt-cinq heures au service redémarré à trois heures ;
    poser `la veille` dans les deux ferait table rase dans la minute à chaque
    fusion sur `main`, c'est-à-dire en pleine journée.
    """
    maintenant = NUIT.replace(hour=heure_de_demarrage)

    assert service._jour_deja_seme(maintenant, heure=4) == attendu


async def test_un_semis_dont_la_cible_est_refusee_n_efface_rien(monkeypatch) -> None:
    """Le refus arrive **avant** la première écriture, pas après.

    L'ordre est tout ce qu'il y a à garder ici. Vérifier la cible après avoir
    fait table rase donnerait le même refus, la même trace, le même code de
    sortie — et une base déjà détruite. Le test le distingue en constatant
    qu'aucun des gestes suivants n'a eu lieu.
    """
    gestes: list[str] = []

    monkeypatch.setattr(service, "get_settings", lambda: _reglages(environment="staging"))
    monkeypatch.setattr(service, "check_object_store_configuration", lambda: gestes.append("dépôt"))
    monkeypatch.setattr(service.seed, "reset_schema", lambda: gestes.append("table rase"))

    async def _populate():
        gestes.append("écriture")

    monkeypatch.setattr(service.seed, "populate", _populate)

    with pytest.raises(SeedRefused):
        await service._semer_a_nouveau()

    assert gestes == []
