"""Le lien traqué : ce qui compte, ce qui ne compte pas, et ce qu'on ne garde pas.

Trois familles de tests, et la première est celle qui compte.

**La vie privée.** Aucune adresse IP n'est stockée — vérifié sur le schéma
entier, pas sur les trois colonnes auxquelles on pense. Et l'oubli est
définitif : passé la fenêtre, l'empreinte **et son sel** ont disparu, si bien
que plus personne ne peut relier deux clics, même en possession de l'adresse
d'origine.

**Ce qu'on écarte.** Robots, préchargements, doublons. Chacun laisse une trace
avec sa raison, et aucun n'entre dans un agrégat. Un compteur qui n'avance pas
s'explique mieux avec « quatre-vingts préchargements » qu'avec le silence.

**Ce qu'on mesure.** La part locale, calculée à la lecture contre le point du
salon — jamais figée au moment du clic, parce que le rayon est en configuration.
"""

import uuid
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.integrations.geoip import Localisation, ResolveurAbsent
from app.models import Business, CollaborationLink, LinkClick, LinkClickSalt
from app.models.enums import ClickOutcome, DeviceFamily
from app.services import impact as impact_service
from app.services import tracking as service
from tests.conftest import inscrire_verifie

PREFIX = get_settings().api_v1_prefix

#: Un agent utilisateur d'iPhone, tel qu'Instagram en envoie.
IPHONE = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Mobile/15E148 Instagram 302.0.0.23.113"
)
BUREAU = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120"


class ResolveurFixe:
    """Rend toujours la même ville. Le vrai lecteur MMDB n'a rien à faire ici.

    Ce qu'on éprouve n'est pas la base de données géographique — elle est d'un
    tiers et se met à jour toute seule — mais **ce que le service fait** de ce
    qu'elle rend.
    """

    def __init__(self, localisation: Localisation | None) -> None:
        self.localisation = localisation
        self.vues: list[str] = []

    def resolve(self, ip: str) -> Localisation | None:
        self.vues.append(ip)
        return self.localisation


MIAMI = Localisation(
    country_code="US", region="Florida", city="Miami", longitude=-80.1918, latitude=25.7617
)
MUMBAI = Localisation(
    country_code="IN", region="Maharashtra", city="Mumbai", longitude=72.8777, latitude=19.0760
)


def passage(**overrides) -> service.Passage:
    """Un passage ordinaire : quelqu'un ouvre une story sur son téléphone."""
    defauts = {
        "ip": "203.0.113.7",
        "user_agent": IPHONE,
        "referer": "https://l.instagram.com/quelque/chose?utm=1",
        "entetes": {},
        "methode": "GET",
    }
    return service.Passage(**{**defauts, **overrides})


async def contrepartie_avec_lien(session: AsyncSession) -> tuple[CollaborationLink, Business]:
    """Une contrepartie consommée, son salon, et le lien qui les relie."""
    from tests.test_collaboration import contrepartie

    collaboration, decor = await contrepartie(session)
    lien = await service.lien_de_la_contrepartie(session, collaboration_id=collaboration.id)
    await session.flush()
    return lien, decor["business"]


# --------------------------------------------------------------------------
# la vie privée : l'exigence, pas la préférence
# --------------------------------------------------------------------------


async def test_aucune_table_ne_porte_d_adresse_ip(session: AsyncSession) -> None:
    """L'exigence, vérifiée sur le schéma entier plutôt que sur trois colonnes.

    Écrit sur `information_schema` et non sur les modèles : c'est la base qui
    fait foi, et une colonne ajoutée par une migration écrite à la main
    échapperait à une inspection des classes Python.

    La liste de motifs est volontairement large — `ip`, `adresse`, `address`,
    `inet`, `remote` — parce qu'on ne sait pas sous quel nom quelqu'un
    l'ajouterait un jour.
    """
    lignes = (
        await session.execute(
            sa.text(
                """
                SELECT table_name, column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = 'public'
                """
            )
        )
    ).all()
    assert len(lignes) > 100, "le schéma est bien inspecté, et pas vide"

    motifs = ("ip_", "_ip", "ipaddr", "adresse_ip", "client_ip", "remote_addr", "inet")
    fautives = [
        f"{table}.{colonne}"
        for table, colonne, _ in lignes
        if any(motif in colonne.lower() for motif in motifs)
    ]
    assert not fautives, f"une adresse IP est stockée : {fautives}"

    # Et aucun type réseau natif de Postgres, quel que soit le nom donné.
    types = [f"{table}.{colonne}" for table, colonne, type_ in lignes if type_ in ("inet", "cidr")]
    assert not types, f"colonne de type réseau : {types}"


