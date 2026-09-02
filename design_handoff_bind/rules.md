# Règles qui ne se lisent pas sur une maquette

## 1. Une seule palette, et deux écrans hors système

*Section refaite le 2026-08-24, côté produit. Elle décrivait une bascule
clair/sombre retirée depuis, et nommait six jetons qui n'existent plus —
bg.raised, role.merchant, accent.default, badge.scrim,
media.placeholderStripe, elevation.1. Le retrait avait été écrit dans la
copie de travail de `tokens.json` et jamais propagé ici ; la note l'accompagne
désormais des deux côtés.*

La v1.1 ne livre **qu'une palette**, claire, pour les trois rôles. Il n'y a pas
de second thème, et pas de réglage pour en changer : `userOverride` désignait
une bascule vers quelque chose qui n'existait pas, et **un interrupteur qui ne
commande rien est pire que son absence** — il fait douter de ceux qui commandent
quelque chose. Il est retiré des jetons comme il l'a été de l'écran de réglages.

Ce qu'on prenait pour la moitié sombre est un **kit d'accommodation**, pas une
seconde palette : `ink.onDark`, `line.onDark`, `bg.onDark`, `scrim.badgeOnDark`
et les variantes `onDark` des paliers. Il sert les deux écrans déclarés hors
système, et eux seuls :

- **le code de retrait** — `#FFFFFF` sur `#000000`, plein écran, sans marque ;
- **la visionneuse** — `bg.onDark`, chrome minimal.

`bg.onDark` s'appelait bg.sunken jusqu'au 2026-08-24. Le nom disait un
renfoncement, la valeur est le fond le plus sombre de la palette, et huit
surfaces claires l'avaient employé comme un creux : elles rendaient du noir.

Ce qui ne change jamais : la typographie, l'échelle d'espacement, les rayons, la
densité par rôle, la structure des composants, les libellés.

## 2. L'écran de code de retrait ne suit aucun thème
- Toujours `#FFFFFF` sur `#000000` (`code.fg` / `code.bg`), 21:1. Aucun gris sur un élément porteur, aucune opacité, aucune ombre, aucun rayon sur le bloc de code.
- Code de **six chiffres**, dérivé côté serveur et **renouvelé tout seul toutes les 30 secondes**.
- *Corrigé le 2026-08-24 : les six chiffres ne s'affichent plus.* Ils ne se
  saisissent pas et ne désignent rien seuls — ils ne valent qu'avec
  l'identifiant que porte le QR — et c'est précisément leur forme qui les
  faisait confondre avec le code de secours, qui se dicte : un commerçant a
  essayé de les taper. Une légende sous les chiffres n'y suffisait pas. Ce qui
  reste à montrer est que le code est **vivant**, et le décompte le dit sans
  ressembler à une saisie. `type.code` (mono 76) reste déclaré pour le jour où
  un écran doit à nouveau montrer un code en grand.
- **Aucun bouton de renouvellement.** Le code tourne de lui-même : en proposer un donnerait à croire qu'il faut agir, et laisserait quelqu'un attendre devant un écran qui se met déjà à jour.
- Un **code de secours de six caractères** accompagne toujours les chiffres, sur l'alphabet sans O, 0, I ni 1, groupé trois par trois (`4H2 9KX`). Il se dicte au téléphone et se saisit au comptoir quand la caméra ne lit rien. Il ne tourne pas ; ce qui le protège est d'être lié à une réservation, à usage unique, à durée courte et limité en tentatives.
- Compte à rebours **en chiffres** (mono 46), jamais en anneau de progression : un anneau ne se lit pas de loin. Il compte les secondes qui restent avant la rotation suivante, **sous un libellé qui dit ce qui arrive à zéro** (« Nouveau code dans »). *Corrigé le 2026-09-01 : la règle décrivait un bloc inversé sous un tiers de la rotation, et son jeton — cité ici jusqu'à aujourd'hui — est retiré de la passation.* **Le compteur ne change jamais d'apparence, et il n'a pas d'état d'urgence.** À zéro il ne se passe rien : l'écran recharge seul, le QR devient un autre QR, le scan est identique. L'inversion mettait une alarme sur la seule chose de cet écran qui ne demande aucune action. Ce que le compteur prouve est que l'écran est **vivant** — pas une capture prise la semaine dernière — et le libellé lève l'ambiguïté avec le code de secours juste dessous, qui lui ne tourne pas.
- Le QR reste affiché en permanence : il porte l'identifiant du code et les chiffres du moment, et se régénère à chaque rotation.
- Il n'existe pas d'état « expiré » sur cet écran : un code périmé est remplacé par le suivant. Ce qui expire est le **droit de consommer**, et cela se dit sur l'écran de réservation, pas ici.
- À l'ouverture : luminosité forcée au maximum, veille désactivée (`expo-keep-awake`), thème système ignoré. Restauration à la sortie.
- Hors ligne, le code reste affiché et valide : la vérification se fait côté salon.
- Le rendu n'utilise ni marge négative ni décalage calculé : la barre de biffure est un enfant absolu d'un conteneur de la hauteur exacte de la ligne de chiffres.

