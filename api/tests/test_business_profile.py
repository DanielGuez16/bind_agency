"""Profil commerce.

L'isolation entre commerces est éprouvée sur chaque verbe, pas seulement sur la
lecture : une fuite en écriture est pire qu'une fuite en lecture.
"""

import uuid

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.exc import IntegrityError, InternalError
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.config import get_settings
from app.integrations.geocoding import Coordinates, ManualGeocoder
from app.models import AuditLog, Business, BusinessMember
from app.models.enums import ActorKind, BusinessMemberRole, BusinessStatus, UserRole
from app.services import business as business_service

PREFIX = get_settings().api_v1_prefix

MIAMI = {"longitude": -80.1918, "latitude": 25.7617}
ADRESSE = "100 Ocean Drive, Miami, FL"


def payload_commerce(**overrides) -> dict:
    return {
        "name": "Salon Ocean",
        "category": "beauty",
        "currency": "usd",
        "address": ADRESSE,
        "coordinates": MIAMI,
        "timezone": "America/New_York",
    } | overrides


async def compte(client: AsyncClient, role: UserRole = UserRole.BUSINESS_MEMBER) -> dict:
    email = f"{uuid.uuid4()}@example.com"
    password = "un-mot-de-passe-solide-42"
    created = await client.post(
        f"{PREFIX}/auth/register",
        json={"email": email, "password": password, "role": role.value},
    )
    assert created.status_code == 201, created.text
    tokens = (
        await client.post(f"{PREFIX}/auth/login", json={"email": email, "password": password})
    ).json()
    return {
        "user_id": created.json()["id"],
        "headers": {"Authorization": f"Bearer {tokens['access_token']}"},
    }


async def commerce(client: AsyncClient, membre: dict, **overrides) -> dict:
    response = await client.post(
        f"{PREFIX}/business", json=payload_commerce(**overrides), headers=membre["headers"]
    )
    assert response.status_code == 201, response.text
    return response.json()


# --------------------------------------------------------------------------
# création
# --------------------------------------------------------------------------


