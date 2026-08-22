"""Schémas de la reprise d'un compte commerce."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import PorteeDeReprise


class RepriseDemandee(BaseModel):
    """Ce qu'un administrateur doit dire pour entrer.

    Le motif distingue une intervention d'une habitude ; la portée dit ce qu'on
    vient faire, et **elle borne réellement** — chaque requête est vérifiée
    contre elle. Les deux sont obligatoires, et les deux, le salon les lira.
    """

    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=1, max_length=500)
    #: Les écrans qu'on ouvre. **Au moins un** : une portée vide ouvrirait tout
    #: ou rien, et les deux réponses sont mauvaises.
    scope: list[PorteeDeReprise] = Field(min_length=1)
    #: Faux quand le salon a demandé. **Le défaut est « de ma propre
    #: initiative »**, faute d'un canal par lequel le salon écrive : c'est celui
    #: qui affirme avoir été appelé qui doit le dire, sans quoi toute reprise se
    #: présenterait comme sollicitée sans que personne ne l'ait sollicitée.
    #:
    #: **Une déclaration, et elle tient parce que le gérant la lit.** Il est le
    #: seul à savoir s'il a appelé, et il lit ce mot dans sa liste : cocher « le
    #: salon a demandé » quand personne n'a rien demandé se fait devant celui
    #: qui peut le démentir. Voir le modèle pour pourquoi ce champ ne se
    #: calcule pas.
    spontaneous: bool = True


class BusinessSupportAccessRead(BaseModel):
    """Une reprise, telle que l'administration et **le salon** la lisent.

    La même forme des deux côtés : ce que le salon voit de nous est ce que nous
    voyons de nous-mêmes. Rendre une version allégée au commerce demanderait de
    choisir ce qu'on lui cache, et il n'y a rien ici qui se cache.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    business_id: uuid.UUID
    #: **Le nom, et non l'identifiant.** Un UUID ne nomme personne : un gérant
    #: qui lit qu'on est entré chez lui doit pouvoir dire qui. Recopié à
    #: l'ouverture, donc figé — il lira en octobre ce qu'il a lu en mars.
    admin_name: str
    reason: str
    #: Ce que la reprise ouvre. Le salon lit la liste, et la liste est vraie :
    #: une requête hors de ces écrans est refusée, pas seulement mal vue.
    scope: list[PorteeDeReprise]
    #: Vrai quand aucune demande du salon ne l'a précédée. **C'est ce que le
    #: gérant lit en premier** : être entré parce qu'il l'a demandé et être
    #: entré de sa propre initiative ne se défendent pas de la même façon.
    spontaneous: bool
    started_at: datetime
    expires_at: datetime
    #: Nulle quand personne n'a refermé. **Une reprise échue n'est pas une
    #: reprise fermée** : l'expiration éteint sans rien écrire, et les deux ne
    #: se lisent pas pareil.
    ended_at: datetime | None


class RepriseOuverte(BusinessSupportAccessRead):
    """Ce que l'administration lit **d'elle-même** en ouvrant une reprise.

    Une reprise se justifie une par une, et c'est précisément ce qui empêche
    d'en voir l'ensemble : celui qui ouvre la quinzième de la semaine a une
    bonne raison pour celle-là aussi. Le compte est rendu ici pour cette seule
    raison — il ne refuse rien, il se lit.

    Un seuil qui refuserait serait pire : il se contournerait en attendant un
    jour, et transformerait une mesure honnête en formalité à franchir.
    """

    #: Combien de reprises l'appelant a ouvertes sur la fenêtre, **tous salons
    #: confondus**. Closes et échues comprises : ce qu'on mesure est le geste,
    #: pas la porte encore ouverte.
    reprises_recentes_de_l_appelant: int
    #: La largeur de cette fenêtre, en jours. Servie avec le compte parce qu'un
    #: nombre sans sa période ne veut rien dire, et que la période est en
    #: configuration — la lire ici évite de la recopier ailleurs.
    fenetre_en_jours: int