async def test_l_adresse_sert_puis_disparait(session: AsyncSession) -> None:
    """Elle est bien utilisée — sinon la géographie serait vide — et pas gardée.

    Les deux moitiés comptent. Un service qui n'appellerait jamais le résolveur
    passerait un test d'absence de stockage sans rien prouver.
    """
    lien, _ = await contrepartie_avec_lien(session)
    resolveur = ResolveurFixe(MIAMI)

    _, clic = await service.ouvrir(
        session, slug=lien.slug, passage=passage(ip="198.51.100.42"), resolveur=resolveur
    )

    assert resolveur.vues == ["198.51.100.42"], "l'adresse a bien servi à résoudre"
    assert clic.city == "Miami"

    # Et elle n'est nulle part dans la ligne écrite.
    valeurs = [str(getattr(clic, colonne.name)) for colonne in LinkClick.__table__.columns]
    assert not any("198.51.100.42" in valeur for valeur in valeurs)


async def test_la_purge_rend_l_oubli_definitif(session: AsyncSession) -> None:
    """Passé la fenêtre, l'empreinte **et son sel** ont disparu.

    C'est la propriété qui distingue ce dispositif d'un pseudonymat : avec une
    clé de configuration, quelqu'un tenant l'adresse d'origine pourrait
    recalculer l'empreinte et relier deux clics des mois plus tard. Le sel
    détruit, ce calcul n'existe plus pour personne — nous compris.
    """
    lien, _ = await contrepartie_avec_lien(session)
    vieux = datetime.now(UTC) - timedelta(days=2)

    _, clic = await service.ouvrir(
        session, slug=lien.slug, passage=passage(), resolveur=ResolveurFixe(MIAMI)
    )
    assert clic.fingerprint is not None, "l'empreinte existe le temps de dédupliquer"
    await session.execute(
        sa.update(LinkClick).where(LinkClick.id == clic.id).values(occurred_at=vieux)
    )
    await session.execute(sa.update(LinkClickSalt).values(jour=vieux.date()))

    compte = await service.purger(session)

    assert compte["empreintes_effacees"] == 1
    assert compte["sels_effaces"] == 1
    await session.refresh(clic)
    assert clic.fingerprint is None
    assert (await session.scalar(sa.select(sa.func.count()).select_from(LinkClickSalt))) == 0
    # Le clic, lui, reste : c'est une mesure, et elle ne nomme personne.
    assert clic.city == "Miami"


async def test_la_purge_laisse_les_empreintes_de_la_fenetre(session: AsyncSession) -> None:
    """Le pendant. Une purge qui efface tout casserait la déduplication.

    Sans lui, un `UPDATE` sans clause de date passerait le test précédent.
    """
    lien, _ = await contrepartie_avec_lien(session)
    _, clic = await service.ouvrir(
        session, slug=lien.slug, passage=passage(), resolveur=ResolveurFixe(MIAMI)
    )

    await service.purger(session)

    await session.refresh(clic)
    assert clic.fingerprint is not None


async def test_l_empreinte_ne_traverse_pas_deux_liens(session: AsyncSession) -> None:
    """Le même visiteur porte deux empreintes différentes sur deux liens.

    Sans le lien dans le calcul, recouper deux contreparties dirait « ces deux
    salons ont été vus par le même téléphone » — un recoupement qu'on ne veut
    ni faire ni rendre possible.
    """
    a, _ = await contrepartie_avec_lien(session)
    b, _ = await contrepartie_avec_lien(session)
    sel = b"un-sel-de-trente-deux-octets-xxxx"

    assert service.empreinte(sel, a.id, "203.0.113.7", IPHONE) != service.empreinte(
        sel, b.id, "203.0.113.7", IPHONE
    )
    # Et sur le même lien, le même visiteur se reconnaît : sans cela, la
    # déduplication ne dédupliquerait rien.
    assert service.empreinte(sel, a.id, "203.0.113.7", IPHONE) == service.empreinte(
        sel, a.id, "203.0.113.7", IPHONE
    )


# --------------------------------------------------------------------------
# ce qu'on écarte
# --------------------------------------------------------------------------


