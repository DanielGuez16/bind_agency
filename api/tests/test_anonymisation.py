"""Anonymisation de compte.

Ce qui identifie disparaît, ce qui engage reste. Les vérifications sont faites
en base, colonne par colonne, et non au travers d'un schéma de sortie : un
schéma peut masquer un champ sans que la base l'ait effacé.
"""

import uuid
from datetime import UTC, datetime

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.exc import IntegrityError, InternalError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

from app.core.config import get_settings
from app.models import (
    AuditLog,
    Booking,
    Collaboration,
    CreatorProfile,
    RefreshToken,
    SocialAccount,
    SocialMetricsSnapshot,
    User,
)
from app.models.enums import (
    ActorKind,
    ContentFormat,
    Platform,
    SocialAccountStatus,
    UserRole,
    UserStatus,
)
from app.services import anonymization
from app.services.audit import Actor
from tests.factories import (
    PASSWORD,
    booking_insert,
    new_booking_graph,
    new_social_account,
    new_user,
)

PREFIX = get_settings().api_v1_prefix


async def compte_complet(session: AsyncSession, conn: AsyncConnection) -> dict:
    """Un créateur complet.

    Tout ce que l'anonymisation doit effacer, et tout ce qu'elle doit épargner.
    L'adresse est unique par appel : plusieurs comptes coexistent dans un même
    test sans se disputer l'unicité.
    """
    graph = await new_booking_graph(conn)
    creator_id = graph["creator_id"]
    email = f"rebecca-{uuid.uuid4().hex[:8]}@example.com"

    # **Le nom d'affichage est posé ici**, sans quoi son effacement ne prouve
    # rien : une colonne jamais renseignée est nulle avant comme après.
    await conn.execute(
        sa.update(User).where(User.id == creator_id).values(display_name="Rebecca A.")
    )
    await conn.execute(
        sa.update(CreatorProfile)
        .where(CreatorProfile.user_id == creator_id)
        .values(
            first_name="Rebecca",
            last_name="Alvarez",
            bio="Créatrice beauté à Miami",
            city="Miami",
            geo=sa.func.ST_GeogFromText("POINT(-80.1918 25.7617)"),
            completed_collabs_count=4,
        )
    )
    await conn.execute(
        sa.update(User).where(User.id == creator_id).values(email=email, phone="+13055550101")
    )
    await conn.execute(
        sa.insert(SocialMetricsSnapshot).values(
            social_account_id=graph["social_account_id"],
            followers_count=12000,
            following_count=300,
            media_count=210,
            raw_payload={"followers_count": 12000},
        )
    )

    booking_id = (await conn.execute(booking_insert(graph).returning(Booking.id))).scalar_one()
    collaboration_id = (
        await conn.execute(
            sa.insert(Collaboration)
            .values(
                booking_id=booking_id,
                tier_id=graph["tier_id"],
                required_format=ContentFormat.STORY,
                deadline_at=datetime.now(UTC),
            )
            .returning(Collaboration.id)
        )
    ).scalar_one()

    # La session n'a jamais chargé cette ligne : `get` la lit sur la même
    # connexion, donc voit ce que les écritures ci-dessus viennent d'y poser.
    # Surtout pas d'`expire_all` ici — il invaliderait les instances chargées
    # par un appel précédent, dont l'accès déclencherait une IO synchrone.
    user = await session.get(User, creator_id)

    return graph | {
        "user": user,
        "email": email,
        "booking_id": booking_id,
        "collaboration_id": collaboration_id,
    }


# --------------------------------------------------------------------------
# ce qui disparaît
# --------------------------------------------------------------------------


async def test_le_compte_perd_toute_donnee_personnelle(
    session: AsyncSession, conn: AsyncConnection
) -> None:
    contexte = await compte_complet(session, conn)
    user = contexte["user"]

    assert await anonymization.anonymize_account(session, user=user, actor=Actor.from_user(user))
    await session.flush()

    ligne = (
        await conn.execute(
            sa.select(User.email, User.phone, User.password_hash, User.status, User.locale).where(
                User.id == user.id
            )
        )
    ).one()
    ligne_complete = (
        await conn.execute(
            sa.select(
                User.date_of_birth, User.age_verified_at, User.age_minimum_applique
            ).where(User.id == user.id)
        )
    ).one()

    assert (ligne.email, ligne.phone, ligne.password_hash) == (None, None, None)
    assert ligne.status == UserStatus.ANONYMIZED
    # La langue n'identifie personne : elle reste.
    assert ligne.locale is not None
    # Et la date de naissance part, tandis que la preuve qu'on l'a vérifiée
    # reste : un fait sur ce qui a eu lieu n'est pas une donnée identifiante.
    assert ligne_complete.date_of_birth is None
    assert ligne_complete.age_verified_at is not None
    assert ligne_complete.age_minimum_applique is not None


