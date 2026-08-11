"""Les médias de la plateforme : les poser, et les relire par famille."""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import PlatformAsset
from app.models.enums import BusinessCategory

#: Les deux familles. Écrites une fois ici : un slug composé à la main dans un
#: appelant et une faute de frappe range un média là où personne ne le relit.
CATEGORIE = "category"
ACCUEIL = "home"

#: La vidéo de l'écran d'accueil et son affiche. L'affiche s'affiche pendant le
#: chargement, et reste seule tant qu'aucune vidéo n'est fournie.
#: Deux orientations, parce que l'accueil est en plein écran. Une vidéo 16:9 sur
#: un téléphone tenu droit ne peut donner que des bandes noires ou un recadrage
#: qui coupe le sujet ; une 9:16 sur un écran large a le défaut symétrique.
#:
#: Chaque orientation a son affiche pour la même raison : une affiche 16:9 sous
#: une vidéo 9:16 recadre au chargement, puis la vidéo démarre sur un autre
#: cadrage, et le saut se voit.
VIDEO = f"{ACCUEIL}/video"
AFFICHE_VIDEO = f"{ACCUEIL}/video-poster"
VIDEO_PORTRAIT = f"{ACCUEIL}/video-portrait"
AFFICHE_PORTRAIT = f"{ACCUEIL}/video-portrait-poster"

#: Les quatre, dans l'ordre où la route les rend.
MEDIAS_D_ACCUEIL = (VIDEO, AFFICHE_VIDEO, VIDEO_PORTRAIT, AFFICHE_PORTRAIT)


def slug_de_categorie(categorie: BusinessCategory) -> str:
    return f"{CATEGORIE}/{categorie.value}"


async def poser(session: AsyncSession, *, slug: str, object_key: str) -> None:
    """Range la clé sous ce slug, en remplaçant celle qui s'y trouvait.

    Un `insert … on conflict do update` et non un « lire puis écrire » : le
    semis repose les huit médias à chaque exécution, et la version en deux
    temps aurait laissé le premier passage se comporter autrement que les
    suivants — exactement la différence qu'on ne veut pas avoir à déboguer.
    """
    ordre = insert(PlatformAsset).values(slug=slug, object_key=object_key)
    await session.execute(
        ordre.on_conflict_do_update(
            index_elements=[PlatformAsset.slug],
            set_={
                "object_key": ordre.excluded.object_key,
                "updated_at": sa.text("clock_timestamp()"),
            },
        )
    )


async def photos_de_categories(session: AsyncSession) -> dict[BusinessCategory, str | None]:
    """Les six catégories, **toutes**, photo ou non.

    Rendre seulement celles qui ont une image obligerait l'app à deviner que
    les autres existent quand même, et une catégorie disparaîtrait de Discovery
    parce qu'un fichier manque. Le `None` est une réponse ; l'absence de ligne
    n'en est pas une.
    """
    posees = dict(
        (
            await session.execute(
                sa.select(PlatformAsset.slug, PlatformAsset.object_key).where(
                    PlatformAsset.slug.startswith(f"{CATEGORIE}/")
                )
            )
        ).all()
    )
    return {categorie: posees.get(slug_de_categorie(categorie)) for categorie in BusinessCategory}


async def media_d_accueil(session: AsyncSession) -> dict[str, str | None]:
    """Les quatre médias de l'accueil. Chacun peut manquer, séparément.

    **Aucun n'est obligatoire, et c'est l'app qui arbitre.** Elle sait seule
    quelle orientation lui va ; lui rendre une seule clé « la bonne » reviendrait
    à décider ici d'une chose qu'on ne peut pas savoir d'ici. On rend ce qui
    existe, elle choisit et se replie.
    """
    posees = dict(
        (
            await session.execute(
                sa.select(PlatformAsset.slug, PlatformAsset.object_key).where(
                    PlatformAsset.slug.in_(MEDIAS_D_ACCUEIL)
                )
            )
        ).all()
    )
    return {
        "video_key": posees.get(VIDEO),
        "poster_key": posees.get(AFFICHE_VIDEO),
        "video_portrait_key": posees.get(VIDEO_PORTRAIT),
        "poster_portrait_key": posees.get(AFFICHE_PORTRAIT),
    }
