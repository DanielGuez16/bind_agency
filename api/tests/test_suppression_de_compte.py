"""Fermer son compte : demander, revenir, être refusé, puis disparaître.

Quatre règles, et chacune est éprouvée sur le cas où deux implémentations
plausibles **divergent** — jamais sur celui où elles diraient la même chose :

— **anonymiser, pas détruire.** Le décor vérifie qu'une réservation passée est
  toujours là et toujours rattachée après coup. Un test qui ne regarderait que
  le compte passerait aussi bien sur un `DELETE CASCADE` ;
— **différée de trente jours.** L'échéance est comparée au délai de
  configuration, et le compte est vérifié **encore actif** juste après la
  demande. Sans cette seconde assertion, une anonymisation immédiate passerait
  le premier test sans qu'on le voie ;
— **refusée tant qu'une contrepartie est en cours.** Éprouvée sur les quatre
  statuts en cours *et* sur les deux issues, sinon une garde qui refuserait
  tout le monde passerait le test de refus sans rien garantir ;
— **le commerce voit une créatrice partie.** Vérifié après anonymisation, sur
  la valeur du drapeau **et** sur la présence de la ligne : un historique vidé
  satisferait « aucun compte anonymisé visible » et raterait tout le sujet.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Booking, Collaboration, User
from app.models.enums import ActorKind, CollaborationStatus, UserRole, UserStatus
from app.services import account_deletion as service
from app.services import booking_history
from app.services import collaboration as collaboration_service
from app.services.audit import Actor
from tests.conftest import inscrire_verifie
from tests.test_collaboration import contrepartie
from tests.test_counterpart_queue import statut

PREFIX = get_settings().api_v1_prefix


async def _jetons(client: AsyncClient, email: str) -> dict[str, str]:
    from tests.test_redemption_caisse import MOT_DE_PASSE

    jetons = (
        await client.post(f"{PREFIX}/auth/login", json={"email": email, "password": MOT_DE_PASSE})
    ).json()
    return {"Authorization": f"Bearer {jetons['access_token']}"}


async def _clore(session: AsyncSession, ligne: Collaboration) -> None:
    """Amène la contrepartie à une issue, pour libérer la suppression."""
    await statut(session, ligne, CollaborationStatus.APPROVED)


# --------------------------------------------------------------------------
# le délai, et le retour
# --------------------------------------------------------------------------


async def test_la_demande_ouvre_trente_jours_sans_rien_effacer(
    client: AsyncClient, session: AsyncSession
) -> None:
    """L'échéance est posée, et le compte reste utilisable jusque-là.

    La seconde assertion est la vraie : sans elle, une anonymisation immédiate
    passerait la première sans qu'on le remarque.
    """
    ligne, s = await contrepartie(session)
    await _clore(session, ligne)
    await session.commit()

    reponse = await client.post(
        f"{PREFIX}/me/deletion", headers=await _jetons(client, s["createur"].email)
    )
    assert reponse.status_code == 202, reponse.text

    echeance = datetime.fromisoformat(reponse.json()["deletion_effective_at"])
    attendu = datetime.now(UTC) + timedelta(seconds=get_settings().account_deletion_delay_seconds)
    assert abs((echeance - attendu).total_seconds()) < 120

    # Toujours actif, toujours joignable : c'est ce qui rend le retour possible.
    await session.refresh(s["createur"])
    assert s["createur"].status is UserStatus.ACTIVE
    assert s["createur"].email is not None


async def test_le_retour_est_possible_pendant_le_delai(
    client: AsyncClient, session: AsyncSession
) -> None:
    ligne, s = await contrepartie(session)
    await _clore(session, ligne)
    await session.commit()
    entetes = await _jetons(client, s["createur"].email)

    await client.post(f"{PREFIX}/me/deletion", headers=entetes)
    retour = await client.delete(f"{PREFIX}/me/deletion", headers=entetes)

    assert retour.status_code == 200, retour.text
    assert retour.json()["deletion_effective_at"] is None

    # Et le compte redevient supprimable : le retour n'est pas un aller simple.
    assert (await client.post(f"{PREFIX}/me/deletion", headers=entetes)).status_code == 202


async def test_redemander_ne_repousse_pas_l_echeance(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Sans quoi il suffirait de rappuyer chaque semaine pour ne jamais partir."""
    ligne, s = await contrepartie(session)
    await _clore(session, ligne)
    await session.commit()
    entetes = await _jetons(client, s["createur"].email)

    premiere = (await client.post(f"{PREFIX}/me/deletion", headers=entetes)).json()
    seconde = await client.post(f"{PREFIX}/me/deletion", headers=entetes)

    assert seconde.status_code == 409
    assert seconde.json()["detail"] == "deletion_already_requested"

    await session.refresh(s["createur"])
    assert s["createur"].deletion_effective_at == datetime.fromisoformat(
        premiere["deletion_effective_at"]
    )


