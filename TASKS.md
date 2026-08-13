# TASKS

Liste de travail. Une tâche par session Claude Code. Cocher à la fin, jamais avant.
Source de vérité fonctionnelle : `SPEC.md`. Décisions prises en route : `DECISIONS.md`.

Convention : une tâche est terminée quand son critère de fin est vérifié, pas quand le code compile.

---

## Phase 0 — Prérequis

Rien ici ne bloque le développement. Tout se simule en local. Seul le premier point est un délai administratif long qui conditionne la mise en production.

- [ ] Confirmer l'entité légale américaine et lancer la vérification d'entreprise Meta
      *Fin : vérification soumise. Seul point réellement urgent*
- [ ] Créer l'app développeur Meta en mode développement, ajouter les comptes de test
      *Fin : connexion Instagram fonctionnelle en local sur un compte ayant un rôle sur l'app. Pas de revue à ce stade, elle exige une démonstration de l'intégration terminée*
- [ ] Créer l'app développeur TikTok en bac à sable
      *Fin : connexion fonctionnelle sur un utilisateur déclaré*
- [ ] Déposer la candidature partenaire Snapchat
      *Fin : demande soumise. Le produit se livre sans Snapchat si l'accès tarde*
- [ ] Réserver le nom de domaine, préparer les pages politique de confidentialité et conditions
      *Fin : pages en ligne. Nécessaire avant les revues, pas avant le code*
- [ ] Ouvrir Stripe en mode test, le stockage objet et le Postgres hébergé
      *Fin : `.env.example` documenté*
- [ ] Poser un premier jeu de seuils de paliers provisoire en configuration
      *Fin : valeurs modifiables sans redéploiement, à faire valider par Rebecca plus tard*
- [ ] Ouvrir le compte Geocodio et poser la clé
      *Le fournisseur est choisi et **le code est écrit** — voir `DECISIONS.md`
      du 2026-08-06 et `app/integrations/geocoding.py`. Ne reste que
      l'administratif, qui n'est pas du code : créer le compte, copier la clé
      dans `GEOCODING_API_KEY`, et passer `GEOCODING_PROVIDER=geocodio`.
      Coût : 2 500 requêtes par jour gratuites, puis 1 $ les mille — sans
      abonnement, et sans carte tant qu'on reste sous le quota. BIND ne résout
      qu'à la création ou à la modification d'un commerce, et pas du tout quand
      les coordonnées sont déclarées : le quota gratuit couvre le lancement
      sans marge à surveiller.*
- [ ] Comptes Apple et Google au nom de l'entité
      *Fin : à faire avant la distribution seulement, un build de développement Expo n'en a pas besoin*

---

## Phase 1 — Socle

- [x] Initialiser le dépôt : `api/` FastAPI, `app/` Expo, `SPEC.md`, `TASKS.md`, `DECISIONS.md`, `CLAUDE.md`
      *Fin : les deux projets démarrent en local avec une commande documentée*
- [x] Modèle de données complet et migrations
      *Fin : toutes les tables de la spec créées, migration réversible*
- [x] Authentification et rôles créateur, membre commerce, admin
      *Fin : un utilisateur de chaque rôle peut se connecter, les routes protégées répondent 403 au mauvais rôle*
- [x] Journal d'audit des transitions d'état
      *Fin : toute transition écrit une ligne immuable*
- [x] Internationalisation anglais et espagnol côté API (messages) et app (interface)
      *Fin : basculer la locale change l'intégralité des libellés*
- [x] Procédure d'anonymisation de compte
      *Fin : un compte anonymisé perd email, téléphone, nom, prénom et empreinte, ses jetons sont révoqués, ses snapshots supprimés, son statut passe à `anonymized`, et toutes ses lignes de journal, réservations et contreparties restent intactes et rattachées*

---

## Phase 2 — Commerce

- [x] Profil commerce : création, catégorie, adresse, géolocalisation, fuseau
      *Fin : un commerce peut être créé et relu avec ses coordonnées géographiques*
- [x] Catalogue en saisie manuelle, items et variantes, réservable ou non
      *Fin : contrainte en base imposant une durée dès que l'item est réservable, une variante est réservable et pas son parent*
