# Passation — BIND · v0.6 · grand écran

> Addendum à `README.md` (v0.4) et `PASSATION-v0.5.md`. Ce document couvre le
> chantier grand écran sur les trois rôles, plus les points relevés en campagne
> de test. Maquettes : `BIND Desktop — v0.6.dc.html`, captures à 1512.

## Constat

L'application n'existait pas sur grand écran. Une colonne étroite centrée dans
du vide, ou un bloc étiré sur 1500. La barre d'onglets mobile reprise en bas
d'un écran de bureau. `rules.md` §8 décrivait bien un comportement grand écran,
mais il tenait en trois lignes par rôle et ne définissait aucune coquille : ce
n'est pas un oubli d'application, c'est une règle trop courte.

## 1. La coquille de bureau

Au-delà de 900 de large mesurés sur le conteneur, la barre d'onglets du bas
disparaît et devient une **barre latérale de 240**, repliable en **rail de 72**.
Le repli est un choix de l'utilisateur, retenu par appareil — jamais une
conséquence automatique de la largeur.

| Élément | Largeur | Contenu |
| --- | --- | --- |
| Barre latérale | 240 | Marque, contexte (commerce ou nom), navigation, réglages, repli |
| Rail replié | 72 | Icônes seules, libellé en étiquette au survol |
| Barre de titre | hauteur 56 | Nom de l'écran, fraîcheur de la donnée, deux actions au plus |
| Liste commerce | 400 | Inchangé depuis `rules.md` §8 |
| Détail commerce | 720 max | Borné : le vide à droite est voulu |
| Contenu créateur | 1120 max | Élargi depuis 760 |
| Contenu rapports | 1120 max | — |
| Panneau admin | 440 | Dans la fourchette 400–470 |

Densité de la navigation : lignes de **44** chez le créateur et le commerce,
de **38** chez l'administration. La ligne active porte un fond `accent.subtle`
et une barre gauche de 3 px `accent.default` — jamais la couleur seule.

Le rôle se lit à la couleur du nom sous la marque : `role.creator`,
`role.merchant`, neutre pour l'administration. Aucun autre marqueur de rôle.

### Ce que la coquille ne touche pas

L'écran de code de retrait reste **hors thème et hors grille** : plein écran,
blanc sur noir, sans barre latérale ni barre de titre. Il n'entre pas dans le
gabarit, et c'est voulu.

## 2. Le créateur passe de 760 à 1120

`rules.md` §8 bornait le contenu créateur à 760 centré. C'est exactement la
colonne étroite dans le vide relevée en test. Nouvelle règle : **1120**, et les
rangées thématiques de la v0.5 passent en grille de **3 à 4 cartes par ligne**
au lieu d'un défilement horizontal. Le défilement horizontal reste la forme
mobile ; sur grand écran il cache du contenu sans raison.

## 3. Connexion : deux portes

Le rôle se choisit **avant** le formulaire, sur un écran de choix portant deux
cartes de 440 côte à côte, chacune avec sa promesse et trois points concrets.
La paire de chips créateur / commerce au milieu de l'inscription disparaît.

Le formulaire vit ensuite sur un écran en deux parties : un panneau d'encre de
604 qui reprend la promesse choisie, et le formulaire sur 480. Le panneau existe
pour que le formulaire ait un contexte au lieu d'un vide.

**Le bouton de validation reste visible en permanence**, à l'état désactivé tant
que la saisie est incomplète, avec une jauge qui dit ce qui manque (« 6 / 12 »,
« Six to go »). C'est le cas prévu par `components.md` §1 : une action qui
redeviendra possible. Le retirer, comme aujourd'hui, laisse un écran sans issue
visible.

## 4. Rapports commerce : deux graphiques

Amendement à `components.md` §17, qui excluait tout graphique.

**Ce qui est autorisé** : des barres, et une évolution dans le temps. Une seule
couleur par série. Pas de dégradé, pas d'ombre, pas de troisième dimension, pas
de légende flottante, pas de courbe lissée, pas d'axe secondaire.

- **Publications livrées par semaine** — douze barres, trois lignes de repère,
  échelle en `type.mono` 11.
- **Répartition par palier** — trois barres horizontales, chacune dans sa teinte
  de palier, avec son `TierBadge`. C'est la seule série colorée : la couleur y
  porte déjà un sens ailleurs dans le produit.

Les règles de fond ne bougent pas. Le taux nomme ses deux termes sous le
chiffre. Le taux nul se dit en mots. La portée est annoncée comme une
approximation, en toutes lettres.

## 5. Caisse sur bureau

Barre de caisse fixée en haut, sur `bg.inverse` — c'est le seul écran commerce
qui se lit debout, à un mètre, entre deux clientes. Champ de 72, pavé de douze
touches de 56 **conservé même là où un clavier physique existe** : au comptoir
on tape d'une main. La saisie clavier fonctionne en parallèle, et l'aide sous le
champ le dit.

