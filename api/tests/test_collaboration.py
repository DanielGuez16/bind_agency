"""Contrepartie : critères figés, échéances, boucle de relance, preuve.

Deux propriétés dominent, et ce sont des interdits.

**Aucune validation automatique à l'expiration d'un délai.** Une échéance
dépassée produit un `unfulfilled`, jamais un `approved` par défaut : accepter
par lassitude ferait de l'échéance une récompense pour qui ne répond pas.

**Le refus de conformité rouvre, il ne clôt pas.** Nouvelle échéance à chaque
passage, sinon le créateur tomberait en non honoré pour un délai déjà écoulé —
ce qui reviendrait à refuser en faisant semblant de laisser une chance.
"""

import itertools
from datetime import UTC, datetime, timedelta

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import AuditLog, Collaboration, Proof, TierOffer
from app.models.enums import ActorKind, CaptureMethod, CollaborationStatus
from app.services import collaboration as service
from app.services import proof as proof_service
from app.services import redemption
from app.services.audit import Actor
from tests.test_redemption_caisse import scene

PREFIX = get_settings().api_v1_prefix

#: Le diagramme de SPEC.md §4.2, recopié à la main. `under_review` y est ajouté
#: comme l'étape « contrôle » du diagramme : il figure dans les statuts de §2.6
#: sans apparaître dans le schéma, et une table partielle lèverait un KeyError.
DIAGRAMME = {
    ("pending", "submitted"),
    ("pending", "unfulfilled"),
    ("submitted", "under_review"),
    ("submitted", "approved"),
    ("submitted", "resubmit_requested"),
    ("under_review", "approved"),
    ("under_review", "resubmit_requested"),
    ("resubmit_requested", "submitted"),
    ("resubmit_requested", "unfulfilled"),
}


async def contrepartie(session: AsyncSession, **critere) -> tuple[Collaboration, dict]:
    """Une réservation consommée, donc une contrepartie ouverte."""
    s = await scene(session)
    if critere:
        await session.execute(
            sa.update(TierOffer).where(TierOffer.id == s["offre"].id).values(**critere)
        )
        await session.flush()

    await redemption.marquer_consomme(
        session, redemption_code_id=s["code"].id, par_user_id=s["caissier"].id
    )
    from app.services import booking_states

    await booking_states.consommer(
        session, booking=s["booking"], actor=Actor.from_user(s["caissier"])
    )
    ligne = await service.du_booking(session, s["booking"].id)
    assert ligne is not None
    return ligne, s


def capture(
    niveau: CaptureMethod = CaptureMethod.API, contenu: bytes = b"le media"
) -> proof_service.MediaCapture:
    return proof_service.MediaCapture(
        capture_method=niveau,
        contenu=contenu,
        media_key="preuves/story.mp4" if niveau is not CaptureMethod.UPLOAD else None,
        screenshot_key="preuves/capture.png" if niveau is CaptureMethod.UPLOAD else None,
        source_url="https://instagram.example/p/abc" if niveau is CaptureMethod.URL_FETCH else None,
    )


# --------------------------------------------------------------------------
# création et critères figés
# --------------------------------------------------------------------------


async def test_la_consommation_ouvre_la_contrepartie(session: AsyncSession) -> None:
    """`consumed` est le seul état qui la crée, et les deux écritures
    appartiennent à la même transaction : une prestation servie sans
    contrepartie ouverte serait une prestation offerte."""
    ligne, _ = await contrepartie(session)

    assert ligne.status is CollaborationStatus.PENDING
    assert ligne.deadline_at > datetime.now(UTC)
    assert ligne.attempts_count == 0
    assert ligne.needs_human_review is False

    journal = await session.scalar(sa.select(AuditLog).where(AuditLog.entity_id == ligne.id))
    assert journal is not None
    assert journal.actor_kind is ActorKind.SYSTEM
    assert journal.reason


async def test_les_criteres_sont_figes_a_la_creation(session: AsyncSession) -> None:
    """Un commerce qui durcit ses exigences après coup changerait ce qu'on
    reproche au créateur de ne pas avoir fait."""
    ligne, s = await contrepartie(session, required_mention="@salon.ocean", required_geotag=True)

    assert ligne.required_mention == "@salon.ocean"
    assert ligne.required_geotag is True

    await session.execute(
        sa.update(TierOffer)
        .where(TierOffer.id == s["offre"].id)
        .values(required_mention="@autre.chose", required_geotag=False)
    )
    await session.flush()
    await session.refresh(ligne)

    assert ligne.required_mention == "@salon.ocean"
    assert ligne.required_geotag is True


