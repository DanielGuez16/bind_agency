# Passation — BIND · direction After Hours

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
- Pas de `backdrop-filter`, pas de flou d'arrière-plan, aucun dégradé porteur de sens (les fonds pleins sont des couleurs unies).
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
