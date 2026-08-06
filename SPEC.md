# BIND — Spécification technique

Document de référence pour l'implémentation. Traduit la note de cadrage en modèle de données, règles et contrats d'API. Destiné à être découpé en prompts pour Claude Code.

---

## 1. Stack retenue

| Brique | Choix | Raison |
|---|---|---|
| Backend | FastAPI + Python 3.12 | Stack habituelle, async natif pour les appels API sociaux |
| Base | PostgreSQL | Obligatoire, pas SQLite : les réservations concurrentes exigent des verrous transactionnels réels |
| Fichiers | Stockage objet compatible S3 | Preuves de publication, cartes importées, médias |
| Tâches de fond | Worker asyncio + table de jobs en base | Rafraîchissement des métriques, deadlines, expiration des réservations. Pas de Celery au départ |
| App créateur et commerce | Expo / React Native, avec build web | Un seul codebase pour iOS, Android et web. La caméra est nécessaire des deux côtés |
| Dashboard commerce lourd | Build web du même codebase | L'import de carte se fait mieux sur grand écran |
| Extraction de carte | Modèle vision via API, sortie JSON structurée | Plus robuste qu'un OCR classique sur des grilles tarifaires de salons, gère l'espagnol nativement |
| Paiement abonnement | Stripe Billing | Uniquement l'abonnement commerce. Aucun autre flux d'argent dans le système |

**Contrainte structurante à ne jamais violer** : aucune table ne porte de solde en devise appartenant à un créateur, et aucun transfert de valeur entre deux utilisateurs n'existe. Le prix d'un item est une donnée de reporting, jamais un avoir.

---

## 2. Modèle de données

### 2.1 Identité

**user**
`id, role (creator | business_member | admin), email, phone, locale (en | es), status, created_at, last_login_at`

**creator_profile**
`user_id (PK/FK), first_name, last_name, city, geo (point), bio, reliability_score (nullable), completed_collabs_count, is_new_creator (dérivé), created_at`

`reliability_score` est **nullable et le reste** tant qu'aucun historique n'existe. C'est ce null qui déclenche le badge "Nouveau créateur" et le comportement neutre du moteur de paliers.

**social_account**
`id, creator_id, platform (instagram | tiktok | snapchat | youtube), external_id, handle, access_token_encrypted, refresh_token_encrypted, token_expires_at, granted_scopes (jsonb), status (active | expired | revoked), connected_at, last_synced_at`

Un créateur peut connecter plusieurs comptes, y compris plusieurs sur la même plateforme. Chiffrement des tokens au repos obligatoire.

**social_metrics_snapshot**
`id, social_account_id, captured_at, followers_count, following_count, media_count, avg_views (nullable), engagement_rate (nullable), audience_demographics (jsonb nullable), raw_payload (jsonb)`

Historisé, jamais écrasé. L'éligibilité lit toujours le dernier snapshot valide, ce qui évite un appel API synchrone pendant un parcours utilisateur.

### 2.2 Commerce

**business**
`id, name, category (beauty | restaurant | museum | fitness | family_activity | other), address, geo (point), timezone (défaut America/New_York), default_locale, phone, status (onboarding | active | suspended), created_at`

**business_member**
`id, business_id, user_id, role (owner | staff)`

**subscription_plan**
`id, category, name, price_cents, currency, billing_interval, features (jsonb), is_active`

La tarification est une donnée, jamais une constante dans le code. Plusieurs plans coexistent par catégorie.

**subscription**
`id, business_id, plan_id, status, current_period_end, stripe_customer_id, stripe_subscription_id`

### 2.3 Catalogue

**catalog_item**
`id, business_id, parent_item_id (nullable), name, description, price_cents, currency, duration_minutes (nullable), requires_booking (défaut vrai), is_available, source (manual | import), created_at, updated_at`

`parent_item_id` porte les variantes (durée, longueur, avec ou sans dépose). Une variante est un item à part entière rattaché à son parent : c'est elle qui est réservable, jamais le parent.

`requires_booking` traduit le "si pertinent pour l'activité" de la note. Un soin en salon se réserve, une entrée de musée ou un plat au restaurant non. Un item sans réservation ne consomme aucune capacité : le créateur obtient directement un code valable sur une fenêtre de validité, et se présente quand il veut.

