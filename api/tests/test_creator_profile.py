"""Profil créateur en écriture.

Le test central n'est pas celui de la mise à jour : c'est celui qui compare les
colonnes personnelles du modèle à ce que l'anonymisation efface. Il est écrit
pour tomber le jour où quelqu'un ajoutera un champ personnel sans l'ajouter à
l'effacement — c'est-à-dire au moment où personne ne pensera à le vérifier.

Le reste porte sur la conséquence de cette tâche pour la vérification de
cohérence : le signal du nom avait été écrit avant la route qui l'alimente, il
cesse aujourd'hui d'être neutre.
"""

import uuid

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import CreatorProfile, SocialAccount, User
from app.models.enums import (
    Platform,
    SocialAccountStatus,
    UserRole,
    VerificationStatus,
)
from app.services import account_verification as verification
from app.services import anonymization as anonymization_service
from app.services import auth as auth_service
from app.services import creator_profile as service
from app.services import metrics as metrics_service
from app.services.audit import Actor
from tests.test_social_metrics import FauxFournisseur, metriques

PREFIX = get_settings().api_v1_prefix

#: Colonnes de `creator_profile` qui ne sont **pas** des données personnelles,
#: chacune avec sa raison. C'est la seule liste écrite à la main de ce fichier,
#: et elle est faite pour rester courte : tout ce qui n'y figure pas doit être
#: effacé par l'anonymisation.
NON_PERSONNEL = {
    # La clé. La ligne survit à l'anonymisation, l'historique la référence.
    "user_id",
    # Faits sur des collaborations qui ont eu lieu, pas données identifiantes.
    "reliability_score",
    "completed_collabs_count",
    # Dérivée de `reliability_score`, générée par la base.
    "is_new_creator",
    # La marque de l'anonymisation elle-même.
    "anonymized_at",
    # Date de création de la ligne, pas de la personne.
    "created_at",
}


async def creer_createur(session: AsyncSession, **profil) -> CreatorProfile:
    user = await auth_service.register(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password="tourbillon-cactus-91-vermeil",
        role=UserRole.CREATOR,
    )
    if profil:
        await service.update_profile(session, user_id=user.id, modifications=profil)
    return await service.get_profile(session, user.id)


async def connecte(client: AsyncClient, role: UserRole = UserRole.CREATOR) -> dict:
    email, password = f"{uuid.uuid4()}@example.com", "tourbillon-cactus-91-vermeil"
    cree = await client.post(
        f"{PREFIX}/auth/register",
        json={"email": email, "password": password, "role": role.value},
    )
    assert cree.status_code == 201, cree.text
    jetons = (
        await client.post(f"{PREFIX}/auth/login", json={"email": email, "password": password})
    ).json()
    return {
        "user_id": uuid.UUID(cree.json()["id"]),
        "headers": {"Authorization": f"Bearer {jetons['access_token']}"},
    }


# --------------------------------------------------------------------------
# écriture par le titulaire
# --------------------------------------------------------------------------


async def test_un_createur_renseigne_ses_quatre_champs(client: AsyncClient) -> None:
    createur = await connecte(client)

    reponse = await client.patch(
        f"{PREFIX}/me/profile",
        json={
            "first_name": "Rebecca",
            "last_name": "Alvarez",
            "city": "Wynwood",
            "bio": "Beauté et bien-être à Miami.",
        },
        headers=createur["headers"],
    )

    assert reponse.status_code == 200, reponse.text
    corps = reponse.json()
    assert corps["first_name"] == "Rebecca"
    assert corps["last_name"] == "Alvarez"
    assert corps["city"] == "Wynwood"
    assert corps["bio"] == "Beauté et bien-être à Miami."

    relu = await client.get(f"{PREFIX}/me/profile", headers=createur["headers"])
    assert relu.json() == corps