## 3. Espagnol : libellés jusqu'à +30 %
- Aucun bouton **qui occupe une largeur** n'est dimensionné sur son texte :
  `fullWidth` ou `flex: 1`. Deux lignes autorisées sur un libellé d'action,
  hauteur minimale 48, `textAlign: 'center'`.
- *Exception nommée le 2026-08-24* : **la pilule d'action d'une carte se
  dimensionne sur son texte** (`fullWidth={false}` dans une rangée). Le bouton
  du système est déjà une pilule ; étiré sur toute la carte il cesse d'en être
  une. La règle du dessus reste entière pour les boutons de pied d'écran et de
  feuille, qui sont ceux que l'espagnol fait déborder.
- **Aucune troncature sur une action ni sur un statut.** L'ellipse est réservée aux noms propres (salon, créatrice) sur une seule ligne.
- Les mots de palier ne s'abrègent jamais : `HISTORIA` et `PUBLICACIÓN` passent sur deux lignes dans les listes denses plutôt qu'en initiale, taille plancher 10 px.
- Les rangées de chips **dont il faut voir l'ensemble** sont en `flexWrap` : une
  option qu'on ne peut pas comparer aux autres ne se choisit pas, et celle qui
  sort de l'écran n'existe pas pour qui ne défile pas.
- *Amendé le 2026-08-28 : le défilement horizontal est admis pour une ligne de
  **filtres non exclusifs**.* La règle visait les choix qui s'excluent — un
  palier, un format, une durée — où l'on décide en comparant. Six catégories
  qu'on parcourt ne sont pas dans ce cas : aucune n'écarte les autres, la
  première porte « tout », et la ligne se relit d'un geste. La question n'est
  donc pas la forme du défilement, c'est **si l'ensemble doit se voir d'un
  coup** ; là où oui, `flexWrap` reste la règle.
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
- `ink.mute` vaut `#796D5B` : 4,77:1 sur `bg.page` et 5,06:1 sur `bg.surface`.
  Il **ne passe pas** sur `bg.inset`, où il tombe à 4,36:1 — sur un fond creux,
  descendre à `ink.soft`. *Corrigé le 2026-08-24 : la règle nommait
  text.muted à `#5A6463` et bg.canvas, trois noms qui n'existent pas.*
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
- **La carte de décision ne porte aucun chiffre d'audience.** Un visage, un pseudonyme, un rendez-vous et une échéance — on décide d'un rendez-vous sur *qui* et *quand*, pas sur *combien*. Le nombre d'abonnés, le compte de collaborations et la ponctualité pèsent une décision et se lisent posément : ils restent sur la fiche du créateur, qu'un lien de la carte ouvre. *Tranché à la v9, reconfirmé le 2026-09-01 contre la v12, qui dessinait « 7 600 followers » sous le pseudonyme.* Le chiffre est absent du **contrat**, pas seulement de l'écran : `ReservationDuCommerce` porte vingt champs et aucun compteur d'audience — `creator_id`, `creator_handle`, `creator_profil_url`, `creator_avatar_key`, c'est-à-dire *qui*. Le redessiner coûte donc une route et un agrégat **avant la première ligne d'écran**. Le chemin qui existe déjà est la pilule « Profile » de la carte, qui ouvre la fiche où ces chiffres vivent.
- Le commerce définit sur chaque offre la **mention** et le **tag de localisation** attendus : ce sont les deux éléments contrôlés, rappelés au créateur avant réservation puis sur son écran de preuve.

## 7. Réseau et hors ligne
- Créateur : le fil s'affiche depuis le cache, marqué « vu il y a 2 h », sans bouton Réserver. Le code de retrait reste affiché et valide. L'envoi de preuve est mis en file locale, l'échéance est suspendue le temps du réessai.
- Commerce : fonctionnent hors ligne, en file d'attente ordonnée — validation d'un code, capacité, horaires. Exigent le réseau, bouton **retiré** — contrôle d'une preuve, ouverture d'une prestation au catalogue. Une modification en attente est marquée sur sa ligne, pas dans une bannière éphémère.
- Admin : chaque écran affiche sa fraîcheur de données et bloque les décisions plutôt que d'agir sur des données périmées.

## 8. Grand écran (build web)
- Créateur : contenu centré, largeur maximale **1120** (`contentMaxCreator`) ;
  cartes en `flexWrap`, 2 puis 3 par ligne. *Corrigé le 2026-08-24 : la règle
  disait 760 quand `tokens.json` déclare 1120 depuis la v1.1 — deux documents
  de la même passation se contredisaient, et c'est le jeton qui fait foi
  puisque c'est lui que le produit lit.*
- Commerce : au-delà de 900 de large, liste de 400 + panneau détail en `flexDirection: 'row'`, jamais plus de deux colonnes. Barre de caisse fixée en haut.
- Admin : conçu pour 1360, tables à colonnes fixes, défilement virtuel, panneau détail de 400 à 470.
- Le seuil est mesuré sur la largeur du conteneur (`useWindowDimensions` / `onLayout`), pas via des media queries.
