# Passation — BIND

> **v1.0 — BIND AGENCY (2026-08-14). Remplacement complet du système.** Le
> produit passe du vert éditorial à l'orange de l'agence. `PASSATION-v1.0.md`,
> `components-v1.0.md` et `tokens.json` font foi ; **tout ce qui suit dans ce
> fichier décrit la direction Miami After Hours et reste valable pour la
> structure des écrans, jamais pour une couleur, une fonte ou un rayon.**
>
> Deux arbitrages rendus côté produit, écrits en fin de `PASSATION-v1.0.md` :
> la couleur de rôle est gardée **en matière et non en teinte**, et la
> désaturation des photos est **refusée sur le contenu**.
>
> Deux manques nommés : le logo vectoriel et les trois images de satin.
> `SurfaceSatin` n'existe pas tant qu'elles ne sont pas livrées — un dégradé
> linéaire en attendant serait exactement le cliché que la direction évite.

---

> **v0.5 — découverte créateur (2026-08-08).** Le rôle créateur passe en thème
> clair : seul changement au niveau des jetons, le jeu clair existait déjà et
> tient AA. Deux exceptions gardent le sombre — l'écran de code de retrait, et
> la galerie plein écran d'une fiche salon. Le détail est dans
> `PASSATION-v0.5.md`.
>
> **v0.4 — révision de direction visuelle (2026-08-07).** Le sombre est
> conservé, ses fonds cessent d'être noirs. Ce qui a changé est listé en fin de
> document, section « v0.4 ». `tokens.json` fait foi.

## Objet
BIND met en relation des créateurs de contenu et des commerces de beauté et bien-être à Miami (ongles, instituts, coiffeurs, spas). Deux rôles dans une seule application React Native (Expo, build web) plus un back office administrateur web. Le créateur certifie son audience, obtient des paliers, réserve une prestation offerte, la consomme en présentant un code, publie et soumet sa preuve. Le commerce compose son catalogue par palier, règle horaires et capacité, valide les codes au comptoir et contrôle les publications reçues.

Contrainte produit non négociable : **aucun montant n'est présenté au créateur, jamais**. Pas de solde, pas d'avoir, pas de prix barré. La valeur s'exprime en prestation et en durée (« Pose gel, 45 min »). Les montants n'existent que dans le back office administrateur, écran des plans d'abonnement.

## Nature des fichiers fournis
Les fichiers `.dc.html` de ce dossier sont des **références de design réalisées en HTML** : ils montrent l'intention visuelle et le comportement attendu, ce n'est pas du code de production à copier. Le travail consiste à **recréer ces écrans dans l'application React Native existante**, avec ses conventions, sa navigation et ses composants. Si l'app n'existe pas encore, elle est à créer en React Native via Expo (build web inclus), conformément aux contraintes techniques ci-dessous.

Le document de référence est ce dossier, pas les maquettes : en cas d'écart, ce README et `tokens.json` font foi.

## Fidélité
**Haute fidélité.** Couleurs, typographie, échelle d'espacement, rayons, hauteurs de ligne et libellés sont définitifs. Les valeurs exactes sont dans `tokens.json`, l'inventaire des composants dans `components.md`, les règles non visibles sur maquette dans `rules.md`, la correspondance API dans `api-map.md`.

## Contraintes techniques
- React Native + Expo, build web. **Flexbox uniquement**, aucun grid CSS.
- Pas de `backdrop-filter`, pas de flou d'arrière-plan. Les fonds pleins restent des couleurs unies ; **une seule exception depuis la v0.4**, le voile de lisibilité posé sur une photo (`scrim.top/mid/bottom`), qui ne porte aucun sens et sert uniquement à rendre un texte lisible sur une image quelconque.
- Ombres déclarées en `shadowColor/shadowOffset/shadowOpacity/shadowRadius` (iOS) + `elevation` (Android). Une ombre est décorative : la profondeur passe par `bg.raised` et une bordure.
- Animations limitées à `opacity` et `transform`. Pas de shimmer en dégradé animé, pas d'animation de layout sur les listes.
- Bordures de 1 ou 2 px uniquement. Icônes en `react-native-svg`, 24 px, trait 1,75.
- Placeholders d'image : assets PNG statiques rayés, trois formats (16:9 couverture, 1:1 prestation, 44 px vignette).
- Polices chargées en assets locaux via `expo-font` : Familjen Grotesk (display), IBM Plex Sans (UI), IBM Plex Mono (chiffres, codes).

## Thème et rôles
Un seul jeu de jetons sémantiques, deux thèmes. Le thème par défaut dépend du rôle :

```ts
const theme = user.role === 'merchant' ? 'light' : 'dark'; // surchargeable dans les réglages
```

Le créateur est en sombre (navigation, le soir, photos plein cadre). Le commerce est en clair : il travaille en pleine journée sur un téléphone posé au comptoir, souvent près d'une vitrine, où le sombre perd son contraste perçu. Le rôle commerce est signalé par un liseré `role.merchant` de 3 px en haut de chaque écran, une densité plus forte (padding 16, gap 8, lignes de 44 à 64 contre padding 20, gap 16, cartes de 76) et la donnée avant l'image. Les composants, rayons, champs et messages sont strictement les mêmes objets.

**Exception unique** : l'écran de code de retrait ignore le thème. Toujours `#FFFFFF` sur `#000000`, 21:1. Détail dans `rules.md`.

## Écrans
Créateur : inscription et connexion d'un réseau · paliers accessibles et refus expliqué · fil géolocalisé · fiche commerce · réservation et choix de créneau · code de retrait · soumission de preuve · historique.
Commerce : catalogue et composition par palier · horaires et capacité · caisse · réservations du jour · publications reçues · profil et activation.
Administrateur : file des comptes à vérifier · file des contreparties en revue humaine · gestion des paliers · gestion des plans · file des jobs épuisés.

