"""Envoi de notifications push, derrière une interface.

**Deux implémentations, comme partout ailleurs dans ce dossier.** `log` n'appelle
personne et trace ce qu'elle aurait envoyé : c'est elle qui tourne en
développement, en démonstration et dans les tests. `expo` parle au service
d'Expo. Le mode est en configuration, et il n'y a pas de repli silencieux — un
fournisseur mal configuré refuse de démarrer plutôt que d'avaler les envois.

**Ce que le fournisseur rend compte autant que ce qu'il envoie.** Un jeton de
terminal cesse de valoir sans nous prévenir : l'application est désinstallée,
les notifications sont coupées, le téléphone est réinitialisé. Expo le dit —
`DeviceNotRegistered` — et c'est la seule occasion qu'on ait de l'apprendre. Le
verdict est donc rendu **par envoi**, distinctement du succès et de l'échec
passager, pour que l'appelant sache lequel révoquer.

**Un échec n'est jamais silencieux et ne fait jamais échouer l'appelant.** La
décision qu'une notification annonce est déjà écrite ; un service de push en
panne ne doit pas la défaire. C'est la même règle que les emails, et elle est
tenue au même endroit — chez l'appelant, pas ici : ce module lève, l'appelant
décide de ce qu'il en fait.

**Aucun contenu sensible dans une notification.** Elle s'affiche sur un écran
verrouillé, à côté de quiconque regarde par-dessus l'épaule. Le titre et le
corps disent ce qui s'est passé et chez qui ; ils ne portent ni code de
retrait, ni adresse, ni montant.
"""

import logging
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol, runtime_checkable

import httpx

from app.core.config import ConfigurationError, get_settings

logger = logging.getLogger(__name__)

#: L'adresse du service d'Expo. Publique, sans clé pour les envois simples :
#: le jeton de terminal suffit à désigner le destinataire.
EXPO_ENDPOINT = "https://exp.host/--/api/v2/push/send"

#: Expo refuse les lots trop gros. Cent est la valeur qu'il documente.
LOT_MAXIMUM = 100


@dataclass(frozen=True, slots=True)
class Envoi:
    """Une notification, pour un terminal.

    `donnees` voyage avec la notification et sert à ouvrir le bon écran quand
    on la touche. Elle ne porte que des identifiants — jamais un contenu que
    l'app pourrait afficher sans le redemander au serveur.
    """

    token: str
    titre: str
    corps: str
    donnees: dict[str, str]


class Verdict(StrEnum):
    """Ce qu'il est advenu d'un envoi. Trois issues, trois conduites.

    `JETON_INVALIDE` est la seule qui demande d'écrire en base : le terminal
    n'existe plus, et réessayer ne le fera pas revenir. Les deux autres se
    distinguent parce qu'un échec passager se retente et qu'un succès non.
    """

    ENVOYE = "envoye"
    #: Le terminal n'est plus enregistré. À révoquer, pas à retenter.
    JETON_INVALIDE = "jeton_invalide"
    #: Panne passagère du service, ou refus qu'on ne sait pas lire.
    ECHEC = "echec"


@runtime_checkable
class PushSender(Protocol):
    async def envoyer(self, envois: list[Envoi]) -> list[Verdict]:
        """Rend un verdict **par envoi**, dans l'ordre reçu.

        L'ordre est le contrat : l'appelant apparie les verdicts à ses jetons
        par position. Rendre un dictionnaire par jeton aurait été plus sûr et
        plus verbeux ; c'est un compromis assumé, et le test l'éprouve.
        """
        ...


class LogPushSender:
    """N'appelle personne, trace ce qu'elle aurait envoyé.

    En service tant qu'aucun compte Expo n'existe — c'est-à-dire aujourd'hui.
    Tout ce qui est en amont d'elle est vrai : les préférences, les jetons, la
    révocation, le choix des destinataires. Seul le dernier saut est simulé.
    """

    async def envoyer(self, envois: list[Envoi]) -> list[Verdict]:
        for envoi in envois:
            logger.info(
                "notification simulée",
                extra={"titre": envoi.titre, "donnees": envoi.donnees},
            )
        return [Verdict.ENVOYE for _ in envois]


