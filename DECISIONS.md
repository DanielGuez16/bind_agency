# DECISIONS

Décisions techniques prises en cours de route. Une ligne par décision, avec la
date et la raison. On n'y consigne que ce qui n'est pas déductible du code.

---

## 2026-08-05 — Phase 1, initialisation du dépôt

**Postgres local via `postgis/postgis:16-3.4`, extension non activée.**
Le choix du géo (PostGIS `geography`, `earthdistance`, ou colonnes lat-lon nues)
se tranche à la tâche « modèle de données ». Partir de l'image PostGIS évite de
recréer conteneur et volume ce jour-là. L'image n'existe qu'en amd64 : elle
tourne en émulation sur Apple Silicon. Mesuré sans impact utile — conteneur sain
en 10 s, suite de tests en 0,5 s. À revoir seulement si les tests de concurrence
de la phase 5 deviennent lents.

**Ports décalés : Postgres sur 5434, API sur 8010.**
5432, 5433 et 8000 sont déjà occupés par d'autres projets sur la machine de
développement. Aucune raison technique, juste une cohabitation. Le conteneur
reste sur 5432 en interne.

**Base de test distincte, créée et détruite par la session pytest.**
`TEST_DATABASE_URL` est une variable dédiée. `conftest.py` refuse de démarrer si
elle est absente, et refuse de tourner si elle désigne la même base que
`DATABASE_URL`. Aucune commande de test ne doit pouvoir effacer des données de
travail.

**Alembic en template async, URL injectée depuis `app.core.config`.**
`alembic.ini` ne porte pas `sqlalchemy.url` : une seule source de vérité pour la
configuration, et aucun identifiant de connexion commité. Le template async
évite de réécrire `run_migrations_online` dès la première migration.

**`/api/v1/health` renvoie 503 si une dépendance est en défaut, et la nomme.**
Une sonde qui répond 200 base morte ne sert à rien. Elle n'utilise pas la
dépendance de session : une session injectée échouerait à la résolution et
produirait un 500 opaque au lieu du 503 attendu.

**Aucune valeur de repli sur les secrets dans `core/config.py`.**
Variable absente égale erreur de démarrage. Un défaut silencieux se découvre en
production, pas au lancement.

**Node 24, fixé dans `.nvmrc`.**
Expo SDK 57 démarre sans avertissement dessus. Pas de raison de descendre.

---

## 2026-08-05 — Phase 1, modèle de données

**Géo tranché : PostGIS, `geography(Point,4326)`, index GiST.**
Sur `business.geo` et `creator_profile.geo`. Le filtrage se fera par distance
autour du créateur, `geography` répond en mètres sans projection à choisir.
L'index GiST est déclaré explicitement plutôt que laissé à GeoAlchemy2
(`spatial_index=False`) : l'autogénération et le modèle décrivent alors la même
chose, sans index créé dans le dos de la migration.

**Table `app_user`, classe `User`. Écart assumé à `SPEC.md`.**
`user` est un mot réservé Postgres. La fidélité littérale à la spec coûterait un
`"user"` sur chaque requête écrite à la main. `SPEC.md` sera corrigé.

**Devise portée par le commerce, jamais par le montant.**
`currency` existe sur `business` et sur `subscription_plan` — celui-ci est au
niveau plateforme, il n'a pas de commerce. Aucune sur `catalog_item` ni sur
`booking` : dupliquer la devise à chaque montant ouvre la porte aux
incohérences. Un test de schéma verrouille la règle.

**`booking.requires_booking` dénormalisé, garanti par clé étrangère composite.**
Un `CHECK` ne peut pas joindre : la contrainte « créneau si et seulement si
l'item exige une réservation » était inexprimable telle quelle. La colonne est
figée à la réservation comme `value_cents_snapshot`, et une FK composite vers
`catalog_item (id, business_id, requires_booking)` interdit qu'elle diverge.
Conséquence acceptée : un commerce ne peut plus basculer `requires_booking` sur
un item déjà réservé — on ne réécrit pas la nature d'une réservation passée. Le
service devra renvoyer une erreur explicite demandant de créer un nouvel item,
et non laisser remonter la violation de contrainte.

**Le même procédé sert à la cohérence commerce.**
FK composites `tier_offer → catalog_item (id, business_id)` et
`booking → tier_offer (id, business_id)`, plus la variante vers son parent. Il
devient structurellement impossible qu'une offre ou une réservation pointe
l'item d'un autre commerce.

**`audit_log.actor_user_id` en `RESTRICT`, pas en `SET NULL`.**
Découvert par un test en échec : `SET NULL` est un `UPDATE`, que le trigger
d'immuabilité refuse. Les deux règles étaient incompatibles. `RESTRICT` est
aussi le comportement voulu — un utilisateur qui a agi ne s'efface pas, il
s'anonymise.

**Suppression d'un créateur impossible par construction.**
Tout ce qui est historique ou probatoire est en `RESTRICT` : `booking`,
`collaboration`, `proof`, `reliability_event`, `redemption_code`, `audit_log`.
La suppression de compte du §7 est donc une anonymisation — d'où `anonymized_at`
sur `creator_profile` et la nullabilité des champs personnels, `app_user.email`
et `app_user.phone` compris. Sans cette nullabilité, l'effacement buterait sur
des `NOT NULL` au moment où il faudra le livrer.

**Les CHECK d'enum sont exclus de la comparaison de schéma.**
`sa.Enum(native_enum=False, create_constraint=True)` produit des contraintes
marquées `_type_bound`. Le plugin de comparaison d'Alembic les lit en base mais
ne les reconnaît pas côté métadonnées : sans filtre, **chaque autogénération
proposait de supprimer les 22 CHECK d'enum**, ce qui aurait retiré en silence
toute la validation. Le filtre vit dans `app/core/schema.py`, partagé par
`alembic/env.py` et par un test qui vérifie l'absence de dérive.

**Le `search_path` est posé à la connexion, jamais par un `SET`.**
Un `SET` exécuté avant `context.begin_transaction()` ouvre une transaction
implicite ; Alembic considère alors qu'il ne gère pas la transaction, ne
committe jamais, et **la migration est annulée en silence avec un code de sortie
nul et un journal normal**. Le cadrage sur `public` est donc passé en
`connect_args`. Il sert aussi à ignorer `tiger` et `topology`, que l'image
postgis ajoute au `search_path` de la base de développement mais qui n'existent
pas dans une base créée depuis `template1` — celle des tests et de la CI.

**`is_new_creator` en colonne générée.**
`GENERATED ALWAYS AS (reliability_score IS NULL) STORED`. Un champ dérivé qui ne
peut pas diverger de sa source, et qui reste filtrable en SQL.

**Journal d'audit immuable par trigger.**
Exception sur `UPDATE`, `DELETE` et `TRUNCATE` — ce dernier explicitement, il ne
déclenche pas les triggers de ligne. Sans ces quinze lignes, « immuable » ne
serait qu'une intention.

**Complétude conditionnelle plutôt que `NOT NULL` inconditionnel.**
`business.geo` et `business.address` sont nullables, mais
`CHECK (status <> 'active' OR ... IS NOT NULL)` : un géocodage qui échoue ne
bloque pas l'inscription, et un commerce n'apparaît dans le fil que localisable.
Même logique sur `app_user.email`, nullable pour l'anonymisation seulement :
`CHECK (status = 'anonymized' OR email IS NOT NULL)` interdit un compte sans
moyen de connexion. Le statut porte la garantie, pas la colonne.

---

## 2026-08-05 — Phase 1, authentification et rôles

**Liste d'autorisation des jetons de rafraîchissement, pas liste de refus.**
Chaque jeton émis a sa ligne dans `refresh_token`, et l'identifiant de la ligne
sert de `jti`. Un jeton n'est accepté que si sa ligne existe, n'est pas révoquée
et n'est pas expirée : une signature valide ne suffit pas. Le jeton lui-même
n'est pas stocké, la signature prouve déjà son authenticité.

**Rotation à chaque rafraîchissement, avec détection de rejeu.**
L'ancien jeton est révoqué au moment où le nouveau est émis. Si un jeton déjà
révoqué se présente, la session est considérée comme compromise et **toutes** les
sessions du compte sont coupées. C'est ce qui donne sa valeur à la table : sans
rotation, une révocation ne protège que du vol futur.

**Le type de jeton est vérifié à la décodification.**
Sans le contrôle `typ`, un jeton de rafraîchissement — trente jours — serait
accepté comme jeton d'accès sur toute route protégée.

**Le statut du compte est relu à chaque requête.**
`current_user` recharge l'utilisateur et refuse tout statut autre qu'`active`.
Un jeton émis avant une suspension cesse d'ouvrir des portes immédiatement, sans
attendre son expiration.

**Aucune dérogation administrateur sur `require_business_member`.**
Un administrateur n'est pas membre d'un commerce. Une route d'administration
déclare `require_role(UserRole.ADMIN)` ; elle ne se déguise pas en route
commerce. Une dérogation implicite est exactement ce qui rend les fuites entre
locataires invisibles à la relecture.

**403 et non 404 quand le commerce n'existe pas.**
Répondre 404 dans un cas et 403 dans l'autre dirait à un membre du commerce A
quels identifiants existent ailleurs. Les deux cas répondent `not_a_member`.

**Le hachage est effectué même sans compte correspondant.**
Sinon le temps de réponse de la connexion révèle si une adresse est enregistrée.

**Les routes de sonde vivent dans la suite de tests.**
Éprouver `require_role` et `require_business_member` demande des routes
protégées. Elles sont montées par la fixture de test à partir des dépendances
réelles, jamais par `create_app` : le code de production ne porte pas
d'endpoints factices.

**La rotation avec détection de rejeu est un ajout délibéré au brief.**
La consigne demandait une table de jetons révocables. La rotation n'y figurait
pas : elle a été ajoutée sciemment, parce que sans elle une révocation ne
protège que du vol futur — un jeton déjà dérobé reste valable jusqu'à son
expiration, et la table ne sert qu'à fermer la porte après coup. Validé après
signalement.

**`jwt_secret_key` en `SecretStr`, URL de base masquées du `repr`.**
La clé de signature ne sort qu'avec `.get_secret_value()` : une clé qui
apparaît dans un `repr` ou une trace de mise au point est une clé perdue.
`database_url` et `test_database_url` gardent leur type `PostgresDsn` —
SQLAlchemy et Alembic en ont besoin tel quel — mais passent en `repr=False`,
car elles contiennent le mot de passe.
Limite connue : une `ValidationError` de pydantic-settings au démarrage affiche
le dictionnaire d'entrée, donc les valeurs présentes. En CI, GitHub les masque.
En production, ne pas recopier cette trace dans un ticket.

**Pas d'`assert` sur une invariante garantie ailleurs.**
`authenticate` teste explicitement `user is None` au lieu de s'appuyer sur le
fait que `verify_password` renvoie faux quand l'empreinte est absente. Un
`assert` disparaît sous `python -O`, et aurait transformé un refus
d'authentification en erreur 500 le jour où cette fonction changerait.

---

## 2026-08-05 — Phase 1, journal d'audit

**Point de passage unique, sans transaction propre.**
`app/services/audit.py` est le seul endroit qui écrit dans `audit_log`. La
fonction n'ouvre ni ne committe de transaction : elle écrit dans la session que
l'appelant lui donne, et c'est l'appelant qui committe, une fois, avec la
transition décrite. C'est ce qui rend impossible une transition committée sans
sa trace — le contraire serait un bug, pas un cas dégradé.

**`clock_timestamp()` et non `now()` sur `occurred_at`.**
Découvert par un test en échec. `now()` renvoie l'heure de **début de
transaction** : toutes les lignes écrites dans la même transaction portaient un
horodatage identique, et le journal était incapable de dire qu'un jeton avait
été révoqué *puis* un autre émis. Sur une rotation, les deux lignes sont
séparées d'une milliseconde — indistinguables avec `now()`. Les autres tables
gardent `now()` sur `created_at`, l'ordre intra-transaction n'y a pas de sens.

**L'absence d'acteur utilisateur est une information, pas un trou.**
`CHECK ((actor_kind = 'system') = (actor_user_id IS NULL))`. L'équivalence
interdit les deux incohérences : un « système » attribué à quelqu'un, et un
acteur humain anonyme dont on ne saura jamais qui il était. Le service refuse en
plus une transition système sans `reason` : une décision automatique muette est
indéfendable trois mois plus tard.

**Une ligne par entité touchée, jamais une ligne pour un lot.**
La révocation en masse déclenchée par un rejeu utilise `RETURNING` pour
journaliser chaque jeton coupé séparément. « Des jetons ont été révoqués » n'est
pas une trace exploitable.

**Un compte inscrit n'est plus supprimable.**
Sa ligne de journal d'inscription le retient, par la clé étrangère `RESTRICT`
posée à la tâche précédente. Ce n'est pas une régression : c'est la politique
d'anonymisation qui devient effective dès la première écriture du journal. Un
test le vérifie explicitement.

**Seules les transitions existantes sont câblées.**
Comptes et jetons. Les états de réservation et de contrepartie arriveront avec
leurs phases, avec les entrées correspondantes dans `AuditedEntity`.

**Une erreur de configuration nomme les champs, jamais les valeurs.**
`get_settings` enveloppe la `ValidationError` de pydantic-settings dans une
`ConfigurationError` qui ne cite que `loc` et `type` — ni `input`, qui porte la
valeur reçue, ni `msg`, qui peut la citer selon le validateur. Le `raise ... from
None` est le cœur du masquage : sans lui l'exception d'origine reste chaînée et
son affichage recrache le dictionnaire d'entrée en entier. Un test vérifie
l'absence de la clé et de l'URL dans la trace formatée complète, pas seulement
dans le message.

---

## 2026-08-05 — Phase 1, internationalisation

**L'API renvoie des codes, l'application traduit.**
Aucun texte destiné à l'affichage ne sort du backend. Une API qui renvoie des
phrases localisées oblige à redéployer le serveur pour corriger une virgule, et
impose de connaître la langue de l'appelant à chaque endpoint. `ErrorCode` dans
`api/app/core/errors.py` est la source de vérité, et `api_error()` en est la
seule fabrique — le type du paramètre interdit qu'un code hors catalogue parte
vers l'app.

**Trois garde-fous contre la dérive entre backend et app.**
Un test d'analyse statique refuse tout `detail="..."` littéral absent de
`ErrorCode`. Un test côté app lit `errors.py` directement — plutôt que d'en
recopier la liste, ce qui dériverait — et vérifie que chaque code a son message.
Et le type `Catalogue` fait échouer la compilation TypeScript si une clé manque
en espagnol. Vérifié en retirant une clé : la compilation et le test tombent
tous les deux.

**Un catalogue serveur malgré tout, pour ce qui ne passe pas par l'app.**
`api/app/locales/*.json`, lu avec la locale de `app_user.locale` — celle du
destinataire, jamais celle de l'appelant. Un seul message aujourd'hui, la
structure existe pour les emails transactionnels de la phase 7.

**Le 422 ne renvoie plus la valeur rejetée.**
Découvert en écrivant le catalogue : la réponse de validation par défaut de
FastAPI contient `input`, c'est-à-dire la valeur refusée. Un mot de passe trop
court repartait tel quel vers l'appelant. Le gestionnaire ne conserve que le
chemin du champ et la nature du défaut, même discipline que pour les erreurs de
configuration, et normalise le corps sur le code `validation_failed`.

**La locale décide du format, le commerce décide de la devise.**
`formatMoney(centimes, devise, locale)` prend la devise en paramètre
obligatoire. La déduire de la langue afficherait des euros à un créateur
hispanophone de Miami. Même logique sur les fuseaux : `timeZone` est obligatoire,
c'est celui du commerce.

**Le harnais de test de l'app étend le preset au lieu de le remplacer.**
`jest-expo` définit deux `setupFiles` indispensables. Les déclarer dans
`package.json` les remplace au lieu de s'y ajouter et casse l'environnement en
silence — les tests continuent de passer. La configuration vit donc dans
`jest.config.js`, qui étale le preset explicitement.

**`EXPO_PUBLIC_*` est inliné à la compilation.**
Ces variables n'existent pas hors bundler, donc pas sous jest. L'URL de l'API est
une propriété de composant avec l'environnement pour valeur par défaut, ce qui la
rend injectable en test sans contourner le bundler.

**Bruit `act(...)` dans les tests de l'app : connu, laissé tel quel.**
Les tests de rendu émettent des `console.error` « The current testing
environment is not configured to support act(...) ». Appariement de versions en
amont entre `@testing-library/react-native` 14 et React 19 ; le bon moteur de
rendu (`test-renderer`) est bien installé, le drapeau `IS_REACT_ACT_ENVIRONMENT`
est bien posé, et une garde de démontage a été ajoutée — sans effet. Aucun
impact sur le déterminisme : les 24 tests passent. `console.error` n'est
volontairement pas muselé, ça masquerait de vraies erreurs. À revoir quand la
bibliothèque rattrape React 19, pas avant.

---

## 2026-08-05 — Phase 1, anonymisation de compte

**Effacement sur place, jamais suppression.**
Ce qui identifie disparaît, ce qui engage reste. Réservations, contreparties,
preuves, événements de fiabilité et lignes de journal restent intacts et
toujours rattachés : un commerce ne perd pas son historique parce qu'un créateur
exerce un droit. Les `RESTRICT` posés à la tâche du modèle rendaient déjà la
suppression impossible ; cette procédure est ce qui rend l'effacement possible
malgré eux.

**L'acteur est toujours quelqu'un, jamais le système.**
Le créateur qui exerce son droit, ou l'administrateur qui le fait pour lui. La
fonction refuse `ActorKind.SYSTEM` : une anonymisation n'arrive pas toute seule,
et le journal doit pouvoir dire qui l'a demandée.

**`external_id` et `handle` sont des données personnelles, pas des clés.**
Un handle Instagram nomme quelqu'un. Ils sont effacés avec les jetons, le compte
social passe en `revoked`, et la ligne reste comme coquille porteuse de la
référence des réservations passées. Postgres acceptant plusieurs `NULL` dans un
index unique, plusieurs comptes anonymisés cohabitent sur la même plateforme —
vérifié par un test, c'est la propriété qui rend tout le mécanisme viable.

Deux CHECK encadrent la nullabilité ainsi ouverte : les deux identifiants
s'effacent ensemble (`identity_erased_together`), et un compte encore utilisable
garde forcément son identité (`identity_unless_revoked`).

**Un trigger gèle le compte anonymisé.**
Une anonymisation qu'un simple `UPDATE` peut défaire n'en est pas une. Le
trigger refuse les deux façons de la défaire : remettre le compte en service, et
y réinjecter email, téléphone ou empreinte. C'est pour ça que la mise à jour de
`app_user` est la dernière opération de la procédure.

**Idempotente par retour anticipé.**
Rejouée sur un compte déjà anonymisé, elle ne fait rien, n'écrit aucune seconde
ligne de journal et ne lève pas. C'est ce qui permet de la relancer après un
incident sans savoir jusqu'où la précédente était allée.

**`city` effacée en plus de la liste demandée.**
Le périmètre citait nom, prénom, bio et geo. `city` est une donnée de
localisation personnelle au même titre que `geo` — la laisser en effaçant les
coordonnées n'aurait pas de sens. Écart signalé.

**`revoke_all_for_user` prend désormais son acteur et son motif.**
Une détection de rejeu est une décision du système, une anonymisation est un
droit exercé par quelqu'un. La même opération technique, deux acteurs
différents : c'est à l'appelant de le dire, pas à la fonction de le supposer.

---

