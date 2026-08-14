"""La carte du commerce, et la règle qu'elle commande.

**Le manque que ça répare.** Un restaurant peut proposer « un menu contre une
story ». Le créateur ne sait pas ce qu'il va manger — donc il ne vient pas.
L'offre est en ligne, elle a l'air normale, elle ne convertit pas, et le
commerce n'a aucun moyen de savoir pourquoi.

**Ce qui est éprouvé ici, dans l'ordre d'importance.**

1. La règle, dans les deux sens : une offre à choix se refuse sans carte, et
   s'ouvre dès qu'il y a des pages **ou** un lien. Une garde qui refuserait
   toujours passerait le premier test sans rien garantir et rendrait le
   catalogue inutilisable en beauté, où presque rien ne laisse de choix.
2. Les deux portes d'ouverture. Une offre naît **active** : ne garder que la
   route d'activation laisserait passer le chemin le plus court, celui que tout
   le monde emprunte.
3. Ce qui ne doit **pas** être bloqué : créer l'item, fermer une offre, ouvrir
   une offre sur une prestation qui ne laisse aucun choix.
"""

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.schemas.catalog import CatalogItemCreate
from app.schemas.tier_offers import TierOfferCreate
from app.services import business_menu as service
from app.services import business_public
from app.services import catalog as catalog_service
from app.services import tier_offers as offer_service
from app.services.audit import Actor
from tests.test_activation import commerce_en_cours

PREFIX = get_settings().api_v1_prefix

#: Le palier du jeu de tests, comme ailleurs dans la suite.
from tests.test_booking_create import STORY  # noqa: E402


async def carte_de(session: AsyncSession, business_id: uuid.UUID, combien: int):
    return [
        await service.ajouter(
            session, business_id=business_id, storage_key=f"photos/cartes/x/{rang}.jpg"
        )
        for rang in range(combien)
    ]


async def item(session: AsyncSession, business, *, leaves_choice: bool):
    return await catalog_service.create_item(
        session,
        business=business,
        payload=CatalogItemCreate(
            name="Menu du jour" if leaves_choice else "Brushing",
            price_cents=2500,
            duration_minutes=45,
            requires_booking=True,
            leaves_choice=leaves_choice,
        ),
    )


async def ouvrir(session: AsyncSession, business, item_id: uuid.UUID):
    return await offer_service.create_offer(
        session,
        business_id=business.id,
        payload=TierOfferCreate(tier_id=STORY, catalog_item_id=item_id),
    )


# --------------------------------------------------------------------------
# la règle
# --------------------------------------------------------------------------


async def test_une_offre_a_choix_se_refuse_sans_carte_ni_lien(session: AsyncSession) -> None:
    """**Le cœur du changement.** Sans carte, le créateur ne sait pas ce qu'il
    obtient : l'offre ne doit pas partir en ligne."""
    business, _ = await commerce_en_cours(session)
    menu = await item(session, business, leaves_choice=True)

    with pytest.raises(offer_service.CarteManquante):
        await ouvrir(session, business, menu.id)


async def test_des_pages_suffisent_a_ouvrir(session: AsyncSession) -> None:
    """Le sens inverse, et il compte autant : une garde qui refuserait toujours
    passerait le test précédent sans rien garantir."""
    business, _ = await commerce_en_cours(session)
    await carte_de(session, business.id, 2)
    menu = await item(session, business, leaves_choice=True)

    offre = await ouvrir(session, business, menu.id)

    assert offre.is_active is True


async def test_un_lien_seul_suffit_a_ouvrir(session: AsyncSession) -> None:
    """**L'un ou l'autre.** Forcer à photographier une carte déjà bien
    présentée en ligne serait absurde."""
    business, _ = await commerce_en_cours(session)
    business.menu_url = "https://le-restaurant.example/carte"
    await session.flush()
    menu = await item(session, business, leaves_choice=True)

    offre = await ouvrir(session, business, menu.id)

    assert offre.is_active is True