- [x] Règles de capacité et disponibilité temps réel
      *Fin : horaires hebdomadaires et fermetures ponctuelles paramétrables, plusieurs plages par jour sans chevauchement ; le commerce active et désactive un item ou un parent, la lecture de son catalogue reflète l'état effectif, et la transition est journalisée*
- [x] Jeu de données de départ : trois commerces fictifs avec catalogue, capacités et créneaux
      *Fin : une commande recrée l'environnement de test à zéro*

---

## Phase 3 — Moteur de paliers

- [x] Table de configuration des paliers et interface admin
      *Fin : créer et modifier un palier sans toucher au code*
- [x] Composition des offres par palier côté commerce
      *Fin : un item peut être placé à plusieurs paliers*
- [ ] Journal des modifications de configuration
      *Fin : toute modification d'un palier ou d'un plan d'abonnement laisse une trace nommant le champ, l'ancienne et la nouvelle valeur, et l'administrateur. Le journal actuel ne sait décrire qu'une bascule d'état — `from_status` vers `to_status` — il faudra une autre forme d'enregistrement. À faire quand un deuxième besoin du même type apparaîtra*
- [x] Fonction d'éligibilité
      *Fin : tests unitaires couvrant score nul (neutre), score bas (plafonné), volume insuffisant, mauvaise plateforme*

---

## Phase 4 — Créateur

- [x] Connexion OAuth Instagram et stockage chiffré des jetons
      *Fin : un compte réel se connecte, les jetons sont illisibles en base*
- [x] Récupération et historisation des métriques
      *Fin : un snapshot est créé, l'éligibilité lit le dernier snapshot sans appel réseau*
- [x] Renouvellement des jetons en tâche de fond
      *Fin : un jeton proche de l'expiration est renouvelé automatiquement*
- [x] Vérification de cohérence du profil à la connexion d'un compte social
      *Fin : un compte trop récent ou incohérent passe en revue et ne peut pas réserver*
- [x] Profil créateur en écriture
      *Prérequis de la vérification de cohérence : sans nom renseigné, le signal du nom déclaré reste neutre*
      *Fin : un créateur renseigne et modifie son prénom, son nom et sa ville, la ville n'est pas dérivée de `geo`, et les champs sont bien ceux que la procédure d'anonymisation efface*
- [x] Écran des paliers accessibles et badge nouveau créateur
      *Fin : un créateur sans historique voit le badge et ses paliers selon son volume seul*

---

## Phase 5 — Découverte et réservation

- [x] Calcul de disponibilité à la volée
      *Fin : tests couvrant chevauchement, postes multiples, exception de fermeture*
- [x] Fil géolocalisé, seuls les items réellement réservables apparaissent
      *Fin : un item indisponible ou sans créneau n'apparaît jamais, et un item désactivé — directement ou par son parent — n'apparaît jamais dans le fil*
- [x] Création de réservation avec verrou et garde de dix minutes
      *Y compris : prénom et nom obligatoires avant la première réservation. Ils sont facultatifs à l'inscription, et rien ne les exige aujourd'hui — il n'existe aucun chemin de réservation où poser la condition*
      *Fin : test de concurrence, deux réservations simultanées sur la dernière place, une seule passe*
- [x] Machine à états de la réservation, annulation, absence, expiration
      *Fin : toutes les transitions de la spec testées, aucune transition illégale possible*
- [x] Implémentation réelle du géocodage d'adresse
      *Fin : une adresse saisie librement produit des coordonnées, et l'échec de résolution laisse le commerce en `onboarding` sans bloquer son inscription*
- [x] Résolveur d'appartenance pour les ressources sans `business_id` dans l'URL
      *Fin : un test par type de ressource — réservation, contrepartie, preuve, code de retrait — vérifiant qu'un membre du commerce A reçoit 403 sur une ressource du commerce B. `require_business_member` ne sait aujourd'hui lire l'identifiant que dans le chemin ; c'est le point de fuite entre commerces le plus probable du projet*

---

## Phase 6 — Caisse

- [x] Génération du code tournant et de la saisie de secours
      *Fin : le code change toutes les trente secondes, l'ancien reste accepté une fenêtre*
- [x] Vérification et consommation côté commerce
      *Fin : un code déjà consommé est refusé, la réservation passe en consommée et crée la contrepartie*