## 2026-08-05 — Phase 2, profil commerce

**Le géocodage est une interface avant d'être un service.**
Une seule opération, adresse vers coordonnées. `ManualGeocoder` ne résout rien :
il rend les coordonnées telles qu'on les lui donne. Aucun appel réseau, aucune
clé, aucune dépendance ajoutée. La phase 2 existe donc sans attendre le choix
d'un fournisseur, et la règle « un commerce n'est actif que géocodé » reste
vraie sans dépendre de personne. L'implémentation réelle arrive en phase 5,
quand le fil géolocalisé en a besoin, et remplacera `ManualGeocoder` sans que le
service de commerce change d'une ligne.

Le manque était réel, pas une erreur de rédaction : la phase 0 listait les
dépendances externes connues à l'écriture, et celle-ci n'était apparue nulle
part. Elle y figure désormais, avec la même nature que les autres — compte, clé,
coût à l'appel.

**Le créateur devient `owner` dans la même transaction.**
Un commerce sans membre est un commerce auquel personne ne peut accéder. Les
deux écritures ne sont pas deux étapes dont la seconde pourrait manquer.

**L'activation est une transition explicite, pas un effet de bord.**
Une route dédiée, un passage par le point d'entrée du journal, et un refus qui
nomme la condition manquante — `business_missing_address` ou
`business_missing_coordinates`. « Ça n'a pas marché » n'aide personne à
compléter son inscription.

**Le fuseau est déclaré, jamais déduit.**
Ni des coordonnées, ni de l'adresse. Validé contre la base de fuseaux du
système plutôt que contre une liste recopiée qui prendrait du retard au
prochain changement politique. `tzdata` est ajouté aux dépendances : une image
Docker sans données de fuseau rendrait `available_timezones()` vide, donc toute
validation impossible.

**La devise est immuable, garanti par trigger.**
Le schéma de mise à jour ne la contient pas et refuse les champs inconnus —
l'envoyer donne un 422 plutôt qu'un succès silencieux. Mais un schéma protège
une route, pas une table : un trigger refuse tout changement de `currency` en
base. Tous les montants du commerce, prix de catalogue comme
`value_cents_snapshot` figés sur des réservations passées, sont libellés dans
cette devise sans la porter eux-mêmes. La changer ne convertirait rien, elle
réinterpréterait l'historique.

**`/business/...` pour le commerçant, `/businesses/...` réservé à la découverte.**
Les deux n'auront pas les mêmes règles d'accès en phase 5. Les séparer
maintenant évite d'avoir à démêler un chemin partagé plus tard.

**`current_business` plutôt qu'un `assert` dans le routeur.**
L'appartenance prouve l'existence du commerce par clé étrangère, mais un
`assert` disparaîtrait sous `python -O` et transformerait l'impossible en 500.
La dépendance le charge et répond 403 dans le cas qui ne devrait pas arriver.

---

## 2026-08-05 — Phase 2, catalogue en saisie manuelle

**Ce qu'une réservation fige, et ce qu'elle laisse libre.**
Le prix reste modifiable sans aucune vérification : `value_cents_snapshot` fige
la valeur au moment de la réservation, c'est précisément à ça qu'il sert. La
nature et la durée, elles, ne bougent plus — rien ne les fige côté réservation,
et les changer sous des réservations à venir décalerait la capacité sans que
personne ne l'ait décidé. Même code d'erreur pour les deux, dont le message dit
de créer un nouvel item.

**Une contrainte brute n'atteint jamais l'appelant.**
Le service vérifie avant d'écrire, et rattrape la violation si elle survient
quand même. Une violation de clé étrangère ne dit pas quoi faire ; un code de
catalogue, si. Les tests vérifient explicitement que ni « violates » ni
« constraint » n'apparaissent dans une réponse.

**Trois invariantes que seul le service tient.** *(voir le point suivant)*
Un parent n'est jamais réservable, il n'y a pas de variante de variante, et la
durée d'un item réservé ne change plus. Aucune n'est portée par le schéma. Elles
sont donc contournables par tout chemin d'écriture qui n'emprunte pas le
service — un script d'import, une correction manuelle en base, un futur job.

**La cohérence durée / réservabilité se vérifie sur l'état résultant.**
Découvert par un test en échec : un `CHECK` existait en base et remontait en 500.
Un schéma ne peut pas trancher, parce qu'une mise à jour partielle qui ne change
que `requires_booking` produit un état incohérent sans qu'aucun champ envoyé ne
soit invalide. Seul le service connaît l'état après fusion — d'où
`catalog_duration_mismatch`, et le `CHECK` qui redevient un filet.

**Disponibilité calculée, jamais recopiée.**
Un parent désactivé rend ses variantes indisponibles en lecture, sans que leur
propre interrupteur ne bouge. Le lu expose les deux : `is_available`, celui que
le commerce manipule, et `is_effectively_available`, calculé. Une valeur
dupliquée est une valeur qui divergera, il suffit d'un chemin d'écriture qui
oublie de la propager.

**404 sur un item d'un autre commerce, et non 403.**
Différent du profil commerce, où le 404 aurait révélé quels identifiants
existent. Ici l'appelant a déjà prouvé son appartenance au commerce du chemin,
et la réponse ne parle que de son propre catalogue : elle ne dit rien d'ailleurs.

**`parent_item_id` n'est pas modifiable.**
Reparenter un item changerait son niveau ou son commerce, alors qu'il reste
réservé sous son ancien parent dans les réservations passées. Créer un nouvel
item est la bonne réponse, comme pour la nature et la durée.

**Un `refresh` après mise à jour.**
`updated_at` a un `onupdate` côté serveur : l'attribut est expiré après l'UPDATE,
et le relire déclencherait une IO implicite — interdite en SQLAlchemy async, elle
lève `MissingGreenlet`. Le service rafraîchit avant de rendre l'objet.

**Deux invariants de forme passent du service à la base.**
Un parent n'est jamais réservable, et il n'y a pas de variante de variante. Les
deux demandent de regarder les lignes voisines, ce qu'un `CHECK` ne peut pas
faire : d'où un trigger. Motif du déplacement : le premier import en masse de la
phase 9 écrira des items sans passer par le service, et c'est précisément le
moment où personne ne relira.

Le trigger borne sa recherche du parent au même commerce. Sans ce filtre il
répondait à la place de `fk_catalog_item_parent_business` sur un parent
d'ailleurs, avec un message qui n'était pas le bon. Et il teste la profondeur
avant la réservabilité : sur une variante réservable les deux règles
s'appliquent, la profondeur est le diagnostic utile.

Les tests écrivent en SQL direct, sans le service. Un trigger vérifié au travers
du code qu'il double ne prouve rien.

**DÉCISION DIFFÉRÉE — durée d'un item déjà réservé.**
*Prise le 2026-08-05. Réexamen : à la première tâche de la phase 5 qui écrit
dans `booking`, soit « Création de réservation avec verrou et garde de dix
minutes ».*

Aujourd'hui, seul le service empêche de modifier `duration_minutes` sur un item
qui a des réservations. Contrairement à `requires_booking`, qui appartient à
`fk_booking_item_business_requires_booking` et que la base refuse donc
elle-même, `duration_minutes` n'apparaît dans aucune contrainte référentielle.

La fermeture possible : étendre l'unique de `catalog_item` et la clé étrangère
de `booking` à `duration_minutes`. Postgres n'applique pas une clé étrangère
composite dont une colonne est nulle, donc les items non réservables — durée
nulle — ne seraient pas concernés, et ce sont exactement ceux qui n'ont pas de
durée à protéger. Coût : `booking` porterait la durée réservée.

Différée parce qu'elle change `booking`, et qu'on ne veut pas migrer cette table
deux fois.

---

## 2026-08-05 — Phase 2, capacité et disponibilité temps réel

**Les horaires sont des heures locales, pas des instants.**
Saisis et stockés tels quels, sans conversion. Une ouverture à neuf heures reste
neuf heures après un changement d'heure. La conversion vers le fuseau du
commerce n'a lieu qu'au calcul de disponibilité, en phase 5.

**Lundi vaut 0.** `SPEC.md` dit « 0-6 » sans préciser l'origine, et Postgres
compte dimanche à 0 là où Python compte lundi. Le choix suit `date.weekday()`,
et il est écrit dans le schéma plutôt que déduit à la lecture.

**Deux plages qui se touchent ne se chevauchent pas.**
Un commerce qui ferme à midi et rouvre à midi reste cohérent. Le recouvrement
est strict des deux côtés.

**`is_closed` est déduit, jamais saisi.**
Une exception sans horaires est une fermeture ; une fermeture n'a pas
d'horaires. Les deux façons de le dire ne peuvent pas diverger, et deux `CHECK`
le garantissent en base. Conséquence à connaître : ajuster le seul nombre de
postes d'une journée suppose d'en redonner les horaires — l'exception remplace
la règle du jour, elle ne s'y ajoute pas.

**La disponibilité a sa propre route.**
`PUT .../availability` plutôt qu'un champ de la mise à jour générale, d'où
`is_available` a été retiré. C'est une transition d'état : elle laisse une trace
au journal, et deux chemins pour la même transition finiraient par diverger sur
ce point précis. Rebasculer sur la même valeur n'écrit rien — une transition qui
n'en est pas une ne laisse pas de trace.

**Modifier la capacité ne touche aucune réservation.**
Ni déplacement, ni annulation. Ce que le commerce doit voir quand une
réservation tombe hors de ses nouveaux horaires se décidera en phase 5, quand la
disponibilité existera vraiment.

**Le non-chevauchement tient dans le service, et la base pourrait le porter.**
Vérifié sur une base sonde plutôt que supposé : `btree_gist` est disponible
en 1.7, un type `timerange` sur `time` se crée en une ligne, et une contrainte
`EXCLUDE USING gist (business_id WITH =, weekday WITH =, timerange(start_time,
end_time) WITH &&)` refuse exactement les recouvrements visés en laissant passer
les plages accolées. Cinq lignes de migration. Non posée dans cette tâche, elle
n'était pas demandée.

---

## 2026-08-05 — Phase 2, non-chevauchement en base et jeu de données de départ

**Le non-chevauchement passe en base, sans quitter le service.**
Contrainte d'exclusion `ex_capacity_rule_no_overlap`, via `btree_gist` et un type
`timerange` créé pour l'occasion — Postgres n'en a pas sur `time` en standard.
`&&` est strict aux bornes : deux plages accolées passent, ce qui est
exactement la sémantique du service et le cas d'usage même de la coupure du
midi. Le service continue de vérifier et de renvoyer `capacity_rule_overlap` : la
contrainte est le filet, pas le message.

`btree_gist` rejoint `postgis` sur la liste des extensions qui demanderont un
rôle privilégié sur du Postgres managé, et que le `downgrade` ne supprime pas —
une extension peut être partagée avec d'autres schémas de la même base. Le type
`timerange`, lui, est à nous : le `downgrade` le supprime.

**`ex_` rejoint les préfixes de nommage.** SQLAlchemy ne modélise pas les
contraintes d'exclusion, elles sont donc nommées à la main dans leur migration,
et le test de convention les accepte désormais.

**`SPEC.md` dit maintenant que 0 vaut lundi.** L'ambiguïté était réelle : Python
compte lundi à 0, Postgres dimanche à 0.

**Le jeu de données passe par les services, pas par des insertions directes.**
Il produit donc exactement ce que l'API aurait produit, lignes de journal
comprises — six transitions de commerce, sept de compte — et il éprouve les
règles dans les deux couches. Une insertion directe aurait fabriqué des données
qu'aucun parcours réel ne peut atteindre.

**Elle repart d'une base propre plutôt que de tenter une mise à jour.**
`downgrade base` puis `upgrade head`, puis écriture. C'est ce qui la rend
rejouable sans avoir à raisonner sur ce qu'une exécution précédente avait
laissé. Elle refuse de tourner hors des environnements jetables : elle efface
avant d'écrire.

**Aucune donnée de test dans une migration.** Une migration décrit un schéma,
pas son contenu. La commande est séparée et n'est jamais lancée automatiquement.

**Les trois commerces diffèrent sur ce qui comptera en phase 5.** Variantes et
journées coupées à midi pour le premier, items sans réservation pour le
deuxième, cinq postes en parallèle avec fermeture et journée aménagée pour le
troisième. Un jeu uniforme ne révélerait rien.

---

## 2026-08-05 — Phase 3, paliers de référence et administration

**Les paliers entrent par migration, pas par la commande de jeu de données.**
Ce sont des données de référence : elles doivent exister en production, où la
commande de jeu de données ne tourne jamais. Sept paliers — story, post, reel
sur Instagram et TikTok, story seule sur Snapchat, ce format n'existant pas
ailleurs chez eux.

Les identifiants sont **fixés en dur** plutôt que générés à l'exécution :
développement, CI, préproduction et production portent les mêmes, ce qui rend un
`tier_id` lisible d'un environnement à l'autre. Un test le verrouille.

Snapchat est posé mais `is_active` faux : l'accès partenaire n'est pas obtenu, et
la bascule ne demandera qu'un changement de drapeau, pas une migration.

Les seuils sont **provisoires et restent à valider**. Ils sont modifiables par
l'interface d'administration sans redéploiement, conformément à la règle de
configuration ; ils ne sont dans la migration que comme point de départ.

**`platform` et `content_format` ne se modifient pas.**
Ce couple identifie le palier. Le changer ferait qu'une offre composée pour
« story Instagram » se retrouverait sur « reel TikTok » sans que le commerce ait
rien demandé. Absents du schéma de mise à jour, qui refuse les champs inconnus.

**Un palier référencé se désactive, il ne se supprime pas.**
Vérification dans le service, interception de la violation en filet, code
`tier_in_use`. La désactivation ne touche aucune offre : elles restent en base
et cessent simplement d'être proposées. Rien n'est supprimé en cascade.

**Seule la bascule d'activité est journalisée.**
Un changement de seuil n'est pas une transition d'état : le journal, dont la
forme est `from_status` vers `to_status`, ne sait pas le décrire. C'est un manque
assumé et non un oubli — un administrateur qui abaisse un seuil global pose un
acte de portée produit, et il ne laisse aujourd'hui aucune trace. Le corriger
demanderait une autre forme d'enregistrement, à décider si le besoin se
confirme.

**Aucun effet rétroactif : constaté, pas ajouté.** *(voir la réponse détaillée
dans le rapport de tâche)* Un seuil ne s'applique qu'à l'entrée. `collaboration`
fige `required_format`, `required_mention`, `required_geotag` et `deadline_at` ;
`booking` fige `value_cents_snapshot`. Rien en aval ne relit le palier. Deux
tests le démontrent plutôt que de l'affirmer.

---

## 2026-08-05 — Phase 3, composition des offres par palier

**Un item à plusieurs paliers n'est pas un doublon.**
L'unicité porte sur le triplet commerce, palier, item. Un créateur éligible à
deux paliers verra donc le même item deux fois, et c'est au fil de la phase 5 de
présenter le meilleur palier accessible. Rien ici ne l'empêche, et le jeu de
données de départ pose délibérément le cas.

**Refus à la création sur un palier inactif, tolérance après coup.**
On ne compose pas sur un palier fermé, mais fermer un palier ensuite laisse les
offres en place. Ce sont deux règles différentes et elles ne se contredisent
pas : la première protège une saisie, la seconde protège un historique.

**« Effectivement proposée » se calcule à partir de trois interrupteurs.**
Celui de l'offre, celui du palier, celui de l'item corrigé par son parent. Aucun
n'est recopié sur l'offre — trois valeurs dupliquées, ce seraient trois façons
de diverger. Une offre dont le palier ou l'item est désactivé reste en base et
cesse simplement d'être proposée.

**`add()` doit être à l'intérieur du `begin_nested()`.**
Découvert par un test en échec, et corrigé dans trois services. `begin_nested()`
vide les objets en attente **avant** d'ouvrir le point de sauvegarde : un `add()`
placé au-dessus voit son `INSERT` partir hors de la protection du savepoint, et
la violation laisse la session inutilisable au lieu d'être rattrapée. Le symptôme
n'est pas l'erreur attendue mais un `PendingRollbackError` opaque, plus loin.

**La remise à zéro du jeu de données ne passe plus par `downgrade base`.**
Découvert au même moment. Le retour de la migration des paliers de référence
refuse d'effacer un palier encore référencé par une offre — protection légitime,
mais qui bloquait une remise à zéro alors que les tables allaient de toute façon
disparaître. La commande vide désormais `public` de tout ce qui n'appartient pas
à une extension, puis applique les migrations. On ne demande pas à des migrations
de défaire des données qu'on veut jeter.

**Deux règles que le service tient seul.**
Un parent ne se place pas dans une offre, et une offre ne se crée pas sur un
palier inactif. Voir le rapport de tâche pour ce que la base pourrait porter.

**Le palier inactif reste au service, et c'est un choix, pas un renoncement.**
Un `BEFORE INSERT` sur `tier_offer` porterait bien le refus de composer sur un
palier fermé. Mais il ne peut pas s'étendre à l'`UPDATE`, puisque désactiver un
palier ensuite doit justement laisser les offres en place. La base garantirait
donc la moitié de la règle.

Une demi-garantie en base est pire qu'aucune : on cesse de vérifier ailleurs
parce qu'« on a la contrainte », et le trou restant devient d'autant plus
invisible qu'on croit la règle tenue. La règle vit donc entièrement dans le
service, où elle est visible et complète.

**Un parent ne se place pas dans une offre : passé en base.**
Deux triggers, une fonction, parce que la règle a deux sens — offrir un item qui
a des variantes, et donner une variante à un item déjà offert. Sans le second,
elle se contourne en inversant l'ordre des opérations. Testé en SQL direct, les
deux sens et les cas légitimes.

**Un test de refus ne s'arrête pas au code d'erreur.**
Règle ajoutée à `CLAUDE.md`. La classe de défaut qu'elle vise : le refus renvoie
le bon code, mais laisse la session inutilisable ; la requête fautive passe le
test, et c'est la suivante qui tombe, ailleurs, sous une erreur qui ne dit rien.

La fixture de connexion vérifie désormais en sortie que la connexion répond
encore — garde-fou universel, impossible à oublier — et les tests de refus dont
le chemin exécute du SQL enchaînent explicitement une opération qui doit réussir.

**Correction d'un diagnostic trop large.** J'avais annoncé le défaut du
`begin_nested` dans trois services. Vérification faite en le réintroduisant : il
n'est reproductible que dans celui des offres, où la session avait déjà validé
une écriture sur la même connexion. Les deux autres ont été alignés par
cohérence, pas parce qu'ils étaient cassés.

---

## 2026-08-05 — Phase 3, fonction d'éligibilité

**L'unité est le couple (compte social, palier), jamais le créateur seul.**
`SPEC.md` §3.1 le pose, et la structure des tables l'impose : les abonnés sont
une propriété du compte, et `booking.social_account_id` fige celui sur lequel la
contrepartie sera publiée. Une réservation engage un compte, l'éligibilité se
prononce donc sur un compte. Deux comptes de la même plateforme peuvent différer,
et c'est le créateur qui choisit avec lequel il réserve.

À noter parce que ce n'est pas évident : les conditions d'un palier mélangent
deux niveaux. Les abonnés viennent du compte, le nombre de collaborations et le
score viennent du créateur. Un score dégradé plafonne donc tous ses comptes.

**Le refus est expliqué, et tous les obstacles sont renvoyés.**
Pas le premier. Un créateur à qui l'on dit « pas assez d'abonnés », qui en gagne,
et à qui l'on dit ensuite « pas assez de collaborations », a été mal traité deux
fois. Chaque raison correspond à une action différente : c'est le critère qui
décide s'il faut une raison de plus ou non.

