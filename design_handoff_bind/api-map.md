# Correspondance écran ↔ API

Révisée le 2026-08-14 **contre la surface réelle** : 119 routes, relevées sur l'application elle-même et non de mémoire. Préfixe `/api/v1` partout sauf `/r/{slug}`.

Ce qui n'est pas négociable reste ce que chaque écran doit recevoir et les états qu'il doit pouvoir rendre.

---

## Ce qui a changé depuis la dernière révision

La carte précédente datait de la PR #36. Elle décrivait une quarantaine de routes ; il y en a 119. **Deux de ses lignes étaient fausses** et dix domaines entiers manquaient.

**Deux corrections, à lire avant de composer quoi que ce soit :**

| Ce que la carte disait | Ce qui existe |
|---|---|
| `POST /merchant/pause` | `POST /business/{business_id}/pause` — l'ancien chemin n'a jamais existé |
| Arbitrage : « hors périmètre, la décision passe par la route du commerce » | `POST /admin/collaborations/{id}/decision`, **route distincte**, corps distinct (`issue`, `reason`, `note`) |

**Dix domaines apparus depuis :** galerie photos du commerce, import de carte, abonnement, annuaire des créateurs, reporting, liens traqués et audience mesurée, notifications et préférences, signalement de déplacement pour rien, inscription sur le terrain, reprise de compte par le support.

**Une convention corrigée.** L'ancienne carte annonçait deux formes d'erreur contradictoires. Il n'y en a qu'une : `{"detail": "<code>"}`, où le code appartient à une liste fermée. Il n'y a **pas** de champ `message`. Le client traduit le code ; il n'a jamais de texte serveur à afficher.

**Une convention retirée.** « Réponses paginées par curseur » était faux : aucune route ne rend de curseur. Trois routes bornent leur liste — `GET /me/bookings` par `avant` + `limite`, `GET /business/{id}/collaborations` et `GET /admin/collaborations/review` par `limite`. Les autres rendent tout.

---

## Conventions

`/business/...` est l'espace du commerçant, protégé par le résolveur d'appartenance. `/businesses/...` est la découverte côté créateur. Le préfixe `/admin` exige le rôle administrateur.

Dates en ISO 8601 UTC ; les délais s'expriment côté client à partir de `expires_at` / `deadline_at` / `hold_expires_at`. Montants en centimes entiers, **jamais rendus aux applications créateur et commerce**.

Le rafraîchissement se fait **à l'ouverture d'écran et sur geste**. Il n'existe aucun canal poussé côté données ; les notifications push annoncent, elles ne transportent pas d'état.

**Les médias sont des clés, jamais des adresses.** `cover_photo_key`, `photo_key`, `storage_key`, `screenshot_key` se servent par `GET /media/{cle}` — publiques, sans en-tête. Les **preuves** sont privées : `GET /proofs/{id}/access` rend `{url, expires_in}`, et c'est cette adresse-là, courte et liée à cette preuve, qu'on met dans une balise d'image.

---

## Créateur

