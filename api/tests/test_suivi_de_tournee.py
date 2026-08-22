"""Le suivi de tournée : par où la fiche est passée, et où elle s'est arrêtée.

**Trois états pour une fiche non activée, et non un seul**, parce qu'ils
appellent trois gestes différents :

— jamais ouverte → **revisiter**. Personne n'a rien vu, et une relance
  s'adresserait à un lien que nul ne regarde ;
— ouverte, abandonnée → **relancer**. Quelqu'un a regardé et s'est arrêté ;
— ouverte, bloquée sur l'engagement → ni l'un ni l'autre. C'est le produit qui
  coince — mot de passe, conditions — et le démarchage n'y peut rien.

Les deux premiers étaient **indistinguables** : la ligne de suivi portait
`issued_at`, `used_at`, `expires_at` et `revoked_at`, et rien qui dise que
quelqu'un avait ouvert. Un lien jamais vu et un lien vu puis abandonné rendaient
exactement la même ligne — précisément les deux cas où la conduite diffère.

Chaque état est éprouvé **contre son voisin**, dans le même décor : un test qui
n'éprouverait qu'un état passerait sur une implémentation qui les confond tous.
"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.enums import HandoverChannel
from app.services import handover as service
from app.services.handover import EtatDeLaTournee
from tests.test_handover import MOT_DE_PASSE, preparee

PREFIX = get_settings().api_v1_prefix


@pytest.fixture(autouse=True)
def _adresse(monkeypatch: pytest.MonkeyPatch):
    get_settings.cache_clear()
    monkeypatch.setenv("HANDOVER_BASE_URL", "https://bind.example/reprendre")
    yield
    get_settings.cache_clear()


async def _etat(session: AsyncSession, business_id: uuid.UUID) -> EtatDeLaTournee:
    lignes = {ligne.business_id: ligne for ligne in await service.suivi(session)}
    return lignes[business_id].etat


# --------------------------------------------------------------------------
# les trois états
# --------------------------------------------------------------------------


async def test_une_fiche_remise_et_jamais_ouverte_se_revisite(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Le lien est parti, personne ne l'a regardé."""
    business, admin = await preparee(session)
    await service.emettre(session, business=business, emis_par=admin, canal=HandoverChannel.EMAIL)
    await session.commit()

    assert await _etat(session, business.id) is EtatDeLaTournee.JAMAIS_OUVERTE


async def test_une_fiche_ouverte_et_abandonnee_se_relance(
    client: AsyncClient, session: AsyncSession
) -> None:
    """**Le test qui sépare deux conduites opposées.**

    Le décor est le même que le précédent à une chose près : quelqu'un a
    ouvert. Sans cet appel, les deux états sont indistinguables — et c'était
    l'état du produit.
    """
    business, admin = await preparee(session)
    emis = await service.emettre(
        session, business=business, emis_par=admin, canal=HandoverChannel.EMAIL
    )
    await session.commit()

    reponse = await client.get(f"{PREFIX}/handover/{emis.jeton}")
    assert reponse.status_code == 200

    assert await _etat(session, business.id) is EtatDeLaTournee.ABANDONNEE


