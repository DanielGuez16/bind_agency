"""La galerie photos d'un commerce.

`business` ne portait qu'une clé de couverture, et les maquettes de Discovery
v0.5 déroulent plusieurs photos par fiche. Le critère de fin est celui de
`TASKS.md` : un commerce téléverse plusieurs photos, les ordonne, en supprime,
et la fiche publique les affiche **dans cet ordre**.

Ce qui est éprouvé ici est ce qu'un ordre peut faire de travers : se réécrire
en collision avec lui-même, laisser un trou après un retrait, et accepter un
ordre partiel qui déciderait à la place du commerce.
"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.services import business_photos as service
from app.services import business_public
from tests.test_activation import MOT_DE_PASSE, commerce_en_cours

PREFIX = get_settings().api_v1_prefix


async def galerie_de(session: AsyncSession, business_id: uuid.UUID, combien: int):
    return [
        await service.ajouter(
            session, business_id=business_id, storage_key=f"photos/commerces/x/{rang}.jpg"
        )
        for rang in range(combien)
    ]


async def test_les_photos_se_rangent_dans_l_ordre_du_depot(session: AsyncSession) -> None:
    """À la fin, jamais au début : le commerce a choisi son ordre, et une
    nouvelle photo n'a aucune raison de passer devant ce qu'il a mis en tête."""
    business, _ = await commerce_en_cours(session)
    posees = await galerie_de(session, business.id, 3)

    assert [p.position for p in posees] == [0, 1, 2]
    lues = await service.lister(session, business.id)
    assert [p.id for p in lues] == [p.id for p in posees]


async def test_reordonner_reecrit_tout_sans_collision(session: AsyncSession) -> None:
    """**Le cas que la contrainte différée existe pour.**

    Réordonner, c'est réécrire toutes les positions. À contrainte immédiate, la
    deuxième écriture entrerait en collision avec la troisième avant que
    celle-ci ait bougé, et il faudrait passer par des valeurs intermédiaires.
    """
    business, _ = await commerce_en_cours(session)
    a, b, c = await galerie_de(session, business.id, 3)

    # L'inversion complète : chaque photo prend la place d'une autre.
    ordonnees = await service.reordonner(session, business_id=business.id, ordre=[c.id, b.id, a.id])

    assert [p.id for p in ordonnees] == [c.id, b.id, a.id]
    assert [p.position for p in ordonnees] == [0, 1, 2]


async def test_un_ordre_partiel_est_refuse(session: AsyncSession) -> None:
    """Deviner ce qu'un appelant a voulu dire, c'est inventer un ordre qu'il
    n'a pas demandé — et le commerce le découvrirait sur sa fiche."""
    business, _ = await commerce_en_cours(session)
    a, b, _c = await galerie_de(session, business.id, 3)

    with pytest.raises(service.PhotoIntrouvable):
        await service.reordonner(session, business_id=business.id, ordre=[b.id, a.id])

    # La session reste utilisable : le refus n'a pas laissé de transaction
    # cassée derrière lui.
    assert len(await service.lister(session, business.id)) == 3


async def test_un_ordre_citant_une_photo_etrangere_est_refuse(session: AsyncSession) -> None:
    """Ce serait une fuite silencieuse : le commerce déplacerait la photo d'un
    autre dans sa propre galerie."""
    business, _ = await commerce_en_cours(session)
    autre, _ = await commerce_en_cours(session)
    a, b, c = await galerie_de(session, business.id, 3)
    etrangere = (await galerie_de(session, autre.id, 1))[0]

    with pytest.raises(service.PhotoIntrouvable):
        await service.reordonner(session, business_id=business.id, ordre=[a.id, b.id, etrangere.id])
    assert len(await service.lister(session, business.id)) == 3
    _ = c


async def test_retirer_referme_le_trou(session: AsyncSession) -> None:
    """Des positions 0, 2, 3 s'afficheraient bien — le tri les remet en ordre —
    mais l'insertion suivante calculerait son rang sur un maximum devenu faux,
    et l'ordre finirait par diverger de ce que le commerce a choisi."""
    business, _ = await commerce_en_cours(session)
    a, b, c = await galerie_de(session, business.id, 3)

    await service.retirer(session, business_id=business.id, photo_id=b.id)

    restantes = await service.lister(session, business.id)
    assert [p.id for p in restantes] == [a.id, c.id]
    assert [p.position for p in restantes] == [0, 1]


async def test_la_galerie_a_un_plafond(session: AsyncSession) -> None:
    """Au-delà, la fiche devient un catalogue et le commerce un photographe."""
    business, _ = await commerce_en_cours(session)
    await galerie_de(session, business.id, service.MAXIMUM_PAR_COMMERCE)

    with pytest.raises(service.GaleriePleine):
        await service.ajouter(
            session, business_id=business.id, storage_key="photos/commerces/x/trop.jpg"
        )


async def test_la_fiche_publique_les_affiche_dans_cet_ordre(session: AsyncSession) -> None:
    """Le critère de fin de la tâche, vérifié de bout en bout."""
    import sqlalchemy as sa

    from app.models import Business
    from app.models.enums import BusinessStatus

    business, proprietaire = await commerce_en_cours(session)
    a, b, c = await galerie_de(session, business.id, 3)
    await service.reordonner(session, business_id=business.id, ordre=[c.id, a.id, b.id])

    # La fiche publique n'existe que pour un commerce en ligne : c'est la règle
    # du produit, et la contourner ferait tester une fiche que personne ne peut
    # ouvrir.
    await session.execute(
        sa.update(Business).where(Business.id == business.id).values(status=BusinessStatus.ACTIVE)
    )
    await session.flush()

    vue = await business_public.fiche(session, business_id=business.id, creator_id=proprietaire.id)

    assert vue.photos == (c.storage_key, a.storage_key, b.storage_key)


async def test_la_galerie_est_reservee_a_son_commerce(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Une galerie se compose depuis la configuration de son propre commerce."""
    business, _ = await commerce_en_cours(session)
    _, etranger = await commerce_en_cours(session)
    await session.commit()

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login", json={"email": etranger.email, "password": MOT_DE_PASSE}
        )
    ).json()
    entetes = {"Authorization": f"Bearer {jetons['access_token']}"}

    reponse = await client.get(f"{PREFIX}/business/{business.id}/photos", headers=entetes)
    assert reponse.status_code in (403, 404)
