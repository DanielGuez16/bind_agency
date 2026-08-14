# Passation — BIND AGENCY · v1.0 · nouvelle direction

> Remplacement complet du système Miami After Hours (v0.4). Ce document, avec
> `tokens.json` v1.0 et `components.md` v1.0, est la référence. Les passations
> v0.5 à v0.7 restent valables pour la **structure** des écrans qu'elles
> décrivent — découverte, fiche salon, gabarit de bureau, paliers — et sont
> caduques sur toute valeur de couleur, de typographie et de rayon.
>
> Planche : `BIND AGENCY - Design System v1.0.dc.html`.

## Ce qui est demandé

La marque de l'agence de la fondatrice. Le produit était vert et éditorial, la
marque est orange et mode. Changement de système, pas d'ajustement.

## Deux points ouverts, un seul restant

Les visuels Instagram et le logo sont arrivés après la première écriture de ce
document. Ils confirment **`brand.500` à `#F26B21`** — votre lecture était juste,
et l'écart de vivacité entre le satin et le bloc plein est de la compression JPEG,
pas de la charte.

Ils corrigent en revanche trois déductions, listées au §0.

**Il reste à obtenir le logo en vectoriel.** Les lettres sont dessinées à la main
— le D porte une coupe oblique qu'aucune fonte ne donne. Toute reconstruction en
Outfit reste une approximation, y compris celle de la planche.

## 0. Ce que les visuels ont corrigé

Trois choses que j'avais déduites de travers du brief écrit.

### Le titre est d'une seule famille, à deux voix

J'avais lu « un serif italique pour les mots accentués, un sans géométrique pour le
reste, les deux dans le même titre ». Ce n'est pas ce qu'elle fait. Sur
« L'accompagnement / Talent by *Bind* », les deux lignes sont **du même Didone** :
romain pour la première, italique pour la seconde. L'accent est un changement de
**voix**, pas de **famille**.

C'est plus juste et plus simple : il n'y a plus de raccord entre deux fontes à
réussir. Conséquence sur l'échelle typographique, au §2.

### Le texte du bloc est blanc

J'avais mis l'encre en défaut sur le bloc. Sur ses visuels, le mot dans le bloc
est **blanc** neuf fois sur onze — *Noël*, *Bind*, *Tolérance*, *Actus Influence*.
L'encre n'apparaît que sur deux étiquettes courtes (*Talent*, *5 astuces*).

Le blanc devient donc le défaut du bloc, l'encre une variante admise. La règle
d'accessibilité ne bouge pas : le bloc est toujours au-dessus de 34 px, où le blanc
passe. L'encre reste obligatoire sous 24 px, donc sur les boutons et les pastilles.

### Le logo est fin et monochrome

Je l'avais fait gras, avec le point d'exclamation en orange. Il est en **trait
fin**, monoline, géométrique large, **entièrement blanc**, et le « ! » n'est jamais
coloré à part : c'est une lettre, pas un accent. AGENCY est centré dessous, en trait
fin, très espacé.

Une seule couleur par occurrence : blanc sur orange, satin ou encre ; encre sur os.

## 1. Une teinte, deux emplois

La rampe compte neuf valeurs. Deux seulement portent un rôle fonctionnel, et
c'est la règle centrale du système :

| Valeur | Emploi |
| --- | --- |
| `brand.500` `#F26B21` | **Surface uniquement.** Ne s'écrit jamais. |
| `brand.700` `#A83E06` | **Texte uniquement.** Ne se pose jamais en fond plein. |
| `brand.600` | État appuyé de tout ce qui est en 500. |
| 50, 100, 200, 400, 900 | Matière : satins, teinte du palier post, bandeaux. |

Les gris violacés de la v0.4 sont remplacés par des neutres chauds. Un neutre
froid posé à côté d'un orange saturé le fait virer au rouge brique.

## 2. Typographie

**Bodoni Moda** tient le titre, en romain pour la ligne et en italique pour le mot
accentué. **Outfit** tient tout le fonctionnel : titres d'écran, sections, corps,
légendes, étiquettes, boutons, navigation. **IBM Plex Mono** est conservé pour les
chiffres, les codes et les horaires.

