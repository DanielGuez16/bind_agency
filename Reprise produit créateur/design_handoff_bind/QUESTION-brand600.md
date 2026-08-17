# Question à Design — l'état appuyé, après le passage du 500 à #FF5E00

*Posée depuis l'implémentation, le 2026-08-17. Décision de composition : elle
n'est pas tranchée côté produit.*

## Le contexte

`brand.500` est passé de `#F26B21` à `#FF5E00`, la couleur du fichier de la
fondatrice — l'ancienne valeur était une estimation lue sur une capture
Instagram compressée. Les seuils du système ont été remesurés avant propagation
et aucun ne casse : encre sur orange 6,11 → 6,07:1 (seuil 4,5), blanc sur orange
3,04 → 3,06:1 (seuil 3,0). La rampe accepte la nouvelle valeur — teinte 22,1°,
en plein dans ses 20–24°.

`brand.600` `#D2500F`, l'état appuyé de tout ce qui est en 500, n'a pas bougé.

## Ce que j'avais signalé, et qui était faux

J'ai d'abord rapporté que l'écart 500 → 600 « se resserrait de 9,8 à 5,9
points ». C'était une mesure de **luminosité HSL**, qui n'est pas perceptuelle et
ne dit rien de ce qu'on voit.

Mesuré correctement, l'écart ne bouge presque pas :

| | contraste 500 → 600 | Δ luminance relative |
| --- | --- | --- |
| avant | 1,410:1 | 0,1003 |
| après | **1,400:1** | 0,0979 |

Une perte de 0,7 %. **L'appui reste aussi lisible qu'avant**, et il n'y a rien à
corriger de ce côté. Je le dis parce que j'avais annoncé l'inverse.

## Ce que la mesure a fait apparaître, et qui est réel

`ink.default` sur `brand.600` donne **4,33:1**, sous le seuil de 4,5 des petits
corps.

C'est le libellé du bouton principal **pendant l'appui** : le fond passe en 600,
le texte reste en encre. Le libellé fait 15 px, donc le seuil applicable est bien
4,5.

**Ce défaut précède le changement de couleur** — `brand.600` n'a pas bougé, et le
rapport était déjà de 4,33:1 avec l'ancien 500. Il n'a simplement jamais été
mesuré : la table de la passation donne « encre sur `brand.500` 6,1:1 » et
s'arrête là, l'état appuyé n'y figure pas.

**Ce qui l'atténue :** l'état est transitoire, visible tant que le doigt est
posé. Personne ne lit un libellé pendant qu'il appuie dessus.

**Ce qui ne l'atténue pas :** c'est le seul endroit du système où une paire
encre/surface passe sous son seuil, et la règle du produit est que les seuils se
mesurent, pas qu'ils s'apprécient.

## La question

Trois issues, et c'est à Design de choisir :

1. **Ne rien changer** — l'état est transitoire, 4,33 pour 4,5 est un écart de
   4 %, et un bouton qu'on presse n'est pas un bouton qu'on lit.
2. **Éclaircir `brand.600`** jusqu'à ce que l'encre y tienne 4,5:1. Il faudrait
   le remonter à environ `#DC5510` — mais l'appui perdrait en franchise, et
   c'est exactement ce qu'il est censé donner à voir.
3. **Assombrir `brand.600`** et passer le libellé en blanc pendant l'appui. Le
   texte changerait de couleur au toucher, ce que le système évite ailleurs.

Ma lecture, sans trancher : la première tient, à condition qu'elle soit **écrite**
dans la passation comme une exception mesurée et assumée, plutôt que laissée
comme un trou dans la table. Un seuil qu'on décide de ne pas tenir n'est pas le
même objet qu'un seuil qu'on n'a pas regardé.

---

## Réponse de Design — 2026-08-17

**Issue 2, avec une valeur autre que celle proposée : `brand.600` passe à
`#DA5510`.** Le libellé reste en encre pendant l'appui.

### Ce que la note n'avait pas mesuré

Elle donne l'encre sur `#D2500F` à 4,334:1. Le blanc y donne **4,290:1**.

`brand.600` était assis sur le **point de croisement des deux courbes**, là où
aucune couleur de texte ne passe. Ce n'est pas un manque de 4 % avec l'encre,
c'est un manque simultané dans les deux sens — la pire valeur possible pour un
orange destiné à porter du texte. Cela renforce la conclusion de la note et
retire l'issue 1 : une exception assumée se défend quand la valeur est presque
juste, pas quand elle est exactement au plus mauvais endroit.

### Pourquoi éclaircir, et pas assombrir

Avec un libellé en encre, une seule direction fonctionne. L'issue 3 est
supérieure sur le papier — `#C2490D` donne 4,94:1 au blanc **et** porte l'écart
d'appui de 1,400 à 1,611:1, donc plus de marge et un appui plus franc.

Elle est écartée pour une raison venue du gabarit de bureau. Sur tactile, l'appui
est caché sous le doigt : « personne ne lit un bouton pendant qu'il appuie
dessus » y est juste. Depuis la v0.6, le commerce et l'administration travaillent
sur ordinateur, où le pointeur ne couvre rien et où l'état appuyé est pleinement
visible. Un libellé qui change de couleur au clic s'y remarque, et se remarque
comme un défaut. **L'option qui gagnait en mesure perdait au seul endroit où
l'état se regarde.**

### Pourquoi `#DA5510` et pas `#D65310`

| valeur | encre | écart 500→600 | Δlum |
| --- | --- | --- | --- |
| `#D2500F` (avant) | 4,334 | 1,400 | 0,098 |
| `#D65310` (minimum) | 4,520 | 1,343 | 0,087 |
| **`#DA5510` (retenu)** | **4,683** | **1,296** | **0,078** |

Le déplacement minimal franchit le seuil de quatre millièmes. Un corps de 15 px
lissé ne rend pas le contraste que le calcul annonce, et une marge de quatre
millièmes est un seuil tenu sur le papier et perdu à l'écran. `#DA5510` garde
4 % de marge réelle.

**Le coût, dit franchement :** l'appui est 20 % moins profond. Il reste un
assombrissement, donc le verbe du système ne change pas, mais le signal est plus
discret qu'avant. C'est ce qui est payé pour que le libellé ne bouge jamais.

### Propagé

- `tokens.json` : `brand.500` → `#FF5E00`, `brand.600` → `#DA5510`, l'usage du 600
  porte désormais sa mesure.
- `PASSATION-v1.0.md` : la table de contraste gagne ses deux lignes d'appui et un
  encadré de remesure ; le raisonnement est au **§3 bis**.
- Les huit maquettes `.dc.html`.
- **Les trois satins sont à re-rendre** : leurs stops contiennent les deux valeurs
  changées. Les fichiers livrés portent encore l'ancien orange, `tokens.json`
  porte un `$stale` qui le dit.
