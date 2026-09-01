"""Voir une preuve, sans jamais la rendre publique.

**Le commerce doit regarder ce qu'on lui demande d'approuver.** Il voyait le
pseudonyme, la prestation et quatre motifs de refus, et rien de ce qui avait été
publié : on lui demandait de trancher sur un contenu qu'il ne pouvait pas
ouvrir.

**Une preuve n'est jamais servie par un lien direct.** Ni vers le stockage — le
compartiment est privé, et une adresse de compartiment se devine — ni par une
route ouverte. L'API délivre un **droit de lecture signé et court**, portant
l'identité de la preuve et celle du demandeur, et c'est ce droit qui ouvre
l'objet.

**Pourquoi un jeton dans l'adresse plutôt qu'une adresse présignée du
fournisseur.** Une adresse présignée désigne le compartiment : elle en révèle le
nom et l'hôte, et elle ne marche que là où l'on signe — le développement local
écrit sur disque et ne signe rien. Un jeton émis par l'API marche dans les deux
cas, ne dit rien du stockage, et se révoque en changeant une clé.

**Qui a le droit.** Le commerce concerné, l'administration, et **la créatrice
qui l'a envoyée**.

**Ce dernier point renverse la règle d'avant, et la raison compte.** Il était
écrit ici que la créatrice n'avait pas à rouvrir l'objet archivé — « elle sait
ce qu'elle a publié ». C'était vrai d'une preuve prise isolément et faux du
produit : l'écran « mes publications » existe précisément pour lui montrer ce
qu'elle a publié, et il affichait la photo du **service au catalogue du salon**
faute d'avoir accès à l'image du post. Une liste de publications illustrée par
les photos d'autrui n'est pas une liste de publications.

**L'élargissement est borné à sa propre publication.** La créatrice lit la
preuve de la collaboration dont elle est l'auteure, jamais une autre : c'est la
réservation qui porte le créateur, et c'est elle qu'on interroge — pas un
identifiant fourni par l'appelant.
"""

import uuid
from datetime import timedelta

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import InvalidToken, TokenType, create_token, decode_token
from app.models import Booking, BusinessMember, Collaboration, Proof, User
from app.models.enums import UserRole


class ProofNotFound(Exception):
    """Preuve inconnue, ou hors de portée du demandeur.

    Une seule exception pour les deux : distinguer « elle n'existe pas » de
    « elle ne vous regarde pas » dirait à qui tâtonne quels identifiants
    existent.
    """


async def _a_le_droit(session: AsyncSession, *, proof: Proof, user: User) -> bool:
    if user.role is UserRole.ADMIN:
        return True

    if user.role is UserRole.CREATOR:
        # **Sa publication, et seulement la sienne.** Le créateur se lit sur la
        # réservation que porte la collaboration ; le comparer à l'appelant est
        # la seule chose qui distingue « ma preuve » de « une preuve ».
        creator_id = await session.scalar(
            sa.select(Booking.creator_id)
            .join(Collaboration, Collaboration.booking_id == Booking.id)
            .where(Collaboration.id == proof.collaboration_id)
        )
        return creator_id == user.id

    if user.role is not UserRole.BUSINESS_MEMBER:
        return False

    # Le commerce de la collaboration, et l'appartenance du demandeur : les deux
    # se lisent en base, jamais dans la requête. La collaboration ne porte pas
    # le commerce — elle porte la réservation, qui le porte.
    business_id = await session.scalar(
        sa.select(Booking.business_id)
        .join(Collaboration, Collaboration.booking_id == Booking.id)
        .where(Collaboration.id == proof.collaboration_id)
    )
    if business_id is None:
        return False

    return bool(
        await session.scalar(
            sa.select(BusinessMember.id).where(
                BusinessMember.business_id == business_id,
                BusinessMember.user_id == user.id,
            )
        )
    )


async def droit_de_lecture(
    session: AsyncSession, *, proof_id: uuid.UUID, user: User
) -> tuple[str, int]:
    """Un jeton de lecture pour cette preuve, et sa durée.

    Le droit est vérifié **ici**, à l'émission, et de nouveau à la lecture : le
    jeton pourrait survivre à la perte de l'appartenance qui l'a justifié, et
    quelques minutes suffisent à changer d'employeur sur le papier.
    """
    proof = await session.get(Proof, proof_id)
    if proof is None or not await _a_le_droit(session, proof=proof, user=user):
        raise ProofNotFound(str(proof_id))

    duree = get_settings().proof_read_ttl_seconds
    jeton = create_token(
        subject=user.id,
        token_type=TokenType.PROOF_READ,
        # L'identifiant de la preuve **dans le jeton** : il n'ouvre que celle-là,
        # et un jeton obtenu pour une preuve ne sert pas à en lire une autre.
        token_id=proof_id,
        lifetime=timedelta(seconds=duree),
    )
    return jeton, duree


async def preuve_lisible(session: AsyncSession, *, proof_id: uuid.UUID, jeton: str) -> Proof:
    """La preuve, si le jeton l'ouvre et si le droit tient encore."""
    try:
        claims = decode_token(jeton, expected_type=TokenType.PROOF_READ)
    except InvalidToken as error:
        raise ProofNotFound(str(proof_id)) from error

    # Le jeton vaut pour la preuve qu'il nomme, pas pour celle qu'on demande.
    # Sans cette comparaison, un jeton valide ouvrirait n'importe quel objet.
    if claims.token_id != proof_id:
        raise ProofNotFound(str(proof_id))

    proof = await session.get(Proof, proof_id)
    demandeur = await session.get(User, claims.subject)
    if proof is None or demandeur is None:
        raise ProofNotFound(str(proof_id))

    # Revérifié : l'appartenance a pu tomber depuis l'émission.
    if not await _a_le_droit(session, proof=proof, user=demandeur):
        raise ProofNotFound(str(proof_id))

    return proof


def cle_du_media(proof: Proof) -> str | None:
    """L'objet à montrer : le média capturé, sinon la capture d'écran.

    Dans cet ordre parce que le premier est ce que la plateforme a rendu et le
    second ce que la créatrice a envoyé — quand les deux existent, le premier
    fait foi.
    """
    return proof.media_key or proof.screenshot_key