`duration_minutes` est **obligatoire dès que `requires_booking` est vrai**, et sans objet sinon. Sans elle, aucun calcul de capacité n'est possible. La contrainte est vérifiée en base, pas seulement dans le code.

`is_available` est le toggle temps réel du commerce, indépendant des quotas de créneaux.

`photo_key` sur un item, `cover_photo_key` sur un commerce : des **clés de stockage objet, jamais des URL**. Une URL signée expire, une URL publique fuit, et les deux se figeraient en base au changement de fournisseur. Nullables toutes les deux — un commerce fraîchement inscrit n'a pas de photo, et un item sans photo reste réservable.

**menu_import**
`id, business_id, file_key, mime_type, status (uploaded | extracted | under_review | validated | failed), extracted_payload (jsonb), reviewed_by, reviewed_at, created_at`

L'extraction ne crée jamais directement des `catalog_item`. Elle remplit `extracted_payload`, le commerce valide ou corrige dans un écran dédié, et seule la validation crée les items. L'écran de relecture doit demander explicitement la durée, que l'extraction ne fournit pas de façon fiable.

### 2.4 Paliers

**tier**
`id, platform, content_format (story | post | reel), min_followers, min_reliability_score (nullable), min_completed_collabs, value_ratio_hint, display_order, is_active`

Table de configuration globale gérée par la plateforme, pas par les commerces. Le palier est défini par le couple plateforme + format, ce qui permet de traiter le fait qu'un reel n'existe pas sur Snapchat et qu'un compte à 50k sur TikTok ne donne aucun droit sur Instagram.

**tier_offer**
`id, business_id, tier_id, catalog_item_id, required_mention (nullable), required_geotag (bool), is_active, created_at`

Les critères de publication appartiennent au commerce, qui exprime ce qu'il attend d'une publication. Ni au palier — qui ne définit que le couple plateforme × format — ni au créateur. Ils sont **recopiés sur la contrepartie à sa création et figés là** : un commerce qui change ses exigences ne modifie pas les obligations d'une contrepartie en cours.

C'est la composition du commerce : quels items de sa carte il place à quel palier. Un item peut apparaître à plusieurs paliers.

### 2.5 Capacité et réservation

**capacity_rule**
`id, business_id, weekday (0-6), start_time, end_time, concurrent_slots`

Horaires d'ouverture et nombre de postes en parallèle.

`weekday` : **0 = lundi**, convention `date.weekday()` de Python. Postgres compte dimanche à 0 de son côté, d'où la précision — une ambiguïté laissée ici produirait deux lectures.

Les horaires sont des **heures locales du commerce**, pas des instants. Ils sont stockés tels qu'ils sont saisis, sans conversion : la conversion vers le fuseau n'a lieu qu'au calcul de disponibilité. Plusieurs plages par jour sont permises — un commerce ferme le midi — et elles ne peuvent pas se chevaucher. Deux plages qui se touchent ne se chevauchent pas.

**capacity_exception**
`id, business_id, date, is_closed, start_time (nullable), end_time (nullable), concurrent_slots (nullable)`

Fermetures exceptionnelles et ajustements ponctuels.

**booking**
`id, creator_id, business_id, tier_offer_id, catalog_item_id, social_account_id, starts_at (UTC, nullable), ends_at (UTC, nullable), valid_until (UTC), status (held | confirmed | consumed | cancelled | no_show | expired), hold_expires_at, value_cents_snapshot, cancelled_at, consumed_at, created_at`

Pour un item sans réservation, `starts_at` et `ends_at` restent nuls, seul `valid_until` s'applique : le créateur se présente quand il veut avant l'échéance. La capacité n'est pas consultée et l'état `no_show` n'existe pas dans ce cas, l'expiration suffit.

`value_cents_snapshot` fige le prix au moment de la réservation : le commerce peut changer sa carte ensuite, l'historique ne doit pas bouger.

`social_account_id` fige sur quel compte la contrepartie sera publiée. C'est aussi ce compte dont les métriques ont servi à l'éligibilité.

**redemption_code**
`id, booking_id, secret, manual_code, rotation_seconds (défaut 30), consumed_at, consumed_by_user_id`

