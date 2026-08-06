# Inventaire des composants — forme React Native

Conventions : tous les composants sont des fonctions React sans état interne sauf mention. Les couleurs sont lues via `useTheme()` qui retourne le jeu de jetons du thème courant (`tokens.color[theme]`) ; aucune valeur brute dans le code d'écran. Les tailles sont en points, identiques web et natif.

## 1. Button

```ts
type ButtonProps = {
  label: string;                  // jamais tronqué, 2 lignes autorisées
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';  // défaut primary
  size?: 'sm' | 'md' | 'lg';      // 36 / 48 / 56
  state?: 'default' | 'pressed' | 'disabled' | 'loading';
  fullWidth?: boolean;            // défaut true
  onPress?: () => void;
  accessibilityLabel?: string;
};
```

- **primary** : fond `accent.default`, texte `accent.onAccent`, rayon `radius.md` (8). Pressé : `accent.pressed`.
- **secondary** : fond `bg.surface`, bordure 1 px `border.default`, texte `text.primary`.
- **ghost** : pas de fond ni bordure, texte `accent.default`.
- **danger** : bordure 1 px `status.danger`, texte `status.danger`, fond transparent.
- **disabled** : fond `bg.raised`, texte `text.disabled`. Utilisé seulement quand l'action redeviendra possible ; sinon retirer le bouton.
- **loading** : le libellé est remplacé par « <verbe>… » et un anneau de 15 px en rotation (`transform`), même géométrie, non pressable.
- Tailles : `sm` 36 (secondaire dense, commerce), `md` 48 (défaut), `lg` 56 (action de caisse et actions de fin d'écran).
- Largeur : `fullWidth` ou `flex: 1` dans une rangée. **Jamais dimensionné sur le texte** (contrainte espagnol).
- Hauteur minimale de zone tactile : 44.

## 2. TextField

```ts
type TextFieldProps = {
  label: string;
  value: string;
  placeholder?: string;
  helpText?: string;
  errorText?: string;             // présent => état error
  state?: 'default' | 'focus' | 'error' | 'disabled';
  keyboard?: 'default' | 'numeric' | 'code';   // 'code' = alphabet réduit, voir CodeInput
  onChangeText?: (v: string) => void;
};
```

Hauteur 48, rayon 8, padding horizontal 14, texte `type.body`. Bordure : `border.default` (1 px) ; focus `border.focus` (2 px, padding compensé, **aucun halo**) ; erreur `status.danger` (1 px) sur fond `status.danger.subtle`. Le message d'erreur est précédé d'un point de 14 px `status.danger` et remplace `helpText`. Disabled : fond `bg.sunken`, texte `text.disabled`.

## 3. Stepper (compteur)
Champ de 44 de haut avec valeur en `type.mono` à gauche, deux touches carrées de 28 à 32 (− et +) à droite, fond `bg.sunken`. Utilisé pour places/jour et capacité. Variante « rangée de valeurs » (1 à 5) pour la capacité journalière : cinq boutons `flex:1` de 40, l'actif prend `status.danger` s'il descend sous les réservations prises.

## 4. Toggle
40 × 22, rayon plein, pastille blanche de 16. Actif `accent.default`, inactif `border.default`. Sert à ouvrir/fermer une prestation et à mettre BIND en pause.

## 5. SegmentedTabs

```ts
type SegmentedTabsProps = { items: { label: string; count?: number }[]; index: number; onChange: (i: number) => void };
```
Rangée de 1 px de gap sur fond `border.subtle`, chaque segment `flex:1`, 30 à 32 de haut. Actif : fond `bg.inverse` ou `bg.raised` selon le thème, texte inversé. Les compteurs font partie du libellé (« À venir · 1 »). Les onglets et leurs compteurs se chargent **avant** la liste.

## 6. Chip / FilterChip
Rayon plein, padding 7×13, `type.label`. Sélectionné : fond `bg.inverse`, texte `text.inverse`. Non sélectionné : bordure `border.default`, texte `text.secondary`. Enveloppe en `flexWrap` — jamais de défilement horizontal masquant des options en espagnol.

## 7. TierBadge

```ts
type TierBadgeProps = { tier: 'story' | 'post' | 'reel'; size?: 'sm' | 'md'; onPhoto?: boolean };
```

Trois marqueurs **redondants**, obligatoires ensemble :
1. le mot, toujours écrit et jamais abrégé (`STORY` / `HISTORIA`, `POST` / `PUBLICACIÓN`, `REEL`), `type.mono` 10-11 px, letterSpacing 0,06em ;
2. un glyphe de 1, 2 ou 3 barres à gauche du mot (largeur 3, hauteurs 6 / 9 / 12, gap 2) — barres inactives en `tier.*.glyphEmpty`, souvent transparentes ;
3. une matière propre : story = contour `tier.story` ; post = fond `tier.post.subtle` + bordure ; reel = fond plein `tier.reel` avec glyphe et texte inversés.

Aucun chiffre de niveau dans le badge (collision avec le badge de vague, et invite à la comparaison). `onPhoto` ajoute un fond `badge.scrim` opaque. Le badge est toujours accompagné, sur les cartes, d'une ligne de contrepartie en clair (« Une story dans les 48 h ») : c'est cette phrase qui informe.

## 8. WaveBadge · NewcomerBadge · BehaviourChip
- **WaveBadge** : **retiré du périmètre.** Une vague est une cohorte que quelqu'un ouvre et ferme ; la dériver du mois d'inscription inventerait cette décision et donnerait à un simple horodatage l'apparence d'un programme. Rien en base ne la porte. Le jour où les vagues existent vraiment, le badge revient avec elles.
- **NewcomerBadge** : chip « Nouveau sur BIND », destiné au commerce, expire à 21 jours ou 3 publications livrées. N'affiche jamais de zéro.
- **BehaviourChip** : chips cumulables et jamais décroissantes (« 12 publications livrées », « Habitué · <salon> », « Toujours dans les délais »). Aucun badge négatif n'existe dans le système.
- Deux badges maximum sur un profil, priorité comportement > nouveau.

## 9. Cards
- **BusinessCard** (fil créateur) : couverture 16:9 de 150, badge de palier en haut à droite, distance en pastille `badge.scrim`, nom en `type.title`, méta en `type.caption`, séparateur `border.subtle`, prestation + durée, ligne de contrepartie, bouton `md`. Rayon `radius.lg`.
- **ServiceRow** (commerce, 64 de haut) : vignette 44, nom `type.label`, méta en `type.mono`, badge de palier, Toggle à droite.
- **DataRow** (44 à 52) : libellé `text.secondary` à gauche, valeur `text.primary` (mono si chiffre) à droite. Base des écrans horaires, profil, détails admin.
- **MediaFallback** : quand l'image manque, monogramme de deux lettres sur `bg.raised` (créateur : neutre et non commenté) ; côté commerce, libellé « Photo manquante · ajouter » en `status.warning` — c'est une tâche, pas un défaut. La hauteur de la carte ne change jamais.

## 10. StatusMessage

```ts
type StatusMessageProps = { level: 'danger' | 'warning' | 'neutral'; title?: string; body: string; action?: ButtonProps };
```
Bloc de padding 12-14, rayon `radius.lg`, fond `status.*.subtle`, bordure 1 px assortie, point de 14-16 px, titre `type.label`, corps `type.caption`. Toujours : ce qui s'est passé, puis quoi faire.

## 11. EmptyState
Colonne centrée (créateur) ou bloc aligné à gauche (commerce) : cercle de 52-56 en `bg.raised`, titre `type.heading`, corps `type.caption`, une à trois actions dont **chacune annonce son gain chiffré**. Côté commerce, un tableau de repères chiffrés remplace toute formule d'encouragement.

## 12. Skeleton
`SkeletonBox`, `SkeletonLine`, `SkeletonCard` : fond `skeleton.base`, `Animated.loop` sur `opacity` de 0,45 à 1, 1400 ms, décalages de 100 à 350 ms entre lignes. Géométrie identique au contenu final. Trois lignes maximum côté commerce.

## 13. CodeInput (caisse)
Champ de 72 de haut, bordure 2 px `text.primary`, quatre caractères en `type.mono` 40 avec gap 14, curseur en tiret de 26×3. Pavé de 12 touches de 56 (`flex:1`, 3 rangées de 4), alphabet réduit **sans O, 0, I ni 1**, dernière touche « Effacer ». Le champ est en haut de l'écran, le pavé toujours ouvert, le scan QR en bouton secondaire.

## 14. PickupCodeScreen (créateur)
Écran plein, hors thème. Voir `rules.md` § 2. Sous-composants : `CodeGlyphs` (76 px, **six chiffres**), `Countdown` (46 px, bloc inversé sous 10 s, compte les secondes avant la rotation suivante), `ManualCode` (mono, six caractères groupés trois par trois), `QrBlock` (170 avec bordure 2 px, **toujours affiché**, régénéré à chaque rotation).

Ni `ExpiredStrike` ni bouton de renouvellement : le code tourne de lui-même, il n'expire pas. Ce qui expire est le droit de consommer, et cela se dit ailleurs.

## 15. SlotPicker · DayPicker
- **DayPicker** : quatre à sept tuiles de 60, colonne jour + numéro en `type.mono`, actif en `bg.inverse`, indisponible en `bg.sunken` sans être masqué.
- **SlotPicker** : chips de 11×16 en `type.mono` 15. Libre = bordure ; sélectionné = `accent.subtle` + bordure `accent.default` ; pris = `bg.sunken`, texte `text.disabled`, non pressable mais **visible** (donne le rythme du salon).

## 16. Composants admin (web dense)
- **TableHeader / TableRow** : hauteur 30 (en-tête) et 34 à 38 (lignes), padding horizontal 12, colonnes à largeur fixe en `flexDirection: 'row'`. Cellules numériques alignées à droite avec **14 px de padding droit** (gouttière obligatoire, sinon les valeurs se collent à la colonne suivante). Ligne active : fond `accent.subtle` + barre gauche de 3 px `accent.default`.
- **DetailPanel** : colonne de 400 à 470, en-tête de 36 avec identifiant technique et rappel du raccourci, corps en blocs de `DataRow` bordés.
- **DecisionBar** : deux ou trois boutons `flex:1` de 34 avec pastille de raccourci (A / D / R, H / T / N). Un motif choisi dans une liste fermée est obligatoire pour toute décision autre qu'une approbation.
- **KeyHint** : pastille `type.mono` 10-11 px sur `bg.raised`.
- **Toolbar** : rangée de 40 avec filtres en chips de 26, compteur de sélection, actions de masse à droite. Les actions de masse ne sont permises que sur les approbations et les relances de jobs.

## 17. Ce qui n'existe pas
Pas de composant affichant un montant, un solde, un cumul de valeur ou un score public côté créateur ou commerce. Pas de badge négatif. Pas de barre de progression en pourcentage sur l'activation commerce (on énonce « 2 étapes sur 4 » et ce qui est bloquant). Pas de carrousel, pas de graphique décoratif, pas d'illustration.