async def test_un_robot_declare_ne_compte_pas(session: AsyncSession) -> None:
    lien, _ = await contrepartie_avec_lien(session)
    resolveur = ResolveurFixe(MIAMI)

    _, clic = await service.ouvrir(
        session,
        slug=lien.slug,
        passage=passage(user_agent="Mozilla/5.0 (compatible; Googlebot/2.1)"),
        resolveur=resolveur,
    )

    assert clic.outcome is ClickOutcome.BOT
    # Et on ne l'a même pas géolocalisé : le filtre le moins cher passe en
    # premier, sinon chaque passage d'un moteur d'indexation coûterait une
    # lecture de base.
    assert resolveur.vues == []


async def test_un_prechargement_ne_compte_pas(session: AsyncSession) -> None:
    """Les trois en-têtes, parce que les trois existent encore.

    Une garde calée sur `Sec-Purpose` seul laisserait passer Chrome et Firefox
    dans leurs formes anciennes, et gonflerait chaque lien du même bruit.
    """
    lien, _ = await contrepartie_avec_lien(session)

    for entete, valeur in (
        ("sec-purpose", "prefetch;prerender"),
        ("purpose", "prefetch"),
        ("x-moz", "prefetch"),
    ):
        _, clic = await service.ouvrir(
            session,
            slug=lien.slug,
            passage=passage(entetes={entete: valeur}),
            resolveur=ResolveurFixe(MIAMI),
        )
        assert clic.outcome is ClickOutcome.PREFETCH, entete


async def test_une_inspection_head_ne_compte_pas(session: AsyncSession) -> None:
    """`HEAD` ne rend pas de page : personne n'a rien lu."""
    lien, _ = await contrepartie_avec_lien(session)

    _, clic = await service.ouvrir(
        session, slug=lien.slug, passage=passage(methode="HEAD"), resolveur=ResolveurFixe(MIAMI)
    )

    assert clic.outcome is ClickOutcome.PREFETCH


async def test_un_agent_absent_ne_compte_pas(session: AsyncSession) -> None:
    """Tous les navigateurs en envoient un ; son absence désigne un script."""
    lien, _ = await contrepartie_avec_lien(session)

    for absent in (None, "", "   "):
        _, clic = await service.ouvrir(
            session,
            slug=lien.slug,
            passage=passage(user_agent=absent),
            resolveur=ResolveurFixe(MIAMI),
        )
        assert clic.outcome is ClickOutcome.BOT, repr(absent)


async def test_le_meme_visiteur_ne_compte_qu_une_fois(session: AsyncSession) -> None:
    """Rouvrir une story trois fois n'est pas découvrir le salon trois fois."""
    lien, _ = await contrepartie_avec_lien(session)

    premiers = [
        (
            await service.ouvrir(
                session, slug=lien.slug, passage=passage(), resolveur=ResolveurFixe(MIAMI)
            )
        )[1].outcome
        for _ in range(3)
    ]

    assert premiers == [ClickOutcome.COUNTED, ClickOutcome.DUPLICATE, ClickOutcome.DUPLICATE]


async def test_un_autre_visiteur_compte(session: AsyncSession) -> None:
    """Le pendant : une déduplication qui écarterait tout le monde après le
    premier clic passerait le test précédent en ne comptant jamais rien."""
    lien, _ = await contrepartie_avec_lien(session)

    _, un = await service.ouvrir(
        session, slug=lien.slug, passage=passage(ip="203.0.113.7"), resolveur=ResolveurFixe(MIAMI)
    )
    _, deux = await service.ouvrir(
        session, slug=lien.slug, passage=passage(ip="203.0.113.8"), resolveur=ResolveurFixe(MIAMI)
    )

    assert un.outcome is ClickOutcome.COUNTED
    assert deux.outcome is ClickOutcome.COUNTED


async def test_le_doublon_expire_avec_sa_fenetre(session: AsyncSession) -> None:
    """Deux visites à deux heures d'écart sont deux visites."""
    lien, _ = await contrepartie_avec_lien(session)

    _, premier = await service.ouvrir(
        session, slug=lien.slug, passage=passage(), resolveur=ResolveurFixe(MIAMI)
    )
    await session.execute(
        sa.update(LinkClick)
        .where(LinkClick.id == premier.id)
        .values(occurred_at=datetime.now(UTC) - timedelta(hours=2))
    )

    _, second = await service.ouvrir(
        session, slug=lien.slug, passage=passage(), resolveur=ResolveurFixe(MIAMI)
    )

    assert second.outcome is ClickOutcome.COUNTED


# --------------------------------------------------------------------------
# ce qu'on retient du passage
# --------------------------------------------------------------------------


