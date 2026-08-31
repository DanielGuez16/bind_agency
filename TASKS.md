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
- [x] **`pytest -n auto`, une base par worker**
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
      *La porte du cadre 11c — « See the 34 services » — a été livrée depuis :
      `onVoirLesPrestations` mène à `PrestationsDuPalier`, sur une lecture non
      bornée par le rayon. Cette note disait encore « la navigation ne le passe
      toujours pas », six semaines après qu'elle le passe*
- [x] **Trois minuteurs tenaient le worker, et le diagnostic d'avant était faux**
      *« A worker process has failed to exit gracefully » sortait à **chaque**
      exécution, depuis assez longtemps pour qu'on ait cessé de le lire. La
      suite passe : c'est ce qui le rend coûteux — tant qu'il sort toujours, il
      ne dira rien le jour où une vraie fuite arrive.*
      ***Ce qui avait empêché de le trouver était un raisonnement, pas un
      outil.** L'enquête concluait « ce n'est pas un fichier » parce que
      l'avertissement disparaît à `--maxWorkers=1`. À un worker, Jest s'exécute
      **en bande**, dans le processus principal : il n'y a alors aucun worker
      qui puisse échouer à sortir. La disparition ne disait rien du coupable,
      elle disait qu'il n'y avait plus de worker — et `--detectOpenHandles`
      force le même mode, donc il ne nommait rien parce qu'en bande il n'y avait
      rien à nommer.*
      *L'outil manquant est `--no-cache` : sans horodatage en cache, Jest ne
      peut plus décider que la série sera courte et rapide, et il fait tourner
      ses workers **même sur deux fichiers**. Chaque fichier passe alors seul
      avec un fichier propre ; cinq sur cent deux ont répondu, de façon
      reproductible.*
      *Trois causes. `client.ts` posait son échéance sans `unref` : une écriture
      dont la réponse n'arrive pas — le décor qui sépare l'optimiste de
      l'attente — tenait un minuteur quinze secondes après la fin du test, et
      rien n'annule un `POST`. `usePosition` n'éteignait pas le minuteur de sa
      course une fois celle-ci jouée : dix secondes de plus après une position
      arrivée en une milliseconde. `ContratDeLaPreuve` posait le retour du
      bouton « copié » dans le geste plutôt que dans un effet — quitter l'écran
      dans les deux secondes écrivait dans un composant démonté.*
      *Et quatre décors rendaient `new Promise<Response>(() => {})`, qui ne
      modélise pas un réseau lent mais un `fetch` qui ignore son signal. Le vrai
      rejette quand on l'annule ; sans cela le `finally` du client n'est jamais
      atteint et aucun test n'emprunte le chemin d'annulation.
      `reponseQuiNArrivePas` ne répond pas davantage, il écoute `abort`.*
      ***Non exigé en intégration continue, et c'est délibéré.** L'avertissement
      dépend d'un budget de démontage de 500 ms sur un runner partagé : c'est le
      profil exact de la garde de durée, retirée après quatre CI rouges et rien
      trouvé d'autre qu'elle-même. Les trois causes sont tenues par des tests
      unitaires, qui ne dépendent d'aucune machine, et la famille de décors par
      une garde textuelle. 4 tests neufs plus 4 sur la garde, 5 mutations*
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
- [x] **Treize méthodes d'API que personne n'appelle**
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
- [x] **Prévenir doit coûter moins que disparaître**
      *`cancelled_late`, troisième événement de fiabilité, poids `-5` en
      configuration contre `-25` pour l'absence. Les deux coûtaient pareil,
      donc rien n'incitait à prévenir. **Le dossier arrive en `cancelled`** —
      elle a annulé, pas disparu — et c'est l'événement qui porte la nuance ;
      `no_show` reste ce que le commerce constate. `SPEC.md` §4.1 mis à jour.
      5 tests neufs, 1 repris*
      ***Le poids a bougé, et c'est le test d'équilibre qui l'a fait bouger.**
      Livré à -10, il posait 70 − 10 = 60 : exactement le minimum du reel, où
      l'on ne passe que parce que la comparaison est `>=`. Prévenir tard coûtait
      donc le haut de l'échelle à un point près — l'inverse de ce que
      l'événement existe pour faire. Descendu à -5, cinq points de marge, et le
      test les affirme en toutes lettres pour le prochain réglage. Une
      annulation tardive est une faute légère, pas une demi-absence.*
- [x] **Annuler ce que le salon n'a pas accepté, et couper l'appareil perdu**
      *Trois tranches. Le **défaut** d'abord : `annuler` visait `no_show` sans
      regarder d'où elle partait, et `awaiting_business` n'a pas cette flèche —
      les deux délais valant 24 h, toute demande en validation à moins d'un jour
      levait au lieu de s'annuler. `SPEC.md` §4.1 mis à jour avec la raison, et
      le `xfail(strict)` retiré : il a fait exactement ce pour quoi il était
      strict. Puis `annulation_sans_frais_jusqu_a`, nulle quand l'annulation est
      toujours libre. Puis `GET /me/devices` et la révocation **par
      identifiant** : le jeton est un secret, et on ne l'a pas quand l'appareil
      est perdu. 11 tests neufs, 6 mutations vérifiées*
- [x] **Les photos de plateforme partent, avec leur table**
      *Vérifié avant de retirer : les pastilles du fil sont des **mots
      traduits**, leurs comptes viennent de la route du fil, et aucun écran ne
      lit `photo_key` d'une catégorie. La vidéo d'accueil était déjà partie avec
      la v3. Route, schéma, service, modèle, semis, deux tests de semis, la
      garde de surface publique, la carte, la méthode du client, ses types — et
      la table. Une capacité retirée à moitié repousse*
- [x] **Archiver plutôt qu'effacer, et remplacer plutôt que réécrire**
      *La donnée décide, pas le geste : jamais réservée → suppression vraie,
      déjà réservée → archive et jamais de suppression. **`archived_at` distinct
      de `is_available`** — fermer pour l'été et retirer pour de bon valaient la
      même chose, et l'écran devait choisir entre perdre la saisonnière et garder
      les archives pour toujours. `reservations_count` fait dire au bouton ce
      qu'il déplace. La modification se coupe en deux : présentation par `PATCH`,
      accord par `POST /replace`, qui crée la neuve et archive l'ancienne dans
      une transaction. 11 tests neufs, 5 mutations dont une conservée et
      documentée*
- [x] **Le filtrage de l'annuaire, et le total qui va avec**
      *Palier — répétable, au moins un des formats —, réseau, distance
      maximale. **`total` recalculé sur le filtre** : sans lui « 20 sur 128 »
      ment dès qu'un filtre est posé. Le filtre s'applique **avant la page**,
      pour la même raison que le tri : filtrer une page n'est pas filtrer la
      liste, et la page suivante rendrait un autre sous-ensemble. Une position
      inconnue n'est écartée que par le filtre de distance — le seul qui demande
      une garantie qu'on ne peut pas donner d'elle. 7 tests neufs, 4 mutations*
- [x] **La grâce a trois états, et le voisinage part**
      *`grace_ends_at` sur le commerce, et non sur l'abonnement : la route de
      l'abonnement rend `null` quand il n'y en a pas, c'est-à-dire exactement
      dans les deux états où le bandeau a quelque chose à dire. `status` ne les
      distingue pas — un salon en grâce et un salon abonné sont tous deux
      `active`. `reperesDuVoisinage` retirée de bout en bout, `portee_locale`
      l'a remplacée : route, schéma, service, deux réglages, ses tests et deux
      lignes de la carte. `revoquerUnTerminal`, `modifierUnItem` et
      `supprimerUnItem` restent, avec leur raison écrite. 2 tests neufs*
- [x] **Trois dettes nommées retirées, et deux chiffres ajoutés**
      *`engagement_rate` et `avg_views` sur le compte d'une demande : le second
      chiffre de la décision, souvent le premier regardé. **Aucun mécanisme ne
      les remplit encore** — le relevé de profil pose `None` aux deux, ils se
      calculent sur les publications et viendront avec `fetch_media`. Le contrat
      est posé, la mesure suivra. Retirés : le média d'accueil de la v3, le
      compte à rebours sans lecteur, et la couverture 4:5 du mur supprimé —
      **la colonne et les vingt photos restent**, seul le contrat les quitte.
      2 tests neufs, 7 retirés avec le code mort, 2 mutations vérifiées*
- [x] **Qui a préparé quoi, et qui a remis**
      *`prepared_by` relu du **journal d'audit** et non de `issued_by_user_id` :
      le lien est nul tant que rien n'a été remis, c'est-à-dire exactement sur
      les fiches qui attendent qu'on passe. `remis_par` à côté, distinct — la
      même personne fait souvent les deux, pas toujours, et les confondre ferait
      mentir la comparaison. Sans eux, le taux d'activation par voie compare
      deux démarcheurs en croyant comparer deux méthodes. Une adresse et non un
      nom : un compte d'équipe n'en a pas. 4 tests neufs, 3 mutations vérifiées*
- [x] **Le suivi de tournée : trois états, pas un**
      *`opened_at` posé au premier aperçu, `blocked_at` à chaque prise en main
      refusée. **Les deux premiers états étaient indistinguables** — un lien
      jamais vu et un lien vu puis abandonné rendaient la même ligne, et ce sont
      précisément les deux cas où la conduite diffère : revisiter, ou relancer.
      Le troisième — arrêté sur l'engagement — se lit **sans que l'écran ait
      rien à rapporter** : une tentative refusée est quelqu'un arrivé jusqu'au
      mot de passe et bloqué là. `etat` dérivé des dates, jamais stocké.
      `channel` était déjà servi. 8 tests neufs, 5 mutations vérifiées*
- [x] **Ce qui informe un prix : la durée, la catégorie, la portée**
      *`subscription` n'avait **aucune date** — ni ouverture ni fin, seulement
      `current_period_end` — donc aucune durée n'était calculable. Deux colonnes,
      reprises du journal d'audit **seulement quand un commerce n'a souscrit
      qu'une fois**, nulles sinon : deviner rendrait une médiane que personne ne
      sait lire. **Deux médianes servies séparément**, terminée et en cours,
      chacune avec son effectif — la censure à droite ne se résout pas en
      moyennant les deux, elle se cache. `abonnes_par_categorie` sert la
      catégorie des **abonnés**, distincte de celle du plan.
      `GET /business/{id}/tier-offers/creatrices-par-palier?catalog_item_id`
      rend un **total** par palier, ce qu'aucune composition de
      `gains_par_palier` ne donne. 9 tests neufs, 5 mutations vérifiées*
- [x] **L'annuaire est celui d'un salon, pas celui du produit**
      *`annuaire()` prend le commerce : `paliers_ouverts` dit « elle peut
      réserver ce que vous avez ouvert » et non « elle se qualifie quelque
      part » — le manque qui comptait le plus. Plus `peut_reserver_ici`,
      `palier_accessible` (le plus exigeant des ouverts), `distance_metres`, le
      tri **accès d'abord puis proximité** côté serveur, la pagination et le
      `total`. Les paliers du salon sont relus par la fonction qui sert déjà le
      compte de portée — deux lectures de « ce que ce commerce offre »
      finiraient par diverger. 9 tests neufs, 6 mutations vérifiées*
- [x] **Fermer sans faute : la quatrième issue de l'arbitrage**
      *`closed_no_fault`, terminale, **sans aucun événement de fiabilité** — ni
      positif ni négatif. Un événement neutre de poids nul aurait presque suffi
      et pas tout à fait : `evaluer` rend un score dès qu'un événement existe,
      et la créatrice serait passée de « pas encore de score » — condition
      ignorée par les paliers — à un nombre comparable à leur seuil. Ne rien
      écrire est la seule façon de ne rien changer. `repetitions_du_dernier_
      motif` et `meme_motif_repete` sur la file, comptés **de suite** et non en
      tout. `GET /admin/collaborations/motifs-qui-reviennent` compte les
      dossiers où un motif boucle : un signal sur le produit, pas sur les
      créatrices. 13 tests neufs, 6 mutations vérifiées*
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
- [x] **La preuve v3 attend trois champs, et une horloge qui n'est pas celle-là**
      *`dernier_motif` est arrivé et se lit. Restent : le **temps restant dans
      la fenêtre de vérification**, calculé serveur ; le **nom du salon**, sans
      lequel la ligne du lieu n'a rien à copier ; et la **plateforme**, sans
      laquelle « une story sur Instagram » ne peut pas s'écrire.
      `secondes_avant_echeance`, servi par #181, **n'est pas** la fenêtre : il
      compte jusqu'à l'échéance de publication — 48 ou 72 h — quand la fenêtre
      court depuis la publication et vaut 24 h. Deux horloges sur le même
      écran ; l'une pour l'autre annoncerait « 21 h » quand il en reste 45. Il
      est consigné `a-instruire` faute de lecteur*
- [x] **Le plafond de tentatives n'est pas servi**
      *La planche écrit « attempt 2 of 3 ». `collaboration_max_attempts` vit
      dans la configuration de l'API et n'est servi nulle part ; l'écrire en
      dur dans l'écran est ce que le dépôt interdit. La carte de reprise porte
      donc le rang seul, qui reste vrai — mais c'est le plafond qui dit combien
      de chances restent*
- [x] **L'inventaire des cartes ne voit pas les surfaces sans filet**
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
      *Et ce n'est pas non plus le troisième, comblé depuis : la **fenêtre de
      lecture**. La garde découpait un bloc de style sur neuf cents caractères,
      et une carte plus longue sortait de l'inventaire sans erreur ni
      avertissement — quatre lignes de prose ont suffi, une fois. Le découpage
      suit maintenant l'imbrication des accolades et n'a plus de longueur
      maximale. **Trois trous distincts dans une seule garde** : ce qu'elle lit,
      ce qu'elle cherche, et jusqu'où elle lit*
      *Le troisième est comblé à son tour. La bonne question n'était pas
      « lequel des deux nœuds est le parent » mais **« lequel des deux porte
      l'ombre »** : la moitié intérieure d'une carte enveloppée est celle qui
      clippe **sans** porter d'élévation, et elle n'a pas à en réclamer une. Le
      filet quitte donc la définition sans casser le comptage. Deux surfaces
      pleines entrent à l'inventaire — les portes de l'accueil, le panneau
      reconnu de la caisse, qui a reçu son ombre — et une pastille en sort :
      `KeyHint` portait `radius.lg` sur quatorze points de haut, là où les
      jetons réservent `sm` aux pastilles*
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
- [x] **La confirmation d'adresse rendait du JSON dans un navigateur**
      *`{"id":"…","email":"…","role":"creator"}` sur le **tout premier geste**
      que quelqu'un fait avec BIND, et sur le seul écran qui décide s'il
      continue. La mécanique était juste — le jeton consommé, l'adresse
      vérifiée — c'est ce qu'il voyait qui était faux.*
      *Une page HTML sobre, sans rien d'extérieur : ni feuille de style
      distante, ni police, ni image. Elle s'ouvre parfois dans le navigateur
      intégré d'un client de messagerie, sur le réseau d'un salon, et une page
      qui dépend d'un second aller-retour est une page qui reste blanche.*
      ***Le refus reçoit le même soin, et c'est là que le gain est le plus
      grand** : un jeton déjà consommé est presque toujours quelqu'un qui a
      cliqué deux fois, et `{"detail":"email_verification_invalid"}` se lit
      comme une panne. Le code reste 400 — le navigateur n'en fait rien, et
      mentir sur le statut troublerait ce qui lit vraiment les codes.*
      *La langue vient du compte quand on sait qui lit, de l'en-tête du
      navigateur sinon : un jeton inconnu ne désigne personne, c'est même la
      raison pour laquelle il est refusé. Les textes sont au catalogue serveur,
      dans les deux langues. 4 tests, 3 mutations*
- [x] **Le nom civil des créatrices : retiré depuis, et désormais éprouvé**
      *Vérifié avant d'agir, et le constat était périmé : `CreateurVuRead` ne
      porte ni prénom ni nom depuis la #201, et aucune autre réponse servie à
      un commerce ne les porte — la file d'arbitrage montre `creator_handle`.
      La donnée ne partait plus.*
      ***Mais rien ne le tenait.** La garantie reposait sur une absence : ajouter
      `first_name` au schéma « pour la commodité de l'écran » l'aurait rendue à
      tout salon abonné sans faire tomber quoi que ce soit. Un test l'épingle
      maintenant, sur un décor qui pose un vrai nom — un profil sans prénom
      passerait quelle que soit l'implémentation. Mutation vérifiée sur la fuite
      complète : colonne au select, champ au service, champ au schéma.*
- [x] **La règle des 400 ms n'était vraie qu'au second lancement**
      *Un fil consulté hier repartait d'un écran de chargement, alors que la
      réponse d'hier est presque toujours la bonne — des salons n'apparaissent
      pas en une nuit. La dernière réponse réussie est rangée, et l'écran la
      pose immédiatement pendant que la requête part quand même.*
      ***L'inscription est au cas par cas, jamais par défaut.** Sept points
      d'appel : l'appartenance, le fil, la fiche d'un salon, son catalogue, les
      paliers du créateur, les plans. Ce qui n'y entre pas est la moitié qui
      compte — disponibilité, journée, réservations, contreparties, codes de
      retrait, reprises de compte : toutes décident d'un geste à l'instant où on
      les lit, et une réponse d'il y a dix minutes y ferait tenir un créneau
      déjà pris.*
      *Trois règles. La clé porte une **version**, parce qu'un champ retiré du
      contrat ne se verrait qu'en production. Tout est effacé à la fermeture de
      session **et à l'ouverture** — une application tuée sans déconnexion
      laisse son cache à la personne suivante. Et passé un âge on n'affiche plus
      rien : un fil de la semaine dernière ment avec l'aplomb du frais.*
      *Le cache ne remplace jamais une réponse déjà arrivée — c'est le cas du
      réseau rapide, et celui qu'on casserait sans y penser. 7 tests, 7
      mutations. Le vidage n'emporte que nos clés : le salon choisi et les
      préférences d'appareil ne sont pas des réponses.*
- [x] **Le mur montait quatre-vingts images d'un coup**
      ***Le plafond suivant, et il ne se voyait pas dans les octets.** La
      vignette a ramené le fil de 10,5 Mo à 0,8 ; mais `Image` décode avant de
      réduire, et le coût du décodage ne dépend pas du cadre où on pose la
      photo. Une grille en `ScrollView` et `.map` montait donc toutes ses
      rangées à la première image — vingt salons, quatre-vingts `Image`.*
      *`Ecran` prend un mode **liste** : le corps nominal passe en `FlatList`,
      les trois autres états restent dans le défileur ordinaire — ils tiennent
      en un écran et n'ont rien à virtualiser. Additif : aucun écran ne change
      tant qu'il ne le demande pas, et le fil est seul à le demander.*
      ***Une seule construction du contenu, pas deux.** `useMur` produit
      l'en-tête, les rangées et le pied ; `SectionsParQuartier` les pose dans un
      bloc, le fil les confie au défileur. Deux constructions du même mur
      finiraient par diverger — c'est la faute déjà vue ailleurs dans ce dépôt.
      Les marges vivent donc sur la rangée, seule écriture qui rende la même
      chose des deux côtés.*
      *Le bloc reste utile : il sert quand aucun quartier n'est déclaré — des
      salons réservables mais non situés — et dans les décors de test.
      1 test neuf, 4 mutations*