@pytest.mark.parametrize("lien", ["", "   ", "\n"])
async def test_un_lien_vide_ne_compte_pas(session: AsyncSession, lien: str) -> None:
    """Le genre de valeur qu'un formulaire laisse passer. Elle ouvrirait une
    offre vers une carte que personne ne peut lire — exactement ce que la règle
    existe pour empêcher."""
    business, _ = await commerce_en_cours(session)
    business.menu_url = lien
    await session.flush()
    menu = await item(session, business, leaves_choice=True)

    with pytest.raises(offer_service.CarteManquante):
        await ouvrir(session, business, menu.id)


async def test_une_prestation_precise_s_ouvre_sans_carte(session: AsyncSession) -> None:
    """La règle ne vaut que pour les offres à choix. Un salon de beauté n'a
    aucune carte à déposer, et son catalogue doit fonctionner."""
    business, _ = await commerce_en_cours(session)
    precise = await item(session, business, leaves_choice=False)

    offre = await ouvrir(session, business, precise.id)

    assert offre.is_active is True


# --------------------------------------------------------------------------
# les deux portes d'ouverture
# --------------------------------------------------------------------------


async def test_rouvrir_une_offre_a_choix_redemande_la_carte(session: AsyncSession) -> None:
    """**Le chemin détourné.** Ouvrir pendant que la carte est là, fermer,
    effacer la carte, rouvrir : sans garde sur l'activation, l'offre repartirait
    en ligne sans carte."""
    business, proprietaire = await commerce_en_cours(session)
    pages = await carte_de(session, business.id, 1)
    menu = await item(session, business, leaves_choice=True)
    offre = await ouvrir(session, business, menu.id)

    await offer_service.set_active(
        session, offer=offre, is_active=False, actor=Actor.from_user(proprietaire)
    )
    await service.retirer(session, business_id=business.id, page_id=pages[0].id)

    with pytest.raises(offer_service.CarteManquante):
        await offer_service.set_active(
            session, offer=offre, is_active=True, actor=Actor.from_user(proprietaire)
        )


async def test_fermer_une_offre_ne_demande_jamais_de_carte(session: AsyncSession) -> None:
    """On ne bloque pas quelqu'un qui range. Une garde posée sur les deux sens
    enfermerait une offre ouverte avant la règle."""
    business, proprietaire = await commerce_en_cours(session)
    pages = await carte_de(session, business.id, 1)
    menu = await item(session, business, leaves_choice=True)
    offre = await ouvrir(session, business, menu.id)
    await service.retirer(session, business_id=business.id, page_id=pages[0].id)

    change = await offer_service.set_active(
        session, offer=offre, is_active=False, actor=Actor.from_user(proprietaire)
    )

    assert change is True
    assert offre.is_active is False


async def test_retirer_la_derniere_page_ne_ferme_aucune_offre(session: AsyncSession) -> None:
    """La règle se vérifie à l'ouverture, pas en continu. Refermer derrière le
    commerce pendant qu'il réorganise sa carte lui ferait perdre sa composition
    sans un mot ; il retrouvera le refus au prochain geste d'ouverture."""
    business, _ = await commerce_en_cours(session)
    pages = await carte_de(session, business.id, 1)
    menu = await item(session, business, leaves_choice=True)
    offre = await ouvrir(session, business, menu.id)

    await service.retirer(session, business_id=business.id, page_id=pages[0].id)

    assert offre.is_active is True


async def test_creer_l_item_ne_demande_pas_de_carte(session: AsyncSession) -> None:
    """Un item se saisit au fil de l'eau, souvent avant que la carte soit
    photographiée. Refuser là obligerait à tout faire dans un ordre imposé."""
    business, _ = await commerce_en_cours(session)

    menu = await item(session, business, leaves_choice=True)

    assert menu.leaves_choice is True


# --------------------------------------------------------------------------
# la carte elle-même
# --------------------------------------------------------------------------


async def test_les_pages_se_rangent_dans_l_ordre_du_depot(session: AsyncSession) -> None:
    business, _ = await commerce_en_cours(session)
    posees = await carte_de(session, business.id, 3)

    assert [p.position for p in posees] == [0, 1, 2]
    assert [p.id for p in await service.lister(session, business.id)] == [p.id for p in posees]