- [x] Scanner caméra et saisie manuelle dans l'app commerce
      *Construit et éprouvé en simulé. Le critère « sur un appareil réel » reste **non vérifié** : ni test ni simulateur ne fournissent de caméra*
      *Fin : les deux chemins fonctionnent sur un appareil réel*

---

## Phase 7 — Contrepartie

- [x] Création de la contrepartie avec critères et échéance
      *Fin : les critères affichés au créateur sont ceux figés à la candidature*
- [x] Soumission de preuve, archivage du média, empreinte et horodatage serveur
      *Fin : le contenu reste consultable après suppression de la publication d'origine*
- [x] Boucle automatique de relance et de nouvelle soumission
      *Fin : trois tentatives lèvent le drapeau de revue humaine, aucune escalade avant*
- [x] Emails transactionnels : confirmation, rappel de deadline, relance
      *Fin : envoyés depuis un domaine vérifié, en anglais et en espagnol*
- [x] Passage automatique en non honoré à l'échéance
      *Fin : job de fond testé sur une échéance dépassée*

---

## Phase 8 — Fiabilité

- [x] Événements de fiabilité générés par les transitions
      *Fin : absence, retard, non conformité produisent chacun leur événement*
- [x] Calcul du score et mise en cache
      *Fin : changer une pondération recalcule tout l'historique sans migration*
- [x] Rétablir les seuils de collaborations sur les paliers de référence
      *Fin : `completed_collabs_count` est alimenté par les événements de fiabilité, et les seuils des paliers de référence sont remis aux valeurs voulues. Ils ont été mis à zéro en phase 3 parce que le compteur n'était alimenté par rien, ce qui rendait les paliers `post` et `reel` inatteignables*
- [x] Effet du score sur les paliers accessibles
      *Fin : un score dégradé plafonne effectivement le créateur*

---

## Phase 9 — Import de carte

- [x] Téléversement et extraction structurée
      *Fin : un PDF de salon en anglais et un en espagnol produisent une charge exploitable*
- [x] Écran de relecture et correction, saisie des durées
      *Fin : aucun item n'est créé sans validation explicite du commerce*

---

## Intégration — brancher l'interface sur l'API réelle

- [x] Bloc 1 · Thème et jetons
      *Fin : `tokens.json` est copié tel quel de la passation et un test compare les deux fichiers ; aucun littéral de couleur hors de `app/src/theme/` ; le thème suit le rôle et se laisse forcer ; l'écran de code exporte ses deux couleurs à part*
- [x] Corrections de la passation
      *Fin : code de retrait à six chiffres tournants sans bouton de renouvellement, codes d'obstacle du serveur consommés tels quels, écran admin des paliers réduit à la modification, badge de vague retiré. `tokens.json` en v0.3.0*
- [x] Routes manquantes, avant les écrans
      *Fin : les dix manques listés sont comblés et testés — fiche publique d'un commerce, historique créateur, journée commerce, contreparties du commerce et file d'arbitrage, plans d'abonnement, étapes d'activation, audience du créateur, dates sur les obstacles, statut de vérification*
- [x] Bloc 2 · Bibliothèque de composants
      *Fin : les 17 familles écrites et éprouvées isolément, avant tout écran. 44 tests portant sur les règles qui ne se voient pas sur une maquette — bouton jamais dimensionné sur son texte, trois marqueurs du badge de palier, action impossible retirée et non grisée, créneau pris visible mais non pressable, gouttière des colonnes numériques. Le badge de vague n'existe nulle part*
- [x] Bloc 3 · Client d'API typé
      *Fin : aucun chemin écrit dans un écran, un test compare chaque route appelée au contrat réel du serveur, et la CI refuse un contrat périmé. Un code d'erreur inconnu donne le message générique, jamais le code brut. Une seule rotation de jeton vit à la fois*
- [x] Bloc 4 · Écrans créateur
      *Fin : audience et vérification, paliers, fil, fiche commerce, créneaux, code de retrait, preuve, historique. Les quatre états sont vérifiés mécaniquement sur chaque écran, l'écart chiffré n'apparaît qu'à 60 % du seuil, et l'écran des paliers sort de la dette*