async def test_une_fiche_bloquee_sur_l_engagement_ne_se_relance_pas(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Le troisième état, lu sans que l'écran ait rien à rapporter.

    Une prise en main tentée et refusée est quelqu'un arrivé jusqu'à
    l'engagement. Ici, les conditions ne sont pas acceptées.
    """
    business, admin = await preparee(session)
    emis = await service.emettre(
        session, business=business, emis_par=admin, canal=HandoverChannel.QR
    )
    await session.commit()

    await client.get(f"{PREFIX}/handover/{emis.jeton}")
    refus = await client.post(
        f"{PREFIX}/handover/{emis.jeton}/claim",
        json={
            "email": f"{uuid.uuid4()}@example.com",
            "password": MOT_DE_PASSE,
            "terms_version": "une-version-qui-n-est-pas-la-bonne",
            "locale": "en",
        },
    )
    assert refus.status_code >= 400, refus.text

    assert await _etat(session, business.id) is EtatDeLaTournee.BLOQUEE


async def test_une_fiche_assumee_l_emporte_sur_tout_le_reste(
    client: AsyncClient, session: AsyncSession
) -> None:
    """**Le sens inverse, et il compte.**

    Une fiche bloquée puis assumée est assumée. Sans ce test, une lecture qui
    regarderait `blocked_at` avant `used_at` laisserait une fiche activée
    afficher « bloquée » pour toujours — et la tournée compterait un échec là
    où elle a réussi.
    """
    business, admin = await preparee(session)
    emis = await service.emettre(
        session, business=business, emis_par=admin, canal=HandoverChannel.QR
    )
    await session.commit()

    await client.get(f"{PREFIX}/handover/{emis.jeton}")
    await client.post(
        f"{PREFIX}/handover/{emis.jeton}/claim",
        json={
            "email": f"{uuid.uuid4()}@example.com",
            "password": MOT_DE_PASSE,
            "terms_version": "mauvaise",
            "locale": "en",
        },
    )
    prise = await client.post(
        f"{PREFIX}/handover/{emis.jeton}/claim",
        json={
            "email": f"{uuid.uuid4()}@example.com",
            "password": MOT_DE_PASSE,
            "terms_version": get_settings().terms_version,
            "locale": "en",
        },
    )
    assert prise.status_code == 200, prise.text

    assert await _etat(session, business.id) is EtatDeLaTournee.ACTIVEE


async def test_une_fiche_jamais_remise_reste_preparee(session: AsyncSession) -> None:
    """Il reste à passer. Ce n'est pas un échec de tournée, c'est du travail
    qui n'a pas encore eu lieu."""
    business, _ = await preparee(session)
    await session.commit()

    assert await _etat(session, business.id) is EtatDeLaTournee.PREPAREE


# --------------------------------------------------------------------------
# l'ouverture, notée une fois
# --------------------------------------------------------------------------


async def test_la_premiere_ouverture_est_celle_qui_reste(
    client: AsyncClient, session: AsyncSession
) -> None:
    """**La première et non la dernière.**

    Un démarcheur qui rouvre le lien pour vérifier ne doit pas effacer la trace
    de la vraie visite, ni faire passer pour récent un intérêt qui date de trois
    semaines. Deux appels, une seule date.
    """
    business, admin = await preparee(session)
    emis = await service.emettre(
        session, business=business, emis_par=admin, canal=HandoverChannel.QR
    )
    await session.commit()

    await client.get(f"{PREFIX}/handover/{emis.jeton}")
    lignes = {ligne.business_id: ligne for ligne in await service.suivi(session)}
    premiere = lignes[business.id].opened_at
    assert premiere is not None

    await client.get(f"{PREFIX}/handover/{emis.jeton}")
    lignes = {ligne.business_id: ligne for ligne in await service.suivi(session)}
    assert lignes[business.id].opened_at == premiere


async def test_un_jeton_inconnu_ne_marque_rien(client: AsyncClient, session: AsyncSession) -> None:
    """Le vide est ici le bon résultat, et il se distingue du symptôme.

    Un jeton inconnu n'a pas de ligne à marquer. Le décor porte une fiche
    remise et non ouverte : si l'appel marquait quoi que ce soit, il marquerait
    la mauvaise.
    """
    business, admin = await preparee(session)
    await service.emettre(session, business=business, emis_par=admin, canal=HandoverChannel.QR)
    await session.commit()

    reponse = await client.get(f"{PREFIX}/handover/un-jeton-qui-n-existe-pas")
    assert reponse.status_code == 404

    assert await _etat(session, business.id) is EtatDeLaTournee.JAMAIS_OUVERTE


# --------------------------------------------------------------------------
# la voie de remise
# --------------------------------------------------------------------------


async def test_la_voie_de_remise_est_servie(session: AsyncSession) -> None:
    """Main propre ou lien : c'est ce qui départage les deux méthodes.

    Deux fiches, deux voies, dans le même décor — sans quoi une lecture qui
    rendrait toujours la même valeur passerait.
    """
    au_comptoir, admin = await preparee(session, name="Salon du QR")
    a_distance, admin2 = await preparee(session, name="Salon du lien")
    await service.emettre(session, business=au_comptoir, emis_par=admin, canal=HandoverChannel.QR)
    await service.emettre(
        session, business=a_distance, emis_par=admin2, canal=HandoverChannel.EMAIL
    )
    await session.commit()

    lignes = {ligne.business_id: ligne for ligne in await service.suivi(session)}

    assert lignes[au_comptoir.id].channel is HandoverChannel.QR
    assert lignes[a_distance.id].channel is HandoverChannel.EMAIL
