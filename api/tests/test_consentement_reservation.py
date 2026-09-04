"""L'engagement de la créatrice, recueilli à la confirmation.

**Pourquoi à la confirmation et pas à la pose du garde.** `SPEC.md` §4.1 nomme
l'acte : « confirmation créateur » est la seule flèche que la créatrice tire
elle-même vers un état où le salon l'attend. Le `held` posé juste avant n'est
qu'un verrou de capacité qui expire tout seul au bout de dix minutes ; y
recueillir un consentement produirait des acceptations enregistrées sur des
réservations qui n'ont jamais existé du point de vue du salon.

**Pourquoi la route et pas le service.** `confirmer` a soixante-trois appelants
— tests, semis, autres services — dont aucun ne parle de conditions. Leur
imposer une version leur ferait fabriquer une preuve qu'aucun humain n'a
produite, et c'est exactement ce qu'un journal d'engagement ne doit pas
contenir. La route est le seul chemin qu'une créatrice emprunte.
"""

import uuid

import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import AuditLog
from app.services import booking_states
from tests.test_booking_create import monter_le_decor, premier_creneau, reserver

PREFIX = get_settings().api_v1_prefix
MOT_DE_PASSE = "tourbillon-cactus-91-vermeil"


async def _entetes(client: AsyncClient, utilisateur) -> dict:
    reponse = await client.post(
        f"{PREFIX}/auth/login",
        json={"email": utilisateur.email, "password": MOT_DE_PASSE},
    )
    assert reponse.status_code == 200, reponse.text
    return {"Authorization": f"Bearer {reponse.json()['access_token']}"}


async def _une_reservation_tenue(session: AsyncSession):
    decor = await monter_le_decor(session)
    creneau = await premier_creneau(session, decor)
    booking = await reserver(session, decor, starts_at=creneau)
    await session.commit()
    return decor, booking


async def test_confirmer_exige_la_version_des_conditions(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Un corps absent est un refus, pas un défaut silencieux.

    **C'est la garde qui donne sa valeur à tout le reste.** Sans elle, une
    version d'app antérieure continuerait de confirmer sans rien accepter, et le
    journal porterait une moitié des engagements — donc aucun, puisqu'on ne
    saurait pas laquelle.
    """
    decor, booking = await _une_reservation_tenue(session)
    entetes = await _entetes(client, decor["createur"])

    reponse = await client.post(f"{PREFIX}/bookings/{booking.id}/confirm", headers=entetes)

    assert reponse.status_code == 422, reponse.text


async def test_une_version_perimee_est_refusee(client: AsyncClient, session: AsyncSession) -> None:
    """La version que l'écran a montrée, pas celle en vigueur à l'envoi.

    Un écran ouvert la semaine dernière montre les conditions de la semaine
    dernière. Enregistrer la version courante sur cette acceptation-là serait
    écrire au journal une preuve que personne n'a produite.
    """
    decor, booking = await _une_reservation_tenue(session)
    entetes = await _entetes(client, decor["createur"])

    reponse = await client.post(
        f"{PREFIX}/bookings/{booking.id}/confirm",
        json={"terms_version": "1999-01"},
        headers=entetes,
    )

    assert reponse.status_code == 409, reponse.text
    assert reponse.json()["detail"] == "booking_terms_outdated"


async def test_la_confirmation_ecrit_la_version_au_journal(
    client: AsyncClient, session: AsyncSession
) -> None:
    """**Qui, quand, sur quelle version** — les trois choses qu'on regardera le
    jour où quelqu'un contestera avoir accepté quoi que ce soit.

    Au journal d'audit et non sur la réservation : le journal est immuable et ne
    se supprime pas avec la ligne, là où une colonne recopiée peut diverger sous
    un `UPDATE`. Même choix que la prise en main d'une fiche.
    """
    decor, booking = await _une_reservation_tenue(session)
    entetes = await _entetes(client, decor["createur"])
    version = get_settings().terms_version

    reponse = await client.post(
        f"{PREFIX}/bookings/{booking.id}/confirm",
        json={"terms_version": version},
        headers=entetes,
    )
    assert reponse.status_code == 200, reponse.text

    # **L'entité, pas la table.** `extra` est mappé sur une colonne nommée
    # `metadata` ; passer par `__table__` rend le nom de la colonne et perd
    # celui de l'attribut.
    lignes = list(
        await session.scalars(
            sa.select(AuditLog).where(
                AuditLog.entity_type == "booking",
                AuditLog.entity_id == booking.id,
                AuditLog.to_status.in_(("confirmed", "awaiting_business")),
            )
        )
    )
    assert len(lignes) == 1, "la confirmation n'a pas laissé exactement une trace"
    assert lignes[0].extra == {"terms_version": version}
    assert lignes[0].actor_user_id == decor["createur"].id


async def test_un_champ_inconnu_est_refuse(client: AsyncClient, session: AsyncSession) -> None:
    """`extra="forbid"` : le corps ne porte que l'engagement.

    Il serait tentant d'y glisser un jour un « j'ai lu » ou un identifiant de
    session ; chacun ferait croire que le serveur en tient compte.
    """
    decor, booking = await _une_reservation_tenue(session)
    entetes = await _entetes(client, decor["createur"])

    reponse = await client.post(
        f"{PREFIX}/bookings/{booking.id}/confirm",
        json={"terms_version": get_settings().terms_version, "lu": True},
        headers=entetes,
    )

    assert reponse.status_code == 422, reponse.text


async def test_le_service_confirme_encore_sans_version(session: AsyncSession) -> None:
    """**Les soixante-trois appelants du service ne fabriquent pas de preuve.**

    Le semis, les autres services et les tests confirment des réservations sans
    qu'aucun humain n'accepte quoi que ce soit. Leur imposer une version
    remplirait le journal d'engagements que personne n'a pris — et le journal ne
    vaudrait plus rien, puisqu'on ne saurait plus distinguer les vrais.

    Le pendant de cette tolérance est la garde du dessus : la route, elle, exige.
    """
    decor, booking = await _une_reservation_tenue(session)

    await booking_states.confirmer(session, booking=booking, creator_id=decor["createur"].id)
    await session.flush()

    ligne = (
        await session.scalars(
            sa.select(AuditLog).where(
                AuditLog.entity_type == "booking",
                AuditLog.entity_id == booking.id,
                AuditLog.to_status.in_(("confirmed", "awaiting_business")),
            )
        )
    ).one()
    assert ligne.extra is None, "une confirmation sans humain a laissé une preuve d'engagement"


async def test_une_reservation_d_autrui_ne_se_confirme_pas(
    client: AsyncClient, session: AsyncSession
) -> None:
    """L'engagement n'ouvre aucune porte : la propriété reste vérifiée d'abord.

    Sans ce cas, un corps valide pourrait donner l'illusion d'un droit — et
    c'est le genre de garde qu'on croit acquise parce qu'elle l'était avant le
    changement.
    """
    _, booking = await _une_reservation_tenue(session)
    autre, _ = await _une_reservation_tenue(session)
    entetes = await _entetes(client, autre["createur"])

    reponse = await client.post(
        f"{PREFIX}/bookings/{booking.id}/confirm",
        json={"terms_version": get_settings().terms_version},
        headers=entetes,
    )

    assert reponse.status_code in (403, 404), reponse.text
    assert uuid.UUID(str(booking.id))