Familjen Grotesk et IBM Plex Sans sont retirés.

**La frontière entre les deux familles est une taille, pas un rôle : le Didone ne
descend jamais sous 34 px.** En dessous, Outfit, toujours. C'est ce qui empêche le
serif de se répandre dans une interface où il n'a rien à faire — et c'est aussi la
façon la plus sûre de tenir la règle en revue : un serif de 22 px est un bug
visible.

| Jeton | Famille | Taille |
| --- | --- | --- |
| `display` | Bodoni Moda romain | 58 / 66 |
| `displayAccent` | Bodoni Moda italique | 58 / 66 |
| `heading` | Bodoni Moda romain | 34 / 42 — plancher |
| `headingAccent` | Bodoni Moda italique | 34 / 42 |
| `screenTitle` | Outfit 600 | 28 / 34 |
| `section` | Outfit 600 | 22 / 28 |

La règle du mot accentué est portée par un composant, `TitreAccentue`, et non
laissée à l'appelant : un seul mot par titre, un mot porteur de sens, rien sous
34 px, et la clé i18n qui transporte le mot séparément — l'accent se déplace en
espagnol.

**Quand le mot accentué porte le bloc, il ouvre sa ligne**, comme sur ses visuels.
Le bloc pend sous la ligne du dessus au lieu de s'insérer dans une phrase : un
retour à la ligne ne peut plus le couper, et la ponctuation qui suit reste collée
au bloc.

Le trait d'icône passe de 1,75 à 2. À côté d'un Bodoni très contrasté, un trait
de 1,75 paraît hésitant.

## 3. Tension 1 — le contraste

Vous demandiez où l'orange peut être un texte et où il doit être un fond. Les
rapports sont mesurés, la réponse est mécanique.

| Combinaison | Rapport | Verdict |
| --- | --- | --- |
| `brand.500` sur blanc | 3,0:1 | **Interdit en texte**, quelle que soit la taille |
| `brand.700` sur blanc | 6,3:1 | Toute taille |
| `brand.700` sur `bg.page` | 5,7:1 | Toute taille |
| encre sur `brand.500` | 6,1:1 | Toute taille — **le défaut en interface** |
| blanc sur `brand.500` | 3,0:1 | **≥ 24 px seulement — le défaut du bloc** |

En une phrase : *l'orange 500 ne s'écrit jamais, l'orange 700 s'écrit toujours,
et sur un fond orange le texte est en encre — blanc au-delà de 24 px seulement.*

C'est le piège de la direction : la teinte de marque est la seule qu'on ne peut
pas écrire. La fondatrice l'emploie sur des visuels où le texte fait 200 px, ce
qui est cohérent et ne descend pas dans une interface.

**Conséquence sur le bouton principal :** il est orange à texte encre, et non
blanc sur orange. Son libellé fait 15 px, donc sous le seuil du blanc. C'est la
seule divergence assumée avec ses visuels, où le mot dans le bloc est blanc : à
200 px le blanc passe, à 15 px il échoue.

**Conséquence sur le focus :** il reste une encre de 2 px. Sur un écran qui porte
de l'orange, un focus orange se perd.

## 4. Tension 2 — les paliers

La teinte ne peut plus distinguer les paliers, alors c'est la **manière dont la
teinte est posée** qui le fait.

| Palier | Matière | Construction |
| --- | --- | --- |
| Story | contour | Bordure 1,5 px `brand.700`, fond papier, texte `brand.700` |
| Post | teinte | Fond `brand.100`, bordure 1 px `brand.500`, texte `brand.700` |
| Reel | aplat | Fond `brand.500` plein, texte et glyphe en encre |

Deux gains sur l'ancien système, au-delà du fait de survivre au monochrome :

**La progression est ordinale.** De moins de matière à plus de matière. Un rose,
un vert et un violet ne disaient pas lequel était le plus exigeant ; il fallait
l'apprendre. Contour, teinte, aplat s'ordonne sans apprentissage — ce qui est
exactement le problème que la v0.7 cherchait à résoudre sur l'écran des paliers.
L'échelle validée là-bas devient ici la définition du palier lui-même.

