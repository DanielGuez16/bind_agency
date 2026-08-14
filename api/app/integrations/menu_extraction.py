"""Extraction d'une carte : interface, et son implémentation par modèle vision.

**Le reste du système ne connaît que cette interface, jamais un fournisseur.**
Même raisonnement que pour le géocodage, les plateformes sociales et l'envoi
d'emails : le jour où l'on change de modèle, un seul fichier bouge.

**Une extraction ne produit jamais d'item.** Elle remplit une charge que le
commerce validera. C'est une règle du dépôt, et elle tient ici aussi : ce module
rend des lignes candidates, il n'écrit rien.

**La durée n'est pas extraite, et ce n'est pas un manque.** Une carte de salon
affiche des prix, pas des durées de poste — et quand elle en affiche une, c'est
la durée annoncée au client, pas le temps que le commerce bloque. Les deux
diffèrent souvent d'un quart d'heure de remise en état. La demander à l'écran de
relecture est le seul moyen d'obtenir la bonne.

**Le modèle se trompe, et on le sait.** Chaque ligne porte une confiance, et
l'écran de relecture s'en sert pour ordonner ce qu'un humain doit regarder en
premier. Une extraction rendue sans confiance obligerait à tout relire avec la
même attention, ce qui revient à ne rien relire.

**La réflexion est coupée, explicitement.** Sur les modèles de la génération 5,
ne pas envoyer de champ `thinking` ne veut plus dire « sans réflexion » : c'est
la réflexion adaptative qui s'applique par défaut. Or `max_tokens` plafonne la
réflexion **et** la réponse ensemble : une carte longue pouvait dépenser son
budget à réfléchir et rendre un JSON coupé au milieu d'une ligne, que `_lire`
signalait comme « réponse illisible ». Le défaut se serait découvert debout dans
un salon, sur la carte la plus fournie de la tournée — celle qui a le plus à
gagner à être lue automatiquement.

Lire une carte est une transcription, pas un raisonnement : les jetons dépensés
à délibérer n'ajoutent rien et prennent la place du résultat. On coupe donc, et
on relève quand même le plafond — les deux, parce que couper protège du partage
et relever protège de la carte de soixante lignes. Le plafond est en
configuration : c'est un seuil, et aucun seuil ne vit dans le code.

**Une troncature se dit, elle ne se devine pas.** Si la réponse s'arrête sur
`max_tokens`, l'erreur le nomme au lieu de dire « illisible ». Les deux
appellent des gestes opposés — relever le plafond, ou reprendre la photo — et
les confondre, c'est reprendre la photo trois fois d'une carte qui était bien
cadrée.
"""

import json
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Protocol, runtime_checkable

import httpx

from app.core.config import ConfigurationError, get_settings


class ExtractionError(Exception):
    """L'extraction n'a pas abouti. Transitoire du point de vue de l'appelant."""


@dataclass(frozen=True, slots=True)
class LigneExtraite:
    """Une ligne candidate. Pas un item : personne ne l'a encore validée."""

    name: str
    price_cents: int
    description: str | None = None
    #: Entre zéro et un. Sert à ordonner la relecture, jamais à décider seul.
    confidence: Decimal = Decimal("0")
    #: Ce que le modèle a lu tel quel, pour qu'un humain puisse comparer.
    raw: dict = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class Extraction:
    lignes: tuple[LigneExtraite, ...]
    #: Devise lue sur la carte, quand elle y figure. Jamais utilisée pour
    #: écrire : la devise d'un commerce est déclarée à sa création et ne bouge
    #: plus. Rendue pour que la relecture signale une incohérence.
    currency: str | None = None


@runtime_checkable
class MenuExtractor(Protocol):
    async def extraire(self, contenu: bytes, *, mime_type: str) -> Extraction:
        """Lit une carte et rend des lignes candidates.

        Lève `ExtractionError` si la lecture échoue. Ne rend jamais une
        extraction vide en cas d'erreur : le vide veut dire « rien trouvé »,
        pas « ça n'a pas marché », et les confondre ferait valider une carte
        blanche.
        """
        ...


class ManualExtractor:
    """N'extrait rien. Le mode du développement, des tests et de la démo.

    Ce n'est pas un repli silencieux : c'est le mode déclaré par
    `MENU_EXTRACTION_PROVIDER`, et demander un modèle réel sans clé empêche de
    démarrer. Le commerce saisit sa carte à la main, ce qui reste le chemin de
    la phase 2 et fonctionne parfaitement.
    """

    async def extraire(self, contenu: bytes, *, mime_type: str) -> Extraction:
        return Extraction(lignes=())


ANTHROPIC = "https://api.anthropic.com/v1/messages"

#: Ce qu'on demande au modèle. Volontairement étroit : un nom, un prix, une
#: description. Lui demander la durée produirait une invention plausible, et une
#: durée inventée fausse tout le calcul de capacité sans que personne ne le voie.
INSTRUCTION = """Tu lis la carte d'un commerce. Rends un JSON strict :
{"currency": "USD" ou null, "lignes": [{"name": ..., "price_cents": entier,
"description": ... ou null, "confidence": nombre entre 0 et 1}]}

Règles : price_cents en centimes entiers, jamais de flottant. N'invente aucune
ligne absente de la carte. Ne devine aucune durée. Si un prix est illisible,
baisse la confiance plutôt que d'inventer un chiffre."""


