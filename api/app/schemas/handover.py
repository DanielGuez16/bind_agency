"""Schémas de la fiche préparée et de sa prise en main."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.enums import BusinessStatus, HandoverChannel
from app.services.handover import EtatDeLaTournee, Locale


class JetonACreer(BaseModel):
    """Par où le lien part, et à qui.

    `extra="forbid"` : un champ inconnu est refusé plutôt qu'ignoré. Un
    destinataire mal nommé et silencieusement ignoré enverrait la fondatrice
    attendre une réponse à un courriel jamais parti.
    """

    model_config = ConfigDict(extra="forbid")

    channel: HandoverChannel
    #: L'adresse du gérant, pour le canal `email`. Le QR n'en a pas : la
    #: personne qui scanne est celle qui est devant la tablette.
    destination: EmailStr | None = None


class LienRemisRead(BaseModel):
    """**Rendu une seule fois.** La base n'en garde que l'empreinte.

    Le lien figure ici et nulle part ailleurs : le relire plus tard est
    impossible par construction, et c'est ce qui fait qu'un lien volé ne se
    vole qu'au moment où il est émis.
    """

    model_config = ConfigDict(from_attributes=True)

    business_id: uuid.UUID
    url: str
    expires_at: datetime
    channel: HandoverChannel


class ApercuDeLaFiche(BaseModel):
    """Ce que le salon voit avant de s'engager.

    **Tout ce qui a été préparé en son nom, et rien de plus.** Aucun
    identifiant de la fondatrice, aucun autre salon : ce document se lit sans
    être connecté, sur la seule possession du lien.
    """

    business_name: str
    address: str | None
    phone: str | None
    #: Combien de prestations ont été relevées de la carte photographiée, et
    #: combien de plages d'ouverture ont été saisies. Des nombres, pas des
    #: listes : c'est ce qui permet au gérant de reconnaître son salon sans que
    #: le lien devienne une lecture complète de sa fiche.
    prestations_preparees: int
    plages_preparees: int
    #: La version des conditions qu'il doit accepter, et qui doit revenir
    #: telle quelle : un lien ouvert la semaine dernière montre les conditions
    #: de la semaine dernière.
    terms_version: str


class PriseEnMain(BaseModel):
    """Le compte que le salon crée, et son acceptation."""

    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: str = Field(min_length=8, max_length=200)
    locale: Locale = Locale.EN
    #: La version acceptée, telle que l'écran l'a montrée. Comparée à celle en
    #: vigueur : un booléen ne dirait pas *quoi* a été accepté.
    terms_version: str = Field(min_length=1, max_length=50)


class RattachementDeCompte(BaseModel):
    """Un compte qui existe déjà assume la fiche. Le cas du deuxième salon."""

    model_config = ConfigDict(extra="forbid")

    terms_version: str = Field(min_length=1, max_length=50)


class LigneDeSuiviRead(BaseModel):
    """Une fiche préparée et où elle en est.

    Les fiches assumées restent dans la liste : sans elles, on ne saurait
    jamais combien de visites ont abouti.
    """

    model_config = ConfigDict(from_attributes=True)

    business_id: uuid.UUID
    name: str
    status: BusinessStatus
    address: str | None
    prepared_at: datetime
    issued_at: datetime | None
    expires_at: datetime | None
    used_at: datetime | None
    revoked_at: datetime | None
    #: Par où le lien est parvenu : le QR de la tablette — le décideur était
    #: là — ou un envoi, quand il ne l'était pas. **C'est ce qui départage les
    #: deux méthodes de démarchage**, et le taux d'activation par voie dit si un
    #: second passage rapporte plus qu'une relance.
    channel: HandoverChannel | None
    #: Première ouverture du lien. Nulle : personne ne l'a jamais vu.
    opened_at: datetime | None
    #: Dernière prise en main tentée et refusée.
    blocked_at: datetime | None
    #: Qui a préparé la fiche, par son adresse.
    #:
    #: **Sans elle, la comparaison des deux méthodes ne tient qu'à une
    #: personne** : si toutes les fiches remises au comptoir viennent d'une
    #: tournée et toutes celles envoyées d'une autre, le taux d'activation par
    #: voie compare deux démarcheurs en croyant comparer deux méthodes.
    #:
    #: Relue du journal d'audit, donc présente pour **toutes** les fiches — y
    #: compris celles qui n'ont encore rien reçu, c'est-à-dire précisément
    #: celles dont on veut savoir de qui elles sont.
    #:
    #: Une adresse et non un nom : un compte d'équipe n'en a pas. Les noms
    #: vivent sur le profil créateur, et cet écran est interne.
    prepared_by: str | None
    #: Qui a remis le lien. Nulle tant que rien n'a été remis, et **distincte de
    #: la précédente** : préparer quarante fiches au bureau et en remettre vingt
    #: en tournée sont deux gestes.
    remis_par: str | None
    #: Où en est cette fiche, en un mot qui commande une conduite.
    #:
    #: **Trois états pour une fiche non activée, et non un seul.** Jamais
    #: ouverte → **revisiter**, personne n'a rien vu et une relance s'adresserait
    #: à un lien que nul ne regarde. Ouverte et abandonnée → **relancer**,
    #: quelqu'un a regardé et s'est arrêté. Ouverte et bloquée sur l'engagement
    #: → ni l'un ni l'autre : c'est le produit qui coince, mot de passe ou
    #: conditions, et le démarchage n'y peut rien.
    #:
    #: Dérivé des dates, jamais stocké : une colonne d'état finirait par les
    #: contredire.
    etat: EtatDeLaTournee
