"""Téléverser une capture, et ce que la route refuse.

Le maillon qui manquait : la soumission attend une clé déjà déposée, et rien ne
permettait de déposer. La boucle s'arrêtait là.

Ce fichier éprouve les refus, parce que ce sont eux qui protègent : un poids
vérifié sur l'en-tête déclaré ne protège de rien, et un type déduit du nom de
fichier non plus.
"""

import uuid

import pytest
from httpx import AsyncClient

from app.core.config import get_settings
from app.models.enums import UserRole
from app.services import auth as auth_service

PREFIX = get_settings().api_v1_prefix
MOT_DE_PASSE = "un-mot-de-passe-solide-42"

PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


async def creatrice(client: AsyncClient, session) -> dict:
    user = await auth_service.register(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password=MOT_DE_PASSE,
        role=UserRole.CREATOR,
    )
    await session.commit()
    jetons = (
        await client.post(
            f"{PREFIX}/auth/login", json={"email": user.email, "password": MOT_DE_PASSE}
        )
    ).json()
    return {"Authorization": f"Bearer {jetons['access_token']}"}


async def test_une_capture_est_deposee_dans_le_compartiment_prive(
    client: AsyncClient, session
) -> None:
    entetes = await creatrice(client, session)

    reponse = await client.post(
        f"{PREFIX}/me/proof-uploads",
        headers=entetes,
        files={"fichier": ("capture.png", PNG, "image/png")},
    )

    assert reponse.status_code == 201, reponse.text
    cle = reponse.json()["screenshot_key"]
    # Le préfixe décide du compartiment : `proofs/` n'est pas dans la liste des
    # publics, et c'est le dépôt qui range — pas la route.
    assert cle.startswith("proofs/upload/")


async def test_un_fichier_trop_lourd_est_refuse(client: AsyncClient, session) -> None:
    """Refusé **pendant** la lecture, pas après.

    Accepter le flux entier pour le refuser ensuite ferait dépendre la mémoire
    du serveur de ce que l'appelant envoie.
    """
    entetes = await creatrice(client, session)
    plafond = get_settings().proof_upload_max_bytes
    trop = PNG + b"\x00" * (plafond + 1)

    reponse = await client.post(
        f"{PREFIX}/me/proof-uploads",
        headers=entetes,
        files={"fichier": ("enorme.png", trop, "image/png")},
    )

    assert reponse.status_code == 413
    assert reponse.json()["detail"] == "proof_too_large"


async def test_le_type_vient_du_contenu_pas_du_nom(client: AsyncClient, session) -> None:
    """Le nom du fichier et le type déclaré sont fournis par l'appelant.

    Les croire laisserait archiver n'importe quoi sous une extension d'image, et
    le contrôle le découvrirait devant un fichier illisible.
    """
    entetes = await creatrice(client, session)

    reponse = await client.post(
        f"{PREFIX}/me/proof-uploads",
        headers=entetes,
        files={"fichier": ("capture.png", b"ceci n'est pas une image", "image/png")},
    )

    assert reponse.status_code == 415
    assert reponse.json()["detail"] == "proof_unsupported_type"


async def test_un_fichier_vide_est_refuse(client: AsyncClient, session) -> None:
    entetes = await creatrice(client, session)

    reponse = await client.post(
        f"{PREFIX}/me/proof-uploads",
        headers=entetes,
        files={"fichier": ("vide.png", b"", "image/png")},
    )

    assert reponse.status_code == 422


async def test_seule_une_creatrice_televerse(client: AsyncClient, session) -> None:
    """Un commerce n'a pas de preuve à envoyer, il en reçoit."""
    user = await auth_service.register(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password=MOT_DE_PASSE,
        role=UserRole.BUSINESS_MEMBER,
    )
    await session.commit()
    jetons = (
        await client.post(
            f"{PREFIX}/auth/login", json={"email": user.email, "password": MOT_DE_PASSE}
        )
    ).json()

    reponse = await client.post(
        f"{PREFIX}/me/proof-uploads",
        headers={"Authorization": f"Bearer {jetons['access_token']}"},
        files={"fichier": ("capture.png", PNG, "image/png")},
    )

    assert reponse.status_code == 403


async def test_sans_authentification_rien_ne_se_depose(client: AsyncClient) -> None:
    reponse = await client.post(
        f"{PREFIX}/me/proof-uploads", files={"fichier": ("capture.png", PNG, "image/png")}
    )

    assert reponse.status_code == 401


@pytest.mark.parametrize("signature", [b"\x89PNG\r\n\x1a\n", b"\xff\xd8\xff", b"RIFF"])
async def test_les_trois_formats_acceptes_passent(
    client: AsyncClient, session, signature: bytes
) -> None:
    """L'autre sens. Une liste qui refuserait tout passerait les tests de refus
    sans rien garantir, et personne ne pourrait envoyer sa preuve."""
    entetes = await creatrice(client, session)

    reponse = await client.post(
        f"{PREFIX}/me/proof-uploads",
        headers=entetes,
        files={"fichier": ("capture", signature + b"contenu quelconque", "image/png")},
    )

    assert reponse.status_code == 201, reponse.text