| Écran | Route | Données | États |
|---|---|---|---|
| Entrée | `GET /platform-media` | `home {video_key, video_portrait_key, poster_key, poster_portrait_key}`, `categories` | **Public**, avant toute connexion. Sans fond : les portes restent |
| Inscription / connexion | `POST /auth/register {email, password, role, locale}`, `POST /auth/login` | `access_token`, `refresh_token`, `expires_in` | `email_already_used`, `invalid_credentials` |
| Connexion réseau | `POST /me/social-accounts/instagram/connect` ou `.../tiktok/connect` → `{authorization_url}` | puis `GET /me/verification` → `[] {social_account_id, platform, handle, verification_status, started_at, reviewed_at, signaux[]}` | **Aucune promesse de délai.** `oauth_denied`, `social_provider_unavailable` |
| Comptes rattachés | `GET /me/social-accounts` | `[] {id, platform, handle, status, verification_status, token_expires_at, connected_at}` | jeton expiré → reconnecter |
| Audience | `GET /me/audience` | `[] {platform, handle, followers_count, media_count, avg_views, engagement_rate, captured_at, reconnectable}` | **Le chiffre est daté.** Nul ≠ zéro : sans relevé, `followers_count` est nul |
| — relance | `POST /me/social-accounts/{id}/metrics/refresh` | le relevé neuf | limité par `metrics_min_refresh_interval_seconds` |
| Paliers | `GET /me/tiers` | `creator_id, is_new_creator, fiabilite, paliers[]` — chaque palier porte ses `obstacles[] {raison, requis, constate, ecart, depuis}` | tous les obstacles rendus, ordre serveur conservé. Pas de projection de délai |
| Profil | `GET`/`PATCH /me/profile` | `first_name, last_name, city, bio, reliability_score, completed_collabs_count, is_new_creator, anonymized_at` | `reliability_score` **nul = neutre**, pas zéro |
| Langue | `PATCH /me {locale}` | `id, email, role, status, locale` | — |
| Fil | `GET /businesses?longitude&latitude&rayon_metres&categorie` | `commerces[]`, `obstacles[]`, `rayon_metres`, `total_prestations`, `categories[]`, `rayons[]` | vide → **les `obstacles` disent pourquoi** ; permission refusée ; hors ligne |
| Fiche | `GET /businesses/{id}` | `name, category, address, timezone, phone, cover_photo_key, photos[], offres[]` | palier fermé rendu **avec** ses obstacles, contrairement au fil |
| Créneaux | `GET /businesses/{id}/availability?catalog_item_id&jours` | `[] {starts_at, ends_at, places_restantes}` | vide → jour suivant |
| Réservation | `POST /bookings {tier_offer_id, social_account_id, starts_at}` puis `POST /bookings/{id}/confirm` | naît en `held` avec `hold_expires_at` ; **le code naît à la confirmation** | `booking_slot_unavailable`, `booking_tier_not_accessible`, `booking_name_required`, `booking_hold_expired` |
| — annuler | `POST /bookings/{id}/cancel` | — | fenêtre sans frais en configuration |
| Code de retrait | `GET /bookings/{id}/code` | `code` (6 chiffres, tourne), `manual_code` (6 caractères, fixe), `seconds_remaining`, `rotation_seconds` | **Pas d'état expiré** : il tourne seul. Les deux codes ne servent pas au même geste — voir la note plus bas |
| Déplacement pour rien | `POST /bookings/{id}/venue-report {note}` | `id, booking_id, status, reported_at, note` | fenêtre courte après le créneau ; **ne pénalise jamais celui qui signale** |
| Historique | `GET /me/bookings?status&avant&limite` (`status` répétable) | `items[]`, `compteurs` par statut **sur tout l'historique** | vide par onglet |
| Contrepartie | `GET /collaborations/{id}` | `required_format, required_mention, required_geotag, deadline_at, status, attempts_count, needs_human_review, proofs[]` | `under_review`, `resubmit_requested`, `unfulfilled` |
| — envoyer la preuve | `POST /me/proof-uploads` (multipart `fichier`) → `{screenshot_key}` puis `POST /collaborations/{id}/proof {source_url, screenshot_key, note}` | **deux appels** : le fichier d'abord, la soumission ensuite | file locale sur échec d'envoi |
| Lien traqué | `GET /me/collaborations/{id}/link` | `slug`, `url`, `is_active` | **un seul lien par contrepartie, pour toute sa vie** — il vit dans le sticker déjà publié |
| Portée mesurée | `GET /me/link-clicks` | `clics, clics_locaux, part_locale, par_pays, par_ville, par_terminal, par_referent, ecartes` | aucune adresse IP n'existe nulle part |
| Notifications | `GET /me/notification-preferences`, `PUT /me/notification-preferences/{kind} {enabled}` | `preferences {genre: bool}` — **douze genres**, huit créateur, quatre commerce | absente = acceptée |
| Terminal | `PUT /me/devices {token, platform}`, `DELETE /me/devices/{token}` | `id, platform, status, last_seen_at` | se révoque comme un jeton social |

