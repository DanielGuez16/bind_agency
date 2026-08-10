"""Le dépôt S3, et sa règle de confidentialité.

**Deux compartiments, jamais un seul avec un filtre de préfixe.** Un
compartiment public s'énumère : qui connaît son adresse en liste le contenu.
Ranger les preuves dedans en comptant sur l'API pour ne servir que `photos/`
protégerait la route et laisserait le compartiment ouvert.

La règle de rangement se teste **sans réseau** : c'est une règle de
confidentialité, elle doit pouvoir se lire et se vérifier sans monter un
fournisseur. Ce qui a besoin d'un client S3 est éprouvé sur un client simulé.
"""

import pytest

from app.core.config import ConfigurationError
from app.integrations import object_store
from app.integrations.object_store import (
    ObjectStoreUnavailable,
    S3ObjectStore,
    compartiment_de,
)

PUBLIC = "bind-public"
PRIVE = "bind-prive"


def depot(**overrides) -> S3ObjectStore:
    valeurs = {
        "public": PUBLIC,
        "prive": PRIVE,
        "endpoint": "https://exemple.test/storage/v1/s3",
        "region": "auto",
        "access_key": "une-cle",
        "secret_key": "un-secret",
        "duree_signature": 300,
    }
    return S3ObjectStore(**(valeurs | overrides))


# --------------------------------------------------------------------------
# le rangement
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "prefixe",
    ["photos/business", "photos/item", "photos/", "photos/quelque-chose-de-neuf"],
)
def test_les_photos_vont_dans_le_compartiment_public(prefixe: str) -> None:
    """Acté quand la route média a été ouverte : les photos sont publiques."""
    assert compartiment_de(prefixe, public=PUBLIC, prive=PRIVE) == PUBLIC


@pytest.mark.parametrize("prefixe", ["proofs/upload", "proofs/url", "proofs/"])
def test_les_preuves_vont_dans_le_compartiment_prive(prefixe: str) -> None:
    assert compartiment_de(prefixe, public=PUBLIC, prive=PRIVE) == PRIVE


@pytest.mark.parametrize(
    "prefixe",
    [
        # Un préfixe qui n'existe pas encore. C'est le cas qui compte : le jour
        # où quelqu'un en ajoute un et oublie ce fichier, le repli doit être du
        # bon côté.
        "exports/comptabilite",
        "documents/identite",
        "",
        "photo/business",  # au singulier : ressemblant, et pas dans la liste
        "PHOTOS/business",  # la casse ne suffit pas à ouvrir un compartiment
        "../photos/business",
    ],
)
def test_tout_ce_qui_n_est_pas_declare_public_est_prive(prefixe: str) -> None:
    """La liste des publics est fermée ; il n'y a pas de liste des privés.

    L'inverse ferait d'un oubli une fuite. Ici, un oubli ne fait qu'une lecture
    qui passe par l'API.
    """
    assert compartiment_de(prefixe, public=PUBLIC, prive=PRIVE) == PRIVE


def test_le_depot_range_selon_le_prefixe() -> None:
    """La même règle, vue depuis l'objet : elle n'est pas réécrite ailleurs."""
    magasin = depot()

    assert magasin.compartiment("photos/business") == PUBLIC
    assert magasin.compartiment("proofs/upload/2026-08-09/abc") == PRIVE


# --------------------------------------------------------------------------
# le refus de faire semblant
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "manquant",
    ["public", "prive", "access_key", "secret_key"],
)
def test_un_depot_incomplet_refuse_d_exister(manquant: str) -> None:
    """À la construction, pas au premier dépôt.

    Une preuve perdue faute d'identifiants ne se rattrape pas, et le créateur
    qui l'a envoyée n'en saurait rien.
    """
    with pytest.raises(ObjectStoreUnavailable):
        depot(**{manquant: None})


def test_deux_compartiments_identiques_sont_refuses(monkeypatch: pytest.MonkeyPatch) -> None:
    """Le même nom des deux côtés vaut un seul compartiment public.

    C'est exactement la configuration que la règle interdit, et elle est facile
    à écrire par distraction en recopiant une ligne.
    """
    from app.core import config as module_config

    reglages = module_config.build_settings(
        _env_file=None,
        database_url="postgresql+psycopg://x:y@localhost/z",
        jwt_secret_key="peu-importe-ici-mais-assez-longue-pour-hmac",
        token_encryption_key="dGVzdC10ZXN0LXRlc3QtdGVzdC10ZXN0LXRlc3QtdGVzdC10ZXN0",
        object_store_provider="s3",
        object_store_bucket_public="bind-media",
        object_store_bucket_prive="bind-media",
        object_store_access_key="une-cle",
        object_store_secret_key="un-secret",
    )
    monkeypatch.setattr(object_store, "get_settings", lambda: reglages)

    with pytest.raises((ObjectStoreUnavailable, ConfigurationError)):
        object_store.check_object_store_configuration()