- [x] **Le compte des reprises arrivait après l'appui**
      *`GET /admin/me/support-access/recent`, sans identifiant de salon. Le même
      nombre était déjà servi sur la réponse à l'ouverture — il n'était pas
      faux, il était tardif : **lu après le geste, il retient pour la fois
      suivante**, c'est-à-dire qu'il fait ce qu'un journal fait, et un journal
      enregistre un abus sans l'empêcher.*
      *Sans salon dans le chemin, parce que le compte doit vivre avant qu'un
      salon soit choisi : l'écran le pose au-dessus du champ de motif, donc
      avant tout le reste. Le poser sur la route qui liste les reprises d'un
      salon aurait rendu un nombre tous salons confondus depuis une route qui
      parle d'un salon.*
      ***Les deux réponses partagent leurs champs, elles ne les recopient pas.**
      `CompteDesReprises` côté serveur, et le même type côté app : l'écran les
      lit à quelques secondes d'écart — une fois en ouvrant le formulaire, une
      fois en le validant — et deux calculs indépendants finiraient par
      diverger. Une mutation qui fait mentir l'un des deux tombe.*
      *Le champ reste sur le `POST`, à jour, celle qu'on vient d'ouvrir
      comprise. 4 tests, 3 mutations. Demandé par la session qui tient l'écran
      d'administration ; le branchement lui revient.*
- [x] **L'encre trop claire sur un fond qui a changé, mesurée pour la première fois**
      ***La capacité était là, personne ne l'appelait.* `luminance()` et
      `contraste()` existent depuis longtemps dans le thème, ils sont justes, et
      ils ne servaient qu'à **une seule chose** : l'opacité minimale d'un voile
      de photo. Design a reproduit cinq fois la même erreur et l'a corrigée cinq
      fois, à la main.*
      *Vingt-sept paires déclarées, chacune avec son seuil et sa raison. Les
      seuils sont ceux du standard et ne sont pas tous à 4,5 : un grand texte et
      une bordure de contrôle demandent 3, un élément **inactif** n'est soumis à
      rien — son illisibilité est le message. Un produit croisé aurait fait
      tomber des paires que personne ne pose, et une garde qui crie au loup
      apprend à ignorer le rouge.*
      ***Une quatrième erreur trouvée en l'écrivant.** `BasDuMur` posait
      « repartir du haut » — un libellé **pressable** — en `ink.faint` sur la
      page : 2,46:1. Le jeton l'écrit lui-même : « ne porte jamais de texte à
      lire », et « trois erreurs de contraste sur quatre viennent d'un
      `ink.faint` employé comme couleur de texte ». Corrigé en `ink.mute`.*
      ***Et un chiffre à trancher par le dessin, pas par moi** : `ink.mute` sur
      `bg.deep` vaut **4,36**. La paire existe — un encart gris porte des
      légendes — et elle ne passe qu'au titre du grand texte. Inscrite avec son
      nombre plutôt que corrigée seule.*
      *Ce que la garde ne fait pas est écrit dans son en-tête : elle mesure la
      palette, pas les écrans. Ce qu'elle rattrape à la place est la **forme**
      du défaut — `ink.faint` est un état, jamais une couleur, donc il ne
      s'écrit jamais sans condition. 32 tests, 5 mutations*
- [x] **Seize salons du semis n'avaient aucun visage**
      *Mesuré avant et après, sur une base jetable pour ne toucher à celle de
      personne : **34 photos réelles sur 102** avant, **50 sur 102** après. Les
      seize couvertures manquantes étaient les seize salons du marché ; les
      trois écrits à la main avaient les leurs.*
      *Les vingt photographies verticales dormaient dans `assets/photos/`,
      déposées pour un mur qui ne les lit plus. Elles sont déjà appariées au
      sujet — le barbier chez le barbier, la poterie chez le potier, les vingt
      dans l'ordre du prompt qui les a produites — et **dix-neuf des vingt
      étaient déjà nommées** dans `MARCHE` et dans la table écrite à la main.
      Il ne manquait que de les rendre au seul champ que les écrans lisent.*
      *`_deposer_photo` prend une liste de replis, essayés dans l'ordre. Le
      premier chemin reste celui que `A-FOURNIR.md` réclame : un repli est une
      consolation, pas une réponse à la demande. Le recadrage est franc — un 2:3
      ramené en 16:9 perd le haut et le bas — et une photo du bon commerce mal
      cadrée vaut mieux qu'un aplat qui n'est celle de personne.*
      *5 tests, 3 mutations. La troisième — le semis qui cesse de passer le
      numéro — a **survécu** au premier jet : les trois premiers tests
      éprouvaient le mécanisme et pas son branchement. Le test qui la rattrape
      lit les clés du jeu posé et se saute quand les photos ne sont pas là,
      puisqu'elles ne sont pas versionnées.*
      *Les photos de prestation restent générées : elles sont petites et le
      dégradé y passe.*
- [x] **Les cinquante-deux dernières images du semis, trouvées sur Openverse**
      ***102 fournies, 0 générée.** Le semis ne fabrique plus un seul dégradé :
      cinquante photos de prestation et les deux pages de carte de La Mesa
      Larga sont posées, au mot le plus proche du nom de la prestation —
      « corte clásico » cherché comme *barber haircut*, « taller de pastelería »
      comme *pastry baking class*.*
      *Openverse n'a besoin d'aucune clé. **Un en-tête `User-Agent` accentué
      fait répondre 403**, et le message ne dit rien de la cause : quarante-huit
      recherches ont échoué d'affilée avant que la comparaison avec `curl` le
      montre.*
      *Deux règles tenues. Le grand côté est borné à 1200 px avant le dépôt.
      Et **seules les licences qui permettent la modification** : `cc0`, `pdm`,
      `by`, `by-sa`. `license_type=commercial` laissait passer `by-nd`, cinq
      images sont arrivées ainsi, et recadrer est une œuvre dérivée — refaites.*
      *Deux vérifications qui ont trouvé quelque chose : les dimensions
      annoncées par l'API ne sont pas toujours celles du fichier — une page de
      carte annoncée verticale est arrivée en 1200 × 900, que le semis aurait
      recadrée en une bande — et les deux pages de carte étaient **la même
      image**, ce qui ne montre pas ce qu'une carte de deux pages est.*
      *`A-FOURNIR.md` porte les cinquante-deux avec leur auteur, leur licence et
      leur source : ce sont des images de remplacement, elles sont justes de
      sujet et de personne d'autre, et un lancement réel les remplace toutes.
      Les dossiers des seize salons arrivent maintenant avec le dépôt.*
- [x] **Les favoris : le cœur tient à la prestation, pas à l'offre**
      ***La décision, et le modèle la tranche contre l'évidence.** Le mur rend
      une carte par `tier_offer` — c'est ce qu'on voit, ce serait donc ce qu'on
      épingle. Mais un `tier_offer` meurt de deux façons qui ne disent rien de
      la prestation : le salon ferme ce palier-là et garde l'autre, ou **la
      créatrice perd le palier**. Le second est un changement chez elle, et un
      favori qui disparaît parce qu'on a baissé d'un palier pendant un mois est
      un favori qu'on n'ose plus poser. `catalog_item` ne meurt qu'à
      l'archivage, définitif par construction : la seule mort qui le mérite.*
      ***Le salon n'est pas une seconde cible.** Le geste est un cœur sur une
      carte du fil, et une carte du fil est une prestation.*
      ***La liste se lit hors du fil**, et c'est l'autre décision. Le fil est
      borné par une position et un rayon ; un favori posé à Wynwood doit se
      relire depuis Kendall. En faire un filtre du fil en aurait fait une liste
      qui ne s'ouvre qu'à l'endroit où on l'a remplie.*
      *Une prestation devenue irréservable **reste, avec sa raison** — fermée,
      salon indisponible, hors palier : trois conduites différentes, et la
      retirer sans un mot ferait croire à un mauvais appui. Le fil porte
      `est_favori` : quatre-vingts cartes ne demandent pas leur cœur une par
      une. L'anonymisation les emporte, et pas depuis le vidage des réseaux
      sociaux — celui-ci rend la main quand il n'y en a aucun, donc une
      créatrice sans réseau connecté aurait gardé les siens.*
      *12 tests, 6 mutations. La première a **survécu** : aucun décor n'avait de
      prestation offerte nulle part, si bien que « fermée par le salon » et
      « hors de ta portée » ne divergeaient sur aucun cas.*
      *Reste à composer : le cœur sur la carte et l'écran de la liste. Il manque
      d'abord une **icône de cœur** au système — en dessiner une serait poser
      une marque dans un alphabet qui en a un.*
- [x] **Le semis semait après la fermeture, et la journée du jour était vide**
      *Dix-neuf réservations sur vingt partaient au lendemain : le choix du
      créneau ne regardait qu'en avant, et semé à 22 h tous les salons de Miami
      sont fermés. L'écran « Aujourd'hui » — le premier qu'on ouvre en
      démonstration — était donc vide à l'heure où on le montre.*
      *Le semis prend maintenant le prochain créneau **du jour**, et à défaut le
      **dernier déjà passé du même jour**. Mesuré : 19 salons sur 19 ont une
      ligne aujourd'hui, contre 1 avant.*
      ***Ce qu'un créneau passé empêche, et qu'on ne contourne pas.** Une heure
      dépassée ne s'accepte pas — `trancher` lève `CreneauDepasse` — donc chez
      un salon qui valide, la ligne reste en attente. C'est un état vrai, que la
      journée affiche, et qui montre ce qui arrive quand on ne tranche pas à
      temps. Le semis ne force rien.*
      *Deux tests portaient l'ancienne promesse : « une réservation confirmée »
      et « jamais derrière nous ». Réécrits sur la nouvelle — une réservation
      **dans la journée courante**, à toute heure. Une mutation a survécu : rien
      n'épinglait « le dernier » créneau passé plutôt que n'importe lequel, et
      `min` au lieu de `max` posait le rendez-vous à l'ouverture. 3 mutations*
- [x] **Les 46 images sous attribution : l'obligation supprimée, pas documentée**
      ***Ce que `by` et `by-sa` exigent suit l'image, pas la page de crédits.***
      *Créditer partout où l'image paraît vaut dans l'application, mais aussi
      dans une capture collée à une planche, un message envoyé à un salon, une
      URL publique. Une page de crédits aurait suffi en droit et se serait
      détachée au premier partage.*
      *Mesuré avant de choisir : 9 mots-clés sur 10 ont des résultats en `cc0`
      ou `pdm`. Les 52 sont donc reprises sous ces deux licences — domaine
      public ou renonciation — et **plus une seule n'exige d'attribution**. Deux
      recherches, dix minutes, et la question n'existe plus.*
      *Quatorze ont un petit côté entre 640 et 798 px, donc légèrement agrandies
      au recadrage en 800 × 800. Visible de près, sans importance pour ce
      qu'elles servent à montrer.*
- [x] **Le bandeau ne devient pas une ligne de confirmation — tranché, puis renversé**
      ***Renversé le 2026-08-24 par les #308 et #310** : les deux données sont
      servies, la ligne est composée. La condition était juste, sa formulation
      était trop large — « ce n'est pas un report » disait « jamais » là où il
      fallait dire « pas avec ce qu'on a ». Voir `DECISIONS.md`.*
      *La planche voulait « vous êtes en ligne · 41 créatrices peuvent vous
      réserver », puis une disparition au bout de sept jours. Les deux données
      manquent : aucune **date de publication** n'est servie, donc la règle des
      sept jours n'a pas d'origine, et la **portée locale** ne vit que sur les
      rapports. Ce n'est pas un report : une ligne qui affirmerait l'une ou
      l'autre à l'estime serait une confirmation fausse, ce qui est pire que
      l'absence de confirmation. Le bandeau s'efface simplement*
- [x] **Publier reste un appel explicite — tranché, et l'écran le dit**
      *Le dernier point coché rend la publication **possible**, il ne la
      déclenche pas : un salon choisit le moment où il apparaît. Le bandeau
      porte donc le geste, et une phrase le dit à l'endroit exact où la
      confusion a lieu — quand tout est vert et que rien ne s'est passé. Voir
      `DECISIONS.md`, 2026-08-23*
- [x] **L'avis de favori : le premier message que personne n'a déclenché**
      *Ce qui donne son sens au cœur. Sans lui, un favori ne sert qu'à
      retrouver ce qu'on savait déjà.*
      ***Un balayage, et non un crochet à l'écriture.** L'ouverture a deux
      causes — le salon rouvre, ou la créatrice atteint le palier — et la
      seconde n'a aucun point d'écriture : elle arrive par un relevé de
      métriques, qui n'a aucune raison de savoir qui a mis quoi en favori.
      Comparer l'état à celui d'avant attrape les deux, et n'en oubliera pas
      une troisième.*
      ***On annonce une transition, jamais un état** : `dernier_etat`, posé à
      la création avec l'état du jour — un favori mis sur une prestation déjà
      réservable ne déclenche rien — et réécrit à chaque passage, **y compris
      à la fermeture**. Sans cette dernière écriture, une prestation qui
      s'ouvre, se ferme et se rouvre n'est annoncée qu'une fois.*
      ***Un genre et non deux.** Les deux causes disent la même chose au
      lecteur : « tu peux la réserver ». Deux genres offriraient d'en couper un
      et pas l'autre, ce qui n'a aucun sens — c'est l'argument déjà tenu pour
      `closed_no_fault`, qui partage son genre avec la non-honoration.*
      ***Le seul réglage du produit**, `app_user.favoris_me_previennent`, vrai
      par défaut, **relu au moment de sortir** et non au dépôt : quelqu'un qui
      coupe entre les deux est entendu, ce que la boîte d'envoi annonce depuis
      le début en rangeant un identifiant plutôt qu'une adresse. Son écart a sa
      propre raison — un refus ne se lit pas comme un compte injoignable.*
      *6 tests, 5 mutations. Nom du champ repris de la session qui rendra
      l'interrupteur, sur l'écran des favoris et non dans les réglages.*
- [x] **L'intermittence était la marge, pas les fichiers**
      *Ce qui tranche est que **les deux ensembles observés ne se recoupent
      pas** : quatre fichiers d'un côté — `attente`, `chargement-v3`,
      `coquille`, la photo — et deux de l'autre, `apres-la-reservation` et
      `chemin-du-code`. Aucun commun. Si c'était une fuite, ce serait toujours
      les mêmes.*
      *Reproduit : douze passages de la suite entière, un rouge, deux fichiers
      dedans, **leurs durées gonflées à dix-neuf et trente et une secondes** là
      où ils en mettent une. Ce n'est pas un test qui bloque, c'est toute
      l'exécution qui ralentit — et le défaut d'usine de `waitFor`, une seconde,
      n'y survit pas.*
      *`asyncUtilTimeout` passe à cinq secondes. **Ça ne coûte rien** : `waitFor`
      rend la main dès que la condition tient, donc une suite verte ne met pas
      une milliseconde de plus ; seul un test qui échoue vraiment met quatre
      secondes de plus à le dire, une fois. Et pas davantage, sans quoi un test
      réellement bloqué se confondrait avec un test lent — le même défaut dans
      l'autre sens.*
      *Douze passages après, tous verts. **Douze contre douze ne prouve pas** —
      un défaut d'un sur douze demanderait bien plus de tirages — et l'argument
      ne repose pas là-dessus : il repose sur les deux ensembles disjoints et
      sur le facteur vingt des durées. Un test garde le réglage par ce qu'il
      fait plutôt que par sa valeur, parce que le retirer ne fait rien tomber
      tant que la machine n'est pas chargée. 1 mutation*
- [x] **Les trois champs des deux derniers écrans sont servis et lus**
      *`GET /admin/businesses` porte `created_at` — la colonne « inscrit le » —
      et un **total**, celui de la recherche courante et non du catalogue : «
      4 of 742 · this search » distingue quatre résultats de quatre salons.
      `Favori.palier_requis` porte le palier **de la prestation**, ce qui permet
      d'écrire « et il s'ouvre » sans mentir : le prochain palier de la
      créatrice n'ouvre pas forcément ce favori-là.*
      *Les trois lignes ont quitté `champs-servis` au premier lecteur, comme la
      garde le réclame*
- [x] **La luminosité et la veille de l'écran de code, branchées**
      *`rules.md` §2 les annonce — « luminosité forcée au maximum, veille
      désactivée (`expo-keep-awake`), restauration à la sortie » — et
      `produit.json` les déclare à `true`. **Aucune des deux n'est implémentée** :
      ni `expo-keep-awake` ni `expo-brightness` n'est installé, et aucun écran ne
      les appelle. Trouvé par l'audit du 2026-08-24.*
      *C'est le même défaut que l'avertissement sans glyphe — une règle écrite et
      vraie que rien n'exécute — à ceci près qu'ici elle n'est pas seulement non
      gardée, elle est absente. Le coût est réel : un écran qui s'éteint pendant
      qu'on présente son code au comptoir, et un code illisible en plein soleil.*
      *Tranché et fait le 2026-08-24 : `expo-keep-awake` et `expo-brightness`
      installés, `shell/presentationAuComptoir.ts` branché sur la couture qui
      existait déjà dans `CodeScreen` et que personne ne remplissait. La
      restauration de la luminosité d'avant est la moitié qu'on oublie, et c'est
      celle que trois des quatre tests éprouvent — dont le cas d'un remontage,
      où relire la valeur enregistrerait le maximum comme « valeur d'avant ».*

- [x] **Deux listes qui manquaient : les décisions par salon, et les salons de l'administration**
      *`decisions_en_attente` sur `/me/businesses`. C'est ce qui fait basculer
      un gérant qui ne savait pas qu'on l'attendait — deux noms de salons ne
      disent pas lequel a besoin de lui ce matin. En une requête groupée : la
      coquille appelle cette route à chaque ouverture, et c'est elle qui
      retarde tout le reste.*
      *Un **schéma à part** et non un champ de plus sur `BusinessRead` : le
      compte n'a de sens que dans le sélecteur, et sur la fiche d'un salon qu'on
      regarde déjà il répète ce que la journée affiche à côté.*
      ***Et j'ai failli casser le sélecteur en l'écrivant.** Le premier jet ne
      servait que `id`, `name` et `timezone` — `neighborhood` et `address`
      étaient déjà là, et le sélecteur les lit pour distinguer deux salons du
      même nom. Aucun test du serveur ne l'aurait dit : c'est le contrat de
      l'app qui l'a signalé.*
      ***`GET /admin/businesses`.** Le manque dépassait la mise en page :
      l'écran de reprise était greffé sur la fiche de tournée, donc on ne
      pouvait reprendre **que les salons venus du terrain**. Un salon inscrit
      tout seul — ce que le produit veut rendre possible — était hors d'atteinte
      du support. Tous les états, parce que celui en inscription est celui qu'on
      vient débloquer. `reprise_en_cours` est celle de **l'appelant** : savoir
      qu'un collègue est entré ne change pas ce que je peux faire, et l'afficher
      inviterait à se demander pourquoi lui plutôt que moi. 5 tests, 4 mutations*