**La règle des trois marqueurs redondants devient vérifiable par
construction.** Mot, glyphe à barres, matière : les trois badges restent
distincts en niveaux de gris. Avec les trois teintes, c'était vrai en théorie et
jamais testé.

Sur fond sombre, contour et teinte s'éclaircissent, l'aplat ne bouge pas.
L'ordre est conservé.

## 5. Tension 3 — le bloc orange

Vous aviez raison, et la réponse est une règle de comptage.

**Le bloc plein est un signe de ponctuation typographique.** Un par écran au
maximum, sur le mot accentué du plus grand titre.

**Il vit :**

- sur le mot accentué du titre d'un **écran de seuil** — accueil avant
  inscription, franchissement de palier, confirmation de réservation ;
- sur l'**action principale**, une seule par écran ;
- comme **aplat du palier reel** ;
- comme **filet d'onglet actif**, 3 px — c'est une surface, hors comptage.

**Il ne vit pas :**

- dans une ligne de liste ou de tableau. Répété, il devient une nappe : plus
  rien n'est accentué et l'œil ne trouve plus la ligne active ;
- sur une carte dans un fil ;
- sur un état, un compteur, une pastille de statut. Un bloc de marque sur
  « Validé » fait croire à une promotion ;
- sur les **écrans de travail quotidien** — journée du commerce, caisse,
  arbitrage, réservations : **zéro bloc**. On les ouvre dix fois par jour ; une
  signature vue dix fois par jour est du bruit. L'orange y reste, en filet actif
  et en bouton principal ;
- **deux fois sur le même écran**, y compris un dans le titre et un dans le
  sous-titre. La règle se vérifie à l'œil nu et doit être tenue en revue.

Sur les huit écrans à reprendre, quatre auront un bloc et quatre n'en auront
aucun.

Le bloc n'est jamais animé. Une signature qui bouge est une bannière.

## 6. Le satin

Trois surfaces, construites en radiales superposées : des bandes claires et
sombres qui se croisent, sans direction unique. **Un dégradé linéaire à deux
arrêts est interdit** — c'est le cliché que la direction évite.

| Variante | Emploi |
| --- | --- |
| `satin.drape` | Accueil avant inscription, plein écran |
| `satin.fold` | Palier franchi, confirmation |
| `satin.ember` | Variante sombre, titre blanc admis |

Il vit sur une surface de 240 px de haut au minimum, une fois par écran au plus,
et seulement là où la marque se présente. Il ne vit jamais sur un bouton, une
carte de liste, un fond de formulaire ou de tableau, ni sous un texte de moins de
24 px. Un dégradé derrière de la donnée rend la donnée illisible et le dégradé
bon marché.

**Note d'intégration.** React Native ne sait pas empiler des radiales. Les trois
satins sont livrés en images 2x et 3x, pas calculés à l'exécution.
`expo-linear-gradient` ne suffit pas et donnerait la pente qu'on refuse.

## 7. Photographie

Désaturée en **gris chaud**, jamais en gris neutre — un gris froid sur un fond os
fait sale. Contraste porté à 1,08.

**Deux clés, jamais un gris moyen.** Ses mosaïques alternent des ensembles presque
blancs et des ensembles presque noirs. Le produit prend la **haute clé** par défaut
— un fond os appelle des photos claires — et la **basse clé** sur les surfaces
sombres : galerie, accueil, voile de couverture.

**Un seul élément coloré par photo** : la pastille de distance ou le badge de
palier, jamais les deux. Le second passe sur `scrim.badge`.

React Native n'a pas de filtre CSS : la désaturation est appliquée aux fichiers
livrés par les commerces, côté serveur, à l'envoi. Elle n'est pas calculée dans
l'app. C'est un point à arbitrer avec l'API — aujourd'hui rien ne traite les
images à l'ingestion.

## 8. La quatrième tension, que vous n'avez pas posée

