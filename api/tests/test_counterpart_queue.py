"""Les deux files de contreparties : celle du commerce, celle de l'arbitre.

Trois propriétés.

Les trois onglets ne couvrent pas tout, et c'est pour cela que le filtre reste
facultatif : `unfulfilled` n'appartient à aucun d'eux, et lier la lecture aux
onglets ferait disparaître de l'interface un statut qui existe en base.

Le motif de la dernière demande est relu dans le **journal**, pas recopié sur la
contrepartie. Le journal est immuable ; une copie ne l'est pas et finirait par
en diverger.

La file d'arbitrage se vide. Un drapeau levé reste levé — c'est une trace — mais
un dossier tranché n'est plus à trancher, et le garder ferait grossir une pile
qui ne descend jamais.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Collaboration
from app.models.enums import CollaborationStatus, ReliabilityEventType, UserRole
from app.services import auth as auth_service
from app.services import collaboration as service
from app.services import proof as proof_service
from app.services.audit import Actor
from tests.test_collaboration import capture, contrepartie

PREFIX = get_settings().api_v1_prefix
#: Trois reproches **différents**, et non trois fois le même : l'ordre et la
#: variété sont précisément ce que l'historique doit rendre lisible.
MOTIFS_D_ESSAI = ("missing_mention", "missing_location", "wrong_format", "low_quality")
MOT_DE_PASSE = "un-mot-de-passe-solide-42"


async def statut(session: AsyncSession, ligne: Collaboration, vers: CollaborationStatus) -> None:
    """Pose un statut sans passer par la machine, pour composer une file.

    Les transitions elles-mêmes sont éprouvées dans `test_collaboration.py` ;
    ici on éprouve la lecture, et emprunter le chemin complet à chaque ligne
    rendrait ces tests illisibles sans rien prouver de plus.
    """
    await session.execute(
        sa.update(Collaboration).where(Collaboration.id == ligne.id).values(status=vers)
    )
    await session.flush()


async def test_les_trois_filtres_partitionnent_ce_qu_ils_couvrent(session: AsyncSession) -> None:
    """Chaque onglet dit à qui la balle appartient, pas quel statut interne court."""
    attendus = {
        service.FiltreDeContrepartie.ATTENDUE: (
            CollaborationStatus.PENDING,
            CollaborationStatus.RESUBMIT_REQUESTED,
        ),
        service.FiltreDeContrepartie.A_CONTROLER: (
            CollaborationStatus.SUBMITTED,
            CollaborationStatus.UNDER_REVIEW,
        ),
        service.FiltreDeContrepartie.APPROUVEE: (CollaborationStatus.APPROVED,),
    }
    couverts = {s for statuts in attendus.values() for s in statuts}

    for filtre, statuts in attendus.items():
        assert service._STATUTS_DU_FILTRE[filtre] == frozenset(statuts)

    # Aucun recouvrement : une ligne n'apparaît pas dans deux onglets.
    total = sum(len(s) for s in attendus.values())
    assert total == len(couverts)

    # Et ce que les onglets ne couvrent pas est nommé, pas oublié.
    assert set(CollaborationStatus) - couverts == {CollaborationStatus.UNFULFILLED}


async def test_sans_filtre_la_liste_rend_aussi_le_non_honore(session: AsyncSession) -> None:
    """C'est la raison d'être du filtre facultatif.

    Sans lui, `unfulfilled` n'aurait aucun chemin de lecture et disparaîtrait
    de l'interface sans disparaître de la base.
    """
    ligne, s = await contrepartie(session)
    await statut(session, ligne, CollaborationStatus.UNFULFILLED)

    sans_filtre = await service.lister_pour_le_commerce(session, business_id=s["business"].id)
    assert [x.collaboration_id for x in sans_filtre] == [ligne.id]

    for filtre in service.FiltreDeContrepartie:
        avec = await service.lister_pour_le_commerce(
            session, business_id=s["business"].id, filtre=filtre
        )
        assert avec == (), f"{filtre} ne doit pas ramener un non honoré"


async def test_la_ligne_porte_la_creatrice_l_item_et_le_critere(session: AsyncSession) -> None:
    ligne, s = await contrepartie(session)

    lignes = await service.lister_pour_le_commerce(session, business_id=s["business"].id)

    assert len(lignes) == 1
    lue = lignes[0]
    assert lue.creator_first_name == "Rebecca"
    assert lue.creator_handle == "rebecca.miami"
    assert lue.item_name == "Soin visage"
    assert lue.required_format == ligne.required_format
    assert lue.deadline_at == ligne.deadline_at


async def test_le_dernier_motif_est_relu_dans_le_journal(session: AsyncSession) -> None:
    """Et c'est bien le dernier, pas le premier.

    Le journal est immuable ; recopier le motif sur la contrepartie créerait
    une seconde vérité qu'un UPDATE ferait diverger de lui.
    """
    ligne, s = await contrepartie(session)
    await statut(session, ligne, CollaborationStatus.SUBMITTED)
    await service.demander_une_nouvelle_soumission(
        session,
        collaboration=ligne,
        actor=Actor.from_user(s["caissier"]),
        reason="mention_absente",
    )
    await statut(session, ligne, CollaborationStatus.SUBMITTED)
    await service.demander_une_nouvelle_soumission(
        session,
        collaboration=ligne,
        actor=Actor.from_user(s["caissier"]),
        reason="lieu_absent",
    )

    lignes = await service.lister_pour_le_commerce(session, business_id=s["business"].id)

    assert lignes[0].dernier_motif == "lieu_absent"
    assert lignes[0].attempts_count == 2


async def test_une_contrepartie_sans_motif_n_en_invente_pas(session: AsyncSession) -> None:
    """Le pendant du test précédent : sans lui, un motif figé le passerait."""
    _, s = await contrepartie(session)

    lignes = await service.lister_pour_le_commerce(session, business_id=s["business"].id)

    assert lignes[0].dernier_motif is None
    assert lignes[0].derniere_soumission is None


async def test_la_liste_du_commerce_est_isolee(client: AsyncClient, session: AsyncSession) -> None:
    """Sur la route, où le résolveur d'appartenance s'applique."""
    _, a = await contrepartie(session)
    _, b = await contrepartie(session)
    await session.commit()

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login",
            json={"email": b["caissier"].email, "password": MOT_DE_PASSE},
        )
    ).json()
    entetes = {"Authorization": f"Bearer {jetons['access_token']}"}

    refuse = await client.get(
        f"{PREFIX}/business/{a['business'].id}/collaborations", headers=entetes
    )
    assert refuse.status_code == 403
    assert refuse.json()["detail"] == "not_a_member"

    accepte = await client.get(
        f"{PREFIX}/business/{b['business'].id}/collaborations", headers=entetes
    )
    assert accepte.status_code == 200, accepte.text
    assert len(accepte.json()) == 1


# --------------------------------------------------------------------------
# file d'arbitrage
# --------------------------------------------------------------------------


async def test_la_file_d_arbitrage_ne_prend_que_les_dossiers_marques(
    session: AsyncSession,
) -> None:
    marquee, _ = await contrepartie(session)
    await contrepartie(session)  # une seconde, sans drapeau
    await session.execute(
        sa.update(Collaboration)
        .where(Collaboration.id == marquee.id)
        .values(needs_human_review=True)
    )
    await session.flush()

    file = await service.file_de_revue_humaine(session)

    assert [x.collaboration_id for x in file] == [marquee.id]


async def test_un_dossier_tranche_sort_de_la_file_sans_perdre_sa_trace(
    session: AsyncSession,
) -> None:
    """Le drapeau reste levé, la file se vide.

    Confondre les deux ferait grossir une pile qui ne descend jamais, ou
    effacerait le fait qu'un humain a dû regarder.
    """
    ligne, s = await contrepartie(session)
    await session.execute(
        sa.update(Collaboration)
        .where(Collaboration.id == ligne.id)
        .values(needs_human_review=True, status=CollaborationStatus.SUBMITTED)
    )
    await session.flush()
    assert len(await service.file_de_revue_humaine(session)) == 1

    await session.refresh(ligne)
    await service.approuver(session, collaboration=ligne, actor=Actor.from_user(s["caissier"]))

    assert await service.file_de_revue_humaine(session) == ()
    await session.refresh(ligne)
    assert ligne.needs_human_review is True, "la trace ne s'efface pas"


async def test_la_file_d_arbitrage_voit_les_deux_parties(session: AsyncSession) -> None:
    """L'arbitre a besoin d'exactement ce que le commerce voyait.

    Une vue plus pauvre l'obligerait à décider avec moins d'information que
    celui dont il révise la décision.
    """
    ligne, s = await contrepartie(session)
    await session.execute(
        sa.update(Collaboration).where(Collaboration.id == ligne.id).values(needs_human_review=True)
    )
    await session.flush()

    file = await service.file_de_revue_humaine(session)

    lue = file[0]
    assert lue.business_name == s["business"].name
    assert lue.creator_handle == "rebecca.miami"
    assert lue.deadline_at is not None


async def test_la_file_d_arbitrage_est_reservee_aux_administrateurs(
    client: AsyncClient, session: AsyncSession
) -> None:
    _, s = await contrepartie(session)
    admin = await auth_service.register(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password=MOT_DE_PASSE,
        role=UserRole.ADMIN,
    )
    await session.commit()

    async def entetes(user) -> dict:
        jetons = (
            await client.post(
                f"{PREFIX}/auth/login", json={"email": user.email, "password": MOT_DE_PASSE}
            )
        ).json()
        return {"Authorization": f"Bearer {jetons['access_token']}"}

    refuse = await client.get(
        f"{PREFIX}/admin/collaborations/review", headers=await entetes(s["caissier"])
    )
    assert refuse.status_code == 403
    assert refuse.json()["detail"] == "insufficient_role"

    accepte = await client.get(
        f"{PREFIX}/admin/collaborations/review", headers=await entetes(admin)
    )
    assert accepte.status_code == 200, accepte.text


# --------------------------------------------------------------------------
# arbitrage
# --------------------------------------------------------------------------


async def _admin_connecte(client: AsyncClient, session: AsyncSession) -> dict:
    admin = await auth_service.register(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password=MOT_DE_PASSE,
        role=UserRole.ADMIN,
    )
    await session.commit()
    jetons = (
        await client.post(
            f"{PREFIX}/auth/login", json={"email": admin.email, "password": MOT_DE_PASSE}
        )
    ).json()
    return {"Authorization": f"Bearer {jetons['access_token']}"}


async def _en_revue(
    session: AsyncSession, statut: CollaborationStatus = CollaborationStatus.SUBMITTED
):
    ligne, s = await contrepartie(session)
    await session.execute(
        sa.update(Collaboration)
        .where(Collaboration.id == ligne.id)
        .values(needs_human_review=True, status=statut, attempts_count=3)
    )
    await session.flush()
    await session.refresh(ligne)
    return ligne, s


async def test_l_arbitre_peut_clore_en_non_honoree(
    client: AsyncClient, session: AsyncSession
) -> None:
    """L'issue qui n'appartient qu'à lui.

    Sans elle, un dossier sorti de la boucle à la troisième tentative y reste
    pour toujours : le créateur attend, le commerce attend, et le drapeau
    devient une impasse.
    """
    ligne, _ = await _en_revue(session)
    entetes = await _admin_connecte(client, session)

    reponse = await client.post(
        f"{PREFIX}/admin/collaborations/{ligne.id}/decision",
        json={"issue": "unfulfilled", "reason": "wrong_format"},
        headers=entetes,
    )

    assert reponse.status_code == 200, reponse.text
    assert reponse.json()["status"] == CollaborationStatus.UNFULFILLED.value
    # Le drapeau reste levé : c'est une trace, elle ne s'efface pas. Mais la
    # file, elle, se vide.
    assert reponse.json()["needs_human_review"] is True
    assert await service.file_de_revue_humaine(session) == ()


async def test_l_arbitre_tranche_dans_le_vocabulaire_du_commerce(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Approuver et redemander disent la même chose des deux côtés.

    Un second langage pour l'arbitre obligerait chacun à traduire, et
    l'arbitrage cesserait d'être comparable à la décision qu'il révise.
    """
    ligne, _ = await _en_revue(session)
    entetes = await _admin_connecte(client, session)

    reponse = await client.post(
        f"{PREFIX}/admin/collaborations/{ligne.id}/decision",
        json={"issue": "approve"},
        headers=entetes,
    )
    assert reponse.status_code == 200, reponse.text
    assert reponse.json()["status"] == CollaborationStatus.APPROVED.value