#: Ce que `app_user` porte sans que cela désigne personne.
#:
#: **Écrit ici plutôt que déduit**, comme la table jumelle du profil créateur :
#: une liste dérivée du code qu'elle vérifie serait toujours d'accord avec lui.
NON_PERSONNEL_SUR_LE_COMPTE = {
    "id",  # la clé ; le journal d'audit la référence
    "role",  # ce qu'on faisait, pas qui on était
    "status",  # devient `anonymized`, c'est la marque elle-même
    "locale",  # une langue n'identifie personne
    "created_at",
    "last_login_at",  # un instant sans contenu
    "email_verified_at",  # le fait d'avoir vérifié, pas l'adresse
    "age_verified_at",  # idem, et c'est la preuve qu'on garde
    "age_minimum_applique",  # le seuil appliqué, un entier
    "favoris_me_previennent",  # une préférence, pas une identité
    "deletion_requested_at",
    "deletion_effective_at",
}


async def test_le_compte_n_a_aucune_colonne_personnelle_oubliee(
    session: AsyncSession, conn: AsyncConnection
) -> None:
    """Par comparaison de colonnes, et non par liste recopiée.

    **La garde manquait de ce côté-ci.** Le profil créateur en a une depuis
    toujours — ajouter un champ personnel sans l'ajouter à l'effacement y fait
    tomber le test — mais `app_user` n'avait qu'une liste écrite à la main, qui
    ne dit rien d'une colonne qu'on n'y a pas pensée. C'est par ce trou qu'une
    date de naissance non effacée serait passée en silence.

    **Et elle a trouvé quelque chose du premier coup.** `display_name` est
    déclaré nullable dans le modèle « pour que l'anonymisation puisse
    l'effacer », et `_strip_account` ne l'effaçait pas. Aucune liste recopiée
    ne pouvait le dire : elle ne parle que des colonnes qu'on y a pensées.
    """
    contexte = await compte_complet(session, conn)
    user = contexte["user"]

    colonnes = {c.name for c in User.__table__.columns}
    personnelles = colonnes - NON_PERSONNEL_SUR_LE_COMPTE
    assert personnelles, "la table jumelle doit rester une liste, pas tout absorber"

    avant = (
        await conn.execute(
            sa.select(*[User.__table__.c[nom] for nom in sorted(personnelles)]).where(
                User.id == user.id
            )
        )
    ).one()._mapping
    jamais_posees = [nom for nom, valeur in avant.items() if valeur is None]
    assert jamais_posees == [], (
        "colonnes personnelles jamais renseignées par ce test : "
        f"{jamais_posees}. Le décor doit les poser, sinon leur effacement ne prouve rien"
    )

    assert await anonymization.anonymize_account(session, user=user, actor=Actor.from_user(user))
    await session.flush()

    apres = (
        await conn.execute(
            sa.select(*[User.__table__.c[nom] for nom in sorted(personnelles)]).where(
                User.id == user.id
            )
        )
    ).one()._mapping
    restantes = [nom for nom, valeur in apres.items() if valeur is not None]
    assert restantes == [], f"colonnes personnelles non effacées : {restantes}"


async def test_le_profil_createur_est_vide_de_son_identite(
    session: AsyncSession, conn: AsyncConnection
) -> None:
    contexte = await compte_complet(session, conn)
    user = contexte["user"]

    await anonymization.anonymize_account(session, user=user, actor=Actor.from_user(user))
    await session.flush()

    profil = (
        await conn.execute(
            sa.select(
                CreatorProfile.first_name,
                CreatorProfile.last_name,
                CreatorProfile.bio,
                CreatorProfile.city,
                CreatorProfile.geo,
                CreatorProfile.anonymized_at,
                CreatorProfile.completed_collabs_count,
            ).where(CreatorProfile.user_id == user.id)
        )
    ).one()

    assert (profil.first_name, profil.last_name, profil.bio, profil.city, profil.geo) == (
        None,
        None,
        None,
        None,
        None,
    )
    assert profil.anonymized_at is not None
    # Le nombre de collaborations est un fait, pas une donnée identifiante.
    assert profil.completed_collabs_count == 4