**La couleur de rôle disparaît aussi.** Le créateur était sarcelle, le commerce
ambre. Une seule teinte de marque supprime cette distinction comme elle
supprimait celle des paliers — mais ici, contrairement aux paliers, je ne la
remplace pas.

**Pourquoi elle peut partir.** Un rôle ne coexiste jamais avec un autre dans une
session. Personne n'a besoin de reconnaître son rôle à une couleur : il n'y a
rien à en distinguer sur l'écran qu'on regarde. La couleur de rôle nous servait,
à nous. Le rôle reste écrit : le nom du commerce ou de la créatrice sous la
marque, en `ink.mute`, ce qui est plus explicite qu'une teinte que personne ne
décode.

**Ce que ça coûte.** Une capture d'écran ne dit plus de quel rôle elle vient. En
revue interne et en support, il faudra lire le nom. C'est le seul coût, et il est
interne.

**Si vous le refusez**, l'alternative est de teinter la barre latérale par
matière et non par couleur : encre pour l'administration, os pour le commerce,
papier pour le créateur. Dites-moi.

## 9. Un motif repris des visuels

**Le filet segmenté.** En tête de ses carrousels : autant de segments de 3 px que
de vues, gouttière de 14, les vues parcourues en `brand.500`, les autres en blanc.

Elle l'emploie comme une pagination. Le produit s'en sert mieux comme
**progression d'une mise en route** : il remplace le compteur « 2/4 » de la mise en
route du commerce. L'orange y est admis parce que le filet ne porte aucun texte.

Il **ne remplace pas** les points de la galerie d'un salon : douze points valent
mieux que douze segments de 8 px.

**Les émoji restent interdits** dans le produit, même si ses visuels en portent.
S'aligner sur la marque ne change pas cette règle : un réseau social et une
application de réservation ne sont pas la même surface.

## 10. Surfaces et états

**Les rayons tombent à 0.** Les 8, 12 et 16 de la v0.4 disparaissent. La mode ne
s'arrondit pas, et le bloc plein ne fonctionne que d'équerre. Restent 2 px sur
les vignettes photo et la pilule sur les seules chips de filtre.

**Le filet remplace l'ombre.** `elevation.1` est supprimé ; une carte se tient à
son filet de 1 px. Une seule ombre subsiste, pour ce qui flotte réellement :
feuille, menu, dialogue.

**L'avertissement perd sa couleur.** Un ambre dans un système orange est
indiscernable de la marque : l'utilisateur lit une mise en avant, pas une alerte.
L'avertissement devient neutre et emphatique — fond `bg.deep`, encre, filet
d'encre, **et son glyphe devient obligatoire**, seul marqueur qui lui reste.
C'est la conséquence la plus lourde de la nouvelle direction, et elle est
volontaire.

**Le danger passe au cramoisi** `#A31B2F`. L'ancien `#B3271E` était un rouge
orangé qui se confondait avec la marque en vision protanope.

## 11. Ce qui reste hors système

Deux écrans, inchangés :

- **l'écran de code de retrait**, blanc pur sur noir pur, plein écran, sans
  marque ni orange. Il est lu par une caméra et par une vendeuse à un mètre ;
- **la galerie plein écran**, sur `bg.sunken`, chrome minimal.

## 12. Ce qui n'est pas affecté

Toute la structure acquise depuis la v0.5 tient. Sont conservés tels quels : le
catalogue de découverte et ses quatre rangées, la fiche salon en page, le gabarit
de bureau v0.6 (240 / 72, largeurs bornées, densités), l'échelle d'échange des
paliers v0.7, la règle des 60 % sur l'écart au seuil, les états vides
typographiques, les deux graphiques autorisés, et les sept données manquantes
listées en v0.5.

Contraintes inchangées : React Native + Expo, flexbox uniquement, seuils mesurés
sur le conteneur. Anglais et espagnol, clés symétriques. Aucun émoji. Aucun
montant présenté au créateur. `opacity` et `transform` seuls animables. Trois
marqueurs redondants sur les paliers. Le bouton impossible est retiré, jamais
grisé — hors le cas nommé en v0.6 §3.

