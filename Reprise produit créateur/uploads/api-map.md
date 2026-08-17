# Correspondance écran ↔ API

Les chemins ci-dessous ont été **réconciliés avec les routes réelles** de l'API (préfixe `/api/v1`). Ce qui n'est pas négociable reste ce que chaque écran a besoin de recevoir et les états qu'il doit pouvoir rendre.

Trois conventions de l'API qui ne se devinent pas depuis le design : `/business/...` est l'espace du commerçant, protégé par le résolveur d'appartenance ; `/businesses/...` est la découverte côté créateur ; une erreur répond `{"detail": "<code>"}` où le code appartient à une liste fermée.

**Non comblé, volontairement** : quartiers, événements temps réel, versionnement des paliers. Le rafraîchissement se fait à l'ouverture d'écran et sur geste, rien de plus.

Conventions : `GET` en lecture, réponses paginées par curseur, dates en ISO 8601 UTC, délais exprimés côté client à partir de `expires_at` / `deadline_at`. Toute réponse d'erreur porte `{ code, message }` où `code` appartient à une liste fermée ; le client n'affiche jamais `message` brut si un libellé local existe.

## Créateur

| Écran | Route | Données attendues | États |
|---|---|---|---|
| 01a Entrée | — | — | — |
| 01b Connexion réseau | `POST /me/social-accounts/instagram/connect` puis `GET /me/verification` | `verification_status`, `started_at`, `signaux[] {signal, verdict, constate, requis}`. **Aucune promesse de délai** | chargement long, `account_private`, hors ligne |
| 01c Audience certifiée | `GET /me/audience` + `GET /me/tiers` | `followers_count`, `engagement_rate`, `captured_at` (le chiffre est **daté**), `paliers[]`. Pas de `wave` : le badge est retiré | nul ≠ zéro : sans relevé, `followers_count` est nul |
| 01d Erreur de connexion | codes `account_private`, `oauth_denied`, `network` | motif + marche à suivre | 3 variantes |
| 02a Paliers | `GET /me/tiers` | `paliers[] {tier_id, accessible, obstacles[] {raison, requis, constate, ecart, depuis}}` | tous les obstacles rendus, ordre serveur conservé |
| 02b Éligible à rien | même route, `paliers[].accessible = false` partout | obstacle le plus proche. **Pas de `next_check_at`** : aucune projection de délai | écran d'action, pas d'état vide |
| 02c Chargement | — | — | squelettes |
| 02d Mesures périmées | obstacle `metrics_stale`, `depuis` = date du relevé | paliers du dernier relevé, daté | réessai par `POST /me/social-accounts/{id}/metrics/refresh` |
| 02e Compte en vérification | obstacle `account_under_review`, `depuis` = rattachement ; détail par `GET /me/verification` | jour n, **sans objectif annoncé** | persistant |
| 02f Autorisation expirée | obstacle `account_token_invalid`, `depuis` = échéance du jeton | engagements maintenus | reconnexion |
| 03 Fil géolocalisé | `GET /businesses?longitude&latitude&rayon_metres&categorie` | `commerces[] {business_id, name, category, address, cover_photo_key, distance_metres, items[]}` + `obstacles[]` à part. **Pas de quartier, pas de curseur** | chargement, vide (les `obstacles` disent pourquoi), permission refusée, hors ligne |
| 03 Quartiers | — | **hors périmètre** : rien en base ne porte un quartier | — |
| 04 Fiche commerce | `GET /businesses/{id}` | profil + `offres[] {name, duration_minutes, photo_key, required_mention, required_geotag, accessible, obstacles[], prochains_creneaux[]}`. **Pas de statistiques** | palier fermé rendu avec ses obstacles (contrairement au fil), sans photo, chargement, cache daté |
| 05a Créneaux | `GET /businesses/{id}/availability?catalog_item_id` | `creneaux[] {starts_at, ends_at, places_restantes}` | vide (jour suivant), palier fermé |
| 05b Confirmation | `POST /bookings {tier_offer_id, social_account_id, starts_at}` puis `POST /bookings/{id}/confirm` | la réservation naît en `held` avec `hold_expires_at` ; le code naît à la **confirmation** | `booking_slot_unavailable`, `booking_tier_not_accessible`, `booking_name_required`, `booking_hold_expired` |
| 06 Code de retrait | `GET /bookings/{id}/code` | `code` (6 chiffres), `manual_code` (6 caractères), `seconds_remaining`, `rotation_seconds` | nominal, < 10 s, hors ligne. **Pas d'état expiré, pas de renouvellement** : le code tourne seul |
| 07a Soumission | `GET /collaborations/{id}` puis `POST /collaborations/{id}/proof` (multipart) | `required_format`, `required_mention`, `required_geotag`, `deadline_at`, `attempts_count` | envoi progressif, échec (file locale), vide |
| 07b En contrôle | `GET /collaborations/{id}` | `status: under_review`, `submitted_at` | aucune promesse de délai |
| 07c Nouvelle soumission | `status: resubmit_requested` | `dernier_motif`, `deadline_at` (nouvelle), `attempts_count` | 3ᵉ tentative → `needs_human_review` |
| 07d Non honorée | `status: unfulfilled` | `deadline_at` dépassé. **Jamais d'approbation par défaut** | annoncé une fois |
| 08 Historique | `GET /me/bookings?status=&avant=&limite=` (`status` répétable) | `items[] {starts_at, business_*, item_name, status, platform, content_format, contrepartie}` + `compteurs` par statut, **sur tout l'historique** | vide par onglet, chargement, cache daté |

## Commerce

