"""Regarder une preuve, et personne d'autre.

Le commerce voyait le pseudonyme, la prestation et quatre motifs de refus, mais
pas ce qu'on lui demandait d'approuver. Ouvrir cette porte est nécessaire ; la
laisser entrebâillée ne l'est pas.

Ce fichier éprouve **qui** peut regarder, et ce que vaut le jeton : c'est là que
se joue la confidentialité, pas dans le rendu.
"""

import uuid
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import TokenType, create_token
from app.integrations.object_store import get_object_store
from app.models import BusinessMember, Proof
from app.models.enums import CaptureMethod
from app.services import proof_access as service
from tests.test_collaboration import contrepartie

PREFIX = get_settings().api_v1_prefix

#: Un PNG minuscule mais valide : la route déduit le type du contenu, et un
#: contenu quelconque sortirait en « application/octet-stream ».
CONTENU = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)
MOT_DE_PASSE = "tourbillon-cactus-91-vermeil"


async def scene(session: AsyncSession) -> dict:
    """Une contrepartie ouverte, sa preuve, et les gens autour."""
    # Le montage passe par le helper existant : consommer ouvre la
    # contrepartie, et le refaire ici en dupliquerait la mécanique — qui
    # divergerait au premier changement d'état.
    collaboration, decor = await contrepartie(session)

    # **Le contenu est réellement déposé.** Sans lui, une lecture autorisée
    # répondait 404 faute d'objet — exactement comme une lecture refusée — et
    # les tests ne distinguaient plus les deux. Quatre mutations survivaient à
    # cause de ça.
    cle = await get_object_store().deposer(CONTENU, prefixe="proofs/upload")

    # La preuve est posée directement : ce fichier éprouve l'accès, pas la
    # soumission. C'est un montage de test, pas un jeu de données.
    preuve = Proof(
        collaboration_id=collaboration.id,
        submitted_at=datetime.now(UTC),
        capture_method=CaptureMethod.UPLOAD,
        content_hash="a" * 64,
        screenshot_key=cle,
    )
    session.add(preuve)

    await session.flush()

    # `caissier` est déjà membre du commerce : le décor le fabrique.
    return {**decor, "collaboration": collaboration, "preuve": preuve, "membre": decor["caissier"]}


async def entetes(client: AsyncClient, user) -> dict:
    reponse = await client.post(
        f"{PREFIX}/auth/login", json={"email": user.email, "password": MOT_DE_PASSE}
    )
    return {"Authorization": f"Bearer {reponse.json()['access_token']}"}


# --------------------------------------------------------------------------
# qui a le droit
# --------------------------------------------------------------------------


async def test_le_commerce_concerne_obtient_son_droit(
    client: AsyncClient, session: AsyncSession
) -> None:
    s = await scene(session)

    reponse = await client.get(
        f"{PREFIX}/proofs/{s['preuve'].id}/access",
        headers=await entetes(client, s["membre"]),
    )

    assert reponse.status_code == 200, reponse.text
    corps = reponse.json()
    assert str(s["preuve"].id) in corps["url"]
    # L'adresse pointe sur l'API, jamais sur le stockage : le nom du
    # compartiment n'a pas à sortir, et un fournisseur qui change ne doit rien
    # changer pour l'app.
    assert "supabase" not in corps["url"] and "amazonaws" not in corps["url"]
    assert 0 < corps["expires_in"] <= 3600


async def test_l_adresse_rendue_ouvre_l_objet_telle_quelle(
    client: AsyncClient, session: AsyncSession
) -> None:
    """**Empruntée, et non reconstruite.**

    Le chemin était écrit à la main dans la réponse, sans le préfixe de
    version. Le client le complétait avec l'origine de l'API et tombait sur un
    404 : côté commerce, l'aperçu restait un bloc gris et le salon approuvait
    sans voir la publication.

    Aucun test ne pouvait le voir : chacun extrayait le jeton de l'adresse et
    reconstruisait le chemin lui-même, ce qui prouvait que le jeton ouvrait —
    jamais que l'adresse rendue menait quelque part.
    """
    s = await scene(session)

    droit = await client.get(
        f"{PREFIX}/proofs/{s['preuve'].id}/access",
        headers=await entetes(client, s["membre"]),
    )
    assert droit.status_code == 200, droit.text

    # Telle quelle. Le client ne fait qu'y accoler l'origine de l'API.
    reponse = await client.get(droit.json()["url"])

    assert reponse.status_code == 200, reponse.text
    assert reponse.headers["content-type"].startswith("image/")
    assert reponse.content