- [x] Bloc 5 · Écrans commerce
      *Fin : journée du comptoir, publications reçues avec motif obligatoire, activation avec ses six étapes séparées en bloquantes et visibilité. Aucun montant, aucun rejet définitif, aucun pourcentage*
- [x] Bloc 6 · Back office
      *Fin : file d'arbitrage avec les trois issues — la clôture n'apparaît que là — et lecture des plans d'abonnement, seul écran du produit à afficher des montants*

---

## Mode démonstration

- [x] Fournisseurs de démonstration derrière les interfaces existantes
      *Fin : aucune branche conditionnelle sur le mode dans un service, vérifié par un test qui parcourt les sources. Le fournisseur social emprunte le vrai parcours OAuth et sait produire les états dégradés — jeton expiré, plateforme qui refuse*
- [x] Jeu de données riche
      *Fin : cinq créateurs à cinq états, quatre commerces dont un qui n'a rien composé, réservations et contreparties dans chaque état, un job épuisé, des plans d'abonnement, des dates relatives à aujourd'hui. Chaque état est obtenu par le service qui le produit ; les rares exceptions sont nommées et portent leur raison*
- [x] Photos
      *Fin : générées, sans réseau ni licence, dérivées du nom de façon stable. Servies par `GET /media/{cle}`, restreinte aux préfixes de photos — jamais aux preuves*
- [x] Vraies photos, en remplacement des dégradés
      *Fin : le semis lit `assets/photos/`, réduit chaque image au dépôt et retombe sur un dégradé pour tout fichier absent, qu'il nomme. Les fichiers ne sont pas versionnés ; l'intégration continue tourne donc entièrement sur le repli. Le préfixe `photos/genere/` distingue un dégradé d'une vraie photo dans toute réponse d'API. Les six pastilles de catégorie et le média d'accueil, qui n'appartiennent à aucun commerce, vivent dans `platform_asset` et se lisent par `GET /platform-media`*

---

## Phase 10 — Reste

- [x] Reporting commerce
      *Fin : réservations, consommations, absences, publications par palier et par prestation, valeur offerte, portée approximative. Le taux d'honoration est nul et non zéro quand rien n'a été servi*
- [x] Abonnement Stripe, mode test
      *Fin : derrière une interface, `log` pour la démonstration et `stripe` pour le vrai. Le prix vient de `subscription_plan`, jamais du tableau de bord du fournisseur. Un statut inconnu ne fait pas participer*
- [x] Capture de preuve niveau 2
      *Fin : schémas limités, refus des adresses internes **et des redirections vers elles**, taille vérifiée pendant la lecture et non sur l'annonce, types en liste fermée, délai maximal. Toutes les limites en configuration*
- [x] Intégration TikTok, en bac à sable
      *Fin : le fournisseur est écrit et branché derrière la fabrique. Les appels sont les vrais ; seuls les comptes inscrits comme testeurs répondent tant que l'application n'est pas revue. Non vérifié faute d'identifiants*
- [x] Dépôt objet, local
      *Fin : une preuve archivée reste consultable après redémarrage, et la clé ne dépend d'aucun fournisseur. L'implémentation S3 refuse de démarrer plutôt que de retomber en silence sur le disque*
- [x] Snapchat : vérifier que son absence ne casse rien
      *Fin : la plateforme existe en base et dans les paliers, aucune implémentation ne lui répond, et la fabrique lève au lieu de rendre un fournisseur muet*
- [x] Coquille applicative et navigation
      *Fin : routeur par rôle, inscription et connexion sur l'API réelle, session dans le trousseau de l'appareil avec rafraîchissement automatique, thème appliqué au niveau de la coquille, sélecteur de langue en réglages, frontière d'erreur qui ne montre jamais de trace. Une session expirée ou un compte suspendu ramène à la connexion avec un message*
- [x] Rétrograder l'app en Expo SDK 54
      *Fin : Expo Go de l'App Store ouvre le QR code. Aucune ligne de code applicatif n'a changé — seules les versions, alignées par `expo install --fix` plutôt que devinées*
- [x] Défauts du premier passage sur iPhone
      *Fin : zone sûre au niveau de la coquille, icônes d'onglets, photos réellement demandées, choix de créneau par jour avec bouton fixé, code de retrait appelé une fois par rotation et arrêté hors écran, réservation qui ouvre son code, plateforme affichée sur les paliers, rayon à 15 km réglable*
