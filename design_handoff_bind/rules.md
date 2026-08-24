# Règles qui ne se lisent pas sur une maquette

## 1. Thème clair et thème sombre
Un seul jeu de noms, deux valeurs. Ce qui change :
- **Profondeur** : en sombre, la hiérarchie passe par `bg.surface` → `bg.raised` + `border.default` ; les ombres sont quasi invisibles et ne portent aucun sens. En clair, `elevation.1` (ombre teintée) est admise sur les cartes créateur ; côté commerce tout reste à plat sur bordure pour ne pas alourdir des listes longues.
- **`role.merchant`** se décline : `#F5A524` en sombre, `#9A5F04` en clair. Le jeton ne se copie pas d'un thème à l'autre — l'ocre clair du sombre est illisible sur blanc.
- **`accent.default`** vaut `#35DBC0` en sombre (texte `accent.onAccent` presque noir) et `#0A7364` en clair (texte blanc). Le contraste tient AA dans les deux sens, y compris sur un libellé de 15 px en gras.
- **`badge.scrim`** passe d'un noir à 90 % à un blanc à 92 %.
- **Placeholders d'image** : trois jetons distincts par thème (`media.placeholder`, `media.placeholderStripe`, `media.placeholderText`) — les rayures doivent rester perceptibles sans devenir un motif visible.

Ce qui ne change jamais : la typographie, l'échelle d'espacement, les rayons, la densité par rôle, la structure des composants, les libellés.

Bascule : `theme = role === 'merchant' ? 'light' : 'dark'`, surchargeable par l'utilisateur dans les réglages, persistée localement. Le changement de thème est instantané, sans animation de couleur.

## 2. L'écran de code de retrait ne suit aucun thème
- Toujours `#FFFFFF` sur `#000000` (`code.fg` / `code.bg`), 21:1. Aucun gris sur un élément porteur, aucune opacité, aucune ombre, aucun rayon sur le bloc de code.
- Code de **six chiffres**, dérivé côté serveur et **renouvelé tout seul toutes les 30 secondes**. Chiffres en `type.code` (mono 76), lisibles à 1,20 m dans un salon très éclairé ou en plein soleil.
- **Aucun bouton de renouvellement.** Le code tourne de lui-même : en proposer un donnerait à croire qu'il faut agir, et laisserait quelqu'un attendre devant un écran qui se met déjà à jour.
- Un **code de secours de six caractères** accompagne toujours les chiffres, sur l'alphabet sans O, 0, I ni 1, groupé trois par trois (`4H2 9KX`). Il se dicte au téléphone et se saisit au comptoir quand la caméra ne lit rien. Il ne tourne pas ; ce qui le protège est d'être lié à une réservation, à usage unique, à durée courte et limité en tentatives.
- Compte à rebours **en chiffres** (mono 46), jamais en anneau de progression : un anneau ne se lit pas de loin. Il compte les secondes qui restent avant la rotation suivante. Sous 10 s, le compteur passe en bloc inversé — le seuil de 60 s valait pour un code qui expirait, pas pour un code qui tourne.
- Le QR reste affiché en permanence : il porte l'identifiant du code et les chiffres du moment, et se régénère à chaque rotation.
- Il n'existe pas d'état « expiré » sur cet écran : un code périmé est remplacé par le suivant. Ce qui expire est le **droit de consommer**, et cela se dit sur l'écran de réservation, pas ici.
- À l'ouverture : luminosité forcée au maximum, veille désactivée (`expo-keep-awake`), thème système ignoré. Restauration à la sortie.
- Hors ligne, le code reste affiché et valide : la vérification se fait côté salon.
- Le rendu n'utilise ni marge négative ni décalage calculé : la barre de biffure est un enfant absolu d'un conteneur de la hauteur exacte de la ligne de chiffres.

## 3. Espagnol : libellés jusqu'à +30 %
- Aucun bouton n'est dimensionné sur son texte : `fullWidth` ou `flex: 1`. Deux lignes autorisées sur un libellé d'action, hauteur minimale 48, `textAlign: 'center'`.
- **Aucune troncature sur une action ni sur un statut.** L'ellipse est réservée aux noms propres (salon, créatrice) sur une seule ligne.
- Les mots de palier ne s'abrègent jamais : `HISTORIA` et `PUBLICACIÓN` passent sur deux lignes dans les listes denses plutôt qu'en initiale, taille plancher 10 px.
- Les rangées de chips sont en `flexWrap`, jamais en défilement horizontal : une option ne doit pas sortir de l'écran.
- Les chiffres, codes, heures et durées restent en `type.data` et ne se traduisent pas. Format d'heure sur 24 h dans les deux langues (cohérent avec la caisse) ; les dates suivent la locale.
- Les libellés d'état admin (`manuel`, `actif`, `épuisé`) sont des chaînes traduites, mais les identifiants techniques et les codes d'erreur restent en anglais brut.
- Textes de référence à tester en espagnol : « Confirmar reserva », « Mostrar código », « Solicitar un código nuevo », « Enviar mi comprobante », « Nueva presentación solicitada ».

