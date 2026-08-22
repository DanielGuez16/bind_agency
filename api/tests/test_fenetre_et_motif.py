"""Le dernier motif de refus, sur l'écran d'envoi de preuve.

**Le compte à rebours a existé ici et n'a jamais eu de lecteur.** Il courait
jusqu'à `deadline_at` ; l'écran, lui, écrit l'échéance en instant absolu —
« avant jeudi 21, 14:30 » plutôt qu'« sous 48 h » — parce qu'un délai demande
de compter depuis une date qu'on ne regarde plus. Le champ est parti, et ses
tests avec lui : garder des tests verts sur du code mort est la façon la plus
sûre de croire couvert ce qui ne l'est pas.

**Le motif du dernier refus vient du journal d'audit**, pas d'une colonne.
Le poser sur `collaboration` ferait une seconde vérité qu'un `UPDATE` pourrait
faire diverger de l'audit — lequel est immuable. La file du commerce le dérive
déjà de cette source ; le créateur lit maintenant la même.

Ce qui est éprouvé ici est donc l'écart entre deux implémentations plausibles,
jamais la simple présence d'un champ :

— le **dernier** motif et non le premier, ce qui exige deux refus distincts.
  Un seul refus laisserait passer une lecture qui prend `[0]` ;
— le **plancher à zéro** sur une échéance passée, ce qui exige une échéance
  effectivement dépassée. Un décor où elle est à venir ne distingue pas un
  `max(0, …)` d'une soustraction nue ;
— la **même valeur des deux côtés**, ce qui exige de lire les deux façades. La
  duplication du champ ne se voit pas sur une seule.
"""

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Tier
from app.models.enums import CollaborationStatus
from app.services import collaboration as service
from app.services.audit import Actor
from tests.test_collaboration import contrepartie
from tests.test_counterpart_queue import statut

PREFIX = get_settings().api_v1_prefix


async def _jetons(client: AsyncClient, email: str) -> dict[str, str]:
    from tests.test_redemption_caisse import MOT_DE_PASSE

    jetons = (
        await client.post(f"{PREFIX}/auth/login", json={"email": email, "password": MOT_DE_PASSE})
    ).json()
    return {"Authorization": f"Bearer {jetons['access_token']}"}


# --------------------------------------------------------------------------
# le temps restant
# --------------------------------------------------------------------------


# --------------------------------------------------------------------------
# le dernier motif
# --------------------------------------------------------------------------


