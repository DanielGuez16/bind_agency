# Composants — révision v1.1 (direction B · Ambre)

> Ce document remplace `components.md` v1.0 sur les sections nommées. Les
> sections non citées sont inchangées. Conventions de nommage, props et structure
> React Native : inchangées.
>
> Source des valeurs : `tokens.json` v1.1. Règles non lisibles dans un jeton :
> `PASSATION-v1.1.md`.

## Ce qui change pour tous les composants

1. **Les rayons remontent.** L'échelle `radius` de la v1.1 s'applique par rôle :
   `sm` (10) chip et pastille, `md` (14) champ et ligne de liste, `lg` (18) carte,
   feuille et panneau, `xl` (24) visionneuse et couverture, `photo` (16) toute
   image, `pill` bouton et chip de filtre. **`none` est réservé au bloc
   accentué**, et à lui seul.

   La v1.0 mettait tout à zéro sur la raison « le bloc plein ne fonctionne que
   d'équerre ». **Cette raison est remplacée, pas conservée à côté de son
   contraire** : elle était vraie du bloc et fausse du reste. Le bloc orange
   reste d'équerre — un aplat de marque aux angles arrondis devient un bouton, et
   la signature perd la raideur qui la fait lire comme une signature. Tout le
   reste s'arrondit.

2. **L'ombre de carte revient**, à une seule valeur, `elevation.card`. La v1.0
   l'avait supprimée au motif que le filet suffisait : vrai à l'angle droit, faux
   à `radius.lg`, où un coin arrondi sans ombre flotte au lieu de se poser.
   Jamais cumulée avec `line.strong`.

3. **Une seule famille de texte.** Plus Jakarta Sans partout, IBM Plex Mono pour
   les chiffres, codes, seuils et horaires. **L'accent est une graisse** — 800
   contre 700 — plus jamais une autre voix.

4. **Le plancher de 34 px disparaît.** Il gardait un serif d'entrer dans
   l'interface ; il n'y a plus de serif. Conséquence : le titre accentué est
   disponible à toutes les tailles.

5. **Aucun composant n'écrit en `brand.500`.** Le texte orange est `brand.700`.
   Le 500 est une surface, le 700 est du texte, et aucun des deux ne fait l'autre.

6. **Trait d'icône à 2**, grille de 24. Inchangé.

---

## 1. `Button`

Jamais dimensionné sur son texte, `fullWidth` par défaut, hauteur `size.button`
(52), **`radius.pill`**.

| Variante | Surface | Texte | Bordure |
| --- | --- | --- | --- |
| `primary` | `brand.500` | `ink.onBrand` | aucune |
| `primary:pressed` | `brand.600` | `ink.onBrand` | aucune |
| `secondary` | transparent | `ink.default` | 1,5 px `line.ink` |
| `disabled` | `bg.surface` | `ink.faint` | 1 px `line.default` |

**Le libellé est en encre, jamais en blanc.** Encre sur `brand.500` : 7,77:1.
Blanc : 2,36:1, sous le seuil des petits corps **et** sous celui des grands. Ce
n'est pas propre à l'ambre — les quatre oranges essayés dans ce projet se
comportent pareil, et c'est une propriété des oranges chauds à clarté lisible,
pas un choix de palette.

**L'appui n'impose plus d'arbitrage.** `brand.600` porte l'encre à 5,66:1 avec un
écart de 1,37:1 : l'appui est à la fois lisible et visible. C'est la première
fois dans ce projet, et c'est ce qui a fait retenir la direction.

`ink.faint` sur `disabled` est le seul emploi légitime de ce jeton : ici
l'illisibilité **est** le message. Partout ailleurs, `ink.faint` ne porte pas de
texte à lire.

Une seule action `primary` par écran ; la seconde est `secondary`. L'état
`disabled` reste réservé à une action qui redeviendra possible
(`PASSATION-v0.6.md` §3).

---

## 2. `TierBadge`

Les trois matières sont **conservées** : elles ne dépendaient pas de la palette,
et c'est ce qui les rend portables d'une direction à l'autre. `radius.sm`.

| Palier | Matière | Surface | Bordure | Texte | Barres pleines |
| --- | --- | --- | --- | --- | --- |
| Story | contour | `bg.surface` | 1,5 px `brand.700` | `brand.700` | 1 / 3 |
| Post | teinte | `brand.100` | 1 px `brand.500` | `brand.700` | 2 / 3 |
| Reel | aplat | `brand.500` | aucune | `ink.onBrand` | 3 / 3 |

