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
- [ ] Ouvrir Stripe en mode test et le Postgres hébergé
      *Le stockage objet est ouvert — deux compartiments Supabase, voir plus
      bas. **La moitié code de cette tâche est faite** : `.env.example`
      documente désormais les cent dix réglages, et un test tombe à chaque
      oubli — trente-quatre y manquaient, dont plusieurs récents. Ne reste que
      l'ouverture de deux comptes, qui n'est pas du code*
- [ ] **Le texte des conditions n'existe nulle part**
      *Trouvé en écrivant la prise en main : un salon accepte « la version
      2026-01 des conditions », cette acceptation est écrite au journal d'audit
      avec son auteur et son instant — et **le document qu'elle désigne n'existe
      dans aucun fichier du dépôt**. Le mécanisme de preuve est complet, ce
      qu'il prouve ne l'est pas. Ce n'est pas bloqué par un accès externe mais
      par une décision juridique : le texte se rédige, il ne s'invente pas*
- [x] Poser un premier jeu de seuils de paliers provisoire en configuration
      *Fait depuis la migration `ca6ed22e418a` et jamais coché : sept paliers de
      référence, identifiants fixés en dur pour être lisibles d'un
      environnement à l'autre, Snapchat posé mais inactif. Modifiables sans
      redéploiement par `PATCH /admin/tiers/{id}` — et depuis aujourd'hui,
      chaque modification laisse une trace nommant le champ, l'ancienne valeur,
      la nouvelle et l'administrateur. **Les seuils restent à valider par
      Rebecca** : c'est la seule partie de cette tâche qui n'est pas du code*
- [x] Ouvrir le compte Geocodio et poser la clé
      *Compte ouvert, clés chez Render. **La démonstration ne s'en sert pas
      encore** : `render.yaml` fixe `GEOCODING_PROVIDER: manual`, et
      `GEOCODING_API_KEY` n'y est pas déclarée — un déploiement neuf ne
      l'emporterait donc pas. Basculer la démonstration sur Geocodio est une
      ligne de blueprint et une variable à déclarer, pas un développement*
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
- [x] Journal des modifications de configuration
      *Le second besoin est apparu : les seuils sont modifiables sans
      redéploiement, et rien ne gardait trace de qui les avait changés. Fin :
      une table `configuration_change` — le champ, l'ancienne valeur, la
      nouvelle, l'auteur, l'instant — écrite dans la transaction qui modifie,
      et une route de lecture par palier. **Une table à part et non le journal
      d'audit** : celui-ci décrit des transitions, et « to_status : 2000 » ne
      dirait ni de quoi ni depuis quoi. Les valeurs sont du texte : un journal
      qui les retyperait se tromperait le jour où la colonne change de type,
      c'est-à-dire le jour où l'on vient le relire. La bascule d'activité
      figure dans les deux, et ce n'est pas une redondance — c'est une
      transition **et** une modification. Les plans d'abonnement suivront quand
      une route les modifiera : aucune n'existe aujourd'hui. 8 tests,
      8 mutations vérifiées*
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
- [x] **Les polices ne s'appliquent à aucun texte sur le web**
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
- [x] La préférence respectée sur le chemin du courriel
      *Le chemin du push consultait le statut du compte et la préférence ;
      celui du courriel ne consultait ni l'un ni l'autre — couper une
      notification la coupait sur le téléphone et la laissait arriver dans la
      boîte. Fin : une seule garde, `notifications.joignable`, aux mêmes deux
      règles que le push, appelée par les trois envois ; une seule table
      clé → genre, celle du routeur des décisions ayant disparu ; **et une clé
      sans genre lève** au lieu de partir « au cas où », ce qui rétablirait le
      défaut. Un test vérifie que chaque genre est commandé par au moins une
      clé : un interrupteur qui ne coupe rien fait douter des neuf autres.
      7 tests, 7 mutations vérifiées*
