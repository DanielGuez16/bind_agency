# Passation — BIND · v0.5 · découverte créateur

> Addendum à `README.md` (v0.4). Ce document ne remplace rien : il liste ce que
> la v0.5 change, ajoute ou retire. En cas d'écart avec les maquettes, ce
> document et `tokens.json` font foi.
>
> Maquettes : `BIND Creator — Discovery v0.5.dc.html` (nouveaux écrans) et
> `BIND Creator — Current UI (recreation).dc.html` (état de départ, pour
> comparaison).

## Constat

Le fil était une liste unique, sans couleur, sans image en grand, sans entrée de
navigation. Trois chips de rayon et des cartes empilées : rien à parcourir, rien
à explorer, aucune façon de dire « je cherche une manucure ». La fondatrice
demande une expérience de catalogue, proche de ce que font ClassPass et
Uber Eats.

## Ce qui change

### 1. Le rôle créateur passe en thème clair

Seul changement au niveau des jetons. `theme.defaultByRole.creator` vaut
désormais `light`. Le jeu clair existe déjà et est vérifié AA ; aucune valeur
n'est ajoutée.

```json
"theme": { "defaultByRole": { "creator": "light", "merchant": "light" } }
```

Conséquences à appliquer dans `app/src/theme/index.tsx` : `THEME_PAR_ROLE.creator`
passe à `'light'`. La surcharge utilisateur et sa persistance ne bougent pas —
qui préfère le sombre le garde.

Deux exceptions conservent le sombre, et ce sont les deux seules :

- l'écran de code de retrait, toujours `#FFFFFF` sur `#000000` (`rules.md` §2) ;
- la galerie plein écran d'une fiche salon, sur `bg.sunken` du thème sombre
  (`#080610`). Une photo se regarde sur du sombre ; l'interface autour n'est que
  du chrome.

`elevation.1` devient admise sur les cartes de découverte, comme le prévoit déjà
`rules.md` §1 pour le thème clair : `0 1px 2px rgba(20,16,31,0.06)`. C'est le
seul relief ; la hiérarchie reste portée par la bordure et la surface.

### 2. Le fil devient un catalogue

L'écran `Fil` est remplacé par `Découverte` (`onglets.fil` → `onglets.decouverte`,
libellé « Discover » / « Descubrir »). Il se compose de haut en bas :

1. **Lieu et marque.** Le quartier courant, modifiable, et le monogramme.
2. **Recherche.** Champ plein, rayon plein, 48 de haut. Il ouvre l'écran de
   recherche, il ne filtre pas sur place.
3. **Catégories.** Six pastilles rondes de 64 avec leur mot : ongles, coiffure,
   soins du visage, spa, sourcils et cils, massage. Appui court : la catégorie
   devient un filtre et les rangées se recomposent. Appui sur « See all » d'une
   rangée : écran de catégorie. La pastille active porte une bordure de 2 px
   `accent.default` — jamais la couleur seule, le mot est toujours écrit.
4. **Barre de filtres.** Bouton `Filters` porteur du nombre de filtres actifs,
   puis les filtres posés sous forme de chips.
5. **Rangées thématiques**, dans cet ordre : `Still room today`, `Near you`,
   `New on BIND`, `Open at your tier`. Chaque rangée porte un titre et un
   « See all ». Une rangée vide n'est pas rendue.

**Défilement horizontal des catégories et des rangées.** C'est la seule
dérogation à la règle « pas de défilement horizontal » de `rules.md` §3, et elle
est bornée : elle ne vaut que pour des **contenus**, jamais pour des **options**.
Les chips de filtre restent en `flexWrap` dans la feuille de filtres, où elles
sont toutes visibles à la fois. La barre de filtres de l'écran de découverte est
un rappel de ce qui est posé, pas le lieu où l'on choisit.

### 3. Quatre filtres réels

Dans une feuille venant du bas, en `flexWrap` :

| Filtre | Valeurs | Défaut |
|---|---|---|
| Distance | 5, 15, 30, 50 km | 15 km |
| Accès au palier | « Only what is open to me » | **actif** |
| Disponibilité | Any day, Free today, Next 7 days | Any day |
| Type de prestation | taxonomie fermée, multi-sélection | aucun |

