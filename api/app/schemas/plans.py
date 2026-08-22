"""Schémas des plans d'abonnement.

Le seul schéma du produit qui porte des montants, servi au seul rôle
administrateur.
"""

import uuid

from pydantic import BaseModel, ConfigDict

from app.models.enums import BillingInterval, BusinessCategory


class AbonnesParCategorieRead(BaseModel):
    """Qui a souscrit à ce plan, par catégorie de commerce.

    **À ne pas confondre avec `PlanAdministrateurRead.category`**, qui dit à
    quelle catégorie le plan s'adresse. Celle-ci dit qui a souscrit, et l'écart
    entre les deux est l'argument chiffré de la tarification par catégorie.
    """

    model_config = ConfigDict(from_attributes=True)

    categorie: BusinessCategory
    #: Tous statuts confondus : une catégorie qui a souscrit puis est partie a
    #: quelque chose à dire sur le prix.
    abonnes: int
    abonnes_actifs: int


class PlanAdministrateurRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    plan_id: uuid.UUID
    name: str
    category: BusinessCategory
    price_cents: int
    currency: str
    billing_interval: BillingInterval
    features: dict
    is_active: bool
    subscriptions_count: int
    active_subscriptions_count: int
    #: Ramené au mois par le service, pas par l'écran : un plan annuel et un
    #: plan mensuel n'ont pas la même unité, et la conversion est une règle de
    #: facturation, pas une décision de mise en page.
    mrr_cents: int

    #: La médiane des abonnements **terminés**, en jours. Nulle tant qu'aucun
    #: n'est fini — jamais zéro, qui se lirait « ils partent tout de suite ».
    #:
    #: **Terminés seulement, et la question a été tranchée en ne la tranchant
    #: pas.** Mélanger les abonnements finis et ceux qui courent rendrait un
    #: nombre dont personne ne peut dire ce qu'il mesure : une durée terminée
    #: est un fait, une durée courue est un minimum. Les deux sont donc servies
    #: séparément, chacune avec son effectif, et l'écran dit laquelle il
    #: affiche.
    #:
    #: Le biais qui reste est vers le bas — on ne mesure que ceux qui sont
    #: partis. `duree_mediane_en_cours_jours` le rend visible.
    duree_mediane_terminee_jours: int | None
    #: Sur combien d'abonnements elle est calculée. **Sans lui, « 7 mois » se
    #: lit comme un fait quand il sort de trois départs.**
    abonnements_termines: int
    #: La médiane des durées courues des abonnements vivants, en jours. Un
    #: minimum, jamais une durée de vie.
    duree_mediane_en_cours_jours: int | None
    abonnements_en_cours: int
    #: Vide quand personne n'a souscrit : une liste de zéros par catégorie ne se
    #: lit pas, et ferait croire à un échantillon là où il n'y a rien.
    abonnes_par_categorie: list[AbonnesParCategorieRead]