async def test_un_autre_commerce_n_obtient_rien(client: AsyncClient, session: AsyncSession) -> None:
    """404 et non 403 : distinguer les deux dirait quels identifiants existent."""
    s = await scene(session)
    autre = await scene(session)

    reponse = await client.get(
        f"{PREFIX}/proofs/{s['preuve'].id}/access",
        headers=await entetes(client, autre["membre"]),
    )

    assert reponse.status_code == 404


async def test_la_creatrice_revient_sur_sa_publication(
    client: AsyncClient, session: AsyncSession
) -> None:
    """**Renversement de la règle d'avant, et la raison compte.**

    Il était écrit qu'elle n'avait pas à rouvrir l'objet archivé — « elle sait
    ce qu'elle a publié ». C'était vrai d'une preuve isolée et faux du produit :
    l'écran « mes publications » existe pour lui montrer ce qu'elle a publié, et
    il affichait la photo du **service au catalogue du salon** faute d'accès à
    l'image du post.
    """
    s = await scene(session)

    droit = await client.get(
        f"{PREFIX}/proofs/{s['preuve'].id}/access",
        headers=await entetes(client, s["createur"]),
    )
    assert droit.status_code == 200, droit.text

    # Le droit ouvre réellement l'objet : un 200 sur l'émission ne prouve rien
    # de la lecture, et c'est cette moitié-là qui compte pour l'écran.
    reponse = await client.get(droit.json()["url"])
    assert reponse.status_code == 200, reponse.text
    assert reponse.headers["content-type"].startswith("image/")


async def test_une_autre_creatrice_n_obtient_rien(
    client: AsyncClient, session: AsyncSession
) -> None:
    """**L'autre moitié, et sans elle la première ne garde rien.**

    Un test qui ne montrerait que l'accès accordé passerait aussi bien sur un
    droit ouvert à tous les créateurs. L'élargissement porte sur *sa* publication
    — la réservation dit qui l'a faite, et c'est elle qu'on interroge.
    """
    s = await scene(session)
    autre = await scene(session)

    reponse = await client.get(
        f"{PREFIX}/proofs/{s['preuve'].id}/access",
        headers=await entetes(client, autre["createur"]),
    )

    assert reponse.status_code == 404


async def test_sans_authentification_aucun_droit(
    client: AsyncClient, session: AsyncSession
) -> None:
    s = await scene(session)

    reponse = await client.get(f"{PREFIX}/proofs/{s['preuve'].id}/access")

    assert reponse.status_code == 401


# --------------------------------------------------------------------------
# ce que vaut le jeton
# --------------------------------------------------------------------------


async def test_la_lecture_sans_jeton_est_refusee(
    client: AsyncClient, session: AsyncSession
) -> None:
    s = await scene(session)

    reponse = await client.get(f"{PREFIX}/proofs/{s['preuve'].id}")

    # Le paramètre est obligatoire : la route ne s'ouvre pas « par défaut ».
    assert reponse.status_code in (401, 422)


async def test_un_jeton_ouvre_une_seule_preuve(client: AsyncClient, session: AsyncSession) -> None:
    """Sans cette comparaison, un jeton valide ouvrirait n'importe quel objet.

    C'est le défaut qu'on ne voit pas : le jeton est bon, la signature tient,
    et il sert à lire autre chose que ce pour quoi il a été émis.
    """
    s = await scene(session)
    autre = await scene(session)

    droit = await client.get(
        f"{PREFIX}/proofs/{s['preuve'].id}/access",
        headers=await entetes(client, s["membre"]),
    )
    jeton = droit.json()["url"].split("t=")[1]

    reponse = await client.get(f"{PREFIX}/proofs/{autre['preuve'].id}", params={"t": jeton})

    assert reponse.status_code == 404


async def test_un_jeton_expire_n_ouvre_plus(client: AsyncClient, session: AsyncSession) -> None:
    s = await scene(session)

    perime = create_token(
        subject=s["membre"].id,
        token_type=TokenType.PROOF_READ,
        token_id=s["preuve"].id,
        lifetime=timedelta(seconds=-1),
    )

    reponse = await client.get(f"{PREFIX}/proofs/{s['preuve'].id}", params={"t": perime})

    assert reponse.status_code == 404