---

## Commerce

| Écran | Route | Données | États |
|---|---|---|---|
| **Créer son commerce** | `POST /business {name, category, currency, address, coordinates, timezone, default_locale, phone, cover_photo_key}` | rend le commerce en `onboarding`, l'appelant devient `owner` | **Route existante et sans écran** — voir « manques » |
| Mes commerces | `GET /me/businesses` | `[]` — vide pour un membre qui vient de s'inscrire | c'est cet état vide qui doit mener à la création |
| Profil | `GET`/`PATCH /business/{id}` | `name, category, address, coordinates, timezone, default_locale, phone, currency, cover_photo_key, status` | **la devise ne se modifie pas** : `PATCH` la refuse |
| Étapes d'activation | `GET /business/{id}/activation` | `status`, `etapes[] {cle, done, blocking}` — six étapes, **deux bloquantes** | pas de pourcentage : « 2 sur 4 » se comprend, « 50 % » ne dit pas laquelle manque |
| Ouvrir / mettre en pause | `POST /business/{id}/activate`, `POST /business/{id}/pause` | le commerce | refus nommés : `business_missing_address`, `business_missing_coordinates`, `business_not_claimed` |
| Composition | `GET /business/{id}/composition` | `prestations, prestations_masquees, jours_ouverts, en_ligne_depuis, status` | ce qui manque pour paraître dans le fil |
| Catalogue | `GET`/`POST /business/{id}/catalog-items` ; `GET`/`PATCH`/`DELETE /business/{id}/catalog-items/{item_id}` ; `PUT /business/{id}/catalog-items/{item_id}/availability {is_available}` | `name, description, price_cents, duration_minutes, requires_booking, photo_key, parent_item_id, is_available, is_effectively_available` | `duration_minutes` **obligatoire dès que réservable** ; une variante est réservable, pas son parent |
| Import de carte | `POST /business/{id}/menu-imports {file_key, mime_type}` → `POST /business/{id}/menu-imports/{import_id}/extract` → `POST /business/{id}/menu-imports/{import_id}/validate {lignes}` ; relecture par `GET /business/{id}/menu-imports/{import_id}` | `status, lignes[], confiance_moyenne`, puis `items_crees` | **l'extraction ne crée jamais d'items** : elle remplit une charge que le commerce valide |
| Paliers offerts | `GET /business/{id}/tiers` ; `GET`/`POST /business/{id}/tier-offers` ; `PUT /business/{id}/tier-offers/{offer_id}/activation {is_active}` ; `DELETE /business/{id}/tier-offers/{offer_id}` | `tier_id, catalog_item_id, platform, content_format, item_name, is_active, is_effectively_offered` | `is_effectively_offered` tient compte du palier et de l'item |
| Horaires | `GET`/`POST /business/{id}/capacity-rules` ; `PATCH`/`DELETE /business/{id}/capacity-rules/{rule_id}` | `weekday, start_time, end_time, concurrent_slots` | **sept lignes toujours** : un jour sans règle s'écrit « fermé » |
| Exceptions | `GET`/`POST /business/{id}/capacity-exceptions` ; `DELETE /business/{id}/capacity-exceptions/{exception_id}` | `date, is_closed, start_time, end_time, concurrent_slots` | réservations déjà prises conservées |
| Galerie | `POST /business/{id}/photos/uploads` (multipart) → `POST /business/{id}/photos {storage_key, alt_text}` ; `GET /business/{id}/photos` ; `PUT /business/{id}/photos/order {photos}` ; `DELETE /business/{id}/photos/{photo_id}` | `id, storage_key, position, alt_text` | **l'ordre s'envoie en entier**, pas par déplacement |
| Journée | `GET /business/{id}/bookings?jour=` | `jour, timezone, debut, fin, items[], a_trancher` | découpée dans le **fuseau du commerce** |
| — trancher | `POST /bookings/{id}/approve` ; `POST /bookings/{id}/decline {reason}` ; `POST /bookings/{id}/cancel-by-business {reason}` ; `POST /bookings/{id}/no-show {reason}` | la réservation | `a_trancher` compte ce qui attend une décision |
| Caisse | `POST /redemptions/verify {code}` → `POST /redemptions/consume {redemption_code_id}` | `creator_name, item_name, item_photo_key, starts_at, valid_until, status, par_secours` | `code_unknown`, `code_expired`, `already_redeemed`. **`par_secours` dit lequel des deux codes a servi** |
| Publications | `GET /business/{id}/collaborations?filtre&limite` | mêmes colonnes que la file d'arbitrage | `filtre` facultatif ; sans lui, `unfulfilled` apparaît aussi |
| — décision | `POST /business/collaborations/{id}/decision {approuve, reason, note}` | la contrepartie | **deux actions**, motif obligatoire sur le refus, `note` libre et facultative |
| Annuaire | `GET /business/{id}/creators` | `creator_id, first_name, last_name, city, bio, comptes[], paliers_ouverts, audience_totale` | **ce que l'abonnement achète** : sans abonnement, `subscription_required` — un refus, jamais une liste vide |
| Reporting | `GET /business/{id}/reporting?depuis&jusqu_a` | `reservations, consommations, annulations, absences, deplacements_pour_rien, publications, non_honorees, valeur_offerte_cents, portee_approximative, taux_d_honoration, par_palier, par_item` | `taux_d_honoration` **nul et non zéro** quand rien n'a été servi |
| Audience du salon | `GET /business/{id}/link-clicks` | mêmes agrégats que côté créateur | mesurée sur les clics réels, pas prédite |
| Abonnement | `GET`/`POST`/`DELETE /business/{id}/subscription`, `GET /business/{id}/plans` | `plan_id, status, current_period_end, checkout_url` | `checkout_url` **nulle en mode journal** : ne pas dessiner de bouton mort |
| Reprises de compte | `GET /business/{id}/support-access` | `[] {admin_user_id, reason, started_at, expires_at, ended_at}` | **ce que le salon lit de nous** : chaque entrée du support, avec son motif |
| Prise en main | `GET /handover/{jeton}` → `POST /handover/{jeton}/claim {email, password, locale, terms_version}` | aperçu : `business_name, address, phone, prestations_preparees, plages_preparees, terms_version` | **Ces deux-là sont publiques** : le salon n'a pas encore de compte. `handover_invalid` couvre inconnu, expiré, consommé, révoqué — un seul code pour les quatre |
| — second salon | `POST /handover/{jeton}/attach {terms_version}` | le commerce | **celle-ci exige une session** : un propriétaire qui a déjà un compte assume une seconde fiche sans s'inventer une seconde adresse |