**Deux situations ne sont pas des refus et ne sont pas renvoyées.**
Une autre plateforme est hors de portée. Un palier inactif n'existe pas du point
de vue du créateur — le lui montrer lui apprendrait une décision interne qui ne
le concerne pas.

**Fraîcheur : sept jours, valeur unique, en configuration.**
Ajoutée à `SPEC.md` §9, qui ne la prévoyait pas. Pas de réglage par plateforme :
le job de rafraîchissement est le même partout, et une différence qu'on ne
saurait pas justifier est un réglage de trop. Trois situations voisines, trois
raisons distinctes — aucun relevé, relevé périmé, jeton invalide — parce que dire
de grandir à quelqu'un dont le jeton a expiré est un contresens.

**`verification_status` bloque à deux endroits, et l'ordre compte.**
L'inéligibilité d'abord, parce que le fil interroge cette fonction et que
`SPEC.md` §3.3 interdit d'afficher ce qui n'est pas réservable. Le refus à la
réservation ensuite, pour que la garantie ne dépende pas du fil. S'il ne fallait
en garder qu'un, ce serait l'inéligibilité : elle sert le créateur, l'autre ne
sert que nous. Le second niveau arrive avec la création de réservation, phase 5.

**Le cold start est verrouillé par une paire de tests, pas par une intention.**
Un score nul face à un palier exigeant 60 doit passer ; un score de 0,00 face au
même palier doit échouer. Tant que ces deux-là passent ensemble, aucun
`score or 0` n'a pu se glisser. Le premier est en outre paramétré sur tous les
paliers de référence, donc ajouter un palier n'y échappe pas.

La forme du code y contribue : `evaluer_score` traite les deux cas nuls dans des
branches nommées séparément — le palier n'exige rien, le créateur n'a pas
d'historique — avant toute comparaison. Deux nuls de nature différente, même
issue, jamais le même nom.

**Trois requêtes, quel que soit le nombre de comptes.**
`DISTINCT ON (social_account_id)` fait tenir les derniers relevés en une seule
requête. Le test du compteur tourne sur un compte **et** sur trois pour le même
total : la propriété tenue est l'indépendance, un seul cas ne la démontrerait
pas.

**Aucune fonction ne prend une offre, et c'est structurel.**
La fonction rend un ensemble de couples accessibles ; qui veut savoir pour une
offre interroge cet ensemble. Une fonction qu'on peut appeler dans une boucle
finira dans une boucle. Un test vérifie qu'aucun symbole exposé ne parle d'offre.

**Rien en cache, délibérément.** Le résultat dépend de l'âge des relevés, donc du
moment : le mettre en cache ressusciterait exactement les chiffres périmés que la
fraîcheur écarte. Les paliers non plus — un décalage entre une bascule
d'administrateur et le fil coûterait plus que les sept lignes économisées.

**Seuils de collaborations neutralisés, et la leçon du jeu de données.**
`completed_collabs_count` n'est alimenté par aucun code — les événements de
fiabilité sont la phase 8. Les paliers exigeant une ou deux collaborations
étaient donc inatteignables : personne n'aurait jamais dépassé `story`, et le
blocage n'aurait rien eu à voir avec le mérite du créateur. Les seuils passent à
zéro par migration. La condition existe toujours dans le moteur d'éligibilité,
elle est simplement satisfaite par tout le monde tant que rien ne la mesure, et
se rallume d'un changement de configuration. Tâche de rétablissement inscrite en
phase 8.

**La leçon vaut plus que la correction : le jeu de données de départ masquait le
défaut** en posant `completed_collabs_count` et `reliability_score` à la main.
Il produisait des créateurs avec sept collaborations là où aucun mécanisme
n'était capable d'en compter une seule. Une donnée de test qui court-circuite un
mécanisme empêche de voir que le mécanisme n'existe pas — et le jeu est
précisément ce sur quoi on s'appuie pour croire que le système fonctionne.

---

## 2026-08-06 — Phase 4, connexion OAuth Instagram

**Le chiffrement est porté par le type de colonne, pas par le service.**
`EncryptedText` chiffre au `bind` et déchiffre au `result`. C'est la différence
entre « on chiffre les jetons » et « on ne peut pas écrire un jeton en clair » :
le second se tient sans discipline, et tout nouveau chemin d'écriture en hérite
gratuitement. Le `bytea` sous-jacent n'a pas changé, la migration ne voit donc
aucune dérive.

**Chaque valeur chiffrée porte l'identifiant de sa clé.**
Sans lui, changer de clé imposerait de tout redéchiffrer d'un coup — transaction
géante et fenêtre d'indisponibilité. Avec lui, on ajoute une clé, on la rend
active, et les anciennes valeurs restent lisibles pendant qu'un travail de fond
les réécrit à son rythme. `TOKEN_ENCRYPTION_PREVIOUS_KEYS` garde les clés
retirées de l'écriture mais encore nécessaires à la lecture.

AES-GCM, nonce tiré à chaque chiffrement : deux jetons identiques ne se
reconnaissent pas en base. Pas de données associées — au moment de chiffrer un
`INSERT`, la ligne n'a pas encore d'identifiant à lier.

**L'état OAuth est signé *et* à usage unique, et il faut les deux.**
Le jeton signé écarte les états fabriqués sans toucher la base. La ligne
`oauth_state` les rend consommables une seule fois. Le jeton seul resterait
rejouable jusqu'à son expiration : quiconque intercepterait l'état d'un créateur
pourrait finir le parcours avec son propre compte Instagram, et le rattacher au
compte BIND de ce créateur.

Les cinq refus — inconnu, mauvaise plateforme, autre utilisateur, déjà consommé,
expiré — partagent un seul code d'erreur. Distinguer « inconnu » de « déjà
utilisé » renseignerait qui tâtonne.

**Le retour du fournisseur n'est pas authentifié, et c'est structurel.**
Meta exige une URI de redirection HTTPS enregistrée : c'est une redirection de
navigateur, sans en-tête d'autorisation. L'état est donc la seule chose qui dit
de qui il s'agit — d'où son traitement. La route est hors du préfixe `/me`, qui
signifie « authentifié » partout ailleurs.

**Reconnecter met à jour, ne duplique pas, et n'est pas un conflit.**
C'est le geste normal quand un jeton a expiré. Reprendre un compte lié à un autre
créateur est refusé avec un code explicite : l'unicité `(platform, external_id)`
l'interdirait de toute façon, mais une violation brute ne dirait pas pourquoi.

**Un compte arrive en `needs_review`.** La vérification de cohérence du profil
est une tâche à part ; d'ici là le compte est rattaché mais ne réserve rien, et
le moteur d'éligibilité le dit avec sa propre raison.

**L'identité n'est pas de la métrique.** Lire `id` et `username` est le minimum
sans lequel il n'y a rien à enregistrer. Les abonnés et les vues sont la tâche
suivante, et le jeton de longue durée obtenu ici est ce qu'elle utilisera.

**Trouvé en route : l'inscription d'un créateur ne créait pas son profil.**
`social_account.creator_id` et `booking.creator_id` référencent
`creator_profile.user_id`, pas `app_user.id`. Un créateur inscrit ne pouvait donc
rattacher aucun compte social — et le moteur d'éligibilité, qui renvoie un
ensemble vide quand le profil manque, le déclarait inéligible à tout sans que
rien ne le signale. `register` crée désormais la ligne. Le jeu de données, qui
l'insérait lui-même, la complète maintenant.

---

## 2026-08-05 — Récupération et historisation des métriques

**Les snapshots sont en ajout seul.** Jamais de mise à jour, jamais de
suppression. Deux relevés successifs font deux lignes même à chiffres
identiques : « rien n'a bougé entre lundi et mardi » est une information, et
écraser la ligne de lundi la détruirait. C'est aussi ce qui rend l'éligibilité
explicable — un créateur dont l'accès change doit pouvoir voir sur quoi elle
s'est appuyée.

Conséquence relevée en route : `captured_at` prenait `now()`, qui en Postgres
est l'heure d'**ouverture de la transaction**. Deux relevés enregistrés sans
validation intermédiaire portaient donc la même heure, et « le dernier
snapshot » — la seule question que pose l'éligibilité — n'avait pas de réponse
déterminée. Passé à `clock_timestamp()`, par migration. Même correction que pour
`audit_log.occurred_at`, et pour la même raison : une table en ajout seul n'a
que son ordre pour structure.

**Un relevé qui échoue n'écrit rien.** Ni ligne partielle, ni zéro. Un zéro
écrit est un zéro qui sera lu comme une mesure, et l'éligibilité le comparera au
seuil sans savoir qu'il est faux. Un snapshot faux est pire qu'un snapshot
absent : l'absence a une raison de refus qui lui est propre, `no_metrics`.

**Ce que la table déclare obligatoire doit venir de la plateforme ; ce qu'elle
déclare nullable a le droit de manquer.** C'est la règle qui tranche « réponse
incomplète ». Sans abonnés, pas de snapshot. Sans démographie, snapshot avec
démographie nulle — Meta la refuse aux comptes en dessous de cent abonnés et à
certains types de compte, ce qui est la situation de la majorité des créateurs
au lancement. Faire échouer le relevé pour ça ne mesurerait personne.

**Deux familles d'échec, et c'est le fournisseur qui tranche.** Un refus
d'authentification bascule le compte en `expired` : l'accès est perdu, seule une
reconnexion le rétablira. Une erreur transitoire ne touche à rien. Meta répond
400 dans les deux cas ; seul le corps les sépare — `error.type` valant
`OAuthException`, ou un code 190/102, sous deux formes selon l'hôte. Confondre
les deux ferait déconnecter des comptes sains à la première panne de Meta.

La bascule en `expired` est la seule erreur dont la transaction est **validée**.
L'annuler renverrait bien l'erreur au créateur mais laisserait le compte affiché
comme actif, et le relevé suivant irait redécouvrir la même chose chez Meta.

**`engagement_rate` et `avg_views` restent nuls.** Ils se calculent sur les
publications, pas sur le profil, et n'entrent dans aucune condition
d'éligibilité aujourd'hui. Nul veut dire « pas encore mesuré », jamais « zéro ».

**La fréquence est bornée par compte.** Seuil en configuration
(`METRICS_MIN_REFRESH_INTERVAL_SECONDS`, une heure). Le quota que cela protège
est celui de la plateforme, qui se compte par compte : une limite par créateur
punirait celui qui en a trois, une limite globale ferait qu'un créateur actif
empêche les autres de se relever. Le refus est prononcé **avant** l'appel — une
limite rendue après n'économiserait aucun quota.

*Limite connue :* la borne s'appuie sur `last_synced_at`, qui n'est posé qu'en
cas de succès. Un relevé qui échoue ne consomme donc pas le quota, ce qui est
voulu — le créateur n'a rien obtenu — mais laisse une porte ouverte à une
répétition d'échecs. La refermer demande un compteur de tentatives, qui a sa
place avec le job planifié et sa politique de report.

**Le trousseau de chiffrement se construit au démarrage.** `create_app()`
l'appelle. Une clé absente ou mal formée empêche de lancer, au lieu de laisser
l'API fonctionner à moitié jusqu'au premier rattachement d'un compte social.

---

## 2026-08-05 — Audit du jeu de données de départ

La règle est entrée dans `CLAUDE.md` : *le jeu de données de départ ne pose
jamais à la main une valeur qu'un mécanisme du produit doit produire.* Suit
l'audit de chaque valeur qu'il écrit.

**Ce qui passait déjà par un mécanisme, et continue.** Commerces, appartenance
`owner`, passage en `active` et lignes de journal (`business`) ; items et
variantes (`catalog`) ; plages et exceptions (`capacity`) ; offres par palier
(`tier_offers`) ; comptes et mots de passe (`auth`).

**Corrigé, parce que le mécanisme existe maintenant.**

- *Le compte social* était inséré directement, avec son `external_id`, son
  `handle`, son `status` et son `verification_status`. Il est désormais obtenu
  par le parcours OAuth complet — `start_authorization` puis
  `complete_authorization` — via un fournisseur local qui répond de mémoire au
  lieu de répondre du réseau. L'état reste signé, à usage unique et vérifié ; le
  jeton est chiffré par le type de colonne comme n'importe quel autre.
- *Le premier relevé de métriques* était un `SocialMetricsSnapshot` posé à la
  main. Il vient maintenant de `refresh_profile_metrics`, le service écrit dans
  cette tâche.

**Les trous restants — valeurs qu'aucun mécanisme ne sait produire.** Elles ne
sont plus posées du tout : le jeu de données montre l'état réel du produit.

1. **`social_account.verification_status`** — posé à `verified` pour les
   créateurs « expérimentés ». *C'est le trou le plus coûteux.* Le seul écrivain
   du champ est `complete_authorization`, qui pose `needs_review` ; **rien
   n'existe qui fasse passer un compte en `verified`**. Tout créateur réel est
   donc aujourd'hui bloqué sur `account_under_review` et n'accède à aucun
   palier. Le jeu de données le masquait entièrement. Mécanisme attendu : tâche
   « Vérification de cohérence du profil », phase 4.
2. **`creator_profile.reliability_score`** — posé à 82.5 et 61.0. Aucun
   mécanisme ne l'écrit. Phase 8 (`reliability_event`). Déjà rencontré : c'est
   ce qui a conduit à neutraliser les seuils de collaborations.
3. **`creator_profile.completed_collabs_count`** — posé à 7 et 2. Le compteur
   n'est alimenté par rien. Phase 8, avec la finalisation d'une collaboration.
4. **`creator_profile.first_name` / `last_name`** — posés en dur. Aucune route
   ne permet à un créateur de renseigner son identité ; `PATCH /me` ne traite
   que `locale`. Champs déclaratifs, pas dérivés, mais le constat est le même :
   le produit ne sait pas les obtenir.
5. **`creator_profile.city`** — posé à « Miami ». Même absence de route, et pas
   de dérivation depuis `geo` non plus.

Les points 4 et 5 ne relèvent d'aucune tâche existante : à créer si l'écran de
profil créateur en a besoin.

**Ce qui reste posé à la main et n'est pas un trou.** Les coordonnées des trois
commerces, via `ManualGeocoder`. C'est le contournement décidé en phase 2, avec
son service réel prévu en phase 5 : le mécanisme *est* la saisie manuelle
aujourd'hui.

**Deux tests changent de sens.** L'un affirmait « au moins un créateur a un
historique » et passait parce que le jeu de données le fabriquait : il validait
une fiction. Il affirme maintenant que **tous** les créateurs sont en cold
start, et il échouera quand la phase 8 arrivera — c'est voulu, ce jour-là le jeu
de données doit changer. L'autre est neuf et énonce le trou n° 1 : aucun compte
social du jeu n'est `verified`. La commande le dit aussi à voix haute en fin
d'exécution, parce qu'un trou consigné dans un fichier ne se voit pas.

---

## 2026-08-06 — `clock_timestamp()` partout

Deuxième fois que `now()` mord — après `audit_log.occurred_at` puis
`social_metrics_snapshot.captured_at` — donc revue de toutes les colonnes
plutôt qu'une correction de plus. La règle est entrée dans `CLAUDE.md`.

Quatorze colonnes passent de `now()` à `clock_timestamp()`, dont neuf par le
mixin `CreatedAt` qu'elles partagent. **Deux défauts étaient présents en base**,
tous deux sur des colonnes qu'un service trie :

- les dix `tier_offer` du jeu de données portaient un seul `created_at`, et
  `list_offers` ordonne dessus ;
- les trois `social_account` du jeu portaient un seul `connected_at`, et
  `list_accounts` ordonne dessus.

Dans les deux cas l'ordre rendu à l'application dépendait du plan d'exécution.

`catalog_item.updated_at` avait un troisième défaut, plus discret : une ligne
créée puis modifiée dans la même transaction se retrouvait avec un `updated_at`
antérieur à son `created_at`, l'heure d'ouverture de la transaction étant
forcément avant celle de l'instruction qui a créé la ligne.

Aucune donnée existante n'est réécrite : seule la valeur par défaut change.

---

## 2026-08-06 — Vérification de cohérence du profil

**Le contrôle s'exécute après un relevé de métriques réussi**, et il est appelé
depuis le service de métriques, pas depuis la route. Sans snapshot il n'aurait
rien à regarder ; et un enchaînement posé dans une route ne vaudrait que pour
cette route, alors que le job planifié devra le déclencher aussi.

**Trois issues, et une seule s'obtient sans humain.** `verified` est prononcé
automatiquement, `rejected` ne l'est jamais. Un rejet définitif prononcé par une
heuristique sur un vrai créateur est une perte sèche que personne ne rattrape :
il ne réessaiera pas. Tout ce qui n'est pas net reste en `needs_review` et
remonte dans la file d'administration, qui seule prononce le rejet.

**Chaque signal produit un verdict nommé, pas un score agrégé**, pour la même
raison que les obstacles d'éligibilité : un score dirait « 0,62 » et personne ne
saurait quoi en faire, cinq verdicts nommés disent lequel a bloqué.

**Deux façons distinctes de ne pas se prononcer**, nommées séparément :
`ignore_mecanisme_absent` — le produit ne sait pas encore mesurer ce signal,
c'est un trou chez nous — et `ignore_historique_insuffisant` — le produit sait
le mesurer, ce compte n'a pas encore de quoi, c'est au temps de faire son
travail. Les confondre ferait chercher un bug là où il n'y a que de la patience
à avoir. Même découpage que les deux branches nulles de `VerdictScore`.

**`verified` demande deux conditions, pas une** : aucun signal manqué, **et au
moins un signal jugé**. Sans la seconde, un compte dont rien n'est mesurable
passerait par vacuité — « aucun signal n'a échoué » serait vrai précisément
parce qu'aucun n'a été examiné. C'est le réflexe sur l'ensemble vide : ici le
vide est le symptôme, pas le résultat.

**État des cinq signaux de `SPEC.md` §3.2 aujourd'hui.** Un seul est pleinement
mesurable, et c'est dit plutôt que masqué :

| Signal | État | Ce qui manque |
|---|---|---|
| Ancienneté / première publication | `ignore_mecanisme_absent` | `/me` ne les donne pas ; relevé des publications |
| Volume de publication | **jugé** | — |
| Régularité de publication | jugé dès deux relevés espacés | approximation par différence de compteurs |
| Engagement | `ignore_mecanisme_absent` | `engagement_rate` nul tant que les publications ne sont pas relevées |
| Nom déclaré | `ignore_mecanisme_absent` | tâche « Profil créateur en écriture » |

La régularité est mesurée sur la progression du nombre de publications entre le
premier et le dernier relevé. C'est une approximation assumée — la vraie
régularité se lit sur les dates des publications — mais elle se calcule avec ce
que nous avons, et c'est elle qui donne son sens à la réexécution : un compte
examiné trop tôt n'est pas condamné, il est ajourné.

**La comparaison du nom est écrite avant la route qui l'alimentera**, et
éprouvée directement. Le jour où le profil s'écrit, le signal compte sans qu'une
ligne change. Elle est volontairement permissive — un fragment du nom présent
dans le pseudonyme suffit — parce qu'elle vise l'usurpation grossière et non
l'état civil : la plupart des créateurs ont un pseudonyme de scène, et les faire
tous passer en revue rendrait la file inutilisable. Conséquence acceptée : un
fragment court peut se reconnaître par hasard dans un mot plus long. Le signal
penchant du côté permissif, une reconnaissance de trop coûte moins cher qu'un
vrai créateur envoyé en revue.