Le code affiché au créateur est dérivé côté serveur (HMAC du booking id et du secret, fenêtre de 30 secondes, tolérance d'une fenêtre). Il n'est jamais stocké tel quel. `manual_code` est la saisie de secours à six caractères, à usage unique.

### 2.6 Contrepartie et preuve

**collaboration**
`id, booking_id, tier_id, required_format, required_mention, required_geotag (bool), deadline_at, status, attempts_count, approved_at, created_at`

Statuts : `pending | submitted | under_review | approved | resubmit_requested | unfulfilled`.

Il n'existe pas de statut `disputed`. En cas de non conformité, le système repasse en `resubmit_requested` avec une nouvelle deadline. L'escalade humaine n'est qu'un drapeau `needs_human_review` levé automatiquement à partir de trois tentatives.

**proof**
`id, collaboration_id, submitted_at (serveur), source_url (nullable), capture_method (api | url_fetch | upload), media_key, screenshot_key, content_hash, platform_published_at (nullable), metadata (jsonb)`

L'horodatage fait foi côté serveur, jamais celui fourni par le client. Le contenu est archivé au moment de la soumission, on ne conserve jamais un simple lien.

### 2.7 Fiabilité

**reliability_event**
`id, creator_id, booking_id (nullable), type, weight, occurred_at`

Types : `collab_completed`, `published_on_time`, `published_late`, `first_pass_compliant`, `resubmit_required`, `no_show`, `unfulfilled`, `business_rating`.

Le score n'est jamais stocké comme une valeur écrite à la main : il est recalculé à partir des événements, et le résultat est mis en cache dans `creator_profile.reliability_score`. Cela rend tout ajustement de pondération rétroactif sans migration.

---

## 3. Le moteur de paliers

### 3.1 Règle d'éligibilité

Pour un créateur donné, un compte social donné et un palier donné :

```
followers = dernier snapshot valide du compte social
plateforme du compte == plateforme du palier
followers >= tier.min_followers
completed_collabs >= tier.min_completed_collabs

si reliability_score EST NULL  -> la condition de score est ignorée (cold start neutre)
sinon                          -> reliability_score >= tier.min_reliability_score
```

Le cold start neutre est une décision assumée : un compte neuf accède aux paliers correspondant à son volume. Le garde-fou n'est pas ici mais à l'inscription, dans la vérification de cohérence du profil sur les données OAuth.

### 3.2 Vérification de cohérence à l'inscription

Contrôle interne, sans service tiers, à partir des seules données déjà récupérées. Il produit un statut `verified | needs_review | rejected` sur le compte social, et un compte en `needs_review` ne peut pas réserver tant qu'un administrateur n'a pas tranché.

Signaux disponibles et exploitables :

- Ancienneté du compte et date de la première publication
- Nombre de publications rapporté au nombre d'abonnés
- Régularité de publication sur les dernières semaines
- Engagement rapporté au volume, une valeur aberrante dans un sens comme dans l'autre étant suspecte
- Cohérence entre le nom déclaré à l'inscription et le compte connecté

Les seuils sont en configuration, comme le reste. C'est ce contrôle, et pas le moteur de paliers, qui protège du compte acheté ou fraîchement créé.

Le profil créateur est déclaratif : prénom, nom, ville et bio sont saisis par le créateur, jamais dérivés. La ville est un champ libre — Miami compte assez de quartiers nommés pour qu'une liste fermée soit fausse dès le premier jour — et elle n'est jamais déduite des coordonnées. Prénom et nom sont facultatifs à l'inscription et obligatoires avant la première réservation.

### 3.3 Ce que voit le créateur

Le fil ne liste pas des offres mais des commerces. Pour chaque commerce, on affiche les items accessibles, c'est à dire les `tier_offer` dont le palier est éligible, dont l'item est `is_available`, et pour lesquels il reste au moins un créneau libre dans l'horizon de réservation.

Un item ne doit jamais apparaître s'il n'est pas réservable. Un fil qui montre des choses indisponibles détruit la confiance en deux jours.

L'affichage indique la valeur de l'item et la situe par rapport au ratio indicatif du palier. Une offre nettement en dessous de la référence est signalée au créateur, sans être masquée ni bloquée. C'est le mécanisme d'auto-régulation prévu par la note de cadrage : le commerce reste libre de composer ce qu'il veut, le créateur sait ce qu'il accepte.

### 3.4 Calcul de disponibilité

Ne concerne que les items dont `requires_booking` est vrai.

Ne pas matérialiser des lignes de créneaux à l'avance. La disponibilité se calcule à la volée :

```
pour une date et un item de durée D :
  fenêtres = capacity_rule du jour, corrigées par capacity_exception
  pour chaque créneau candidat (pas de 15 min) :
     réservations chevauchantes = bookings actifs du commerce
                                  dont [starts_at, ends_at) recoupe le créneau
     libre si count(réservations) < concurrent_slots
```

Statuts comptant comme occupants : `held`, `confirmed`, `consumed`.

### 3.5 Concurrence

La création d'une réservation doit être protégée, sinon deux créateurs prendront le même poste :

1. Verrou consultatif Postgres sur une clé dérivée de `business_id` et du jour
2. Recompte de la capacité à l'intérieur de la transaction
3. Insertion en `held` avec `hold_expires_at` à +10 minutes
4. Libération du verrou

Un job de fond passe les `held` expirés en `expired`. Ne jamais se fier au client pour libérer une place.

---

## 4. Machines à états

### 4.1 Réservation

```
held ──confirmation créateur──> confirmed ──scan du code──> consumed
 │                                  │
 │                                  ├──annulation > 24h avant──> cancelled
 │                                  ├──annulation < 24h ou absence──> no_show
 └──délai de garde dépassé──> expired
```

`consumed` est le seul état qui crée la `collaboration` et démarre le délai de publication.
`no_show` génère un `reliability_event` négatif.

### 4.2 Contrepartie

```
pending ──soumission──> submitted ──┬──contrôle automatique──> approved
                                    │
                                    └──mise en revue──> under_review ──> approved
                                    
submitted ou under_review ──non conforme──> resubmit_requested ──> submitted

pending ou resubmit_requested ──deadline dépassée──> unfulfilled
```

`under_review` est l'étape de contrôle quand un humain s'y arrête. Le contrôle automatique la saute et va directement de `submitted` à son issue. Aucune de ces deux voies ne mène à `approved` par écoulement du temps : une deadline dépassée produit toujours `unfulfilled`, jamais une acceptation par défaut.

Chaque passage par `resubmit_requested` incrémente `attempts_count`. À trois, `needs_human_review` passe à vrai et le dossier sort de la boucle automatique.

---

## 5. Intégrations sociales

### 5.1 Abstraction

Une interface unique par plateforme, avec quatre opérations : `authorize`, `refresh`, `fetch_profile_metrics`, `fetch_media`. Chaque plateforme implémente ce qu'elle peut et déclare ses capacités. Le reste du système ne connaît jamais les spécificités d'un réseau.

Cela permet de démarrer sans Snapchat, dont l'accès partenaire est un délai calendaire, et de brancher un agrégateur commercial en remplacement d'une implémentation si nécessaire.

### 5.2 Rafraîchissement

- Métriques : job quotidien par compte, plus un rafraîchissement à la demande limité en fréquence
- Tokens : job de renouvellement anticipé, les jetons longue durée Meta expirant au bout de 60 jours
- Un compte en `expired` ou `revoked` ne rend pas le créateur inéligible rétroactivement, mais bloque toute nouvelle réservation sur ce compte, avec relance explicite

Le travail planifié passe par une table de jobs : un job par traitement et par cible, reprogrammé après chaque succès. Un échec est reporté avec un délai croissant plafonné, et après un nombre de tentatives en configuration le job s'arrête et remonte dans la file d'administration. Un compte en `expired` ou `revoked` n'est plus planifié du tout.

Un relevé est atomique : il écrit un snapshot complet ou n'écrit rien. Les compteurs obligatoires manquants sont un échec ; la démographie manquante ne l'est pas, la plateforme la refusant aux petits comptes. Un refus d'authentification bascule le compte en `expired`, une erreur transitoire ne change aucun état.

### 5.3 Capture de preuve

Par ordre de préférence, selon ce que la plateforme autorise :

1. Lecture du média sur le compte connecté du créateur via API, dans la fenêtre où il existe
2. Récupération du contenu depuis l'URL publique fournie
3. Capture d'écran envoyée par le créateur

Dans les trois cas : archivage du fichier, empreinte de contenu, horodatage serveur. Le niveau utilisé est stocké dans `capture_method`, ce qui permet de pondérer la confiance et d'automatiser plus tard uniquement les cas de niveau 1.

Les stories sont le cas le plus fréquent et le plus fragile. Elles disparaissent en 24 heures et ne sont pas accessibles depuis un simple lien. Le délai de soumission doit donc être plus court que la durée de vie du contenu, sinon la preuve n'existe plus au moment où on la demande.

---

## 6. Surface d'API

Regroupée par domaine, toutes les routes sous `/api/v1`.

**Auth et créateur**
`POST /auth/*`, `GET|PATCH /me`, `POST /me/social-accounts/{platform}/connect`, `DELETE /me/social-accounts/{id}`, `GET /me/tiers`, `GET /me/bookings`, `GET /me/collaborations`

**Découverte**
`GET /businesses` (filtres géo, catégorie, palier éligible), `GET /businesses/{id}`, `GET /businesses/{id}/offers`, `GET /businesses/{id}/availability`

**Réservation**
`POST /bookings` (hold), `POST /bookings/{id}/confirm`, `POST /bookings/{id}/cancel`, `GET /bookings/{id}/code`

**Caisse commerce**
`POST /redemptions/verify` (code scanné ou saisi), `POST /redemptions/consume`

**Contrepartie**
`POST /collaborations/{id}/proof`, `GET /collaborations/{id}`

**Commerce**
`POST /business/menu-imports`, `GET|PATCH /business/menu-imports/{id}`, CRUD `catalog-items`, CRUD `tier-offers`, CRUD `capacity-rules` et `capacity-exceptions`, `GET /business/bookings`, `GET /business/collaborations`, `GET /business/reporting`

**Admin**
CRUD `tiers`, CRUD `subscription-plans`, file de `needs_human_review`

---

## 7. Règles transverses

- **i18n** : anglais et espagnol dès le premier écran. Les noms d'items saisis par le commerce restent dans leur langue d'origine, aucune traduction automatique du catalogue.
- **Fuseaux** : tout en UTC en base, conversion à l'affichage sur le fuseau du commerce.
- **Argent** : entiers en centimes, jamais de flottant. Devise portée par le commerce.
- **Données personnelles** : consentement horodaté à la connexion OAuth, suppression de compte qui purge tokens et snapshots, conservation limitée des preuves. Cadre Floride à respecter comme n'importe quelle app américaine.
- **Journalisation** : toute transition d'état écrite dans un journal d'audit immuable. C'est ce qui rend défendable un dossier "non honoré" sans intervention humaine.

---

## 8. Ordre de construction

1. Socle : modèle de données, migrations, auth, rôles
2. Commerce : profil, capacité, catalogue en saisie manuelle
3. Paliers : table de configuration, composition des `tier_offer`, moteur d'éligibilité
4. Créateur : connexion OAuth Instagram, snapshots de métriques, calcul des paliers accessibles
5. Découverte et réservation : disponibilité, verrous, machine à états
6. Caisse : génération et vérification du code, passage en `consumed`
7. Contrepartie : création, deadlines, soumission et archivage de preuve, boucle de relance
8. Fiabilité : événements, calcul du score, effet sur les paliers
9. Import de carte : extraction, écran de relecture, création d'items
10. TikTok, puis Snapchat quand l'accès partenaire arrive
11. Abonnement Stripe et reporting commerce

Chaque étape est testable seule. Les étapes 1 à 8 forment le produit minimum réellement utilisable.

---

## 9. Points laissés en paramètre

À ne pas figer dans le code, tous en configuration :

- Seuils d'abonnés et de score par palier
- Ratio de valeur indicatif entre paliers
- Durée de garde d'une réservation (10 minutes)
- Fenêtre d'annulation sans pénalité (24 heures)
- Délai de publication après consommation
- Fraîcheur maximale d'un relevé de métriques, au-delà de laquelle il ne donne accès à rien (7 jours)
- Nombre de tentatives avant revue humaine (3)
- Prix des abonnements par catégorie