async def test_les_comptes_sociaux_sont_vides_mais_conserves(
    session: AsyncSession, conn: AsyncConnection
) -> None:
    contexte = await compte_complet(session, conn)
    user = contexte["user"]

    await anonymization.anonymize_account(session, user=user, actor=Actor.from_user(user))
    await session.flush()

    compte = (
        await conn.execute(
            sa.select(
                SocialAccount.external_id,
                SocialAccount.handle,
                SocialAccount.access_token_encrypted,
                SocialAccount.refresh_token_encrypted,
                SocialAccount.granted_scopes,
                SocialAccount.status,
            ).where(SocialAccount.id == contexte["social_account_id"])
        )
    ).one()

    assert compte.external_id is None
    assert compte.handle is None
    assert compte.access_token_encrypted is None
    assert compte.refresh_token_encrypted is None
    assert compte.granted_scopes is None
    assert compte.status == SocialAccountStatus.REVOKED


async def test_les_snapshots_de_metriques_sont_supprimes(
    session: AsyncSession, conn: AsyncConnection
) -> None:
    contexte = await compte_complet(session, conn)
    user = contexte["user"]

    avant = await conn.scalar(sa.select(sa.func.count()).select_from(SocialMetricsSnapshot))
    assert avant == 1

    await anonymization.anonymize_account(session, user=user, actor=Actor.from_user(user))
    await session.flush()

    apres = await conn.scalar(sa.select(sa.func.count()).select_from(SocialMetricsSnapshot))
    assert apres == 0


async def test_toutes_les_sessions_sont_revoquees_avec_une_ligne_de_journal_chacune(
    session: AsyncSession, conn: AsyncConnection
) -> None:
    contexte = await compte_complet(session, conn)
    user = contexte["user"]
    await auth_tokens(session, user, combien=2)

    await anonymization.anonymize_account(session, user=user, actor=Actor.from_user(user))
    await session.flush()

    encore_actifs = await conn.scalar(
        sa.select(sa.func.count())
        .select_from(RefreshToken)
        .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
    )
    assert encore_actifs == 0

    revocations = await conn.scalar(
        sa.select(sa.func.count())
        .select_from(AuditLog)
        .where(
            AuditLog.entity_type == "refresh_token",
            AuditLog.to_status == "revoked",
            AuditLog.reason == anonymization.REASON,
        )
    )
    assert revocations == 2


async def auth_tokens(session: AsyncSession, user: User, *, combien: int) -> None:
    from app.services import auth as auth_service

    for _ in range(combien):
        await auth_service.issue_tokens(session, user)
    await session.flush()


# --------------------------------------------------------------------------
# ce qui reste
# --------------------------------------------------------------------------


async def test_l_historique_reste_intact_et_rattache(
    session: AsyncSession, conn: AsyncConnection
) -> None:
    """Un commerce ne perd pas son historique parce qu'un créateur exerce un droit."""
    contexte = await compte_complet(session, conn)
    user = contexte["user"]

    await anonymization.anonymize_account(session, user=user, actor=Actor.from_user(user))
    await session.flush()

    reservation = (
        await conn.execute(
            sa.select(Booking.creator_id, Booking.business_id, Booking.value_cents_snapshot).where(
                Booking.id == contexte["booking_id"]
            )
        )
    ).one()
    assert reservation.creator_id == user.id
    assert reservation.business_id == contexte["business_id"]
    assert reservation.value_cents_snapshot == 8000

    contrepartie = (
        await conn.execute(
            sa.select(Collaboration.booking_id).where(
                Collaboration.id == contexte["collaboration_id"]
            )
        )
    ).one()
    assert contrepartie.booking_id == contexte["booking_id"]