**Le contrôle ne descend jamais.** Un compte `verified` garde son statut même si
un relevé ultérieur le ferait échouer ; un compte `rejected` n'est pas relevé
par une réexécution, sans quoi la machine défairait la décision d'un
administrateur. La file d'administration est le seul chemin descendant.

**Les constats partent au journal avec la transition.** Les seuils bougeront ;
sans cette trace, une décision passée deviendrait inexplicable — on relirait la
règle d'aujourd'hui en croyant relire celle qui a tranché.

**Le jeu de données atteint `verified` par le mécanisme.** Les trois créateurs y
arrivent sans intervention, chacun avec sa ligne de journal `needs_review →
verified`, acteur `system`, motif renseigné. Ils accèdent respectivement à 3, 2
et 1 paliers, selon leurs abonnés seuls. Le statut n'est toujours pas posé : il
est obtenu. Le test du jeu de données qui affirmait l'inverse à la tâche
précédente — « aucun créateur n'accède à un palier » — était le bon constat à ce
moment-là, et affirme maintenant le contraire pour la même raison : il décrit ce
que le produit sait faire.

---

## 2026-08-06 — Régularité de publication : un signal qui ne bloque jamais

Restriction ajoutée après coup, et **c'est le genre de restriction qu'on lève
par inadvertance en croyant durcir** : le raisonnement compte donc plus que la
règle.

`media_count` chez Instagram **ne compte pas les stories**. Un créateur qui
publie exclusivement en story a une progression de compteur nulle,
indéfiniment. Or c'est exactement le profil du palier d'entrée — mille abonnés,
format story — donc notre cible la plus nombreuse au lancement.

Si ce signal pouvait manquer, un tel créateur resterait ajourné pour toujours
sans que rien ne le signale : chaque réexécution le recondamnerait au lieu de le
sauver, et la file d'administration se remplirait de vrais créateurs sans que
personne ne comprenne pourquoi. Le mécanisme censé rattraper le temps
travaillerait contre eux.

Une progression nulle veut donc dire « je n'ai rien vu », pas « il n'a rien
fait ». La mesure ne sait pas distinguer les deux : c'est une propriété de la
donnée, pas du créateur.

**Le signal est neutre, ou tenu. Jamais manqué.** Le constat mesuré est quand
même rendu — la file voit la progression — mais il ne retient personne. Le jour
où les publications seront relevées, avec leurs dates et leurs formats, le
signal retrouvera son sens plein et pourra redevenir bloquant. Pas avant.

---

## 2026-08-06 — Travail planifié : ossature, report, concurrence

**Une table de jobs en base, pas de courtier de messages.** Postgres tient déjà
les deux choses qu'un ordonnanceur demande, une transaction et un verrou de
ligne. Un système distinct ajouterait surtout un second endroit où l'état peut
diverger du nôtre. Les traitements des phases 6 et 7 — expiration des `held`,
échéances de collaboration — s'y brancheront sans rien changer à l'ossature.

**Une ligne par travail, pour toujours.** `UNIQUE (job_type, target_id)` : il ne
peut pas exister deux relevés quotidiens du même compte. Un job récurrent n'est
pas consommé quand il réussit, il est reprogrammé — la ligne *est* le travail,
pas son occurrence. C'est ce qui rend la planification idempotente : on peut la
relancer autant qu'on veut.

**Pas d'état « en cours », et c'est délibéré.** Un job réclamé l'est par un
verrou de ligne tenu jusqu'au commit. Une colonne `running` survivrait à la mort
du processus et il faudrait un ramasse-miettes pour distinguer un job vraiment
en cours d'un job orphelin. Le verrou, lui, disparaît tout seul. Contrepartie
assumée : la transaction dure le temps du traitement, donc d'un appel réseau.

**`FOR UPDATE SKIP LOCKED`, et c'est un verrou, pas une convention.** Deux
exécutions concurrentes ne se voient pas attribuer le même job, sans qu'aucune
discipline d'appel soit requise. `SKIP LOCKED` et non `NOWAIT` : la seconde
continue avec les jobs suivants au lieu d'échouer, donc ajouter un processus
ajoute du débit.

Vérifié en retirant `SKIP LOCKED` : le test se **bloque** au lieu d'échouer — la
seconde exécution attend le verrou de la première, qui attend que la seconde ait
fini. Les deux tests de concurrence sont donc bornés par un délai, sans quoi une
régression produirait un blocage en intégration continue, c'est-à-dire un
silence.

**Une transaction par job.** L'échec d'un job n'annule pas le report d'un autre.
Un `commit` global les ferait tomber ensemble, ce qui est exactement ce qu'on ne
veut pas d'une file.

**Report croissant, plafonné, puis arrêt.** Croissant parce qu'une panne d'en
face dure rarement une seconde ; plafonné parce qu'un délai qui double
indéfiniment finit par ne plus jamais réessayer, et un compte se réparerait
après que le créateur a renoncé. Après `JOB_MAX_ATTEMPTS`, le job s'arrête et
devient visible dans la file d'administration, avec sa dernière erreur — un job
qui échoue en silence pour toujours est pire qu'un job qui n'existe pas. Une
route d'administration le réarme : sans elle, s'arrêter reviendrait à
abandonner.

**Trois issues pour un traitement, pas deux.** Réussi, échec passager, ou
*retiré* — le travail n'a plus d'objet. Sans la troisième, un compte dont le
jeton est définitivement refusé serait reporté, réessayé, épuisé, puis
remonterait dans la file comme s'il y avait quelque chose à réparer, alors que
la seule suite possible est une reconnexion par le créateur.

**Renouvellement anticipé, marge de sept jours.** Les jetons Meta durent soixante
jours et ne se renouvellent **que tant qu'ils sont valides** : passé l'échéance
il n'y a plus de renouvellement du tout. La marge n'est donc pas une prudence,
c'est ce qui laisse une seconde chance si Meta est indisponible le jour dit.

**Même distinction d'échecs que pour les métriques.** Un refus
d'authentification bascule le compte en `expired` et retire le job ; une erreur
transitoire ne touche à rien et reporte. Ne jamais déconnecter un compte sain
sur une panne d'en face.

**Un compte `expired` ou `revoked` n'est plus planifié**, ni renouvellement ni
relevé. Marteler une porte fermée n'accumulerait que des échecs qui finiraient
par épuiser des jobs et remplir la file de bruit. Le balayage retire ces jobs, et
les recrée d'eux-mêmes quand le créateur reconnecte : personne n'a à se souvenir
de le faire.

**La borne de fréquence des relevés à la demande est refermée.** Elle se lisait
sur `last_synced_at`, qui ne retient que les succès : un relevé qui échoue ne
consommait rien, donc il suffisait d'échouer pour pouvoir recommencer aussitôt,
en boucle. `last_sync_attempt_at` retient désormais la tentative, posée avant
l'appel, et la route valide cette écriture quelle que soit l'issue. Règle
générale qui en découle : **un appel réellement passé est toujours enregistré**.

**Le déclenchement reste manuel**, deux verbes séparés — `make jobs-plan` aligne
la file et se relance sans conséquence, `make jobs-run` parle au réseau. Les
fondre ferait hésiter à lancer le premier. L'ordonnanceur réel est une affaire
de déploiement.

**Trouvé en lançant la commande pour de vrai.** Le fournisseur refuse d'exister
quand l'application Meta n'est pas déclarée, et cette erreur remontait jusqu'à
la boucle : elle arrêtait le passage au premier compte concerné **et** annulait
sa transaction. Sur un environnement sans clés, la commande ne faisait donc rien
et n'en gardait aucune trace. C'est maintenant un échec reportable comme un
autre — la configuration peut arriver entre deux passages — et le job porte la
raison. Le défaut ne se voyait dans aucun test : tous injectaient un fournisseur
déjà construit.

---

## 2026-08-06 — Profil créateur en écriture

**La ville est déclarée, jamais dérivée de `geo`, et le champ est libre.** Miami
compte assez de quartiers nommés — Wynwood, Brickell, Little Havana, Little
Haiti, Coconut Grove — pour qu'une liste fermée soit fausse dès le premier jour.
Et un créateur qui ne s'y retrouve pas écrit n'importe quoi plutôt que rien, ce
qui est pire qu'un champ libre. `geo` n'est pas alimenté ici : il servira au fil
de la phase 5, et viendra du même contournement manuel que pour les commerces
tant que le géocodage réel n'existe pas.

**Une chaîne vide vaut « pas renseigné ».** Elle est ramenée à `NULL` plutôt que
refusée : effacer un champ en envoyant `""` est un geste naturel. Sans cette
normalisation, un prénom à `""` serait « renseigné » pour la base et vide pour
tout le monde — et le signal du nom, dans la vérification de cohérence, se
croirait jugeable avec rien à comparer.

**Ce qui n'est pas envoyé n'est pas touché ; ce qui est envoyé à `null` est
effacé.** Une mise à jour partielle ne doit pas effacer par omission, mais
retirer sa bio doit rester possible sans écrire un espace.

**Un champ non modifiable est refusé, pas ignoré.** Une charge utile portant
`reliability_score` reçoit un 422. Un champ silencieusement écarté ferait croire
à l'appelant qu'il a été pris en compte.

**Aucun identifiant dans l'URL.** Le titulaire vient du jeton, donc il n'existe
aucune forme de requête permettant de viser le profil d'un autre. La protection
est dans la forme de l'API, pas dans un contrôle qu'on pourrait oublier
d'écrire — et un test vérifie qu'aucune route de profil ne prend d'identifiant.

**L'anonymisation devient irréversible en base, pas seulement en service.**
`app_user` avait son trigger ; `creator_profile` n'en avait aucun, ses champs
personnels étaient simplement mis à `NULL` et rien n'empêchait de les remplir à
nouveau. Cela n'avait pas d'occasion de se produire tant qu'aucune route
n'écrivait ces champs — cette tâche en crée une. Le trigger refuse de repasser
un champ personnel effacé à une valeur non nulle, et refuse de retirer
`anonymized_at`. Il laisse `reliability_score` et `completed_collabs_count`
modifiables : ce sont des faits sur des collaborations qui ont eu lieu, et ils
doivent pouvoir être recalculés.

**Le test d'anonymisation compare, il n'énumère pas.** Il dérive les colonnes
personnelles de `CreatorProfile.__table__`, moins une courte liste de colonnes
explicitement non personnelles, chacune avec sa raison. Ajouter un champ
personnel au profil sans l'ajouter à l'effacement fait tomber le test — au
moment précis où personne ne pensera à le vérifier. Une liste recopiée à côté de
celle du service aurait le défaut inverse : elle serait toujours d'accord avec
ce qu'on vient d'écrire.

Le test exige aussi que **toutes** les colonnes personnelles soient renseignées
avant l'anonymisation, sinon leur effacement ne prouverait rien. Cette assertion
a immédiatement rapporté un trou dans le jeu de départ du test : `geo` n'était
pas posé, donc son effacement portait sur une colonne déjà nulle.

**Le signal du nom cesse d'être neutre, sans qu'une ligne change dans la
vérification.** La comparaison avait été écrite avant la route qui l'alimente,
et elle compte à partir d'aujourd'hui. Sa permissivité est inchangée. Un compte
en `needs_review` gagne un signal jugé de plus à sa prochaine réexécution ; un
compte déjà `verified` n'est pas redescendu par un nom devenu comparable — le
contrôle ne descend jamais.

**Renseigner son nom ne déclenche aucune réexécution.** Le contrôle reste
accroché au relevé de métriques, et à lui seul : sans cela, une frappe dans un
champ de formulaire appellerait Meta.

**Prénom et nom obligatoires avant la première réservation : rien ne le
garantit, et rien ne peut le garantir ici.** Aucun service ni aucune route de
réservation n'existe — la seule lecture de `first_name` dans tout le code est
celle de l'anonymisation et celle du signal du nom. Il n'y a donc aucun endroit
où poser la condition. Elle rejoint la tâche « Création de réservation » en
phase 5, où le chemin existera.

**Trouvé en route : une échéance de job posée par la mauvaise horloge.**
`run_after` était calculé avec `datetime.now(UTC)`, celle du processus, puis
comparé par la réclamation à `clock_timestamp()`, celle de la base. Quelques
millisecondes d'avance suffisaient pour qu'un job réarmé « maintenant » ne soit
pas encore dû. Le test l'a montré une fois sur une suite complète, puis a repassé
seul — c'est-à-dire la pire forme de défaut. Toutes les échéances sont
désormais calculées par la base. Même règle que pour les preuves : seul le temps
serveur fait foi, et l'application est un client de la base comme un autre.

---

## 2026-08-06 — Écran des paliers accessibles

**L'écran montre tous les paliers actifs, le fil n'en montrera aucun
d'inaccessible.** Ce n'est pas une incohérence : ici un palier fermé oriente, là
il encombrerait. Un créateur qui débute verrait sinon un écran vide, sans rien
savoir de ce qui l'attend.

**Regroupé par palier, pas par couple (compte, palier).** Le moteur répond par
couple — la bonne forme pour filtrer un fil, pas pour peupler un écran. Un
créateur à trois comptes verrait le même palier trois fois. Accessible dès qu'un
compte l'ouvre ; sinon, les obstacles du compte qui s'en approche le plus, parce
que lui montrer ceux de son compte le plus faible le ferait viser la mauvaise
cible. « Le plus proche » se lit d'abord au nombre d'obstacles, puis à l'écart
d'abonnés : celui qui n'a qu'un relevé à attendre est plus proche que celui à
qui il manque dix mille abonnés.

**Un créateur sans compte social n'a aucun obstacle**, au sens du moteur : il n'y
a pas de couple à évaluer. Le piège de l'ensemble vide, encore — l'écran aurait
affiché des paliers tous fermés sans dire pourquoi, à la personne qui vient
justement de s'inscrire. Nouvelle raison nommée, `no_social_account`.

**Trouvé en écrivant l'écran : aucune raison de refus n'était traduite.** Les
`RaisonRefus` ne sont pas des `ErrorCode` — énumération distincte — donc le test
de parité des catalogues, qui ne lisait que `errors.py`, ne les voyait pas.
L'écran affichait `undefined` à chaque obstacle. Les huit raisons sont entrées
aux deux catalogues, et le test de parité lit désormais aussi `eligibility.py`.
Sans cet ajout, le trou se serait rouvert au premier motif suivant.

---

## 2026-08-06 — Résolveur d'appartenance

**Un résolveur par type de ressource**, chacun disant comment remonter au
commerce : `booking → business_id`, `collaboration → booking`, `proof →
collaboration → booking`, `redemption_code → booking`. Les chaînes sont écrites
une fois, dans un seul module ; une route qui recopierait la jointure pourrait
en oublier un maillon sans que rien ne le dise.

**403, jamais 404.** Une ressource inexistante et une ressource d'un autre
commerce reçoivent la même réponse. Les distinguer ferait de la route un oracle
d'existence : on lirait l'existence d'une réservation du commerce d'en face en
observant lequel des deux codes revient.

**Écrit avant les routes qu'il protège.** Aucune route métier de ces quatre
ressources n'existe encore, et c'est exactement pourquoi le résolveur vient
maintenant : la première écrirait sinon son contrôle en ligne, et les suivantes
le recopieraient. Les tests passent par des routes de sonde montées par la seule
suite de tests, avec la dépendance réelle.

**Un test par type, et un test qui compare la liste des types à celle des
sondes.** Une chaîne fausse sur un seul type passerait inaperçue sous un test
générique ; un type ajouté sans sonde serait couvert en apparence.

---

## 2026-08-06 — Géocodage réel : Geocodio

**Fournisseur retenu : Geocodio.** Les trois critères étaient : pas
d'abonnement, facturation à l'appel, pas de carte bancaire pour le quota
d'essai. Geocodio les tient tous les trois, ce qui est rare — la plupart des
concurrents facturent au mois, ou demandent une carte dès l'inscription.

*Limite à connaître :* Geocodio ne couvre que les États-Unis et le Canada. Cela
convient à un lancement à Miami, et devra être revu le jour d'une ouverture
ailleurs. Le changement tiendra dans `app/integrations/geocoding.py` et nulle
part ailleurs — c'est ce que l'interface à une seule opération achetait.

**Pas de repli silencieux sur le fournisseur.** `GEOCODING_PROVIDER` vaut
`manual` ou `geocodio` ; demander `geocodio` sans clé empêche de démarrer, comme
pour la clé de chiffrement. Un repli sur le mode manuel aurait laissé la
production placer les commerces nulle part sans que rien ne le dise.

**Des coordonnées déclarées l'emportent toujours sur la résolution.** Un
commerce qui s'est placé lui-même sur une carte sait mieux que nous où il est :
un géocodeur place à la rue, pas à la porte, et une adresse de centre commercial
tombe régulièrement sur le mauvais bâtiment. Sans cette priorité, corriger une
résolution fausse serait impossible. Conséquence utile : l'appel n'a pas lieu du
tout, on ne paie pas pour une réponse qu'on ignore.

**Une résolution imprécise est refusée comme une absence.** Seuil en
configuration. Un commerce placé à quarante kilomètres apparaîtrait dans le
mauvais fil, et personne ne saurait pourquoi — alors qu'un commerce resté en
onboarding se voit.

**Aucun échec ne bloque l'inscription.** Clé refusée, quota dépassé, panne,
réseau coupé, réponse illisible, adresse introuvable : tous rendent `None`. Le
commerce reste en `onboarding`. Perdre un commerce parce que Geocodio est en
panne serait le perdre pour une raison qui ne le regarde pas.

---

## 2026-08-06 — Durée réservée figée, et calcul de disponibilité

**La décision différée en phase 2 est tranchée : `booking` porte sa propre
`duration_minutes`.** Un commerce qui allonge un soin de trente à soixante
minutes allongeait rétroactivement toutes les réservations déjà prises, et le
calcul de disponibilité aurait vu des occupations qui n'avaient jamais été
réservées ainsi. La clé étrangère composite l'inclut, ce qui interdit de fait la
modification de la durée d'un item déjà réservé — même mécanisme que pour
`requires_booking`, et meilleur qu'un trigger : elle tient sans qu'on décide
*quand* la vérifier.

**Trouvé en route : ajouter une colonne nullable à une clé composite l'a
désactivée.** Postgres n'applique pas une clé étrangère composite dès qu'une de
ses colonnes est nulle. `duration_minutes` est nulle pour un item sans créneau,
donc la nouvelle clé à quatre colonnes ne garantissait plus rien sur ces
lignes — exactement celles où la nature de l'item est la seule chose à
vérifier. **L'ancienne clé à trois colonnes reste en place** : les deux se
complètent, retirer l'une rouvre un trou que l'autre ne couvre pas. Un test
existant l'a signalé en cessant de refuser ce qu'il refusait la veille.

**Aucune ligne de créneau n'est matérialisée.** Des créneaux écrits à l'avance
devraient être régénérés à chaque changement d'horaire, à chaque exception, à
chaque durée modifiée — et le jour où la régénération échoue, le commerce vend
des places qui n'existent pas. Calculer coûte une requête ; matérialiser coûte
une classe entière de désynchronisations.

**Un `held` occupe la place tant que son garde n'a pas expiré, et plus après.**
La condition se lit sur `hold_expires_at`, pas sur le seul statut : s'appuyer
sur le statut ferait tenir la place d'une réservation abandonnée jusqu'au
prochain passage du job d'expiration. Inversement, ignorer les `held` vendrait
deux fois la même place pendant les dix minutes du parcours.