Chaque écran est fourni avec ses états : chargement, vide, erreur, et pour le créateur le cas « éligible à rien ». Les identifiants `data-screen-label` des maquettes (01a, 02b, 15a…) servent de référence commune dans les échanges.

## Principes d'écriture des états
- **Chargement** : squelettes à la géométrie exacte du contenu final, pulsation d'opacité 1,4 s. La navigation et les compteurs d'onglets arrivent avant les listes. Un bouton porte son propre chargement, pas de voile plein écran.
- **Vide** : jamais un cul-de-sac. Chaque issue proposée annonce son gain chiffré (« Élargir à 5 km · 9 salons »). Côté commerce, le vide est un diagnostic chiffré sur sept jours.
- **Erreur** : ce qui s'est passé, puis quoi faire. Jamais de code technique en face utilisateur, jamais de « oops ». Une donnée périmée s'affiche **datée** plutôt que masquée ; seul le calcul manquant est marqué indisponible.
- **Action impossible** : le bouton est **retiré**, pas grisé.
- **Obstacles** : tous affichés, dans l'ordre renvoyé par l'API, sous leur code serveur, avec l'écart chiffré si la valeur actuelle atteint au moins 60 % du seuil. En dessous, le palier est présenté comme un horizon : seuil indicatif, notification automatique à l'approche, **aucune projection de délai**.

## Fichiers de ce dossier
- `README.md` — ce document.
- `components.md` — inventaire des composants, variantes, états, signatures React Native.
- `tokens.json` — jetons finaux, version unique (v0.2.1), deux thèmes, noms sémantiques.
- `rules.md` — thèmes, écran de code, libellés espagnols, animations, accessibilité.
- `api-map.md` — correspondance écran par écran avec les routes de l'API.
- `design/BIND Design System.dc.html` — système : palette, type, échelles, composants, paliers, badges (section 2a = décisions retenues).
- `design/BIND Creator Screens Lot 1.dc.html` — inscription, paliers, fil, fiche commerce.
- `design/BIND Creator Screens Lot 2.dc.html` — réservation, code, preuve, historique.
- `design/BIND Merchant Screens.dc.html` — catalogue, horaires, caisse, journée, publications, activation.
- `design/BIND Admin Back Office.dc.html` — cinq files et écrans de gestion.

Ouvrir les `.dc.html` dans un navigateur pour voir les écrans à taille réelle.


---

## v0.4 · révision de direction visuelle

Constat sur appareil : trop sombre, trop plat, sans vie. Un seul accent aqua sur
du noir neutre, aucune marque, aucun mouvement, des icônes approximatives, et
des écrans qui n'étaient que du texte empilé.

**Les fonds ne sont plus noirs.** Ils sont une encre indigo-prune très sombre et
légèrement colorée — `bg.canvas` #0E0B16, `bg.surface` #181327, `bg.raised`
#221B36. Quatre niveaux qui se distinguent réellement l'un de l'autre, ce que
trois gris neutres à deux points d'écart ne faisaient pas.

**Un second accent, chaud.** `accent.warm` (#FF8A5C en sombre, #B0491A en
clair) pour ce qui appelle sans être l'action principale. L'aqua reste l'accent
premier et le seul à porter une action.

**Trois teintes de palier franchement distinctes.** Story rose, post aqua, reel
violet, chacune avec sa déclinaison `.subtle`, `.onTier` et ses deux couleurs de
glyphe. Elles étaient gris, aqua et blanc : à l'écran, deux paliers sur trois se
ressemblaient. La règle des trois marqueurs redondants ne bouge pas — la couleur
ne porte toujours aucune information seule, le mot et le glyphe restent
obligatoires.

**Une marque.** Monogramme géométrique : un axe et deux arcs inégaux, lisible
comme un « B » sans être la lettre d'une police. Trait d'épaisseur constante,
aucun effet, tient de 20 à 96 points. `Logo` pour le signe, `Marque` pour le
signe et le nom. Sa couleur vient du thème : elle suit l'accent du rôle.

**Le mouvement entre dans le système.** `motion` existait sans emploi. Trois
primitives : `Apparition` (opacité et dix points de montée, échelonnée en
cascade, plafonnée à huit rangs), `useEnfoncement` (échelle 0,97 au doigt), et
`vibration` (retour tactile des actions engagées). Toutes respectent le réglage
système « réduire les animations » : pour qui a des vertiges vestibulaires, une
cascade est un symptôme, pas une décoration. Les piles glissent horizontalement
et rendent le retour au geste depuis le bord.

**La photo mène la carte.** `BusinessCard` donne 208 points à sa couverture et
pose le nom dessus, sur le voile de lisibilité. Les photos de salon étaient des
vignettes de 150 points sous lesquelles s'empilait du texte.

**Les icônes sont construites, plus suggérées.** Le glyphe des réglages était un
rond entouré de huit rayons — un soleil, pas un réglage. Ce sont maintenant
trois curseurs. Tête et épaules pour la personne, cadran et aiguilles pour
l'horloge, et trois glyphes ajoutés : `cadenas`, `etincelle`, `fleche`.

**Chaque écran commence par un point d'entrée visuel.** `EnTeteDEcran` : une
salutation par le prénom, le titre, et une rangée de compteurs facultative. Le
prénom se déduit de l'adresse quand il n'y a que ça, et **aucune salutation ne
s'affiche** si le fragment obtenu n'a pas l'air d'un prénom — « Bonjour
utilisateur » se remarque immédiatement.

**Aucun émoji, nulle part.** Un test le vérifie sur toutes les sources.