- [x] **Les deux écrans qui vont avec, composés**
      *Le sélecteur porte le compte sur chaque ligne, et **zéro ne s'écrit
      pas** : une colonne de zéros apprend à ne plus la regarder. La ligne ne
      dit pas « aujourd'hui » non plus — le nombre servi est celui de la file
      « à trancher », et une demande d'avant-hier attend toujours.*
      *L'onglet « salons » liste tous les états, cherche par nom **au serveur**
      — un filtre local ne verrait que les cent premiers, donc mentirait
      exactement là où il sert — et **dit son plafond** : sans cette ligne, un
      salon au-delà du centième se lit comme un salon qui n'existe pas.*
      *Une ligne, pas une carte : les trois marques d'une carte obligent à
      l'ombre, et cent cartes à ombre dans une liste qu'on parcourt sont le
      défaut qu'on venait de corriger sur les réservations. La reprise reste sur
      la fiche de tournée aussi — un administrateur debout dans un salon a déjà
      sa fiche ouverte. 9 tests, 4 mutations*
- [x] **Le semis ne fabriquait aucune vignette, et le repli le cachait**
      ***Cent deux images, zéro `@vignette`.* Le semis appelait le dépôt
      d'objets directement au lieu de `deposer_une_image`, qui range les deux.
      Le mur demande la vignette, ne la trouve jamais, et la route retombe sur
      l'original — un repli qui existe pour de bonnes raisons et qui masquait
      ici leur absence totale.*
      ***Rien ne pouvait le dire.** L'image arrivait, l'écran était juste,
      seulement lent. Mesuré en interrogeant la route : `…@vignette` rendait
      l'original **octet pour octet**, 169 Ko de moyenne. Après correction,
      18 Ko — un rapport de 9,2. Sur les quatre-vingts cartes d'un fil de vingt
      salons : **13,2 Mo contre 1,4**.*
      *Le cache, lui, était bon : `public, max-age=31536000, immutable`, vérifié
      sur la réponse réelle, et l'URL ne porte ni jeton ni horodatage. L'appareil
      garde ce qu'il a. Il gardait simplement des originaux.*
      *`deposer_une_image` prend un dépôt facultatif, pour que le semis range
      dans le sien sans refaire la réduction de son côté — une seconde copie du
      traitement d'image diverge au premier réglage qu'on touche. 1 test,
      2 mutations.*
- [x] **La configuration passe à deux portes, et la pause a un toit**
      *`ActivationScreen` est supprimé, avec ses tests et ses onze chaînes
      devenues orphelines : le bandeau porte ce qui manque et la publication,
      les réglages portent la pause. Le cas « publié mais invisible » a failli
      partir avec l'écran — une étape non bloquante manquante garde le salon
      hors des murs, et rien d'autre ne le lui disait*
- [x] **Le nombre de créatrices éligibles par palier, pour une prestation**
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
- [x] **L'engagement et les vues moyennes manquent sur la demande**
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
- [x] **Clore sans faute, la quatrième issue**
      *`close_no_fault` sur la décision d'arbitrage, statut terminal
      `closed_no_fault`. Elle prend la première place quand le même motif
      boucle — ni approuver ni refuser n'est juste — et repasse derrière sur un
      dossier à motifs mélangés, sans jamais disparaître : c'est l'ordre qui
      conseille, pas la présence.*
      *`meme_motif_repete` et `repetitions_du_dernier_motif` sont servis, et ma
      dérivation est retirée : elle exigeait que **tous** les motifs soient
      identiques, le serveur compte la **suite** du dernier contre un seuil de
      configuration. « Format, mention, mention, mention » les faisait diverger.*
- [x] **Les motifs qui reviennent se lisent au pied de la file**
      *`GET /admin/collaborations/motifs-qui-reviennent` était servie et
      personne ne la lisait. Elle est maintenant au **pied** de l'arbitrage, et
      pas en tête : la question ne se pose qu'après le travail, et en haut elle
      repousserait la file — c'est-à-dire ce pour quoi on ouvre l'écran. Elle
      paraît aussi sur la **file vide**, qui est le moment où elle se lit le
      mieux : plus rien à trancher, et la question devient « pourquoi ces
      trois-là reviennent-elles ».*
      *Les deux nombres, et **aucun verdict**. Le rapport départage un motif
      difficile d'un motif incompréhensible — la mention manquante sur cent
      dossiers dont deux bouclent n'est pas la même chose que sur douze dont
      dix — mais écrire « incompréhensible » à la place du lecteur demanderait
      un seuil, et un seuil de plus dans un écran est un seuil que personne ne
      relit. L'ordre du serveur ne se rejoue pas : retrier sur le rapport ferait
      remonter un motif vu deux fois.*
      *Les deux requêtes partent ensemble, et **l'agrégat est rattrapé** : cet
      écran n'existe que pour débloquer des dossiers arrêtés, et le mettre en
      erreur pour une statistique de pied de page laisserait quinze dossiers
      bloqués. Deux décors répondaient encore la même forme à toutes les routes
      — la file servie à l'agrégat lui donnait des lignes sans motif, affichées
      sans que rien ne tombe. 7 tests, 7 mutations*
- [x] **Les plans : deux totaux, la durée médiane, et qui prend chaque plan**
      *`totaliser` rendait « — » dès que deux devises se croisaient — le seul
      chiffre d'argent de l'écran, dans le cas même qu'il existe pour traiter.
      Un total par groupe de devise **et** de périodicité : additionner un
      mensuel et un annuel de la même devise donnerait un nombre qui n'est ni
      l'un ni l'autre, et qui aurait l'air juste.*
      *La durée médiane arrive en quatre champs et non un, et c'est mieux que ce
      que je demandais : une durée terminée est un fait, une durée courue est un
      minimum, et la médiane d'un mélange ne mesure rien de nommable. L'écran
      affiche « 7 mois · sur 12 terminés », et signale quand la médiane parle au
      nom d'une minorité.*
      *La répartition par catégorie porte combien restent à côté de combien ont
      souscrit — c'est l'écart qui fait l'argument. Une catégorie à zéro garde sa
      ligne : « ce plan n'a jamais séduit un salon d'ongles » est ce qu'on vient
      lire. 1188 tests verts, 8 mutations sur les deux moitiés*
- [x] **Deux PR fusionnées en ont effacé d'autres, et la CI est restée verte**
      *#212 a retiré vingt-six lignes de `TASKS.md` ; #217 a supprimé 435 lignes
      de #215 — le bilan de tournée, ses deux modules, son test et ses six
      chaînes — quatre heures après sa fusion.*
      *La cause n'est pas une résolution de conflit, contrairement à ce que
      j'avais supposé : c'est `git reset --soft origin/main` suivi de
      `git add -A`. Le reset déplace HEAD sur le **nouveau** `origin/main` en
      gardant l'arbre de travail, lequel porte encore l'état d'avant pour tout ce
      qu'on n'a pas touché ; `git add -A` enregistre alors le retrait de tout ce
      qui a été fusionné entre-temps. Plus on livre vite, plus la fenêtre est
      large. La forme juste est
      `git reset --soft "$(git merge-base HEAD origin/main)"`.*
      *Rien ne l'a signalé, et rien ne pouvait : **un test supprimé ne rougit
      pas**, il disparaît avec le code qu'il éprouvait. Trouvée par
      `bind-agency-1b`, qui a inventorié ses onze PR après le signalement.*
      ***La vérification écrite ici était fausse**, et elle a survécu à sa
      correction. `git show --numstat HEAD | awk '$1==0 && $2>0'` attrape aussi
      bien un fichier supprimé qu'un commit qui **ne fait que retirer des
      lignes** — un nettoyage de table de garde, une clé de traduction devenue
      orpheline — et elle a crié au loup sur deux commits légitimes dans l'heure
      qui a suivi son écriture. La forme juste,
      `git diff --diff-filter=D --name-only origin/main...HEAD`, ne nomme que ce
      qui n'existe plus. Elle est dans `CLAUDE.md` avec la cause et le reset
      juste ; cette ligne-ci prescrivait encore l'ancienne.*
      ***Et la CI le nomme désormais elle-même**, par le pas « Suppressions non
      annoncées » : il annote sur l'onglet des fichiers, là où le relecteur est
      déjà, et **n'interdit pas** — une suppression délibérée est un geste
      normal, ce qui manquait était un endroit où la voir. Il compte bien « des
      lignes retirées, aucune ajoutée », donc il criera parfois au loup ; c'est
      sans coût sur une annotation, et ce serait le défaut qu'on connaît sur une
      vérification requise. Fermée : la cause est comprise, le geste juste est
      dans le fichier qu'on lit, et la CI le montre*

- [x] **`prepared_by` manque sur la ligne de suivi**
      *La planche a une colonne « prepared by ». Sur une tournée à deux
      personnes, c'est ce qui permet de comparer les méthodes. Un nom et non un
      identifiant, sinon l'écran devra recharger les comptes pour une colonne.
      Demande effacée par erreur en #217 et remise ici : aucune autre ligne du
      fichier ne la portait*
      *Servie en **deux** champs plutôt qu'un, et la distinction est juste :
      préparer quarante fiches au bureau et en remettre vingt en tournée sont
      deux gestes. L'écran ne les répète pas — la seconde main ne paraît que
      lorsqu'elle diffère de la première, sauf quand le préparateur est inconnu,
      où c'est la seule main qu'on ait. Une adresse et non un nom : un compte
      d'équipe n'en a pas*
- [ ] **`HandoverChannel` n'a pas de valeur pour le SMS**
      *Il vaut `qr` ou `email`, et la planche montre aussi « by text ». Le
      ranger sous `email` ferait mentir la colonne qui compare justement les
      voies. Rien à faire tant que l'envoi par SMS n'existe pas. Effacée par
      erreur en #217, remise ici*
- [x] **L'écran de chargement — direction A, le point qui cale les lettres**
      *Deux tracés superposés dans la même `viewBox` : l'alignement est
      structurel et non mesuré, donc juste à toute échelle. La chute s'exprime en
      hauteurs de logotype, sans rebond — un point qui rebondit devient un
      personnage. Le plafond de huit cents millisecondes est un plafond et non
      une cible. Au-delà, un filet en `brand.500` prend le relais et ne
      ressemble pas à la marque : sinon on ne distingue plus « ça s'ouvre » de
      « ça bloque ». 1202 tests verts, 3 mutations*
- [x] **L'abonnement du commerce — le trou du produit, comblé**
      *Quatre routes complètes, un client qui savait les appeler, et aucun
      écran : le refus de l'annuaire menait nulle part. L'écran nomme ce que
      l'abonnement ouvre — la visibilité, pas le contact — liste les plans,
      reprend un paiement inachevé sans en créer un second, et résilie. Le
      client gagne `resilier`, la moitié manquante de la paire : souscrire sans
      pouvoir arrêter enferme, et c'est celle qui rassure au moment de
      commencer. 1212 tests verts, 3 mutations*
- [x] **Le catalogue se corrige et se retire**
      *Il se composait sans se corriger : une faute d'orthographe demandait de
      supprimer et de recommencer, ce qu'un item déjà réservé refuse de toute
      façon. La photo, le nom et la description s'éditent en place ; la durée,
      le palier et la contrepartie n'y sont pas — douze réservations citent une
      prestation de quarante-cinq minutes, et la passer à soixante-quinze
      réécrirait leur histoire.*
      *Le refus de suppression se lit sur son **code** et non son message, et
      propose le geste qui reste. 1245 tests verts, 3 mutations*