async def test_annuler_sans_demande_est_un_conflit(
    client: AsyncClient, session: AsyncSession
) -> None:
    _, s = await contrepartie(session)
    await session.commit()

    retour = await client.delete(
        f"{PREFIX}/me/deletion", headers=await _jetons(client, s["createur"].email)
    )
    assert retour.status_code == 409
    assert retour.json()["detail"] == "deletion_not_requested"


# --------------------------------------------------------------------------
# la contrepartie en cours
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "en_cours",
    [
        CollaborationStatus.PENDING,
        CollaborationStatus.SUBMITTED,
        CollaborationStatus.UNDER_REVIEW,
        CollaborationStatus.RESUBMIT_REQUESTED,
    ],
)
async def test_une_contrepartie_en_cours_bloque_le_depart(
    client: AsyncClient, session: AsyncSession, en_cours: CollaborationStatus
) -> None:
    """Les quatre statuts qui engagent encore un salon."""
    ligne, s = await contrepartie(session)
    await statut(session, ligne, en_cours)
    await session.commit()

    reponse = await client.post(
        f"{PREFIX}/me/deletion", headers=await _jetons(client, s["createur"].email)
    )
    assert reponse.status_code == 409
    assert reponse.json()["detail"] == "deletion_blocked_by_collaboration"


@pytest.mark.parametrize("issue", [CollaborationStatus.APPROVED, CollaborationStatus.UNFULFILLED])
async def test_les_deux_issues_liberent_le_depart(
    client: AsyncClient, session: AsyncSession, issue: CollaborationStatus
) -> None:
    """**Le sens inverse, et il compte autant.**

    Une garde qui refuserait tout le monde passerait les quatre tests
    ci-dessus sans rien garantir. `unfulfilled` libère comme `approved` : le
    salon sait à quoi s'en tenir, ce qui est tout ce qu'on lui doit.
    """
    ligne, s = await contrepartie(session)
    await statut(session, ligne, issue)
    await session.commit()

    reponse = await client.post(
        f"{PREFIX}/me/deletion", headers=await _jetons(client, s["createur"].email)
    )
    assert reponse.status_code == 202, reponse.text


# --------------------------------------------------------------------------
# l'application
# --------------------------------------------------------------------------


async def test_le_balayage_anonymise_les_echeances_passees(session: AsyncSession) -> None:
    ligne, s = await contrepartie(session)
    await _clore(session, ligne)
    createur = s["createur"]
    await service.demander(session, user=createur, actor=Actor.from_user(createur))
    # L'échéance est ramenée dans le passé : trente jours ne s'attendent pas.
    createur.deletion_effective_at = datetime.now(UTC) - timedelta(minutes=1)
    await session.flush()

    assert await service.appliquer_les_echeances(session) == 1

    await session.refresh(createur)
    assert createur.status is UserStatus.ANONYMIZED
    assert createur.email is None