- [x] Écrans de composition du commerce
      *Fin : catalogue groupé par palier, horaires et capacité en sept lignes toujours — un jour sans règle s'écrit « fermé », parce qu'une ligne absente ne dit pas si le commerce a fermé ou n'a rien rempli. Ouvrir et fermer passent par la route de transition, qui laisse une trace. Une lecture des paliers côté commerce est venue avec : la seule route était réservée à l'administration*
- [x] Écran des paliers créateur, v0.7 · une échelle et non un historique
      *Fin : la plateforme passe en onglets et l'échelle compte trois barreaux, triés par format croissant ; chaque barreau dit ce qu'on donne et ce qu'on obtient, au conditionnel s'il est fermé ; la progression est portée par la matière du bandeau — contour, teinte, aplat — et se lit en niveaux de gris ; l'écart n'est chiffré et jauge qu'à 60 % du seuil, obstacle par obstacle ; une cause commune passe devant et est retirée des barreaux, où le palier acquis dit « en pause, pas perdu » ; les règles existent enfin, colonne de droite en bureau et écran empilé en compact, le score de fiabilité en tête. Douze mutations vérifiées.*
- [x] Galerie photos d'un commerce
      *Fin : service, routes et fiche publique livrés en #88 ; l'écran suit avec deux flèches par ligne — le glisser-déposer n'existe pas en React Native sans bibliothèque, et deux flèches sont accessibles au lecteur d'écran, ce qu'un glisser n'est jamais. Chaque déplacement envoie l'ordre complet, que le serveur exige. « Définir comme couverture » passe par la route du commerce : la couverture est son champ, et une seconde route ferait deux vérités. Le branchement de l'écran dans la section catalogue reste à faire, avec le téléversement*
- [x] Sélection du média de preuve
      *Livré avec la soumission de preuve et resté non coché. Vérifié : galerie et
      appareil photo, aperçu avant envoi, refus de permission dit comme un choix
      avec la seule issue qui existe — les réglages — et poids mesuré avant de
      partir plutôt qu'après vingt mégaoctets sur le réseau d'un salon. Sept tests*
- [x] Lien traqué par contrepartie, et audience réellement mesurée
      *Réponse au problème posé : TikTok ne rend pas la composition géographique
      d'une audience, et un créateur de Miami peut toucher l'Inde. On cesse de
      prédire. Fin : un identifiant court par contrepartie, une redirection
      publique, des clics horodatés côté serveur avec pays, région, ville,
      famille de terminal et hôte du référent. **L'adresse IP n'est jamais
      stockée** — vérifié sur le schéma entier — et son empreinte de
      déduplication disparaît avec son sel, ce qui rend l'oubli définitif.
      Robots et préchargements écartés en gardant la trace du rejet. Agrégats
      au salon, au créateur, à l'administration ; les signaux de fabrication à
      la seule administration. Score d'impact local à poids nul en
      configuration. 38 tests, 5 mutations éprouvées*
- [x] Notifications push, derrière une interface
      *Sept événements sortent de l'application : réservation acceptée, refusée,
      annulée par le salon, rappel d'échéance, publication approuvée, nouvelle
      soumission demandée, et — seule à remonter vers le commerce — demande à
      valider. Préférence par genre et par personne, l'absence valant « oui ».
      **Jamais pour un compte suspendu ou anonymisé**, garanti par le service et
      par la révocation à l'anonymisation. Un jeton de terminal se révoque comme
      un jeton social, au moment où le fournisseur le déclare mort.*
      *Fin : **non vérifié de bout en bout**, même statut que le scanner caméra.
      Expo exige un identifiant de projet EAS et un build de développement —
      Expo Go ne reçoit plus de notifications distantes depuis le SDK 53.
      `PUSH_PROVIDER=log` est en service et trace ce qu'il aurait envoyé ; tout
      ce qui est en amont du dernier saut est éprouvé (21 tests, 5 mutations).
      Le jour où le compte existe : `PUSH_PROVIDER=expo`, un `projectId` EAS
      dans `app.json`, un build de développement, et l'app doit appeler
      `PUT /me/devices` au démarrage avec le jeton rendu par
      `expo-notifications`.*