async def test_une_consommation_ne_cree_qu_une_contrepartie(session: AsyncSession) -> None:
    ligne, s = await contrepartie(session)

    with pytest.raises(service.AlreadyExists):
        await service.creer(session, booking=s["booking"])

    combien = await session.scalar(
        sa.select(sa.func.count())
        .select_from(Collaboration)
        .where(Collaboration.booking_id == s["booking"].id)
    )
    assert combien == 1
    assert ligne.id is not None


# --------------------------------------------------------------------------
# le diagramme, en entier
# --------------------------------------------------------------------------


def test_la_table_est_exactement_le_diagramme() -> None:
    declarees = {
        (depuis.value, vers.value)
        for depuis, versions in service.TRANSITIONS.items()
        for vers in versions
    }
    assert declarees == DIAGRAMME


def test_tous_les_etats_figurent_dans_la_table() -> None:
    assert set(service.TRANSITIONS) == set(CollaborationStatus)


@pytest.mark.parametrize(
    ("depuis", "vers"),
    [
        (a, b)
        for a, b in itertools.product(CollaborationStatus, repeat=2)
        if (a.value, b.value) not in DIAGRAMME
    ],
)
async def test_aucune_transition_hors_diagramme(
    depuis: CollaborationStatus, vers: CollaborationStatus, session: AsyncSession
) -> None:
    ligne, s = await contrepartie(session)
    await session.execute(
        sa.update(Collaboration).where(Collaboration.id == ligne.id).values(status=depuis)
    )
    await session.refresh(ligne)

    with pytest.raises(service.TransitionNotAllowed):
        await service.transitionner(
            session,
            collaboration=ligne,
            vers=vers,
            actor=Actor.from_user(s["caissier"]),
            reason="essai",
        )

    assert (
        await session.scalar(sa.select(Collaboration.status).where(Collaboration.id == ligne.id))
        == depuis.value
    )


# --------------------------------------------------------------------------
# l'interdit central : jamais d'acceptation par défaut
# --------------------------------------------------------------------------


async def test_une_echeance_depassee_donne_un_non_honore(session: AsyncSession) -> None:
    ligne, _ = await contrepartie(session)
    ligne.deadline_at = datetime.now(UTC) - timedelta(minutes=1)
    await session.flush()

    assert await service.expirer_les_echeances(session) == 1

    await session.refresh(ligne)
    assert ligne.status is CollaborationStatus.UNFULFILLED
    assert ligne.approved_at is None


async def test_aucun_chemin_automatique_ne_produit_un_approuve(session: AsyncSession) -> None:
    """On essaie de le provoquer : échéances dépassées de toutes les façons.

    Accepter par lassitude ferait de l'échéance une récompense pour qui ne
    répond pas — et le commerce a donné une prestation contre une publication
    qui n'existe pas.
    """
    lignes = []
    for etat in (CollaborationStatus.PENDING, CollaborationStatus.RESUBMIT_REQUESTED):
        ligne, _ = await contrepartie(session)
        await session.execute(
            sa.update(Collaboration)
            .where(Collaboration.id == ligne.id)
            .values(status=etat, deadline_at=datetime.now(UTC) - timedelta(days=30))
        )
        lignes.append(ligne.id)
    await session.flush()

    for _ in range(3):
        await service.expirer_les_echeances(session)

    statuts = set(
        await session.scalars(sa.select(Collaboration.status).where(Collaboration.id.in_(lignes)))
    )
    assert statuts == {CollaborationStatus.UNFULFILLED.value}

    approuvees = await session.scalar(
        sa.select(sa.func.count())
        .select_from(Collaboration)
        .where(Collaboration.status == CollaborationStatus.APPROVED)
    )
    assert approuvees == 0


async def test_une_soumission_en_attente_de_controle_n_expire_pas(
    session: AsyncSession,
) -> None:
    """Le créateur a répondu, la balle est de notre côté. La faire tomber
    punirait quelqu'un de notre propre lenteur."""
    ligne, s = await contrepartie(session)
    await proof_service.soumettre(
        session, collaboration=ligne, capture=capture(), actor=Actor.from_user(s["createur"])
    )
    ligne.deadline_at = datetime.now(UTC) - timedelta(days=7)
    await session.flush()

    assert await service.expirer_les_echeances(session) == 0
    await session.refresh(ligne)
    assert ligne.status is CollaborationStatus.SUBMITTED