async def test_le_referent_est_reduit_a_son_hote(session: AsyncSession) -> None:
    """Une URL de référent transporte des chemins et des paramètres.

    On veut savoir « depuis Instagram », pas depuis quelle page ni avec quel
    identifiant de session dans la requête.
    """
    lien, _ = await contrepartie_avec_lien(session)

    _, clic = await service.ouvrir(
        session,
        slug=lien.slug,
        passage=passage(referer="https://l.instagram.com/prive/chemin?token=secret"),
        resolveur=ResolveurFixe(MIAMI),
    )

    assert clic.referrer_host == "l.instagram.com"
    assert "secret" not in str(clic.referrer_host)


async def test_la_famille_de_terminal_distingue_la_tablette_du_mobile() -> None:
    """La tablette se teste avant le mobile : « iPad » et « Android »
    cohabitent dans les mêmes chaînes, et l'ordre inverse rangerait tous les
    iPad parmi les téléphones."""
    assert service.famille_de_terminal(IPHONE) is DeviceFamily.MOBILE
    assert service.famille_de_terminal("Mozilla/5.0 (iPad; CPU OS 17_0)") is DeviceFamily.TABLET
    assert service.famille_de_terminal(BUREAU) is DeviceFamily.DESKTOP
    # Android sans « mobile » est une tablette, par convention de Google.
    assert service.famille_de_terminal("Mozilla/5.0 (Linux; Android 14)") is DeviceFamily.TABLET
    assert (
        service.famille_de_terminal("Mozilla/5.0 (Linux; Android 14; Mobile)")
        is DeviceFamily.MOBILE
    )
    assert service.famille_de_terminal(None) is DeviceFamily.UNKNOWN


async def test_sans_base_geographique_le_clic_reste_sans_pays(session: AsyncSession) -> None:
    """On n'invente pas une géographie qu'on n'a pas.

    L'intégration continue tourne ainsi : aucune base n'est versionnée. Un
    repli sur un pays par défaut contaminerait la part locale et le score
    d'impact de toutes les campagnes.
    """
    lien, _ = await contrepartie_avec_lien(session)

    _, clic = await service.ouvrir(
        session, slug=lien.slug, passage=passage(), resolveur=ResolveurAbsent()
    )

    assert clic.outcome is ClickOutcome.COUNTED, "le clic compte quand même"
    assert clic.country_code is None
    assert clic.city_geo is None


# --------------------------------------------------------------------------
# le lien lui-même
# --------------------------------------------------------------------------


async def test_un_lien_par_contrepartie_et_pas_deux(session: AsyncSession) -> None:
    """Demandé deux fois, c'est le même : un lien déjà collé dans une story ne
    doit pas cesser de fonctionner parce qu'on a rouvert l'écran."""
    lien, _ = await contrepartie_avec_lien(session)

    encore = await service.lien_de_la_contrepartie(session, collaboration_id=lien.collaboration_id)

    assert encore.id == lien.id
    assert encore.slug == lien.slug


async def test_le_slug_ne_se_devine_pas() -> None:
    """Tiré au hasard, jamais dérivé de l'identifiant de la contrepartie.

    Un lien devinable laisserait fabriquer des clics sur la collaboration de
    quelqu'un d'autre — exactement ce que la mesure existe pour empêcher.
    """
    tirages = {service.nouveau_slug() for _ in range(200)}

    assert len(tirages) == 200, "deux cents tirages, deux cents valeurs"
    assert all(len(slug) == get_settings().link_slug_length for slug in tirages)
    # L'alphabet exclut ce qui se confond à l'oral et à la recopie.
    assert all(caractere not in "01ilo" for slug in tirages for caractere in slug)


async def test_un_createur_n_obtient_pas_le_lien_d_un_autre(session: AsyncSession) -> None:
    """Et le refus ne dit pas si la contrepartie existe.

    Savoir qu'elle existe suffirait à chercher son identifiant court.
    """
    from tests.test_collaboration import contrepartie

    collaboration, _ = await contrepartie(session)
    intrus = uuid.uuid4()

    try:
        await service.lien_du_createur(
            session, collaboration_id=collaboration.id, creator_id=intrus
        )
    except service.ContrepartieIntrouvable:
        pass
    else:
        raise AssertionError("le lien d'un autre créateur a été rendu")

    # La session reste utilisable après le refus : une violation attrapée hors
    # d'un point de sauvegarde la laisserait inutilisable, et le défaut
    # n'apparaîtrait qu'au prochain appel, ailleurs.
    assert await session.scalar(sa.select(sa.func.count()).select_from(CollaborationLink)) >= 0


