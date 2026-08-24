# Passation — BIND · direction B · Ambre (v1.1)

> **Direction tranchée par la fondatrice le 2026-08-18**, dans l'artefact de
> l'implémentation. Ce document la transcrit et en tire les conséquences pour les
> composants et les écrans. Les valeurs — rampe, échelle typographique, rayons —
> viennent d'elle et ne sont pas des propositions de design.
>
> Remplace `PASSATION-v1.0.md` sur la palette, la typographie et les rayons.
> Les sections v0.5, v0.6 et v0.7 non citées ici restent en vigueur.

## Ce qui change en une phrase

L'orange devient l'ambre `#F39120`, le Didone disparaît au profit de Plus Jakarta
Sans, et les rayons remontent partout sauf sur le bloc accentué.

## 1. La rampe

| Jeton | Valeur | Rôle |
| --- | --- | --- |
| `brand.50` | `#F8F4EF` | Fond d'élément actif dans la navigation |
| `brand.100` | `#F0E3D3` | Teinte du palier post |
| `brand.200` | `#EBC9A3` | Filet clair sur fond de marque |
| `brand.400` | `#F2A855` | La marque sur fond sombre — 9,19:1 sur l'encre |
| `brand.500` | `#F39120` | **La marque. Une surface, jamais du texte** |
| `brand.600` | `#D5770B` | État appuyé |
| `brand.700` | `#A55709` | **Du texte, jamais un aplat** |
| `brand.900` | `#5C300A` | Teinte de palier sur fond sombre |

`brand.500` et `brand.700` sont exactement inverses l'un de l'autre, et c'est la
règle la plus facile à enfreindre du système : le 500 est une surface parce qu'il
donne 2,36:1 sur blanc, le 700 est du texte parce qu'il donne 5,29:1. Aucun des
deux ne fait le travail de l'autre.

**Les neutres penchent vers l'ambre** — teinte 36°, saturation faible. Un gris pur
à côté de cet orange se lit comme une erreur d'impression.

## 2. Les deux mesures qui survivent à la palette

Ces deux règles ont été établies sur l'ambre mais ne lui sont pas propres. Elles
valent pour toute palette de cette famille, et elles sont à transmettre comme
telles.

### Le bouton principal porte l'encre, jamais le blanc

`#17140F` sur `#F39120` donne **7,77:1**. Le blanc donne **2,36:1**, sous le seuil
des petits corps **et** sous celui des grands — il n'existe aucune taille à
laquelle il passerait.

Ce n'est pas propre à l'ambre. Quatre oranges ont traversé ce projet — `#F26B21`,
`#FF5E00`, les trois candidats de la v3, `#F39120` — et **aucun orange chaud à
clarté lisible ne porte du blanc en corps de texte**. Un orange assez sombre pour
porter du blanc n'est plus un orange de marque, c'est une terre cuite.

### Le point du logo est invisible sur un aplat de marque

`logo.signature` `#FF5E00` sur `brand.500` : **1,30:1**.

Le point vit sur `bg.inverse` (5,99:1), sur `bg.surface` (3,06:1) et sur `bg.page`
(2,89:1). Jamais sur l'orange. Ce n'est pas un défaut de palette mais une règle de
pose, et elle s'est vérifiée sur les quatre oranges.

Sur `bg.page`, 2,89 est trois centièmes sous le 3,00 attendu d'un élément
graphique. Le point reste admis parce qu'il n'est jamais seul : les lettres du
logotype portent 17:1 et donnent la forme. Sur une surface où le point serait le
seul objet, poser `bg.surface`.

### Pourquoi le jeton est distinct

`logo.signature` ne référence pas `brand.500`. Le point a traversé le vert
sarcelle, l'orange brut, le `#FF5E00` mesuré et l'ambre **sans changer une fois** :
c'est la seule constante visuelle du produit. S'il pointait vers la rampe, il
aurait déjà changé quatre fois.

## 3. La typographie

Plus Jakarta Sans pour tout, IBM Plex Mono pour les chiffres, codes, seuils et
horaires. **Une seule famille de texte : l'accent est une graisse.**

