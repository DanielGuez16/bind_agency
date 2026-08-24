"""La reprise d'un compte commerce par l'administration.

**La garantie qui porte ce fichier : après l'activation, l'administration n'a
aucun accès au compte d'un salon.** Elle en obtient un par un geste explicite,
motivé, borné dans le temps, et **dont le salon est prévenu**. Les quatre
qualificatifs comptent ensemble : une reprise sans motif ne dit pas pourquoi on
est entré, une reprise sans terme redevient un accès permanent, et une reprise
silencieuse est un accès dont personne ne peut demander compte.

Le sens inverse compte autant : hors reprise, un administrateur reçoit le même
refus que n'importe qui. Une dérogation qui laisserait passer sans reprise
rendrait tout le dispositif décoratif.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

from app.core.config import get_settings
from app.models import AuditLog, Business, BusinessSupportAccess, User
from app.models.enums import ActorKind, PorteeDeReprise, UserRole
from app.services import support as service
from tests.conftest import inscrire_verifie
from tests.factories import PASSWORD_HASH, new_business, new_user
from tests.test_activation import commerce_en_cours

PREFIX = get_settings().api_v1_prefix
MOT_DE_PASSE = "tourbillon-cactus-91-vermeil"

#: La portée des décors qui n'éprouvent pas la portée elle-même.
#:
#: **Un seul écran, et jamais tous.** Ouvrir la portée entière partout ferait
#: passer un service qui l'ignore aussi bien qu'un service qui l'applique :
#: aucun de ces décors ne divergerait plus, et la portée ne serait éprouvée
#: nulle part. Avec un seul écran, les tests qui touchent un autre écran
#: tombent — ce qui est exactement le point.
PORTEE = [PorteeDeReprise.FICHE]


async def administrateur(session: AsyncSession) -> User:
    return await inscrire_verifie(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password=MOT_DE_PASSE,
        role=UserRole.ADMIN,
    )


# --------------------------------------------------------------------------
# aucun accès sans reprise
# --------------------------------------------------------------------------


async def test_hors_reprise_un_administrateur_n_a_aucun_acces(
    session: AsyncSession, client: AsyncClient
) -> None:
    """**La garantie de fond.** Sans reprise ouverte, le refus est le même que
    pour n'importe qui."""
    business, _ = await commerce_en_cours(session)
    admin = await administrateur(session)
    await session.commit()

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login", json={"email": admin.email, "password": MOT_DE_PASSE}
        )
    ).json()
    reponse = await client.get(
        f"{PREFIX}/business/{business.id}",
        headers={"Authorization": f"Bearer {jetons['access_token']}"},
    )

    assert reponse.status_code == 403, reponse.text


async def test_pendant_une_reprise_l_administrateur_agit_au_nom_du_salon(
    session: AsyncSession, client: AsyncClient
) -> None:
    """La reprise ouvre la porte — c'est ce à quoi elle sert."""
    business, _ = await commerce_en_cours(session)
    admin = await administrateur(session)
    await service.ouvrir(
        session, business=business, admin=admin, motif="débloquer les horaires", portee=PORTEE
    )
    await session.commit()

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login", json={"email": admin.email, "password": MOT_DE_PASSE}
        )
    ).json()
    reponse = await client.get(
        f"{PREFIX}/business/{business.id}",
        headers={"Authorization": f"Bearer {jetons['access_token']}"},
    )

    assert reponse.status_code == 200, reponse.text
    assert reponse.json()["id"] == str(business.id)


async def test_une_reprise_expiree_ne_donne_plus_rien(session: AsyncSession) -> None:
    """**Bornée**, et vérifié sur l'horloge de lecture : une reprise qu'on
    oublie de fermer redeviendrait un accès permanent."""
    business, _ = await commerce_en_cours(session)
    admin = await administrateur(session)
    acces = await service.ouvrir(
        session, business=business, admin=admin, motif="comprendre un refus", portee=PORTEE
    )

    apres = acces.expires_at + timedelta(seconds=1)

    assert (
        await service.en_cours(
            session, business_id=business.id, admin_user_id=admin.id, maintenant=apres
        )
        is None
    )


async def test_une_reprise_fermee_ne_donne_plus_rien(session: AsyncSession) -> None:
    business, _ = await commerce_en_cours(session)
    admin = await administrateur(session)
    acces = await service.ouvrir(
        session, business=business, admin=admin, motif="débloquer les horaires", portee=PORTEE
    )

    await service.fermer(session, acces=acces, acteur=admin)

    assert acces.ended_at is not None
    assert await service.en_cours(session, business_id=business.id, admin_user_id=admin.id) is None


async def test_la_reprise_d_un_administrateur_n_ouvre_rien_a_un_autre(
    session: AsyncSession,
) -> None:
    """Nominative. Un accès ouvert par l'un ne se prête pas."""
    business, _ = await commerce_en_cours(session)
    premier = await administrateur(session)
    second = await administrateur(session)
    await service.ouvrir(
        session, business=business, admin=premier, motif="débloquer les horaires", portee=PORTEE
    )

    assert await service.en_cours(session, business_id=business.id, admin_user_id=second.id) is None


