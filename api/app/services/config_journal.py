"""Enregistrer une modification de configuration, et la relire.

**Le manque que ce module comble.** Un seuil de palier se change par l'interface
d'administration, sans redéploiement — c'est la règle du produit, et c'est bien.
Mais rien ne gardait trace de qui l'avait changé, ni de ce qu'il valait avant.
Un créateur perd un palier qu'il avait ; six semaines plus tard, personne ne
peut dire si son audience a baissé ou si le seuil a monté.

**Écrit dans la transaction qui modifie.** Comme le journal d'audit : ou le
changement et sa trace existent tous deux, ou aucun.

**Seuls les champs qui changent réellement produisent une ligne.** Renvoyer la
même valeur n'est pas une modification, et une ligne par appel remplirait le
journal de bruit — après quoi personne ne le lirait plus.
"""

import uuid
from decimal import Decimal
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ConfigurationChange
from app.services.audit import Actor

#: Les entités dont ce journal sait parler. Nommées ici plutôt qu'écrites à la
#: main dans chaque appelant : deux orthographes du même mot rendraient une
#: moitié de l'histoire invisible à la lecture.
TIER = "tier"
SUBSCRIPTION_PLAN = "subscription_plan"
#: Les critères de publication d'une offre — la mention attendue, le lieu. Ce
#: sont des valeurs que le commerce change, pas des bascules d'état : l'offre a
#: déjà son journal d'audit pour l'ouverture et la fermeture, et mêler les deux
#: rendrait « a retiré l'offre » et « a corrigé le pseudonyme » illisibles l'un
#: à côté de l'autre.
TIER_OFFER = "tier_offer"


def lisible(valeur: Any) -> str | None:
    """La valeur telle qu'on l'écrit au journal.

    **Le texte, et pas le type d'origine.** Un journal qui retypera un jour ses
    valeurs se trompera le jour où la colonne change de type — et c'est
    précisément ce jour-là qu'on viendra le relire. `None` reste `None` : un
    seuil qui passe de « aucun » à soixante n'est pas le même geste qu'un seuil
    qui monte de cinquante à soixante.
    """
    if valeur is None:
        return None
    if isinstance(valeur, bool):
        # Avant `Decimal` et `int` : en Python, un booléen est un entier, et
        # `str(True)` doit donner « true » et non « True » pour se relire comme
        # le reste du produit.
        return "true" if valeur else "false"
    if isinstance(valeur, Decimal):
        return format(valeur.normalize(), "f")
    return str(valeur)


async def enregistrer(
    session: AsyncSession,
    *,
    entity_type: str,
    entity_id: uuid.UUID,
    champs: dict[str, tuple[Any, Any]],
    actor: Actor,
) -> tuple[ConfigurationChange, ...]:
    """Écrit une ligne par champ **réellement** modifié.

    `champs` associe le nom du champ au couple (avant, après). Les couples dont
    les deux membres se lisent pareil sont ignorés : renvoyer la même valeur
    n'est pas une modification.

    **Un acteur humain est exigé.** Le système ne change pas une configuration :
    s'il le faisait un jour, la trace dirait « personne », et une modification
    de seuil sans auteur est exactement ce que ce journal existe pour empêcher.
    """
    if actor.user_id is None:
        raise ValueError("une modification de configuration a toujours un auteur")

    lignes = []
    for champ, (avant, apres) in champs.items():
        ecrit_avant, ecrit_apres = lisible(avant), lisible(apres)
        if ecrit_avant == ecrit_apres:
            continue

        ligne = ConfigurationChange(
            entity_type=entity_type,
            entity_id=entity_id,
            field=champ,
            value_before=ecrit_avant,
            value_after=ecrit_apres,
            actor_user_id=actor.user_id,
        )
        session.add(ligne)
        lignes.append(ligne)

    if lignes:
        await session.flush()
    return tuple(lignes)


async def historique(
    session: AsyncSession, *, entity_id: uuid.UUID, limite: int = 200
) -> tuple[ConfigurationChange, ...]:
    """L'histoire d'un objet, la plus récente d'abord."""
    return tuple(
        await session.scalars(
            sa.select(ConfigurationChange)
            .where(ConfigurationChange.entity_id == entity_id)
            .order_by(ConfigurationChange.changed_at.desc())
            .limit(max(1, min(limite, 1000)))
        )
    )
