# Passation — BIND · v0.7 · paliers créateur

> Addendum à `PASSATION-v0.6.md`. Il traite le §8 laissé ouvert : l'écran des
> paliers côté créateur. Maquettes : `BIND Creator - Tiers v0.7.dc.html`,
> mobile 390 × 844 et bureau 1512.

## Le problème

L'écran est le plus important du produit et le seul que personne n'a compris en
le lisant — y compris la fondatrice, qui a cru y voir ses anciennes
publications.

La cause est structurelle, pas cosmétique. `PaliersScreen.tsx` énumère des
**états** : « Story · Instagram · Ouvert », six fois, en cartes identiques. Une
liste de formats de publication accompagnés d'un état se lit comme un
historique. Rien dans la forme ne dit qu'il s'agit d'un **droit d'accès**, et
rien ne dit que ces droits sont **ordonnés**.

Le texte de principe existait déjà en tête (`tiers.principe`) et il est juste.
Personne ne le lit, parce qu'il est démenti par ce qui suit : trois cartes
plates, sans hiérarchie, dans lesquelles rien ne monte.

## La correction : un échange, ordonné

### 1. Chaque palier est un échange, en deux colonnes

La carte n'affiche plus un état suivi de détails. Elle affiche **ce que je
donne** à gauche, **ce que j'obtiens** à droite, séparés par un filet vertical.

| Colonne | Contenu |
| --- | --- |
| You give | La phrase de contrepartie (`LigneDeContrepartie`), inchangée |
| You get | Le nombre de prestations, en `type.mono` 29, et sa barre |

Sur un palier fermé, les deux intitulés passent au conditionnel : *You would
give* / *You would get*. C'est la seule variation de copie entre ouvert et
fermé, et elle suffit à dire que le second est une projection.

### 2. La progression est portée par la matière, pas par la couleur

Le bandeau de la carte reprend la doctrine des trois matières du `TierBadge` et
l'étend à la carte entière :

| Palier | Bandeau | Bordure |
| --- | --- | --- |
| Story | `tier.story.subtle` | 1 px `tier.story` |
| Post | `tier.post.subtle` | 1 px `tier.post` |
| Reel | `tier.reel` **plein**, texte sur teinte | 1 px `tier.reel` |

Contour, teinte, aplat : la même échelle que le badge, à l'échelle de la carte.
Elle se lit en niveaux de gris, ce qui reste la règle.

La barre « You get » est proportionnelle au palier le plus généreux de la liste
— 12 / 34 / 58 donne 21 %, 59 %, 100 %. C'est là que la générosité croissante
devient visible sans lecture.

### 3. Un bandeau de principe, avec son diagramme

En tête, sur `bg.inverse` : la phrase `tiers.principe` et trois barres
ascendantes dans les trois teintes de palier, légendées STORY, POST, REEL.
C'est le seul endroit du produit où les trois formats se voient ensemble, et
c'est ce qui fait tenir la promesse des trois secondes.

Les trois barres reprennent le vocabulaire du glyphe de `TierBadge`. Aucune
illustration n'est introduite : `components.md` §17 reste en vigueur.

### 4. La plateforme passe en onglets

**Changement d'architecture de l'information.** Les paliers sont renvoyés par
l'API en couples plateforme × format, soit jusqu'à six cartes. Six cartes
mélangées cassent l'échelle : « story fermé » sous « story ouvert » se lit comme
une contradiction, et la progression disparaît.

La plateforme devient donc un jeu d'onglets au-dessus de l'échelle, chaque
onglet portant son nombre de paliers ouverts (« Instagram · 1 OPEN »). Sous
l'onglet, trois barreaux et trois seulement.

La `Chip` de plateforme sur la carte disparaît : l'onglet la porte.

### 5. Le prochain palier est désigné

Le premier palier fermé de l'échelle porte une pastille `NEXT FOR YOU` sur
`accent.default` et une bordure de **2 px** au lieu de 1. C'est le seul objectif
de l'écran ; les paliers plus lointains portent « Further ahead ».

### 6. L'écart, dans le respect de la règle des 60 %

Inchangée sur le fond, rendue graphiquement au-dessus du seuil.

**À partir de 60 % du seuil** — le compte chiffré, une barre de 10 px, et la
phrase `obstacles.ecart` :