async def test_la_reprise_ne_vaut_que_pour_ce_commerce(session: AsyncSession) -> None:
    """Le sens qu'on oublierait de vérifier : une reprise ouverte chez A ne doit
    pas ouvrir B."""
    chez_a, _ = await commerce_en_cours(session)
    chez_b, _ = await commerce_en_cours(session)
    admin = await administrateur(session)
    await service.ouvrir(session, business=chez_a, admin=admin, motif="un motif", portee=PORTEE)

    assert await service.en_cours(session, business_id=chez_b.id, admin_user_id=admin.id) is None


# --------------------------------------------------------------------------
# explicite, et motivée
# --------------------------------------------------------------------------


async def test_un_motif_vide_est_refuse(session: AsyncSession) -> None:
    """Le motif est ce qui distingue une intervention d'une habitude."""
    business, _ = await commerce_en_cours(session)
    admin = await administrateur(session)

    with pytest.raises(service.ReasonRequired):
        await service.ouvrir(session, business=business, admin=admin, motif="   ", portee=PORTEE)

    assert await service.en_cours(session, business_id=business.id, admin_user_id=admin.id) is None


async def test_seul_un_administrateur_reprend(session: AsyncSession) -> None:
    business, proprietaire = await commerce_en_cours(session)

    with pytest.raises(service.NotAnAdmin):
        await service.ouvrir(
            session, business=business, admin=proprietaire, motif="un motif", portee=PORTEE
        )


async def test_on_n_ouvre_pas_deux_reprises_a_la_fois(session: AsyncSession) -> None:
    """Deux motifs pour une seule intervention feraient deux lignes dans la
    liste du salon là où il ne s'est rien passé de plus."""
    business, _ = await commerce_en_cours(session)
    admin = await administrateur(session)
    await service.ouvrir(
        session, business=business, admin=admin, motif="premier motif", portee=PORTEE
    )

    with pytest.raises(service.AlreadyOpen):
        await service.ouvrir(
            session, business=business, admin=admin, motif="second motif", portee=PORTEE
        )


async def test_l_ouverture_ecrit_son_motif_au_journal(session: AsyncSession) -> None:
    """**Au journal, qui ne s'efface pas.** La ligne de reprise peut être
    supprimée un jour ; ce qu'on relira alors est là."""
    business, _ = await commerce_en_cours(session)
    admin = await administrateur(session)

    await service.ouvrir(
        session, business=business, admin=admin, motif="débloquer les horaires", portee=PORTEE
    )

    entree = await session.scalar(
        sa.select(AuditLog).where(
            AuditLog.entity_id == business.id, AuditLog.reason == service.REASON_OUVERTE
        )
    )
    assert entree is not None
    assert entree.note == "débloquer les horaires"
    assert entree.actor_kind is ActorKind.ADMIN
    assert entree.actor_user_id == admin.id


# --------------------------------------------------------------------------
# visible du salon
# --------------------------------------------------------------------------


async def test_le_salon_lit_les_reprises_passees(
    session: AsyncSession, client: AsyncClient
) -> None:
    """**Ce qui rend le dispositif acceptable.** Un accès qu'on découvre n'est
    pas un accès déclaré."""
    business, proprietaire = await commerce_en_cours(session)
    admin = await administrateur(session)
    acces = await service.ouvrir(
        session, business=business, admin=admin, motif="débloquer les horaires", portee=PORTEE
    )
    await service.fermer(session, acces=acces, acteur=admin)
    await session.commit()

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login",
            json={"email": proprietaire.email, "password": MOT_DE_PASSE},
        )
    ).json()
    reponse = await client.get(
        f"{PREFIX}/business/{business.id}/support-access",
        headers={"Authorization": f"Bearer {jetons['access_token']}"},
    )

    assert reponse.status_code == 200, reponse.text
    lignes = reponse.json()
    assert len(lignes) == 1
    assert lignes[0]["reason"] == "débloquer les horaires"
    assert lignes[0]["ended_at"] is not None


async def test_un_salon_ne_lit_pas_les_reprises_d_un_autre(
    session: AsyncSession, client: AsyncClient
) -> None:
    """La fuite classique entre locataires, sur une route neuve."""
    chez_a, _ = await commerce_en_cours(session)
    chez_b, proprietaire_b = await commerce_en_cours(session)
    admin = await administrateur(session)
    await service.ouvrir(session, business=chez_a, admin=admin, motif="un motif", portee=PORTEE)
    await session.commit()

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login",
            json={"email": proprietaire_b.email, "password": MOT_DE_PASSE},
        )
    ).json()
    reponse = await client.get(
        f"{PREFIX}/business/{chez_a.id}/support-access",
        headers={"Authorization": f"Bearer {jetons['access_token']}"},
    )

    assert reponse.status_code == 403, reponse.text
    del chez_b


async def test_l_historique_garde_les_reprises_closes(session: AsyncSession) -> None:
    """N'afficher que celles en cours dirait « personne n'est entré » à
    quelqu'un chez qui on est entré trois fois."""
    business, _ = await commerce_en_cours(session)
    admin = await administrateur(session)
    for motif in ("première", "deuxième"):
        acces = await service.ouvrir(
            session, business=business, admin=admin, motif=motif, portee=PORTEE
        )
        await service.fermer(session, acces=acces, acteur=admin)

    lignes = await service.historique(session, business_id=business.id)

    assert [ligne.reason for ligne in lignes] == ["deuxième", "première"]


