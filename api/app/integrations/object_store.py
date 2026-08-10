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


def _statut_http(error: Exception) -> int | None:
    """Le statut HTTP d'une erreur `botocore`, ou `None` si elle n'en porte pas.

    Il est présent même quand le code et le message sont vides, et c'est la
    seule chose sur laquelle on peut décider. Le chercher dans le texte de
    l'exception marchait tant que le fournisseur rendait du XML S3 conforme.
    """
    reponse = getattr(error, "response", None) or {}
    return reponse.get("ResponseMetadata", {}).get("HTTPStatusCode")


def _details_s3(error: Exception, *, operation: str, compartiment: str, cle: str) -> str:
    """Ce que le serveur a répondu, en une ligne lisible.

    `ClientError` s'affiche « An error occurred () when calling PutObject » quand
    le corps de la réponse n'est pas le XML attendu — ce que renvoient plusieurs
    fournisseurs compatibles S3 sur leurs propres refus. Le message est alors
    vide, sans code ni raison, et on a perdu deux fois du temps sur le
    compartiment privé faute de savoir ce qui était réellement arrivé.

    D'où l'extraction à la main : le **statut HTTP** est toujours là même quand
    le code ne l'est pas, et c'est lui qui distingue un droit refusé d'un
    compartiment absent ou d'une charge rejetée. Le compartiment visé et la clé
    en font partie : « refusé » sans dire *où* laisse chercher du mauvais côté
    de la frontière public / privé.
    """
    reponse = getattr(error, "response", None) or {}
    meta = reponse.get("ResponseMetadata", {})
    faute = reponse.get("Error", {})

    morceaux = [
        f"{operation} sur {compartiment}/{cle}",
        f"http={meta.get('HTTPStatusCode') or '?'}",
        f"code={faute.get('Code') or type(error).__name__}",
    ]
    if message := (faute.get("Message") or str(error)):
        morceaux.append(f"message={message}")
    if demande := meta.get("RequestId"):
        morceaux.append(f"requête={demande}")
    return ", ".join(morceaux)


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
        compartiment = self.compartiment(prefixe)
        try:
            async with self._client() as s3:
                await s3.put_object(Bucket=compartiment, Key=cle, Body=contenu)
        except Exception as error:
            # Enveloppé : l'appelant traite un dépôt manqué, il n'a pas à
            # connaître les exceptions de `botocore`. Mais il emporte ce que le
            # serveur a dit, sans quoi « refusé » n'oriente vers rien.
            raise ObjectStoreError(
                "dépôt S3 refusé : "
                + _details_s3(error, operation="PutObject", compartiment=compartiment, cle=cle)
                + f", {len(contenu)} octets"
            ) from error
        return cle

    async def lire(self, cle: str) -> bytes | None:
        try:
            async with self._client() as s3:
                reponse = await s3.get_object(Bucket=self.compartiment(cle), Key=cle)
                return await reponse["Body"].read()
        except Exception as error:
            # Une absence n'est pas une panne, et les deux se distinguent mal
            # dans `botocore` : `NoSuchKey` porte un nom, le reste non.
            #
            # **Le statut, jamais le texte.** La version précédente cherchait
            # « 404 » dans le message. Chez un fournisseur qui répond un corps
            # non conforme, ce message est vide — « An error occurred () » — et
            # un objet simplement absent remontait comme une panne : la route
            # de média rendait 503 là où elle devait rendre 404, et l'app
            # affichait une erreur au lieu de son repli d'image.
            if type(error).__name__ == "NoSuchKey" or _statut_http(error) == 404:
                return None
            raise ObjectStoreError(
                "lecture S3 refusée : "
                + _details_s3(
                    error, operation="GetObject", compartiment=self.compartiment(cle), cle=cle
                )
            ) from error

    async def supprimer(self, cle: str) -> None:
        """Retire un objet. N'existe que pour la sonde de déploiement.

        Le produit ne supprime jamais : une preuve archivée est une pièce, et
        une photo est nommée par son empreinte, donc jamais réécrite. La sonde,
        elle, dépose une charge de plusieurs mégaoctets pour éprouver le plafond
        du compartiment — la laisser derrière ferait grossir le dépôt d'autant à
        chaque déploiement.
        """
        async with self._client() as s3:
            await s3.delete_object(Bucket=self.compartiment(cle), Key=cle)

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

        await _verifier_le_plafond(depot, prefixe=prefixe, compartiment=compartiment)


async def _verifier_le_plafond(depot, *, prefixe: str, compartiment: str) -> None:
    """Le compartiment accepte-t-il la **plus grosse** chose qu'on y mettra.

    Un témoin de vingt octets ne prouve que la joignabilité. Il passe sur un
    compartiment dont la limite de taille par fichier est inférieure à ce que le
    produit dépose, et l'échec arrive plus tard — sur une vraie preuve, envoyée
    par un vrai créateur, qu'on ne peut pas lui redemander. C'est exactement ce
    qui s'est produit : « deux compartiments joignables », puis un refus au
    premier archivage.

    Le refus lui-même n'aidait pas. Supabase répond **413** avec un corps que
    `botocore` ne sait pas lire comme une erreur S3 : le code et le message
    ressortent vides, et l'exception affiche « An error occurred () ». D'où la
    traduction ici, où le statut suffit à nommer la cause.

    La charge est retirée aussitôt : la garder ferait grossir le dépôt de quinze
    mégaoctets à chaque déploiement.
    """
    plafond = get_settings().proof_fetch_max_bytes
    charge = b"\0" * plafond
    # Un préfixe à part, sous la même racine donc dans le même compartiment :
    # la charge d'épreuve ne se confond pas avec le témoin d'aller-retour, qui
    # lui reste en place.
    gabarit = f"{prefixe}-gabarit"

    try:
        cle = await depot.deposer(charge, prefixe=gabarit)
    except ObjectStoreError as error:
        if "http=413" in str(error):
            raise ObjectStoreUnavailable(
                f"le compartiment {compartiment} refuse une charge de "
                f"{plafond // 1024 // 1024} Mo (413) : sa limite de taille par "
                "fichier est inférieure à ce que le produit dépose. Relever "
                "« File size limit » sur le compartiment, ou abaisser "
                "PROOF_FETCH_MAX_BYTES — mais alors le produit refusera des "
                "preuves qu'il accepte aujourd'hui"
            ) from error
        raise ObjectStoreUnavailable(
            f"le compartiment {compartiment} refuse une charge de "
            f"{plafond // 1024 // 1024} Mo : {error}"
        ) from error

    await depot.supprimer(cle)


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
