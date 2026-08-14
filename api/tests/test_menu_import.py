"""Import de carte : extraction, relecture, validation.

La propriété centrale est un interdit : **aucun item n'est créé sans validation
explicite du commerce**. L'extraction remplit une charge, elle n'écrit rien dans
le catalogue — un test le vérifie sur une extraction réussie, avec des lignes.

La seconde est que **la durée est saisie, jamais extraite**. Une ligne
réservable sans durée est refusée à la validation, en bloc : créer la moitié des
items laisserait un catalogue à moitié importé qu'il faudrait démêler.
"""

import json
import uuid
from decimal import Decimal

import httpx
import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import ConfigurationError, build_settings, get_settings
from app.integrations.menu_extraction import (
    Extraction,
    ExtractionError,
    LigneExtraite,
    ManualExtractor,
    VisionExtractor,
    check_extraction_configuration,
)
from app.models import CatalogItem, MenuImport
from app.models.enums import CatalogItemSource, MenuImportStatus, UserRole
from app.services import auth as auth_service
from app.services import menu_import as service
from tests.test_availability import commerce

PREFIX = get_settings().api_v1_prefix

CARTE = b"un-pdf-de-carte"


class FauxExtracteur:
    """Rend ce qu'on lui donne, ou lève."""

    def __init__(self, *, rend: Extraction | None = None, leve: Exception | None = None):
        self.rend = rend
        self.leve = leve
        self.appels = 0

    async def extraire(self, contenu: bytes, *, mime_type: str) -> Extraction:
        self.appels += 1
        if self.leve is not None:
            raise self.leve
        return self.rend or Extraction(lignes=())


def extraction(*lignes: tuple[str, int, str]) -> Extraction:
    return Extraction(
        currency="USD",
        lignes=tuple(
            LigneExtraite(name=nom, price_cents=prix, confidence=Decimal(confiance))
            for nom, prix, confiance in lignes
        ),
    )


async def import_extrait(session: AsyncSession, *lignes) -> tuple[MenuImport, object]:
    b = await commerce(session)
    ligne = await service.creer(
        session, business=b, file_key="cartes/salon.pdf", mime_type="application/pdf"
    )
    await service.extraire(
        session,
        import_=ligne,
        contenu=CARTE,
        extractor=FauxExtracteur(rend=extraction(*lignes)),
    )
    return ligne, b


async def membre(session: AsyncSession):
    return await auth_service.register(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password="un-mot-de-passe-solide-42",
        role=UserRole.BUSINESS_MEMBER,
    )


async def items_de(session: AsyncSession, business_id: uuid.UUID) -> list[CatalogItem]:
    return list(
        await session.scalars(sa.select(CatalogItem).where(CatalogItem.business_id == business_id))
    )


# --------------------------------------------------------------------------
# l'interdit central
# --------------------------------------------------------------------------


async def test_une_extraction_ne_cree_aucun_item(session: AsyncSession) -> None:
    """Même réussie, même avec des lignes parfaitement lues. C'est la
    validation qui écrit, et elle seule."""
    ligne, b = await import_extrait(session, ("Soin visage", 8000, "0.95"), ("Coupe", 4000, "0.9"))

    assert ligne.status is MenuImportStatus.EXTRACTED
    assert len(ligne.extracted_payload["lignes"]) == 2
    assert await items_de(session, b.id) == []


async def test_la_validation_cree_ce_que_le_commerce_a_relu(session: AsyncSession) -> None:
    """Les items viennent des lignes révisées, jamais de la charge extraite :
    valider en relisant la charge annulerait la relecture."""
    ligne, b = await import_extrait(session, ("Soin visage", 8000, "0.95"))
    await service.ouvrir_la_relecture(session, import_=ligne)
    user = await membre(session)

    crees = await service.valider(
        session,
        import_=ligne,
        business=b,
        lignes=[
            # Le commerce a corrigé le nom et le prix : c'est le but de l'écran.
            service.LigneRevue(name="Soin visage premium", price_cents=9500, duration_minutes=60)
        ],
        reviewed_by=user.id,
    )

    assert len(crees) == 1
    assert crees[0].name == "Soin visage premium"
    assert crees[0].price_cents == 9500
    assert ligne.status is MenuImportStatus.VALIDATED
    assert ligne.reviewed_by == user.id