async def test_le_balayage_epargne_ce_qui_est_dans_les_temps(session: AsyncSession) -> None:
    """Le pendant : un balayage qui expirerait tout passerait le test précédent
    sans rien garantir."""
    ligne, _ = await contrepartie(session)

    assert await service.expirer_les_echeances(session) == 0
    await session.refresh(ligne)
    assert ligne.status is CollaborationStatus.PENDING


# --------------------------------------------------------------------------
# le refus rouvre, il ne clôt pas
# --------------------------------------------------------------------------


async def test_un_refus_rouvre_avec_une_nouvelle_echeance(session: AsyncSession) -> None:
    """Sans nouvelle échéance, le créateur tomberait en non honoré pour un délai
    déjà écoulé : refuser en faisant semblant de laisser une chance."""
    ligne, s = await contrepartie(session)
    await proof_service.soumettre(
        session, collaboration=ligne, capture=capture(), actor=Actor.from_user(s["createur"])
    )
    ligne.deadline_at = datetime.now(UTC) - timedelta(hours=1)
    await session.flush()

    await service.demander_une_nouvelle_soumission(
        session,
        collaboration=ligne,
        actor=Actor.from_user(s["caissier"]),
        reason="mention absente",
    )

    assert ligne.status is CollaborationStatus.RESUBMIT_REQUESTED
    assert ligne.deadline_at > datetime.now(UTC)
    assert ligne.attempts_count == 1
    # Le dossier n'est pas clos : il repart pour une soumission.
    assert CollaborationStatus.SUBMITTED in service.TRANSITIONS[ligne.status]


async def test_le_drapeau_de_revue_humaine_se_leve_a_la_troisieme(
    session: AsyncSession,
) -> None:
    """Il sort le dossier de la boucle sans le trancher. Il n'existe pas de
    statut `disputed` : un litige nommé appelle un arbitre, un drapeau appelle
    un regard."""
    ligne, s = await contrepartie(session)
    maximum = get_settings().collaboration_max_attempts

    for tour in range(maximum):
        await proof_service.soumettre(
            session,
            collaboration=ligne,
            capture=capture(contenu=f"essai {tour}".encode()),
            actor=Actor.from_user(s["createur"]),
        )
        await service.demander_une_nouvelle_soumission(
            session,
            collaboration=ligne,
            actor=Actor.from_user(s["caissier"]),
            reason="non conforme",
        )
        assert ligne.needs_human_review is (tour + 1 >= maximum)

    assert ligne.attempts_count == maximum
    # Et le dossier reste rouvert, pas fermé.
    assert ligne.status is CollaborationStatus.RESUBMIT_REQUESTED


async def test_une_approbation_est_toujours_volontaire(session: AsyncSession) -> None:
    ligne, s = await contrepartie(session)
    await proof_service.soumettre(
        session, collaboration=ligne, capture=capture(), actor=Actor.from_user(s["createur"])
    )

    await service.approuver(session, collaboration=ligne, actor=Actor.from_user(s["caissier"]))

    assert ligne.status is CollaborationStatus.APPROVED
    assert ligne.approved_at is not None
    journal = await session.scalar(
        sa.select(AuditLog).where(
            AuditLog.entity_id == ligne.id,
            AuditLog.to_status == CollaborationStatus.APPROVED.value,
        )
    )
    # Toujours un acteur humain : `system` n'approuve rien.
    assert journal.actor_kind is not ActorKind.SYSTEM


# --------------------------------------------------------------------------
# preuve
# --------------------------------------------------------------------------


def test_l_ordre_de_preference_suit_la_spec() -> None:
    """API, puis URL, puis capture d'écran. Déduire l'ordre de l'énumération
    ferait qu'un membre ajouté au mauvais endroit changerait la hiérarchie de
    confiance sans que personne ne le voie."""
    assert proof_service.ORDRE_DE_PREFERENCE == (
        CaptureMethod.API,
        CaptureMethod.URL_FETCH,
        CaptureMethod.UPLOAD,
    )
    assert proof_service.rang_de_confiance(CaptureMethod.API) == 0
    assert proof_service.rang_de_confiance(CaptureMethod.UPLOAD) == 2
    # Le seul niveau qu'on pourra automatiser plus tard.
    assert proof_service.NIVEAU_AUTOMATISABLE is CaptureMethod.API


