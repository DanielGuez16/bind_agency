"""Schémas de la contrepartie."""

import uuid
from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field

from app.core.config import get_settings
from app.models.enums import CaptureMethod, CollaborationStatus, ContentFormat, Platform


class PreuveSoumise(BaseModel):
    """Ce que le créateur envoie.

    `platform_published_at` est accepté mais n'est **jamais** la référence :
    c'est `submitted_at`, posé côté serveur, qui décide si l'échéance est
    tenue. Un horodatage fourni par le client n'est pas une preuve.
    """

    model_config = ConfigDict(extra="forbid")

    #: L'URL publique de la publication, quand elle en a une. Elle sert à
    #: tenter le niveau 2 ; elle n'est jamais conservée seule.
    source_url: str | None = Field(default=None, max_length=1000)
    #: Une capture d'écran déjà téléversée, pour le niveau 3. Clé de stockage
    #: objet, jamais une URL.
    screenshot_key: str | None = Field(default=None, max_length=500)
    #: Ce que le créateur dit de sa soumission. **L'autre moitié du canal** :
    #: le commerce refusait avec un code, le créateur resoumettait sans un mot,
    #: et le dossier arrivait en arbitrage sans qu'aucune phrase n'ait été
    #: échangée. Facultatif — une soumission conforme n'a rien à expliquer.
    note: str | None = Field(default=None, max_length=500)


class PreuveRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    submitted_at: datetime
    #: Le niveau réellement employé. C'est lui qui permettra d'automatiser
    #: uniquement les cas de niveau 1.
    capture_method: CaptureMethod
    content_hash: str
    source_url: str | None
    platform_published_at: datetime | None
    #: Vraie quand les quatre conditions de `SPEC.md` sont réunies. Nulle sur
    #: une preuve de niveau 2 ou 3 : la question ne s'est pas posée, ce qui
    #: n'est pas la même chose qu'une vérification qui a échoué.
    verifiee: bool | None
    #: Les codes des conditions manquantes, quand il y en a. Fermés.
    raisons_de_non_verification: list[str]
    #: Ce que le créateur a écrit en soumettant. Lu par le commerce et par
    #: l'arbitre : c'est la moitié du canal qui vient d'en bas.
    note: str | None


