"""Dépôt d'objets, derrière une interface.

Trois implémentations, une seule interface. Le service d'archivage ne sait pas
laquelle il tient, et aucune branche conditionnelle sur le mode : le choix est
une ligne de configuration, vérifiée au démarrage.

**`memory`** garde en mémoire du processus. Le mode des tests : rien à nettoyer,
rien à monter, et deux tests ne se marchent pas dessus.

**`local`** écrit sur le disque. Le mode du développement et de la démo — une
preuve archivée reste consultable après redémarrage, ce qui est exactement la
propriété qui manquait quand `deposer` ne faisait que calculer une clé.

**`s3`** parle à un fournisseur compatible S3, sur **deux compartiments**.

Deux et non un seul avec un filtre de préfixe : un compartiment public
s'énumère, et qui connaît son adresse en liste le contenu. Ranger les preuves
dedans en comptant sur l'API pour ne servir que `photos/` protégerait la route
et laisserait le compartiment ouvert.

Le préfixe décide du compartiment, et **tout ce qui n'est pas explicitement
public va dans le privé**. Le repli est du bon côté : un préfixe ajouté demain
et oublié ici atterrit au pire dans le compartiment fermé, jamais dans l'ouvert.

**Une preuve ne se sert jamais par un lien direct.** L'API rend une adresse
signée de courte durée, ou rien.

**La clé est dérivée du contenu.** Deux dépôts du même fichier partagent la
leur, et le stockage ne double pas. Le préfixe range par nature, ce qui rend une
politique de rétention écrivable plus tard sans relire les lignes.
"""

import hashlib
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol, runtime_checkable

from app.core.config import get_settings


class ObjectStoreError(Exception):
    """Le dépôt n'a pas abouti. Distinct d'un refus métier."""


class ObjectStoreUnavailable(ObjectStoreError):
    """Le fournisseur déclaré n'est pas utilisable, et on refuse de faire semblant."""


def cle_pour(contenu: bytes, *, prefixe: str) -> str:
    """La clé d'un contenu, identique quelle que soit l'implémentation.

    Calculée ici et pas dans chaque dépôt : deux implémentations qui
    dériveraient la clé différemment rendraient un objet introuvable après un
    changement de fournisseur.
    """
    empreinte = hashlib.sha256(contenu).hexdigest()
    jour = datetime.now(UTC).date().isoformat()
    return f"{prefixe}/{jour}/{empreinte}"


@runtime_checkable
class ObjectStore(Protocol):
    async def deposer(self, contenu: bytes, *, prefixe: str) -> str:
        """Range le contenu et rend sa clé."""
        ...

    async def lire(self, cle: str) -> bytes | None:
        """Le contenu, ou `None` s'il n'existe pas. Jamais une exception pour
        une absence : elle se distingue mal d'une panne."""
        ...


class MemoryObjectStore:
    """Le mode des tests. L'état vit dans l'instance, pas dans un module."""

    def __init__(self) -> None:
        self._objets: dict[str, bytes] = {}

    async def deposer(self, contenu: bytes, *, prefixe: str) -> str:
        cle = cle_pour(contenu, prefixe=prefixe)
        self._objets[cle] = contenu
        return cle

    async def lire(self, cle: str) -> bytes | None:
        return self._objets.get(cle)


class LocalObjectStore:
    """Le mode du développement et de la démo. Écrit sous une racine."""

    def __init__(self, racine: Path) -> None:
        self._racine = racine

    def _chemin(self, cle: str) -> Path:
        # La clé est construite par `cle_pour` et ne contient que des segments
        # sûrs. On le vérifie quand même : une clé venue d'ailleurs qui
        # remonterait l'arborescence écrirait n'importe où sur la machine.
        chemin = (self._racine / cle).resolve()
        racine = self._racine.resolve()
        if not chemin.is_relative_to(racine):
            raise ObjectStoreError(f"clé hors de la racine : {cle}")
        return chemin

    async def deposer(self, contenu: bytes, *, prefixe: str) -> str:
        cle = cle_pour(contenu, prefixe=prefixe)
        chemin = self._chemin(cle)
        chemin.parent.mkdir(parents=True, exist_ok=True)
        # Écriture puis renommage : un processus tué au milieu laisse un
        # fichier temporaire, jamais un objet tronqué sous une clé qui promet
        # son contenu.
        provisoire = chemin.with_suffix(".partiel")
        provisoire.write_bytes(contenu)
        provisoire.replace(chemin)
        return cle

    async def lire(self, cle: str) -> bytes | None:
        chemin = self._chemin(cle)
        return chemin.read_bytes() if chemin.is_file() else None