**Les horaires sont convertis ici, et nulle part ailleurs.** Ils restent stockés
en heures locales du commerce ; la conversion vers le fuseau n'a lieu qu'au
calcul. C'est ce qui fait qu'un commerce garde son ouverture à neuf heures des
deux côtés du changement d'heure, au lieu de glisser à huit ou à dix.

**Une exception remplace la règle du jour, elle ne s'y ajoute pas.** Sinon il
faudrait décider ce qui de la règle survit, et personne ne se souviendrait de la
convention six mois plus tard.

**Un item non réservable est un refus, pas une liste vide.** Rendre zéro créneau
laisserait croire qu'il est complet, alors qu'il n'a pas de créneaux du tout —
il a une fenêtre de validité.

---

## 2026-08-06 — Fil géolocalisé

**Le fil liste des commerces, pas des offres.** Un créateur se déplace vers un
lieu ; lui présenter quinze lignes du même salon parce qu'il propose quinze
soins ferait disparaître les autres commerces du quartier.

**Rien d'inaccessible n'apparaît.** Palier fermé, item désactivé — directement
ou par son parent — offre retirée, commerce en onboarding, et surtout : aucun
créneau libre dans l'horizon. Ce dernier filtre est le plus coûteux, donc le
dernier appliqué ; tout ce qui pouvait être écarté par une requête l'a été
avant. Le parcours de disponibilité s'arrête au premier créneau trouvé — le fil
n'a besoin que de savoir s'il en reste **un**.

**Les obstacles sont renvoyés à part, même quand le fil n'est pas vide.** Un
créateur qui accède au palier story mais pas au reel doit savoir ce qui lui
manque, sinon il croit avoir tout vu. Dédoublonnés par raison : bloqué trois
fois pour la même raison, il n'a pas besoin de la lire trois fois, et on garde
le plus petit écart — la marche la plus courte.

C'est la différence exacte avec l'écran des paliers, où **tous** les paliers
sont montrés : là-bas un palier fermé oriente, ici il encombre.

**Les coordonnées viennent de l'appelant, pas du profil.** Un créateur consulte
le fil là où il se trouve, qui n'est pas toujours la ville qu'il a déclarée.
Prendre `creator_profile.geo` lui montrerait Miami depuis un aéroport.

**Le ratio de valeur est rendu, jamais utilisé pour masquer.** `SPEC.md` §3.3
demande de *signaler* une offre nettement en dessous de la référence du palier,
pas de la bloquer : le commerce reste libre de composer ce qu'il veut, le
créateur sait ce qu'il accepte.

**Chaque item porte le compte social qui ouvre son palier.** La réservation se
fait au nom d'un compte précis, pas du créateur en général : le renvoyer ici
évite à l'app de le redemander et au créateur de choisir à l'aveugle.

---

## 2026-08-06 — Création de réservation

**La clé du verrou est `(business_id, jour)`, et le choix compte.** Verrouiller
le commerce entier sérialiserait toutes ses réservations, y compris celles de
mardi prochain qui ne se disputent rien. Verrouiller le créneau seul laisserait
passer deux réservations de durées différentes qui se chevauchent : 9h30-10h30
et 10h00-11h00 ne partagent aucun créneau candidat et se disputent pourtant la
place de 10h00.

**`pg_advisory_xact_lock` et non `pg_advisory_lock`.** Le second devrait être
relâché à la main, et un chemin d'erreur qui l'oublie garde le verrou pour toute
la vie de la connexion. Le premier tombe avec la transaction, qu'elle réussisse
ou non.

**Le recompte a lieu après le verrou, et c'est tout ce qui compte.** Une
vérification faite avant ne prouve rien : entre elle et l'écriture, quelqu'un
d'autre a eu le temps d'écrire. Le recompte repasse par le calcul de
disponibilité plutôt que d'écrire son propre comptage — deux façons de compter
la même chose finiraient par diverger, et la seconde serait celle qu'on
oublierait de corriger.

**Vérifié en retirant le verrou :** le test de concurrence échoue, la seconde
transaction n'est plus sérialisée et les deux réservations passent. Le test ne
constate donc pas une propriété qui tiendrait sans lui.

**Le nom est exigé ici, pas dans le profil.** Les champs restent facultatifs
tant que le créateur ne s'engage auprès de personne ; ils deviennent
obligatoires au moment où un commerce va le recevoir. Code d'erreur dédié.

**Un item sans créneau ne prend pas de verrou.** Il ne dispute aucune capacité :
verrouiller sérialiserait des réservations qui n'ont aucune raison de l'être.

**Offre inconnue, retirée, palier désactivé, item indisponible, commerce fermé :
un seul refus.** Les distinguer renseignerait sur ce qui existe chez un commerce
dont le fil ne montre rien.

**Trouvé en route : trois tests supposaient `audit_log` globalement vide.** Ils
comptaient sur toute la table ou filtraient sur le seul `entity_type`. Or le
journal est immuable : tout test qui valide sa transaction y laisse des lignes
définitivement, et le test de concurrence en écrit forcément. Ces assertions
sont maintenant filtrées sur l'entité concernée. C'était un piège latent, pas
une conséquence de cette tâche — le premier test à committer l'aurait déclenché.

---

## 2026-08-06 — Machine à états de la réservation

**Les transitions sont déclarées dans une table, pas déduites d'une suite de
`if`.** Une table se relit et se compare au diagramme de `SPEC.md` §4.1 ; du
code réparti ne se compare à rien, et la transition qu'on a oublié d'interdire
ne se voit qu'au moment où quelqu'un l'emprunte.

Le test l'éprouve sur **toutes** les paires d'états — trente combinaisons
interdites sur trente-six — avec un diagramme recopié à la main comme oracle.
Le dériver de la table qu'il vérifie n'aurait aucun sens : il serait toujours
d'accord avec elle, y compris le jour où quelqu'un y ajoute une flèche par
erreur.

**Les états terminaux sont déclarés vides, pas absents.** Un `get` sur une clé
manquante et un ensemble vide se ressemblent trop, et la différence entre
« terminal » et « oublié » doit se voir.

**C'est le délai qui décide de l'issue d'une annulation, pas l'appelant.**
Au-delà de la fenêtre de vingt-quatre heures, une annulation est un `no_show` :
le commerce a bloqué un poste qu'il ne remplira plus. Laisser choisir
reviendrait à laisser échapper à la pénalité. Un `held` s'annule toujours sans
pénalité — rien n'a encore été promis, et le garde serait tombé tout seul.

**`no_show` est refusé sur un item sans créneau.** Il n'y a pas d'heure à
laquelle ne pas se présenter. Le refuser explicitement évite qu'un commerce
pénalise un créateur pour une absence qui n'a pas de sens.

**Le garde est relu à la confirmation, pas seulement au balayage.** Entre
l'échéance et le passage du job, la place est déjà rendue — le calcul de
disponibilité la propose à quelqu'un d'autre. Confirmer dans cet intervalle
vendrait deux fois la même place.

**Le balayage est un job global, pas un job par réservation.** Sa cible est une
sentinelle fixe ; une ligne par place tenue coûterait cher pour un travail qui
se fait en une requête.

**Trouvé en route : la colonne d'un enum non natif est dimensionnée à la
création.** `sa.Enum(native_enum=False)` produit un `VARCHAR(n)` calé sur la
plus longue valeur connue à ce moment-là. Ajouter `booking_hold_sweep`, plus
long, exigeait d'élargir la colonne en plus de réécrire la contrainte —
réécrire la seule contrainte n'aurait rien changé. C'est la base qui l'a
signalé, par une troncature refusée.

---

## 2026-08-06 — Photos de couverture et d'article

**Une clé de stockage objet, jamais une URL.** Une URL signée expire, une URL
publique fuit, et les deux se figeraient en base le jour d'un changement de
fournisseur. La clé ne dépend de personne : c'est au moment de servir qu'on
fabrique un accès. Mêmes règles que les preuves de publication.

**Nullables toutes les deux.** Exiger une image avant de pouvoir s'inscrire
perdrait des commerces sur une étape qui n'engage rien, et un article sans
photo reste parfaitement réservable — c'est l'affichage qui s'en arrange.

**Trouvé en écrivant le test : les champs étaient acceptés puis jetés.** Les
schémas les déclaraient, les services de création ne les écrivaient pas. Un
champ silencieusement ignoré est pire qu'un champ refusé : l'appelant croit
avoir enregistré. C'est précisément ce que le test de bout en bout — écriture,
lecture, fil — était écrit pour attraper, et il l'a attrapé du premier coup.

---

## 2026-08-06 — Code de retrait et caisse

**Le code affiché n'est jamais stocké.** Il est dérivé d'un secret et de la
fenêtre courante — HMAC-SHA256, troncature dynamique comme TOTP. Un code stocké
fuirait avec la base ; un code dérivé ne vaut que trente secondes, et la base ne
contient que de quoi le recalculer. Vérifié par lecture SQL directe.

**Le `booking_id` entre dans le message.** Deux réservations qui partageraient
par accident le même secret n'afficheraient pas le même code, et un code observé
chez l'un ne vaut rien chez l'autre.

**Une fenêtre de tolérance, pas deux.** Entre le moment où le créateur montre
son écran et celui où la caisse scanne, on franchit parfois une frontière :
refuser là serait incompréhensible. Accepter la fenêtre *suivante* ne servirait à
rien — personne ne scanne un code du futur — et doublerait la surface.

**Comparaison à temps constant.** `==` fuit le préfixe commun par le temps de
retour ; sur six chiffres qu'on peut soumettre en boucle, cela suffit à
reconstruire le code chiffre par chiffre.

**L'alphabet du code de secours exclut `I`, `O`, `0`, `1`.** Il se dicte à voix
haute et se saisit à la main, deux situations où ces caractères se confondent.
Quatre symboles en moins contre des refus absurdes en moins.

**Le code est créé au premier affichage, pas à la réservation.** Une réservation
annulée avant confirmation n'a jamais besoin de code, et le secret d'un code que
personne n'a montré n'a pas de raison d'exister.

**Vérifier et consommer sont deux routes.** La caisse voit ce qu'elle doit servir
avant de le déclarer servi. Les fondre ferait consommer une réservation qu'on n'a
pas encore honorée, et `consumed` est terminal.

**L'ordre de la consommation compte.** Le code d'abord, la réservation ensuite :
le `UPDATE … WHERE consumed_at IS NULL` est la barrière contre le double scan, et
c'est lui qui doit échouer en premier. Basculer la réservation d'abord ferait
passer les deux caisses avant que l'une ne s'aperçoive de rien. Éprouvé sur deux
connexions réelles.

**L'appartenance est vérifiée sur les deux routes, à la main.** Le code arrive
dans le corps et non dans le chemin : la dépendance de résolution ne peut pas le
lire. Sans ce contrôle, une caisse lirait ce que le commerce voisin s'apprête à
servir en scannant un écran par-dessus une épaule.

---

## 2026-08-06 — Code de secours, création déterministe, écran de caisse

**Le code de secours passe à six caractères, groupés trois par trois.** Huit se
dictaient mal au téléphone et se saisissaient mal sur un comptoir. Ce n'est pas
la longueur qui protège : c'est que le code est **lié à une réservation**, à
**usage unique**, à **durée courte** — il meurt avec le droit de consommer — et
désormais **limité en tentatives**. Six caractères sur trente-deux symboles font
un milliard de combinaisons ; quelques essais ratés ferment la porte bien avant
qu'on en approche.

Le compteur d'essais est écrit en base au moment du refus, et la route valide
cette écriture avant de lever : sans cela il partirait avec la transaction
annulée et ne compterait rien. Un essai qui aboutit le remet à zéro — sinon un
code sain se fermerait après quelques scans ratés étalés sur plusieurs visites.

**Le code naît à la confirmation, pas au premier affichage.** Une réservation
confirmée sans ligne de code serait un cas particulier qui ressortirait partout :
en reporting, en support, et le jour où le téléphone du créateur est vide de
batterie et qu'il faut lui dicter son code au comptoir. Déterministe vaut mieux
que paresseux.

Conséquence relevée : `creer_code` réessayait cinq fois sur n'importe quelle
violation d'unicité. Or un doublon de `booking_id` n'est pas une collision de
code de secours — l'une se réessaie, l'autre signale qu'on appelle deux fois ce
qui n'arrive qu'une. Les deux sont maintenant distinctes.

**La saisie manuelle est le chemin de premier rang de l'écran de caisse**, pas un
secours dégradé. Dans un salon, une caméra sale, un écran fissuré ou une lumière
rasante arrivent tous les jours ; mettre le scanner au centre ferait perdre du
temps à la caisse précisément les jours où elle en a le moins. Le champ est donc
visible d'emblée, le scanner est l'autre onglet, et un onglet scanner sans
caméra retombe sur la saisie en disant pourquoi.

**Le scanner réel est injecté, et reste non vérifié.** Ni test ni simulateur ne
fournissent de caméra. Tout ce qui pouvait l'être — saisie, vérification,
service, enchaînement, refus traduits — est éprouvé derrière l'interface. Reste
à valider à la main : autorisation refusée puis accordée, QR lu à contre-jour, et
le fait qu'une seule lecture parte par présentation.

**Trouvé en écrivant l'écran : `fireEvent` aussi est asynchrone.**
@testing-library/react-native 14 a rendu `render` **et** `fireEvent` promissifs.
Le premier avait coûté huit exécutions rouges ; le second faisait que les
requêtes ne trouvaient plus le champ qu'elles venaient de remplir.
`ecran.test.tsx` portait le défaut lui aussi. Le garde-fou couvre désormais les
deux, et s'étend en ajoutant un nom à une liste.

---

## 2026-08-06 — Contrepartie, preuve, boucle de relance

**Aucune validation automatique à l'expiration d'un délai.** Une échéance
dépassée produit un `unfulfilled`, jamais un `approved` par défaut. Accepter par
lassitude ferait de l'échéance une récompense pour qui ne répond pas, alors que
le commerce a donné une prestation contre une publication qui n'existe pas. Un
test essaie de provoquer l'inverse par tous les états expirables.

`submitted` n'est **pas** expirable : le créateur a répondu, la balle est de
notre côté. Le faire tomber punirait quelqu'un de notre propre lenteur.

**Le refus de conformité rouvre, il ne clôt pas.** `resubmit_requested` avec une
**nouvelle échéance** — sans elle, le créateur tomberait en non honoré pour un
délai déjà écoulé, ce qui reviendrait à refuser en faisant semblant de laisser
une chance. Le délai de reprise est plus court : le créateur sait déjà quoi
faire, il lui reste à le refaire.

`needs_human_review` se lève à la troisième tentative et sort le dossier de la
boucle **sans le trancher**. Il n'existe pas de statut de litige, et l'API du
commerce n'offre pas de bouton « rejeter » : approuver, ou redemander avec un
motif obligatoire. Un créateur à qui l'on dit « non conforme » sans dire
pourquoi refera la même chose.

**Les critères sont figés à la création**, recopiés depuis l'offre. Un commerce
qui les durcit ensuite changerait rétroactivement ce qu'on reproche au créateur
de ne pas avoir fait.

*Écart relevé :* `collaboration` portait `required_mention` et `required_geotag`
depuis la phase 1 mais **rien ne les alimentait**. Les critères affichés auraient
toujours été vides. Ils vivent désormais sur `tier_offer`.

*Contradiction signalée :* `under_review` figure dans les statuts de `SPEC.md`
§2.6 mais pas dans le diagramme §4.2. Traité comme l'étape « contrôle » du
diagramme, parce qu'une table de transitions partielle lèverait un `KeyError`.

**L'ordre de préférence de capture est appliqué au serveur, pas choisi par
l'appelant.** Sinon tout le monde enverrait une capture d'écran. Le niveau
employé est conservé dans `capture_method` : c'est lui qui permettra
**d'automatiser uniquement les cas de niveau 1**, où la plateforme atteste
elle-même que le contenu était sur le compte connecté. L'ordre est une constante
déclarée et non l'ordre de l'énumération — un membre ajouté au mauvais endroit
changerait sinon la hiérarchie de confiance sans que personne ne le voie.

**Les soumissions s'empilent, elles ne s'écrasent pas.** L'historique d'un
dossier refusé trois fois est ce qu'un commerce contestera. Renvoyer le même
fichier après un refus est reconnu par son empreinte : ce n'est pas une
correction.

*Non branché, et dit comme tel :* le dépôt réel chez un fournisseur compatible
S3, ainsi que les niveaux 1 et 2 de capture. Le niveau 1 attend `fetch_media` ;
le niveau 2 demande des garde-fous — taille, types, refus des adresses internes
— dont l'absence ouvrirait une porte de requête côté serveur. Les brancher à
moitié serait pire que pas du tout.

---

## 2026-08-06 — Emails transactionnels

**Fournisseur : Resend.** Facturation à l'usage, pas d'abonnement, domaine à
vérifier. Mêmes critères que pour le géocodage, et même traitement : le mode est
déclaré par `EMAIL_PROVIDER`, et demander `resend` sans clé ni expéditeur
empêche de démarrer. Découvrir la clé manquante au premier rappel signifierait
des créateurs sans avertissement et des dossiers qui tombent en non honoré sans
que personne n'ait rien dit.

Le domaine vérifié n'est pas une formalité : un transactionnel envoyé depuis un
domaine non authentifié finit en indésirable, et un rappel qui n'arrive pas vaut
un rappel qui n'existe pas.

**Aucun envoi ne fait échouer ce qui l'a déclenché.** Les rappels passent par la
file de jobs, avec son report et son épuisement. Un service injoignable ne doit
pas annuler la contrepartie qu'il devait annoncer — le créateur préfère une
contrepartie correctement ouverte sans email à un email parfait sur une
contrepartie qui n'existe pas.

En revanche, l'erreur **remonte** depuis le module de notification : l'avaler
ferait croire à un envoi. C'est au job de la reporter, pas au module.

**La langue est celle du destinataire, jamais celle du déclencheur.** Un
commerce hispanophone qui refuse une preuve écrit son motif en espagnol ; le
créateur reçoit le cadre du message dans sa langue à lui. Le motif reste tel
quel — c'est du contenu saisi, et on ne traduit pas ce qu'un commerce a écrit.

**L'échéance est rendue dans le fuseau du commerce.** Affichée en UTC à
quelqu'un qui vit à Miami, elle se lit à quatre heures près.

**Trouvé en route : j'avais écrit un second lecteur de catalogue.**
`app/core/i18n.py` existait déjà et servait exactement à ça. Deux façons de lire
le même fichier auraient divergé, et c'est la seconde qu'on aurait oublié de
corriger. `notifications` passe désormais par le module existant.

**Un test qui figeait une liste est tombé, et il avait tort.** Il affirmait
`available_keys() == {"account.welcome.subject"}` — la seule clé du jour où il a
été écrit. Chaque gabarit ajouté le faisait tomber sans qu'aucune propriété soit
en cause. Il compare maintenant les clés exposées à celles des catalogues, dans
les deux langues.

Un troisième test vérifie que les deux langues attendent les **mêmes variables**
de substitution : une variable présente d'un seul côté produirait un email
amputé dans une langue et correct dans l'autre, le pire des deux.

---

## 2026-08-06 — Fiabilité : événements, score, seuils rallumés

**Le score et le compteur sont deux caches, tous deux entièrement
recalculables.** Rien n'est écrit à la main. Un test recalcule depuis les
événements et compare à ce qui est stocké ; un second désaccorde volontairement
le cache et vérifie que le recalcul le détecte puis le répare — sans lui, le
premier test pourrait passer en comparant le cache à lui-même. Un cache qu'on ne
sait pas reconstruire finit par diverger sans qu'on le sache, et le jour où on
s'en aperçoit il n'y a plus de référence pour trancher.

