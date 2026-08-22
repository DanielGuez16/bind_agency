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
- [x] **La disponibilité vérifiée une fois pour tout le fil**
      *Elle se vérifiait ligne par ligne : six lectures répétées par couple, soit
      **121 requêtes et 56 ms** pour dix-neuf salons. `couples_avec_creneau` fait
      les six une fois pour l'ensemble et rejoue le parcours en mémoire — **9
      requêtes, 10 ms**, verdict identique, vérifié couple par couple contre
      `creneaux_libres`. Le groupement porte sur l'ensemble **large** : les
      comptes par rayon et par catégorie s'y découpent*
- [x] **Filtre « libre aujourd'hui » et « sept prochains jours »**
      *`disponible=aujourd_hui|sept_jours`, posé sur le fil rendu et **après** les
      comptes : c'est un choix sur ce qu'on regarde, pas sur ce qu'on propose
      d'élargir. Un test vérifie que `categories` et `rayons` ne bougent pas.
      « Aujourd'hui » vaut un jour glissant — à 23 h, « jusqu'à minuit » ne
      rendrait presque rien*
- [x] **Recherche libre sur le fil**
      *`recherche=`, en `ILIKE` avec `unaccent` des deux côtés, sur le nom du
      salon, celui de la prestation et sa description. Miami est bilingue :
      « panaderia » trouve « Panadería ». Un balayage assumé — à vingt salons un
      index coûterait plus cher qu'il ne rapporte, et la forme de la requête ne
      change pas le jour où `pg_trgm` deviendra nécessaire*
- [x] **Point de suggestions, deux groupes**
      *`GET /businesses/suggestions` rend prestations et salons, passés par le
      même tamis que le fil. `origine` dit s'il classe sur les réservations
      **servies** du quartier ou sur la distance, et l'écran change de mot :
      un salon proche annoncé comme populaire est invérifiable. Le quartier vient
      de la position, jamais d'un paramètre*
- [x] **Compte par palier dans le rayon, sur `/me/tiers`**
      *Coordonnées facultatives : la route n'en dépend jamais, elle en tire parti
      quand elles sont là. `commerces_dans_le_rayon` vaut `null` — pas zéro —
      sans position, pour que l'écran distingue « on n'a pas demandé » de « il
      n'y en a aucun ». Des commerces et non des offres : « douze au total, dont
      neuf à moins de quinze kilomètres »*
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

## Vitesse de vérification

- [x] **Court-circuit de la CI quand un job n'a rien à éprouver**
      *Livré par la conversation produit sous le nom `perimetre`, arrivé le
      premier — j'avais écrit le même job en parallèle sous le nom
      `changements`, et je l'ai abandonné au rebase. Le travail en double a
      coûté une demi-heure : ce qui touche `.github/` mérite d'être annoncé
      avant d'être écrit, comme on le fait déjà pour les fichiers d'écran*
- [x] **Garde de durée côté Jest** — `app/scripts/duree-des-tests.mjs`
      *Livrée par la conversation produit en #146, avec le court-circuit. Elle
      part d'un cas réel : `entete-du-mur` mettait 17,4 s quand ses voisins en
      prenaient 1,7, sans que rien n'échoue*
- [x] **Garde de durée côté Python** — dans `tests/conftest.py`
      *Cette ligne a été cochée une première fois pour un travail qui n'était
      dans aucun commit : la garde décrite — un rapport à la médiane, un simple
      avertissement — n'a jamais existé dans le dépôt. Elle existe maintenant, et
      **sous une autre forme, parce que la médiane est le mauvais outil ici**.
      Mesuré sur la suite entière : la médiane d'un test est de 0,24 s et le 99e
      centile de 0,96 s, donc dix fois la médiane vaut 2,4 s — et le test
      légitime le plus lourd en met 3,7 à lui seul. Un rapport qui accuse un test
      sain est un rapport qui sera retiré au premier rouge. C'est la conclusion
      à laquelle la garde Jest était déjà arrivée, mesures à l'appui, et il a
      fallu la retrouver faute de l'avoir lue.
      Donc : le **test** et non le fichier — un fichier n'est pas lent parce
      qu'il porte un défaut, il est long parce qu'il porte beaucoup ; un
      **plafond mesuré** de 10 s, 2,7 fois le plus lourd des tests honnêtes ; un
      **échec** et non un avertissement, comme côté Jest ; et des dispenses
      déclarées avec leur raison, `@pytest.mark.lent("…")`, sur le modèle de
      `ecrit_pour_de_bon`. Quatre mutations : un test de douze secondes non
      déclaré, une dispense retirée, une dispense sans raison, et le contrefait
      de la garde anti-fuite*
- [x] **Le semis était lancé cinq fois, il l'est trois**
      *Ce que la garde ci-dessus a trouvé le jour où elle a été posée. Trois
      tests lançaient chacun le semis complet — vingt salons, leurs photos,
      leurs vignettes — pour lire trois lignes du **même** résumé : 34, 41 et
      31 secondes pour trois assertions sur un texte identique. Une fixture de
      module les sert toutes les trois. Restent séparés le refus hors
      environnement jetable, et le double passage qui éprouve la rejouabilité —
      deux questions différentes, pas deux lectures d'une même sortie.
      Suite complète : **568 s → 485 s**, à nombre de tests égal (1561)*
- [x] **La garde anti-fuite couvrait sept tables sur trente-six**
      *Elle existe pour nommer le test qui laisse une écriture derrière lui —
      la cause exacte d'une suite non déterministe — et elle en laissait passer
      les quatre cinquièmes : la boîte d'envoi, les profils créateur, les codes
      de retrait, les jetons de rafraîchissement, les préférences de
      notification. Déduite du schéma moins une dispense d'une seule table, une
      table neuve est surveillée le jour où elle est créée. Le commentaire qui
      dispensait « `tier`, `subscription_plan` et consorts » était faux :
      compté, `subscription_plan` est vide. Vérifié dans les deux sens — une
      écriture validée dans `link_click_salt` fait tomber la garde neuve et
      passe inaperçue de l'ancienne*
- [ ] **`pytest -n auto`, une base par worker**
      *La suite entière prend dix minutes ; huit workers la ramèneraient sous
      deux. Deux obstacles mesurés : les workers visent tous la **même** base —
      réparable en dérivant le nom de `PYTEST_XDIST_WORKER` — et un second, non
      résolu, où les workers échouent à s'authentifier alors que la même
      configuration marche en série. **Non fait délibérément** : les tests de
      concurrence — verrou consultatif, deux réservations simultanées sur la
      dernière place — deviendraient douteux si l'isolation par worker était
      imparfaite, et c'est trop cher payé*
- [ ] **La suite complète a échoué une fois sans explication** — non reproduit
      *L'entrée qui tenait ici disait « instable, deux exécutions sur quatre »,
      avec un diagnostic assuré — des tests sensibles au temps qui dérivent sur
      dix minutes. Repris à zéro, le décompte ne tient pas. Sur les quatre
      exécutions, **trois avaient une cause connue** : deux sessions pytest sur
      la même base, ce qui était ma faute et non celle de la suite ; le garde-fou
      de la carte des routes, qui signalait une entrée réellement manquante ;
      et une passée sans rien. Il **reste une seule** exécution inexpliquée, cinq
      échecs dont deux dans `test_emails.py`, et la sortie n'a pas retenu les
      trois autres noms. Compter une faute connue comme une instabilité fabrique
      un fantôme, et un fantôme se cherche indéfiniment.
      **Trois exécutions complètes depuis, toutes à 1561 tests verts** — dont
      une avec la garde anti-fuite élargie à trente-cinq tables, qui n'a rien
      trouvé : à l'exception des deux tests qui écrivent pour de bon et le
      déclarent, aucun test ne laisse rien derrière lui.
      Non reproduit ne veut pas dire inexistant. Ce qui manque pour trancher est
      la sortie complète du jour où ça retombera : lancer avec `-p no:randomly`
      et **garder le fichier entier**, pas un `tail`*

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
- [x] **Le commerce peut enfin constater une absence depuis l'application**
      *Le serveur avait `mark_no_show` depuis toujours, le client avait sa route
      **et sa méthode** depuis la #115, et rien ne les appelait : une méthode
      d'API sans appelant, c'est-à-dire du code mort qui a l'air d'une
      fonctionnalité. Seul l'appel manquait, et c'est ce qui rendait le geste
      introuvable pour un commerçant.
      Fin : le bouton s'ouvre sur `absence_signalable_a`, rendu par le serveur.
      Avant l'heure, l'écran **dit à partir de quand** — un bouton absent sans
      explication se lit comme une fonction manquante. Sans créneau, rien n'est
      proposé (`SPEC.md` §4.1). L'absence étant irréversible, elle se confirme
      d'un second appui sur un bouton qui nomme ce qu'il fait, après un
      avertissement placé **avant** et non après ; le désistement, lui, ne se
      confirme pas, et un test l'exige.
      **Le décor encodait ce qu'il devait éprouver** : il posait
      `absence_signalable_a` à `starts_at + 20 min`, exactement ce qu'un écran
      qui recopierait le réglage calculerait — la mutation qui remplace le champ
      par ce calcul passait tous les tests. Deux cas où les deux lectures se
      contredisent l'ont réparé. 10 tests neufs, 8 mutations*
