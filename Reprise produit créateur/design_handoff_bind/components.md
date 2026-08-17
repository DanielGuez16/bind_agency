# Composants — révision v1.0 (BIND AGENCY)

> Ce document remplace les sections nommées de `components.md` v0.4. Les sections
> non citées ici sont inchangées. Conventions de nommage, props et structure
> React Native : inchangées.
>
> Source des valeurs : `tokens.json` v1.0. Règles non lisibles dans un jeton :
> `PASSATION-v1.0.md`.

## Ce qui change pour tous les composants

1. **Rayons à 0.** Tout ce qui portait `radius.8`, `radius.12` ou `radius.16`
   passe à l'angle droit. Restent `radius.photo` (2) sur les vignettes et
   `radius.pill` sur les chips de filtre.
2. **L'ombre de carte disparaît.** `elevation.1` est supprimé. Une carte se tient
   à son filet de 1 px `line.default`. Seuls feuille, menu et dialogue portent
   `elevation.float`.
3. **Trait d'icône à 2** au lieu de 1,75, grille de 24 inchangée.
4. **Deux familles, séparées par une taille.** Bodoni Moda au-dessus de 34 px
   (`display`, `displayAccent`, `heading`, `headingAccent`), Outfit en dessous, y
   compris les titres d'écran (`screenTitle`, 28). Aucun composant d'interface
   n'écrit en serif.
5. **Aucun composant n'écrit en `brand.500`.** Le texte orange est
   `brand.700`, sans exception.

---

## 1. `Button`

Inchangé sur le fond : jamais dimensionné sur son texte, `fullWidth` par défaut,
hauteur `size.button` (52).

| Variante | Surface | Texte | Bordure |
| --- | --- | --- | --- |
| `primary` | `brand.500` | `ink.onBrand` | aucune |
| `primary:pressed` | `brand.600` | `ink.onBrand` | aucune |
| `secondary` | transparent | `ink.default` | 1 px `line.ink` |
| `disabled` | `bg.surface` | `ink.faint` | 1 px `line.default` |

**Le texte du bouton principal est en encre, pas en blanc.** Blanc sur
`brand.500` donne 3,0:1 et échoue au seuil des petits corps ; l'encre donne
6,1:1. C'est aussi ce que font les visuels de la fondatrice.

**Une seule action `primary` par écran.** La seconde est `secondary`. Un second
orange plus pâle est interdit — il crée une hiérarchie fausse entre deux actions
de même niveau.

L'appui assombrit vers `brand.600`. Aucune opacité, aucun changement de taille.

L'état `disabled` reste réservé au cas d'une action qui redeviendra possible
(formulaire incomplet, cf. `PASSATION-v0.6.md` §3). Partout ailleurs, le bouton
impossible est retiré.

---

## 2. `TierBadge`

**Réécrit.** Les trois teintes distinctes sont remplacées par trois matières.

| Palier | Matière | Surface | Bordure | Texte | Barres pleines |
| --- | --- | --- | --- | --- | --- |
| Story | contour | `bg.surface` | 1,5 px `brand.700` | `brand.700` | 1 / 3 |
| Post | teinte | `brand.100` | 1 px `brand.500` | `brand.700` | 2 / 3 |
| Reel | aplat | `brand.500` | aucune | `ink.onBrand` | 3 / 3 |

Les **trois marqueurs redondants restent obligatoires ensemble** : le mot, le
glyphe à trois barres, et désormais la matière au lieu de la teinte. La règle est
maintenant vérifiable par construction — les trois badges restent distincts en
niveaux de gris, ce qui n'était vrai qu'en théorie avec le rose, le vert et le
violet.

Le mot n'est jamais abrégé. Sur fond sombre, contour et teinte s'éclaircissent
(`brand.400`, `brand.900`), l'aplat ne bouge pas : l'ordre des matières est
conservé.

La barre de proportion d'un palier reprend la même matière que son badge :
contour pour story, teinte bordée pour post, aplat pour reel.

---

## 3. `BarreauDePalier` (v0.7)