@pytest.mark.parametrize("niveau", list(CaptureMethod))
async def test_la_methode_employee_est_conservee(
    niveau: CaptureMethod, session: AsyncSession
) -> None:
    """C'est elle qui permettra d'automatiser uniquement les cas de niveau 1."""
    ligne, s = await contrepartie(session)

    preuve = await proof_service.soumettre(
        session,
        collaboration=ligne,
        capture=capture(niveau),
        actor=Actor.from_user(s["createur"]),
    )

    assert preuve.capture_method is niveau
    assert ligne.status is CollaborationStatus.SUBMITTED


async def test_la_preuve_porte_son_empreinte_et_l_heure_serveur(
    session: AsyncSession,
) -> None:
    """Un horodatage fourni par le client n'est jamais une preuve."""
    ligne, s = await contrepartie(session)
    contenu = b"le media exact"

    preuve = await proof_service.soumettre(
        session,
        collaboration=ligne,
        capture=capture(contenu=contenu),
        actor=Actor.from_user(s["createur"]),
    )

    assert preuve.content_hash == proof_service.empreinte(contenu)
    assert len(preuve.content_hash) == 64
    assert preuve.submitted_at is not None
    assert abs((preuve.submitted_at - datetime.now(UTC)).total_seconds()) < 60


async def test_une_preuve_sans_fichier_archive_est_refusee(session: AsyncSession) -> None:
    """Un lien conservé sans son contenu ne prouve rien le jour où le commerce
    conteste : les stories disparaissent en vingt-quatre heures."""
    ligne, s = await contrepartie(session)

    with pytest.raises(proof_service.NothingArchived):
        await proof_service.soumettre(
            session,
            collaboration=ligne,
            capture=proof_service.MediaCapture(
                capture_method=CaptureMethod.URL_FETCH,
                contenu=b"x",
                source_url="https://instagram.example/p/abc",
            ),
            actor=Actor.from_user(s["createur"]),
        )

    assert ligne.status is CollaborationStatus.PENDING


async def test_les_soumissions_s_empilent_sans_s_ecraser(session: AsyncSession) -> None:
    """L'historique d'un dossier refusé est exactement ce qu'un commerce
    contestera, et ce qui justifiera un non honoré."""
    ligne, s = await contrepartie(session)

    await proof_service.soumettre(
        session,
        collaboration=ligne,
        capture=capture(contenu=b"premiere"),
        actor=Actor.from_user(s["createur"]),
    )
    await service.demander_une_nouvelle_soumission(
        session, collaboration=ligne, actor=Actor.from_user(s["caissier"]), reason="non conforme"
    )
    await proof_service.soumettre(
        session,
        collaboration=ligne,
        capture=capture(contenu=b"seconde"),
        actor=Actor.from_user(s["createur"]),
    )

    preuves = await proof_service.preuves_de(session, ligne.id)
    assert len(preuves) == 2
    assert preuves[0].content_hash != preuves[1].content_hash
    assert preuves[0].submitted_at <= preuves[1].submitted_at


async def test_renvoyer_le_meme_fichier_se_reconnait(session: AsyncSession) -> None:
    """Renvoyer la même capture après un refus n'est pas une correction."""
    ligne, s = await contrepartie(session)
    contenu = b"toujours la meme"

    await proof_service.soumettre(
        session,
        collaboration=ligne,
        capture=capture(contenu=contenu),
        actor=Actor.from_user(s["createur"]),
    )

    assert await proof_service.deja_soumise(session, collaboration_id=ligne.id, contenu=contenu)
    assert not await proof_service.deja_soumise(
        session, collaboration_id=ligne.id, contenu=b"autre chose"
    )


@pytest.mark.parametrize("etat", [CollaborationStatus.APPROVED, CollaborationStatus.UNFULFILLED])
async def test_une_contrepartie_close_n_accepte_plus_de_preuve(
    etat: CollaborationStatus, session: AsyncSession
) -> None:
    """Accepter quand même laisserait croire au créateur qu'il a répondu."""
    ligne, s = await contrepartie(session)
    await session.execute(
        sa.update(Collaboration).where(Collaboration.id == ligne.id).values(status=etat)
    )
    await session.refresh(ligne)

    with pytest.raises(proof_service.CollaborationNotOpen):
        await proof_service.soumettre(
            session, collaboration=ligne, capture=capture(), actor=Actor.from_user(s["createur"])
        )

    assert (
        await session.scalar(
            sa.select(sa.func.count()).select_from(Proof).where(Proof.collaboration_id == ligne.id)
        )
        == 0
    )


