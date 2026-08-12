"""Soumission de preuve : archivage, empreinte, horodatage serveur.

**Trois niveaux de capture, par ordre de préférence** (`SPEC.md` §5.3) :

1. lecture du média sur le compte connecté, via l'API de la plateforme
2. récupération depuis l'URL publique fournie
3. capture d'écran envoyée par le créateur

Le niveau réellement employé est stocké dans `capture_method`. C'est lui qui
permettra plus tard **d'automatiser uniquement les cas de niveau 1** : une
lecture par l'API dit que le contenu était bien sur le compte connecté à cet
instant, une capture d'écran ne dit que ce qu'on a bien voulu montrer. Sans
cette trace, on ne pourrait pas distinguer les dossiers automatisables des
autres, et il faudrait tout regarder à la main pour toujours.

**Le fichier est archivé, jamais un simple lien.** Les stories disparaissent en
vingt-quatre heures, et une publication se supprime en trois gestes : un lien
conservé sans son contenu ne prouve rien le jour où le commerce conteste.

**L'horodatage fait foi côté serveur.** `platform_published_at` vient de la
plateforme et n'est qu'une information ; `submitted_at` est le nôtre et c'est
lui qui décide si l'échéance est tenue. Un horodatage fourni par le client
n'est jamais une preuve.
"""

import hashlib
import uuid
from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Collaboration, Proof
from app.models.enums import CaptureMethod, CollaborationStatus
from app.services import audit, verification
from app.services import collaboration as collaboration_service

#: L'ordre de préférence de `SPEC.md` §5.3, du plus fiable au moins fiable.
#: Déclaré ici plutôt que déduit de l'ordre de l'énumération : un membre ajouté
#: au mauvais endroit changerait silencieusement la hiérarchie de confiance.
ORDRE_DE_PREFERENCE = (CaptureMethod.API, CaptureMethod.URL_FETCH, CaptureMethod.UPLOAD)

#: Le seul niveau qu'on pourra automatiser : la plateforme atteste elle-même que
#: le contenu était sur le compte connecté.
NIVEAU_AUTOMATISABLE = CaptureMethod.API


class ProofError(Exception):
    """Base des refus de soumission."""


class CollaborationNotOpen(ProofError):
    """La contrepartie n'attend pas de preuve.

    Approuvée, non honorée, ou déjà soumise : dans les trois cas il n'y a rien
    à recevoir, et accepter quand même laisserait croire au créateur qu'il a
    répondu.
    """


class NothingArchived(ProofError):
    """Une preuve sans fichier archivé n'est pas une preuve.

    La base le refuse aussi. Le dire ici évite qu'une violation brute atteigne
    l'appelant avec un message qui parle de contraintes.
    """


@dataclass(frozen=True, slots=True)
class MediaCapture:
    """Ce qu'une capture rapporte, quel que soit son niveau."""

    capture_method: CaptureMethod
    contenu: bytes
    media_key: str | None = None
    screenshot_key: str | None = None
    source_url: str | None = None
    platform_published_at: object | None = None
    extra: dict | None = None


def empreinte(contenu: bytes) -> str:
    """SHA-256 du fichier archivé.

    Elle sert à deux choses : montrer que l'archive n'a pas bougé depuis la
    soumission, et reconnaître deux soumissions du même fichier — un créateur
    qui renvoie la même capture après un refus n'a rien corrigé.
    """
    return hashlib.sha256(contenu).hexdigest()


def rang_de_confiance(methode: CaptureMethod) -> int:
    """Position dans l'ordre de préférence. Zéro est le plus fiable."""
    return ORDRE_DE_PREFERENCE.index(methode)


async def soumettre(
    session: AsyncSession,
    *,
    collaboration: Collaboration,
    capture: MediaCapture,
    actor: audit.Actor,
    note: str | None = None,
    verdict: verification.Verdict | None = None,
) -> Proof:
    """Archive la preuve et fait passer la contrepartie en `submitted`.

    L'échéance n'est **pas** vérifiée ici. Une contrepartie dont le délai est
    écoulé est déjà passée en `unfulfilled` par le balayage, et la table des
    transitions refusera la soumission. Contrôler l'heure en plus donnerait deux
    sources à la même règle, et c'est la seconde qui finirait par diverger.
    """
    if collaboration.status not in (
        CollaborationStatus.PENDING,
        CollaborationStatus.RESUBMIT_REQUESTED,
    ):
        raise CollaborationNotOpen(collaboration.status.value)

    if capture.media_key is None and capture.screenshot_key is None:
        raise NothingArchived(str(collaboration.id))

    preuve = Proof(
        collaboration_id=collaboration.id,
        source_url=capture.source_url,
        capture_method=capture.capture_method,
        media_key=capture.media_key,
        screenshot_key=capture.screenshot_key,
        content_hash=empreinte(capture.contenu),
        platform_published_at=capture.platform_published_at,
        # **Les trois champs de la vérification, écrits même si le verdict est
        # négatif.** Ils disent ce que la plateforme a répondu ; les omettre
        # quand la publication ne correspond pas laisserait un dossier rejeté
        # sans ses pièces, impossible à rejuger.
        platform_media_id=(capture.extra or {}).get("platform_media_id"),
        platform_author_id=(capture.extra or {}).get("platform_author_id"),
        platform_media_type=(capture.extra or {}).get("platform_media_type"),
        note=note,
        # Le verdict rejoint ce que la plateforme a répondu : les deux
        # racontent la même soumission, et les séparer ferait lire l'un sans
        # l'autre.
        extra=(
            capture.extra
            if verdict is None
            else {
                **(capture.extra or {}),
                "verification": {"verifiee": verdict.verifiee, "raisons": list(verdict.raisons)},
            }
        ),
    )
    session.add(preuve)
    await session.flush()

    niveau = rang_de_confiance(capture.capture_method) + 1

    await collaboration_service.transitionner(
        session,
        collaboration=collaboration,
        vers=CollaborationStatus.SUBMITTED,
        actor=actor,
        reason=f"preuve archivée, capture de niveau {niveau}",
    )
    return preuve


async def preuves_de(session: AsyncSession, collaboration_id: uuid.UUID) -> list[Proof]:
    """Toutes les soumissions, dans l'ordre. La table est en ajout seul.

    Une nouvelle soumission n'écrase pas la précédente : l'historique d'un
    dossier refusé trois fois est exactement ce qu'un commerce contestera, et ce
    qui justifiera un `unfulfilled`.
    """
    return list(
        await session.scalars(
            sa.select(Proof)
            .where(Proof.collaboration_id == collaboration_id)
            .order_by(Proof.submitted_at)
        )
    )


async def deja_soumise(
    session: AsyncSession, *, collaboration_id: uuid.UUID, contenu: bytes
) -> bool:
    """Ce fichier a-t-il déjà été soumis pour cette contrepartie.

    Renvoyer la même capture après un refus n'est pas une correction. Le dire
    évite un troisième aller-retour qui n'apprendrait rien à personne.
    """
    return bool(
        await session.scalar(
            sa.select(Proof.id).where(
                Proof.collaboration_id == collaboration_id,
                Proof.content_hash == empreinte(contenu),
            )
        )
    )
