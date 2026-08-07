"""Dépôt d'objets, derrière une interface.

Trois implémentations, une seule interface. Le service d'archivage ne sait pas
laquelle il tient, et aucune branche conditionnelle sur le mode : le choix est
une ligne de configuration, vérifiée au démarrage.

**`memory`** garde en mémoire du processus. Le mode des tests : rien à nettoyer,
rien à monter, et deux tests ne se marchent pas dessus.

**`local`** écrit sur le disque. Le mode du développement et de la démo — une
preuve archivée reste consultable après redémarrage, ce qui est exactement la
propriété qui manquait quand `deposer` ne faisait que calculer une clé.

**`s3`** parle à un fournisseur compatible S3. Il n'est pas branché : sans
identifiants ni entité, l'écrire reviendrait à écrire du code que personne ne
peut exécuter. La classe existe pour que la forme du contrat soit visible, et
elle refuse de démarrer plutôt que de faire semblant.

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


class S3ObjectStore:
    """Compatible S3. **Non branché.**

    La classe existe pour que la forme du contrat se voie, et pour que le jour
    où les identifiants arrivent, ce soit un fichier à compléter et non une
    architecture à inventer. Elle lève au lieu de retomber en silence sur le
    disque : un dépôt qui croit écrire chez un fournisseur et écrit ailleurs est
    pire qu'un dépôt qui refuse.
    """

    def __init__(self, bucket: str | None) -> None:
        self._bucket = bucket

    async def deposer(self, contenu: bytes, *, prefixe: str) -> str:
        raise ObjectStoreUnavailable(
            "le dépôt S3 n'est pas branché : ni client, ni identifiants. Voir DECISIONS.md."
        )

    async def lire(self, cle: str) -> bytes | None:
        raise ObjectStoreUnavailable("le dépôt S3 n'est pas branché.")


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
    return S3ObjectStore(settings.object_store_bucket)


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

    if settings.object_store_provider == "s3" and not settings.object_store_bucket:
        raise ObjectStoreUnavailable(
            "OBJECT_STORE_PROVIDER=s3 sans OBJECT_STORE_BUCKET : le dépôt ne sait pas où écrire."
        )
