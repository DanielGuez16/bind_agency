"""La confirmation d'adresse, de bout en bout.

**Le trou de conception de la campagne** : on s'inscrivait avec n'importe quelle
adresse, aucun message ne partait, aucun lien n'existait. Un salon pouvait donc
bloquer une place pour quelqu'un qu'on ne savait pas joindre.

La frontière retenue : un compte non confirmé **entre et se sert du produit**,
il ne peut simplement pas engager quelqu'un d'autre.
"""

import uuid
from datetime import date, UTC, datetime, timedelta

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.age import NAISSANCE_DES_JEUX_DE_DONNEES
from app.core.config import get_settings
from app.models import EmailVerification, User
from app.models.enums import Locale, UserRole, UserStatus
from app.services import auth as auth_service
from app.services import email_verification as service
from app.services import outbox

PREFIX = get_settings().api_v1_prefix
MOT_DE_PASSE = "tourbillon-cactus-91-vermeil"


async def inscrit(session: AsyncSession, *, locale: Locale = Locale.EN) -> User:
    return await auth_service.register(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password=MOT_DE_PASSE,
        role=UserRole.CREATOR,
        date_of_birth=NAISSANCE_DES_JEUX_DE_DONNEES,
        locale=locale,
    )


async def test_l_inscription_depose_le_courriel(session: AsyncSession) -> None:
    """**Dans la même transaction que le compte.** Ou les deux existent, ou
    aucun : un compte créé sans son courriel attendrait un message qui ne
    viendrait jamais, et personne ne le saurait."""
    user = await inscrit(session)
    await service.emettre(session, user=user)

    lignes = await outbox.en_attente(session)

    assert any(ligne.template_key == "account.verification" for ligne in lignes)


async def test_le_lien_confirme_et_ne_sert_qu_une_fois(session: AsyncSession) -> None:
    user = await inscrit(session)
    jeton = await service.emettre(session, user=user)

    confirme = await service.confirmer(session, jeton=jeton)
    assert confirme.email_verified_at is not None

    # **Le second passage refuse**, et c'est exact : il a été consommé. Un lien
    # qui traîne dans une boîte mail ne rouvre pas une porte des mois plus tard.
    with pytest.raises(service.JetonInconnu):
        await service.confirmer(session, jeton=jeton)

    assert await session.scalar(sa.select(sa.literal(1))) == 1


async def test_un_renvoi_revoque_le_precedent(session: AsyncSession) -> None:
    """Deux liens vivants pour une adresse feraient qu'un vieux courriel
    confirme aussi bien que le dernier."""
    user = await inscrit(session)
    premier = await service.emettre(session, user=user)
    second = await service.emettre(session, user=user)

    with pytest.raises(service.JetonInconnu):
        await service.confirmer(session, jeton=premier)
    assert await session.scalar(sa.select(sa.literal(1))) == 1

    # Et le dernier, lui, marche : une révocation qui fermerait les deux
    # passerait le test ci-dessus sans rien garantir.
    assert (await service.confirmer(session, jeton=second)).email_verified_at is not None


async def test_un_lien_expire_ne_confirme_plus(session: AsyncSession) -> None:
    user = await inscrit(session)
    jeton = await service.emettre(session, user=user)
    # **Les deux dates reculent, pas seulement l'échéance.** La contrainte
    # `expire_apres_emission` refuse une échéance antérieure à l'émission : ne
    # reculer que la première ferait échouer le montage sur une violation, et le
    # test parlerait de la contrainte au lieu de l'expiration.
    passe = datetime.now(UTC) - timedelta(hours=48)
    await session.execute(
        sa.update(EmailVerification)
        .where(EmailVerification.user_id == user.id)
        .values(issued_at=passe, expires_at=passe + timedelta(hours=1))
    )

    with pytest.raises(service.JetonInconnu):
        await service.confirmer(session, jeton=jeton)
    assert await session.scalar(sa.select(sa.literal(1))) == 1


