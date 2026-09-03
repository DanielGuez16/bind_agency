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
| `secondary` | transparent | `ink.default` | 1,5 px `line.solo` |
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
| Post | teinte | `brand.100` | 1 px `brand.500` | `brand.900` | 2 / 3 |
| Reel | aplat | `brand.500` | aucune | `ink.onBrand` | 3 / 3 |

Trois marqueurs redondants obligatoires ensemble : le mot, le glyphe à trois
barres, la matière. Vérifiable par construction — les trois badges restent
distincts en niveaux de gris.

Le mot n'est jamais abrégé. Sur fond sombre, contour et teinte s'éclaircissent
(`brand.400`, `brand.900`), l'aplat ne bouge pas : l'ordre des matières est
conservé.

**Le libellé du badge fait 11 px.** À cette taille, aucune couleur sous 4,5:1
n'est admise, et c'est ce qui fixe la couleur de chaque matière.

> **Corrigé le 2026-08-21.** Cette section affirmait que « `brand.700` sur
> `brand.100` passe ». C'est **faux** : mesuré, le couple donne **4,19:1** à
> 11 px. Le libellé du badge teinte est donc `brand.900`, à **8,84:1**, qui reste
> dans la famille brune de la rampe. Assombrir le fond n'était pas l'issue —
> `brand.700` sur `brand.200` est pire, à 3,38:1. Les deux autres matières
> étaient justes : contour `brand.700` sur `bg.surface` 5,29, aplat
> `ink.default` sur `brand.500` 7,77. C'est le seul couple du système qui
> portait une affirmation non mesurée, et il est resté faux deux versions.

`brand.700` sur `bg.inset` (4,56:1) reste à éviter sous 13 px, et l'aplat porte
l'encre.

---

## 3. `BarreauDePalier` (v0.7)

Structure inchangée. Trois substitutions par rapport à la v1.0 :

- carte en `radius.lg`, bandeau de format en haut, coins supérieurs suivant la
  carte ;
- la pastille `NEXT FOR YOU` reste `brand.500` à texte encre, en `radius.sm` ;
- la bordure du prochain palier reste `line.solo` sur 2 px — un orange de 2 px sur
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
| warning | `bg.inset` | `line.solo` | `ink.default` | **obligatoire** |
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
`line.solo`** — sur un écran qui porte de l'orange, un focus orange se perd.
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

Inchangés, et **explicitement hors système** : galerie sur `bg.onDark` en
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

## 13 bis. Une carte porte un seul traitement

Cinq reprises de la journée du commerce ont fini sur ce défaut, et il vaut pour
toute carte du produit.

**Le défaut :** une carte de décision portait un titre en sans, une date en mono,
un corps en sans, et une paire étiquette-valeur alignée sur une seconde colonne.
Quatre grammaires typographiques sur 322 px de large, donc quatre changements de
mode pour lire trois faits. Le verdict des tests était « fouillis », et c'était
une mesure.

**Trois règles en sortent :**

1. **Une colonne.** Aucune paire étiquette-valeur sur une carte étroite : deux
   colonnes y creusent une rivière au milieu. L'échéance entre dans la phrase qui
   l'explique, en gras dans le texte.
2. **Deux graisses au plus par carte** — 700 pour le titre, 400 pour le reste, 600
   pour le mot qui porte l'échéance. Pas de troisième famille.
3. **Un fait, une fois.** Un fait qui change de traitement cesse d'être reconnu
   comme le même fait : c'est ce qui fait écrire une heure limite deux fois, en
   croyant la dire une seule.

**Le titre porte ce qu'on cherche d'abord**, pas le nom de l'objet : « Gel
manicure, Sunday at 2pm » et non « Gel manicure » avec l'heure ailleurs.

## 13 ter. Une étiquette n'est pas une phrase

`type.label` et `type.dataLabel` sont des **capitales espacées de 11 px**. Cette
forme se lit par reconnaissance, pas par lecture : l'œil identifie un mot connu et
passe. Au-delà de quelques mots, elle force un déchiffrage lettre par lettre.

**La règle : moins de vingt-quatre signes, et jamais plus de quatre mots.** Au-delà,
c'est du texte, donc `bodyStrong` ou `body`.

Trois familles de violations, toutes rencontrées :

1. **Une phrase déguisée en étiquette** — « WHY · CAMILLE READS THIS, WORD FOR
   WORD », « THE LOCATION TAG IS MISSING », « READ ONLY, MONTHLY FIGURES COMPUTED
   SERVER-SIDE ». Elles se lisent mal et échouent souvent le seuil de couleur à
   11 px.