Structure inchangée : bandeau de format, deux colonnes give / get, obstacles,
action. Trois substitutions :

- le bandeau prend la **matière** du palier au lieu de sa teinte `subtle` ;
- la bordure de carte suit : 1,5 px `brand.700` pour story, 1 px `brand.500`
  pour post, 1 px `brand.500` pour reel ;
- la pastille `NEXT FOR YOU` passe de `accent.default` à `brand.500` avec texte
  encre, et la bordure de 2 px du prochain palier devient `line.ink` — un orange
  de 2 px sur un bandeau orange ne se voyait plus.

---

## 4. `EnTete` et le mot accentué

**Nouveau composant : `TitreAccentue`.**

Rend un titre en Bodoni Moda **romain**, dont **un seul mot** passe en Bodoni Moda
**italique**, avec ou sans bloc plein. L'accent est un changement de voix dans une
seule famille, pas un changement de famille — c'est ce que fait la fondatrice, et
il n'y a plus de raccord entre deux fontes à réussir.

```
props: texte, motAccentue, bloc (bool, défaut false)
```

Règles portées par le composant, pas par l'appelant :

- un seul mot accentué ; deux annulent l'accent ;
- le mot accentué porte le sens — un verbe, un chiffre, un nom de format. Jamais
  un article, jamais un adjectif ;
- rien sous 34 px, bloc ou pas : le Didone perd ses déliés et devient sale. En
  dessous, `screenTitle` en Outfit ;
- `bloc` pose `brand.500` derrière le mot, **texte blanc par défaut**. L'encre est
  une variante admise, pas le défaut : sur les visuels de la fondatrice le mot est
  blanc neuf fois sur onze ;
- **quand le mot porte le bloc, il ouvre sa ligne.** Le bloc pend sous la ligne du
  dessus au lieu de s'insérer dans une phrase — un retour à la ligne ne peut alors
  plus le couper, et la ponctuation qui suit reste collée au bloc.

**i18n.** La clé porte le mot accentué séparément, jamais un index de caractères
— l'accent se déplace en espagnol, et un index se décale.

```
"tiers.title": { "texte": "Your {{accent}}", "accent": "tiers" }
"tiers.title": { "texte": "Tus {{accent}}",  "accent": "niveles" }
```

---

## 5. `EtatDeStatut`

| Statut | Surface | Filet gauche 3 px | Texte | Glyphe |
| --- | --- | --- | --- | --- |
| success | `status.success.surface` | `status.success.rule` | `status.success.text` | facultatif |
| warning | `status.warning.surface` | `status.warning.rule` | `ink.default` | **obligatoire** |
| danger | `status.danger.surface` | `status.danger.rule` | `status.danger.text` | facultatif |

**L'avertissement n'a plus de teinte.** Un ambre dans un système orange se lit
comme une mise en avant de marque et non comme une alerte. Il devient neutre et
emphatique : fond `bg.deep`, encre, filet d'encre, **et son glyphe est
obligatoire** — c'est le seul marqueur qui lui reste. Un avertissement sans
glyphe est un bug, pas un choix.

Le rouge de danger passe au cramoisi `#A31B2F`. L'ancien `#B3271E` était un rouge
orangé qui se confondait avec la marque en vision protanope.

---

## 6. `TextField`

Repos : 1 px `line.default`. **Focus : 2 px `line.ink`**, pas d'orange — sur un
écran qui porte de l'orange, un focus orange se perd. Erreur : 2 px
`status.danger.rule`. Hauteur `size.field` (50), angle droit.

---

## 7. `BusinessCard`

Les deux formats (compact 264 × 176, pleine largeur × 208) sont conservés.
Changements :

- angle droit, plus d'ombre, filet 1 px `line.default` ;
- la couverture est **désaturée en gris chaud**, cuite dans le fichier côté
  serveur, en haute clé sur fond clair et en basse clé sous un voile ;
- **un seul élément coloré par couverture** : la pastille de distance en
  `brand.500` à texte encre, **ou** le `TierBadge`, jamais les deux. Le second
  passe en `scrim.badge` à texte encre ;
