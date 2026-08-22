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
| Inscription / connexion | `POST /auth/register {email, password, role, locale}`, `POST /auth/login` | `access_token`, `refresh_token`, `token_type`, `expires_in` | `email_already_used`, `invalid_credentials` |
| — session | `POST /auth/refresh {refresh_token}` → un couple neuf ; `POST /auth/logout {refresh_token}` | l'ancien jeton est révoqué à chaque rotation | **Les deux marchent sans jeton d'accès valide** : se déconnecter doit rester possible depuis un téléphone qu'on rend, et rafraîchir sert précisément quand l'accès a expiré |
| Connexion réseau | `POST /me/social-accounts/instagram/connect` **ou** `POST /me/social-accounts/tiktok/connect` → `{authorization_url}` | puis `GET /me/verification` → `[] {social_account_id, platform, handle, verification_status, started_at, reviewed_at, signaux[]}` | **Aucune promesse de délai.** `oauth_denied`, `social_provider_unavailable` |
| Comptes rattachés | `GET /me/social-accounts` | `[] {id, platform, handle, status, verification_status, token_expires_at, connected_at}` | jeton expiré → reconnecter |
| Audience | `GET /me/audience` | **Une ligne par compte connecté**, jamais un agrégat : `[] {social_account_id, platform, handle, status, verification_status, followers_count, following_count, media_count, avg_views, engagement_rate, captured_at, reconnectable}` | **Chaque compte porte ses chiffres et sa propre date.** Deux réseaux ne partagent jamais un relevé — c'est la ligne qu'il faut lire, pas la somme. Nul ≠ zéro : sans relevé, `followers_count` est nul et `captured_at` aussi |
| — relance | `POST /me/social-accounts/{id}/metrics/refresh` | le relevé neuf | limité par `metrics_min_refresh_interval_seconds` |
| Paliers | `GET /me/tiers?longitude&latitude&rayon_metres` | `creator_id, is_new_creator, fiabilite {reliability_score, completed_collabs_count}, paliers[]`. Chaque palier porte ses `obstacles[] {raison, requis, constate, ecart, depuis}` **et `offres_disponibles`** | `offres_disponibles` vaut **pour les paliers fermés comme pour les ouverts** : c'est ce que la carte d'un palier fermé annonce, et le fil ne peut pas le fournir — il ne rend jamais une prestation d'un palier fermé. **Zéro est une réponse** : un palier qu'aucun commerce n'a composé se dit, il ne se masque pas. Le compte suit l'état effectif — item retiré, parent désactivé, commerce hors ligne en sortent | **Position facultative** : sans elle, la réponse d'avant au champ près ; avec, chaque palier porte `offres_dans_le_rayon` et `commerces_dans_le_rayon`. **`null` n'est pas zéro** — l'écran distingue « on n'a pas demandé » de « il n'y en a aucun ». Les deux coordonnées vont ensemble, une seule est un 422 |
| Offres d'un palier | `GET /me/tiers/{tier_id}/offres?longitude&latitude` | `[] {tier_offer_id, catalog_item_id, business_id, nom, nom_du_commerce, neighborhood, price_cents, currency, duration_minutes, photo_key, distance_metres \| null}` | **Non borné par la distance**, ce que le fil ne peut pas rendre : il est borné par un rayon par construction. C'est le second état de la bascule « près de vous / les douze », dont les deux états doivent montrer deux listes différentes. **Trié par quartier puis par nom de prestation** — le seul axe que le produit connaît et qui ne classe personne : trier par palier hiérarchiserait des prestations toutes réservables, trier par salon supposerait un ordre entre eux. La position n'y borne rien, elle ajoute seulement `distance_metres` |
| Profil | `GET`/`PATCH /me/profile` | `first_name, last_name, city, bio, reliability_score, completed_collabs_count, is_new_creator, anonymized_at` | `reliability_score` **nul = neutre**, pas zéro |
| Langue | `PATCH /me {locale}` | `id, email, role, status, locale` | — |
| Fil | `GET /businesses?longitude&latitude&rayon_metres&categorie&disponible&recherche` | `commerces[]`, `obstacles[]`, `rayon_metres`, `total_prestations`, **`categories[] {categorie, commerces, prestations}`**, **`rayons[] {rayon_metres, commerces, prestations}`** | `categories` donne **le compte de salons et de prestations par catégorie**, et `rayons` ce qu'un élargissement ouvrirait. Les deux sortent **du même tamis que la liste** — mêmes paliers, mêmes items disponibles, même contrôle de créneau : un compte calculé plus vite promettrait des salons que l'écran suivant ne rendrait pas. Vide → **les `obstacles` disent pourquoi** |
| Fil, filtré | `GET /businesses?…&disponible=aujourd_hui\|sept_jours` | idem | le filtre porte sur **le fil rendu**, jamais sur `categories` ni `rayons` : ceux-ci disent ce qu'un élargissement ouvrirait, et les filtrer ferait promettre neuf salons puis n'en montrer que trois. « Aujourd'hui » vaut **un jour glissant**, pas « jusqu'à minuit » — à 23 h, la seconde définition ne rendrait presque rien |
| Fil, cherché | `GET /businesses?…&recherche=` | idem | cherche le nom du salon, celui de la prestation et sa description, **sans accent des deux côtés** : « panaderia » trouve « Panadería ». Miami est bilingue. Un terme vide ou fait d'espaces n'est pas une recherche : le fil revient entier |
| Fiche | `GET /businesses/{id}` | `name, category, address, timezone, phone, cover_photo_key, photos[], menu_pages[], menu_url \| null, offres[]` | palier fermé rendu **avec** ses obstacles, contrairement au fil. **`menu_pages` n'est pas `photos`** : la galerie montre le lieu, la carte se consulte — deux accès distincts sur l'écran, jamais un carrousel commun. Quand `menu_pages` est vide et `menu_url` renseignée, **dire qu'on sortira de l'application** avant d'ouvrir le lien. Chaque offre porte `leaves_choice` : vrai, le créateur choisira sur place et la carte est ce qui lui dit quoi — c'est là que l'accès à la carte doit se voir |
| Créneaux | `GET /businesses/{id}/availability?catalog_item_id&jours` | `[] {starts_at, ends_at, places_restantes}` | vide → jour suivant |
| Suggestions | `GET /businesses/suggestions?longitude&latitude&rayon_metres` | `prestations[]`, `salons[]`, `quartier \| null`, **`origine`** | deux groupes, **même tamis que le fil** : une suggestion qu'on ne peut pas réserver envoie sur une impasse. **`origine` décide de la phrase, pas seulement du contenu** — `populaire` quand le classement vient des réservations servies du quartier, `a_proximite` quand il n'y a aucun historique et qu'on classe par distance. Un salon proche annoncé comme populaire est un mensonge invérifiable : l'écran a **deux phrases**. Le quartier vient de la position, jamais d'un paramètre |
| Réservation | `POST /bookings {tier_offer_id, social_account_id, starts_at}` puis `POST /bookings/{id}/confirm` | naît en `held` avec `hold_expires_at` ; **le code naît à la confirmation** | `booking_slot_unavailable`, `booking_tier_not_accessible`, `booking_name_required`, `booking_hold_expired` |
| — annuler | `POST /bookings/{id}/cancel` | — | fenêtre sans frais en configuration |
| Code de retrait | `GET /bookings/{id}/code` | `code` (6 chiffres, tourne), `manual_code` (6 caractères, fixe), `seconds_remaining`, `rotation_seconds` | **Pas d'état expiré** : il tourne seul. Les deux codes ne servent pas au même geste — voir la note plus bas |
| Déplacement pour rien | `POST /bookings/{id}/venue-report {note}` | `id, booking_id, status, reported_at, note` | fenêtre courte après le créneau ; **ne pénalise jamais celui qui signale** |
| Historique | `GET /me/bookings?status&avant&limite` (`status` répétable) | `items[]`, `compteurs` par statut **sur tout l'historique** | vide par onglet |
| Contrepartie | `GET /collaborations/{id}` | `required_format, required_mention, required_geotag, deadline_at, status, attempts_count, needs_human_review, proofs[]` | `under_review`, `resubmit_requested`, `unfulfilled` |
| — envoyer la preuve | `POST /me/proof-uploads` (multipart `fichier`) → `{screenshot_key}` puis `POST /collaborations/{id}/proof {source_url, screenshot_key, note}` | **deux appels** : le fichier d'abord, la soumission ensuite | file locale sur échec d'envoi |
| Lien traqué | `GET /me/collaborations/{id}/link` | `slug`, `url`, `is_active` | **un seul lien par contrepartie, pour toute sa vie** — il vit dans le sticker déjà publié |
| Portée mesurée | `GET /me/link-clicks` | `clics, clics_locaux, part_locale, par_pays, par_ville, par_terminal, par_referent, ecartes` | aucune adresse IP n'existe nulle part |
| Confirmation d'adresse | `GET /auth/verify-email?token=`, `POST /me/verify-email/resend` | le compte, `email_verified_at` daté | le lien s'ouvre **dans un navigateur**, pas dans l'app : à usage unique, borné à 24 h, et un renvoi révoque le précédent. Un compte non confirmé entre et se sert du produit — il ne peut ni réserver ni mettre un commerce en ligne |
| Fermer son compte | `POST /me/deletion`, `DELETE /me/deletion` | le compte, `deletion_effective_at` daté | **anonymise, ne détruit pas** — le journal est immuable et une contrepartie engagée concerne un salon qui n'a rien demandé. Différée de trente jours, retour possible pendant tout le délai. Refusée en 409 `deletion_blocked_by_collaboration` tant qu'une contrepartie est en cours : il faut l'honorer ou la clore. Côté commerce, l'historique reste et porte `creator_partie` — jamais un nom vide |
| Terminal | `PUT /me/devices {token, platform}`, `DELETE /me/devices/{token}` | `id, platform, status, last_seen_at` | se révoque comme un jeton social. **Plus de réglage par genre** : les sept genres restent, le choix par personne a été retiré |

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
| Repères du voisinage | `GET /business/{id}/neighbourhood` | `rayon_metres, commerces, prestations_publiees {bas, haut} \| null, places_par_jour {bas, haut} \| null, palier_le_plus_offert {platform, content_format} \| null` | **pour les états vides du commerce.** Des fourchettes, jamais des chiffres exacts : un salon ne doit pas pouvoir lire le catalogue de son voisin. Les deux fourchettes sont `null` sous cinq salons alentour — `commerces` est rendu quand même, l'écran écrit alors « pas encore assez de salons autour de vous » et non un vide. `rayon_metres` est rendu parce que l'écran l'écrit : « les salons dans 2 km » situe le repère, « le quartier » ne situe rien — **il n'y a pas de quartiers dans le modèle** |
| Catalogue | `GET`/`POST /business/{id}/catalog-items` ; `GET`/`PATCH`/`DELETE /business/{id}/catalog-items/{item_id}` ; `PUT /business/{id}/catalog-items/{item_id}/availability {is_available}` | `name, description, price_cents, duration_minutes, requires_booking, photo_key, parent_item_id, is_available, is_effectively_available` | `duration_minutes` **obligatoire dès que réservable** ; une variante est réservable, pas son parent |
| Import de carte | `POST /business/{id}/menu-imports/uploads` (multipart `fichier`) → `{file_key, mime_type}` ; puis `POST /business/{id}/menu-imports {file_key, mime_type}` → `POST /business/{id}/menu-imports/{import_id}/extract` → `POST /business/{id}/menu-imports/{import_id}/validate {lignes}` ; relecture par `GET /business/{id}/menu-imports/{import_id}` | `status, mime_type, currency, lignes[] {name, price_cents, description, confidence}, confiance_moyenne, reviewed_at`, puis `{import_id, status, items_crees}` | **C'est une photo qui se dépose** — la carte au mur, prise au téléphone : JPEG, PNG ou WebP, huit mégaoctets. Le `mime_type` est déduit de la signature, pas de ce que l'appelant déclare. **L'extraction ne crée jamais d'items** : elle remplit une charge que le commerce valide. **Aucune durée n'est extraite** — une carte affiche des prix, et une durée inventée fausserait toute la capacité. `confidence` sert à ordonner la relecture. En mode `manual`, l'extraction rend une charge vide : l'écran doit alors proposer la saisie, pas un état d'erreur |
| Portée d'une prestation | `GET /business/{id}/tier-offers/creatrices-par-palier?catalog_item_id` | `tier_id, platform, content_format, creatrices, deja_offert` | **un total, pas un gain.** « ces 103 créatrices deviennent 12 si je monte cette prestation d'un palier » : les deux paliers sont ouverts, donc absents de `portee.gains_par_palier`, et aucune composition des gains ne rend ces deux nombres. Le compte ne dépend pas de la prestation — l'éligibilité regarde une créatrice et un palier — mais `deja_offert` en dépend, et c'est lui qui dit lequel des nombres est celui d'aujourd'hui |
| Paliers offerts | `GET /business/{id}/tiers` ; `GET`/`POST /business/{id}/tier-offers` ; `PUT /business/{id}/tier-offers/{offer_id}/activation {is_active}` ; `DELETE /business/{id}/tier-offers/{offer_id}` | `tier_id, catalog_item_id, platform, content_format, item_name, is_active, is_effectively_offered` | `is_effectively_offered` tient compte du palier et de l'item |
| Horaires | `GET`/`POST /business/{id}/capacity-rules` ; `PATCH`/`DELETE /business/{id}/capacity-rules/{rule_id}` | `weekday, start_time, end_time, concurrent_slots` | **sept lignes toujours** : un jour sans règle s'écrit « fermé » |
| Exceptions | `GET`/`POST /business/{id}/capacity-exceptions` ; `DELETE /business/{id}/capacity-exceptions/{exception_id}` | `date, is_closed, start_time, end_time, concurrent_slots` | réservations déjà prises conservées |
| Galerie | `POST /business/{id}/photos/uploads` (multipart) → `POST /business/{id}/photos {storage_key, alt_text}` ; `GET /business/{id}/photos` ; `PUT /business/{id}/photos/order {photos}` ; `DELETE /business/{id}/photos/{photo_id}` | `id, storage_key, position, alt_text` | **l'ordre s'envoie en entier**, pas par déplacement |
| Carte du commerce | `POST /business/{id}/menu/uploads` (multipart) → `POST /business/{id}/menu {storage_key, alt_text}` ; `GET /business/{id}/menu` ; `PUT /business/{id}/menu/order {pages}` ; `DELETE /business/{id}/menu/{page_id}` | `id, storage_key, position, alt_text` | **mécanisme identique à la galerie, entrée différente.** Plusieurs pages, parce qu'une carte tient rarement sur une — entrées et plats d'un côté, desserts de l'autre. Plafond de huit. Le lien vers la carte en ligne n'est pas ici : c'est `menu_url`, un champ du commerce, changé par `PATCH /business/{id}` |
| Bande de disponibilité | `GET /businesses/{id}/availability/summary?catalog_item_id=&jours=14` | par jour : `jour`, `ouvert`, `creneaux_libres` | **une route et non quatorze appels**. `ouvert` et le compte sont deux champs : zéro créneau sur un jour ouvert n'est pas un jour fermé |
| Journée | `GET /business/{id}/bookings?jour=` | `jour, timezone, debut, fin, items[], a_trancher` — chaque ligne porte `creator_profil_url` | découpée dans le **fuseau du commerce**. Le lien du profil est **dérivé** du pseudonyme et du réseau de la demande, jamais stocké ; nul si la plateforme n'a pas d'adresse publique connue |
| — trancher | `POST /bookings/{id}/approve` ; `POST /bookings/{id}/decline {reason}` ; `POST /bookings/{id}/cancel-by-business {reason}` ; `POST /bookings/{id}/no-show {reason}` | la réservation | `a_trancher` compte ce qui attend une décision |
| Caisse | `POST /redemptions/verify {code}` → `POST /redemptions/consume {redemption_code_id}` | `creator_name, item_name, item_photo_key, starts_at, valid_until, status, par_secours` | `code_unknown`, `code_expired`, `already_redeemed`. **`par_secours` dit lequel des deux codes a servi** |
| Publications | `GET /business/{id}/collaborations?filtre&limite` | mêmes colonnes que la file d'arbitrage | `filtre` facultatif ; sans lui, `unfulfilled` apparaît aussi |
| — décision | `POST /business/collaborations/{id}/decision {approuve, reason, note}` | la contrepartie | **deux actions**, motif obligatoire sur le refus, `note` libre et facultative |
| Annuaire | `GET /business/{id}/creators?limite&decalage` | `{portee, createurs[], total}` — `portee {createurs, peuvent_reserver, rayon_metres, gains_par_palier[]}` ; par créatrice `creator_id, city, bio, paliers_ouverts, peut_reserver_ici, palier_accessible, distance_metres, audience_totale` et `comptes[] {platform, handle, followers, avatar_key, profil_url}` | **ce que l'abonnement achète** : sans abonnement, `subscription_required` — un refus, jamais une liste vide. **L'annuaire est celui de ce salon** : `paliers_ouverts` dit « elle peut réserver ce que vous avez ouvert », pas « elle se qualifie quelque part ». Trié par le serveur — accès d'abord, proximité ensuite — parce qu'une liste paginée triée dans le client se réordonne à chaque page. Borné au même rayon que `portee`. `distance_metres` nulle veut dire « on ne sait pas », jamais « loin » : la ligne passe en fin de tri sans être écartée. Ni prénom ni nom : le pseudonyme est l'identité de cet écran. `avatar_key` se sert par `GET /media/{cle}` |
| Reporting | `GET /business/{id}/reporting?depuis&jusqu_a` | `business_id, currency, debut, fin, timezone, reservations, consommations, annulations, absences, deplacements_pour_rien, publications, publications_attendues, non_honorees, valeur_offerte_cents, portee_approximative, taux_d_honoration` ; **trois agrégats** : `par_palier[] {tier_id, platform, content_format, publications, valeur_offerte_cents}`, `par_item[] {catalog_item_id, name, reservations, consommations, publications, valeur_offerte_cents}`, **`par_semaine[] {debut, publications}`** | `taux_d_honoration` **nul et non zéro** quand rien n'a été servi. `par_semaine` est l'agrégat hebdomadaire — il existe depuis #78 et manquait à cette carte : `debut` est le lundi de la semaine, dans le fuseau du commerce |
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
| Contreparties en revue | `GET /admin/collaborations/review?limite` | `collaboration_id, business_name, creator_*, platform, deadline_at, attempts_count, needs_human_review, dernier_motif, repetitions_du_dernier_motif, meme_motif_repete` | échéance la plus proche en tête. `meme_motif_repete` est le tri de l'écran : trois fois le même reproche appelle « fermer sans faute », trois reproches différents appellent une décision |
| — arbitrage | `POST /admin/collaborations/{id}/decision {issue, reason, note}` | la contrepartie | **route et corps distincts de ceux du commerce**. `issue` et non `approuve` : l'arbitre a **quatre** issues — `approve`, `resubmit`, `unfulfilled`, et `close_no_fault`, qui clôt sans écrire aucun événement de fiabilité |
| — motifs qui bouclent | `GET /admin/collaborations/motifs-qui-reviennent` | `motif, dossiers, dossiers_touches` | un signal sur le produit, pas sur les créatrices : un motif opposé trois fois **de suite** sur beaucoup de dossiers dit qu'une exigence est mal formulée quelque part |
| Déplacements signalés | `GET /admin/venue-reports` | `booking_id, reported_at, note, starts_at, business_name, signalements_ecartes_du_createur, signalements_confirmes_du_salon` | les deux compteurs sont **rendus à l'arbitre**, pas appliqués |
| — décision | `POST /admin/venue-reports/{id}/decision {retenu}` | le signalement | un signalement écarté écrit un événement **de poids zéro** |
| Inscription terrain | `GET`/`POST /admin/prospects` | suivi : `business_id, name, status, address, prepared_at, issued_at, expires_at, used_at, revoked_at, channel, opened_at, blocked_at, etat, prepared_by, remis_par` | **les fiches assumées restent dans la liste** : sans elles, on ne sait pas combien de visites ont abouti. `etat` vaut `prepared`, `never_opened`, `opened_not_claimed`, `blocked_on_commitment` ou `claimed` — **trois états pour une fiche non activée**, parce qu'ils appellent trois gestes : revisiter, relancer, ou rien de tout cela — le produit coince. `channel` départage les deux méthodes de démarchage ; le taux d'activation par voie dit si un second passage rapporte plus qu'une relance. `prepared_by` et `remis_par` sont **deux gestes distincts** — sans eux, un taux d'activation par voie compare deux démarcheurs en croyant comparer deux méthodes. `prepared_by` vient du journal d'audit, donc présent même sur une fiche jamais remise |
| — remettre le lien | `POST /admin/prospects/{id}/handover {channel, destination}` | `url, expires_at, channel` | **rendue une seule fois** : la base n'en garde que l'empreinte. `channel ∈ qr \| email` |
| — fermer le lien | `DELETE /admin/prospects/{id}/handover` | 204, **même sans lien ouvert** | « rien à fermer » est le résultat voulu |
| Reprise de compte | `POST`/`DELETE`/`GET /admin/businesses/{id}/support-access {reason}` | `reason, started_at, expires_at, ended_at` | motif **obligatoire** ; bornée ; le salon est prévenu |
| Paliers | `GET`/`POST /admin/tiers`, `GET`/`PATCH`/`DELETE /admin/tiers/{id}` | seuils, ratio indicatif, activation | `min_reliability_score` nul = condition ignorée, **pas échouée** |
| — historique | `GET /admin/tiers/{id}/changes` | `field, value_before, value_after, actor_user_id, changed_at` | **valeurs en texte**, `null` distinct d'une valeur |
| Plans | `GET /admin/plans` | `price_cents, billing_interval, subscriptions_count, active_subscriptions_count, mrr_cents, duree_mediane_terminee_jours, abonnements_termines, duree_mediane_en_cours_jours, abonnements_en_cours, abonnes_par_categorie[]` | **lecture seule**, et le seul écran du produit qui affiche des montants. **Deux médianes et jamais une** : une durée terminée est un fait, une durée courue est un minimum, et les mélanger rendrait un nombre que personne ne sait lire — l'écran dit laquelle il affiche, et l'effectif servi à côté dit ce qu'elle vaut. `abonnes_par_categorie` est la catégorie des **abonnés**, à ne pas confondre avec `category`, qui dit à qui le plan s'adresse : c'est leur écart qui informe un prix |
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
| **Aucun profil public de créateur chez nous** : `GET /business/{id}/creators` est la seule lecture, et elle n'a pas de vue par créateur | `profil_url` mène **chez la plateforme**, pas chez nous. Une fiche créateur interne reste à concevoir |
| La photo est relevée **avec les métriques**, donc au rythme du travail de fond | Un compte tout juste rattaché n'a pas encore de visage. L'écran doit tenir `avatar_key` nulle sans clignoter |
| Aucun écran ne consomme `POST /business` | Un salon qui s'inscrit n'a aucun chemin vers son commerce — **le défaut le plus grave du produit** |
| Aucun écran ne consomme `POST /admin/prospects` ni `POST /admin/prospects/{id}/handover` | Le mode terrain est inatteignable |
| Pas de sélecteur de commerce | `GET /me/businesses` rend une liste ; l'app prend le premier |
| Pas de quartiers : le voisinage est un **rayon** | `GET /business/{id}/neighbourhood` rend `rayon_metres` avec ses chiffres. Écrire « votre quartier » sur cet écran serait inventer un découpage que le modèle n'a pas |
| Pas de curseur, pas de versionnement des paliers | Hors périmètre, inchangé |