async def test_un_jeton_d_un_autre_type_n_ouvre_rien(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Un jeton de session est signé par la même clé.

    Sans vérification du type, il ouvrirait les preuves — et un jeton de session
    dure quinze minutes, pas cinq.
    """
    s = await scene(session)

    session_token = create_token(
        subject=s["membre"].id,
        token_type=TokenType.ACCESS,
        token_id=uuid.uuid4(),
        lifetime=timedelta(minutes=15),
    )

    reponse = await client.get(f"{PREFIX}/proofs/{s['preuve'].id}", params={"t": session_token})

    assert reponse.status_code == 404


async def test_le_droit_tombe_avec_l_appartenance(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Vérifié à l'émission **et** à la lecture.

    Quelques minutes suffisent à changer d'employeur sur le papier, et un jeton
    encore valide ne doit pas survivre au droit qui l'a justifié.
    """
    s = await scene(session)

    droit = await client.get(
        f"{PREFIX}/proofs/{s['preuve'].id}/access",
        headers=await entetes(client, s["membre"]),
    )
    adresse = droit.json()["url"]

    await session.execute(sa.delete(BusinessMember).where(BusinessMember.user_id == s["membre"].id))
    await session.commit()

    reponse = await client.get(adresse)

    assert reponse.status_code == 404


# --------------------------------------------------------------------------
# ce qu'on montre
# --------------------------------------------------------------------------


def test_le_media_prime_sur_la_capture_d_ecran() -> None:
    """Le premier est ce que la plateforme a rendu, le second ce que la
    créatrice a envoyé. Quand les deux existent, le premier fait foi."""
    avec_les_deux = Proof(media_key="proofs/url/a", screenshot_key="proofs/upload/b")
    capture_seule = Proof(media_key=None, screenshot_key="proofs/upload/b")
    ni_l_un_ni_l_autre = Proof(media_key=None, screenshot_key=None)

    assert service.cle_du_media(avec_les_deux) == "proofs/url/a"
    assert service.cle_du_media(capture_seule) == "proofs/upload/b"
    assert service.cle_du_media(ni_l_un_ni_l_autre) is None


async def test_une_lecture_autorisee_rend_l_image(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Le test qui rend les autres discriminants.

    Sans lui, une lecture autorisée répondait 404 faute d'objet déposé —
    indistinguable d'un refus — et toutes les règles de confidentialité
    passaient les tests sans être exercées.
    """
    s = await scene(session)

    droit = await client.get(
        f"{PREFIX}/proofs/{s['preuve'].id}/access",
        headers=await entetes(client, s["membre"]),
    )
    jeton = droit.json()["url"].split("t=")[1]

    reponse = await client.get(f"{PREFIX}/proofs/{s['preuve'].id}", params={"t": jeton})

    assert reponse.status_code == 200, reponse.text
    assert reponse.content == CONTENU
    assert reponse.headers["content-type"] == "image/png"
    # Jamais dans un cache partagé.
    assert "private" in reponse.headers["cache-control"]


async def test_un_jeton_n_ouvre_pas_l_autre_preuve_du_meme_commerce(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Le cas qui isole la règle du jeton.

    Deux preuves du **même** commerce : l'appartenance autorise les deux, et
    seule la comparaison entre la preuve nommée par le jeton et celle demandée
    peut refuser. Avec deux commerces différents, c'est l'appartenance qui
    refusait — la règle du jeton n'était jamais exercée.
    """
    s = await scene(session)

    seconde = Proof(
        collaboration_id=s["collaboration"].id,
        submitted_at=datetime.now(UTC),
        capture_method=CaptureMethod.UPLOAD,
        content_hash="b" * 64,
        screenshot_key=await get_object_store().deposer(CONTENU, prefixe="proofs/upload"),
    )
    session.add(seconde)
    await session.flush()

    droit = await client.get(
        f"{PREFIX}/proofs/{s['preuve'].id}/access",
        headers=await entetes(client, s["membre"]),
    )
    jeton = droit.json()["url"].split("t=")[1]

    # Le même commerce, le même membre, un jeton parfaitement valide — et une
    # autre preuve.
    reponse = await client.get(f"{PREFIX}/proofs/{seconde.id}", params={"t": jeton})

    assert reponse.status_code == 404