async def test_le_balayage_laisse_en_attente_une_contrepartie_nee_entre_temps(
    session: AsyncSession,
) -> None:
    """Trente jours séparent la demande de l'effet. La garde se rejoue.

    Ne vérifier qu'à l'entrée laisserait disparaître quelqu'un qui doit une
    publication à un salon — exactement ce que la garde existe pour empêcher.
    """
    ligne, s = await contrepartie(session)
    await _clore(session, ligne)
    createur = s["createur"]
    await service.demander(session, user=createur, actor=Actor.from_user(createur))
    createur.deletion_effective_at = datetime.now(UTC) - timedelta(minutes=1)

    # La contrepartie se rouvre après la demande.
    await statut(session, ligne, CollaborationStatus.SUBMITTED)

    assert await service.appliquer_les_echeances(session) == 0

    await session.refresh(createur)
    assert createur.status is UserStatus.ACTIVE
    # La demande tient : rien ne l'annule à la place de la personne.
    assert createur.deletion_effective_at is not None


async def test_l_echeance_a_venir_n_est_pas_balayee(session: AsyncSession) -> None:
    """Le vide est ici le bon résultat, et on le distingue du symptôme."""
    ligne, s = await contrepartie(session)
    await _clore(session, ligne)
    createur = s["createur"]
    await service.demander(session, user=createur, actor=Actor.from_user(createur))
    await session.flush()

    assert await service.appliquer_les_echeances(session) == 0
    await session.refresh(createur)
    assert createur.status is UserStatus.ACTIVE


async def test_l_anonymisation_ne_detruit_pas_l_historique(session: AsyncSession) -> None:
    """La réservation reste, et reste rattachée.

    Un test qui ne regarderait que le compte passerait aussi sur un
    `DELETE CASCADE` qui aurait emporté le salon avec.
    """
    ligne, s = await contrepartie(session)
    await _clore(session, ligne)
    createur = s["createur"]
    booking_id = s["booking"].id

    await service.demander(session, user=createur, actor=Actor.from_user(createur))
    createur.deletion_effective_at = datetime.now(UTC) - timedelta(minutes=1)
    await service.appliquer_les_echeances(session)

    reste = await session.get(Booking, booking_id)
    assert reste is not None
    assert reste.creator_id == createur.id
    assert await session.get(Collaboration, ligne.id) is not None


async def test_le_systeme_ne_supprime_personne_de_lui_meme(session: AsyncSession) -> None:
    """Une suppression a toujours un demandeur nommé."""
    ligne, s = await contrepartie(session)
    await _clore(session, ligne)

    with pytest.raises(ValueError):
        await service.demander(
            session, user=s["createur"], actor=Actor(kind=ActorKind.SYSTEM, user_id=None)
        )

    # La session reste saine : on s'en sert encore après le refus.
    assert await session.scalar(sa.select(sa.func.count()).select_from(User)) > 0


# --------------------------------------------------------------------------
# ce que le commerce voit
# --------------------------------------------------------------------------


async def test_le_commerce_voit_une_creatrice_partie_et_non_une_ligne_vide(
    session: AsyncSession,
) -> None:
    """La ligne reste, et elle dit ce qui s'est passé.

    Deux assertions et non une : « aucun compte anonymisé visible » serait
    satisfait par un historique vide, qui raterait tout le sujet.
    """
    ligne, s = await contrepartie(session)
    await _clore(session, ligne)
    createur = s["createur"]

    avant = await collaboration_service.lister_pour_le_commerce(
        session, business_id=s["business"].id
    )
    assert next(f for f in avant if f.collaboration_id == ligne.id).creator_partie is False

    await service.demander(session, user=createur, actor=Actor.from_user(createur))
    createur.deletion_effective_at = datetime.now(UTC) - timedelta(minutes=1)
    await service.appliquer_les_echeances(session)

    apres = await collaboration_service.lister_pour_le_commerce(
        session, business_id=s["business"].id
    )
    ligne_apres = next(f for f in apres if f.collaboration_id == ligne.id)
    assert ligne_apres.creator_partie is True
    # Et le pseudonyme est bien parti : le drapeau ne masque pas un nom resté
    # en base. Le prénom n'est plus vérifié ici parce qu'il n'est plus servi du
    # tout — un salon voit un pseudonyme, jamais un état civil.
    assert ligne_apres.creator_handle is None


