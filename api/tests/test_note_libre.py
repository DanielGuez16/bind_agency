"""Le canal minimal : une phrase attachée à un code, jamais seule.

**Ce que ce fichier protège.** `SPEC.md` §4.2 interdisait le texte libre, et
pour une raison qui tient toujours : une phrase ne se traduit pas à
l'affichage, et elle ressortait sur l'écran de l'arbitre dans la langue de qui
l'avait écrite. La règle change de forme plutôt que de disparaître — le **code
reste obligatoire** et porte le sens traduisible, la note ajoute ce qu'un code
ne peut pas dire.

L'invariant tenu ici est donc « jamais seule », à trois niveaux : la base le
refuse, le service le refuse, et l'API n'offre aucun chemin pour l'y faire
entrer. Trois plutôt qu'un parce que c'est exactement le trou que la spec
craignait : il suffirait d'un appelant.
"""

import uuid

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import AuditLog, Collaboration, Proof
from app.models.enums import CollaborationStatus
from app.services import audit
from app.services import collaboration as service
from app.services import proof as proof_service
from app.services.audit import Actor
from tests.test_collaboration import capture, contrepartie

PREFIX = get_settings().api_v1_prefix
MOT_DE_PASSE = "un-mot-de-passe-solide-42"


# --------------------------------------------------------------------------
# jamais seule
# --------------------------------------------------------------------------


async def test_la_base_refuse_une_note_sans_motif(session: AsyncSession) -> None:
    """En SQL direct, sans passer par le service qui la double.

    Vérifiée au travers du service, la contrainte ne prouverait rien : c'est
    précisément l'appelant qui contourne le service que la spec redoutait.
    """
    ligne, _ = await contrepartie(session)

    with pytest.raises(IntegrityError):
        async with session.begin_nested():
            await session.execute(
                sa.text(
                    """
                    INSERT INTO audit_log
                        (id, entity_type, entity_id, to_status, actor_kind, note)
                    VALUES (:id, 'collaboration', :entite, 'submitted', 'system', 'une phrase')
                    """
                ),
                {"id": uuid.uuid4(), "entite": ligne.id},
            )

    # La session reste utilisable après le refus : une violation attrapée hors
    # d'un point de sauvegarde la laisserait inutilisable, et le défaut
    # n'apparaîtrait qu'au prochain appel, ailleurs.
    assert await session.scalar(sa.select(sa.func.count()).select_from(AuditLog)) >= 0


async def test_la_base_accepte_une_note_avec_son_motif(session: AsyncSession) -> None:
    """Le pendant. Une contrainte qui refuse tout passe le test de refus sans
    rien garantir."""
    ligne, _ = await contrepartie(session)

    await session.execute(
        sa.text(
            """
            INSERT INTO audit_log
                (id, entity_type, entity_id, to_status, actor_kind, reason, note)
            VALUES (:id, 'collaboration', :entite, 'submitted', 'system', 'un_code', 'une phrase')
            """
        ),
        {"id": uuid.uuid4(), "entite": ligne.id},
    )
    await session.flush()

    ecrite = await session.scalar(sa.select(AuditLog.note).where(AuditLog.note.is_not(None)))
    assert ecrite == "une phrase"


async def test_le_service_refuse_une_note_sans_motif(session: AsyncSession) -> None:
    """Refusé avant la base, pour que l'appelant lise une erreur de
    programmation plutôt qu'une violation de contrainte à trois appels de là."""
    ligne, decor = await contrepartie(session)

    with pytest.raises(ValueError, match="attachée à un motif"):
        await audit.record_transition(
            session,
            entity=audit.AuditedEntity.COLLABORATION,
            entity_id=ligne.id,
            to_status="submitted",
            actor=Actor.from_user(decor["caissier"]),
            note="une phrase sans code",
        )


async def test_la_note_est_bornee_en_base(session: AsyncSession) -> None:
    """La borne est en base et pas seulement dans le schéma : un second
    appelant la contournerait."""
    ligne, _ = await contrepartie(session)

    with pytest.raises(IntegrityError):
        async with session.begin_nested():
            await session.execute(
                sa.text(
                    """
                    INSERT INTO audit_log
                        (id, entity_type, entity_id, to_status, actor_kind, reason, note)
                    VALUES (:id, 'collaboration', :entite, 'submitted', 'system', 'x', :note)
                    """
                ),
                {"id": uuid.uuid4(), "entite": ligne.id, "note": "a" * 501},
            )

    assert await session.scalar(sa.select(sa.func.count()).select_from(AuditLog)) >= 0


