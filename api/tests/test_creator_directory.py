"""L'annuaire des créateurs, réservé aux commerces abonnés.

C'est ce que BIND vend à un salon : l'accès à un réseau. Deux choses s'y jouent
et aucune ne se voit à l'œil.

La première est une **promesse faite à la créatrice** : son score de fiabilité
n'est jamais montré à un commerce, jamais comparé entre créatrices. Le palier
ouvert porte la même information sans la divulguer — un score dégradé la
plafonne à un palier plus bas, c'est le moteur d'éligibilité qui le fait.

La seconde est la **barrière de vente**. Sans abonnement, la route refuse ; elle
ne rend pas une liste vide, qui se lirait comme « aucun créateur » et ferait un
argument contre le produit.
"""

import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import SocialAccount
from app.models.enums import (
    ContentFormat,
    Platform,
    ReliabilityEventType,
    SocialAccountStatus,
)
from app.services import directory as service
from app.services import reliability
from tests.test_activation import MOT_DE_PASSE, commerce_en_cours
from tests.test_creator_tiers import compte, createur

PREFIX = get_settings().api_v1_prefix


async def test_le_score_n_apparait_jamais_dans_l_annuaire(session: AsyncSession) -> None:
    """La promesse est tenue **par le schéma**, pas par la discipline d'un écran.

    Une donnée absente du schéma ne peut pas fuir, quoi que le service calcule
    par ailleurs. C'est le bon endroit pour tenir une promesse faite à un
    utilisateur : une consigne dans un composant s'oublie au deuxième qui lit la
    même réponse.
    """
    from app.schemas.directory import CreateurVuRead

    champs = set(CreateurVuRead.model_fields)
    interdits = {"reliability_score", "completed_collabs_count", "score", "fiabilite"}

    assert not (champs & interdits), f"l'annuaire expose {champs & interdits}"


async def test_le_palier_ouvert_remplace_le_score(session: AsyncSession) -> None:
    """Un score dégradé plafonne la créatrice à un palier inférieur.

    C'est ce qui permet de retirer le score sans rien retirer au salon : le
    palier dit qu'elle tient ses engagements, sans le nombre et sans classement.
    """
    user = await createur(session)
    await compte(session, user, followers=64_000)

    # Le haut de l'échelle demande de l'audience **et** des collaborations
    # menées à terme. Les deux sont produites par le service, jamais posées.
    for _ in range(15):
        await reliability.enregistrer(
            session, creator_id=user.id, type_=ReliabilityEventType.COLLAB_COMPLETED
        )

    avant = {v.creator_id: v.paliers_ouverts for v in await service.annuaire(session)}
    assert ContentFormat.REEL in avant[user.id], "le jeu de départ n'ouvre pas le haut"

    # Des manquements réels, par le service — jamais un score écrit à la main.
    for _ in range(30):
        await reliability.enregistrer(
            session, creator_id=user.id, type_=ReliabilityEventType.UNFULFILLED
        )

    apres = {v.creator_id: v.paliers_ouverts for v in await service.annuaire(session)}
    assert len(apres[user.id]) < len(avant[user.id]), (
        "le score dégradé n'a fermé aucun palier : l'annuaire ne dirait plus rien "
        "de la fiabilité, et retirer le score deviendrait une perte sèche"
    )


async def test_un_profil_sans_reseau_n_encombre_pas_l_annuaire(session: AsyncSession) -> None:
    """Ni volume, ni palier, ni publication possible : une ligne vide."""
    sans_reseau = await createur(session)

    identifiants = {v.creator_id for v in await service.annuaire(session)}
    assert sans_reseau.id not in identifiants


async def test_un_compte_revoque_n_est_pas_un_reseau_atteignable(
    session: AsyncSession,
) -> None:
    """Le salon lit des poignées pour évaluer une portée. Une poignée dont
    l'autorisation est morte n'en offre aucune."""
    user = await createur(session)
    await compte(session, user, followers=24_000)
    await session.execute(
        sa.update(SocialAccount)
        .where(SocialAccount.creator_id == user.id)
        .values(status=SocialAccountStatus.REVOKED)
    )
    await session.flush()

    vus = {v.creator_id: v for v in await service.annuaire(session)}
    assert vus[user.id].comptes == ()


async def test_l_annuaire_ne_fait_pas_une_requete_par_createur(session: AsyncSession) -> None:
    """`evaluer` est pure : on charge en masse et on évalue en mémoire.

    Une boucle sur `evaluer_createur` aurait donné trois requêtes par ligne — un
    N+1 invisible à dix créatrices et fatal à trois cents.
    """
    for _ in range(4):
        user = await createur(session)
        await compte(session, user, followers=24_000)

    compteur = {"n": 0}

    @sa.event.listens_for(session.sync_session, "do_orm_execute")
    def _compter(_etat) -> None:
        compteur["n"] += 1

    try:
        vus = await service.annuaire(session)
    finally:
        sa.event.remove(session.sync_session, "do_orm_execute", _compter)

    assert len(vus) >= 4
    # Trois requêtes de chargement, quelle que soit la taille de l'annuaire.
    assert compteur["n"] <= 5, f"{compteur['n']} requêtes pour {len(vus)} créateurs"