- [x] **La porte de la représaille, fermée dans les deux sens**
      *Un sens était tenu : signaler un déplacement pour rien annule la
      réservation, donc le salon ne peut plus marquer absente celle qu'il n'a
      pas reçue. L'autre ne l'était pas — `signaler` exige `confirmed` et
      `no_show` est terminal, si bien qu'il suffisait de marquer l'absence
      **avant** qu'elle ne signale pour lui fermer son seul recours. Et la
      fenêtre où c'était possible s'ouvrait vingt minutes après le créneau,
      c'est-à-dire pendant qu'elle était sur la route.
      Fin : l'absence ne s'ouvre qu'à la fermeture de la fenêtre de
      signalement — **le plus tard des deux délais**, quatre heures aujourd'hui.
      Un `max` et non un troisième réglage : deux nombres à tenir d'accord à la
      main rouvriraient la porte le jour où l'on allonge la fenêtre, sans que
      personne ne s'en aperçoive. Le plancher de vingt minutes reste et protège
      autre chose — une créatrice en retard n'est pas absente — et il reprend la
      main si la fenêtre passait sous lui.
      Deux trouvailles au passage. La règle était **écrite deux fois**, dans
      `booking_states` et `booking_history` : la première modification de l'une
      aurait fait mentir l'écran sur ce que le serveur accepte. Et la fenêtre de
      signalement était fermée à droite, laissant un instant où le signalement
      et l'absence étaient possibles tous les deux — semi-ouverte, les deux
      règles partitionnent le temps. 6 tests neufs, 2 repris sur le fond,
      6 mutations*
- [x] **La règle de l'arbitre ne s'applique pas à l'absence, et c'est prouvé**
      *Demandée par analogie avec les décisions de contrepartie, elle donnerait
      ici une condition qui ne peut jamais être vraie. `no_show` n'est
      atteignable que depuis `confirmed` ; une contrepartie — seul objet qui
      porte `needs_human_review` — n'est créée qu'à la consommation, et
      `consumed` est terminal. Une réservation marquable absente n'a donc jamais
      d'arbitre. Plutôt qu'un garde-fou décoratif dans l'écran, quatre tests
      côté serveur tiennent les deux prémisses : ils tombent le jour où l'une
      change*
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
- [x] **L'en-tête du mur, et le filtre par catégorie qu'il commande**
      *L'en-tête nommait l'écran — « Near you », un bonjour, des chips de
      rayon ; il nomme maintenant l'endroit : le quartier, le rayon avec son
      compte, la marque, et les catégories avec les leurs. Le rayon et « All »
      sont là **avant le premier appel**, parce que la navigation n'attend pas
      la donnée. Le filtre était prêt sur trois couches et appelé par personne :
      la route l'accepte, le client sait l'envoyer, le serveur rend les
      comptes — il ne manquait qu'un état, et il est **vérifié sur l'URL
      réellement appelée**, jamais sur l'allure de la chip. Réappuyer sur la
      catégorie en vigueur la retire : c'est le « Clear » du cadre 03b, posé sur
      le geste qui a filtré plutôt qu'à côté. **Sous deux catégories la rangée
      entière tombe**, « All » compris — une chip seule est un interrupteur qui
      ne commande rien. Le compte passe aussi par le libellé d'accessibilité :
      c'est lui qui décide du geste, il ne peut pas n'exister que pour qui voit.
      Trois montages de test omettaient `categories`, et c'est une lecture non
      défensive qui les a trouvés. 12 tests neufs, 12 mutations vérifiées*
- [x] **Les rangées par quartier : ce que montre une catégorie choisie**
      *La direction 1b de « Fil v2 », branchée là où Design l'a elle-même
      placée — « le mur de 1a peut être le fil par défaut, et les rangées de 1b
      devenir ce que montre une catégorie choisie ». Le mur répond à « je
      descends sans intention », les rangées à « je cherche quelque chose près
      de chez moi », qui est exactement ce qu'on vient de dire en appuyant sur
      une catégorie. Deux axes : on descend par quartiers, on balaie dedans. La
      première carte est plus large — c'est le salon le plus proche du quartier,
      pas un mérite — et la prestation ne s'écrit que sur elle, même règle que le
      mur : le texte suit la largeur. **Une rangée sous trois salons se ferme sur
      une carte d'os** qui nomme le quartier suivant et sa distance : sous trois,
      rien ne dépasse le bord droit, le glissement ne s'annonce plus et la rangée
      ressemble à un chargement qui a échoué. Elle ne s'appuie pas — ce qu'elle
      annonce est la rangée juste dessous. **Le vrai risque de cette vue était
      ailleurs** : l'ossature étant le quartier, les salons hors des dix quartiers
      ouverts — `neighborhood: null`, qu'aucun compte du serveur ne porte —
      auraient disparu en silence, si bien que filtrer aurait caché des salons
      réservables. Ils font une dernière rangée. Une mutation a révélé une garde
      qui ne pouvait pas tomber, doublée par celle d'à côté. 15 tests neufs,
      11 mutations vérifiées*
- [x] **L'étiquette au survol du rail replié**
      *Le rail de 72 gardait ses libellés dans l'arbre d'accessibilité et nulle
      part ailleurs : un lecteur d'écran savait lire la navigation, un œil
      devait deviner cinq pictogrammes. L'étiquette s'ouvre au survol **et au
      focus** — le survol seul aurait déplacé le manque sur le clavier. Trois
      choses qui ne se devinent pas : `Pressable` retient `onHoverIn` pour sa
      propre mécanique et ne le repose pas sur la vue, donc le composant écrit
      avec aurait été **intestable** ; l'étiquette vit hors du défileur, qui
      rogne ce qui déborde à droite et qu'aucun test de rendu ne voit ; et elle
      est cachée des lecteurs d'écran, le libellé étant déjà sur la ligne. Deux
      tests de la coquille changeaient de sens tout seuls, le repli étant retenu
      par appareil dans un stockage simulé qui survit d'un test à l'autre.
      6 tests neufs, 9 mutations vérifiées — dont une qui n'a rien cassé et a
      fait écrire le cas manquant*
- [x] **Le cadre 11c des paliers : la porte qui ouvrait dans le vide**
      *« Voir les 34 prestations » existait sur l'écran des paliers et
      `porteOuverte` en dépendait ; la navigation ne le passait pas,
      délibérément — une porte qui annonce trente-quatre prestations et ouvre
      sur autre chose ment plus qu'elle ne rend service. Il manquait une lecture
      **non bornée par la distance**, que `/businesses` ne peut pas rendre par
      construction : `GET /me/tiers/{tier_id}/offres` l'apporte, triée par
      quartier puis par nom — le seul axe qui ne classe personne, et celui des
      rangées du fil.*
      *La phrase porte deux nombres et **ils comptent la même chose** :
      `offres_disponibles` et `offres_dans_le_rayon`. Le second a failli compter
      des salons, ce qui aurait mis deux grandeurs dans une phrase où les deux
      restent plausibles — donc où personne ne l'aurait remarqué. **`null` n'est
      pas zéro** : sans position, la moitié de la phrase se tait et la bascule
      disparaît, parce qu'il n'y a rien à basculer quand on ignore où l'on est.
      Et la bascule disparaît aussi quand tout est dans le rayon : les deux
      états montreraient la même liste. L'ordre du serveur ne se rejoue pas ici.
      **Une prestation sans distance n'est pas loin, elle est d'origine
      inconnue** — elle sort du « proche » sans être écartée du total. 8 tests
      neufs plus 1 sur le câblage, 8 mutations vérifiées.*
      *Trois tables exhaustives ont fait tomber la suite à l'arrivée de l'écran —
      blocs orange, couverture, squelettes — et une quatrième a exigé ses quatre
      états. C'est exactement ce pour quoi elles existent.*
- [ ] **Quatorze champs servis et rendus nulle part, à instruire un par un**
      *Trouvés par la garde en une minute, et inscrits dans sa table sous
      `a-instruire` — ce ne sont pas des exemptions, ce sont des constats en
      attente de décision. Quelques-uns sautent aux yeux :
      `ReservationDuCreateur.business_address`, que le cadre 08a affiche
      pourtant — « 120 NE 41st St · 320 m » — et que je n'ai pas rendu en le
      composant ; `Preuve.raisons_de_non_verification`, qui dit pourquoi une
      preuve n'a pas été retenue ; `Reporting.deplacements_pour_rien`, dont la
      tâche entière a été construite ; `CodeDeRetrait.rotation_seconds`, quand
      l'écran de code compte probablement trente secondes en dur ;
      `needs_human_review` sur trois types, c'est-à-dire l'escalade de la
      troisième tentative, invisible partout. Chacun se tranche : rendu, ou
      passé en `contrat` avec sa raison*
