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
- [ ] Choisir le fournisseur de géocodage d'adresse, ouvrir le compte et la clé
      *Fin : clé en configuration, coût à l'appel connu. N'est apparu qu'à la phase 2 : la contrainte « un commerce n'est actif que géocodé » suppose un service de résolution, qu'aucune ligne de cette liste ne prévoyait. Contourné en phase 2 par saisie manuelle des coordonnées, réellement nécessaire en phase 5*
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

- [ ] Événements de fiabilité générés par les transitions
      *Fin : absence, retard, non conformité produisent chacun leur événement*
- [ ] Calcul du score et mise en cache
      *Fin : changer une pondération recalcule tout l'historique sans migration*
- [ ] Rétablir les seuils de collaborations sur les paliers de référence
      *Fin : `completed_collabs_count` est alimenté par les événements de fiabilité, et les seuils des paliers de référence sont remis aux valeurs voulues. Ils ont été mis à zéro en phase 3 parce que le compteur n'était alimenté par rien, ce qui rendait les paliers `post` et `reel` inatteignables*
- [ ] Effet du score sur les paliers accessibles
      *Fin : un score dégradé plafonne effectivement le créateur*

---

## Phase 9 — Import de carte

- [ ] Téléversement et extraction structurée
      *Fin : un PDF de salon en anglais et un en espagnol produisent une charge exploitable*
- [ ] Écran de relecture et correction, saisie des durées
      *Fin : aucun item n'est créé sans validation explicite du commerce*

---

## Phase 10 — Reste

- [ ] Capture de preuve niveaux 1 et 2
      *Le niveau 3 — capture d'écran envoyée — fonctionne depuis la phase 7. Les deux niveaux supérieurs ont été laissés débranchés faute de garde-fous : les poser à moitié ouvrirait une porte de requête côté serveur*
      *Fin, pour le niveau 2 : taille maximale, types acceptés, refus des adresses internes **et des redirections vers elles**, délai maximal. Le niveau 1 attend `fetch_media`, qui arrive avec TikTok*
- [ ] Dépôt objet réel, compatible S3
      *Le stockage local suffit à la démo, et le passage se fait par la même interface — `deposer` est la seule fonction à changer*
      *Fin : une preuve archivée reste consultable après redémarrage, et la clé rendue ne dépend d'aucun fournisseur*
- [ ] Intégration TikTok
- [ ] Intégration Snapchat, à l'obtention de l'accès partenaire
- [ ] Abonnement Stripe et plans par catégorie
- [ ] Reporting commerce