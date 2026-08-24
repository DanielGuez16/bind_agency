"""Les images servies en direct par l'hébergeur, plutôt que relayées.

**Mesuré avant d'être fait.** Sur le service de démonstration, une image coûtait
1 090 ms au-dessus du plancher de l'API pour 16 Ko : ni du SQL, ni des octets —
l'API allait chercher le fichier chez l'hébergeur et le renvoyait. Vingt images
par écran de fil, et c'est ce qui restait de la lenteur une fois le processeur
réglé.

Ce que ce fichier éprouve est **la sûreté de la bascule**, pas sa vitesse : la
garde de préfixe reste l'unique goulot, et aucune clé hors du compartiment
public ne peut recevoir d'adresse directe.
"""

import pytest
from httpx import AsyncClient

from app.core.config import get_settings
from app.integrations import object_store
from app.services import storage

PREFIX = get_settings().api_v1_prefix
BASE = "https://exemple.supabase.co/storage/v1/object/public/bind-public"


@pytest.fixture
def adresse_publique(monkeypatch: pytest.MonkeyPatch):
    """Pose l'adresse publique, comme en démonstration."""
    reglages = get_settings().model_copy(update={"object_store_public_base_url": BASE})
    monkeypatch.setattr("app.services.storage.get_settings", lambda: reglages)
    return reglages


# --------------------------------------------------------------------------
# la garde de préfixe : aucune clé privée ne reçoit d'adresse directe
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "cle",
    [
        "proofs/api/2026-08-24/abcdef",
        "proofs/url/2026-08-24/abcdef",
        "proofs/upload/2026-08-24/abcdef",
        # Les trois formes qui ressemblent à du public sans en être : un préfixe
        # qui commence pareil, un chemin qui contient `photos/` plus loin, et une
        # remontée de répertoire. La garde doit prendre les trois.
        "photosprivees/2026-08-24/abcdef",
        "captures/photos/2026-08-24/abcdef",
        "../proofs/api/2026-08-24/abcdef",
    ],
)
def test_aucune_cle_hors_du_public_ne_recoit_d_adresse(adresse_publique, cle: str) -> None:
    """**La question posée à cette bascule, et sa seule réponse acceptable.**

    Une preuve de publication vit dans l'autre compartiment ; lui donner une
    adresse directe rendrait soit un lien mort, soit — bien pire — un lien qui
    marche. Les six formes couvrent ce qu'on écrirait par erreur, pas seulement
    celle qu'on avait en tête.
    """
    assert storage.url_publique(cle) is None


def test_et_une_photo_en_recoit_une(adresse_publique) -> None:
    """Le sens inverse. Une garde qui refuse tout passe le test de refus sans
    rien garantir."""
    assert (
        storage.url_publique("photos/item/2026-08-24/abc") == f"{BASE}/photos/item/2026-08-24/abc"
    )
    # L'aperçu flouté aussi : c'est un objet distinct, déjà flouté au repos, et
    # le contrôle d'abonnement tient à ce que le JSON sert — jamais à qui sert
    # le fichier. Un salon non abonné ne reçoit pas la clé de l'original.
    assert storage.url_publique("photos/createurs/abc@apercu") is not None


def test_la_liste_des_prefixes_n_est_pas_recopiee(adresse_publique) -> None:
    """**Deux vérités divergeraient.** La garde lit la liste du dépôt, celle qui
    décide déjà du compartiment. La recopier ferait qu'un préfixe ajouté d'un
    côté manquerait de l'autre — et le jour où ça arrive, une clé privée reçoit
    une adresse publique."""
    assert object_store.PREFIXES_PUBLICS == ("photos/",)
    assert storage.url_publique("photos/x") is not None


def test_sans_adresse_configuree_rien_n_est_direct() -> None:
    """Le développement local et les tests tournent sur un dépôt de fichiers :
    la route doit continuer de relayer, sans quoi rien ne s'affiche hors
    production."""
    assert storage.url_publique("photos/item/2026-08-24/abc") is None


# --------------------------------------------------------------------------
# la route : redirection permanente, et repli sur le relais
# --------------------------------------------------------------------------


async def test_la_route_redirige_au_lieu_de_relayer(client: AsyncClient, adresse_publique) -> None:
    """**308 et non 302** : permanente et cachable, donc le navigateur ne
    repasse pas par nous à la visite suivante. La clé est une empreinte du
    contenu : la cible ne changera jamais sous la même clé."""
    reponse = await client.get(f"{PREFIX}/media/photos/item/2026-08-24/abc", follow_redirects=False)

    assert reponse.status_code == 308
    assert reponse.headers["location"] == f"{BASE}/photos/item/2026-08-24/abc"
    assert "immutable" in reponse.headers["cache-control"]


async def test_une_preuve_reste_introuvable_meme_en_direct(
    client: AsyncClient, adresse_publique, monkeypatch: pytest.MonkeyPatch
) -> None:
    """404 et non 403 : dire « existe mais interdit » apprendrait qu'une preuve
    porte cette clé. Et surtout : **pas de redirection**, qui serait une fuite
    d'adresse même si le lien ne marchait pas.

    **La preuve est réellement déposée, et c'est tout le décor.** Sans elle, la
    route rend 404 parce que le dépôt est vide — donc une route qui aurait perdu
    son filtre de préfixe passerait ce test aussi bien que la bonne. Mutation
    faite, mutation survivante : c'est ce montage-ci qui l'attrape.
    """
    from app.integrations.object_store import MemoryObjectStore
    from app.routers import media as routeur_media

    depot = MemoryObjectStore()
    cle = "proofs/api/2026-08-24/abc"
    await depot.deposer_sous(b"\x89PNG\r\n\x1a\n une preuve bien reelle", cle=cle)
    monkeypatch.setattr(routeur_media, "get_object_store", lambda: depot)
    assert await depot.lire(cle) is not None, "le décor ne pose rien : il ne prouverait rien"

    reponse = await client.get(f"{PREFIX}/media/{cle}", follow_redirects=False)

    assert reponse.status_code == 404, "la preuve a été servie"
    assert "location" not in reponse.headers


# --------------------------------------------------------------------------
# le type du contenu, posé à l'écriture
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("octets", "attendu"),
    [
        (b"\x89PNG\r\n\x1a\n reste", "image/png"),
        (b"\xff\xd8\xff\xe0 reste", "image/jpeg"),
        (b"RIFF____WEBPVP8 ", "image/webp"),
        (b"\x00\x00\x00\x20ftypisom", "video/mp4"),
        (b"pas une image du tout", "application/octet-stream"),
    ],
)
def test_le_type_est_deduit_des_octets_jamais_de_la_cle(octets: bytes, attendu: str) -> None:
    """**Sans lui, tout partait en flux binaire et aucun navigateur n'affichait
    rien.** Tant que la route relayait, elle déduisait le type à chaque lecture ;
    un lien direct rend ce que le dépôt a enregistré.

    Le défaut a déjà été payé sur la vidéo d'accueil : le fichier était bien
    servi, aucun lecteur ne le jouait. Le MP4 est ici parce que sa signature ne
    commence pas au premier octet — c'est exactement le cas qu'une lecture naïve
    rate.
    """
    assert object_store.type_du_contenu(octets) == attendu