| Rôle | Taille / interligne | Graisse | Approche |
| --- | --- | --- | --- |
| `display` | 44 / 50 | 700 | −0.02 em |
| `displayAccent` | 44 / 50 | 800 | −0.02 em |
| `heading` | 32 / 40 | 700 | −0.015 em |
| `headingAccent` | 32 / 40 | 800 | −0.015 em |
| `screenTitle` | 28 / 34 | 700 | −0.02 em |
| `section` | 22 / 28 | 700 | −0.015 em |
| `body` | 16 / 25 | 400 | 0 |
| `bodyStrong` | 16 / 25 | 600 | 0 |
| `caption` | 13 / 19 | 400 | 0 |
| `label` | 11 / 14 | 600 | +1,4 px, capitales |
| `mono` | 14 / 20 | 500 | +0,8 px |
| `monoSmall` | 11 / 15 | 500 | +1,2 px |

### Le plancher du Didone n'existe plus

Il gardait un serif d'entrer dans l'interface. Il n'y a plus de serif, donc il n'a
plus d'objet.

Conséquence directe, et c'est un gain : **le titre accentué est disponible à
toutes les tailles.** Son accent étant une graisse et non une famille, il tient à
16 px comme à 44. La v1.0 devait refuser l'accent sous 34 px et retomber sur une
autre fonte ; ce raccord disparaît.

### Ce que la v1.0 perd, et ce que ça règle

Deux fontes à charger deviennent une. Le raccord entre un Didone et un
géométrique — qui demandait de rattraper deux hauteurs d'x différentes — n'existe
plus. Et le reproche des testeurs disparaît à la source : un Didone à 34 px sur
chaque écran faisait magazine, et il n'y a plus de Didone.

## 4. Les rayons — une raison remplacée, pas ajoutée

L'échelle par rôle :

| Jeton | Valeur | Emploi |
| --- | --- | --- |
| `none` | 0 | **Le bloc accentué, et rien d'autre** |
| `sm` | 10 | Chip, pastille |
| `md` | 14 | Champ, ligne de liste |
| `lg` | 18 | Carte, feuille, panneau |
| `xl` | 24 | Visionneuse, couverture |
| `photo` | 16 | Toute image |
| `pill` | 999 | Bouton, chip de filtre |

La v1.0 mettait **tous** les rayons à zéro, sur la raison « le bloc plein ne
fonctionne que d'équerre ». **Cette raison est remplacée, pas conservée à côté de
son contraire.** Elle était vraie du bloc et fausse de tout le reste, et je l'avais
généralisée à tort : d'une propriété d'un objet j'ai fait une loi de système.

Ce qui reste vrai : **le bloc orange reste d'équerre.** Un aplat de marque aux
angles arrondis devient un bouton, et la signature perd la raideur qui la fait
lire comme une signature. Ce qui devient vrai : tout le reste s'arrondit.

**`elevation.card` revient** par conséquence. La v1.0 l'avait supprimée au motif
que le filet suffisait — vrai à l'angle droit, faux à 18 px, où un coin arrondi
sans ombre flotte au lieu de se poser.

**Deux valeurs pour les images** : `photo` (16) quand l'image est un objet dans une
carte, `xl` (24) quand elle **est** la carte. Une image encadrée et une image qui
touche les bords ne demandent pas le même arrondi optique.

## 5. Table de contraste

Recalculée le 2026-08-18 depuis les hexadécimaux. Les paires symétriques sont
dérivées d'un seul calcul : « 500 sur blanc » et « blanc sur 500 » sont une paire
lue dans deux sens, et les avoir traitées comme deux constats indépendants est ce
qui les a laissées diverger en v1.0.

