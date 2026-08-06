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