async def test_la_journee_du_commerce_dit_aussi_le_depart(session: AsyncSession) -> None:
    """L'autre façade, parce qu'un champ ajouté d'un seul côté est la panne
    la plus fréquente de ce dépôt."""
    ligne, s = await contrepartie(session)
    await _clore(session, ligne)
    createur = s["createur"]
    await service.demander(session, user=createur, actor=Actor.from_user(createur))
    createur.deletion_effective_at = datetime.now(UTC) - timedelta(minutes=1)
    await service.appliquer_les_echeances(session)
    await session.flush()

    booking = await session.get(Booking, s["booking"].id)
    assert booking is not None
    jour = (booking.starts_at or booking.created_at).date()
    journee = await booking_history.journee_du_commerce(session, business=s["business"], jour=jour)

    # **La ligne est cherchée par son identifiant, pas « quelque part ».** Un
    # `any(...)` sur une liste vide passerait au vert en n'inspectant rien, ce
    # qui est exactement le défaut que cette tranche corrige : l'historique doit
    # rester, et c'est lui qu'on vérifie ici.
    lignes = [*journee.items, *journee.a_trancher]
    la_notre = next(r for r in lignes if r.booking_id == booking.id)
    assert la_notre.creator_partie is True
    assert la_notre.creator_handle is None


# --------------------------------------------------------------------------
# le rôle qui ne se supprime pas
# --------------------------------------------------------------------------


async def test_un_administrateur_ne_peut_pas_supprimer_son_compte(
    client: AsyncClient, session: AsyncSession
) -> None:
    """**Le trou n'était pas un oubli d'écran, c'était une route ouverte.**

    Aucune des conditions qui bloquent les autres ne s'appliquait à un
    administrateur : ni contrepartie en cours, ni réservation, ni rien. La
    demande passait, et trente jours plus tard l'anonymisation emportait le seul
    compte capable d'arbitrer un dossier, de reprendre un salon et de fixer un
    prix — sans aucun chemin pour en recréer un.

    **Le test passe par la route, pas par le service.** Masquer le bloc à
    l'écran retire le geste à qui le cherchait, pas à qui connaît l'adresse :
    c'est le refus HTTP qui ferme la porte, et c'est donc lui qu'on éprouve.
    """
    from tests.test_redemption_caisse import MOT_DE_PASSE

    admin = await inscrire_verifie(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password=MOT_DE_PASSE,
        role=UserRole.ADMIN,
    )
    await session.commit()

    reponse = await client.post(f"{PREFIX}/me/deletion", headers=await _jetons(client, admin.email))

    assert reponse.status_code == 403, reponse.text
    assert reponse.json()["detail"] == "deletion_forbidden_for_role"

    # **Et rien n'a été posé au passage.** Un refus qui laisserait la date
    # d'échéance écrite rendrait le compte supprimable au prochain balayage,
    # c'est-à-dire refuserait à l'écran et accepterait dans les faits.
    await session.refresh(admin)
    assert admin.deletion_requested_at is None


async def test_une_creatrice_peut_toujours_partir(
    client: AsyncClient, session: AsyncSession
) -> None:
    """**Le cas qui fait diverger les deux implémentations.**

    Un refus posé sur tout le monde passerait le test du dessus tout aussi
    bien. C'est ici qu'il se verrait : le départ d'une créatrice est un droit,
    et c'est celui que la garde ne doit pas emporter.
    """
    ligne, s = await contrepartie(session)
    await _clore(session, ligne)
    await session.commit()

    reponse = await client.post(
        f"{PREFIX}/me/deletion", headers=await _jetons(client, s["createur"].email)
    )

    assert reponse.status_code == 202, reponse.text
