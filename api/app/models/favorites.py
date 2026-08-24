"""Ce qu'une créatrice met de côté.

**Le favori porte sur la prestation, pas sur l'offre affichée.** Le mur rend une
carte par `tier_offer` — le même article ouvert à deux paliers fait deux cartes,
et c'est voulu. Mais un `tier_offer` meurt de deux façons qui n'ont rien à voir
avec la prestation : le salon ferme ce palier-là et garde l'autre, ou **la
créatrice perd le palier**. Le second est un changement chez elle, et un favori
qui disparaît parce qu'on a baissé d'un palier pendant un mois est un favori
qu'on n'ose plus poser.

`catalog_item` ne meurt qu'à l'archivage, qui est définitif par construction :
« une archive ne se supprime jamais et ne se rouvre jamais ». C'est la seule
mort qui mérite d'emporter le favori, et encore — la liste garde la ligne et dit
pourquoi elle est éteinte, plutôt que de la retirer sans un mot.

**Le salon n'est pas un favori.** Le geste est un cœur sur une carte du fil, et
une carte du fil est une prestation. Ajouter une seconde cible doublerait la
surface pour un geste que personne n'a demandé, et « j'ai un favori chez eux »
répond déjà à la question.
"""

import uuid

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAt, UUIDPrimaryKey


class CreatorFavorite(UUIDPrimaryKey, CreatedAt, Base):
    """Une prestation qu'une créatrice garde sous la main."""

    __tablename__ = "creator_favorite"

    #: **`CASCADE` des deux côtés, et c'est la bonne réponse ici.** Un favori
    #: n'est la trace de rien : il ne prouve aucun accord, il n'ordonne aucun
    #: événement, et personne ne le relira dans six mois. Un compte anonymisé ne
    #: doit rien en garder, et une prestation supprimée — ce qui n'arrive
    #: qu'avant toute réservation — n'a pas à laisser une ligne orpheline.
    creator_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("app_user.id", ondelete="CASCADE"), nullable=False
    )
    catalog_item_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("catalog_item.id", ondelete="CASCADE"), nullable=False
    )

    __table_args__ = (
        # Le geste est un interrupteur : appuyer deux fois sur le cœur ne pose
        # pas deux favoris. La contrainte le dit en base, et le service s'en
        # sert pour rendre le second appui inoffensif plutôt que fautif.
        sa.UniqueConstraint("creator_id", "catalog_item_id", name="un_seul_favori_par_prestation"),
        # La liste se lit par créatrice, la plus récente d'abord.
        sa.Index("ix_creator_favorite_creator_id_created_at", "creator_id", "created_at"),
    )
