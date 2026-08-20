"""Le sens des événements du score, et la date de fin d'une autorisation.

Deux données que le serveur possédait sans les rendre, et le même défaut dans
les deux cas : l'écran savait *quelque chose*, mais le savait tout seul.

**Le sens vient du poids, jamais d'une table écrite à côté.** L'écran de
fiabilité récitait les sept événements et leur signe depuis du texte figé. Un
exploitant qui inverserait un poids en configuration l'aurait rendu faux sans
qu'aucun test ne tombe — c'est exactement ce que ce fichier éprouve, en
inversant réellement un poids et en vérifiant que le sens suit.

**Et une autorisation finie porte sa date.** `status` disait « révoquée » sans
dire quand ; la seule façon de l'apprendre était de heurter l'obstacle d'un
palier, c'est-à-dire de découvrir la panne au moment de réserver.
"""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import SocialAccount
from app.models.enums import ReliabilityEventType
from app.services import audience as audience_service
from app.services import creator_tiers, reliability
from tests.test_feed import createur


@pytest.fixture
def poids_du_jour():
    """Remplace la grille et rend la configuration après coup.

    Le cache de `get_settings` est vidé des deux côtés : sans quoi le réglage
    posé ici fuirait dans les tests suivants, et une suite qui se contamine
    elle-même finit par prouver le contraire de ce qu'elle affirme.
    """
    original = dict(get_settings().reliability_weights)

    def poser(**changements: str):
        get_settings().reliability_weights.update(
            {clef: Decimal(valeur) for clef, valeur in changements.items()}
        )

    yield poser
    get_settings().reliability_weights.clear()
    get_settings().reliability_weights.update(original)


# --------------------------------------------------------------------------
# le sens des événements
# --------------------------------------------------------------------------


def test_les_neuf_evenements_sortent_avec_leur_sens() -> None:
    """Tous, y compris ceux dont le poids est nul.

    Taire un poids nul ferait disparaître de l'écran quelque chose qui existe
    et qui peut redevenir non nul au premier réglage : « ce qui affecte le
    score » doit pouvoir dire « ceci ne l'affecte pas ».
    """
    composantes = reliability.composantes()

    assert len(composantes) == len(ReliabilityEventType)
    assert {c.evenement for c in composantes} == set(ReliabilityEventType)


def test_le_sens_suit_le_poids_et_non_une_liste_ecrite_a_cote(poids_du_jour) -> None:
    """**Le test qui manquait**, et le seul qui distingue les deux mondes.

    Une table récitée et une dérivation du poids rendent le même verdict sur la
    configuration par défaut : c'est précisément pour ça que le défaut a vécu
    si longtemps. Le décor doit donc *diverger* — on inverse réellement le
    poids d'une absence, et on regarde si le sens suit.
    """
    par_defaut = {c.evenement: c.sens for c in reliability.composantes()}
    assert par_defaut[ReliabilityEventType.NO_SHOW] is reliability.SensDuScore.DESCEND
    assert par_defaut[ReliabilityEventType.COLLAB_COMPLETED] is reliability.SensDuScore.MONTE

    # L'exploitant fait l'inverse de ce que l'écran récitait.
    poids_du_jour(no_show="7", collab_completed="-1")

    apres = {c.evenement: c.sens for c in reliability.composantes()}
    assert apres[ReliabilityEventType.NO_SHOW] is reliability.SensDuScore.MONTE
    assert apres[ReliabilityEventType.COLLAB_COMPLETED] is reliability.SensDuScore.DESCEND


def test_un_poids_nul_est_neutre_et_non_une_baisse(poids_du_jour) -> None:
    """Trois valeurs, pas deux.

    Ranger le zéro avec « descend » afficherait une pénalité qui n'existe pas —
    et le signalement écarté est justement à zéro **délibérément**, pour ne pas
    décourager de signaler.
    """
    assert reliability.sens(ReliabilityEventType.ABUSIVE_REPORT) is reliability.SensDuScore.NEUTRE

    poids_du_jour(abusive_report="-4")
    assert reliability.sens(ReliabilityEventType.ABUSIVE_REPORT) is reliability.SensDuScore.DESCEND