async def test_un_createur_ne_modifie_que_son_profil(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Il n'y a pas d'identifiant dans l'URL : la question n'est pas « le contrôle
    de propriétaire est-il correct », c'est « peut-on seulement formuler la
    requête ». Ce test vérifie qu'écrire depuis un compte ne touche que celui-là.
    """
    premier = await connecte(client)
    second = await connecte(client)

    await client.patch(
        f"{PREFIX}/me/profile", json={"first_name": "Rebecca"}, headers=premier["headers"]
    )
    await client.patch(
        f"{PREFIX}/me/profile", json={"first_name": "Mateo"}, headers=second["headers"]
    )

    assert (await client.get(f"{PREFIX}/me/profile", headers=premier["headers"])).json()[
        "first_name"
    ] == "Rebecca"
    assert (await client.get(f"{PREFIX}/me/profile", headers=second["headers"])).json()[
        "first_name"
    ] == "Mateo"

    # Et aucune route ne prend un identifiant de profil : la forme de l'API
    # exclut la question.
    chemins = [c for c in client._transport.app.openapi()["paths"] if "profile" in c]  # noqa: SLF001
    assert chemins == [f"{PREFIX}/me/profile"]


async def test_un_champ_absent_n_est_pas_efface(client: AsyncClient) -> None:
    """Une mise à jour partielle ne doit pas effacer par omission."""
    createur = await connecte(client)
    await client.patch(
        f"{PREFIX}/me/profile",
        json={"first_name": "Rebecca", "last_name": "Alvarez", "city": "Wynwood"},
        headers=createur["headers"],
    )

    apres = await client.patch(
        f"{PREFIX}/me/profile", json={"city": "Brickell"}, headers=createur["headers"]
    )

    assert apres.json()["city"] == "Brickell"
    assert apres.json()["first_name"] == "Rebecca"
    assert apres.json()["last_name"] == "Alvarez"


async def test_un_champ_envoye_a_null_est_efface(client: AsyncClient) -> None:
    """Le pendant du test précédent. Retirer sa bio est un geste légitime."""
    createur = await connecte(client)
    await client.patch(
        f"{PREFIX}/me/profile", json={"bio": "Un texte."}, headers=createur["headers"]
    )

    apres = await client.patch(
        f"{PREFIX}/me/profile", json={"bio": None}, headers=createur["headers"]
    )

    assert apres.json()["bio"] is None


async def test_une_chaine_vide_vaut_pas_renseigne(client: AsyncClient) -> None:
    """Sinon le signal du nom se croirait jugeable avec rien à comparer."""
    createur = await connecte(client)

    reponse = await client.patch(
        f"{PREFIX}/me/profile",
        json={"first_name": "   ", "last_name": "", "city": "  Miami  "},
        headers=createur["headers"],
    )

    assert reponse.json()["first_name"] is None
    assert reponse.json()["last_name"] is None
    # Et les espaces autour d'une vraie valeur sont retirés.
    assert reponse.json()["city"] == "Miami"


async def test_un_champ_non_modifiable_est_refuse_pas_ignore(client: AsyncClient) -> None:
    """Un champ silencieusement écarté ferait croire qu'il a été pris en compte."""
    createur = await connecte(client)

    reponse = await client.patch(
        f"{PREFIX}/me/profile",
        json={"first_name": "Rebecca", "reliability_score": 99},
        headers=createur["headers"],
    )

    assert reponse.status_code == 422
    # Et rien n'a été écrit au passage.
    assert (await client.get(f"{PREFIX}/me/profile", headers=createur["headers"])).json()[
        "first_name"
    ] is None


async def test_le_profil_n_est_pas_ouvert_aux_autres_roles(client: AsyncClient) -> None:
    commerce = await connecte(client, UserRole.BUSINESS_MEMBER)

    assert (
        await client.get(f"{PREFIX}/me/profile", headers=commerce["headers"])
    ).status_code == 403


# --------------------------------------------------------------------------
# anonymisation — le test qui doit tomber tout seul
# --------------------------------------------------------------------------


async def test_l_anonymisation_efface_tout_ce_qui_est_personnel(
    session: AsyncSession,
) -> None:
    """Par comparaison, pas par liste recopiée.

    Les colonnes examinées sont celles du modèle, moins une courte liste de
    colonnes explicitement non personnelles. Ajouter un champ personnel au
    profil sans l'ajouter à l'effacement fait tomber ce test — c'est tout son
    intérêt, puisque personne n'ira le mettre à jour à ce moment-là.

    Une liste de champs à vérifier, recopiée à côté de celle du service, aurait
    exactement le défaut inverse : elle serait toujours d'accord avec ce qu'on
    vient d'écrire.
    """
    profil = await creer_createur(
        session,
        first_name="Rebecca",
        last_name="Alvarez",
        city="Wynwood",
        bio="Beauté et bien-être à Miami.",
    )
    user_id = profil.user_id

    # `geo` n'est pas écrit par le service — cette tâche ne l'alimente pas — mais
    # il est personnel et l'anonymisation l'efface. Il est donc posé ici en
    # direct : sans cela, son effacement porterait sur une colonne déjà nulle et
    # ne prouverait rien. C'est l'assertion de complétude ci-dessous qui l'a
    # signalé, et c'est exactement son rôle.
    await session.execute(
        sa.update(CreatorProfile)
        .where(CreatorProfile.user_id == user_id)
        .values(geo="SRID=4326;POINT(-80.1918 25.7617)")
    )
    await session.flush()

    colonnes = {c.name for c in CreatorProfile.__table__.columns}
    personnelles = colonnes - NON_PERSONNEL
    assert personnelles, "aucune colonne personnelle : la liste d'exclusion a tout avalé"

    # Toutes renseignées avant, sans quoi l'effacement ne prouverait rien.
    avant = (
        await session.execute(
            sa.select(*[CreatorProfile.__table__.c[nom] for nom in sorted(personnelles)]).where(
                CreatorProfile.user_id == user_id
            )
        )
    ).one()
    non_posees = [
        nom for nom, valeur in zip(sorted(personnelles), avant, strict=True) if valeur is None
    ]
    assert not non_posees, (
        f"colonnes personnelles jamais renseignées par ce test : {non_posees}. "
        "Le jeu de départ doit les poser, sinon leur effacement ne prouve rien."
    )

    user = await session.get(User, user_id)
    await anonymization_service.anonymize_account(session, user=user, actor=Actor.from_user(user))

    apres = (
        await session.execute(
            sa.select(*[CreatorProfile.__table__.c[nom] for nom in sorted(personnelles)]).where(
                CreatorProfile.user_id == user_id
            )
        )
    ).one()
    restantes = [
        nom for nom, valeur in zip(sorted(personnelles), apres, strict=True) if valeur is not None
    ]
    assert not restantes, f"champs personnels non effacés par l'anonymisation : {restantes}"


async def test_un_profil_anonymise_ne_se_reecrit_pas(session: AsyncSession) -> None:
    profil = await creer_createur(session, first_name="Rebecca")
    user = await session.get(User, profil.user_id)
    await anonymization_service.anonymize_account(session, user=user, actor=Actor.from_user(user))

    with pytest.raises(service.ProfileAnonymized):
        await service.update_profile(
            session, user_id=profil.user_id, modifications={"first_name": "Rebecca"}
        )

    # La session reste utilisable, et le champ n'est pas revenu.
    assert (
        await session.scalar(
            sa.select(CreatorProfile.first_name).where(CreatorProfile.user_id == profil.user_id)
        )
        is None
    )


async def test_le_trigger_refuse_de_remplir_un_champ_efface(session: AsyncSession) -> None:
    """En SQL direct, sans passer par le service qu'il double.

    Vérifié au travers du service, il ne prouverait rien : c'est justement pour
    les chemins d'écriture qui ne passent pas par lui qu'il existe.
    """
    profil = await creer_createur(session, first_name="Rebecca")
    user = await session.get(User, profil.user_id)
    await anonymization_service.anonymize_account(session, user=user, actor=Actor.from_user(user))
    await session.commit()

    with pytest.raises(Exception, match="champ personnel"):
        async with session.begin_nested():
            await session.execute(
                sa.text("UPDATE creator_profile SET first_name = 'Rebecca' WHERE user_id = :u"),
                {"u": profil.user_id},
            )

    with pytest.raises(Exception, match="irreversible"):
        async with session.begin_nested():
            await session.execute(
                sa.text("UPDATE creator_profile SET anonymized_at = NULL WHERE user_id = :u"),
                {"u": profil.user_id},
            )

    # Et l'inverse : ce qui n'est pas personnel reste modifiable, sans quoi la
    # contrainte refuserait tout et passerait le test de refus sans rien garantir.
    async with session.begin_nested():
        await session.execute(
            sa.text("UPDATE creator_profile SET completed_collabs_count = 3 WHERE user_id = :u"),
            {"u": profil.user_id},
        )
    assert (
        await session.scalar(
            sa.select(CreatorProfile.completed_collabs_count).where(
                CreatorProfile.user_id == profil.user_id
            )
        )
        == 3
    )


# --------------------------------------------------------------------------
# conséquence : le signal du nom cesse d'être neutre
# --------------------------------------------------------------------------


async def compte_social(session: AsyncSession, profil: CreatorProfile, **overrides):
    valeurs = {
        "creator_id": profil.user_id,
        "platform": Platform.INSTAGRAM,
        "external_id": f"1784140{uuid.uuid4().int % 10**10}",
        "handle": "rebecca.miami",
        "access_token_encrypted": "IGQVJXY-jeton",
        "status": SocialAccountStatus.ACTIVE,
        "verification_status": VerificationStatus.NEEDS_REVIEW,
    }
    compte = SocialAccount(**(valeurs | overrides))
    session.add(compte)
    await session.flush()
    return compte


async def relever(session: AsyncSession, compte, **chiffres) -> None:
    compte.last_synced_at = compte.last_sync_attempt_at = None
    await metrics_service.refresh_profile_metrics(
        session, account=compte, provider=FauxFournisseur(rend=metriques(**chiffres))
    )


def verdict_du_nom(coherence) -> verification.VerdictSignal:
    return next(
        c.verdict for c in coherence.constats if c.signal is verification.Signal.NOM_DECLARE
    )


async def test_le_signal_du_nom_est_neutre_sans_nom_et_juge_avec(
    session: AsyncSession,
) -> None:
    """La comparaison était écrite avant la route qui l'alimente. Elle compte
    aujourd'hui, sans qu'une ligne ait changé dans la vérification."""
    profil = await creer_createur(session)
    compte = await compte_social(session, profil)

    sans_nom = verification.evaluer(await verification.charger(session, compte), get_settings())
    assert verdict_du_nom(sans_nom) is verification.VerdictSignal.IGNORE_MECANISME_ABSENT

    await service.update_profile(
        session, user_id=profil.user_id, modifications={"first_name": "Rebecca"}
    )

    avec_nom = verification.evaluer(await verification.charger(session, compte), get_settings())
    assert verdict_du_nom(avec_nom) is verification.VerdictSignal.TENU
    # La permissivité n'a pas changé : un fragment du nom dans le pseudonyme
    # suffit toujours.
    assert verification.nom_present_dans_handle("Rebecca", None, "rebecca.miami")


async def test_un_compte_en_revue_gagne_un_signal_juge(session: AsyncSession) -> None:
    """C'est ce que la tâche apporte à la vérification : un signal de plus
    réellement examiné, là où il n'y en avait qu'un."""
    profil = await creer_createur(session)
    compte = await compte_social(session, profil)
    await relever(session, compte, followers_count=90_000, media_count=14)

    assert compte.verification_status is VerificationStatus.NEEDS_REVIEW
    avant = verification.evaluer(await verification.charger(session, compte), get_settings())
    juges_avant = len(avant.juges)

    await service.update_profile(
        session, user_id=profil.user_id, modifications={"first_name": "Rebecca"}
    )
    await relever(session, compte, followers_count=90_000, media_count=14)

    apres = verification.evaluer(await verification.charger(session, compte), get_settings())
    assert len(apres.juges) == juges_avant + 1
    assert verdict_du_nom(apres) is verification.VerdictSignal.TENU


async def test_un_nom_discordant_retient_sans_rejeter(session: AsyncSession) -> None:
    """Le pendant du test précédent : le signal doit aussi savoir manquer."""
    profil = await creer_createur(session)
    compte = await compte_social(session, profil, handle="luxe.watches.deals")
    await service.update_profile(
        session,
        user_id=profil.user_id,
        modifications={"first_name": "Rebecca", "last_name": "Alvarez"},
    )

    await relever(session, compte, followers_count=12_400, media_count=208)

    coherence = verification.evaluer(await verification.charger(session, compte), get_settings())
    assert verdict_du_nom(coherence) is verification.VerdictSignal.MANQUE
    # Retenu, jamais rejeté : le rejet reste la seule affaire de l'administration.
    assert compte.verification_status is VerificationStatus.NEEDS_REVIEW


async def test_un_compte_verified_n_est_pas_redescendu_par_un_nom_discordant(
    session: AsyncSession,
) -> None:
    """Le nom devient comparable après coup : cela ne doit pas défaire une
    vérification déjà prononcée. Le contrôle ne descend jamais."""
    profil = await creer_createur(session)
    compte = await compte_social(session, profil, handle="luxe.watches.deals")
    await relever(session, compte, followers_count=12_400, media_count=208)
    assert compte.verification_status is VerificationStatus.VERIFIED

    await service.update_profile(
        session,
        user_id=profil.user_id,
        modifications={"first_name": "Rebecca", "last_name": "Alvarez"},
    )
    await relever(session, compte, followers_count=12_400, media_count=208)

    assert compte.verification_status is VerificationStatus.VERIFIED
    # Et le contrôle a bien vu la discordance : il ne l'a simplement pas suivie.
    coherence = verification.evaluer(await verification.charger(session, compte), get_settings())
    assert verdict_du_nom(coherence) is verification.VerdictSignal.MANQUE
    assert coherence.verifiable is False


async def test_l_ecriture_du_profil_ne_declenche_aucune_reexecution(
    session: AsyncSession,
) -> None:
    """Renseigner son nom ne re-vérifie rien tout seul : le contrôle s'accroche
    au relevé de métriques, et lui seul. Sans quoi une frappe dans un champ de
    formulaire appellerait Meta."""
    profil = await creer_createur(session)
    compte = await compte_social(session, profil)
    await relever(session, compte, followers_count=90_000, media_count=14)
    reviewed = compte.verification_reviewed_at

    await service.update_profile(
        session, user_id=profil.user_id, modifications={"first_name": "Rebecca"}
    )

    assert compte.verification_status is VerificationStatus.NEEDS_REVIEW
    assert compte.verification_reviewed_at == reviewed


async def test_la_ville_n_est_pas_derivee_de_geo(session: AsyncSession) -> None:
    """Déclarée, champ libre. Miami compte assez de quartiers nommés pour
    qu'une liste fermée soit fausse dès le premier jour."""
    profil = await creer_createur(session, city="Little Haiti")

    assert profil.city == "Little Haiti"
    # `geo` n'est pas alimenté par cette tâche : il viendra avec le fil de la
    # phase 5 et son contournement manuel de géocodage.
    assert profil.geo is None

    for quartier in ("Wynwood", "Brickell", "Coconut Grove", "Little Havana"):
        maj = await service.update_profile(
            session, user_id=profil.user_id, modifications={"city": quartier}
        )
        assert maj.city == quartier
        assert maj.geo is None