---

## Administrateur

| Écran | Route | Données | Notes |
|---|---|---|---|
| Comptes à vérifier | `GET /admin/social-accounts/review` | `handle, platform, connected_at, last_synced_at, constats[]` | tri par attente |
| — décision | `POST /admin/social-accounts/{id}/verification {status, reason}` | `verification_status, constats[]` | **le rejet ne s'obtient jamais automatiquement** : seule cette file le prononce |
| Contreparties en revue | `GET /admin/collaborations/review?limite` | `collaboration_id, business_name, creator_*, platform, deadline_at, attempts_count, needs_human_review, dernier_motif` | échéance la plus proche en tête |
| — arbitrage | `POST /admin/collaborations/{id}/decision {issue, reason, note}` | la contrepartie | **route et corps distincts de ceux du commerce**. `issue` et non `approuve` : l'arbitre a plus de deux issues |
| Déplacements signalés | `GET /admin/venue-reports` | `booking_id, reported_at, note, starts_at, business_name, signalements_ecartes_du_createur, signalements_confirmes_du_salon` | les deux compteurs sont **rendus à l'arbitre**, pas appliqués |
| — décision | `POST /admin/venue-reports/{id}/decision {retenu}` | le signalement | un signalement écarté écrit un événement **de poids zéro** |
| Inscription terrain | `GET`/`POST /admin/prospects` | suivi : `business_id, name, status, address, prepared_at, issued_at, expires_at, used_at, revoked_at, channel` | **les fiches assumées restent dans la liste** : sans elles, on ne sait pas combien de visites ont abouti |
| — remettre le lien | `POST /admin/prospects/{id}/handover {channel, destination}` | `url, expires_at, channel` | **rendue une seule fois** : la base n'en garde que l'empreinte. `channel ∈ qr \| email` |
| — fermer le lien | `DELETE /admin/prospects/{id}/handover` | 204, **même sans lien ouvert** | « rien à fermer » est le résultat voulu |
| Reprise de compte | `POST`/`DELETE`/`GET /admin/businesses/{id}/support-access {reason}` | `reason, started_at, expires_at, ended_at` | motif **obligatoire** ; bornée ; le salon est prévenu |
| Paliers | `GET`/`POST /admin/tiers`, `GET`/`PATCH`/`DELETE /admin/tiers/{id}` | seuils, ratio indicatif, activation | `min_reliability_score` nul = condition ignorée, **pas échouée** |
| — historique | `GET /admin/tiers/{id}/changes` | `field, value_before, value_after, actor_user_id, changed_at` | **valeurs en texte**, `null` distinct d'une valeur |
| Plans | `GET /admin/plans` | `price_cents, billing_interval, subscriptions_count, active_subscriptions_count, mrr_cents` | **lecture seule**, et le seul écran du produit qui affiche des montants |
| Audience globale | `GET /admin/link-clicks` | agrégats + `signaux[]` de fabrication | les coups écartés sont gardés sans être comptés |
| Jobs épuisés | `GET /admin/jobs/exhausted`, `POST /admin/jobs/{id}/retry` | `job_type, target_id, attempts, last_error, last_run_at` | ni relance de masse ni abandon |