#: Les préfixes servis par le compartiment public. Liste **fermée**.
#:
#: Tout le reste va dans le privé. L'inverse — une liste de ce qui est privé —
#: ferait d'un oubli une fuite ; ici un oubli ne fait qu'une lecture qui passe
#: par l'API.
PREFIXES_PUBLICS = ("photos/",)


def compartiment_de(prefixe: str, *, public: str, prive: str) -> str:
    """Où range-t-on ce préfixe.

    Séparé du client pour se tester sans réseau : c'est une règle de
    confidentialité, et elle doit pouvoir se lire sans monter un fournisseur.
    """
    return public if prefixe.startswith(PREFIXES_PUBLICS) else prive


class S3ObjectStore:
    """Compatible S3, sur deux compartiments.

    Le client est construit à l'appel et refermé aussitôt : `aioboto3` ouvre une
    session par contexte, et en garder une ouverte pour la vie du processus
    demanderait de la refermer proprement à l'arrêt — pour un dépôt qui sert
    quelques objets par minute, ce n'est pas le bon compromis.
    """

    def __init__(
        self,
        *,
        public: str | None,
        prive: str | None,
        endpoint: str | None,
        region: str,
        access_key: str | None,
        secret_key: str | None,
        duree_signature: int,
    ) -> None:
        if not (public and prive and access_key and secret_key):
            # Refuser ici, à la construction, et non au premier dépôt : une
            # preuve perdue faute d'identifiants ne se rattrape pas, et le
            # créateur qui l'a envoyée n'en saurait rien.
            raise ObjectStoreUnavailable(
                "dépôt S3 incomplet : OBJECT_STORE_BUCKET_PUBLIC, "
                "OBJECT_STORE_BUCKET_PRIVE, OBJECT_STORE_ACCESS_KEY et "
                "OBJECT_STORE_SECRET_KEY sont tous attendus"
            )
        self._public = public
        self._prive = prive
        self._endpoint = endpoint
        self._region = region
        self._access_key = access_key
        self._secret_key = secret_key
        self._duree = duree_signature

    def _client(self):
        import aioboto3

        return aioboto3.Session().client(
            "s3",
            endpoint_url=self._endpoint,
            region_name=self._region,
            aws_access_key_id=self._access_key,
            aws_secret_access_key=self._secret_key,
        )

    def compartiment(self, cle_ou_prefixe: str) -> str:
        """Le compartiment d'une clé ou d'un préfixe. Public seulement si déclaré."""
        return compartiment_de(cle_ou_prefixe, public=self._public, prive=self._prive)

    async def deposer(self, contenu: bytes, *, prefixe: str) -> str:
        cle = cle_pour(contenu, prefixe=prefixe)
        try:
            async with self._client() as s3:
                await s3.put_object(Bucket=self.compartiment(prefixe), Key=cle, Body=contenu)
        except Exception as error:
            # Enveloppé : l'appelant traite un dépôt manqué, il n'a pas à
            # connaître les exceptions de `botocore`.
            raise ObjectStoreError(f"dépôt S3 refusé : {type(error).__name__}") from error
        return cle

    async def lire(self, cle: str) -> bytes | None:
        try:
            async with self._client() as s3:
                reponse = await s3.get_object(Bucket=self.compartiment(cle), Key=cle)
                return await reponse["Body"].read()
        except Exception as error:
            # Une absence n'est pas une panne, et les deux se distinguent mal
            # dans `botocore` : `NoSuchKey` porte un nom, le reste non.
            if type(error).__name__ in ("NoSuchKey", "ClientError") and "404" in str(error):
                return None
            if type(error).__name__ == "NoSuchKey":
                return None
            raise ObjectStoreError(f"lecture S3 refusée : {type(error).__name__}") from error

    async def url_signee(self, cle: str) -> str:
        """Une adresse de lecture à durée courte.

        **Le seul chemin vers une preuve.** Elle n'est pas publique et ne le
        devient pas : l'adresse expire, et jusque-là elle ne désigne qu'un
        objet, pas un compartiment.
        """
        async with self._client() as s3:
            return await s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": self.compartiment(cle), "Key": cle},
                ExpiresIn=self._duree,
            )