async def test_une_ligne_ecartee_ne_devient_pas_un_item(session: AsyncSession) -> None:
    ligne, b = await import_extrait(session, ("Soin", 8000, "0.9"), ("Ligne fausse", 1, "0.2"))
    await service.ouvrir_la_relecture(session, import_=ligne)
    user = await membre(session)

    crees = await service.valider(
        session,
        import_=ligne,
        business=b,
        lignes=[
            service.LigneRevue(name="Soin", price_cents=8000, duration_minutes=60),
            service.LigneRevue(name="Ligne fausse", price_cents=1, retenue=False),
        ],
        reviewed_by=user.id,
    )

    assert [item.name for item in crees] == ["Soin"]
    # Ce que le commerce a refusé est conservé : savoir ce qu'il écarte vaut
    # autant que savoir ce qu'il garde.
    revisee = ligne.extracted_payload["revisee"]
    assert any(item["name"] == "Ligne fausse" and item["retenue"] is False for item in revisee)


async def test_les_items_importes_sont_marques_comme_tels(session: AsyncSession) -> None:
    """Savoir lesquels viennent d'où sert le jour où l'on veut mesurer ce que le
    modèle rate."""
    ligne, b = await import_extrait(session, ("Soin", 8000, "0.9"))
    await service.ouvrir_la_relecture(session, import_=ligne)
    user = await membre(session)

    await service.valider(
        session,
        import_=ligne,
        business=b,
        lignes=[service.LigneRevue(name="Soin", price_cents=8000, duration_minutes=60)],
        reviewed_by=user.id,
    )

    business_id = b.id
    session.expire_all()
    items = await items_de(session, business_id)
    assert [item.source for item in items] == [CatalogItemSource.IMPORT]


# --------------------------------------------------------------------------
# la durée est saisie, jamais extraite
# --------------------------------------------------------------------------


def test_l_extraction_ne_rend_aucune_durée() -> None:
    """Lui demander la durée produirait une invention plausible, et une durée
    inventée fausse tout le calcul de capacité sans que personne ne le voie."""
    champs = LigneExtraite.__dataclass_fields__

    assert "duration_minutes" not in champs
    assert {"name", "price_cents", "description", "confidence"} <= set(champs)


async def test_une_ligne_reservable_sans_duree_est_refusee(session: AsyncSession) -> None:
    ligne, b = await import_extrait(session, ("Soin", 8000, "0.9"))
    await service.ouvrir_la_relecture(session, import_=ligne)
    user = await membre(session)

    with pytest.raises(service.DurationRequired, match="Soin"):
        await service.valider(
            session,
            import_=ligne,
            business=b,
            lignes=[service.LigneRevue(name="Soin", price_cents=8000)],
            reviewed_by=user.id,
        )

    # Rien n'a été créé, et l'import n'a pas bougé : refusé en bloc.
    assert await items_de(session, b.id) == []
    assert ligne.status is MenuImportStatus.UNDER_REVIEW


async def test_le_refus_est_en_bloc_pas_a_moitie(session: AsyncSession) -> None:
    """Créer la moitié des items laisserait le commerce devant un catalogue à
    moitié importé qu'il faudrait démêler."""
    ligne, b = await import_extrait(session, ("A", 1000, "0.9"), ("B", 2000, "0.9"))
    await service.ouvrir_la_relecture(session, import_=ligne)
    user = await membre(session)

    with pytest.raises(service.DurationRequired):
        await service.valider(
            session,
            import_=ligne,
            business=b,
            lignes=[
                service.LigneRevue(name="A", price_cents=1000, duration_minutes=30),
                service.LigneRevue(name="B", price_cents=2000),
            ],
            reviewed_by=user.id,
        )

    assert await items_de(session, b.id) == []


async def test_une_ligne_non_reservable_n_exige_pas_de_duree(session: AsyncSession) -> None:
    """Une entrée de musée ou un plat ne se réserve pas : la durée n'a pas
    d'objet, et l'exiger bloquerait des catalogues entiers."""
    ligne, b = await import_extrait(session, ("Café", 300, "0.9"))
    await service.ouvrir_la_relecture(session, import_=ligne)
    user = await membre(session)

    crees = await service.valider(
        session,
        import_=ligne,
        business=b,
        lignes=[service.LigneRevue(name="Café", price_cents=300, requires_booking=False)],
        reviewed_by=user.id,
    )

    assert crees[0].duration_minutes is None
    assert crees[0].requires_booking is False


# --------------------------------------------------------------------------
# les états
# --------------------------------------------------------------------------