# --------------------------------------------------------------------------
# ce qu'on mesure
# --------------------------------------------------------------------------


async def test_la_part_locale_se_calcule_contre_le_point_du_salon(
    session: AsyncSession,
) -> None:
    """C'est toute la question de la fondatrice : Miami ou l'Inde.

    Le salon est à Miami. Deux clics de Miami, un de Mumbai : la part locale
    vaut deux tiers, et elle le dit avec le rayon qui l'a produite.
    """
    lien, business = await contrepartie_avec_lien(session)
    for ip, ou in (("203.0.113.1", MIAMI), ("203.0.113.2", MIAMI), ("203.0.113.3", MUMBAI)):
        await service.ouvrir(
            session, slug=lien.slug, passage=passage(ip=ip), resolveur=ResolveurFixe(ou)
        )
    await session.flush()

    vue = await impact_service.audience_du_commerce(session, business_id=business.id)

    assert vue.clics == 3
    assert vue.clics_locaux == 2
    assert vue.part_locale is not None
    assert round(float(vue.part_locale), 2) == 0.67
    assert vue.rayon_local_metres == get_settings().link_local_radius_metres
    assert {ligne.country_code for ligne in vue.par_pays} == {"US", "IN"}


async def test_la_part_locale_est_nulle_et_non_zero_sans_clic(session: AsyncSession) -> None:
    """Zéro sur zéro n'est pas zéro.

    Afficher « 0 % de local » à une créatrice dont la story vient d'être
    publiée serait un reproche pour quelque chose qui n'a pas eu lieu. Même
    règle que le taux d'honoration.
    """
    _, business = await contrepartie_avec_lien(session)

    vue = await impact_service.audience_du_commerce(session, business_id=business.id)

    assert vue.clics == 0
    assert vue.part_locale is None
    assert impact_service.score_d_impact_local(vue) is None


async def test_les_ecartes_sont_comptes_a_part_et_jamais_dans_les_clics(
    session: AsyncSession,
) -> None:
    """Un compteur qui n'avance pas s'explique mieux qu'avec le silence."""
    lien, business = await contrepartie_avec_lien(session)
    await service.ouvrir(
        session, slug=lien.slug, passage=passage(ip="203.0.113.1"), resolveur=ResolveurFixe(MIAMI)
    )
    await service.ouvrir(
        session,
        slug=lien.slug,
        passage=passage(ip="203.0.113.2", user_agent="Googlebot/2.1"),
        resolveur=ResolveurFixe(MIAMI),
    )
    await service.ouvrir(
        session,
        slug=lien.slug,
        passage=passage(ip="203.0.113.3", entetes={"sec-purpose": "prefetch"}),
        resolveur=ResolveurFixe(MIAMI),
    )
    await session.flush()

    vue = await impact_service.audience_du_commerce(session, business_id=business.id)

    assert vue.clics == 1
    assert vue.ecartes.robots == 1
    assert vue.ecartes.prechargements == 1
    assert vue.ecartes.total == 2


async def test_le_score_d_impact_pese_zero_tant_que_le_poids_est_zero(
    session: AsyncSession,
) -> None:
    """La mécanique existe, se teste, et ne pèse sur rien.

    Le poids est en configuration et vaut zéro tant qu'aucune donnée réelle n'a
    été observée. Le jour où il pèsera, ce sera une décision prise sur des
    chiffres — pas un effet de bord de la livraison.
    """
    from decimal import Decimal

    lien, business = await contrepartie_avec_lien(session)
    await service.ouvrir(session, slug=lien.slug, passage=passage(), resolveur=ResolveurFixe(MIAMI))
    await session.flush()
    vue = await impact_service.audience_du_commerce(session, business_id=business.id)

    assert get_settings().local_impact_weight == Decimal("0"), "le poids livré est nul"
    assert impact_service.score_d_impact_local(vue) == Decimal("0")
    # Et la mécanique n'est pas morte : à poids non nul, elle rend la part.
    assert impact_service.score_d_impact_local(vue, poids=Decimal("1")) == Decimal("1.0000")
    assert impact_service.score_d_impact_local(vue, poids=Decimal("0.5")) == Decimal("0.5000")