class VisionExtractor:
    """Modèle vision d'Anthropic, derrière l'interface.

    Le choix du fournisseur ne remonte nulle part : ni le service, ni la route,
    ni l'écran ne savent lequel a lu la carte.
    """

    def __init__(self, client: httpx.AsyncClient) -> None:
        settings = get_settings()
        if settings.menu_extraction_api_key is None:
            raise ConfigurationError(
                "MENU_EXTRACTION_PROVIDER=vision exige MENU_EXTRACTION_API_KEY"
            )

        self._client = client
        self._cle = settings.menu_extraction_api_key.get_secret_value()
        self._modele = settings.menu_extraction_model
        self._plafond = settings.menu_extraction_max_tokens
        self._delai = httpx.Timeout(settings.menu_extraction_timeout_seconds)

    async def extraire(self, contenu: bytes, *, mime_type: str) -> Extraction:
        import base64

        try:
            reponse = await self._client.post(
                ANTHROPIC,
                headers={
                    "x-api-key": self._cle,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": self._modele,
                    "max_tokens": self._plafond,
                    # Explicite, et jamais omis : sur la génération 5, omettre
                    # ce champ active la réflexion adaptative, qui partagerait
                    # `max_tokens` avec la réponse. Voir l'en-tête du module.
                    "thinking": {"type": "disabled"},
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "image",
                                    "source": {
                                        "type": "base64",
                                        "media_type": mime_type,
                                        "data": base64.b64encode(contenu).decode(),
                                    },
                                },
                                {"type": "text", "text": INSTRUCTION},
                            ],
                        }
                    ],
                },
                timeout=self._delai,
            )
        except httpx.HTTPError as error:
            raise ExtractionError(f"modèle injoignable : {type(error).__name__}") from error

        if reponse.status_code >= 400:
            raise ExtractionError(f"le modèle a répondu {reponse.status_code}")

        return _lire(reponse.json())


def _lire(corps: object) -> Extraction:
    """Transforme la réponse en lignes candidates, ou lève.

    Toute réponse mal formée est une erreur, jamais une extraction vide : le
    vide veut dire « rien trouvé sur cette carte », et le confondre avec un
    échec ferait valider une carte blanche.
    """
    if not isinstance(corps, dict):
        raise ExtractionError("réponse inattendue")

    # **Avant de tenter de lire.** Une réponse coupée au plafond est du JSON
    # valide jusqu'à l'endroit où elle s'arrête, et invalide ensuite : sans ce
    # test elle se signale « illisible », ce qui fait reprendre la photo d'une
    # carte parfaitement cadrée. Le geste qu'elle appelle est de relever
    # `MENU_EXTRACTION_MAX_TOKENS`, et il faut le dire.
    if corps.get("stop_reason") == "max_tokens":
        raise ExtractionError(
            "réponse tronquée au plafond de jetons : relever MENU_EXTRACTION_MAX_TOKENS"
        )

    blocs = corps.get("content") or []
    texte = next((b.get("text") for b in blocs if isinstance(b, dict) and b.get("text")), None)
    if not texte:
        raise ExtractionError("réponse sans texte")

    try:
        charge = json.loads(texte)
    except ValueError as error:
        raise ExtractionError("réponse illisible") from error

    if not isinstance(charge, dict) or not isinstance(charge.get("lignes"), list):
        raise ExtractionError("charge sans lignes")

    return Extraction(
        lignes=tuple(_ligne(brut) for brut in charge["lignes"] if _exploitable(brut)),
        currency=(charge.get("currency") or None),
    )


def _exploitable(brut: object) -> bool:
    """Une ligne sans nom ou sans prix entier n'est pas exploitable.

    Elle est écartée plutôt que rendue avec des trous : une ligne à moitié lue
    coûte plus de temps à corriger qu'à ressaisir, et elle passe plus facilement
    la relecture qu'une absence.
    """
    return (
        isinstance(brut, dict)
        and isinstance(brut.get("name"), str)
        and brut["name"].strip() != ""
        and isinstance(brut.get("price_cents"), int)
        and brut["price_cents"] >= 0
    )


def _ligne(brut: dict) -> LigneExtraite:
    return LigneExtraite(
        name=brut["name"].strip(),
        price_cents=brut["price_cents"],
        description=(brut.get("description") or None),
        confidence=Decimal(str(brut.get("confidence") or 0)),
        raw=brut,
    )


def get_extractor(client: httpx.AsyncClient | None = None) -> MenuExtractor:
    """Le fournisseur déclaré en configuration. Pas de repli silencieux."""
    settings = get_settings()
    if settings.menu_extraction_provider != "vision":
        return ManualExtractor()

    if client is None:
        raise ConfigurationError("un client HTTP est requis pour l'extraction par modèle")
    return VisionExtractor(client)


def check_extraction_configuration() -> None:
    """Appelé au démarrage. Une clé manquante découverte au premier import
    laisserait un commerce croire que sa carte est en cours de lecture."""
    settings = get_settings()
    if settings.menu_extraction_provider == "vision" and settings.menu_extraction_api_key is None:
        raise ConfigurationError("MENU_EXTRACTION_PROVIDER=vision exige MENU_EXTRACTION_API_KEY")