async def test_une_adresse_changee_depuis_l_envoi_ne_se_confirme_pas(
    session: AsyncSession,
) -> None:
    """**Le jeton vise une adresse, pas un compte.** Sans cela, quelqu'un
    pourrait faire confirmer une adresse qu'il vient de saisir avec un lien parti
    à l'ancienne — c'est-à-dire faire valider une adresse que personne n'a
    ouverte."""
    user = await inscrit(session)
    jeton = await service.emettre(session, user=user)
    user.email = f"{uuid.uuid4()}@example.com"
    await session.flush()

    with pytest.raises(service.JetonInconnu):
        await service.confirmer(session, jeton=jeton)
    assert await session.scalar(sa.select(sa.literal(1))) == 1


async def test_un_compte_ferme_ne_se_confirme_pas(session: AsyncSession) -> None:
    user = await inscrit(session)
    jeton = await service.emettre(session, user=user)
    await session.execute(
        sa.update(User).where(User.id == user.id).values(status=UserStatus.SUSPENDED)
    )
    await session.flush()

    with pytest.raises(service.JetonInconnu):
        await service.confirmer(session, jeton=jeton)
    assert await session.scalar(sa.select(sa.literal(1))) == 1


async def test_le_jeton_n_est_pas_en_base(session: AsyncSession) -> None:
    """Une fuite de la base ne donne aucun lien utilisable."""
    user = await inscrit(session)
    jeton = await service.emettre(session, user=user)

    ligne = await session.scalar(
        sa.select(EmailVerification).where(EmailVerification.user_id == user.id)
    )
    assert ligne is not None
    assert jeton.encode() not in ligne.token_hash
    assert ligne.token_hash != jeton.encode()