async def test_les_composantes_arrivent_jusqu_a_la_vue_des_paliers(
    session: AsyncSession,
) -> None:
    """Le service peut les produire sans que la vue les laisse passer."""
    user, _ = await createur(session)

    vue = await creator_tiers.vue_des_paliers(session, creator_id=user.id)

    assert len(vue.fiabilite.composantes) == len(ReliabilityEventType)
    monte = {
        c.evenement for c in vue.fiabilite.composantes if c.sens is reliability.SensDuScore.MONTE
    }
    assert ReliabilityEventType.COLLAB_COMPLETED in monte
    assert ReliabilityEventType.NO_SHOW not in monte


async def test_les_poids_eux_memes_ne_sortent_jamais(session: AsyncSession) -> None:
    """L'écran nomme, il ne barème pas.

    « −25 » ne veut rien dire à qui ne connaît pas l'échelle, et le servir
    inviterait à l'afficher — lire « une absence coûte vingt-cinq points » sur
    cent transformerait une explication en barème.

    La garde porte sur **les clés servies**, et non sur une recherche de la
    valeur dans le corps : une première version cherchait « 5 » dans le JSON et
    le trouvait dans un UUID. Un décor qui accuse le hasard ne prouve rien, et
    aurait fini par être désactivé plutôt que corrigé.
    """
    user, _ = await createur(session)
    vue = await creator_tiers.vue_des_paliers(session, creator_id=user.id)

    from app.schemas.creator_tiers import VueDesPaliersRead

    corps = VueDesPaliersRead.model_validate(vue).model_dump(mode="json")
    composantes = corps["fiabilite"]["composantes"]

    assert composantes, "la liste vide passerait cette garde sans rien servir"
    for composante in composantes:
        assert set(composante) == {"evenement", "sens"}


# --------------------------------------------------------------------------
# la date de fin d'autorisation
# --------------------------------------------------------------------------


async def test_la_carte_dit_quand_l_autorisation_tombe(session: AsyncSession) -> None:
    """La date, et pas seulement le verdict.

    L'échéance est posée **dans le passé** : c'est le cas où le champ sert à
    quelque chose, et un décor à venir ne distinguerait pas une lecture juste
    d'une lecture qui rendrait n'importe quelle date du compte.
    """
    user, compte = await createur(session)
    tombee = datetime.now(UTC) - timedelta(days=3)
    await session.execute(
        sa.update(SocialAccount)
        .where(SocialAccount.id == compte.id)
        .values(token_expires_at=tombee)
    )
    await session.flush()

    lignes = await audience_service.audience(session, creator_id=user.id)

    assert lignes[0].token_expires_at is not None
    assert abs((lignes[0].token_expires_at - tombee).total_seconds()) < 1
    # Et ce n'est pas la date de rattachement qu'on a servie par erreur : les
    # deux sont des dates du même compte, et rien d'autre ne les départage.
    assert lignes[0].token_expires_at != compte.connected_at


async def test_une_plateforme_qui_ne_borne_rien_rend_nul(session: AsyncSession) -> None:
    """Nul veut dire « on ne sait pas », jamais « c'est bon ».

    Le vide est ici le bon résultat, et non le symptôme : c'est `status` qui
    tranche, et lui seul.
    """
    user, compte = await createur(session)
    await session.execute(
        sa.update(SocialAccount).where(SocialAccount.id == compte.id).values(token_expires_at=None)
    )
    await session.flush()

    lignes = await audience_service.audience(session, creator_id=user.id)

    assert lignes[0].token_expires_at is None
    # Le compte est toujours là, et toujours lisible : un nul sur la date n'est
    # pas un compte absent.
    assert lignes[0].social_account_id == compte.id