## 13. Les huit écrans

À reprendre dans ce système, un par un. Prévision du comptage de blocs :

| Écran | Bloc |
| --- | --- |
| Accueil avant inscription | 1, sur satin |
| Connexion, les deux portes | 1 |
| Découverte | 0 |
| Fiche salon | 0 |
| Paliers | 1, au franchissement seulement |
| Journée du commerce | 0 |
| Caisse | 0 |
| Arbitrage | 0 |

---

## Arbitrages rendus côté produit (2026-08-14)

Deux points laissés ouverts par la passation sont tranchés ici, et c'est ce
dépôt qui fait foi sur eux.

**§8, la couleur de rôle — l'alternative est retenue.** La distinction est
gardée, **en matière et non en teinte** : encre pour l'administration, os pour
le commerce, papier pour le créateur. `color.role.creator` et
`color.role.merchant` disparaissent bien ; ce qui les remplace n'est pas une
autre teinte mais le fond de la barre latérale et de la coquille.

**§7, la désaturation — refusée sur le contenu.** Les photos de salons et de
prestations ne sont **pas** désaturées. C'est un procédé de collage marketing,
et l'appliquer au fil détruirait ce qui fait choisir un salon : la couleur d'un
vernis, d'une mèche, d'une pièce. Le traitement reste possible sur les fonds
décoratifs, jamais sur le contenu. Rien n'est donc à faire côté API à
l'ingestion, et le point ouvert que le §7 laissait à arbitrer est clos par un
non.

---

## La règle des deux marques (2026-08-14)

Le système a deux marques, et une règle qui décide entre elles.

> **Le logotype partout où on a la place de le lire, la marque compacte partout
> ailleurs. Le seuil est la lisibilité des quatre lettres, pas le support.**

Elle s'est écrite en trois temps, et chacun a coûté une découverte.

1. Le logotype réduit à seize pixels donnait quatre taches. Refuser de le
   réduire était juste ; laisser le favicon dans cet état l'était moins.
2. Design a livré `BIND Mark - Favicon 16` : le bloc orange, avec le point
   d'exclamation **évidé** dedans. Évidé et non posé — un point orange sur blanc
   est un panneau d'alerte, le même creusé dans un carré plein devient une
   marque, parce que l'objet reconnu est le carré et le signe ce qui y manque.
3. Restait la tuile d'application, gardée au logotype **parce qu'elle est
   livrée en 1024** — jusqu'à mesurer ce qu'un lanceur en affiche : vingt-sept
   pixels de large pour quatre lettres à 48 dp. La résolution du fichier n'a
   jamais été la question.

**Le seuil est mesuré, pas choisi.** `B!ND` dans la fonte du système occupe
0,592 fois le corps par lettre. Dix pixels par lettre est *encadré* par deux
mesures : 6,75 au lanceur Android, dont la capture est illisible, et 11,1 au
plus petit usage in-app, qui se lit. Les deux nombres vivent dans
`produit.json`, et rien ne les recopie.

**Conséquence, et c'est la forme la plus sûre de la règle :** aucun fichier cuit
ne porte plus le logotype. Tous sont des tuiles, aucune tuile ne s'affiche assez
grand. Le logotype ne vit donc qu'en texte, dans l'interface, là où l'écran lui
donne la place — et `Marque` refuse de rendre sous le plancher, comme `Texte`
refuse une surface employée en encre. Un logotype illisible ne se signale pas :
il ressemble à un logotype, en plus petit, et il traverse une revue. C'est
exactement ainsi que l'ancien monogramme vert a traversé le remplacement complet
du système.

*Un écart relevé sur la planche du 16, et tranché :* sa dernière colonne annonce
« quatre unités à gauche et à droite ». La géométrie qu'elle donne huit fois, et
son tableau de cotes, disent **six** — quatre est la largeur du signe, pas sa
marge. La géométrie fait foi, et l'argument sur les masques des plateformes
tient mieux encore avec six.