class ExpoPushSender:
    """Parle au service d'Expo.

    **Non vérifiée de bout en bout.** Expo exige un identifiant de projet EAS et
    un build de développement — Expo Go ne reçoit plus de notifications
    distantes depuis le SDK 53. Le code est écrit d'après le contrat publié ;
    personne n'a encore vu une notification arriver sur un téléphone. C'est le
    même statut que le scanner caméra, et `TASKS.md` le dit.
    """

    def __init__(self, client: httpx.AsyncClient) -> None:
        self._client = client

    async def envoyer(self, envois: list[Envoi]) -> list[Verdict]:
        verdicts: list[Verdict] = []
        for debut in range(0, len(envois), LOT_MAXIMUM):
            lot = envois[debut : debut + LOT_MAXIMUM]
            verdicts.extend(await self._envoyer_un_lot(lot))
        return verdicts

    async def _envoyer_un_lot(self, lot: list[Envoi]) -> list[Verdict]:
        charge = [
            {
                "to": envoi.token,
                "title": envoi.titre,
                "body": envoi.corps,
                "data": envoi.donnees,
                # Le son par défaut : une notification muette passe inaperçue,
                # et c'est l'urgence qui justifie ce chantier.
                "sound": "default",
            }
            for envoi in lot
        ]

        try:
            reponse = await self._client.post(
                EXPO_ENDPOINT,
                json=charge,
                timeout=get_settings().push_timeout_seconds,
            )
            reponse.raise_for_status()
            recus = reponse.json().get("data", [])
        except (httpx.HTTPError, ValueError):
            # **Tout le lot échoue, et c'est voulu.** On ne sait pas lesquels
            # sont partis ; les compter comme envoyés en perdrait, les compter
            # comme invalides révoquerait des terminaux parfaitement valides.
            logger.warning("lot de notifications non parti", extra={"taille": len(lot)})
            return [Verdict.ECHEC for _ in lot]

        return [_lire_le_recu(recu) for recu in _aligner(recus, len(lot))]


def _aligner(recus: list, attendu: int) -> list:
    """Complète ou tronque pour que les verdicts s'apparient aux envois.

    Le contrat d'Expo est « un reçu par envoi, dans l'ordre ». S'il ne le tient
    pas, une liste plus courte décalerait tous les verdicts suivants — et
    révoquerait le jeton de quelqu'un d'autre.
    """
    if len(recus) == attendu:
        return recus
    logger.warning("reçus désalignés", extra={"recus": len(recus), "attendu": attendu})
    return (recus + [None] * attendu)[:attendu]


def _lire_le_recu(recu: object) -> Verdict:
    """Traduit un reçu Expo en verdict.

    `DeviceNotRegistered` est le seul détail qu'on lit dans l'erreur : c'est
    lui qui distingue « ce terminal n'existe plus » de « le service a eu un
    hoquet ». Les autres codes changent avec le temps, et les interpréter
    reviendrait à suivre une documentation qui n'est pas la nôtre.
    """
    if not isinstance(recu, dict):
        return Verdict.ECHEC
    if recu.get("status") == "ok":
        return Verdict.ENVOYE
    details = recu.get("details")
    if isinstance(details, dict) and details.get("error") == "DeviceNotRegistered":
        return Verdict.JETON_INVALIDE
    return Verdict.ECHEC


def get_push_sender(client: httpx.AsyncClient | None = None) -> PushSender:
    """Le fournisseur déclaré en configuration. Pas de repli silencieux."""
    settings = get_settings()
    if settings.push_provider != "expo":
        return LogPushSender()

    if client is None:
        raise ConfigurationError("un client HTTP est requis pour PUSH_PROVIDER=expo")
    return ExpoPushSender(client)


def check_push_configuration() -> None:
    """Appelée au démarrage.

    Découvrir qu'un mode inconnu a été écrit dans la configuration au moment du
    premier envoi ferait perdre la notification **et** son événement.
    """
    settings = get_settings()
    if settings.push_provider not in ("log", "expo"):
        raise ConfigurationError(f"PUSH_PROVIDER inconnu : {settings.push_provider}")