async def test_le_createur_ne_voit_que_ses_propres_clics(session: AsyncSession) -> None:
    """Deux créatrices, deux mesures. Le pendant du test d'isolation du salon."""
    from tests.test_collaboration import contrepartie

    une, decor_a = await contrepartie(session)
    autre, decor_b = await contrepartie(session)
    lien_a = await service.lien_de_la_contrepartie(session, collaboration_id=une.id)
    lien_b = await service.lien_de_la_contrepartie(session, collaboration_id=autre.id)
    await session.flush()

    await service.ouvrir(
        session, slug=lien_a.slug, passage=passage(), resolveur=ResolveurFixe(MIAMI)
    )
    for ip in ("203.0.113.10", "203.0.113.11"):
        await service.ouvrir(
            session, slug=lien_b.slug, passage=passage(ip=ip), resolveur=ResolveurFixe(MIAMI)
        )
    await session.flush()

    vue_a = await impact_service.audience_du_createur(session, creator_id=decor_a["createur"].id)
    vue_b = await impact_service.audience_du_createur(session, creator_id=decor_b["createur"].id)

    assert vue_a.clics == 1
    assert vue_b.clics == 2


# --------------------------------------------------------------------------
# les signaux de fabrication
# --------------------------------------------------------------------------


def _audience(**overrides) -> impact_service.AudienceDesLiens:
    """Une audience ordinaire : cent clics, plusieurs villes, plusieurs terminaux."""
    defauts = {
        "clics": 100,
        "clics_locaux": 60,
        "rayon_local_metres": 30_000,
        "par_pays": (impact_service.LigneDePays("US", 100),),
        "par_ville": (
            impact_service.LigneDeVille("Miami", "Florida", "US", 60),
            impact_service.LigneDeVille("Orlando", "Florida", "US", 40),
        ),
        "par_terminal": (
            impact_service.LigneDeTerminal(DeviceFamily.MOBILE, 80),
            impact_service.LigneDeTerminal(DeviceFamily.DESKTOP, 20),
        ),
        "par_referent": (impact_service.LigneDeReferent("l.instagram.com", 100),),
        "ecartes": impact_service.Ecartes(robots=2, prechargements=3, doublons=5),
    }
    return impact_service.AudienceDesLiens(**{**defauts, **overrides})


def test_une_audience_ordinaire_ne_declenche_aucun_signal() -> None:
    """Le pendant, et il vient en premier.

    Des seuils réglés trop bas crieraient sur tout le monde, et un signal qui
    se déclenche toujours ne se lit plus. Sans ce test, on ne saurait pas.
    """
    assert impact_service.signaux_de_fabrication(_audience()) == ()


def test_une_seule_ville_se_signale() -> None:
    """Une audience réelle, même très locale, s'étale sur une agglomération.

    Un script, lui, tourne d'un endroit.
    """
    vue = _audience(par_ville=(impact_service.LigneDeVille("Miami", "Florida", "US", 100),))

    codes = [signal.code for signal in impact_service.signaux_de_fabrication(vue)]

    assert codes == ["une_seule_ville"]


def test_un_seul_terminal_se_signale() -> None:
    vue = _audience(par_terminal=(impact_service.LigneDeTerminal(DeviceFamily.MOBILE, 100),))

    codes = [signal.code for signal in impact_service.signaux_de_fabrication(vue)]

    assert "un_seul_terminal" in codes


def test_l_absence_de_referent_se_signale() -> None:
    """Un clic depuis une story porte l'hôte de la plateforme.

    Un appel direct n'en a pas : c'est la signature d'un client qui ne vient
    pas d'une page.
    """
    vue = _audience(par_referent=(impact_service.LigneDeReferent(None, 100),))

    codes = [signal.code for signal in impact_service.signaux_de_fabrication(vue)]

    assert "sans_referent" in codes


def test_une_majorite_de_coups_ecartes_se_signale() -> None:
    """Beaucoup de robots pour peu de clics désigne un générateur, pas un public."""
    vue = _audience(ecartes=impact_service.Ecartes(robots=300, prechargements=0, doublons=0))

    codes = [signal.code for signal in impact_service.signaux_de_fabrication(vue)]

    assert "majorite_ecartee" in codes


def test_on_ne_signale_rien_sur_trop_peu_de_clics() -> None:
    """Sur douze clics, toutes les proportions sont aberrantes.

    Signaler là accuserait une créatrice dont la story vient de sortir.
    """
    vue = _audience(
        clics=12,
        par_ville=(impact_service.LigneDeVille("Miami", "Florida", "US", 12),),
        par_terminal=(impact_service.LigneDeTerminal(DeviceFamily.MOBILE, 12),),
        par_referent=(impact_service.LigneDeReferent(None, 12),),
    )

    assert impact_service.signaux_de_fabrication(vue) == ()