À droite, un panneau de 440 : les validations du jour, la plus récente sur
`status.success.subtle` avec l'échéance de publication calculée.

## 6. Back office

Les tableaux occupent leur colonne. En-tête de 30, lignes de 36, colonnes à
largeur fixe, chiffres alignés à droite avec la gouttière de 14. Ligne active :
`accent.subtle` et barre gauche de 3 px.

Barre d'outils de 40 : chips de filtre de 26, compteur de sélection, actions de
masse à droite — limitées aux approbations, comme le veut `components.md` §16.

Panneau de décision de 440, fixé à droite : identifiant technique en en-tête,
aperçu archivé, mention et lieu attendus, historique des demandes, liste fermée
de motifs, puis les trois décisions avec leurs raccourcis A, R et N. Seule
« non honoré » est bordée de `status.danger` : c'est la seule décision du
produit qui ne se rouvre pas.

La fraîcheur de la donnée est annoncée dans la barre de titre.

## 7. États vides

Plus de titre et une phrase sur du blanc. Un **bloc typographique** :

- titre en `type.display` porté à **52 / 56** sur grand écran ;
- une phrase de contexte en 18 / 26 ;
- **des chiffres**, en `type.mono` 44 pour les repères, ou en tableau de
  `DataRow` côté commerce ;
- **les issues, chacune portant son gain chiffré** — « Widen to 30 km · 9
  salons », « Open 4 more services ».

Le cercle de 54 disparaît : il ne disait rien et occupait la place du titre.
Aucune illustration n'est introduite ; `components.md` §17 reste en vigueur sur
ce point.

## 8. Paliers

Trois demandes de la campagne, à traiter dans une passe dédiée :

1. une **progression visuelle** entre les trois paliers, plutôt que quatre
   cartes identiques empilées ;
2. l'**écart au seuil rendu graphiquement**, dans le respect de la règle des
   60 % — pas de barre de progression sous le seuil, où seul l'horizon
   s'affiche ;
3. le **prochain palier mis en avant** comme objectif, distinct des paliers
   lointains.

Non livré dans cette passe. La règle « aucune projection de rythme » et
l'interdiction du pourcentage d'activation restent entières.

## 9. Favicon et marque

Le chevron est retiré. Le favicon est le monogramme, `accent.default` sombre sur
`bg.inverse`, en 16, 32, 64 et 180.

**Le 16 est un dessin distinct, pas une réduction.** Sous 32, le trait
s'épaissit et les extrémités passent en coupe droite (`butt`, `miter`) : un
trait rond sur trois pixels devient une bouillie grise. Aucune version ne porte
de texte.

Trois verrouillages : horizontal (signe + nom), empilé sur encre, et le signe
seul. Le nom n'accompagne le signe que sur l'accueil et la connexion ; partout
ailleurs le signe suffit.

## 10. Réseaux sociaux

Les deux boutons blancs identiques deviennent des lignes de 56 portant la marque
de la plateforme, monochrome, tracée dans le trait de 1,75 du système. Trois
états : connecté (poignée et pastille verte), non connecté (bouton `Connect`),
autorisation expirée (`status.warning.subtle`).

Le texte de `account_token_invalid` reste un fait technique, jamais un
manquement : « Instagram limits authorisations to 60 days. Bookings in progress
are unaffected. »

**À l'intégration, remplacer les glyphes par les fichiers officiels** des
chartes Meta et TikTok. Ce sont des marques déposées : les tracés de la maquette
sont une approximation de gabarit, pas les logos.

## Ce qui change dans les jetons

Une seule addition, `breakpoint` :

```json
"breakpoint": {
  "compact": 0,
  "medium": 600,
  "expanded": 900,
  "contentMaxCreator": 1120,
  "contentMaxMerchant": 720,
  "contentMaxReports": 1120,
  "listWidthMerchant": 400,
  "sidebarWidth": 240,
  "sidebarRailWidth": 72,
  "detailPanelAdmin": 440,
  "topBarHeight": 56
}
```

`contentMaxCreator` passe de 760 à 1120. Aucune couleur, aucune typographie,
aucun rayon ne change.

## Ce qui reste à arbitrer

- Les **paliers** (§8), non livrés.
- La **découverte créateur sur bureau** en grille de 3 à 4 cartes : la règle est
  posée, l'écran n'est pas dessiné.
- Les sept données manquantes listées dans `PASSATION-v0.5.md` restent
  manquantes.

## Contraintes inchangées

React Native + Expo, flexbox uniquement, seuils mesurés sur le conteneur et
jamais en media query. Anglais et espagnol, clés symétriques. Aucun émoji.
Aucun montant présenté au créateur. `opacity` et `transform` seuls animables.
Icônes 24, trait 1,75. Trois marqueurs redondants sur les paliers. Le bouton
impossible est retiré — l'exception du formulaire de connexion est nommée au §3.