# --------------------------------------------------------------------------
# les contraintes, éprouvées en SQL direct
# --------------------------------------------------------------------------


async def _insertion(conn: AsyncConnection, **overrides):
    business_id = await new_business(conn)
    admin_id = await new_user(conn, role=UserRole.ADMIN, password_hash=PASSWORD_HASH)
    instant = datetime.now(UTC)
    valeurs = {
        "business_id": business_id,
        "admin_user_id": admin_id,
        "admin_name": "Amélie R.",
        "reason": "un motif",
        "scope": [PorteeDeReprise.FICHE.value],
        "expires_at": instant + timedelta(hours=2),
    } | overrides
    return sa.insert(BusinessSupportAccess).values(**valeurs)


async def test_la_base_accepte_une_reprise_bien_formee(conn: AsyncConnection) -> None:
    """**Le sens qui passe.** Une contrainte qui refuse tout passerait les
    refus suivants sans rien garantir."""
    await conn.execute(await _insertion(conn))


@pytest.mark.parametrize(
    ("champs", "contrainte"),
    [
        pytest.param(
            {"reason": "   "},
            "ck_business_support_access_motif_non_vide",
            id="motif vide",
        ),
        pytest.param(
            {"reason": "x" * 501},
            "ck_business_support_access_motif_borne",
            id="motif trop long",
        ),
        pytest.param(
            {"expires_at": datetime.now(UTC) - timedelta(hours=1)},
            "ck_business_support_access_expire_apres_ouverture",
            id="expire avant d'être ouverte",
        ),
        pytest.param(
            {"ended_at": datetime.now(UTC) - timedelta(hours=1)},
            "ck_business_support_access_close_apres_ouverture",
            id="close avant d'être ouverte",
        ),
        pytest.param(
            {"scope": []},
            "ck_business_support_access_portee_non_vide",
            id="portée vide",
        ),
        pytest.param(
            # **Une valeur inventée, et non une valeur oubliée.** Sans cette
            # contrainte elle s'insérerait, ne correspondrait à aucun écran, et
            # la reprise serait refusée partout : ce qui se lit comme une panne
            # du support plutôt que comme une faute de frappe.
            {"scope": ["comptabilite"]},
            "ck_business_support_access_portee_connue",
            id="portée inconnue",
        ),
        pytest.param(
            {"admin_name": "  "},
            "ck_business_support_access_nom_non_vide",
            id="nom vide",
        ),
    ],
)
async def test_la_base_refuse_les_reprises_incoherentes(
    conn: AsyncConnection, champs: dict, contrainte: str
) -> None:
    insertion = await _insertion(conn, **champs)

    with pytest.raises(IntegrityError) as echec:
        async with conn.begin_nested():
            await conn.execute(insertion)
    assert echec.value.orig.diag.constraint_name == contrainte

    # La transaction reste utilisable après le refus.
    assert await conn.scalar(sa.select(sa.literal(1))) == 1