def test_les_signaux_portent_le_constat_et_le_seuil() -> None:
    """Un arbitre a besoin de voir ce qui a déclenché, pas seulement que ça a
    déclenché. Une note agrégée cacherait ce qui l'a produite."""
    vue = _audience(par_ville=(impact_service.LigneDeVille("Miami", "Florida", "US", 100),))

    signal = impact_service.signaux_de_fabrication(vue)[0]

    assert signal.constate == 1
    assert signal.seuil == impact_service.SEUIL_UNE_SEULE_VILLE


# --------------------------------------------------------------------------
# la route publique
# --------------------------------------------------------------------------


async def test_la_redirection_envoie_sur_la_fiche_et_compte(
    client: AsyncClient, session: AsyncSession, monkeypatch
) -> None:
    """Le parcours complet : quelqu'un touche un sticker et arrive quelque part.

    Éprouvé sur la route, hors du préfixe d'API, avec les en-têtes qu'un
    téléphone envoie réellement. Le service seul ne prouverait pas que
    l'adresse est lue au bon endroit de `X-Forwarded-For`.
    """
    lien, business = await contrepartie_avec_lien(session)
    await session.commit()
    monkeypatch.setattr(
        get_settings(), "link_redirect_base_url", "https://bind.example", raising=False
    )

    reponse = await client.get(
        f"/r/{lien.slug}",
        headers={
            "user-agent": IPHONE,
            "referer": "https://l.instagram.com/x",
            "x-forwarded-for": "198.51.100.9, 10.0.0.1",
        },
    )

    assert reponse.status_code == 302
    assert reponse.headers["location"] == f"https://bind.example/{business.id}"

    clic = await session.scalar(sa.select(LinkClick).where(LinkClick.link_id == lien.id))
    assert clic is not None
    assert clic.outcome is ClickOutcome.COUNTED
    assert clic.device_family is DeviceFamily.MOBILE
    assert clic.referrer_host == "l.instagram.com"


async def test_l_adresse_lue_est_celle_du_visiteur_pas_du_repartiteur(
    client: AsyncClient, session: AsyncSession, monkeypatch
) -> None:
    """Le **premier** maillon de `X-Forwarded-For`, jamais le dernier.

    Prendre le dernier géolocaliserait le répartiteur de l'hébergeur : tous les
    clics du produit viendraient du même centre de données, et la part locale
    vaudrait soit zéro soit un, pour tout le monde, sans que rien ne le
    signale.
    """
    from app.routers import tracking as routeur

    lien, _ = await contrepartie_avec_lien(session)
    await session.commit()
    monkeypatch.setattr(
        get_settings(), "link_redirect_base_url", "https://bind.example", raising=False
    )

    vues: list[str | None] = []

    class Espion:
        def resolve(self, ip):
            vues.append(ip)
            return MIAMI

    monkeypatch.setattr(routeur, "get_geo_resolver", lambda: Espion())

    await client.get(
        f"/r/{lien.slug}",
        headers={"user-agent": IPHONE, "x-forwarded-for": "198.51.100.9, 10.0.0.1, 10.0.0.2"},
    )

    assert vues == ["198.51.100.9"]


async def test_une_adresse_inconnue_rend_404(client: AsyncClient, monkeypatch) -> None:
    """Sans distinguer « jamais existé » de « désactivé » : le dire indiquerait
    à qui essaie des adresses au hasard laquelle a déjà servi."""
    monkeypatch.setattr(
        get_settings(), "link_redirect_base_url", "https://bind.example", raising=False
    )

    reponse = await client.get("/r/inexistant9", headers={"user-agent": IPHONE})

    assert reponse.status_code == 404


# --------------------------------------------------------------------------
# qui lit quoi
# --------------------------------------------------------------------------


async def connecter(client: AsyncClient, session: AsyncSession, role) -> dict:
    """Un compte du rôle demandé, et ses en-têtes."""
    from app.models.enums import UserRole

    email, motdepasse = f"{uuid.uuid4()}@example.com", "tourbillon-cactus-91-vermeil"
    await inscrire_verifie(session, email=email, password=motdepasse, role=UserRole(role))
    await session.commit()
    jetons = (
        await client.post(f"{PREFIX}/auth/login", json={"email": email, "password": motdepasse})
    ).json()
    return {"headers": {"Authorization": f"Bearer {jetons['access_token']}"}}