Trois marqueurs redondants obligatoires ensemble : le mot, le glyphe à trois
barres, la matière. Vérifiable par construction — les trois badges restent
distincts en niveaux de gris.

Le mot n'est jamais abrégé. Sur fond sombre, contour et teinte s'éclaircissent
(`brand.400`, `brand.900`), l'aplat ne bouge pas : l'ordre des matières est
conservé.

**Le libellé du badge fait 11 px.** À cette taille, aucune couleur sous 4,5:1
n'est admise : `brand.700` sur `brand.100` passe, `brand.700` sur `bg.deep`
(4,56:1) est à éviter, et l'aplat porte l'encre.

---

## 3. `BarreauDePalier` (v0.7)

Structure inchangée. Trois substitutions par rapport à la v1.0 :

- carte en `radius.lg`, bandeau de format en haut, coins supérieurs suivant la
  carte ;
- la pastille `NEXT FOR YOU` reste `brand.500` à texte encre, en `radius.sm` ;
- la bordure du prochain palier reste `line.ink` sur 2 px — un orange de 2 px sur
  un bandeau orange ne se voit pas, quelle que soit la rampe.

La barre d'écart au seuil reste `brand.500` : elle ne porte aucun texte. Sous
60 % du seuil, pas de barre — règle de la v0.7, inchangée.

---

## 4. `TitreAccentue`

**Réécrit.** L'accent n'est plus un changement de famille mais **un changement de
graisse** : le titre est en 700, le mot accentué en 800.

```
props: texte, motAccentue, bloc (bool, défaut false)
```

Règles portées par le composant :

- un seul mot accentué ; deux annulent l'accent ;
- le mot accentué porte le sens — un verbe, un chiffre, un nom de format. Jamais
  un article, jamais un adjectif ;
- **plus de taille minimale.** L'accent étant une graisse, il tient à 16 px comme
  à 44. Les paires `display`/`displayAccent` et `heading`/`headingAccent` sont
  faites pour ça ; en dessous, 600 contre 400 suffit ;
- `bloc` pose `brand.500` derrière le mot, **texte encre**, `radius.none`. Le
  blanc n'est pas une variante admise : il donne 2,36:1. C'est la seule
  divergence assumée avec les visuels de la fondatrice, où le mot dans le bloc
  est blanc — à 200 px sur Instagram le blanc passe, à 44 px dans une interface
  il échoue ;
- **quand le mot porte le bloc, il ouvre sa ligne.** Le bloc pend sous la ligne du
  dessus au lieu de s'insérer dans une phrase : un retour à la ligne ne peut plus
  le couper, et la ponctuation qui suit reste collée au bloc.

**Un seul bloc par écran, et jamais sur un écran de travail quotidien.** Le fil,
la journée du commerce, les réservations et l'arbitrage n'en portent pas. Règle
de la v1.0, maintenue mot pour mot : ce qui est magnifique sur un visuel ne se
répète pas sur un écran ouvert dix fois par jour.

**i18n.** La clé porte le mot accentué séparément, jamais un index de caractères
— l'accent se déplace en espagnol, et un index se décale.

```
"tiers.title": { "texte": "Your {{accent}}", "accent": "tiers" }
"tiers.title": { "texte": "Tus {{accent}}",  "accent": "niveles" }
```

---

## 5. `EtatDeStatut`

`radius.md`, filet gauche 3 px.

| Statut | Surface | Filet | Texte | Glyphe |
| --- | --- | --- | --- | --- |
| success | `status.success.surface` | `status.success.rule` | `status.success.text` | facultatif |
| warning | `bg.deep` | `line.ink` | `ink.default` | **obligatoire** |
| danger | `status.danger.surface` | `status.danger.rule` | `status.danger.text` | facultatif |

**L'avertissement n'a pas de teinte, et la règle se renforce avec l'ambre.** Un
ambre dans un système ambre se lit comme une mise en avant de marque et non comme
une alerte. Son glyphe est **obligatoire** : c'est le seul marqueur qui lui reste.
Un avertissement sans glyphe est un bug, pas un choix.

Le cramoisi `#A31B2F` reste : un rouge orangé se confondrait avec la marque en
vision protanope, et le risque augmente en passant à l'ambre.

---

## 6. `TextField`

`radius.md`, hauteur `size.field` (50). Repos 1 px `line.default`. **Focus 2 px
`line.ink`** — sur un écran qui porte de l'orange, un focus orange se perd.
Erreur 2 px `status.danger.rule`.

---

## 7. `BusinessCard`

Deux formats conservés : compact 264 × 176, pleine largeur × 208.