2. **Un titre de section en étiquette** — « NOW YOURS TO SET ». Un titre porte le
   sens d'un bloc, il ne l'annote pas.
3. **Deux faits dans une étiquette** — « STATE · 11 MOST RECENT OF 34 », « AS OF
   21 AUG · 240 SUBSCRIPTIONS ». Le point médian y sert de conjonction, ce qui est
   son second emploi interdit.

**Ce qui reste légitime** : les têtes de colonnes d'un tableau (`BUSINESS`,
`EXPECTED`, `TIER`), un état d'un ou deux mots (`READ ONLY`, `LIVE`, `DRAFT`), et
les intertitres d'une planche de présentation, qui ne sont pas du produit.

## 13 quater. Un champ conditionnel suit la donnée, pas la catégorie

Le champ « carte du menu » apparaissait pour tout commerce. Le réflexe serait de le
lier à la catégorie — restaurant oui, salon non — et ce serait faux : un spa qui
propose « une formule au choix » en a besoin, un restaurant à menu unique n'en a
aucun usage.

**Il suit le drapeau « laisse un choix » de l'item de catalogue**, celui déjà
demandé au lot 4. Aucune prestation à choix, aucun champ. Et le libellé nomme ce
qu'il sert : « ce que la créatrice pourra choisir », jamais « carte du menu ».

La règle se généralise : **un champ conditionnel se lie à la donnée qui le rend
nécessaire**, jamais à une catégorie qui la corrèle.

## 13 quinquies. Un onglet reste actif sur toute sa section

Un onglet de barre basse désigne une **section**, pas un écran. `More` reste donc
coloré tant qu'on est dans « Your place », « Your services », « Reports » ou
« Creators » — pas seulement sur le menu lui-même.

Sans cela, entrer dans une sous-page éteint la barre entière : plus aucun onglet
n'est actif, et l'utilisateur ne sait plus d'où il vient ni ce que le retour
ramène. C'est le même principe que le sélecteur de salon, où le contexte reste
visible pendant qu'on agit.

Vaut pour les quatre onglets des trois rôles, et pour la barre latérale de bureau.

## 13 sexies. Retiré

**Ce document dit ce que le système ajoute ; cette section dit ce qu'il a enlevé.**
Cinq régressions en une soirée ont eu la même cause : une planche neuve repart
d'une carte antérieure et réintroduit un élément qu'une passe suivante avait
retiré. Un retrait ne laisse aucune trace dans le fichier qu'il vide, donc il
faut le lire ici avant de recomposer un écran existant.

Une ligne par retrait, la version qui l'a décidé, et la raison en une phrase.