async def test_sans_abonnement_la_route_refuse(client: AsyncClient, session: AsyncSession) -> None:
    """**Rien ne part, donc rien ne fuit.**

    Un refus, pas une liste vide — le vide se lit « aucun créateur », ce qui est
    faux et fait un argument contre le produit. Et pas une liste dégradée non
    plus : elle a existé un jour, sans écran pour l'accompagner, et un salon
    non abonné recevait alors une grille de cartes sans nom ni visage sans une
    ligne qui explique pourquoi.

    Le décor porte un pseudonyme et un volume reconnaissables, et l'assertion
    regarde le **corps entier** : un refus qui laisserait quand même partir
    quelque chose se verrait ici, et pas dans un champ qu'on aurait pensé à
    vérifier.
    """
    business, proprietaire = await commerce_en_cours(session)
    elle = await createur(session)
    await compte(session, elle, followers=48_213, handle="rebecca.miami")
    await session.commit()

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login",
            json={"email": proprietaire.email, "password": MOT_DE_PASSE},
        )
    ).json()
    entetes = {"Authorization": f"Bearer {jetons['access_token']}"}

    reponse = await client.get(f"{PREFIX}/business/{business.id}/creators", headers=entetes)

    assert reponse.status_code == 402
    assert reponse.json()["detail"] == "subscription_required"
    assert "rebecca.miami" not in reponse.text
    assert "48213" not in reponse.text


async def test_le_lien_public_se_derive_du_pseudonyme(session: AsyncSession) -> None:
    """**Dérivé, jamais stocké.** Le pseudonyme est déjà en base ; ranger à côté
    une adresse qu'on en déduit ferait deux vérités, et celle qu'on ne
    rafraîchit pas vieillirait."""
    assert (
        service.lien_public(Platform.INSTAGRAM, "rebecca.miami")
        == "https://www.instagram.com/rebecca.miami/"
    )
    assert (
        service.lien_public(Platform.TIKTOK, "rebecca.miami")
        == "https://www.tiktok.com/@rebecca.miami"
    )


async def test_un_arobase_de_trop_ne_double_pas(session: AsyncSession) -> None:
    """Un pseudonyme saisi « @rebecca » donnerait `.../@@rebecca` — une adresse
    qui ne mène nulle part, et qu'on n'aurait vue qu'en cliquant."""
    assert service.lien_public(Platform.TIKTOK, "@rebecca") == "https://www.tiktok.com/@rebecca"


async def test_sans_pseudonyme_il_n_y_a_pas_de_lien(session: AsyncSession) -> None:
    """**Rien plutôt qu'une adresse partielle.** Un lien qui mène à une page
    d'erreur est pire qu'un lien absent : le salon croit que la créatrice a
    supprimé son compte."""
    assert service.lien_public(Platform.INSTAGRAM, None) is None
    assert service.lien_public(Platform.INSTAGRAM, "") is None


async def test_une_plateforme_non_rattachee_n_a_pas_de_lien(session: AsyncSession) -> None:
    """Snapchat existe en base et aucune implémentation ne le rattache :
    fabriquer une adresse pour une plateforme qu'on ne sait pas lire produirait
    un lien qu'on n'a jamais vu fonctionner."""
    assert service.lien_public(Platform.SNAPCHAT, "rebecca") is None


async def test_l_annuaire_rend_le_visage_et_le_lien(session: AsyncSession) -> None:
    """Bout en bout : ce que le salon reçoit réellement."""
    user = await createur(session)
    ligne = await compte(session, user, followers=12_000)
    ligne.avatar_key = "photos/avatars/abcdef"
    await session.flush()

    lignes = await service.annuaire(session)

    vu = next(c for c in lignes if c.creator_id == user.id)
    assert vu.comptes[0].avatar_key == "photos/avatars/abcdef"
    assert vu.comptes[0].profil_url == "https://www.instagram.com/compte.dessai/"


async def test_un_compte_sans_photo_ne_ment_pas(session: AsyncSession) -> None:
    """**Nulle, et non une image par défaut posée côté serveur.** Le choix de ce
    qu'on montre à la place appartient à l'écran, qui sait la taille et le
    thème ; le serveur qui trancherait imposerait son choix aux deux."""
    user = await createur(session)
    await compte(session, user, followers=12_000)

    lignes = await service.annuaire(session)

    vu = next(c for c in lignes if c.creator_id == user.id)
    assert vu.comptes[0].avatar_key is None
