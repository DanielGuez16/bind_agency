"""Import de carte : téléversement, extraction, relecture, validation.

**Aucun item n'est créé sans validation explicite du commerce.** C'est la règle
du dépôt, et c'est la seule chose qui empêche une carte mal lue de peupler un
catalogue avec des prix faux. L'extraction remplit une charge ; la validation
crée les items, à partir de ce que le commerce a **relu et corrigé**, pas de ce
que le modèle a proposé.

**La durée est saisie à la relecture, jamais extraite.** Une carte affiche des
prix, pas des temps de poste — et quand elle affiche une durée, c'est celle
annoncée au client, pas celle que le commerce bloque. Sans durée, aucun calcul
de capacité n'est possible : une ligne réservable sans durée est refusée à la
validation, pas silencieusement créée sans elle.

**La charge extraite est conservée telle quelle.** Ce que le commerce valide est
une charge *révisée*, distincte de ce que le modèle avait lu. Garder les deux
permet de mesurer ce que le modèle rate — et de savoir, dans six mois, si le
changer a amélioré quelque chose.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.menu_extraction import Extraction, ExtractionError, MenuExtractor
from app.models import Business, CatalogItem, MenuImport
from app.models.enums import CatalogItemSource, MenuImportStatus
from app.schemas.catalog import CatalogItemCreate
from app.services import catalog as catalog_service

#: Transitions autorisées. `uploaded → failed` existe parce qu'une extraction
#: peut échouer avant d'avoir produit quoi que ce soit ; `extracted → failed`
#: n'existe pas, une extraction obtenue ne se perd pas.
TRANSITIONS: dict[MenuImportStatus, frozenset[MenuImportStatus]] = {
    MenuImportStatus.UPLOADED: frozenset({MenuImportStatus.EXTRACTED, MenuImportStatus.FAILED}),
    MenuImportStatus.EXTRACTED: frozenset({MenuImportStatus.UNDER_REVIEW}),
    MenuImportStatus.UNDER_REVIEW: frozenset(
        {MenuImportStatus.VALIDATED, MenuImportStatus.UNDER_REVIEW}
    ),
    MenuImportStatus.VALIDATED: frozenset(),
    #: Un échec se reprend en téléversant à nouveau, pas en réessayant sur
    #: place : le fichier était peut-être le problème.
    MenuImportStatus.FAILED: frozenset(),
}


class MenuImportError(Exception):
    """Base des refus d'import."""


class ImportNotFound(MenuImportError):
    """Import inexistant, ou d'un autre commerce."""


class TransitionNotAllowed(MenuImportError):
    """L'import n'est pas dans un état qui permette ce geste."""


class DurationRequired(MenuImportError):
    """Une ligne réservable sans durée ne se valide pas.

    Sans durée, aucun calcul de capacité n'est possible : la créer quand même
    donnerait un item qui n'apparaîtrait jamais dans un fil, sans que personne
    ne comprenne pourquoi.
    """


@dataclass(frozen=True, slots=True)
class LigneRevue:
    """Ce que le commerce a relu. Le nom et le prix peuvent différer de
    l'extraction : c'est le but de la relecture."""

    name: str
    price_cents: int
    description: str | None = None
    duration_minutes: int | None = None
    requires_booking: bool = True
    #: Écartée par le commerce. Conservée dans la charge révisée — savoir ce
    #: qu'il a refusé vaut autant que savoir ce qu'il a gardé.
    retenue: bool = True


async def creer(
    session: AsyncSession, *, business: Business, file_key: str, mime_type: str
) -> MenuImport:
    """Enregistre le téléversement. Rien n'est lu à ce stade."""
    ligne = MenuImport(
        business_id=business.id,
        file_key=file_key,
        mime_type=mime_type,
        status=MenuImportStatus.UPLOADED,
    )
    session.add(ligne)
    await session.flush()
    return ligne


async def extraire(
    session: AsyncSession,
    *,
    import_: MenuImport,
    contenu: bytes,
    extractor: MenuExtractor,
) -> MenuImport:
    """Lit la carte et remplit la charge. Ne crée aucun item.

    Un échec fait passer l'import en `failed` avec sa raison : laisser un
    commerce devant un import bloqué en `uploaded` sans explication est pire que
    lui dire que la lecture a raté.
    """
    _exiger(import_, MenuImportStatus.EXTRACTED)

    try:
        extraction = await extractor.extraire(contenu, mime_type=import_.mime_type)
    except ExtractionError as error:
        import_.status = MenuImportStatus.FAILED
        import_.extracted_payload = {"erreur": str(error)}
        await session.flush()
        return import_

    import_.extracted_payload = _serialiser(extraction)
    import_.status = MenuImportStatus.EXTRACTED
    await session.flush()
    return import_


