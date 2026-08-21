"""Ce qu'un écran prétend cacher doit être absent de la réponse.

**Un masque visuel n'est pas un contrôle d'accès.** React Native n'a pas de
`filter` CSS : un flou s'y pose par-dessus une image bel et bien téléchargée, et
la photo est sur l'appareil du commerce qui n'a pas payé, à un inspecteur près.
Rappeler la route sans l'application donne la même chose, en plus simple.

Trois choses sont éprouvées, et la première est la seule qui protège vraiment :

— **l'aperçu détruit l'information**, il ne la couvre pas. Réduit à trente-deux
  pixels *avant* d'être flouté : ce qui a été jeté n'est plus dans le fichier
  servi. Un flou appliqué à une image pleine taille laisserait tous les pixels
  d'origine, atténués, et se retire ;
— **la route des médias ne retombe jamais de l'aperçu vers l'original.** C'est
  le repli qui a sauvé les vignettes d'avant, et c'est exactement celui qu'il ne
  faut pas ici : il servirait la photo nette à qui n'a pas le droit de la voir ;
— **la réponse est éprouvée dans les deux sens.** Une route qui masquerait
  toujours passerait le test d'absence sans rien garantir de ce que
  l'abonnement achète.
"""

import io

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.integrations import images
from app.integrations.object_store import MemoryObjectStore
from app.services import directory, storage
from tests.test_activation import MOT_DE_PASSE, commerce_en_cours
from tests.test_creator_tiers import compte, createur

PREFIX = get_settings().api_v1_prefix


def _photographie(cote: int = 900) -> bytes:
    """Du bruit, pas un aplat : un aplat se compresse à quelques octets et la
    comparaison de poids ne dirait plus rien."""
    from PIL import Image

    pytest.importorskip("PIL")
    image = Image.new("RGB", (cote, cote))
    pixels = image.load()
    for x in range(0, cote, 3):
        for y in range(0, cote, 3):
            pixels[x, y] = ((x * 7) % 256, (y * 13) % 256, ((x + y) * 3) % 256)
    sortie = io.BytesIO()
    image.save(sortie, format="JPEG", quality=95)
    return sortie.getvalue()


# --------------------------------------------------------------------------
# l'aperçu détruit, il ne couvre pas
# --------------------------------------------------------------------------


def test_l_apercu_ne_contient_plus_le_visage() -> None:
    """Trente-deux pixels de côté, et quelques centaines d'octets.

    L'assertion porte sur les **dimensions** autant que sur le poids : un flou
    posé sur une image pleine taille peut peser peu et contenir encore tout ce
    qu'il faut pour reconnaître quelqu'un. Ce qui protège est ce qui a été jeté.
    """
    from PIL import Image

    original = _photographie()
    apercu = images.apercu_floute(original)

    assert apercu is not None
    assert max(Image.open(io.BytesIO(apercu)).size) <= images.COTE_APERCU
    # Deux ordres de grandeur : un aperçu qui pèserait le quart de l'original
    # serait une image, pas une tache.
    assert len(apercu) * 100 < len(original)


def test_l_apercu_n_est_pas_la_vignette() -> None:
    """Deux dérivées différentes, et c'est le point.

    Si l'aperçu était la vignette, il suffirait de demander la vignette — que
    l'annuaire sert déjà aux abonnés — pour voir le visage.
    """
    original = _photographie()

    assert images.apercu_floute(original) != images.vignette(original)
    assert len(images.apercu_floute(original)) < len(images.vignette(original))


def test_la_cle_d_apercu_n_est_pas_celle_d_une_vignette() -> None:
    """Le repli de la route des médias n'attrape que le suffixe de vignette.

    Deux suffixes distincts, sans quoi un aperçu manquant se transformerait en
    photo nette — la panne la plus discrète qui soit.
    """
    cle = "avatars/abc"

    assert storage.cle_d_apercu(cle) != storage.cle_de_vignette(cle)
    assert not storage.cle_d_apercu(cle).endswith(storage.SUFFIXE_VIGNETTE)