async def test_creation_rattache_le_createur_comme_owner(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    """Un commerce sans membre est un commerce auquel personne ne peut accéder."""
    membre = await compte(client)

    cree = await commerce(client, membre)

    appartenance = (
        await conn.execute(
            sa.select(BusinessMember.role).where(
                BusinessMember.business_id == uuid.UUID(cree["id"]),
                BusinessMember.user_id == uuid.UUID(membre["user_id"]),
            )
        )
    ).one()
    assert appartenance.role == BusinessMemberRole.OWNER


async def test_creation_normalise_la_devise_et_demarre_en_onboarding(
    client: AsyncClient,
) -> None:
    membre = await compte(client)

    cree = await commerce(client, membre)

    assert cree["currency"] == "USD"
    assert cree["status"] == BusinessStatus.ONBOARDING.value
    assert cree["coordinates"] == pytest.approx(MIAMI)


async def test_creation_journalise_sa_transition(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    membre = await compte(client)

    cree = await commerce(client, membre)

    # Filtré sur l'entité créée, pas sur le seul type : `audit_log` est
    # immuable, donc tout test qui valide sa transaction y laisse des lignes
    # pour de bon. Une assertion globale se casserait au premier d'entre eux.
    ligne = (
        await conn.execute(
            sa.select(AuditLog.__table__).where(AuditLog.entity_id == uuid.UUID(cree["id"]))
        )
    ).one()
    assert ligne.entity_id == uuid.UUID(cree["id"])
    assert ligne.from_status is None
    assert ligne.to_status == BusinessStatus.ONBOARDING.value
    assert ligne.actor_kind == ActorKind.BUSINESS_MEMBER


async def test_un_createur_ne_peut_pas_creer_de_commerce(client: AsyncClient) -> None:
    createur = await compte(client, role=UserRole.CREATOR)

    response = await client.post(
        f"{PREFIX}/business", json=payload_commerce(), headers=createur["headers"]
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "insufficient_role"


async def test_creation_sans_coordonnees_est_acceptee(client: AsyncClient) -> None:
    """Un géocodage impossible ne doit pas bloquer une inscription."""
    membre = await compte(client)

    cree = await commerce(client, membre, coordinates=None, address=None)

    assert cree["coordinates"] is None
    assert cree["status"] == BusinessStatus.ONBOARDING.value


@pytest.mark.parametrize(
    "champ",
    [
        {"timezone": "Mars/Olympus_Mons"},
        {"timezone": "america/new_york"},
        {"currency": "US"},
        {"currency": "US1"},
        {"coordinates": {"longitude": -200.0, "latitude": 25.0}},
        {"coordinates": {"longitude": -80.0, "latitude": 91.0}},
        {"category": "casino"},
        {"name": ""},
    ],
)
async def test_creation_refuse_une_valeur_invalide(client: AsyncClient, champ: dict) -> None:
    membre = await compte(client)

    response = await client.post(
        f"{PREFIX}/business", json=payload_commerce(**champ), headers=membre["headers"]
    )

    assert response.status_code == 422, f"{champ} aurait dû être refusé"
    assert response.json()["detail"] == "validation_failed"


# --------------------------------------------------------------------------
# isolation entre commerces
# --------------------------------------------------------------------------


async def test_un_membre_du_commerce_a_ne_lit_pas_le_commerce_b(client: AsyncClient) -> None:
    membre_a = await compte(client)
    membre_b = await compte(client)
    await commerce(client, membre_a)
    commerce_b = await commerce(client, membre_b, name="Salon B")

    response = await client.get(
        f"{PREFIX}/business/{commerce_b['id']}", headers=membre_a["headers"]
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "not_a_member"


async def test_un_membre_du_commerce_a_ne_modifie_pas_le_commerce_b(client: AsyncClient) -> None:
    """Une fuite en écriture est pire qu'une fuite en lecture."""
    membre_a = await compte(client)
    membre_b = await compte(client)
    await commerce(client, membre_a)
    commerce_b = await commerce(client, membre_b, name="Salon B")

    response = await client.patch(
        f"{PREFIX}/business/{commerce_b['id']}",
        json={"name": "Renommé par A"},
        headers=membre_a["headers"],
    )

    assert response.status_code == 403


async def test_un_membre_du_commerce_a_n_active_pas_le_commerce_b(client: AsyncClient) -> None:
    membre_a = await compte(client)
    membre_b = await compte(client)
    await commerce(client, membre_a)
    commerce_b = await commerce(client, membre_b, name="Salon B")

    response = await client.post(
        f"{PREFIX}/business/{commerce_b['id']}/activate", headers=membre_a["headers"]
    )

    assert response.status_code == 403


async def test_un_commerce_inexistant_repond_403(client: AsyncClient) -> None:
    membre = await compte(client)
    await commerce(client, membre)

    response = await client.get(f"{PREFIX}/business/{uuid.uuid4()}", headers=membre["headers"])
    assert response.status_code == 403


# --------------------------------------------------------------------------
# mise à jour
# --------------------------------------------------------------------------


async def test_mise_a_jour_partielle_ne_touche_pas_le_reste(client: AsyncClient) -> None:
    membre = await compte(client)
    cree = await commerce(client, membre)

    response = await client.patch(
        f"{PREFIX}/business/{cree['id']}",
        json={"phone": "+13055550101"},
        headers=membre["headers"],
    )

    assert response.status_code == 200
    modifie = response.json()
    assert modifie["phone"] == "+13055550101"
    assert modifie["name"] == cree["name"]
    assert modifie["coordinates"] == pytest.approx(MIAMI)


async def test_la_devise_ne_peut_pas_etre_modifiee_par_l_api(client: AsyncClient) -> None:
    membre = await compte(client)
    cree = await commerce(client, membre)

    response = await client.patch(
        f"{PREFIX}/business/{cree['id']}", json={"currency": "EUR"}, headers=membre["headers"]
    )

    assert response.status_code == 422, "le champ doit être refusé, pas ignoré en silence"
    assert response.json()["detail"] == "validation_failed"


async def test_la_devise_ne_peut_pas_etre_modifiee_en_base(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    """Un schéma protège une route, pas une table."""
    membre = await compte(client)
    cree = await commerce(client, membre)

    with pytest.raises((IntegrityError, InternalError)) as excinfo:
        async with conn.begin_nested():
            await conn.execute(
                sa.update(Business)
                .where(Business.id == uuid.UUID(cree["id"]))
                .values(currency="EUR")
            )

    assert "la devise d'un commerce ne change pas" in str(excinfo.value)


async def test_un_fuseau_invalide_est_refuse_en_mise_a_jour(client: AsyncClient) -> None:
    membre = await compte(client)
    cree = await commerce(client, membre)

    response = await client.patch(
        f"{PREFIX}/business/{cree['id']}",
        json={"timezone": "Europe/Atlantide"},
        headers=membre["headers"],
    )
    assert response.status_code == 422


async def test_le_fuseau_valide_est_accepte(client: AsyncClient) -> None:
    membre = await compte(client)
    cree = await commerce(client, membre)

    response = await client.patch(
        f"{PREFIX}/business/{cree['id']}",
        json={"timezone": "America/Los_Angeles"},
        headers=membre["headers"],
    )
    assert response.status_code == 200
    assert response.json()["timezone"] == "America/Los_Angeles"


async def test_les_coordonnees_peuvent_etre_ajoutees_apres_coup(client: AsyncClient) -> None:
    membre = await compte(client)
    cree = await commerce(client, membre, coordinates=None, address=None)
    assert cree["coordinates"] is None

    response = await client.patch(
        f"{PREFIX}/business/{cree['id']}",
        json={"address": ADRESSE, "coordinates": MIAMI},
        headers=membre["headers"],
    )

    assert response.status_code == 200
    assert response.json()["coordinates"] == pytest.approx(MIAMI)


# --------------------------------------------------------------------------
# activation
# --------------------------------------------------------------------------


async def test_l_activation_refuse_un_commerce_sans_coordonnees(client: AsyncClient) -> None:
    membre = await compte(client)
    cree = await commerce(client, membre, coordinates=None)

    response = await client.post(
        f"{PREFIX}/business/{cree['id']}/activate", headers=membre["headers"]
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "business_missing_coordinates"


async def test_l_activation_refuse_un_commerce_sans_adresse(client: AsyncClient) -> None:
    membre = await compte(client)
    cree = await commerce(client, membre, address=None)

    response = await client.post(
        f"{PREFIX}/business/{cree['id']}/activate", headers=membre["headers"]
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "business_missing_address"


async def test_l_activation_reussie_journalise_sa_transition(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    membre = await compte(client)
    cree = await commerce(client, membre)

    response = await client.post(
        f"{PREFIX}/business/{cree['id']}/activate", headers=membre["headers"]
    )

    assert response.status_code == 200
    assert response.json()["status"] == BusinessStatus.ACTIVE.value

    ligne = (
        await conn.execute(
            sa.select(AuditLog.__table__).where(
                AuditLog.entity_id == uuid.UUID(cree["id"]),
                AuditLog.to_status == BusinessStatus.ACTIVE.value,
            )
        )
    ).one()
    assert ligne.entity_id == uuid.UUID(cree["id"])
    assert ligne.from_status == BusinessStatus.ONBOARDING.value
    assert ligne.actor_user_id == uuid.UUID(membre["user_id"])
    assert ligne.reason == business_service.REASON_ACTIVATION


async def test_activer_deux_fois_est_refuse(client: AsyncClient) -> None:
    membre = await compte(client)
    cree = await commerce(client, membre)
    await client.post(f"{PREFIX}/business/{cree['id']}/activate", headers=membre["headers"])

    response = await client.post(
        f"{PREFIX}/business/{cree['id']}/activate", headers=membre["headers"]
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "business_already_active"

    relu = await client.get(f"{PREFIX}/business/{cree['id']}", headers=membre["headers"])
    assert relu.status_code == 200
    assert relu.json()["status"] == BusinessStatus.ACTIVE.value


async def test_un_commerce_actif_ne_peut_pas_perdre_ses_coordonnees(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    """La contrainte de complétude conditionnelle tient aussi après activation."""
    membre = await compte(client)
    cree = await commerce(client, membre)
    await client.post(f"{PREFIX}/business/{cree['id']}/activate", headers=membre["headers"])

    with pytest.raises(IntegrityError) as excinfo:
        async with conn.begin_nested():
            await conn.execute(
                sa.update(Business).where(Business.id == uuid.UUID(cree["id"])).values(geo=None)
            )

    assert excinfo.value.orig.diag.constraint_name == "ck_business_active_requires_geo"


# --------------------------------------------------------------------------
# géocodage
# --------------------------------------------------------------------------


async def test_le_geocodeur_manuel_rend_les_coordonnees_telles_quelles() -> None:
    geocodeur = ManualGeocoder()
    fournies = Coordinates(longitude=-80.1918, latitude=25.7617)

    assert await geocodeur.locate(ADRESSE, declared=fournies) == fournies


async def test_le_geocodeur_manuel_ne_resout_rien_sans_coordonnees() -> None:
    """Il ne devine pas : c'est la phase 5 qui apportera une vraie résolution."""
    assert await ManualGeocoder().locate(ADRESSE) is None


@pytest.mark.parametrize(
    ("longitude", "latitude"),
    [(-181.0, 25.0), (181.0, 25.0), (-80.0, -91.0), (-80.0, 91.0)],
)
def test_des_coordonnees_hors_bornes_sont_refusees(longitude: float, latitude: float) -> None:
    with pytest.raises(ValueError, match="hors bornes"):
        Coordinates(longitude=longitude, latitude=latitude)


def test_l_ordre_wkt_est_longitude_puis_latitude() -> None:
    """PostGIS attend l'inverse de l'usage courant : une inversion place Miami en Somalie."""
    assert Coordinates(longitude=-80.1918, latitude=25.7617).as_wkt() == "POINT(-80.1918 25.7617)"


# --------------------------------------------------------------------------
# le quartier
# --------------------------------------------------------------------------


async def test_le_quartier_declare_a_la_creation_revient_dans_la_reponse(
    client: AsyncClient,
) -> None:
    """**Le défaut que ce test existe pour attraper.** Le champ traversait le
    schéma d'entrée, le service et la base sans problème, et le routeur, qui
    construit `BusinessRead` champ par champ, l'oubliait. Un champ accepté puis
    perdu rend un 200 à quelqu'un qui croit avoir enregistré — c'est nommé dans
    `CLAUDE.md`, et c'est arrivé ici.
    """
    membre = await compte(client)

    cree = await commerce(client, membre, neighborhood="wynwood")

    assert cree["neighborhood"] == "wynwood"
    relu = await client.get(f"{PREFIX}/business/{cree['id']}", headers=membre["headers"])
    assert relu.json()["neighborhood"] == "wynwood"


async def test_le_quartier_se_change_et_se_retire(client: AsyncClient) -> None:
    """Un salon déménage, ou s'est trompé. `null` le retire : il reste
    réservable, il n'est simplement plus situé."""
    membre = await compte(client)
    cree = await commerce(client, membre, neighborhood="brickell")

    change = await client.patch(
        f"{PREFIX}/business/{cree['id']}",
        json={"neighborhood": "midtown"},
        headers=membre["headers"],
    )
    assert change.status_code == 200, change.text
    assert change.json()["neighborhood"] == "midtown"

    retire = await client.patch(
        f"{PREFIX}/business/{cree['id']}",
        json={"neighborhood": None},
        headers=membre["headers"],
    )
    assert retire.json()["neighborhood"] is None


async def test_un_quartier_hors_liste_est_refuse(client: AsyncClient) -> None:
    """**L'autre sens, et c'est la raison d'être de la liste fermée.** Deux
    salons qui écriraient « South Beach » et « SoBe » ne se compteraient pas
    ensemble, et le fil annoncerait deux quartiers là où il y en a un."""
    membre = await compte(client)

    refuse = await client.post(
        f"{PREFIX}/business",
        json=payload_commerce(neighborhood="sobe"),
        headers=membre["headers"],
    )

    assert refuse.status_code == 422, refuse.text
    # La session reste utilisable après le refus.
    assert (await commerce(client, membre))["neighborhood"] is None