---

## Deux notes qui décident d'un écran

**Les deux codes de retrait ne servent pas au même geste.** `code` est un nombre à six chiffres qui **tourne toutes les trente secondes** : il se montre à l'écran et se scanne ou se lit à voix haute sur le moment. `manual_code` est un code à six caractères **fixe pour toute la vie de la réservation**, sans `I`, `O`, `0` ni `1` : il se dicte au téléphone et se tape sur un comptoir quand la caméra ne marche pas. À l'usage ils se confondent — c'est un défaut relevé en campagne 3, et il se corrige **des deux côtés à la fois** : l'écran qui les montre au créateur et celui qui les saisit au comptoir.

**Ce que le client ne doit jamais afficher.** Aucun montant, prix, valeur de prestation ni solde dans les applications créateur et commerce. `value_cents_snapshot` et `valeur_offerte_cents` existent pour le reporting interne ; s'ils arrivent, le client les ignore. La contrainte est produit, pas cosmétique.

---

## Manques connus de l'API, à ne pas contourner en dessinant

| Ce qui manque | Conséquence pour l'écran |
|---|---|
| **Aucune photo de profil de créateur** nulle part — ni colonne, ni clé, ni route | L'annuaire ne peut pas en montrer. Dessiner un emplacement, pas une image |
| **Aucun profil public de créateur** : `GET /business/{id}/creators` est la seule lecture, et elle n'a pas de vue par créateur | Pas de lien « voir le profil » possible aujourd'hui |
| Aucun écran ne consomme `POST /business` | Un salon qui s'inscrit n'a aucun chemin vers son commerce — **le défaut le plus grave du produit** |
| Aucun écran ne consomme `POST /admin/prospects` ni `POST /admin/prospects/{id}/handover` | Le mode terrain est inatteignable |
| Pas de sélecteur de commerce | `GET /me/businesses` rend une liste ; l'app prend le premier |
| Pas de quartiers, pas de curseur, pas de versionnement des paliers | Hors périmètre, inchangé |
