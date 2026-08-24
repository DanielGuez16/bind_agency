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


class CompteDesReprises(BaseModel):
    """Ce que l'administration lit **d'elle-même**, avant d'ouvrir quoi que ce soit.

    Une reprise se justifie une par une, et c'est précisément ce qui empêche
    d'en voir l'ensemble : celui qui ouvre la quinzième de la semaine a une
    bonne raison pour celle-là aussi. Le compte est rendu pour cette seule
    raison — il ne refuse rien, il se lit.

    Un seuil qui refuserait serait pire : il se contournerait en attendant un
    jour, et transformerait une mesure honnête en formalité à franchir.

    **Servi sur une lecture, et non seulement après l'ouverture.** Lu après
    l'appui, il retient pour la fois suivante — c'est-à-dire qu'il fait ce
    qu'un journal fait, et un journal n'empêche rien. Ce qui retient est de se
    comparer à soi-même **pendant qu'on écrit encore le motif**, quand on peut
    encore ne pas le faire.
    """

    model_config = ConfigDict(from_attributes=True)

    #: Combien de reprises l'appelant a ouvertes sur la fenêtre, **tous salons
    #: confondus**. Closes et échues comprises : ce qu'on mesure est le geste,
    #: pas la porte encore ouverte.
    reprises_recentes_de_l_appelant: int
    #: La largeur de cette fenêtre, en jours. Servie avec le compte parce qu'un
    #: nombre sans sa période ne veut rien dire, et que la période est en
    #: configuration — la lire ici évite de la recopier ailleurs.
    fenetre_en_jours: int


class RepriseOuverte(BusinessSupportAccessRead, CompteDesReprises):
    """La reprise qu'on vient d'ouvrir, et le compte à jour.

    **Les deux champs viennent de `CompteDesReprises` et non d'une copie.** La
    route de lecture et cette réponse-ci disent le même nombre : les écrire deux
    fois les ferait diverger le jour où l'un des deux gagne une nuance, et
    l'écran lirait alors deux vérités selon l'instant où il regarde.

    Le compte rendu ici inclut celle qu'on vient d'ouvrir. La lire à zéro le
    jour de la première serait exact et inutile.
    """


class CommerceVuParLAdministration(BaseModel):
    """Un salon dans la liste que l'administration parcourt pour en reprendre un.

    **De quoi choisir, et rien de plus.** Ce n'est pas la fiche du salon : elle
    existe et se lit derrière une reprise ouverte. Ce qu'il faut ici est de
    reconnaître le bon parmi cent — un nom, un quartier, un état — et de savoir
    si on est déjà dedans.
    """

    model_config = ConfigDict(from_attributes=True)

    business_id: uuid.UUID
    name: str
    category: str
    neighborhood: str | None
    status: str
    #: Vrai quand **l'appelant** a une reprise vivante sur ce salon.
    #:
    #: Sur l'appelant et non sur le salon : savoir qu'un collègue est entré ne
    #: change pas ce que je peux faire, et l'afficher inviterait à se demander
    #: pourquoi lui plutôt que moi. Ce que l'écran doit dire est « tu es déjà
    #: dedans », pour ne pas proposer d'ouvrir une seconde fois.
    reprise_en_cours: bool