async def test_l_arbitre_qui_redemande_pose_une_nouvelle_echeance(
    client: AsyncClient, session: AsyncSession
) -> None:
    ligne, _ = await _en_revue(session)
    entetes = await _admin_connecte(client, session)

    reponse = await client.post(
        f"{PREFIX}/admin/collaborations/{ligne.id}/decision",
        json={"issue": "resubmit", "reason": "missing_mention"},
        headers=entetes,
    )

    assert reponse.status_code == 200, reponse.text
    corps = reponse.json()
    assert corps["status"] == CollaborationStatus.RESUBMIT_REQUESTED.value

    # Ce que la règle protège n'est pas « une échéance plus lointaine
    # qu'avant » — la fenêtre de correction est volontairement plus courte que
    # celle de la publication initiale, corriger une légende va plus vite que
    # produire un contenu. C'est qu'une **fenêtre entière** rouvre : le
    # créateur ne doit pas hériter du reliquat d'un délai déjà entamé, sinon on
    # lui redemande quelque chose sans lui laisser le temps de le faire.
    fenetre = timedelta(seconds=get_settings().collaboration_resubmit_seconds)
    nouvelle = datetime.fromisoformat(corps["deadline_at"])
    assert nouvelle > datetime.now(UTC)
    assert nouvelle - datetime.now(UTC) > fenetre * 0.99