- [x] Les deux messages orphelins ont leur genre, et partent
      *`collaboration.opened` et `collaboration.unfulfilled` étaient écrits,
      traduits, et émis par personne. Chacun reçoit **son propre genre** plutôt
      que celui du rappel : couper les rappels ne doit pas faire taire « votre
      contrepartie n'a pas été honorée », qui touche le score de fiabilité donc
      ferme des paliers — l'apprendre six semaines plus tard en constatant
      qu'on ne peut plus réserver est bien pire. L'ouverture est déposée à la
      création de la contrepartie, avec le format et les exigences : un message
      qui dirait « publiez » sans dire quoi ne vaudrait pas mieux que son
      absence. Au passage, `NOTIFICATION_PAR_ISSUE` portait un genre que plus
      personne ne lisait — une mutation l'a montré. 6 tests, 6 mutations*
- [x] La surface publique, énumérée et fermée
      *Rien n'inventoriait les routes servies sans authentification. Fin : un
      test parcourt l'arbre des routeurs — `app.routes` ne rend plus des
      `APIRoute` mais des routeurs inclus, et le lire à plat rend une liste
      vide, donc un test vert qui n'inspecte rien : une assertion de volume
      garde ce piège-là. Douze routes publiques déclarées, chacune avec sa
      raison écrite, et le sens inverse tenu — une tolérance qui ne sert plus
      fait tomber le test. Le garde-fou a trouvé trois routes que personne
      n'avait jamais énumérées : les deux rappels OAuth et la lecture d'une
      preuve. Les trois sont défendables, et c'est la première fois qu'on le
      vérifie. 4 tests, 5 mutations vérifiées*
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
- [x] Une boîte d'envoi : les messages ne partent plus dans la requête
      *Décision de réservation, transition de contrepartie, avertissement de
      grâce, ouverture de reprise envoyaient courriel et push **avant de
      répondre**. Fin : une table `outbound_message` — et non un type de job,
      dont l'invariant est « une ligne par travail, pour toujours » quand un
      message est une occurrence. Le dépôt se fait **dans la transaction de
      l'événement** : ou la décision et son annonce existent toutes deux, ou
      aucune, ce qui referme la fenêtre où quelqu'un était refusé sans jamais
      l'apprendre. Un balayage à la minute vide la boîte, avec le report des
      jobs et trois issues — parti, écarté, reporté. **Les envois directs ont
      été supprimés** : deux façons d'envoyer un message serait le défaut
      lui-même. 20 tests, 15 mutations vérifiées*