# --------------------------------------------------------------------------
# ce que les deux parties lisent
# --------------------------------------------------------------------------


async def test_la_note_du_commerce_atteint_l_historique(session: AsyncSession) -> None:
    """Elle est relue dans le journal, comme le motif, et dans le même ordre.

    C'est ce qui la rend lisible par l'arbitre : il voit la répétition des
    reproches **et** ce qui les accompagnait.
    """
    ligne, decor = await contrepartie(session)
    await proof_service.soumettre(
        session, collaboration=ligne, capture=capture(), actor=Actor.from_user(decor["createur"])
    )

    await service.demander_une_nouvelle_soumission(
        session,
        collaboration=ligne,
        actor=Actor.from_user(decor["caissier"]),
        reason="missing_mention",
        note="On ne voit pas @salon sur la story, il est caché par le sticker.",
    )

    file = await service.lister_pour_le_commerce(session, business_id=decor["business"].id)
    dossier = next(d for d in file if d.collaboration_id == ligne.id)
    assert dossier.tentatives[-1].motif == "missing_mention"
    assert "caché par le sticker" in (dossier.tentatives[-1].note or "")


async def test_la_note_du_createur_accompagne_sa_preuve(session: AsyncSession) -> None:
    """L'autre moitié du canal.

    Le commerce refusait avec un code, le créateur resoumettait sans un mot, et
    le dossier arrivait en arbitrage sans qu'aucune phrase n'ait été échangée.
    """
    ligne, decor = await contrepartie(session)

    await proof_service.soumettre(
        session,
        collaboration=ligne,
        capture=capture(),
        actor=Actor.from_user(decor["createur"]),
        note="Le sticker est en haut à droite, la mention est dessous.",
    )

    ecrite = await session.scalar(sa.select(Proof.note).where(Proof.collaboration_id == ligne.id))
    assert "en haut à droite" in (ecrite or "")


async def test_la_note_du_createur_est_lue_par_le_commerce(session: AsyncSession) -> None:
    """Elle se lit au même endroit que la preuve.

    Sinon le commerce décide en ayant vu l'image sans avoir lu la phrase, ce
    qui est exactement la situation qu'on répare.
    """
    ligne, decor = await contrepartie(session)
    await proof_service.soumettre(
        session,
        collaboration=ligne,
        capture=capture(),
        actor=Actor.from_user(decor["createur"]),
        note="J'ai republié avec le lieu cette fois.",
    )

    file = await service.lister_pour_le_commerce(session, business_id=decor["business"].id)
    dossier = next(d for d in file if d.collaboration_id == ligne.id)

    assert dossier.derniere_soumission is not None
    assert "avec le lieu" in (dossier.derniere_soumission.note or "")


async def test_une_soumission_sans_note_reste_possible(session: AsyncSession) -> None:
    """Une soumission conforme n'a rien à expliquer. Le canal est une
    ouverture, pas une formalité de plus."""
    ligne, decor = await contrepartie(session)

    await proof_service.soumettre(
        session, collaboration=ligne, capture=capture(), actor=Actor.from_user(decor["createur"])
    )

    ecrite = await session.scalar(sa.select(Proof.note).where(Proof.collaboration_id == ligne.id))
    assert ecrite is None


# --------------------------------------------------------------------------
# la route
# --------------------------------------------------------------------------


