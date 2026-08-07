"""L'obstacle, rendu à l'identique partout où il sort.

Il en existait deux copies, une dans `feed.py` et une dans `creator_tiers.py`.
Deux copies d'un même contrat divergent au premier champ ajouté — c'est
exactement ce qui a failli arriver en ajoutant `depuis`. Une seule définition,
importée aux deux endroits.
"""

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.services.eligibility import RaisonRefus


class ObstacleRead(BaseModel):
    """Une raison, de quoi la chiffrer, et de quoi la dater.

    `requis` et `constate` sont rendus pour que l'app puisse écrire « il te
    manque 1 400 abonnés » plutôt que « pas assez d'abonnés ». La phrase est
    traduite côté app, les nombres viennent d'ici.

    `depuis` porte la date qui explique l'obstacle quand il en a une : dernier
    relevé pour `metrics_stale`, échéance du jeton pour
    `account_token_invalid`, début du contrôle pour `account_under_review`.
    Elle est nulle sur les obstacles qui n'ont rien à dater. L'écart en
    secondes reste dans `ecart` pour qui veut calculer, mais il ne s'affiche
    pas : « il vous manque 431 200 secondes » ne veut rien dire, « relevé du
    3 août » si.
    """

    model_config = ConfigDict(from_attributes=True)

    raison: RaisonRefus
    requis: Decimal | int | None
    constate: Decimal | int | None
    ecart: Decimal | int | None
    depuis: datetime | None