**Les pondérations vivent en configuration, et sont rétroactives.** Le recalcul
relit l'historique avec la grille du jour ; changer le poids d'une absence ne
demande ni migration ni réécriture. Le poids reste **figé sur chaque ligne**
malgré tout : il dit ce que l'événement valait au moment où il s'est produit,
ce qu'un historique doit pouvoir raconter. Les deux lectures répondent à deux
questions différentes.

**Les événements naissent des transitions, jamais d'un appel séparé.** Un appel
séparé finit par être oublié sur une branche, et c'est exactement la branche qui
pénalise quelqu'un qu'on oublie. La correspondance issue → événements est
déclarée dans une table plutôt que dispersée dans les branches : une issue
ajoutée sans son événement se voit là, pas au troisième mois d'exploitation.

**Une approbation du premier coup se distingue d'une approbation au troisième
essai.** `first_pass_compliant` n'est émis que si `attempts_count` est resté à
zéro. Une collaboration obtenue après relance compte quand même comme menée à
son terme — elle l'a été.

**Un créateur sans événement garde un score nul.** Nul veut dire neutre, jamais
zéro : écrire zéro ferait d'un débutant quelqu'un de peu fiable, et aucun
débutant n'accéderait à rien.

**Les seuils de collaborations sont rétablis** aux valeurs d'origine, reprises
de la migration qui les avait neutralisées et non réinventées. Ils étaient à
zéro parce que le compteur n'était alimenté par rien — un seuil qui refuse tout
le monde n'est pas un seuil, c'est une porte fermée.

Conséquence immédiate, et c'est le signe que la condition mord : un test qui
affirmait qu'un créateur à vingt-quatre mille abonnés accédait au palier reel
est tombé. Il affirme maintenant le contraire, avec la bonne raison — ce ne sont
pas les abonnés qui bloquent, ce sont les collaborations.

**Le plafonnement n'est pas une exclusion.** Un score dégradé ferme les paliers
hauts et laisse le palier d'entrée ouvert : quelqu'un qui a mal fait doit
pouvoir remonter.

---

## 2026-08-06 — Import de carte

**Le modèle vision est un fournisseur derrière une interface**, comme le
géocodage, les plateformes sociales et l'envoi d'emails. Ni le service, ni la
route, ni l'écran ne savent lequel a lu la carte. Le mode est déclaré par
`MENU_EXTRACTION_PROVIDER` ; demander `vision` sans clé empêche de démarrer.

Le mode `manual` n'extrait rien et rend une charge vide. Ce n'est pas un repli
silencieux : c'est le chemin de la phase 2, la saisie à la main, qui fonctionne
parfaitement.

**Aucun item n'est créé sans validation explicite du commerce.** Quatre gestes —
téléverser, extraire, relire, valider — et seul le dernier touche au catalogue.
Un test le vérifie sur une extraction **réussie, avec des lignes** : c'est là
que la règle pourrait céder, pas sur une extraction vide.

Les items viennent des lignes **révisées**, jamais de la charge extraite. Valider
en relisant la charge annulerait la relecture, et personne ne s'en apercevrait
avant de voir des prix faux dans un fil.

**La durée n'est jamais extraite.** Une carte affiche des prix, pas des temps de
poste — et quand elle affiche une durée, c'est celle annoncée au client, pas
celle que le commerce bloque : les deux diffèrent souvent d'un quart d'heure de
remise en état. L'interdiction est double : le type de retour de l'extraction ne
porte pas de champ de durée, et la consigne au modèle lui interdit d'en deviner
une. Une durée inventée fausserait tout le calcul de capacité sans que personne
ne le voie.

À l'écran, le champ reste **vide**. Le préremplir ferait valider une durée que
personne n'a choisie.

**Une ligne réservable sans durée est refusée en bloc.** Créer la moitié des
items laisserait le commerce devant un catalogue à moitié importé qu'il faudrait
démêler.

**Une ligne à moitié lue est écartée, pas rendue avec des trous.** Elle coûte
plus de temps à corriger qu'à ressaisir, et elle passe plus facilement la
relecture qu'une absence.

**Une réponse inexploitable lève, elle ne rend pas une extraction vide.** Le vide
veut dire « rien trouvé sur cette carte » ; le confondre avec un échec ferait
valider une carte blanche.

**La confiance est rendue et sert à ordonner la relecture.** Une extraction sans
confiance obligerait à tout relire avec la même attention, ce qui revient à ne
rien relire. L'écran ne signale que les lignes sous le seuil — tout signaler
reviendrait à ne rien signaler.

**Les deux charges sont conservées côte à côte**, extraite et révisée. Comparer
les deux dit ce que le modèle rate, et si le changer a servi à quelque chose.
Ce qu'un commerce a écarté est conservé aussi : le savoir vaut autant que savoir
ce qu'il a gardé.

---

## 2026-08-06 — Les dix routes manquantes de l'intégration

**La fiche publique d'un commerce montre les paliers fermés, le fil les masque.**
C'est le seul endroit où les deux vues divergent, et c'est délibéré. Le fil
masque parce qu'un fil encombré de prestations inaccessibles détruit la
confiance en deux jours. Une fiche est déjà ouverte : le créateur a choisi ce
commerce, et masquer la moitié de sa carte lui ferait croire que le salon
propose trois soins quand il en propose huit. Chaque offre porte donc son
`accessible` et, quand elle est fermée, les obstacles qui la ferment. Ce qui
reste masqué des deux côtés, c'est ce que le commerce a retiré — un item
désactivé est une absence, pas une invitation.

**Un commerce non publié répond 404, pas 403.** Il n'y a pas de droit à refuser,
la ressource n'est pas publiée. Le commerce absent et le commerce en cours
d'inscription se répondent pareil, ce qui ne divulgue aucun identifiant.

**Les compteurs d'onglets de l'historique se comptent sur tout l'historique.**
Un onglet qui annonce « 3 » parce que la première page en contient trois ment
dès la seconde. Ils ignorent aussi le filtre en cours : un onglet ne se compte
pas depuis le filtre d'un autre.

**Le palier d'une réservation vient de l'offre, jamais de la contrepartie.** La
contrepartie naît à la consommation ; passer par elle rendrait le palier nul sur
exactement les lignes que le créateur regarde le plus, celles qui sont à venir.

**La journée du commerce se découpe dans son fuseau, y compris le jour par
défaut.** Un serveur en UTC est déjà demain quand il est 20 h à Miami : sans
conversion, la journée par défaut sauterait chaque soir. Les bornes réellement
utilisées sont rendues, pour que le commerce puisse vérifier ce qui a été compté
comme « sa » journée.

**Le filtre des contreparties reste facultatif.** Les trois onglets du design —
à contrôler, attendue, approuvée — ne couvrent pas `unfulfilled`. Lier la
lecture aux onglets ferait disparaître de l'interface un statut qui existe en
base. Sans filtre, la liste rend tout.

**Le motif de la dernière demande de nouvelle soumission est relu dans le
journal d'audit**, pas recopié sur la contrepartie. Le journal est immuable ;
une copie ne l'est pas et finirait par en diverger sous un UPDATE.

**Un dossier tranché sort de la file d'arbitrage sans perdre son drapeau.**
`needs_human_review` reste levé — c'est une trace — mais un dossier réglé n'est
plus à trancher, et le garder ferait grossir une pile qui ne descend jamais.

**La mensualisation d'un plan annuel est une règle de facturation, pas une mise
en page.** Elle est faite dans le service, arrondie et non tronquée : douze mois
de troncature perdent jusqu'à onze centimes par plan, et le total cesse d'être
vérifiable à la main. `past_due` compte comme du revenu récurrent — la facture
n'est pas encaissée mais l'abonnement court, et l'exclure ferait apparaître une
chute là où il n'y a qu'un prélèvement en retard.

**`activate_business` consomme la liste que la route expose.** Écrire les
conditions deux fois les ferait diverger au premier ajout, et l'écran
annoncerait « prêt » sur une activation que le service refuse. Un test retire
une étape bloquante et vérifie que l'activation tombe sur celle-là précisément.
Les étapes non bloquantes — photo, catalogue, offre, horaires — sont rendues
parce qu'elles décident de la **visibilité** : un commerce actif sans offre
n'apparaît dans aucun fil, et le taire produirait un commerce « activé » que
personne ne voit et dont personne ne comprend pourquoi.

**Les abonnés du créateur sont sa donnée et lui sont rendus datés.**
L'éligibilité s'en servait pour trancher et ne les rendait qu'en creux : qui
avait 1 800 abonnés lisait « il t'en manque 200 » sans jamais lire 1 800. Un
chiffre sans date serait pris pour celui du jour, alors qu'il peut avoir une
semaine. Sans relevé, la valeur est **nulle et non zéro** — « pas encore
mesuré » n'est pas « zéro abonné ».

**Le statut de vérification ne promet aucun délai.** Ni objectif, ni estimation,
ni « sous 72 heures ». Une promesse tenue par une file d'attente humaine se
brise le premier jour de charge, auprès de gens qui n'ont rien fait de mal. On
rend la date de démarrage — le compteur de jours se calcule côté app — et les
signaux jugés, recalculés à la lecture plutôt que relus d'un cache qui aurait
vieilli pendant que les relevés bougent.

**Les obstacles portent une date quand ils en ont une.** `metrics_stale` porte
la date du relevé, `account_token_invalid` l'échéance du jeton,
`account_under_review` la date de rattachement. L'écart en secondes reste
disponible pour qui veut calculer, mais il ne s'affiche pas : « il vous manque
431 200 secondes » ne veut rien dire, « relevé du 3 août » se lit. Les
obstacles qui n'ont rien à dater gardent `depuis` nul.

**Non comblé, volontairement** : quartiers, événements temps réel, versionnement
des paliers. Le rafraîchissement se fait à l'ouverture d'écran et sur geste.

---

## 2026-08-07 — Arbitrage administrateur, et le contrat d'API

**L'administrateur tranche dans le vocabulaire du commerce, plus une issue qui
n'est qu'à lui.** Approuver et redemander disent exactement la même chose des
deux côtés : lui donner un second langage obligerait chacun à traduire, et
l'arbitrage cesserait d'être comparable à la décision qu'il révise. Clore en non
honoré n'appartient qu'à lui — c'est la seule décision du produit qui ne se
rouvre pas, et le commerce ne doit jamais pouvoir la prendre par lassitude.

Sans cette décision, le drapeau `needs_human_review` était une impasse : la
mécanique s'arrête à la troisième tentative sans trancher, et personne ensuite
ne pouvait le faire.

**Deux flèches ont été ajoutées à la machine à états** — `submitted →
unfulfilled` et `under_review → unfulfilled` — et elles n'existent que pour
l'arbitrage. La table dit ce qui est *possible*, l'appelant dit qui en a le
*droit* : la boucle d'échéances ne balaie que `pending` et
`resubmit_requested`, le routeur commerce n'appelle jamais la clôture. Un test
le vérifie sur le code, pas sur une intention — il compte les appels à
`vers=UNFULFILLED` dans le service et refuse le nom de la fonction de clôture
dans le routeur commerce.

**L'arbitrage est borné aux dossiers marqués en revue.** Sans cette borne,
l'administrateur deviendrait un commerce fantôme, décidant à la place de celui
qui a donné la prestation. Ce qu'on arbitre est ce que la mécanique a refusé de
trancher toute seule.

**La fenêtre de nouvelle soumission est plus courte que celle de la publication
initiale, et c'est voulu.** Corriger une légende va plus vite que produire un
contenu. Ce que la règle protège n'est pas « une échéance plus lointaine
qu'avant » mais « une fenêtre entière qui rouvre » : le créateur ne doit pas
hériter du reliquat d'un délai déjà entamé. Un premier test avait fixé la
mauvaise garantie et serait tombé le jour où la configuration bougeait.

**Le contrat d'API est un fichier commité, et la CI refuse qu'il vieillisse.**
`api/scripts/dump_openapi.py` écrit les chemins, méthodes et codes de réponse —
ni schémas ni descriptions, qui changent à chaque montée de version de FastAPI
et rendraient le fichier illisible en revue, donc invérifiable. Un test côté app
compare chaque route appelée à ce fichier. Sans la vérification de fraîcheur, le
test continuerait de passer contre une photographie périmée du serveur : il
cesserait de prouver quoi que ce soit au moment précis où une route est
renommée.

**Une panne de transport n'est pas une erreur d'API.** La conduite à tenir
diffère — une requête jamais partie se rejoue sans risque, une qui a reçu un 409
non — et la phrase à dire n'est pas la même. `NetworkError` porte le premier
cas, `ApiError` le second avec son code du catalogue fermé.

**Une seule rotation de jeton vit à la fois.** Trois écrans qui chargent en
parallèle prennent trois 401 simultanés ; sans partage de la promesse, deux
rotations invalideraient le jeton que la troisième vient d'obtenir.

**Une rotation refusée efface la session, une rotation en panne réseau ne
l'efface pas.** Le premier cas prouve que le jeton est mort et le garder ferait
retenter indéfiniment ; le second ne prouve rien, et effacer déconnecterait
quelqu'un qui passe sous un tunnel.

**La déconnexion ferme la session localement quoi qu'il arrive.** Un serveur
injoignable ne doit pas laisser quelqu'un connecté sur un téléphone qu'il vient
de rendre.

---

## 2026-08-07 — Les écrans, et ce qui les tient

**Les quatre états ne sont pas écrits écran par écran.** `useRequete` les
produit, `Ecran` les rend, et un test les force sur chaque écran d'un registre.
Les écrire à la main garantissait qu'il en manquerait un quelque part, et que ce
serait l'erreur — celle qu'on ne voit jamais en développant, parce que le
serveur répond.

**Le vide n'est pas l'erreur.** Une liste vide est une réponse valide qui
demande une conduite — élargir le rayon, changer de jour — là où une erreur
demande de réessayer. `estVide` est obligatoire et sans valeur par défaut :
« vide » ne se devine pas, et le laisser deviner ferait afficher un état vide
sur une réponse pleine.

**Un rechargement ne repasse pas par l'état de chargement.** L'écran garde ce
qu'il montrait ; le vider ferait clignoter une liste que quelqu'un était en
train de lire. Une erreur de rechargement conserve les données précédentes et
les affiche **datées** — les effacer punirait l'utilisateur d'une panne qui ne
le concerne pas.

**L'écart chiffré démarre à 60 % du seuil, et la bascule est testée aux deux
bords.** En dessous, horizon : le seuil et rien d'autre. « Il te manque 8 800
abonnés » n'aide pas à agir, cela apprend seulement que ce n'est pas pour soi.

**Un obstacle sans mesure ne produit pas d'écart.** Annoncer « il te manque
10 000 » à quelqu'un qu'on n'a jamais mesuré serait une invention : c'est un
horizon.

**Le même obstacle, dans les mêmes termes, sur la fiche et sur les paliers.**
C'était la condition posée pour garder la divergence avec le fil. Une offre
fermée est visible, sans bouton, avec son code serveur.

**Le bouton est retiré, jamais grisé** — sur la fiche quand le palier est
fermé, sur le contrôle tant qu'aucun motif n'est choisi, sur l'activation tant
qu'une étape bloquante manque, sur l'arbitrage pour les deux issues qui
exigent un motif.

**Les compteurs d'onglets viennent de la réponse, pas de la page.** Et les
onglets restent visibles quand l'onglet courant est vide : un historique dont
seul « à venir » est vide n'est pas un historique vide, et masquer les onglets
empêcherait d'aller voir les autres.

**L'heure s'affiche dans le fuseau du commerce**, côté créateur comme côté
comptoir. Un rendez-vous se prend là où il a lieu ; l'afficher dans le fuseau du
téléphone ferait rater des rendez-vous à quiconque voyage. Sur un droit sans
créneau, aucune heure n'est inventée.

**L'écran de code n'a pas quatre états, et c'est sa règle.** Il garde son
dernier code quoi qu'il arrive, y compris hors ligne : la vérification se fait
côté salon, et effacer l'écran sur une perte de réseau laisserait quelqu'un
devant une caisse sans rien à montrer. Il est nommé hors registre plutôt
qu'exempté en silence.

**Le vocabulaire de l'arbitre est celui du commerce**, et un test compare les
deux libellés du catalogue. La clôture en non honoré n'apparaît que sur l'écran
d'arbitrage ; un test vérifie qu'elle n'existe nulle part côté commerce.

**La division des centimes se fait à l'affichage, sur un seul écran.** Les
montants restent des entiers partout ailleurs, parce qu'un flottant finit
toujours par perdre un centime.

**La dette d'écrans non migrés décroît**, de cinq à quatre : l'écran des paliers
a été refait sur les composants et le client. Le test la compte dans les deux
sens — il tombe si quelqu'un l'agrandit, et si quelqu'un migre un écran sans
retirer sa tolérance.

---

## 2026-08-07 — Mode démonstration et fin de la phase 10

**Le mode démonstration n'existe pas dans le produit.** C'est une implémentation
de plus derrière chaque interface, choisie par une ligne de configuration. Un
test parcourt toutes les sources et refuse qu'un service interroge le mode :
s'il le savait, il finirait par en tirer parti, et ce que la démonstration
prouve ne serait plus ce que la production fait. Seules trois fabriques ont le
droit de poser la question, et un second test vérifie qu'elles la posent — sans
lui, un produit où le mode aurait disparu passerait le premier.

**Deux trous d'abstraction ont été comblés pour cela.** Le fournisseur social
était nommé en dur dans le routeur : ajouter TikTok y demandait une seconde
branche, et faire une démonstration demandait de mentir sur des identifiants
Meta. Le dépôt d'objets n'existait pas : `deposer` calculait une clé sans rien
écrire, et une preuve archivée n'était consultable nulle part.

**Les dépendances de fournisseur sont deux fonctions nommées, pas une fabrique
de fermetures.** Une dépendance FastAPI se surcharge par identité ; une
fermeture construite à chaque import n'est visable par aucun test. Vingt modules
de test l'ont découvert d'un coup.

**Les images sont générées, pas téléchargées.** Embarquer des photos libres de
droits pèse des mégaoctets et pose une question de licence par fichier ; les
télécharger au moment du jeu de données le rend dépendant du réseau, y compris
en intégration continue. Trois couches — dégradé, deux sources de lumière,
grain — et c'est le grain qui fait basculer la lecture : un aplat parfaitement
lisse est immédiatement rangé dans « image manquante ».

**Une route sert les photos, jamais les preuves.** Le préfixe est vérifié, pas
seulement documenté : les clés sont des empreintes, donc devinables par
quiconque possède le fichier, et une route qui servirait tout laisserait
n'importe quel porteur de jeton lire n'importe quelle preuve.

**Le jeu de données obtient ses états, il ne les pose pas.** Les seules
exceptions sont nommées et portent leur raison : reculer un horodatage pour
qu'une échéance soit dépassée, vieillir un relevé. Aucun service ne sait
remonter le temps, et le seul autre moyen serait d'attendre.

Deux choses se sont vues en vérifiant le jeu obtenu, et ni l'une ni l'autre
n'était un défaut du produit. **Une annulation à moins de vingt-quatre heures
devient une absence** : le jeu réservait pour aujourd'hui et n'obtenait jamais
d'annulation. Il réserve maintenant à trois jours — la règle n'est pas
contournée, on lui donne ses conditions. **Toutes les issues dégradées données à
la même créatrice lui faisaient un score de quarante**, alors que le jeu doit
montrer une créatrice vérifiée avec un bon score. Elles sont réparties, et un
garde-fou vérifie l'ordre des deux scores plutôt que de faire confiance.