async def test_la_route_des_medias_ne_retombe_pas_de_l_apercu_vers_l_original(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """**Le test qui compte.**

    Le décor range un original **sans** son aperçu — exactement l'état d'une
    photo d'avant ce changement. Une route qui replierait comme elle le fait
    pour les vignettes servirait la photo nette ; celle qui refuse rend 404.
    """
    from app.routers import media as routeur_media

    depot = MemoryObjectStore()
    original = _photographie()
    cle = await depot.deposer(original, prefixe="avatars")
    monkeypatch.setattr(routeur_media, "get_object_store", lambda: depot)

    # L'original **est** dans le dépôt : c'est tout l'intérêt du décor. Un dépôt
    # vide rendrait 404 sans rien prouver du repli.
    assert await depot.lire(cle) is not None

    reponse = await client.get(f"{PREFIX}/media/{storage.cle_d_apercu(cle)}")

    assert reponse.status_code == 404
    assert original not in reponse.content


# --------------------------------------------------------------------------
# ce que la réponse livre, et ce qu'elle retient
# --------------------------------------------------------------------------


async def _annuaire(client: AsyncClient, session: AsyncSession, *, abonne: bool):
    business, proprietaire = await commerce_en_cours(session)
    elle = await createur(session)
    await compte(session, elle, followers=48_213, handle="rebecca.miami")

    if abonne:
        from app.integrations.billing import LogBillingProvider
        from app.services import subscription as subscription_service
        from tests.test_grace import plan

        await subscription_service.souscrire(
            session,
            business=business,
            plan_id=(await plan(session)).id,
            actor=proprietaire,
            provider=LogBillingProvider(),
        )
    await session.commit()

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login",
            json={"email": proprietaire.email, "password": MOT_DE_PASSE},
        )
    ).json()
    return await client.get(
        f"{PREFIX}/business/{business.id}/creators",
        headers={"Authorization": f"Bearer {jetons['access_token']}"},
    )


async def test_avec_abonnement_tout_est_la(client: AsyncClient, session: AsyncSession) -> None:
    """**Le sens inverse, et il compte autant.**

    Une route qui masquerait toujours passerait le test d'absence sans rien
    garantir de ce que l'abonnement achète.
    """
    reponse = await _annuaire(client, session, abonne=True)

    assert reponse.status_code == 200, reponse.text
    assert "rebecca.miami" in reponse.text
    ligne = reponse.json()["createurs"][0]
    assert ligne["comptes"][0]["followers"] == 48_213
    assert ligne["comptes"][0]["profil_url"]
    assert ligne["audience_totale"] == 48_213


async def test_la_biographie_ne_sort_pas_non_plus(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Du texte libre est une porte de sortie pour le pseudonyme.

    « écris-moi sur @rebecca.miami » tient très bien dans une bio. Fermer le
    champ `handle` en laissant passer la bio rendrait le pseudonyme par l'autre
    porte, et la règle ne protégerait que ce qu'elle a nommé.
    """
    from app.services import creator_profile as profile_service

    business, proprietaire = await commerce_en_cours(session)
    elle = await createur(session)
    await compte(session, elle, followers=1_000, handle="rebecca.miami")
    await profile_service.update_profile(
        session,
        user_id=elle.id,
        modifications={"bio": "Miami. Écris-moi sur @rebecca.miami"},
    )
    await session.commit()

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login",
            json={"email": proprietaire.email, "password": MOT_DE_PASSE},
        )
    ).json()
    reponse = await client.get(
        f"{PREFIX}/business/{business.id}/creators",
        headers={"Authorization": f"Bearer {jetons['access_token']}"},
    )

    assert "rebecca.miami" not in reponse.text
    assert reponse.json()["createurs"][0]["bio"] is None


async def test_l_apercu_remplace_la_photo_et_non_l_inverse(session: AsyncSession) -> None:
    """La clé servie sans abonnement est celle de l'aperçu, jamais l'originale."""
    elle = await createur(session)
    await compte(session, elle, followers=1_000, avatar_key="avatars/xyz")

    sans = {v.creator_id: v for v in await directory.annuaire(session, abonne=False)}[elle.id]
    avec = {v.creator_id: v for v in await directory.annuaire(session, abonne=True)}[elle.id]

    assert avec.comptes[0].avatar_key == "avatars/xyz"
    assert sans.comptes[0].avatar_key == storage.cle_d_apercu("avatars/xyz")
    assert sans.comptes[0].avatar_key != avec.comptes[0].avatar_key


async def test_sans_photo_il_n_y_a_pas_d_apercu(session: AsyncSession) -> None:
    """Nul reste nul : on n'invente pas une clé pour une image qui n'existe pas."""
    elle = await createur(session)
    await compte(session, elle, followers=1_000, avatar_key=None)

    vue = {v.creator_id: v for v in await directory.annuaire(session, abonne=False)}[elle.id]

    assert vue.comptes[0].avatar_key is None