| Combinaison | Rapport | Verdict |
| --- | --- | --- |
| encre sur `brand.500` | 7,8:1 | **Le bouton principal**, toute taille |
| blanc sur `brand.500` | 2,4:1 | **Interdit**, toute taille |
| encre sur `brand.600` | 5,7:1 | **L'appui**, toute taille |
| écart `500` → `600` | 1,4:1 | Appui visible |
| `brand.700` sur `bg.surface` | 5,3:1 | Texte orange, toute taille |
| `brand.700` sur `bg.page` | 5,0:1 | Texte orange, toute taille |
| `brand.700` sur `bg.inset` | 4,6:1 | Passe de peu — éviter sous 13 px |
| `brand.500` sur `bg.surface` | 2,4:1 | **Interdit en texte** |
| `ink.default` sur `bg.page` | 17,3:1 | — |
| `ink.soft` sur `bg.page` | 9,9:1 | Corps long |
| `ink.mute` sur `bg.page` | 4,8:1 | Passe |
| `ink.mute` sur `bg.inset` | 4,4:1 | **Échoue** — descendre à `ink.soft` |
| `ink.faint` sur `bg.page` | 2,5:1 | **Jamais de texte à lire** |
| `ink.onDark` sur `bg.inverse` | 16,7:1 | — |
| `brand.400` sur `bg.inverse` | 9,2:1 | La marque sur sombre |
| `logo.signature` sur `brand.500` | 1,3:1 | **Invisible** — jamais sur l'orange |
| `logo.signature` sur `bg.surface` | 3,1:1 | Élément graphique, admis |

**L'appui n'impose plus d'arbitrage, et c'est nouveau.** En v1.0, `brand.600`
valait `#D2500F` où l'encre donnait 4,33 et le blanc 4,29 — la valeur était assise
sur le point de croisement où aucune couleur de texte ne passe. Puis `#DA5510`
tenait l'encre à 4,68 mais réduisait l'appui de 20 %. Ici les deux tiennent
ensemble, sans compromis à documenter.

**Deux jetons portent une réserve écrite.** `ink.faint` ne porte jamais de texte à
lire — son seul emploi légitime est le libellé d'un champ désactivé, où
l'illisibilité *est* le message. Trois erreurs de contraste sur quatre, dans
l'historique de ce projet, viennent d'un `ink.faint` employé comme couleur de
texte. Et `ink.mute` échoue sur `bg.inset` : c'est le seul couple de la table qui
passe sur deux surfaces et échoue sur la troisième.

## 6. Ce qui est à refaire, et dans quel ordre

**Les treize planches d'écrans** portent la palette et la typographie de la v1.0.
Elles n'ont pas été touchées avant l'arbitrage, précisément pour ne pas être
refaites deux fois. Elles sont maintenant à reprendre, et l'ordre qui limite le
travail perdu est celui des dépendances :

1. **Le fil créateur** (`BIND Creator - Le mur v2.1`) — il sert de référence, et
   les autres écrans reprennent ses cartes et ses rangées.
2. **La fiche de salon** — elle partage la carte et la visionneuse.
3. **La journée du commerce**, puis les rapports et l'annuaire.
4. **L'arbitrage et les plans**, qui ne partagent presque rien avec le reste.
5. **Les écrans de marque** — accueil, connexion, favicon.

**Les trois satins sont périmés pour la deuxième fois** : leurs stops portaient
l'orange brut, puis `#FF5E00`. Les recettes à jour sont dans
`tokens.json → satin.recette` ; les fichiers livrés ne valent plus rien.

## 7. Ce qui ne bouge pas

Les règles de produit, qui n'ont jamais dépendu de la palette :

- aucun montant présenté au créateur, ni au commerce ; ce qui a été donné se
  compte en prestations et en minutes de fauteuil ;
- une prestation non accessible reste visible sur la fiche du salon, jamais dans
  le fil ;
- l'écart au seuil n'est chiffré qu'à partir de 60 % ; en dessous, le palier est
  un horizon, sans barre ni projection de délai ;
- pas de suspension pour absences : le score de fiabilité est gradué et
  réversible, une suspension est binaire et engage des droits ;
- l'annuaire des créateurs est en lecture seule ; le produit circule dans un seul
  sens ;
- un écran ne dit jamais avoir lu ce qu'il n'a pas lu ;
- le bouton impossible est retiré, jamais grisé — sauf l'action qui redeviendra
  possible, nommée en v0.6 §3 ;
- trois marqueurs redondants sur les paliers : le mot, le glyphe, la matière ;
- aucun émoji, aucune illustration, deux graphiques autorisés ;
- React Native, flexbox seul, seuils sur la largeur du conteneur ; anglais et
  espagnol, clés symétriques.

L'écran de code de retrait et la galerie restent **hors système** : blanc pur sur
noir pur pour le premier, `bg.onDark` pour la seconde, sans marque, sans orange et
sans rayon.