Le bouton de validation porte le nombre qu'il va montrer (« Show 24 salons »),
recalculé à chaque changement — conforme au principe des issues chiffrées.

**Le filtre de palier retiré n'ouvre pas le fil aux prestations inaccessibles.**
Il élargit aux **salons** qui n'ont rien d'ouvert pour la créatrice, dont la
fiche montrera ce qu'ils offrent. La règle ne bouge pas : une prestation non
accessible n'apparaît **jamais** dans une rangée, dans une recherche ou dans un
écran de catégorie. Elle n'existe que sur la fiche du salon.

### 4. Recherche

Trois états, un seul écran.

- **Ouverte** : recherches récentes (effaçables une à une) et une rangée de
  requêtes populaires dans le quartier.
- **Saisie** : suggestions en deux sections, `Services` puis `Salons`. Le
  fragment saisi est mis en gras dans le résultat, jamais surligné en couleur.
- **Résultats** : la barre de filtres, un compteur en `type.mono`, puis des
  cartes pleine largeur à couverture de 208 — la même carte que les rangées,
  élargie.

La recherche porte sur les noms de salon et les noms de prestation. Ces textes
sont saisis par les commerces : ils **ne sont pas traduits** et la recherche ne
les normalise pas au-delà des accents et de la casse.

### 5. La carte est portée par la photo

Deux formats, un seul composant.

- **En rangée** : 264 de large, couverture de 176.
- **Pleine largeur** (recherche, catégorie, état vide) : couverture de 208,
  celle de la v0.4.

Sur la couverture : la pastille de distance en haut à gauche, le `TierBadge` en
haut à droite, le nom en `type.title` sur le voile de lisibilité. Sous la
couverture : la prestation et sa durée en `type.bodyStrong`, la ligne de
contrepartie en `type.caption`. La rangée « Still room today » ajoute une
pastille `accent.warm` au-dessus du nom (« 3 slots left ») — jamais un nombre nu,
jamais un compte à rebours.

Le voile, les jetons `scrim.*` et le repli monogramme ne changent pas. Le voile
reste sombre dans les deux thèmes : le texte posé dessus est `text.onScrim`,
tandis que les pastilles du haut passent sur `badge.scrim`, blanc à 92 % en
thème clair.

### 6. Fiche salon, construite comme une page

1. **Galerie** de 340, pagination par points, compteur `1 / 12`, retour en
   pastille sur voile. Elle ouvre la galerie plein écran.
2. **Identité** : nom en `type.display`, distance et quartier en `type.mono`,
   puis les badges (`Nouveau sur BIND`, amplitude du jour).
3. **Prestations groupées par palier.** Un groupe par palier, en-tête teinté
   `tier.*.subtle` portant le `TierBadge` et la phrase de contrepartie. Les
   groupes ouverts d'abord, sous « Open to you now » ; les groupes fermés
   ensuite, sous « Not open to you yet ».
4. **Groupe fermé** : opacité 0,75, **aucun bouton** (retiré, pas grisé),
   l'obstacle sous son code serveur, et une ligne qui dit pourquoi la prestation
   est là : « Never shown in your feed. Listed here so you know what the salon
   offers. »
5. **Informations pratiques** : horaires du jour, adresse, ce que le commerce
   attend (mention, tag de lieu), et une tuile de carte statique.

Aucun montant, nulle part. La valeur reste la prestation et sa durée.

### 7. Accueil avant inscription

Vidéo verticale d'une créatrice, plein écran, **muette, en boucle, sans
contrôle** — ni bouton de son, ni barre de lecture, ni pause. Par-dessus : le
monogramme et le nom en haut, un titre, une phrase, puis `Create account`
(blanc plein) et `Sign in` (contour blanc).

**Repli.** Une photo fixe 9:16, embarquée dans le binaire, remplace la vidéo à
l'identique dès qu'elle échoue — réseau absent, décodage impossible, économiseur
de données actif, `prefers-reduced-motion`. La composition ne bouge pas d'un
point et **aucun message n'est affiché** : une vidéo d'ambiance qui ne charge pas
n'est pas une panne pour qui arrive. Le repli est aussi ce qui s'affiche pendant
le premier chargement, sans transition ni fondu.

L'inscription et la connexion suivent, en thème clair, avec le sélecteur de rôle
existant.

## Composants

### Nouveaux

