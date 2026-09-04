"""Profil créateur, en lecture et en écriture par son titulaire.

Quatre champs déclaratifs : prénom, nom, ville, bio. Rien d'autre — ni
coordonnées, ni photo.

**La ville est déclarée, jamais dérivée de `geo`.** Champ libre, sans liste
fermée : Miami compte assez de quartiers nommés pour qu'une liste soit fausse
dès le premier jour, et un créateur qui ne se retrouve pas dans la liste écrira
n'importe quoi plutôt que rien. `geo` n'est pas alimenté ici ; il servira au fil
de la phase 5 et viendra du même contournement manuel que pour les commerces
tant que le géocodage réel n'existe pas.

**Une chaîne vide n'est pas une valeur.** Elle est ramenée à `NULL`, sinon un
prénom à `""` serait « renseigné » pour la base et vide pour tout le monde —
et le signal du nom, dans la vérification de cohérence, se croirait jugeable
alors qu'il n'aurait rien à comparer.

**Ce qui n'est pas envoyé n'est pas touché.** Une mise à jour partielle ne doit
pas effacer par omission. Envoyer explicitement `null` efface, en revanche :
retirer sa bio est un geste légitime, et l'interdire obligerait à écrire un
espace.
"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CreatorProfile

#: Les champs que le titulaire peut écrire. Sert aussi de garde-fou : tout
#: autre nom présent dans une charge utile serait ignoré silencieusement, ce que
#: le schéma Pydantic interdit en amont.
CHAMPS_MODIFIABLES = ("first_name", "last_name", "city", "bio", "interests")


class CreatorProfileError(Exception):
    """Base des refus du profil."""


class CreatorProfileNotFound(CreatorProfileError):
    """Aucun profil pour cet utilisateur.

    Ne devrait pas arriver : `register` crée la ligne pour tout créateur. Si
    cela se produit, c'est que quelque chose a contourné l'inscription, et le
    dire vaut mieux que fabriquer une ligne à la volée pour masquer le trou.
    """


class ProfileAnonymized(CreatorProfileError):
    """Un profil anonymisé ne se réécrit pas."""


async def get_profile(session: AsyncSession, user_id: uuid.UUID) -> CreatorProfile:
    profil = await session.get(CreatorProfile, user_id)
    if profil is None:
        raise CreatorProfileNotFound(str(user_id))
    return profil


async def update_profile(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    modifications: dict[str, str | list[str] | None],
) -> CreatorProfile:
    """Écrit les champs fournis, laisse les autres.

    Il n'y a pas de contrôle de propriétaire ici, et ce n'est pas un oubli :
    l'identifiant vient du jeton, jamais de l'URL. Il n'existe donc aucune forme
    de requête permettant de viser le profil d'un autre — la protection est dans
    la forme de l'API, pas dans une vérification qu'on pourrait oublier.
    """
    profil = await get_profile(session, user_id)

    if profil.anonymized_at is not None:
        # Une transition irréversible. Le refus est doublé d'un trigger, parce
        # qu'un service n'est pas le seul chemin d'écriture possible.
        raise ProfileAnonymized(str(user_id))

    for champ, valeur in modifications.items():
        if champ in CHAMPS_MODIFIABLES:
            setattr(profil, champ, valeur)

    await session.flush()
    # `is_new_creator` est calculée par la base : après l'écriture elle est
    # expirée, et la lire au moment de sérialiser la réponse tenterait une
    # entrée-sortie là où le contexte asynchrone ne le permet plus.
    await session.refresh(profil)
    return profil
