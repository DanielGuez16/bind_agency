"""Une créatrice de l'annuaire, lue seule.

**Le geste manquait.** L'annuaire listait, et la seule chose qu'un salon
pouvait faire d'une rangée était d'en sortir — vers Instagram, hors du
produit. La fiche est la destination qui manquait ; le lien sortant y déménage.

L'invariant qui tient tout le reste : **toute rangée de la liste s'ouvre, et
dit la même chose.** C'est aussi le décor où deux implémentations divergent. La
liste et la fiche décident chacune qui est visible ; si elles décidaient
séparément, l'écart ne se lirait pas comme un désaccord entre deux fonctions —
il se lirait comme une rangée qui mène à une page vide, et rien à l'écran ne
l'expliquerait. Le test compare **tous** les champs de l'objet, pas seulement
l'identifiant : une garde qui n'en comparerait qu'un n'éprouverait que celui-là,
et le volume, le palier ou la distance pourraient diverger sans faire tomber
personne.
"""

import dataclasses
import uuid

import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import CreatorProfile
from app.models.enums import ContentFormat, UserRole
from app.services import directory
from tests.conftest import inscrire_verifie
from tests.test_activation import MOT_DE_PASSE as MOT_DE_PASSE_ACTIVATION
from tests.test_annuaire_de_ce_salon import (
    DEHORS,
    MOT_DE_PASSE,
    PLUS_LOIN,
    TOUT_PRES,
    creatrice,
)
from tests.test_booking_create import REEL, STORY, monter_le_decor

PREFIX = get_settings().api_v1_prefix


# --------------------------------------------------------------------------
# l'invariant : la liste et la fiche ne divergent pas
# --------------------------------------------------------------------------


async def test_toute_rangee_de_l_annuaire_s_ouvre_et_dit_la_meme_chose(
    session: AsyncSession,
) -> None:
    """**Le décor porte les trois formes que la liste sait montrer.**

    Une créatrice proche et éligible, une lointaine, une sans position. Les
    trois sont dans la liste, et les trois doivent s'ouvrir : c'est là que
    deux jeux de conditions écrits séparément se sépareraient — celui de la
    fiche oublierait les sans-position, ou serrerait le rayon, et seule la
    troisième rangée mènerait à une page vide.

    La comparaison porte sur l'objet entier. Se contenter de l'identifiant
    laisserait le volume, le palier et la distance diverger en silence.
    """
    decor = await monter_le_decor(session, tier_id=STORY)
    proche = await creatrice(session, ou=TOUT_PRES, followers=60_000)
    loin = await creatrice(session, ou=PLUS_LOIN, followers=31_000)
    sans_position = await creatrice(session, ou=None, followers=12_000)

    page = await directory.annuaire(session, business=decor["business"])
    listees = {vu.creator_id: vu for vu in page.createurs}

    assert {proche.id, loin.id, sans_position.id} <= set(listees)

    for creator_id, depuis_la_liste in listees.items():
        depuis_la_fiche = await directory.creatrice(
            session, business=decor["business"], creator_id=creator_id
        )
        assert depuis_la_fiche is not None, f"{creator_id} est listée et ne s'ouvre pas"
        assert dataclasses.asdict(depuis_la_fiche) == dataclasses.asdict(depuis_la_liste)


# --------------------------------------------------------------------------
# ce qui ne s'ouvre pas
# --------------------------------------------------------------------------


async def test_une_creatrice_hors_du_rayon_ne_s_ouvre_pas(session: AsyncSession) -> None:
    """Le rayon borne la fiche comme il borne la liste.

    **Le décor pose une créatrice complète et éligible**, à quarante kilomètres.
    Une créatrice sans réseau ou anonymisée passerait ce test quelle que soit
    l'implémentation du rayon : le décor serait alors celui que le code fautif
    produit lui-même, et il ne prouverait rien.
    """
    decor = await monter_le_decor(session, tier_id=STORY)
    dehors = await creatrice(session, ou=DEHORS, followers=60_000)

    assert (
        await directory.creatrice(session, business=decor["business"], creator_id=dehors.id)
    ) is None