- [x] Écrans des notifications côté app
      *Fin : l'autorisation se demande une fois connecté et jamais avant — sur
      le premier écran elle se refuse, et un refus ne se redemande plus. On ne
      la redemande qu'où la fenêtre s'ouvrira encore. Le jeton se réaffirme à
      chaque démarrage, la route étant idempotente. Les sept préférences se
      règlent dans les réglages, une bascule à la fois, et chaque rôle ne voit
      que les genres qui le concernent. **Toujours non vérifié de bout en
      bout** : Expo ne délivre de jeton distant que sur un build de
      développement*
- [x] Le cas inverse de l'absence : signaler un déplacement pour rien
      *Un créateur qui ne vient pas est pénalisé ; un salon fermé ne l'était
      pas, et la réservation restait `confirmed` — si bien que le commerce
      pouvait encore marquer absent quelqu'un qu'il n'avait pas reçu. Fin :
      fenêtre courte après l'heure du créneau, sur l'heure serveur ; la
      réservation part en `cancelled`, jamais en `no_show`, et **signaler
      n'écrit aucun événement de fiabilité sur celui qui signale** ; le
      signalement est une allégation qui ne compte contre le salon qu'une fois
      arbitrée ; l'arbitre voit combien de signalements de ce créateur ont déjà
      été écartés et combien de ce salon ont été retenus. 18 tests, 4 mutations*
- [x] Capture de preuve niveau 1
      *Fin : `fetch_media` sur l'interface, le fournisseur de démonstration et Instagram ; trois colonnes sur `proof` — identifiant du média, auteur, type dans le vocabulaire de la plateforme — et un index unique partiel, parce qu'une publication ne règle qu'une contrepartie ; la règle des quatre conditions isolée dans `verification`, pure et éprouvée sur les cas qui comptent ; la vérification tentée **à la soumission**, jamais par balayage. Le relevé des publications n'a pas fait une tranche à part : le déclencheur étant la soumission, il se réduisait à `fetch_media`. Quinze mutations vérifiées*
- [x] Tests de bout en bout dans un vrai navigateur
      *Le trou structurel : trois défauts n'ont été trouvés que par
      l'observation — la vidéo qui ne jouait pas, les polices jamais chargées,
      la barre latérale jamais montée. Fin : Playwright sur le build web réel,
      servi en statique, parlant à une vraie API sur une vraie base, dans un
      job d'intégration continue à part. Dix tests couvrant la navigation aux
      trois largeurs et à la bascule, la déclaration et le chargement réel des
      fontes, la lecture effective de la vidéo, et le parcours complet du fil
      jusqu'au code de retrait. Les trois défauts historiques ont été rejoués
      en mutation : les trois sont attrapés.*
- [ ] **Les polices ne s'appliquent à aucun texte sur le web**
      *Trouvé par les tests de bout en bout, à leur première exécution. Les
      trois `@font-face` sont déclarées sous les noms que le thème demande, les
      fichiers sont servis, une face atteint `loaded` — et pourtant **aucun
      élément du document n'a une `font-family` de nos familles** : tout le
      texte rend dans la pile système de React Native Web. Reproduction :
      ouvrir le build web, `[...document.querySelectorAll('*')]` filtré sur
      `getComputedStyle(n).fontFamily` contenant « Familjen » ou « IBM Plex »
      rend une liste vide. Aucune règle CSS n'applique ces familles, seulement
      les `@font-face`. La cause n'est pas établie : `Texte` pose bien
      `fontFamily: nomDeFonte(...)`, qui rend « Familjen Grotesk 600 ». À
      instruire — c'est cent pour cent des écrans web.*
- [x] Dépôt objet réel, compatible S3
      *Fin : deux compartiments Supabase, `make demo-seed` y range photos et preuves. La sonde de déploiement écrit et relit dans chacun, et éprouve le gabarit — pas seulement la joignabilité : un témoin de vingt octets passe sur un compartiment dont la limite de taille est inférieure à ce qu'on y dépose. Un refus porte le statut HTTP, le compartiment et la clé, parce que « ClientError » sans rien d'autre a coûté deux diagnostics*