**Le niveau 2 de la preuve suit ses redirections lui-même.** C'est le seul
moyen de tenir la promesse : laisser le client HTTP les suivre ne contrôlerait
que la première adresse, c'est-à-dire précisément celle qui est irréprochable.
La taille est vérifiée **pendant la lecture** et non sur `Content-Length`, qui
est déclaratif — un serveur hostile annonce mille octets puis en envoie dix
gigaoctets. Les adresses IPv4 mappées en IPv6 sont déballées avant d'être
jugées : `::ffff:127.0.0.1` n'est ni privée ni de bouclage tant qu'on ne le fait
pas, et c'est exactement la forme qu'un contournement prendrait.

**Un échec du niveau 2 ne remonte pas.** URL morte, type refusé, adresse
interne : dans tous les cas on descend au niveau 3. Le créateur a peut-être
envoyé une capture, et le faire échouer parce que son lien a expiré le
punirait de la mécanique.

**`SubscriptionStatus.INCOMPLETE` a été ajouté**, et c'est un changement de
modèle. Stripe ouvre un abonnement en `incomplete` tant que le premier paiement
n'a pas abouti, et c'est le comportement voulu : un commerce ne participe pas
avant d'avoir payé. C'est aussi ce qu'on retient quand le fournisseur rend un
statut inconnu — dans le doute, on ne fait pas participer.

La migration a demandé **deux gestes, et l'autogénération n'en voyait qu'un** :
l'énumération est rendue en `VARCHAR` + `CHECK`, et élargir la colonne sans
réécrire la contrainte laisse un `CHECK` qui refuse toujours la nouvelle valeur.
Le défaut ne serait apparu qu'au premier commerce tentant de s'abonner. Le nom
passé à `op.drop_constraint` doit être le nom **court** : la convention de
nommage préfixe déjà, et le nom complet aurait été préfixé une seconde fois.

**Le prix envoyé à Stripe vient de `subscription_plan`.** Laisser le tableau de
bord du fournisseur porter la tarification créerait une seconde source, et c'est
celle qu'on oublierait de mettre à jour. Notre énumération n'est pas renommée
pour lui plaire : `monthly` devient `month` à la frontière.

**Le mode test de Stripe fonctionne sans entité juridique.** Ce qui attend
l'entité est le passage en production : une clé à changer, pas un code à écrire.

**Le bac à sable de TikTok n'est pas un mode de notre code.** Les appels sont
les vrais ; ce qui change est la liste des comptes que la plateforme accepte de
servir. Le drapeau ne change aucun appel : il permet de dire « compte non
inscrit au bac à sable » plutôt que « échec », sans quoi chaque essai
ressemblerait à un défaut du produit.

**Snapchat n'a aucune implémentation, et la fabrique lève.** Rendre un
fournisseur qui ne fait rien laisserait un créateur devant un parcours qui ne se
termine jamais. Les routes de rattachement sont déclarées une par plateforme
plutôt que génériques : une route `/{platform}/connect` accepterait `snapchat`
et rendrait un 503, donnant le droit de croire que la plateforme existe et
qu'elle est en panne.

**Le taux d'honoration est nul et non zéro quand rien n'a été servi.** Zéro sur
zéro n'est pas zéro, et afficher 0 % à un commerce qui n'a encore servi personne
serait un reproche pour quelque chose qu'il n'a pas fait.

**La portée du reporting s'appelle `portee_approximative`.** Le nombre d'abonnés
d'un compte n'est pas le nombre de personnes ayant vu une story ; le nom du
champ le rappelle à qui le lit sans avoir lu la documentation. Le relevé retenu
est celui **antérieur à l'approbation** : un créateur qui a doublé son audience
depuis ne rend pas rétroactivement la publication plus large qu'elle ne l'a été.

**Les comptes du jeu de données ne pouvaient pas se connecter.** Ils employaient
un domaine en `.test`, que la validation d'adresse refuse comme nom d'usage
spécial ; le jeu les créait par le service, qui ne passe pas par le schéma
d'entrée. Le domaine est maintenant `.example` — réservé par la RFC 2606,
accepté par le validateur.

Le test qui prétendait le vérifier ne regardait que `password_hash` et
concluait que les comptes étaient utilisables. **Il constatait un ensemble vide
sans jamais se connecter.** Il fait maintenant passer chaque adresse par la
validation d'entrée, la seule porte par laquelle une connexion arrive. Le défaut
ne s'est vu qu'en ouvrant le serveur à la main et en parcourant le produit —
c'est précisément ce que le passage demandait de faire.

---

## 2026-08-07 — La coquille applicative

**Le rôle vient du serveur, jamais d'un jeton décodé.** Après connexion on relit
`/me` : le jeton porte un identifiant, pas des droits. Le déduire côté client
reviendrait à laisser l'appareil se déclarer administrateur. La navigation qui
en découle n'est qu'un confort ; c'est l'API qui refuse.

**Deux vocabulaires de rôle, séparés.** L'API dit `business_member`, le design
dit `merchant`. Les confondre obligerait à renommer l'un pour plaire à l'autre,
et c'est toujours le mauvais qu'on renomme. `themeDuRole` fait la traduction, à
un seul endroit.

**Les jetons vivent dans le trousseau de l'appareil**, pas dans `AsyncStorage`,
qui écrit en clair dans un fichier que toute sauvegarde emporte. Sur le web il
n'existe pas d'équivalent : on retombe sur le stockage du navigateur et **on
l'affiche dans les réglages**. Un repli silencieux aurait fait croire que le web
est protégé comme le natif.

**Le rétablissement au démarrage est un état à part.** Tant qu'on n'a pas lu le
trousseau, on ne sait pas s'il y a une session : afficher l'écran de connexion
pendant ce temps ferait clignoter l'app à chaque ouverture pour quelqu'un de
déjà connecté.

**Un jeton présent n'est pas une session valide.** On le vérifie contre `/me`
plutôt que de faire confiance à sa présence. En revanche, **une panne réseau au
démarrage n'efface rien** : on ne jette pas quelqu'un dehors parce qu'il ouvre
l'app sous un tunnel.

**Le compte suspendu se distingue de la session expirée.** L'API répond 401
partout sans dire lequel des deux — elle relit le statut à chaque requête — mais
la connexion, elle, rend `account_not_active`. C'est le seul endroit où on
l'apprend, et c'est là qu'on le dit.

**Le rôle administrateur ne se choisit pas à l'inscription.** L'API l'accepte ;
l'offrir dans un formulaire public ferait de « administrateur » une case à
cocher.

**Chaque rôle n'a que ses onglets.** Ce n'est pas une garantie de sécurité, mais
un onglet qui répondrait 403 est pire qu'un onglet absent : il promet quelque
chose qu'il ne peut pas tenir.

**La frontière d'erreur journalise la trace et n'en montre rien.**
`TypeError: Cannot read properties of undefined` n'apprend rien à quelqu'un qui
voulait réserver un soin, et lui fait croire que le produit est cassé partout.
Elle offre toujours une issue : sans bouton, un plantage d'écran demande de tuer
l'application.

**`GET /me/businesses` a dû être ajoutée.** Tous les écrans commerce prennent un
`business_id`, et le résolveur d'appartenance ne sert qu'à vérifier celui qu'on
lui donne — il ne dit pas lequel demander. Sans cette route, une application
commerce ne peut rien afficher. Elle rend une **liste** : rien n'interdit
d'appartenir à deux commerces, et rendre le premier obligerait à la réécrire le
jour où quelqu'un en a deux.

**L'écran de santé est relégué en réglages.** Il répond à « est-ce que ça
marche », question qu'on se pose quand ça ne marche pas — pas un onglet
permanent.

**`app.tsx` et `App.tsx` étaient le même fichier.** Le système de fichiers de
macOS est insensible à la casse ; le dépôt en portait deux, git en voyait deux,
le disque un seul. Découvert en supprimant l'un et en perdant l'autre.

---

## 2026-08-07 — Le bug qui n'envoyait aucune requête

**Cause.** `globalThis.fetch` était rangé nu dans un champ du client, puis
appelé par `this.fetchImpl(...)`. L'appel lui donne l'instance comme `this` ;
les navigateurs refusent — « Failed to execute 'fetch' on 'Window': Illegal
invocation » — et **la requête ne part pas**. React Native, dont le `fetch` est
une fonction ordinaire sans contrôle de `this`, l'acceptait : le défaut
n'existait qu'en web, et le natif ne pouvait pas le révéler.

**Pourquoi il était invisible.** La `TypeError` était levée à l'intérieur du
`try` qui enveloppe l'appel, attrapée, et retransformée en `NetworkError`. Le
symptôme devenait « vérifiez votre connexion » : aucune requête dans l'onglet
réseau, rien dans la console, et un message qui désigne le réseau alors que le
réseau n'a jamais été sollicité.

Un bloc `catch` qui enveloppe **tout** ce qui a pu être levé transforme une
erreur de programmation en panne d'infrastructure. On ne peut pas distinguer les
deux par leur type — un navigateur rend aussi une `TypeError` pour une vraie
panne réseau — mais on peut **journaliser la cause** avant de l'envelopper. C'est
la ligne qui manquait, et son absence a coûté tout le temps de diagnostic.

**Un second défaut dormait derrière.** `connecter`, `deconnecter` et la rotation
écrivaient leurs chemins à la main — `/auth/login` — sans le préfixe `/api/v1`.
Le test de contrat ne les voyait pas : il ne parcourt que le module `routes`.
Une fois le `fetch` réparé, ils auraient rendu 404, et il aurait fallu un second
tour de diagnostic pour le même symptôme. Les trois passent maintenant par
`routes`, et un test refuse tout chemin littéral dans le client.

**`EXPO_PUBLIC_API_URL` absente ne se rattrape plus.** Le repli sur `localhost`
marchait sur la machine de développement et produisait ailleurs des erreurs de
connexion que personne ne reliait à une variable manquante. L'application
affiche désormais un écran qui nomme la variable, le fichier, et rappelle que
les variables `EXPO_PUBLIC_` sont inlinées à la compilation — donc qu'il faut
relancer le serveur. Cet écran est volontairement non traduit : il s'adresse à
qui installe, pas à qui utilise, et doit rester lisible si le catalogue n'a pas
chargé.

**Ce que l'épisode dit des tests.** Les 240 tests passaient. Aucun n'appelait le
client sans lui injecter `fetchImpl` — le chemin de production n'était jamais
emprunté. Le test ajouté installe un `fetch` qui vérifie son `this`, comme le
font les navigateurs, et construit le client **sans** injection.

---

## 2026-08-07 — Retour à Expo SDK 54

**Le SDK suit Expo Go, pas l'inverse.** Expo Go de l'App Store sert le SDK 54 ;
un projet en 57 produit un QR code qu'il refuse d'ouvrir, et la seule autre voie
— une compilation native — demandait une mise à jour de macOS. Le SDK le plus
récent n'a d'intérêt que si quelqu'un peut ouvrir l'application.

**Les versions viennent d'`expo install --check`, jamais d'une supposition.**
Seize paquets à aligner, dont React, React Native, les typages et `jest-expo`.
Deviner un numéro de React Native pour un SDK donné se paie en erreurs de
compilation qui ne nomment pas leur cause.

**Rien d'autre n'a changé.** Aucune ligne de code applicatif, aucun test. Les
quatre API Expo employées — `CameraView` et `useCameraPermissions`,
`requestForegroundPermissionsAsync`, `getItemAsync` et consorts, `getLocales` —
existent toutes dans les versions du SDK 54, vérifié dans les typages installés.
Rien de ce que le produit utilise n'était propre au SDK 57.

**Le dossier `ios/` est retiré et ignoré.** Produit par un `prebuild`, il se
regénère à la demande ; commité, il divergerait de `app.json` sans que rien ne
le signale. `android/` l'est aussi, par symétrie.

**Ce que la rétrogradation coûte réellement** : React 19.1 au lieu de 19.2,
React Native 0.81 au lieu de 0.86, TypeScript 5.9 au lieu de 6.0. Aucun de ces
écarts ne touche ce qui est écrit.

---

## 2026-08-07 — Le premier passage sur iPhone

Neuf défauts remontés, dont deux qui n'existaient pas là où on les cherchait.

**La zone sûre est posée une fois, dans la coquille.** Le titre passait sous
l'encoche sur tous les écrans. Les marges sont appliquées à la main plutôt que
par `SafeAreaView` : ce dernier les pose côté natif, dans une vue que le style
JavaScript ne montre pas — l'intention devient invisible en lecture et
invérifiable en test. Un `View` avec `useSafeAreaInsets` dit ce qu'il fait, et
un test le vérifie avec les marges d'un iPhone 13 injectées par
`initialMetrics` — le seul moyen de l'éprouver hors appareil.

**Les cinq flèches identiques étaient le caractère de repli de la barre
d'onglets.** Aucune `tabBarIcon` n'était déclarée. Sept icônes ajoutées au jeu,
posées dans la navigation et non dans les écrans : une icône d'onglet est une
propriété de la navigation.

**Les photos n'étaient pas mal adressées, elles n'étaient jamais demandées.**
`BusinessCard` ne recevait aucune couverture, et son repli au monogramme passait
pour un défaut de chargement. Deux choses manquaient derrière : l'URL rendue
était **relative** — un composant `Image` ne connaît pas la base de l'API — et
la route exigeait une authentification que `Image` ne sait pas porter, ni sur le
web ni uniformément sur mobile.

La route des photos est donc devenue **publique**. Une photo de couverture est
montrée dans le fil à tout créateur : elle n'est pas confidentielle, et une
route protégée dont personne ne peut se servir ne protège rien — elle casse. Ce
qui reste protégé, ce sont les preuves, par le filtre de préfixe, quel que soit
le porteur.

**Le choix de créneau montrait l'horizon entier.** Trente jours, plusieurs
centaines de départs, aucune date, et le bouton de confirmation hors de vue. Un
jour d'abord, puis ses créneaux seulement, séparés à midi — la coupure que tout
le monde a en tête — et le bouton fixé sous la liste. Le regroupement se fait
dans le fuseau **du commerce** : un créneau de 23 h à Miami tombe le lendemain
en UTC, et classer sur la date brute placerait des rendez-vous du soir au jour
suivant.

**Le code de retrait s'appelait en boucle.** La relecture était déclenchée
depuis un *updater* d'état — que React exécute deux fois en développement — et
le décompte repartait de la réponse à chaque tour. Le décompte est maintenant
piloté par une **échéance** retenue en référence : un compteur se remet à zéro à
chaque rendu, une échéance non. Et rien ne tourne quand l'écran n'est pas
visible : un onglet quitté laisse l'écran monté, et le minuteur continuait.
Mesuré : un appel en douze secondes à l'écran, zéro depuis un autre onglet.

**Le code n'était atteignable qu'après la confirmation.** Fermer l'application
le faisait perdre jusqu'au rendez-vous, alors que c'est la seule chose à montrer
au comptoir. Une réservation confirmée y mène désormais depuis l'historique, une
prestation consommée mène à sa contrepartie. Les lignes qui ne mènent nulle part
ne sont pas pressables : une ligne qui répond au doigt sans rien ouvrir apprend
à ne plus essayer, et c'est tout l'écran qui devient inerte.

**L'écran des paliers affichait bien ses obstacles.** Ce qui manquait était la
**plateforme** : six paliers portaient trois libellés répétés deux fois, et
« story fermé » juste sous « story ouvert » se lisait comme une contradiction.
Le message d'absence de compte disait par-dessus le marché « connectez un compte
Instagram » sur un palier TikTok, à quelqu'un qui avait déjà connecté Instagram.
Le code du serveur ne porte pas la plateforme — c'est le palier qui la porte,
et il la passe maintenant au message.

**Le rayon passe de 2 à 15 km, et devient réglable depuis le fil.** Miami est
une ville de voiture ; deux kilomètres ne couvrent qu'un quartier et ne
montraient qu'un salon. Le réglage vit dans le fil et non seulement dans son
état vide : un fil maigre n'est pas un fil vide, et il faut pouvoir l'élargir
sans avoir à le vider d'abord.

## 2026-08-07 — L'adresse de l'API se déduit du serveur qui sert le bundle

`EXPO_PUBLIC_API_URL` devient un contournement, plus la voie normale. L'adresse
vient de `hostUri` sur l'appareil, de `location.hostname` sur le web.

Raison : la demander à la main ouvrait deux façons de se tromper, et les deux se
présentaient à l'identique sous « Network request failed » — `localhost`, qui
désigne le téléphone, et une adresse d'hier après un changement de réseau. Les
deux se sont produites. La machine qui vient de servir le bundle est joignable
par construction et héberge l'API : elle n'a pas à être redemandée.

Le port ne se déduit pas — rien dans 8081 ne dit 8010 — et l'absence d'adresse
reste un écran explicite : un repli sur `localhost` marcherait en développement
et reproduirait l'échec ailleurs.

## 2026-08-07 — Le code de retrait appartient à sa réservation, et à la pile des réservations

Deux corrections liées, du deuxième passage sur iPhone.

**Le code, son échéance et le numéro de réservation sont une seule valeur.**
Ils vivaient dans trois emplacements séparés ; ouvrir une autre réservation
réutilise l'écran sans le démonter, l'échéance précédente n'était pas passée,
rien n'était redemandé — et toutes les réservations montraient le même code et
le même QR. Les lier rend la faute impossible à réécrire.

**Le code et la preuve passent de la pile de découverte à celle des
réservations.** Ils y avaient été empilés parce que c'est du fil qu'on réserve,
ce qui affichait le code à l'intérieur de l'onglet « à proximité ». La
confirmation bascule d'onglet et laisse la découverte revenir à son fil.

Au passage : une réservation seulement retenue n'a pas de code, la ligne ne le
propose plus ; et quand le serveur refuse, l'écran le dit au lieu d'attendre
sans fin — la règle « hors ligne, on garde ce qui est à l'écran » ne vaut que
s'il y a quelque chose à garder.

## 2026-08-07 — Direction visuelle : le sombre garde ses fonds, pas son noir

Constat sur appareil : trop sombre, trop plat. Les fonds passent d'un gris
neutre presque noir à une encre indigo-prune légèrement colorée, sur quatre
niveaux qui se distinguent réellement. Un second accent chaud entre dans la
palette, et les trois paliers reçoivent trois teintes franchement distinctes —
ils étaient gris, aqua et blanc, indiscernables deux sur trois.

La règle des trois marqueurs redondants ne bouge pas : la couleur ne porte
aucune information seule, le mot et le glyphe restent obligatoires.

Le mouvement entre dans le système, limité à l'opacité et à la transformation
comme `motion.animatableProps` le demandait déjà, et **suspendu quand l'appareil
demande de réduire les animations** : une cascade est un symptôme pour qui a des
vertiges vestibulaires, pas une décoration.

## 2026-08-07 — Le rappel OAuth ramène dans l'application

Le rappel d'autorisation arrive sur le serveur ; l'application est ailleurs, sur
un téléphone, à une autre adresse. Le parcours se terminait donc sur une réponse
JSON affichée dans le navigateur : le compte était rattaché et l'application ne
le savait jamais.

L'application fournit son adresse de retour à l'ouverture, le serveur la garde
avec l'état OAuth et redirige dessus. Elle est **contrôlée à l'ouverture** contre
une liste fermée de schémas : suivre une adresse fournie par le client ferait de
ce rappel une redirection ouverte, de quoi faire aboutir un parcours
d'autorisation BIND sur un site tiers. Contrôlée à l'ouverture et non au rappel,
parce qu'au rappel la personne a déjà autorisé chez Meta.