async def test_une_extraction_ratee_dit_pourquoi(session: AsyncSession) -> None:
    """Laisser un commerce devant un import bloqué sans explication est pire
    que lui dire que la lecture a raté."""
    b = await commerce(session)
    ligne = await service.creer(
        session, business=b, file_key="cartes/illisible.pdf", mime_type="application/pdf"
    )

    await service.extraire(
        session,
        import_=ligne,
        contenu=CARTE,
        extractor=FauxExtracteur(leve=ExtractionError("modèle injoignable")),
    )

    assert ligne.status is MenuImportStatus.FAILED
    assert "injoignable" in ligne.extracted_payload["erreur"]


async def test_un_import_valide_ne_se_revalide_pas(session: AsyncSession) -> None:
    ligne, b = await import_extrait(session, ("Soin", 8000, "0.9"))
    await service.ouvrir_la_relecture(session, import_=ligne)
    user = await membre(session)
    await service.valider(
        session,
        import_=ligne,
        business=b,
        lignes=[service.LigneRevue(name="Soin", price_cents=8000, duration_minutes=60)],
        reviewed_by=user.id,
    )

    with pytest.raises(service.TransitionNotAllowed):
        await service.valider(
            session,
            import_=ligne,
            business=b,
            lignes=[service.LigneRevue(name="Doublon", price_cents=1, duration_minutes=1)],
            reviewed_by=user.id,
        )

    business_id = b.id
    session.expire_all()
    assert len(await items_de(session, business_id)) == 1


async def test_un_import_rate_ne_se_valide_pas(session: AsyncSession) -> None:
    b = await commerce(session)
    ligne = await service.creer(session, business=b, file_key="x", mime_type="application/pdf")
    await service.extraire(
        session, import_=ligne, contenu=CARTE, extractor=FauxExtracteur(leve=ExtractionError("x"))
    )
    user = await membre(session)

    with pytest.raises(service.TransitionNotAllowed):
        await service.valider(
            session,
            import_=ligne,
            business=b,
            lignes=[service.LigneRevue(name="A", price_cents=1, duration_minutes=1)],
            reviewed_by=user.id,
        )


def test_tous_les_etats_figurent_dans_la_table() -> None:
    assert set(service.TRANSITIONS) == set(MenuImportStatus)


async def test_l_import_d_un_autre_commerce_est_introuvable(session: AsyncSession) -> None:
    ligne, _ = await import_extrait(session, ("Soin", 8000, "0.9"))
    autre = await commerce(session)

    with pytest.raises(service.ImportNotFound):
        await service.du_commerce(session, import_id=ligne.id, business_id=autre.id)


async def test_la_confiance_moyenne_ordonne_la_relecture(session: AsyncSession) -> None:
    """Une extraction rendue sans confiance obligerait à tout relire avec la
    même attention, ce qui revient à ne rien relire."""
    sure, _ = await import_extrait(session, ("A", 1000, "0.95"), ("B", 2000, "0.85"))
    douteuse, _ = await import_extrait(session, ("C", 1000, "0.3"), ("D", 2000, "0.2"))

    assert service.confiance_moyenne(sure) > service.confiance_moyenne(douteuse)

    vide = await service.creer(
        session, business=await commerce(session), file_key="x", mime_type="application/pdf"
    )
    assert service.confiance_moyenne(vide) is None


# --------------------------------------------------------------------------
# le fournisseur
# --------------------------------------------------------------------------


def test_vision_sans_cle_empeche_de_demarrer(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.core import encryption
    from app.integrations import menu_extraction as module

    reglages = build_settings(
        _env_file=None,
        database_url=str(get_settings().database_url),
        jwt_secret_key="peu-importe-ici-mais-assez-longue-pour-hmac",
        token_encryption_key=encryption.generate_key(),
        menu_extraction_provider="vision",
    )
    monkeypatch.setattr(module, "get_settings", lambda: reglages)

    with pytest.raises(ConfigurationError, match="MENU_EXTRACTION_API_KEY"):
        check_extraction_configuration()


def test_le_mode_manuel_ne_demande_rien() -> None:
    check_extraction_configuration()


async def test_le_mode_manuel_n_extrait_rien() -> None:
    """Le commerce saisit sa carte, ce qui reste le chemin de la phase 2 et
    fonctionne parfaitement."""
    resultat = await ManualExtractor().extraire(CARTE, mime_type="application/pdf")
    assert resultat.lignes == ()


@pytest.fixture
def vision_configure(monkeypatch: pytest.MonkeyPatch):
    from app.core import encryption
    from app.integrations import menu_extraction as module

    reglages = build_settings(
        _env_file=None,
        database_url=str(get_settings().database_url),
        jwt_secret_key="peu-importe-ici-mais-assez-longue-pour-hmac",
        token_encryption_key=encryption.generate_key(),
        menu_extraction_provider="vision",
        menu_extraction_api_key="une-cle-modele",
    )
    monkeypatch.setattr(module, "get_settings", lambda: reglages)
    return reglages


def reponse_modele(charge: dict) -> httpx.Response:
    return httpx.Response(200, json={"content": [{"type": "text", "text": json.dumps(charge)}]})


async def test_le_modele_rend_des_lignes_exploitables(vision_configure) -> None:
    charge = {
        "currency": "USD",
        "lignes": [
            {"name": "Soin visage", "price_cents": 8000, "description": None, "confidence": 0.93}
        ],
    }

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda r: reponse_modele(charge))
    ) as http:
        resultat = await VisionExtractor(http).extraire(CARTE, mime_type="image/jpeg")

    assert resultat.currency == "USD"
    assert resultat.lignes[0].name == "Soin visage"
    assert resultat.lignes[0].price_cents == 8000
    assert resultat.lignes[0].confidence == Decimal("0.93")