class CollaborationRead(BaseModel):
    """Les critères sont ceux figés à la candidature, pas ceux d'aujourd'hui."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    booking_id: uuid.UUID
    tier_id: uuid.UUID
    required_format: ContentFormat
    required_mention: str | None
    required_geotag: bool
    #: L'échéance, en instant absolu. **Et pas un compte à rebours** : l'écran
    #: écrit « avant jeudi 21, 14:30 » plutôt qu'« sous 48 h », parce qu'un
    #: délai demande de compter depuis une date qu'on ne regarde plus. Un
    #: `secondes_avant_echeance` a existé ici et n'a jamais eu de lecteur.
    deadline_at: datetime
    status: CollaborationStatus
    attempts_count: int
    needs_human_review: bool
    approved_at: datetime | None
    #: Le code du dernier refus, quand il y en a eu un. `None` avant toute
    #: demande de nouvelle soumission.
    #:
    #: **Un code fermé de `MotifDeDecision`, jamais une phrase** : il se traduit
    #: à l'affichage, et c'est toute la raison pour laquelle le motif a cessé
    #: d'être du texte libre. Il est relu du journal d'audit, la même source que
    #: `LigneDeFile.dernier_motif` côté commerce — deux lecteurs, une vérité.
    #:
    #: Sans lui, l'écran créateur invitait à resoumettre sans dire ce qui
    #: manquait : le seul écran qui doit porter le reproche était le seul à ne
    #: pas l'avoir.
    dernier_motif: str | None
    #: Le plafond de tentatives, servi à côté du rang.
    #:
    #: L'écran veut écrire « tentative 2 sur 3 » et n'avait que le 2. Le 3 est
    #: en configuration — `collaboration_max_attempts` — précisément pour qu'il
    #: change sans redéploiement ; le recopier dans l'application le figerait au
    #: jour de la compilation, et le premier ajustement rendrait l'écran
    #: menteur sans que rien ne tombe.
    max_attempts: int
    #: Le salon, la prestation et le réseau. Trois noms qui vivent sur
    #: `booking`, `business`, `catalog_item` et `tier` ; la contrepartie ne les
    #: duplique pas, la lecture les joint.
    #:
    #: **Le nom du salon est celui qui manquait le plus** : c'est le mot que la
    #: créatrice recopie dans le lieu de sa publication, et `required_geotag`
    #: ne veut rien dire sans lui.
    business_name: str | None
    item_name: str | None
    platform: Platform | None
    proofs: list[PreuveRead]

    @classmethod
    def assembler(cls, ligne, preuves, *, dernier_motif=None, contexte=None) -> "CollaborationRead":
        """La même lecture pour le commerce et pour l'arbitre.

        Elle vit ici plutôt que dans un routeur : deux routeurs en ont besoin,
        et la recopier ferait qu'un champ ajouté n'apparaîtrait que d'un côté —
        celui qu'on aurait pensé à modifier.
        """
        return cls(
            id=ligne.id,
            booking_id=ligne.booking_id,
            tier_id=ligne.tier_id,
            required_format=ligne.required_format,
            required_mention=ligne.required_mention,
            required_geotag=ligne.required_geotag,
            deadline_at=ligne.deadline_at,
            status=ligne.status,
            attempts_count=ligne.attempts_count,
            needs_human_review=ligne.needs_human_review,
            approved_at=ligne.approved_at,
            dernier_motif=dernier_motif,
            max_attempts=get_settings().collaboration_max_attempts,
            business_name=contexte.business_name if contexte else None,
            item_name=contexte.item_name if contexte else None,
            platform=contexte.platform if contexte else None,
            proofs=[PreuveRead.model_validate(p) for p in preuves],
        )


class MotifDeDecision(StrEnum):
    """Pourquoi une soumission est refusée. **Un code, pas une phrase.**

    Le motif était du texte libre. Il traversait le journal d'audit tel quel et
    ressortait sur l'écran de l'arbitre dans la langue de celui qui l'avait
    écrit : « Le format n'est pas celui attendu » au milieu d'une interface en
    anglais. Une phrase ne se traduit pas à l'affichage ; un code, si.

    La liste est fermée des deux côtés — le commerce et l'arbitre choisissent
    dans la même, c'est le même vocabulaire. Accepter en plus une phrase libre
    rouvrirait exactement le trou : il suffirait d'un appelant pour que
    l'intraduisible revienne.
    """

    MENTION_MANQUANTE = "missing_mention"
    LIEU_MANQUANT = "missing_location"
    FORMAT_INATTENDU = "wrong_format"
    QUALITE_INSUFFISANTE = "low_quality"


class DecisionCommerce(BaseModel):
    """Approuver, ou redemander. Jamais « rejeter » : il n'existe pas de statut
    de litige, et un refus rouvre avec une nouvelle échéance."""

    model_config = ConfigDict(extra="forbid")

    approuve: bool
    #: Obligatoire quand on redemande : le créateur doit savoir quoi corriger.
    reason: MotifDeDecision | None = None
    #: Le texte libre attaché au motif. **Facultatif, jamais seul.**
    #:
    #: `SPEC.md` §4.2 interdisait le texte libre pour une raison qui tient
    #: toujours : une phrase ne se traduit pas, et elle ressort sur l'écran de
    #: l'arbitre dans la langue de qui l'a écrite. Le code reste donc
    #: obligatoire et porte le sens ; la note ajoute ce qu'un code ne peut pas
    #: dire, et n'existe pas sans lui.
    note: str | None = Field(default=None, max_length=500)


class IssueDArbitrage(StrEnum):
    """Le vocabulaire du commerce, plus une issue qui n'est qu'à l'arbitre.

    `approve` et `resubmit` disent exactement la même chose des deux côtés :
    l'arbitre ne dispose pas d'un second langage, il tranche dans le premier.
    `unfulfilled` clôt, et c'est la seule décision du produit qui ne se rouvre
    pas — raison pour laquelle elle n'appartient à personne d'autre.
    `close_no_fault` clôt aussi, et n'accuse pas : elle appartient à l'arbitre
    pour la même raison, plus une — c'est le produit qu'elle met en cause, et
    ce n'est pas au salon de faire ce constat.
    """

    APPROUVER = "approve"
    REDEMANDER = "resubmit"
    NON_HONOREE = "unfulfilled"
    #: Clore sans mettre le dossier au débit de personne.
    #:
    #: **La quatrième issue, et la seule qui n'accuse pas.** Trois refus pour le
    #: même motif ne disent pas qu'une créatrice est de mauvaise foi : ils
    #: disent que la demande n'a jamais été comprise. Trois motifs différents
    #: disent l'inverse, et `unfulfilled` les tranche.
    FERMER_SANS_FAUTE = "close_no_fault"


class DecisionAdministrateur(BaseModel):
    """L'arbitrage d'un dossier sorti de la boucle automatique.

    Le motif est obligatoire sur tout ce qui n'est pas une approbation, comme
    côté commerce : la note est lue par les deux parties.
    """

    model_config = ConfigDict(extra="forbid")

    issue: IssueDArbitrage
    reason: MotifDeDecision | None = None
    #: Le texte libre attaché au motif. **Facultatif, jamais seul.**
    #:
    #: `SPEC.md` §4.2 interdisait le texte libre pour une raison qui tient
    #: toujours : une phrase ne se traduit pas, et elle ressort sur l'écran de
    #: l'arbitre dans la langue de qui l'a écrite. Le code reste donc
    #: obligatoire et porte le sens ; la note ajoute ce qu'un code ne peut pas
    #: dire, et n'existe pas sans lui.
    note: str | None = Field(default=None, max_length=500)