async def test_une_creatrice_sans_reseau_ne_s_ouvre_pas(session: AsyncSession) -> None:
    """Un profil sans compte rattaché n'offre rien à un commerce.

    C'est la condition qui vit dans `_vu_de` et non dans les conditions SQL :
    elle doit valoir pour la fiche comme pour la liste, sans quoi une rangée
    absente de la liste s'ouvrirait quand même par son adresse.
    """
    decor = await monter_le_decor(session, tier_id=STORY)
    nue = await inscrire_verifie(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password=MOT_DE_PASSE,
        role=UserRole.CREATOR,
    )
    await session.execute(
        sa.update(CreatorProfile)
        .where(CreatorProfile.user_id == nue.id)
        .values(geo=sa.func.ST_SetSRID(sa.func.ST_MakePoint(*TOUT_PRES), 4326))
    )
    await session.flush()

    page = await directory.annuaire(session, business=decor["business"])
    assert nue.id not in {vu.creator_id for vu in page.createurs}
    assert (
        await directory.creatrice(session, business=decor["business"], creator_id=nue.id)
    ) is None


async def test_une_creatrice_anonymisee_ne_s_ouvre_pas(session: AsyncSession) -> None:
    """L'effacement vaut pour la fiche.

    Le décor la crée **complète et proche**, puis l'anonymise : elle est donc
    lisible avant, ce qui rend le refus imputable à l'anonymisation et à rien
    d'autre.
    """
    decor = await monter_le_decor(session, tier_id=STORY)
    elle = await creatrice(session, ou=TOUT_PRES, followers=60_000)

    assert (
        await directory.creatrice(session, business=decor["business"], creator_id=elle.id)
    ) is not None

    await session.execute(
        sa.update(CreatorProfile)
        .where(CreatorProfile.user_id == elle.id)
        .values(anonymized_at=sa.func.now())
    )
    await session.flush()

    assert (
        await directory.creatrice(session, business=decor["business"], creator_id=elle.id)
    ) is None


async def test_un_identifiant_inconnu_ne_s_ouvre_pas(session: AsyncSession) -> None:
    """Rien, et non une fiche vide : la route en fait un 404."""
    decor = await monter_le_decor(session, tier_id=STORY)

    assert (
        await directory.creatrice(session, business=decor["business"], creator_id=uuid.uuid4())
    ) is None


# --------------------------------------------------------------------------
# la portée est celle du salon qui demande
# --------------------------------------------------------------------------


async def test_l_identifiant_vu_d_un_autre_salon_n_ouvre_rien(session: AsyncSession) -> None:
    """**Un identifiant ne donne pas le droit de lire.**

    Le décor est le seul qui sépare les deux implémentations : deux salons
    éloignés, et une créatrice dans le rayon du premier seulement. Une fiche
    qui chercherait par le seul identifiant la rendrait au second — elle
    existe, elle est active, elle a un réseau — et le rayon ne serait plus
    qu'une règle d'affichage de la liste.

    Elle est bien lisible depuis son propre salon, sur la ligne d'avant : sans
    cette moitié, une fiche qui ne rendrait jamais rien passerait le test.
    """
    ici = await monter_le_decor(session, tier_id=STORY)
    ailleurs = await monter_le_decor(session, tier_id=STORY, coordinates=DEHORS)
    elle = await creatrice(session, ou=TOUT_PRES, followers=60_000)

    assert (
        await directory.creatrice(session, business=ici["business"], creator_id=elle.id)
    ) is not None
    assert (
        await directory.creatrice(session, business=ailleurs["business"], creator_id=elle.id)
    ) is None


async def test_le_palier_de_la_fiche_est_celui_de_ce_salon(session: AsyncSession) -> None:
    """La fiche répond « elle peut réserver ce que **vous** avez ouvert ».

    Le décor fait diverger les deux lectures possibles : la créatrice se
    qualifie pour le reel, un salon l'offre, l'autre non. Une fiche qui
    évaluerait tous les paliers du produit rendrait le reel des deux côtés.
    """
    ici = await monter_le_decor(session, tier_id=REEL, followers=60_000)
    ailleurs = await monter_le_decor(session, tier_id=STORY, coordinates=TOUT_PRES)
    # Soixante mille abonnés **et deux collaborations** : le reel ne s'ouvre pas
    # au volume seul. Sans les collaborations, la fiche rend une liste vide des
    # deux côtés et le test passerait au vert sans rien distinguer.
    elle = await creatrice(session, ou=TOUT_PRES, followers=60_000, collabs=2)

    depuis_ici = await directory.creatrice(session, business=ici["business"], creator_id=elle.id)
    depuis_ailleurs = await directory.creatrice(
        session, business=ailleurs["business"], creator_id=elle.id
    )

    assert depuis_ici is not None and depuis_ailleurs is not None
    assert ContentFormat.REEL in depuis_ici.paliers_ouverts
    assert ContentFormat.REEL not in depuis_ailleurs.paliers_ouverts