async def test_le_journal_garde_la_trace_et_nomme_le_demandeur(
    session: AsyncSession, conn: AsyncConnection
) -> None:
    contexte = await compte_complet(session, conn)
    user = contexte["user"]

    await anonymization.anonymize_account(session, user=user, actor=Actor.from_user(user))
    await session.flush()

    ligne = (
        await conn.execute(
            sa.select(AuditLog.__table__).where(
                AuditLog.entity_type == "app_user",
                AuditLog.to_status == UserStatus.ANONYMIZED.value,
            )
        )
    ).one()

    assert ligne.entity_id == user.id
    assert ligne.from_status == UserStatus.ACTIVE.value
    assert ligne.actor_user_id == user.id
    assert ligne.actor_kind == ActorKind.CREATOR
    assert ligne.reason == anonymization.REASON


async def test_un_administrateur_peut_la_declencher_et_le_journal_le_dit(
    session: AsyncSession, conn: AsyncConnection
) -> None:
    contexte = await compte_complet(session, conn)
    user = contexte["user"]
    admin_id = await new_user(conn, role=UserRole.ADMIN, email="admin@example.com")
    admin = await session.get(User, admin_id)

    await anonymization.anonymize_account(session, user=user, actor=Actor.from_user(admin))
    await session.flush()

    ligne = (
        await conn.execute(
            sa.select(AuditLog.__table__).where(
                AuditLog.entity_type == "app_user",
                AuditLog.to_status == UserStatus.ANONYMIZED.value,
            )
        )
    ).one()
    assert ligne.actor_kind == ActorKind.ADMIN
    assert ligne.actor_user_id == admin_id


async def test_le_systeme_ne_peut_pas_anonymiser_seul(
    session: AsyncSession, conn: AsyncConnection
) -> None:
    contexte = await compte_complet(session, conn)

    with pytest.raises(ValueError, match="demandeur"):
        await anonymization.anonymize_account(session, user=contexte["user"], actor=Actor.system())


# --------------------------------------------------------------------------
# unicité, idempotence, irréversibilité
# --------------------------------------------------------------------------


async def test_deux_comptes_anonymises_sur_la_meme_plateforme_cohabitent(
    session: AsyncSession, conn: AsyncConnection
) -> None:
    """Postgres accepte plusieurs NULL dans un index unique.

    C'est exactement ce qui rend l'effacement possible sans supprimer la ligne.
    """
    premier = await compte_complet(session, conn)
    second = await compte_complet(session, conn)

    assert premier["social_account_id"] != second["social_account_id"]

    await anonymization.anonymize_account(
        session, user=premier["user"], actor=Actor.from_user(premier["user"])
    )
    await anonymization.anonymize_account(
        session, user=second["user"], actor=Actor.from_user(second["user"])
    )
    await session.flush()

    vides = await conn.scalar(
        sa.select(sa.func.count())
        .select_from(SocialAccount)
        .where(SocialAccount.platform == Platform.INSTAGRAM, SocialAccount.external_id.is_(None))
    )
    assert vides == 2


async def test_rejouer_la_procedure_ne_leve_pas(
    session: AsyncSession, conn: AsyncConnection
) -> None:
    contexte = await compte_complet(session, conn)
    user = contexte["user"]

    assert await anonymization.anonymize_account(session, user=user, actor=Actor.from_user(user))
    await session.flush()

    assert (
        await anonymization.anonymize_account(session, user=user, actor=Actor.from_user(user))
        is False
    )
    await session.flush()

    lignes = await conn.scalar(
        sa.select(sa.func.count())
        .select_from(AuditLog)
        .where(AuditLog.entity_type == "app_user", AuditLog.reason == anonymization.REASON)
    )
    assert lignes == 1, "un rejeu ne doit pas écrire une seconde fois"


async def test_un_compte_anonymise_ne_peut_pas_etre_reactive(
    session: AsyncSession, conn: AsyncConnection
) -> None:
    contexte = await compte_complet(session, conn)
    user = contexte["user"]
    await anonymization.anonymize_account(session, user=user, actor=Actor.from_user(user))
    await session.flush()

    with pytest.raises((IntegrityError, InternalError)) as excinfo:
        async with conn.begin_nested():
            await conn.execute(
                sa.update(User).where(User.id == user.id).values(status=UserStatus.ACTIVE)
            )

    assert "ne peut pas etre reactive" in str(excinfo.value)


async def test_un_compte_anonymise_ne_recouvre_pas_ses_donnees(
    session: AsyncSession, conn: AsyncConnection
) -> None:
    contexte = await compte_complet(session, conn)
    user = contexte["user"]
    await anonymization.anonymize_account(session, user=user, actor=Actor.from_user(user))
    await session.flush()

    with pytest.raises((IntegrityError, InternalError)) as excinfo:
        async with conn.begin_nested():
            await conn.execute(
                sa.update(User).where(User.id == user.id).values(email="rebecca@example.com")
            )

    assert "recouvrer ses donnees" in str(excinfo.value)