@pytest.mark.parametrize(
    "ligne",
    [
        {"name": "", "price_cents": 100},
        {"name": "Sans prix"},
        {"name": "Prix flottant", "price_cents": 12.5},
        {"name": "Prix négatif", "price_cents": -100},
        "pas un objet",
    ],
)
async def test_une_ligne_a_moitie_lue_est_ecartee(ligne, vision_configure) -> None:
    """Une ligne à moitié lue coûte plus de temps à corriger qu'à ressaisir, et
    elle passe plus facilement la relecture qu'une absence."""
    charge = {"currency": None, "lignes": [ligne]}

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda r: reponse_modele(charge))
    ) as http:
        resultat = await VisionExtractor(http).extraire(CARTE, mime_type="image/jpeg")

    assert resultat.lignes == ()


@pytest.mark.parametrize(
    "reponse",
    [
        httpx.Response(200, json={"content": []}),
        httpx.Response(200, json={"content": [{"type": "text", "text": "pas du json"}]}),
        httpx.Response(200, json={"content": [{"type": "text", "text": '{"lignes": "x"}'}]}),
        httpx.Response(401, json={"error": "clé invalide"}),
        httpx.Response(500, text="down"),
    ],
)
async def test_une_reponse_inexploitable_leve_au_lieu_de_rendre_vide(
    reponse: httpx.Response, vision_configure
) -> None:
    """Le vide veut dire « rien trouvé sur cette carte ». Le confondre avec un
    échec ferait valider une carte blanche."""
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: reponse)) as http:
        with pytest.raises(ExtractionError):
            await VisionExtractor(http).extraire(CARTE, mime_type="image/jpeg")


async def test_le_reseau_coupe_leve_une_erreur_d_extraction(vision_configure) -> None:
    def couper(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refusé", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(couper)) as http:
        with pytest.raises(ExtractionError):
            await VisionExtractor(http).extraire(CARTE, mime_type="image/jpeg")


def test_l_instruction_interdit_d_inventer_une_duree() -> None:
    """Le garde-fou est dans la consigne autant que dans le type de retour."""
    from app.integrations.menu_extraction import INSTRUCTION

    assert "durée" in INSTRUCTION.lower()
    assert "n'invente" in INSTRUCTION.lower()


# --------------------------------------------------------------------------
# la photo de la carte, de bout en bout
# --------------------------------------------------------------------------
#
# **Ce que ces tests gardent, et qui manquait.** L'extraction est faite pour
# lire une photo — le contenu part en bloc image vers un modèle vision. Mais la
# route d'extraction passait `b""` : elle ne relisait jamais le fichier. En mode
# `manual` l'extraction rend une charge vide de toute façon, donc **aucun test
# ne le voyait**. Une photo de carte partait au modèle vide.
#
# Et aucune route ne permettait de déposer une carte : la création d'un import
# exige une clé de fichier, et seules la galerie et les preuves savaient en
# produire une.

PIXEL_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c6300010000050001"
)


async def entetes_du_commerce(session, client: AsyncClient, business) -> dict[str, str]:
    """Le propriétaire du commerce, connecté.

    Le décor rend le commerce et non son membre : on retrouve celui-ci par
    l'appartenance, qui est la seule vérité sur qui peut agir en son nom.
    """
    from app.models import BusinessMember, User

    membre = await session.scalar(
        sa.select(User)
        .join(BusinessMember, BusinessMember.user_id == User.id)
        .where(BusinessMember.business_id == business.id)
    )
    await session.commit()
    jetons = (
        await client.post(
            f"{PREFIX}/auth/login",
            json={"email": membre.email, "password": "un-mot-de-passe-solide-42"},
        )
    ).json()
    return {"Authorization": f"Bearer {jetons['access_token']}"}