#: Une seule instance par processus pour `memory` : deux instances feraient
#: perdre ce qui vient d'être déposé, et l'échec ressemblerait à un défaut du
#: service d'archivage.
_memoire = MemoryObjectStore()


def get_object_store() -> ObjectStore:
    """Le dépôt déclaré par la configuration."""
    settings = get_settings()
    if settings.object_store_provider == "memory":
        return _memoire
    if settings.object_store_provider == "local":
        return LocalObjectStore(Path(settings.object_store_local_root))
    return S3ObjectStore(
        public=settings.object_store_bucket_public,
        prive=settings.object_store_bucket_prive,
        endpoint=settings.object_store_endpoint,
        region=settings.object_store_region,
        access_key=settings.object_store_access_key,
        secret_key=(
            settings.object_store_secret_key.get_secret_value()
            if settings.object_store_secret_key
            else None
        ),
        duree_signature=settings.object_store_signed_url_seconds,
    )


async def verifier_les_deux_compartiments() -> None:
    """Écrit un témoin dans chaque compartiment et le relit.

    **Une configuration valide n'est pas une configuration qui marche.** Les
    deux noms peuvent être posés, non vides et différents, et désigner des
    compartiments qui n'existent pas — ou dont l'un est celui où l'on a écrit et
    l'autre celui où l'on lit. Rien ne le dit avant la première lecture, et la
    première lecture arrive des jours plus tard, sur un écran, sous la forme
    d'une image absente.

    Le témoin est minuscule et son contenu est fixe, donc sa clé aussi : deux
    exécutions ne laissent qu'un objet, pas un par lancement.
    """
    depot = get_object_store()
    if not isinstance(depot, S3ObjectStore):
        return

    for prefixe, compartiment in (
        ("photos/temoin", "public"),
        ("proofs/temoin", "privé"),
    ):
        try:
            cle = await depot.deposer(TEMOIN, prefixe=prefixe)
        except ObjectStoreError as error:
            raise ObjectStoreUnavailable(
                f"écriture impossible dans le compartiment {compartiment} : {error}"
            ) from error

        relu = await depot.lire(cle)
        if relu != TEMOIN:
            raise ObjectStoreUnavailable(
                f"le compartiment {compartiment} accepte l'écriture mais ne rend "
                f"pas ce qu'on y a mis ({cle}) : on écrit et on lit à deux "
                "endroits différents"
            )


#: Le témoin d'aller-retour. Fixe, donc sa clé aussi.
TEMOIN = b"bind-temoin-de-depot"


def check_object_store_configuration() -> None:
    """Refuse de démarrer plutôt que d'échouer à la première preuve.

    Découvrir au premier archivage que la racine n'est pas inscriptible
    signifierait une preuve perdue, et le créateur qui l'a envoyée n'en saurait
    rien.
    """
    settings = get_settings()

    if settings.object_store_provider == "local":
        racine = Path(settings.object_store_local_root)
        try:
            racine.mkdir(parents=True, exist_ok=True)
            temoin = racine / ".ecriture"
            temoin.write_bytes(b"")
            temoin.unlink()
        except OSError as error:
            raise ObjectStoreUnavailable(
                f"racine de dépôt inutilisable : {racine} ({error})"
            ) from error

    if settings.object_store_provider == "s3":
        # Construire suffit : le constructeur refuse ce qui est incomplet, et
        # le refaire ici en dupliquerait la liste — qui divergerait au premier
        # champ ajouté.
        get_object_store()

        if settings.object_store_bucket_public == settings.object_store_bucket_prive:
            raise ObjectStoreUnavailable(
                "les deux compartiments sont le même : un compartiment public "
                "s'énumère, et les preuves y seraient listables."
            )
