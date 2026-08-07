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

import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Collaboration
from app.models.enums import CollaborationStatus, UserRole
from app.services import auth as auth_service
from app.services import collaboration as service
from app.services.audit import Actor
from tests.test_collaboration import contrepartie

PREFIX = get_settings().api_v1_prefix
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