async def test_la_route_confirme_et_refuse_un_jeton_inconnu(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Le chemin réel : un `GET`, parce qu'un lien de courriel s'ouvre dans un
    navigateur."""
    user = await inscrit(session)
    jeton = await service.emettre(session, user=user)
    await session.commit()

    ok = await client.get(f"{PREFIX}/auth/verify-email", params={"token": jeton})
    assert ok.status_code == 200, ok.text

    refus = await client.get(f"{PREFIX}/auth/verify-email", params={"token": "n-importe-quoi"})
    assert refus.status_code == 400


# --------------------------------------------------------------------------
# ce que voit celui qui clique
# --------------------------------------------------------------------------


async def test_le_lien_rend_une_page_et_non_du_json(
    client: AsyncClient, session: AsyncSession
) -> None:
    """**Le tout premier geste avec le produit, et il montrait du JSON.**

    `{"id":"…","email":"…","role":"creator"}` dans un navigateur, sur le seul
    écran qui décide si quelqu'un continue. La mécanique était juste — le jeton
    consommé, l'adresse vérifiée — c'est ce qu'il voyait qui était faux.

    Le décor éprouve les deux moitiés : le type de contenu, et le fait que rien
    du compte ne paraisse. Vérifier le seul type laisserait passer une page qui
    affiche l'adresse et l'identifiant dans du HTML — ce qui serait la même
    faute, mieux habillée.
    """
    user = await inscrit(session)
    adresse = user.email
    identifiant = str(user.id)
    jeton = await service.emettre(session, user=user)
    await session.commit()

    reponse = await client.get(f"{PREFIX}/auth/verify-email", params={"token": jeton})

    assert reponse.status_code == 200, reponse.text
    assert reponse.headers["content-type"].startswith("text/html")
    assert "<html" in reponse.text
    assert adresse not in reponse.text
    assert identifiant not in reponse.text


async def test_un_lien_deja_utilise_explique_au_lieu_de_paraitre_casse(
    client: AsyncClient, session: AsyncSession
) -> None:
    """**Presque toujours quelqu'un qui a cliqué deux fois.**

    `{"detail":"email_verification_invalid"}` se lit comme une panne, et fait
    renoncer quelqu'un dont l'adresse est déjà confirmée. Le code reste 400 : le
    navigateur n'en fait rien, et mentir sur le statut troublerait ce qui lit
    vraiment les codes.
    """
    user = await inscrit(session)
    jeton = await service.emettre(session, user=user)
    await session.commit()
    await client.get(f"{PREFIX}/auth/verify-email", params={"token": jeton})

    second = await client.get(f"{PREFIX}/auth/verify-email", params={"token": jeton})

    assert second.status_code == 400
    assert second.headers["content-type"].startswith("text/html")
    assert "email_verification_invalid" not in second.text


async def test_la_page_parle_la_langue_du_destinataire(
    client: AsyncClient, session: AsyncSession
) -> None:
    """**La langue du compte, et non celle du navigateur, quand on sait qui lit.**

    Le décor pose un compte hispanophone **et** un en-tête anglais : c'est le
    seul montage où les deux implémentations divergent. Sans l'en-tête
    contraire, une page qui lirait le navigateur rendrait de l'espagnol par
    hasard sur une machine espagnole, et par défaut de l'anglais partout
    ailleurs — le test passerait sans rien éprouver.
    """
    from app.core.i18n import translate
    from app.models.enums import Locale

    user = await inscrit(session, locale=Locale.ES)
    jeton = await service.emettre(session, user=user)
    await session.commit()

    reponse = await client.get(
        f"{PREFIX}/auth/verify-email",
        params={"token": jeton},
        headers={"Accept-Language": "en-US,en;q=0.9"},
    )

    assert translate("account.verification.page.confirmed.title", Locale.ES) in reponse.text
    assert translate("account.verification.page.confirmed.title", Locale.EN) not in reponse.text


async def test_un_jeton_inconnu_ne_designe_personne_donc_on_lit_le_navigateur(
    client: AsyncClient,
) -> None:
    """Le refus n'a pas d'utilisateur : c'est même la raison pour laquelle il
    est refusé. L'en-tête du navigateur est la seule indication qui reste."""
    from app.core.i18n import translate
    from app.models.enums import Locale

    reponse = await client.get(
        f"{PREFIX}/auth/verify-email",
        params={"token": "n-importe-quoi"},
        headers={"Accept-Language": "es-ES,es;q=0.9"},
    )

    assert translate("account.verification.page.invalid.title", Locale.ES) in reponse.text


# --------------------------------------------------------------------------
# ce qu'un compte non confirmé ne peut pas
# --------------------------------------------------------------------------


async def test_un_compte_non_confirme_ne_reserve_pas(session: AsyncSession) -> None:
    """**Le premier geste qui coûte à un tiers.** Le salon bloque une place pour
    quelqu'un qu'on ne sait pas joindre : c'est là que la frontière est posée, et
    pas à la connexion."""
    from app.services import booking as booking_service
    from tests.test_booking_create import monter_le_decor, premier_creneau, reserver

    decor = await monter_le_decor(session)
    await session.execute(
        sa.update(User).where(User.id == decor["createur"].id).values(email_verified_at=None)
    )
    await session.flush()

    with pytest.raises(booking_service.EmailNotVerified):
        await reserver(session, decor, starts_at=await premier_creneau(session, decor))

    assert await session.scalar(sa.select(sa.literal(1))) == 1


async def test_un_compte_confirme_reserve(session: AsyncSession) -> None:
    """L'autre sens, et il compte autant : une garde qui refuserait toujours
    passerait le test précédent en fermant le produit."""
    from tests.test_booking_create import monter_le_decor, premier_creneau, reserver

    decor = await monter_le_decor(session)

    ligne = await reserver(session, decor, starts_at=await premier_creneau(session, decor))

    assert ligne is not None


async def test_un_compte_non_confirme_ne_met_rien_en_ligne(session: AsyncSession) -> None:
    """Mettre un salon en ligne l'expose à des créatrices qui vont s'y
    déplacer : le minimum est de pouvoir joindre celui qui l'assume."""
    from app.services import business as business_service
    from app.services.audit import Actor
    from tests.test_activation import commerce_en_cours

    business, proprietaire = await commerce_en_cours(session)
    await session.execute(
        sa.update(User).where(User.id == proprietaire.id).values(email_verified_at=None)
    )
    await session.flush()

    with pytest.raises(business_service.EmailNotVerified):
        await business_service.activate_business(
            session, business=business, actor=Actor.from_user(proprietaire)
        )

    assert await session.scalar(sa.select(sa.literal(1))) == 1