La redirection ne porte qu'un statut, jamais le code ni le jeton : ils ont été
échangés côté serveur, et une adresse se dépose dans l'historique du navigateur
et dans les journaux du système.

## 2026-08-07 — Le fil dit toujours pourquoi il est vide

Trois décisions, toutes venues d'un essai sur un vrai compte Instagram.

**Le fil nomme le cas de l'ensemble vide.** Sans compte social, le moteur n'a
aucun couple à évaluer, donc rien à reprocher : le fil rendait zéro commerce
**et** zéro obstacle. Le message était laissé à l'écran des paliers — décision
explicite, et démentie à l'usage : le fil est le premier écran qu'on ouvre, et
la seule explication qui restait à l'app était « rien autour de toi », fausse,
qui envoie élargir un rayon dont la taille ne changera rien.

**Une seule raison à la fois, la plus en amont.** Les obstacles s'empilent — un
compte neuf en porte trois. Les afficher côte à côte donnerait trois actions
dont deux sans effet tant que la première n'est pas levée. Le catalogue est
ordonné comme la chaîne : sans compte, pas de relevé ; sans relevé, pas de
palier ; sans palier, la distance ne veut rien dire. Les autres obstacles
restent lisibles dessous.

**Le rattachement planifie le premier relevé.** Les deux travaux d'un compte
étaient laissés à la réconciliation périodique. Correct pour un compte de longue
date, faux pour un compte qu'on vient de rattacher : tant qu'elle n'a pas
tourné, aucun relevé n'existe, le moteur n'a aucun chiffre à juger, et le
créateur voit un fil vide juste après avoir connecté son compte.

## 2026-08-08 — Un compte social porte le fournisseur qui l'a créé

Un compte rattaché en démonstration porte un jeton qui n'existe chez personne.
Le jour où `SOCIAL_PROVIDER` passe en réel, il devient irrécupérable — et l'app
proposait « reconnecter », ce qui aurait créé un **autre** compte en laissant
celui-ci mort à côté. Rien dans la ligne ne permettait de le deviner après coup :
la colonne `provider_mode` l'écrit au rattachement.

**Le mode vient du fournisseur, pas de la configuration.** Les deux divergent :
le jeu de données construit ses propres fournisseurs simulés quel que soit le
réglage déclaré. Lire le réglage aurait marqué ses comptes comme réels, soit
exactement le cas qu'on cherche à détecter. Chaque fournisseur déclare donc ce
qu'il est.

La colonne est nullable et **sans remplissage rétroactif** : les lignes
antérieures ont un mode inconnu, et le deviner serait une invention. Inconnu ne
conclut rien.

## 2026-08-08 — L'adresse de retour OAuth accepte les origines déjà de confiance

Sur le web, l'adresse de retour est celle de la page, en `http` ou `https`. Les
autoriser en bloc rendrait la redirection ouverte ; on réutilise donc
`CORS_ORIGINS`, la liste des origines à qui l'API accepte déjà de parler, plutôt
que d'en tenir une seconde qui finirait par diverger. Sans cela, le rattachement
était impossible dans un navigateur, et le refus revenait sous « information
manquante ou incorrecte », qui n'aide personne.

## 2026-08-08 — La file à trancher n'est pas un planning

Les réservations en attente du commerce sont rendues **hors de la journée**,
toutes dates confondues. Bornées au jour affiché, une décision à prendre pour
après-demain n'apparaissait dans aucune page qu'on ouvre : la créatrice
attendait une réponse que personne ne voyait à donner.

Elles sont posées en tête de l'écran de journée plutôt que sur un écran à part :
c'est là que le commerce regarde, et une file rangée ailleurs se consulte quand
on y pense.

## 2026-08-09 — Deux compartiments d'objets, et non un seul filtré

Les photos de salon et de prestation sont publiques ; les preuves de publication
ne le sont jamais. Elles vivent donc dans **deux compartiments distincts**, et
non dans un seul où l'API ne servirait que le préfixe `photos/`.

Un compartiment public s'énumère : qui connaît son adresse en liste le contenu.
Filtrer côté API protégerait la route et laisserait le compartiment ouvert.

La liste des préfixes publics est **fermée**, et tout ce qui n'y figure pas va
dans le privé. L'inverse — nommer ce qui est privé — ferait d'un oubli une
fuite ; ici, un oubli ne produit qu'une lecture qui passe par l'API.

Une preuve ne se sert jamais par un lien direct : l'API rend une adresse signée
de cinq minutes. Une adresse signée est un droit de lecture transmissible qui
voyage dans un historique de navigateur — assez longue pour ouvrir l'image
demandée, trop courte pour être partagée utilement.

## 2026-08-09 — Le jeu de données vérifie la base, pas seulement l'étiquette

`demo` rejoint les environnements où la commande accepte d'effacer. Le nom de
l'environnement dit ce que la configuration prétend être ; il ne dit pas quelle
base est visée, et une variable mal posée suffirait à faire passer une base pour
une autre.

Sur un environnement dont la base est distante, la commande exige donc en plus
que `SEED_DATABASE_NAME` nomme exactement la base visée. Viser autre chose
demande deux gestes délibérés — mentir sur l'environnement, puis nommer la base
à détruire — au lieu d'un seul oubli.

`production` n'est ni dans la liste des environnements autorisés, ni dans celle
des distants : l'ouverture faite pour la démonstration ne l'englobe pas d'avance,
et deux tests le vérifient — l'un sur le comportement, l'autre sur la liste
elle-même.

## 2026-08-09 — Le garde-fou regarde l'hôte, et vérifie avant d'écrire

Deux manques trouvés en écrivant le mode d'emploi de la commande distante.

**Le nom de la base ne suffit pas.** Celle de Supabase s'appelle `postgres`, le
nom le plus répandu qui soit : une base locale portant le même nom passait la
comparaison. Un environnement déclaré distant qui vise `localhost` est refusé —
c'est la forme qu'a l'accident, une variable oubliée dans un shell et la
configuration retombe sur le `.env` du poste.

**L'ordre comptait.** Les migrations tournaient avant le refus : la mauvaise
base était déjà migrée quand la commande disait non. Migrer ne détruit rien,
mais une écriture reste une écriture, et « refuser plutôt qu'agir » ne souffre
pas d'exception d'ordre. Tout se vérifie maintenant avant la première écriture,
le dépôt d'objets compris — sans lui, le jeu de données échouait **après** avoir
effacé, laissant une base à moitié écrite.

## 2026-08-10 — Le motif d'un refus devient un code du vocabulaire fermé

`reason` était du texte libre sur les deux routes de décision. Le commerce y
écrivait en réalité une clé d'interface, le jeu de données une phrase française,
et l'écran d'arbitrage rendait la valeur telle quelle : « Le format n'est pas
celui attendu » au milieu d'une interface anglaise. Une phrase ne se traduit pas
à l'affichage.

Les quatre motifs deviennent une énumération de wire (`missing_mention`,
`missing_location`, `wrong_format`, `low_quality`), acceptée par les deux routes
et rendue dans la langue du client. Le texte libre est **refusé** plutôt que
toléré : l'accepter en plus rouvrirait le trou au premier appelant qui en
enverrait. Rien en base — le journal d'audit garde une colonne texte, et les
motifs écrits avant ce changement s'y lisent encore comme des phrases, ce que
l'affichage rend tel quel plutôt que de les effacer.

## 2026-08-10 — La file rend l'historique des demandes, et non le seul dernier motif

`dernier_motif` était calculé par une fenêtre `row_number() = 1`. Il devient
dérivé d'une liste `tentatives` relue en une requête, du plus ancien au plus
récent, avec l'acteur de chaque demande. Raison : c'est la répétition qui
justifie l'escalade, et l'arbitre décidait sans la voir. Toujours rien de
dupliqué sur la contrepartie — le journal reste la seule vérité.


## 2026-08-10 — Le préfixe de la clé dit si la photo est vraie ou générée

Une photo fournie se range sous `photos/business/…`, un dégradé de secours sous
`photos/genere/business/…`. Raison : il fallait distinguer les deux pendant les
tests, et la clé est déjà renvoyée par l'API — elle se lit dans n'importe quelle
réponse, survit à une capture d'écran, et n'oblige aucun écran à porter un
repère de développement qu'on oublierait d'enlever. Rien n'a changé dans
l'interface.

## 2026-08-10 — Les photos réelles ne sont pas versionnées, et le semis s'en passe

`assets/photos/` est ignoré par git : vingt fichiers de plusieurs mégaoctets
entrent dans l'historique pour toujours et rien ne les en sort. Le semis retombe
sur ses dégradés générés pour tout fichier absent et **nomme les chemins
manquants** au lieu d'un décompte — les photos arrivent par vagues, et « 6
générées » n'apprend pas lesquelles aller chercher. L'intégration continue
tourne donc entièrement sur le repli, ce qui en fait un chemin éprouvé à chaque
exécution plutôt qu'une branche de secours jamais empruntée.

## 2026-08-10 — Redimensionnement au dépôt, avec Pillow en dépendance de développement

Une photo de banque d'images fait 4000 pixels et huit mégaoctets ; les
couvertures tombent à 140 Ko une fois réduites. Le décodage vit dans le semis,
jamais dans le produit : l'API sert des octets déjà rangés et n'ouvre aucune
image, donc Pillow reste hors des dépendances d'exécution. Absent, le semis
dépose les originaux et le dit — dégradé, pas cassé.

## 2026-08-10 — `platform_asset` porte ce qui n'appartient à aucun commerce

Les six pastilles de catégorie et le média d'accueil ne peuvent se ranger ni sur
`business` ni sur `catalog_item`. Les recalculer était impossible — la clé est
une empreinte du contenu — et les écrire en configuration aurait mis une valeur
produite par le dépôt d'objets dans un fichier tenu à la main. Une table à deux
colonnes, un slug lisible (`category/beauty`, `home/video`), et `GET
/platform-media` qui rend les six catégories **même sans photo** : le `None` est
une réponse, l'absence de ligne n'en est pas une.

## 2026-08-10 — La vidéo d'accueil est réencodée à la main, et le semis surveille le poids

La vidéo fournie faisait 39 Mo (4K, 60 im/s) pour 12 secondes servies en fond
d'écran d'accueil. Réencodée en 720p à 30 im/s : 2,8 Mo, même durée, différence
invisible sur un téléphone. Le réencodage reste **manuel** — l'automatiser
demanderait `ffmpeg` au moment du semis, une dépendance d'un autre ordre que
Pillow pour un fichier unique qui change une fois par an.

Ce qui est automatisé, c'est le **constat** : tout média rangé au-delà de 8 Mo
est signalé nommément à la fin du semis, et un test l'érige en condition. Le
seuil ne refuse rien — le semis ne décide pas qu'une démonstration ne peut pas
avoir lieu — mais un média trop lourd ne se découvre plus devant quelqu'un.
## 2026-08-10 — Une erreur de dépôt porte le statut HTTP, le compartiment et la clé

`ObjectStoreError` disait « dépôt S3 refusé : ClientError », et l'exception
sous-jacente affichait « An error occurred () » — code et message vides. C'est
ce que produit `botocore` quand le corps de la réponse n'est pas le XML S3
attendu, ce que fait Supabase sur ses propres refus. Deux diagnostics ont été
perdus dessus.

Le **statut HTTP est présent même quand le reste est vide**. Il est désormais
extrait, avec le compartiment visé, la clé et la taille : `http=413, sur
bind-prive, 62914560 octets` se lit d'un coup, là où le texte nu laissait
soupçonner un problème de droits.

Conséquence trouvée en chemin : `lire` détectait une absence en cherchant
« 404 » dans le **texte** de l'exception. Message vide, donc jamais trouvé — un
objet absent remontait en panne, et `GET /media/{clé}` rendait 503 au lieu de
404. La décision se prend maintenant sur le statut.

## 2026-08-10 — La sonde de déploiement éprouve le gabarit, pas seulement la joignabilité

Un témoin de vingt octets prouve qu'un compartiment existe et répond. Il ne
prouve rien de sa **limite de taille par fichier**, que Supabase fixe par
compartiment : le témoin passe, et le refus arrive plus tard sur une vraie
preuve, envoyée par un vrai créateur, qu'on ne peut pas lui redemander.

La sonde dépose donc en plus une charge à `proof_fetch_max_bytes` — la plus
grosse chose que le produit puisse ranger — et la retire aussitôt, pour ne pas
faire grossir le dépôt à chaque déploiement. Un 413 y est traduit en clair, avec
les deux façons d'en sortir.

## 2026-08-10 — La charge du QR vient de l'API, jamais d'une composition dans l'app

L'écran du créateur assemblait `bookingId:code` ; la vérification attend
l'identifiant du **code de retrait**, que l'API rend déjà tout formé sous
`payload` — le type client ne le déclarait même pas. Le QR se lisait
parfaitement et la caisse le refusait, sans que rien ne dise pourquoi.

Deux façons de former une même valeur finissent toujours par diverger. Celle qui
fait foi est celle du serveur.

Corollaire tranché au passage : **le nombre à six chiffres ne se saisit pas**. Il
tourne avec le temps et ne désigne rien sans l'identifiant que porte le QR ; le
code destiné à la frappe est le code de secours. L'écran du créateur le dit
maintenant, parce que les chiffres sont ce qu'on lit en premier.

## 2026-08-10 — Une couverture de carte suit le rapport de l'image, pas une hauteur fixe

208 points de haut ne valent le 16:9 des couvertures qu'à une seule largeur
d'écran. Partout ailleurs, `resizeMode="cover"` rognait — et ce qu'il rognait
était le sujet. La boîte porte donc un `aspectRatio`. La hauteur d'une carte
reste identique d'une carte à l'autre : elle découle de la largeur, qui est la
même pour toutes.

## 2026-08-11 — Le score de fiabilité accompagne les paliers ; le compte dans le rayon, non

`reliability_score_too_low` ferme des paliers en citant un seuil, et rien ne
renvoyait le score : l'écran affichait une condition que le créateur ne pouvait
comparer à rien. Les deux termes vivent déjà sur `creator_profile`, écrits par
`reliability.rafraichir` — une lecture de plus dans la requête qui portait déjà
`is_new_creator` suffit. Les trois champs sont lus **d'un coup** : le badge
« nouveau créateur » et le score sortent du même `NULL`, et deux lectures à deux
instants pourraient les faire se contredire.

Le second manque de la passation v0.7 — « 9 prestations dans 15 km » — n'est
**pas** branché. Aucune position n'est stockée : `GET /businesses` reçoit
longitude et latitude de l'appelant, précisément parce qu'un créateur consulte
le fil là où il se trouve et non dans la ville qu'il a déclarée. Compter dans un
rayon depuis `/me/tiers` demanderait de lui passer la même position, donc de
faire dépendre du lieu une route qui n'en dépend pas. C'est un changement de
sens de la route, pas une jointure. En attendant, le compte global reste seul,
et la ligne « les comptes couvrent tout BIND » dit sa portée.

## 2026-08-11 — Le bandeau de principe emprunte les teintes du thème opposé

Le diagramme des trois formats se pose sur `bg.inverse`. Les teintes de palier du
thème courant y sont sombres sur sombre : `tier.story` clair sur `bg.inverse`
clair donne 2,9 de contraste, `tier.reel` 2,5, sous les 3 exigés pour un objet
graphique. Le jeu de jetons de l'autre thème est calibré pour ce fond-là — c'est
d'ailleurs celui que la maquette dessine. Une surface inversée porte donc les
couleurs du thème inversé, dans les deux sens. Aucun jeton ajouté.


## 2026-08-11 — Les critères de publication appartiennent au comptoir, pas à l'historique du créateur

`ReservationDuCreateurRead` déclarait `required_mention` et `required_geotag`,
que la structure du service ne portait pas : `GET /me/bookings` levait à la
validation de réponse, sur chaque appel. L'exception passe **hors** de
l'intergiciel CORS, qui n'a donc jamais posé son en-tête — l'app lisait un refus
de CORS et cherchait la panne du mauvais côté.

Ils étaient tombés du mauvais côté. Le comptoir en a l'usage : c'est lui qui
vérifiera la publication, et `ReservationDuCommerceRead` les omettait alors que
le service les portait déjà — l'écran de journée les affichait vides, sans
erreur. Le créateur, lui, lit ses obligations sur la contrepartie, où elles sont
figées à sa création (SPEC §2.4) ; les rendre aussi sur la réservation
donnerait une seconde source, qui dérive dès que le salon change ses exigences.

Le défaut symétrique de celui des photos, et il coûte plus cher : un schéma
d'écriture qui ignore un champ rend un 200 mensonger, un schéma de lecture qui
en exige un rend un 500 permanent. `test_schemas_ecrits.py` éprouve désormais
les deux sens, sur les vingt-six couples `X` / `XRead` du projet.

Ce que la garde ne couvre pas : le contrat entre l'API et `app/src/api/types.ts`,
écrit à la main. `openapi.json` ne porte que les chemins, par choix assumé — et
c'est ce qui a laissé `ReservationDuCommerce` déclarer côté app deux champs que
l'API ne rendait pas.

## 2026-08-11 — Les comptes des issues du fil sortent du même tamis que la liste

« Élargir à 5 km · 9 salons », « Retirer le filtre Spa · 34 salons » : la
passation exige qu'aucune issue ne se propose à l'aveugle, donc que le chiffre
soit vrai. Or le seul filtre du fil qui ne s'exprime pas en SQL — reste-t-il un
créneau — est aussi le plus discriminant. Un compte pris sur la requête
géographique seule aurait annoncé des salons complets.

Le fil interroge donc **une fois au rayon le plus large configuré**, sans filtre
de catégorie, applique le contrôle de disponibilité une fois, puis découpe : la
liste, les comptes par catégorie, les comptes par rayon. Ils ne peuvent pas se
contredire, puisqu'ils sortent du même ensemble. Compter chaque rayon par une
requête de plus aurait refait tout le contrôle de disponibilité à chaque fois.

Le coût est réel et assumé : le contrôle porte désormais sur les lignes du plus
large rayon configuré, pas du rayon demandé. À revoir si `feed_radius_options_metres`
s'allonge, ou le jour où le fil se paginera.

Deux règles que les tests figent, chacune éprouvée sur sa mutation :

- Les comptes par catégorie **ignorent le filtre de catégorie en vigueur** —
  « Retirer le filtre Spa » se lit depuis le filtre Spa, et les appliquer à la
  requête ferait disparaître les autres pastilles au premier clic.
- Les comptes par rayon **conservent** ce filtre. Les deux issues d'un fil vide
  ne se mélangent pas : relâcher les deux à la fois annoncerait un total que ni
  l'une ni l'autre ne rend.

Aucune issue n'est proposée à un créateur sans compte social : élargir n'y
changerait rien, et le proposer enverrait chercher ailleurs une cause qui est
ici. C'est le même piège de l'ensemble vide que les obstacles ont déjà connu.

**Recherche et rangées thématiques : non implémentées, et à trancher.** Le point
3 de la campagne les demande, la passation les exclut. `components.md` §« ce qui
n'existe pas » dit « pas de carrousel », `rules.md` §31 dit que les rangées de
chips sont en `flexWrap` et « jamais en défilement horizontal », et aucune
maquette — 03a à 03d — ne montre de champ de recherche. `api-map.md` ne connaît
au fil que `longitude`, `latitude`, `rayon_metres` et `categorie`, avec la
mention « **Pas de quartier, pas de curseur** ». L'entrée par quartier de la
maquette 03d tombe sous la même exclusion, et aucun modèle de quartier n'existe
en base.