- le nom reste en `type.title` sur le voile, en blanc — au-delà de 24 px, donc
  admis.

---

## 8. `Chip` et `ChipDeFiltre`

Seuls composants à conserver `radius.pill`. Sélectionné : `bg.inverse` à texte
`ink.onDark`. Non sélectionné : 1 px `line.default`, texte `ink.soft`.
**Un chip sélectionné n'est jamais orange** : dans une rangée de filtres, l'orange
désignerait une promotion et non une sélection.

La pastille de compteur du bouton `Filters` passe en `brand.500` à texte encre.

---

## 9. `BarreLaterale` (v0.6)

Largeurs et densités inchangées (240 / 72, lignes de 44 ou 38).

- **La couleur de rôle est supprimée.** Le nom du commerce ou de la créatrice
  sous la marque passe en `ink.mute`. Voir `PASSATION-v1.0.md` §8.
- L'élément actif : fond `brand.50`, barre gauche 3 px `brand.500`, texte
  `brand.700`. Jamais un aplat `brand.500` — la navigation est traversée cinquante
  fois par jour.
- Le monogramme est le logo B!ND — les lettres en `ink.default` sur la barre
  latérale claire, **et le point du « ! » en `brand.500`**. Le point est la seule
  couleur du logotype ; c'est lui qui fait la marque. Aucune signature ne
  l'accompagne : ni « AGENCY », ni « CRÉATEUR DE LIEN ».

---

## 10. `Galerie` et `EcranDeCode`

Inchangés, et **explicitement hors système** : la galerie sur `bg.sunken`,
l'écran de code en blanc pur sur noir pur, plein écran, sans marque ni orange.

---

## 11. `FiletSegmente`

**Nouveau**, repris de ses carrousels. Autant de segments de 3 px que d'étapes,
gouttière de 14, les étapes parcourues en `brand.500`, les autres en blanc sur
fond sombre ou `line.strong` sur fond clair.

Il remplace le compteur « 2/4 » de la mise en route du commerce. L'orange y est
admis parce que le filet ne porte aucun texte.

Il **ne remplace pas** les points de pagination de la galerie : douze points
valent mieux que douze segments de 8 px.

---

## 12. `SurfaceSatin`

**Nouveau.** Rend l'une des trois images de satin en fond d'une zone.

```
props: variante ('drape' | 'fold' | 'ember'), hauteurMin (>= 240)
```

Le composant refuse de rendre sous 240 px de haut et n'accepte comme enfant
qu'un `type.display`, `type.displayAccent` ou `type.title`. Il n'est ni un
bouton, ni une carte, ni un fond de formulaire ou de tableau. Une seule instance
par écran.

---

## 13. Ce qui est supprimé

| Composant / jeton | Raison |
| --- | --- |
| `elevation.1` sur les cartes | Le filet remplace l'ombre. |
| `color.role.creator`, `color.role.merchant` | Section 08 de la passation. |
| `color.accent.*` (sarcelle) | Remplacé par `color.brand.*`. |
| `color.tier.*` (rose, vert, violet) | Remplacé par les trois matières. |
| `status.warning` en ambre | Indiscernable de la marque. |
| `tiers.valueHint` | Déjà retiré en v0.7 : valeur monétaire côté créateur. |
| `type.display` en Familjen Grotesk | Remplacé par Bodoni Moda. |
| `type.title` (34, Outfit) | Devient `heading` en Bodoni Moda ; l'équivalent sans est `screenTitle`, 28. |

---

## 14. Interdits, inchangés

Aucun graphique hors des deux autorisés en v0.6 (barres, évolution dans le
temps). Aucune illustration. Aucun émoji. Aucun montant présenté au créateur.
`opacity` et `transform` seuls animables. Flexbox uniquement. Anglais et
espagnol, clés symétriques.

**Deux ajouts à cette liste.** Le bloc accentué n'est jamais animé : une signature
qui bouge est une bannière. Et **les émoji restent interdits** même si les visuels
de la fondatrice en portent — un réseau social et une application de réservation
ne sont pas la même surface.