async def test_la_fermeture_ne_compare_pas_deux_horloges(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """**Deux horloges, et une contrainte qui les compare.**

    `started_at` est écrit par `clock_timestamp()`, côté Postgres. `ended_at`
    l'était par `datetime.now(UTC)`, côté Python. La contrainte
    `close_apres_ouverture` compare les deux : il suffit que l'horloge de la
    base soit en avance de quelques millisecondes pour qu'une reprise ouverte
    puis refermée dans la foulée paraisse s'être fermée avant de s'ouvrir.

    Vu en intégration continue avec les chiffres — 2,7 millisecondes d'écart —
    et sur trois tests d'un coup.

    **Le sabotage est une horloge Python en retard**, ce qui est exactement la
    forme du défaut. Avec l'ancienne écriture il produit la violation à tous les
    coups ; avec la nouvelle il ne change rien, puisque l'heure ne vient plus de
    là. Un test qui se contenterait de vérifier `ended_at >= started_at` sur
    l'horloge du jour passerait dans les deux cas — c'est le décor qui pourrait
    être produit par le code fautif.
    """
    business, _ = await commerce_en_cours(session)
    admin = await administrateur(session)
    acces = await service.ouvrir(
        session, business=business, admin=admin, motif="débloquer les horaires", portee=PORTEE
    )

    class HorlogeEnRetard(datetime):
        @classmethod
        def now(cls, tz=None):  # noqa: ANN001, ANN206 - signature de datetime
            return datetime.now(tz) - timedelta(seconds=1)

    monkeypatch.setattr(service, "datetime", HorlogeEnRetard)

    ferme = await service.fermer(session, acces=acces, acteur=admin)

    assert ferme.ended_at is not None
    assert ferme.ended_at >= ferme.started_at
    # La session reste saine : une violation attrapée hors point de sauvegarde
    # la laisserait inutilisable, et le défaut ressortirait ailleurs.
    assert await session.scalar(sa.select(sa.literal(1))) == 1


# --------------------------------------------------------------------------
# la portée : ce que la reprise ouvre, et rien d'autre
# --------------------------------------------------------------------------


async def _jetons(client: AsyncClient, user: User) -> dict[str, str]:
    reponse = await client.post(
        f"{PREFIX}/auth/login", json={"email": user.email, "password": MOT_DE_PASSE}
    )
    jetons = reponse.json()
    return {"Authorization": f"Bearer {jetons['access_token']}"}


async def test_la_portee_ouvre_un_ecran_et_ferme_les_autres(
    session: AsyncSession, client: AsyncClient
) -> None:
    """**Le test qui fait la différence entre une portée et une phrase.**

    La reprise est ouverte sur le catalogue seul. La même requête sur la fiche
    du salon est refusée, et sur le catalogue elle passe. Un service qui
    enregistrerait la portée sans la vérifier rendrait 200 aux deux — c'est
    précisément l'implémentation qu'on redoute, et c'est ce décor-là qui la
    sépare de la bonne.

    Le code d'erreur est distinct du refus ordinaire : celui qui le reçoit a
    déjà prouvé son accès, et sans ce code il chercherait une panne là où il
    n'a qu'à déclarer la bonne portée.
    """
    business, _ = await commerce_en_cours(session)
    admin = await administrateur(session)
    await service.ouvrir(
        session,
        business=business,
        admin=admin,
        motif="corriger une prestation",
        portee=[PorteeDeReprise.CATALOGUE],
    )
    await session.commit()
    entete = await _jetons(client, admin)

    fiche = await client.get(f"{PREFIX}/business/{business.id}", headers=entete)
    assert fiche.status_code == 403, fiche.text
    assert fiche.json()["detail"] == "support_access_out_of_scope"

    catalogue = await client.get(f"{PREFIX}/business/{business.id}/catalog-items", headers=entete)
    assert catalogue.status_code == 200, catalogue.text


async def test_un_ecran_qu_aucune_portee_ne_nomme_reste_ferme(
    session: AsyncSession, client: AsyncClient
) -> None:
    """**Le sens du refus quand on n'a rien classé.**

    La reprise est ouverte sur *toutes* les portées qui existent, et la requête
    est refusée quand même : la liste des reprises du salon ne relève d'aucun
    écran déclaré. C'est le sens qui refuse, et il se voit — un écran neuf que
    personne n'a classé bloque le support à la première tentative. Le sens
    inverse ouvrirait une porte que personne n'a déclarée, et rien ne le dirait
    jamais.

    **La portée entière est ce qui rend ce décor divergent** : avec une portée
    étroite, un service qui laisse passer l'inclassable et un service qui le
    refuse rendraient tous deux 403, pour deux raisons différentes.
    """
    business, _ = await commerce_en_cours(session)
    admin = await administrateur(session)
    await service.ouvrir(
        session,
        business=business,
        admin=admin,
        motif="tout ouvrir",
        portee=list(PorteeDeReprise),
    )
    await session.commit()
    entete = await _jetons(client, admin)

    reponse = await client.get(f"{PREFIX}/business/{business.id}/support-access", headers=entete)

    assert reponse.status_code == 403, reponse.text
    assert reponse.json()["detail"] == "support_access_out_of_scope"


async def test_une_portee_vide_est_refusee(session: AsyncSession) -> None:
    """Une portée vide ouvrirait tout ou rien, et les deux sont mauvais."""
    business, _ = await commerce_en_cours(session)
    admin = await administrateur(session)

    with pytest.raises(service.ScopeRequired):
        await service.ouvrir(session, business=business, admin=admin, motif="un motif", portee=[])

    assert await session.scalar(sa.select(sa.literal(1))) == 1


async def test_la_portee_declaree_est_celle_qu_on_relit(
    session: AsyncSession, client: AsyncClient
) -> None:
    """Ce que le salon lit est ce qui a été déclaré — dédoublonné et ordonné.

    L'ordre des cases cochées ne doit pas changer ce que le gérant lit d'une
    reprise à l'autre.
    """
    business, proprietaire = await commerce_en_cours(session)
    admin = await administrateur(session)
    await service.ouvrir(
        session,
        business=business,
        admin=admin,
        motif="deux écrans",
        portee=[
            PorteeDeReprise.CHIFFRES,
            PorteeDeReprise.AGENDA,
            PorteeDeReprise.CHIFFRES,
        ],
    )
    await session.commit()

    reponse = await client.get(
        f"{PREFIX}/business/{business.id}/support-access",
        headers=await _jetons(client, proprietaire),
    )

    assert reponse.status_code == 200, reponse.text
    assert reponse.json()[0]["scope"] == ["agenda", "chiffres"]


# --------------------------------------------------------------------------
# le nom, la spontanéité, le compte
# --------------------------------------------------------------------------


async def test_le_nom_est_celui_du_jour_de_la_reprise(
    session: AsyncSession, client: AsyncClient
) -> None:
    """**Recopié, pas joint.** Le gérant qui relit une reprise de mars doit lire
    le nom qu'il a lu en mars.

    Le sabotage est un renommage après coup : une lecture par jointure suivrait
    le nouveau nom, une copie non. Sans ce décor, les deux implémentations
    rendraient la même chose et le test ne prouverait rien.
    """
    business, proprietaire = await commerce_en_cours(session)
    admin = await administrateur(session)
    admin.display_name = "Amélie R."
    await session.flush()
    await service.ouvrir(session, business=business, admin=admin, motif="un motif", portee=PORTEE)
    admin.display_name = "Amélie Rousseau"
    await session.commit()

    reponse = await client.get(
        f"{PREFIX}/business/{business.id}/support-access",
        headers=await _jetons(client, proprietaire),
    )

    assert reponse.status_code == 200, reponse.text
    ligne = reponse.json()[0]
    assert ligne["admin_name"] == "Amélie R."
    # **Et l'identifiant ne sort plus.** Un UUID affiché à un gérant ne nomme
    # personne, et le servir à côté du nom inviterait à le montrer.
    assert "admin_user_id" not in ligne


async def test_un_administrateur_sans_nom_ne_laisse_pas_un_vide(
    session: AsyncSession, client: AsyncClient
) -> None:
    """Le repli neutre dit au moins de qui il s'agit — de nous."""
    business, proprietaire = await commerce_en_cours(session)
    admin = await administrateur(session)
    await service.ouvrir(session, business=business, admin=admin, motif="un motif", portee=PORTEE)
    await session.commit()

    reponse = await client.get(
        f"{PREFIX}/business/{business.id}/support-access",
        headers=await _jetons(client, proprietaire),
    )

    assert reponse.json()[0]["admin_name"] == service.NOM_PAR_DEFAUT


async def test_le_silence_vaut_de_ma_propre_initiative(
    session: AsyncSession, client: AsyncClient
) -> None:
    """**Le défaut est le sens inconfortable.**

    Aucun canal ne permet au salon d'écrire, donc rien ne prouve qu'il a
    demandé. Le défaut est `spontaneous`, et c'est celui qui affirme avoir été
    appelé qui doit le dire. L'inverse laisserait toute reprise se présenter
    comme sollicitée sans que personne ne l'ait sollicitée.
    """
    business, _ = await commerce_en_cours(session)
    admin = await administrateur(session)
    await session.commit()
    entete = await _jetons(client, admin)

    tue = await client.post(
        f"{PREFIX}/admin/businesses/{business.id}/support-access",
        headers=entete,
        json={"reason": "personne ne m'a rien demandé", "scope": ["fiche"]},
    )
    assert tue.status_code == 201, tue.text
    assert tue.json()["spontaneous"] is True

    await client.delete(f"{PREFIX}/admin/businesses/{business.id}/support-access", headers=entete)
    appele = await client.post(
        f"{PREFIX}/admin/businesses/{business.id}/support-access",
        headers=entete,
        json={"reason": "le salon a appelé", "scope": ["fiche"], "spontaneous": False},
    )
    assert appele.status_code == 201, appele.text
    assert appele.json()["spontaneous"] is False


async def test_le_compte_des_reprises_traverse_les_salons_et_s_arrete_a_la_fenetre(
    session: AsyncSession,
) -> None:
    """**Tous salons confondus, et sur la fenêtre seulement.**

    Trois reprises : deux chez des salons différents cette semaine, une
    troisième posée avant la fenêtre. Le décor diverge des deux implémentations
    fautives à la fois — celle qui ne compterait que le salon courant rendrait
    un, celle qui ignorerait la fenêtre rendrait trois.

    Les closes comptent : ce qu'on mesure est le geste, pas la porte encore
    ouverte. N'additionner que les vivantes rendrait toujours un ou zéro, et ne
    mesurerait plus rien.
    """
    chez_a, _ = await commerce_en_cours(session)
    chez_b, _ = await commerce_en_cours(session)
    chez_c, _ = await commerce_en_cours(session)
    admin = await administrateur(session)

    premiere = await service.ouvrir(
        session, business=chez_a, admin=admin, motif="premier", portee=PORTEE
    )
    await service.fermer(session, acces=premiere, acteur=admin)
    await service.ouvrir(session, business=chez_b, admin=admin, motif="second", portee=PORTEE)

    fenetre = get_settings().support_access_recent_window_seconds
    ancienne = await service.ouvrir(
        session, business=chez_c, admin=admin, motif="le mois dernier", portee=PORTEE
    )
    # **Reculée après coup, et par une écriture directe.** `started_at` vient de
    # `clock_timestamp()` et la contrainte exige `expires_at > started_at` :
    # ouvrir avec une heure passée ferait échouer l'insertion elle-même, ce qui
    # éprouverait la contrainte et non la fenêtre.
    await session.execute(
        sa.update(BusinessSupportAccess)
        .where(BusinessSupportAccess.id == ancienne.id)
        .values(started_at=datetime.now(UTC) - timedelta(seconds=fenetre + 3600))
    )

    assert await service.reprises_recentes(session, admin_user_id=admin.id) == 2


async def test_l_ouverture_rend_le_compte_de_l_appelant(
    session: AsyncSession, client: AsyncClient
) -> None:
    """Celui qui ouvre la deuxième de la journée le lit en ouvrant la deuxième.

    Une reprise se justifie une par une, et c'est ce qui empêche d'en voir
    l'ensemble. Celle qu'on vient d'ouvrir compte dans le total : la lire à zéro
    le jour de la première serait exact et inutile.
    """
    chez_a, _ = await commerce_en_cours(session)
    chez_b, _ = await commerce_en_cours(session)
    admin = await administrateur(session)
    await session.commit()
    entete = await _jetons(client, admin)

    for business in (chez_a, chez_b):
        reponse = await client.post(
            f"{PREFIX}/admin/businesses/{business.id}/support-access",
            headers=entete,
            json={"reason": "un motif", "scope": ["fiche"]},
        )
        assert reponse.status_code == 201, reponse.text

    assert reponse.json()["reprises_recentes_de_l_appelant"] == 2
    assert reponse.json()["fenetre_en_jours"] == (
        get_settings().support_access_recent_window_seconds // 86_400
    )


# --------------------------------------------------------------------------
# le salon referme
# --------------------------------------------------------------------------


async def test_le_salon_referme_et_la_porte_tombe_dans_la_seconde(
    session: AsyncSession, client: AsyncClient
) -> None:
    """**« L'accès se ferme sans discussion » ne tenait pas.**

    Seule la porte d'administration savait se refermer : le gérant qui n'était
    pas d'accord n'avait qu'un numéro à appeler. Une garantie qui suppose qu'on
    décroche n'est pas une garantie.

    Le décor le prouve dans les deux sens : l'administrateur passe avant, il ne
    passe plus après. Ne vérifier que le 204 laisserait passer une route qui
    écrit `ended_at` sans que le résolveur en tienne compte.
    """
    business, proprietaire = await commerce_en_cours(session)
    admin = await administrateur(session)
    await service.ouvrir(session, business=business, admin=admin, motif="un motif", portee=PORTEE)
    await session.commit()
    cote_admin = await _jetons(client, admin)

    avant = await client.get(f"{PREFIX}/business/{business.id}", headers=cote_admin)
    assert avant.status_code == 200, avant.text

    ferme = await client.delete(
        f"{PREFIX}/business/{business.id}/support-access",
        headers=await _jetons(client, proprietaire),
    )
    assert ferme.status_code == 204, ferme.text

    apres = await client.get(f"{PREFIX}/business/{business.id}", headers=cote_admin)
    assert apres.status_code == 403, apres.text


async def test_le_salon_referme_toutes_les_reprises_pas_une(
    session: AsyncSession, client: AsyncClient
) -> None:
    """Lui demander laquelle serait lui demander de savoir combien sont entrés.

    Deux administrateurs, deux reprises vivantes. Une implémentation qui n'en
    fermerait qu'une — la plus récente, la sienne — laisserait la seconde
    ouverte, et le gérant croirait la porte close.
    """
    business, proprietaire = await commerce_en_cours(session)
    premier = await administrateur(session)
    second = await administrateur(session)
    for admin in (premier, second):
        await service.ouvrir(
            session, business=business, admin=admin, motif="un motif", portee=PORTEE
        )
    await session.commit()

    reponse = await client.delete(
        f"{PREFIX}/business/{business.id}/support-access",
        headers=await _jetons(client, proprietaire),
    )
    assert reponse.status_code == 204, reponse.text

    # **Relu en base, et non sur les objets de la session.** Ceux-ci portent
    # encore l'état d'avant la requête HTTP, qui a écrit dans une autre session
    # — les interroger dirait « toujours ouvertes » quoi qu'il arrive.
    business_id = business.id
    session.expire_all()
    assert await service.toutes_en_cours(session, business_id=business_id) == ()
    closes = await session.scalars(
        sa.select(BusinessSupportAccess.ended_at).where(
            BusinessSupportAccess.business_id == business_id
        )
    )
    assert all(fin is not None for fin in closes)


async def test_le_journal_dit_lequel_des_deux_a_referme(session: AsyncSession) -> None:
    """« Je suis ressorti » et « on m'a mis dehors » ne se relisent pas pareil.

    C'est le second qui devrait faire réfléchir à ce qu'on était venu faire, et
    un journal qui les confondrait effacerait exactement cela.
    """
    business, proprietaire = await commerce_en_cours(session)
    admin = await administrateur(session)
    sienne = await service.ouvrir(
        session, business=business, admin=admin, motif="la mienne", portee=PORTEE
    )
    await service.fermer(session, acces=sienne, acteur=admin)

    subie = await service.ouvrir(
        session, business=business, admin=admin, motif="l'autre", portee=PORTEE
    )
    await service.fermer(session, acces=subie, acteur=proprietaire)

    motifs = list(
        await session.scalars(
            sa.select(AuditLog.reason)
            .where(AuditLog.reason.in_([service.REASON_FERMEE, service.REASON_FERMEE_PAR_LE_SALON]))
            .order_by(AuditLog.occurred_at)
        )
    )
    assert motifs == [service.REASON_FERMEE, service.REASON_FERMEE_PAR_LE_SALON]


async def test_un_salon_ne_referme_pas_la_reprise_d_un_autre(
    session: AsyncSession, client: AsyncClient
) -> None:
    """La même fuite entre locataires, sur la route neuve."""
    chez_a, _ = await commerce_en_cours(session)
    _, proprietaire_b = await commerce_en_cours(session)
    admin = await administrateur(session)
    await service.ouvrir(session, business=chez_a, admin=admin, motif="un motif", portee=PORTEE)
    await session.commit()

    reponse = await client.delete(
        f"{PREFIX}/business/{chez_a.id}/support-access",
        headers=await _jetons(client, proprietaire_b),
    )

    assert reponse.status_code == 403, reponse.text
    # **L'identifiant est lu avant d'expirer la session.** `expire_all` rend
    # chaque attribut rechargeable, et le relire depuis un objet expiré déclenche
    # une lecture synchrone au milieu d'un test asynchrone — une panne qui ne
    # parle pas du sujet.
    chez_a_id = chez_a.id
    session.expire_all()
    assert len(await service.toutes_en_cours(session, business_id=chez_a_id)) == 1


async def test_refermer_quand_il_n_y_a_rien_ne_se_plaint_pas(
    session: AsyncSession, client: AsyncClient
) -> None:
    """« Il n'y avait rien à fermer » est le résultat voulu par quelqu'un qui
    veut être sûr que la porte est close."""
    business, proprietaire = await commerce_en_cours(session)
    await session.commit()

    reponse = await client.delete(
        f"{PREFIX}/business/{business.id}/support-access",
        headers=await _jetons(client, proprietaire),
    )

    assert reponse.status_code == 204, reponse.text


# --------------------------------------------------------------------------
# le compte, avant l'appui
# --------------------------------------------------------------------------


async def test_le_compte_se_lit_sans_avoir_choisi_de_salon(
    session: AsyncSession, client: AsyncClient
) -> None:
    """**Toute la raison de cette route : le nombre avant le geste.**

    Le même compte est déjà rendu par l'ouverture ; lu là, il retient pour la
    fois suivante — c'est-à-dire qu'il fait ce qu'un journal fait, et un journal
    enregistre un abus sans l'empêcher. Ce qui retient est de se comparer à
    soi-même pendant qu'on écrit encore le motif.

    **Le décor n'ouvre rien du tout après la lecture**, et c'est ce qui le rend
    probant : aucun identifiant de salon n'entre dans la requête, et le nombre
    est celui des reprises déjà faites ailleurs. Une route qui aurait besoin
    d'un salon ne pourrait pas répondre ici.
    """
    chez_a, _ = await commerce_en_cours(session)
    chez_b, _ = await commerce_en_cours(session)
    admin = await administrateur(session)
    for business in (chez_a, chez_b):
        await service.ouvrir(
            session, business=business, admin=admin, motif="un motif", portee=PORTEE
        )
    await session.commit()

    reponse = await client.get(
        f"{PREFIX}/admin/me/support-access/recent", headers=await _jetons(client, admin)
    )

    assert reponse.status_code == 200, reponse.text
    assert reponse.json()["reprises_recentes_de_l_appelant"] == 2
    assert reponse.json()["fenetre_en_jours"] == (
        get_settings().support_access_recent_window_seconds // 86_400
    )


async def test_le_compte_est_celui_de_l_appelant_et_non_celui_de_tous(
    session: AsyncSession, client: AsyncClient
) -> None:
    """**Se comparer à soi-même**, pas à la moyenne de l'équipe.

    Le décor pose deux administrateurs, l'un avec trois reprises et l'autre avec
    une. Un compte global rendrait quatre aux deux ; un compte par appelant rend
    trois et un. Sans le second administrateur, les deux implémentations
    rendraient le même nombre et rien ne serait éprouvé.
    """
    salons = [(await commerce_en_cours(session))[0] for _ in range(3)]
    prolixe = await administrateur(session)
    discret = await administrateur(session)
    for business in salons:
        await service.ouvrir(
            session, business=business, admin=prolixe, motif="un motif", portee=PORTEE
        )
    await service.ouvrir(
        session, business=salons[0], admin=discret, motif="un motif", portee=PORTEE
    )
    await session.commit()

    vu_par_prolixe = await client.get(
        f"{PREFIX}/admin/me/support-access/recent", headers=await _jetons(client, prolixe)
    )
    vu_par_discret = await client.get(
        f"{PREFIX}/admin/me/support-access/recent", headers=await _jetons(client, discret)
    )

    assert vu_par_prolixe.json()["reprises_recentes_de_l_appelant"] == 3
    assert vu_par_discret.json()["reprises_recentes_de_l_appelant"] == 1


async def test_la_lecture_et_l_ouverture_disent_le_meme_nombre(
    session: AsyncSession, client: AsyncClient
) -> None:
    """Les deux réponses partagent leurs champs, elles ne les recopient pas.

    **L'écran lit les deux à quelques secondes d'écart** — une fois en ouvrant
    le formulaire, une fois en le validant. Deux calculs indépendants
    finiraient par diverger, et le gérant du produit lirait alors deux vérités
    selon l'instant où il regarde. Le décor le vérifie sur la seule chose qui
    change entre les deux lectures : la reprise qu'on vient d'ouvrir.
    """
    business, _ = await commerce_en_cours(session)
    admin = await administrateur(session)
    await session.commit()
    entete = await _jetons(client, admin)

    avant = await client.get(f"{PREFIX}/admin/me/support-access/recent", headers=entete)
    assert avant.json()["reprises_recentes_de_l_appelant"] == 0

    ouverture = await client.post(
        f"{PREFIX}/admin/businesses/{business.id}/support-access",
        headers=entete,
        json={"reason": "un motif", "scope": ["fiche"]},
    )
    apres = await client.get(f"{PREFIX}/admin/me/support-access/recent", headers=entete)

    # Celle qu'on vient d'ouvrir compte des deux côtés : la lire à zéro le jour
    # de la première serait exact et inutile.
    assert ouverture.json()["reprises_recentes_de_l_appelant"] == 1
    assert apres.json()["reprises_recentes_de_l_appelant"] == 1
    assert apres.json()["fenetre_en_jours"] == ouverture.json()["fenetre_en_jours"]


async def test_seule_l_administration_lit_ce_compte(
    session: AsyncSession, client: AsyncClient
) -> None:
    """Un gérant n'a rien à savoir du rythme de nos interventions ailleurs."""
    _, proprietaire = await commerce_en_cours(session)
    await session.commit()

    reponse = await client.get(
        f"{PREFIX}/admin/me/support-access/recent",
        headers=await _jetons(client, proprietaire),
    )

    assert reponse.status_code == 403, reponse.text


# --------------------------------------------------------------------------
# la liste que l'administration parcourt
# --------------------------------------------------------------------------


async def test_l_administration_voit_les_salons_qui_ne_viennent_pas_du_terrain(
    session: AsyncSession, client: AsyncClient
) -> None:
    """**Le manque dépassait la mise en page.**

    L'écran de reprise était greffé sur la fiche de tournée : on ne pouvait
    reprendre que les salons **venus du terrain**. Un salon inscrit tout seul —
    ce que le produit veut rendre possible — était hors d'atteinte du support.

    Le décor en pose un qui n'a aucune fiche de tournée, ce qui est le cas de
    tous ceux montés par `commerce_en_cours`. Sans cette route, il n'apparaît
    nulle part côté administration.
    """
    business, _ = await commerce_en_cours(session)
    admin = await administrateur(session)
    await session.commit()

    reponse = await client.get(f"{PREFIX}/admin/businesses", headers=await _jetons(client, admin))

    assert reponse.status_code == 200, reponse.text
    identifiants = [ligne["business_id"] for ligne in reponse.json()]
    assert str(business.id) in identifiants


async def test_la_liste_dit_ou_l_appelant_est_deja_entre(
    session: AsyncSession, client: AsyncClient
) -> None:
    """**Sur l'appelant, et non sur le salon.**

    Le décor pose deux salons et une reprise sur un seul : c'est le seul
    montage où « je suis dedans » se distingue de « quelqu'un est dedans ».
    Savoir qu'un collègue est entré ne change pas ce que je peux faire, et
    l'afficher inviterait à se demander pourquoi lui plutôt que moi.
    """
    chez_a, _ = await commerce_en_cours(session)
    chez_b, _ = await commerce_en_cours(session)
    admin = await administrateur(session)
    collegue = await administrateur(session)
    await service.ouvrir(session, business=chez_a, admin=admin, motif="un motif", portee=PORTEE)
    await service.ouvrir(session, business=chez_b, admin=collegue, motif="un motif", portee=PORTEE)
    await session.commit()

    reponse = await client.get(f"{PREFIX}/admin/businesses", headers=await _jetons(client, admin))

    par_salon = {ligne["business_id"]: ligne["reprise_en_cours"] for ligne in reponse.json()}
    assert par_salon[str(chez_a.id)] is True
    assert par_salon[str(chez_b.id)] is False


async def test_la_recherche_trouve_sans_accent_ni_casse(
    session: AsyncSession, client: AsyncClient
) -> None:
    """C'est ainsi qu'on cherche un salon dont on a entendu le nom au téléphone."""
    business, _ = await commerce_en_cours(session)
    await session.execute(
        sa.update(Business).where(Business.id == business.id).values(name="Panadería del Sol")
    )
    admin = await administrateur(session)
    await session.commit()

    reponse = await client.get(
        f"{PREFIX}/admin/businesses",
        params={"recherche": "panaderia"},
        headers=await _jetons(client, admin),
    )

    assert reponse.status_code == 200, reponse.text
    assert [ligne["name"] for ligne in reponse.json()] == ["Panadería del Sol"]


async def test_un_salon_ne_lit_pas_la_liste_des_salons(
    session: AsyncSession, client: AsyncClient
) -> None:
    """Elle nomme tous les commerces du produit : ce n'est pas une liste que
    le voisin consulte."""
    _, proprietaire = await commerce_en_cours(session)
    await session.commit()

    reponse = await client.get(
        f"{PREFIX}/admin/businesses", headers=await _jetons(client, proprietaire)
    )

    assert reponse.status_code == 403, reponse.text