- [x] **Le catalogue tient les quatre règles de Design**
      *`archived_at`, `reservations_count` et `/replace` sont arrivés par
      `bind-agency-1a` (#238) ; l'écran s'en sert. Le bouton nomme son écart —
      « archiver, douze réservations citent cette prestation » — et **il n'y a
      jamais les deux gestes** : à zéro la suppression est vraie, au-delà elle
      n'existe pas. Offrir une suppression pour la voir refusée apprend qu'un
      écran propose des actions qui échouent.*
      *Durée et palier ouvrent le même formulaire que la création, pré-rempli,
      et appellent `/replace` — un seul appel, parce qu'une panne entre deux
      laisserait le catalogue avec les deux prestations ou avec aucune. Le
      palier ne suit pas la neuve : recopier l'offre poserait un accord que
      personne n'a conclu. 4 mutations*
- [x] **Archiver n'est pas fermer, et rien ne les distinguait**
      *Un salon ferme une prestation pour l'été et la rouvre en septembre ; il
      archive celle qu'il ne refera plus. Les deux valent `is_available: false`,
      donc l'écran ne peut pas sortir les archives de la liste de travail sans
      en sortir aussi les saisonnières. Il faudrait un état distinct —
      `archived_at`, ou une transition propre qui laisse sa trace au journal.
      Demandé à `bind-agency-1a`*
- [x] **Le compte de réservations qui citent une prestation**
      *Le bouton doit nommer son écart : « archiver, douze réservations citent
      cette prestation ». Sans le nombre il dit « archiver », et le gérant ne
      sait pas ce qu'il déplace. Un entier sur `CatalogItemRead` suffit*
- [x] **Changer la durée d'un item réservé est refusé par le service**
      *`CatalogItemUpdate` accepte `duration_minutes`. L'écran ne l'offre pas,
      mais **une discipline d'écran finit par céder** : la règle doit descendre
      dans la route — refus sur un item déjà réservé, ou une route de
      remplacement qui crée la nouvelle prestation et archive l'ancienne dans
      la même transaction*
- [x] **Le prix : ni corrigeable, ni créateur d'une nouvelle prestation**
      *Tranché : le prix s'édite en place, et le palier déjà choisi ne bouge
      pas — `TierOffer.tier_id` est explicite.*
      *Design ne le range dans aucune des deux listes. Il ne réécrit l'histoire
      d'aucune réservation — le prix est du reporting ici — mais il déplace le
      palier suggéré, qui se calcule sur le rang du prix dans le catalogue. Non
      offert en attendant, plutôt que tranché seul*
- [x] **Couper les notifications de cet appareil**
      *`revoquerUnTerminal` existait, documentée, appelant la bonne route — et
      personne ne l'appelait. Les réglages portent maintenant l'interrupteur,
      pour la créatrice comme pour le salon.*
      *Révoquer ne suffisait pas : le jeton se réenregistre à chaque session, et
      couper sans mémoriser le choix aurait fait un geste qui s'annule tout seul
      au lancement suivant. Le refus est gardé sur l'appareil et relu avant tout
      enregistrement. « Refusé ici » est distinct de « refusé par le système » :
      les deux se lèvent à des endroits différents*
- [x] **Aucune route ne liste les terminaux d'un compte**
      *Fait : `GET /me/devices` et la révocation par `device_id`. Voir « Annuler
      ce que le salon n'a pas accepté, et couper l'appareil perdu ».*
      *`PUT /me/devices` et `DELETE /me/devices/{token}` existent, `GET` non.
      Révoquer exige donc de **posséder** le jeton, qu'on n'a que sur l'appareil
      lui-même : couper les notifications d'un **téléphone perdu** depuis un
      autre appareil est impossible, et c'est précisément le cas qui motive
      cette capacité.*
      *L'écran le dit plutôt que de laisser croire — quelqu'un qui vient de
      perdre son téléphone est la dernière personne à qui l'on doit une
      demi-vérité. Il faudrait un `GET /me/devices` rendant l'appareil, sa
      plateforme et sa dernière activité, plus une révocation par identifiant
      et non par jeton*
- [x] **La créatrice peut annuler, et elle lit ce que ça coûte avant**
      *`annulerLaReservation` existait dans le client, appelant la bonne route,
      et personne ne l'appelait : la seule sortie d'un rendez-vous qu'on ne peut
      plus honorer était de ne pas venir — ce que le produit compte comme une
      absence. Deux appuis, et la conséquence est écrite entre les deux.*
      *Ce qui décide n'est pas l'horloge mais le diagramme : `no_show` n'est
      atteignable que depuis `confirmed`. Une place tenue ou en attente d'accord
      ne peut pas y mener, quelle que soit la valeur du réglage. 1257 tests
      verts, 3 mutations*
- [x] **`awaiting_business → no_show` est interdit, et `annuler` y va quand même**
      *Corrigé : `annuler` vise `cancelled` et l'issue tardive passe par un
      événement de fiabilité. `SPEC.md` §4.1 porte la flèche.*
      *Défaut prouvé, pas déduit : `annuler` choisit son état d'arrivée sans
      regarder d'où elle part. Avec les valeurs par défaut — accord et
      annulation libre à 86 400 s chacun — toute réservation chez un salon en
      validation à moins de 24 h du rendez-vous **ne s'annule pas du tout** :
      la route lève `TransitionNotAllowed` au lieu d'annuler. La créatrice est
      coincée sur un rendez-vous que le salon n'a même pas accepté.*
      *Invisible parce que les deux tests d'annulation appellent `confirmer` sur
      un décor sans validation : tous deux partent de `confirmed`, et la seule
      forme qui casse n'était écrite nulle part.
      `test_annuler_pendant_que_le_salon_reflechit_et_pres_de_l_heure` la porte
      en `xfail(strict=True)` — le jour où c'est corrigé, la CI rougit tant que
      le marqueur reste. Demandé à `bind-agency-1a`*
- [x] **L'instant où l'annulation cesse d'être libre n'est pas servi**
      *Servi : `annulation_sans_frais_jusqu_a`, calculé par
      `fin_de_l_annulation_libre` et rendu sur l'historique de réservation.*
      *L'écran dit « annuler près de l'heure compte comme une absence » sans
      pouvoir dire **quand**, parce que `booking_free_cancellation_seconds` est
      un réglage et que le dépôt interdit de le recopier — à raison, il
      dériverait au premier ajustement. Or c'est la date qui change la
      décision : « libre jusqu'à 14 h 30 » fait annuler maintenant, « annuler
      tard coûte » fait renoncer ou fait annuler trop tard. Demandé :
      `annulation_sans_frais_jusqu_a` sur `ReservationDuCreateur`, calculé
      serveur, **nul** quand l'annulation est toujours libre — un instant posé
      là ferait croire à une limite qui n'existe pas. Même forme
      qu'`absence_signalable_a`, qui a réglé le même problème sur la journée*
- [x] **Le salon lit les reprises faites chez lui**
      *`mesReprises` existait, la promesse « le salon en est prévenu » aussi, et
      rien ne la vérifiait : la reprise s'ouvrait, les horaires changeaient sous
      les yeux du gérant, et aucun écran ne disait qui ni pourquoi. Un bandeau
      d'encre sur la journée tant qu'une reprise court, et la liste complète
      dans les réglages.*
      *Le motif est cité **mot pour mot**, entre guillemets, jamais reformulé :
      c'est le mécanisme lui-même, pas sa présentation. Et « expirée toute
      seule » se distingue de « refermée » — le service écrit que c'est la
      seconde qui devrait gêner. 1292 tests, 3 mutations*
- [x] **La portée borne la reprise, et le salon met dehors**
      *Les cinq manques de la reprise, pris ensemble parce qu'ils ne se
      tiennent qu'ensemble : un nom sans portée nomme quelqu'un qui peut tout,
      et une portée sans bouton de sortie reste une phrase.*
      ***La portée est la borne, la durée n'est qu'un plafond.** Un ensemble
      d'écrans déclaré à l'ouverture et vérifié à chaque requête, par
      l'étiquette du routeur. Une horloge se renouvelle — il suffit de rouvrir
      quand la précédente s'éteint — une portée non. Ce qui n'est classé nulle
      part n'est ouvert par personne : un écran neuf bloque le support à la
      première tentative, ce qui est le bon sens de l'erreur.*
      *`admin_name` est **recopié** à l'ouverture, jamais joint : le gérant
      relira en octobre le nom qu'il a lu en mars. `spontaneous` est déclaré,
      faute d'un canal entrant — le défaut est le sens inconfortable, et c'est
      celui qui affirme avoir été appelé qui doit le dire. Le compte des
      reprises de l'appelant, tous salons confondus sur sept jours glissants,
      est rendu à l'ouverture et ne refuse rien.*
      *Et `DELETE /business/{id}/support-access` : le salon coupe **toutes**
      les reprises vivantes chez lui, sans avoir personne à convaincre. Le
      journal distingue « je suis ressorti » de « on m'a mis dehors ».
      36 tests d'API, 10 d'écran, 11 mutations*
      *Reste à composer : le bouton du bandeau de la journée, que la planche
      dessine. La route existe et le client l'appelle depuis les réglages —
      c'est une pose, pas un mécanisme.*
- [x] **La liste des terminaux, et la révocation par identité**
      *Fait, même tranche que ci-dessus : un identifiant opaque désigne, le
      jeton n'est plus exigé.*
      *La planche des appareils ne peut pas se composer : `GET /me/devices`
      n'existe pas, et la révocation exige de **posséder** le jeton, qu'on n'a
      que sur l'appareil perdu. C'est un cercle. Déjà demandé avec la réponse
      sur le jeton — un identifiant opaque suffit à désigner, et rendre les
      jetons de tous les appareils crée une cible qui n'existait pas.*
      *Ce que la planche ajoute et qui est décisif : l'appareil courant porte
      « celui-ci » et **n'a pas de bouton pour se couper**. Se couper soi-même
      est une déconnexion, un autre geste — les confondre fait perdre l'accès à
      quelqu'un qui voulait le garder*
- [x] **Le mur tirait des originaux de 2000 pixels dans des cadres de 100 points**
      ***Mesuré avant de décider**, et le résultat ne laisse pas de doute : un
      fil de vingt salons à quatre prestations charge quatre-vingts images d'un
      coup — la grille est un `ScrollView` et un `.map`, rien n'y est
      virtualisé. Photographies déjà réduites : **10,5 Mo**. Photos sorties d'un
      téléphone : **52 Mo**. Le JSON qui les nomme : **50 Ko**, soit un demi
      pour cent du total.*
      *Le mur appelait `urlDuMedia` et non `urlDeLaVignette` : la dérivée
      existait et personne ne la demandait. Ses trois cadres font 100, 52 et 44
      points. Et le poids n'est pas le pire — `Image` décode avant de réduire,
      donc une image de 2000 × 2000 occupe seize mégaoctets de mémoire quel que
      soit le cadre. Quatre-vingts d'un coup, c'est ce qui fait ramer le
      défilement avant même que le réseau soit en cause.*
      ***Et la vignette elle-même n'était pas dimensionnée sur l'écran** : 480
      pixels, calibrés sur des cartes de 150 points que la grille v3 ne rend
      plus. Les cinq cadres qui la lisent sont mesurés — 100, 64, 56, 56,
      40 × 52 — le plus grand demande 300 pixels à densité triple. Ramenée à
      320. 10,5 Mo → 1,5 Mo par le seul changement d'appel, → **0,8 Mo** avec le
      nouveau plafond ; 52 Mo → 1,8 Mo sur des photos de téléphone.*
      *Le plafond ne se relit pas sur les images déjà rangées : une vignette
      d'hier reste à 480, plus lourde que nécessaire et parfaitement correcte.
      Un balayage du dépôt coûterait plus que le gain, qui se réalise de
      lui-même à mesure que les photos se remplacent. 2 tests, 2 mutations*
- [x] **Le cœur marchait, et rien ne le disait**
      *Signalé comme « les favoris ne marchent pas ». Éprouvé bout à bout, dans
      un vrai navigateur, sur un vrai bundle, contre une vraie API et une vraie
      base : **le mécanisme est juste**. L'appui part en `POST /me/favorites`,
      le serveur répond 204, la ligne est en base, le fil relu porte
      `est_favori: true`, et la liste la rend. Un parcours de bout en bout le
      tient désormais — il n'y en avait aucun sur les favoris, et c'est ce qui
      rendait le signalement invérifiable.*
      ***Ce qui manquait était le retour, et il manquait deux fois.** Sur le
      fil, un appui réussi ne changeait rien de visible hors de la carte
      touchée. Et un appui **raté** ne changeait rien du tout : le cœur se
      remplissait, revenait, et le produit se taisait — les deux se lisent
      « il ne s'est rien passé », et l'échec ne laisse alors rien à réessayer.
      Le retour en arrière est maintenant accompagné d'une phrase qui nomme la
      prestation, sur le fil comme sur la liste.*
      *Le compte sur la porte vient du **serveur** : `favoris_total` sur le fil,
      gratuit — le fil charge déjà l'ensemble des favoris pour poser
      `est_favori`. Le dériver des cartes rendues aurait oublié les favoris hors
      du rayon et **changé en marchant**. Il bouge à l'appui, avant la réponse,
      et l'état servi voyage avec le geste : sans lui, revenir sur son propre
      appui compterait comme un retrait de plus. Zéro ne s'écrit pas.
      1560 tests app, 1795 tests api, 7 mutations*
- [x] **Le fil v4 : une carte par salon, et le cœur passe sur la fiche**
      *« On voit trois services alors qu'il y en a beaucoup plus. » Le compte
      était juste des deux côtés — le fil ne montre que ce qui se réserve, la
      fiche montre l'étagère entière — et c'est la **composition** qui le
      faisait lire comme un défaut : un salon apparaissait autant de fois qu'il
      avait de prestations ouvertes.*
      *La carte de salon ne l'annonce pas, elle le **montre** : deux prestations
      nommées avec leur palier, puis « and 2 more inside ». Une phrase de plus
      était précisément ce qui produisait l'incompréhension ; une carte qui
      contient deux lignes visibles ne peut pas être prise pour une seule chose.*
      ***Le compte est servi, et il vient de `bind-agency-1a`.* On a trouvé la
      même chose chacun de son côté à une heure d'intervalle — `prestations`
      comptait des **offres**, donc une prestation ouverte à deux paliers
      accessibles comptait deux fois, et la somme des cartes aurait cessé
      d'égaler l'en-tête du quartier. Sa version est meilleure : un champ
      `prestations_ouvertes` par salon, et les trois niveaux passant par la même
      fonction. J'ai jeté la mienne et lu la sienne — deux calculs de la même
      chose finissent par diverger, et c'est celui qu'on regarde le moins qui
      ment.*
      ***Le quartier est nommé dans les deux phrases.** « 3 services open to
      you » se lisait comme un total de ville ; le nom posé sur la ligne du
      dessus ne suffisait pas, parce que c'est la phrase qu'on lit. L'en-tête
      porte « 2 salons · 3 services open to you in Wynwood », la carte « 4
      services open to you in Wynwood » — et sa variante courte sous
      « Ailleurs », où il n'y a pas de quartier à nommer.*
      *Le cœur quitte le fil : il porte sur la prestation, et une carte de salon
      en contient plusieurs. Il vit sur la fiche, **sur les deux ensembles** —
      garder ce qu'on ne peut pas encore réserver est le cas qui justifie l'avis
      de réouverture. `est_favori` est servi par offre ; deux offres du même
      article portent le même cœur. Le seul cœur du fil est la porte, en
      pilule : remplie avec son compte, vide sans.*
      *Le compte de la porte reste servi et n'est jamais recopié : la pile
      prévient le fil qu'un cœur a bougé, et le fil redemande. **Au geste et non
      au démontage** — la première version attendait la sortie de la fiche, et
      le parcours de bout en bout a montré qu'elle ne marchait pas sur le web.*
      *Et la fiche sépare les deux ensembles, chacun compté : « 4 open to you »,
      « 3 not open to you yet ». Le second porte ce qu'un compte connecté
      rapporterait, avec son nombre, son réseau et son bouton — la plainte
      devient l'argument. 1589 tests app, 16 e2e, 10 mutations*
- [x] **Un salon sans quartier déclaré n'apparaît maintenant quelque part**
      *`useMur` filtrait par quartier ouvert ; sans quartier, il rendait `null`
      et les deux chemins du mur s'arrêtaient là. Un fil de salons non situés
      rendait **zéro carte et aucun état vide** — une barre de recherche
      au-dessus d'un mur blanc.*
      *Une section « Ailleurs à Miami » en fin de mur, triée par distance,
      plutôt qu'un repli sur liste plate : le cas courant est **mixte**, pas
      binaire — les salons démarchés portent un quartier, ceux qui s'inscrivent
      seuls parfois pas. Un repli aurait ajouté une seconde mise en page dont
      l'apparition dépend d'une donnée invisible, et le cas mixte n'y serait de
      toute façon pas entré*
- [x] **La journée porte sa reprise, et la requête de plus a disparu**
      *`BandeauDeReprise` appelait `mesReprises` lui-même, sur l'écran le plus
      ouvert du produit, pour une réponse presque toujours vide.
      `reprise_en_cours` est servi sur la journée depuis la #300, et le bandeau
      le reçoit — une requête de moins par ouverture*
- [x] **L'annulation v3 : passé la fenêtre, on arrête de parler du score**
      *La formulation était le sujet, pas le mécanisme. L'écran écrivait « votre
      score de fiabilité baisse » — exactement la phrase que Design interdit.
      Passé la fenêtre, annuler et ne pas venir coûtent la même chose : le score
      ne départage rien, et le mentionner donne à croire qu'on peut encore
      l'éviter.*
      *Ce qui diffère est ailleurs, et c'est tout ce que l'écran dit : la place
      repart, et le salon sait. « Ça compte comme une absence, mais Vela peut
      encore donner ta place » décrit les mêmes conséquences et fait annuler là
      où l'autre fait renoncer.*
      *La fenêtre se nomme par une **heure** — `annulation_sans_frais_jusqu_a`,
      servi — jamais par une durée. Le bouton ne bouge ni de forme ni de place
      à aucune heure : rendre l'annulation difficile produit des absences
      silencieuses, pas des présences. 1314 tests, 3 mutations*
- [x] **Une annulation tardive doit coûter moins qu'une absence**
      *Fait : `cancelled_late`, poids `-5`. Voir « Prévenir doit coûter moins
      que disparaître » et « Une faute légère, pas une demi-absence ».*
      *Tranché côté produit, pas encore côté service. Tant que les deux coûtent
      exactement pareil, rien n'incite à prévenir plutôt qu'à disparaître —
      sauf la bonne volonté, qui n'est pas un mécanisme. Le jour où
      `booking_states.annuler` porte un événement de fiabilité distinct du
      `no_show`, l'écran l'écrit en une ligne de plus dans le bloc « les
      prévenir maintenant vaut mieux », et c'est **la seule incitation réelle à
      prévenir**. Composé sans, exprès : la phrase s'ajoute, elle ne se
      remplace pas*
- [x] **La reprise a ses trois freins, et le salon met dehors depuis la journée**
      *Le bouton « End it » était dans les réglages ; il est maintenant sur le
      bandeau de la journée, là où le salon regarde chaque matin. Un seul appui,
      **sans confirmation** : une question de plus entre le gérant et sa porte
      est une négociation, et il n'a personne à convaincre. La portée s'écrit
      sur le bandeau, au présent — la liste des réglages dit « could open »
      d'une porte close, la journée dit « open now » d'une porte ouverte.*
      *L'écran d'administration existe : motif transmis mot pour mot, portée par
      écrans qui borne réellement, « spontanée » par défaut. « Tout » n'est pas
      interdit, il est écrit — le serveur n'a pas de valeur « tout », demander
      tout c'est cocher les sept, et le gérant lit les sept. 1340 tests,
      5 mutations*
- [x] **L'attente : le seuil, et la photo qui ne pousse plus rien**
      *« Lent » veut dire « je ne sais pas si ça marche ». Les quatre durées
      sont des jetons — appui 100, état 160, fondu 220, seuil 400 — et aucune
      n'est écrite dans un écran.*
      *Rien ne clignote sous 400 ms : le squelette ne part plus au premier
      instant. La vue reste montée et vide pendant le seuil, ce qui n'est pas un
      blanc — c'est ce qu'il y avait déjà. Et `Photo` réserve sa hauteur sur un
      aplat `bg.deep`, puis fond l'image en 220 ms sans échelle ni translation :
      le défaut n'était pas la lenteur, c'était la carte qui grandit et pousse
      ce qu'on lisait. La règle 2 — l'appui en 100 ms — existait déjà.
      1348 tests, 3 mutations*
- [x] **`Photo` est branchée sur les six familles**
      *Reste le fil et ses quartiers, la fiche de salon et sa galerie,
      l'annuaire, le catalogue, le suivi de tournée. C'est le changement qui
      touche le plus d'écrans, et le seul que les testeurs nommaient
      directement — les sites restants sont mécaniques, pas décisionnels*
- [x] **La liste qui se recompose s'atténue sans se vider**
      *L'ancienne doit descendre à 25 % **sans se vider**, dès l'appui et sans
      attendre le seuil : ce n'est pas un indicateur d'attente, c'est un
      remplacement. La nouvelle monte par-dessus, décalée de 30 ms par ligne et
      de 4 px au plus. Et l'aller-retour tient ses 220 ms même si la donnée
      revient en 40 ms, sans quoi l'atténuation deviendrait un voyant qui
      clignote. Concerne le fil, la bande de créneaux, les trois onglets des
      réservations, la file d'arbitrage, l'annuaire*
- [x] **La règle 3 : la réussite ne s'annonce pas, et une garde la tient**
      *Un résultat qui apparaît **est** la confirmation. Il reste des bandeaux
      de réussite à retirer, et une garde à écrire pour qu'ils ne reviennent
      pas — c'est une règle qui retire, donc elle se défait toute seule si rien
      ne la tient*
- [x] **La suppression se tape, et le pavé cramoisi s'en va**
      *La campagne renverse l'arbitrage, et son argument est meilleur que le
      nôtre : on avait retiré la boîte de confirmation parce que trente jours
      la rendaient inutile. Le délai reste vrai — **mais il protège de la
      mauvaise décision, pas du mauvais appui**. Et un bloc encadré, teinté,
      plus haut que tout le reste de l'écran attire la main autant qu'il
      l'avertit.*
      *Le geste redevient une ligne parmi les autres ; ce qui vient après
      protège. Adresse et mot de passe retapés — le mot de passe est
      **vraiment vérifié**, par la route de connexion, sans toucher au coffre :
      un champ qui accepterait n'importe quoi aurait l'air d'un contrôle sans
      en être un. La suppression ne prend pas de corps ; c'est là que la
      vérification devrait vivre, et c'est demandé.*
      *Le bouton est **retiré** tant que les deux champs ne concordent pas,
      jamais grisé. Et la confirmation ne se referme qu'à la réussite : un refus
      laisserait sinon le message au-dessus d'un bouton disparu. 2 mutations*
- [x] **« Your place » se replie, et la journée avec**
      *Trois sections repliées, une seule ouverte à la fois, et chacune **dit
      ce qu'elle contient avant qu'on l'ouvre** — c'est le compte qui remplace
      le contenu, pas un titre. Repliées et non réparties : les trois décrivent
      le même objet, et trois écrans redonneraient les portes que la v3.1 vient
      de retirer. Ce qui gênait est la hauteur, pas le voisinage.*
      *Le blocage de la carte passe **dans le résumé** : replier ne doit rien
      cacher qui décide, et une prestation qui ne se publie pas faute de carte
      se voit fermé comme ouvert.*
      ***Et la journée, troisième retour.** Deux replis, choisis pour ce qu'ils
      ne demandent pas : l'exception, qui se décide en marchant et ne se lit
      pas tous les matins, et les lignes finies — servi, annulé, manqué — qui
      poussaient hors de l'écran celles qui attendent un geste. Les deux gardent
      leur compte en tête, qui est ce qu'on lit. Le composant est extrait :
      un écran qui replie à la main le fait une fois puis dérive*
- [x] **Le fil v5 : des rangées par catégorie, et des cartes qu'on voit**
      *« On ne voit rien » était une **mesure**, pas une impression : une grille
      de deux sur 354 points donne des colonnes de 171, et une photo de 100 y
      fait un letterbox de 1,71:1 sur des images qui arrivent en 4:3. Un quart
      du cadrage jeté, dix-sept mille pixels rendus. Une carte de 280 porte un
      4:3 entier — 3,4 fois la surface, sans recadrage.*
      ***Et le quartier redevient une étiquette.** Il avait été fait colonne
      vertébrale du fil alors que la fondatrice l'avait écarté au démarchage :
      il filtre trop fort comme axe, et Miami est une ville de voiture. Il vit
      dans la ligne d'attribution, avec le salon et la distance. La même
      décision règle les deux reproches — la rangée donne la largeur **et**
      l'axe.*
      *« Le plus près de toi » ouvre le fil sans filtrer, puis les catégories
      précisent. Chaque rangée porte son compte **servi** : douze dans le rayon,
      deux à l'écran — le dériver des cartes chargées ferait croire le fil
      exhaustif, ce qui est le défaut que la v4 venait de fermer.*
      *Ce qui a traversé les trois fils reste intact : la prestation porte le
      titre, le salon est l'attribution, et « +3 more here » dit ce qui est
      ouvert chez lui — c'est la seule différence avec la v0.5, qui nommait une
      prestation sans mener à un lieu. 1600 tests, 3 mutations*
- [x] **La suppression côté commerce dit que les réservations sont honorées**
      *Une phrase de plus, et elle ferme une porte : les créneaux déjà acceptés
      sont honorés avant l'effacement, comme à l'échéance d'un abonnement. Sans
      elle, supprimer son compte serait le moyen le plus rapide de se défaire
      d'une journée chargée*
- [x] **L'état d'échec de l'envoi de preuve**
      *Le cas était **certain** — le téléversement était cassé en web sur tout le
      produit — et il n'existait pas : un bandeau cramoisi portant le message du
      client, et rien d'autre.*
      ***Un échec réseau n'est pas une erreur de la créatrice**, et c'est
      l'écran qui doit le dire : c'est lui qui décide entre réessayer et
      abandonner. Rien ne se vide, rien ne se compte, rien ne devient rouge. Un
      formulaire efface et recommence ; ici il n'y a rien à corriger.*
      *La phrase qu'on ne peut pas déduire de l'écran est écrite : « toujours 1
      sur 3 ». Les trois essais existent pour un contenu insuffisant, pas pour
      un réseau absent — les confondre ferait perdre un essai à quelqu'un qui
      n'a rien fait, et l'arbitrage verrait un troisième essai qui n'en est pas
      un. Vérifié côté serveur par l'autre conversation.*
      ***L'échéance porte l'urgence, jamais le bandeau.** Le même échec est
      anodin à deux jours et pressant à six heures : la ligne sous le bouton
      change, le ton non. Douze heures est le seuil, parce qu'au-delà il reste
      une nuit — « demain matin » est une réponse, « dans six heures » n'en est
      pas une.*
      *Et l'aperçu dit qu'il ne recadre pas : une capture avec ses barres
      système est une preuve valable, et exiger un cadrage propre ferait échouer
      des preuves honnêtes. Le refus de permission garde son cramoisi — celui-là
      **est** une chose à corriger, et il porte sa propre issue. 1 mutation, qui
      a d'abord survécu : le glyphe est décoratif, donc invisible aux requêtes
      par défaut, et l'assertion passait quel que soit le niveau*
      ***Deux choses signalées.** `max_attempts` n'est pas servi sur la
      contrepartie : le plafond est recopié dans l'écran, et cette ligne mentira
      au premier ajustement — demandé. Et l'échec pendant que l'application est
      fermée n'est pas composé : si l'envoi part en arrière-plan et rate,
      personne ne voit cet écran. C'est une décision de mécanisme*
- [ ] **Ce qui raccourcirait vraiment l'attente tient maintenant au serveur**
      *Design le dit sans détour : ces règles rendent l'attente lisible, elles
      ne la raccourcissent pas. Des trois choses qui la raccourciraient, **la
      troisième est faite** — `cacheDesReponses` pose la dernière réponse avant
      que le réseau réponde, et la règle 1 est vraie dès le premier lancement
      sur les sept routes inscrites, le fil compris. Ce qui n'y entre jamais est
      écrit à côté : tout ce qui décide d'un geste.*
      *Restent les deux qui ne sont pas de composition : les dérivées d'image
      servies à la taille d'affichage plutôt qu'en pleine résolution — sans
      doute l'essentiel de la lenteur réelle du fil — et les agrégats du
      §6 quinquies*
- [x] **Toutes les images passent par `Photo`**
      *Elles ne sont pas dans une liste et ne poussent rien — l'écran est fait
      pour elles. Le fondu leur ferait du bien quand même, et il ne coûte qu'un
      remplacement*
- [x] **Le compte des reprises de l'appelant se lit avant l'appui**
      *Toujours servi sur la réponse au `POST`. Demandé une seconde fois à
      `bind-agency-1a`, avec la forme : un `GET` indépendant du salon, parce que
      le compte doit vivre avant même qu'un salon soit choisi*
- [x] **Les portraits demandent la vignette, et la pile du téléphone est virtualisée**
      *`Image` décode avant de réduire : une photo occupe sa taille en pixels en
      mémoire quel que soit le cadre. Vingt portraits d'origine tenaient leur
      pleine taille dans des cadres de 132 points — le même changement sur le
      mur a mesuré 10,5 Mo contre 1,5.*
      *La clé nue n'était pas un arbitrage : la vignette d'avatar existait depuis
      la veille et le repli de la route depuis huit jours quand la grille a été
      écrite. C'était la forme juste dans le cas dangereux — l'aperçu flouté,
      qui n'a pas de vignette — prise faute de séparer les deux cas.
      `urlDuPortrait` les sépare.*
      *Et « voir plus » empile vingt créatrices par appui : quatre-vingts
      portraits montés d'un coup après quatre appuis. La pile passe en liste
      virtualisée sous le seuil ; la grille reste un bloc au-dessus, parce que
      trois colonnes en `flexWrap` ne sont pas une liste. 1391 tests,
      4 mutations*
- [x] **La grille large est virtualisée, et la mesure a décidé**
      *`FlatList` porte `numColumns` et le contrat de `liste` n'en a pas la
      notion. Ce sera une ligne le jour où quelqu'un mesure — et elle ne sera
      pas plus chère plus tard, ce qui est une raison de ne pas la poser
      maintenant : ce serait du contrat que personne n'éprouve*
- [x] **Les quatre freins de la reprise tiennent**
      *`mesReprisesRecentes` est branché : le compte se lit au-dessus du champ
      de motif, pendant qu'on peut encore ne pas ouvrir. Lu après l'appui, il
      retenait pour la fois suivante — c'est-à-dire qu'il faisait ce qu'un
      journal fait, enregistrer sans empêcher.*
      *Il ne refuse rien, et il ne bloque pas le formulaire : un seuil qui
      refuserait se contournerait en attendant un jour. Et un compte absent
      n'est pas un compte à zéro — rien plutôt qu'un chiffre faux, parce que
      « ta première en sept jours » à quelqu'un qui en a ouvert quinze est
      l'exact contraire de ce que cette phrase existe pour faire. 1411 tests,
      3 mutations*
- [x] **Deux défauts de campagne : l'accueil coupé, le champ repeint**
      *Les promesses descendaient 68 points sous le bouton et se dessinaient
      par-dessus — la garde e2e mesurait le défilement du document, qui ne
      défilait pas. Elle mesure maintenant le chevauchement, et elle tombe sur
      l'ancien code.*
      *Le champ : `TextInput` est un `input` sur le web, un enfant carré qui
      porte son propre fond, et le conteneur arrondi ne découpait pas.
      `overflow: hidden` plus la neutralisation de l'autoremplissage — par une
      transition différée, pour n'avoir aucune couleur de fond à deviner.
      1443 tests, 4 e2e, 3 mutations sur navigateur*
- [x] **L'accueil est mesuré dans les deux langues**
      *L'espagnol est plus long et c'est lui qui décide de la hauteur réelle. La
      bascule de langue n'est pas atteignable depuis l'accueil : il faudrait
      soit un moyen de la forcer dans le build de test, soit un paramètre
      d'adresse. La marge prise en légende en tient lieu, ce qui n'est pas une
      garantie*
- [x] **La ligne de l'audience menait nulle part**
      *`navigate('paliers')` désignait un onglet qui n'a jamais existé — les
      onglets du créateur sont `parcours`, `audience`, `reservations` et
      `reglages`, et l'écran des paliers vit dans la pile du fil. L'appui
      partait, le nom était ignoré, rien ne bougeait. C'était le seul chemin
      vers les paliers depuis qu'ils ont quitté le fil.*
      *Le `as never` a effacé la vérification qui l'aurait dit. Deux gardes :
      une qui lit les noms visés — la cible imbriquée comprise — et une qui
      appuie et regarde l'écran qui vient. 1447 tests, 2 mutations*
- [x] **Le fil v3.1 : chercher, et garder**
      *La recherche était servie depuis des jours et n'avait aucun bouton. Les
      catégories passent sur une ligne défilante de pilules — 86 points rendus
      à 34 — et les 52 rendus paient la barre. Les deux barres restent collées :
      104 points sur 728, le prix demandé.*
      *Le cœur est optimiste et sans annonce : le remplissage **est** la
      confirmation. Il porte sur l'article et non sur l'offre, donc le même
      article ouvert à deux paliers montre le même cœur. La liste des favoris
      garde les prestations devenues irréservables avec leur raison — quatre
      états, quatre conduites. 1465 tests, 3 mutations*
- [x] **Le fil change de grain : une carte par salon, et le compte qui va avec**
      *La route servait déjà le bon grain — `commerces[]` imbrique ses `items`,
      et c'est `SectionsParQuartier` qui aplatit. Rien à regrouper côté serveur,
      donc, mais un compte manquait et un autre était faux.*

      *`prestations_ouvertes` sur chaque salon, **servi et non déduit** : une
      carte de salon qui écrirait `items.length` compterait des offres. Un
      article ouvert au story et au reel fait deux contreparties légitimes — et
      une seule prestation ; la carte listerait deux fois le même nom.*

      ***Le même défaut vivait déjà dans les totaux***, latent : `total_prestations`
      et le compte par quartier faisaient `sum(len(c.items))`. Aucune créatrice
      ne le voyait — le seul doublon du semis est à un palier TikTok que personne
      n'atteint. Les trois niveaux passent maintenant par la même fonction.*

      *Et `est_favori` sur les offres de la fiche : le cœur quitte le mur avec
      l'ancien grain, il se pose sur la fiche, et sans ce champ il s'ouvrait
      vide devant une prestation déjà gardée. Une seule lecture des favoris
      pour toute la fiche, comme le fil le fait déjà.*

- [x] **La journée sait ce qu'elle porte : la reprise en cours, et depuis quand le salon est en ligne**
      *Deux points que l'autre conversation renvoyait, tous deux sur l'écran du
      matin. Aucun ne demandait un calcul neuf : les deux données existaient et
      arrivaient mal.*

      *`reprise_en_cours` dans la charge de la journée. Le bandeau faisait sa
      propre requête, et le commentaire qui la défendait avait raison sur le
      fond — la journée n'a pas à porter un historique qui ne la concerne pas.
      C'est vrai de l'historique ; ça ne l'est pas d'**une ligne ou nulle**. On
      retire donc un aller-retour de l'écran le plus ouvert du produit, pour une
      donnée absente dans la quasi-totalité des cas, et le bandeau cesse
      d'apparaître une seconde après le reste — il dit une chose grave, il la
      disait en sursaut. L'historique reste sur `support-access` pour les
      réglages, et l'écran garde sa règle d'échéance : une reprise peut expirer
      pendant qu'on regarde, et le serveur ne le redira pas.*

      *`en_ligne_depuis` **déplacée** de la composition vers la vue
      d'activation. Elle vivait sur une route dont plus rien ne lit la réponse ;
      la journée charge déjà la vue d'activation, donc la date y arrive sans
      requête de plus. Sans lecteur pour l'instant — le bandeau des sept
      premiers jours l'attend, avec la portée locale qui lui manque encore.*

- [x] **Les deux champs que la planche réclamait : le total de la recherche, et le palier du favori**
      *`GET /admin/businesses` devient une enveloppe `{items, total}` et porte
      `created_at`. Une liste nue ne pouvait porter aucun total, et l'écran
      borne à cent : sans le compte, « 4 sur 742 » ne s'écrit pas et le plafond
      dit qu'on tronque sans dire de combien. Le total est celui de la recherche
      courante — compté sans la borne, sur les mêmes conditions ; compter les
      lignes rendues redirait « 100 » dès qu'on dépasse, ce qui est exactement
      le nombre qu'il ne faut pas croire. L'écran d'administration le lit déjà.*

      *`palier_requis` sur un favori, servi seulement quand l'état est
      `hors_palier`. **Le palier de cette prestation, pas le prochain de la
      créatrice** : les deux diffèrent dès qu'un article n'est offert qu'à un
      palier lointain, et écrire l'autre promettrait une ouverture qui n'aurait
      pas lieu — la seule promesse que cet écran est construit pour ne pas
      faire. Sans lecteur pour l'instant, la composition se fait ailleurs.*

- [x] **La portée locale complète la ligne de confirmation**
      *« En ligne depuis trois jours » était vrai et ne rassurait personne. Il
      manquait « et 41 créatrices peuvent vous réserver », qui est ce qu'un
      salon qui vient d'apparaître veut savoir. Servi sur la vue d'activation,
      que la journée charge déjà — pas de seconde requête pour une demi-phrase.*

      ***Calculé seulement dans la fenêtre où il se lit.** La portée coûte
      quatre requêtes et une boucle sur le quartier ; les payer à chaque
      ouverture de la journée, pendant toute la vie du salon, pour une ligne qui
      disparaît au bout d'une semaine, serait le mauvais sens exact. Hors
      fenêtre le champ est nul, et rien n'est calculé.*

      ***Le délai est servi avec.** `ACTIVATION_CONFIRMATION_DAYS`, sept par
      défaut. La règle des sept jours vivait en dur dans l'app, et elle décide
      désormais aussi côté serveur si la portée est calculée : deux copies d'un
      même délai finissent par diverger, et le jour où elles le font l'écran
      montre « depuis 8 jours » sans le nombre qui rassure — le pire des deux
      états.*

      ***Zéro se tait.** « 0 créatrice peut vous réserver » sur la ligne qui doit
      rassurer serait la pire phrase du produit ; la date seule reste vraie.
      Trois branches écrites à la main, comme le titre de la journée — `count`
      traverse le formateur de nombres et la pluralisation d'i18n-js ne se
      déclenche plus.*

- [x] **Le favori porte sur la prestation — tranché définitivement**
      *La planche s'aligne sur le contrat, pas l'inverse, et Design est prévenu.
      `ItemDuFil.est_favori` est posé sur l'article, `POST /me/favorites` prend
      un `catalog_item_id`, et `GET /me/favorites` rend des prestations avec
      leur état. Garder un salon aurait demandé une autre table et un autre
      écran, pour un geste que personne n'a demandé — et « j'ai un favori chez
      eux » répond déjà à la question*
- [x] **Ce qu'un favori déclenche est décidé, et sa place aussi**
      *Faut-il prévenir quand une prestation s'ouvre au palier de la créatrice ?
      Ce serait la première notification sortante du produit, donc une décision
      de fond — et Design note que le cœur perd la moitié de son intérêt sans
      elle*
- [x] **La liste des favoris se lâche autant qu'elle se garde**
      *Le cœur y était décoratif — « retirer se fait là où l'on a posé » — et
      c'était faux pour la moitié de la liste : un salon qui ne paraît plus
      n'est dans aucun fil, donc son favori n'aurait **jamais** eu d'endroit où
      être retiré. La liste se serait remplie une fois pour toutes.*
      *Le retrait est optimiste et revient si le serveur refuse. Et la ligne
      entière ouvre le salon, y compris sur une prestation réservable — c'était
      réservé au bandeau des états bloqués, donc le cas le plus fréquent ne
      menait nulle part. 1482 tests, 3 mutations*
- [x] **L'interrupteur des notifications de favori est posé**
      *Deux notifications arrivent — la prestation qui devient accessible, le
      salon qui rouvre — et ce sont **les premiers messages non transactionnels
      du produit**. La règle qui a retiré les préférences tient parce que tout
      ce que le produit dit est déclenché par celui qui le reçoit ; ces deux-là
      partent trois semaines après un cœur posé, sans que personne n'ait rien
      demandé.*
      *La place est décidée : **un seul interrupteur, sur l'écran des favoris**,
      au-dessus de ce qu'il gouverne, absent quand la liste est vide. Pas dans
      les réglages — un interrupteur dont le sujet n'est pas à l'écran est le
      défaut diagnostiqué sur « profil et mise en ligne ». Pas un par favori —
      ce serait le mur qu'on vient de retirer, une case à la fois.*
      *Non dessiné faute de champ : un interrupteur qui ne commande rien est
      pire que son absence. Demandé à `bind-agency-1a` — un booléen vrai par
      défaut, plus les deux genres dans `NotificationKind`*
- [x] **La configuration v3.1 : deux portes de rang égal, et la photo qui se dépose**
      *« Your offer » et ses deux onglets disparaissent. La découpe est par
      objet — ce qui décrit l'endroit, ce qui décrit ce qu'on y fait — et elle
      recoupe la fréquence : un lieu se compose une fois, un catalogue vit en
      continu. Les horaires rejoignent la couverture et la carte, parce que des
      heures d'ouverture décrivent un endroit.*
      *Et la photo par prestation se dépose enfin. `photo_key` était déclarée
      corrigeable, la route de dépôt existait, **et rien ne les reliait** :
      aucun écran ne savait produire de clé. Elle est trouvable par son
      absence — cadre pointillé dans la liste, « needs a photo » en état.
      1522 tests, 4 mutations*
- [x] **Les cartes de la fiche restent, la planche les voulait en lignes**
      *Tranché : gardées. L'attendu avant réservation, le prochain créneau et
      l'écart au seuil sont exactement ce qui fait décider, et une ligne de 64
      points ne les montre pas. Design a composé la compacité en pensant à la
      lisibilité de la liste, pas à ce qu'elle porte — ce qui reste de la
      planche est pris : les deux ensembles nommés et comptés, le cœur par
      ligne, et le bloc du compte à connecter*
- [x] **Les quatre colonnes, là où la place existe**
      *La planche est dessinée à 1512, où elles tiennent. Sur 390, quatre
      colonnes ne sont pas des colonnes : le nom se tronque au troisième mot et
      la durée passe sous le palier. La carte du comptoir reste donc la carte,
      et la table ne s'ajoute qu'au-dessus du seuil — deux compositions pour
      deux places, jamais une pour les deux.*
      *Nom, durée, palier, état, avec un en-tête posé une fois au-dessus de la
      liste entière et non par groupe de palier : les prestations sans palier
      sont dans la même table, et un en-tête par groupe en aurait fait
      plusieurs. Le test monte les deux largeurs sur le même décor — n'éprouver
      que la grande passerait avec une table posée partout, c'est-à-dire avec
      ce qu'on a refusé de livrer*
- [x] **La capacité reste au lieu**
      *Tranché, et l'argument retourne la question de Design. Un nombre de
      fauteuils est une propriété de l'endroit, et l'exception du jour existe
      pour les écarts. **Si elle bougeait souvent, ce serait le signe que le
      nombre déclaré est faux, pas qu'il est au mauvais endroit** — la
      fréquence mesurerait alors une erreur de déclaration, pas un besoin de
      déplacement*
- [x] **Le résumé de composition a retrouvé sa fonction, en trois endroits**
      *Il disait à un salon ce qui manque avant qu'il apparaisse — « douze dont
      trois éteintes n'est pas la même composition que douze visibles, et c'est
      la moitié qu'on oublie ». La fonction se pose au pied de la liste qu'elle
      compte : « 8 services · 5 open to creators ».*
      *Deux de ses trois nombres se comptent dans l'écran qui tient déjà les
      articles — un appel pour un nombre qu'on peut compter serait deux comptes
      qui finiraient par diverger. La définition est recopiée du serveur : le
      parent d'une gamme n'est pas une prestation, et la visibilité se lit sur
      `is_effectively_available`. 1519 tests, 2 mutations*
- [x] **La confirmation des sept premiers jours, à moitié**
      *`en_ligne_depuis` est servi, et il donne enfin une origine à la règle :
      le bandeau d'encre devient une ligne de confirmation, qui s'efface au
      bout de sept jours. Les deux côtés du seuil sont éprouvés — une
      confirmation qui ne s'effacerait jamais est un bandeau dont on ne
      comprend plus l'objet.*
      *Ce qui manque encore est **la portée locale** — « 41 créatrices peuvent
      vous réserver ». Elle ne vit que sur les rapports, et la journée ne va pas
      chercher une seconde requête pour une demi-phrase. La ligne s'arrête donc
      à ce qui est vrai : depuis quand. L'affirmer à l'estime serait une
      confirmation fausse ; ne pas l'écrire n'enlève rien à la date. Demandé*
- [x] **Les planches v1.0 confrontées cadre par cadre, et trois trous nommés**
      *La question posée n'était pas « faut-il les redessiner » — c'est du
      travail de Design — mais **« les écrans ont-ils été confrontés à leurs
      cadres »**. C'est le motif qui a coûté trois campagnes à l'audience, et
      celui qui avait laissé `Lot 1 v1.1` sans entrée nulle part.*
      *Les quatre planches v1.0 portent **55 cadres**. Le registre, lui, n'a
      jamais tenu qu'un état **par planche** — « Passée » en bloc — et c'est
      exactement la lecture qui surestime ou sous-estime, comme le cadre 02 l'a
      montré. Confrontés un par un : la plupart sont dépassés par une planche v3
      qui a eu, elle, sa confrontation — le fil (cinq fois), la fiche, le
      créneau, la preuve, l'accueil, l'audience, la journée, le catalogue, les
      horaires, la caisse, les publications, l'activation, l'arbitrage, les
      plans.*
      ***Trois cadres ne sont dépassés par aucune planche v3 et n'existent dans
      aucun écran :***
      *— **05d, le créneau pris pendant qu'on choisissait.** « 14:30 vient
      d'être pris · Encore libre aujourd'hui · 16:00, 17:15 · Confirmer pour
      16:00 ». Aujourd'hui, ce cas rend le message d'erreur générique du client
      et laisse la créatrice devant une liste qu'elle doit relire. C'est le seul
      des trois qui coûte une réservation.*
      *— **07d, l'envoi de preuve en cours, avec son pourcentage** — et une
      phrase que la v3.1 cherchait : « L'envoi continue si tu quittes l'écran.
      Tu peux fermer l'app. » La v3.1 pose la question de l'échec en
      arrière-plan comme ouverte ; **la v1.0 y avait déjà répondu**, et c'est
      une décision de mécanisme qui attendait qu'on relise la planche.*
      *— **14c, le commerce suspendu et ce qu'il doit encore.** « Motif : trois
      retraits refusés au comptoir · Ce qui reste dû · Réservations à honorer ».
      Le produit sait suspendre ; il ne montre nulle part ce qui reste dû. C'est
      la même règle que la phrase ajoutée à la suppression cette semaine — les
      réservations acceptées sont honorées — et elle n'a pas d'écran.*
      *Les trois sont de la composition, et deux dépendent d'un arbitrage : ce
      qu'on propose quand un créneau tombe, et si l'envoi part en arrière-plan.
      **Tranché : 05d et 14c pris, 07d refusé** — voir l'entrée suivante*

- [x] **Les deux cadres orphelins qui restaient, et le troisième refusé**
      *05d et 14c livrés, 07d écarté. Le refus est la partie qui compte, et il
      est écrit ici parce que rien d'autre ne le dira : un cadre non pris
      ressemble en tout point à un cadre oublié, et la planche v1.0 le
      redemandera dans six mois.*
      ***07d, l'envoi qui continue si on quitte l'écran — refusé.*** *« Une
      décision plus récente le contredit : l'envoi ne part qu'au premier plan,
      parce qu'un envoi en arrière-plan qui échoue laisse quelqu'un croire qu'il
      a fini. La v1.0 répondait sans avoir vu le cas d'échec. » La planche
      n'avait pas tort au moment où elle a été dessinée ; elle a été écrite
      avant que l'échec existe, et une réponse donnée avant la question ne vaut
      que tant que la question ne change pas.*
      ***05d, le créneau pris pendant qu'on choisissait.*** *Le seul des trois
      qui coûtait une réservation. L'échec `booking_slot_unavailable` rendait le
      message générique du client, et renvoyait la créatrice relire la liste
      entière — c'est-à-dire refaire depuis le début le choix qu'elle venait de
      faire. L'écran propose désormais les trois premières heures encore libres
      **du même jour**, en neutre et non en cramoisi : personne n'a mal fait
      quoi que ce soit. Et il dit « plus rien aujourd'hui » quand il ne reste
      rien, plutôt que de rendre un bloc vide.*
      ***14c, le commerce suspendu.*** *`miseEnLigne` traitait `suspended`
      comme une composition inachevée : le salon lisait « deux points avant que
      les créatrices vous voient », et cocher les deux n'aurait rien changé — ce
      qui le retient est une décision prise sur lui. Le bandeau d'encre dit
      maintenant la suspension et **ce qui reste dû**, sur la même règle que la
      phrase de la suppression : les réservations acceptées sont honorées. Le
      **motif** de la suspension n'est pas servi — `VueDActivation` ne porte que
      `status` — il est demandé plus bas.*
      *Deux mutations. La seconde a survécu et c'est elle qui a appris quelque
      chose : le test ne montrait que le créneau pris, si bien que « proposer
      des heures quand le créneau tombe » et « en proposer à **n'importe quel**
      échec » rendaient le même verdict. Une panne réseau y aurait proposé une
      heure qui retombe dans la même panne. Le cas divergent — une 500 garde le
      message d'échec et ne propose rien — a été écrit après, et il tombe sur la
      mutation.*

- [x] **Le compte du salon suspendu disait le contraire de sa phrase**
      *Livré hier, et faux d'un jour. Le bandeau recevait les réservations du
      jour **plus** la file à trancher, sous une phrase qui dit « les N
      réservations que vous avez déjà acceptées » : un salon sans aucune
      réservation et trois demandes en attente lisait qu'il en avait accepté
      trois. Les deux ne se somment d'ailleurs pas — la file vient du serveur et
      porte des décisions pour après-demain, la journée ne connaît qu'un jour.*
      *La phrase nomme maintenant le jour, et le compte ne prend que ce qui a
      été accepté. Le cas divergent — rien d'accepté, trois demandes — tombe sur
      l'ancien câblage ; il fallait le monter sur l'écran et non sur le bandeau,
      parce que le défaut était au point d'appel et qu'un test du composant seul
      l'aurait manqué en beauté*

- [x] **Le registre des planches, à jour de la génération v3**
      *Vingt-six lignes ajoutées, titres relevés dans le projet Design plutôt
      que devinés. Le registre s'arrêtait à `Lot 1 v1.1` : toute la génération
      Ambre était passée sans y entrer, tracée en entrées cochées — c'est-à-dire
      là où on cherche du travail, pas l'état d'une planche. La règle du haut ne
      gardait donc plus rien depuis douze planches.*
      *Design tient son propre index, `INDEX-planches.md`, qui date chaque
      planche et dit ce qu'elle a **tranché** ; il se termine en disant que le
      rapprochement avec ce qui a été **construit** appartient au dépôt. Les deux
      documents se répondent, et c'est l'écart qui se voit.*
      *L'écart, une fois le rapprochement fait, tient en un nom — voir l'entrée
      ci-dessous. Vingt-cinq planches sur vingt-six sont passées ou reportées
      avec leur raison écrite ; six n'ont pas de ligne chez Design parce
      qu'elles sont arrivées après sa dernière mise à jour*

- [x] **`Creator - Les reservations v3`, confrontée — et ma propre alerte corrigée**
      ***Je l'avais annoncée « jamais confrontée », et c'était faux.*** *La
      confrontation a bien eu lieu : `sectionAVenir`, `verbeDeLaContrepartie`,
      `surfaceDe`, les cadres 08b et 08c cités dans le code, et un fichier de
      tests entier — `reservations-08.test.tsx`. Ce qui manquait était l'entrée
      dans ce fichier, pas le travail. J'avais conclu de l'absence d'entrée à
      l'absence de travail, ce qui est exactement le raisonnement que le
      registre est censé rendre inutile.*
      *La leçon n'est pas « le registre ne sert à rien » — sans lui je n'aurais
      rien regardé. Elle est qu'un registre dit **ce qui a été inscrit**, jamais
      ce qui a été fait, et qu'un trou dans le registre est une question, pas un
      verdict. Le vérifier a coûté dix minutes ; l'annoncer sans vérifier
      aurait fait refaire un écran entier.*
      ***Et il y avait bien un écart, plus petit et plus intéressant.*** *La
      décision centrale de la planche pour l'onglet en cours — « le titre est le
      verbe », « Post a story » plutôt que « Gel manicure » — était **calculée
      et jamais rendue**. `verbeDeLaContrepartie` existait, était testé, et ne
      servait qu'à choisir une surface ; sa propre note décrivait pourtant un
      affichage qui n'existait nulle part. C'est le mode d'échec des champs
      servis sans lecteur, transposé à l'intérieur de l'app.*
      *Trois mutations, et **la première a survécu** : j'avais gardé le verbe
      derrière `onglet === 'en-cours'`, ce qui paraissait plus sûr. Les onglets
      se découpent sur le statut — « à venir » tient `held`,
      `awaiting_business` et `confirmed` — et une contrepartie ne naît qu'à la
      consommation : la condition était **inatteignable**, et la retirer laissait
      tout vert. Ce qui décide est la présence d'une contrepartie, et les deux
      cas où le verbe doit se taire ne sont pas le même — pas de contrepartie,
      et une contrepartie close. Les deux écrits, les deux tombent*

- [x] **Le motif de suspension, servi sur la vue d'activation**
      *`suspension_motif` et `suspendu_depuis` sur `VueDActivationRead`. Un code
      de liste fermée, jamais du texte : l'écran le traduit, et une phrase rendue
      par l'API ne passerait aucune garde de traduction. Les deux nuls hors
      suspension — la contrainte de la table le garantit pour le motif.*

      *Le motif vient de la **colonne**, la date du **journal**. Lire un état
      courant dans un journal d'événements est ce qui a déjà coûté cher ici ;
      mais une date de transition ne vit nulle part ailleurs.*

- [x] **Le bandeau dit pourquoi le salon est dehors — et il ne se montrait à personne**
      *Les deux champs servis par l'autre conversation, composés ici.
      `paused_by_business` et `grace_expired` : deux titres, deux phrases. Le
      titre général ne reste que sur le motif absent, parce qu'un salon en pause
      volontaire qui lit « votre compte est suspendu » lit une sanction — et
      c'est exactement le message au support qu'on cherchait à éviter. Une pause
      se lève par le salon lui-même, une grâce en payant : le champ ne vaut que
      par cette différence.*
      *Deux cas divergents. Une réponse **d'avant** les deux champs rend encore
      un bandeau, sans motif : la contrainte de table garantit le motif côté
      serveur, mais une garde de base ne traverse pas un cache d'application, et
      ce bandeau se rend sur une réponse qui a pu dormir. Et la grâce n'est pas
      la pause : sans ce cas, un écran qui poserait la pause par défaut passerait
      tous les autres.*
      ***Le vrai défaut est apparu en écrivant le test, et il est plus vieux que
      cette tranche.*** *Le bandeau ne vivait que dans les enfants de l'écran,
      donc jamais dans l'état vide — or les deux états qu'il annonce **vident la
      journée par construction** : un salon pas encore publié n'est dans aucun
      fil et ne reçoit rien, un salon suspendu en est sorti. « Il reste deux
      points avant que les créatrices vous voient » ne s'affichait donc jamais
      au salon qui n'était pas publié. L'écran le plus regardé du produit
      cachait sa seule consigne à ceux à qui elle s'adresse.*
      *Rien ne pouvait le dire : le décor de tous les tests du bandeau portait
      une journée pleine, où les deux implémentations rendent le même verdict.
      C'est le test de la pause — journée vide, puisque c'est la seule qu'un
      salon suspendu aura — qui a échoué en timeout et fait trouver le reste.
      Deux mutations, les deux tombent*

- [x] **Le seul écran qui montre des montants les composait à la main**
      *Trouvé en balayant la famille que la planche des réservations avait
      révélée : du code qui a l'air de faire quelque chose. `PlansScreen`
      formatait ses montants avec `${(cents / 100).toFixed(2)} ${devise}` —
      « 198.00 USD » dans toutes les langues, point décimal et code de devise,
      alors que le reste de l'écran passe à la virgule en espagnol. Et
      `formatMoney` existait dans `format.ts`, avec `Intl` et la langue, sans
      **aucun appelant**.*
      *Deux traitements du même sujet dont un seul est branché, et c'est celui
      qui a tort : le cas est plus vicieux que la simple duplication, parce que
      la copie correcte ne peut pas dériver — elle ne sert pas.*
      *Le décor divergent est la **langue**, pas le nombre. En anglais les deux
      implémentations rendent des chaînes différentes et également plausibles ;
      seul l'espagnol montre laquelle ne regarde pas la langue. Et l'assertion
      porte le littéral que l'utilisateur voit — l'écrire avec `formatMoney`
      n'aurait prouvé que l'auto-cohérence de la fonction*

- [x] **L'application web s'installe sur un écran d'accueil**
      *La distribution de la démonstration passe par le web — le compte Apple
      attend l'entité légale — donc l'installation est le premier contact de
      Rebecca avec le produit. Manifeste, trois icônes, plein écran, et le nom
      sous l'icône.*
      ***Le gabarit HTML est vérifié avant d'être écrit, et c'était nécessaire.***
      *Deux comportements possibles ne se distinguent pas de l'extérieur :
      `public/index.html` peut être un **modèle** où Expo injecte le script du
      bundle, ou un fichier **recopié tel quel** qui masquerait la page générée —
      auquel cas l'application ne démarre plus du tout, sans erreur. Mesuré sur
      un export réel : c'est un modèle. Un test e2e le tient désormais, parce
      qu'une version d'Expo peut changer d'avis et que l'échec est muet.*
      ***Les icônes sont dessinées, pas réduites**, par la chaîne existante :
      192 et 512 à fond perdu pour l'usage `any`, et une masquable à 512 dont le
      signe rentre dans la **même zone sûre** que les couches d'Android — deux
      marges différentes pour la même application se verraient au moment où le
      lanceur remplace l'une par l'autre.*
      ***Le fond du document passe à l'encre**, et c'est ce qui tient le
      lancement. Le premier rendu arrive après un bundle d'un mégaoctet et demi ;
      avant lui on voit le document nu, blanc par défaut — donc un éclair blanc
      juste avant un écran de chargement à l'encre, à chaque ouverture. Trois
      couleurs doivent coïncider : celle du manifeste, celle du document, celle
      de l'écran de chargement.*
      ***La barre d'état reste opaque**, délibérément. `black-translucent` ferait
      passer la page sous l'heure et la batterie, ce qui demande
      `viewport-fit=cover` et des marges lues dans `env(safe-area-inset-*)` : le
      produit lit déjà ses marges, mais ce qu'elles valent dans une application
      web installée n'a pas été mesuré sur un téléphone. Un test tient les deux
      ensemble — qui passera au translucide apprendra là qu'il doit poser le
      `viewport-fit`.*
      ***Un défaut trouvé en écrivant les tests : l'écran de chargement de la
      marque n'avait aucun test qu'il soit rendu.*** *`Chargement` était éprouvé,
      `App` ne l'était pas — la première chose que voit un utilisateur, à chaque
      ouverture, ne tenait que par relecture. Et la première version du test
      courait après un écran d'une frame : sur cette machine les polices et le
      trousseau répondent d'un coup. Il retient maintenant les polices, ce qui
      **rend observable la condition réelle** d'un téléphone plutôt que d'en
      fabriquer une.*
      *Cinq mutations. **La quatrième a survécu** : mon test des tailles listait
      les trois paires à la main, donc il vérifiait que trois fichiers ont la
      bonne taille — ce que personne ne contestait — pendant que la déclaration
      pouvait mentir à côté. Faire pointer l'entrée « 512x512 » vers le fichier
      de 192, c'est-à-dire le défaut exact qu'il annonçait, le laissait vert. Le
      manifeste est devenu le sujet du test, et la mutation tombe.*
      *La garde des sélecteurs e2e a refusé les miens, à raison : ils visent
      l'en-tête du document, qu'aucun écran ne peut porter. Catégorie déclarée
      avec sa raison plutôt que contournée, et étroite — trois noms de balise et
      un attribut, un `data-testid` n'y passe pas.*
      ***Ce qui reste à regarder sur un téléphone**, et qu'aucun test ne peut
      rendre : qu'iOS propose bien « Sur l'écran d'accueil », et qu'ouvrir depuis
      là ne ramène pas la barre de Safari. Tout ce dont ces deux choses dépendent
      est éprouvé ; les deux faits eux-mêmes demandent un appareil*

- [x] **Trois défauts de composition, avant la démonstration**
      ***Le catalogue, troisième retour, et la même cause à chaque fois.*** *Les
      prestations ne se distinguaient pas les unes des autres : la ligne portait
      tout ce qu'il faut **dans** une prestation, et rien qui la sépare de sa
      voisine — pas de surface, pas de filet, seulement un `gap` de huit. Dix
      prestations faisaient un bloc gris où le nom de l'une touchait la durée de
      la suivante. Deux traitements, parce qu'il y a deux formats et deux
      lectures : au comptoir une carte à filet, qui est le traitement du système
      pour ce qui informe ; en table des rangées jointives séparées d'un filet,
      comme sous l'en-tête. Des cartes en table feraient des îlots là où l'œil
      suit une colonne ; des filets au comptoir ne suffiraient pas, une ligne
      dépliée y déborde sur trois blocs.*
      ***La date des réservations s'empilait, et la cause tenait en un
      nombre.*** *Le moment vivait dans une colonne de cinquante-deux points, où
      `formatDateTime` rend « Aug 26, 2026 at 2:30 PM » : chaque mot passait à
      la ligne. Cette largeur est celle du quantième seul de l'historique — deux
      chiffres — et elle a été reprise pour une carte qui porte une phrase. Le
      moment remonte dans la colonne principale, sur une ligne, et en **repère**
      plutôt qu'en date : `repereDuCreneau` existait et la fiche s'en sert déjà
      pour la même raison — « demain à 14:30 » se lit sans compter.*
      ***La flèche de « aujourd'hui seulement » ne dépliait rien, deux fois.***
      *`ExceptionDuJour` rendait `null` pendant ses deux requêtes — et il ne se
      monte qu'au moment où l'on ouvre, donc c'était le cas normal du premier
      appui — puis `null` encore quand aucune règle ne couvre ce jour,
      c'est-à-dire sur un jour fermé dans la semaine type. La seconde ne se
      résout pas en attendant : le bloc restait vide pour toujours, et c'est ce
      qu'on voyait. Les deux disent maintenant ce qu'elles sont, et la phrase du
      jour fermé renvoie à la semaine type — c'est là que le jour se rouvre.*
      ***Et « rien à faire » sous « 5 faits aujourd'hui ».*** *Le titre du
      repliable des terminées portait un jugement d'état là où il devait nommer
      un contenu. « Servi et clos » sur cinq lignes servies et closes ne se
      contredit plus.*
      *Deux tests, deux mutations, les deux tombent. Aucune garde neuve*

- [x] **La navigation v6 : quatre onglets en bas, huit lignes au bureau**
      ***Le défaut le plus grave de la campagne, et sa cause n'était pas le
      nombre.*** *Les huit onglets viennent de la coquille de bureau, où une
      barre latérale de 240 points les porte sans effort ; transposés en bas
      d'un iPhone ils font des cibles de quarante-huit points. Ce qui manquait
      est un **tri** — et c'est celui de la fréquence, le même que la
      configuration emploie déjà. En bas ce qui porte une échéance : une
      décision à rendre, un code à valider, un délai de publication qui court.
      Sous « More » ce qu'on a composé une fois et qu'on relit parfois.*
      *Le compte justifie la place : un onglet sans compte n'appelle jamais. La
      journée porte `decisions_en_attente`, déjà servi et déjà lu par le
      sélecteur de salon. **Zéro ne se rend pas** — une pastille à zéro dit
      « rien » en occupant la place de « quelque chose ».*
      *Les quatre écrans rangés **quittent la barre, pas la navigation** : ils
      restent des destinations déclarées, et le menu y mène. Le bureau garde ses
      huit lignes : même donnée, deux mises en forme, comme le sélecteur de
      salon qui est un bouton partout et un mur à la caisse.*
      ***Le menu informe au lieu de rediriger.*** *Chaque ligne porte son
      état — « 6 open · 2 need a photo » — parce qu'un menu qui ne fait que
      rediriger oblige à ouvrir un écran pour apprendre qu'il n'y avait rien à y
      faire. Deux requêtes sur un écran qu'on ouvre rarement, aux mêmes sources
      que les écrans concernés : les recalculer ici en ferait deux comptes qui
      finiraient par diverger.*
      ***Un écart écrit : `liste` et non le « + » de la planche.*** *Un plus sur
      une barre d'onglets se lit « ajouter », juste à côté d'une caisse où l'on
      ajoute effectivement quelque chose.*
      ***Le bandeau « vous êtes en ligne » part — quatrième reprise.*** *Il
      confirmait un état permanent à quelqu'un qui ouvre l'écran pour agir, et
      occupait le tiers haut de l'écran le plus ouvert du produit. Avec lui
      partent la fenêtre de sept jours, ses trois branches de pluriel, et
      `BandeauDeMiseEnLigne` sort de l'inventaire des cartes — c'était la seule
      surface qu'il portait. `createurs_qui_peuvent_reserver` et
      `confirmation_jours` ne sont plus lus : déclarés en `contrat`, et le
      serveur peut cesser de calculer une portée qui coûte quatre requêtes pour
      une ligne qui n'existe plus. Demandé plus bas.*
      ***La phrase de la preuve reprend sa formulation d'origine.*** *Ce qui
      compte est ce qu'on gagne à envoyer vite, pas comment une story
      fonctionne ; et « vous la prenez » répond à la question réellement posée —
      c'est à qui de faire la capture.*
      ***Trois mutations, deux ont survécu et les deux ont appris quelque
      chose.*** *La ligne du menu n'était pas un `Pressable` : elle posait
      `onStartShouldSetResponder` à la main, donc elle répondait au doigt sans
      retour visuel et ne répondait à rien sous test. Le menu ne menait nulle
      part, et seule la garde qui **appuie pour de bon** l'a dit. Et
      l'assertion des onglets du commerce tolérait les autres — remettre les
      huit en bas la laissait verte, c'est-à-dire qu'elle ne gardait rien contre
      le défaut qu'on venait de corriger. C'est l'ensemble qui est la règle*

- [ ] **Le compte des preuves en attente, pour la pastille de l'onglet**
      *La planche v6 pose un compte sur les trois premiers onglets — « les trois
      portent un compte, et c'est ce qui justifie leur place ». La journée a le
      sien ; les publications n'en ont aucun de servi. Le calculer côté écran
      demanderait à la coquille de charger la file des publications à chaque
      ouverture de l'application, pour un nombre qui existe déjà côté serveur.
      Ce qu'il faut : le nombre de preuves qui attendent une décision du salon,
      sur `/me/businesses` à côté de `decisions_en_attente` — même endroit, même
      raison, et une seule requête pour les deux*

- [ ] **La portée locale et le délai de confirmation peuvent cesser d'être calculés**
      *`createurs_qui_peuvent_reserver` coûte quatre requêtes et une boucle sur
      le quartier, et `confirmation_jours` décide de la fenêtre où elle est
      calculée. Les deux existaient pour le bandeau « vous êtes en ligne », que
      Design vient de retirer. Ils sont déclarés en `contrat` côté app pour que
      la garde ne mente pas ; côté serveur, c'est du calcul dont plus personne
      ne lit le résultat*

- [x] **Retirer plutôt que ranger : la journée, cinquième reprise, et les réservations**
      ***Le diagnostic qui manquait aux quatre précédentes.*** *Quatre passes
      avaient rangé les mêmes blocs — sections, densité, bandeau, graisses — et
      aucune n'avait demandé ce que cet écran **n'a pas à porter**. Un écran
      d'action qui contient un réglage, un historique et un profil ne se
      dédensifie pas : il se vide.*
      ***Les prestations servies quittent la journée.*** *Elles sont closes,
      personne n'agit dessus, et la journée d'un salon plein finit avec plus de
      lignes closes que d'ouvertes. Il en reste un compte dans l'en-tête, qui
      ouvre la liste. Deux blocs se comparent d'un regard, trois se lisent — et
      c'est là tout le sujet.*
      ***La capacité du jour rejoint la semaine type, et sa flèche part avec.***
      *C'est elle que la flèche prétendait déplier, corrigée deux fois sans
      succès : elle ne dépliait pas mal, **elle n'avait rien à faire là**. Un
      contrôle de réglage posé sur un écran d'action ne peut pas s'expliquer.
      Elle vit maintenant sous le lieu, à côté de la règle générale qu'elle
      dépasse et dans laquelle elle écrit déjà.*
      ***L'audience de la créatrice y était déjà à sa place**, vérifié plutôt
      que supposé : `ReseauxDeLaCreatrice` n'a qu'un appelant, le détail qu'on
      ouvre pour décider. La ligne de liste ne portait que le pseudonyme et
      l'heure limite.*
      ***Les réservations, même diagnostic.*** *Cinq faits justes de même poids
      — prestation, salon, heure, échéance, palier — dont aucun prioritaire. Le
      titre devient le geste, et le code de retrait en est un : « montre ton
      code » était la seule chose qu'une réservation confirmée demande, et la
      ligne titrait la prestation. Les onglets suivent l'ordre de ce qu'on doit
      faire : ce qui court contre une échéance passe devant un rendez-vous de la
      semaine prochaine, qui n'attend rien de personne.*
      ***Un écart écrit sur le libellé.*** *La planche dit « Waiting on you » ;
      la garde des libellés courts le refuse — 103 points par cellule sur trois
      onglets. « To do » dit la même chose et tient.*
      *Deux mutations, les deux tombent. Un décor corrigé au passage : « confirmée
      sans contrepartie » servait de cas « sans geste », alors que c'est
      précisément le cas qui en a un depuis cette passe. Le vrai cas sans geste
      est celui où l'on attend quelqu'un d'autre*

- [x] **Un seul traitement : la carte de décision, et le serrage sous 22 points**
      ***Quatre grammaires typographiques pour trois faits.*** *La carte portait
      un titre en sans, une date en mono sur une seconde colonne, un corps en
      sans, et une paire glyphe-valeur pour l'échéance : l'œil changeait de mode
      quatre fois pour lire trois choses. Deux captures d'iPhone l'ont montré
      mieux qu'aucune relecture.*
      ***Et la répétition en découlait**, ce qui est la partie intéressante :
      l'heure limite était écrite deux fois parce qu'en mono, isolée d'un verbe,
      elle ne se lit pas comme une échéance mais comme une donnée de plus. Ce
      n'était pas un oubli, c'était la conséquence d'un traitement incapable de
      dire ce qu'il portait. Une colonne, deux graisses, chaque fait une fois, et
      l'échéance dans la phrase qui l'explique.*
      ***Les dates deviennent relatives.*** *« Aug 30, 2026 at 2:00 PM » demande
      de se situer dans un calendrier ; « demain à 14:00 » se lit.
      `repereDuCreneau` tranchait déjà pour la fiche et pour les réservations de
      la créatrice — le produit ne compte pas les jours de deux façons. Au-delà
      d'une semaine la date brute revient, parce qu'il n'y a plus de repère
      humain.*
      ***Le serrage de −0,015 em quitte les tailles sous 22 points.*** *Il tient
      un grand chiffre ensemble ; petit, il ferme des contreformes déjà
      compactes. Il reste sur le display et les titres, où la taille lui donne de
      quoi mordre, et `section` garde le sien — 22 est la borne. Un seul échelon
      était concerné, `type.titreDApercu` à seize points, lu par les trois
      titres de carte de liste.*
      *Deux mutations. **La seconde a survécu** : rien ne tenait la règle qu'on
      venait de poser, et une approche se repose échelon par échelon sans qu'on
      le voie — c'est ainsi que les règles de ce système ont déjà disparu une
      fois. Une assertion de plus dans l'inventaire de type existant, pas un
      fichier de garde neuf.*
      ***Une réserve sur la méthode**, écrite parce qu'elle change ce qui a été
      vérifié : le MCP de Design a perdu son autorisation et la planche v8 n'a
      pas pu être lue. Les trois changements viennent du brief, qui les nomme
      précisément ; ce qu'une planche montre et qu'un brief ne dit pas — un
      espacement, un ordre de blocs — n'a donc pas été confronté*

- [x] **La v8 confrontée à la planche, et une seule chose à reprendre**
      *La planche n'a pas pu être lue — le connecteur Design a perdu son
      autorisation en cours de session, et `/design-login` demande un terminal
      interactif. Daniel a donc décrit les quatre points qu'elle porte et que le
      brief ne disait pas ; ils se vérifiaient sans accès.*
      ***Sur cinq points, le produit gagne sur trois**, et c'est le résultat qui
      compte le plus de cette passe :*
      *— **L'audience ne revient pas.** La planche la remettait sur la ligne
      d'attribution, que la v7 avait retirée deux jours plus tôt. Cause
      identifiée par Design lui-même : en refaisant la carte pour corriger la
      typographie, il en a retapé le contenu depuis une version antérieure —
      **le défaut de la planche repeinte, appliqué à une planche**. Signalé
      plutôt que tranché seul, et c'est ce qui l'a fait voir.*
      *— **La graisse 700 à seize points n'existe pas** dans l'échelle : le
      titre reste en 600.*
      *— **L'ambre et sa condition restent.** La planche demandait une emphase
      permanente sur le mot d'heure ; une emphase permanente cesse d'être une
      emphase.*
      *— Les gestes restent dans la liste sur téléphone : ils n'ont nulle part
      ailleurs à aller en 390 points, et « depuis la fiche » vaut pour le
      bureau. La ligne en retard n'a pas de bouton pour une autre raison —
      l'absence ne s'ouvre qu'à vingt minutes puis réellement à quatre heures,
      ce n'est pas une décision à prendre en passant.*
      *— L'heure du rendez-vous devait entrer dans le titre **parce que**
      l'audience occupait la ligne d'attribution. L'audience partie, elle y
      retrouve sa place : rien à faire.*
      ***La seule reprise : une date est une phrase.*** *La sous-ligne du jour
      se composait comme un tampon — point médian entre le jour et les heures,
      tiret entre les bornes, zéros de tête : « Wednesday 26 August ·
      09:00–19:00 ». Aucun de ces trois signes n'est mono, et l'ensemble se
      lisait pourtant comme une donnée : **c'est la ponctuation qui porte la
      grammaire, pas seulement la fonte**. Une virgule, le mot de liaison de la
      langue, et pas de zéro de tête.*
      *Le mot vient de la langue et non du code : « to » et « a » ne se
      devinent pas d'un tiret. Une mutation, elle tombe*

- [x] **L'administration reçoit sa passe de composition**
      *Jamais faite jusqu'ici. La planche n'a pas pu être lue — le connecteur
      Design est sans autorisation depuis deux jours — et le brief nommait les
      corrections assez précisément pour s'en passer.*
      ***L'ambre revient à la navigation seule.*** *La rangée choisie de la table
      d'administration était peinte en `brand.50` : sur une file de quinze
      lignes, la couleur de marque cessait de dire « ici » pour dire « une ligne
      parmi d'autres ». Elle passe en matière — `bg.inset` et filet `line.solo`
      — qui dit la même chose sans dépenser la seule couleur dont la navigation
      dispose. Même raison pour la case cochée, qui est de l'ornement répété par
      rangée, pour les dix jauges des plans — un écran qui se lit et n'offre
      aucun geste — et pour les onze « Take over » de l'annuaire des salons, qui
      faisaient de la reprise la colonne de l'écran au lieu de son exception.*
      *Ce qui **garde** son ambre : le lien qui ouvre les notes de l'arbitrage.
      Un lien est un geste, pas de l'ornement, et c'est la seule action du
      panneau.*
      ***Une phrase déguisée en étiquette.*** *« Ce qui s'ouvre, et rien
      d'autre » était en capitales espacées de onze points sur la reprise de
      compte : une étiquette n'a pas de verbe, et une phrase qui en prend le
      costume se lit deux fois — une fois pour la déchiffrer, une fois pour la
      comprendre. Elle passait de surcroît sous le seuil de contraste, que onze
      points en `ink.soft` ne tiennent pas.*
      ***Les poignées quittent le mono.*** *Un pseudonyme n'est pas un code lu
      caractère par caractère ; « @casabruma » se lit d'un mot. Même défaut que
      les dates en mono, corrigé la semaine dernière, et même correction.*
      ***La question ouverte se répond depuis le code, et la réponse est
      rassurante.*** *Design s'inquiétait de « 48 nœuds en mono contre 4 en
      sans » sur le panneau d'arbitrage. Le panneau construit en porte **un** —
      le rang d'une tentative. Les quarante-huit sont ceux de la maquette, pas
      du produit : la densité qu'il redoutait n'existe pas ici, et il n'y a donc
      pas de colonne à retirer.*
      *Deux mutations, toutes deux survivantes au premier tour — rien ne tenait
      la règle qu'on venait de poser. Une assertion de plus dans l'inventaire de
      type existant, portant sur la **table partagée** et non sur les écrans qui
      l'emploient : c'est là que les quinze occurrences naissent, et un lien
      d'action doit pouvoir garder son ambre*

- [x] **Chaque écran porte son nom, et cinq ne l'avaient pas**
      *Trouvé en parcourant le produit à la main, et par rien d'autre. Un
      parcours de bout en bout se porte par l'écran qu'il éprouve — c'est ce que
      la garde des sélecteurs exige — et un écran sans `testID` ne peut pas être
      visé du tout : l'exploration a dû cibler des contrôles isolés dans la page
      entière, ce qui mesure l'existence d'un bouton et non celle de la page.
      Deux parcours ont échoué sur cette absence, et j'ai d'abord pris l'échec
      pour un défaut du produit.*
      *La caisse et le mode terrain n'en avaient aucun — l'une parce qu'elle ne
      passe pas par `Ecran`, faute de requête à quatre états. La garde en a
      révélé trois autres : la santé, la création d'un commerce — qui portait
      un nom sans le préfixe — et **la revue de carte, qui n'avait aucun
      identifiant du tout**, ce qui explique qu'aucun parcours n'ait jamais
      atteint l'import automatique.*
      *L'assertion vit dans la couverture des écrans, dont c'est déjà le sujet.
      Une mutation, elle tombe*

- [x] **L'étiquette des plans joignait deux faits par un point médian**
      *« Read only · monthly figures computed server-side » : quarante-sept
      signes en capitales espacées de onze points, et le point médian y servait
      de **conjonction** — ce qu'un séparateur ne sait pas faire. Il range côte
      à côte, il ne relie pas, et l'œil doit fabriquer lui-même le lien que la
      phrase aurait porté.*
      *La règle de la passation, §13 ter : une étiquette fait moins de
      vingt-quatre signes ; au-delà c'est du texte, et il s'écrit comme une
      phrase. Restent des étiquettes les têtes de colonnes, les états d'un ou
      deux mots, les intertitres.*
      *Une mutation, et elle a survécu au premier tour — rien ne tenait la
      règle. L'assertion vit dans le test de l'écran, et elle éprouve la **casse
      rendue** plutôt que le nom du jeton : c'est ce que l'œil reçoit, et un
      jeton peut changer de nom sans que la règle change*

- [x] **Les deux autres étiquettes, tranchées : une passe, l'autre reste**
      *`annuaire.trieePar` — « Sorted by access, then distance », 31 signes —
      **passe en texte**. Décrire un ordre demande un verbe : ce n'est pas une
      catégorie, c'est une règle de tri, et les capitales espacées la faisaient
      lire deux fois.*
      *`reglages.reprisesTitre` — « When BIND entered your account », 30 signes —
      **reste une étiquette**. C'est un titre de section et non un fait à lire :
      l'exception de la passation s'applique, et la borne de vingt-quatre signes
      ne vaut que pour ce qui se lit comme une information.*
      *La distinction est celle qui compte, et elle ne se déduit pas de la
      longueur : deux chaînes de trente signes, deux traitements opposés. Une
      mutation sur celle qui change, elle tombe*

- [x] **La liste d'un palier mène au salon**
      *Elle nomme des prestations réservables — c'est tout son sujet — et
      n'ouvrait rien. Il fallait retenir le nom du salon, revenir au fil et l'y
      chercher, pour arriver à une fiche qui vit **dans la même pile**. Il n'y
      avait qu'à relier : `OffreDuPalier` porte déjà `business_id`.*
      *La rangée était un `DataRow`, composant d'affichage ; elle est enveloppée
      d'un `Pressable` plutôt que de rendre `DataRow` pressable — un composant
      qui montre n'a pas à savoir qu'on peut le toucher. Une mutation, elle
      tombe*

- [x] **Les trois liens publics du salon**
      *Instagram, TikTok, site web : facultatifs, indépendants, et « aucun » est
      un état normal — ils n'entrent dans aucune étape qui retient la
      publication. Trois colonnes plutôt qu'une table de liens : une table
      permettrait n'importe quel réseau, ce que personne n'a demandé, et ferait
      payer une jointure à chaque fiche pour trois champs qui ne bougent jamais.*
      ***Sur « votre lieu », pas dans les réglages.*** *La demande disait
      « réglages », mais `ReglagesScreen` écrit noir sur blanc qu'il ne porte que
      ce qui engage le compte — pause, suppression, déconnexion — et que la
      composition du commerce vit ailleurs. Un lien Instagram décrit la vitrine,
      exactement comme l'adresse et les photos.*
      ***Rien n'est deviné.*** *Le lien du profil d'une créatrice se calcule de
      son pseudonyme et de sa plateforme ; celui d'un salon, non — la page d'une
      marque n'est pas toujours un compte, et la fabriquer rendrait un lien mort
      que le salon découvrirait par un créateur.*
      *Le cas divergent est la chaîne vide : sans conversion en `null`, vider un
      champ enverrait `""`, la fiche rendrait un lien vers nulle part, et le
      salon croirait l'avoir retiré. Une mutation, elle tombe*

- [ ] **`test_l_emission_refuse_sans_adresse_configuree` lit le `.env` de la machine**
      *Trouvé en lançant la suite complète avec `HANDOVER_BASE_URL` renseignée —
      je l'avais posée pour explorer le mode terrain, qui reste invisible sans
      elle. Le test fait `monkeypatch.delenv("HANDOVER_BASE_URL")`, ce qui vide
      `os.environ` mais **n'empêche pas pydantic-settings de relire le fichier
      `.env`**. Il ne passe donc que sur une machine dont le fichier ne porte pas
      la variable, et c'est le cas de toutes jusqu'ici — ce qui explique aussi
      qu'aucune fiche de terrain n'apparaisse jamais au semis.*
      *C'est la famille nommée dans `CLAUDE.md` : « un test de configuration qui
      lisait le `.env` de la machine, vert sur le poste qui portait les
      identifiants et rouge en intégration continue ». Ici c'est l'inverse, et
      donc pire : il est vert partout **parce que** personne ne configure la
      variable qu'il éprouve.*
      *Le geste juste est de surcharger le réglage plutôt que la variable
      d'environnement. Non corrigé ici : `tests/` est tenu par une autre
      conversation cette semaine, et deux mains sur le même fichier de test est
      exactement ce qu'on vient d'éviter ailleurs*

- [ ] **`catalogue/corriger.ts` déclare une règle que personne ne consulte**
      *Même balayage. Le module nomme `CORRIGEABLES` — nom, description, photo —
      et `DEMANDENT_UNE_AUTRE` — durée, nature, réservabilité — avec une note
      soignée, et il est **testé**. Aucun écran ne l'importe : `CatalogueScreen`
      réimplémente la même coupure en ligne, un formulaire pour les trois
      premiers et `remplacerUnItem` pour les autres.*
      *Le produit se comporte bien aujourd'hui, et c'est ce qui rend l'entrée
      facile à repousser. Ce qui coûtera est le jour où la règle bouge : deux
      copies, dont une seule tenue par des tests, et c'est **l'autre** qui
      décide de ce que voit le salon. À trancher plutôt qu'à laisser : ou
      l'écran lit le module, ou le module reconnaît qu'il documente une règle
      descendue dans la route et cesse de se présenter comme la source*

- [ ] **La suspension punitive : une décision produit qui n'a jamais été prise**
      *Non pas un travail en attente — **une décision qui n'existe pas**, et la
      distinction porte tout. La planche 14c de Design écrit « Motif : trois
      retraits refusés au comptoir » ; ce motif n'a ni valeur dans
      `SuspensionReason`, ni mécanisme qui l'écrirait, ni arbitrage sur ce qui
      le déclencherait. Trois retraits refusés dans quel intervalle, refusés par
      qui, avec quel recours — rien de tout cela n'a été tranché.*

      *`SuspensionReason` porte deux valeurs et elles ne sont **pas**
      punitives : `paused_by_business` — le salon s'est retiré lui-même — et
      `grace_expired` — l'abonnement n'a pas été payé. Les deux se disent sans
      détour, et elles ne se lèvent pas de la même façon : la première par le
      salon, la seconde en payant. C'est cette différence qui évite le message
      au support.*

      *Servir un motif punitif sous l'une de ces deux valeurs serait pire que le
      silence actuel : le salon lirait une sanction là où il a fait un choix ou
      oublié une facture. **Ce qui est à faire n'est pas un champ, c'est un
      arbitrage** — et tant qu'il n'est pas rendu, l'écran dit ce qui est vrai.
      Tranché le 2026-08-25.*
- [x] **Un salon neuf sans couverture ne paraît plus : la couverture bloque**
      *La carte du fil au grain salon tire sa vignette de `cover_photo_key`,
      sans repli. Des deux issues, celle qui a été tranchée est la seconde : un
      salon ne paraît pas dans un fil sans photo de couverture, au même titre
      qu'il n'y paraît pas sans adresse. Servir la photo d'un article l'aurait
      fait paraître derrière un soin, ce qui ne dit rien du lieu où l'on entre.*

      ***Trois conditions bloquantes désormais**, contre deux. `MissingCoverPhoto`,
      son code d'erreur et ses deux traductions. Les décors de huit fichiers
      posent maintenant une couverture — c'est la conséquence honnête de la
      règle, et les tests de la condition la retirent explicitement.*

- [x] **Le compte des preuves en attente, par salon**
      *La pastille du troisième onglet. `preuves_en_attente` sur
      `/me/businesses`, à côté du compte des décisions. Le calculer côté écran
      ferait charger la file entière à chaque ouverture du sélecteur, pour n'en
      garder qu'un nombre.*

      ***Une sous-requête corrélée, jamais une seconde jointure** : deux
      `outerjoin` comptés ensemble se multiplient — trois réservations et deux
      preuves donneraient six de chaque. Et les deux statuts comptés sont lus
      depuis le service, pas recopiés : deux définitions d'une même file
      divergeraient, et c'est la pastille qui mentirait.*

- [x] **La portée locale ne se calcule plus sur la journée**
      *La ligne de confirmation de mise en ligne a été retirée de l'écran — elle
      confirmait un état permanent à quelqu'un qui ouvre l'écran pour agir.
      Quatre requêtes et une boucle sur le quartier partaient à chaque ouverture
      de la journée pour une phrase que plus personne ne lit.
      `createurs_qui_peuvent_reserver` et `confirmation_jours` sont retirés de la
      vue d'activation ; la portée reste servie par l'annuaire, qui en a l'usage.*

- [x] **Le jeu de démonstration raconte quelque chose**
      *Il montrait une journée pauvre : une ligne par salon, des demandes
      posées derrière nous qu'aucun bouton ne pouvait trancher, une série
      hebdomadaire plate, aucun favori, et un écran de tournée vide.*

      ***La journée.** Une carte par état plutôt qu'une ligne : consommées,
      confirmées, à trancher, annulée, absence. Ce qui a « déjà eu lieu » est
      mené sur les créneaux de **demain** — journée toujours entière — puis
      reposé sur les heures d'aujourd'hui. Les mener sur aujourd'hui liait la
      composition à l'heure du semis : à 18 h il ne restait que trois créneaux,
      tous partaient au passé, et l'écran n'avait plus rien à trancher.*

      ***Les demandes à trancher sont posées devant nous, jamais derrière.**
      `trancher` refuse une heure dépassée — c'est une garde du produit — donc
      une demande posée le matin s'affichait « à trancher » et refusait les deux
      boutons. Un écran sur lequel on ne peut rien est pire qu'un écran vide, et
      un test l'interdit désormais.*

      ***Les créatrices ont une histoire.** `marquer_les_etats_de_compte` passe
      après les parcours : Nina a eu un compte qui marchait avant que son jeton
      meure. L'ordre inverse lui interdisait de réserver, et son écran de paliers
      montrait un obstacle sur quelqu'un qui n'avait jamais rien fait.*

      ***Les rapports montent.** Un parcours par semaine donnait douze barres
      identiques. Le volume croît — et il croît pour de vrai, ce sont des
      parcours menés par les services.*

      ***Les favoris, dont un hors palier.** L'irréservable s'obtient en retirant
      l'offre du palier, jamais en posant un état.*

      ***La tournée porte ses quatre stades et ses deux voies.** Elle était vide
      faute de `HANDOVER_BASE_URL`, qui n'a jamais été configurée nulle part —
      ni dans `.env.example`, ni chez Render. Les deux la déclarent maintenant,
      et le semis l'annonce plutôt que d'échouer quand elle manque.*

- [x] **`accessibilityState` n'est lu par personne sur le web — les vingt sont faits**
      *Mesuré dans `node_modules` plutôt que supposé : `createDOMProps` de cette
      version de React Native Web n'en contient **aucune** mention. Tout ce que
      l'application annonçait ainsi — **tous les gestes à deux états** — n'arrivait
      jamais au DOM. Sur natif rien n'était cassé, donc le défaut ne se voyait
      que là où l'application est montrée.*

      *`etatAccessible()` pose les deux à un seul endroit : l'objet pour le
      natif, les attributs `aria-*` pour le web. Vingt sites y passent, `Toggle`
      compris. Le refaire à chaque appel, c'est en oublier un — et un état oublié
      ne se voit pas, il s'entend chez quelqu'un qui n'est pas là pour le dire.*

      ***`false` est une réponse**, et c'est le cas qui fait diverger le décor :
      « non coché » n'est pas « pas de case ». Une implémentation qui ne poserait
      l'attribut que sur une valeur vraie passerait un test écrit sur `true`.*

      *La leçon est dans `DECISIONS.md` : un test unitaire qui lit une propriété
      telle qu'écrite ne prouve rien du rendu, et seul un parcours qui regarde le
      DOM peut le voir.*

- [x] **La journée se compose depuis les horaires, plus depuis les créneaux libres**
      *Deux tests du semis tombaient toutes les nuits, sur `main` comme ailleurs :
      l'intégration continue tourne en UTC, c'est-à-dire à vingt-deux heures à
      Miami. Passé la fermeture, `creneaux_libres` ne rendait plus rien avant
      maintenant, la composition basculait sur demain, et la journée courante
      restait vide.*

      ***La cause était une contradiction, pas une limite.** Une prestation
      servie ce matin n'a pas besoin qu'un créneau soit encore libre à l'heure du
      semis : elle a eu lieu, elle est close, et le créneau qu'elle occupait est
      justement pris. Chercher un créneau libre pour poser une chose passée
      revenait à demander que le passé ne se soit pas produit.*

      *Les heures passées viennent donc de `fenetres_du_jour` — la même fonction
      qui décide des créneaux, exceptions comprises. Vérifié à vingt-deux heures :
      chaque salon actif porte une journée, et le salon d'ouverture en porte
      quatre états.*

      ***Les demandes à trancher gardent leur règle** : jamais dans le passé,
      quitte à basculer sur demain. Une garde explicite l'assure — une ligne dont
      l'accord n'est pas passé reste devant nous, où elle se tranche.*

      ***`prochain_creneau_reservable` est retirée**, avec ses deux tests : elle
      n'avait plus d'appelant depuis que sa remplaçante compose la journée
      entière, et ses tests éprouvaient donc du code mort. C'est l'un d'eux qui
      a fini par tomber, faute de créneau libre à minuit — il disait vrai sur du
      code que personne n'exécute.*

- [x] **Cinq défauts qui ne se voient qu'en natif**
      *Tous invisibles sur le web, et pour la même raison de fond : le navigateur
      pardonne ce que Yoga et React Native refusent.*

      ***Trois n'en font qu'un.** `grouperParMois` ne fusionnait que les groupes
      voisins ; le serveur range les réservations sans créneau en dernier, et
      leur `valid_until` retombe dans un mois déjà vu. Deux sections de même clé,
      un avertissement sur le web, un écran grisé en natif — « à venir » et
      « terminées » vidés, et le bouton du code de retrait avec eux, puisqu'il
      vit dans cet écran.*

      ***Le champ de mot de passe** : `height: '100%'` contre un parent qui n'a
      qu'un `minHeight`. Le navigateur retombe sur la ligne flex, Yoga n'a rien
      contre quoi calculer.*

      ***Accorder une réservation** : `key={compte.platform}`, alors que rien
      n'interdit deux comptes sur la même plateforme.*

- [ ] **La fiche d'un salon grise « parfois », sous Expo Go seulement**
      *Signalé en vérification de bout en bout. **En attente d'une occurrence
      documentée** — le message de console au moment où ça grise, ou le nom du
      salon. Sans l'un des deux il n'y a rien à chercher qu'à l'aveugle.*

      *Ce qu'on sait : le mécanisme est `FrontiereDErreur`, qui grise sur toute
      erreur de rendu. Et ce n'est **pas** une clé dupliquée — `FicheScreen` n'a
      que des clés uniques, contrairement aux quatre autres défauts de la même
      campagne. L'intermittence désigne une forme de données particulière.*

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

**Un trou dans le registre est une question, pas un verdict.** Une planche sans
ligne n'a pas prouvé qu'elle n'a pas été passée : elle a prouvé que personne n'a
écrit la ligne. Ce sont deux choses différentes, et les confondre coûte plus
cher que le trou — on annonce un écran à refaire, on rouvre un travail rendu, et
on fait perdre à quelqu'un la journée qu'il aurait passée ailleurs.

C'est arrivé ici, sur `Creator - Les reservations v3`. Aucune entrée ne la
nommait, j'ai conclu « jamais confrontée », et c'était faux : la confrontation
était dans le code — `sectionAVenir`, `surfaceDe`, les cadres 08b et 08c cités
en commentaire — et dans un fichier de tests entier. **Ce qui manquait était la
ligne, pas le travail.**

Le geste est donc toujours le même et il coûte dix minutes : **avant d'annoncer
un trou, aller voir l'écran.** Chercher les noms de la planche dans le code et
dans les tests, pas seulement dans ce fichier. Un registre dit ce qui a été
inscrit ; seul le dépôt dit ce qui a été fait.

Et ce n'est pas un argument contre le registre — sans lui, personne n'aurait
regardé cet écran du tout. C'est un argument sur la façon de le lire : il
désigne où chercher, il ne conclut pas à la place de qui cherche.

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


### La génération v3

**Les titres viennent du projet Design, les états viennent d'ici.** Design tient
son propre index — `design_handoff_bind/INDEX-planches.md` — qui date chaque
planche et dit **ce qu'elle a tranché**. Il se termine par la phrase qui partage
le travail : *« Il ne dit pas si une planche a été implémentée, seulement si elle
a été tranchée. Le rapprochement entre les deux appartient au dépôt, pas ici. »*
C'est ce tableau. La colonne de droite ne répète donc pas la décision, elle dit
ce qui en a été construit.

| Planche | Tranché | Ce que le dépôt en a fait |
| --- | --- | --- |
| `BIND Palette et typographie v3` | 08-18 | **Passée.** La direction Ambre : jetons, typographie, formes. |
| `BIND Creator - Le fil v3` | 08-19 | **Dépassée** par la v5, après v3.1 et v4. |
| `BIND Creator - Le fil v3.1` | — | **Passée**, puis dépassée : chercher, et garder. |
| `BIND Creator - Le fil v4` | — | **Passée**, puis dépassée : une carte par salon, le cœur passe sur la fiche. |
| `BIND Creator - Le fil v5` | — | **Passée.** Rangées par catégorie, cartes qu'on voit. C'est la forme en vigueur. |
| `BIND Creator - La fiche v3` | 08-19 | **Passée**, deux écarts écrits : pas d'étiquette d'horaires faute d'un champ servi, et les glyphes du jeu existant. |
| `BIND Creator - Le creneau v3` | 08-19 | **Passée.** Bande de quatorze jours ; `revolu` ajouté en cours de route. Le cadre 05d de la v1.0 — le créneau pris pendant qu'on choisissait — repris depuis. |
| `BIND Creator - Les reservations v3` | 08-20 | **Passée**, et confrontée cadre par cadre depuis. Les trois onglets, les deux sections nommées de « à venir », la grammaire des quatre surfaces, l'historique en lignes nues avec le mois en séparateur. Un écart trouvé et corrigé : le verbe de l'onglet en cours était calculé et jamais rendu. |
| `BIND Creator - La preuve v3` | 08-20 | **Passée.** Trois champs, et une horloge qui n'est pas celle du téléphone. |
| `BIND Creator - La preuve v3.1` | — | **Passée.** L'échec d'envoi : un échec réseau n'est pas une faute de la créatrice, et la tentative ne compte pas. Son cadre 07d de la v1.0 — l'envoi qui continue en arrière-plan — **explicitement refusé**, raison écrite plus haut. |
| `BIND Creator - L accueil v3` | 08-20 | **Passée.** Le premier écran, repris en dernier. |
| `BIND Creator - L audience v3` | 08-20 | **Passée.** L'écran nommé le plus faible du produit sur trois campagnes. |
| `BIND Creator - L annulation v3` | 08-22 | **Passée.** Passé la fenêtre, on arrête de parler du score. |
| `BIND Merchant - La journee v3` | 08-21 | **Passée**, en trois retours. La mise en ligne y est devenue un état et l'exception y est remontée. |
| `BIND Merchant - Les rapports v3` | 08-21 | **Passée.** À zéro donnée, l'écran change de nature. |
| `BIND Merchant - L annuaire v3` | 08-21 | **Partiellement passée**, reste reporté avec sa raison — les trois filtres de la planche n'existent pas sur la route, et les poser côté écran filtrerait une page au lieu d'une liste. Section dédiée plus bas. |
| `BIND Merchant - La configuration v3` | 08-21 | **Passée.** Deux gestes et un état ; le mot « go live » a quitté le produit. |
| `BIND Merchant - La configuration v3.1` | — | **Passée.** Deux portes de rang égal, et la photo qui se dépose. |
| `BIND Merchant - L abonnement v3` | 08-22 | **Passée.** Quatre routes complètes qui n'avaient aucun écran ; la grâce se dit en trois intensités. |
| `BIND Merchant - Le selecteur de salon v3` | 08-22 | **Passée.** Un gérant qui a deux salons peut ouvrir le second. |
| `BIND Admin - L arbitrage v3` | 08-21 | **Passée**, quatrième issue comprise : clore sans faute, sans aucun événement de fiabilité. |
| `BIND Admin - Les plans v3` | 08-21 | **Passée.** La largeur va à la durée médiane et à la catégorie. |
| `BIND Admin - La reprise et les appareils v3` | 08-22 | **Passée pour la reprise** — quatre freins, portée bornée, le salon met dehors depuis la journée. **La moitié « appareils » est reportée avec sa raison** : `GET /me/devices` n'existe pas et la révocation exigeait de posséder le jeton qu'on n'a que sur l'appareil perdu — un cercle, rompu depuis par l'identifiant opaque. |
| `BIND Terrain - La tournee v3` | 08-22 | **Passée**, suivi de tournée compris — le chiffre décisif est l'écart entre les deux voies de remise, pas le taux d'activation. **Un écart écrit** : `HandoverChannel` n'a pas de valeur pour le SMS alors que la planche propose « by text ». |
| `BIND Marque - Le chargement v3` | 08-22 | **Passée**, direction A : le point qui tombe et cale les lettres, plafond de 800 ms qui n'est pas une cible. |
| `BIND Systeme - L attente v3` | 08-22 | **Partiellement passée.** Les règles de composition sont faites, cache compris. Ce qui raccourcirait vraiment l'attente tient au serveur — entrée ouverte plus haut. |
| `BIND Les deux derniers ecrans v3` | — | **Passée.** L'écran d'administration des salons — quatre colonnes, plafond de cent lignes écrit avec son remède, et « Take over » pour seul mot cliquable — et les favoris avec leur veille d'ouverture. |

**Six planches n'ont pas de ligne dans l'index de Design**, et ce n'est pas une
négligence de sa part : `Le fil v3.1`, `v4`, `v5`, `La preuve v3.1`,
`La configuration v3.1` et `Les deux derniers ecrans v3` sont des révisions de
point ou des planches arrivées après sa dernière mise à jour, le 22 août. Elles
sont datées ici par ce qu'elles ont remplacé.

**Et le rapprochement a trouvé exactement un trou.** `Creator - Les reservations
v3` a été tranchée le 20 août — *« une ligne dit ce qu'elle attend ; le détail
n'arrive qu'au moment d'agir »* — et **aucune entrée de ce fichier ne la
confronte**. L'écran a bien été touché depuis : le bouton qui cessait de
s'étirer, la reprise en contour d'encre. C'est du repeint, pas une
confrontation, et c'est le mode d'échec que ce registre nomme lui-même le plus
discret : il ne laisse **aucun écran laid derrière lui**. La dernière
confrontation réelle de cet écran est le cadre 08 de `Lot 1 v1.1`, c'est-à-dire
une planche v1.0. C'est mot pour mot ce qui a coûté trois campagnes à l'audience.


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

- [x] **Les filtres de l'annuaire : palier, réseau, distance**
      *Fait : `FiltreDAnnuaire`, appliqué avant la page, total recalculé sur le
      filtre.*
      *La planche v3 en pose trois plus « can book here », et aucun n'existe :
      la route ne prend que `limite` et `decalage`. Les poser côté écran
      filtrerait **une page** et non la liste — la même faute que rejouer le
      tri, et elle se voit dès la seconde page. Ce sont les trois seules choses
      qu'un salon sache formuler avant d'avoir vu qui que ce soit ; la recherche
      par pseudonyme, elle, arrive plus tard, quand il a des noms en tête*

- [x] **Le sélecteur de salon, pour un gérant qui en a deux**
      *`useMonCommerce` prend `mesCommerces[0]` et la coquille n'offre aucun
      moyen de changer. Depuis que le rattachement d'une fiche existe, un gérant
      peut avoir deux salons — le second est réservable par les créatrices, et
      son gérant ne peut pas l'ouvrir. Rien n'est cassé : c'est incomplet, et
      c'est vraisemblablement pourquoi la route de rattachement n'avait jamais
      eu d'écran. Le nom du salon est déjà dans la barre latérale, c'est là que
      le choix se pose*

- [x] **Le compte de décisions du jour, par salon** — *livré, l'entrée avait survécu*
      *`CommerceDeLAppartenance.decisions_en_attente` est servi sur
      `/me/businesses` et vérifié en production. La #278 l'a posé ; cette entrée
      est restée décochée dessous, et une entrée décochée sous un travail rendu
      fait refaire ce travail. Voir la règle du geste dans `DECISIONS.md` :
      chercher le **sujet**, pas seulement sa tâche.*
      *La liste du sélecteur porte « 5 aujourd'hui » sur chaque ligne, et c'est
      ce qui fait basculer un gérant qui ne savait pas qu'on l'attendait. Sans
      lui la liste reste utilisable et perd sa raison d'être ouverte. La donnée
      existe par salon — c'est le compteur que la journée affiche déjà — mais
      `/me/businesses` ne rend que l'appartenance. Le porter là plutôt que
      d'ouvrir une requête par salon depuis l'écran : deux salons feraient deux
      appels, dix en feraient dix*