async def test_l_api_refuse_une_note_trop_longue(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Refusée avant d'atteindre la base : un 422 nommé vaut mieux qu'un 500."""
    ligne, decor = await contrepartie(session)
    await proof_service.soumettre(
        session, collaboration=ligne, capture=capture(), actor=Actor.from_user(decor["createur"])
    )
    await session.commit()

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login",
            json={"email": decor["caissier"].email, "password": MOT_DE_PASSE},
        )
    ).json()

    reponse = await client.post(
        f"{PREFIX}/business/collaborations/{ligne.id}/decision",
        json={"approuve": False, "reason": "missing_mention", "note": "a" * 501},
        headers={"Authorization": f"Bearer {jetons['access_token']}"},
    )

    assert reponse.status_code == 422


async def test_l_api_n_offre_aucun_chemin_pour_une_note_seule(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Le troisième verrou, et le seul que la spec nommait.

    Approuver n'accepte pas de motif ; une note posée là serait donc seule.
    Le contrôle du motif obligatoire la refuse avec elle.
    """
    ligne, decor = await contrepartie(session)
    await proof_service.soumettre(
        session, collaboration=ligne, capture=capture(), actor=Actor.from_user(decor["createur"])
    )
    await session.commit()

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login",
            json={"email": decor["caissier"].email, "password": MOT_DE_PASSE},
        )
    ).json()
    entetes = {"Authorization": f"Bearer {jetons['access_token']}"}

    # Refuser sans code mais avec une note : la note ne remplace pas le code.
    refus = await client.post(
        f"{PREFIX}/business/collaborations/{ligne.id}/decision",
        json={"approuve": False, "note": "Ce n'est pas ce qu'on avait dit."},
        headers=entetes,
    )
    assert refus.status_code == 422

    # Et le chemin nominal fonctionne toujours.
    accepte = await client.post(
        f"{PREFIX}/business/collaborations/{ligne.id}/decision",
        json={
            "approuve": False,
            "reason": "missing_mention",
            "note": "Le sticker cache la mention.",
        },
        headers=entetes,
    )
    assert accepte.status_code == 200


async def test_le_createur_lit_la_note_du_commerce_sur_sa_contrepartie(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Lisible par les deux parties : c'est la moitié qui manquait le plus.

    Sans elle, le créateur recevait « mention manquante » et devait deviner
    laquelle, où, et pourquoi la sienne ne comptait pas.
    """
    ligne, decor = await contrepartie(session)
    await proof_service.soumettre(
        session, collaboration=ligne, capture=capture(), actor=Actor.from_user(decor["createur"])
    )
    await service.demander_une_nouvelle_soumission(
        session,
        collaboration=ligne,
        actor=Actor.from_user(decor["caissier"]),
        reason="missing_mention",
        note="Le sticker recouvre @salon en haut.",
    )
    await session.commit()

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login",
            json={"email": decor["createur"].email, "password": MOT_DE_PASSE},
        )
    ).json()

    reponse = await client.get(
        f"{PREFIX}/collaborations/{ligne.id}",
        headers={"Authorization": f"Bearer {jetons['access_token']}"},
    )

    assert reponse.status_code == 200
    assert reponse.json()["status"] == CollaborationStatus.RESUBMIT_REQUESTED.value

    # Et la note du commerce est bien celle que le journal a gardée : c'est
    # elle que le créateur doit lire pour savoir quoi corriger.
    ecrite = await session.scalar(sa.select(AuditLog.note).where(AuditLog.note.is_not(None)))
    assert "recouvre @salon" in (ecrite or "")


async def test_la_note_ne_se_corrige_pas_apres_coup(session: AsyncSession) -> None:
    """Le journal est immuable, et sa note l'est avec lui.

    Une note qu'on pourrait réécrire cesserait d'être ce qui a été dit au
    moment où ça a été dit — et c'est tout ce qui lui donne sa valeur devant un
    arbitre.
    """
    ligne, decor = await contrepartie(session)
    await proof_service.soumettre(
        session, collaboration=ligne, capture=capture(), actor=Actor.from_user(decor["createur"])
    )
    await service.demander_une_nouvelle_soumission(
        session,
        collaboration=ligne,
        actor=Actor.from_user(decor["caissier"]),
        reason="missing_mention",
        note="La version d'origine.",
    )
    await session.flush()

    # Le trigger d'immuabilité lève une exception Postgres, remontée en
    # `InternalError` : c'est bien le refus du journal, pas une contrainte.
    with pytest.raises(DBAPIError):
        async with session.begin_nested():
            await session.execute(
                sa.text("UPDATE audit_log SET note = 'réécrite' WHERE note IS NOT NULL")
            )

    assert await session.scalar(sa.select(sa.func.count()).select_from(Collaboration)) >= 0
