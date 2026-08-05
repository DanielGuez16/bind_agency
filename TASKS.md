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
- [ ] Journal d'audit des transitions d'état
      *Fin : toute transition écrit une ligne immuable*
- [ ] Internationalisation anglais et espagnol côté API (messages) et app (interface)
      *Fin : basculer la locale change l'intégralité des libellés*

---

## Phase 2 — Commerce

- [ ] Profil commerce : création, catégorie, adresse, géolocalisation, fuseau
      *Fin : un commerce peut être créé et relu avec ses coordonnées géographiques*
- [ ] Catalogue en saisie manuelle, items et variantes, réservable ou non
      *Fin : contrainte en base imposant une durée dès que l'item est réservable, une variante est réservable et pas son parent*
- [ ] Règles de capacité et exceptions
      *Fin : horaires hebdomadaires et fermetures ponctuelles paramétrables*
- [ ] Toggle de disponibilité temps réel par item
      *Fin : désactiver un item le retire immédiatement du fil créateur*
- [ ] Jeu de données de départ : trois commerces fictifs avec catalogue, capacités et créneaux
      *Fin : une commande recrée l'environnement de test à zéro*

---

## Phase 3 — Moteur de paliers

- [ ] Table de configuration des paliers et interface admin
      *Fin : créer et modifier un palier sans toucher au code*
- [ ] Composition des offres par palier côté commerce
      *Fin : un item peut être placé à plusieurs paliers*
- [ ] Fonction d'éligibilité
      *Fin : tests unitaires couvrant score nul (neutre), score bas (plafonné), volume insuffisant, mauvaise plateforme*

---

## Phase 4 — Créateur

- [ ] Connexion OAuth Instagram et stockage chiffré des jetons
      *Fin : un compte réel se connecte, les jetons sont illisibles en base*
- [ ] Récupération et historisation des métriques
      *Fin : un snapshot est créé, l'éligibilité lit le dernier snapshot sans appel réseau*
- [ ] Renouvellement des jetons en tâche de fond
      *Fin : un jeton proche de l'expiration est renouvelé automatiquement*
- [ ] Vérification de cohérence du profil à la connexion d'un compte social
      *Fin : un compte trop récent ou incohérent passe en revue et ne peut pas réserver*
- [ ] Écran des paliers accessibles et badge nouveau créateur
      *Fin : un créateur sans historique voit le badge et ses paliers selon son volume seul*

---

## Phase 5 — Découverte et réservation

- [ ] Calcul de disponibilité à la volée
      *Fin : tests couvrant chevauchement, postes multiples, exception de fermeture*
- [ ] Fil géolocalisé, seuls les items réellement réservables apparaissent
      *Fin : un item indisponible ou sans créneau n'apparaît jamais*
- [ ] Création de réservation avec verrou et garde de dix minutes
      *Fin : test de concurrence, deux réservations simultanées sur la dernière place, une seule passe*
- [ ] Machine à états de la réservation, annulation, absence, expiration
      *Fin : toutes les transitions de la spec testées, aucune transition illégale possible*

---

## Phase 6 — Caisse

- [ ] Génération du code tournant et de la saisie de secours
      *Fin : le code change toutes les trente secondes, l'ancien reste accepté une fenêtre*
- [ ] Vérification et consommation côté commerce
      *Fin : un code déjà consommé est refusé, la réservation passe en consommée et crée la contrepartie*
- [ ] Scanner caméra et saisie manuelle dans l'app commerce
      *Fin : les deux chemins fonctionnent sur un appareil réel*

---

## Phase 7 — Contrepartie

- [ ] Création de la contrepartie avec critères et échéance
      *Fin : les critères affichés au créateur sont ceux figés à la candidature*
- [ ] Soumission de preuve, archivage du média, empreinte et horodatage serveur
      *Fin : le contenu reste consultable après suppression de la publication d'origine*
- [ ] Boucle automatique de relance et de nouvelle soumission
      *Fin : trois tentatives lèvent le drapeau de revue humaine, aucune escalade avant*
- [ ] Emails transactionnels : confirmation, rappel de deadline, relance
      *Fin : envoyés depuis un domaine vérifié, en anglais et en espagnol*
- [ ] Passage automatique en non honoré à l'échéance
      *Fin : job de fond testé sur une échéance dépassée*

---

## Phase 8 — Fiabilité

- [ ] Événements de fiabilité générés par les transitions
      *Fin : absence, retard, non conformité produisent chacun leur événement*
- [ ] Calcul du score et mise en cache
      *Fin : changer une pondération recalcule tout l'historique sans migration*
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

- [ ] Intégration TikTok
- [ ] Intégration Snapchat, à l'obtention de l'accès partenaire
- [ ] Abonnement Stripe et plans par catégorie
- [ ] Reporting commerce