def _serialiser(extraction: Extraction) -> dict:
    """La charge, telle que le modèle l'a rendue. Conservée sans retouche."""
    return {
        "currency": extraction.currency,
        "lignes": [
            {
                "name": ligne.name,
                "price_cents": ligne.price_cents,
                "description": ligne.description,
                "confidence": str(ligne.confidence),
            }
            for ligne in extraction.lignes
        ],
    }


async def valider(
    session: AsyncSession,
    *,
    import_: MenuImport,
    business: Business,
    lignes: list[LigneRevue],
    reviewed_by: uuid.UUID,
) -> list[CatalogItem]:
    """Crée les items depuis ce que le commerce a relu. Le seul chemin.

    Les items viennent des lignes **révisées**, jamais de la charge extraite :
    valider en relisant la charge annulerait la relecture, et personne ne s'en
    apercevrait avant de voir des prix faux dans un fil.
    """
    _exiger(import_, MenuImportStatus.VALIDATED)

    retenues = [ligne for ligne in lignes if ligne.retenue]
    sans_duree = [
        ligne.name for ligne in retenues if ligne.requires_booking and not ligne.duration_minutes
    ]
    if sans_duree:
        # Refusé en bloc : créer la moitié des items laisserait le commerce
        # devant un catalogue à moitié importé qu'il faudrait démêler.
        raise DurationRequired(", ".join(sans_duree))

    crees = []
    for ligne in retenues:
        crees.append(
            await catalog_service.create_item(
                session,
                business=business,
                payload=CatalogItemCreate(
                    name=ligne.name,
                    description=ligne.description,
                    price_cents=ligne.price_cents,
                    duration_minutes=ligne.duration_minutes if ligne.requires_booking else None,
                    requires_booking=ligne.requires_booking,
                ),
            )
        )

    # Marqués comme importés : un catalogue mélange des items saisis à la main
    # et des items relus, et savoir lesquels viennent d'où sert le jour où l'on
    # veut mesurer ce que le modèle rate.
    if crees:
        await session.execute(
            sa.update(CatalogItem)
            .where(CatalogItem.id.in_([item.id for item in crees]))
            .values(source=CatalogItemSource.IMPORT)
        )

    import_.status = MenuImportStatus.VALIDATED
    import_.reviewed_by = reviewed_by
    import_.reviewed_at = datetime.now(UTC)
    import_.extracted_payload = {
        **(import_.extracted_payload or {}),
        # La charge révisée, à côté de l'extraite. Comparer les deux dit ce que
        # le modèle a raté, et si le changer a servi à quelque chose.
        "revisee": [
            {
                "name": ligne.name,
                "price_cents": ligne.price_cents,
                "duration_minutes": ligne.duration_minutes,
                "requires_booking": ligne.requires_booking,
                "retenue": ligne.retenue,
            }
            for ligne in lignes
        ],
    }
    await session.flush()
    return crees


def _exiger(import_: MenuImport, vers: MenuImportStatus) -> None:
    if vers not in TRANSITIONS[import_.status]:
        raise TransitionNotAllowed(f"{import_.status.value} → {vers.value}")


async def ouvrir_la_relecture(session: AsyncSession, *, import_: MenuImport) -> MenuImport:
    """Marque que quelqu'un regarde. Idempotent : rouvrir n'est pas une faute."""
    _exiger(import_, MenuImportStatus.UNDER_REVIEW)
    import_.status = MenuImportStatus.UNDER_REVIEW
    await session.flush()
    return import_


async def du_commerce(
    session: AsyncSession, *, import_id: uuid.UUID, business_id: uuid.UUID
) -> MenuImport:
    ligne = await session.get(MenuImport, import_id)
    if ligne is None or ligne.business_id != business_id:
        # Même réponse pour les deux : distinguer dirait à un commerce quels
        # imports existent chez un autre.
        raise ImportNotFound(str(import_id))
    return ligne


def confiance_moyenne(import_: MenuImport) -> Decimal | None:
    """Sert à ordonner ce qu'un humain doit regarder en premier.

    Une extraction rendue sans confiance obligerait à tout relire avec la même
    attention, ce qui revient à ne rien relire.
    """
    lignes = (import_.extracted_payload or {}).get("lignes") or []
    if not lignes:
        return None
    total = sum(Decimal(str(ligne.get("confidence") or 0)) for ligne in lignes)
    return (total / len(lignes)).quantize(Decimal("0.01"))