# --------------------------------------------------------------------------
# la route
# --------------------------------------------------------------------------


async def _salon_abonne(session: AsyncSession, *, abonne: bool = True):
    """Un salon, abonné ou non, et de quoi signer ses appels."""
    from app.integrations.billing import LogBillingProvider
    from app.services import subscription as subscription_service
    from tests.test_activation import commerce_en_cours
    from tests.test_grace import plan

    business, proprietaire = await commerce_en_cours(session)
    if abonne:
        await subscription_service.souscrire(
            session,
            business=business,
            plan_id=(await plan(session)).id,
            actor=proprietaire,
            provider=LogBillingProvider(),
        )
    return business, proprietaire


async def _entetes(client: AsyncClient, proprietaire) -> dict[str, str]:
    jetons = (
        await client.post(
            f"{PREFIX}/auth/login",
            json={"email": proprietaire.email, "password": MOT_DE_PASSE_ACTIVATION},
        )
    ).json()
    return {"Authorization": f"Bearer {jetons['access_token']}"}


async def test_la_route_ouvre_la_fiche_d_une_creatrice_joignable(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Le chemin nominal, et il porte ce que la rangée montrait.

    L'assertion regarde le pseudonyme **et** le volume : une fiche qui ne
    rendrait qu'une coquille — l'identifiant et rien d'autre — passerait un
    test qui se contenterait du code 200.
    """
    business, proprietaire = await _salon_abonne(session)
    elle = await creatrice(session, ou=TOUT_PRES, followers=48_213)
    await session.commit()

    reponse = await client.get(
        f"{PREFIX}/business/{business.id}/creators/{elle.id}",
        headers=await _entetes(client, proprietaire),
    )

    assert reponse.status_code == 200
    corps = reponse.json()
    assert corps["creator_id"] == str(elle.id)
    assert corps["comptes"][0]["handle"]
    assert corps["audience_totale"] == 48_213


async def test_sans_abonnement_la_fiche_refuse_comme_la_liste(
    client: AsyncClient, session: AsyncSession
) -> None:
    """**Le test qui justifie la dépendance de routeur.**

    La fiche ouvre exactement ce que la liste vend. Écrite en ligne dans la
    route de la liste, la vérification aurait manqué à celle-ci — un oubli
    d'une ligne, que rien n'aurait signalé — et un salon non abonné aurait lu
    une par une les créatrices que la liste lui refuse.

    Le décor porte un pseudonyme et un volume reconnaissables, et l'assertion
    regarde le **corps entier** : un refus qui laisserait quand même partir
    quelque chose se verrait ici, et pas dans un champ qu'on aurait pensé à
    vérifier.
    """
    business, proprietaire = await _salon_abonne(session, abonne=False)
    elle = await creatrice(session, ou=TOUT_PRES, followers=48_213)
    await session.commit()

    reponse = await client.get(
        f"{PREFIX}/business/{business.id}/creators/{elle.id}",
        headers=await _entetes(client, proprietaire),
    )

    assert reponse.status_code == 402
    assert reponse.json()["detail"] == "subscription_required"
    assert str(elle.id) not in reponse.text
    assert "48213" not in reponse.text


async def test_une_creatrice_hors_de_portee_repond_introuvable(
    client: AsyncClient, session: AsyncSession
) -> None:
    """404, et le corps ne dit pas qu'elle existe ailleurs.

    Distinguer « hors de votre rayon » d'un identifiant inventé ferait de cette
    route un moyen de sonder l'annuaire national, une requête à la fois.
    """
    business, proprietaire = await _salon_abonne(session)
    dehors = await creatrice(session, ou=DEHORS, followers=48_213)
    await session.commit()
    entetes = await _entetes(client, proprietaire)

    hors_rayon = await client.get(
        f"{PREFIX}/business/{business.id}/creators/{dehors.id}", headers=entetes
    )
    inventee = await client.get(
        f"{PREFIX}/business/{business.id}/creators/{uuid.uuid4()}", headers=entetes
    )

    assert hors_rayon.status_code == 404
    # **Les deux réponses sont indiscernables**, et c'est la garantie. Un corps
    # qui dirait « hors de votre rayon » d'un côté et « inconnue » de l'autre
    # rendrait l'existence lisible sans rendre la fiche.
    assert hors_rayon.json() == inventee.json()
    assert "48213" not in hors_rayon.text