```
Followers                    7,600 / 10,000
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░
2,400 to go out of 10,000.
```

**En dessous de 60 %** — pas de barre, pas de jauge, pas de délai. Le seuil, et
`obstacles.horizon` :

```
Followers                            50,000
Unlocks at 50,000. We will let you know as you get close.
```

L'absence de barre est le signal : une barre presque vide décourage plus qu'elle
n'informe, et une projection de rythme serait un engagement que le produit ne
tient pas.

**Tous les obstacles sont rendus**, dans l'ordre du serveur, chacun avec son
propre traitement 60 %. Un palier peut donc porter une barre pour les abonnés et
un horizon pour les collaborations.

### 7. Le compte de prestations devient une porte

`tiers.opens` était un texte mort. Il devient l'action de la carte : une ligne
de 48 sous le filet, « See the 12 services », qui mène à la découverte filtrée
sur ce palier.

Le compte gagne un second nombre, celui du rayon : « 12 services · 9 within
15 km ». Douze au total dont neuf accessibles à pied, ce n'est pas la même
promesse, et `tiers.opensHelp` ne le disait qu'en note.

Sur un palier fermé le compte n'est pas cliquable — il n'y a rien à réserver.
Il reste affiché : c'est l'argument.

### 8. Les règles existent

Écran `How tiers work`, atteint depuis un bloc en pied d'échelle. Trois
sections :

1. **Le score de fiabilité** — sa valeur, sa barre, sa définition en une phrase,
   et les deux garanties : jamais comparé entre créatrices, jamais montré à un
   commerce. **Il vient en premier** : c'est la condition que personne ne
   connaît, et les deux blocs suivants s'y réfèrent.
2. **Ce qui ouvre un palier** — audience lue, collaborations terminées, score de
   fiabilité. Un palier s'ouvre quand les trois conditions sont réunies.
3. **Ce qui le referme** — une contrepartie close comme non honorée, une absence,
   une audience repassée sous un seuil franchi. Puis, en note : *un salon qui se
   désiste ne compte jamais contre vous*, ce qui reprend exactement
   `commerce.seDesisterAide`.

Chaque section se termine par ce qui **ne** compte **pas**. C'est la première
question posée, et y répondre coûte une ligne.

Sur grand écran, ces trois blocs deviennent la colonne de droite : les règles ne
sont plus un écran séparé.

### 9. Aucun palier fermé n'est atténué

Pas d'opacité réduite, pas de compactage, pas de repli. **C'est une divergence
assumée avec la fiche salon**, où un palier fermé passe à 0,75 : là-bas il
encombre, ici il oriente. Un palier fermé porte l'information la plus utile de
l'écran — ce qui manque, et ce que cela ouvrirait.

### 10. Quand une seule cause ferme tout

Le comportement existant est conservé : la cause commune passe devant avec son
issue, et l'échelle reste lisible dessous. Deux ajouts :

- une phrase de liaison, « This is what you had, and what is waiting once it is
  back », qui explique pourquoi l'échelle est encore là ;
- sur un palier qui était ouvert, l'état devient **« Paused, not lost »**. C'est
  la question qu'on se pose devant cet écran, et quatre mots y répondent.

## Composants

### Nouveaux

| Composant | Rôle |
| --- | --- |
| `BarreauDePalier` | La carte d'échange. Bandeau de format, deux colonnes give / get, obstacles, action. Variantes `ouvert`, `prochain`, `lointain`, `enPause`. |
| `BandeauDePrincipe` | Fond `bg.inverse`, la phrase de principe et les trois barres ascendantes. |
| `EcartAuSeuil` | Rend un obstacle chiffrable : au-dessus de 60 %, compte + barre + écart ; en dessous, seuil + horizon. La bascule vit **là**, pas dans l'écran. |
| `OngletsDePlateforme` | Un onglet par plateforme connectée, avec son nombre de paliers ouverts. Ne se rend pas si une seule plateforme est connectée. |
| `ReglesDesPaliers` | Les trois blocs. Écran sur mobile, colonne sur grand écran. |

### Modifiés

- **`CartePalier`** est remplacée par `BarreauDePalier`. La `Chip` de plateforme
  et la `Chip` d'état disparaissent au profit du bandeau et de la pastille.