async def test_toute_issue_autre_qu_une_approbation_exige_un_motif(
    client: AsyncClient, session: AsyncSession
) -> None:
    ligne, _ = await _en_revue(session)
    entetes = await _admin_connecte(client, session)

    for issue in ("resubmit", "unfulfilled"):
        refuse = await client.post(
            f"{PREFIX}/admin/collaborations/{ligne.id}/decision",
            json={"issue": issue},
            headers=entetes,
        )
        assert refuse.status_code == 422, issue
        assert refuse.json()["detail"] == "validation_failed"

    # Le pendant : une approbation n'en demande pas, et passe.
    accepte = await client.post(
        f"{PREFIX}/admin/collaborations/{ligne.id}/decision",
        json={"issue": "approve"},
        headers=entetes,
    )
    assert accepte.status_code == 200, accepte.text


async def test_un_dossier_hors_revue_ne_s_arbitre_pas(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Sans cette borne, l'administrateur deviendrait un commerce fantôme.

    Il déciderait à la place de celui qui a donné la prestation. Ce qu'on
    arbitre est ce que la mécanique a refusé de trancher toute seule.
    """
    ligne, _ = await contrepartie(session)
    assert ligne.needs_human_review is False
    entetes = await _admin_connecte(client, session)

    refuse = await client.post(
        f"{PREFIX}/admin/collaborations/{ligne.id}/decision",
        json={"issue": "approve"},
        headers=entetes,
    )

    assert refuse.status_code == 409
    assert refuse.json()["detail"] == "collaboration_not_in_review"


async def test_le_commerce_ne_peut_pas_clore_en_non_honoree(
    client: AsyncClient, session: AsyncSession
) -> None:
    """C'est la seule décision du produit qui ne se rouvre pas.

    Le commerce approuve ou redemande. Lui ouvrir la clôture ferait fermer des
    dossiers qu'on ne saurait plus rouvrir, par lassitude ou par erreur.
    """
    ligne, s = await _en_revue(session)
    await session.commit()

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login",
            json={"email": s["caissier"].email, "password": MOT_DE_PASSE},
        )
    ).json()
    entetes = {"Authorization": f"Bearer {jetons['access_token']}"}

    # La route commerce n'accepte que `approuve` : il n'y a pas de champ par
    # lequel demander une clôture.
    refuse = await client.post(
        f"{PREFIX}/business/collaborations/{ligne.id}/decision",
        json={"issue": "unfulfilled", "reason": "low_quality"},
        headers=entetes,
    )
    assert refuse.status_code == 422

    # Et la route d'arbitrage lui est fermée par son rôle.
    interdit = await client.post(
        f"{PREFIX}/admin/collaborations/{ligne.id}/decision",
        json={"issue": "unfulfilled", "reason": "low_quality"},
        headers=entetes,
    )
    assert interdit.status_code == 403
    assert interdit.json()["detail"] == "insufficient_role"


async def test_la_cloture_produit_l_evenement_de_fiabilite(session: AsyncSession) -> None:
    """Une issue sans son événement se verrait dans la table, pas au troisième
    mois d'exploitation."""
    assert (
        ReliabilityEventType.UNFULFILLED
        in service.EVENEMENTS_PAR_ISSUE[CollaborationStatus.UNFULFILLED]
    )


# --------------------------------------------------------------------------
# Le chemin complet, sans état posé à la main
# --------------------------------------------------------------------------


async def _jusqu_a_la_revue_humaine(session: AsyncSession) -> Collaboration:
    """Un dossier amené en revue humaine **par le produit**.

    Aucun `UPDATE` : la créatrice soumet, le commerce redemande, autant de fois
    que la configuration en autorise, et le drapeau se lève tout seul au
    dernier tour.

    C'est ce que ce fichier ne faisait nulle part. Chaque test d'arbitrage
    posait `needs_human_review=True` avec un statut choisi à la main, et
    choisissait `submitted` — un état où les flèches existaient déjà. Le produit,
    lui, laisse le dossier en `resubmit_requested`, où il n'y en avait aucune :
    deux issues sur trois répondaient 409 en ligne, et aucun test ne pouvait le
    voir.

    Même famille que le montage de preuve qui posait une clé sans objet derrière.
    Un décor qui ne ressemble pas à ce que la mécanique produit ne prouve rien.
    """
    ligne, _ = await contrepartie(session)

    for tour in range(get_settings().collaboration_max_attempts):
        await proof_service.soumettre(
            session, collaboration=ligne, capture=capture(), actor=Actor.system()
        )
        await service.demander_une_nouvelle_soumission(
            session,
            collaboration=ligne,
            actor=Actor.system(),
            reason=MOTIFS_D_ESSAI[tour],
        )

    await session.refresh(ligne)
    return ligne


async def test_le_produit_amene_le_dossier_en_resubmit_requested(session: AsyncSession) -> None:
    """L'état réel de la revue humaine, constaté et non supposé.

    C'est celui-là que la route d'arbitrage doit accepter. Le drapeau se lève
    dans `demander_une_nouvelle_soumission`, qui laisse le dossier en
    `resubmit_requested` : il n'y a pas d'autre chemin vers la revue humaine.
    """
    ligne = await _jusqu_a_la_revue_humaine(session)

    assert ligne.needs_human_review is True
    assert ligne.status is CollaborationStatus.RESUBMIT_REQUESTED
    assert ligne.attempts_count == get_settings().collaboration_max_attempts

    # Et c'est le seul état que la file rend : si un jour un autre chemin lève
    # le drapeau, ce test le dira au lieu de laisser une issue muette.
    file = await service.file_de_revue_humaine(session)
    assert {vue.status for vue in file} == {CollaborationStatus.RESUBMIT_REQUESTED}


@pytest.mark.parametrize(
    ("issue", "attendu"),
    [
        ("approve", CollaborationStatus.APPROVED),
        ("resubmit", CollaborationStatus.RESUBMIT_REQUESTED),
        ("unfulfilled", CollaborationStatus.UNFULFILLED),
    ],
)
async def test_les_trois_issues_partent_du_dossier_reel(
    client: AsyncClient,
    session: AsyncSession,
    issue: str,
    attendu: CollaborationStatus,
) -> None:
    """Les trois issues, depuis l'état que le produit fabrique, par la route.

    Deux d'entre elles répondaient 409 : la seule sortie de la boucle
    automatique était fermée, et un dossier arrivé à la dernière tentative
    restait bloqué pour toujours — plus personne ne pouvait agir dessus, ni le
    commerce, ni l'arbitre.
    """
    ligne = await _jusqu_a_la_revue_humaine(session)
    entetes = await _admin_connecte(client, session)

    reponse = await client.post(
        f"{PREFIX}/admin/collaborations/{ligne.id}/decision",
        json={"issue": issue, "reason": "low_quality"},
        headers=entetes,
    )

    assert reponse.status_code == 200, reponse.text
    assert reponse.json()["status"] == attendu.value
    # Le drapeau reste levé : c'est une trace, elle ne s'efface pas.
    assert reponse.json()["needs_human_review"] is True


async def test_un_motif_en_texte_libre_est_refuse_des_deux_cotes(
    client: AsyncClient, session: AsyncSession
) -> None:
    """La seule chose qui empêche l'intraduisible de revenir.

    Le motif était une phrase. Elle traversait le journal telle quelle et
    ressortait sur l'écran de l'arbitre dans la langue de celui qui l'avait
    écrite — « Le format n'est pas celui attendu » au milieu d'une interface en
    anglais. Traduire à l'affichage suppose un code ; il suffit d'un appelant
    qui envoie une phrase pour que le trou se rouvre.
    """
    ligne = await _jusqu_a_la_revue_humaine(session)
    await session.commit()
    entetes = await _admin_connecte(client, session)

    refuse = await client.post(
        f"{PREFIX}/admin/collaborations/{ligne.id}/decision",
        json={"issue": "resubmit", "reason": "Le format n'est pas celui attendu"},
        headers=entetes,
    )
    assert refuse.status_code == 422
    assert refuse.json()["detail"] == "validation_failed"


async def test_l_historique_porte_les_trois_demandes_dans_l_ordre(
    session: AsyncSession,
) -> None:
    """C'est la répétition qui justifie l'escalade.

    L'écran ne montrait que la dernière demande. Trois fois le même reproche et
    trois reproches différents n'appellent pas la même décision, et l'arbitre
    n'avait aucun moyen de les distinguer.
    """
    await _jusqu_a_la_revue_humaine(session)

    (vue,) = await service.file_de_revue_humaine(session)

    assert [t.motif for t in vue.tentatives] == list(
        MOTIFS_D_ESSAI[: get_settings().collaboration_max_attempts]
    )
    # Chronologique, et non l'inverse : on lit l'escalade dans le sens où elle
    # s'est produite.
    assert [t.demandee_le for t in vue.tentatives] == sorted(t.demandee_le for t in vue.tentatives)
    # Le dernier motif n'est plus stocké en double, il se dérive.
    assert vue.dernier_motif == vue.tentatives[-1].motif