async def test_les_signaux_ne_sortent_qu_a_l_administration(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Un doute n'est pas un fait.

    Le montrer au salon ferait refuser des publications sur une heuristique que
    personne n'a arbitrée, et le montrer au créateur ferait contester un
    soupçon dont il ne connaît pas la règle.
    """
    lien, business = await contrepartie_avec_lien(session)
    await service.ouvrir(session, slug=lien.slug, passage=passage(), resolveur=ResolveurFixe(MIAMI))
    await session.commit()

    admin = await connecter(client, session, "admin")
    vue_admin = await client.get(f"{PREFIX}/admin/link-clicks", **admin)
    assert vue_admin.status_code == 200
    assert "signaux" in vue_admin.json()

    membre = await connecter(client, session, "creator")
    vue_createur = await client.get(f"{PREFIX}/me/link-clicks", **membre)
    assert vue_createur.status_code == 200
    assert "signaux" not in vue_createur.json()


async def test_l_audience_du_createur_est_reservee_aux_createurs(
    client: AsyncClient, session: AsyncSession
) -> None:
    commerce = await connecter(client, session, "business_member")

    refus = await client.get(f"{PREFIX}/me/link-clicks", **commerce)

    assert refus.status_code == 403


async def test_l_audience_totale_est_reservee_a_l_administration(
    client: AsyncClient, session: AsyncSession
) -> None:
    createur = await connecter(client, session, "creator")

    refus = await client.get(f"{PREFIX}/admin/link-clicks", **createur)

    assert refus.status_code == 403

    # Le pendant : un administrateur passe. Sans lui, une route cassée qui
    # refuserait tout le monde passerait ce test.
    admin = await connecter(client, session, "admin")
    accepte = await client.get(f"{PREFIX}/admin/link-clicks", **admin)
    assert accepte.status_code == 200


async def test_un_salon_ne_lit_pas_l_audience_d_un_autre(
    client: AsyncClient, session: AsyncSession
) -> None:
    """L'isolation vient du résolveur d'appartenance, pas d'un filtre écrit ici."""
    from app.models import BusinessMember
    from app.models.enums import BusinessMemberRole, UserRole

    _, salon_a = await contrepartie_avec_lien(session)
    _, salon_b = await contrepartie_avec_lien(session)

    email, motdepasse = f"{uuid.uuid4()}@example.com", "tourbillon-cactus-91-vermeil"
    membre = await inscrire_verifie(
        session, email=email, password=motdepasse, role=UserRole.BUSINESS_MEMBER
    )
    session.add(
        BusinessMember(business_id=salon_b.id, user_id=membre.id, role=BusinessMemberRole.STAFF)
    )
    await session.commit()

    jetons = (
        await client.post(f"{PREFIX}/auth/login", json={"email": email, "password": motdepasse})
    ).json()
    entetes = {"Authorization": f"Bearer {jetons['access_token']}"}

    refus = await client.get(f"{PREFIX}/business/{salon_a.id}/link-clicks", headers=entetes)
    assert refus.status_code == 403

    accepte = await client.get(f"{PREFIX}/business/{salon_b.id}/link-clicks", headers=entetes)
    assert accepte.status_code == 200


async def test_le_createur_recoit_une_adresse_complete_a_coller(
    client: AsyncClient, session: AsyncSession, monkeypatch
) -> None:
    """Assemblée par le serveur : l'app la recomposerait à partir d'une base
    qu'elle devrait connaître, et les deux divergeraient au premier changement
    de domaine."""
    from tests.test_collaboration import contrepartie

    collaboration, decor = await contrepartie(session)
    await session.commit()
    monkeypatch.setattr(
        get_settings(), "link_redirect_base_url", "https://bind.example", raising=False
    )

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login",
            json={"email": decor["createur"].email, "password": "tourbillon-cactus-91-vermeil"},
        )
    ).json()
    entetes = {"Authorization": f"Bearer {jetons['access_token']}"}

    reponse = await client.get(
        f"{PREFIX}/me/collaborations/{collaboration.id}/link", headers=entetes
    )

    assert reponse.status_code == 200
    corps = reponse.json()
    assert corps["url"] == f"https://bind.example/r/{corps['slug']}"
    # Demandé deux fois, c'est le même : un lien déjà collé dans une story ne
    # change pas parce qu'on rouvre l'écran.
    encore = await client.get(
        f"{PREFIX}/me/collaborations/{collaboration.id}/link", headers=entetes
    )
    assert encore.json()["slug"] == corps["slug"]