async def test_une_photo_de_carte_se_depose_et_rend_sa_cle(
    session: AsyncSession, client: AsyncClient
) -> None:
    """**Le chemin qui n'existait pas.** Sans lui, la fondatrice photographie la
    carte au mur et n'a nulle part où la mettre."""
    business = await commerce(session)
    en_tetes = await entetes_du_commerce(session, client, business)

    reponse = await client.post(
        f"{PREFIX}/business/{business.id}/menu-imports/uploads",
        files={"fichier": ("carte.png", PIXEL_PNG, "image/png")},
        headers=en_tetes,
    )

    assert reponse.status_code == 201, reponse.text
    assert reponse.json()["file_key"].startswith("photos/cartes/")
    # Le type vient de la signature, jamais de ce que l'appelant déclare.
    assert reponse.json()["mime_type"] == "image/png"


async def test_le_type_declare_par_l_appelant_ne_compte_pas(
    session: AsyncSession, client: AsyncClient
) -> None:
    """Un appelant qui annonce `image/png` sur un fichier texte se ferait
    refuser par le modèle, après l'avoir payé."""
    business = await commerce(session)
    en_tetes = await entetes_du_commerce(session, client, business)

    reponse = await client.post(
        f"{PREFIX}/business/{business.id}/menu-imports/uploads",
        files={"fichier": ("carte.png", b"ceci n'est pas une image", "image/png")},
        headers=en_tetes,
    )

    assert reponse.status_code == 415


async def test_l_extraction_lit_reellement_le_fichier_depose(
    session: AsyncSession, client: AsyncClient
) -> None:
    """**Le défaut trouvé en campagne 3.** La route passait `b""` au modèle.

    Le fournisseur retenu ici note ce qu'il a reçu : c'est la seule façon de
    prouver que les octets déposés sont ceux qui partent — un fournisseur muet
    aurait laissé passer le `b""` pendant encore trois campagnes.
    """
    business = await commerce(session)
    en_tetes = await entetes_du_commerce(session, client, business)

    depot = (
        await client.post(
            f"{PREFIX}/business/{business.id}/menu-imports/uploads",
            files={"fichier": ("carte.png", PIXEL_PNG, "image/png")},
            headers=en_tetes,
        )
    ).json()
    cree = await client.post(
        f"{PREFIX}/business/{business.id}/menu-imports",
        json={"file_key": depot["file_key"], "mime_type": depot["mime_type"]},
        headers=en_tetes,
    )
    assert cree.status_code == 201, cree.text

    recus: list[bytes] = []

    class ExtracteurQuiNote:
        async def extraire(self, contenu: bytes, *, mime_type: str):
            recus.append(contenu)
            return Extraction(lignes=())

    from app.integrations import menu_extraction
    from app.routers import menu_import as routeur

    original = routeur.get_extractor
    routeur.get_extractor = lambda _client: ExtracteurQuiNote()
    try:
        reponse = await client.post(
            f"{PREFIX}/business/{business.id}/menu-imports/{cree.json()['id']}/extract",
            headers=en_tetes,
        )
    finally:
        routeur.get_extractor = original
    del menu_extraction

    assert reponse.status_code == 200, reponse.text
    assert recus == [PIXEL_PNG], "le modèle doit recevoir les octets déposés, pas du vide"


async def test_une_cle_morte_ne_part_pas_au_modele(
    session: AsyncSession, client: AsyncClient
) -> None:
    """**Le vide n'est pas une carte blanche.**

    Si la clé ne désigne plus rien, envoyer zéro octet au modèle lui ferait
    répondre « rien trouvé » — et le commerce validerait une carte vide en
    croyant que sa photo était illisible. Un refus nommé, et rien de payé.
    """
    business = await commerce(session)
    en_tetes = await entetes_du_commerce(session, client, business)

    cree = await client.post(
        f"{PREFIX}/business/{business.id}/menu-imports",
        json={"file_key": "photos/cartes/inexistante", "mime_type": "image/png"},
        headers=en_tetes,
    )
    assert cree.status_code == 201, cree.text

    reponse = await client.post(
        f"{PREFIX}/business/{business.id}/menu-imports/{cree.json()['id']}/extract",
        headers=en_tetes,
    )

    assert reponse.status_code == 404, reponse.text
