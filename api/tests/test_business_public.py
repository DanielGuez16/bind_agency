"""Fiche publique d'un commerce.

C'est la seule vue d'un commerce lisible sans appartenance, et le seul manque
qui cassait le parcours principal : le fil menait à une carte qu'on ne pouvait
pas ouvrir.

Deux propriétés opposées à celles du fil, et c'est le cœur des tests ici. Le fil
masque ce qui n'est pas réservable ; la fiche montre tout et dit ce qui est
fermé. Ce qui reste identique, c'est ce qui ne sort pas : ni réservations, ni
membres, ni reporting.
"""

import uuid

import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Business, CatalogItem
from app.models.enums import BusinessStatus, UserRole
from app.services import business_public as service
from app.services.eligibility import RaisonRefus
from tests.test_feed import REEL, STORY, commerce, createur, offre

PREFIX = get_settings().api_v1_prefix


async def fiche(session, business, user):
    return await service.fiche(session, business_id=business.id, creator_id=user.id)


async def test_la_fiche_rend_le_profil_les_offres_et_les_creneaux(session: AsyncSession) -> None:
    b = await commerce(session, longitude=-80.1305, latitude=25.7907, name="Salon Ocean")
    await offre(session, b, name="Soin visage")
    user, compte = await createur(session)

    vue = await fiche(session, b, user)

    assert vue.name == "Salon Ocean"
    assert vue.timezone == "America/New_York"
    assert [o.name for o in vue.offres] == ["Soin visage"]
    offre_lue = vue.offres[0]
    assert offre_lue.accessible is True
    assert offre_lue.social_account_id == compte.id
    assert offre_lue.prochains_creneaux, "un salon ouvert 8 h-20 h a des créneaux"
    assert len(offre_lue.prochains_creneaux) <= service.PROCHAINS_CRENEAUX


async def test_un_palier_ferme_reste_visible_avec_ses_obstacles(session: AsyncSession) -> None:
    """L'inverse exact du fil, et c'est voulu.

    Le fil masque pour ne pas encombrer ; la fiche montre parce qu'elle est
    déjà ouverte. Masquer la moitié d'une carte ferait croire que le salon
    propose une prestation quand il en propose deux.
    """
    b = await commerce(session, longitude=-80.1305, latitude=25.7907)
    await offre(session, b, tier_id=STORY, name="Accessible")
    await offre(session, b, tier_id=REEL, name="Hors d'atteinte")
    # 1 200 abonnés : au-dessus du seuil story (1 000), sous celui du reel.
    user, _ = await createur(session, followers=1_200)

    vue = await fiche(session, b, user)

    par_nom = {o.name: o for o in vue.offres}
    assert set(par_nom) == {"Accessible", "Hors d'atteinte"}
    assert par_nom["Accessible"].accessible is True
    ferme = par_nom["Hors d'atteinte"]
    assert ferme.accessible is False
    assert ferme.social_account_id is None
    assert RaisonRefus.NOT_ENOUGH_FOLLOWERS in {o.raison for o in ferme.obstacles}
    # Pas de créneaux calculés sur une offre qu'on ne peut pas réserver : ce
    # serait payer le parcours de disponibilité pour rien.
    assert ferme.prochains_creneaux == ()


async def test_l_obstacle_est_dedoublonne_par_raison(session: AsyncSession) -> None:
    """Le même manque lu deux fois ne se dit qu'une.

    Sans dédoublonnage, un créateur évalué sur deux comptes verrait deux fois
    « il te manque des abonnés » sur la même offre.
    """
    b = await commerce(session, longitude=-80.1305, latitude=25.7907)
    await offre(session, b, tier_id=REEL)
    user, _ = await createur(session, followers=1_200)
    # Un second compte, également insuffisant.
    await createur(session, followers=900)

    vue = await fiche(session, b, user)

    raisons = [o.raison for o in vue.offres[0].obstacles]
    assert len(raisons) == len(set(raisons))


async def test_un_item_desactive_disparait_de_la_fiche(session: AsyncSession) -> None:
    """Même règle que le fil : ce qui n'est pas offert ne s'affiche pas.

    Un palier fermé est une invitation, un item retiré du catalogue est une
    absence. Les confondre montrerait des prestations que le salon ne fait plus.
    """
    b = await commerce(session, longitude=-80.1305, latitude=25.7907)
    item, _ = await offre(session, b, name="Retiré")
    await offre(session, b, name="Toujours là")
    user, _ = await createur(session)

    assert len((await fiche(session, b, user)).offres) == 2

    await session.execute(
        sa.update(CatalogItem).where(CatalogItem.id == item.id).values(is_available=False)
    )
    await session.flush()

    assert [o.name for o in (await fiche(session, b, user)).offres] == ["Toujours là"]


async def test_un_commerce_inactif_n_est_pas_publie(session: AsyncSession) -> None:
    b = await commerce(session, longitude=-80.1305, latitude=25.7907)
    await offre(session, b)
    user, _ = await createur(session)

    assert (await fiche(session, b, user)).offres, "le commerce actif se lit"

    await session.execute(
        sa.update(Business).where(Business.id == b.id).values(status=BusinessStatus.ONBOARDING)
    )
    await session.flush()

    try:
        await fiche(session, b, user)
    except service.BusinessNotPublic:
        pass
    else:
        raise AssertionError("un commerce en cours d'inscription ne doit pas être lisible")


async def test_l_absent_et_l_inactif_se_repondent_pareil(session: AsyncSession) -> None:
    """Distinguer les deux dirait quels identifiants existent."""
    user, _ = await createur(session)
    try:
        await service.fiche(session, business_id=uuid.uuid4(), creator_id=user.id)
    except service.BusinessNotPublic:
        pass
    else:
        raise AssertionError("un commerce absent doit lever la même erreur")


async def test_la_fiche_ne_rend_ni_reservation_ni_membre_ni_montant_de_commerce(
    session: AsyncSession,
) -> None:
    """Ce qui n'y est pas est la moitié du contrat.

    Le test lit les champs réellement rendus plutôt qu'une liste écrite à la
    main : un champ ajouté demain sans y penser le fait tomber.
    """
    b = await commerce(session, longitude=-80.1305, latitude=25.7907)
    await offre(session, b)
    user, _ = await createur(session)

    vue = await fiche(session, b, user)
    champs = set(vue.__slots__) | set(vue.offres[0].__slots__)

    interdits = {"bookings", "members", "subscription", "revenue", "value_cents_snapshot"}
    assert not (champs & interdits)


async def test_la_route_est_reservee_aux_createurs(client: AsyncClient) -> None:
    async def connecte(role: UserRole) -> dict:
        email, password = f"{uuid.uuid4()}@example.com", "un-mot-de-passe-solide-42"
        await client.post(
            f"{PREFIX}/auth/register",
            json={"email": email, "password": password, "role": role.value},
        )
        jetons = (
            await client.post(f"{PREFIX}/auth/login", json={"email": email, "password": password})
        ).json()
        return {"headers": {"Authorization": f"Bearer {jetons['access_token']}"}}

    inconnu = uuid.uuid4()
    commercant = await connecte(UserRole.BUSINESS_MEMBER)
    assert (await client.get(f"{PREFIX}/businesses/{inconnu}", **commercant)).status_code == 403

    createur_connecte = await connecte(UserRole.CREATOR)
    reponse = await client.get(f"{PREFIX}/businesses/{inconnu}", **createur_connecte)
    # Le rôle passe, la ressource n'existe pas : c'est bien un 404 du catalogue
    # et non un code brut.
    assert reponse.status_code == 404
    assert reponse.json()["detail"] == "business_not_found"