# --------------------------------------------------------------------------
# les routes
# --------------------------------------------------------------------------


async def test_le_createur_soumet_et_le_commerce_redemande(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Le tour complet : soumission, refus motivé, nouvelle échéance."""
    from tests.test_redemption_caisse import MOT_DE_PASSE

    ligne, s = await contrepartie(session)
    await session.commit()

    async def entetes(user) -> dict:
        jetons = (
            await client.post(
                f"{PREFIX}/auth/login", json={"email": user.email, "password": MOT_DE_PASSE}
            )
        ).json()
        return {"Authorization": f"Bearer {jetons['access_token']}"}

    createur = await entetes(s["createur"])
    soumise = await client.post(
        f"{PREFIX}/collaborations/{ligne.id}/proof",
        json={"screenshot_key": "preuves/capture.png"},
        headers=createur,
    )
    assert soumise.status_code == 200, soumise.text
    corps = soumise.json()
    assert corps["status"] == CollaborationStatus.SUBMITTED.value
    assert len(corps["proofs"]) == 1
    # Le niveau employé est rendu : c'est lui qui dira plus tard ce qu'on peut
    # automatiser.
    assert corps["proofs"][0]["capture_method"] == CaptureMethod.UPLOAD.value

    caissier = await entetes(s["caissier"])
    refus = await client.post(
        f"{PREFIX}/business/collaborations/{ligne.id}/decision",
        json={"approuve": False, "reason": "la mention du salon est absente"},
        headers=caissier,
    )
    assert refus.status_code == 200, refus.text
    assert refus.json()["status"] == CollaborationStatus.RESUBMIT_REQUESTED.value
    assert refus.json()["attempts_count"] == 1


async def test_un_refus_sans_motif_est_refuse(client: AsyncClient, session: AsyncSession) -> None:
    """Un créateur à qui l'on dit « non conforme » sans dire pourquoi refera la
    même chose."""
    from tests.test_redemption_caisse import MOT_DE_PASSE

    ligne, s = await contrepartie(session)
    await proof_service.soumettre(
        session, collaboration=ligne, capture=capture(), actor=Actor.from_user(s["createur"])
    )
    await session.commit()

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login",
            json={"email": s["caissier"].email, "password": MOT_DE_PASSE},
        )
    ).json()

    reponse = await client.post(
        f"{PREFIX}/business/collaborations/{ligne.id}/decision",
        json={"approuve": False, "reason": "   "},
        headers={"Authorization": f"Bearer {jetons['access_token']}"},
    )
    assert reponse.status_code == 422


async def test_la_contrepartie_d_un_autre_createur_est_introuvable(
    client: AsyncClient, session: AsyncSession
) -> None:
    from tests.test_redemption_caisse import MOT_DE_PASSE

    ligne, _ = await contrepartie(session)
    autre = await contrepartie(session)
    await session.commit()

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login",
            json={"email": autre[1]["createur"].email, "password": MOT_DE_PASSE},
        )
    ).json()

    reponse = await client.get(
        f"{PREFIX}/collaborations/{ligne.id}",
        headers={"Authorization": f"Bearer {jetons['access_token']}"},
    )
    assert reponse.status_code == 404
    assert reponse.json()["detail"] == "collaboration_not_found"


async def test_un_commerce_d_ailleurs_ne_decide_de_rien(
    client: AsyncClient, session: AsyncSession
) -> None:
    """C'est le résolveur d'appartenance qui l'interdit, sur une ressource sans
    `business_id` dans le chemin."""
    from tests.test_redemption_caisse import MOT_DE_PASSE

    ligne, s = await contrepartie(session)
    autre = await contrepartie(session)
    await proof_service.soumettre(
        session, collaboration=ligne, capture=capture(), actor=Actor.from_user(s["createur"])
    )
    await session.commit()

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login",
            json={"email": autre[1]["caissier"].email, "password": MOT_DE_PASSE},
        )
    ).json()

    reponse = await client.post(
        f"{PREFIX}/business/collaborations/{ligne.id}/decision",
        json={"approuve": True},
        headers={"Authorization": f"Bearer {jetons['access_token']}"},
    )
    assert reponse.status_code == 403