async def test_reordonner_reecrit_tout_sans_collision(session: AsyncSession) -> None:
    """La contrainte d'unicité est différée : la transaction a le droit de se
    contredire en son milieu, et Postgres vérifie à la fin."""
    business, _ = await commerce_en_cours(session)
    pages = await carte_de(session, business.id, 3)

    rendu = await service.reordonner(
        session, business_id=business.id, ordre=[pages[2].id, pages[0].id, pages[1].id]
    )

    assert [p.id for p in rendu] == [pages[2].id, pages[0].id, pages[1].id]
    assert [p.position for p in rendu] == [0, 1, 2]


async def test_un_ordre_partiel_est_refuse(session: AsyncSession) -> None:
    """Deviner ce qu'un appelant a voulu dire, c'est inventer un ordre qu'il n'a
    pas demandé — et le commerce découvrirait des desserts avant les entrées."""
    business, _ = await commerce_en_cours(session)
    pages = await carte_de(session, business.id, 3)

    with pytest.raises(service.PageIntrouvable):
        await service.reordonner(session, business_id=business.id, ordre=[pages[0].id])


async def test_retirer_referme_le_trou(session: AsyncSession) -> None:
    """Des positions 0, 2, 3 s'afficheraient correctement, mais l'insertion
    suivante calculerait son rang sur un maximum devenu faux."""
    business, _ = await commerce_en_cours(session)
    pages = await carte_de(session, business.id, 3)

    await service.retirer(session, business_id=business.id, page_id=pages[0].id)

    assert [p.position for p in await service.lister(session, business.id)] == [0, 1]


async def test_la_carte_a_un_plafond(session: AsyncSession) -> None:
    """Au-delà, ce n'est plus une carte, c'est un livre."""
    business, _ = await commerce_en_cours(session)
    await carte_de(session, business.id, service.MAXIMUM_PAR_COMMERCE)

    with pytest.raises(service.CartePleine):
        await service.ajouter(
            session, business_id=business.id, storage_key="photos/cartes/x/trop.jpg"
        )


# --------------------------------------------------------------------------
# la fiche publique
# --------------------------------------------------------------------------


async def _mettre_en_ligne(session: AsyncSession, business) -> None:
    """La fiche publique n'existe que pour un commerce en ligne : c'est la règle
    du produit, et la contourner ferait tester une fiche que personne ne peut
    ouvrir."""
    import sqlalchemy as sa

    from app.models import Business
    from app.models.enums import BusinessStatus

    await session.execute(
        sa.update(Business).where(Business.id == business.id).values(status=BusinessStatus.ACTIVE)
    )
    await session.flush()


async def test_la_fiche_publique_separe_la_carte_de_la_galerie(session: AsyncSession) -> None:
    """**Deux gestes différents, deux accès différents.** La galerie montre le
    lieu, la carte se consulte. Les mêler ferait chercher une entrecôte entre
    deux photos de salle."""
    from app.services import business_photos

    business, proprietaire = await commerce_en_cours(session)
    await business_photos.ajouter(
        session, business_id=business.id, storage_key="photos/commerces/x/salle.jpg"
    )
    await carte_de(session, business.id, 2)

    await _mettre_en_ligne(session, business)
    fiche = await business_public.fiche(
        session, business_id=business.id, creator_id=proprietaire.id
    )

    assert fiche.photos == ("photos/commerces/x/salle.jpg",)
    assert len(fiche.menu_pages) == 2
    assert all(cle.startswith("photos/cartes/") for cle in fiche.menu_pages)


async def test_la_fiche_rend_le_lien_et_le_vide_qui_va_avec(session: AsyncSession) -> None:
    """L'écran doit pouvoir dire qu'on sortira de l'application : il le lit sur
    `menu_pages` vide **et** `menu_url` renseignée. Rendre l'un sans l'autre
    laisserait la question sans réponse."""
    business, proprietaire = await commerce_en_cours(session)
    business.menu_url = "https://le-restaurant.example/carte"
    await session.flush()

    await _mettre_en_ligne(session, business)
    fiche = await business_public.fiche(
        session, business_id=business.id, creator_id=proprietaire.id
    )

    assert fiche.menu_pages == ()
    assert fiche.menu_url == "https://le-restaurant.example/carte"