| Composant | Rôle |
|---|---|
| `BarreDeRecherche` | Champ de 48, rayon plein. Deux états : repos (ouvre l'écran de recherche) et actif (saisie, croix d'effacement). |
| `RangeeDeCategories` | Défilement horizontal de `PastilleDeCategorie` (64, ronde, photo + mot). Sélection portée par une bordure de 2 px et le mot. |
| `RangeeThematique` | Titre, « See all », défilement horizontal de `BusinessCard`. Ne se rend pas si sa liste est vide. |
| `FeuilleDeFiltres` | Feuille modale, quatre sections en `flexWrap`, pied à deux actions. |
| `GroupeDePalier` | En-tête `tier.*.subtle` + `TierBadge` + contrepartie, puis ses `PrestationRow`. Variante fermée : opacité 0,75, sans action. |
| `PrestationRow` | 76 de haut, vignette de 56, nom, `durée · prochain créneau` en `type.mono`, action `Book` à droite. Remplace `ServiceRow` sur la fiche. |
| `Galerie` | Pagination horizontale + compteur. Plein écran sur fond sombre, bande de vignettes de 56. |

### Modifiés

- **`BusinessCard`** gagne une variante `compacte` (264 × couverture 176) et une
  pastille facultative `accent.warm` sur la couverture. La variante pleine
  largeur est inchangée.
- **`Chip`** gagne une pastille de compteur, utilisée par le bouton `Filters`.
- **`Icone`** gagne un glyphe : `recherche`, une loupe construite —
  `M11 19a8 8 0 100-16 8 8 0 000 16zM16.8 16.8L21 21`, trait 1,75 comme les
  autres. C'est la seule icône ajoutée ; `reglages` sert au bouton de filtres,
  `fleche` retournée sert au retour.

### Retirés

- **`RangeeDeChips` de rayon en tête de fil.** Le rayon vit dans la feuille de
  filtres. Il reste proposé, chiffré, dans l'état vide.

## Ce que l'API doit fournir

À arbitrer avec `api-map.md`. Rien de ce qui suit n'existe aujourd'hui.

1. **Catégorie sur le commerce** — taxonomie fermée de six valeurs, portée par
   le commerce, renvoyée sur le fil et la fiche. Les libellés sont traduits côté
   app, la valeur est un code stable.
2. **Type de prestation sur l'item de catalogue** — seconde taxonomie fermée,
   indépendante de la catégorie du salon (un spa peut proposer une manucure).
3. **Disponibilité du jour** — un booléen et un décompte de places restantes par
   commerce, sinon la rangée « Still room today » demande un appel par carte.
4. **Ancienneté** — la date d'activation du commerce, pour « New on BIND ».
5. **Recherche** — une route unique renvoyant deux listes typées, services et
   commerces, filtrées par les mêmes paramètres que le fil.
6. **Galerie** — une liste ordonnée de médias par commerce, aujourd'hui limitée
   à `cover_photo_key`.
7. **Horaires du jour** — l'amplitude d'ouverture du jour courant sur la fiche.

Tant qu'une de ces données manque, la rangée ou le filtre correspondant **ne se
rend pas**. Aucune valeur inventée côté client, aucun tri approximatif présenté
comme un classement.

## Matière à fournir

Les maquettes utilisent des placeholders rayés annotés. Pour juger des écrans il
faut de vraies photos :

- **8 à 12 couvertures de salon**, 16:9, minimum 1200 px de large. Intérieur ou
  détail de prestation, pas de logo incrusté.
- **6 photos de catégorie**, carrées, recadrables en rond à 64 — un détail lisible
  très petit : une main, une mèche, une texture.
- **10 à 12 photos** pour la galerie d'un salon de démonstration.
- **1 vidéo verticale** de créatrice, 9:16, 6 à 10 secondes, bouclable sans
  raccord visible, **utilisable sans son**, plus **1 image fixe** tirée de la même
  séquence pour le repli.

## Contraintes inchangées

React Native + Expo, flexbox uniquement. Anglais et espagnol, clés symétriques.
Aucun émoji. Aucun montant présenté au créateur. `opacity` et `transform` seuls
animables. Bordures de 1 ou 2 px. Icônes 24, trait 1,75. Trois marqueurs
redondants sur les paliers. Le bouton impossible est retiré, jamais grisé.