- **`PaliersScreen`** groupe par plateforme et trie par format croissant. Le
  premier palier fermé de la liste triée reçoit `prochain`.

## Ce que l'API doit fournir

Trois manques, à arbitrer avec `api-map.md`.

1. **Le nombre de prestations dans le rayon**, en plus de
   `offres_disponibles` qui est global. Sans lui, la seconde moitié de la phrase
   ne se rend pas — le nombre global reste affiché seul.
2. **Le score de fiabilité, sa valeur et ses deux termes.** L'obstacle
   `reliability_score_too_low` existe et ferme des paliers, mais rien ne renvoie
   le score ni ce qui le compose. Tant qu'il manque, le bloc affiche la
   définition sans le chiffre — jamais un chiffre inventé.
3. **Le seuil de chaque obstacle**, déjà présent via `requis`, mais il faut
   confirmer qu'il est renvoyé même sous 60 % : c'est précisément le cas où
   l'écran n'a que lui à montrer.

Tant qu'une donnée manque, l'élément correspondant ne se rend pas.

## Textes à ajouter

Clés symétriques anglais / espagnol, dans `tiers.*` :

| Clé | Anglais |
| --- | --- |
| `giveLabel` | You give |
| `getLabel` | You get |
| `giveLabelLocked` | You would give |
| `getLabelLocked` | You would get |
| `openToYou` | Open to you |
| `nextForYou` | Next for you |
| `furtherAhead` | Further ahead |
| `pausedNotLost` | Paused, not lost |
| `seeServices` | See the {{count}} services |
| `opensWithRadius` | {{count}} services · {{proches}} within {{rayon}} km |
| `rulesEntry` | How tiers work |
| `rulesEntryHelp` | What lifts you, what sets you back, and what reliability means. |
| `rulesUp` | What opens a tier |
| `rulesDown` | What closes one again |
| `reliabilityTitle` | Your reliability score |
| `stillWaiting` | This is what you had, and what is waiting once it is back. |

`tiers.locked` et `tiers.unlocked` ne sont plus utilisées.

**`tiers.valueHint` est retirée du catalogue** (« Up to {{ratio}}x the value of
your audience »), en anglais comme en espagnol. Elle n'était branchée nulle
part, et elle présente une valeur monétaire à une créatrice — rien dans l'app
côté créateur ne doit ressembler à un solde. Décision validée le 11/08/2026.

## Grand écran

Sur le gabarit v0.6, contenu borné à **1120** : échelle sur **720**, règles en
colonne de **360**.

Le bandeau de format passe à gauche du barreau, sur **150** de large. Les trois
matières s'empilent alors en colonne et la progression contour → teinte → aplat
se lit verticalement, sans avoir à comparer trois en-têtes éloignés. Les
obstacles gagnent une barre pleine largeur, et la phrase d'horizon tient sur la
même ligne que le seuil.

Les onglets de plateforme rejoignent la barre de titre, à droite.

## Ce qui ne change pas

Aucun chiffre de niveau, aucune comparaison entre créatrices, aucune projection
de rythme, aucun pourcentage d'activation. Aucun montant présenté au créateur —
y compris la « valeur » d'un palier. Les trois marqueurs redondants du
`TierBadge` restent obligatoires ensemble. Le mot du palier n'est jamais abrégé.
React Native + Expo, flexbox, anglais et espagnol, aucun émoji.


## Règle écartée · la suspension pour absences

**Deux absences non prévenues ne suspendent pas la créatrice, ni 30 jours ni
autrement.** Cette règle a circulé ; elle n'existe pas et ne sera pas construite.
Décision du 2026-08-19.

La raison est structurelle et vaut d'être écrite : le score de fiabilité couvre
déjà le cas, **gradué et réversible**, là où une suspension est binaire et engage
des droits. Une absence fait baisser un score qui se remonte en honorant les
contreparties suivantes ; une suspension retire l'accès pendant un mois sans que
rien de ce que fait la créatrice n'y change quoi que ce soit.

Aucun écran ne doit donc annoncer de suspension, de compte à rebours de
réintégration, ni de « dernier avertissement ». Ce qu'une absence produit se dit
là où elle se mesure : sur le score, et sur les paliers qu'il ferme.