# --------------------------------------------------------------------------
# l'adresse signée
# --------------------------------------------------------------------------


class FauxClientS3:
    """Assez de S3 pour vérifier ce qu'on lui demande, et rien de plus."""

    def __init__(self) -> None:
        self.appels: list[dict] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    async def generate_presigned_url(self, operation, *, Params, ExpiresIn):  # noqa: N803
        self.appels.append({"operation": operation, "params": Params, "expire": ExpiresIn})
        return f"https://exemple.test/{Params['Bucket']}/{Params['Key']}?signature=xxx"

    async def put_object(self, *, Bucket, Key, Body):  # noqa: N803
        self.appels.append({"operation": "put", "params": {"Bucket": Bucket, "Key": Key}})


@pytest.mark.anyio
async def test_une_preuve_se_signe_sur_le_compartiment_prive() -> None:
    faux = FauxClientS3()
    magasin = depot()
    magasin._client = lambda: faux  # type: ignore[method-assign]

    adresse = await magasin.url_signee("proofs/upload/2026-08-09/abc")

    assert faux.appels[0]["params"]["Bucket"] == PRIVE
    assert PRIVE in adresse


@pytest.mark.anyio
async def test_l_adresse_signee_est_de_courte_duree() -> None:
    """Une adresse signée est un droit de lecture transmissible, et elle voyage
    dans un historique de navigateur. Assez longue pour ouvrir l'image qu'on
    vient de demander, trop courte pour être partagée utilement."""
    faux = FauxClientS3()
    magasin = depot(duree_signature=300)
    magasin._client = lambda: faux  # type: ignore[method-assign]

    await magasin.url_signee("proofs/upload/2026-08-09/abc")

    assert faux.appels[0]["expire"] == 300
    assert faux.appels[0]["expire"] <= 3600, "une adresse de preuve ne dure pas une journée"


@pytest.mark.anyio
async def test_un_depot_de_preuve_ne_touche_jamais_le_public() -> None:
    faux = FauxClientS3()
    magasin = depot()
    magasin._client = lambda: faux  # type: ignore[method-assign]

    await magasin.deposer(b"une capture", prefixe="proofs/upload")

    assert faux.appels[0]["params"]["Bucket"] == PRIVE


# --------------------------------------------------------------------------
# l'aller-retour
# --------------------------------------------------------------------------


class FauxDepotAsymetrique:
    """Un dépôt qui accepte tout et ne rend rien.

    C'est la panne qu'aucune vérification de configuration ne voit : les deux
    noms sont posés, non vides et différents, et l'un des deux ne désigne rien.
    """

    def __init__(self, *, rend: bool) -> None:
        self.rend = rend
        self.ecrits: list[str] = []
        self.retires: list[str] = []

    async def deposer(self, contenu: bytes, *, prefixe: str) -> str:
        self.ecrits.append(prefixe)
        return f"{prefixe}/2026-01-01/abc"

    async def lire(self, cle: str) -> bytes | None:
        return object_store.TEMOIN if self.rend else None

    async def supprimer(self, cle: str) -> None:
        self.retires.append(cle)


