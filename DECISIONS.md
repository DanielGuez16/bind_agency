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