| Écran | Route | Données attendues | États |
|---|---|---|---|
| 09a Catalogue | `GET /business/{id}/tier-offers` | `offers[] {name, duration_min, tier, capacity_per_day, taken_today, photo_url, open}` groupés par palier | vide (+ `neighborhood_benchmarks`), chargement |
| 09a Ouvrir/fermer | `PUT /business/{id}/tier-offers/{offer_id}/activation` | — | file d'attente interdite (réseau requis) |
| 09b Composition | `POST /business/{id}/catalog-items` puis `POST /business/{id}/tier-offers` | `{name, duration_min, capacity_per_day, tier, expected_mention, expected_place_tag, photo}` | `tier` avec conséquence affichée ; photo facultative |
| 10a Horaires | `GET`/`POST` `/business/{id}/capacity-rules` | `week[] {weekday, open_at, close_at, capacity}`, `exceptions[]` | hors ligne : file locale marquée sur la ligne |
| 10b Capacité du jour | `POST /business/{id}/capacity-exceptions` | `bookings_taken`, `slots_open_after`, `next_day_default` | conflit chiffré avant enregistrement |
| 10b Fermer la journée | `POST /business/{id}/capacity-exceptions {is_closed: true}` | — | réservations prises conservées |
| 11a Caisse · saisie | `POST /redemptions/verify {code}` | `booking {creator, service, tier, counterpart, history}` | `code_unknown`, `code_expired`, `already_redeemed`, hors ligne (validation locale + envoi différé) |
| 11b Confirmation | `POST /redemptions/consume` | démarre le délai de contrepartie | « ce n'est pas la bonne personne » → abandon sans trace |
| 12a Journée | `GET /business/{id}/bookings?jour=` | `jour`, `timezone`, `debut`/`fin` (bornes réellement utilisées), `items[] {starts_at, creator_*, item_name, status, contrepartie}`. Découpée dans le **fuseau du commerce** | vide, chargement, hors ligne daté |
| 12a Absence | `POST /bookings/{id}/no-show` | disponible 20 min après l'heure prévue | réouvre la place |
| 13a Publications | `GET /business/{id}/collaborations?filtre={to_review\|expected\|approved}` | `items[] {creator_*, required_*, deadline_at, attempts_count, dernier_motif, derniere_soumission}`. **Filtre facultatif** : sans lui, `unfulfilled` apparaît aussi | vide, hors ligne (bouton retiré), chargement |
| 13b Contrôle | `POST /business/collaborations/{id}/decision {decision, reason}` | `expected` vs `observed` (mention, lieu, délai, format) | **deux actions seulement**, motif obligatoire sur la seconde |
| 14a Activation | `GET /business/{id}/activation` | `[{cle, done, blocking}]` — six étapes, deux bloquantes. **Pas de durée estimée, pas de pourcentage** | l'activation refuse exactement ce que `blocking` annonce |
| 14b Profil | `GET`/`PATCH` `/business/{id}` | identité, langues, comptes, utilisateurs caisse | pause : `POST /merchant/pause` |
| 14c Suspendu | `GET /business/{id}` (`status`) | `suspension {reason_code, facts[], due_bookings, proofs_to_review}` | caisse encore utilisable sur les lignes dues |

## Administrateur

| Écran | Route | Données attendues | Notes |
|---|---|---|---|
| 15a Comptes à vérifier | `GET /admin/social-accounts/review` | `items[] {handle, networks, followers, score, signals[], waiting_for, mode}` | tri par attente ; médiane et objectif 72 h en pied |
| 15a Décision | `POST /admin/social-accounts/{id}/verification` | `decision ∈ approve \| request_correction \| reject` | motif obligatoire hors `approve` ; annulation 30 s ; masse autorisée seulement sur `approve` |
| 16a Contreparties en revue | `GET /admin/collaborations/review` | mêmes colonnes que la file du commerce, échéance la plus proche en tête. Un dossier tranché en sort, son drapeau reste | arbitrage individuel uniquement |
| 16a Arbitrage | `POST /business/collaborations/{id}/decision` | **hors périmètre pour l'instant** : la file se lit, la décision passe par la même route que le commerce | note lue par les deux parties |
| 17a Paliers | `GET /admin/tiers`, `PATCH /admin/tiers/{id}` | seuils, ratio indicatif, activation | versionnement, simulation et double validation **hors périmètre** : l'écran se réduit à modifier un palier |
| 18a Plans | `GET /admin/plans` | `[{name, price_cents, billing_interval, subscriptions_count, active_subscriptions_count, mrr_cents}]` — le mensuel est calculé côté serveur. **Lecture seule** | seul écran du produit affichant des montants |
| 18a Modification | — | **hors périmètre** : l'écran se lit, il ne modifie pas | — |
| 19a Jobs épuisés | `GET /admin/jobs/exhausted` | `items[] {type, ref, attempts, last_error {code, message, stack}, exhausted_since, user_impact}` | rafraîchi toutes les 10 s |
| 19a Actions | `POST /admin/jobs/{id}/retry` | la relance de masse et l'abandon n'existent pas encore | — |
| 19a Bascule métier | — | **hors périmètre** | — |

## Événements temps réel — hors périmètre
Il n'existe aucun canal poussé. Le rafraîchissement se fait **à l'ouverture d'écran et sur geste**, rien de plus. Les quatre événements qui figuraient ici (`booking.redeemed`, `proof.state_changed`, `tier.unlocked`, `verification.state_changed`) se lisent chacun par une relecture de la route correspondante.

## Ce que le client ne doit jamais recevoir ni afficher
Aucun montant, prix, valeur de prestation ou solde dans les réponses destinées aux applications créateur et commerce. Si le backend en expose, le client les ignore : la contrainte est produit, pas cosmétique.