# --------------------------------------------------------------------------
# effet sur la connexion
# --------------------------------------------------------------------------


async def test_la_connexion_est_refusee_apres_anonymisation(
    client: AsyncClient, session: AsyncSession, conn: AsyncConnection
) -> None:
    email = "adieu@example.com"
    user_id = await new_user(conn, email=email)
    user = await session.get(User, user_id)

    avant = await client.post(f"{PREFIX}/auth/login", json={"email": email, "password": PASSWORD})
    assert avant.status_code == 200

    await anonymization.anonymize_account(session, user=user, actor=Actor.from_user(user))
    await session.flush()

    apres = await client.post(f"{PREFIX}/auth/login", json={"email": email, "password": PASSWORD})
    assert apres.status_code == 401, "l'adresse n'existe plus, donc identifiants invalides"


async def test_un_compte_sans_profil_createur_s_anonymise_aussi(
    session: AsyncSession, conn: AsyncConnection
) -> None:
    """Un membre de commerce ou un administrateur n'a pas de creator_profile."""
    user_id = await new_user(conn, role=UserRole.BUSINESS_MEMBER, email="staff@example.com")
    user = await session.get(User, user_id)

    assert await anonymization.anonymize_account(session, user=user, actor=Actor.from_user(user))
    await session.flush()

    statut = await conn.scalar(sa.select(User.status).where(User.id == user_id))
    assert statut == UserStatus.ANONYMIZED


async def test_un_compte_sans_compte_social_s_anonymise_aussi(
    session: AsyncSession, conn: AsyncConnection
) -> None:
    user_id = await new_user(conn, email="sans-reseau@example.com")
    user = await session.get(User, user_id)

    assert await anonymization.anonymize_account(session, user=user, actor=Actor.from_user(user))
    await session.flush()

    assert await conn.scalar(sa.select(User.email).where(User.id == user_id)) is None


async def test_un_compte_social_actif_garde_forcement_son_identite(
    conn: AsyncConnection,
) -> None:
    """La contrainte qui rend l'effacement sûr protège aussi du cas inverse."""
    creator_id = await new_user(conn)
    await conn.execute(sa.insert(CreatorProfile).values(user_id=creator_id))
    account_id = await new_social_account(conn, creator_id)

    with pytest.raises(IntegrityError) as excinfo:
        async with conn.begin_nested():
            await conn.execute(
                sa.update(SocialAccount)
                .where(SocialAccount.id == account_id)
                .values(external_id=None, handle=None)
            )

    assert excinfo.value.orig.diag.constraint_name == "ck_social_account_identity_unless_revoked"


async def test_les_deux_identifiants_s_effacent_ensemble(conn: AsyncConnection) -> None:
    creator_id = await new_user(conn)
    await conn.execute(sa.insert(CreatorProfile).values(user_id=creator_id))
    account_id = await new_social_account(conn, creator_id)

    with pytest.raises(IntegrityError) as excinfo:
        async with conn.begin_nested():
            await conn.execute(
                sa.update(SocialAccount)
                .where(SocialAccount.id == account_id)
                .values(handle=None, status=SocialAccountStatus.REVOKED)
            )

    assert excinfo.value.orig.diag.constraint_name == "ck_social_account_identity_erased_together"


async def test_l_anonymisation_ne_touche_pas_les_autres_comptes(
    session: AsyncSession, conn: AsyncConnection
) -> None:
    voisin_id = await new_user(conn, email="voisin@example.com")
    contexte = await compte_complet(session, conn)

    await anonymization.anonymize_account(
        session, user=contexte["user"], actor=Actor.from_user(contexte["user"])
    )
    await session.flush()

    voisin = (
        await conn.execute(sa.select(User.email, User.status).where(User.id == voisin_id))
    ).one()
    assert voisin.email == "voisin@example.com"
    assert voisin.status == UserStatus.ACTIVE


async def test_un_identifiant_inexistant_ne_casse_rien(session: AsyncSession) -> None:
    """Garde-fou : la procédure travaille sur une entité chargée, jamais sur un identifiant nu."""
    assert await session.get(User, uuid.uuid4()) is None