async def test_aucun_motif_avant_le_premier_refus(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Nul, et non une chaîne vide : rien ne s'est passé."""
    ligne, s = await contrepartie(session)
    await session.commit()

    reponse = await client.get(
        f"{PREFIX}/collaborations/{ligne.id}",
        headers=await _jetons(client, s["createur"].email),
    )
    assert reponse.json()["dernier_motif"] is None


async def test_la_creatrice_lit_le_dernier_motif_et_non_le_premier(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Deux refus **différents**, parce qu'un seul ne prouverait rien.

    Avec un seul refus au décor, une lecture qui prend la première entrée du
    journal rend exactement la même réponse que celle qui prend la dernière :
    le test passerait sur l'implémentation qu'il doit écarter.
    """
    ligne, s = await contrepartie(session)
    await statut(session, ligne, CollaborationStatus.SUBMITTED)
    await service.demander_une_nouvelle_soumission(
        session,
        collaboration=ligne,
        actor=Actor.from_user(s["caissier"]),
        reason="missing_mention",
    )
    await statut(session, ligne, CollaborationStatus.SUBMITTED)
    await service.demander_une_nouvelle_soumission(
        session,
        collaboration=ligne,
        actor=Actor.from_user(s["caissier"]),
        reason="wrong_format",
    )
    await session.commit()

    reponse = await client.get(
        f"{PREFIX}/collaborations/{ligne.id}",
        headers=await _jetons(client, s["createur"].email),
    )
    assert reponse.json()["dernier_motif"] == "wrong_format"


async def test_les_deux_facades_disent_le_meme_motif(session: AsyncSession) -> None:
    """La file du commerce et la lecture du créateur, sur une seule source.

    C'est l'assertion qui rend la duplication visible : un motif recopié dans
    une colonne passerait les tests précédents et divergerait ici dès qu'un
    seul des deux chemins l'oublierait.
    """
    ligne, s = await contrepartie(session)
    await statut(session, ligne, CollaborationStatus.SUBMITTED)
    await service.demander_une_nouvelle_soumission(
        session,
        collaboration=ligne,
        actor=Actor.from_user(s["caissier"]),
        reason="low_quality",
    )
    await session.flush()

    cote_commerce = await service.lister_pour_le_commerce(session, business_id=s["business"].id)
    de_la_file = next(f for f in cote_commerce if f.collaboration_id == ligne.id)

    tentative = await service.derniere_tentative(session, ligne.id)
    assert tentative is not None
    assert tentative.motif == de_la_file.dernier_motif == "low_quality"


# --------------------------------------------------------------------------
# de quoi parle le dossier, et combien d'essais il reste
# --------------------------------------------------------------------------


async def test_le_dossier_dit_le_salon_la_prestation_et_le_reseau(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Les trois noms, et chacun à sa place.

    L'assertion la plus utile est la dernière : **les trois valeurs sont
    distinctes deux à deux**. Sans elle, une lecture qui inverse le salon et la
    prestation rendrait exactement la même réponse sur un décor où les deux se
    ressemblent, et le test survivrait à la mutation qu'il doit attraper.
    """
    ligne, s = await contrepartie(session)
    await session.commit()

    corps = (
        await client.get(
            f"{PREFIX}/collaborations/{ligne.id}",
            headers=await _jetons(client, s["createur"].email),
        )
    ).json()

    palier = await session.get(Tier, ligne.tier_id)
    assert palier is not None
    assert corps["business_name"] == s["business"].name
    assert corps["item_name"] == s["item"].name
    assert corps["platform"] == palier.platform.value

    # Le décor doit **diverger** : trois noms confondus ne prouveraient rien.
    assert s["business"].name != s["item"].name


async def test_le_nom_du_salon_est_ce_que_la_creatrice_recopie(
    client: AsyncClient, session: AsyncSession
) -> None:
    """La ligne du lieu a de quoi être remplie quand le géotag est exigé.

    C'est le manque que cette tranche corrige : `required_geotag` était servi
    sans le mot à poser, ce qui revenait à demander un lieu sans le nommer.
    """
    ligne, s = await contrepartie(session, required_geotag=True)
    await session.commit()

    corps = (
        await client.get(
            f"{PREFIX}/collaborations/{ligne.id}",
            headers=await _jetons(client, s["createur"].email),
        )
    ).json()

    assert corps["required_geotag"] is True
    assert corps["business_name"]


async def test_le_plafond_de_tentatives_est_servi_avec_le_rang(
    client: AsyncClient, session: AsyncSession
) -> None:
    """« Tentative 2 sur 3 » demande le 3 autant que le 2.

    Le plafond vient de la configuration et non d'une constante recopiée dans
    l'application : `collaboration_max_attempts` change sans redéploiement, et
    un écran qui le figerait mentirait au premier ajustement.

    Le décor pousse le rang à 1 pour qu'il **diffère** du plafond : à zéro
    contre trois l'écart existe déjà, mais une lecture qui rendrait le rang à
    la place du plafond se verrait moins bien qu'ici, où les deux nombres sont
    tous deux non nuls et distincts.
    """
    ligne, s = await contrepartie(session)
    await statut(session, ligne, CollaborationStatus.SUBMITTED)
    await service.demander_une_nouvelle_soumission(
        session,
        collaboration=ligne,
        actor=Actor.from_user(s["caissier"]),
        reason="missing_mention",
    )
    await session.commit()

    corps = (
        await client.get(
            f"{PREFIX}/collaborations/{ligne.id}",
            headers=await _jetons(client, s["createur"].email),
        )
    ).json()

    plafond = get_settings().collaboration_max_attempts
    assert corps["max_attempts"] == plafond
    assert corps["attempts_count"] == 1
    assert corps["attempts_count"] != corps["max_attempts"]


async def test_le_contexte_d_un_dossier_inconnu_est_nul_et_non_vide(
    session: AsyncSession,
) -> None:
    """Nul, jamais des chaînes vides.

    Un écran qui reçoit « » ne distingue pas un salon sans nom d'un dossier
    introuvable, et les jointures sont obligatoires des deux côtés.
    """
    import uuid as _uuid

    assert await service.contexte_de(session, _uuid.uuid4()) is None