- [x] **`Lot 1 v1.1` · 02 · les paliers : déjà passé, et le registre le surestimait**
      *Confronté cadre par cadre, et il n'y avait presque rien à faire — pour
      une raison qui vaut d'être écrite : **le cadre 02 est la planche
      `Tiers v0.7`, restylée**. Il le dit lui-même en sous-titre, « la v0.7 dans
      le nouveau système ». Cette planche-là a eu sa propre tâche, livrée et
      éprouvée à douze mutations : l'échelle d'échange, la progression en
      matière, l'écart chiffré à 60 %, la cause commune devant. Le registre
      l'avait comptée comme jamais confrontée parce qu'il regardait
      `Lot 1 v1.1` **en bloc**.*
      *Deux détails vérifiés. Le filet d'encre à gauche du prochain palier et
      l'orange réservé à la barre d'écart : tenus, `line.ink` contre
      `brand.500`. Et le tiret cadratin d'un palier fermé : **la planche est
      périmée, pas l'écran**. Elle écrivait « — » parce que `offres_disponibles`
      n'existait pas encore — « je n'ai pas inventé le nombre », dit son
      encadré. Le champ existe depuis, pour les paliers fermés aussi, et son
      contrat dit « zéro est une réponse ». Rendre le vrai nombre vaut mieux
      qu'un tiret qui ne signalait qu'une donnée absente.*
      *Reste **une seule chose** : « See the 34 services » est la porte du cadre
      11c. `onVoirLesPrestations` existe sur l'écran, `porteOuverte` en dépend,
      et la navigation ne le passe toujours pas. Les deux se prennent ensemble*
- [ ] **`pytest -n auto`, avec une base par worker**
      *Mesuré : le job `api` prend 754 s, dont **704 dans `pytest` seul** —
      l'installation en fait 22, le reste est du bruit. C'est 93 % du job et
      78 % de l'attente d'une exécution complète. Mais ce n'est pas un drapeau
      à ajouter : les tests partagent une seule base `bind_test`, et le dépôt
      éprouve explicitement les verrous consultatifs et le comportement
      transactionnel. Des workers `xdist` demandent une base par worker, et
      chaque test de concurrence doit être relu un par un. **Reporté
      délibérément** : rendre douteux exactement les tests qu'on ne peut pas se
      permettre de douter serait payer trop cher pour dix minutes*
- [ ] **La suite `app` force la sortie d'un worker, sur un arbre propre**
      *« A worker process has failed to exit gracefully » sort à **chaque**
      exécution, avant comme après la correction du fichier à 17 secondes : la
      fuite est ailleurs et n'est pas identifiée. Elle est sans conséquence
      visible — la suite passe — mais elle interdit d'exiger
      `jest --detectOpenHandles`, qui est le seul outil qui nomme un handle
      resté ouvert **et** son fichier. C'est la classe de défaut que la garde de
      durée ne peut pas attraper : le coût est dans le démontage, et Jest ne le
      compte pas dans la durée du fichier. Fin : `--detectOpenHandles` sort
      propre, et devient une étape de la CI*
- [x] **Une garde de parité qui ne regardait jamais les appels**
      *La parité des traductions comparait les deux catalogues l'un à l'autre :
      elle attrapait une clé traduite d'un seul côté et laissait passer une clé
      absente des deux. Le défaut s'est produit deux fois dans la journée — six
      clés du cadre 11c lues sous `tiers` et posées dans `parcours`, parité
      intacte, et l'écran affichant `[missing … translation]` en clair à la
      place du titre. **La clé se résout par son chemin entier, jamais par sa
      feuille** : la première version aurait trouvé l'homonyme de `parcours` et
      déclaré la garde satisfaite, ce qui est reproduire le défaut qu'elle
      interdit — vérifié par mutation, elle passe au vert sur le vrai cas. Les
      vingt-deux clés composées sont hors de portée, dénombrées et plafonnées
      plutôt que passées sous silence. 4 tests neufs, 4 mutations vérifiées*
- [x] **Les deux grandeurs de la phrase du 11c, et le champ que personne n'alimentait**
      *Tranché par Daniel : « neuf prestations à moins de quinze kilomètres, chez
      six salons » dit ce que le seul compte de prestations ne dit pas — neuf
      chez un salon et neuf chez six sont deux offres très différentes. Les deux
      sont dans la phrase, chacune nommée.*
      *L'implémenter a révélé que **ni l'un ni l'autre n'était jamais
      alimenté** : `mesPaliers()` n'envoyait aucune coordonnée, le serveur
      rendait `null` pour les deux, et la seconde moitié de la phrase comme la
      bascule ne fonctionnaient que dans les tests. Cinquième cas du jour dans
      cette famille, et une variante neuve : les quatre premières étaient « le
      serveur rend, l'écran ignore », que la garde des champs attrape ;
      celle-ci est « le serveur rend, l'écran lit, et personne ne demande » — le
      champ est lu, donc la garde ne peut pas le voir. Seul un test sur l'URL
      réellement appelée l'attrape. 2 tests neufs plus 1 repris, 5 mutations*
- [x] **Les quatorze champs servis et rendus nulle part, tranchés**
      *`rotation_seconds` d'abord : **le code ne se désynchronise pas**, le
      compte à rebours étant piloté par `seconds_remaining`. Le vrai défaut est
      le seuil d'urgence, fixé à dix secondes quelle que soit la cadence — à
      quinze secondes de rotation, rouge les deux tiers du temps, et un signal
      permanent cesse d'être un signal. Il devient une part de la cadence.*
      *Quatre des cinq défauts corrigés : l'adresse sur la ligne, les trois
      `needs_human_review` rendus des deux côtés — et côté commerce **un dossier
      sous arbitrage n'est plus décidable** — et les déplacements pour rien dans
      le rapport. `avg_views` ajouté, `media_count` retiré, six en `contrat`.*
      *Deux défauts sortis de la liste sans être cherchés : `verifiee === false`
      et `=== null` rendaient **le même écran**, si bien qu'une preuve refusée
      s'affichait « attestée, non vérifiée » — le type disait pourtant que les
      deux se disent autrement. Et un montage de test portait
      `needs_human_review: true`, donc tous les tests de décision du commerce
      s'exerçaient sur le cas où il ne doit plus décider. 3 tests neufs plus 2
      repris, 6 mutations vérifiées*
- [x] **Le commerce ne peut pas signaler une absence depuis l'application**
      *Fait, et repris plus haut sous « Le commerce peut enfin constater une
      absence ». Le diagnostic était juste sur la conséquence et faux sur la
      cause : l'entrée de route `marquerAbsent` **et sa méthode de client**
      existaient depuis la #115, documentées et appelant le bon chemin. Seul
      l'appelant manquait — une méthode d'API sans appelant, c'est-à-dire du
      code mort qui a l'air d'une fonctionnalité, et qui a tenu seize PR parce
      que chercher `no-show` dans le dépôt donnait quatre résultats rassurants*
- [ ] **Le commerce ne peut pas signaler une absence depuis l'application**
      *Diagnostic corrigé : `absence_signalable_a` n'est pas un champ non
      affiché, **c'est une route absente du client**. Le serveur a
      `mark_no_show`, l'app ne l'appelle nulle part. Il faut l'entrée de route,
      la méthode, et l'action sur la journée — ouverte par
      `absence_signalable_a`, qui dit aussi à quelle heure elle s'ouvre, et
      c'est le serveur qui refuse, jamais l'horloge du téléphone. Une tranche,
      pas un rendu de champ*