- **`radius.lg`** sur la carte, **`radius.xl`** quand la couverture est la carte
  (pleine largeur, sans texte sous l'image) ;
- `elevation.card`, sans filet ;
- la couverture reste **désaturée en gris chaud**, cuite côté serveur, haute clé
  sur fond clair et basse clé sous voile ;
- **un seul élément coloré par couverture** : la pastille de distance en
  `brand.500` à texte encre, **ou** le `TierBadge`, jamais les deux. Le second
  passe en `scrim.badge` à texte encre ;
- le nom en `type.section` ou plus, en blanc sur le voile — au-delà de 22 px,
  donc admis.

---

## 8. `Chip` et `ChipDeFiltre`

`ChipDeFiltre` en `radius.pill`, `Chip` en `radius.sm`. Sélectionné :
`bg.inverse` à texte `ink.onDark`. Non sélectionné : 1 px `line.default`, texte
`ink.soft`.

**Un chip sélectionné n'est jamais orange** : dans une rangée de filtres,
l'orange désignerait une promotion et non une sélection.

La pastille de compteur du bouton `Filters` est `brand.500` à texte encre.

---

## 9. `BarreLaterale` (v0.6)

Largeurs et densités inchangées : 240 / 72, lignes de 44 ou 38.

- lignes de navigation en `radius.md` ;
- élément actif : fond `brand.50`, barre gauche 3 px `brand.500`, texte
  `brand.700`. **Jamais un aplat `brand.500`** — la navigation est traversée
  cinquante fois par jour ;
- la couleur de rôle reste supprimée ; le nom sous la marque est `ink.mute` ;
- le monogramme est le **SVG** du logotype, lettres en `ink.default`, point en
  `logo.signature`. Jamais composé en caractères.

---

## 10. `Galerie` et `EcranDeCode`

Inchangés, et **explicitement hors système** : galerie sur `bg.sunken` en
`radius.xl`, écran de code en blanc pur sur noir pur, plein écran, sans marque,
sans orange et sans rayon.

---

## 11. `FiletSegmente`

Autant de segments de 3 px que d'étapes, gouttière de 14, étapes parcourues en
`brand.500`. `radius.pill` sur chaque segment. L'orange y est admis parce que le
filet ne porte aucun texte.

Il **ne remplace pas** les points de pagination de la galerie : douze points
valent mieux que douze segments de 8 px.

---

## 12. `SurfaceSatin`

```
props: variante ('drape' | 'fold' | 'ember'), hauteurMin (>= 240)
```

`radius.xl`. Refuse de rendre sous 240 px de haut, n'accepte comme enfant qu'un
`type.display`, `type.displayAccent` ou `type.heading`. Ni bouton, ni carte, ni
fond de formulaire ou de tableau. Une seule instance par écran.

**Les trois images sont périmées** pour la deuxième fois : leurs stops portaient
l'orange brut puis `#FF5E00`. Recettes à jour dans `tokens.json → satin.recette`.

Aucun texte de moins de 24 px sur un satin, et **aucun logotype nu** : sur la
course d'un dégradé, aucune couleur de texte ne tient d'un bout à l'autre. Là où
la marque doit y apparaître, elle porte son cartouche d'encre.

---

## 13. Ce qui est supprimé ou rétabli

| Élément | Décision |
| --- | --- |
| `type.*` en Bodoni Moda | Supprimé. Plus aucun serif dans le produit. |
| Le plancher de 34 px | Supprimé — il n'a plus d'objet sans serif. |
| Rayons à 0 partout | Remplacé par l'échelle par rôle. `none` au bloc seul. |
| `elevation.card` | **Rétabli.** Un coin de 18 px sans ombre flotte. |
| Bloc accentué à texte blanc | Supprimé : 2,36:1. Le bloc porte l'encre. |
| `color.role.*`, `color.accent.*`, `color.tier.*` | Restent supprimés. |
| `status.warning` en ambre | Reste supprimé, et la raison se renforce. |
| `tiers.valueHint` | Reste supprimé : valeur monétaire côté créateur. |

---

## 14. Interdits, inchangés

Deux graphiques autorisés et deux seulement (barres, évolution dans le temps).
Aucune illustration. Aucun émoji. Aucun montant présenté au créateur. Aucun
montant côté commerce non plus — ce qui a été donné se compte en prestations et
en minutes de fauteuil. `opacity` et `transform` seuls animables. Flexbox
uniquement. Anglais et espagnol, clés symétriques.

Le bloc accentué n'est jamais animé : une signature qui bouge est une bannière.

Les émoji restent interdits même si les visuels de la fondatrice en portent : un
réseau social et une application de réservation ne sont pas la même surface.