## 4. Animations autorisées
- Propriétés animables : **`opacity` et `transform` uniquement**. Aucune animation de couleur, de hauteur, de largeur ni de layout.
- Durées : 120 ms (retour tactile), 200 ms (transition par défaut, apparition d'un panneau), 320 ms (transition d'écran). Easing `ease-out`.
- Squelettes : `Animated.loop` sur `opacity` 0,45 → 1, 1400 ms, décalage de 100 à 350 ms entre lignes. Pas de shimmer en dégradé animé (coûteux sur Android bas de gamme).
- Chargement d'un bouton : anneau de 15 px en rotation continue 800 ms. Jamais de voile plein écran pour une action de moins d'une seconde.
- Compte à rebours : mise à jour textuelle à la seconde, sans transition.
- Listes : pas de `LayoutAnimation`, pas d'entrée décalée. Une ligne qui change d'état change de style, sans mouvement.
- `useReducedMotion` respecté : les boucles d'opacité passent à un état fixe à 0,7.

## 5. Accessibilité
- AA partout : 4,5:1 pour tout texte sous 24 px ou sous 18,66 px gras. L'écran de code est à 21:1.
- `text.muted` clair vaut `#5A6463` (et non un gris plus clair) précisément pour tenir 4,5:1 sur `bg.surface`, `bg.canvas` et les vignettes `bg.onDark`.
- Zone tactile minimale 44 × 44, y compris sur les touches du pavé de caisse (56) et les chips de créneau.
- Aucune information portée par la couleur seule : les paliers ont mot + glyphe + matière, les états admin ont un libellé texte en plus de leur couleur.
- Ordre de lecture VoiceOver / TalkBack : titre d'écran, statut ou délai en cours, contenu, actions. Le code de retrait s'annonce caractère par caractère (`accessibilityLabel` avec espaces).

## 6. Délais, obstacles, décisions
- Un délai qui court s'affiche en **temps restant** (« 11 h restantes »), pas en date seule, et se suspend pendant un réessai technique d'envoi.
- Écart chiffré si valeur ≥ 60 % du seuil ; sinon horizon sans chiffre ni projection de délai. Jamais de projection de rythme (« environ trois ans » est interdit).
- Les obstacles proviennent d'un **catalogue fermé**, et ce sont les codes du serveur qui font foi — le client les consomme tels quels, sans table de correspondance : `not_enough_followers`, `not_enough_completed_collabs`, `reliability_score_too_low`, `no_metrics`, `metrics_stale`, `account_token_invalid`, `account_under_review`, `account_rejected`, `no_social_account`. Un code inconnu s'affiche en « détail indisponible », jamais en texte improvisé.
- `account_token_invalid` est formulée comme un fait technique (« Instagram limite la durée des autorisations à 60 jours »), jamais comme un manquement du créateur. Les réservations et preuves en cours restent honorables.
- `account_under_review` est un **état persistant** : c'est l'écran d'accueil du créateur à chaque ouverture tant que le contrôle dure, daté, avec un compteur de jours et un contact support. Ce n'est pas un spinner d'inscription.
- Preuves : **aucune validation automatique, ni par défaut ni par silence**. Un contrôle aboutit à conforme, ou à une demande de nouvelle soumission avec une nouvelle date limite. Trois tentatives déclenchent une revue humaine. Un délai dépassé sans nouvelle soumission enregistre la contrepartie en **non honorée**, sans badge ni marque permanente sur le profil.
- Côté commerce, deux actions seulement sur une preuve : approuver, ou redemander une soumission avec un motif obligatoire (liste fermée + note lue par la créatrice). **Il n'existe aucun rejet définitif côté commerce.**
- Sur une story, la capture est le chemin normal (le média expire en 24 h) ; la détection par mention passe en second. Sur un post ou un reel, l'ordre s'inverse.
- Le commerce définit sur chaque offre la **mention** et le **tag de localisation** attendus : ce sont les deux éléments contrôlés, rappelés au créateur avant réservation puis sur son écran de preuve.

## 7. Réseau et hors ligne
- Créateur : le fil s'affiche depuis le cache, marqué « vu il y a 2 h », sans bouton Réserver. Le code de retrait reste affiché et valide. L'envoi de preuve est mis en file locale, l'échéance est suspendue le temps du réessai.
- Commerce : fonctionnent hors ligne, en file d'attente ordonnée — validation d'un code, capacité, horaires. Exigent le réseau, bouton **retiré** — contrôle d'une preuve, ouverture d'une prestation au catalogue. Une modification en attente est marquée sur sa ligne, pas dans une bannière éphémère.
- Admin : chaque écran affiche sa fraîcheur de données et bloque les décisions plutôt que d'agir sur des données périmées.

## 8. Grand écran (build web)
- Créateur : contenu centré, largeur maximale 760 ; cartes en `flexWrap`, 2 puis 3 par ligne.
- Commerce : au-delà de 900 de large, liste de 400 + panneau détail en `flexDirection: 'row'`, jamais plus de deux colonnes. Barre de caisse fixée en haut.
- Admin : conçu pour 1360, tables à colonnes fixes, défilement virtuel, panneau détail de 400 à 470.
- Le seuil est mesuré sur la largeur du conteneur (`useWindowDimensions` / `onLayout`), pas via des media queries.
