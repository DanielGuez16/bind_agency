"""L'annuaire des créatrices vu par l'administration.

**Le score de fiabilité vit ici et nulle part ailleurs, et c'est un
renversement.** Le schéma refusait de le servir : « un classement de personnes
par note ne devient pas acceptable parce que c'est un administrateur qui le
lit ». L'argument portait sur le **classement**, et la conclusion l'a étendu à
la **donnée** — cet annuaire n'ordonne pas par score, il l'affiche sur la ligne
d'une personne qu'on est venu chercher par son pseudonyme.

Ce que la règle protège est intact et n'a jamais concerné ce lecteur-ci : un
commerce ne voit jamais ce nombre, et ce qui rend ce silence tenable est que le
palier accessible **est** le signal — un score dégradé plafonne mécaniquement.
L'administration, elle, arbitre des dossiers.

**Le décor obtient le score en le faisant produire, jamais en l'écrivant.** Une
valeur posée à la main sur `creator_profile.reliability_score` passerait ce test
sur un produit dont le mécanisme de score aurait disparu.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

from app.core.config import get_settings
from app.models import SocialMetricsSnapshot
from app.models.enums import ReliabilityEventType, UserRole
from app.services import reliability
from tests.conftest import inscrire_verifie
from tests.factories import new_creator, new_social_account

PREFIX = get_settings().api_v1_prefix
MOT_DE_PASSE = "tourbillon-cactus-91-vermeil"


async def jeton_administrateur(session: AsyncSession, client: AsyncClient) -> str:
    admin = await inscrire_verifie(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password=MOT_DE_PASSE,
        role=UserRole.ADMIN,
    )
    await session.commit()
    reponse = await client.post(
        f"{PREFIX}/auth/login", json={"email": admin.email, "password": MOT_DE_PASSE}
    )
    return reponse.json()["access_token"]


@pytest.mark.anyio
async def test_le_score_est_servi_et_le_neutre_reste_neutre(
    session: AsyncSession, conn: AsyncConnection, client: AsyncClient
) -> None:
    """**Deux créatrices qui divergent sur le seul champ qu'on éprouve.**

    Avec une seule, un service qui rendrait toujours `null` et un service qui
    rendrait toujours un nombre passeraient l'un comme l'autre. Il en faut une
    qui a un historique et une qui n'en a pas — et c'est précisément le couple
    que la règle du produit distingue : `null` signifie **neutre**, jamais zéro.
    """
    notee = await new_creator(conn)
    await new_social_account(conn, notee, handle="avec_historique")
    sans_historique = await new_creator(conn)
    await new_social_account(conn, sans_historique, handle="sans_historique")

    # Le score se fabrique par le mécanisme du produit : un événement réel,
    # puis le rafraîchissement des caches que `enregistrer` déclenche lui-même.
    await reliability.enregistrer(
        session, creator_id=notee, type_=ReliabilityEventType.PUBLISHED_ON_TIME
    )
    await session.commit()

    jeton = await jeton_administrateur(session, client)
    reponse = await client.get(
        f"{PREFIX}/admin/creators", headers={"Authorization": f"Bearer {jeton}"}
    )
    assert reponse.status_code == 200, reponse.text

    par_id = {ligne["creator_id"]: ligne for ligne in reponse.json()["items"]}

    # Celle qui a un historique porte un score, et il n'est pas nul.
    assert par_id[str(notee)]["reliability_score"] is not None

    # **Celle qui n'en a pas porte `null`, et surtout pas zéro.** Zéro la
    # classerait dernière d'une liste où elle n'est que la plus récente, et
    # c'est exactement la lecture que la règle du moteur de paliers interdit.
    assert par_id[str(sans_historique)]["reliability_score"] is None


@pytest.mark.anyio
async def test_un_commerce_n_atteint_pas_cet_annuaire(
    session: AsyncSession, conn: AsyncConnection, client: AsyncClient
) -> None:
    """**Le pendant, et c'est lui qui tient la promesse.**

    Servir le score à l'administration n'a de sens que si la porte reste fermée
    à tout le reste : un salon qui atteindrait cette route lirait le nombre
    qu'on lui promet de ne jamais montrer. Sans ce test, le renversement
    ci-dessus ouvrirait la donnée sans que rien ne dise à qui.
    """
    createur = await new_creator(conn)
    await new_social_account(conn, createur, handle="quelqu_un")

    commercant = await inscrire_verifie(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password=MOT_DE_PASSE,
        role=UserRole.BUSINESS_MEMBER,
    )
    await session.commit()

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login",
            json={"email": commercant.email, "password": MOT_DE_PASSE},
        )
    ).json()
    reponse = await client.get(
        f"{PREFIX}/admin/creators",
        headers={"Authorization": f"Bearer {jetons['access_token']}"},
    )

    assert reponse.status_code == 403, reponse.text


@pytest.mark.anyio
async def test_le_volume_vient_du_dernier_releve_et_la_route_repond(
    session: AsyncSession, conn: AsyncConnection, client: AsyncClient
) -> None:
    """**La route levait à chaque appel, et rien ne le disait.**

    Elle lisait `SocialAccount.followers_count`, un attribut qui n'existe pas :
    le volume vit sur `SocialMetricsSnapshot`. L'écran n'a donc jamais pu
    s'afficher, et aucun test serveur ne couvrait cette route — les tests de
    l'application simulent la couche HTTP et ne touchent jamais la requête.

    **Deux relevés, et c'est le décor qui compte.** Avec un seul, une jointure
    sur n'importe quel relevé rendrait le même verdict qu'une jointure sur le
    plus récent — c'est-à-dire tout le temps, jusqu'en production.
    """
    createur = await new_creator(conn)
    compte = await new_social_account(conn, createur, handle="deux_releves")

    for quand, combien in ((0, 1_000), (1, 2_500)):
        session.add(
            SocialMetricsSnapshot(
                social_account_id=compte,
                captured_at=datetime.now(UTC) + timedelta(minutes=quand),
                followers_count=combien,
                following_count=300,
                media_count=210,
                raw_payload={},
            )
        )
    await session.commit()

    jeton = await jeton_administrateur(session, client)
    reponse = await client.get(
        f"{PREFIX}/admin/creators", headers={"Authorization": f"Bearer {jeton}"}
    )
    assert reponse.status_code == 200, reponse.text

    ligne = next(x for x in reponse.json()["items"] if x["creator_id"] == str(createur))
    assert ligne["audience_totale"] == 2_500
    assert ligne["reseaux"][0]["followers"] == 2_500


@pytest.mark.anyio
async def test_l_enveloppe_compte_au_dela_du_plafond(
    session: AsyncSession, conn: AsyncConnection, client: AsyncClient
) -> None:
    """**Le total porte sur la recherche, la liste s'arrête au plafond.**

    C'est le manque que l'annuaire des salons avait déjà réglé, reposé ici : une
    liste bornée à cent sans total dit qu'elle tronque sans dire de combien, et
    « 128 sur BIND » ne se dérive pas de cent lignes.

    Le décor divergent est le dépassement. Sous le plafond, un service qui rend
    `len(items)` comme total et un service qui compte vraiment donnent le même
    nombre — il faut franchir la borne pour que les deux se séparent.
    """
    from app.routers.creator_admin import PLAFOND

    for rang in range(PLAFOND + 3):
        createur = await new_creator(conn)
        await new_social_account(conn, createur, handle=f"deborde_{rang}")

    jeton = await jeton_administrateur(session, client)
    reponse = await client.get(
        f"{PREFIX}/admin/creators", headers={"Authorization": f"Bearer {jeton}"}
    )
    assert reponse.status_code == 200, reponse.text

    corps = reponse.json()
    assert len(corps["items"]) == PLAFOND
    assert corps["total"] >= PLAFOND + 3
    assert corps["total"] > len(corps["items"])


@pytest.mark.anyio
async def test_la_mediane_ignore_les_scores_absents(
    session: AsyncSession, conn: AsyncConnection, client: AsyncClient
) -> None:
    """**La médiane se calcule sur les scores qui existent, jamais sur tous.**

    `null` signifie neutre et non zéro : compter les sans-historique comme des
    zéros écraserait la médiane à chaque inscription, et le chiffre baisserait
    précisément quand le produit grandit.

    Le décor fait diverger les deux implémentations — une notée, deux sans
    historique. Une médiane sur l'ensemble prendrait un zéro comme valeur
    centrale ; celle qui ignore les absents rend le score de la seule notée. Et
    `createurs_avec_score` est ce qui rend le nombre lisible : « 86 » sorti d'un
    score n'est pas « 86 » sorti de cent.
    """
    notee = await new_creator(conn)
    await new_social_account(conn, notee, handle="la_seule_notee")
    for rang in range(2):
        muette = await new_creator(conn)
        await new_social_account(conn, muette, handle=f"sans_score_{rang}")

    await reliability.enregistrer(
        session, creator_id=notee, type_=ReliabilityEventType.PUBLISHED_ON_TIME
    )
    await session.commit()

    jeton = await jeton_administrateur(session, client)
    reponse = await client.get(
        f"{PREFIX}/admin/creators", headers={"Authorization": f"Bearer {jeton}"}
    )
    corps = reponse.json()

    assert corps["createurs_avec_score"] == 1
    assert corps["total"] >= 3
    # La médiane est celle de la notée, et elle est au-dessus de la base : un
    # zéro dans le calcul l'aurait tirée vers le bas.
    assert corps["fiabilite_mediane"] is not None
    assert float(corps["fiabilite_mediane"]) > 70