@pytest.mark.anyio
async def test_l_aller_retour_ecrit_dans_les_deux_compartiments(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    faux = FauxDepotAsymetrique(rend=True)
    monkeypatch.setattr(object_store, "get_object_store", lambda: faux)
    monkeypatch.setattr(object_store, "S3ObjectStore", FauxDepotAsymetrique)

    await object_store.verifier_les_deux_compartiments()

    # Les deux, pas seulement celui qu'on regarde en premier. Et pour chacun,
    # le témoin d'aller-retour **puis** la charge au gabarit du produit : un
    # témoin de vingt octets passe sur un compartiment dont la limite de taille
    # est inférieure à ce qu'on y déposera vraiment.
    assert faux.ecrits == [
        "photos/temoin",
        "photos/temoin-gabarit",
        "proofs/temoin",
        "proofs/temoin-gabarit",
    ]

    # La charge est retirée : la garder ferait grossir le dépôt de quinze
    # mégaoctets à chaque déploiement.
    assert len(faux.retires) == 2


@pytest.mark.anyio
async def test_un_compartiment_qui_ne_rend_rien_est_signale(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Écrire et lire à deux endroits différents ne se voit pas autrement.

    La configuration est valide, l'écriture réussit, et l'absence se découvre
    des jours plus tard sur un écran, sous la forme d'une image manquante.
    """
    faux = FauxDepotAsymetrique(rend=False)
    monkeypatch.setattr(object_store, "get_object_store", lambda: faux)
    monkeypatch.setattr(object_store, "S3ObjectStore", FauxDepotAsymetrique)

    with pytest.raises(ObjectStoreUnavailable, match="ne rend pas"):
        await object_store.verifier_les_deux_compartiments()


@pytest.mark.anyio
async def test_l_aller_retour_ne_concerne_que_le_mode_s3(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Le disque local n'a pas de compartiment à joindre, et le vérifier
    ferait échouer le développement sur une propriété qui n'existe pas."""
    from app.integrations.object_store import MemoryObjectStore

    monkeypatch.setattr(object_store, "get_object_store", MemoryObjectStore)

    await object_store.verifier_les_deux_compartiments()


# --------------------------------------------------------------------------
# ce que le serveur répond, quand il le dit mal
# --------------------------------------------------------------------------


def _client_error(statut: int, *, code: str = "", message: str = ""):
    """Une `ClientError` comme en rend un fournisseur compatible S3.

    Le cas qui compte est celui où le corps de la réponse n'est pas le XML
    attendu : `botocore` construit alors une erreur dont le code et le message
    sont **vides**, et dont le texte est « An error occurred () ». Seul le
    statut HTTP reste. C'est ce que renvoie Supabase, et c'est ce sur quoi le
    code doit décider.
    """
    from botocore.exceptions import ClientError

    return ClientError(
        {
            "Error": {"Code": code, "Message": message},
            "ResponseMetadata": {"HTTPStatusCode": statut},
        },
        "PutObject",
    )


class FauxClientQuiRefuse(FauxClientS3):
    def __init__(self, erreur: Exception) -> None:
        super().__init__()
        self.erreur = erreur

    async def put_object(self, *, Bucket, Key, Body):  # noqa: N803
        raise self.erreur

    async def get_object(self, *, Bucket, Key):  # noqa: N803
        raise self.erreur


def _depot(client) -> object_store.S3ObjectStore:
    depot = object_store.S3ObjectStore(
        public="bind-public",
        prive="bind-prive",
        endpoint="https://exemple.test",
        region="us-east-1",
        access_key="cle",
        secret_key="secret",
        duree_signature=600,
    )
    depot._client = lambda: client  # noqa: SLF001
    return depot


@pytest.mark.anyio
async def test_un_refus_muet_dit_quand_meme_le_statut_et_le_compartiment() -> None:
    """« dépôt S3 refusé : ClientError » n'oriente vers rien.

    On a perdu deux fois du temps sur le compartiment privé faute de savoir ce
    que le serveur répondait. Le statut est là même quand le code et le message
    sont vides — et 413 se lit tout de suite comme une charge refusée, là où le
    texte nu laisse croire à un problème de droits.
    """
    depot = _depot(FauxClientQuiRefuse(_client_error(413)))

    with pytest.raises(object_store.ObjectStoreError) as refus:
        await depot.deposer(b"x" * 2048, prefixe="proofs/upload")

    dit = str(refus.value)
    assert "http=413" in dit
    assert "bind-prive" in dit, "le compartiment visé manque, on cherche du mauvais côté"
    assert "2048 octets" in dit, "la taille manque, alors que c'est elle qui est refusée"
    assert "PutObject" in dit


@pytest.mark.anyio
async def test_un_objet_absent_reste_une_absence_meme_sans_message() -> None:
    """Le statut, jamais le texte.

    La détection cherchait « 404 » dans le message de l'exception. Chez un
    fournisseur qui répond un corps non conforme, ce message est vide : un objet
    simplement absent remontait en panne, la route de média rendait 503 au lieu
    de 404, et l'app affichait une erreur au lieu de son repli d'image.
    """
    depot = _depot(FauxClientQuiRefuse(_client_error(404)))

    assert await depot.lire("photos/business/2026-01-01/absente") is None


@pytest.mark.anyio
async def test_une_vraie_panne_de_lecture_ne_passe_pas_pour_une_absence() -> None:
    """L'inverse du test précédent, sans quoi il serait satisfait par un `return None` nu."""
    depot = _depot(FauxClientQuiRefuse(_client_error(500)))

    with pytest.raises(object_store.ObjectStoreError) as panne:
        await depot.lire("photos/business/2026-01-01/illisible")

    assert "http=500" in str(panne.value)