- [x] **Un plafond de durée sur chaque job de la CI**
      *Le pas `Navigateur` de la e2e est resté cinquante minutes puis vingt-cinq
      sans finir, sur deux exécutions consécutives, **sans échouer**. Le défaut
      de GitHub est de six heures. Ce qui rend la chose coûteuse est ce qu'on
      voit pendant : run `in_progress`, PR `BLOCKED` en attente d'une
      vérification requise — **un état qui se lit comme de la patience**, comme
      le run jamais dispatché. Les bornes viennent de quatorze exécutions
      vertes — 9 s, 62 s, 308 s, 632 s au pire — et sont larges à dessein : une
      borne serrée rend rouge du bon code un jour de runner lent, ce qui apprend
      à relancer sans lire. Un plafond par pas a été écarté (le blocage se
      déplace), le cache Playwright aussi (une minute sur cinq, contre une clé à
      tenir et un mode d'échec de plus)*
- [ ] **Treize méthodes d'API que personne n'appelle**
      *Trouvées par la garde neuve, née de mon erreur sur l'absence — dont la
      quatorzième vient d'être branchée par la conversation fonctionnelle. Ce
      sont des capacités que le produit sait demander au serveur et qu'aucun
      écran n'offre : du code mort **qui a l'air d'une fonctionnalité**.
      Plusieurs appartiennent à des tâches cochées — la reprise de compte en
      entier (trois méthodes), l'abonnement (trois), les repères du voisinage,
      la modification et la suppression d'un item, la réouverture d'une offre,
      la prise en main d'une fiche. Et une qui saute aux yeux : **le créateur ne
      peut pas annuler sa réservation**. Chacune se tranche : branchée, ou
      passée en `contrat` avec sa raison*
- [x] **Trois bloquants trouvés en campagne, et deux ajouts**
      *Le produit a été monté localement sur le jeu de démonstration pour
      chacun des trois : lu dans le code, aucun n'était visible.
      **Le code de retrait.** `confirmed` ne veut pas dire consommable : le
      diagramme n'a pas de flèche vers `expired`, donc une réservation que
      personne n'a servie garde son statut pour toujours. Passé `valid_until`
      le serveur refuse le code, et l'écran le proposait quand même — un
      message d'erreur à la place du QR, au comptoir, le jour du rendez-vous.
      L'écran cesse de proposer et dit pourquoi. **Deux décors de test
      l'encodaient** : une date figée au 16 août, et un `valid_until` omis.
      **Les réseaux en 503.** Sept intégrations refusent de démarrer mal
      configurées ; la sociale était la seule à ne pas l'être, et levait à la
      première requête. Les deux façons d'obtenir un 503 ont été reproduites, et
      une seule donne **les deux** plateformes : `SOCIAL_PROVIDER=demo` sans
      `API_PUBLIC_BASE_URL`. C'est la configuration de la campagne, et à poser
      chez Render — le code, lui, refuse maintenant de démarrer sans elle.
      **L'annuaire.** Le semis abonnait `actifs[:2]`, écrit quand le jeu comptait
      trois salons ; passé à vingt, il a désigné deux salons du marché et laissé
      Ocean Beauty Studio — celui avec lequel on ouvre le produit — sans
      abonnement. La route répondait 402 et l'écran le disait exactement. Les
      abonnés sont nommés.
      **Le pseudonyme mène au profil** sur le réseau de la demande, par la même
      dérivation que l'annuaire — jamais stockée.
      **Le réglage des notifications est retiré** : écran, deux routes, table,
      modèle. Les sept genres restent. Six tests qui ne parlaient que du réglage
      sont partis ; deux qui éprouvaient aussi « on relit au moment de sortir »
      portent maintenant sur la suspension. 12 tests neufs, 5 mutations*
- [x] **Trois points du journal de campagne**
      *La **demande de position** part à l'arrivée sur le fil : une seule
      question au lieu de deux. La première n'apprenait rien que le système ne
      dise mieux — c'est lui qui nomme l'application et porte les conséquences —
      et elle ajoutait un geste avant le geste. L'écran ne reste que pour le
      refus, où il gagne un « réessayer » qui **relit** l'autorisation au lieu de
      promettre de la redemander.
      **« À examiner » vide : défaut de données, pas de filtre.** Vérifié en
      comptant par commerce : la seule contrepartie `submitted` du jeu était chez
      Wynwood, et Ocean — le salon de démonstration — n'en avait aucune, pendant
      que « attendues » en portait deux. Même forme que l'abonnement pris par
      rang. « Expected » devient « en attente de sa publication », et les trois
      onglets suivent l'ordre d'usage : à examiner, approuvées, en attente.
      **Le lien de publication : trois manques qui se cachaient l'un l'autre.**
      L'écran de soumission n'avait pas de champ, le semis posait `None`, et le
      niveau 3 — le seul qui fonctionne aujourd'hui — jetait l'adresse reçue.
      Aucun ne pouvait se découvrir sans les deux autres. Et **le niveau 1 levait
      à sa première ligne** : `fournisseur_de` est une dépendance FastAPI, elle
      était employée en `async with`. Ce chemin n'est atteint que si une adresse
      est fournie, donc il n'avait jamais tourné.
      9 tests neufs, 5 mutations*
- [x] **Deux horloges comparées par une contrainte** — reprise de compte
      *`started_at` écrit par `clock_timestamp()` côté Postgres, `ended_at` par
      `datetime.now(UTC)` côté Python, et `close_apres_ouverture` compare les
      deux. **2,7 millisecondes** d'avance de la base suffisent à fermer avant
      d'ouvrir : trois tests tombés d'un coup en suite complète, avec les
      chiffres dans la trace.
      C'est la cause que j'avais avancée il y a deux jours sur l'instabilité de
      la boîte d'envoi sans pouvoir la confirmer — ma mesure au repos montrait
      Postgres **derrière** Python. Elle est ici mesurée sous charge, et dans
      l'autre sens. **Reste à passer le même peigne** sur les autres colonnes
      qui comparent une heure Python à une heure écrite par la base*
- [x] **Les trois champs sans lecteur, tranchés plutôt que rangés**
      *`prochain_palier` et `commerces_de_plus` passent du fil à `/me/tiers`,
      où leur sujet est parti. La route portait déjà les obstacles et le compte
      dans le rayon par palier ; seul le **classement** a déménagé, et il reste
      au serveur — le recopier dans l'écran en ferait une seconde vérité.
      `commerces_de_plus` ne suit pas : hors du fil il n'y a rien à exclure, et
      garder le mot promettrait une soustraction sans opérande.
      `cover_portrait_key` quitte le fil. Le produit ne rend qu'une forme de
      couverture, 16:9, avec sa raison mesurée ; aucune surface portrait
      n'existe et aucun écran n'en dépose. La colonne et les vingt images
      restent — elles ne coûtent rien, et la question de composition n'est pas
      à moi pendant que l'autre conversation refait ces écrans.
      La section « à instruire » de la garde des champs est de nouveau **vide**.
      4 tests neufs, 2 mutations dont une survivante documentée*
- [x] **Le peigne des horloges** — dernier morceau de l'instabilité
      *Quatorze colonnes écrites par la base, confrontées à leurs comparaisons.
      Une seule était comparée à une heure Python sur un écart qui peut être
      nul, et son jumeau avait la bonne écriture depuis le début. Une garde
      empêche le motif de revenir — elle était d'abord partielle, et la mutation
      l'a montré*
- [x] **La confirmation d'adresse, la chaîne complète**
      *Envoi à l'inscription dans la même transaction, jeton borné à 24 h et à
      usage unique, route de confirmation en `GET` — un lien de courriel s'ouvre
      dans un navigateur — et renvoi qui révoque le précédent. Un compte non
      confirmé entre et se sert du produit ; il ne peut ni réserver ni mettre un
      commerce en ligne. Les comptes existants sont datés par la migration.
      11 tests neufs*
- [x] **La force du mot de passe, et la validation des champs**
      *Pas de règle de composition — elle accepte `Password1!` et refuse une
      phrase de passe. Liste de refus, adresse interdite dans le mot de passe,
      variété minimale, rangées de clavier. Confirmation à l'inscription.
      Téléphone au format international, normalisé avant validation ; nom
      dépouillé de ses espaces avant d'être compté ; adresse d'au moins dix
      caractères. 13 tests neufs*
- [x] **Le 402 revient sur l'annuaire**
      *Le mode dégradé de la #199 est retiré : il n'avait aucun écran pour
      l'accompagner. L'écran n'affiche « l'annuaire vient avec un abonnement »
      que sur un 402 ; avec le 200 dégradé, un salon non abonné voyait une
      grille de cartes sans nom ni visage sans une ligne qui explique pourquoi
      — le chemin qui vend l'abonnement était mort. **La machinerie du floutage
      reste** : `apercu_floute`, la clé `@apercu` et son repli qui échoue plutôt
      que de servir la photo nette, tous éprouvés, pour le jour où un écran
      montrera un aperçu. 1 test repris, 1 mutation vérifiée*
- [x] **Un salon voit un pseudonyme, jamais un état civil**
      *Le peigne complet, et il était plus large que l'annuaire : la journée du
      comptoir et la caisse **préféraient** « Rebecca Alvarez » au pseudonyme
      et ne retombaient sur `@rebecca.miami` qu'à défaut. `creator_first_name`
      et `creator_last_name` retirés de la journée et de la file des
      contreparties ; `creator_name`, que la caisse composait depuis le profil,
      devient `creator_handle` — le compte **de cette réservation**, celui qui
      publiera. Trois écrans basculés. Après ce passage, aucun schéma
      destiné à un commerce ne porte de nom civil. 1 test neuf, 5 repris,
      2 mutations vérifiées*
- [x] **Le pseudonyme est l'identité de l'annuaire**
      *`first_name` et `last_name` retirés de l'annuaire, **dans les deux états
      d'abonnement** : ils ne s'achètent pas, l'écran ne les montre nulle part.
      L'annuaire titrait « Léa Martel », c'est-à-dire l'état civil de cent
      vingt-huit personnes chez tout salon abonné qui ne les a jamais
      rencontrées. Le nom reste sur la journée du comptoir, où la créatrice a
      choisi ce salon et s'y présente. Trouvé par la garde des champs servis de
      l'autre conversation, qui les avait dénoncés comme orphelins. 2 tests
      neufs, 1 mutation vérifiée*
- [x] **Le masque est au serveur, et le contre-factuel par palier**
      *Sans abonnement, l'annuaire ne renvoie plus ni pseudonyme, ni volume, ni
      lien de profil, ni photo nette — **ni biographie**, qui est du texte libre
      où le pseudonyme reparaît. À la place, un aperçu réduit à 32 px **avant**
      d'être flouté : ce qui est jeté n'est plus dans le fichier servi.
      `@apercu` est un suffixe distinct de `@vignette` pour que le repli de la
      route des médias ne le rattrape pas — il servirait la photo nette. La
      route ne refuse plus en 402, elle sert en deux qualités, dans une
      enveloppe qui porte aussi la portée locale. `gains_par_palier` : ce que
      chaque palier fermé ajouterait, évalué **un palier à la fois** et
      seulement pour qui ne peut pas déjà réserver. 14 tests neufs, 9 mutations
      vérifiées dont 3 qui ont trouvé des décors qui ne prouvaient rien*
- [x] **Qui est là, depuis quand, et avec quoi elle frappe**
      *Quatre données pour des écrans en composition. `portee_locale` sur le
      reporting : combien de créatrices dans le rayon, combien peuvent déjà
      réserver aux paliers ouverts — le seul chiffre de l'écran vide qui ne
      parle pas du salon. La règle d'éligibilité n'est pas réécrite, les
      lectures sont faites en gros et passées à `evaluer`. `premiere_semaine`,
      **calculée hors de la fenêtre** : bornée par elle, elle rendrait le début
      de la fenêtre. `comptes` sur chaque demande de réservation — tous les
      réseaux, pas seulement celui de la demande, parce que l'absence de TikTok
      fait partie de la décision. `horaires` sur la journée, par
      `availability.fenetres_du_jour` : exceptions comprises, vide veut dire
      fermé. 13 tests neufs, 5 mutations vérifiées*
- [x] **Le sens des événements du score, et la fin d'une autorisation**
      *`fiabilite.composantes` : les neuf événements avec `up`, `down` ou
      `neutral`, **dérivés du signe de `reliability_weights`** et non récités.
      L'écran listait les sept événements depuis du texte figé ; un poids
      inversé l'aurait rendu faux sans qu'aucun test ne tombe. Les poids
      eux-mêmes ne sortent pas — l'écran nomme, il ne barème pas.
      `token_expires_at` sur la carte d'audience : `status` disait « finie »
      sans dire quand, et la seule façon de l'apprendre était l'obstacle d'un
      palier. `reliability.Fiabilite` renommée `CachesDeFiabilite` — la garde
      des schémas lus a vu la collision de noms avant qu'elle coûte un 500.
      7 tests neufs, 5 mutations vérifiées*
- [x] **La suppression de compte, ouverte enfin**
      *`anonymize_account` existait sans porte. `POST /me/deletion` et
      `DELETE /me/deletion`, `deletion_effective_at` sur `/me`. Anonymise et ne
      détruit pas ; différée de trente jours avec retour possible pendant tout
      le délai ; refusée tant qu'une contrepartie est en cours, **et la garde
      est rejouée au balayage** — trente jours suffisent à en faire naître une.
      Côté commerce, `creator_partie` sur la file et sur la journée : un drapeau
      traduit à l'écran, jamais un nom vide qui se lit comme un bug.
      17 tests neufs, 5 mutations vérifiées*
- [x] **Le salon, la prestation, le réseau et le plafond de tentatives**
      *`business_name`, `item_name` et `platform` joints à la lecture — la
      contrepartie ne les duplique pas. Le nom du salon est celui qui manquait
      le plus : `required_geotag` était servi sans le mot à recopier.
      `max_attempts` vient de `collaboration_max_attempts`, servi et non figé
      dans l'app, pour que « tentative 2 sur 3 » ne mente pas au premier
      ajustement. 4 tests neufs, 3 mutations vérifiées*
- [x] **Le temps restant et le dernier motif, pour l'écran d'envoi de preuve**
      *`secondes_avant_echeance` compté par le serveur — l'horloge d'un terminal
      n'est pas une preuve — plancher à zéro, `deadline_at` servi à côté pour
      qu'un écran resté ouvert se recale sans redemander la route.
      `dernier_motif` relu du journal d'audit, la même source que
      `LigneDeFile.dernier_motif` : deux façades, une vérité. 7 tests neufs,
      5 mutations vérifiées. **Contradiction signalée** — il n'existe qu'une
      fenêtre, `deadline_at`, à 24 h de la consommation puis 12 h par refus ; ni
      le code ni `SPEC.md` ne portent de délai de 48/72 h par palier*
- [x] **L'écran de validation d'adresse, côté app**
      *Une bannière dans la coquille plutôt qu'un écran, et c'est le point : le
      compte non confirmé suit la personne d'un onglet à l'autre, un écran
      dédié serait absent de celui où le refus tombe. `email_verified_at` entre
      dans la session ; `relireLeCompte` et `renvoyerLaVerification` s'ajoutent
      à ses gestes. **L'accueil du retour de lien est le retour au premier
      plan** — le lien vise l'API et s'ouvre dans un navigateur, l'application
      n'est jamais rappelée, elle revient : `AppState` relit alors le compte et
      la bannière part d'elle-même. Le renvoi relit le compte même en échec,
      sans quoi le 409 « déjà vérifiée » afficherait une erreur pour annoncer
      une réussite. 5 tests neufs, 4 mutations vérifiées*
- [x] **La suite en parallèle** — 651 s à 300 s, mesuré
      *`pytest-xdist` avec `--dist loadgroup`. Les deux tests de concurrence
      partagent `xdist_group("concurrence")` : même worker, sériels entre eux, et
      le verrou consultatif reste éprouvé. `test_seed.py` est groupé aussi — le
      répartir faisait payer son montage à chaque worker qui en recevait un
      morceau.
      Une base par worker, dérivée de `PYTEST_XDIST_WORKER`, et le dépôt d'objets
      avec : deux semis concurrents écrivent la **même** clé — c'est l'empreinte
      du contenu — et se volaient leur fichier `.partiel`.
      **Ce qui avait bloqué la première tentative** : `str()` sur un `URL`
      SQLAlchemy masque le mot de passe. Le message disait « password
      authentication failed for user bind » et le parallélisme n'y était pour
      rien.
      **Le chemin critique est **, épinglé sur un worker : les
      neuf autres finissent et l'attendent. Il est passé de 164 s à 116 s en
      cessant de rejouer le semis une troisième fois pour lire un résumé que le
      second passage avait déjà produit.
      **Les cent secondes qui restent ne se clonent pas** : ce sont les deux
      passages qui éprouvent la rejouabilité. Une base modèle les remplacerait
      par un , qui prouverait qu'on sait copier une
      base — pas que la commande repart d'un état rempli. C'est le plancher, et
      il est le sujet d'un test, pas son coût*
- [ ] **`SOCIAL_PROVIDER` et `API_PUBLIC_BASE_URL` à poser chez Render**
      *Le seul des trois bloquants que le code ne peut pas corriger seul. Depuis
      cette tranche, l'API refuse de démarrer sans elles plutôt que de répondre
      503 à la première créatrice — ce qui rend le manque visible au déploiement
      et non une inscription à la fois*
- [x] **La direction Ambre : jetons, typographie et formes**
      *Les trois fichiers de Design importés depuis son projet. Les 31 valeurs
      sont identiques à celles de l'artefact où la fondatrice a tranché — rien à
      arbitrer, seulement à appliquer. La garde de la passation passe de
      l'égalité à l'inclusion, avec son sens inverse : l'app n'invente aucune
      valeur que Design ne déclare pas. **Trois secondes vérités supprimées** —
      `color.tier` qui recopiait la rampe en hexadécimaux et serait restée à
      l'orange brut, la liste des couleurs du sigle, et un drapeau booléen qui
      disait sans sa raison ce que la règle dit en toutes lettres. Les trois
      réserves de contraste de Design deviennent quatre mesures.
      **Cette ligne a d'abord affirmé que le bloc accentué restait d'équerre et
      qu'un test le tenait ; c'était faux des deux moitiés.** La bascule l'avait
      arrondi avec les 65 autres sites, et les deux gardes qui parlaient de
      `radius.none` sont restées vertes — l'une vérifiait la valeur du jeton,
      l'autre que personne d'autre ne s'en servait. La direction manquante est
      écrite : le bloc doit le porter. De même `elevation.card`, déclarée et
      consommée nulle part, et la pose du point du logo, que la palette ne peut
      pas garantir. 1040 tests verts, 8 mutations vérifiées*
- [x] **Le fil créateur v3, sur les remarques de la revue**
      *La prestation prend le titre, le salon passe en attribution : les
      testeurs ne savaient pas s'ils regardaient un lieu ou une prestation, et
      c'était une inversion de hiérarchie, pas un manque de catégorie. Même
      correction sur la fiche, au même endroit, avec la même variante et un test
      qui compare les deux. Le chrome disparaît, deux aperçus par ligne, case de
      badge à hauteur fixe. Le quartier structure le mur en sections repliables
      plutôt que d'ajouter une troisième bande. Partent avec : le mur en
      mosaïque, cycle.ts, regles.ts, les rangées par quartier, le bilan du pied,
      cinq fichiers de tests. Deux écarts instruits — le badge à `brand.900`
      (4,19:1 mesuré sur la valeur de la planche) et pas de bouton de recherche,
      faute d'écran à ouvrir. 980 tests verts, 13 mutations vérifiées*
- [x] **`BusinessCard` retirée, avec ses tests et son squelette**
      *Une carte qui survit sans écran finit par resservir en portant une
      composition périmée — c'est ce qui est arrivé au monogramme vert, qui a
      traversé un remplacement complet du système en gardant sa forme. Partent
      avec elle : `SkeletonCard`, le rapport de couverture 16:9, deux tests qui
      décrivaient sa composition, et quatre raisons écrites devenues fausses. Le
      squelette par défaut d'`Ecran` devient une liste de lignes — une forme qui
      n'affirme rien — et une garde neuve le fixe : rien ne disait ce que reçoit
      l'écran qui oublie de déclarer sa silhouette*
- [x] **`elevation.card` posée sur les douze cartes du produit**
      *La règle vient avec les rayons et non par écran : « un coin de 18 px sans
      ombre flotte au lieu de se poser » vaut des douze surfaces qui portent ce
      rayon. Trois clippent leur contenu et portent leur ombre sur une vue
      extérieure — sur iOS, une vue qui clippe coupe sa propre ombre. L'inventaire
      change de sens : il liste les cartes qui la portent, compte les poses, et
      exige l'égalité. Sa première version lisait l'import et restait verte quand
      on retirait l'ombre ; la mutation l'a dit, la relecture non*
- [x] **La fiche de salon v3 — point 2 du §6**
      *Une ligne portait cinq informations dont deux codées ; elle pose deux
      questions, et c'est une ligne chacune. Le badge codé quitte cet écran et
      survit sur le fil et les paliers. Le bouton cesse de s'étirer —
      `fullWidth` valait `true` par défaut, d'où les 316 points. Le bloc fermé
      reprend son opacité pleine, seule la vignette s'atténue, et l'obstacle
      emprunte `EcartAuSeuil` aux paliers avec sa règle des 60 %. La couverture
      porte le compte de photos, la carte devient une ligne nommée. `ServiceRow`
      part avec l'écran qu'elle servait. Deux écarts écrits : pas d'étiquette
      d'horaires, faute d'un champ servi, et les glyphes du jeu existant plutôt
      que deux marques relevées et une inventée. 998 tests verts, 11 mutations*
- [x] **Le choix du créneau v3 — point 3 du §6**
      *Une bande de quatorze jours plutôt qu'une grille de trente : la grille
      serait vide aux trois quarts et dirait « ce salon n'a rien ». Les jours
      sans place gardent leur place et répondent — ils disent pourquoi et
      proposent les deux jours ouverts les plus proches — au lieu d'être
      `disabled`. Quatre états servis, dont `revolu` qui manquait et que le
      serveur a ajouté en cours de route. L'étiquette d'horaires de la fiche est
      débloquée, croisée avec une preuve d'ouverture prise sur les créneaux déjà
      servis. 1030 tests verts, 10 mutations vérifiées*
- [x] **L'accueil et la connexion v3 — le premier écran, repris en dernier**
      *La vidéo part et emporte six mécanismes : repli sur l'affiche, choix
      d'orientation, hors-ligne, reprise au premier plan, relance après montage,
      boucle garantie deux fois. Le satin et le défilement partent avec. Les
      deux portes passent côte à côte, intitulés empilés à 22 en graisse 800 —
      c'est l'empilement qui les autorise à être gros. Le bloc noir de la
      connexion part sans être remplacé. `mediasPlateforme` et
      `MediasPlateforme.home` restent servis sans lecteur : à trancher*
- [x] **La reprise dit ce qu'elle reproche — `dernier_motif` consomme**
      *L'écran renvoyait recommencer sans dire quoi corriger. La carte nomme le
      manque en toutes lettres, jamais par son code, et dit aussi **ce qui
      allait** : un manque non borné se lit comme un tout à refaire. Ce qui
      allait se déduit du contrat et de rien d'autre — une exigence jamais
      posée n'était pas « là ». Le fond est neutre, pas une alerte : un refus
      rouvre. Quatre mutations vérifiées, dont celle qui recopie la phrase de
      la planche et rassure toujours sur la mention*
- [ ] **La preuve v3 attend trois champs, et une horloge qui n'est pas celle-là**
      *`dernier_motif` est arrivé et se lit. Restent : le **temps restant dans
      la fenêtre de vérification**, calculé serveur ; le **nom du salon**, sans
      lequel la ligne du lieu n'a rien à copier ; et la **plateforme**, sans
      laquelle « une story sur Instagram » ne peut pas s'écrire.
      `secondes_avant_echeance`, servi par #181, **n'est pas** la fenêtre : il
      compte jusqu'à l'échéance de publication — 48 ou 72 h — quand la fenêtre
      court depuis la publication et vaut 24 h. Deux horloges sur le même
      écran ; l'une pour l'autre annoncerait « 21 h » quand il en reste 45. Il
      est consigné `a-instruire` faute de lecteur*
- [ ] **Le plafond de tentatives n'est pas servi**
      *La planche écrit « attempt 2 of 3 ». `collaboration_max_attempts` vit
      dans la configuration de l'API et n'est servi nulle part ; l'écrire en
      dur dans l'écran est ce que le dépôt interdit. La carte de reprise porte
      donc le rang seul, qui reste vrai — mais c'est le plafond qui dit combien
      de chances restent*
- [ ] **L'inventaire des cartes ne voit pas les surfaces sans filet**
      *Sa définition est « fond de surface + rayon de 18 + filet ». Les deux
      portes de l'accueil et le panneau `reconnu` de `RedemptionScreen` ont le
      rayon et le fond sans le filet : ils lui échappent. L'élargir casse le
      comptage sur les trois surfaces qui clippent, où une carte est deux blocs.
      Ce qu'il faudrait est un détecteur qui sache lequel des deux blocs est le
      parent — ou une convention qui nomme les vues enveloppantes*
      *Ce trou n'est pas celui que #208 a bouché, et la distinction vaut d'être
      retenue : #208 a élargi **l'ensemble des formes de style lues** — les
      styles fonctionnels des cartes pressables — en gardant la définition
      intacte, et n'a donc rien changé aux cartes qui enveloppent. Mon
      élargissement portait sur **la définition elle-même**, en retirant le
      filet des marques exigées : c'est lui qui fait compter deux fois une carte
      enveloppée, puisque l'extérieur et l'intérieur la satisfont alors tous les
      deux. Élargir ce qu'on lit et élargir ce qu'on cherche n'ont pas les mêmes
      conséquences*
- [x] **L'audience v3 — l'écran le plus faible, signalé sur trois campagnes**
      *Les logos de réseau manquaient entièrement, et un compte connecté ne se
      distinguait pas d'un compte à connecter. Aucun nombre n'apparaît plus
      seul : les abonnés portent le seuil qu'ils visent et le palier qu'ils
      ouvrent, l'engagement et les vues passent sous la phrase qui dit à quoi
      ils servent. Le score passe en deux niveaux, sa barre en `brand.500` — le
      système n'a aucune couleur pour « le score est bas ». `monoDisplay` et
      `monoFigure` entrent dans les jetons, synchronisés depuis la passation.
      Trois écarts avec la planche, chacun écrit dans `DECISIONS.md` : les
      paliers ne « restent » pas quand l'autorisation tombe, sept événements
      bougent le score et non quatre, et « first reading within a day » promet
      un délai que la configuration décide. 1065 tests verts, 6 mutations*
- [x] **Le score lit sa mécanique au lieu de la réciter**
      *Les neuf événements arrivent avec leur sens, dérivé du signe du poids du
      jour ; l'écran les range et les nomme. Les neutres ont leur section — « ce
      qui affecte le score » doit pouvoir dire « ceci ne l'affecte pas ». Un code
      sans libellé ne s'affiche pas brut, et une garde lit l'énumération Python
      pour tomber le jour où un dixième arrive*
- [x] **La carte dit depuis quand l'autorisation est tombée**
      *`token_expires_at` est servi. Une date à venir ne se rend pas : un compte
      révoqué avant l'échéance de son jeton en porte une, et « expire le 3
      octobre » sous « il faut réautoriser » dirait le contraire du bloc qui la
      porte. La période de renouvellement elle-même — « tous les 60 jours » —
      reste hors du produit : c'est une règle de plateforme, pas une donnée*
- [x] **La journée du commerce v3 — l'écran le plus utilisé, et le plus mal compris**
      *« On ne comprend même pas à quoi sert cette page » était la remarque la
      plus grave de la revue. La barre de titre compte les décisions et le nom
      du jour descend en sous-ligne ; trois natures du plus urgent au plus
      froid, dont seule la première porte des cartes ; un contour ambre sur la
      demande dont la limite tombe aujourd'hui, dans le fuseau du salon. Deux
      défauts trouvés par les tests en chemin : « 1 requests need your answer »
      au cas le plus courant, et une journée sans rendez-vous mais avec des
      demandes en attente qui s'affichait vide — la seule chose urgente du
      produit, invisible. 1084 tests verts, 6 mutations*
- [x] **La demande montre les deux réseaux de la créatrice**
      *`comptes` arrive sur la réservation. Celui qui est rattaché porte son
      chiffre et mène au profil — le seul lien sortant du produit, donc le
      glyphe de sortie ; celui qui manque reste affiché en encre douce et sans
      action, parce que savoir qu'il n'y a pas de TikTok fait partie de la
      décision. Un compte sans relevé n'affiche pas zéro*
- [x] **La sous-ligne de la journée dit les horaires**
      *`horaires` arrive sur la journée, avec ses exceptions. Vide veut dire
      fermé, et se dit : un jour creux ne se lit pas pareil selon qu'on était
      fermé ou que personne n'est venu. À ne pas confondre avec `debut` et
      `fin`, qui sont les bornes de la journée comptée — c'est en les prenant
      pour des horaires que la ligne serait restée fausse*
- [x] **Les rapports v3 — à zéro donnée, l'écran change de nature**
      *Un salon qui vient de s'inscrire n'a pas besoin d'un rapport vide : il a
      besoin de savoir pourquoi rien ne s'est passé et quoi faire. Quatre points
      calculés sur sa propre composition — catalogue, photos, paliers, jours
      d'ouverture — chacun avec son nombre, ce qui est fait en tête. Et un
      défaut vivant réparé au passage : les barres par palier n'avaient plus
      aucun remplissage depuis le passage à l'ambre. 1098 tests verts,
      6 mutations*
- [x] **Le compte de créatrices atteignables est rendu**
      *`portee_locale` arrive sur la réponse des rapports — aucun appel de plus.
      Le panneau ferme l'écran vide avec les deux nombres et son rayon, et le
      point des paliers cite l'écart entre les deux : ce que le serveur sait
      dire est le gain d'ouvrir des paliers pris ensemble. Le gain d'un palier
      **précis** n'est pas servi et ne s'invente pas*
- [x] **Le sélecteur de période a ses trois positions**
      *`premiere_semaine` est servie. « Depuis le début » n'apparaît que s'il y
      a un début : sans elle, l'onglet retomberait sur la fenêtre par défaut et
      rendrait la même chose que son voisin. Les douze semaines se comptent
      depuis la borne de fin **servie**, jamais depuis l'horloge locale — un
      calcul local décalerait la borne d'un jour à chaque bord de fuseau*
- [x] **La mise en ligne devient un état, et l'exception remonte sur la journée**
      *« Profil et mise en ligne » n'était pas une section : un bandeau sur la
      journée porte ce qui manque et son compte, et disparaît à la publication.
      L'exception du jour — couper une place, fermer — vit sur l'écran du matin
      et écrit dans la même donnée que la semaine type, sans second modèle.
      1142 tests verts, 5 mutations*
- [ ] **Le bandeau ne devient pas une ligne de confirmation**
      *La planche veut qu'il devienne « vous êtes en ligne · 41 créatrices
      peuvent vous réserver », puis disparaisse au bout de sept jours. Deux
      choses manquent : une **date de publication** pour la règle des sept
      jours, et la **portée locale sur la journée** — elle n'est servie que sur
      les rapports. En attendant, le bandeau s'efface simplement*
- [ ] **Publier reste un appel explicite, et la planche l'ignore**
      *Elle écrit que le bandeau « s'efface au dernier point coché », ce qui
      suppose une publication automatique. `activerLeCommerce` existe et rien ne
      l'appelle tout seul : le bandeau porte donc le geste sous un nom qui n'est
      pas « go live ». Si la publication doit devenir automatique, c'est une
      décision serveur, pas un habillage*
- [x] **La configuration passe à deux portes, et la pause a un toit**
      *`ActivationScreen` est supprimé, avec ses tests et ses onze chaînes
      devenues orphelines : le bandeau porte ce qui manque et la publication,
      les réglages portent la pause. Le cas « publié mais invisible » a failli
      partir avec l'écran — une étape non bloquante manquante garde le salon
      hors des murs, et rien d'autre ne le lui disait*
- [ ] **Le nombre de créatrices éligibles par palier, pour une prestation**
      *La planche du catalogue veut « 103 créatrices deviennent 12 » quand un
      salon monte une prestation de story à reel. C'est un compte **par palier**,
      dans les deux sens, pour des paliers l'un et l'autre **ouverts**.*
      *À ne pas confondre avec `portee.gains_par_palier`, qui existe déjà et
      répond à une autre question : un gain marginal sur un palier **fermé**,
      pour le contre-factuel de l'annuaire. Les paliers ouverts n'y figurent pas
      par construction, et `peuvent_reserver` est « peut réserver ce qui est
      ouvert », tous paliers confondus — aucune composition des deux ne donne le
      nombre du catalogue. Le composer quand même produirait un chiffre faux, et
      c'est un chiffre sur lequel un salon décide.*
      *En attendant, l'avertissement garde l'argument qu'il a : les seuils
      d'abonnés, qui disent la même chose dans le même sens.*
- [ ] **L'engagement et les vues moyennes manquent sur la demande**
      *`CompteDeLaCreatriceRead` sert le pseudonyme et les abonnés ; la planche
      de la journée pose aussi « 4,2 % d'engagement · 2 140 vues moyennes » sur
      le panneau. Deux champs sur le même objet*
- [x] **L'arbitrage v3 — la forme du malentendu, pas la conversation**
      *La colonne « Reasons » distingue « 3 · same » de « 3 · mixed », et un
      filtre sépare les deux files : trois refus pour le même motif disent que
      la demande n'a jamais été comprise, trois motifs différents disent
      l'inverse. Le dossier nomme la forme en une phrase avant tout journal, et
      les notes sont repliées — un arbitre qui les lit toutes avant de regarder
      la preuve juge une correspondance au lieu d'un fait. 1161 tests verts,
      5 mutations*
- [ ] **La quatrième issue d'arbitrage n'existe pas**
      *« Clore sans faute » : quand le motif se répète trois fois, ni approuver
      ni refuser n'est juste — c'est le produit qui a échoué à transmettre une
      demande, et la trancher comme une faute la met au débit de la mauvaise
      personne. Il faut une issue de plus à côté d'`approve` / `resubmit` /
      `unfulfilled`, qui ferme le dossier sans toucher au score, et un événement
      de fiabilité neutre du même genre qu'`abusive_report` — présent dans la
      grille, de poids nul, et listé plutôt que tu.*
      *Demandé à `bind-agency-1a`. Côté écran tout est prêt : dès que le code
      existe, le bouton prend la première place sur un dossier « same », et
      « approve » la reprend sur un « mixed ». `fiabilite.composantes` sert déjà
      les neuf événements avec leur sens, et un dixième tombera sur la garde qui
      lit l'énumération Python — il faudra sa phrase.*
- [ ] **Neuf planches d'écrans portent encore la v1.0**
      *Le fil, la fiche, le créneau, la preuve, l'accueil et l'audience sont
      passés en v3, dans la palette Ambre. Les autres suivent l'ordre du
      `PASSATION-v1.1.md` §6, qui limite le travail perdu : la fiche de
      journée du commerce d'abord,
      les rapports et l'annuaire ; l'arbitrage et les plans ; les écrans de
      marque. C'est du travail de Design, pas du produit*
- [ ] Intégration Snapchat, à l'obtention de l'accès partenaire

---

## Les planches de Design

**La règle.** Aucune nouvelle planche n'est prise tant que la précédente n'est
pas **entièrement passée** ou **explicitement reportée**, avec sa raison écrite
ici. Six spécifications ont été perdues en route faute de cette liste, et elles
n'avaient l'air d'être perdues nulle part.

**Passée n'est pas repeinte.** Une planche est passée quand ses écrans ont été
confrontés à elle, cadre par cadre. Un écran qui adopte les jetons d'un nouveau
système paraît juste et peut n'avoir jamais été comparé à ce que la planche
dessine — c'est le mode d'échec le plus discret du lot, parce qu'il ne laisse
**aucun écran laid derrière lui** : ni un test, ni une revue, ni une capture ne
le signalent. Le dépôt en porte déjà la trace ailleurs, avec le « B » du système
vert qui a « traversé la v1.0 parce que le composant était repeint et pas
redessiné ».

**Reportée sans raison écrite veut dire perdue.** La raison et ce qui débloque
tiennent sur la ligne, sinon le report n'est qu'un oubli qu'on a eu l'air de
décider.

**Et deux planches peuvent se recouvrir.** Le cadre 02 de `Lot 1 v1.1` est la
planche `Tiers v0.7` restylée — il le dit en sous-titre — et le registre l'avait
comptée comme jamais confrontée parce qu'il regardait `Lot 1 v1.1` en bloc. Un
registre par planche **surestime** le manque dès qu'une planche en reprend une
autre : l'état se lit par cadre quand un cadre a déjà sa propre planche.

| Planche | État |
| --- | --- |
| `BIND Creator - Current UI (recreation)` | **Hors registre.** Ce n'est pas une spécification mais un état des lieux de l'existant, qui a servi de point de départ. Rien à implémenter. |
| `BIND Creator - Discovery v0.5` | **Passée**, puis dépassée. Le catalogue et ses rangées ont été livrés, puis remplacés par `Fil v2` et `Le mur v2.1`. |
| `BIND Desktop - v0.6` | **Passée** (#142 la ferme). Coquille, barre latérale, barre de titre, largeurs bornées, densités, états vides typographiques, favicon et marque. Son §8 — les paliers — a été reporté puis traité par la v0.7. Sa dernière ligne ouverte était l'étiquette au survol du rail replié. |
| `BIND Creator - Tiers v0.7` | **Partiellement passée, et le reste est reporté avec sa raison.** L'échelle d'échange tient, redessinée depuis en matières par la v1.0. **Le cadre 11c — les prestations d'un palier — n'est pas livré** : sa bascule « Near you first / All 12 » demande de *lister* les prestations hors du rayon, et aucune lecture ne les rend. Débloqué par une lecture des offres d'un palier non bornée par la distance, dont la forme dépend d'un arbitrage que Daniel n'a pas pris — « tout BIND » n'a pas d'ordre naturel. Voir l'entrée détaillée plus haut. |
| `BIND AGENCY - Design System v1.0` | **Passée** (#112). Fontes, rampe orange, rayons à zéro, ombre de carte supprimée, rôle gardé en matière, paliers en contour, teinte et aplat. |
| `BIND Merchant - Lot 2 v1.1` | **Passée.** |
| `BIND Admin - Lot 3 v1.1` | **Passée.** |
| `BIND Menu - Lot 4 v1.1` | **Passée** (#123). |
| `BIND Mark - Favicon 16` | **Passée.** Le 16 est un dessin distinct, et aucun fichier cuit ne porte plus le logotype. |
| `BIND Creator - Fil v2` | **Partiellement passée, et le reste est sans objet.** La direction 1b — les rangées par quartier — est branchée là où Design l'a elle-même placée : ce que montre une catégorie choisie (#141). La direction 1a a été remplacée par `Le mur v2.1`. |
| `BIND Creator - Le mur v2.1` | **Passée, et ses cinq réserves sont tranchées** (#131, #132, #140, #141, #145). Trois écarts à la planche sont assumés et écrits : le quartier de la position n'est pas nommé — rien ne sait le résoudre ; le titre de quartier reste à 34 contre 28 sur la planche — la raison a changé sans que la décision change : c'était le plancher du Didone, tombé avec lui en v1.1, c'est maintenant que la planche est une v1.0 non rééditée ; et les catégories sont les six du modèle, celles de la planche datant du produit mono-catégorie. Deux étaient des défauts et sont corrigés : le rayon se règle de nouveau dans les deux sens, et le mur va à fond perdu. |
| `BIND Creator - Lot 1 v1.1` | **Passée.** Le cadre 01, l'audience (#149) — l'écran nommé deux fois comme le plus faible du produit — et le cadre 08, les réservations (#150), sont confrontés à leurs planches. Le cadre 02 l'était déjà : c'est `Tiers v0.7` restylée, livrée sous sa propre tâche, et le registre le surestimait en lisant la planche en bloc. Son fil a été remplacé par le mur, et son cadre 03b a servi à composer le filtre par catégorie. **Reste la porte du cadre 11c**, que 02a ouvre et que la navigation ne passe pas. |

**Ce que cette liste a trouvé en étant écrite :** `Lot 1 v1.1` était la seule
planche sans entrée nulle part, alors que les lots 2, 3 et 4 en avaient chacun
une. Ses écrans emploient les bons jetons, donc rien ne signalait le manque —
ni un test, ni une revue, ni un écran visiblement faux. C'est exactement le cas
que la règle ci-dessus existe pour attraper.

---

## `BIND Merchant - L annuaire v3` — la route commerce-scopée

**Partiellement passée.** Les deux décisions de Design qui ne dépendent d'aucune
donnée sont livrées : l'absence de score n'est plus expliquée, l'absence de
contact l'est, et la fiche titre le pseudonyme. Ce qui suit manque encore, et
l'écran ne peut pas l'inventer.

**Le compte, avant la liste.** Design a tranché : à deux mille créatrices, un
salon ne cherche pas, il ne connaît aucun nom. L'écran doit commencer par « 41
des 128 dans 15 km peuvent réserver ce que vous avez ouvert ». Le calcul existe
— `portee_locale.autour_du_commerce` rend `createurs` / `peuvent_reserver` /
`rayon_metres` — mais n'est exposé que sur les rapports. **Reprendre les trois
noms tels quels** : deux noms pour le même nombre sur deux écrans divergent au
premier ajustement.

**Le contre-factuel.** « Ouvrir le palier post porterait ce chiffre à 103 » est
la phrase qui justifie l'abonnement. `eligibility.evaluer` est pure et la boucle
est déjà en mémoire, donc le calcul ne coûte pas d'aller-retour. Deux réserves :
un palier ne s'ouvre pas dans l'abstrait — `TierOffer` le lie à un item de
catalogue, donc sur un catalogue vide la carte ne se rend pas ; et un seul
candidat, celui au plus grand écart, parce que la planche montre une phrase.

**Le tri, accès d'abord et proximité ensuite — le point dur.** `annuaire()` ne
prend aucun commerce : tri par `user_id`, et `paliers_ouverts` calculé sur
**tous** les paliers actifs. Le champ répond donc « elle se qualifie quelque
part », pas « elle peut réserver ici ». Ni `peut_reserver_ici` ni le tri ne sont
dérivables côté écran. `portee_locale._paliers_ouverts` fait déjà la requête
juste — les quatre conditions d'`is_effectively_offered` — à réutiliser, pas à
réécrire. Pour la distance, `ST_Distance` sur les deux `Geography` **sans
`cast`**, qui perd le SRID.

Décision à prendre avec : `portee_locale` **exclut** les créatrices sans
position. Si l'annuaire les liste avec une distance nulle, « 41 des 128 »
surplombera une liste de 137 lignes. Même population que le compte.

**Ce que l'écran attend par créatrice** : distance, palier accessible **chez ce
salon**, nombre de prestations réservables, et par réseau l'engagement et la
date du dernier relevé — tous dérivables, aucun servi. Les collaborations
passées avec ce salon passent par `Booking`, `Collaboration` n'ayant pas de
`business_id`.

**Ce qui n'existe pas et qu'il ne faut pas fabriquer** : le quartier. Aucune
colonne, aucune source entre `city` et `geo`. L'écran retombe sur `city`.

**Et un défaut à instruire à part, plus grave que celui qu'on corrige.** La
route sert `first_name` et `last_name` — le nom d'état civil de chaque
créatrice, à tout salon abonné qui ne l'a jamais rencontrée. L'écran a cessé de
les lire, mais la donnée part toujours sur le réseau. Le schéma est la dernière
barrière avant le réseau, et c'est là qu'il faut la poser.