| Retiré | Où | Pourquoi |
| --- | --- | --- |
| Le compte d'abonnés sur une carte de décision | v9, commerce | Un visage et un lien disent **qui**, pas combien. L'audience appartient à la fiche qu'on ouvre pour décider. |
| L'audience sur une ligne de liste | v7, commerce | Utile en agissant, inutile en parcourant. Le détail n'apparaît qu'au moment d'agir. |
| Le bandeau « vous êtes en ligne » | v6, journée | Il confirmait un état permanent à quelqu'un qui ouvre l'écran pour agir, et occupait le tiers haut. |
| L'historique du jour sur la journée | v7, commerce | Servi derrière un compte dans l'en-tête : ce qui est clos n'a pas à peser sur ce qui attend. |
| La capacité du jour sur la journée | v7, commerce | Descendue sous `More`, avec la semaine type qu'elle modifie. La flèche qui la dépliait part avec elle. |
| Les comptes sur les onglets de réservations | v10, créateur | Un chiffre sur un onglet est un appel permanent ; seul « to send » en mérite un, et la ligne d'aide le porte. |
| La pastille « 1 saved » sur une carte de salon | v4, créateur | Une carte de salon contient quatre prestations : un cœur ou un compte y désignerait quoi ? |
| Le point orange sur la porte des favoris | v3.1, créateur | Un point nu sur une porte se lit « non lu », donc il annonçait une notification non décidée. |
| Le mono sur les dates et les durées | v8, partout | Une date est une phrase et se lit d'un bloc. `type.data` porte un code, un décompte, un seuil. |
| Le serrage négatif sous 22 px | v8, partout | Il tient un display de 44 px ; à 22 et moins il ferme des contreformes déjà compactes. |
| Les tirets cadratins | v8, partout | Remplacés **par le sens** : virgule pour une apposition, point pour deux phrases. Jamais par un point médian, qui est le séparateur de champs. |
| Le tiret dans une cellule vide | v12, commerce | Un signe à interpréter, en `ink.faint` à 2,46:1. La cellule reste vide quand une autre colonne porte déjà le fait. |
| ~~Le « 0 » sur un jour sans décision~~ **remis en v14** | v11 puis v14, commerce | Retiré tant que la bande tenait **sept cases dans l'écran** : sept chiffres à lire pour en retenir deux. Remis à quatorze cases sur une piste qui défile, où une case vide ne se distingue plus d'une case pas encore chargée. Ce n'est pas le retrait qui était faux, c'est la longueur de la bande qui a changé la question. En `ink.mute`, jamais `ink.faint` : un chiffre posé pour être lu ne peut pas vivre à 2,46:1. |
| Le chevron **comme promesse** sur chaque ligne d'un tableau | v12, commerce | Sept chevrons répétaient sept fois la même promesse. Il revient en v13 comme **marque** et non comme cible : la rangée entière reste la seule zone cliquable, et rien d'autre dedans ne l'est. Même partage que le glyphe `sortie`. |
| « MIAMI » sous le titre du fil | v9, créateur | Le fil est local par construction ; le nom de la ville n'informe personne. |
| La vidéo de fond de l'accueil | v3, créateur | Quatre états à tenir pour un fond qui ne fait pas arriver plus vite au fil. |
| Le bloc noir de la connexion de bureau | v3, créateur | Il expliquait le produit à la seule personne qui a déjà un compte. |
| La signature « AGENCY » et « CRÉATEUR DE LIEN » | v1.0, marque | Le logotype seul suffit, et la seconde est en français quand BIND parle anglais et espagnol. |
| Le sélecteur de période à zéro donnée | v3, rapports | Il n'y a aucune période à comparer. |
| Le mot à côté de la flèche de retour | v14, partout | « Back » redit le geste que la flèche fait, et sur une sous-page de menu il écrivait « More » — le nom de l'endroit qu'on venait de quitter, en haut de chaque page qu'on y ouvre. La destination reste dans le libellé accessible, où elle répond à « où revient-on » pour qui n'a pas l'écran sous les yeux. |
| Le glyphe `sortie` sur l'entrée d'abonnement | v14, commerce | Il dit « ce lien quitte l'application », et l'abonnement est un écran du produit. Il ne marquait qu'un lien interne, c'est-à-dire rien. |
| L'intertitre propre de la pause et celui de l'abonnement | v14, commerce | Deux titres de même taille pour deux gestes que le salon lit comme un seul sujet — ce qu'il peut faire de son commerce. Un seul intertitre, et deux boutons de même forme. |
| La recherche par pseudonyme dans l'annuaire | v3, commerce | Un salon ne connaît aucun pseudonyme : le champ ne sert qu'à qui sait déjà quoi taper. |
| La suspension punitive | v0.7, produit | Le score de fiabilité couvre le cas, gradué et réversible, là où une suspension est binaire et engage des droits. |
| `tiers.valueHint` | v0.7, créateur | Une valeur monétaire présentée à un créateur. |
| `color.role.*`, `color.accent.*`, `color.tier.*` | v1.0, jetons | Trois jeux de teintes pour trois rôles : la matière encode le palier, la couleur ne le double pas. |
| `userOverride` sur le thème | v1.1, jetons | Un interrupteur vers un second thème qui n'existe pas. |
| `size.listRow` | v1.1, jetons | Deux jetons pour la même hauteur. |

**Avant de recomposer un écran existant, lire cette table.** Un élément qui y
figure ne revient que par une décision explicite qui l'y remplace, jamais par un
copier-coller d'une planche antérieure.

## 14. Interdits, inchangés

Deux graphiques autorisés et deux seulement (barres, évolution dans le temps).
Aucune illustration. Aucun émoji. Aucun montant présenté au créateur. Aucun
montant côté commerce non plus — ce qui a été donné se compte en prestations et
en minutes de fauteuil. `opacity` et `transform` seuls animables. Flexbox
uniquement. Anglais et espagnol, clés symétriques.

Le bloc accentué n'est jamais animé : une signature qui bouge est une bannière.

Les émoji restent interdits même si les visuels de la fondatrice en portent : un
réseau social et une application de réservation ne sont pas la même surface.