- [x] Inscription d'un salon sur le terrain · la fiche préparée et sa prise en main
      *La fondatrice démarche en physique ; l'inscription autonome demande une
      demi-heure au comptoir et personne ne la fait pendant qu'un client
      attend. Ligne de partage retenue : **elle saisit des faits, jamais des
      engagements**. Fin : un statut `draft` — une fiche sans aucun membre,
      invisible du fil et de la fiche publique, et qui refuse de s'ouvrir ; un
      jeton de prise en main à usage unique, borné, révocable, dont seule
      l'empreinte est stockée et dont un seul est vivant par fiche ; deux
      chemins de remise, le QR pour le décideur présent et le courriel pour le
      propriétaire absent — c'est ce second cas qui perdait la visite ; la
      prise en main crée le compte, rattache le propriétaire, sort la fiche de
      `draft` et **écrit au journal d'audit la version des conditions
      acceptée**, avec qui et quand ; un compte existant peut assumer une
      seconde fiche, parce qu'un propriétaire de deux adresses n'a pas à
      s'inventer une seconde adresse électronique ; une liste de suivi qui
      garde les fiches assumées, sans quoi on ne saurait jamais combien de
      visites ont abouti. Un refus ne distingue jamais inconnu, expiré,
      consommé ou révoqué. 23 tests, 12 mutations vérifiées*
- [x] Période de grâce : ouvrir sans carte bancaire
      *Arbitrage retenu : aucun paiement à l'activation. Fin : `grace_ends_at`
      posé à l'ouverture — durée en configuration, aucun délai en dur — un
      avertissement unique avant l'échéance, et à l'échéance un retrait du fil
      qui est **exactement la mise en pause** : rien n'est effacé, et **les
      réservations déjà prises sont honorées jusqu'au code de retrait**,
      vérifié en consommant celle d'un salon sorti du fil. `suspended_reason`
      distingue le salon sorti pour non-paiement — que souscrire ramène en
      ligne — du salon parti en travaux, que rien ne rouvre à sa place. Un
      balayage horaire ouvre, avertit et ferme, et rattrape les commerces sans
      échéance ni abonnement. Deux genres de notification de plus, avec leurs
      préférences. 20 tests, 16 mutations vérifiées*
- [ ] **Les six genres de notification plus anciens ignorent la préférence sur
      le chemin du courriel**
      *Trouvé en écrivant le septième. `push.destinataire` vérifie le statut du
      compte et la préférence ; `notifications.envoyer_pour` et
      `envoyer_pour_la_reservation` ne vérifient ni l'un ni l'autre. Couper une
      notification sur l'écran la coupe donc sur le téléphone et la laisse
      arriver dans la boîte — l'utilisateur croit avoir coupé, et il n'a coupé
      qu'à moitié. `envoyer_au_commerce` fait le contrôle ; les deux autres
      restent à aligner, et un test doit tomber si l'un d'eux le perd*
- [ ] **Aucun garde-fou sur la surface des routes publiques**
      *Rien n'inventorie les routes servies sans authentification ni rôle. Les
      trois routes de prise en main sont volontairement publiques — le salon
      n'a pas encore de compte — mais rien n'empêche qu'une quatrième le
      devienne par accident, en oubliant une dépendance. Un test qui énumère
      les routes et les compare à une liste explicite fermerait la question.
      Écrit et abandonné une fois : `app.routes` ne rend plus des `APIRoute`
      mais des `_IncludedRouter` qu'il faut parcourir, ce qui demande un peu
      plus que dix lignes*
- [x] Reprise d'un compte commerce, plutôt qu'un accès permanent
      *Arbitrage retenu : aucun accès permanent après l'activation. Fin : une
      reprise explicite — motif écrit à la main, obligatoire — bornée par une
      durée en configuration, nominative, écrite au journal d'audit avec son
      motif en note libre, et **visible du salon** : il est prévenu à
      l'ouverture et lit la liste des reprises passées, dans la même forme que
      l'administration. La dérogation vaut sur les deux résolveurs
      d'appartenance, et l'appartenance rendue n'est jamais écrite en base.
      Hors reprise, un administrateur reçoit le même refus que n'importe qui.
      La phrase « aucune dérogation pour les administrateurs » du socle devient
      « aucune dérogation implicite » — c'est dans `DECISIONS.md`. 18 tests,
      13 mutations vérifiées*
- [ ] Intégration Snapchat, à l'obtention de l'accès partenaire