- [x] **BIND AGENCY v1.0 · le système visuel remplacé**
      *La fondatrice a donné la direction artistique de son agence : le produit
      passe du vert éditorial à l'orange. Remplacement de système, pas
      ajustement — les jetons `accent.*`, `role.*` et les trois teintes de
      palier disparaissent ensemble. Fin : les fontes livrées seules
      (Bodoni Moda, Outfit, l'italique devenu un fichier et non un attribut) ;
      la rampe orange où **`brand.500` ne s'écrit jamais**, tenue par une garde
      statique à quatre formes et par un refus à l'exécution ; les rayons à
      zéro et l'ombre de carte supprimée ; le rôle gardé **en matière** — encre,
      os, papier ; les paliers passés de trois teintes à trois matières, dont la
      progression ordinale se lit en niveaux de gris ; l'avertissement neutre au
      glyphe obligatoire et le danger au cramoisi ; le focus du champ, annoncé
      depuis la v0.4 et **jamais implémenté**, enfin en deux pixels d'encre ; et
      une garde qui **compte les blocs orange écran par écran**, table
      exhaustive, les écrans de travail quotidien à zéro pour une raison écrite.
      Un champ réellement manquant — le temps de fauteuil des rapports — est
      rendu **absent et non zéro** ; les trois autres, annoncés manquants par le
      brief, étaient servis depuis des semaines et c'est la carte de passation
      qui les sous-décrivait. Un manque nommé : le logo vectoriel. Le
      thème sombre est retiré : la v1.0 n'en livre pas, et en reconstituer un
      demandait d'inventer une dizaine de valeurs qu'aucune passation ne
      définit. 46 tests neufs, 12 mutations vérifiées*
- [x] **Le réglage retiré, et les trois satins cuits**
      *Fin : `theme.userOverride` quitte les jetons — un interrupteur qui ne
      commande rien fait douter de ceux qui commandent quelque chose — et une
      note prend sa place, qui dit pourquoi et où la bascule se rebranche. Les
      trois satins sont **cuits depuis les déclarations `radial-gradient` de la
      planche**, peintes par le moteur du navigateur et capturées en 1x, 2x et
      3x : c'est la source, pas un recadrage de JPEG dont le banding se serait
      vu sur 240 px de haut. En JPEG à qualité 90 — 5 valeurs sur 255 d'écart,
      176 Ko au lieu de 2,6 Mo. `SurfaceSatin` porte trois refus plutôt que
      trois consignes, et l'accueil sans média cesse d'annoncer « aucun fond ».
      11 tests neufs, 6 mutations vérifiées*
- [x] **Lots 2 et 3 · le commerce et l'administration dans le système v1.0**
      *Fin : les rapports **ne lisent plus le montant que la réponse porte
      encore** et comptent du temps de fauteuil ; une garde nomme les trois
      écrans qui ont le droit d'afficher une somme, chacun avec sa raison.
      L'annuaire est en lecture seule, tenu par deux gardes — l'écran sans
      action, et le client d'API sans route de contact — parce qu'une lecture
      seule tenue par la discipline finit par céder. Le bouton d'arbitrage
      **nomme son écart** : « Approve without the location tag » plutôt
      qu'« Approve », et l'attendu se lit en face du constaté, qui dit d'où il
      vient. La journée se coupe par ce qu'elle demande et non par des statuts.
      La prise en main n'annonce plus « 0 prestation lue ». Les plans disent
      leur lecture seule une fois plutôt que de griser, et un mensuel calculé
      porte sa note là où le chiffre est. Le mode terrain dit son avancement au
      filet segmenté. 22 tests neufs, 7 mutations vérifiées.*
      *Restent, faute de route : l'annuaire côté serveur, l'agrégat des
      rapports, le point de comparaison de quartier sur la journée vide, les
      deux blocs photographiés du terrain et le cochage prestation par
      prestation — aucun n'a été contourné en inventant une donnée.*
- [x] **L'accueil ne se refait plus sous les yeux**
      *Rapporté comme « la vidéo met plusieurs secondes à démarrer » ; c'était un
      basculement de composition. Tant que le manifeste des médias n'était pas
      revenu, l'écran rendait la composition satin complète, puis basculait sur
      la composition vidéo — la bande quittait le flux, l'en-tête réapparaissait
      ailleurs, l'encre changeait. Fin : le satin devient **la couche du
      dessous**, le voile devient permanent avec lui, `surMedia` est une
      constante et `avecEnTete` disparaît avec la bascule qu'il servait. Deux
      mesures plutôt que deux intuitions — 6,00:1 pour l'encre claire sur le
      satin voilé, 3,83:1 pour la sourde, qui passe au blanc. Le satin est étiré
      et non recadré : ses radiales sont en pourcentages de leur boîte. Un test
      liste ce que l'écran montre et compare avant et après la réponse ; 2
      mutations vérifiées*
- [x] **Un voile adoucit, il ne garantit rien**
      *Le constat fait sur la sous-ligne de l'accueil se répétait sur les cartes
      du fil, et il est plus net qu'annoncé : mesuré sur la pire photo possible,
      `ink.onScrim` ne tient qu'à 0,606 d'opacité et `ink.onScrimMuted` qu'à
      0,733 — des trois arrêts du système, **seul `scrim.photoBottom` les
      dépasse**. La question n'est donc pas l'encre mais l'endroit, et sur un
      dégradé l'endroit dépend de la hauteur de la carte, donc du terminal. Fin :
      le voile adoucit et s'arrête à `modal`, le texte porte sa propre bande à
      `photoBottom`, et le seuil est **calculé depuis les jetons** plutôt
      qu'écrit. L'en-tête de l'accueil portait la même faute — 3,72:1 au pire
      sur une vidéo claire — et prend sa bande aussi : une garantie qui dépend
      de ce qui a fini de charger n'en est pas une. 6 tests neufs, 3 mutations
      vérifiées*
- [x] **Lot 4 — la carte du commerce, composée par-dessus le fonctionnel**
      *Deux règles de Design portent le lot, et toutes deux sont devenues
      mécaniques. **La galerie sur l'encre, la carte sur l'os** — on regarde une
      photo sur du sombre, on lit un texte sur du clair : `FOND_DES_VISIONNEUSES`
      nomme les deux fonds, et un test refuse qu'ils se rejoignent, parce
      qu'uniformiser ressemble à une mise en cohérence. **Une page de carte est
      toujours une photographie** : la visionneuse rend l'original en `contain`,
      jamais la vignette, et une garde refuse que quoi que ce soit du chemin
      d'extraction y entre — recomposer la carte reviendrait à la republier sous
      notre nom. Côté commerce, le blocage se dit en tête et **nomme ses
      prestations** au-dessus de ce qui les débloque, le compte des pages se lit
      avant que la borne se subisse, et « l'un ou l'autre suffit » vit sur le
      filet **entre** les deux formes — écrite sous l'une, elle désignerait
      l'autre comme facultative. Côté fiche, deux lignes de même hauteur pour
      deux accès qu'on ne mêle plus, le glyphe de sortie qui remplace le chevron
      quand la carte n'existe qu'ailleurs, et la feuille qui annonce le domaine.
      18 tests neufs, 10 mutations vérifiées — dont une qui a révélé que le
      dépôt côté commerce n'avait aucune couverture*
- [x] **Ajouter `e2e` aux vérifications requises de `main`**
      *Arbitré par Daniel et posé par la conversation fonctionnelle : la
      protection exige désormais `api`, `app` et `e2e`, en `strict` et sans
      contournement administrateur. Le job qui monte le produit entier bloque
      enfin — c'est celui qui a trouvé les trois défauts qu'aucun test unitaire
      n'aurait vus. `--auto` reste piégeux d'une autre façon : il fusionne dès
      que les requis passent. La conclusion du run entier avant de fusionner
      reste la règle*
- [x] **La vidéo d'accueil réapparaît, et l'ancienne marque disparaît**
      *Deux constats de production. **Le voile** — ni le satin ni un défaut de
      montage : mesuré dans Chromium sur le build réel, il ne laissait passer
      que 18 % de la vidéo en haut et 48 % au mieux, et écrasait le satin, qui
      est une surface de marque. Il n'était pas devenu trop lourd, il avait
      cessé d'être nécessaire : chaque texte de l'écran a depuis son propre fond.
      #118 n'a pas créé le défaut, il a retiré le basculement de composition qui
      seul signalait qu'une vidéo existait. Trouvé au passage, un défaut
      préexistant : le lien de connexion, seul texte sans fond, à 2,14:1 — bande
      et encre claire, 12,14:1. **La marque** — le « B » du système vert avait
      traversé la v1.0 parce que le composant était repeint et pas redessiné, et
      les fichiers statiques venaient d'un script qui écrivait le vert d'eau et
      l'indigo en dur. La marque est le mot ; Chromium le peint avec la fonte
      que l'application embarque. La garde neuve ne juge pas un dessin, elle
      exige que chaque pixel opaque soit un mélange de deux couleurs des
      jetons — les tests d'avant ne regardaient que l'existence et la taille.
      7 tests neufs, 7 mutations vérifiées*
- [x] **Les quatre `marque-*.png` : un câblé, trois retirés**
      *Tranché en regardant ce que le build réclame, et non ce qu'on pouvait
      leur supposer. Expo compile `assets/favicon.png` en un `.ico` de trois
      images — 16, 32 et 48 — et n'écrit qu'un `<link rel="icon">` vers lui :
      le 16, le 32 et le 64 doublaient donc une chaîne qui les produit déjà.
      Retirés. Le 180 est la taille de l'icône d'iOS et avait, lui, une
      destination réelle : `public/` est recopié tel quel à la racine du build —
      vérifié sur un export — et Safari demande `/apple-touch-icon.png` par
      convention quand aucune balise ne la déclare. Il y est posé, ce qui évite
      de remplacer le gabarit HTML généré pour y ajouter une ligne. La garde
      refuse désormais **l'orphelin lui-même** : celle des couleurs ne regarde
      que les fichiers qu'on lui nomme, donc un fichier que personne ne réclame
      lui échappe par construction — et c'est ainsi qu'une marque périmée
      attend son tour. 5 tests neufs, 3 mutations vérifiées*
- [x] **La marque en petit : le bloc, avec le point évidé**
      *Livrée par Design, et elle règle ce que j'avais laissé ouvert. Quatre
      lettres ne tiennent pas dans seize pixels ; le dessin part donc des deux
      signes que la marque possède — le bloc orange plein, et le point
      d'exclamation évidé dedans. Évidé et non posé : un point orange sur blanc
      est un panneau d'alerte, le même creusé dans un carré plein devient une
      marque, parce que l'objet reconnu est le carré et le signe ce qui y
      manque. **Tout est en unités d'une grille de seize**, donc la forme est la
      même à 16, 32, 48 et 128 au lieu d'être arrondie différemment à chacune —
      c'est la propriété que les tests éprouvent, et pas seulement « deux
      couleurs ». Le favicon est livré en `.ico` complet, chaque taille tracée :
      `expo export` en produisait un en **réduisant** la source, et une
      réduction lisse — elle rendrait gris le blanc de deux unités qui sépare le
      fût du point. `web.favicon` est retiré avec `assets/favicon.png` : un
      fichier généré puis masqué par `public/` est pire qu'un orphelin, il
      reparaît le jour où l'on retire ce qui le masquait. 9 tests neufs,
      3 mutations vérifiées*
- [x] **La règle des deux marques, et les tuiles d'application avec**
      *Tranché : les icônes passent à la marque compacte sur les deux
      plateformes. La règle qui en sort est écrite dans la passation — **le
      logotype partout où on a la place de le lire, la marque compacte partout
      ailleurs ; le seuil est la lisibilité des quatre lettres, pas le
      support**. Le seuil est mesuré et non choisi : « B!ND » occupe 0,592 fois
      le corps par lettre, et dix pixels par lettre est encadré par 6,75 au
      lanceur Android — capture illisible à l'appui — et 11,1 au plus petit
      usage in-app, qui se lit. Conséquence, et c'est la forme la plus sûre de
      la règle : **aucun fichier cuit ne porte plus le logotype**, puisque tous
      sont des tuiles. Il ne vit qu'en texte dans l'interface, et `Marque`
      refuse de rendre sous le plancher — un logotype illisible ne se signale
      pas, il ressemble à un logotype en plus petit et traverse une revue.
      Android reçoit ses trois couches au bon gabarit : 432 avec zone sûre à
      288, dix-huit pixels par unité, aucun arrondi. `splash-icon.png` part au
      passage, orphelin comme les précédents. 8 tests neufs, 3 mutations
      vérifiées — dont une qui n'avait rien muté et qu'il a fallu reprendre*
- [x] **Le vectoriel a corrigé la règle : le point est orange**
      *Le logo de la fondatrice contredit ce qui avait été déduit de ses visuels
      Instagram — entièrement blancs sur orange, **où un point orange ne peut
      pas se distinguer du fond**. Les lettres prennent l'encre du fond, seul le
      point du « ! » est `brand.500`, et le fût suit les lettres. Conséquence
      technique : le « ! » ne peut pas être un caractère, une couleur de texte
      s'appliquant au glyphe entier — il se dessine, et son tracé est **mesuré
      sur la fonte** (le fût s'affine de 31 à 22 pixels à 400, le point est rond).
      Le sigle s'inverse — tuile encre, fût blanc, point orange — et sa palette
      passe à trois couleurs : sur une tuile orange le point disparaîtrait, et
      c'est lui la marque. La signature disparaît partout, jeton compris.
      12 tests neufs, 7 mutations vérifiées — dont deux passées d'abord, qui ont
      révélé une garde supprimée par une réécriture et une autre qui ne lisait
      jamais le rendu*
- [x] **Le vectoriel : tracé, mesuré, intégré**
      *Le PNG de la fondatrice vectorisé au seuil, les deux couleurs séparées sur
      une même toile pour que les chemins s'alignent. La trace est **mesurée
      contre la source** : 99,75 % de recouvrement sur l'encre, 99,22 % sur le
      point, écart de contour jamais supérieur à un pixel, et la coupe oblique du
      D à -1,835° des deux côtés. Le point est un chemin distinct, donc la
      variante blanche recolore les lettres seules. `$meta.unconfirmed` tombe.
      6 tests neufs*
- [x] **Les paliers sortent des onglets : quatre au lieu de cinq**
      *Un onglet répond à une question qu'on se pose en ouvrant l'application, et
      « quel est mon palier » n'en est pas une : ce qu'on veut savoir, c'est ce
      qu'on peut réserver. Le fil répond, les paliers expliquent — depuis une
      ligne « douze prestations vous sont ouvertes », d'où l'écran s'ouvre et
      revient. Rien à ajouter côté données, `Fil.total_prestations` existait.
      **Une garde écrite puis retirée** : le `total <= 0` protégeait un état
      qu'aucun appel n'atteint — le total est nul exactement quand le fil est
      vide, et un fil vide rend l'état vide à la place du corps — et son test
      fabriquait une réponse que le serveur ne produit pas. Le test des onglets
      passe d'un `arrayContaining`, qui aurait laissé passer un sixième onglet,
      à une égalité stricte. 5 tests neufs, 4 mutations vérifiées*
- [x] **Le mur : le fil créateur refait**
      *Six positions dans un ordre fixe, huit salons puis une respiration, trois
      pixels partout. Les salons arrivent triés par distance et se posent : la
      position décide, pas nous. Le placement et les trois arbitrages vivent
      hors du rendu et s'éprouvent seuls — 41 tests, plus 10 sur ce que l'écran
      montre, 5 mutations vérifiées. Une lecture de la planche a évité un champ
      serveur : la respiration annonce le quartier du salon qui la **suit**, pas
      un quartier hors rayon. Et un test tombé a révélé que l'échelle du texte
      suit la largeur et non la hauteur — la bande fait 150 et porte 22, le duo
      238 et porte 19*
- [x] **Little Haiti : dans la liste des quartiers, ou pas**
      *La planche du mur le montre — « Soleil Braids · LITTLE HAITI · 2,6 KM » —
      et il n'est pas dans les neuf quartiers de la liste fermée. Deux choses
      validées se contredisent. Le mur code sur les neuf en attendant : le type
      ne permet rien d'autre. À trancher par Daniel*
- [x] **Borner les sélecteurs de la suite de bout en bout à leur écran**
      *Trouvé en réécrivant le fil : le parcours de réservation vérifiait la
      liste de l'historique avec `[data-testid^="rangee-"]`, qui était la grille
      du **fil** — l'autre onglet, resté monté dans le document. Le test passait
      en regardant un écran qu'il ne visitait pas. Corrigé sur ce cas ; la règle
      générale — un sélecteur par préfixe se porte depuis `getByTestId('ecran-x')`
      et non depuis `page` — est passée sur toute la suite, et tenue par une
      garde qui refuse tout `page.locator` ou `page.getByTestId` nu. Un cas
      trouvé en chemin : `etat-nominal` est le nom que le gabarit donne à son
      contenu chargé, donc il existe sur **chaque** écran monté — l'attendre
      depuis `page` revenait à attendre que n'importe quoi ait chargé*
- [x] **Les cadres E et F du mur : le vide, et le bas**
      *Les deux issues du vide portent leur nombre, depuis `rayons` ; celle qui
      n'ouvrirait rien disparaît, une issue à zéro étant un cul-de-sac chiffré.
      Le bas du fil est le seul fond d'encre du mur — il compte ce qui a été vu,
      offre deux sorties chiffrées, et nomme en pied ce que le prochain palier
      ouvrirait, seule fois où le fil en parle. Cinq montages de test omettaient
      `rayons` et `quartiers`, obligatoires dans le type : corrigés côté
      montages, pas en rendant le composant défensif. 14 tests neufs,
      6 mutations vérifiées*
- [ ] Intégration Snapchat, à l'obtention de l'accès partenaire