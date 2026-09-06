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

## 2026-08-11 — Une autorisation refusée ne se redemande pas, elle se réactive

`usePosition` avalait tout : refus, absence de service, panne du relevé,
ressortaient en « pas de position ». Le bouton « Share my location » restait
offert, et après un refus il ne produisait plus rien du tout — ni le système ni
le navigateur ne reposent la question, et `requestForegroundPermissionsAsync`
répond « refusé » sans rien afficher.

L'état est donc **lu avant d'être demandé**. Sur un refus acquis, on ne rejoue
pas une demande muette : on retire le bouton et on nomme le chemin exact vers le
réglage, qui n'est pas le même dans un navigateur, sur iOS et sur Android.
« Dans les réglages » n'aide personne.

Quatre issues distinctes, parce qu'elles n'appellent pas la même conduite :
jamais demandée (redemander), en cours (attendre), refusée (réactiver),
indisponible (réessayer). Le relevé est borné à dix secondes : sans échéance,
un capteur qui ne rend pas la main se lit exactement comme « rien ne se passe ».

## 2026-08-11 — Le mot de passe se masque, et se relit

Le champ n'avait aucun `secureTextEntry` : le mot de passe s'écrivait en clair,
douze caractères en grand, sur le premier écran du produit. Masquer sans donner
le moyen de relire est l'autre moitié du défaut — c'est ce qui fait ressaisir
trois fois la même chaîne sur un clavier de téléphone.

`TextField` prend donc un `secret`, avec sa bascule. Elle porte son état et pas
seulement son action : une lecture d'écran doit pouvoir dire si le mot de passe
est visible en ce moment. Toujours masqué au montage, y compris après un échec
de connexion.

## 2026-08-11 — Le code de secours se groupe des deux côtés, sur le même jeton

La créatrice lit « PAP EDB », la caissière tapait « PAPEDB ». Six caractères
d'affilée se recomptent à chaque fois qu'on lève les yeux, et la dictée se suit
groupe par groupe ou pas du tout.

Le groupement porte sur les **positions**, pas sur ce qui est déjà saisi : groupé
sur la valeur, le champ changerait de forme à chaque touche et les caractères
déjà tapés glisseraient sous les doigts. `tokens.code.manualGroupSize` fait foi
des deux côtés — deux constantes finiraient par diverger.

L'écart entre groupes est porté par le conteneur, jamais par un séparateur
dessiné : un tiret se dicterait avec le code. Et le nom accessible reste épelé
caractère par caractère — « PAP EDB » se prononcerait.

## 2026-08-11 — Une décision nomme ce sur quoi elle porte

« Approve » ne disait pas ce qu'on approuvait. À l'œil, le panneau ouvert
au-dessus le dit ; à l'oreille, la barre arrive seule, et trois boutons
identiques d'un dossier à l'autre ne se distinguent plus.

Le libellé nomme donc l'objet — la publication — et le nom accessible ajoute le
créateur, la prestation et le commerce. Le commerce et l'arbitre gardent le
**même** vocabulaire, règle déjà éprouvée par un test : changer le libellé de
l'arbitre seul aurait forcé chacun à traduire l'autre.

## 2026-08-11 — Le taux d'honoration s'écrit en fraction, plus en pourcentage

« 29 % » s'affichait au-dessus de sa propre note, « 2 of 7 », qui vaut 28,57.
Un seul calcul, mais arrondi à l'entier au-dessus de la fraction qu'il résume.
Aucun arrondi ne les réconcilie : sur sept prestations, un point de pourcentage
n'existe pas.

La fraction devient le chiffre, la note dit ce qu'elle compte. C'est la règle
que la maison applique déjà à l'activation — « 2 étapes sur 4 » se comprend,
« 50 % » ne dit pas laquelle manque. `taux_d_honoration` reste rendu par l'API :
il est juste, et c'est une donnée de reporting légitime.

## 2026-08-11 — Confirmer une réservation mène à la liste, pas au code

Deux raisons, et la seconde est une panne. La prestation est souvent dans
plusieurs jours, et un code qui tourne toutes les trente secondes ne sert à rien
avant d'être debout au comptoir. Surtout, la validation par le commerce est le
comportement par défaut (SPEC §4.1) : la réservation qu'on vient de confirmer
est en `awaiting_business`, et **le code naît à l'arrivée dans `confirmed`**.
L'écran s'ouvrait donc sur un refus du serveur, juste après le geste le plus
engageant du parcours.

La liste confirme que la place est prise, porte la date, et c'est de là qu'on
rouvre le code le jour venu — chemin ajouté à la campagne précédente.

## 2026-08-11 — Toutes les dates passent par `format.ts`

Sept endroits reformataient à la main ce que `format.ts` faisait déjà :
`toLocaleString()` sans options rend « 11/08/2026 16:45:00 », un mois en
chiffres que la moitié du monde lit à l'envers et des secondes sur un
rendez-vous en salon.

Une garde de source l'interdit désormais hors de `format.ts`. Elle cherche le
**nom de la méthode**, où qu'il soit sur la ligne : les six appels s'écrivaient
de trois façons, et une garde calée sur la première en aurait laissé passer
deux. Deux tolérances, nommées : `format.ts` lui-même, et la clé de
regroupement ISO de `CreneauxScreen`, qui n'est jamais affichée.

Conséquence assumée : **l'horloge du comptoir suit maintenant la langue**. La
journée la forçait sur vingt-quatre heures, à côté d'une échéance de publication
qui passait par `formatDateTime` et s'écrivait en AM/PM — deux horloges sur le
même écran, à Miami, où l'on compte en douze.

## 2026-08-11 — Un palier fermé porte toujours un obstacle, même jamais évalué

Le moteur d'éligibilité n'évalue que les couples (compte, palier) **de même
plateforme**. Un palier TikTok chez quelqu'un qui n'a connecté qu'Instagram n'a
donc aucun couple, donc aucun obstacle à reprocher : la fiche affichait « pas
encore ouverte à toi » et rien d'autre. Ce n'est pas un accès sans reproche,
c'est un accès jamais examiné.

Le cas est plus fréquent que l'absence totale de compte — il suffit d'un salon
qui compose un palier sur un réseau qu'on n'a pas — et invisible dans des tests
qui n'emploient qu'Instagram. `no_social_account` est la bonne raison, et l'app
la rend déjà avec la plateforme du palier : « connecte un compte TikTok »,
jamais un « connecte un compte » qui laisserait chercher lequel.

Troisième occurrence du piège de l'ensemble vide, après `creator_tiers` et le
fil. Il valait aussi sur l'écran où l'on vient pour réserver.

## 2026-08-11 — Les plateformes rattachables se comparent entre les deux dépôts

`PlateformeConnectable` est écrite à la main dans `types.ts`, `PLATEFORMES_BRANCHEES`
vit dans `providers.py`. Deux listes de la même chose, dans deux langages, que
rien ne rapprochait — et le contrat de chemins ne pouvait pas les rapprocher :
`openapi.json` ne porte que les routes, par choix assumé, et une plateforme
n'est pas une route.

Ce n'est pas théorique. Snapchat existe déjà en base et dans les paliers, et la
fabrique **lève** au lieu de rendre un fournisseur muet : le jour où l'app
l'offrirait sans que le serveur l'implémente, le bouton mènerait à une erreur
serveur, sur l'écran dont le seul rôle est de dire quels réseaux rattacher.

Un test lit les deux sources et les compare. Comparer des sources plutôt que des
routes est inhabituel ici ; c'est le seul moyen tant que la liste ne transite
pas par l'API, et elle n'a aucune raison d'y transiter pour deux valeurs.

## 2026-08-11 — Une annulation n'est pas une panne

Toutes les fins prématurées d'une requête se ressemblent à l'arrivée : `fetch`
lève la même `AbortError`. Elles n'ont rien en commun. Une annulation par
l'appelant est le fonctionnement normal — on change d'écran, on change de
filtre, la requête en vol ne sert plus. Une échéance dépassée est une panne. Une
levée inattendue est un défaut de programmation.

Les trois s'écrivaient `console.error` : `/businesses` et
`/business/{id}/collaborations` remplissaient la console d'erreurs rouges à
chaque geste, et la vraie panne s'y noyait. Ce qui rend un journal inutile est
le bruit, pas le silence.

Trouvé en écrivant le test : **un signal déjà avorté n'émettait plus rien**.
L'appelant peut annuler avant que la requête parte — le temps de lire le
coffre, un écran a pu être quitté. S'abonner ne suffisait pas, l'événement était
passé : la requête partait pour de bon et attendait ses quinze secondes.

## 2026-08-12 — Les fontes sont chargées, et la graisse fait partie du nom

`tokens.json` nommait trois familles, `Texte` les demandait par `fontFamily`, et
aucune n'existait dans le dépôt : ni `expo-font`, ni un seul fichier de fonte.
Tout le produit rendait en police système — SF Pro sur iPhone, Helvetica dans le
navigateur — sans qu'aucune erreur ni aucun test ne le signale. C'était le seul
écart de rendu portant sur cent pour cent des écrans à la fois.

Chaque graisse est enregistrée sous son propre nom, « IBM Plex Sans 600 », et
`Texte` demande ce nom-là. Sur iOS et Android, `fontWeight` ne choisit pas un
fichier : une graisse absente est **synthétisée** par le moteur, ce qui donne un
gras épaissi au lieu du dessin voulu. Le web suit le même chemin, ce qui évite
d'avoir deux comportements à tenir d'accord.

Les familles restent dans les jetons et nulle part ailleurs — un test parcourt
les sources et refuse tout nom de fonte écrit hors du dossier du thème. Changer
de direction artistique, c'est changer la ligne du jeton et l'entrée de fichier
correspondante dans `polices.ts`, deux endroits adjacents.

## 2026-08-12 — L'élévation vient du thème, pas du jeton seul

`elevation.0/1/2` existaient depuis la v0.4 et n'étaient lus par aucune ligne de
`src/` : toutes les surfaces du produit vivaient sur le plan du fond, séparées
par un filet de 1 px. Le jeton porte une ombre calibrée sur fond sombre ; posée
telle quelle sur le thème clair, elle écrase. La fonction `elevation()` la ramène
à douze pour cent en clair, ce que la maquette dessine, et rend les trois formes
que les plateformes attendent — `shadow*` sur iOS, `elevation` sur Android,
`boxShadow` sur le web — depuis les mêmes nombres.

## 2026-08-12 — Un cran de densité en grand écran, identique aux deux rôles

`Ecran` appliquait la densité du rôle à toute largeur. Le commerce, calibré pour
un téléphone posé au comptoir, était donc **plus serré que le créateur** sur un
bureau de 1512 — 16 contre 20 — l'inverse de ce qu'une grande surface demande.
Les deux passent à 24, comme la maquette. La densité compacte ne bouge pas :
c'est là qu'elle a sa raison d'être.

## 2026-08-12 — La proposition de palier ne s'écrit nulle part

La plateforme situe une prestation à partir de son prix **et de son rang parmi
les prix de son catalogue** : un soin à 90 dollars est haut de gamme chez un
barbier et courant dans un spa. Le calcul se fait à l'affichage, jamais en base.

Trois raisons, dont chacune suffirait. La proposition dépend du catalogue
entier, donc une valeur stockée serait périmée dès qu'un prix bouge ailleurs.
Recalculer coûte un tri sur des lignes déjà chargées. Et une proposition sans
trace ne peut pas usurper l'autorité du choix du commerce — une colonne posée à
côté de `tier_id` finirait par le faire.

Sous trois prix **distincts**, aucune proposition. Il n'y a pas de distribution
à lire dans deux prix, ni dans dix lignes au même tarif, et conseiller quand
même reviendrait à inventer sur l'écran où le commerce décide. Deux prix égaux
reçoivent toujours le même palier : sans cela, deux manucures à 45 dollars
tomberaient de part et d'autre d'une frontière selon leur ordre en base, et le
commerce lirait deux conseils contradictoires sur deux lignes identiques.

Un parent de gamme est écarté de la distribution, et il se reconnaît à ce qu'il
**a des enfants** — jamais à son propre `parent_item_id`, qui est nul comme
celui de toute prestation de premier rang. C'est la définition qu'emploient déjà
le fil et le semis.


## 2026-08-12 — La géographie se résout d'un fichier local, jamais d'un service

Le lien traqué doit dire d'où viennent les gens. La question posée était :
comment, sans dépendance payante et sans stocker l'adresse.

**Un service hébergé est écarté pour la raison même qui motive la contrainte.**
Une API de géolocalisation, gratuite ou non, exige d'*envoyer* l'adresse à un
tiers — c'est-à-dire de faire exactement ce qu'on s'interdit de faire soi-même,
en s'en remettant à la politique de rétention de quelqu'un d'autre. Le quota et
le prix ne sont pas le vrai sujet.

**Retenu : une base MMDB locale**, lue par `maxminddb` (MIT). Deux bases
publiques la publient sans abonnement — DB-IP Lite City (CC BY, mensuelle, sans
compte) et MaxMind GeoLite2 City (gratuite, compte requis). Le lecteur est le
même : changer de base est une ligne de configuration. Aucun réseau, aucune
clé, aucun quota, et l'adresse ne quitte jamais le processus.

**Sans base, on ne devine pas.** Le résolveur absent rend `None` et le clic est
enregistré sans géographie. L'intégration continue tourne ainsi, aucun fichier
n'étant versionné. Un repli sur un pays par défaut contaminerait la part locale
de toutes les campagnes.

La granularité s'arrête à la ville, et les coordonnées rendues sont **le centre
de la ville** — identiques pour tous ses habitants. Elles situent une ville,
jamais quelqu'un.

## 2026-08-12 — L'adresse IP n'est jamais stockée, et l'oubli est définitif

Exigence, pas préférence. Trois choses la tiennent, et la troisième est celle
qui la distingue d'un pseudonymat.

**Aucune colonne n'existe pour elle.** Il n'y a pas de champ à oublier de
purger. Un test parcourt `information_schema` — le schéma entier, pas trois
colonnes choisies — et refuse tout nom ou type qui y ressemblerait.

**Elle sert à deux choses et disparaît avec la requête** : résoudre une ville,
calculer une empreinte de déduplication.

**Le sel de l'empreinte est tiré au hasard chaque jour et détruit avec elle.**
Une clé de configuration resterait, et avec elle la possibilité de recalculer
une empreinte des mois plus tard en tenant l'adresse d'origine. Le sel parti, ce
calcul n'existe plus pour personne — nous compris. La purge est un balayage de
la file de travail : sans lui, la garantie tiendrait dans une docstring.

L'empreinte inclut le lien. Sans cela, un même visiteur porterait la même
empreinte sur toutes les contreparties, et recouper deux liens dirait « ces deux
salons ont été vus par le même téléphone » — un recoupement qu'on ne veut ni
faire ni rendre possible.

## 2026-08-12 — Ce qu'on écarte laisse une trace, et ce qu'on doute ne condamne pas

**Trois filtres avant de compter** : agent utilisateur de robot déclaré (liste
fermée, agent vide compris), préchargement (`Sec-Purpose`, `Purpose`, `X-Moz`,
et `HEAD`), doublon d'empreinte dans la fenêtre. Chacun est enregistré **avec sa
raison** plutôt que jeté : un compteur qui n'avance pas s'explique mieux avec
« quatre-vingts préchargements » qu'avec le silence, et la forme des rejets est
le principal signal d'une campagne fabriquée.

**On ne prétend pas distinguer un humain d'un programme.** Ce serait faux, et le
prétendre ferait accuser des créateurs honnêtes sur une heuristique. Quatre
signaux nommés — une seule ville, un seul terminal, aucun référent, une majorité
de coups écartés — sont exposés **à l'administration seule**, avec le constat et
le seuil qui les ont déclenchés. Un doute n'est pas un fait : le montrer au
salon ferait refuser des publications que personne n'a arbitrées.

Rien n'est signalé sous trente clics : sur douze, toutes les proportions sont
aberrantes et aucune ne signifie quoi que ce soit.

## 2026-08-12 — La part locale se calcule, le score d'impact pèse zéro

Le clic garde le centre de sa ville ; la distance au salon se refait à la
lecture. Un booléen « local » figé au moment du clic cesserait d'être vrai le
jour où le rayon change — même règle que le score de fiabilité, recalculé depuis
ses événements plutôt qu'écrit à la main.

`local_impact_weight` vaut **zéro** et le reste tant qu'aucune donnée réelle n'a
été observée. La mécanique existe, se teste et s'expose ; le jour où elle
pèsera, ce sera une décision prise sur des chiffres, pas un effet de bord de sa
livraison.

Trouvé en écrivant les tests : la route de redirection **ne validait pas sa
transaction**. Elle redirigeait parfaitement et ne comptait jamais rien. C'est
le pire profil de défaut pour une route de mesure — tout fonctionne, sauf ce
qu'elle existe pour faire.
## 2026-08-12 — L'annuaire ne montre pas le score, et le palier le remplace

La note de cadrage demandait un annuaire des créateurs portant le score de
fiabilité. Le produit promet l'inverse à la créatrice, sur son propre écran et
dans les deux langues : « jamais comparé entre créatrices, jamais montré à un
commerce » — passation v0.7 §8.1, livrée en #74. Un annuaire l'affichant aurait
cassé les deux moitiés de la phrase d'un coup.

Le palier ouvert porte la même information sans la divulguer. Un score dégradé
plafonne la créatrice à un palier inférieur — c'est le moteur d'éligibilité qui
le fait, pas une règle d'affichage — si bien qu'un salon qui lit « ouvert au
palier reel » sait qu'elle tient ses engagements, sans le nombre et sans
pouvoir classer. L'interface le dit en une ligne : sans elle, un salon cherche
une note, ne la trouve pas, et conclut à un oubli.

**L'absence est tenue par le schéma**, pas par la discipline d'un écran. Une
donnée absente de `CreateurVuRead` ne peut pas fuir, quoi que le service
calcule. Un test compare le jeu de champs à une liste d'interdits.

L'abonnement est vérifié dans la route, jamais dans l'écran : le laisser
décider mettrait la vente derrière une condition d'affichage, et il suffirait
de demander la route. Un commerce sans abonnement reçoit un 402 nommé, pas une
liste vide — le vide se lirait « aucun créateur ».

L'évaluation se fait en mémoire : `eligibility.evaluer` est pure, on charge en
trois requêtes et on évalue chaque créatrice sans retourner en base. Une boucle
sur `evaluer_createur` aurait donné trois requêtes par ligne d'annuaire, un N+1
invisible à dix créatrices et fatal à trois cents.


## 2026-08-12 — Une note libre accompagne le motif, sans jamais le remplacer

**Cette décision révise `SPEC.md` §4.2**, qui refusait tout texte libre. La
règle d'origine avait une raison qui tient toujours : une phrase ne se traduit
pas à l'affichage, et elle ressortait sur l'écran de l'arbitre dans la langue de
qui l'avait écrite. Elle a aussi produit ce qu'elle ne prévoyait pas — un
dossier arrivant en arbitrage après trois allers-retours sans qu'aucune phrase
n'ait été échangée, un créateur lisant « mention manquante » sans savoir
laquelle ni où, un commerce refusant sans pouvoir dire ce qu'il voyait.

L'objection est traitée plutôt qu'ignorée, en quatre points :

- **Le code reste obligatoire** et porte le sens traduisible. La note ajoute ce
  qu'un code ne peut pas dire.
- **La note ne voyage jamais seule**, et c'est une contrainte de base
  (`ck_audit_log_note_accompagne_un_motif`), pas la discipline des appelants.
  C'était précisément le trou craint : « il suffirait d'un appelant ».
- **Elle est rendue telle quelle et jamais traduite**, comme le nom d'un item de
  catalogue. Le service d'emails appliquait déjà cette règle au motif.
- **Elle est immuable** comme la ligne de journal qui la porte : le trigger qui
  refuse tout UPDATE vaut aussi pour elle. Une note qu'on pourrait réécrire
  cesserait d'être ce qui a été dit au moment où ça a été dit, et c'est tout ce
  qui lui donne sa valeur devant un arbitre.

Le créateur dispose de la même chose sur sa soumission (`proof.note`), lue au
même endroit que sa preuve — sinon le commerce déciderait en ayant vu l'image
sans avoir lu la phrase.

Ce n'est **pas** une messagerie : ni fil, ni notification de message, ni réponse
hors décision. Une phrase attachée à un acte. La messagerie complète reste une
décision à part.

## 2026-08-12 — La base sonde du jeu de données dérive du nom de la base de test

`bind_seed_probe` était en dur. Deux copies de travail sur le même Postgres se
la détruisaient l'une à l'autre : chacune commence par un `DROP DATABASE ...
WITH (FORCE)`, et la seconde emportait la sonde de la première entre sa création
et son premier appel. L'échec ressortait en « database does not exist » sur du
code qui n'avait pas bougé, et coûtait un diagnostic à chaque fois.

Changer `TEST_DATABASE_URL` ne suffisait pas — ce nom-là ne s'en déduisait pas.
Il en dérive maintenant.

## 2026-08-12 — Les notifications push partent à côté des emails, jamais à leur place

Le produit ne savait prévenir que par email. Un créateur dont la réservation est
acceptée l'apprenait en ouvrant sa boîte ; un salon qui reçoit une demande à
valider ne l'apprenait qu'en ouvrant l'application — sur un produit où une place
se tient dix minutes et où une story vit vingt-quatre heures.

**Chaque envoi est appelé à côté de l'email, jamais dans une seconde détection
d'événement.** Détecter deux fois « le salon a accepté » ferait deux vérités qui
divergeraient à la première branche ajoutée, et c'est la branche oubliée qui
laisse quelqu'un sans nouvelle. Les gabarits sont les mêmes des deux côtés : un
titre de notification et un sujet d'email disent la même chose.

**Deux garanties, chacune tenue à deux endroits.** Un compte suspendu ou
anonymisé ne reçoit rien : le service refuse de servir un compte non actif, et
l'anonymisation révoque ses terminaux. L'un est une garantie permanente, l'autre
une transition ponctuelle ; la seconde peut être oubliée sur un chemin nouveau,
la première vaut sur tous.

**Un jeton de terminal se révoque comme un jeton social**, et au moment où le
fournisseur le déclare mort — c'est la seule occasion qu'on ait, il ne prévient
pas d'avance. Un échec passager, lui, ne révoque rien : couper les notifications
de quelqu'un dont le terminal va bien le laisserait sans rien à réparer.

**Une préférence absente vaut « oui ».** La table ne porte que les décisions
prises ; écrire sept lignes par personne à l'inscription en ferait sept dont
personne ne changera jamais aucune.

**Aucun contenu sensible dans une notification.** Elle s'affiche sur un écran
verrouillé : le titre dit ce qui s'est passé et chez qui, jamais le code de
retrait ni l'adresse.

**Non vérifiées de bout en bout**, et `TASKS.md` le dit — même statut que le
scanner caméra. Expo exige un identifiant de projet EAS et un build de
développement ; `PUSH_PROVIDER=log` est en service et trace ce qu'il aurait
envoyé. Tout ce qui est en amont du dernier saut est éprouvé.

## 2026-08-12 — L'autorisation de notification se demande une fois connecté

Jamais sur le premier écran. Une autorisation réclamée avant d'avoir montré à
quoi elle sert se refuse, et une fois refusée elle ne se redemande plus — c'est
la leçon de la position, où un bouton qui ne produisait plus rien a coûté une
campagne. Une fois connecté, il y a des réservations à suivre et des
publications à rendre : la demande a un sens.

**On ne redemande qu'où la fenêtre s'ouvrira encore.** `getPermissionsAsync`
est lu avant `requestPermissionsAsync` : après un refus définitif, le second
répond « refusé » sans rien afficher, et insister ne rouvre rien.

Le jeton se réaffirme à chaque démarrage — il change quand l'application est
réinstallée — et la route est un `PUT` pour cette raison. Un refus n'est pas une
panne : le produit fonctionne sans notifications, il prévient seulement moins
bien.

**Chaque rôle ne voit que les genres qui le concernent.** Le serveur les rend
tous les sept, il ne connaît pas l'écran ; c'est l'app qui choisit. « Une
réservation attend votre décision » ne veut rien dire pour un créateur, et un
interrupteur qui ne commande rien est pire qu'un interrupteur absent.

**Chaque bascule part seule et se corrige seule.** Un bouton « enregistrer »
pour sept interrupteurs ferait perdre six réglages quand le septième échoue. En
cas de refus du serveur, l'interrupteur revient où il était et le dit — le
laisser sur une valeur que le serveur ignore ferait croire à un réglage qui
n'existe pas.

## 2026-08-12 — La note ne part jamais sans son motif, côté app aussi

Le champ n'apparaît qu'une fois un motif choisi, et il n'est pas envoyé sur une
approbation. Les deux règles disent la même chose sous deux formes : le serveur
refuse une note seule jusque dans une contrainte de base, et l'app ne tente pas
de l'y faire entrer.

Le cas qui l'a fait écrire : choisir un motif, taper une phrase, puis changer
d'avis et approuver. Sans la seconde règle, la note partait seule et le serveur
refusait l'approbation — sur le geste le plus banal de l'écran. Un test l'a
attrapé ; une relecture ne l'aurait pas vu.

`NOTE_MAXIMUM` est recopié du serveur, et un test compare les deux valeurs —
même dispositif que le poids d'une capture, pour la même raison.

## 2026-08-12 — Le cas inverse de l'absence : signaler un déplacement pour rien

Un créateur qui ne vient pas produit un `no_show` et un événement de fiabilité
négatif. Un salon fermé, ou qui a oublié, ne produisait rien. Pire : la
réservation restait `confirmed`, si bien que le commerce pouvait encore marquer
absent quelqu'un qu'il n'avait pas reçu.

**Signaler ne coûte jamais rien à celui qui signale.** C'est la règle qui fait
exister le dispositif : un recours qui pénalise celui qui l'exerce n'est pas un
recours, il apprend à se taire. La réservation part en `cancelled` — ce que
`SPEC.md` §4.1 prescrit déjà pour toute défaillance qui ne vient pas du
créateur — et aucun événement de fiabilité n'est écrit sur lui.

**Et cela ferme la porte à la représaille.** `cancelled` est terminal : une fois
le signalement posé, le commerce ne peut plus marquer absent. Sans ce corollaire,
le recours ouvrait un risque au lieu d'en fermer un.

**La fenêtre s'ouvre à l'heure du créneau.** Pas avant — on ne signale pas un
déplacement qu'on n'a pas fait, et sans cette borne on pourrait annuler en
déguisant l'annulation en signalement, échappant à la fenêtre de vingt-quatre
heures. Quatre heures, en configuration. Un item sans créneau n'a pas de
fenêtre : il n'y a pas d'heure à laquelle on l'attendait.

### Ce qui est proposé plutôt que décidé

**L'abus.** Un signalement est une allégation : il ne compte contre le salon
qu'une fois arbitré, comme un dossier en revue humaine. Un signalement écarté
écrit un événement `abusive_report` **dont le poids vaut zéro** en
configuration — le mécanisme existe pour que la décision se prenne un jour sur
des chiffres, pas pour punir aujourd'hui quelqu'un dont le signalement n'a pas
été retenu, ce qui n'est pas la même chose qu'un mensonge. Le seul chiffre qui
parle d'abus est rendu **à l'arbitre** : combien de signalements de ce créateur
ont déjà été écartés.

**Le score du salon : rien n'est inventé.** Il n'existe pas de score de commerce
dans ce produit, et en créer un est une décision d'une autre taille que
celle-ci. Ce qui est livré est l'événement à partir duquel il se calculerait :
un compteur de signalements retenus, exposé au reporting du commerce et à
l'arbitre. Le jour où un score existera, il se recalculera depuis ces faits —
comme le score de fiabilité, jamais écrit à la main.

## 2026-08-12 — Géocodage : rien à faire, sauf ouvrir le compte

Vérifié plutôt que réécrit. `GeocodioGeocoder` existe depuis la phase 5, avec sa
clé en configuration, son seuil de précision, son délai, et le refus de démarrer
si la clé manque. Quatorze tests le couvrent. La ligne qui restait en phase 0
n'est pas du code : c'est l'ouverture du compte.

Geocodio tient toujours les trois critères — 2 500 requêtes par jour gratuites,
puis 1 $ les mille, sans abonnement et sans carte tant qu'on reste sous le
quota. À l'échelle de BIND, qui ne résout qu'à la création ou modification d'un
commerce et pas du tout quand les coordonnées sont déclarées, le quota gratuit
couvre le lancement sans marge à surveiller.

## 2026-08-12 — Des tests de bout en bout dans un vrai navigateur

Le trou structurel du projet. Trois défauts n'ont été trouvés que par
l'observation de quelqu'un qui ouvrait l'application : la vidéo d'accueil qui
ne jouait pas, les polices jamais chargées, la barre latérale jamais montée.
Aucun n'était visible d'un test unitaire — les doubles répondent ce qu'on leur
fait dire, et rien n'y charge de fonte, ne joue de vidéo, ni ne mesure une
fenêtre.

**Playwright sur le build web réel**, exporté par Metro, servi en statique,
parlant à une vraie API sur une vraie base, dans un job d'intégration continue
à part. Un seul navigateur : ce qu'on cherche n'est pas une différence de
moteur, c'est ce que le nôtre fait de notre application.

**Aucune reprise.** Un test de bout en bout qui ne passe qu'à la seconde
tentative est instable, et le masquer par une reprise le rendrait inutile.

**Les trois défauts historiques ont été rejoués en mutation.** Retirer
`playsInline`, ranger la barre latérale dans `screenOptions` comme à l'origine,
et vider la liste des fontes : les trois sont attrapés. C'est la seule preuve
qui valait quelque chose ici — une suite verte sur un produit sain ne dit rien.

### Ce que la première exécution a trouvé

**Un défaut de configuration :** l'origine du serveur statique n'était pas dans
`CORS_ORIGINS`, si bien que chaque requête partait et revenait en échec. L'app
affichait des écrans vides sans qu'aucune erreur ne remonte à l'utilisateur.
Invisible de tout test unitaire, par construction.

**Un défaut de produit, non résolu :** les trois `@font-face` sont déclarées,
servies, chargées — et **aucun élément du document n'emploie ces familles**.
Tout le texte du build web rend dans la pile système. La cause n'est pas
établie et la tâche est ouverte dans `TASKS.md`.

**Et un test creux, le mien.** La première version du fichier des polices
appelait `document.fonts.check('16px "Familjen Grotesk"')`, qui répond **vrai
même quand la famille n'existe pas** : le navigateur juge que le texte peut
être rendu, en repli. Le test passait sur un produit dont les polices ne
s'appliquent nulle part. Il ne restait vert que parce qu'il ne demandait rien.
On lit désormais les faces enregistrées une à une, sous leur nom exact.

**Un troisième, sur la machine d'intégration :** le dépôt objet vaut `memory`
par défaut. Le semis y déposait photos et vidéos, son processus se terminait,
l'API redémarrait sur un dépôt vide — toutes les clés en base, aucun octet
derrière, et la route de média répondait 404 sur tout. Le navigateur, lui,
rapporte `MEDIA_ELEMENT_ERROR: Format error` : le même message qu'un codec
absent. Deux exécutions ont cherché du côté du codec avant que le journal de
l'API ne montre les 404. Le test vérifie maintenant que la source répond 200
**avant** de demander si elle se lit — un fichier manquant et un fichier
illisible ne se diagnostiquent pas au même endroit, et le navigateur ne les
distingue pas pour nous.

## 2026-08-13 — Inscription sur le terrain : des faits, jamais des engagements

La fondatrice démarche en physique, tablette à la main. L'inscription autonome
demande une demi-heure au comptoir — identité, adresse, horaires, carte des
prestations avec leurs durées, photos, mot de passe, moyen de paiement — et
personne ne la fait pendant qu'un client attend. La visite se termine sur
« je le ferai ce soir », et ce soir n'arrive pas.

**La ligne de partage est celle-ci : elle peut saisir des *faits*, jamais des
*engagements*.** Nom, adresse, horaires, carte, photos : elle les connaît aussi
bien que le salon, et c'est là que sont les trente minutes. Mot de passe,
acceptation des conditions, mise en ligne : si elle les pose, personne ne peut
dire qui a accepté quoi, elle détient les identifiants d'un tiers, et le premier
litige n'a aucune réponse. **Un parcours entièrement assisté est plus rapide et
indéfendable ; l'inscription autonome est défendable et convertit à zéro sur le
trottoir.**

**Un statut `draft`, et non un `onboarding` sans membre.** Les deux décrivent un
commerce incomplet, et c'est justement pourquoi il fallait les séparer :
`onboarding` désigne un commerce dont quelqu'un a déjà le compte, `draft` une
fiche que personne n'assume. Les confondre reviendrait à ne plus savoir si un
commerce a un propriétaire — la seule question à laquelle ce dispositif doit
pouvoir répondre.

**Le QR d'abord, le courriel ensuite, et les deux sont nécessaires.** Si le
décideur est là, il scanne l'écran de la tablette : rien à taper, et la personne
qui assume est manifestement celle qui est présente. Mais le propriétaire n'est
souvent pas dans le salon — c'est précisément ce cas-là qui perdait la visite —
et le lien doit alors le suivre.

**La preuve de l'engagement va au journal d'audit, pas sur la ligne de prise en
main.** Le journal est immuable et ne disparaît pas avec le commerce ; la ligne,
elle, s'efface en cascade avec un prospect qui n'a rien donné. Ce qu'on
regardera le jour où quelqu'un contestera avoir accepté quoi que ce soit — qui,
quand, quelle version — doit survivre au ménage.

**Une version de conditions, pas un booléen.** Un lien ouvert la semaine
dernière montre les conditions de la semaine dernière : la version acceptée est
comparée à celle en vigueur, et un écart refuse. Écrire la version courante sur
une acceptation produite sur une autre serait écrire une preuve fausse.

**Pas de système général de conditions pour autant.** Aucune colonne n'est
ajoutée à `app_user`, aucune table de versions n'est créée : ce qui existe ici
est la preuve d'un engagement précis, celui d'un salon qui assume sa fiche. Un
dispositif général est une autre décision, et elle se prendra quand les
conditions changeront pour de vrai.

**Un compte existant peut assumer une seconde fiche.** Un propriétaire qui tient
deux adresses n'a pas à s'inventer une seconde adresse électronique ni à tenir
deux mots de passe pour deux salons de la même rue.

**Ce qui est écarté, et pourquoi.** La saisie hors ligne : une file d'envois
différés avec résolution de conflits est un mécanisme d'une autre taille que
celui-ci. La concession retenue est plus modeste — un envoi de photo qui échoue
se rejoue sans refaire le formulaire.

## 2026-08-13 — La période de grâce, et ce qui arrive au bout

Suite de la décision précédente : le salon assume sa fiche, il ne sort pas sa
carte pour autant. **Demander un moyen de paiement au comptoir est la friction
la plus forte du parcours, et elle arrive au moment exact où la personne vient
de dire oui.** Le salon ouvre, se montre, reçoit des réservations ; la question
de l'abonnement se pose une fois qu'il a vu ce que ça donne — ce qui est le seul
argument qui vaille.

**La fin de grâce est une mise en pause, pas une fermeture.** Les offres cessent
de paraître dans le fil ; le catalogue, les horaires et l'historique restent. Le
mécanisme existait déjà pour les congés et les travaux, et il n'y avait aucune
raison d'en écrire un second.

**Les réservations déjà prises sont honorées, jusqu'au code de retrait.** Ni la
consommation ni la contrepartie ne regardent le statut du commerce — c'était
déjà vrai, et c'est maintenant tenu par un test qui va jusqu'à consommer la
réservation d'un salon sorti du fil. Vérifier que la ligne existe encore
n'aurait rien prouvé : une promesse tenue à moitié n'est pas tenue.

**Prévenir avant est la moitié de la règle.** Disparaître du fil sans l'avoir
dit se lit comme une panne, et c'est le support qui l'apprend. L'avertissement
part une seule fois — `grace_warned_at` existe pour ça : sans lui, un salon
recevrait le même message toutes les heures pendant une semaine et cesserait de
lire les suivants. Et la date s'écrit **après** l'envoi : la poser avant ferait
passer pour prévenu un salon dont le message n'est jamais parti.

**`suspended_reason` est une colonne, et non une lecture du journal d'audit.**
C'est ce qui distingue le salon sorti pour non-paiement — que souscrire ramène
en ligne — du salon parti en travaux, que rien ne doit rouvrir à sa place. Le
journal porte bien la raison de chaque transition, mais lire un état courant
dans un journal d'événements est exactement ce qui a déjà coûté cher ici. Une
contrainte pose l'équivalence dans les deux sens : suspendu sans raison, ou une
raison sans être suspendu, sont refusés tous les deux.

**Le balayage ouvre avant d'avertir et de fermer.** Un commerce ouvert avant ce
dispositif, ou dont l'abonnement s'est arrêté, n'a pas d'échéance : sans ce
rattrapage il resterait visible pour toujours sans jamais payer, et personne ne
s'en apercevrait parce que rien ne le regarde.

**Le contrôle des préférences a été posé sur le chemin du courriel.** Les six
genres plus anciens ne le font que sur le chemin du push : couper une
notification sur l'écran la coupe sur le téléphone et la laisse arriver dans la
boîte. C'est un défaut, il est noté dans `TASKS.md`, et ce n'était pas une
raison d'en ajouter un septième.

**Trois contraintes `CHECK` réécrites à la main dans une seule migration**, et
la troisième avait été oubliée : `business.status`, `notification_preference.kind`
et `job.job_type`. Toute énumération applicative se rend en VARCHAR + CHECK, et
l'autogénération ne compare pas les listes. La suite l'a dit, pas la relecture.

## 2026-08-13 — La reprise d'un compte commerce, plutôt qu'un accès permanent

Troisième volet de l'inscription sur le terrain. La fondatrice accompagne des
salons qui découvrent le produit, et il arrivera qu'il faille entrer dans un
compte pour débloquer quelque chose.

**Aucun accès permanent après l'activation.** Il est commode le premier mois et
ingérable au centième salon : personne ne saurait plus qui peut entrer où, ni ce
qui a été fait au nom de qui.

**Une reprise, avec quatre qualificatifs qui ne se séparent pas.** Explicite —
un geste, et un motif écrit à la main, parce qu'un motif en liste déroulante se
choisit sans réfléchir. Bornée — une reprise qu'on oublie de fermer redevient un
accès permanent. Nominative — elle vaut pour un administrateur et un commerce,
et ne se prête pas. Visible du salon — il est prévenu à l'ouverture et lit la
liste des reprises passées.

**Cette décision renverse une phrase écrite au socle**, et il faut le dire :
`require_business_member` portait « aucune dérogation pour les
administrateurs ». La règle devient « aucune dérogation *implicite* » — la seule
porte est une reprise, et hors reprise le refus est identique à celui de
n'importe qui, ce que le premier test du fichier vérifie.

**La dérogation vaut sur les deux résolveurs.** Une reprise qui ouvrirait la
fiche du commerce mais pas ses réservations ni ses contreparties ne débloquerait
à peu près rien, et obligerait le support à demander au salon de faire lui-même
ce qu'on est venu faire pour lui.

**L'appartenance rendue n'est pas écrite en base.** Elle n'existe que le temps de
la requête, pour que les routes lisent `membership.role` sans savoir d'où il
vient. Poser une vraie ligne `business_member` créerait un accès qui survivrait à
la reprise — exactement ce qu'on refuse. Le rôle est `owner` : une intervention
qui ne peut pas toucher à la configuration ne débloque rien.

**Le salon lit la même chose que nous.** Rendre une version allégée au commerce
demanderait de choisir ce qu'on lui cache, et il n'y a rien ici qui se cache.

**Une reprise échue n'est pas une reprise fermée.** `ended_at` ne se remplit que
si quelqu'un a refermé ; l'expiration éteint sans rien écrire. Dans une liste,
« refermée à 15 h 12 » et « expirée toute seule » ne se lisent pas pareil, et
c'est la seconde qui devrait gêner.

## 2026-08-13 — La préférence vaut pour la boîte comme pour l'écran verrouillé

Le chemin du push consultait deux choses avant d'envoyer : le statut du compte
et la préférence du genre. Le chemin du courriel ne consultait ni l'une ni
l'autre. **Couper une notification sur l'écran la coupait sur le téléphone et la
laissait arriver dans la boîte** — le pire des deux mondes pour quelqu'un qui a
explicitement demandé le silence, parce qu'il croit avoir coupé et qu'il n'a
coupé qu'à moitié.

**Une seule garde, appelée par les trois envois.** `notifications.joignable`
porte les deux règles ; les écrire une seconde fois est exactement ce qui les
avait fait diverger.

**Une seule table clé → genre.** Elle vivait dans le routeur des décisions de
réservation, où seul le push la lisait. Elle est maintenant dans le module des
notifications, et les deux canaux y puisent.

**Une clé sans genre lève, elle ne part pas.** Un message dont aucune préférence
ne commande l'envoi est un message qu'on ne peut pas couper : le laisser partir
« au cas où » rétablirait le défaut qu'on vient de réparer. Deux messages sont
dans ce cas — `collaboration.opened` et `collaboration.unfulfilled` — écrits,
traduits, et émis par personne. Leur rattacher le rappel d'échéance ferait taire
« votre contrepartie n'a pas été honorée » pour qui coupe les rappels : c'est
une décision de produit, elle est notée et non prise.

**Et un test dans l'autre sens :** chaque genre doit être commandé par au moins
une clé. L'écran des réglages en propose dix ; celui qui en couperait un sans
effet ferait douter des neuf autres.

## 2026-08-13 — La surface publique s'énumère, elle ne se devine pas

Rien n'inventoriait les routes servies sans authentification. Le produit en a
quelques-unes et chacune a sa raison, mais rien n'empêchait qu'une de plus le
devienne par accident, en oubliant une dépendance dans un routeur neuf. **Une
route d'écriture ouverte par distraction ne se voit ni à la relecture ni à
l'exécution : elle marche.**

**Le parcours de l'arbre, et pas la lecture à plat.** `app.routes` ne rend plus
des `APIRoute` mais des routeurs inclus, qui portent leur routeur d'origine et
le préfixe de leur montage. Une première écriture lisait `app.routes`
directement, trouvait zéro route, et passait — c'est le piège habituel de
l'ensemble vide, et il est refermé par une assertion sur le nombre de routes
inspectées.

**La liste porte ses raisons.** Ajouter une route publique demande d'écrire
pourquoi elle l'est. C'est le seul moment où quelqu'un se posera la question.

**Trois routes que personne n'avait énumérées.** Les deux rappels OAuth — c'est
la plateforme qui appelle, elle ne porte aucun jeton de session, et l'état signé
autorise — et la lecture d'une preuve, servie à une balise d'image qui ne porte
pas d'en-tête : le droit voyage dans l'adresse, court et lié à cette preuve-là,
obtenu par une route authentifiée qui vérifie l'appartenance. Les trois sont
défendables. C'est la première fois qu'on le vérifie.

**Et une mutation qui a corrigé le test plutôt que le code :** retirer
`CurrentUser` d'une route ne la rendait pas publique, parce que son routeur
portait déjà un rôle. La garde tenait ; c'était la mutation qui visait mal. Il a
fallu chercher une route dont `current_user` est la seule garde pour éprouver ce
cas-là pour de bon.

## 2026-08-13 — Une boîte d'envoi, et un seul chemin pour un message

Une décision de réservation, une transition de contrepartie, un avertissement de
fin de grâce, une ouverture de reprise envoyaient leur courriel et leur push
**avant de répondre**. Chacun est borné par sa configuration, donc la requête ne
pendait pas indéfiniment — mais elle pouvait attendre vingt secondes pour deux
messages dont l'appelant n'a rien à faire. Et si le processus mourait entre le
commit et l'envoi, personne n'était prévenu et rien ne le rattrapait.

**Une table, et non un type de job.** La table de jobs porte « une ligne par
travail, pour toujours » : `UNIQUE (job_type, target_id)`, reprogrammée plutôt
que consommée. Un message est l'inverse — une occurrence. Deux reprises ouvertes
sur le même salon sont deux messages ; les y forcer aurait cassé l'invariant, ou
perdu l'un des deux.

**Le dépôt est dans la transaction de l'événement.** C'est tout l'intérêt : le
commit qui écrit la décision écrit le message. Il n'y a plus de fenêtre où
quelqu'un est refusé sans jamais l'apprendre.

**La préférence se relit à l'envoi, pas au dépôt.** Le message est écrit à
l'instant de la décision et part une minute plus tard ; entre les deux,
quelqu'un peut avoir coupé. C'est le moment où le message arriverait qui compte.
La langue aussi se relit là : quelqu'un qui change de langue entre les deux doit
lire le message dans celle qu'il vient de choisir.

**Trois issues, et pas deux.** Parti, écarté, à réessayer. « Écarté » est celle
qu'on oublie : un compte suspendu, un genre refusé, aucun terminal — ce ne sont
ni des succès ni des échecs. Les compter comme des échecs ferait marteler ;
comme des succès, ferait croire que quelqu'un a reçu.

**Un envoi raté ne bloque plus les autres.** C'était le défaut du balayage des
rappels : une exception faisait échouer le job entier et laissait sans rappel
toutes les échéances qui suivaient dans la même passe. Chaque message porte
maintenant son propre report.

**Les envois directs ont été supprimés**, pas seulement contournés. Sept
fonctions — trois de courriel, quatre de push — n'avaient plus d'appelant.
Les garder aurait laissé deux façons d'envoyer un message dans le produit, ce
qui est exactement le défaut qu'on répare : celle qu'on oublierait de corriger
serait celle qui continuerait d'ignorer une préférence ou de tenir une requête.

**Une exception, et elle est dite dans le code :** l'invitation de prise en main
part toujours directement. La boîte écrit à un utilisateur, et le gérant qu'on
invite n'en est pas encore un — c'est ce que le lien existe pour changer.
L'adresse étant rendue à l'écran quoi qu'il arrive, un envoi qui traîne ne coûte
que le temps de la requête d'émission, pas la perte de l'information.

**Et deux tests qui ne vérifiaient plus rien.** Après le passage à la boîte, les
tests de la période de grâce appelaient encore la fonction d'envoi direct : ils
passaient, et n'éprouvaient plus le chemin du produit. C'est le défaut le plus
discret de cette campagne — un test vert sur un code mort.
## 2026-08-12 — Un nom de fonte doit être un identifiant CSS valide

Les trois familles étaient déclarées, servies et chargées, et **pas une ligne de
texte ne les employait**. `Texte` posait pourtant bien `fontFamily`.

`react-native-web` écrit `fontFamily` **verbatim**, sans guillemets : la valeur
arrive telle quelle dans `font-family:`. Or un nom de famille non guillemeté est
une suite d'identifiants CSS, et un identifiant ne peut pas commencer par un
chiffre. « IBM Plex Sans 600 » invalidait donc la déclaration **entière**, que le
navigateur jetait sans erreur, sans avertissement, sans rien. Le texte retombait
sur la pile système.

Les noms sont d'un seul tenant — « IBMPlexSans_600 » — valides non guillemetés,
donc à l'abri de toute couche qui oublierait de citer. Un test unitaire les
compare à l'expression d'un identifiant CSS.

`fontWeight` n'est plus posé du tout. Chaque fichier est enregistré sans
descripteur de graisse : pour le navigateur, la face est de graisse normale.
Demander 600 par-dessus la faisait grossir une seconde fois, par synthèse,
au-dessus d'un semi-gras déjà dessiné. Le nom porte la graisse, et lui seul.

**Ce que les trois tests de bout en bout ne pouvaient pas voir.** Ils
vérifiaient que les faces étaient enregistrées, servies et chargées — les trois
étaient vraies. Une face chargée ne prouve pas qu'un élément la demande, ni que
sa demande est valide. Le test qui manquait lit la police **effectivement
appliquée** par un élément rendu, et c'est le seul qui aurait attrapé le défaut.


## 2026-08-13 — Deux genres pour deux messages, et un journal pour la configuration

**Les deux messages orphelins ont chacun leur genre.** `collaboration.opened` et
`collaboration.unfulfilled` étaient écrits, traduits, et émis par personne. Les
rattacher au rappel d'échéance aurait été le raccourci commode : c'eût été faire
taire « votre contrepartie n'a pas été honorée » pour quelqu'un qui coupe les
rappels — au moment précis où l'information compte le plus, puisqu'elle touche
le score de fiabilité et ferme donc des paliers. L'apprendre six semaines plus
tard en constatant qu'on ne peut plus réserver ce qu'on réservait est bien pire
que de le lire le jour même.

**L'ouverture porte le format et les exigences.** Le contexte est passé en
entier au dépôt et non champ par champ selon le message du jour : le gabarit
d'ouverture est le seul à les nommer, et ne passer que ce dont les autres ont
besoin l'aurait laissé partir en disant « publiez » sans dire quoi — sans rien
casser, et sans que personne ne le voie.

**Une table qui portait une donnée que plus personne ne lisait.**
`NOTIFICATION_PAR_ISSUE` associait un statut à un couple (genre, clé) ; depuis
que la boîte d'envoi déduit le genre de la clé, le premier membre n'était plus
lu. Une mutation l'a montré en le changeant sans qu'aucun test ne tombe. Deux
sources pour la même information finissent par se contredire, et c'est celle
qu'on ne lit pas qui ment le plus longtemps.

---

**Le journal des modifications de configuration**, laissé ouvert depuis la
phase 3 « à faire quand un deuxième besoin du même type apparaîtra ». Il est
apparu : les seuils de paliers se changent par l'interface d'administration sans
redéploiement — c'est la règle du produit — et rien ne gardait trace de qui
avait changé quoi. Un créateur perd l'accès à un palier qu'il avait ; six
semaines plus tard, personne ne peut dire si son audience a baissé ou si le
seuil a monté.

**Une table à part, et non le journal d'audit.** Celui-ci décrit des
transitions : `from_status` vers `to_status`. Un seuil qui passe de mille à deux
mille n'en est pas une, et l'y forcer aurait produit des lignes illisibles —
« to_status : 2000 » ne dit ni de quoi, ni depuis quoi.

**Les valeurs sont stockées en texte.** Un journal qui retyperait ses valeurs
selon la colonne d'origine se tromperait le jour où cette colonne change de
type — c'est-à-dire précisément le jour où l'on vient le relire. `None` reste
`None` : un seuil de score qui passe de « aucun » à soixante n'est pas le même
geste qu'un seuil qui monte de cinquante à soixante.

**La bascule d'activité figure dans les deux journaux**, et ce n'est pas une
redondance : c'est une transition d'état — que d'autres lectures interrogent —
et une modification de configuration.

**Les plans d'abonnement suivront quand une route les modifiera.** Il n'en
existe aucune aujourd'hui : le routeur d'administration ne les lit que. Câbler
un journal sur un chemin qui n'existe pas aurait produit du code que rien
n'appelle, et un test qui ne prouve rien.

## 2026-08-13 — Un réglage qu'on ne sait pas régler n'existe pas

Trente-quatre réglages sur cent dix ne figuraient pas dans `.env.example` — dont
plusieurs ajoutés dans les jours précédents, par moi. Chacun a une valeur par
défaut dans le code, donc rien ne cassait : le produit tournait, et la seule
façon d'apprendre qu'un délai était réglable était de lire `config.py`.

C'est une dette qui ne fait jamais mal une bonne fois. Elle fait perdre une
heure à chaque fois que quelqu'un cherche « comment allonger la garde de
réservation » et conclut que ce n'est pas réglable.

**Un test compare le fichier aux champs de `Settings`, dans les deux sens.** Un
réglage absent du fichier est invisible ; une variable nommée dans le fichier et
inconnue du code se recopie dans un vrai `.env`, où elle est ignorée en silence —
et quelqu'un passe une demi-heure à se demander pourquoi son réglage ne prend
pas. Les deux sens comptent.

**Une seule exclusion, et elle porte sa raison :** `TEST_DATABASE_URL`, lue par
la seule session pytest. La poser dans le fichier d'exemple inviterait à la
renseigner en production, où elle désignerait une base qu'un jeu de données
accepte d'effacer.

**Et une découverte au passage.** Le texte des conditions n'existe dans aucun
fichier du dépôt. Un salon accepte « la version 2026-01 », l'acceptation est
écrite au journal d'audit avec son auteur et son instant — et le document
qu'elle désigne n'existe pas. Le mécanisme de preuve est complet ; ce qu'il
prouve ne l'est pas. Ce n'est pas bloqué par un accès externe, mais par une
rédaction juridique.

## 2026-08-14 — La carte se vérifie dans les deux sens

Le garde-fou de la carte de passation ne vérifiait qu'un sens : toute route
citée doit exister. J'avais écarté l'autre — toute route existante doit être
citée — au motif qu'il ferait tomber la CI à chaque route neuve avant qu'on ait
écrit à quoi elle sert.

C'était protéger la CI au prix d'une carte qui sous-décrit l'API. **Cela a coûté
deux écrans** : Claude Design en a composé deux en croyant absentes des choses
présentes depuis des semaines. Une route non citée est invisible, et l'invisible
se redemande ou se réinvente.

Le coût que je redoutais est réel mais petit : ajouter une route oblige à écrire
sa ligne de carte dans la même PR. C'est le bon moment — c'est le seul où
quelqu'un sait à quoi elle sert.

**Six routes sont hors carte, chacune avec sa raison** : la sonde de
déploiement, les deux rappels OAuth, la lecture d'un média, celle d'une preuve,
et la redirection publique. Aucune n'est appelée par un écran. La liste doit
rester courte : s'y glisse une route d'écran, et l'écran sera composé sans elle.

**Ce que la bidirectionnalité n'attrape pas, et il faut le dire.** Elle compare
des chemins, pas des champs. Les deux manques signalés étaient d'une autre
nature : l'agrégat hebdomadaire des rapports est un **champ** — `par_semaine` —
d'une route déjà citée, et je l'avais perdu en recopiant une introspection
tronquée à 280 caractères sans voir les points de suspension. Un garde-fou sur
les champs demanderait de nommer dans la carte chaque `id` et chaque
`created_at` ; le bruit qu'il produirait le ferait contourner. La parade est
plus simple : ne pas recopier une sortie tronquée.

## 2026-08-14 — L'extraction lisait bien une photo, et ne lisait rien

Question posée en campagne 3 : l'extraction de carte lit-elle une **photo** de
la carte au mur, ou seulement un fichier structuré ? De la réponse dépend la
valeur du mode terrain — si le salon doit ressaisir son catalogue, la visite
n'économise que trois champs.

**Elle lit une photo.** `VisionExtractor` encode le contenu en base64 et
l'envoie en bloc `image` à un modèle vision. C'est fait pour ça, et l'instruction
est explicitement écrite pour une carte affichée.

**Mais le fichier n'arrivait jamais jusqu'à elle**, et de deux façons.

La route d'extraction passait `contenu=b""` au modèle, avec un commentaire
disant qu'on attendait le dépôt objet réel. Le dépôt existe depuis, et personne
n'est revenu ici. En mode `manual` l'extraction rend une charge vide de toute
façon : **aucun test ne pouvait le voir**, et les trente tests du fichier
passaient. C'est le défaut le plus coûteux de cette série, parce qu'il se serait
révélé le jour de la première démonstration réelle, devant un salon.

Et **aucune route ne permettait de déposer une carte**. La création d'un import
exige une clé de fichier ; seules la galerie et les preuves savaient en produire
une. La fondatrice photographiait la carte au mur et n'avait nulle part où la
mettre.

**Les deux bouts sont branchés** : un téléversement qui rend `{file_key,
mime_type}`, le type déduit de la signature et jamais de ce que l'appelant
déclare, et une lecture réelle du fichier à l'extraction. Une clé qui ne désigne
plus rien répond 404 au lieu d'envoyer zéro octet — le vide ferait répondre
« rien trouvé » au modèle, et le commerce validerait une carte blanche en croyant
sa photo illisible.

**Ce qui reste, et qui n'est pas du code** : `MENU_EXTRACTION_PROVIDER=vision`
et sa clé. Tant qu'ils manquent, l'extraction rend une charge vide — et l'écran
doit proposer la saisie plutôt qu'un état d'erreur, ce que la carte de passation
dit maintenant.
---

## 2026-08-14 — Un état vide qui remplace le contenu emporte l'action avec lui

`Ecran` rend son état vide **à la place** du contenu. C'est la bonne règle
quand le contenu est une liste. Elle devient un piège dès qu'une action vit
dans ce contenu : l'action disparaît exactement dans le cas où elle sert, celui
du compte qui n'a rien.

Le défaut s'est présenté deux fois, aux deux portes d'entrée du produit, et
n'avait été vu ni l'une ni l'autre fois.

**Le mode terrain.** Le formulaire de préparation était complet — trois champs,
un bouton, un QR — et rendu dans le corps de l'écran. Tant qu'aucune fiche
n'existait, l'état vide le remplaçait par « aucune fiche préparée ». C'est-à-dire
qu'il était invisible à la première tournée, la seule pour laquelle l'écran a été
écrit. Le formulaire est désormais rendu dans les deux états, construit une seule
fois : deux copies finissent par ne plus dire la même chose.

**Le commerce qui s'inscrit seul.** `POST /business` existait depuis la première
phase, avec son service, son test, sa migration — et **aucun écran ne
l'appelait**. Un gérant inscrit seul arrivait sur un onglet d'attente qui disait
que son commerce n'était pas en ligne et n'offrait rien. Le seul chemin vers un
commerce passait par le mode terrain, donc par quelqu'un d'autre : un produit à
deux côtés dont un côté ne peut pas s'inscrire n'a pas de côté commerce, il a une
liste d'invités.

**Ce qui est demandé à la création, et ce qui ne l'est pas.** Le nom, la
catégorie, l'adresse, le téléphone. La catégorie se choisit et ne se devine pas :
elle classe le commerce dans le fil et dans les compteurs par rayon, et un
commerce mal classé ne remonte dans aucun filtre — défaut qui ne se voit que
côté créateur. L'adresse part au géocodeur ; sans elle le commerce n'est dans
aucun rayon, et l'écran le dit plutôt que de le laisser découvrir. La devise
n'est pas un champ : elle est immuable après création, et la proposer serait
offrir une décision irréversible à quelqu'un qui n'a pas les éléments pour la
prendre. Le reste — horaires, catalogue, photos, paliers — se remplit ensuite,
avec les étapes d'activation qui disent ce qu'il manque.

**Pourquoi les tests d'écran ne l'ont pas vu.** Ils montent chaque écran dans
ses quatre états et vérifient, pour le vide, que le texte du vide s'affiche.
C'est exactement ce que faisait le produit. Une garde qui n'éprouve que la forme
qu'on avait en tête laisse passer celle qu'on n'y avait pas : le test neuf
vérifie qu'un état vide **porte son action**, pas qu'il porte sa phrase, et il
monte l'onglet d'attente lui-même — sans quoi il prouverait qu'un écran de
création fonctionne et rien de plus, ce qui reste vert pendant qu'aucun onglet ne
le monte.
---

## 2026-08-14 — BIND AGENCY v1.0, remplacement du système visuel

La fondatrice a donné la direction artistique de son agence. Le produit passe du
vert éditorial à l'orange. C'est un remplacement de système, pas un ajustement,
et il n'existait pas d'état intermédiaire sain : les jetons de la v0.4 —
`accent.*`, `role.*`, `tier.*` en trois teintes — disparaissent tous ensemble.

**Les fontes sont livrées seules, et c'est la seule tranche qui pouvait l'être.**
`polices.ts` lit les familles dans les jetons : les remplacer ne touche aucun
écran. Coût assumé et nommé dans le changelog des jetons : `design_handoff_bind/
tokens.json` a avancé de deux lignes au lieu de passer en v1.0 d'un bloc, parce
que le test « le fichier de l'app est celui de la passation, sans retouche » lie
les deux fichiers.

**L'italique est un fichier, jamais un attribut.** La v1.0 fait de l'accent un
changement de **voix** à l'intérieur d'une famille. Sur un Didone, l'italique
n'est pas la romaine inclinée mais un autre dessin ; `fontStyle: 'italic'`
produirait un oblique synthétique, et l'écart entre les deux est précisément ce
qui distingue la direction de son imitation. Même mécanique que pour les
graisses, même raison.

**Un seul jeu de couleurs, et le thème sombre est retiré.** La v1.0 livre une
palette, met les trois rôles en clair, et déclare **hors système** les deux
seuls écrans qui restent sombres — le code de retrait et la galerie plein écran,
qui portent leurs couleurs eux-mêmes. Ce qu'elle donne pour le sombre
(`ink.onDark`, `line.onDark`, `bg.sunken`, les variantes `onDark` des paliers)
est un kit d'accommodation pour ces surfaces-là : ni gris intermédiaires, ni
statuts, ni états de bordure. Reconstituer un thème sombre demandait d'inventer
une dizaine de valeurs qu'aucune passation ne définit — exactement la seconde
vérité que le dossier de thème existe pour empêcher.

*Contradiction laissée ouverte et signalée :* `tokens.json` porte encore
`theme.userOverride: true`. La bascule n'a plus de second thème vers lequel
basculer et a donc quitté l'écran des réglages, plutôt que d'y rester en
interrupteur qui ne commande rien. Le jour où un jeu sombre est livré, il se
rebranche dans `theme/index.tsx` et nulle part ailleurs.

**`brand.500` est une surface et ne s'écrit jamais.** C'est la règle centrale du
système — 3,0:1 sur blanc, refusée à toute taille — et la seule que le code peut
réellement tenir. Elle l'est à deux endroits : `Texte` lève quand on lui passe
une surface en couleur, ce qui attrape les couleurs **calculées** ; une garde
statique cherche les quatre formes d'écrire du texte, dont
`tabBarActiveTintColor`, où le mot est au milieu d'un nom composé et qu'une
garde ancrée sur un début de mot aurait laissé passer.

*Ce qui n'est pas dans la liste, et pourquoi.* Les matières claires — 50, 100,
200, 400 — échouent sur un fond clair et tiennent largement sur l'encre, où ce
sont précisément elles qui écrivent. Une garde qui les refuserait partout
interdirait le seul endroit où elles servent, et se ferait désactiver dans la
semaine.

**Le rôle reste lisible, en matière et non en teinte.** Arbitrage rendu sur le §8
de la passation, qui proposait de supprimer purement la couleur de rôle : la
distinction est gardée — encre pour l'administration, os pour le commerce,
papier pour la créatrice. Trois fonds qui existent déjà, aucune teinte de plus à
décoder, et une capture d'écran qui dit encore d'où elle vient.

**Les paliers passent de trois teintes à trois matières.** Contour, teinte,
aplat. Deux gains au-delà du monochrome : la progression devient **ordinale** —
un rose, un vert et un violet ne disaient pas lequel était le plus exigeant, il
fallait l'apprendre — et la règle des trois marqueurs redondants devient
vérifiable par construction. Avec les teintes, « distinct en niveaux de gris »
était vrai en théorie et n'avait jamais été testé.

La table de matière est écrite en **noms de jetons** et non en valeurs, pour que
la garde des couleurs en dur tienne et qu'une couleur se relise dans un écran.
C'est donc une *lecture* des hexadécimaux de la passation, et un test vérifie
que les deux disent la même chose — sans quoi ce serait une seconde vérité.

**L'avertissement perd sa couleur et gagne un glyphe obligatoire.** Un ambre
dans un système orange se lit comme une mise en avant de marque, pas comme une
alerte. Le triangle porte l'alerte à lui seul ; il n'y a aucun prop pour
l'enlever, parce qu'un avertissement sans glyphe serait un bug et non un choix.

**Le focus du champ de saisie existe enfin.** Le commentaire l'annonçait depuis
la v0.4 et le composant n'écoutait ni `onFocus` ni `onBlur` : la bordure restait
à 1 px d'un bout à l'autre de la saisie. Deux pixels d'**encre**, jamais
d'orange — sur un écran qui porte de l'orange, un focus orange se perd.

**`produit.json`, à côté de `tokens.json`.** La v1.0 conserve explicitement (§12)
des choses qu'elle ne réénumère pas : densités du gabarit v0.6, écran de code
hors système, repères en mono des deux graphiques autorisés, libellés de palier
et copie des badges — qui n'ont jamais été des jetons de design. Les remettre
dans `tokens.json` casserait la copie conforme ; les écrire dans un écran
recréerait l'échelle parallèle que le diagnostic de rendu avait démontée. Un
test refuse qu'une clé existe des deux côtés.

**La règle du bloc se compte, elle ne se regarde pas.** La passation dit qu'elle
« se vérifie à l'œil nu ». C'est précisément ce qui ne tient pas : un bloc de
plus arrive six semaines après, par un sous-titre ajouté dans un fichier que
personne ne rouvre, et il ne se voit qu'en ouvrant les huit écrans côte à côte.
Une garde déclare le compte autorisé **écran par écran**, table exhaustive
vérifiée, et les écrans de travail quotidien y sont à zéro pour une raison
écrite plutôt que par défaut.

Le bouton principal n'est pas compté, et le tableau du §13 de la passation le
confirme : « Journée du commerce : 0 », alors que cet écran porte un bouton
principal orange. Ce qui est banni du travail quotidien est la **signature**, pas
la teinte.

Une seconde règle, plus durable que le comptage : **un écran ne peint jamais
`brand.500` lui-même**. Les surfaces orange légitimes vivent toutes dans un
composant. C'est par là qu'arriveraient la ligne de liste, la carte de fil et la
pastille de statut que le §5 refuse — et aucune d'elles ne ressemble à un bloc
dans le code.

**La désaturation des photos est refusée sur le contenu.** Arbitrage rendu sur le
§7 : c'est un procédé de collage marketing, et l'appliquer au fil détruirait ce
qui fait choisir un salon — la couleur d'un vernis, d'une mèche, d'une pièce.
Elle reste possible sur les fonds décoratifs. Conséquence : le point que le §7
laissait à arbitrer avec l'API — un traitement d'image à l'ingestion — est clos
par un non, et rien n'est à faire côté serveur.

**Trois champs annoncés au contrat et pas encore servis, rendus comme absents et
non comme zéro.** `offres_disponibles` par palier, le compte de salons par
catégorie, le relevé d'audience par compte connecté. Chacun est optionnel dans
les types, et chaque écran distingue **absent** de **vide** : « 0 prestation »
dirait à une créatrice éligible que son palier n'ouvre sur rien, et l'état vide
de l'écran d'audience envoyait connecter un réseau quelqu'un qui en avait déjà
un — un cul-de-sac qui ment, sur le seul écran où elle vient vérifier que le
sien est bien pris en compte.

**Un manque reste, et il est nommé.** Le **logo vectoriel** : les lettres sont
dessinées à la main, le D porte une coupe oblique qu'aucune fonte ne donne, et
toute reconstruction est une approximation — `tokens.json` la porte dans
`$meta.unconfirmed`.

*Les trois satins sont arrivés depuis. Voir plus bas.*

---

## 2026-08-14 — Lots 2 et 3, dans le système v1.0

Trois écrans du commerce et quatre de l'administration, repris dans le système
qui vient d'être posé. Deux règles de Design touchent les données, et c'est ce
qui les rend intéressantes.

**Aucun montant dans les rapports, et le client l'ignore même quand la réponse
en porte un.** La page portait « ce que vous avez donné · 4 280,00 USD ». La
règle de la carte d'API est qu'aucun montant ne figure dans une réponse
destinée aux applications créateur et commerce ; la réponse en porte encore un,
et l'écran cesse de le lire. Ce n'est pas cosmétique : ce qui convainc un salon
se dit en prestations, en publications et en délais tenus — et c'est plus juste,
un salon ne compare pas des euros, il compare ce qu'il a donné à ce qu'il a
reçu.

Ce qui remplace le montant est le **temps de fauteuil**, calculé sur la durée
des prestations sans jamais toucher à un prix. `temps_de_fauteuil_minutes` est
annoncé au contrat et pas encore servi, traité comme les trois champs du lot 1 :
absent n'est pas zéro.

**La garde est une liste de trois écrans, chacun avec sa raison.** Les plans —
seul écran du produit à afficher des montants, et il est du back-office. Le
catalogue et la relecture de carte — le prix que le salon tape lui-même sur sa
propre carte, donnée de reporting interne jamais montrée à une créatrice.
Partout ailleurs, ni `formatMoney` ni la division à la main, qui était
justement la forme employée par la page de rapports.

**L'annuaire reste en lecture seule, et c'est une décision, pas un trou.** Aucune
route d'invitation ni de message n'existe, dans aucun sens : le produit circule
dans un seul sens, la créatrice choisit et réserve. L'abonnement achète de la
**visibilité**, pas du contact. Deux gardes plutôt qu'une : l'écran ne porte
aucune action, et le client d'API n'en offre aucune — sans quoi la lecture seule
serait une discipline, et une discipline finit par céder.

**Le bouton d'arbitrage nomme son écart.** Défaut relevé en campagne :
« Approve » seul ne disait pas ce qu'on approuvait, et dans une file où l'on
tranche vingt dossiers à la chaîne un verbe seul finit par vouloir dire
« suivant ». Le libellé vient du **dernier motif** — celui qui a mis le dossier
là — parce qu'il est déjà codé dans le vocabulaire fermé et qu'il vient du
journal : on nomme ce que quelqu'un a reproché, pas ce qu'on croit voir. Quand
il n'y a rien à excuser, le bouton redevient simple.

**Et le constaté dit d'où il vient.** Aux niveaux 2 et 3, la preuve ne porte ni
auteur, ni format, ni mention : rien qui puisse être comparé à l'exigence.
Écrire « conforme » en face d'une ligne que personne n'a vérifiée serait une
affirmation que le produit ne peut pas tenir devant un salon qui conteste. Seule
l'échéance se mesure vraiment des deux côtés.

**La journée se coupe par ce qu'elle demande, pas par des statuts.** Une absence
à constater et une prestation servie la veille se lisaient dans la même colonne,
au même poids. Un statut ne devient une section que s'il change ce que la
vendeuse doit faire ; sinon c'est une nuance, et elle vit dans la ligne.

**La prise en main ne dit plus avoir lu ce qu'elle n'a pas lu.** Elle annonçait
« 0 prestation et 0 plage sont déjà là » quand rien n'avait été relevé — une
lecture affirmée qui n'avait pas eu lieu, sur le premier écran qu'un gérant voit
de BIND et le seul qui doit lui donner envie de continuer. Un bloc, deux rendus,
et les deux comptes traités séparément : une carte relevée sans horaires est le
cas courant.

**Les plans disent leur lecture seule une fois, en haut**, plutôt que de griser.
Un bouton grisé promet qu'il s'allumera, et rien ici ne s'allumera. La règle de
la maison est que l'action impossible est retirée ; la mention la remplace.

### Ce que ces deux lots demandent encore

Trois manques nommés par Design, tous côté serveur, et **aucun n'a été
contourné en inventant une donnée** :

- **la route de l'annuaire** — aucune route commerce ne liste les créateurs ;
- **l'agrégat des rapports** — sans lui, douze semaines font quatre-vingt-quatre
  appels jour par jour ;
- **le point de comparaison de quartier**, exposé sur le catalogue vide et dont
  la journée vide a besoin : c'est là qu'un salon décide de rester ou
  d'abandonner.

Deux compositions restent à faire faute de route : les **deux blocs
photographiés** du mode terrain — carte des prix et horaires, qui remplacent
deux formulaires — et le **cochage prestation par prestation** de la prise en
main, qui demande la liste des items relevés et non leur seul compte.


---

## 2026-08-14 — Le réglage retiré, et les trois satins cuits

**`theme.userOverride` quitte les jetons.** La bascule de thème avait déjà quitté
l'écran des réglages avec le second thème ; la clé restait dans le fichier et
désignait une bascule vers rien. Un interrupteur qui ne commande rien est pire
que son absence, parce qu'il fait douter de ceux qui commandent quelque chose —
c'est la même raison qui fait vérifier ailleurs que chaque genre de notification
est commandé par au moins une clé.

La clé est remplacée par une note qui dit pourquoi elle n'est plus là et où la
bascule se rebranche. Un test refuse qu'elle revienne, et refuse aussi qu'une
source la relise : une clé retirée qu'un écran interroge encore rend
`undefined`, ce qui se lit comme « faux » et ne casse rien — le pire des deux
mondes.

*C'est une retouche du fichier de passation, et c'est la seconde.* La règle
« copié tel quel » vaut contre la dérive silencieuse, pas contre une correction
demandée : les deux copies bougent ensemble, le test qui les lie tient, et la
raison est écrite dans le fichier lui-même plutôt que dans un commit.

### Les satins ne sont pas recadrés d'une photo, et c'est mieux

La consigne était de les recadrer depuis les visuels Instagram en attendant les
sources. **La planche de design les donne exactement** : `BIND AGENCY - Design
System v1.0.dc.html` porte les trois déclarations `radial-gradient` complètes,
arrêt par arrêt. C'est la source, pas une approximation de la source.

Recadrer un JPEG aurait figé dans le produit un banding de compression qui
n'appartient pas à la charte, et il se serait vu : un satin vit sur 240 px de
haut au minimum, c'est-à-dire sur la plus grande surface du produit.

**C'est le navigateur qui peint.** `scripts/cuire-les-satins.mjs` fait rendre les
déclarations CSS par Chromium et capture le résultat en 1x, 2x et 3x.
Réimplémenter l'ellipse et l'interpolation en aurait fait une approximation de
plus, à vérifier à l'œil ; ici il n'y a rien à vérifier, c'est le même peintre.
La dépendance existait déjà — c'est celle des tests de bout en bout.

*Vérifié en chemin :* une première cuisson maison, en radiales calculées à la
main, s'écartait du rendu du navigateur de 3 valeurs sur 255 au maximum. Assez
proche pour qu'on ne voie rien, assez loin pour qu'on ne sache pas si ce qu'on
regarde est la charte ou notre lecture d'elle.

**En JPEG, et c'est le seul endroit du produit où ce serait vrai.** Un satin n'a
ni transparence, ni arête, ni aplat de texte : rien de ce que le JPEG abîme.
Mesuré plutôt que supposé — à qualité 90, l'écart maximal au rendu du navigateur
est de 5 valeurs sur 255, pour un dix-huitième du poids. Les neuf PNG pesaient
2,6 Mo ; ils pèsent 176 Ko.

### Trois refus dans le composant, plutôt que trois consignes

Un satin est la surface la plus facile à mal employer du système : elle est
belle, et il est tentant de la poser derrière une liste. `SurfaceSatin` lève
sous 240 px de haut, refuse un enfant dont la variante typographique passe sous
24 px — `type.section`, à 22, est dehors, et c'est le cas limite qui compte — et
n'existe qu'en trois variantes dont un test vérifie qu'elles rendent trois
images distinctes.

**Il ne porte pas de voile.** Sur `drape` et `fold`, le titre est en encre ; sur
`ember`, qui est la variante sombre, le blanc est admis. Poser un voile pour
rattraper un contraste reviendrait à salir le satin pour sauver un texte qu'on
aurait pu écrire de la bonne couleur.

### Où il est branché, et le comptage qui en découle

L'accueil sans média annonçait « aucun fond » sous les portes : une phrase
d'excuse à l'endroit exact où le produit se montre pour la première fois. C'est
le premier des trois emplois que la passation donne au satin, et il le remplace.

Le satin y prend l'en-tête que les portes cèdent — la marque avec sa signature,
le titre avec son bloc. **La garde statique ne peut pas voir ça** : elle lit un
fichier à la fois et ne sait pas qu'un composant s'efface quand un autre parle.
Les deux fichiers déclarent donc chacun leur bloc, et c'est un test de rendu qui
compte le vrai, sur l'écran monté, dans les deux branches.
---

## 2026-08-14 — Trois seuils que le code n'a pas à connaître

**Le plafond de jetons de l'extraction de carte.** Sur les modèles de la
génération 5, ne pas envoyer de champ `thinking` ne veut plus dire « sans
réflexion » : c'est la réflexion adaptative qui s'applique par défaut, et
`max_tokens` plafonne la réflexion **et** la réponse ensemble. Une carte longue
pouvait donc dépenser son budget à délibérer et rendre un JSON coupé au milieu
d'une ligne, que le lecteur signalait « réponse illisible ». Le défaut se serait
découvert debout dans un salon, sur la carte la plus fournie de la tournée —
celle qui a le plus à gagner à être lue automatiquement.

Lire une carte est une transcription, pas un raisonnement : on coupe la
réflexion explicitement, et on relève quand même le plafond. Les deux, parce que
couper protège du partage et relever protège de la carte de soixante lignes.
`MENU_EXTRACTION_MAX_TOKENS` passe de quatre mille — figés dans le code — à huit
mille en configuration. Et une réponse tronquée nomme désormais le plafond au
lieu de se dire illisible : les deux appellent des gestes opposés, et les
confondre fait reprendre trois fois la photo d'une carte bien cadrée.

**Le délai avant qu'une absence puisse être constatée.** Rien n'empêchait un
salon de marquer absente une créatrice à l'heure pile, pendant qu'elle poussait
la porte — et l'événement de fiabilité qu'une absence écrit ne se retire pas.
`NO_SHOW_DELAI_MINUTES` vaut vingt, et la journée du commerce rend désormais
`absence_signalable_a` : l'écran sait **quand** ouvrir le bouton sans connaître
le seuil. Recopier vingt minutes dans l'application aurait suffi à faire dériver
les deux au premier ajustement, et cette dérive-là se lit comme un bouton grisé
qui devrait être actif.

**L'ordre des deux refus, trouvé par un test existant.** La garde du délai
passait avant la vérification d'état, et un commerce qui tentait l'absence sur
une réservation déjà annulée lisait « trop tôt » — donc attendait vingt minutes
pour rien avant de recommencer. L'état d'abord, l'heure ensuite. Le test du
signalement de lieu l'a montré en tombant ; il n'a pas été modifié, ce qui est le
meilleur signe que l'ordre est le bon.

**Ce qui n'est pas fait, et pourquoi.** La composition de Design annonce aussi
que « deux absences non prévenues suspendent la créatrice 30 jours, sans que tu
aies à intervenir ». `SPEC.md` §4.1 ne connaît qu'un événement de fiabilité
négatif ; une suspension automatique est une sanction d'une autre nature, avec
son seuil, sa durée, sa notification et sa voie de recours. Elle engage le modèle
et les droits du créateur : elle est signalée, pas implémentée.

---

## 2026-08-14 — Le voisinage est un rayon, parce que le quartier n'existe pas

L'état vide du commerce disait « ajoutez une prestation » et rien de plus. Un
salon qui vient de s'inscrire ne sait pas combien de prestations publier ni
combien de places ouvrir : il ouvre au hasard, se trouve invisible dans le fil,
et conclut que le produit ne marche pas. `GET /business/{id}/neighbourhood` rend
trois repères — prestations publiées, places par jour, palier le plus offert.

**« Quartier » n'entre pas dans le modèle.** Miami compte assez de quartiers
nommés pour qu'une liste fermée soit fausse dès le premier jour ; c'est déjà la
raison pour laquelle la ville d'un créateur est un champ libre (SPEC §5.2). Le
voisinage est donc un **rayon** autour du point du commerce, comme le fil et les
compteurs par rayon. Rien de neuf en base, et `rayon_metres` est rendu avec les
chiffres pour que l'écran écrive « les salons dans 2 km » plutôt que « votre
quartier » — qui serait un découpage inventé.

**Des fourchettes, jamais des chiffres exacts, et rien sous cinq salons.** Un
commerce ne doit pas pouvoir lire le catalogue d'un concurrent en s'inscrivant à
côté de lui. On rend l'intervalle interquartile et non les extrêmes : les
extrêmes d'un petit ensemble désignent des salons précis et sautent dès qu'un
seul ouvre ou ferme. Sous le plancher, aucune fourchette — mais le compte est
rendu quand même, pour que l'écran puisse dire « quatre salons autour de vous,
pas encore assez pour se comparer » plutôt qu'afficher un vide qu'on prendrait
pour une panne.

**Deux pièges, chacun avec son test.** Le commerce ne se compte pas lui-même :
un salon au catalogue vide qui s'inclut lirait « 0 à 0 » comme la norme du
quartier, l'exact contraire du repère cherché. Et les salons qui n'ont rien
publié comptent **pour zéro** : un `GROUP BY` ne rend que ceux qui ont au moins
une ligne, et sans remplissage la fourchette serait celle des seuls salons
actifs — un salon neuf lirait qu'il est très en retard alors qu'il est dans la
moyenne.
## 2026-08-14 — Une pastille est une promesse, une URL de démonstration aussi

**Les raccourcis d'arbitrage.** `DecisionBar` dessinait « A », « R », « N » à
côté de chaque décision depuis le premier jour, et rien n'écoutait le clavier.
Une pastille qui ne répond pas est pire que pas de pastille : on la croit, on
appuie, rien ne vient, puis on cesse d'y croire et on clique — ce qui est plus
lent qu'avant.

Le sujet de ce raccourci n'est pas de l'ajouter, c'est de le faire **taire**.
L'arbitre écrit un motif dans un champ de texte avant de clore un dossier en non
honoré ; un raccourci sans discernement clôrait le dossier — la seule décision
du produit qui ne se rouvre pas — au premier caractère de « non conforme ». Il
se tait donc dans une saisie, sous une touche de modification, sur une touche
non déclarée, et hors du web.

**La garde est éprouvée sur les quatre façons d'écrire la même faute** :
`input`, `textarea`, `select`, et l'élément éditable qui n'est aucun des trois.
La mutation qui la réduit à `input` seul — la forme qu'on avait en tête — fait
tomber trois tests. C'est exactement le défaut du garde-fou des rendus
asynchrones, qui ne cherchait l'appel qu'en début de ligne.

**Et les raccourcis suivent le filtre du motif**, parce que la barre retire ses
décisions non approbatives tant qu'aucun motif n'est choisi : un raccourci qui
survivrait à son bouton ferait exactement ce que le bouton refuse.

**Les URL mortes de la démonstration.** Le fournisseur de démonstration rendait
`https://instagram.demo.bind/authorize?state=…`. Ce domaine n'existe pas : les
deux boutons « connecter un réseau » ouvraient une page d'erreur du navigateur.
C'est la **toute première action** que le produit demande à une créatrice, et la
démonstration s'arrêtait là.

L'autorisation revient désormais sur notre propre rappel, avec un code que le
fournisseur de démonstration accepte : le parcours se déroule en entier — état
signé, usage unique, échange, rattachement, retour à l'application — et c'est
bien celui qu'on veut montrer, le même chemin que le vrai sans la plateforme au
bout. L'adresse vient de la requête et non d'un réglage : le serveur connaît la
sienne.

Le test qui compte le plus est **l'autre sens** : une réécriture qui
s'appliquerait à tous les fournisseurs enverrait une vraie créatrice sur notre
rappel au lieu d'Instagram, elle n'autoriserait jamais rien, et le défaut ne se
verrait qu'en production avec de vraies clés.

**Une ligne de `DEMO.md` qui mentait.** Le tableau des limites annonçait que le
bouton d'envoi de preuve « n'ouvre pas encore de sélecteur de média ». Il en
ouvre un depuis deux phases, avec galerie, appareil photo, aperçu, mesure du
poids avant envoi et note facultative. Une limite qui a été levée et qu'on
oublie de retirer coûte exactement ce qu'a coûté celle-ci : elle a été relevée
comme un défaut du produit pendant une campagne de test.

---

## 2026-08-14 — La carte du commerce, et l'extraction abandonnée

**Ce qu'on abandonne.** L'extraction automatique de la carte des prix ne passe
pas à l'échelle, et un salon ne met de toute façon que trois ou cinq prestations
sur BIND, pas sa carte entière. Le code reste en place derrière
`MENU_EXTRACTION_PROVIDER=manual`, qui est déjà la valeur par défaut : coût zéro,
et le chemin de la saisie manuelle continue de fonctionner. Rien n'est supprimé —
un fournisseur vision se rebranche en changeant un réglage, si l'usage revient.

**Le manque réel, à la place.** Un restaurant peut proposer « un menu contre une
story ». Le créateur ne sait pas ce qu'il va manger, donc il ne vient pas.
L'offre est en ligne, elle a l'air normale, elle ne convertit pas, et le commerce
n'a aucun moyen de savoir pourquoi.

**La carte n'est pas la galerie, et c'est le point de départ.** La galerie montre
le lieu : on la fait défiler, on se fait une idée, on passe. La carte se
*consulte* : on l'ouvre pour y chercher un plat et un prix. Deux gestes
différents, donc deux entrées sur la fiche — les mêler ferait chercher une
entrecôte entre deux photos de salle. Le mécanisme, lui, est exactement celui de
la galerie, et il est **recopié plutôt que partagé** : les deux ont la même forme
aujourd'hui et pas la même raison d'être, et une abstraction commune ferait qu'un
plafond relevé pour une carte de restaurant relèverait aussi celui d'une galerie
de salon, sans que personne voie le lien au moment de le changer.

**Plusieurs pages, parce qu'une carte tient rarement sur une.** Entrées et plats
d'un côté, desserts et boissons de l'autre. Plafond à huit : au-delà, ce n'est
plus une carte, c'est un livre.

**Le lien vaut la carte, et réciproquement.** Forcer à photographier une carte
déjà bien présentée en ligne serait absurde ; n'accepter que le lien priverait le
salon qui n'a qu'un tableau au mur. `menu_url` est un champ du commerce, pas une
ressource à part : la route qui le change existe déjà, et en créer une seconde
ferait deux vérités. Un lien vide ou fait d'espaces ne compte pas — c'est le
genre de valeur qu'un formulaire laisse passer, et elle ouvrirait une offre vers
une carte que personne ne peut lire.

**Le drapeau se pose, il ne se devine pas.** `leaves_choice` est déclaré par le
commerce. Le déduire d'un nom — « menu », « formule », « au choix » — marcherait
sur les exemples qu'on a en tête et se tromperait sur « Menu signature du chef »,
qui est un plat précis, comme sur « Soin visage » d'un salon qui en propose
quatre. Faux par défaut : le lancement est en beauté, et une valeur par défaut
vraie fermerait à la migration toutes les offres déjà ouvertes.

**La règle, et ses deux portes.** Une offre à choix ne s'ouvre pas tant que le
commerce n'a ni pages ni lien. Vérifiée à l'ouverture de l'offre et non à la
création de l'item : un item se saisit au fil de l'eau, souvent avant que la
carte soit photographiée, et refuser là obligerait à tout faire dans un ordre
imposé. C'est le geste de *publier* qui engage le commerce vis-à-vis d'un
créateur — exactement comme les critères d'activation.

Deux portes, parce qu'une offre naît **active** : `is_active` vaut vrai par
défaut, donc composer une offre la met en ligne dans le même geste. Ne garder que
la route d'activation aurait laissé passer le chemin le plus court, celui que
tout le monde emprunte, et la règle ne se serait jamais déclenchée. Rouvrir
compte aussi : ouvrir pendant que la carte est là, fermer, effacer la carte,
rouvrir — sans garde sur l'activation, l'offre repartait en ligne sans carte.

**Ce qui n'est délibérément pas bloqué.** Fermer une offre ne demande jamais de
carte : on ne bloque pas quelqu'un qui range, et une garde posée sur les deux
sens enfermerait une offre ouverte avant la règle. Et retirer la dernière page ne
referme aucune offre : la règle se vérifie à l'ouverture, pas en continu —
refermer derrière le commerce pendant qu'il réorganise sa carte lui ferait perdre
sa composition sans un mot. Il retrouvera le refus au prochain geste
d'ouverture, au moment où la question se pose.

**Sur la fiche publique, la carte a son accès et son avertissement.**
`menu_pages` et `menu_url` sont rendus séparément, et `leaves_choice` accompagne
chaque offre : c'est lui qui dit à l'écran quelles prestations appellent une
lecture avant de réserver. Quand `menu_pages` est vide et que `menu_url` est
renseignée, l'écran doit annoncer qu'on sortira de l'application — un lien qui
s'ouvre sans prévenir, au milieu d'un parcours de réservation, fait perdre le fil
à qui revient.
## 2026-08-14 — L'accueil ne se refait plus sous les yeux

Défaut rapporté en campagne de test comme « la vidéo d'accueil met plusieurs
secondes à démarrer ». La vidéo n'était pas en cause, et l'affiche non plus :
elle faisait déjà son travail sous la vidéo, jusqu'à `playingChange`.

**C'était un basculement de composition.** Le manifeste des médias arrive par un
aller-retour. Tant qu'il n'était pas là, `video` et `affiche` valaient tous deux
`null`, et l'écran rendait la composition satin **complète** — bande de satin
dans le flux, marque et titre dedans, portes sans en-tête. À l'arrivée du
manifeste, il basculait sur la composition vidéo : la bande quittait le flux,
l'en-tête réapparaissait ailleurs, l'encre passait de l'encre au blanc.

Ce que le testeur voyait n'était pas un délai. C'était la première chose que
montre le produit qui se réorganisait entièrement, une seconde après
l'ouverture. Un délai se supporte ; une page qui se refait, non.

**Le satin cesse d'être une composition de repli pour devenir la couche du
dessous.** Il est peint en fond, toujours, sous l'affiche et sous la vidéo. La
composition est la même à la milliseconde zéro et à l'arrivée du manifeste :
mêmes couches, même voile, même encre, même en-tête au même endroit. Ce qui
arrive ensuite ne remplace rien, ça s'intercale.

**Le voile devient permanent avec lui**, et c'est ce qui rend l'encre stable. Il
ne protégeait le texte que quand une photo était là ; le faire apparaître avec le
manifeste aurait fait changer la couleur du titre une seconde après l'ouverture,
c'est-à-dire le même défaut sous une autre forme.

**`surMedia` n'est plus calculé, il est vrai.** Une constante à la place d'un
booléen dérivé de l'état de chargement : c'est exactement ce que « la composition
ne change pas » veut dire, et c'est ce qui empêche le défaut de revenir par un
autre chemin.

**`avecEnTete` est supprimé.** Le prop existait le temps que l'accueil prenne
l'en-tête aux portes sur son satin, et c'est précisément ce déplacement qui
refaisait la page. Le satin passé en fond, l'en-tête est revenu là où il vivait,
et le prop est parti avec la bascule qu'il servait.

*La piste de la conversation fonctionnelle — distinguer « manifeste inconnu » de
« manifeste connu et sans média » — est juste, et elle devient sans objet : avec
une composition unique, les deux états appellent le même rendu. Il n'y a plus de
bascule à départager.*

**Deux mesures, plutôt que deux intuitions.** Sur le satin `drape` sous son
voile, `ink.onScrim` donne 6,00:1 — le titre tient. `ink.onScrimMuted`, qui
portait la sous-ligne, donne 3,83:1 : sous le seuil. La nuance sourde n'était
défendable que sur un fond clair connu ; sur un voile posé au-dessus d'une image
quelconque elle ne l'a jamais été, et elle passe au blanc.

**Le satin est étiré, plus recadré.** Les radiales de la planche sont écrites en
pourcentages de leur boîte : un satin en bande et un satin plein écran ne sont
pas la même image cadrée deux fois, ce sont les mêmes pourcentages sur deux
boîtes. `cover` aurait agrandi puis coupé les côtés — sur un téléphone, la
lumière que `drape` pose à 15 % de la largeur serait sortie du cadre, et il ne
serait resté du satin que sa partie sombre.

**Le test mesure le défaut, pas son symptôme.** Il liste ce que l'écran montre,
retient la réponse du manifeste à la main, compare la liste avant et après. Deux
mutations le rejouent : le satin remis en repli, et le voile remis en
conditionnel.

---

## 2026-08-14 — Réduire au dépôt, et deux codes qui n'en font plus qu'un

**Les photos, réduites au dépôt.** Une photo de prestation partait vers le fil
telle qu'elle sortait du téléphone : quatre mille pixels pour un cadre de cent
cinquante points. Le gâchis se paie à chaque affichage, pour tout le monde, et
deux fois sur le réseau d'un salon.

Au dépôt plutôt qu'à la lecture. Le stockage est ce qui coûte le moins cher de
la pile ; une clé dérivée n'a ni cache à invalider ni coût à l'exécution, et la
route des médias continue de ne faire que servir des octets déjà rangés.
Redimensionner à la lecture demanderait un décodeur sur le chemin chaud, un
cache, et une invalidation — trois choses à tenir pour une image qui ne change
jamais.

**Le mécanisme n'est pas neuf : il vient du semis.** `photos_reelles` réduisait
déjà les vraies photos de la démonstration au moment de les ranger, avec le
redressement EXIF et la conversion de mode qui vont avec. On en a extrait le
cœur dans `integrations/images.py`, et le semis l'appelle désormais plutôt que
d'en garder une copie : deux copies d'un même traitement d'image divergent au
premier réglage qu'on touche.

**Pillow passe donc au produit**, et le commentaire qui disait « jamais utilisée
par le produit » a été corrigé au lieu d'être laissé à mentir. C'est la même
leçon que la ligne de `DEMO.md` d'hier.

**La vignette borne, elle ne recadre pas.** Une couverture est en 16:9, une
photo de prestation en carré, une page de carte en portrait : imposer un rapport
au dépôt recadrerait une image dont l'écran décide déjà du cadrage. On borne le
côté le plus long à 480 points, l'application continue de couvrir comme avant,
et une seule taille sert partout.

**La clé est dérivée, pas stockée.** Une colonne par table portant une image —
galerie, carte, prestation, couverture — se remplirait à la migration et se
désynchroniserait au premier dépôt qui échoue à mi-chemin. Le suffixe
`@vignette` se recompose partout à partir de la clé qu'on a déjà, et la route
des médias retombe sur l'original quand la vignette n'existe pas : les images
d'avant ce changement continuent de s'afficher.

**Et la vignette ne fait jamais échouer le dépôt.** Pillow absent, image
illisible, second objet refusé : l'original est déjà rangé. Perdre une photo que
le commerce vient d'envoyer, pour une raison qui ne le regarde pas, coûte plus
que tout ce que la vignette fait gagner. Le détail, lui, garde l'original —
c'est la liste qui n'a jamais eu besoin de quatre mille pixels.

**Les six chiffres du code de retrait ne s'affichent plus.** Ils ne se
saisissent pas, ne désignent rien seuls — ils ne valent qu'avec l'identifiant
que porte le QR — et c'est précisément ce qui les faisait confondre avec le code
de secours, qui se dicte : un commerçant a essayé de taper les premiers.

Une légende sous les chiffres avait été ajoutée pour le dire. Elle ne suffisait
pas, et l'insuffisance était prévisible : **ce qui trompe est la forme, pas
l'absence d'explication.** Six chiffres alignés en gros ressemblent à une saisie,
quoi qu'on écrive dessous.

Le QR les porte déjà. Ce qui restait à montrer, c'est que le code est *vivant* —
et le décompte le dit sans ressembler à une saisie. Les tests de rotation
portaient sur l'affichage des chiffres ; ils portent maintenant sur la charge
réellement encodée dans le QR, c'est-à-dire sur ce que la caisse scanne.

**La suspension automatique n'est pas construite**, et c'est confirmé : le score
de fiabilité couvre déjà le cas, de façon graduée et réversible, là où une
suspension de trente jours est binaire et engage des droits.
## 2026-08-14 — Un voile adoucit, il ne garantit rien

La conversation fonctionnelle a relevé que le constat fait sur la sous-ligne de
l'accueil devait se répéter ailleurs : si `ink.onScrimMuted` n'est pas
défendable sur un voile posé au-dessus d'une image quelconque, elle ne l'est
probablement nulle part où le fond est une photo de commerce.

C'est exact, et c'est plus net que ça.

**Mesuré sur la pire photo possible — une blanche.** C'est le seul raisonnement
qui vaille sur une image dont on ne maîtrise rien, et ce n'est pas un cas
d'école : les mosaïques de la fondatrice alternent justement des ensembles
presque blancs. `ink.onScrim` ne tient qu'à partir d'un voile à **0,606**
d'opacité ; `ink.onScrimMuted` qu'à **0,733**. Des trois arrêts du système —
`photoTop` 0,45, `modal` 0,55, `photoBottom` 0,88 — **seul le dernier les
dépasse**.

**Donc la question n'est pas l'encre, c'est l'endroit.** Un texte posé sur le
haut ou le milieu d'un dégradé n'est démontrable avec aucune des deux encres. Et
sur un dégradé, l'endroit où un texte tombe dépend de la hauteur de la carte,
donc du terminal : les deux lignes du nom d'un salon tombaient autour de 0,65 et
0,76 — au-dessus du seuil pour l'une, en dessous pour l'autre, et impossible à
prouver dans les deux cas.

**Le partage retenu.** `VoileDeLisibilite` adoucit la transition et s'arrête à
`modal` ; le texte porte **sa propre bande** à `photoBottom`. La lisibilité
cesse alors de dépendre d'une hauteur : 12,10:1 et 7,72:1 sur une photo blanche,
sur n'importe quel écran. Descendre le dégradé jusqu'à `photoBottom` en plus
aurait empilé deux couches sombres et mangé le dernier tiers de la photo pour
rien.

**Le seuil est calculé, pas écrit.** `opaciteMinimaleDuVoile` le dérive des
jetons, et trois tests le tiennent : l'arithmétique de contraste elle-même
— vérifiée sur le noir sur blanc à 21:1, qui attraperait une erreur d'exposant
que rien d'autre ne verrait —, les deux seuils, et la conclusion que seul
`photoBottom` les atteint. Le jour où quelqu'un éclaircit cet arrêt pour laisser
voir la photo, c'est là que ça tombe : vérifié en le passant à 0,70.

### Et l'accueil, que j'avais laissé passer

En vérifiant le relevé plutôt qu'en le croyant, la même faute s'est trouvée sur
l'écran que je venais de livrer deux fois. Le voile de l'accueil descend à 0,55
en son milieu, et l'en-tête tombe entre le tiers et la moitié de l'écran selon
la hauteur du contenu : sur une vidéo claire, cela fait entre **5,48:1 et
3,72:1** — au-dessus du seuil ou en dessous selon le terminal.

Sur le satin seul, mesuré, on est à 6,00:1. Mais le satin n'est là que tant
qu'aucune vidéo ne le couvre : **une garantie qui dépend de ce qui a fini de
charger n'en est pas une**, exactement comme celle qui dépend d'une hauteur.

L'en-tête porte donc sa bande lui aussi, et elle vaut 12,10:1 quoi qu'il y ait
derrière. *Coût assumé et à arbitrer si la fondatrice le voit autrement :* la
bande cache le satin sous l'en-tête. Le satin occupe encore tout le reste de
l'écran, et il n'a jamais eu pour rôle de passer sous un texte — mais c'est un
choix visible, pas une conséquence technique.

## 2026-08-14 — La e2e tourne et ne bloque pas

Signalé par la conversation fonctionnelle, vérifié : la protection de `main`
n'exige que `api` et `app`. Le job `e2e` s'exécute sur chaque PR et **son échec
n'empêche rien** — une PR rouge sur lui a été fusionnée aujourd'hui sans que
rien ne s'y oppose.

C'est le job qui monte le produit entier, et il existe parce que trois défauts
n'ont été trouvés que par lui : la vidéo qui ne jouait pas, les polices jamais
chargées, la barre latérale jamais montée. Un garde-fou qui ne bloque pas est
une intention, pas une règle — et `CLAUDE.md` dit précisément le contraire :
« La règle est dans le dépôt, pas dans la vigilance. »

La liste des vérifications requises est un réglage d'administration du dépôt et
pas une décision de composition : elle n'a pas été modifiée ici. **Elle est
remontée à Daniel**, avec la correction proposée — ajouter `e2e` aux
vérifications requises.

*En attendant, la conclusion se lit sur le run entier* — `gh run view <id>
--json conclusion` — et jamais sur l'état de la PR, qui ne reflète que les deux
vérifications requises. C'est la même leçon que celle des sept PR fusionnées sur
une CI rouge, sous une autre forme.

## 2026-08-14 — Une carte se lit, une galerie se regarde

Le lot 4 tient sur deux règles, et aucune des deux ne survit à l'œil seul.

**Les deux fonds.** La galerie s'ouvre sur `bg.sunken`, la carte sur `bg.page`.
Ce n'est pas une variation : on regarde une photo sur du sombre, où le cadre
disparaît, et on lit un texte sur du clair, où l'encre porte. La difficulté est
que la règle tient à *une seule propriété* de deux composants voisins — elle
ressemble à une incohérence pour qui la découvre, et la première main qui passe
l'uniformise en croyant corriger. `FOND_DES_VISIONNEUSES` la nomme, et un test
vérifie **les deux sens** : que chacune peint le sien, et qu'ils diffèrent.

**Une page de carte est une photographie.** L'extraction existe dans le produit,
mais elle ne sert qu'au commerce, à créer ses items depuis sa carte, avec
validation. Elle n'alimente jamais ce que la créatrice lit. Recomposer la carte
reviendrait à la republier sous notre nom : une colonne de prix mal lue, et
c'est nous qui répondons devant quelqu'un qui a commandé autre chose. La garde
refuse tout nom du chemin d'extraction dans le fichier de la visionneuse, et
ignore les lignes de commentaire — sinon elle crierait sur la prose qui
l'explique, et se ferait désactiver.

**Ce qu'une mutation a trouvé.** Rendre le bandeau de blocage permanent — donc
visible même une fois la carte déposée — n'a fait tomber aucun test. Le dépôt
côté commerce n'avait aucune couverture : les 124 tests « écrans commerce » qui
passaient pendant la mutation ne le touchaient pas. Six tests l'entourent
maintenant, dont trois du sens inverse. C'est la quatrième fois sur ce projet
qu'une mutation de trente secondes trouve ce qu'aucune relecture n'a vu, et la
première où ce qu'elle trouve est **une absence** plutôt qu'un test creux.

## 2026-08-14 — Le voile ne protégeait plus rien, et il cachait la vidéo

Rapporté depuis la production : « la vidéo de fond n'apparaît plus, elle jouait
avant #118 ». Les deux hypothèses proposées étaient que le satin permanent la
couvre, ou qu'elle ait cessé d'être demandée. **Ni l'une ni l'autre.**

Mesuré dans Chromium sur le build réel, avec une vidéo unie pour que tout écart
soit imputable aux couches : le satin est bien la couche du dessous, la vidéo
est montée, elle joue, elle avance. Ce qui la couvrait est le **voile** —
`photoBottom` aux deux bouts, `modal` au milieu. Il n'en laissait passer que
**18 % en haut et 48 % au mieux** : un bleu vif arrivait à l'œil en (31, 43, 46),
un gris d'ardoise. Le même écrasement rendait presque noir un satin qui est une
surface de marque.

**Il n'était pas devenu trop lourd, il avait cessé d'être nécessaire.** Il datait
de l'époque où il était la seule protection du texte. Depuis, chaque ligne de cet
écran a reçu son propre fond : l'en-tête sa bande à 12,10:1, les deux portes
leurs cartes opaques. Il payait donc plein tarif pour un service que plus
personne ne lui demandait. Il redevient `photoTop`, en aplat — la pente
n'existait que pour couvrir davantage aux deux bouts, là où vivaient les deux
textes qui portent maintenant leur bande.

**#118 n'a pas introduit le défaut, il a retiré ce qui le masquait.** Les
couleurs du voile sont identiques avant et après ; seule sa condition a changé.
Ce qui a disparu est le basculement de composition à l'arrivée du manifeste —
le seul indice qu'une vidéo existait. Corriger la réorganisation a rendu visible
qu'on ne voyait déjà rien.

**Et un troisième texte n'avait aucun fond.** Le lien « Already have an
account? » est un bouton fantôme, donc en `brand.700`, une encre foncée
calibrée pour du papier : **2,14:1** au pire sur un média. Le voile ne l'a jamais
sauvé et ne pouvait pas — il assombrit l'encre exactement autant que le fond,
et c'est pourquoi l'alléger ne change rien à ce défaut-là. Il prend sa bande et
passe à `ink.onScrim`, à 12,14:1. Défaut préexistant, trouvé en mesurant l'autre.

## 2026-08-14 — L'ancienne marque avait survécu au remplacement du système

Le logo en ligne était encore le « B » du système vert : deux arcs inégaux tenus
par un axe débordant, hérité d'une direction artistique retirée. Il avait
traversé la v1.0 sans que rien ne l'arrête. Les jetons avaient changé, les
fontes, les soixante-quatre écrans ; `Logo.tsx` avait été **repeint** — la
couleur passait par `useColors`, donc il devenait orange et paraissait à jour.
Personne ne regardait sa forme.

**La marque est le mot.** `B!ND`, le point d'exclamation à la place du I,
`AGENCY` centré dessous. Il n'y a pas de signe à côté du mot. Le composant perd
donc son tracé, et `Marque` ne compose plus qu'un texte.

**Les fichiers statiques étaient pires, parce qu'on ne les relit jamais.**
Favicon, icône d'application, trois couches Android, et la couleur qu'Android
compose derrière l'icône, restée bleu pâle dans `app.json`. Ils étaient produits
par un script Python qui dessinait le monogramme à la main, en vert d'eau sur
indigo, valeurs écrites en dur. Le script est remplacé : Chromium peint le mot
avec **le fichier de fonte que l'application embarque**, lu depuis
`node_modules` — même raisonnement que pour les satins.

**Ce que les tests d'alors vérifiaient.** Que les fichiers existaient et
faisaient la bonne taille. Aucun ne regardait ce qu'ils montraient — c'est
exactement par là que l'ancienne marque est passée. La garde neuve ne prétend
pas juger un dessin ; elle vérifie que chaque pixel opaque est **un mélange de
deux couleurs déclarées dans les jetons**. Compter les couleurs dominantes ne
suffisait pas : sur une tuile de seize pixels, l'antialiasing *est* l'image. Un
vert d'eau sur un indigo n'est sur aucun segment de la v1.0, à aucune taille.

*Ce qui reste ouvert :* le vectoriel. Les lettres du logo sont dessinées à la
main — le D porte une coupe oblique qu'aucune fonte ne donne. Ces fichiers sont
la meilleure approximation disponible, et `$meta.unconfirmed` le porte déjà. À
seize pixels, quatre lettres ne se lisent pas ; y mettre un « B » seul aurait été
dessiner un monogramme que personne n'a validé, c'est-à-dire refaire ce qu'on
venait de retirer.

## 2026-08-14 — Un fichier de marque que rien ne réclame finit par resservir

Suite du constat précédent. Les quatre `marque-*.png` avaient été régénérés pour
qu'aucun fichier ne porte l'ancienne marque, sans qu'on sache à quoi ils
servaient. La question a été tranchée en regardant ce que le build **réclame**.

`expo export` compile `assets/favicon.png` en un `favicon.ico` de trois
images — 16, 32 et 48 — et le gabarit qu'il génère n'écrit qu'un
`<link rel="icon">` vers lui. Le 16, le 32 et le 64 doublaient donc une chaîne
qui produit déjà ces tailles depuis une source unique. **Retirés.**

Le 180 est la taille de l'icône d'iOS, et c'était clairement son intention
d'origine. Il avait donc une destination réelle, à condition de le poser où la
plateforme regarde : `public/` est recopié tel quel à la racine du build —
vérifié sur un export, pas supposé — et Safari demande `/apple-touch-icon.png`
par convention quand aucune balise ne la déclare. Il y vit désormais, produit
directement par le script de cuisson.

*L'alternative écartée :* remplacer le gabarit HTML généré par un
`public/index.html` pour y écrire les balises. Cela aurait mis à notre charge la
réinitialisation CSS et l'injection du script d'Expo — un fichier de plus à
tenir à jour à chaque version du SDK — pour une balise que la convention rend
inutile.

**Et une garde de plus, qui ne porte pas sur les couleurs.** Celle des couleurs
ne regarde que les fichiers qu'on lui nomme : un orphelin lui échappe *par
construction*. Elle est doublée d'une garde qui refuse qu'un `marque-*.png`
existe sans être réclamé. C'est la leçon exacte du monogramme vert — un fichier
inerte ne le reste pas, il attend qu'on le reprenne en portant une version que
plus personne ne vérifie.

## 2026-08-14 — La marque en petit : ce qui manque fait le signe

Design a livré `BIND Mark - Favicon 16`, qui règle le point laissé ouvert. Le
dessin ne réduit pas le logotype — il part des deux signes que la marque
possède : le bloc orange plein, et le point d'exclamation **évidé** dedans.

L'évidement n'est pas un effet. Un point d'exclamation orange sur fond blanc est
un panneau d'alerte ; le même point creusé dans un carré plein devient une
marque, parce que l'objet reconnu est le carré et le signe ce qui y manque.

**La propriété qui porte le dessin est la grille**, et c'est elle que les tests
éprouvent. Tout est posé en unités d'une grille de seize, donc chaque cote tombe
sur un pixel entier à 16, 32, 48 et 128 : la forme est *la même* aux quatre
tailles. Une garde qui se contenterait de compter deux couleurs laisserait
passer un dessin franc à chaque taille mais différent d'une taille à l'autre —
c'est-à-dire ce que produit toute réduction. Les trois tailles du `.ico` sont
donc comparées **au centre de chaque unité**, et l'empreinte attendue est écrite
en toutes lettres dans le test plutôt que recalculée depuis le manifeste, qui se
régénère avec le dessin et approuverait tout.

**Le favicon est livré en `.ico` complet.** `expo export` sait en produire un de
trois images, mais en *réduisant* la source : le blanc de deux unités entre le
fût et le point serait rendu en gris, et c'est précisément ce que le dessin
protège. `public/` est recopié tel quel à la racine du build et l'emporte sur ce
qu'Expo génère — vérifié sur un export.

**`web.favicon` est retiré, et `assets/favicon.png` avec.** Tant que la clé
désignait une source, la chaîne compilait un `.ico` que le nôtre recouvrait
*silencieusement*. Un fichier généré puis masqué est pire qu'un orphelin : il
reparaît le jour où l'on retire ce qui le masquait, en portant son propre
dessin. Sans la clé, Expo n'écrit plus de `<link rel="icon">` — la racine suffit,
c'est la plus ancienne convention du web et celle qui sert déjà pour
`apple-touch-icon.png`.

*Un écart relevé sur la planche, et tranché :* sa dernière colonne annonce
« deux unités de marge en haut et en bas, quatre à gauche et à droite ». La
géométrie qu'elle donne huit fois, et son tableau de cotes, disent **six** à
gauche et à droite — quatre est la largeur du signe, pas sa marge. La géométrie
fait foi, et l'affirmation sur les masques des plateformes tient mieux encore
avec six.

*Ce qui n'a pas été tranché :* `icon.png` et les trois couches Android portent
toujours le logotype. Mesuré sur la couche réelle réduite à sa taille
d'affichage, un lanceur Android à 48 dp donne 27 pixels de large pour quatre
lettres — la tache que ce dessin existe pour éviter. La planche range la « tuile
d'application » dans son domaine ; la demande ne nommait que le favicon et
l'icône d'iOS. Remonté plutôt que décidé.

## 2026-08-14 — La règle des deux marques, et sa forme la plus sûre

Les icônes d'application passent à la marque compacte sur les deux plateformes.
La règle qui en sort mérite d'être écrite, et elle l'est maintenant dans la
passation :

> Le logotype partout où on a la place de le lire, la marque compacte partout
> ailleurs. Le seuil est la lisibilité des quatre lettres, pas le support.

**Ce que j'avais mal regardé.** J'avais gardé le logotype sur `icon.png` et les
couches Android *parce qu'elles sont livrées en 1024 et 512*. La résolution du
fichier n'a jamais été la question : mesuré sur la couche réelle réduite à sa
taille d'affichage, un lanceur à 48 dp donne vingt-sept pixels de large pour
quatre lettres. La même tache que la marque compacte existe pour éviter.

**Le seuil est mesuré, pas choisi.** `B!ND` dans la fonte du produit occupe
0,592 fois le corps par lettre — mesuré au navigateur, sur le fichier de fonte
que l'application embarque. Dix pixels par lettre est encadré par deux mesures :
6,75 au lanceur Android, dont la capture est illisible, et 11,1 au plus petit
usage in-app, qui se lit. Les deux nombres vivent dans `produit.json` ; le
script de cuisson et le composant les lisent, aucun ne les recopie.

**La forme la plus sûre de la règle est structurelle.** Aucun fichier cuit ne
porte plus le logotype — tous sont des tuiles, aucune tuile ne s'affiche assez
grand. Le script n'a donc plus besoin de navigateur : il ne peint plus de texte,
il trace des rectangles sur une grille de seize, ce qui est exact et ne laisse
entrer aucun lissage. Le logotype ne vit qu'en texte, dans l'interface, et
`Marque` **refuse** de rendre sous le plancher — comme `Texte` refuse une
surface employée en encre. Le plancher se calcule des deux mesures, il ne
s'écrit pas : vingt-quatre aujourd'hui.

Un logotype illisible ne se signale pas. Il ressemble à un logotype, en plus
petit, et il traverse une revue — c'est exactement ainsi que l'ancien monogramme
vert a traversé le remplacement complet du système.

**Android reçoit enfin le bon gabarit.** Ses icônes ne sont pas des tuiles
masquées mais deux couches composées puis rognées : sur 108 unités, seules les
72 du centre sont garanties. Une tuile pleine posée là aurait vu son signe coupé
en haut et en bas — il occupe trois quarts de la tuile quand le masque n'en
garantit que deux tiers. La grille est donc ramenée à la zone sûre et le fond
fourni par l'autre couche : 432 et 288, soit dix-huit pixels par unité, aucun
arrondi. Après masquage, ce qu'on voit est exactement la marque compacte.

*Et une mutation qui n'a rien muté.* La première tentative pour éprouver la
garde de la règle remplaçait une chaîne qui ne correspondait pas : le test est
passé, et j'ai failli en conclure qu'il ne protégeait rien. Vérifier que la
mutation **s'applique** avant de lire le résultat est la moitié du geste, et
c'est celle qu'on oublie.

---

## 2026-08-14 — La demande d'autorisation était la seule chose non bornée

**Le blocage.** Le fil créateur restait indéfiniment sur « Getting your
location… » en ligne, sur Chrome. Le navigateur demandait, on acceptait, et
l'écran ne repartait jamais — l'état `en_cours` ne propose aucun bouton, à
raison, donc il n'y avait littéralement aucune issue. Le rôle créateur en était
intestable.

**La cause, et pourquoi elle avait échappé.** Sur le web,
`requestForegroundPermissionsAsync` se résout en appelant
`navigator.geolocation.getCurrentPosition` **sans passer de `timeout`** : le
défaut par défaut est l'attente infinie. Si la position n'arrive jamais derrière
l'acceptation — services de localisation désactivés pour le navigateur au niveau
du système, cas ordinaire sur macOS — aucun des deux rappels n'est appelé, la
promesse ne se règle pas, `demander` n'atteint aucun `setEtat`.

Le module portait pourtant, en toutes lettres, « **Le relevé est borné dans le
temps** », avec la bonne raison : « sans échéance, l'écran resterait en attente
pour toujours ». C'était vrai du relevé, et le relevé n'était pas le problème.
La *demande*, qui vient avant, ne l'était pas — et c'est elle qui pend. Une
garde posée sur l'étape qu'on avait en tête, pas sur celle qui casse.

**Le verrou n'en était pas un.** Le code comparait l'état précédent :

```
setEtat((precedent) => (precedent.etat === 'en_cours' ? precedent : { etat: 'en_cours' }));
```

sous un commentaire affirmant « deux demandes en vol ouvriraient deux fenêtres,
et la seconde réponse écraserait la première ». Cette ligne dédoublonne l'**objet
d'état**, jamais l'**appel** : deux `demander()` concurrents passaient tous les
deux. Un commentaire qui décrit une protection que le code n'applique pas est
pire qu'aucun commentaire — il fait passer la relecture ailleurs. Remplacé par
une référence, relâchée dans un `finally` : un verrou qui ne se relâche pas
transforme un écran lent en écran mort, c'est-à-dire le défaut qu'on répare.

**Deux messages qui accusaient à tort.**

« Your device didn't return a location » se déclenchait sur une autorisation
encore en attente. L'appareil n'avait rien refusé et n'avait rien manqué :
personne n'avait encore répondu. L'état `sans_reponse` est distinct
d'`indisponible` — là, l'appareil a répondu qu'il n'avait rien ; ici, la fenêtre
est peut-être encore ouverte. Les deux proposent de réessayer ; un seul parle de
services de localisation, et ce n'est pas celui de l'attente.

« We could not reach BIND. Check your connection and try again » désignait la
connexion de la personne, alors que le cas courant est notre propre service qui
se réveille. Une panne de transport ne dit pas de quel côté elle est ; le message
non plus, désormais. Il propose d'attendre un instant et de réessayer, sans
nommer de coupable.

**Une erreur de méthode, notée parce qu'elle a failli passer.** Le test qui
sépare les deux messages n'avait pas été inséré — son ancre citait
`async () => {` là où le fichier écrit `() => {`, le remplacement n'a rien fait,
et la suite est restée verte à quatorze tests au lieu de quinze. Il n'a été
trouvé que parce que la mutation correspondante **n'a pas fait tomber le test
qu'elle visait**. C'est exactement à ça que sert l'exercice : un test qui n'a
jamais échoué ne prouve pas que le code marche, il prouve qu'il s'exécute — et
celui-là ne s'exécutait même pas.

---

## 2026-08-14 — Le fil créateur bloqué : ce n'était ni le jeton, ni le réseau

Le symptôme était un 401 sur `GET /api/v1/businesses`, et la piste naturelle
l'authentification. Elle était fausse de bout en bout. Ce que la mesure a donné,
contre le déploiement :

- `POST /auth/login` répond 200, et le jeton frais est **accepté** — `/me` passe,
  `/businesses` répond 422 sur des coordonnées manquantes. `JWT_SECRET_KEY` est
  hors de cause, et une reconnexion n'y aurait rien changé : la connexion émet
  avec la clé courante et la vérification lit la même.
- La rotation et la déconnexion fonctionnent. Le 401 vu « à la main » venait d'un
  `curl` sans en-tête `Authorization` : la route répond exactement cela quand on
  ne lui présente rien, et c'est correct.
- Reproduit dans un vrai navigateur : `GET /businesses` avec des coordonnées de
  Miami répond **500**. Au large, où aucun commerce n'est dans le rayon, la même
  route répond 200. Un identifiant de commerce **inexistant** répond 500 lui
  aussi — donc l'échec est dans le SQL, pas dans les données.

**La cause : rien n'appliquait les migrations au déploiement.** Ni le
`Dockerfile`, ni `render.yaml`. Le schéma ne bougeait que lorsque quelqu'un
lançait `make demo-seed` à la main, tandis que le code déployé avançait à chaque
fusion. Ils ont divergé, et toutes les routes qui lisent un commerce
demandaient une colonne que la base n'avait pas. `alembic upgrade head` entre
donc dans la commande de démarrage du conteneur — avec `&&`, pour qu'une
migration en échec empêche de servir. Pas en pré-déploiement : Render le réserve
aux plans payants.

**Pourquoi ça a coûté une journée : un 500 se présentait comme une panne de
réseau.** Une exception non rattrapée remonte jusqu'à uvicorn, qui répond en
texte brut *hors* de la pile d'intergiciels — donc sans en-tête CORS. Le
navigateur ne voit alors plus une réponse mais une origine interdite, `fetch`
lève `TypeError: Failed to fetch`, et l'app, qui ne peut pas distinguer cela
d'un câble débranché, affiche « réessayez dans un instant » avec un bouton qui
ne peut pas aboutir. `ErreurInattendueEnJson` rend maintenant un 500 en JSON,
porteur du code `internal_error`, **sous** `CORSMiddleware` pour que la réponse
en ressorte avec ses en-têtes. L'ordre d'ajout est ce qui décide : le dernier
ajouté est le plus extérieur, celui-ci s'ajoute donc en premier.

**Un défaut trouvé en éprouvant ce correctif.** `alembic/env.py` appelait
`fileConfig` sans `disable_existing_loggers=False` : la valeur par défaut éteint
tous les journaux déjà créés, c'est-à-dire tout `app.*`. La suite appliquant les
migrations dans son propre processus, plus une seule ligne de journal applicative
n'y était émise — `caplog` ne capturait rien, et un test écrit dessus serait
passé vert le jour où le journal aurait disparu pour de bon.

**Le 401 renvoie à la connexion, et le chemin manquait à deux endroits.** La
bascule était déjà globale — `AuthScreen` se rend au-dessus de toute la
navigation dès que la session n'est plus établie. Ce qui manquait, c'est *quand*
elle se déclenche :

1. La rotation rendait `null` pour deux choses opposées — un serveur qui refuse
   le jeton de rafraîchissement, et un serveur injoignable. L'appelant en tirait
   la même conclusion : il jetait dehors quelqu'un qui passait sous un tunnel.
   Trois issues désormais : `jetons`, `morte`, `injoignable`. La dernière lève
   une erreur de réseau et ne ferme rien — ne pas pouvoir poser la question
   n'est pas une réponse.
2. Un 401 sur l'appel **rejoué**, avec un jeton qui vient d'être émis, ne fermait
   pas la session. C'est pourtant ce que répond un compte suspendu, et l'API ne
   le distingue nulle part ailleurs. L'erreur remontait à l'écran, qui affichait
   un message et un bouton « réessayer » que rien ne pouvait faire aboutir.

**La caisse passe enfin par le client.** `RedemptionScreen` recevait un jeton
brut, lu une fois à l'ouverture de l'écran, et construisait ses deux requêtes
elle-même. Quinze minutes plus tard ce jeton était périmé : le serveur répondait
401, et la caisse affichait « authentification requise » sur chaque code
présenté — sans rotation, sans retour à la connexion, sans autre issue que
fermer l'application. Le même blocage que celui du jour, en embuscade, au pire
endroit possible. La dette était nommée dans `Navigation.tsx` ; elle est payée.

**Et une branche qui n'avait jamais été éprouvée.** La distinction entre « code
refusé » et « requête jamais partie » existait dans la caisse depuis le début et
aucun test ne la couvrait : une mutation qui remplaçait la panne de transport par
un refus passait toute la suite au vert. Elle aurait fait redemander dix fois son
code à une cliente dont le code était bon.

---

## 2026-08-16 — Le temps laissé au commerce pour trancher, et ce qu'il risque

**Le délai n'existait pas.** `SPEC.md` §4.1 prescrit
`awaiting_business ──sans réponse dans le délai──> expired` depuis le début ;
rien ne l'implémentait. La seule échéance portée par une réservation était
`hold_expires_at`, le garde de dix minutes du panier, effacé dès qu'on quitte
`held`.

**Une correction à ma propre première lecture.** J'avais annoncé qu'aucune
demande en attente n'expirait jamais. C'était faux : `expirer_les_attentes_depassees`
existait déjà. Mais il expirait sur `coalesce(starts_at, valid_until)` — l'heure
du rendez-vous — ce qui est un filet contre les dossiers morts, pas un délai de
réponse. Une demande posée trois semaines à l'avance pouvait dormir trois
semaines, un droit sans créneau trente jours, **en tenant la place** puisque
`awaiting_business` compte dans la capacité. Le manque était réel, il n'était
pas là où je l'avais dit.

**Vingt-quatre heures, bornées par le début du créneau.** Un jour pour un salon
qui ne regarde son écran qu'entre deux clientes ; mais si la prestation commence
avant, l'échéance tombe au créneau — promettre une réponse pour après le
rendez-vous ne veut rien dire. Un droit sans créneau reçoit le délai plein :
`starts_at` est nul, rien ne le borne. La durée est en configuration
(`BOOKING_APPROVAL_SECONDS`), le bornage est dans le code parce que c'est une
règle, pas un réglage.

**Une colonne distincte, pas un prolongement de `hold_expires_at`.** Les deux
comptent une attente, pas la même et pas pour la même personne. Réutiliser la
première rendrait illisible toute lecture qui demande depuis quand un panier est
ouvert, et la contrainte `held_has_hold_expiry` ne pourrait plus rien affirmer.
Une contrainte symétrique refuse une demande en attente sans échéance : sans
elle, l'oubli produirait exactement le défaut qu'on corrige, et il ne se verrait
qu'au bout de plusieurs jours sur une place que personne ne comprend.

**Posée dans `transitionner` et nulle part ailleurs**, pour la même raison que
la table des transitions existe. `awaiting_business` s'atteint depuis
`confirmer` aujourd'hui ; rien ne dit que ce sera le seul chemin demain, et la
pose faite chez l'appelant est celle qu'on oublie au deuxième.

**Dans la migration, l'ordre est le sujet.** L'autogénération posait la
contrainte avant de remplir la colonne : sur une base portant la moindre demande
en attente, la création échouait et le déploiement s'arrêtait là. Colonne,
remplissage, contrainte. Les demandes déjà en vol reçoivent vingt-quatre heures
à compter du déploiement — leur donner l'échéance qu'elles *auraient eue* ferait
expirer d'un coup des demandes que des commerces sont peut-être en train de
regarder.

**Affiché des deux côtés, depuis la même donnée.** `approval_expires_at` entre
dans `_colonnes_communes` : le commerce lit jusqu'à quand il peut trancher, la
créatrice jusqu'à quand elle attend, et c'est la même heure. Deux comptes à
rebours calculés séparément auraient divergé. L'heure est absolue et dans le
fuseau du salon, pas un décompte : sur vingt-quatre heures, « avant mardi 10 h »
se retient là où « dans 21 h 14 min » demande de refaire le calcul et oblige
l'écran à battre la seconde pour rien.

**Ce que le commerce risque, dit au moment où il décide.** Qu'une contrepartie
non honorée coûte à la créatrice était vrai et construit — `unfulfilled` pèse
−30 dans `reliability_weights`, `no_show` −25 — sans que rien ne le lui dise.
La phrase est sous le bouton d'accord, pas dans un écran d'aide que personne
n'ouvre : c'est là que le doute se pose, quand on s'apprête à donner une
prestation contre une promesse.

**Une mutation qui a d'abord survécu.** Remplacer `approval_expires_at` par
`starts_at` côté écran ne cassait rien : dans tous les décors existants les deux
dates coïncidaient. Il a fallu écrire le cas qui les sépare — rendez-vous la
semaine prochaine, délai écoulé depuis une heure — c'est-à-dire exactement celui
qui motive tout le changement.
## 2026-08-15 — Le point est la seule couleur du logotype

Le vectoriel de la fondatrice est arrivé et **corrige la règle**. Design a mis à
jour la planche, les jetons et la passation ; le dépôt suit.

**Ce qui était faux, et pourquoi.** La règle disait « le point d'exclamation
n'est jamais coloré à part : c'est une lettre, pas un accent ». Elle avait été
déduite de visuels Instagram entièrement blancs sur orange — **où un point
orange ne peut pas se distinguer du fond**. L'information manquait de la seule
source disponible, et il en est sorti une règle au lieu d'une incertitude.
C'est la deuxième fois que ce fichier porte une marque déduite plutôt que vue,
après le « B » du système vert.

**La règle.** Les lettres prennent l'encre du fond — encre sur os et papier,
blanc pur sur encre, satin et orange. **Seul le point du « ! » est
`brand.500`**, dans les deux cas. Le fût suit les lettres.

**Conséquence technique, et c'en est bien une.** Le « ! » ne peut pas être posé
comme caractère : une couleur de texte s'applique au glyphe entier, et le fût
prendrait celle du point. Il se dessine. Le mot se compose donc en trois
morceaux — `B`, le signe, `ND` — et le signe est un tracé.

**Le tracé vient de la fonte, il n'est pas inventé.** Mesuré au navigateur sur
le fichier que l'application embarque, à 400 px : le fût s'affine de 31 à 22
pixels, et le point est rond, de diamètre égal à la largeur haute du fût. Un
rectangle droit à côté de trois lettres de la même fonte se verrait — ce n'est
pas un pictogramme posé près du mot, c'est une de ses lettres.

**Le sigle s'inverse.** Il était une tuile orange avec le point évidé ; il
devient **tuile encre, fût blanc, point orange**, et sa palette passe de deux
couleurs à trois. La raison est dans les jetons : sur une tuile orange le point
disparaîtrait, et c'est lui la marque. La contrainte de palette à deux couleurs
tombe avec elle — le sens du sigle *est* le contraste entre le fût et le point,
il ne survit pas à une palette qui ne peut pas porter les deux.

**Le composant expose une variante, pas une couleur.** `encre` ou `blanc`, et le
point ne bouge pas. Un appelant qui choisit une encre choisit tôt ou tard celle
du point, et le logotype cesse d'avoir sa couleur — c'est la même raison qui
fait refuser `Marque` sous son plancher.

**La signature disparaît.** Ni `AGENCY` ni `CRÉATEUR DE LIEN` — cette dernière
est en français, et BIND s'adresse à Miami en anglais et en espagnol. Le jeton
`type.tagline` part avec le prop.

*Deux mutations sont passées, et ce qu'elles ont trouvé vaut d'être écrit.*
Remettre le « ! » en caractère n'a rien fait tomber : la garde qui le
protégeait avait été **supprimée par une de mes propres réécritures** — un
découpage de bloc trop large l'avait emportée, et le fichier passait au vert
sans elle. Remettre la signature n'a rien fait tomber non plus : la garde lisait
les fichiers et le jeton, jamais ce que l'écran montre. Les deux gardes existent
maintenant dans les deux sens, sur le fichier **et** sur l'arbre rendu. Une
garde qui n'a jamais échoué ne prouve pas qu'elle protège ; elle prouve qu'elle
s'exécute — et celle-ci ne s'exécutait même plus.

---

## 2026-08-16 — Le mouvement, et l'état faux qu'il a fait sortir du bois

**Le constat de départ était partiellement faux, et c'est utile de le noter.**
« Aucun mouvement nulle part » : en réalité `Skeleton`, `Mouvement`
(`Apparition`, `useEnfoncement`, `vibration`) et l'animation de pile
`slide_from_right` existaient déjà. Le fil → fiche **était** animé. Ce qui
manquait n'était pas le mouvement mais son câblage : deux composants sur
vingt-six portaient l'enfoncement, cinq écrans sur dix-huit l'apparition, et le
squelette par défaut mentait sur la forme du contenu quinze fois sur dix-huit.

**L'exception, traitée à part parce que ce n'est pas de l'animation.** Les
préférences de notification affichaient les sept interrupteurs sur « activé »
tant que la réponse n'était pas arrivée : le défaut d'une *préférence absente*
appliqué à une préférence *pas encore lue*. Une valeur inventée montrée comme un
fait. Une silhouette aux dimensions exactes du `Toggle` la remplace, et un échec
de lecture se dit au lieu de laisser les silhouettes indéfiniment.

**Le squelette dit la forme, ou il aggrave le saut.** Le défaut d'`Ecran` est
trois cartes à photo de 150 px — juste sur le fil, faux ailleurs. Trois formes
s'ajoutent (`SkeletonLignes`, `SkeletonFiche`, `SkeletonGrille`) et six écrans
les prennent. Une garde vérifie **les deux sens** : chaque écran montre le sien
*et* ne montre pas celui par défaut, que le défaut a reçu un `testID` pour être
détectable.

**Le retour au toucher : une garde plutôt que des tests d'écran.** Sur
trente-quatre `Pressable`, un seul réagissait à l'appui — dont le bouton retour
de chaque écran, toute la navigation en grand écran, et le choix d'un créneau.
Le défaut n'est pas dans un écran, il est dans l'habitude d'écrire `<Pressable>`
avec un `style` objet : un test par site aurait couvert les trente-quatre
d'aujourd'hui et rien du trente-cinquième.

**La garde a d'abord accusé à tort, et c'est la leçon du jour.** Sa première
version connaissait quatre formes et déclarait `BusinessCard` sans retour — la
carte du fil, qui a un ressort depuis toujours, câblé par
`onPressIn={enfoncement.onPressIn}`. Une cinquième forme a été ajoutée, et la
garde s'éprouve désormais **sur les cinq**. Une garde qui accuse à tort se fait
désactiver ; c'est le même défaut que le garde-fou des rendus asynchrones, à
l'envers.

**Un fondu là où la pile ne voit rien.** Les bascules de la racine — connexion,
déconnexion, sortie de l'accueil — sont un rendu conditionnel et non une
navigation : `slide_from_right` ne s'y applique pas. `Fondu` les enchaîne, sur
une opacité seule : `Apparition` fait monter son contenu de dix pixels, ce qui
convient à une carte et pas à un écran entier. La `key` est ce qui rejoue le
fondu, et `brancheDeLaRacine` vit dans son propre module — importer `App.tsx`
depuis un test tire `expo-font` puis `expo-asset`, absent hors appareil.

**L'haptique sur les deux gestes qui engagent** : choisir un créneau et
réserver. Le parcours créateur était entièrement muet alors que les envois du
côté commerce vibraient déjà.

**Ce qui a été mesuré plutôt que supposé.** Le fil ne se recharge pas au retour
de la fiche : compté dans un navigateur contre le déploiement — un appel au
chargement, aucun au retour, aucun squelette. Changer de rayon relance bien une
requête, sans repasser par le squelette ; un aller-retour d'onglet ne relance
rien. `FilScreen` reste monté sous la pile et les dépendances de `useRequete`
sont des primitives. Aucun cache de session n'a donc été ajouté : il n'aurait
rien réparé.

**La transition partagée est écartée.** Elle demanderait Reanimated 3 et une
couche à maintenir, pour un effet spectaculaire — c'est-à-dire l'inverse de la
règle qu'on s'est donnée : le mouvement sert la lecture, il ne se montre pas.

**Une erreur de méthode.** `npx prettier --write` a reformaté huit fichiers en
style par défaut — le dépôt n'a aucune configuration Prettier, et le style
maison est en guillemets simples. Annulé et refait sans lui. La CI de l'app ne
vérifie pas le format ; celle de l'api, si, via `ruff format --check` en plus de
`ruff check`.
## 2026-08-16 — Les paliers ne sont plus un onglet, ils sont une réponse

L'écran des paliers sort des onglets créateur. Quatre au lieu de cinq.

**Ce que l'onglet faisait de travers.** Un onglet répond à une question qu'on se
pose en ouvrant l'application. « Quel est mon palier » n'en est pas une : ce que
la créatrice veut savoir en ouvrant BIND, c'est **ce qu'elle peut réserver**, et
c'est le fil qui répond. Les paliers sont la *raison*, pas la réponse — rangés
dans un onglet, ils étaient offerts à qui n'avait pas posé la question, et
absents au moment où elle se pose.

L'explication s'ouvre donc depuis une ligne du fil : « douze prestations vous
sont ouvertes ». Le nombre d'abord, la raison ensuite. L'information ne
disparaît pas, elle arrive quand elle sert.

**Rien à ajouter côté données.** `Fil.total_prestations` existait déjà.

**Une garde écrite puis retirée, et c'est le plus instructif.** La ligne portait
d'abord un `if (total <= 0) return null`, avec son test. La mutation qui a
supprimé la garde n'a rien fait tomber — parce que le test fabriquait un fil
peuplé avec un total nul, une réponse que le serveur ne produit pas :
`total_prestations` y vaut `sum(len(commerce.items))`, donc il est nul
**exactement** quand le fil est vide, et un fil vide rend `RaisonDuVide` à la
place de ce corps. La garde protégeait un état qu'aucun appel n'atteint, et le
test passait sans rien couvrir. Les deux sont partis. C'est la même leçon que
les trois champs d'API défensifs de la campagne précédente : le coût d'un repli
n'est pas nul, il crée un chemin que rien ne parcourt et un test qui ment sur ce
qu'il couvre.

**Ce que la coquille garde de plus.** Le test des onglets était écrit en
`arrayContaining` : il aurait laissé passer un sixième onglet sans rien dire.
Il compare maintenant la liste entière, dans l'ordre.

## 2026-08-16 — Une PR en conflit ne reçoit aucune CI, et ça ne se voit pas

Trois quarts d'heure perdus dessus, donc autant l'écrire.

La PR #126 n'a **jamais** déclenché d'exécution. Le workflow était actif, la PR
n'était pas en brouillon, la concurrence est par référence, et fermer puis
rouvrir n'a rien changé. La cause : `main` avait avancé et la branche était en
conflit. GitHub construit les exécutions `pull_request` sur le **commit de
fusion** ; quand il ne peut pas le calculer, il ne dispatche rien du tout.

Ce qui rend le défaut coûteux est ce qu'on voit à la place : `gh pr checks` ne
listait qu'un contrôle tiers en `skipping`. Ça se lit comme « en attente », pas
comme « rien n'a tourné ». **Le signal fiable est `gh pr view --json
mergeable`** : il valait `CONFLICTING`. Après rebase, `MERGEABLE`, et
l'exécution est partie dans la seconde.

À ajouter au réflexe déjà écrit dans `CLAUDE.md` — lire la conclusion du run
entier et non le décompte des contrôles : encore faut-il qu'un run existe.
Quand aucun n'apparaît, la question n'est pas « pourquoi est-il lent » mais
« la branche est-elle fusionnable ».

---

## 2026-08-17 — Le quartier, une liste fermée, et douze squelettes de plus

**Pourquoi une colonne et pas une lecture de l'adresse.** Le géocodeur ne rend
que des coordonnées : l'adaptateur Geocodio jette les composants d'adresse, et
`ManualGeocoder` — celui de la démonstration, des tests et du jeu de données —
ne résout rien du tout. Déduire le quartier d'une chaîne ne marcherait pas
davantage : « 2250 NW 2nd Ave, Miami, FL 33127 » est à Wynwood et ne le dit
nulle part.

**Fermée plutôt que libre, et c'est la décision.** Le quartier est un axe de
navigation : deux salons qui écriraient « South Beach » et « SoBe » ne se
compteraient pas ensemble, et le fil annoncerait deux quartiers là où il y en a
un. Neuf valeurs, déclarées par le commerce. Le serveur rend le **code**, jamais
le nom affiché — celui-ci vit dans les catalogues, identique en anglais et en
espagnol parce que ce sont des noms propres.

**Nullable, sans valeur « autre ».** Un salon hors des neuf quartiers n'a pas de
quartier chez nous, et l'absence le dit mieux qu'une catégorie fourre-tout qui
se remplirait de tout Miami. Il reste dans le fil et reste réservable : le
retirer pour une donnée de navigation le rendrait invisible pour une raison qui
ne le regarde pas.

**La distance d'un quartier est celle de son salon le plus proche**, jamais une
moyenne. « Wynwood · 4 salons · 1,2 km » doit désigner un salon qui existe
vraiment à 1,2 km ; une moyenne n'en désignerait aucun. Et le groupement se fait
sur **le fil déjà rendu**, comme les catégories : deux comptes calculés
séparément divergent au premier filtre, et c'est le compte affiché qui aurait
tort.

**Un tuple positionnel devenu nommé.** L'en-tête de commerce était lu par
indices dans le service du fil ; y insérer le quartier aurait décalé tout ce qui
suivait, et l'adresse serait devenue le quartier sans qu'aucun type ne s'en
plaigne. `_EnTete` est un `NamedTuple`.

**Le défaut que ce lot a produit, et qu'un test attrape désormais.** Le champ
traversait le schéma d'entrée, le service et la base sans encombre — et le
routeur, qui construit `BusinessRead` champ par champ, l'oubliait. Cent
dix-sept tests sont tombés d'un coup sur un `internal_error`. C'est exactement
le défaut nommé dans `CLAUDE.md` : un champ accepté puis perdu rend un 200 à
quelqu'un qui croit avoir enregistré. Trois tests de route le tiennent
maintenant, et les trois mutations correspondantes les font tomber.

**Les douze squelettes restants.** La garde ne vérifie plus seulement les six
premiers écrans : elle exige désormais que **tout** écran passant par `Ecran`
déclare le sien, et elle nomme la seule exception — `FilScreen`, dont le contenu
est vraiment une liste de cartes à photo. Une liste d'exceptions qu'on oublie
d'étendre est précisément ainsi que quinze écrans sur dix-huit s'étaient
retrouvés à mentir sur leur forme.

**Les couvertures verticales : les chiffres, et une conséquence.** Pour une
boîte pleine largeur sur 520 points de haut, l'écran le plus large en pratique
fait 430 points, soit 1290 px à densité 3, et 1560 px de haut. Format **4:5**,
minimum 1290 × 1612, à livrer en 1600 × 2000. Un 9:16 perdrait un quart de la
hauteur au recadrage là où un 4:5 perd 6 % en largeur.

La conséquence n'est pas dans le format : le fil sert aujourd'hui la **vignette**
bornée à 480 px sur le grand côté, ce qui donnerait une image agrandie trois
fois sur une couverture de 520 points. Le mur devra servir l'original, et le
dépôt devra borner l'original — il range aujourd'hui ce qu'il reçoit, soit
4000 px depuis un téléphone. Ce n'est pas fait dans ce lot.

---

## 2026-08-17 — La couverture verticale, et l'original enfin borné

**Un champ à part, jamais un remplacement.** `cover_portrait_key` s'ajoute à
`cover_photo_key` : la paysage sert encore la fiche et les listes, et la
remplacer casserait deux usages pour un troisième. Le mur retombe sur la paysage
quand la verticale manque — un 16:9 recadré vaut mieux qu'un monogramme. **Le
serveur ne recopie pas l'une dans l'autre** : deux champs qui portent la même
valeur ne se distinguent plus le jour où l'un des deux change, et c'est l'app
qui décide du repli.

**Le format, calculé plutôt que choisi.** Pour une boîte pleine largeur sur 520
points de haut : l'écran le plus large en pratique fait 430 points, soit
1290 px à densité 3, et 1560 px de haut. **4:5, minimum 1290 × 1612, livré en
1600 × 2000.** Un 9:16 perdrait un quart de sa hauteur au recadrage là où un 4:5
perd 6 % de sa largeur.

**L'original n'était borné par rien.** On rangeait ce qu'on recevait, soit
quatre mille pixels sortis d'un téléphone. Tant que le fil servait la vignette,
personne ne le payait ; le mur sert l'original — 480 px ne peuvent pas remplir
520 points — et trois salons par écran à cette taille rendraient le défilement
impraticable sur le réseau d'un salon. Le grand côté est désormais borné à 2000,
ce qui laisse passer le 1600 × 2000 sans rien lui écrêter.

**Le défaut que la première version introduisait.** Borner en réutilisant
`vignette` réencodait **toujours**, y compris les images déjà dans les clous :
une page de carte déposée en PNG net devenait un JPEG à qualité 82, et ses prix
s'y lisaient moins bien. L'extraction de carte l'a signalé — son test vérifie
que le modèle reçoit les octets déposés, et il recevait autre chose.
`borner_l_original` ne touche donc que ce qui dépasse ; ce qui passe la borne
ressort octet pour octet.

C'est la deuxième fois en deux jours qu'un test existant attrape une régression
que la relecture n'aurait pas vue. Le premier était le champ perdu par le
routeur, celui-ci le réencodage silencieux.

**La vignette à 480 ne bouge pas.** Elle reste juste là où elle sert — galerie,
carte, catalogue, listes. Une source unique pour le mur, en revanche : servir la
vignette au triptyque et l'original au cadre plein donnerait deux cadrages du
même salon selon sa position dans le cycle.

---

## 2026-08-17 — Little Haiti, et la garde que son ajout a révélée

Dixième quartier, décidé par Daniel après que la conversation design l'a
remonté : sa planche le montrait, il n'était pas dans les neuf validés. Ni elle
ni moi ne l'avons ajouté sur une maquette.

**Une valeur d'énumération ne se voit pas à l'autogénération.** `neighborhood`
est un `sa.Enum(native_enum=False)` : en base, ce n'est pas un type mais une
contrainte de vérification qui énumère les valeurs. Alembic compare les
contraintes **par leur nom** ; celui-ci ne change pas, donc ni l'autogénération
ni `alembic check` ne signalent quoi que ce soit. Une valeur ajoutée côté Python
sans migration serait refusée par la base au premier commerce qui la choisit —
un 500 sur une valeur que le schéma d'entrée accepte. La migration est écrite à
la main, et elle remplace la contrainte entière : une contrainte de vérification
ne s'étend pas.

**`op.f()` sur le nom de la contrainte**, sans quoi la convention de nommage du
dépôt le préfixe une seconde fois et produit
`ck_business_ck_business_neighborhood`. La migration échoue alors au `DROP` —
au bon moment, mais seulement si quelqu'un l'exécute.

**Deux gardes plutôt qu'un test.** Un test qui parcourt `Neighborhood` en entier
et crée un commerce pour chaque valeur : c'est le seul moyen de savoir qu'aucune
n'a été oubliée en base. Et côté app, un test qui exige un nom dans les deux
catalogues pour chacune.

**La seconde a été trouvée par mutation.** Retirer un quartier d'un seul
catalogue tombait déjà, sur la parité anglais/espagnol. Le retirer des **deux**
passait : l'écran aurait affiché `quartiers.little_haiti` en clair, dans les deux
langues, sans que rien ne le dise. La parité vérifie que les catalogues se
ressemblent, pas qu'ils sont complets.

**Vérifié plutôt que refait.** Le délai d'acceptation et le message sur le score
étaient donnés pour manquants ; ils sont sur `main` depuis la veille (#127) —
colonne, configuration, balayage, affichage des deux côtés, et la phrase sous le
bouton d'accord. Rien n'a été réécrit.

---

## 2026-08-17 — Vingt salons, et ce que le nombre a fait tomber

**Une table et un semeur, pas seize fonctions.** Les quatre premiers salons
sont écrits à la main parce qu'ils portent chacun un cas — variantes profondes,
items sans réservation, journée coupée, commerce vierge — et que ce cas *est*
leur raison d'être. Les seize suivants portent une seule chose : le nombre. Les
écrire à la main aurait donné quatorze cents lignes où seuls des noms changent,
et la première divergence entre deux d'entre eux serait passée inaperçue.

**Ce que le nombre a fait tomber, et qui ne se voyait pas à quatre.**

1. **Huit tests comptaient en dur** : « 4 commerces », « 10 offres »,
   `app_user == 10`. Ils sont dérivés du semis désormais — `4 + len(MARCHE)` —
   parce qu'un compte écrit en dur se périme au premier salon ajouté et ne dit
   plus rien de ce qu'il protège.
2. **Une prestation sans photo.** Le semis des photos passait son tour quand le
   nom n'était pas au catalogue des fichiers : vingt-huit items sont partis dans
   le fil sans image, et une carte sans image se lit comme une carte qui n'a pas
   chargé. Le chemin est dérivé du nom, ce qui rejoint le mécanisme existant —
   fichier absent, dégradé, et `A-FOURNIR.md` le réclame.
3. **Trois salons qu'aucune journée ne montrait.** Leurs offres portaient des
   items sans durée, donc sans créneau : le comptoir n'avait rien à afficher et
   le semis écartait leur réservation. Chaque salon a maintenant au moins une
   prestation réservable, et son offre porte dessus.
4. **Un salon invisible.** Panadería del Sol n'offrait qu'en TikTok, que Rebecca
   n'a pas : il n'apparaissait dans aucun fil de la démonstration. Un salon que
   personne ne voit ne démontre rien ; les obstacles de palier sont déjà
   représentés par des comptes qui les rencontrent vraiment.

**Les couvertures ne sont pas au format demandé, et ce n'est pas bloquant.**
Deux sur vingt sont en 4:5 ; treize sont en 2:3, trois en 3:4, deux en 9:16.
Après bornage du grand côté à 2000, dix-huit dépassent les 1290 px de large
qu'un écran de 430 points réclame à densité 3. Les deux 9:16 — `03` et `15` —
tombent à 1123 et 1125, soit un agrandissement de 13 % sur les téléphones les
plus larges. Visible de près, pas de loin.

**`04` n'est attribuée à personne.** C'est le salon de beauté, réservé à Havana
Glow, qui reste vierge et n'apparaît donc dans aucun fil. Elle attend le jour où
elle composera quelque chose.

**Le restaurant à choix a les deux formes.** `menu_url` rend son offre
publiable au semis, avant qu'aucune image n'existe ; les pages déposées montrent
l'autre forme. Un commerce peut avoir les deux, et la fiche publique doit savoir
les présenter — sans cela, ce mécanisme n'avait aucun sujet dans la
démonstration.

**Un import différé, et c'est le cycle qui l'impose.** `seed` importe
`ResumePhotos` de `seed_demo` : le second ne peut donc pas importer le premier
en tête de fichier. Lire `MARCHE` à l'appel rompt le cycle et évite de recopier
seize numéros de couverture — une seconde liste finit par donner à un salon
renommé la photo d'un autre.
## 2026-08-17 — Le mur : la position décide, pas nous

Le fil créateur est refait. Un mur vertical, six positions dans un ordre fixe,
huit salons puis une respiration.

**Ce que la règle achète.** L'alternance de la première passe était une
intention : quelqu'un décidait quel salon méritait le grand format. Ici la
position décide — les salons arrivent triés par distance et se posent dans
l'ordre. Le plus proche tombe en position 1, la plus grande, mais c'est un effet
du tri et non une mise en avant. Aucun classement éditorial, aucun salon promu,
et surtout **rien à défendre** le jour où un commerce demandera pourquoi il n'est
pas en héros.

Le placement vit dans `cycle.ts` et les trois arbitrages dans `regles.ts`, tous
deux sans JSX. Ce n'est pas un découpage de confort : une décision qui vit dans
du rendu se teste au travers de six composants, et celle-ci mérite d'être
éprouvée seule. Le jour où quelqu'un ajoutera « si le salon est bien noté, on le
monte », c'est un test qui dira non.

**Une lecture de la planche corrigée avant qu'elle ne coûte un champ.** La
conversation fonctionnelle s'apprêtait à demander à Daniel un champ serveur pour
les quartiers *hors rayon*, que la respiration aurait annoncés. Ce n'est pas ce
que fait le panneau : le salon juste en dessous **est** dans le quartier annoncé
— Design l'écrit, « la respiration est la porte du quartier qu'elle annonce ».
« Tu n'as rien vu dans » se dit donc de ce qui est **au-dessus**, pas de ce qui
est hors du rayon. Ça se calcule côté app avec ce qui existait déjà.

**L'échelle du texte ne suit pas la hauteur, et ça se lit comme une erreur.** La
bande fait 150 points de haut et porte un nom de 22 ; le duo en fait 238 et n'en
porte que 19. La place se mesure en **largeur** : la bande occupe tout l'écran,
le duo le coupe en deux. Un premier test affirmait la décroissance par hauteur
et tombait — c'est lui qui a révélé la vraie règle, et le commentaire du module
la nomme maintenant pour que la surprise ne passe pas pour un défaut.

**Une seule source d'image, la plus grande.** Le fil servait la vignette, bornée
à 480 px : sur un héros de 520 points à fond perdu, elle serait agrandie trois
fois. Le mur sert l'original, y compris là où un triptyque de 158 points s'en
contenterait — deux sources donneraient deux cadrages du même salon selon sa
position dans le cycle, ce que le mur existe précisément pour éviter.

*Ce qui reste ouvert, et qui n'est pas à moi :* **Little Haiti**. La planche le
montre, la liste fermée des neuf quartiers ne le contient pas. Deux choses
validées se contredisent ; remonté à Daniel, et le mur code sur les neuf en
attendant — le type ne permet rien d'autre.

## 2026-08-17 — La correction de fonte, et les deux tiers qui ne s'appliquent pas

Design a corrigé un défaut de chargement présent sur ses huit planches : axe
`opsz` retiré, graisses épinglées, pile de repli qui atterrit sur un Didone.

**Les deux premiers ne concernent pas le produit.** Il charge des TTF statiques
par graisse depuis `@expo-google-fonts` : il n'y a pas d'axe à retirer, et les
graisses sont épinglées par construction. Reprendre la correction telle quelle
aurait été du bruit.

**Le troisième s'applique, et seulement sur le web.** Sur appareil,
`fontFamily` désigne un fichier chargé — il n'y a pas de repli. Sur le build
web, le navigateur choisit seul tant que la fonte n'est pas arrivée, ou si elle
ne vient jamais : sans pile il atterrit sur sa fonte par défaut, un Times. Un
Didone du XVIIIe remplacé par une romaine de journal est le contraire de la
direction, et ça se voit sur le premier écran. `nomDeFonte` compose donc la pile
sur le web et rend le nom seul ailleurs.

## 2026-08-17 — La pile de repli a cassé l'enregistrement des fontes

Vingt minutes de CI rouge, et la leçon vaut plus que le correctif.

`nomDeFonte` sert **deux choses** : écrire un style, et **enregistrer** la face
auprès d'`expo-font`. J'y ai composé la pile de repli du web. Résultat : le
produit enregistrait une famille appelée « BodoniModa_400Regular, Didot,
"Playfair Display", Georgia, serif » — plus aucune face posée, et toutes les
fontes du web perdues. `pileDeFontes` est désormais une fonction à part, employée
là où l'on écrit un style et nulle part ailleurs.

**Ce que la suite unitaire ne pouvait pas voir.** Ses quatorze tests lisaient le
nom rendu ; aucun ne regardait ce qui part à l'enregistrement. C'est `e2e` qui
l'a dit — « aucune face enregistrée : expo-font n'a rien posé ». Quatrième défaut
que ce job trouve et qu'aucun test unitaire n'aurait vu.

**Et la garde écrite pour ça a d'abord été inutile.** Première version : forcer
`Platform.OS = 'web'` pour éprouver le chemin. La mutation qui remet la pile dans
`nomDeFonte` **passait quand même** — jest rend en natif, où la pile ne
s'applique pas, donc le test ne pouvait pas attraper le défaut pour lequel il
était écrit. Mocker `react-native` entier pour forcer la plateforme a fait tomber
un module natif sans rapport.

La garde vérifie donc **où** le repli est composé, à la source : `pileDeFontes`
le mentionne, `nomDeFonte` non, et il n'y a qu'une mention dans tout le fichier.
Une garde de source est le bon outil quand la distinction tient à une plateforme
que la suite ne joue pas — et la refuser par principe aurait laissé un test vert
qui ne protège rien.

## 2026-08-17 — Un test de bout en bout qui regardait un autre écran

Trouvé en réécrivant le fil, et il vaut plus que sa correction.

Le parcours de réservation vérifiait que la réservation prise apparaît bien dans
l'historique :

```ts
await expect(page.getByTestId('ecran-historique')).toBeVisible();
await expect(page.locator('[data-testid^="rangee-"]').first()).toBeVisible();
```

**`rangee-` n'a jamais été l'historique.** Celui-ci nomme ses lignes
`reservation-<id>`. `rangee-` était la grille du **fil** — l'autre onglet, resté
monté dans le document par la navigation web, donc trouvé par `.first()`. Le test
passait en regardant un écran qu'il ne visitait pas, et il ne l'a dit qu'en
tombant, le jour où la grille a disparu avec le mur.

C'est le défaut le plus coûteux de la famille : non pas un test qui ne vérifie
rien, mais un test qui vérifie **la mauvaise chose** et rassure sur la bonne. Une
suite de bout en bout y est plus exposée qu'une suite unitaire, parce que tout
l'arbre est là et qu'un sélecteur trop large trouve toujours quelque chose.

*La leçon transposable :* dans un test de bout en bout, un sélecteur par préfixe
doit être **porté par l'écran qu'on éprouve** — `page.getByTestId('ecran-x')
.locator(…)` plutôt qu'un `page.locator(…)` global. Ce qui n'a pas été fait ici :
la correction se contente de viser le bon identifiant, parce qu'élargir la règle
à toute la suite dépasse ce lot. Noté dans `TASKS.md`.

## 2026-08-17 — Les deux cadres qui encadrent le mur

**Le vide n'est pas une page d'excuse.** Les deux issues portent désormais leur
nombre — « Élargir à 30 km · 9 » — et le compte vient de `rayons`, que le
serveur rendait déjà. Sans chiffre, l'issue demande de tenter pour voir, et
personne ne tente deux fois.

Et **un élargissement qui n'ouvrirait rien ne se propose pas** : une issue à zéro
est un cul-de-sac chiffré, ce qui est pire qu'une issue absente — elle promet un
geste dont on revient bredouille.

**Le bas du fil est le seul fond d'encre du mur.** Il ferme, là où l'os des
respirations ouvrait ; une fermeture qui se répéterait cesserait d'en être une.
Il compte ce qui a été vu — salons, quartiers, répartition par contrepartie — et
ce décompte est **local par définition** : la planche dit « il compte ce qui a
été **vu** », donc il ne peut pas venir du serveur.

Le pied nomme le prochain palier et ce qu'il ouvrirait. C'est **la seule fois où
le fil parle des paliers**, et le seul endroit où c'est utile : depuis qu'ils ont
quitté les onglets, c'est là qu'une créatrice croise ce qui lui manque sans être
allée le chercher. `prochain_palier` a été demandé à la conversation
fonctionnelle et arbitré par Daniel — je ne l'ai pas pris comme acquis, et le
pied a été écrit pour se taire quand il vaut `null`, ce qui est un état réel et
non un repli.

**Cinq montages de test fabriquaient une réponse impossible.** Ils omettaient
`rayons` et `quartiers`, que `Fil` déclare obligatoires et que le serveur rend
toujours. Le premier réflexe était de rendre le composant défensif —
`fil.rayons ?? []` — et c'est exactement la faute déjà consignée deux fois : un
chemin que rien n'atteint, gardé par un test qui ment sur ce qu'il couvre. Ce
sont les montages qui ont été corrigés.

*Un compte que la planche illustre et ne contracte pas :* elle annonce « vingt
salons » ; le jeu de démonstration en rend dix-neuf, le vingtième restant vierge
par construction. Le pied lit `commerces.length` et dira dix-neuf. Confirmé par
Daniel.
---

## 2026-08-17 — Le prochain palier, et un classement qu'il a fallu refaire

Le seul endroit du produit où une créatrice croise ce qui lui manque sans
l'avoir cherché, et le seul depuis que les paliers ont quitté les onglets. Un
pied de fil qui dirait « d'autres salons » sans les compter serait une
bannière ; c'est le chiffre qui en fait une promesse.

**Le classement de la première version était faux.** Elle triait les paliers
fermés sur l'**écart brut** de leur obstacle : elle plaçait donc « une
collaboration de plus » devant « cinq mille abonnés de plus » parce que
1 < 5000. Ce sont deux grandeurs sans rapport, et les comparer revenait à
inventer un ordre. Le tri se fait maintenant sur le **nombre de conditions non
remplies** — à qui il manque une chose est plus proche qu'à qui il en manque
deux — et l'échelle du produit tranche les ex æquo : story, post, reel.

**On essaie les candidats dans l'ordre.** S'arrêter au plus proche ferait taire
le pied dès que ce palier-là n'a aucun salon dans le rayon, alors que le suivant
en a. On rend le premier qui ouvre vraiment quelque chose, et `None` sinon.

**Une requête à part, et elle est obligatoire.** La requête du fil filtre sur
`Tier.id.in_(paliers_ouverts)` : aucune ligne d'un palier fermé n'en sort.
Compter le gain sur elle aurait toujours rendu zéro — un pied muet, sans que
rien ne le signale. La requête dédiée ne part que lorsqu'un candidat existe.

**Ce que le champ ne fait pas.** Il ne compte pas les salons déjà rendus : un
commerce qui offre aux deux paliers est déjà à l'écran, et le compter comme un
gain ferait mentir le pied d'un rang.

## Les originaux des photos, et jusqu'où les garder

Question posée : faut-il garder 70 Mo de couvertures dans l'arbre de travail ?

**Elles ne sont pas dans le dépôt.** `.gitignore` exclut `assets/photos/**` :
ni l'historique ni un clone ne les portent. Les 70 Mo sont du disque local et
une copie manuelle entre arbres, ce qui coûte peu.

**Elles restent telles que livrées, et c'est délibéré.** Ce sont les masters :
le bornage à 2000 se fait au dépôt, une fois, et se refera si la règle change —
un mur plus haut, un recadrage paysage, un export retina. Réencoder les fichiers
source une fois pour toutes échangerait une gêne de disque contre une perte
définitive.

**Ce qui vaut la peine, en revanche, c'est de ne pas les livrer si gros.**
`20.jpg` fait 15 Mo en 5760 × 8640 ; rien n'en a besoin au-delà de 2000 px sur
le grand côté. La demande faite aux photographes — 1600 × 2000 en 4:5 — suffit,
et elle ramènerait le dossier entier sous les 10 Mo. C'est un réglage d'export,
pas un script à maintenir.

---

## 2026-08-17 — La règle des sélecteurs, passée sur toute la suite

La leçon était notée, la correction ne portait que sur son cas. Elle porte
maintenant sur les cinq fichiers de bout en bout, et une garde la tient.

**Sept sélecteurs partaient de `page`.** Le salon du fil, la grille des
créneaux, le bouton de confirmation, la ligne d'historique, les trois éléments
du code, les deux portes de l'accueil, les trois champs de connexion. Chacun
trouvait la bonne chose aujourd'hui, et aucun ne garantissait de la trouver
demain : en web, les onglets quittés restent montés, et un sélecteur trop large
trouve toujours quelque chose.

**Un huitième, trouvé par la garde et qui valait le détour.** `etat-nominal`
est le nom que le gabarit `Ecran` donne à son contenu chargé : il existe donc
sur **chaque** écran monté. `accorderLaPosition` l'attendait depuis `page` —
c'est-à-dire qu'elle attendait que n'importe quel écran ait chargé, y compris un
onglet d'arrière-plan. Elle reçoit désormais l'écran à surveiller.

**La garde ignore les commentaires**, et ce n'est pas un détail : le dépôt cite
le `rangee-` d'origine dans l'explication du défaut. Les compter ferait échouer
la garde sur sa propre explication, et le premier réflexe serait d'effacer
l'explication.

**Deux échappatoires, chacune une décision.** L'écran lui-même — c'est la
portée, elle ne peut pas être portée — et un écran reçu en paramètre, parce
qu'une aide partagée entre parcours ne peut pas nommer l'écran en dur.

**Et un second cas du même défaut, trouvé en appliquant la règle.**
`ecran-code` n'existait **nulle part** dans le produit. Le parcours vérifiait
pourtant qu'on n'y atterrit pas — `expect(page.getByTestId('ecran-code'))
.toHaveCount(0)` — une assertion qui constatait l'absence de ce qui n'existe sur
aucun écran, et qui ne pouvait donc pas échouer. Porter les sélecteurs a rendu
la chose visible immédiatement : `code.getByTestId('qr')` ne trouvait rien.
L'écran porte désormais son identifiant, et les deux assertions disent enfin
quelque chose.

**Une erreur de méthode, la seconde de la journée.** `git checkout` sur du
travail non commité a effacé cinq corrections d'un coup, découvertes parce que
la garde restait rouge. La règle qui vaut : commiter avant de muter, sans
exception.

---

## 2026-08-17 — Trois tâches fermées, et une réserve sur Geocodio

**Les polices** : vérifié sur `main` avant de cocher. Les deux corrections sont
documentées dans `polices.ts` — un nom de famille contenant un chiffre isolé,
que le navigateur rejetait en silence parce qu'en CSS un identifiant non
guillemeté ne peut pas commencer par un chiffre, et la pile de repli qui cassait
l'enregistrement des faces.

**Le vectoriel** : `$meta.unconfirmed` a disparu de `marque.json`, ce qui était
exactement la condition écrite dans la tâche.

**Geocodio, coché avec une réserve.** Le compte est ouvert et les clés sont chez
Render. Mais `render.yaml` fixe toujours `GEOCODING_PROVIDER: manual`, et
`GEOCODING_API_KEY` n'y est pas déclarée : la démonstration ne se sert donc pas
du géocodeur, et un déploiement neuf n'emporterait pas la clé. Ce n'est pas un
manque de développement — c'est une ligne de blueprint et une variable à
déclarer, le jour où on veut que la démonstration géocode vraiment. La tâche
disait « ouvrir le compte et poser la clé » ; elle est faite, et ce qui reste ne
lui appartient pas.

**La règle passée dans `CLAUDE.md`.** Commiter avant de muter, sans exception.
L'exercice de mutation restaure son sabotage par `git checkout`, et sur du
travail non commité cette commande efface le travail. Payé deux fois dans la
journée : la seconde a coûté cinq corrections de sélecteurs, retrouvées
seulement parce qu'une garde restait rouge. Ce n'est pas une préférence de
style, c'est la condition pour que l'exercice reste sûr.

## 2026-08-17 — Le vectoriel, tracé et mesuré

Le logo de la fondatrice est arrivé en PNG haute résolution. Il a été vectorisé
plutôt qu'attendu, et **la trace a été mesurée contre la source** plutôt que crue.

**Deux masques, une seule toile.** Le PNG est séparé par la couleur — lettres et
fût du « ! » d'un côté, point de l'autre — et chaque masque passe par `potrace`
sans recadrage. C'est ce qui garantit que les deux chemins s'alignent : un
premier essai avec `--tight` recadrait chaque trace sur sa propre boîte, et les
deux ne se superposaient plus.

**Ce que la mesure dit.** 99,75 % de recouvrement sur l'encre, 99,22 % sur le
point, et un écart de contour qui ne dépasse **jamais un pixel** — la largeur de
l'antialiasing de la source. La coupe oblique du D, qui est justement ce
qu'aucune fonte ne donne, mesure **-1,835° sur la source comme sur le tracé**.

**Deux chemins, et c'est ce qui rend la variante blanche possible.** Le point est
un chemin distinct : la variante blanche recolore les lettres seules, et le point
reste orange dans les deux cas.

**`taille` change de sens, et le plancher avec.** Elle désignait un corps de
fonte dont l'encre n'occupait qu'une part ; elle désigne maintenant la hauteur du
tracé. Le plancher passe de vingt-quatre à quatorze — ce n'est pas un
relâchement, c'est la même exigence sur une grandeur différente. Les cinq appels
du produit sont rééchelonnés pour que la largeur rendue ne bouge sur aucun écran.

**Un test qui a failli passer pour juste.** La règle qui décide entre logotype et
marque compacte se calculait depuis `largeurParLettre`. Ce chiffre a changé de
sens avec le vectoriel — la largeur des quatre lettres rapportée au corps devient
celle d'**une** rapportée à la hauteur — et le réutiliser sans le recalibrer
faisait dire à la règle qu'un favicon de seize pixels pouvait porter le logotype.
La borne est désormais celle que Design pose elle-même dans
`logo.mark16.$doctrine` : sous 128, le logotype ne tient pas. Une borne empruntée
vaut mieux qu'une borne dérivée d'une grandeur qui vient de bouger.

**`$meta.unconfirmed` tombe**, et `logo.$asset` avec. Le garder après avoir
obtenu ce qu'il réclamait ferait douter des autres manques qu'il nommerait.

*Un écart relevé et non corrigé :* le point de la fondatrice est `#FF5E00`, celui
du produit `brand.500` `#F26B21`, parce que `tokens.json` le prescrit « dans tous
les cas ». Les SVG portent la couleur du produit ; le PNG reste la référence de
forme. À arbitrer si l'écart n'est pas voulu.

## 2026-08-17 — `brand.500` passe à #FF5E00, mesuré avant d'être propagé

Le 500 devient `#FF5E00`, la couleur du fichier de la fondatrice. `#F26B21` était
une estimation lue sur une capture Instagram compressée ; celle-ci vient d'un
fichier fait par elle. Et le point du logo est le seul endroit du produit où la
marque se signe elle-même.

**La question posée était : est-ce que des seuils cassent.** La réponse est non,
et la marge est confortable.

| combinaison | avant | après | seuil |
| --- | --- | --- | --- |
| encre sur orange — bouton, palier reel, pastille de distance | 6,11:1 | **6,07:1** | 4,5 |
| blanc sur orange — le bloc accentué, ≥ 24 px | 3,04:1 | **3,06:1** | 3,0 |
| orange sur papier — interdit en texte | 3,04:1 | 3,06:1 | — |

La luminance ne bouge que de **-0,8 %** : `#FF5E00` a moins de vert et pas de
bleu, mais il est plus clair d'un cheveu en luminance relative. L'encre sur
orange perd quatre centièmes et garde une marge de 35 % sur son seuil ; le blanc
sur orange en **gagne** deux.

**La rampe l'accepte.** Teinte 22,1°, en plein dans les 20–24° des huit autres
valeurs. Luminosité 50 %, entre le 500 d'avant (53,9) et le 600 (44,1).
Saturation 100 %, la plus pure de la rampe — ce qu'on attend d'une couleur
d'ancrage, dont les autres stops sont des dérivés légèrement rabattus.

**Ce qu'il a fallu recuire.** Les trois satins portent le 500 dans leurs arrêts
et sont livrés en images : recuits, et leurs contrastes **remesurés** dans la même
exécution. `satin.drape` passe de 7,06:1 à 6,94:1 en haut, `fold` de 5,06 à 5,05.
Les commentaires qui citaient ces chiffres ont suivi — un commentaire qui annonce
une mesure cesse d'en être une dès qu'il diverge. Les fichiers de marque aussi :
le point du sigle et des icônes est orange, il devait le rester à la bonne
valeur.

*Un point relevé et non tranché :* l'écart de luminosité entre le 500 et le 600 —
l'état appuyé — se resserre de 9,8 à 5,9 points. La distinction tient, mais elle
est plus étroite qu'avant. À voir avec Design si l'appui doit descendre.

---

## 2026-08-17 — L'en-tête du mur nomme l'endroit, et trois manques nommés avec lui

Le fil rendait « Near you », un bonjour et des chips de rayon. La planche
v2.1 — et le cadre 03b du lot 1, qui dit la même chose depuis une autre
page — demande le quartier, le rayon avec son compte, la marque, et des
catégories avec les leurs. Ce n'est pas un habillage : un titre qui nomme
l'écran répond à « où suis-je dans l'application », et la question est « où
suis-je dans la ville ».

**Le filtre par catégorie était prêt et appelé par personne.** La route accepte
`categorie`, `ApiClient.fil` sait le passer, `Fil.categories` rend les comptes
en ignorant le filtre en vigueur — trois couches, aucun appelant. C'est le
pendant exact du champ accepté par un schéma et ignoré par un service : rien
n'échoue, et il faut lire les trois pour s'apercevoir qu'aucune ne sert. Le test
qui le couvre vérifie donc **l'URL réellement appelée** ; une assertion sur
l'état visuel de la chip aurait passé sur un filtre débranché.

**Réappuyer sur la catégorie en vigueur la retire.** Le cadre 03b pose un
« Clear » à côté de la rangée ; il est posé ici sur la chip elle-même. Le geste
qui a filtré est celui qu'on refait pour défiltrer, et il n'y a rien à chercher
des yeux.

**Sous deux catégories, la rangée entière disparaît, « All » compris.** Une chip
seule à côté d'« All » est un interrupteur qui ne commande rien : les deux états
rendent le même mur. C'est la raison qui avait déjà fait retirer
`theme.userOverride`.

**Une lecture non défensive a trouvé trois montages faux.** `fil.categories`
est lu sans `??`, comme `quartiers` : trois fichiers de test fabriquaient une
réponse sans ce champ, que le serveur rend toujours. Le repli les aurait
laissés mentir. C'est la cinquième fois que ce choix paie sur cet écran.

### Trois manques, nommés plutôt que comblés

**Le quartier où l'on est n'existe pas.** La planche l'écrit sans ambiguïté :
son cadre du vide affiche « Key Biscayne » alors qu'aucun salon n'y répond,
donc le nom ne vient pas du fil. Le produit ne sait pas résoudre une position en
quartier — `integrations/geocoding.py` ne fait que l'adresse d'un commerce vers
un point — et la ville du profil est un champ libre qui dit où l'on habite. Ce
qui est rendu est le quartier du **salon le plus proche**, que `quartiers` trie
déjà en tête ; sans salon, le titre s'efface au lieu d'inventer un nom.

**Le rayon ne se resserre plus.** Les chips de rayon partent avec la ligne
qu'elles occupaient. Élargir porte son nombre à deux endroits, mais `rayons` ne
rend jamais un rayon plus étroit que celui en vigueur : on ne revient pas de
30 km à 15 sans quitter l'écran. La planche n'offre aucun réglage de rayon —
c'est une décision de composition, pas un oubli, et elle revient à Design.

**Les catégories de Design ne sont pas celles du modèle.** « Nails, Hair,
Facials, Spa » sont des types de prestation ; le modèle ne connaît que six
catégories de commerce, et c'est à cette granularité que la route filtre et que
le serveur compte. Les chips sont livrées sur ce qui existe. Inventer la
taxinomie fine aurait été une colonne de base et un compteur de fil décidés en
passant.

---

## 2026-08-17 — Les rangées par quartier, et le salon qui aurait disparu

Design a tranché elle-même où placer la direction 1b : « le mur de 1a peut être
le fil par défaut, et les rangées de 1b devenir ce que montre une catégorie
choisie ». C'est donc la question posée qui sépare les deux rendus, pas un
réglage : le mur répond à « je descends sans intention », les rangées à « je
cherche quelque chose près de chez moi » — et appuyer sur une catégorie est
exactement la seconde phrase.

**Le vrai risque n'était pas la composition.** L'ossature de cette vue est le
quartier, et la liste des quartiers est fermée : un salon hors des dix ouverts
porte `neighborhood: null`, et le serveur ne le compte dans aucun quartier
(`feed.py` l'écarte explicitement). Une vue bâtie sur `quartiers` l'aurait donc
perdu **en silence** — filtrer par catégorie aurait caché des salons
réservables, ce qui est pire que ne pas filtrer du tout. Ils forment une
dernière rangée, sans nom de quartier à porter.

**Le seuil de la carte d'os est mesuré, pas choisi.** La première carte fait
216, les suivantes 150, l'écart 5, la marge 18 : sur 390 points, deux cartes
occupent 371 et s'arrêtent juste avant le bord. Il en faut trois pour que
quelque chose dépasse, et c'est ce dépassement qui annonce le glissement — la
planche s'y tient, « sans flèche ». Sous trois, la rangée ressemble à un
chargement qui a échoué : la carte d'os dit ce qu'il y a plus loin, ce qui est
à la fois l'information manquante et la preuve que rien n'a raté.

**Elle ne s'appuie pas.** Ce qu'elle annonce est la rangée juste en dessous,
déjà sur le même écran ; un lien qui ferait défiler de deux cents points
promettrait un déplacement que le geste fait déjà. C'est le traitement de la
respiration du mur, qui nomme un quartier, le compte, le situe, et ne prétend
pas être une porte.

**Le glissement horizontal, autorisé ici et interdit aux chips.** La
bibliothèque interdit le défilement horizontal aux rangées d'options, parce
qu'une option qui sort de l'écran n'existe pas pour qui n'y pense pas. Ici ce
qui sort est du **contenu**, pas un réglage, et le dépassement est précisément
ce qui annonce le geste. Une rangée qui reviendrait à la ligne perdrait les deux
axes qui font toute la direction.

**Une garde qui ne pouvait pas tomber.** `enRangees` en portait deux avant de
proposer un aperçu : la rangée suivante n'est pas celle des sans-quartier, et le
compte existe. La première ne pouvait jamais s'exécuter utilement — `quartiers`
ne contient que des quartiers nommés, donc y chercher `null` ne rend rien et la
seconde suffisait. Trouvée par mutation, pas par relecture. Retirée, et le nom
de la suite se lit désormais sur le compte, qui le porte typé.

**Le Didone reste à 34.** La planche le descend à 28 « sur ce seul écran », et
`type.heading` déclare 34 comme plancher. Deux sources validées se contredisent ;
le jeton est celle qui se vérifie mécaniquement, donc c'est elle qui est suivie
et l'écart est écrit dans `TASKS.md`. Trancher un plancher typographique en
passant, pour un écran, est exactement ce qui fait diverger un système.

---

## 2026-08-17 — L'étiquette du rail replié, et le geste qu'aucun test n'atteignait

Le rail de 72 gardait ses libellés dans l'arbre d'accessibilité et nulle part
ailleurs : un lecteur d'écran savait lire la navigation, un œil devait deviner
cinq pictogrammes. La planche Desktop v0.6 demande l'étiquette au survol depuis
qu'elle existe.

**Au survol *et* au focus.** Le survol seul aurait déplacé le manque au lieu de
le combler : le clavier traverse le même rail et rencontre les mêmes
pictogrammes.

**`onPointerEnter` et non `onHoverIn`.** Les deux nomment le même geste, mais
`Pressable` retient `onHoverIn` pour sa propre mécanique de pression et ne le
repose pas sur la vue rendue. Écrit avec `onHoverIn`, le composant aurait été
**intestable** — aucun événement ne serait arrivé, et le test aurait dû être
abandonné ou truqué. Vérifié sur un rendu avant d'écrire la ligne : les
événements de pointeur, eux, traversent jusqu'à l'hôte.

**L'étiquette vit hors du défileur.** Posée dans la ligne, elle aurait été
rognée net : un `ScrollView` vertical coupe ce qui déborde à droite, et aucun
test de rendu ne le voit — on ne l'aurait découvert que dans un vrai navigateur,
c'est-à-dire au même endroit que les trois défauts qui ont motivé la suite de
bout en bout. Elle est donc ancrée dans la barre, avec la position que la ligne
**rapporte** et le défilement retranché. La déduire du rang et de la hauteur
marcherait jusqu'au premier changement de densité, où elle désignerait la
voisine.

**Elle est cachée des lecteurs d'écran**, le libellé étant déjà sur la ligne :
l'annoncer deux fois est une gêne, pas un service. Conséquence de test, qui vaut
d'être écrite : la chercher demande `includeHiddenElements`, et c'est le test
qui a rendu la règle visible plutôt que l'inverse.

**Deux tests changeaient de sens tout seuls.** Le repli est retenu par appareil,
et le stockage simulé survit d'un test à l'autre : un test qui repliait le rail
décidait de l'état de départ des suivants, si bien que « presser la bascule » y
**dépliait**. Un `beforeEach` qui vide le stockage, et un `replier()` qui
regarde avant d'appuyer.

**Une garde qui ne pouvait pas tomber, rendue vérifiable.** `oublier` n'efface
que la ligne qu'il avait posée. Aucun test ne l'atteignait, parce que dans
l'ordre courant le pointeur quitte A avant d'entrer dans B. Le geste réel est un
glissement : à la vitesse d'une main, l'entrée dans B peut précéder la sortie de
A, et effacer sans regarder referme alors l'étiquette qui venait de s'ouvrir. Le
cas est maintenant écrit, et la mutation le fait tomber.

---

## 2026-08-17 — Les cinq réserves du mur, tranchées par Daniel

Trois sont des écarts à la planche, assumés ; deux étaient des défauts.

**On ne nomme pas le quartier où l'on est.** La planche le veut — son cadre du
vide affiche « Key Biscayne » alors qu'aucun salon n'y répond, donc le nom ne
vient pas du fil — et rien ne sait le résoudre. Le quartier du salon le plus
proche avait été rendu à sa place ; il tombe. **Annoncer un lieu qu'on ne peut
pas vérifier est la classe de défaut que ce dépôt passe ses journées à
corriger** : plausible, invérifiable de l'autre côté, donc jamais relevé.

**Le rayon se règle de nouveau dans les deux sens.** Le retrait des chips était
une régression : `rayons` ne rend jamais un rayon plus étroit que celui en
vigueur, donc élargir engageait la session entière. Le bas du mur porte un
retour au rayon de départ, provisoire — sa place est la feuille de filtres. Il
ne porte **pas** de nombre, contrairement aux deux autres sorties : celles-là
promettent un gain qu'on ne peut pas deviner, celle-ci ramène à l'état d'où l'on
vient, et lui coller un compte demanderait une requête pour dire ce qu'on savait
déjà. Un seul objet porte le geste et sa cible, plutôt qu'un rappel et un nombre
qu'il aurait fallu garder l'un contre l'autre.

**Les catégories sont les six du modèle.** Design a dessiné Nails, Hair, Facials
et Spa quand le produit était beauté seule ; il y a maintenant des restaurants,
des salles de sport et des musées.

**Le plancher du Didone tient à 34.** La raison de Design est bonne — cinq
salons ne méritent pas l'emphase de vingt — mais **une exception qui n'est pas
écrite dans les jetons est une violation**.

**Le mur va à fond perdu, et la règle qui en sort vaut mieux que le réglage :
`Ecran` marge ce qu'il compose, l'appelant marge ce qu'il fournit.** Le bandeau
d'erreur et le squelette par défaut sont écrits dans `Ecran`, donc ils gardent
leur marge ; l'en-tête, le corps, l'état vide et un squelette fourni viennent de
l'écran, qui seul sait lesquels de ses blocs touchent le bord.

**Pas une marge négative**, qui aurait été plus courte à écrire et fausse : elle
se serait fait rogner par le défileur sur un téléphone, où le conteneur occupe
déjà toute la largeur, et serait passée sur grand écran, où il est plus étroit
que le défileur. Un défaut qui n'apparaît que sous un seuil de largeur est
exactement ce qu'aucun test de rendu ne voit.

**Et le test du fond perdu passait sur le défaut qu'il interdisait.** Il
remontait l'arbre en ne lisant que `style` ; la marge de l'écran vit sur
`contentContainerStyle` du `ScrollView`. Débrancher le fond perdu ne le faisait
pas tomber. Trouvé par mutation, pas par relecture — la sixième fois cette
semaine.

---

## 2026-08-17 — Où passe le temps, mesuré plutôt que supposé

Question de Daniel : je passe plus de temps à vérifier qu'à écrire, et il veut
la même vérification en moins de temps. Mesuré au lieu d'être répondu de
mémoire — et les deux hypothèses de départ, les miennes comme les siennes,
étaient fausses.

| | mesuré |
| --- | --- |
| Suite jest entière | **13,0 s** (`user` 39,4 s sur 10 cœurs) |
| Un fichier de test | 1,7 s |
| Une exécution CI | **~750 s** |
| dont `api` | 754 s, **dont 704 dans `pytest` seul** |
| dont `e2e` | 215 s |
| dont `app` | 60 s |

**Sept exécutions CI sur une session : environ 85 minutes.** Tout le reste —
écriture, tests, suites locales, cinquante et une mutations — tient sous le
quart d'heure de calcul cumulé.

**Le parallélisme était déjà là** côté jest : trois fois le temps réel en temps
processeur. Rien à gagner.

**Les mutations visaient déjà le fichier concerné**, et la prémisse « la suite
entière coûte plusieurs minutes » était fausse d'un facteur soixante.

**Mais la mesure a trouvé autre chose** : `entete-du-mur.test.tsx` coûtait
17,4 s quand ses voisins en prenaient 1,7 — un test que j'avais écrit laissait
une requête pendante pour observer l'état de chargement, et Jest attendait le
handle ouvert. Relâcher la requête à la fin du test : 2,5 s. C'est moi qui avais
fabriqué le coût, et il retombait dans chaque boucle de mutation.

### Le court-circuit, et la seule forme qui préserve la protection

`main` exige `api`, `app` et `e2e`. Un job **sauté** par une condition de job ne
rapporte jamais rien : la fusion l'attend indéfiniment et la protection se
retourne contre elle-même. La condition est donc posée sur les **étapes** — le
job démarre, ne fait rien, et sort en vert.

**En cas de doute, tout s'exécute.** Base de comparaison introuvable, `git diff`
en échec, événement inattendu : le repli est « tout a changé ». Un court-circuit
qui se trompe dans l'autre sens laisse passer exactement ce qu'il prétend
vérifier, et personne ne le sait.

Deux dépendances croisées valaient d'être écrites : `openapi.json` vit dans
`app/` et **est le contrat que le job `api` regénère et compare**, donc le
modifier seul doit réveiller `api` ; et le test des catalogues lit
`api/app/core/errors.py`, donc un code d'erreur ajouté côté serveur doit
réveiller `app`.

### La garde de durée : le test, et non le fichier

Écrite d'abord sur les **fichiers**, à dix fois la médiane — et **elle a échoué
en intégration continue sur trois fichiers parfaitement sains**.
`ecrans-commerce` met huit secondes parce qu'il porte cent vingt-quatre tests à
soixante-cinq millisecondes. Un fichier n'est pas lent parce qu'il contient un
défaut, il est long parce qu'il contient beaucoup — et un faux positif sur une
vérification requise est la manière dont un garde-fou finit par être désactivé.

L'unité est donc le **test**. Le rapport à la médiane est tombé avec : la
médiane d'un test est de quatorze millisecondes, donc dix fois la médiane vaut
cent quarante, et le plancher domine toujours. Un rapport qui ne décide jamais
rien est une décoration qui donne l'air d'un seuil réfléchi.

Reste un plafond, **mesuré** : le test légitime le plus lourd met 1,5 s, les
défauts fabriqués pour l'éprouver en mettaient onze. Cinq secondes laissent
trois fois la marge d'un côté et deux de l'autre.

**Trois formes fabriquées, trois attrapées** : une attente réelle qu'on regarde
passer, un `waitFor` qui va au bout de son délai, un intervalle non avancé.
**Le cas qui l'a motivée lui échappe** — les dix-sept secondes étaient du démontage, et Jest ne les compte
pas dans la durée du fichier. Vérifié en rejouant le défaut : le fichier fautif
ne ressort même pas parmi les cinq plus lents d'une exécution complète.

L'outil de cette classe est `jest --detectOpenHandles`. Il ne peut pas encore
être exigé : la suite force la sortie d'un worker à **chaque** exécution, sur
l'arbre propre, avant comme après cette correction. La fuite est ailleurs et
n'est pas identifiée — tâche à part. Écrire la limite de la garde vaut mieux que
la laisser faire croire que la question est réglée.

### La mesure du court-circuit

Éprouvé sur une PR qui ne touche que `DECISIONS.md`, contre une exécution
complète relevée quelques minutes plus tôt sur le même dépôt.

| | complète | docs seulement |
| --- | --- | --- |
| `perimetre` | 5 s | 4 s |
| `api` | 739 s | **22 s** |
| `e2e` | 226 s | **21 s** |
| `app` | 56 s | **3 s** |
| total | **~750 s** | **33 s** |

`perimetre` a rendu `api=non app=non e2e=non`, et **les trois vérifications
requises rapportent `pass`** : c'est la moitié qui comptait. Un job sauté
n'aurait rien rapporté du tout, et la fusion l'aurait attendu indéfiniment.

Le plancher qui reste — vingt secondes sur `api` et sur `e2e` — est le démarrage
du conteneur Postgres, qu'un `services:` ne sait pas rendre conditionnel. Trois
secondes sur `app`, qui n'en a pas.
---

## 2026-08-17 — Le fil : la disponibilité groupée, le compte par palier, la recherche

### La disponibilité : 121 requêtes, puis 9

Le fil vérifiait la disponibilité **couple par couple**. Six lectures — l'item,
son parent, le commerce, les règles, les exceptions, les occupations — répétées
pour chaque ligne réservable : dix-neuf salons coûtaient **cent vingt et une
requêtes** et cinquante-six millisecondes. Après groupement : **neuf requêtes,
dix millisecondes**, pour un résultat identique.

**`couples_avec_creneau` ne réimplémente pas le calcul.** Les six lectures se
font une fois pour tout l'ensemble, puis `fenetres_du_jour` et
`_creneaux_de_la_fenetre` — ceux de `creneaux_libres` — s'appliquent en mémoire.
Une seconde implémentation de la disponibilité divergerait de la première au
premier changement, et c'est la divergence qu'on ne verrait pas : les deux
répondraient, l'une aurait tort. Le test central compare donc les deux verdicts
couple par couple.

**Le groupement porte sur l'ensemble large, jamais sur le fil rendu.**
`_compter_par_rayon` a besoin des lignes *au-delà* du rayon pour écrire
« élargir à 30 km · 9 salons » ; `_compter_par_categorie` a besoin de celles
*hors* de la catégorie filtrée. Restreindre avant la vérification ferait mentir
les deux issues de l'écran vide.

**Le filtre `disponible`, lui, se pose après les comptes.** C'est un choix sur
ce qu'on regarde, pas sur ce qu'on propose d'élargir. Un test vérifie que
`categories` et `rayons` ne bougent pas quand le filtre s'applique — c'est la
seule chose qui garantit l'emplacement.

**« Aujourd'hui » vaut un jour glissant, pas « jusqu'à minuit ».** À vingt-trois
heures, la seconde définition ne rendrait presque rien et la créatrice
conclurait que le quartier est vide alors qu'il ouvre dans neuf heures.

**Un cas qu'il a fallu construire.** Rien ne distinguait « sept jours » de
l'horizon complet : une règle de capacité est hebdomadaire, donc elle revient
toujours sous sept jours. Il a fallu un salon **fermé par exception** les huit
prochains jours pour que la fenêtre ait un sens éprouvable.

### Le compte par palier : la position acceptée, jamais exigée

Faire dépendre `/me/tiers` d'une position avait été écarté, et à raison — les
paliers d'un créateur ne changent pas parce qu'il a bougé. La distinction qui
manquait : la route **accepte** une position sans en **dépendre**. Sans
coordonnées, la réponse est celle d'avant au champ près ; avec, chaque palier
porte `commerces_dans_le_rayon`.

**`None` et non zéro quand rien n'est demandé.** L'écran doit distinguer « on
n'a pas demandé » de « il n'y en a aucun autour de vous » : rendre zéro ferait
afficher « aucun salon près d'ici » à quelqu'un dont on ignore où il est.

**Des commerces, pas des offres.** La phrase à écrire est « douze au total, dont
neuf à moins de quinze kilomètres » : un salon qui propose trois prestations au
même palier ne compte qu'une fois dans le second nombre, sinon on dirait
« dont quatorze » d'un total de douze.

**Une seule coordonnée est refusée.** C'est une erreur de l'appelant, pas une
demande à moitié : l'accepter en silence ferait répondre « aucun commerce
autour » à quelqu'un dont la latitude s'est perdue en route.

### La recherche : une extension, pas un moteur

`ILIKE` avec `unaccent`, dans la requête du fil qui existe déjà. À vingt salons
et soixante prestations, c'est un balayage de quelques microsecondes ; un index
coûterait plus cher à tenir qu'à ne pas exister. **La forme de la requête ne
change pas quand les données grossissent** : le jour venu, `pg_trgm` et un index
GIN sur les mêmes expressions suffisent, sans rien réécrire.

**`unaccent` des deux côtés.** Sur la colonne parce que « Panadería » porte son
accent, sur le terme parce qu'on peut le taper avec. Ne le mettre que d'un côté
ferait échouer exactement la moitié des cas.

**Le terme est échappé.** Un `%` tapé cherche un pour cent ; laissé tel quel il
devient un joker qui rend le catalogue entier à qui a cherché « 50% ».

### Les suggestions : « populaire » est vrai ou se tait

Deux groupes — prestations et salons — passés par **le même tamis que le fil**.
Une suggestion qu'on ne peut pas réserver envoie sur une impasse quelqu'un qui
cherchait de l'aide.

**`origine` porte la différence, et l'écran change de mot.** On classe sur les
réservations **servies** du quartier ; quand il n'y en a aucune, on retombe sur
la distance et on le dit. Un salon proche annoncé comme populaire est un
mensonge que personne ne peut vérifier — le créateur n'a aucun moyen de savoir
combien de fois il a été réservé. L'application a deux phrases, pas une phrase
et deux contenus.

**Le quartier vient de la position** — celui du salon ouvert le plus proche —
jamais d'un paramètre. Le demander à l'appelant reviendrait à lui faire décider
ce qu'on est mieux placé pour savoir, et à accepter qu'il se trompe.

**La disponibilité n'est pas vérifiée dans les suggestions**, délibérément : une
suggestion est une entrée dans le fil, pas une place réservée. La vérifier
coûterait le calcul le plus cher du produit pour un panneau qu'on ouvre en
tapant, et le fil la vérifiera à l'arrivée.

### Trois gardes redondantes, gardées et dites

L'exercice de mutation a montré que trois conditions ne changent aucun verdict :
la durée nulle et l'absence de règle dans `couples_avec_creneau`, et le statut
`consumed` dans le compteur de popularité — `consumed_at` étant nul partout
ailleurs. Elles sont conservées et **annotées** : elles disent l'intention à qui
lit, là où une comparaison de date sur une colonne nullable la laisse deviner,
et elles protègent d'un changement de contrainte qui casserait la boucle.

---

## 2026-08-17 — L'audience, confrontée à sa planche

L'écran que Daniel a qualifié deux fois de plus faible du produit, sans pouvoir
le nommer. Le registre des planches donne la raison : `Lot 1 v1.1` était la
seule planche sans entrée nulle part. Ses écrans emploient les jetons de la
v1.0 — ils ont traversé la migration — donc **rien ne signalait** qu'ils
n'avaient jamais été comparés cadre par cadre. Repeint n'est pas passé.

**Un chiffre appartient à un compte, et à une date.** L'écran empilait des
lignes de données sans dire à qui elles étaient : deux réseaux connectés y
auraient partagé visuellement un chiffre. Un bloc par compte, le réseau en
tête, le relevé daté sous les valeurs.

**Un compte connecté est une carte, un réseau à connecter est une ligne : la
forme dit l'état avant le mot.** L'écran rendait deux boutons blancs
identiques, l'un sous l'autre — **y compris pour un réseau déjà rattaché**. Il
proposait donc de connecter ce qui l'était. Ce n'est pas une question d'allure :
les deux objets n'ont pas la même action, et rien ne le disait.

**Le tiret cadratin, et la phrase qui dit ce qu'il veut dire.** « Pas encore
mesuré » se lisait comme une valeur ; le tiret ne se lit pas comme une quantité,
ce qui est sa fonction — mais un tiret seul se lit comme une panne, d'où la
phrase. Afficher zéro à quelqu'un qui a douze mille abonnés reste la pire chose
que cet écran puisse faire.

**Deux blocs manquaient.** « Ce qui compte pour les paliers » — les abonnés
n'ouvrent pas un palier seuls, et personne n'allait chercher les collaborations
et le score sur un autre écran. Et **les termes du contrôle** : `SignalJuge`
porte `constate` et `requis` depuis toujours, l'écran n'affichait que le
verdict, si bien qu'« ancienneté : insuffisante » ne disait ni de combien ni
depuis quand. Un verdict sans ses termes ne se conteste pas, et ne s'améliore
pas non plus. **Deux champs servis et rendus nulle part** — la même classe que
le paramètre `categorie` que personne n'envoyait.

**Un test a été repris plutôt que contourné.** Il bannissait le mot « day » sur
tout l'écran, ce qui interdisait le compteur de jours que la planche demande. Ce
n'est pas le mot qui promet, c'est la forme : « jour 3 » dit ce qui s'est passé,
« sous 3 jours » dit ce qui va se passer, et seule la seconde se brise le
premier jour de charge auprès de gens qui n'ont rien fait de mal. La garde
interdit désormais les formes de promesse et **exige** le compteur d'écoulé.

**Une clé de traduction est morte avec le changement** et a été retirée :
`jamaisMesure` ne commandait plus rien.

---

## 2026-08-17 — Les réservations : chaque ligne dit ce qu'elle attend

Le deuxième écran du trou trouvé par le registre. Trois lignes se
ressemblaient — celle qui demande un geste, celle qui attend un contrôle, celle
qui est close — et il fallait lire les trois pour trouver laquelle agissait.

**La règle sort du rendu.** `attenteDe` rend `creatrice`, `controle` ou rien, et
s'éprouve sans monter un écran — même découpage que le cycle du mur. Ce qui en
découle : filet d'encre et bouton pour la première, **des mots** pour la
seconde.

> **Renversé le 2026-09-04, et cette moitié-là ne vaut plus.** « Des mots pour la
> seconde » a tenu six semaines et n'a pas suffi : une ligne qui attend un
> contrôle restait dans l'onglet de celles qui appellent un geste, et le seul
> moyen de savoir laquelle on regardait était de lire la ligne entière. La
> distinction a désormais son onglet — « in review » / « Revisión ». `attenteDe`
> n'est pas retirée pour autant : elle **devient** la définition serveur du
> quatrième onglet, ce qui est une promotion plutôt qu'un abandon. Le reste de
> cette entrée — le filet d'encre, l'action retirée plutôt que grisée, les deux
> champs servis et rendus nulle part — reste vrai. Un bouton grisé se presse quand même et ne répond pas ; l'action
impossible se retire, c'est déjà la règle de la bibliothèque et cet écran ne la
tenait pas.

**Une contradiction interne, corrigée.** La ligne était pressable dès qu'une
contrepartie existait : une ligne affichant « rien à faire de votre côté »
ouvrait l'écran de preuve. La ligne et son texte se contredisaient, et c'est le
texte qui avait raison.

**Deux champs servis et rendus nulle part**, la troisième fois cette session
après `categorie` et `constate`/`requis` : `deadline_at`, qui est la seule chose
décidant s'il faut agir ce soir ou la semaine prochaine, et `attempts_count`,
qui ne s'affiche qu'à partir de la seconde — « tentative 1 sur 3 » sur une
première publication annoncerait un échec qui n'a pas eu lieu.

**Le badge porte le palier et le réseau.** La même prestation peut exister sur
deux comptes : « one story » ne dit pas sur lequel publier, et publier sur le
mauvais ne compte pas.

**Ce qui reste hors de portée sans le serveur** : les exigences de la
contrepartie — mention attendue, géotag — et le motif de reprise, que le cadre
08b affiche en ligne. `ContrepartieBreve` ne les porte pas, et les chercher
demanderait un appel par ligne.

---

## 2026-08-17 — La garde des champs servis et rendus nulle part

Trois fois dans une session, et aucune n'a échoué : le paramètre `categorie`
que le fil acceptait et que personne n'envoyait ; `constate` et `requis` sur les
signaux de vérification ; `deadline_at` et `attempts_count` sur la contrepartie.
Daniel l'a nommé mieux que moi — **trois fois n'est plus une série de
distractions, c'est un défaut de méthode**, et c'est le même que celui de
l'audit des planches : ce qui existe mais que personne ne branche.

Le mode d'échec est toujours identique et c'est ce qui le rend invisible : rien
ne tombe, l'écran paraît complet, les jetons sont les bons, et l'information qui
décide du geste suivant n'est pas à l'écran.

**La garde.** Chaque champ déclaré dans `types.ts` est soit lu quelque part dans
`src/`, soit inscrit dans une table avec sa raison. Trois raisons seulement, et
la troisième est une dette nommée : `contrat` — servi pour une autre façade ;
`technique` — consommé par le client d'API ; `a-instruire` — **rien ne dit que
c'est délibéré**. Cette troisième catégorie est la partie honnête du dispositif :
mettre quatorze champs sous « contrat » sans le vérifier aurait fait de la table
un tapis.

**Elle tient dans les deux sens.** Un champ inscrit qui se met à être lu fait
tomber le test : sans quoi la table vieillit, se remplit de lignes fausses, et
cesse de dire quoi que ce soit — ce qui est arrivé à `$meta.unconfirmed`, gardé
longtemps après que le manque a été comblé.

**Ce qu'elle ne fait pas, écrit plutôt que laissé croire.** Elle lit du texte,
pas un arbre syntaxique : un champ au nom commun — `status`, `name`, `id` — sera
trouvé quelque part même s'il n'est jamais lu *sur ce type-là*. Faux négatifs,
aucun faux positif. C'est le bon sens de l'erreur pour une vérification requise.

**Elle a payé en une minute.** 53 champs sur 430 ne sont lus nulle part.
Quatorze sont suspects et partent dans `TASKS.md` — dont
`ReservationDuCreateur.business_address`, que le cadre 08a affiche et que je
venais moi-même de ne pas rendre en composant cet écran. La garde a trouvé un
quatrième cas du défaut dans le commit qui la précède.

---

## 2026-08-17 — Le cadre 02 était déjà passé, et le registre le surestimait

Confronté cadre par cadre, il n'y avait presque rien à faire, pour une raison
qui vaut d'être écrite : **le cadre 02 de `Lot 1 v1.1` est la planche
`Tiers v0.7`, restylée.** Il le dit lui-même en sous-titre — « la v0.7 dans le
nouveau système ». Cette planche-là a eu sa propre tâche, livrée et éprouvée à
douze mutations.

Le registre l'avait comptée comme jamais confrontée parce qu'il regardait
`Lot 1 v1.1` **en bloc**. C'est la limite d'un registre par planche dès que deux
planches se recouvrent, et elle entre dans sa règle : l'état se lit par cadre
quand un cadre a déjà sa propre planche. Un registre qui surestime le manque
coûte moins cher qu'un registre qui le sous-estime — mais il coûte quand même,
et le dire évite de refaire ce qui est fait.

**Un cas où la planche est périmée et non l'écran.** Le cadre 02a affiche un
tiret cadratin sur ce qu'un palier fermé ouvrirait, avec un encadré qui explique
pourquoi : `offres_disponibles` n'existait pas, « je n'ai pas inventé le
nombre ». Le champ existe depuis, pour les paliers fermés aussi, et son contrat
dit « zéro est une réponse ». Rendre le vrai nombre vaut donc mieux que le
tiret, qui ne signalait qu'une donnée absente. Suivre la planche à la lettre
aurait ici **retiré** une information.

Reste une seule chose de ce cadre : « See the 34 services » est la porte du
cadre 11c. `onVoirLesPrestations` existe sur l'écran et `porteOuverte` en
dépend ; la navigation ne le passe pas. Les deux se prennent ensemble.

**Et la e2e est tombée sur cette PR, pour la bonne raison.** Elle visait le
texte « Show code › ». La ligne porte maintenant un vrai bouton, dont le libellé
a changé : le test est tombé sur un écran parfaitement fonctionnel. C'est le cas
que `CLAUDE.md` enregistre déjà — « un test asservi à un `testID` retiré par la
PR elle-même » — dans sa variante libellé, qui est pire : un libellé est une
décision de composition, et il changera encore. Le sélecteur porte désormais sur
l'action, `[data-testid^="agir-"]`, et part de l'écran plutôt que de la page.

Les deux clés `ouvrir_code` et `ouvrir_preuve` sont mortes avec le changement et
retirées : une clé qui ne commande plus rien fait douter de celles qui
commandent quelque chose.

---

## 2026-08-18 — Le cadre 11c, et la porte qui ouvrait dans le vide

`onVoirLesPrestations` existait depuis la refonte v0.7 et personne ne le
passait — délibérément, et c'était le bon choix : une porte qui annonce
trente-quatre prestations et ouvre sur autre chose ment plus qu'elle ne rend
service. Ce qui manquait était une lecture **non bornée par la distance**.
`/businesses` ne peut pas la rendre : il est borné par un rayon par
construction, exige une position, et trie par distance — ce qui n'a aucun sens
pour « tout BIND ».

**L'ordre a été tranché avant la route, et c'était le bon ordre de décision.**
Par quartier puis par nom : le seul axe que le produit connaît et qui ne classe
personne. Trier par palier hiérarchiserait des prestations qu'on peut toutes
réserver ; trier par salon supposerait un ordre entre eux. C'est aussi l'axe des
rangées du fil — le même des deux côtés, ce qui vaut mieux qu'une coïncidence.

**Deux nombres dans la même phrase, et ils comptent la même chose.** Le champ du
proche a failli compter des salons quand la phrase compte des prestations : deux
grandeurs différentes dans une ligne où les deux restent plausibles, donc où
personne ne l'aurait jamais remarqué. C'est le genre de défaut qu'on n'attrape
qu'en lisant le nom du champ à côté de la phrase qu'il sert.

**`null` n'est pas zéro, et la conséquence va plus loin que le texte.** Sans
position, la moitié de la phrase se tait — « aucune à moins de quinze
kilomètres » serait faux et décourageant — **et la bascule disparaît avec elle**,
parce qu'il n'y a rien à basculer quand on ignore où l'on est. Elle disparaît
aussi quand tout est dans le rayon : les deux états montreraient la même liste,
la faute que le produit a déjà retirée deux fois.

**Une prestation sans distance n'est pas loin, elle est d'origine inconnue.**
Elle sort du « près de vous » sans être écartée du total.

**Quatre tables exhaustives ont fait tomber la suite à l'arrivée de l'écran** —
blocs orange, couverture des écrans, squelettes, et les quatre états. Aucune
n'était un obstacle : chacune a demandé une décision écrite sur un écran neuf,
ce qui est précisément le prix qu'elles existent pour faire payer.

---

## 2026-08-18 — Une garde de parité qui ne regardait jamais les appels

La conversation fonctionnelle a trouvé côté serveur une garde anti-fuite qui
surveillait sept tables sur trente-six, et suggère de chercher l'équivalent
ici : une liste énumérée à la main là où le schéma pourrait la déduire. Elle
avait raison, et le cas était plus près qu'attendu.

**La parité des traductions compare les deux catalogues l'un à l'autre.** Elle
attrape une clé traduite d'un seul côté, et laisse passer une clé absente des
deux. Elle n'a jamais regardé les **appels**.

Le défaut s'est produit deux fois dans la même journée, et la seconde fois sur
six clés : le cadre 11c les lisait sous `tiers`, elles étaient tombées dans
`parcours`. Parité intacte, catalogues d'accord, et l'écran affichait
`[missing "en.tiers.prestationsOuvertes" translation]` **en clair, à la place du
titre**. C'est une assertion de texte dans un test d'écran qui l'a trouvé, par
accident.

**La clé se résout par son chemin entier, jamais par sa feuille**, et c'est tout
le dispositif. La première version cherchait `prestationsOuvertes` quelque part
dans le catalogue : elle aurait trouvé celle de `parcours` et déclaré la garde
satisfaite — c'est-à-dire reproduit exactement le défaut qu'elle prétend
interdire. Vérifié par mutation : avec la résolution par feuille, le vrai défaut
du jour **passe au vert**. Les catalogues sont donc importés et parcourus.

**Les clés composées sont hors de portée, et dénombrées plutôt que passées sous
silence.** Vingt-deux appels en gabarit ne se résolvent pas sans exécuter le
code ; leurs domaines ont leur propre garde, qui recopie la liste à la main
depuis l'union TypeScript pour en faire un oracle. Le compte est plafonné : si
elles se multipliaient, la garde couvrirait de moins en moins **sans le dire**.

521 clés littérales, toutes résolues dans les deux langues.
## 2026-08-17 — Une garde qui couvrait un cinquième du schéma, et une instabilité qui n'en était qu'à moitié une

**Ce qui est parti d'une fausse piste.** La suite `api` était inscrite comme
instable, « deux exécutions sur quatre », avec un diagnostic assuré : des tests
sensibles au temps qui dérivent quand la suite met dix minutes. Repris à zéro,
le décompte ne tient pas. Trois des quatre exécutions avaient une cause connue —
deux sessions pytest sur la même base, un garde-fou qui signalait une entrée
réellement manquante, et une exécution entièrement verte. Il reste **une** seule
exécution inexpliquée, dont la sortie avait été tronquée par un `tail` et dont
trois noms sur cinq sont perdus.

Trois exécutions complètes depuis, toutes à 1561 tests verts. Non reproduit ne
veut pas dire inexistant, et la tâche reste ouverte — mais avec l'instruction de
garder le fichier de sortie entier le jour où ça retombera, ce qui aurait suffi
la première fois.

**Ce que la fausse piste a trouvé, qui n'était pas cherché.** La garde
anti-fuite — celle dont la docstring décrit exactement le symptôme qu'on
poursuivait — surveillait **sept tables sur trente-six**. La boîte d'envoi, les
profils créateur, les codes de retrait, les jetons de rafraîchissement, les
préférences de notification : aucune n'était regardée. Une écriture qui y
survivait à la transaction d'un test ne faisait rien tomber, et le symptôme
serait apparu ailleurs, sous un nom qui n'aurait rien dit.

La liste était énumérée à la main. Elle est maintenant **déduite du schéma**,
moins une dispense d'une seule table : une table neuve est surveillée le jour où
elle est créée, sans que personne ait à y penser. Le commentaire qui accordait
la dispense à « `tier`, `subscription_plan` et consorts » était faux — compté
sur une base fraîchement migrée, `subscription_plan` est vide et l'a toujours
été. Une dispense accordée de mémoire retire une table de la surveillance sans
que personne ne s'en aperçoive ; la liste des dispenses est donc vérifiée au
chargement contre le schéma réel.

Vérifié dans les deux sens, ce qui est la seule façon de le vérifier : une
écriture réellement validée dans `link_click_salt` fait tomber la garde neuve
et **passe inaperçue de l'ancienne**.

**La garde de durée, et pourquoi elle ne ressemble pas à ce qui était demandé.**
Le rapport à la médiane a été écarté sur mesure, pas par goût : la médiane d'un
test est de 0,24 s et le 99e centile de 0,96 s, donc dix fois la médiane vaut
2,4 s — quand le test légitime le plus lourd en met 3,7 à lui seul. Un rapport
qui accuse un test sain est un rapport qui sera retiré au premier rouge, et un
garde-fou retiré ne garde plus rien.

C'est exactement la conclusion à laquelle la garde Jest livrée en #146 était
déjà arrivée, mesures à l'appui, jusqu'au même plafond en secondes et à la même
unité — le test et non le fichier. Elle était écrite dans le dépôt et il a fallu
la retrouver. **Lire ce que l'autre moitié du projet a livré coûte moins cher
que de mesurer deux fois la même chose** ; c'est la seconde fois en deux jours,
après le court-circuit de la CI écrit en double.

**Ce que la garde a trouvé le jour où elle a été posée.** Le semis était lancé
**cinq fois**. Trois de ces lancements — 34, 41 et 31 secondes — exécutaient le
jeu de démonstration entier pour lire trois lignes du **même** résumé. Une
fixture de module les sert toutes les trois et dit rigoureusement la même chose,
puisque c'est la même commande sur la même base. Suite complète : **568 s →
485 s**, à nombre de tests égal.

**La règle `mergeable` change de fichier.** Elle vivait dans ce journal, écrite
le 16 août après trois quarts d'heure perdus sur la PR #126. Deux conversations
s'y sont fait prendre le lendemain, sur la #149 et de mon côté. Le texte était
juste ; il était rangé dans le journal des décisions, que personne ne lit avant
de travailler. Il passe dans `CLAUDE.md`, **avant** les commandes d'attente : on
ne peut pas attendre l'exécution d'une CI qui n'existe pas. Une règle rangée là
où on ne la cherche pas ne protège personne, et le défaut n'était pas dans son
énoncé.

---

## 2026-08-18 — Deux grandeurs dans la phrase, et un champ que personne n'alimentait

**L'arbitrage de Daniel :** « neuf prestations à moins de quinze kilomètres,
chez six salons » dit quelque chose que le seul compte de prestations ne dit
pas — neuf prestations chez un seul salon et neuf chez six sont deux offres très
différentes. Les deux grandeurs sont donc dans la même phrase, **chacune
nommée** : elles ne se comparent pas, elles se complètent. C'est ce qui les
distingue de deux grandeurs confondues, le défaut qu'on avait évité de justesse
en séparant `offres_dans_le_rayon` de `commerces_dans_le_rayon`.

**Et l'implémenter a révélé que ni l'un ni l'autre n'était jamais alimenté.**
`mesPaliers()` n'envoyait aucune coordonnée : le serveur rendait `null` pour les
deux comptes, l'écran des prestations les lisait, et la seconde moitié de sa
phrase comme sa bascule ne fonctionnaient **que dans les tests**, où le palier
était construit à la main.

C'est la cinquième fois de la journée dans cette famille, et c'est une variante
que les précédentes n'annonçaient pas. Les quatre premières étaient « le serveur
rend, l'écran ignore » — la garde des champs les attrape. Celle-ci est « le
serveur rend, l'écran lit, **et personne ne demande** » : le champ *est* lu,
donc la garde ne peut pas le voir. Ce qui l'attrape est un test sur l'URL
réellement appelée, comme pour `categorie`.

Le rayon des paliers est le même que celui d'où part le fil, et c'est écrit :
deux valeurs différentes feraient dire « neuf à moins de quinze kilomètres » ici
et en montreraient douze là-bas.

---

## 2026-08-18 — Les quatorze champs, tranchés — et deux défauts que la liste a fait sortir

**`rotation_seconds` d'abord, et je m'étais alarmé pour la mauvaise raison.** Le
code **ne se désynchronise pas** : le compte à rebours est piloté par
`seconds_remaining` du serveur, pas par une constante. La crainte annoncée était
fausse, et vérifiée avant d'agir.

Le vrai défaut est adjacent et plus discret. Le seuil d'urgence était **un
nombre de secondes fixe**, dix. À trente secondes de rotation il alerte au
dernier tiers ; à quinze, le compte à rebours serait rouge **les deux tiers du
temps**, et un signal d'urgence permanent cesse d'être un signal. Le seuil est
une **part de la cadence**, calée pour reproduire exactement le comportement
d'aujourd'hui. Le commentaire qui disait « toutes les 30 secondes » est corrigé
avec : il était vrai de la configuration du jour, faux le lendemain d'un réglage.

**Le défaut que la liste a fait sortir, et que personne ne cherchait.** En
rendant `raisons_de_non_verification`, on découvre que `verifiee === false` et
`=== null` rendaient **le même écran**. Le type le disait pourtant mot pour
mot — « les deux se disent autrement, attestée d'un côté, ne correspond pas de
l'autre ». Une preuve **refusée** s'affichait « attestée, non vérifiée »,
c'est-à-dire comme une preuve que la plateforme n'avait pas pu contrôler. Trois
états maintenant, et les raisons listées : « ne correspond pas » sans ses termes
se subit, exactement comme le verdict sans ses termes corrigé le matin même.

**Un montage de test encodait le défaut.** Le fixture de la file du commerce
portait `needs_human_review: true` : tous les tests de décision s'exerçaient donc
sur un dossier **qu'un arbitre a en main** — précisément celui où le salon ne
doit plus décider. Corrigé côté montage, et le cas dédié écrit.

**`absence_signalable_a` est plus gros que la liste ne le laissait croire.** Ce
n'est pas un champ non affiché : **le client n'a aucune route de signalement
d'absence.** Le serveur a `mark_no_show`, l'app ne l'appelle nulle part, et le
commerce ne peut pas marquer une absence depuis l'application. C'est une tranche
entière, pas un rendu de champ — elle reste seule sous `a-instruire`, avec le
bon diagnostic cette fois.
## 2026-08-18 — Une méthode d'API sans appelant, et une règle qui ne pouvait pas s'appliquer

**Le diagnostic était à moitié juste, et la moitié fausse coûtait le plus.** Il
était écrit que « le client n'a aucune route de signalement d'absence » et qu'il
fallait « l'entrée de route, la méthode, et l'action ». En réalité l'entrée et
la méthode existaient depuis la #115, documentées, correctes, appelant le bon
chemin. **Seul l'appelant manquait**, et depuis assez longtemps pour que la
recherche du mot `no-show` dans le dépôt donne quatre résultats rassurants et
zéro geste possible pour un commerçant.

C'est la forme exacte que la conversation produit s'interdit en refusant
d'écrire les types d'un écran avant l'écran : une méthode sans appelant est du
code mort qui a l'air d'une fonctionnalité. Ici elle a tenu seize PR.

**L'heure vient du serveur, et le décor de test l'avait effacé.** Le champ
`absence_signalable_a` existe précisément pour que l'écran n'ait pas à connaître
le délai — un seuil recopié dérive au premier ajustement, et la dérive se lit
comme un bouton fermé qui devrait être ouvert. Les tests écrits pour le prouver
posaient pourtant `absence_signalable_a` à `starts_at + 20 min`, c'est-à-dire à
la valeur qu'un écran fautif aurait calculée lui-même : les deux lectures
rendaient le même verdict, et la mutation qui remplace le champ par le calcul
local **passait les six tests**.

Réparé par deux cas où les deux se contredisent — un créneau ouvert plus tôt que
le délai d'usage, un autre plus tard. C'est le troisième montage de test en deux
jours qui encodait le défaut qu'il devait attraper, après celui de la file du
commerce. La règle qui en sort : **un décor qui pourrait être produit par le code
fautif ne prouve rien** ; il faut au moins un cas où les deux implémentations
divergent.

**Et une règle qui ne pouvait pas s'appliquer.** La consigne était « un dossier
qu'un arbitre a en main ne se décide plus côté commerce », par analogie avec les
décisions de contrepartie où elle vient d'être posée. Portée au bouton
d'absence, elle donne une condition qui ne peut jamais être vraie : `no_show`
n'est atteignable que depuis `confirmed` ; une contrepartie — le seul objet qui
porte `needs_human_review` — n'est créée qu'à la consommation ; et `consumed`
est terminal. Une réservation marquable absente n'a jamais de contrepartie,
donc jamais d'arbitre.

Un garde-fou qui ne peut pas se déclencher est pire qu'aucun : il fait croire
que la question est réglée, et il survit à toutes les mutations. Plutôt que de
l'écrire dans l'écran, la conclusion est tenue par quatre tests côté serveur qui
gardent les deux prémisses — deux sur la table des transitions, deux par le
produit. Ils tombent le jour où quelqu'un ajoute une flèche vers `no_show` ou
ouvre une contrepartie plus tôt, ce qui est le moment exact où la règle
deviendrait nécessaire.

**Ce que la vérification a trouvé au passage, et qui n'est pas corrigé.** La
porte de la représaille est fermée dans un sens et pas dans l'autre. Un
signalement de déplacement pour rien annule la réservation dans la même
transaction, donc le salon ne peut plus marquer absent celui qu'il n'a pas reçu.
Mais l'inverse tient aussi : `signaler` exige `confirmed`, et `no_show` est
terminal — un salon qui a oublié un rendez-vous peut marquer la créatrice
absente **avant** qu'elle ne signale, et lui fermer son seul recours en même
temps qu'il lui coûte 25 points de fiabilité. La seule protection est l'écart
des fenêtres : le signalement s'ouvre à l'heure du créneau, l'absence vingt
minutes plus tard. Vingt minutes pendant lesquelles la créatrice est le plus
souvent sur la route. C'est une question de politique produit et non un défaut
d'implémentation, donc elle est posée et non tranchée.
## 2026-08-18 — Un plafond de durée sur chaque job, parce que le défaut est six heures

Signalé par la conversation fonctionnelle, **mesuré ici avant d'être cru** — la
leçon du jour sur les diagnostics relayés sans vérification. Le pas `Navigateur`
de la e2e est resté cinquante minutes, puis vingt-cinq, sans finir, sur deux
exécutions consécutives. **Aucune n'a échoué** : elles n'aboutissaient pas.

**Ce qui rend ce défaut coûteux est ce qu'on voit pendant.** Le run est
`in_progress`, `mergeable` vaut `MERGEABLE`, la PR est `BLOCKED` en attente
d'une vérification requise. Tout est normal. Rien ne distingue « ça installe »
de « c'est bloqué » sans aller lire l'horodatage du pas et le comparer à une
exécution saine. C'est le pendant exact du run jamais dispatché : **un état qui
se lit comme de la patience.**

**Les bornes viennent de la mesure, pas d'une intuition.** Quatorze exécutions
vertes : `perimetre` 9 s au pire, `app` 62 s, `e2e` 308 s, `api` 632 s. Les
plafonds posés — 10, 15, 25 et 30 minutes — laissent entre deux et soixante fois
la marge.

**Et ils sont délibérément larges.** Une borne serrée rend rouge du bon code le
jour où le runner traîne : c'est le défaut qu'on cherche à éviter, en pire,
puisqu'il apprend à relancer sans lire. Ce qu'on achète n'est pas de la vitesse,
c'est qu'un blocage devienne **un échec net** au lieu d'un runner immobilisé six
heures.

**Un plafond par pas a été écarté**, et l'argument est celui de la conversation
fonctionnelle : le blocage peut se déplacer sur `npm ci` ou sur `expo export`,
et un plafond posé sur le seul pas qu'on avait en tête ne garde que celui-là.
C'est la même faute que la garde qui ne cherchait l'appel qu'en début de ligne.

**Le cache de Playwright a d'abord été écarté sur les chiffres, et c'était une
erreur de question.** `playwright install` met 33 à 121 secondes sur un job qui
en met 212 à 308 : le cache gagnerait une minute sur cinq, au prix d'une clé à
tenir. Le calcul était juste ; la question était fausse.

**Le plafond a rendu son verdict sur la PR qui l'ajoute.** Le pas `Navigateur` a
tenu **1360 s puis 1515 s sur deux exécutions consécutives**, tué chaque fois,
pendant que tout le reste du job tenait en 150 s. Le blocage n'est donc ni
occasionnel ni propre à un arbre : il est reproductible, et la PR ne pouvait pas
fusionner. « Le plafond traite déjà le dommage » était faux — il rend le dommage
lisible, il ne l'enlève pas.

Le cache est donc posé, clé sur la version de Playwright : les binaires lui sont
liés, et un cache qui survivrait à une montée de version servirait un navigateur
que la bibliothèque ne sait plus piloter. `--with-deps` reste au défaut de
cache ; sur une touche, seul `install-deps` tourne. Et si ce pas bloque encore,
le plafond le tue en vingt-cinq minutes — les deux se complètent au lieu de se
remplacer.

---

## 2026-08-18 — Une méthode d'API que personne n'appelle

**Née d'une erreur à moi.** J'ai écrit qu'il n'existait aucune route de
signalement d'absence et conclu qu'il fallait « l'entrée de route, la méthode,
et l'action ». `marquerAbsent` existait **depuis seize PR**, documentée,
appelant le bon chemin : seul l'appelant manquait. Ma recherche cherchait
`no_show` et `absent` quand le dépôt écrit `marquerAbsent` sur le chemin
`no-show` — deux motifs faux d'un caractère chacun.

**Une recherche textuelle qui rate ne rend pas « rien », elle rend un silence
rassurant.** C'est ce qui rend ce genre d'erreur plus coûteux qu'une absence de
recherche : on conclut, et on conclut avec assurance.

**La garde est le pendant exact de celle des champs**, et il manquait. Celle-là
attrape « le serveur rend, l'écran ignore » ; celle-ci attrape « le client sait
demander, et personne ne demande ». Une méthode d'API sans appelant est du code
mort **qui a l'air d'une fonctionnalité**, et qui vieillit sans qu'aucun test ne
la touche — c'est ma propre règle, écrite le matin même pour refuser d'ajouter
des types avant leur écran, et jamais vérifiée sur l'existant.

**Quatorze méthodes.** Plusieurs appartiennent à des tâches cochées : la reprise
de compte en entier, l'abonnement, les repères du voisinage, la correction du
catalogue. Deux sautent aux yeux — **le créateur ne peut pas annuler sa
réservation**, le commerce ne peut pas signaler une absence.

**Toutes sous `a-instruire`**, comme les quatorze champs : les ranger sous
« contrat » sans les instruire ferait de la table le tapis qu'elle existe pour
retirer.

### La règle que la conversation fonctionnelle en tire, et qui vaut ici aussi

**Un décor qui pourrait être produit par le code fautif ne prouve rien.** Ses
montages posaient `absence_signalable_a` à exactement ce qu'un écran qui
recopierait le réglage aurait calculé : la mutation qui remplace le champ du
serveur par le calcul local passait ses six tests. Il faut au moins un cas où
les deux implémentations divergent.

C'est la généralisation de la mutation qui a sauvé la garde des clés — résolution
par feuille contre chemin entier, où le catalogue « d'accord avec lui-même »
validait le défaut. Même idée, énoncée mieux.
## 2026-08-18 — Quatre heures, et pourquoi ce n'est pas un nombre de plus

**La décision.** L'absence ne se constate qu'à la fermeture de la fenêtre de
signalement : `starts_at + max(no_show_delai_minutes, venue_report_window_seconds)`,
soit quatre heures aujourd'hui contre vingt minutes avant.

**Pourquoi cette durée-là et pas une autre.** Parce que c'en est déjà une. Toute
valeur inférieure à la fenêtre de signalement laisse un intervalle où le salon
peut effacer le recours de la créatrice ; l'intervalle rétrécit, l'injustice
reste entière pour qui y tombe. Et poser un troisième réglage — un « délai avant
absence » propre à cette règle — créerait deux nombres à tenir d'accord à la
main : le jour où l'on allongerait la fenêtre de signalement, la porte se
rouvrirait sans que rien ne le dise. Écrite en `max`, la garantie suit la
fenêtre par construction.

Les quatre heures ne sont donc pas choisies ici. Elles sont celles de
`venue_report_window_seconds`, dont la raison est écrite depuis sa création :
« assez pour rentrer chez soi et y penser, trop court pour que le souvenir se
reconstruise ». La décision d'aujourd'hui est de **s'y adosser**, pas d'inventer
un seuil.

**Le plancher de vingt minutes reste, et il n'est pas décoratif.** Les deux
délais ne protègent pas la même chose : vingt minutes disent qu'une créatrice
en retard de trois minutes n'est pas absente ; quatre heures disent que celle
qui s'est déplacée garde son recours. Si la fenêtre passait un jour sous vingt
minutes, le plancher reprendrait la main. Un test le tient, sans quoi le `max`
aurait un membre mort.

**Ce que ça coûte, des deux côtés, et c'est ce qui tranche.** Pour un salon
honnête : attendre. La réservation reste `confirmed` l'après-midi, aucune place
n'est bloquée puisque le créneau est passé, aucun argent n'est en jeu, et
l'événement de fiabilité arrive plus tard. Pour une créatrice : vingt-cinq
points et sa seule porte. Les deux ne sont pas commensurables.

**Ce que la correction a fait sortir.** La règle était **écrite deux fois** —
`booking_states.absence_signalable_a` et `booking_history._absence_signalable_a`
— avec la même formule. Tant qu'elles étaient identiques, rien ne se voyait ;
la première modification de l'une aurait fait mentir l'écran sur ce que le
serveur accepte, et le défaut se serait lu comme un bouton ouvert qui se fait
refuser. Réunies. `booking_history` importe désormais `booking_states`, et non
l'inverse : `venue_report` dépend déjà de `booking_states`, qui ne peut donc pas
l'importer en retour — il relit le même réglage, et **un test tient les deux
frontières d'accord**, ce qu'un commentaire n'aurait pas fait.

**Et une borne d'un instant.** `fenetre_ouverte` se lisait `<= fin` : à
l'instant exact de la fermeture, le signalement était encore possible et
l'absence venait de s'ouvrir. Les deux vrais en même temps, sur le seul instant
que cette correction avait pour objet de départager. Semi-ouverte, les deux
règles partitionnent le temps. Une seconde d'epsilon aurait été un nombre
inventé pour masquer le choix qu'il fallait faire.

**Ce qu'il fallait ajouter à l'écran.** Quatre heures d'attente sans explication
se lisent comme un défaut, et un commerçant qui conclut au défaut écrit au
support. La ligne dit maintenant ce qu'elle attend : que la créatrice puisse
encore signaler être venue et avoir trouvé fermé. Un délai qu'on subit sans le
comprendre est un délai qu'on cherche à contourner.

---

## 2026-08-18 — Trois bloquants de campagne, et ce que chacun disait de plus

Le produit a été monté localement sur le jeu de démonstration pour chacun des
trois : lu dans le code, aucun des trois n'était visible.

**Le code de retrait, et le trou du diagramme.** `confirmed` ne veut pas dire
consommable. Une réservation confirmée que personne n'a servie garde son statut
**pour toujours** — le diagramme n'a pas de flèche de `confirmed` vers
`expired`, et rien ne la déplace. Passé `valid_until`, le serveur refuse le code
et l'écran continuait de le proposer : au comptoir, le jour du rendez-vous, un
message d'erreur à la place du QR. Reproduit en reculant `valid_until` d'une
réservation du semis : statut inchangé, route en 409.

Corrigé côté écran, qui cesse de proposer et **dit pourquoi**. La question plus
profonde — faut-il une flèche vers `expired` ? — touche la machine à états et
n'est pas tranchée ici.

**Deux décors de test l'encodaient.** L'un portait `valid_until` figé au 16
août : tant que la date était devant nous il ne disait rien de faux, passée il
affirmait qu'un droit périmé ouvre le code. L'autre omettait complètement
`valid_until`. La règle « les heures sont relatives à maintenant » existait déjà
dans le fichier voisin, écrite après le même accident.

**Les réseaux en 503 : la seule intégration qu'on ne vérifiait pas au
démarrage.** Le géocodeur, le courriel, l'extraction, le dépôt objet, la
facturation, la géolocalisation et les notifications refusent tous de démarrer
mal configurés. Les plateformes sociales levaient à la première requête, le
routeur traduisait en 503, et l'app affichait « réseau indisponible ».

Reproduit les deux façons d'y arriver, et une seule donne **les deux
plateformes** en 503 : `SOCIAL_PROVIDER=demo` sans `API_PUBLIC_BASE_URL`. C'est
donc la configuration de la campagne. La panne est la plus chère du produit —
sans réseau, pas de relevé ; sans relevé, pas de palier ; sans palier, un fil
vide — et elle se découvrait une inscription à la fois.

**L'annuaire : un `[:2]` écrit pour trois salons.** Le semis abonnait
`actifs[:2]`, trié par nom. À trois commerces, les deux premiers étaient
forcément ceux qu'on regarde. Passé à vingt, `[:2]` a désigné « Bayside Play
Loft » et « Brickell Highball », et **Ocean Beauty Studio — le salon avec lequel
on ouvre le produit — s'est retrouvé sans abonnement**. La route répondait 402,
l'écran affichait « l'annuaire vient avec l'abonnement », et c'était exact :
rien n'échouait.

Les abonnés sont maintenant **nommés**. Un test qui vérifierait « au moins deux
abonnements » repasserait au vert avec exactement le défaut d'origine ; celui
qui est écrit nomme Ocean, et un second exige qu'un salon reste sans abonnement.

**Le réglage des notifications retiré.** Écran, deux routes, table, modèle. Les
sept genres restent : ils portent le gabarit et la langue. `kind` demeure dans
la signature de `joignable` — ce n'est pas un vestige, c'est là que vivra une
règle qui dépendrait du genre, et le retirer obligerait à retoucher tous les
appelants pour le remettre.

**Ce qui a survécu au retrait, et pourquoi.** Deux tests éprouvaient la
préférence *et* une propriété plus générale : que la joignabilité est relue au
moment de sortir, pas figée au dépôt. La propriété n'a pas bougé de sens ; ils
la portent maintenant sur la suspension. Deux autres ne parlaient que du
réglage : ils sont partis avec lui.

**Le retour arrière de la migration recrée la table, vide.** Il ne peut pas
faire mieux, et le dire vaut mieux que de laisser croire qu'il restaure quelque
chose : les refus ne sont copiés nulle part. Les archiver serait garder la
donnée qu'on a décidé de ne plus avoir.

---

## 2026-08-18 — La direction Ambre, importée de Design et appliquée au produit

Les trois fichiers de Design — `tokens.json`, `components.md`,
`PASSATION-v1.1.md` — importés depuis son projet et posés dans la passation.
**Les 31 valeurs de rampe, de rayons et d'échelle sont identiques** à celles de
l'artefact où la fondatrice a tranché : Design les a transcrites, il n'y avait
rien à arbitrer.

**La garde de la passation passe de l'égalité à l'inclusion, et il faut dire
pourquoi.** Le fichier de Design décrit un système ; celui de l'app fait tourner
un produit et porte six sections dont Design ne parle pas — `theme`, `font`,
`space`, `motion`, `pattern`, `blockRule`. Exiger l'égalité revenait à demander
au designer de maintenir des durées d'animation. Ce qui est gardé est ce qui
comptait : **toute valeur que Design énonce est celle de l'app**, plus le sens
inverse — l'app n'invente aucune couleur, aucun rayon ni aucune variante que la
passation ne déclare. Sans ce second test, un `brand.550` ajouté côté produit
passerait, la passation restant incluse.

### Trois secondes vérités supprimées au passage

**`color.tier`** recopiait la rampe en hexadécimaux — `#A83E06` pour le 700,
`#F9BC97` pour le 200. Au changement de direction elle serait restée à l'orange
brut, et le test qui la comparait à la table de matières aurait constaté que les
deux mensonges concordaient. Design la supprime ; ce qu'elle avait
d'irremplaçable était deux géométries, reprises depuis `components.md` §2. Le
test change donc d'oracle : il compare désormais à la table du document, recopiée
à la main — la dériver des jetons la rendrait d'accord avec eux quoi qu'ils
disent.

**La liste `logo.mark16.palette`** énumérait trois couleurs à côté d'une prose
qui nommait trois jetons. Elle est dérivée, dans le test comme dans le script de
cuisson.

**Le drapeau `logo.monochrome: false`** disait en booléen ce que la règle dit en
toutes lettres. Un booléen ne porte pas sa raison ; ce qui le remplace est le
fait — deux encres distinctes, dont l'une est la signature.

### Ce que Design retire et que le produit doit porter

`mark16` devient une prose : la géométrie du sigle n'est plus un jeton, parce
qu'un dessin vient de sa propre planche. Elle passe dans `produit.json`, ses
trois couleurs restant dérivées des jetons. Même chose pour trois arrêts de voile
et le mot de la marque, que Design ne nomme pas et que le mur emploie : **dérivés
de son encre plutôt qu'écrits**, sans quoi ils resteraient à l'orange brut au
prochain changement, exactement comme la table des paliers l'a fait.

### L'approche, convertie et non recopiée

Design écrit l'approche en unités CSS — « -0.02em », « 1.4px » — parce que c'est
le vocabulaire d'une maquette. React Native veut des points, et un `em` dépend de
la taille : −0,02 em vaut −0,88 à 44 px et −0,48 à 32. La conversion se fait dans
`echelle.ts`, au seul endroit qui connaît les deux. La recopier en points dans
les jetons aurait créé la seconde vérité que la garde existe pour interdire.

### Les cinq règles, et celle que le produit a ajoutée

Le bloc accentué reste d'équerre, et un test le tient : `radius.none` n'est
employé nulle part ailleurs. **Trois exceptions portent leur raison** — le bloc,
le thème qui déclare le jeton, et les deux surfaces que `components.md` §10 met
explicitement hors système, la galerie et la visionneuse : ce qu'on y regarde est
la photo, et un cadre arrondi par-dessus le travail d'un salon est une opinion de
plus.

`elevation.card` revient. L'avertissement reste sans teinte. Les trois satins
sont recuits — **et leur structure n'a pas suivi la recette à la lettre** :
Design donne un dégradé unique par satin, le script en croise plusieurs, et sa
raison écrite est que c'est précisément ce qui distingue un satin d'une pente.
Ce que Design y nomme sont les couleurs ; ce sont elles qui ont été reprises.

### Les trois réserves deviennent des mesures

Une réserve écrite dans un fichier de jetons ne protège rien. `ink.mute` échoue
sur `bg.deep` et le repli sur `ink.soft` tient ; `brand.700` sur `bg.deep` passe
entre 4,5 et 5, donc s'évite sous 13 px ; le point du logo est admis sur la page
et **invisible sur l'orange**, à 1,30:1. Quatre gardes, quatre mutations
vérifiées — rampe éclaircie, signature alignée sur la marque, orange assombri,
appui confondu : chacune fait tomber la sienne.

## 2026-08-18 — Cinq règles de pose, et ce qu'un jeton ne peut pas protéger

La bascule Ambre a arrondi 66 sites de rayon, dont un qui ne devait pas l'être :
**le bloc orange accentué**. `radius.none` lui est réservé — un aplat de marque
aux angles arrondis devient un bouton, et la signature perd la raideur qui la
fait lire comme une signature. Les deux gardes existantes sont restées vertes
pendant tout ce temps : l'une vérifiait que le jeton valait toujours 0, l'autre
qu'aucun autre fichier ne s'en servait. Aucune ne disait que le bloc s'en sert.
**Une contrainte se teste dans les deux sens, et celle qui n'interdit que le
mauvais côté laisse passer l'oubli du bon.**

**`elevation.card` était déclarée et personne ne la lisait.** La bibliothèque
n'exposait que l'ombre flottante. Un jeton présent dans le fichier et consommé
nulle part passe toutes les gardes de jetons du monde — celle qui existait
comptait les clés. Elle est portée par la vue extérieure et non par la carte :
la carte clippe son contenu pour que la couverture épouse son coin, et sur iOS
une vue qui clippe coupe sa propre ombre au même bord. Une garde qui aurait
seulement demandé « la carte a une ombre » aurait laissé passer une carte ombrée
sur le web et plate sur téléphone, c'est-à-dire le défaut que la CI ne voit pas.

**Le point du logo : une règle de pose, que la palette ne peut pas porter.** Il
vaut 1,30:1 sur un aplat de marque. Les jetons le mesuraient déjà ; ce qu'ils ne
peuvent pas dire, c'est où le logotype est posé. Sur l'accueil il l'est au-dessus
d'un satin, et la seule chose qui l'en sépare est la bande de l'en-tête. La
garde remonte les parents plutôt que de constater la présence des deux nœuds :
les trouver tous les deux dans l'écran ne dit pas que l'un contient l'autre, et
sortir la marque de l'enveloppe est exactement le geste qui laisserait les deux
présents.

**L'avertissement sans teinte devient une identité, pas une mesure.** Ses trois
valeurs sont des jetons neutres du système. Une mesure de saturation laisserait
passer un ambre désaturé, qui est la façon dont la teinte reviendrait.

## 2026-08-18 — Les raisons écrites survivent à ce qu'elles expliquent

Le Didone est retiré ; six raisons qui s'appuyaient sur lui ne l'étaient pas, et
l'une portait un défaut visible. **La pile de repli du web gardait Didot,
Playfair, Georgia pour le rôle `display`** : sur un réseau lent, le premier écran
rendait un serif du XVIIIe sous une direction géométrique — l'inverse exact de la
raison écrite trois lignes au-dessus. `display` et `sans` répliquent maintenant
la même pile, en restant deux clés parce que rien ne garantit qu'ils resteront la
même fonte.

`PLANCHER_DIDONE` est **supprimé plutôt qu'annulé**. Il n'avait plus ni serif à
garder ni assertion pour l'éprouver : son import dans les tests ne servait rien.
Une constante exportée sans appelant et sans garde est le motif qui a coûté seize
PR ailleurs dans ce dépôt.

Deux tests Playwright énonçaient encore les familles de la v1.0. Ils étaient
verts en jest parce qu'ils ne sont pas en jest — **`e2e` est le seul job qui les
voit**, et c'est la deuxième fois que cette frontière laisse passer un test
périmé. La liste des familles retirées ne se vide pas d'une direction à l'autre,
elle s'allonge : sinon une famille abandonnée deux directions plus tôt revient
par une dépendance transitive.

## 2026-08-19 — Le fil v3 : une inversion de hiérarchie, pas une catégorie de plus

Les testeurs ne savaient pas s'ils regardaient un lieu ou une prestation, et la
revue proposait d'ajouter une catégorie « activités ». **Ce n'était pas le
défaut.** Chaque carte du fil est déjà une prestation : une catégorie qui les
rassemblerait toutes rassemblerait tout le fil, et la confusion resterait entière
à l'intérieur de chacune. La carte montrait le salon à 22 points sur la photo et
la prestation à 16 en dessous — l'objet de la réservation était **subordonné au
lieu qui l'héberge**. La prestation prend donc le titre, le salon passe en
attribution avec la durée.

**Le même défaut existait sur la fiche**, où le nom de la prestation était en
`type.label` — onze points, la taille d'une étiquette — sous une durée en mono de
douze, plus grosse que lui. Les deux corrections partagent une variante et un
test qui les compare : les écrire séparément en points les laisserait diverger,
et c'est exactement ainsi que le défaut est né.

**Le chrome de carte disparaît entièrement**, ce qui permet deux aperçus par
ligne. Deux et non trois : à trois, la colonne tombe à 111 points et un nom de
prestation passe sur trois lignes — on aurait densifié l'écran en cassant la
correction qu'il porte. La case du badge garde une **hauteur fixe, occupée ou
vide** ; sans elle, la hauteur d'une rangée dépend de la donnée et deux colonnes
côte à côte se décalent.

**Le quartier n'est pas une troisième bande de navigation.** Empiler catégories,
quartiers et filtres aurait reproduit le défaut signalé. Il structure le mur
lui-même : le plus proche est ouvert, les autres sont des carrés au pied. La
distance ordonne les sections **sans jamais s'écrire** — le tri survit donc à la
disparition de son affichage, et il est servi plutôt que dérivé carte par carte.

**Deux compositions pour un même contenu, supprimées.** Le fil rendait un mur de
six formats sans filtre et des rangées par quartier avec — arbitrage écrit par
Design au bas de la planche v2, et la seconde composition n'apparaissait qu'à
ceux qui filtraient. La v3 n'en a qu'une. Partent avec elle : `cycle.ts`,
`regles.ts`, `RangeesParQuartier`, le bilan du pied, et cinq fichiers de tests
qui n'ont plus d'objet.

**Deux écarts à la planche, tous deux instruits.** Le badge passe de `brand.700`
à `brand.900` sur `brand.100` : l'ambre moyen sur l'ambre clair donne 4,19:1,
sous le 4,5 qu'un texte de cette taille demande, et le dernier cran de la rampe
donne 8,84 en gardant l'ambre sur ambre. Et le bouton de recherche n'est pas
rendu : aucun écran ne le sert, et la passation §7 tranche — « le bouton
impossible est retiré, jamais grisé ».

**Trois champs servis n'ont plus de lecteur**, et la garde des champs les a dits
plutôt qu'une relecture : `CommerceDuFil.cover_portrait_key`, servi pour les
héros à fond perdu que la v3 n'a plus ; `Fil.prochain_palier` et
`ProchainPalier.commerces_de_plus`, dont le sujet est parti vers Audience — qui
consulte `mesPaliers` et non le fil. Ils sont en `a-instruire` et non en
`contrat` : ils étaient rendus hier, et les ranger fermerait la question au lieu
de la poser.

## 2026-08-19 — Deux tests qui n'interrogeaient rien, trouvés en en écrivant d'autres

`toHaveTextContent` compare le contenu **entier** quand on lui passe une chaîne.
Deux assertions en profitaient sans le savoir : `not.toHaveTextContent('·')`
était vraie de toute ligne ne disant pas *uniquement* « · », et
`toHaveTextContent` sur le conteneur de l'en-tête lisait une chaîne vide — il
n'agrège pas ses descendants — si bien que les trois négations sur les noms de
quartier passaient sans rien lire. Aucune n'a été trouvée par relecture : la
première par une mutation, la seconde parce que le conteneur a cessé d'exister
sous cette forme. **Une négation qui porte sur un nœud vide est verte pour
toujours.**
---

## 2026-08-19 — Deux horloges, et trois manques qui se cachaient l'un l'autre

**La cause de l'instabilité est trouvée, et elle n'était pas où je l'avais
cherchée.** Il y a deux jours, la boîte d'envoi échouait par intermittence et
j'avais avancé une hypothèse : `run_after` est écrit par `clock_timestamp()`
côté Postgres, `en_attente` compare à `datetime.now(UTC)` côté Python, deux
horloges non synchronisées. Ma mesure au repos ne la confirmait pas — Postgres
était **derrière** Python de 0,35 ms, jamais devant sur vingt mesures — et je
l'avais transmise en disant ce qui l'affaiblissait.

Elle est confirmée aujourd'hui, sous charge et dans l'autre sens, sur une autre
table. Trois tests de reprise de compte sont tombés d'un coup avec les chiffres
dans la trace : ouverture à `04:23:03.465808`, fermeture à `04:23:03.463118`.
**2,7 millisecondes** — la base en avance, la contrainte
`close_apres_ouverture` rejette, et une reprise ouverte puis refermée dans la
foulée paraît s'être fermée avant de s'ouvrir.

Ce que ça apprend sur la mesure de l'autre jour : elle n'était pas fausse, elle
était prise au mauvais moment. Un écart d'horloge de quelques millisecondes ne
se voit pas sur une machine au repos ; il se voit sous une suite de huit minutes
qui sature le processeur, et c'est exactement quand les tests tombent.

**Le correctif est la règle du dépôt, appliquée là où elle ne l'était pas** :
seul le temps serveur fait foi. Vis-à-vis de Postgres, le processus Python est
un client. `ended_at` vient donc de `clock_timestamp()`, comme `started_at`.
`maintenant` reste prioritaire — les tests qui posent une heure explicite
éprouvent une règle de temps, et leur imposer l'horloge de la base leur
retirerait ce qu'ils vérifient.

**Ce qui reste à faire, et qui est plus large que ce correctif** : passer le même
peigne sur toutes les colonnes qui comparent une heure Python à une heure écrite
par la base. Il y en a d'autres — la boîte d'envoi en est une.

---

**Trois manques qui se cachaient l'un l'autre.** Le commerce devait avoir le lien
vers la publication. Le champ traverse tout le produit : le schéma l'accepte, la
méthode de client le transporte, l'écran du commerce sait l'ouvrir. Trois
endroits le vidaient, et chacun rendait les deux autres invisibles :

- l'écran de soumission n'avait pas de champ pour l'adresse ;
- le semis posait `source_url=None` sur toutes ses preuves ;
- le niveau 3 — le seul qui fonctionne aujourd'hui — ne reportait pas l'adresse
  reçue dans la capture qu'il produit.

Corriger l'un seul n'aurait rien montré. C'est la même forme que la méthode
`marquerAbsent` sans appelant, en trois exemplaires.

**Et un quatrième, que les trois premiers protégeaient.** Le niveau 1 lève à sa
première ligne : `fournisseur_de` est une dépendance FastAPI — un générateur
asynchrone — et elle était employée en `async with`. Le chemin n'est atteint que
si une adresse est fournie ; comme aucune ne l'était jamais, la panne ne pouvait
pas se découvrir. Elle s'est révélée à la seconde où le semis a commencé à en
fournir une.

**Ce que je n'ai pas fait.** Rendre l'adresse obligatoire à la soumission. Une
story n'a pas toujours d'adresse publique, et bloquer l'envoi ferait perdre une
contrepartie pour un détail de forme — alors que la capture seule est déjà une
preuve valable de niveau 3. Le champ est demandé, expliqué, et facultatif.

---

**« À examiner » était vide, et le filtre était juste.** Compté par commerce :
la seule contrepartie `submitted` du jeu de démonstration était chez Wynwood.
Sur Ocean — le salon avec lequel on ouvre le produit — l'onglet ne montrait rien
pendant que « attendues » portait deux lignes, ce qui se lit comme un filtre
cassé.

Troisième fois que le jeu de données place ailleurs l'état que l'écran de
démonstration doit montrer, après l'abonnement pris par rang alphabétique. La
règle qui s'en dégage : **un jeu de démonstration se vérifie sur le compte avec
lequel on démontre**, pas sur l'ensemble. « Au moins un quelque part » est
toujours vrai et ne prouve rien.

## 2026-08-19 — La carte du fil retirée, et l'ombre qu'elle portait seule

`BusinessCard` n'avait plus d'appelant depuis que le fil rend des aperçus de
prestation. **Elle est partie plutôt que d'attendre** : une carte qui survit sans
écran finit par resservir en portant une composition périmée, et le dépôt en a
déjà l'exemple — le monogramme vert a traversé un remplacement complet du
système en gardant sa forme, et se trouvait encore en tête de l'accueil quand
tout le reste avait changé.

Ce qui part avec : `SkeletonCard`, le rapport de couverture 16:9, deux tests qui
décrivaient sa composition — le rapport de la photo et le badge accompagné de sa
phrase, c'est-à-dire précisément la hiérarchie que la v3 corrige. Un troisième
test a changé de sujet sans changer de règle : « le nom vit sur une bande, pas
sur une queue de dégradé » vaut maintenant pour `BandeDeTexteSurPhoto`, que
l'accueil pose sur son satin.

**Le squelette par défaut d'`Ecran` devient une liste de lignes.** Il était une
carte à photo de 150 pixels — la forme la plus affirmative du produit — juste sur
le fil et fausse partout ailleurs, puis fausse partout. Une fiche promet un objet
unique, une grille promet des colonnes, une carte promet une image : chacune fait
sauter la page si elle se trompe. Des lignes ne promettent rien, ce qui est
exactement ce qu'on sait d'un écran qui n'a pas déclaré sa silhouette. **Une
garde neuve fixe cette forme** : les tests existants vérifiaient que six écrans
déclarent la leur, aucun ne disait ce que reçoit le septième — le défaut a pu
rester une carte pendant tout ce temps sans qu'aucun test ne bouge.

**`elevation.card` perd son unique consommateur, et ce n'est pas réglé.** La
règle de la direction tient, et treize surfaces du produit sont des cartes au
sens strict — fond de surface, rayon de 18, filet — dont aucune ne porte d'ombre.
Les leur donner est une décision de composition sur onze écrans dont les planches
sont encore en v1.0. En attendant, la garde du composant disparu est remplacée
par un **inventaire exact** : ajouter une carte oblige à toucher la liste, donc à
se demander si elle se pose ou si elle flotte. Sans lui, la règle s'effriterait
surface par surface sans qu'aucun test ne bouge — ce qui est exactement comment
elle avait disparu la première fois.
---

## 2026-08-19 — Trois champs sans lecteur, et où ils vivent maintenant

Trois champs avaient perdu leur lecteur avec la refonte du fil. Les ranger sous
« contrat » aurait fait passer un déménagement pour une intention.

**`prochain_palier` et `commerces_de_plus` suivent leur sujet.** L'écran qui les
montre lit `mesPaliers` depuis la refonte, plus le fil ; les champs étaient
servis à chaque chargement du fil et lus nulle part. Ils passent donc sur
`/me/tiers`, qui portait **déjà** tout ce qu'ils transportent — obstacles par
palier, compte de commerces dans le rayon — sauf le classement.

**Seul le classement a vraiment déménagé**, et il reste au serveur : c'est une
règle de produit — on classe sur le **nombre** de conditions qui manquent,
jamais sur leur ampleur — et la recopier dans l'écran en ferait une seconde
vérité. Aucune requête de plus : le calcul porte sur des paliers déjà évalués.

**`commerces_de_plus` ne suit pas, il disparaît.** Sur le fil, le compte excluait
les commerces déjà listés — « combien de salons **en plus** de ceux que vous
voyez ». Hors du fil il n'y a rien à exclure : garder le mot promettrait une
soustraction sans opérande. Le palier porte déjà `commerces_dans_le_rayon`, qui
est la grandeur juste, et l'écran d'audience ne l'affiche pas — il n'envoie
aucune position, la valeur y est nulle par construction, et écrire zéro dirait
« aucun salon autour de vous », ce qui est faux et décourageant. Ce qui reste
affiché est l'obstacle : il ne dépend d'aucune position, et c'est la seule chose
actionnable.

**`cover_portrait_key` quitte le fil et rien d'autre.** Le produit ne rend
qu'une forme de couverture — 16:9, avec sa raison mesurée dans `Cards.tsx` : une
boîte de hauteur fixe rogne l'enseigne sur un iPhone. Aucune surface portrait
n'existe, et aucun écran ne permet d'en déposer une : seul le semis remplit le
champ. Le servir sur chaque ligne du fil était donc du poids sans lecteur.

**La colonne et les vingt images restent.** Elles ne coûtent rien, elles ont été
produites, et une surface portrait les retrouverait en une ligne. Supprimer la
colonne jetterait des assets sur une question de composition qui n'est pas
tranchée — et ce n'est pas à moi de la trancher pendant que l'autre conversation
refait ces écrans.

**Une redondance gardée, et dite.** Le filtre du classement écarte les paliers
sur deux conditions : `not accessible` et `obstacles`. La mutation montre que la
première ne change aucun verdict — un palier accessible ne porte jamais
d'obstacle. Elles ne disent pourtant pas la même chose : l'une est la règle,
l'autre empêche un `obstacles[0]` de lever. Fabriquer un décor qui les
distinguerait éprouverait un état que l'éligibilité ne produit pas ; la
redondance est donc documentée des deux côtés plutôt qu'éprouvée sur un cas
impossible.

## 2026-08-19 — L'ombre de carte posée sur les douze, et la garde qui lisait l'import

« Un coin de 18 px sans ombre flotte au lieu de se poser » est une règle qui
**vient avec les rayons**, pas une décision par écran : elle vaut des douze
surfaces du produit qui portent ce rayon. Une carte, ici, c'est trois choses
ensemble — un fond de surface, un rayon de 18, un filet.

**Trois des douze clippent leur contenu et ne peuvent pas porter leur propre
ombre** : sur iOS, une vue qui clippe la coupe au même bord. Leur ombre vit sur
une vue extérieure qui reprend le rayon et le fond, parce qu'iOS calcule l'ombre
depuis la couche opaque. Un rendu l'éprouve — le texte du fichier ne peut pas
dire sur quel nœud l'ombre est posée.

**La garde comptait mal, et la mutation l'a dit.** Sa première version demandait
si le fichier *contenait* `elevationDeCarte` : la ligne d'import suffisait à la
satisfaire, et retirer l'ombre de la carte laissait le test vert. Elle compte
maintenant les poses et les cartes et exige l'égalité — une pose qui disparaît
fait un compte de moins, une carte ajoutée sans ombre un compte de plus. Aucune
relecture n'aurait vu la première version : elle affirmait la bonne chose et
mesurait la mauvaise.

**Et la fenêtre du détecteur est passée de 600 à 900 caractères, pour la même
raison.** Un commentaire de quatre lignes ajouté dans deux blocs de style les
faisait dépasser six cents caractères : ils sortaient de l'inventaire **en
silence**, la liste rétrécissait toute seule, et c'est le contraire de son
emploi. Le pavé est devenu une ligne, la raison longue vivant déjà sur
`elevationDeCarte`, et la fenêtre a été mesurée sur le plus long des douze — 780.

## 2026-08-19 — La fiche v3 : une ligne portait cinq informations, dont deux codées

La cause trouvée par Design est plus étroite que la remarque : « la manière dont
les prestations sont affichées ne se comprend pas » venait d'une ligne qui
portait le nom, la durée, un badge à trois barres, une date brute et un bouton.
Elle pose en fait **deux questions** — qu'est-ce que je donne, quand je viens —
et c'est une ligne chacune, un glyphe chacune, le mot qui décide en gras.

**Le badge codé quitte cet écran.** Il disait le palier, les testeurs y
cherchaient le réseau, qu'il n'a jamais porté. Les deux sont maintenant écrits :
« une story sur Instagram, sous 48 h » ne se décode pas. Il survit sur le fil, où
une carte n'a pas la place d'une phrase, et sur l'écran des paliers, où il est le
sujet.

**Le délai devient un nombre à côté de sa prose, et un test tient les deux.**
`counterpart` porte la phrase courte en toutes lettres ; la phrase longue se
compose de trois morceaux, dont `delaiHeures`. Rien d'autre ne les rapproche : le
jour où le délai d'un palier change, il changerait dans l'une et pas dans
l'autre. Le test lit le nombre **dans la prose** plutôt que de le recopier — une
constante écrite dans le test aurait été une troisième vérité.

**Le bouton passait de 316 à 89 points, et il n'a fallu qu'un mot.** Le bouton du
système est déjà une pilule dimensionnée sur son texte ; il s'étirait parce que
`fullWidth` vaut `true` par défaut et que personne ne lui avait dit non. Trois
aplats orange pleine largeur empilés faisaient trois promotions.

**Le bloc fermé reprend son opacité pleine.** À 75 %, l'explication devenait
illisible en même temps que la prestation — c'est-à-dire que le seul élément
utile d'un bloc fermé était celui qu'on effaçait. Seule la vignette s'atténue,
l'obstacle prend un encart, et il emprunte `EcartAuSeuil` à l'écran des paliers :
deux vocabulaires pour un même refus feraient croire à deux causes, et la règle
des 60 % s'applique sans exception.

**Deux écarts à la planche.** L'étiquette « OPEN UNTIL 19:00 » n'est pas rendue :
les horaires ne sont pas servis sur la fiche publique, et les deviner serait
annoncer une fermeture invérifiable. Et les deux lignes à glyphe empruntent des
icônes du jeu existant plutôt que les marques de réseau que la planche dessine :
Design en trace deux sur trois, la troisième aurait été inventée, et un jeu où
une marque est relevée et l'autre imaginée vaut moins qu'un glyphe neutre —
d'autant que la correction est précisément que le réseau s'**écrit**.

**Un défaut trouvé en écrivant les tests** : la galerie s'ouvrant désormais
depuis la couverture, un salon qui a des photos et pas de couverture déclarée
perdait sa porte entière. La première photo tient ce rôle — c'est une photo du
lieu, c'est ce que la galerie contient.

**Et une négation devenue vide.** `queryByTestId('acces-a-la-carte')` interrogeait
le conteneur des deux lignes jumelles de la v1.1 : il n'existe plus, et
l'assertion était vraie sans rien lire. C'est la troisième de cette forme en deux
jours — une négation qui porte sur un nœud disparu est verte pour toujours.
---

## 2026-08-19 — Le peigne des horloges, la confirmation d'adresse, et un mot de passe qu'on ne devine pas

**Le peigne : quatorze colonnes, un seul endroit.** Toutes les colonnes écrites
par `clock_timestamp()` ont été confrontées à leurs comparaisons. Une seule était
comparée à une heure Python sur un écart qui peut être nul —
`outbound_message.run_after` — et son jumeau, `job.run_after`, avait la bonne
écriture depuis le début. Les autres comparaisons portent sur des fenêtres de
plusieurs heures ou sur des bornes fournies par l'appelant : quelques
millisecondes n'y décident de rien.

`vider()` reposait une heure Python et la transmettait à `en_attente` : la
correction serait restée inerte. C'est le genre de détail qui fait qu'un
correctif « appliqué » ne s'applique pas, et seule la lecture du chemin complet
le montre.

**La garde qui empêche le motif de revenir a d'abord été partielle.** Elle
acceptait toute ligne contenant `maintenant`, donc `maintenant or
datetime.now(UTC)` — la forme exacte du défaut, puisque c'est le repli qui décide
quand l'appelant ne fournit rien. La mutation l'a montré : elle survivait à la
garde censée l'attraper. L'horloge du processus est désormais disqualifiante en
elle-même.

---

**La confirmation d'adresse, et où la frontière est posée.** Un compte non
confirmé **entre et se sert du produit** : il regarde le fil, connecte un réseau,
prépare son profil. Il ne peut pas **engager quelqu'un d'autre** — réserver une
place, ou mettre un commerce en ligne.

Fermer la porte d'entrée transformerait une adresse mal saisie en compte perdu.
Ne rien fermer laisserait un salon bloquer une place pour quelqu'un qu'on ne sait
pas joindre. La frontière est donc au premier geste qui coûte à un tiers.

**Le lien s'ouvre en `GET`, dans un navigateur.** Exiger un `POST` obligerait à
monter une page qui reposte, c'est-à-dire à dépendre de l'application pour
valider une adresse dont on a besoin *avant* que l'application serve. La route
est donc publique, et c'est le jeton qui fait l'autorisation.

**Les comptes existants sont réputés confirmés.** `email_verified_at` arrive
nulle et fermerait la réservation à tout le monde du jour au lendemain, pour une
adresse que personne ne leur a demandé de confirmer. La migration les date à
l'instant du déploiement.

**Les décors et le semis parcourent la vraie chaîne** — jeton émis puis
consommé — plutôt que d'écrire la date à la main. Un jeu de données qui poserait
`email_verified_at` produirait le même état sans jamais éprouver le mécanisme qui
doit le produire.

---

**Le mot de passe : pas de règle de composition, et c'est le point.** La demande
était « une exigence de complexité réelle ». Une règle de classes — majuscule,
chiffre, symbole — accepte `Password1!` et refuse `cheval correct pile agrafe` :
elle mesure la présence de symboles, pas la difficulté à deviner. C'est aussi ce
que le NIST recommande d'abandonner depuis 2017, et le code portait déjà cette
décision en commentaire.

Ce qui la remplace refuse ce qu'une classe accepterait : les mots de passe
connus, ceux qui contiennent l'adresse ou le nom du produit, ceux qui n'ont
presque pas de variété, et les rangées de clavier. Chaque cas de test est un mot
de passe **qu'une règle de composition validerait** — c'est la seule façon de
montrer que le remplacement vaut mieux que ce qu'il remplace.

**Les deux mots de passe partagés du dépôt étaient refusés, à juste titre** :
l'un contenait « motdepasse », l'autre le nom du produit. Ils ont changé.

**Le téléphone est normalisé avant d'être validé.** `+1 (305) 555-0123` est ce
qu'un humain écrit ; le refuser exigerait une saisie de machine sur un formulaire
d'inscription, et la première chose qu'on ferait serait de retirer le `+`.

## 2026-08-19 — Le créneau v3 : une bande de quatorze jours, pas une grille de trente

Design a répondu à la demande de calendrier plutôt que de l'exécuter, et la
réponse tient : une grille mensuelle serait **vide aux trois quarts**, et un
calendrier vide ne dit pas « tu regardes trop loin », il dit « ce salon n'a
rien ». Sept colonnes tiennent en 46 points sur 390 — assez pour un quantième,
pas pour un compte — donc il faudrait appuyer sur chaque jour pour savoir ce
qu'il contient, c'est-à-dire tâtonner. À 64 points, chaque jour porte son compte
ou le mot de son état : on choisit sans ouvrir.

**Les jours sans place gardent leur place, et répondent.** L'écran listait les
jours *qui avaient des créneaux* : un salon fermé le jeudi voyait son jeudi
disparaître, et la bande passait du mercredi au vendredi sans rien dire. Le
sélecteur précédent les rendait `disabled` — refuser l'appui sans rien dire était
l'autre façon de les faire disparaître. Ils disent maintenant pourquoi, et
proposent les deux jours ouverts les plus proches.

**Quatre états, et aucun n'est interchangeable.** Fermé, complet, révolu, ouvert.
Le troisième a failli manquer : à 20 h, le jour même ouvre bien et n'a plus de
début libre, donc il se lisait « complet » — un salon pris d'assaut — alors qu'il
suffit de revenir demain matin. C'est l'état le plus fréquent des quatre, puisque
tout le monde ouvre l'application le soir. Il a été **consigné en creux dans
`etatDuJour()` plutôt que replié en silence**, le temps que le serveur le rende ;
il s'est remplacé par une ligne, comme prévu.

**L'ordre des trois questions n'est pas indifférent** : fermé l'emporte sur
révolu — un salon qui n'ouvre pas n'a pas de dernière plage à clore — et révolu
l'emporte sur complet, sans quoi le cas du soir retombe dans le mot qu'on vient
de lui retirer.

**Une prémisse fausse corrigée avant qu'elle coûte une route.** Design écrivait
que `/availability` rend un jour à la fois et que la bande coûterait quatorze
appels. La route acceptait `jours` depuis toujours. Ce qui manquait réellement
était plus petit et impossible à déduire côté client : *pourquoi* un jour est
vide. Une exception de capacité **remplace** la règle hebdomadaire au lieu de s'y
ajouter, donc un jour férié se serait lu « complet » ; et « complet » n'est même
pas une propriété du jour, puisqu'il reste de la place pour un soin de 30 min et
plus rien pour un de 120.

**L'étiquette d'horaires de la fiche, et la preuve qui ne va que dans un sens.**
Les horaires servis sont hebdomadaires, exceptions non appliquées — un choix
argumenté côté serveur. L'étiquette serait donc fausse un jour d'exception. Le
rattrapage n'a coûté aucun appel : les prestations de la fiche portent leurs
prochains créneaux, qui sortent du calcul de capacité réel. **Un créneau
aujourd'hui prouve que le salon ouvre aujourd'hui ; l'absence ne prouve rien** —
le salon peut être fermé, ou plein. L'étiquette se tait alors. Un faux négatif
cache une information vraie, un faux positif envoie quelqu'un devant une porte
close.

## 2026-08-19 — J'ai vérifié un arbre en croyant vérifier une branche

Le dépôt porte quatre entrées sur des tests qui passaient sans rien prouver.
Celle-ci est d'une espèce nouvelle : **le test prouvait quelque chose de vrai,
sur un objet qui n'était pas celui qui part en revue.**

Trois sessions ont travaillé le même dépôt le même jour, deux dans le worktree
principal. Une autre session y a créé sa branche depuis la mienne ; à partir de
là j'ai commité sur la sienne sans le voir. J'ai annoncé « 1018 tests verts »
trois fois. Ils l'étaient — dans l'arbre de travail, qui contenait des
modifications non commitées d'une autre session, sur une branche qui n'était pas
la mienne.

Deux gestes auraient tout montré, et je les ai recommandés aux autres une heure
avant de ne pas les taper moi-même :

- **`git branch --show-current` avant de commiter.** Mon propre `git worktree
  list` affichait la mauvaise branche ; je ne l'ai pas lu ;
- **la mesure d'une branche se prend dans un `checkout` propre**, pas dans
  l'arbre. `git worktree add --detach <sha>` dans un répertoire jetable coûte
  vingt secondes et répond à la seule question qui compte : *ce qui part en revue
  est-il vert ?*

Et un troisième, qui n'a rien à voir avec git : `git add -A` dans un arbre
partagé ramasse le travail des autres. Il a emporté une fonction d'une autre
session dans un de mes commits, sous un message qui parlait d'autre chose. Les
chemins explicites n'ont pas suffi — nous éditions le même fichier.

## 2026-08-19 — L'accueil v3 : la vidéo part, et emporte six mécanismes

Elle servait à donner envie sur un écran dont le seul travail est de faire
**choisir un rôle**. Ce qui donne envie est le fil derrière, et personne n'y
arrive plus vite parce qu'un fond bouge.

**Ce qu'elle emporte est le vrai gain** : le repli sur l'affiche, le choix
d'orientation entre une 16:9 et une 9:16 mesuré sur la forme du conteneur, le
cas « pas de réseau », la reprise après un retour au premier plan, la relance
après le montage — Safari refuse une lecture demandée avant que l'élément existe
— et la boucle garantie deux fois. Six mécanismes pour un fond, et six blocs de
tests qui n'ont plus d'objet.

**Le satin part avec elle**, et le défilement aussi. Le satin était la couche du
dessous, posée pour que la composition ne change pas entre la première image et
l'arrivée du manifeste ; sans manifeste, il n'y a plus rien qui arrive. Le
défilement existait parce que deux cartes **empilées** dépassaient la hauteur
d'un iPhone : côte à côte, elles tiennent dans les 728 points qui restent.

**Les intitulés sur deux lignes sont ce qui les autorise à être gros.** Deux
colonnes de 171 points ne portent pas « CREATOR ACCOUNT » sur une ligne au-delà
de 13 points, ce qui n'est pas « en gros ». Empilé, chaque mot tient à 22 en
graisse 800, et le second porte le rôle en `brand.700` — le seul endroit de
l'écran où l'orange s'écrit.

**Le bloc noir de la connexion part sans être remplacé.** Il donnait un contexte
au formulaire : sur la connexion, il expliquait donc le produit à quelqu'un qui a
déjà un compte, c'est-à-dire à la seule personne qui n'a pas besoin qu'on le lui
explique. Rien ne le remplace — le vide qu'on lui reprochait venait de la largeur
de la colonne, pas de son absence de voisin.

**Deux orphelins consignés plutôt que supprimés** : `mediasPlateforme` et
`MediasPlateforme.home` restent servis sans lecteur. Soit la route part, soit un
écran à venir en a l'usage.

## 2026-08-19 — Une garde élargie puis remise, et le trou écrit

L'inventaire des cartes définit une carte par trois marqueurs : fond de surface,
rayon de 18, filet. Les deux portes de l'accueil v3 ont perdu leur filet — deux
cartes voisines à filet donnent une couture au milieu de l'écran — et sont donc
**sorties de l'inventaire en silence**, alors qu'elles sont exactement ce que la
règle vise : un coin de 18 px sur une surface.

La définition a été élargie, puis remise. Sans le filet, une carte enveloppée
compte pour deux blocs — la vue extérieure qui porte l'ombre, la vue intérieure
qui clippe — et le comptage d'égalité devient faux sur les trois surfaces qui
clippent. Le rendre juste demanderait de savoir lequel des deux blocs est le
parent de l'autre, ce qu'une expression régulière ne sait pas.

**Plutôt qu'une garde plus large et plus molle, la définition reste étroite et le
trou est écrit.** C'est la décision inverse de celle prise sur la fenêtre du
détecteur, qui était passée de 600 à 900 caractères — et la différence tient à ce
qu'on y gagnait : là, la garde retrouvait ce qu'elle prétendait couvrir ; ici,
elle aurait cessé de compter juste.
## 2026-08-19 — La preuve v3 : le contrat descend là où l'on publie

La liste des réservations sert à décider d'agir, le détail sert à agir. Le
format, la mention et le lieu ne servent qu'au moment où l'on compose la
publication : les lire trois écrans plus tôt, c'est les avoir oubliés en
arrivant. Ils descendent donc sur l'écran d'envoi, par passation avec la session
qui tient la liste.

**La mention et le lieu se copient, et c'est la correction la moins visible de
cet écran.** Le premier motif de reprise du produit est une mention manquante ou
mal écrite ; un bouton de copie retire la faute de frappe du chemin. Le bouton
dit ce qui vient de se passer puis revient : une copie ne produit rien de
visible, et un bouton qui ne change pas laisse appuyer trois fois.

**Deux défauts corrigés au passage, tous deux dans l'ancien écran.** Le badge à
trois barres disait le palier en codé — la même chose que la fiche v3 a retirée.
Et l'échéance s'écrivait sur `UTC`, c'est-à-dire dans le fuseau de personne :
quatre heures d'écart à Miami, sur la seule date que la créatrice doit tenir.

**Quatre champs manquent, et l'écran se tait plutôt que de les inventer.**
`Collaboration` ne porte ni le temps restant dans la fenêtre de vérification, ni
`dernier_motif`, ni le nom du salon et de la prestation, ni la plateforme. Le
plus gênant est le nom du salon : `required_geotag` dit qu'il faut identifier un
lieu, mais **ce qu'on tape dans la plateforme est le nom de l'établissement**, et
une ligne « identifiez le lieu » sans rien à copier raterait exactement ce que
cette planche corrige. La ligne ne se rend donc pas, et un test le dit — il
tombera le jour où le champ arrivera, ce qui est voulu.

**Et une demande de Design plus large que le besoin, la troisième.** La planche
réclame « le résultat de la lecture automatique, mention et lieu séparément » :
`Preuve.verifiee` et `raisons_de_non_verification` suffisent. Vraie, tout est
réuni ; fausse, les raisons disent ce qui a manqué et le reste est passé ; nulle,
la question ne s'est pas posée — c'est « attestée ». Signalé avant qu'une route
soit écrite pour rien.

---

## 2026-08-19 — Les réglages du créateur : deux natures, un seul cramoisi

La revue a rendu trois reproches sur cet écran — « c'est moche, il y a trop de
réglages, les boutons sont colorés pour rien » — et les trois avaient la même
cause. Une colonne unique présentait au même poids une préférence qu'on change
sans conséquence et une sortie de l'application ; la couleur des boutons tenait
lieu de hiérarchie, faute d'en avoir une. **Deux régions séparées par un filet**
remplacent les quatre boutons peints : ce qu'on règle, puis ce qui met fin.

**La suppression est cramoisie, mais sur le bloc et non sur le bouton.** C'est
la seule décision du produit qui ne se rouvre pas, donc la seule teintée — un
seul cramoisi par écran. La porter sur la commande aurait reproduit le défaut
même que la revue signale : un bouton coloré qui crie sans rien dire de plus. Le
bloc porte la nature de la décision, le bouton porte l'action. La déconnexion,
qui se défait en se reconnectant, redevient neutre : la peindre en `danger`
mettait la fin de séance et la suppression définitive au même niveau d'alarme.

**La bascule de thème ne revient pas, et la question est close.** La v1.0
l'avait retirée — un seul jeu de couleurs, `theme.$userOverrideRetire` dans les
jetons en garde la trace. Un interrupteur qui ne commande rien fait douter des
réglages voisins, ce qui est précisément le doute exprimé en revue : la remettre
aurait recréé la cause du reproche en croyant le corriger. Un test l'interdit,
et il cherche l'interrupteur par son rôle autant que par son libellé — une
bascule muette repassait sous une garde qui ne lisait que les mots.

**Le diagnostic de connexion n'est plus un réglage.** Outil de développement, il
occupait à lui seul plus de place que les préférences qu'une créatrice vient
réellement changer : une bonne moitié du « trop de réglages » tenait là. Il
passe derrière un appui long sur la ligne de stockage, en pied d'écran — non
découvrable, non perdu, parce qu'il sert le jour où un écran reste vide. Il
garde son retour au toucher : ce qui le cache est l'apparence au repos d'une
ligne d'encre pâle, pas l'absence de réponse au doigt.

**La suppression de compte est composée sans sa route, et inactive plutôt que
fausse.** `anonymization.anonymize_account` existe ; aucun routeur ne l'expose.
Le bouton est donc `disabled`, ce que `Button` réserve aux actions qui
redeviendront possibles — sa réserve tenant à ce qu'un bouton grisé fasse
deviner ce qui le débloque, une phrase le dit à côté. **Les quatre règles sont
écrites maintenant, pour la route à venir** : la suppression *anonymise et ne
détruit pas*, parce que le journal d'audit est immuable et qu'une contrepartie
engagée concerne un salon qui n'a rien demandé ; elle est *différée de trente
jours*, avec retour possible pendant ce délai ; elle est *refusée tant qu'une
contrepartie court*, qui doit être honorée ou close avant ; et le commerce *ne
voit jamais un compte anonymisé* dans son historique, il voit une créatrice
partie. Elles sont dans le texte de l'écran parce qu'une décision irréversible
se lit avant d'être prise, pas dans la boîte de confirmation qui la suit.
## 2026-08-19 — Ce qui allait se déduit du contrat, jamais du motif seul

La planche v3 exige qu'une reprise dise **ce qui allait** en plus de ce qui
manque : « the mention was there. Add the tag and send it again ». La raison est
juste — un manque non borné se lit comme un tout à refaire, et « la mention
manque » sur une story tournée, montée et publiée laisse croire qu'il faut la
retourner.

**La phrase se déduit, et c'est là qu'elle peut mentir.** Le commerce choisit un
motif dans une liste fermée ; le reproche enregistré est donc entier, et les
autres exigences n'ont pas bloqué. Mais **les autres exigences du contrat**, pas
toutes celles qu'on pourrait nommer : sur une contrepartie sans mention exigée,
« la mention y était » invente une conformité sur une exigence qui n'a jamais
existé, et le fait au moment précis où la créatrice cherche ce qu'elle a raté.
Le rendu croise donc le motif avec `required_mention` et `required_geotag`, et
quand il ne reste rien à rassurer la ligne ne s'écrit pas.

C'est le décor de test qui l'a imposé : recopier l'exemple de la planche
— motif « lieu », réassurance « mention » — laissait passer une implémentation
qui rassure toujours sur la mention. Le cas écrit en premier est donc l'inverse,
puis celui où la mention n'est pas exigée. Quatre mutations, quatre chutes.

**Et le plafond de tentatives reste hors de l'écran.** La planche écrit
« attempt 2 of 3 » ; `collaboration_max_attempts` est un seuil de configuration
que l'API ne sert pas, et l'écrire en dur est ce que `CLAUDE.md` interdit. Le
rang seul est affiché — vrai, mais incomplet — et le manque est consigné.

**`secondes_avant_echeance`, servi par #181, n'est pas l'horloge demandée.** Il
compte jusqu'à `deadline_at`, l'échéance de publication. La jauge de la planche
mesure la fenêtre de vérification : 24 h depuis la publication. Deux horloges sur
le même écran, et l'une pour l'autre annoncerait « 21 h » quand il en reste 45.
Le champ est consigné `a-instruire` plutôt que rangé en `contrat` : il pose une
question de route, il ne la ferme pas.


---

## 2026-08-19 — L'audience v3, et trois écarts avec la planche

**« Les paliers restent où ils étaient » est faux.** La planche rassure ainsi
quand l'autorisation d'un réseau tombe. `eligibility.py` dit l'inverse : un
compte qui n'est plus actif porte `account_token_invalid` sur **chaque** palier,
donc ils se ferment tous. Ce qui est vrai est l'autre moitié, et elle est
vérifiée : `evaluer_createur` n'est appelé qu'à la création d'une réservation,
jamais ensuite, donc ce qui est déjà engagé n'est pas touché. La carte dit les
deux — les nouvelles réservations attendent, les anciennes tiennent — parce que
la seconde moitié est ce qui inquiète vraiment, et la première ce qui est utile.

**Sept événements bougent le score, la planche en nomme quatre.** La grille de
pondération compte trois hausses et quatre baisses, dont « publier en retard »
et « une reprise demandée ». Une liste qui promet de dire ce qui affecte le
score et en tait deux se retourne contre elle le jour où il baisse pour une
raison absente de l'écran. Les mots de Design sont gardés pour les quatre
qu'elle nomme, l'ordre aussi ; les trois autres suivent. Reste que l'écran
**récite** cette grille au lieu de la lire — consigné.

**« First reading within a day of connecting » promet un délai.** La cadence du
relevé est de la configuration, et le dépôt interdit d'écrire un délai en dur.
La phrase existante est gardée : elle dit ce qui compte vraiment — que le tiret
n'est pas un zéro — sans promettre une heure que personne ne tient.

**Et une contradiction interne à la planche, tranchée.** Elle oppose « une carte
à ombre » pour un compte connecté à « une ligne à filet » pour un compte à
connecter, la forme disant l'état avant le mot ; puis dessine cette ligne en
blanc à filet et rayon de 18, c'est-à-dire avec les trois marques d'une carte —
que la règle des rayons oblige alors à porter l'ombre elle aussi. Deux surfaces
blanches surélevées ne se distinguent plus. La ligne est donc creusée dans le
neutre : ce qui est posé et blanc est à vous, ce qui est creusé ne l'est pas
encore. La distinction de la planche est tenue, et aucune exception par écran
n'est ouverte dans l'inventaire des cartes.

**La jauge est un composant, pas deux blocs de style.** Un écran ne peint jamais
la teinte de marque, et la tolérance de cette garde est par fichier : écrire les
deux barres sur place aurait exempté `AudienceScreen.tsx` en entier, donc laissé
passer la pastille orange du mois suivant. `components/Jauge.tsx` est le lieu
légitime de la teinte, et la garde garde toute sa force.

---

## 2026-08-20 — La suppression de compte, branchée sur ses trois routes

`POST /me/deletion` ouvre le délai, `DELETE /me/deletion` le retire, et
`deletion_effective_at` vit sur `/me`. Le bloc cramoisi composé la veille passe
donc de deux textes à **deux états** : aucune demande — les conséquences, puis
le bouton ; une demande ouverte — l'échéance datée, et de quoi revenir. Le
second n'est pas une variante du premier : le compte reste actif, tout marche
encore, et c'est exactement ce que les trente jours existent pour offrir.

**Rien ne demande de confirmer, et c'est le report qui l'autorise.** Une boîte
« êtes-vous sûre ? » par-dessus une décision réversible pendant un mois
ajouterait une friction là où la garantie est ailleurs : les conséquences se
lisent au-dessus du bouton, et le retour reste ouvert jusqu'à l'échéance.

**L'échéance se lit dans le fuseau de l'appareil, pas dans celui d'un salon.**
La règle du produit convertit sur le commerce parce que tout le reste s'y passe ;
cette date-là n'appartient à aucun commerce, elle appartient au compte. La rendre
à Miami pour quelqu'un à Madrid la ferait tomber un jour à côté.

**Le 409 ne porte pas le nombre, et l'application le compte.** Étendre la
fabrique d'erreurs pour un compteur aurait coûté un détail structuré à toutes
les erreurs du produit pour une phrase d'un seul écran ; l'app liste déjà les
réservations, donc elle sait compter. « Il vous reste deux publications » se
traite, « vous avez des contreparties » se subit.

**Ce comptage recopie une constante du serveur, donc une garde la lit.**
`CONTREPARTIES_EN_COURS` doit valoir `account_deletion.EN_COURS` — quatre
statuts, deux langages, deux dossiers. Le jour où le serveur en ajoute un,
l'écran annoncerait une contrepartie là où le refus en compte deux. Le test lit
le bloc `frozenset` dans le fichier Python et compare ; la dérive casse la
suite au lieu de se découvrir sur un écran. Il cible le bloc `EN_COURS` et non
le fichier entier : `CollaborationStatus` y apparaît ailleurs, et prendre tout
le fichier aurait fait passer la garde pour n'importe quelle liste.

**Une page pleine se tait plutôt que de sous-compter.** Cent réservations
demandées ; si la page est pleine elle peut en cacher, et un nombre trop bas
tromperait dans le sens qui fait croire qu'on a fini. La règle vit dans l'aide
pure et non dans le composant — posée dans l'écran, elle ne s'éprouvait qu'en
montant cent réservations, et la mutation qui la retirait passait au vert.

---

## 2026-08-20 — La journée v3, et le relief rendu à ce qui attend

**La campagne 2 avait aplati toute la colonne, la v3 lui rend un relief.** La
raison d'alors était bonne et elle est remplacée, pas conservée à côté de son
contraire : « deux formes physiques pour deux états de la même chose obligent à
réapprendre la lecture à chaque section ». C'était vrai de deux **états** ; ce
ne sont pas deux états, ce sont deux **gestes**. Une demande se soupèse — de
quoi il s'agit, avec qui, jusqu'à quand, et les trois faits décident ensemble ;
le planning se parcourt. Le relief distingue ce qu'on lit de ce qu'on survole,
et le donner aux trois sections revient à ne rien mettre en avant.

**Servi et clos n'en font plus qu'un.** Ils étaient séparés parce qu'une
contrepartie court encore dans un cas et plus dans l'autre. C'est vrai, et c'est
une différence pour la créatrice, pas pour le comptoir : des deux côtés il n'y a
plus rien à faire aujourd'hui. La nuance reste écrite sur la ligne.

**Le contour ambre se décide sur le fuseau du salon, et jamais sur une limite
passée.** Une limite à 22 h à Miami tombe le lendemain en temps universel : lue
sur le fuseau de la machine, elle cesserait d'être « aujourd'hui » pour la
personne qui est au comptoir. Et une limite dépassée tombe bien aujourd'hui sans
qu'il reste rien à faire — le bandeau de dépassement le dit, un contour d'appel
par-dessus ferait espérer une action qui n'existe plus.

**Deux défauts trouvés par les tests, pas par relecture.** Le titre rendait
« 1 requests need your answer » au cas le plus courant de tous, parce que la
première version n'avait que deux branches — zéro et « n ». Et le vide de
l'écran ne regardait que les rendez-vous du jour, alors qu'`a_trancher` est
servi toutes dates confondues : un salon sans rendez-vous aujourd'hui et deux
demandes en attente voyait « aucun rendez-vous », c'est-à-dire l'inverse exact
de ce que la v3 existe pour corriger.

**Et le 18 août 2026 est un mardi.** La planche écrit « Monday 18 August ».
Recopier le libellé de la maquette dans le test aurait fait passer une
implémentation qui renvoie un jour fixe — c'est le décor qui aurait été faux,
pas le code.

**`type.captionStrong` entre dans `produit.json`.** L'échelle de la passation
n'a que `caption` en 400 et `bodyStrong` en 16 : entre les deux, rien. Une seule
phrase en a besoin — la limite qui tombe aujourd'hui — où la graisse fait la
moitié du travail et l'ambre l'autre. Il vit dans le fichier du produit et non
dans la passation : Design ne l'a pas nommé, et la passation reste sa copie.


---

## 2026-08-20 — Le score se lit, il ne se récite plus

**La liste en dur est partie, et c'est le défaut que j'avais consigné la veille
plutôt que corrigé.** L'écran nommait sept événements et leur sens depuis du
texte figé ; les sens viennent de `reliability_weights`, qui est de la
configuration, et un poids inversé en exploitation aurait rendu l'écran faux
sans qu'aucun test ne tombe. Les neuf arrivent maintenant avec le sens du jour.

**Le test qui le prouve sert `no_show` en hausse.** C'est le seul décor qui
diverge : un écran qui porterait sa liste en dur rendrait exactement la même
chose que la planche sur un décor conforme, et le test aurait survécu à la
mutation sans rien éprouver.

**Les neutres ont leur section.** Un signalement écarté ne coûte rien,
délibérément. Taire les poids nuls ferait disparaître de l'écran quelque chose
qui existe et qui peut réapparaître au premier réglage.

**Un code inconnu ne s'affiche pas brut, et le silence n'est pas la réponse.**
« resubmit_required » posé tel quel se lirait comme une chaîne oubliée. Mais se
taire ferait disparaître un événement sans que rien ne le signale : une garde lit
l'énumération Python et exige une phrase pour chaque code. Elle est écrite là
plutôt que recopiée à la main — une liste tenue à la main dans le test serait
exactement le décor que le code fautif produit.

**Une date d'expiration à venir ne se rend pas.** Un compte révoqué avant
l'échéance de son jeton en porte une : écrire « expire le 3 octobre » sous « il
faut réautoriser » dirait le contraire du bloc qui la porte.

**Et pour la troisième fois en deux jours, `undefined` n'est pas `null`.** La
nullité est portée par le contrat, l'absence par l'appelant : `composantes`
manquant faisait tomber l'écran entier là où la bonne réponse est « aucune
section ». Les trois fois, la garde falsy a suffi ; les trois fois, c'est un
test qui l'a trouvée, jamais une relecture.

---

## 2026-08-20 — Les réservations : la pilule, et le contour de la reprise

Les deux points que Design réclamait et que l'écran n'avait pas.

**La pilule était une pilule étirée.** `fullWidth` vaut `true` par défaut ;
personne ne l'avait dit non, et le bouton d'action prenait toute la largeur de
la carte. Même correction qu'à la fiche. **La rangée n'est pas décorative** : en
colonne, `alignSelf` non posé retombe sur l'étirement du parent, et le bouton
reprendrait toute la largeur avec exactement le style qu'on vient de corriger.

**Une reprise n'est pas une demande de plus.** Le salon a regardé, refusé, et dit
pourquoi : c'est la seule ligne de l'écran qui porte un reproche, et sous le même
traitement que les autres elle se perd dans une pile où tout demande également.
`Surface` gagne donc `reprise`, qui prend le contour d'encre — le trait le plus
fort du système. Le contour **remplace** l'ombre au lieu de s'y ajouter : la
règle qui interdit déjà de cumuler l'ombre et le filet clair vaut pour le
troisième traitement, une exception ici abîmerait les deux.

L'onglet garde le dernier mot : une reprise close est de l'histoire, pas un
reproche qu'on ressort.

**Et une garde qui ne prouvait rien, trouvée par mutation.** Le test de la
pilule ne lisait que `alignSelf` du bouton : retirer la rangée le laissait vert,
puisque `alignSelf` reste absent dans les deux cas et que c'est le parent qui
décide. Le décor ne distinguait pas les deux implémentations — exactement le
défaut que le fichier de contexte décrit. Il regarde maintenant l'axe du parent,
et les deux mutations tombent.
## 2026-08-20 — Les publications du commerce : ce que la revue demandait, et deux défauts trouvés en le faisant

La revue posait trois points. **Deux étaient déjà réglés** par la conversation
des données — l'onglet `expected` porte désormais un libellé qui dit de qui et
de quoi on parle, et l'ordre suit l'usage : à examiner, approuvées, attendues.
Ce qui demande un geste vient d'abord, ce qui n'attend personne en dernier.
Les deux sont maintenant tenus par un test : l'ordre se relit sur le rendu, pas
sur la constante.

Le troisième — les liens et l'aperçu dans « à examiner » — était réglé aussi,
mais **rien ne l'attestait**. L'aperçu avait sa garde, l'adresse d'origine non ;
or c'est elle qui compte le plus, l'archive n'étant que la trace. Sans le lien,
le commerce approuve sur une image qu'il ne peut pas recouper. La mutation qui
retire le lien fait maintenant tomber la suite.

**Une ligne sans personne, et c'est la promesse de la suppression de compte.**
`creator_partie` est servi par le serveur depuis l'ouverture de la route ;
l'application ne le lisait pas. Les trois champs de nom étant nuls après
anonymisation, la chaîne de `??` finissait sur une **chaîne vide** : une
contrepartie sans créatrice, que le commerce lit comme une panne du produit.
Elle n'est pas inconnue, elle est partie — c'est exactement ce que la décision
du 19 août promettait de lui montrer, et l'écran ne le montrait pas.

Le même défaut existe sur `ArbitrageScreen`, qui replie sur `—` à trois
endroits. Moins faux qu'une chaîne vide, faux quand même : signalé, pas corrigé
ici, cet écran n'était pas dans la demande.

**« Awaiting her post » supposait le genre de toute créatrice.** Sur un écran
que lisent quatre salons, à propos de gens qu'ils n'ont pas choisis. L'espagnol
était déjà neutre — `Falta su publicación` — donc seul l'anglais portait
l'affirmation. Un test refuse désormais le pronom genré dans ce libellé.

---

## 2026-08-20 — Les rapports : un écran qui change de nature, et des barres qui n'existaient plus

**Les barres par palier n'avaient aucun remplissage, et personne ne le savait.**
Elles empruntaient les teintes de palier — `tier.story`, `tier.post`,
`tier.reel` — supprimées au passage à l'ambre. `useColors()` rendait
`undefined`, la barre recevait `backgroundColor: undefined`, et le graphique
était invisible depuis. Le test qui le couvrait regardait la **présence** de
l'élément et jamais sa couleur : il est resté vert tout du long.

Et même vivante, la teinte se lisait à l'envers : sur une barre, la densité
encode l'ampleur, alors que la matière du `TierBadge` va du contour clair au
plein — le palier le plus fourni était le plus vide. Un seul remplissage, donc,
et la matière descend dans le badge, où elle encode le palier et rien d'autre.

**`toEqual([])` accepte un tableau d'`undefined`.** La garde que j'ai écrite
pour attraper ce défaut a d'abord survécu à sa propre mutation : Jest ignore les
`undefined` dans un tableau, si bien que `[undefined, undefined, undefined]`
**égale** `[]`. Troisième assertion vide de la série, après `toHaveTextContent`
sur une chaîne. La règle qui s'en dégage : une assertion qui compare à du vide
doit être éprouvée sur le cas non vide, sinon elle ne prouve que sa propre
syntaxe.

**Deux mutations ont survécu, et elles ne disaient pas la même chose.** La
première a révélé une **clause morte** dans mon code : `ouverts.length === 0 ||`
ne pouvait rien changer, puisque `sansPhoto` se compte déjà sur `ouverts`. La
seconde a révélé un **décor non divergent** : mon montage avait `catalogue`
déjà fait, c'est-à-dire déjà trié, et la mutation qui retire le tri y survivait
sans rien changer. Le code a été simplifié dans un cas, le décor refait dans
l'autre — ce ne sont pas les mêmes corrections.

**Le rayon de 7 px de la planche devient `radius.sm`.** Aucun rayon ne s'écrit
en dur, et l'échelle n'a rien entre 0 et 10. Trois pixels d'écart valent mieux
qu'une valeur hors système, qui se recopierait ailleurs sans qu'on la voie.

**Et l'échec de la composition se dit.** Une première version rendait `null`
quand une des trois listes manquait : le salon voyait alors un écran
entièrement vide, sans titre ni explication — pire que l'état vide qu'on venait
de remplacer.


---

## 2026-08-20 — La portée locale, et la borne qui vient du serveur

**La fenêtre se compte depuis la borne servie, jamais depuis l'horloge locale.**
Le serveur découpe dans le fuseau du salon — « du 1er au 31 » contient le 31, et
le mois d'un salon de Miami ne commence pas à 20 h la veille. Un client qui
calculerait « aujourd'hui moins 84 jours » décalerait la borne d'un jour à
chaque bord de fuseau, et le décalage ne se verrait que sur les rapports de fin
de mois. Le repère se prend en outre sur la **première** réponse et ne bouge
plus : le relire à chaque changement de période ferait glisser la borne de fin
d'un cran à chaque clic, et « douze semaines » ne montrerait jamais les mêmes
douze.

**« Depuis le début » n'apparaît que s'il y a un début.** Sans `premiere_semaine`
l'onglet retomberait sur la fenêtre par défaut : deux positions rendant la même
chose font douter des deux.

**Le point des paliers cite l'écart, pas le gain d'un palier précis.** Ce que le
serveur sait dire est le nombre de créatrices du rayon qui ne peuvent rien
réserver de ce qui est ouvert. La planche écrit « ouvrir le palier post
toucherait 62 créatrices de plus » — c'est une portée **par palier**, qui n'est
pas servie et ne se déduit pas des deux nombres.

**Et l'absence ne se remplace pas par zéro.** Sans portée servie, le point garde
sa phrase générale : écrire « 0 créatrices ne peuvent pas réserver » à la place
d'une donnée manquante dirait exactement le contraire de la vérité.


---

## 2026-08-20 — Les horaires, les deux réseaux, et une distinction qui s'est payée cinq fois

**La sous-ligne de la journée prend ses horaires sur `horaires`, jamais sur
`debut` et `fin`.** Ces deux-là sont les bornes de la journée *comptée* — minuit
à minuit dans le fuseau du salon — et c'est en les prenant pour des heures
d'ouverture que la ligne serait restée fausse en annonçant « de 00:00 à 00:00 ».
Le test le tient en faisant diverger les deux lectures : le décor pose les
bornes à minuit et les horaires à neuf heures.

**Vide veut dire fermé, et se dit.** Une journée sans réservation ne se lit pas
pareil selon qu'on était fermé ou que personne n'est venu, et c'est exactement
la question qu'un gérant se pose en ouvrant l'écran un jour creux.

**Le réseau absent reste affiché.** Savoir qu'il n'y a pas de TikTok fait partie
de la décision autant que le nombre d'abonnés Instagram : un réseau simplement
omis se lit comme un oubli de l'écran, pas comme une absence. Il porte l'encre
douce et aucune action — le lien sortant est réservé à celui qui a un profil
public, et il porte le glyphe de sortie parce que c'est le seul endroit du
produit où l'on quitte l'application.

**Cinquième fois aujourd'hui que `undefined` n'est pas `null`.** La nullité est
portée par le contrat, l'absence par l'appelant : `horaires` manquant faisait
tomber l'écran entier là où « pas d'horaires » est la bonne réponse. Les cinq
fois, la garde falsy a suffi ; les cinq fois, c'est un test qui l'a trouvée. La
leçon n'est pas la garde, c'est que **tout champ neuf lu par l'app doit être lu
en falsy tant que des décors et des réponses d'avant le champ circulent**.

---

## 2026-08-20 — L'annuaire v3 : le silence sur la note, et le nom civil qui n'avait rien à faire là

**Un renversement, écrit comme tel.** L'annuaire portait une ligne qui
expliquait l'absence de score : « nous ne vous montrons jamais de note, et nous
ne classons jamais les créatrices entre elles ». L'intention était bonne et
l'effet inverse — **écrire qu'on ne montre pas la note apprend qu'une note
existe**, et installe un salon à la chercher ailleurs, chez la créatrice ou en
la réclamant. La ligne est retirée. Ce qui rend le silence tenable : le palier
accessible **est** le signal, puisqu'un score dégradé plafonne mécaniquement.

**L'absence de contact, elle, s'explique**, et c'est l'exact inverse. Un salon
**cherchera** ce bouton — tous les annuaires qu'il connaît en ont un — et ne rien
dire le laisse conclure au défaut. La règle qui sort des deux : une absence
qu'on ne cherche pas se tait, une absence qu'on cherche se dit.

**La fiche titre le pseudonyme, plus le nom civil.** L'écran affichait « Léa
Moreau » : l'identité d'état civil de cent vingt-huit personnes, sur l'écran de
tout salon abonné qui ne les a jamais rencontrées. Le pseudonyme suffit à ce que
l'annuaire sert — reconnaître un compte, aller voir son travail — et le nom
civil arrive à la réservation, quand une créatrice a choisi ce salon.
**La donnée part toujours sur le réseau** : l'écran a cessé de la lire, le
schéma doit cesser de la servir. Instruit dans `TASKS.md`, et les deux champs
sont inscrits `a-instruire` dans la table des champs servis — ce qui empêche
qu'on les croie simplement oubliés.

**Deux champs servis et jetés par le type de l'app.** `avatar_key` et
`profil_url` arrivaient dans la réponse depuis l'ouverture de la route : les
fiches n'avaient pas de visage, et les pseudonymes ne menaient nulle part. Le
portrait garde son cadre quand la photo manque, et ce n'est pas un cas limite —
la même clé servira l'aperçu flouté au salon sans abonnement, et les photos
déposées avant cet aperçu répondront 404 plutôt que de retomber sur l'original.

**Le garde-fou de lecture seule est affiné, pas excepté.** Il interdisait tout
`onPress` dans cet écran. Il attrapait donc le lien de profil au même titre
qu'un bouton de contact, alors que les deux ne disent pas la même chose : l'un
agit sur une créatrice dans BIND, l'autre sort du produit pour aller voir son
travail. Il interdit maintenant le bouton, le rôle « button » et tout appel
d'API d'invitation — et vérifie en plus que **chaque** `onPress` de l'écran est
un `Linking.openURL` portant `accessibilityRole="link"`, sans quoi il aurait
suffi d'éviter le mot « bouton ».

**Ce qui manque encore est écrit dans `TASKS.md`** : le compte avant la liste,
le contre-factuel, le tri accès-puis-proximité, la distance. Aucun n'est
dérivable côté écran — `annuaire()` ne prend pas de commerce, et son
`paliers_ouverts` répond « elle se qualifie quelque part », pas « elle peut
réserver ici ».

---

## 2026-08-20 — L'annuaire commence par le compte, et le gain n'est pas un total

La route rend désormais une **enveloppe** — `{ portee, createurs }` — et non
plus une liste nue. L'écran compose dessus : le compte d'abord, la grille
ensuite. C'est le renversement de la v3, et sa raison est que la recherche par
pseudonyme ne sert qu'à qui sait déjà quoi taper, c'est-à-dire à personne sur un
écran où un salon ne connaît aucun nom.

**`createurs_en_plus` est un gain, jamais un total.** Les paliers déjà ouverts
n'y figurent pas, et une créatrice qui peut déjà réserver n'est comptée dans
aucun gain : les populations se recouvrent — qui ouvre le reel ouvre le story —
et additionner des totaux par palier annoncerait un marché qui n'existe pas. La
phrase se compose donc `peuvent_reserver + createurs_en_plus`. Rendre le gain
tel quel aurait affiché « porterait ce chiffre à 62 » là où le salon en a déjà
41 : une phrase qui passe la relecture et se voit en démonstration. Un test la
tient, et sa mutation tombe.

**Un seul candidat, celui qui rapporte le plus, et jamais un gain nul.** La
planche montre une phrase, pas une liste de paliers à comparer ; et « ouvrir le
post porterait ce chiffre à 41 » invite à un geste qui ne change rien.

**« 128 » ne se dit jamais seul.** Les créatrices sans position renseignée ne
sont comptées nulle part : le nombre est celui de celles dont on peut affirmer
qu'elles sont dans le rayon. « Autour de vous » est donc obligatoire dans la
phrase, et le rayon vient du serveur — la planche écrit 15 km, la configuration
en dit 10.

**La clé d'image se sert telle quelle, et le test a dû être resserré pour le
prouver.** L'écran passait par `urlDeLaVignette`, qui suffixe `@vignette` ; sans
abonnement la clé porte déjà `@apercu`, et la suffixer deux fois n'aurait rien
rendu. Le cadre serait resté vide et on l'aurait pris pour le 404 prévu sur les
photos d'avant l'aperçu — **le défaut se serait caché derrière un cas limite
légitime**. La première assertion vérifiait que l'adresse *contient* la clé, ce
que la vignette fait aussi : la mutation passait au vert. C'est la terminaison
qui distingue les deux, et un second test sert une clé déjà en `@apercu`.

---

## 2026-08-20 — La caisse dit à quoi elle sert, et le produit cesse de genrer

**La revue ne savait pas si l'écran était l'arrivée ou le départ.** Deux mots y
menaient. Le titre disait « redeem a booking » — une mécanique interne, aucun
moment du comptoir. Et l'onglet disait « Checkout », qui en anglais de commerce
veut dire *payer et partir*. Ensemble ils décrivaient la fin d'une visite là où
c'est le début.

L'écran porte maintenant un vrai titre — **« Check a creator in »** — et une
ligne qui dit les trois gestes dans leur ordre : elle présente un code en
arrivant, on le vérifie, on sert, on marque servi. L'onglet devient
**« Register »**, le mot de la planche v3 : la caisse comme meuble, qui ne prend
parti ni pour l'entrée ni pour la sortie. L'espagnol disait déjà « Caja », qui
n'avait pas l'ambiguïté.

**La bande de comptoir ne répète pas le titre.** Elle se lit debout à un mètre :
ce qui sert à cette distance n'est pas le nom de la page — on est dessus — mais
le geste qui commence. Elle dit donc le moment, le titre dit le lieu.

**Le libellé de l'e2e a été corrigé avec.** `ongletsVisibles` recopie les
libellés d'onglets ; « Checkout » y serait resté sans faire échouer quoi que ce
soit — c'est une liste de candidats, un candidat introuvable est simplement
absent — et la couverture aurait baissé en silence. C'est la façon la moins
visible de casser un test.

**Trois fois le même défaut en une journée : le produit genrait ses
créatrices.** « Awaiting her post » sur la file du commerce, « she came and
found you closed » sur le délai d'absence, « she needs to read your menu » sur
la carte. Tous côté anglais ; l'espagnol était neutre à chaque fois — `su`, `la
creadora` — donc la comparaison entre les deux langues ne révélait rien. Ces
phrases parlent de créatrices à des salons qui ne les ont pas choisies et
affirment leur genre à leur place.

Une garde refuse désormais tout pronom de troisième personne genré dans les
chaînes anglaises. **Elle a dû être réécrite pour prouver quelque chose** : la
première version appariait les apostrophes du fichier source, et les
commentaires français en contiennent — « l'écran », « qu'on ». L'appariement se
désynchronisait sur tout le reste, la garde lisait des fragments qui ne sont les
chaînes de personne, et la mutation qui remettait « her » dans un libellé
passait au vert. Elle parcourt maintenant l'objet rendu, et compte les chaînes
visitées pour qu'un import cassé ne rende pas un vert vide.

---

## 2026-08-20 — Un état n'est pas un écran, et midi ne protégeait de rien

**La mise en ligne quitte la configuration pour la journée.** Elle n'était pas
une section : ce qu'elle portait est une liste de ce qui manque, qui n'a
d'utilité que là où le salon regarde déjà et qui doit disparaître une fois
remplie. La transformer en page a produit exactement ce que les testeurs ont dit
— un onglet dont on ne comprend pas l'objet.

Le bandeau n'énumère que ce qui manque. Ce qui est fait se **compte** — « 4 sur
6 » — parce que quatre coches au-dessus de deux manques diluent ce qu'on vient
lire.

**Publier reste un appel explicite, et la planche l'ignore.** Elle écrit que le
bandeau « s'efface au dernier point coché » ; `activerLeCommerce` existe et rien
ne l'appelle tout seul. Le dernier point coché ne publie donc pas, il rend la
publication *possible* : le bandeau porte le geste, sous un nom qui n'est pas
« go live » — le mot part, l'acte reste. Rendre la publication automatique est
une décision serveur.

**Le nombre vient du calcul, pas de la maquette.** « Two things left » est vrai
de la planche et faux à trois manques. Le singulier a sa propre clé, pour la même
raison que sur le titre de la journée : `count` traverse `formaterLesNombres` et
la pluralisation de la bibliothèque ne le voit plus comme un nombre.

**Et midi ne protégeait de rien.** J'avais écrit que lire une date nue à midi
mettait à l'abri du fuseau de la machine ; la mutation a montré que non — minuit
et midi tombent dans la même journée UTC, et c'est `getUTCDay` qui ignore le
fuseau, pas l'heure choisie. Le commentaire décrivait un risque inexistant et le
test prétendait le garder. Les deux sont corrigés : le code dit la vraie raison,
et le test attrape ce qu'il peut réellement attraper — `getDay()` à la place de
`getUTCDay()`, éprouvé sous `TZ=America/New_York`.

C'est la seconde fois de la journée qu'une mutation révèle du code inutile
plutôt qu'un test faible. La question à se poser quand une mutation survit n'est
donc pas seulement « mon décor est-il divergent ? » mais aussi « cette ligne
sert-elle à quelque chose ? ».


---

## 2026-08-20 — Deux portes, et ce qu'une suppression d'écran a failli emporter

**`ActivationScreen` est supprimé.** Ses deux fonctions ont trouvé leur place :
ce qui manque et la publication vivent en bandeau sur la journée, la pause vit
dans les réglages, avec les gestes qui engagent le compte. Le garder monté
nulle part l'aurait laissé resservir un jour en portant une composition
périmée — c'est ce qui était arrivé au logo vert et à `BusinessCard`.

**Onze chaînes de traduction sont parties avec lui.** Une chaîne orpheline ne
coûte rien à laisser, et c'est précisément ce qui la fait resservir ailleurs,
mal. La vérification est mécanique : une clé dont les seuls fichiers porteurs
sont `en.ts` et `es.ts` n'a plus de lecteur.

**Le cas « publié mais invisible » a failli partir avec l'écran.** Les étapes non
bloquantes ne retiennent pas la publication mais décident de la visibilité : un
salon en ligne sans photo de couverture n'apparaît dans aucun mur. L'ancien
écran le disait ; le bandeau, qui s'efface à la publication, ne le disait plus.
Il reste donc affiché dans ce cas — ce n'est pas une liste de tâches qui traîne
après avoir été remplie, c'est un état non résolu.

**La pause ne pouvait pas aller sur le bandeau.** Les deux gestes sont
symétriques dans le mot et opposés dans le moment : le bandeau s'efface à la
publication, or la pause n'a de sens qu'une fois publié.

**Et une assertion trop large ne dit rien de ce qu'elle vise.** Ma garde sur
« l'avertissement n'est pas ambre » lisait tout le bloc, badges compris ; le
badge REEL porte l'aplat de marque, et l'assertion tombait sur lui. Elle serait
restée rouge quoi que fasse l'avertissement. Resserrée sur l'avertissement seul,
elle éprouve enfin ce qu'elle annonce.

---

## 2026-08-20 — La file des publications, composée — et l'inventaire des cartes qui ne voyait pas la moitié du produit

**La file était une pile plate.** Chaque dossier était un `View` à `gap: 6`,
sans surface ni séparation : cinq contrôles se suivaient sans que rien dise où
l'un finissait. Et tout s'y présentait au même poids — le pseudonyme, la preuve,
les quatre motifs de refus, les deux boutons — de sorte qu'on ne distinguait pas
ce qu'on juge de ce avec quoi on tranche. C'est une bonne part du « on ne
comprend pas à quoi sert la page ».

**La grammaire des surfaces s'applique ici comme aux réservations.** Une carte à
ombre demande une décision, une carte à filet informe. Un dossier qu'un arbitre
a en main informe : `needs_human_review` portait déjà la distinction dans les
données, elle devient visible.

**Une seule décision ouverte à la fois, et c'est ce qui rend l'orange tenable.**
Le bloc de marque est un signe de ponctuation ; cinq boutons pleins dans une
colonne n'en sont plus un. La file d'arbitrage avait tranché la même question et
son argument vaut ici. **La preuve, elle, reste visible sur tous les dossiers** :
c'est ce qu'on vient lire, et la cacher ferait payer un clic pour voir avant de
décider. Seule la décision se déplace. Le premier dossier à trancher est ouvert
d'emblée — un écran qui n'ouvre rien ne sert qu'à ceux qui savent déjà qu'il y a
quelque chose à ouvrir, défaut relevé sur l'arbitrage en campagne 2.

**L'inventaire des cartes ne lisait que les styles objet.** `style={{ … }}` était
la seule forme cherchée. Or une carte pressable s'écrit
`style={({ pressed }) => ({ … })}` — la forme canonique du retour au toucher — et
**aucune carte pressable du produit n'était donc comptée**. Élargi plutôt
qu'assorti d'une exception : inscrire le fichier aurait ajusté la règle à la
première carte qu'elle rencontre, ce qui est exactement l'érosion que
l'inventaire existe pour empêcher.

**L'élargissement a trouvé deux défauts de rendu que personne ne voyait.** La
carte de section de `ConfigurationScreen` et la porte des règles de
`PaliersScreen` portaient un coin de 18 px sans ombre — « un coin de 18 px sans
ombre flotte au lieu de se poser », passation §2. Les deux sont pressables, donc
les deux étaient invisibles à la garde depuis qu'elle existe. Une ligne chacune.

C'est la troisième fois en deux jours qu'une garde partielle laisse passer
précisément ce qu'elle prétend surveiller : le rendu asynchrone qui ne cherchait
qu'en début de ligne, le pronom genré cherché par appariement d'apostrophes, et
maintenant les cartes cherchées sous une seule forme de style. La question à
poser à chaque garde reste la même : *quelles autres façons d'écrire la même
chose existe-t-il ?*

---

## 2026-08-20 — L'arbitrage montre une forme, pas une correspondance

**Ce qui doit se voir n'est pas la conversation absente, c'est sa forme.** Rendre
visible ce qui n'a pas été dit est le travail de cet écran — sinon l'arbitre
tranche sur la dernière tentative comme si les deux précédentes n'existaient
pas. Mais pas en affichant des notes libres l'une sous l'autre : cela ferait
juger un ton, et un arbitre qui lit deux paragraphes se met à arbitrer la
politesse.

Ce qui est lisible et décisif est la **répétition du motif**. La colonne écrit
« 3 · same » ou « 3 · mixed », un filtre sépare les deux files, et le dossier
nomme la forme en une phrase avant tout journal.

**Deux tentatives au moins, sinon ce n'est pas une répétition.** Un motif unique
n'est pas « le même motif répété » : écrire « 1 · same » ferait lire une
répétition là où il n'y a qu'un premier refus, et proposerait plus tard la
clôture sans faute avant qu'on ait pu se tromper deux fois.

**Et deux sur trois ne suffisent pas.** Deux fois la mention et une fois le lieu
est un mélange : la créatrice a corrigé quelque chose entre-temps. Le test qui
le tient est celui qui diverge — un décor recopié de la planche, trois fois le
même motif, ne distingue pas une implémentation qui compare les motifs d'une qui
répond toujours « same ».

**Un sélecteur ancré sur un libellé traduit se casse dès que le mot apparaît deux
fois.** Les motifs s'alignent désormais sans leur numéro, donc le même mot vit
dans la colonne et dans la pastille : trois tests cherchaient le texte et
trouvaient les deux. Les pastilles portent maintenant leur code en identifiant.

**La quatrième issue reste à construire, et elle touche le modèle** — consigné
dans `TASKS.md`, demandé à la session des routes. Rien n'est inventé côté client
en attendant : un statut que le serveur ne connaît pas ne se simule pas.


---

## 2026-08-20 — L'événement neutre que je demandais aurait coûté un palier

**Ma demande était fausse, et l'argument qui l'a réfutée mérite d'être gardé.**
Je réclamais un événement de fiabilité neutre pour accompagner « clore sans
faute », par symétrie avec `abusive_report`. La session des routes l'a refusé :
`evaluer` rend un score **nul** tant qu'aucun événement n'existe, et un nombre
dès qu'il y en a un. Un événement de poids nul ne bouge donc pas le score — il
le fait **exister**. Une créatrice dont ce serait le premier événement passerait
de « pas encore de score », que les paliers ignorent comme condition, à un score
de départ comparé à leur seuil : la clôture sans faute lui coûterait un palier,
c'est-à-dire exactement ce qu'elle existe pour éviter.

La symétrie avec `abusive_report` ne tenait pas parce que celui-ci n'arrive
jamais seul — un signalement écarté suppose un signalement, donc un historique.
Une clôture sans faute peut être le tout premier événement d'un compte.

**Aucun événement n'est donc écrit.** `fiabilite.composantes` en reste à neuf, et
la garde qui exige une phrase par code n'a rien à absorber.

**Et ma dérivation de « même motif » était subtilement fausse.** J'exigeais que
*tous* les motifs soient identiques ; le serveur compte la **suite** du dernier
contre `collaboration_max_attempts`. « Format, mention, mention, mention » les
fait diverger : les trois derniers refus portent bien sur la même chose, la
demande n'a jamais été comprise, et ma version répondait « mélangé » à cause du
premier. Le seuil vit en configuration par-dessus le marché — un écran qui
écrirait trois en dur mentirait au premier ajustement.

**La phrase compte la suite, la colonne compte les reproches.** La phrase affirme
une répétition : elle doit dire combien de fois **de suite**. La colonne dit
combien de fois on a refusé. Les deux nombres diffèrent sur le même dossier, et
les confondre écrirait un chiffre faux dans l'un des deux.

**Le champ absent se lit « pas de répétition », jamais l'inverse.**
Sous-proposer la clôture est le bon défaut : sur-proposer fermerait un dossier
où il fallait trancher.

---

## 2026-08-20 — Les paliers : ce qu'on peut réserver, avant comment le système marche

**L'écran s'ouvrait sur une règle.** `tiers.principe` — « plus le format engage,
plus il ouvre » — en bandeau d'encre, avec un diagramme de trois barres qui
montent. C'est une bonne phrase, et c'est le problème : posée en tête, elle fait
lire l'écran comme la description d'un mécanisme. La question qu'une créatrice
vient poser est « qu'est-ce que je peux réserver maintenant », et la réponse
était un chiffre au milieu d'un barreau, sous une légende « ce que j'obtiens ».

L'écran annonce désormais **ce qui est ouvert** en titre, et le principe descend
sous l'échelle : il explique ce qu'on vient de voir au lieu de le précéder. Même
renversement que l'annuaire du commerce le même jour, et pour la même raison —
on répond d'abord, on explique ensuite.

**Le titre nomme le palier le plus généreux, et ne somme rien.**
`offres_disponibles` compte les offres **de ce palier** : une même prestation
proposée à deux paliers y figure deux fois, et additionner les paliers ouverts
annoncerait un catalogue plus grand que le vrai. Le genre de nombre que personne
ne vérifie parce qu'il reste plausible. Un test l'interdit, et sa mutation —
la somme — tombe.

**Il se tait quand rien n'est ouvert.** « 0 prestations vous sont ouvertes » en
titre d'écran est un accueil que le produit ne fait pas ; l'échelle dit ce qui
manque, elle suffit.

## Ce que la vérification a démenti

**La matière est déjà celle d'Ambre.** L'écran a été porté en v1.0 : contour,
teinte et aplat montent, la couleur de rôle a disparu, aucun rayon ni aucune
couleur n'est écrit en dur. Il n'y avait pas d'ancien système à retirer.

**Et la porte vers les prestations existait déjà sur téléphone.** J'ai lu
`{large && porteOuverte}` sur la commande de bureau et conclu qu'elle manquait
ailleurs ; j'ai composé une seconde porte, et le test a trouvé deux nœuds au même
`testID`. Elle était plus bas dans la carte, en pleine largeur sous un filet —
deux emplacements pour un même geste, chacun dicté par la place disponible. Ma
correction est annulée, le commentaire du code dit maintenant que le bureau n'est
pas le seul cas, et le test de la porte reste comme garde de non-régression.

La bascule proche/total de la liste des prestations est en place elle aussi
(`VUES = ['proche', 'tout']`), et la cause commune est bien annoncée une fois en
tête et retirée de chaque barreau.

---

## 2026-08-20 — L'annuaire : le champ a changé de sens, la phrase suivait l'ancien

`paliers_ouverts` répondait « elle se qualifie quelque part ». Il répond
maintenant « elle peut réserver ce que **vous** avez ouvert » — c'est le manque
que l'écran signalait, et il est comblé côté serveur.

**La conséquence était dans la copie, et elle allait contre le produit.** Quand
la liste répondait sur tout BIND, une liste vide ne pouvait venir que de son
audience, et la phrase le disait sans rien reprocher à personne. Depuis que le
champ est scopé au salon, le vide a **deux** causes : son audience, ou des
paliers que ce salon n'a pas ouverts. « No tier open right now » désignait donc
la créatrice là où le lecteur pouvait être en cause — sur un écran où le produit
se donne précisément du mal à n'accuser personne.

La phrase énonce désormais ce qui est certain, du côté du salon : « nothing you
have opened, for now ». Et le titre de section reprend les mots de la planche —
« can book at your salon » — qui disent la portée au lieu de la laisser deviner.
Le levier, lui, est déjà en tête d'écran : « ouvrir le palier post porterait ce
chiffre à 103 ».

**Un défaut qu'aucune relecture n'aurait trouvé**, parce que le code et la
donnée sont restés justes : seul le rapport entre les deux avait changé. C'est
une session voisine qui l'a vu en lisant le commentaire.

**Et une arête de la garde des couleurs en dur, notée sur place.** Un numéro de
PR écrit `#213` est un hexadécimal à trois chiffres valide : la garde le refuse,
à raison — elle ne peut pas distinguer un renvoi d'une couleur. Les références
s'écrivent donc sans dièse dans les sources ; `DECISIONS.md` et `TASKS.md` ne
sont pas balayés et gardent la forme habituelle.

---

## 2026-08-20 — Règle de composition : on répond d'abord, on explique ensuite

Les deux écrans que personne n'a compris — l'annuaire du commerce et les paliers
du créateur — avaient le même défaut, et il s'est corrigé de la même façon le
même jour. Ce n'est pas une coïncidence, c'est une règle, et elle s'écrit ici
pour qu'on n'ait pas à la retrouver une troisième fois.

**Un écran ouvre par la réponse à la question qu'on vient poser. L'explication
du mécanisme vient après, et jamais avant.**

L'annuaire ouvrait sur une liste de créatrices. La question d'un salon n'est pas
« qui sont-elles » — à deux mille il n'en connaît aucune — mais « combien
peuvent réserver ce que j'ai ouvert ». Il ouvre maintenant sur ce compte.

Les paliers ouvraient sur le principe du système — « plus le format engage, plus
il ouvre » — en bandeau d'encre avec un diagramme. La question d'une créatrice
est « qu'est-ce que je peux réserver maintenant ». L'écran l'annonce désormais
en titre, et le principe est descendu sous l'échelle.

**Pourquoi l'erreur est si facile à commettre.** Les deux explications étaient
justes, bien écrites, et utiles — c'est ce qui les rendait indéboulonnables.
Une explication en tête d'écran ne se lit pas comme une aide : elle définit ce
dont l'écran parle. Un écran qui commence par décrire son mécanisme **est** un
écran sur le mécanisme, quelle que soit la qualité de ce qui suit.

**Le signe qui doit alerter** : quand un écran est incompris deux fois de suite,
regarder son premier bloc avant de retoucher le reste. Deux fois sur deux, la
réponse y était et personne ne l'avait vue parce qu'elle arrivait en second.

**Le corollaire, éprouvé le même jour :** ce qui n'est jamais mentionné en revue
n'est pas forcément absent — c'est souvent ce qui ne se voit pas. La galerie et
la carte de la fiche n'ont été citées par aucun testeur ; elles existaient, bien
placées, et **ne répondaient pas au doigt**.

---

## 2026-08-20 — La fiche : deux portes muettes sous une dispense trop large

Les testeurs n'ont mentionné ni la galerie ni la carte. Elles étaient pourtant
là — une pastille comptée sur la couverture, une ligne nommée entre l'identité
et les prestations, toutes deux placées où on les cherche. Ce qui leur manquait
est plus discret : **aucune des deux ne réagissait à l'appui.**

Une pastille posée sur une photo ressemble déjà à une étiquette ; sans retour à
l'appui, rien ne distingue le moment où on l'a pressée du moment où on a touché
l'image. C'est ce qui la fait lire comme une légende.

**La cause est une dispense posée sur un fichier.** La garde du retour au
toucher exemptait `FicheScreen` en entier, pour un voile de fermeture invisible
par construction. Elle couvrait donc aussi la porte de la galerie et la ligne de
la carte. Même chose sur `Visionneuses`, où elle couvrait le bouton de
fermeture et les vignettes de page — tandis que le fond qui l'avait motivée
n'existe plus.

Les dispenses nomment désormais **un élément**, pas un fichier, et un test
vérifie que chacune désigne un `testID` encore présent : une dispense qui ne
dispense plus rien continue de faire croire que la question a été tranchée.

**Et la garde elle-même comptait le mot plutôt que l'emploi.** `({ pressed }) =>`
contient « pressed » par sa seule déstructuration : un style qui reçoit l'état et
l'ignore la satisfaisait sans bouger d'un pixel. C'est exactement ce qui se
passait sur les vignettes de la visionneuse de carte, où l'opacité de l'appui
était écrasée deux lignes plus bas par celle du rang — les deux se multiplient
maintenant. La garde exige donc un emploi, et la forme non déstructurée
`(etat) => etat.pressed` reste admise.


---

## 2026-08-22 — La question tranchée en ne la tranchant pas

**Je demandais un nombre, la session des routes en a servi quatre, et elle a eu
raison.** Ma question était : les abonnements encore actifs comptent-ils dans la
médiane ? Sa réponse est qu'aucune des deux options ne va seule — une durée
terminée est un **fait**, une durée courue est un **minimum**, et prendre la
médiane d'un mélange rend un nombre dont personne ne peut dire ce qu'il mesure.
C'est la censure à droite, et le bon geste était de ne pas choisir.

L'écran affiche donc « 7 mois · sur 12 terminés ». Le second nombre empêche de
lire le premier comme un fait quand il sort de trois départs. Et quand les
abonnements en cours dépassent les terminés, la ligne le dit : la médiane parle
au nom d'une minorité, et le signaler vaut mieux que la corriger.

**Aucune médiane de médianes sur la ligne de total.** Additionner ou moyenner des
médianes ne rend pas la médiane de l'ensemble : la cellule reste vide.

**L'échelle des barres vient de la catégorie la plus fournie, pas du total**, qui
écraserait les quatre lignes d'un plan où une catégorie domine — et c'est
précisément ce plan-là qu'on vient lire. **Une catégorie à zéro garde sa ligne**,
parce que « ce plan n'a jamais séduit un salon d'ongles » est exactement ce que
l'écran existe pour montrer.

**Et `TASKS.md` a perdu trois entrées dans une résolution de conflit.** Vingt-sept
lignes effacées sans rien à la place. Elles ont fini par être livrées, donc rien
n'a manqué cette fois — mais ce fichier est le canal qui a livré quatre rondes de
champs en deux jours, et une demande effacée est une demande qui ne revient pas.
Un conflit sur ce fichier se résout en gardant les deux côtés.
## 2026-08-22 — Une PR fusionnée peut en annuler une autre, sans que rien ne rougisse

**#217 a supprimé 435 lignes de #215**, fusionnée quatre heures plus tôt : le
bilan de tournée, ses deux modules, son test et ses six chaînes de traduction.
C'était une PR sur la fiche et la galerie, et **la cause n'est pas une
résolution de conflit** — c'est ce que j'avais supposé, et c'était faux.
`git reset --soft origin/main` suivi de `git add -A` suffit : le reset déplace
HEAD sur le **nouveau** `origin/main` en gardant l'arbre de travail, lequel porte
encore l'état d'avant pour tout ce qu'on n'a pas touché ; `git add -A` enregistre
alors le retrait de tout ce qui a été fusionné entre-temps. Cela touche donc des
fichiers qu'on n'a jamais ouverts, et plus on livre vite plus la fenêtre est
large. La forme juste est
`git reset --soft "$(git merge-base HEAD origin/main)"`.

Et la vérification qui attrape les trois cas, à passer avant de pousser :
`git show --numstat HEAD | awk '$1==0 && $2>0 {print $3}'` — un fichier en pure
suppression dans une PR qui prétend ajouter est presque toujours un accident.

**La CI n'a rien dit, et ne pouvait rien dire.** Un test supprimé ne rougit pas —
il disparaît. Les 1175 tests restants passaient, et `main` était verte sur un
écran amputé. C'est la seconde perte de la journée après les vingt-sept lignes de
`TASKS.md` effacées par #212 ; celle-ci portait du code livré.

Ce qui la rend invisible est ce qui la rend dangereuse : rien dans le processus
ne distingue « ce fichier n'a jamais existé » de « ce fichier a été supprimé par
une résolution de conflit ». Le seul signal a été un `tsc` qui se plaignait d'un
module absent, deux jours après.

**Et l'état de la tournée n'est plus dérivé nulle part.** Deux dérivations
coexistaient — celle du premier lot et celle que j'avais ajoutée sans voir la
première, ce qui est le même défaut que la PR ci-dessus sous une autre forme.
Le serveur sert `etat`, les deux sont retirées, et une garde vérifie que l'écran
ne lit plus aucune des quatre dates pour décider d'un état. Elle vise les champs
et non le nom de la fonction : une dérivation réécrite sous un autre nom
passerait une garde qui ne chercherait que `etatDeLaFiche`.

---

## 2026-08-22 — Une mise au propre qui effaçait le travail des autres

**Trois PR ont supprimé du travail qu'elles ne touchaient pas.** #212 a effacé
vingt-six lignes de `TASKS.md` — dont deux demandes de champs en attente à
l'API. #217 a fait pire : trente et une lignes de plus, six clés de traduction
par langue, et **trois fichiers source** — la tournée d'une session voisine,
livrée deux heures plus tôt.

**Rien ne l'a signalé.** La suite était verte : les tests partaient avec le code
qu'ils éprouvaient. Aucun type n'a manqué, aucun écran ne s'est cassé. Une
suppression complète et cohérente ne casse rien, et c'est ce qui la rend
invisible. C'est une session voisine qui a vu ses lignes de `TASKS.md` manquer.

**La cause est une commande.** La mise au propre avant PR faisait :

```
git checkout -B branche origin/main     # à T1
… travail …
git reset --soft origin/main            # à T2
git add -A && git commit
```

`git reset --soft` déplace HEAD sur le **nouveau** `origin/main` en gardant
l'arbre de travail — lequel porte encore l'état T1 des fichiers non touchés.
`git add -A` enregistre alors **le retrait de tout ce qui a été fusionné entre
T1 et T2**. Plus les sessions voisines livrent vite, plus la fenêtre est large.

La correction : on se remet à la **base de fusion**, pas à la tête qui bouge.

```
git reset --soft "$(git merge-base HEAD origin/main)"
```

**Et la vérification a dû être corrigée en s'en servant.** La première version
comparait le commit à son parent :

```
git show --numstat HEAD | awk '$1==0 && $2>0 {print $3}'
```

Elle rend « rien à signaler » sur une branche dont la base a vieilli, puisque le
parent est l'ancien `main`. Elle a laissé passer, dans la PR même qui corrigeait
le défaut, la suppression de l'écran des plans. Ce qu'il faut comparer est
`main` **d'aujourd'hui** :

```
git fetch -q origin
git diff --numstat origin/main HEAD | awk '$1==0 && $2>0 {print "  perdu :", $3}'
```

Une garde éprouvée sur le cas qu'on avait en tête et non sur ceux qu'elle doit
attraper : c'est le troisième exemplaire cette semaine, et celui-ci était le
mien.

**`TASKS.md` est une liste, pas un état** — la règle est de la session voisine et
elle vaut d'être reprise. Deux sessions y ajoutent des lignes différentes et
aucune n'a de raison d'écraser l'autre ; un conflit s'y résout en gardant les
deux côtés, et `--ours` comme `--theirs` y sont presque toujours le mauvais
geste. C'est le canal qui a livré quatre rondes de champs en deux jours.

**Ce qui est remis ici, et ce qui ne l'est pas.** La tournée est restaurée par
son autrice en #221, **sans sa dérivation d'état** : le serveur sert `etat`
depuis #218, et un second calcul côté client divergerait — restaurer verbatim
aurait réintroduit le défaut avec le code. La plupart des entrées de `TASKS.md`
ont été réécrites entre-temps ; seules deux demandes n'existaient plus nulle
part, et elles reviennent ici.

**Un défaut trouvé en restaurant.** La garde des pronoms genrés ne mordait pas
sur « himself » : `\bhim\b` s'arrête à une frontière de mot que les lettres
suivantes suppriment. La forme réfléchie était la quatrième façon d'écrire la
même faute.

---

## 2026-08-22 — La garde qui manquait : nommer ce qu'une PR retire sans le dire

Trois PR ont supprimé du travail qu'elles ne touchaient pas, et **rien ne l'a
signalé** — la suite était verte parce que les tests étaient partis avec le code
qu'ils éprouvaient. Une suppression complète et cohérente ne casse rien, et
c'est ce qui la rend invisible.

`scripts/suppressions.sh` nomme désormais tout fichier dont une branche retire
des lignes sans en ajouter. **Il nomme, il n'interdit pas** : une suppression
délibérée est un geste normal, ce qui manquait n'était pas une interdiction mais
un endroit où la voir. Le pas de CI annote la PR — l'annotation se lit sur
l'onglet des fichiers, là où le relecteur est déjà, plutôt que dans un journal
que personne n'ouvre — et sort toujours à zéro.

**La comparaison se fait à trois points depuis la cible, jamais sur le parent du
commit.** Le parent peut être n'importe quel point de l'histoire ; c'est même la
cause du défaut d'origine. La forme `main...HEAD` demande « qu'est-ce que cette
branche change », qui est la question du relecteur — et elle évite le faux
positif de la comparaison à deux points, qui accuse toute branche en retard de
supprimer ce que `main` a gagné depuis.

## Ce que la garde a coûté à écrire, et pourquoi c'était le plus instructif

**Le premier décor était deux PR réelles**, la coupable et la saine. Il semblait
idéal — de vraies données, une divergence des deux côtés. Il ne prouvait rien
contre deux sabotages sur quatre : remplacer la base de fusion par le parent, et
retirer le suivi des renommages. La raison est que ces témoins sont des commits
de **squash**, dont le parent *est* la cible. Une branche à un seul commit ne
distingue pas les deux comparaisons.

Le décor est donc un dépôt fabriqué, qui monte les trois cas où une
implémentation fautive **diverge** de la bonne : une suppression dans le premier
commit d'une branche à deux — le parent de la tête ne la voit pas ; un
renommage pur ; un fichier réécrit, qui ne doit jamais être nommé.

**Et l'épreuve éprouvait un double.** Elle réécrivait la commande `git diff` à
l'identique au lieu d'appeler la fonction : elle passait donc au vert quand on
sabotait celle-ci. Une épreuve qui éprouve une copie de ce qu'elle surveille ne
surveille rien — c'est la même faute que les deux dérivations d'un même état
trouvées le même jour, sous une autre forme.

**Le suivi des renommages n'était pas éprouvable non plus** : git le fait par
défaut depuis 2.9, donc le retirer ne changeait rien. Le décor le désactive
localement, ce qui est le seul cas où le drapeau porte quelque chose — et ce
cas existe, un runner n'ayant pas forcément la configuration qu'on croit.

Cinq mutations, cinq chutes, après trois décors successifs. Aucune n'aurait été
trouvée par relecture.


---

## 2026-08-22 — Le point tombe, et c'est un choix de marque

**Direction A, parce que la signature sert ailleurs.** Entre A et B, l'écart
n'était pas de qualité mais d'ambition : A veut dire quelque chose, B veut
disparaître, et sur un écran vu trois fois par jour disparaître est une ambition
suffisante. Le cas qui fait pencher pour A est celui-ci : le point orange sert au
favicon, à l'icône et aux visuels de l'agence — le voir arriver en dernier, mille
fois, l'installe mieux que n'importe quelle note de passation.

**L'alignement est structurel, et c'est ce qui rend la direction tenable.** Les
deux `Marque` superposées partagent la `viewBox` et le repère du fichier : elles
retombent l'une sur l'autre sans qu'aucune constante ne l'organise, à n'importe
quelle taille. Une position du point mesurée en points d'écran aurait dérivé au
premier changement d'échelle, et personne ne l'aurait vu avant une capture.

**La chute s'exprime en hauteurs de logotype**, pas en pixels : à une autre
taille le point tombe d'aussi loin *relativement*, et la chute garde son poids.

**Aucun rebond, et c'est la seule contrainte d'assouplissement.** Un ressort
dépasse sa cible : le point remonterait, et un point qui remonte est un
personnage. `Easing.out(Easing.cubic)` s'arrête sur sa valeur.

**Le plafond est un plafond, pas une cible.** Si l'application est prête à trois
cents millisecondes, l'écran part à trois cents : une animation qui retient la
main pour finir sa phrase vole du temps.

**Et l'attente ne ressemble pas à la marque.** C'est toute la raison du filet :
si l'attente se dessinait dans le vocabulaire de l'entrée, on ne distinguerait
plus « ça s'ouvre » de « ça bloque ». Il n'apparaît qu'au-delà du plafond —
le montrer d'emblée ferait de chaque ouverture une attente — et sous mouvement
réduit il ne parcourt pas : ce qui compte est que l'état soit marqué, pas qu'il
bouge.

**`Fond` est supprimé avec son indicateur.** Une vue qui survit sans appelant
finit par resservir en portant une composition périmée.
## 2026-08-22 — L'abonnement, et le refus qui menait nulle part

**Le produit vendait quelque chose qu'on ne pouvait pas acheter.** L'annuaire
interceptait proprement le 402, expliquait qu'un abonnement manque, et
s'arrêtait là. Les quatre routes existaient, le client savait les appeler, et
trois de ses méthodes n'avaient aucun appelant — la garde les portait, nommées,
depuis des semaines.

**Un statut inconnu ne s'invente ni dans un sens ni dans l'autre.** Stripe ajoute
des statuts. Le traiter comme actif ouvrirait l'annuaire à qui ne paie pas ; le
traiter comme résilié fermerait la porte à qui paie. « Le paiement n'est pas
terminé » n'affirme aucun accès et propose de rouvrir l'adresse : c'est le seul
repli qui ne ment dans aucune des deux directions.

**L'adresse de paiement ne se rouvre pas sur un abonnement en cours**, même
quand le serveur la sert encore : rouvrir une page de paiement à quelqu'un qui
paie déjà lui ferait craindre un second prélèvement.

**Et un paiement inachevé se reprend, il ne se recommence pas.** Souscrire de
nouveau créerait un second abonnement à côté du premier.

**`resilier` était la moitié manquante d'une paire.** Souscrire sans pouvoir
arrêter enferme, et c'est la moitié qui rassure au moment de commencer. La route
existait ; seul le client ne la couvrait pas.

**La garde de lecture seule de l'annuaire a été affinée, pas exemptée.** Elle
interdit d'agir sur une créatrice ; le bouton qui mène à l'abonnement vit dans la
branche du refus, qui rend zéro créatrice par construction. Une garde exemptée ne
garde plus rien — c'est le geste que la session voisine avait employé sur les
`onPress`, et il vaut ici.
---

## 2026-08-22 — La grille de l'annuaire, sur le contrat commerce-scopé

Le contrat livré apporte `peut_reserver_ici`, `palier_accessible`,
`distance_metres`, le tri et la pagination. La grille se compose dessus, et ce
qu'elle **ne fait pas** compte autant que ce qu'elle fait.

**Le tri ne se rejoue pas.** Une liste paginée triée dans le client se réordonne
à chaque page, puisque chaque page n'a que ses propres lignes à comparer : une
créatrice s'y retrouve deux fois ou jamais. L'ordre se dit en revanche — « trié
par accès, puis par proximité » — parce qu'une grille triée sans l'annoncer se
lit comme un ordre arbitraire, et le premier réflexe est de chercher un moyen de
la trier, qui n'existe pas.

**Un seul badge, et c'est le palier accessible ici.** L'écran listait les formats
qu'elle ouvre — plusieurs badges pour dire une chose — alors que le serveur rend
le meilleur palier **chez ce salon**. La liste répondait « elle se qualifie
quelque part », dont un salon ne peut rien faire.

**Le contour d'encre marque celles qui peuvent réserver ici.** Même grammaire
qu'aux réservations : l'encre marque ce qui engage. Les autres gardent le filet
clair — présentes, pas mises en avant. Les effacer reviendrait à cacher la
moitié du marché que l'abonnement fait voir.

**Une distance nulle se tait.** Elle veut dire « on ne sait pas », jamais
« loin » ; un tiret se lirait comme une absence de proximité, le contraire de ce
que le serveur dit en la laissant nulle.

**« 20 sur 128 », parce qu'une page pleine ne dit pas s'il en reste.** Sans le
total, une grille qui s'arrête se lit comme la fin de l'annuaire.

**Les filtres de la planche ne sont pas posés.** « Can book here », « all
tiers », « any network », « 15 km » supposent un filtrage serveur qui n'existe
pas ; les poser côté client filtrerait une page et non la liste, ce qui est la
même faute que rejouer le tri. Inscrit dans `TASKS.md`.

`formatDistance` entre dans `format.ts` plutôt que dans l'écran : le fil et les
prestations affichent la même grandeur, et deux écritures de « 1,4 km »
finiraient par diverger sur le séparateur décimal — que l'espagnol met en
virgule, où un « 1.4 km » se lit comme quatorze.

## Trois gardes ont trouvé ce que je n'avais pas vu

**La ville avait disparu de la carte.** La garde des champs servis l'a dit : un
champ que le serveur rend et que l'écran cesse de lire est un défaut, pas une
simplification. La planche la pose à côté de la distance — « Wynwood · 320 m »
situe, la distance seule ne dit pas de quel côté.

**Ma carte n'avait pas d'ombre**, et la planche non plus — mais le produit ne
dessine nulle part ailleurs un coin de 18 px à plat, et une grille qui flotte au
milieu d'écrans qui se posent se remarque plus que la fidélité.

**Et un commentaire de quatre lignes a fait sortir la carte de l'inventaire.**
La garde lit un bloc de style sur neuf cents caractères ; la prose à l'intérieur
a suffi à dépasser la fenêtre, et l'inventaire a cessé de voir la carte — sans
erreur, sans avertissement. Le trou était documenté dans `TASKS.md` ; il vient
de coûter quelque chose pour la première fois. Les commentaires de style se
posent désormais au-dessus du nœud.

**Le garde-fou de lecture seule a dû être affiné, pas excepté.** La pagination
porte un rôle de bouton, et c'est juste : c'est un contrôle. Ce que la règle
interdit est d'agir sur une créatrice — inviter, contacter, écrire. Le contrôle
est donc retiré du texte examiné **par son nom**, et la garde vérifie en plus
qu'il appelle bien une lecture : sans quoi le retrait ouvrirait un trou où
n'importe quoi passerait sous ce nom.

---

## 2026-08-22 — L'inventaire des cartes lit un bloc entier, plus une fenêtre

**La fenêtre a fini par coûter quelque chose.** La garde découpait un bloc de
style sur neuf cents caractères — d'abord six cents, relevé une fois quand deux
cartes en étaient sorties. Le compte n'était pas le mauvais réglage : c'est le
principe qui était faux. Un bloc de style porte des commentaires, des ternaires
et des valeurs conditionnelles, et sa longueur n'est bornée par rien. Quatre
lignes de prose dans le style d'une carte de l'annuaire ont suffi à la faire
disparaître de l'inventaire, **sans erreur et sans avertissement**.

Le découpage suit désormais l'imbrication des accolades, comme celui des balises
`Pressable` du garde-fou du retour au toucher, et n'a plus de longueur maximale.
Les deux formes se traitent d'un coup, puisque `style={{ … }}` et
`style={({ pressed }) => ({ … })}` referment toutes deux l'accolade ouverte
juste après `style=`.

**La fenêtre avait aussi des faux positifs, et personne ne les soupçonnait.**
Elle coupait certains blocs à un `}}` qui n'était pas le leur, produisant un
fragment qui portait les trois marques par hasard : `ConfigurationScreen` et
`RedemptionScreen` figuraient à l'inventaire pour des cartes qu'ils n'ont pas.
Une borne qui tronque ne fait pas que manquer des cas, elle en invente.

**Et ma première correction avait la faute de la veille.** Le parcours traversait
les chaînes sans traverser les commentaires : une apostrophe française — « le
style fonction, parce **qu'elle** se presse » — le faisait entrer en mode chaîne
et avalait tout le bloc. C'est exactement ce qui était arrivé à la garde des
pronoms genrés, qui appariait les apostrophes du source et se désynchronisait
sur les mêmes commentaires. **Deux gardes, deux jours, la même apostrophe.** Un
commentaire se saute donc avant qu'on regarde ses guillemets.

**Le décor a dû être refait trois fois pour que la mutation tombe.** Une
accolade littérale placée après les trois marques ne prouve rien : la troncature
les laisse toutes dans le fragment, la carte reste vue, et le sabotage survit.
Une seule accolade fermante ne prouve rien non plus — à l'intérieur de
`style={{` la profondeur vaut deux, et une fermante la ramène à un sans rien
couper. Il faut une chaîne qui referme **jusqu'à zéro**, placée **entre** deux
marques. Cinq mutations, cinq chutes.

**Trois trous distincts dans une seule garde** : ce qu'elle lit — les formes de
style, comblé —, jusqu'où elle lit — la fenêtre, comblée ici —, et ce qu'elle
cherche — la définition d'une carte, qui laisse encore échapper les surfaces
sans filet. Élargir l'un n'élargit pas les autres, et les confondre a déjà fait
croire une fois que la question était réglée.

---

## 2026-08-22 — Une carte est une surface de 18 points, avec ou sans filet

Le troisième trou de l'inventaire : sa définition exigeait **trois** marques —
rayon, fond, filet — et le filet laissait passer tout ce qui est plein. Or une
surface pleine est une carte tout autant qu'une surface cerclée ; c'est même la
plus visible des deux, puisque rien d'autre que son ombre ne la détache du fond.

**Le filet avait été exigé pour une raison, et elle avait une meilleure
réponse.** Une carte qui clippe s'écrit en deux nœuds — l'extérieur porte
l'ombre, l'intérieur découpe, parce que sur iOS une vue qui clippe coupe sa
propre ombre. Sans discriminant, les deux satisfaisaient une définition élargie
et une carte comptait pour deux : le comptage d'égalité devenait faux, et
l'élargissement a été reculé **deux fois** pour ça, par deux sessions
différentes.

La bonne question n'était pas « lequel des deux nœuds est le parent » — ce
qu'une expression régulière ne sait pas — mais **« lequel des deux porte
l'ombre »**. La moitié intérieure est celle qui clippe **sans** porter
d'élévation : la sienne vit sur son enveloppe, et elle n'a pas à en réclamer
une. Un nœud unique qui clippe *et* porte son ombre reste une carte, ce qui est
le cas courant hors iOS.

## Ce que l'élargissement a trouvé

**Le panneau reconnu de la caisse n'avait pas d'ombre.** C'est ce que le
comptoir lit avant de servir — la réservation reconnue, et le geste qui la
clôt — et il flottait sur la page. Il était invisible à l'inventaire parce
qu'une surface pleine n'a pas de filet.

**Et `KeyHint` portait un rayon de carte.** Une pastille de touche, cinq points
de côté sur quatorze de haut, avec `radius.lg`. À cette taille les deux rayons
se ressemblent à l'œil — c'est pourquoi le mauvais a survécu — mais les jetons
réservent `sm` aux chips et aux pastilles, et l'inventaire le comptait comme une
surface devant porter une ombre. Le jeton corrigé, il sort de lui-même : la
garde n'a pas eu besoin d'une exception pour lui.

**Les deux portes de l'accueil entrent à l'inventaire.** Ce sont les cartes les
plus visibles du produit, et elles n'y figuraient pas.

## Les trois trous, et pourquoi il fallait les tenir séparés

Ce qu'elle **lit** — les formes de style, comblé en #208. **Jusqu'où** elle lit
— la fenêtre de neuf cents caractères, comblée en #233. Ce qu'elle **cherche** —
la définition d'une carte, comblé ici.

Les trois se ressemblent assez pour qu'on les confonde, et la confusion a déjà
coûté : un élargissement de ce qu'on **lit** a été pris pour un élargissement de
ce qu'on **cherche**, ce qui a fait croire une fois que la question était réglée.
Élargir l'un n'élargit pas les autres.

---

## 2026-08-22 — Ce qu'une réservation raconte décide de ce qui se corrige

**La règle n'est pas « quels champs sont techniques ».** Douze réservations
passées citent une prestation de quarante-cinq minutes : la passer à
soixante-quinze ferait lire, dans l'historique de quelqu'un, avoir reçu une
prestation qu'il n'a pas reçue. La photo, l'orthographe et la description ne
racontent rien de ce qui s'est passé — les corriger ne touche à aucune
réservation.

**Le refus se lit sur son code, jamais sur son message.** Un refus de suppression
n'est pas une panne : c'est la règle du produit qui répond, et elle appelle un
autre geste. Le lire au message le rendrait dépendant de la langue, et traiter
toute panne comme un refus proposerait de fermer une prestation sur une coupure
de réseau.

**L'écran ne devine pas à la place du serveur.** Il aurait pu compter les
réservations pour savoir si la suppression est permise — il propose, et lit le
refus comme la réponse qu'il est. Deviner demanderait un compte que rien ne sert,
et se tromperait au premier écart.

**Et fermer n'est pas archiver**, ce que l'écran ne prétend pas. Les deux valent
le même drapeau aujourd'hui ; sortir de la liste de travail une prestation
saisonnière que le gérant compte rouvrir serait pire que d'y laisser une archive.
Le manque est demandé plutôt que contourné.
## 2026-08-22 — Révoquer ne suffisait pas

**Le geste s'annulait tout seul.** `revoquerUnTerminal` coupe le jeton côté
serveur ; le crochet le réenregistre à chaque session connectée. Un interrupteur
qui ne survit pas au lancement suivant est un bouton qui ment, et c'est ce qu'on
aurait livré en branchant la méthode telle quelle. Le refus est donc gardé sur
l'appareil et relu **avant** tout enregistrement.

**Le serveur d'abord, la mémoire ensuite.** Si la révocation échoue, noter le
refus ferait croire que c'est coupé alors que le serveur continue d'envoyer.

**Et « refusé ici » n'est pas « refusé par le système ».** Les deux se lèvent à
des endroits différents — les réglages de l'application, ceux du téléphone — et
les confondre enverrait quelqu'un chercher au mauvais endroit.

**Ce que l'écran ne fait pas est écrit sur l'écran.** Couper les notifications
d'un téléphone perdu depuis un autre appareil demande de les énumérer, et aucune
route ne liste les terminaux : révoquer exige de posséder le jeton, qu'on n'a que
sur le téléphone lui-même. La capacité n'était donc pas complète côté serveur,
contrairement à ce qu'on pouvait croire en voyant la méthode sans appelant.
Quelqu'un qui vient de perdre son téléphone est la dernière personne à qui l'on
doit une demi-vérité.

**Et la garde du thème a été affinée, pas exemptée.** Elle cherchait `switch`
tout court : elle attrapait les notifications au même titre qu'un réglage de
couleurs, alors que l'un commande quelque chose et l'autre ne commandait rien.
Elle vise maintenant le libellé.

---

## 2026-08-22 — L'annulation créateur : le diagramme tranche, pas l'horloge

**L'écran ne recopie pas la fenêtre d'annulation libre, il lit la machine
d'états.** La tentation était de comparer `starts_at` au réglage pour savoir si
l'annulation coûte. Deux raisons de ne pas le faire, et la seconde est la
bonne : `booking_free_cancellation_seconds` est un réglage, et le dépôt
interdit d'écrire un délai en dur ; mais surtout, **le délai n'est pas ce qui
décide**. `no_show` n'est atteignable que depuis `confirmed` — c'est une
propriété du diagramme, vraie quelle que soit la valeur du réglage. Une place
seulement tenue, ou une réservation que le salon n'a pas encore acceptée, ne
peut pas mener à une pénalité même à une minute du rendez-vous.

L'implémentation intuitive — « il y a un créneau et il approche, donc ça peut
coûter » — est plausible et fausse, et c'est elle que le premier test écarte.

**Ce que l'écran ne peut toujours pas dire est *quand*.** Sur une confirmée avec
créneau, la pénalité dépend bien du seuil, et le seuil n'est pas servi. La
phrase porte donc la conséquence sans l'heure. C'est moins utile que « libre
jusqu'à 14 h 30 » et c'est ce qu'on sait ; `annulation_sans_frais_jusqu_a` est
demandé, sur le modèle d'`absence_signalable_a`.

**Deux appuis, et la conséquence entre les deux.** `cancelled` est terminal et
la liste se parcourt au pouce : un bouton unique annulerait un rendez-vous par
frôlement. La phrase est écrite pendant qu'on peut encore renoncer — l'apprendre
par une pastille rouge le lendemain serait avoir tendu un piège.

**Un défaut trouvé en chemin, prouvé et non déduit.** `annuler` vise `no_show`
sans regarder son état de départ : depuis `awaiting_business` la transition est
refusée, et avec les valeurs par défaut toute réservation en attente d'accord à
moins de 24 h du rendez-vous ne s'annule pas du tout. Les deux tests existants
confirmaient d'abord, donc aucun n'exerçait cet état — la forme la plus
courante cachait la seule qui casse. Marqué `xfail(strict=True)` : la CI rougira
le jour de la correction si le marqueur reste.

---

## 2026-08-22 — Le catalogue : archiver, et le bouton qui nomme son écart

**`archived_at` distinct de `is_available`, et l'écran en dépend.** Les deux
valaient le même drapeau : sortir les archives de la liste de travail sortait
aussi les prestations saisonnières qu'un salon compte rouvrir en septembre.
La distinction vient du serveur (#238), l'écran ne la reconstruit pas.

**Il n'y a jamais les deux gestes.** À zéro réservation la suppression est
vraie ; au-delà, elle n'existe pas et le bouton dit « archiver, douze
réservations citent cette prestation ». Offrir une suppression pour la voir
refusée apprend à un gérant que l'écran propose des actions qui échouent — et
le nombre est ce qui distingue un bouton qu'on presse par habitude d'un bouton
qu'on presse en sachant ce qu'on déplace.

Le refus par code reste lu. Il ne devrait plus survenir, puisque le compte
décide avant ; il tient la porte si les deux divergent, et c'est justement
quand ils divergent qu'on veut une phrase plutôt qu'une erreur nue.

**`reservations_count` est lu faux, jamais comparé à zéro.** Sixième fois sur
ce projet qu'un champ neuf arrive : les réponses en vol et les décors écrits
avant lui ne le portent pas. `!== 0` sur `undefined` proposerait d'archiver une
prestation vierge. La mutation le dit sans détour.

**Remplacer est le même formulaire que composer, parce que c'est le même
geste.** Changer une durée *est* composer une autre prestation. Un seul appel à
`/replace` : en deux temps, une panne entre les deux laisserait le catalogue
avec les deux prestations, ou avec aucune.

**Le palier ne suit pas la remplaçante**, et la raison est plus forte que le
doublon : recopier l'offre poserait **un accord que personne n'a conclu**. Une
créatrice a accepté un palier sur une prestation de quarante-cinq minutes ;
l'offre recopiée la ferait consentir à soixante-quinze. C'est le principe de
`value_cents_snapshot`, appliqué à l'accord au lieu du prix.

---

## 2026-08-22 — Le gérant de deux salons n'a plus à s'inventer un second compte

`rattacherLaFiche` — `POST /handover/{jeton}/attach` — existait depuis le début
et n'avait aucun appelant. Ce n'était pas une capacité à écrire, **c'était un
écran à brancher**.

**Le cas est celui du propriétaire de deux adresses**, nommé dans le docstring de
la route : « lui refuser le lien parce que son adresse électronique est connue
l'obligerait à s'en inventer une seconde ». Or la branche du jeton se rend
**avant** la porte d'authentification, quelle que soit la session : un gérant
déjà connecté qui ouvrait le lien de son second salon recevait le formulaire de
création de compte. Le produit lui demandait exactement ce que la route existait
pour lui éviter.

**Trois cas, et ils s'excluent.** Session de commerce : la fiche préparée, puis
le rattachement. Anonyme : le formulaire d'origine, inchangé. Un autre rôle : le
message qui dit que le lien est fait pour un salon, **et rien d'autre** — la
première version montrait le message *au-dessus* du formulaire de création, ce
qui laissait croire qu'on pouvait passer outre.

**Le compte est nommé.** « Rattacher à mon compte » sans dire lequel demande de
deviner, et c'est précisément la situation de quelqu'un qui en a deux.

**Les conditions restent exigées**, et la version envoyée est celle que l'écran a
montrée — pas celle en vigueur au moment de l'envoi. Un lien ouvert la semaine
dernière montre les conditions de la semaine dernière, et le serveur refuse
l'écart.

**Un rôle qui ne convient pas le lit plutôt que de découvrir un 403.** Le serveur
refuse tout ce qui n'est pas un membre de commerce ; offrir le bouton quand même
ferait découvrir le refus après le geste.

## Ce que ce lot laisse ouvert

**Un gérant qui rattache un second salon ne peut pas encore l'ouvrir.**
`useMonCommerce` prend `mesCommerces[0]` et la coquille n'offre aucun sélecteur :
le second salon existe, il est réservable par les créatrices, mais son gérant
verra toujours le premier. Rien ne se casse — c'est incomplet, pas faux — et
c'est vraisemblablement pourquoi cette route n'avait jamais eu d'écran. Le
sélecteur de salon est le lot suivant naturel, et il est inscrit dans `TASKS.md`.

**La garde des méthodes sans appelant a fait son travail dans les deux sens.**
Elle avait signalé `rattacherLaFiche` comme capacité sans écran ; elle a fait
tomber la suite dès que l'appelant est arrivé, parce que sa ligne d'exception
était devenue fausse. Une table qui ne tient que dans un sens finit par décrire
un état ancien.
## 2026-08-22 — La reprise de compte : ce n'est pas la trace qui retient

**Un journal enregistre un abus, il ne l'empêche pas.** Design répond à la
question « qu'est-ce qui retient un administrateur » par trois mécanismes, dont
aucun n'est un contrôle d'accès : le motif transmis au salon **mot pour mot**,
le compte des reprises de celui qui les demande, et l'adjectif « spontanée »
écrit pour toujours dans la liste que le gérant relit.

**Un seul des trois est livrable aujourd'hui**, et c'est le premier. Le motif
existe et se transmet ; l'écran le cite entre guillemets, intact. Le résumer ou
le catégoriser aurait retiré précisément ce qui retient — quelqu'un qui sait que
le gérant lira sa phrase exacte l'écrit autrement. Ce n'est pas un champ de
journal, c'est une lettre.

**L'écran d'administration n'est pas livré, et c'est la décision.** Sans portée,
« accès complet » est le seul mode possible : livrer le formulaire aujourd'hui
donnerait un bouton de reprise sans aucun des trois freins, ce qui est pire que
son absence. Design le dit sans détour — « sans portée, l'écran perd son
mécanisme principal ». La portée, le compte par administrateur et la distinction
« spontanée » sont demandés.

**« End it » n'est pas dessiné.** La planche pose ce bouton sur le bandeau du
salon — « l'accès s'ouvre sans permission et se ferme sans discussion » — et la
fermeture est aujourd'hui une route d'administration. Un bouton qui ne coupe
rien, sur cet écran-là, serait pire que son absence.

**Le bandeau se pose hors des quatre états de `Ecran`.** Une journée sans
rendez-vous rend l'état vide, qui ne rend pas ses enfants — et c'est
précisément le jour où une reprise est la plus probable : on entre dans un
compte pour débloquer une configuration, pas un jour chargé. Le laisser dans le
corps l'aurait éteint le seul jour qui compte.

**`repriseEnCours` vérifie `Array.isArray` bien que le type l'affirme.** Le type
est une déclaration sur le serveur, pas une garantie sur ce qui arrive. Ce
bandeau vit sur l'écran le plus ouvert du produit : le faire tomber pour une
réponse malformée coûterait la journée entière au salon, là où se taire ne coûte
qu'un bandeau. Trois décors de test rendaient d'ailleurs le même objet à toutes
les routes — un montage qui ne prouve rien, et qu'il a fallu un second appel
pour révéler.

---

## 2026-08-22 — L'annulation : la formulation est le mécanisme

**Passé la fenêtre, l'écran ne parle plus du score.** L'asymétrie était dans la
règle depuis le début et l'écran ne la voyait pas : au-delà du seuil, annuler et
ne pas venir coûtent la même chose — une absence dans les deux cas. Le score ne
peut donc rien départager, et le mentionner ne fait qu'une chose, donner à
croire qu'on peut encore l'éviter.

Ce qui diffère est ailleurs, et c'est tout ce que l'écran a à dire : **la place
repart, et le salon sait**. Un salon prévenu à 11 h peut remplir 14 h 30 ; un
salon qui l'apprend à 14 h 45 a perdu son créneau et son après-midi.

La version précédente écrivait « votre score de fiabilité baisse ». Les deux
phrases décrivent exactement les mêmes conséquences ; la première fait renoncer,
la seconde fait annuler.

**Le coût ne se chiffre jamais.** « Tu perdras huit points » transforme une
décision en calcul, et un calcul se reporte à demain. Le seul nombre de cet
écran est le délai avant le créneau, et il n'est pas le coût : il dit ce que
prévenir donne au salon.

Rendu comme un fait, pas comme une promesse. « Trois heures leur suffisent pour
la remplir » est vrai à trois heures et faux à cinq minutes ; « ça leur laisse
trois heures » est vrai aux deux, et le nombre porte l'argument tout seul. Le
seuil qui aurait départagé les deux formulations n'existe pas — et l'écrire en
dur aurait été un délai de plus dans le code.

**Le bouton ne bouge pas, à aucune heure.** Pas de bouton grisé, pas de bouton
déplacé, pas de confirmation supplémentaire près de l'heure. Rendre
l'annulation difficile ne produit pas des présences, ça produit des absences
silencieuses — et une absence silencieuse coûte au salon *et* à la créatrice.

**La fenêtre se nomme par une heure, jamais par une durée.** « Jusqu'à 11:00 »
se vérifie d'un coup d'œil ; « 24 h avant » demande un calcul.
`annulation_sans_frais_jusqu_a` est calculé serveur, et l'écran ne le
recalcule pas : le seuil est un réglage, et un écran qui le déduirait d'une
horloge locale fausse annoncerait « gratuit » sur une annulation qui coûte.
C'est la deuxième mutation.

**Deux sources qui ne se contredisent pas.** Le diagramme dit *si* une
annulation peut coûter — `no_show` n'est atteignable que depuis `confirmed`.
L'instant servi dit *quand*. Quand l'instant manque sur une réservation qui peut
coûter, l'écran dit ce qu'il sait sans inventer d'heure, plutôt que de se
rabattre sur « libre ».

**La garde lit les mots.** C'est inhabituel et c'est nécessaire : une
implémentation qui rend la bonne feuille avec la mauvaise phrase passe tous les
tests de structure — bouton présent, route correcte, feuille ouverte. C'est
exactement l'écran que cette planche remplace.
## 2026-08-22 — Le salon qu'on regarde vit dans un contexte, pas dans quatre requêtes

Le rattachement d'une fiche a rendu le cas réel : un gérant peut avoir deux
salons, le second est réservable par les créatrices, et la coquille prenait
`mesCommerces[0]` sans offrir de choix.

**La difficulté n'était pas le contrôle, c'était la source.** `useMonCommerce`
est appelé par quatre endroits — la navigation, la pause du commerce, la reprise
du compte — et chacun montait **sa propre requête**. Tant que la règle était « le
premier de la liste », les quatre tombaient d'accord par hasard. Dès qu'un choix
existe, quatre copies indépendantes divergent : la barre latérale afficherait un
salon pendant qu'un autre écran en met un second en pause. Le fournisseur porte
donc la liste **et** le choix, une fois pour toute la coquille, et le hook lève
hors de lui — retomber sur une requête locale recréerait la seconde source de
vérité qu'il existe pour empêcher.

C'est le genre de divergence qui ne se voit pas en développement, où l'on n'a
qu'un salon : elle n'apparaît que chez le seul utilisateur concerné.

**Un identifiant retenu ne fait jamais autorité.** Il est confronté à la liste
d'appartenance à chaque montage ; un salon qu'on a quitté ou dont l'accès a été
révoqué ne reste pas choisi, et l'on retombe sur le premier — le comportement
d'avant le sélecteur, donc rien ne s'aggrave si la mémoire ment. Le choix est
retenu par appareil, comme le repli de la barre, et pour la même raison : un
gérant ouvre l'application sur le salon où il travaille ce jour-là, et le lui
faire rechoisir à chaque démarrage transformerait un choix rare en geste
quotidien.

**Le contrôle est à deux endroits, et ce n'est pas une redondance.** La barre
latérale porte le nom, donc elle porte le choix — c'est là qu'on lit le nom,
c'est là qu'on en change, et la liste se déplie sous lui plutôt que d'ouvrir un
écran. Mais **la barre latérale n'existe qu'en bureau** : sur un téléphone, ce
serait le seul endroit où changer de salon, et il n'y en aurait aucun. Les
réglages portent donc le même sélecteur, pour les deux mises en page.

**Il ne se rend qu'à partir de deux salons.** Un contrôle qui n'offre aucun choix
occupe la place et fait douter — c'est la règle du bouton qu'on retire plutôt que
de griser. Avec un seul salon, le nom reste ce qu'il a toujours été.

**Le salon courant est marqué, pas retiré de la liste.** Le retirer ferait lire
la liste comme « les autres », et on ne saurait plus lequel on regarde en
l'ouvrant. Le test porte sur `accessibilityState.selected` et non sur la coche :
c'est ce qu'un lecteur d'écran annonce, et vérifier le glyphe éprouverait le
dessin plutôt que ce que l'écran affirme.

---

## 2026-08-22 — La portée d'une reprise se lit sur l'étiquette du routeur

**Le problème.** Une reprise déclare ce qu'elle ouvre ; encore faut-il, à chaque
requête, savoir de quel écran cette requête relève. Le résolveur d'appartenance
ne connaît qu'un identifiant de commerce — il ne sait pas qu'il garde la carte
plutôt que les chiffres.

**Trois façons de le lui dire, et une seule tient.** Un paramètre à chaque route
serait exact et se perdrait : trente-sept routeurs, et celui qu'on oublie
s'ouvre en silence. Une correspondance par chemin demanderait un motif par
route, se déferait au premier renommage, et personne ne verrait qu'elle s'est
défaite. Les étiquettes existent déjà, sont posées une fois par routeur, et
regroupent naturellement ce qui fait un écran.

**Ce qui n'est pas dans la table n'est ouvert par aucune reprise.** Un routeur
neuf, une étiquette oubliée : le support est refusé et le voit à la première
tentative. Le sens inverse — laisser passer l'inclassable — ouvrirait une porte
que personne n'a déclarée, et rien ne le dirait jamais. C'est le seul point de
ce dispositif où l'erreur coûte cher, donc c'est là qu'elle penche du bon côté.

**`support` est absent de la table, volontairement.** La liste des reprises
faites chez un salon est ce que *le salon* lit de nous ; l'administration a sa
propre route pour la même chose. Une reprise ne sert donc jamais à relire ses
propres traces depuis la porte du commerce.

## 2026-08-22 — `spontaneous` est déclaré, faute d'un canal entrant

La spécification demande qu'une reprise porte « spontanée » quand aucune demande
du salon ne l'a précédée. **Aucun canal ne permet à un salon d'écrire** : il n'y
a ni ticket, ni message entrant, ni trace d'un appel. Le calculer rendrait
`true` pour tout le monde, y compris pour les salons qui ont téléphoné — un mot
qui accuse, posé au hasard.

Le champ est donc **déclaré par l'administration**, et son défaut est `true` :
le silence vaut « de ma propre initiative », et c'est celui qui affirme avoir
été appelé qui doit le dire. L'inverse laisserait toute reprise se présenter
comme sollicitée sans que personne ne l'ait sollicitée.

Ce que cela vaut ne tient qu'à une chose : **le gérant le lit**, et il sait, lui,
s'il a appelé. Une déclaration qu'un tiers peut contredire n'est pas une preuve,
mais ce n'est plus une affirmation gratuite. Le jour où un canal entrant
existera, le champ se calculera et cette ligne tombera.

## 2026-08-22 — Une annulation tardive coûte moins qu'une absence

Les deux valaient `no_show`, donc rien n'incitait à prévenir plutôt qu'à
disparaître — alors qu'un salon prévenu à onze heures remplit son créneau de
quatorze heures trente. `cancelled_late` porte la différence, à `-5` contre
`-25`, et **le dossier arrive en `cancelled`** : elle a annulé, pas disparu.

**Le poids a été livré à -10 et corrigé le lendemain, sur le chiffre du test
d'équilibre.** À -10 : base `70`, minimum du reel `60`, et une créatrice dont
c'était le seul écart tombait **exactement** sur le seuil — elle n'y passait que
parce que la comparaison est `>=`, et un point sur n'importe lequel des trois
réglages lui fermait le haut de l'échelle. Prévenir tard lui coûtait donc ce que
cet événement existe pour lui épargner.

À `-5`, cinq points de marge, et le test les affirme au lieu de les laisser
déduire. **Une annulation tardive est une faute légère, pas une demi-absence** :
c'est cette phrase qui fixe l'ordre de grandeur, pas l'écart avec `no_show`.

Le test n'a rien empêché — le poids était déjà en production. Il a rendu un
nombre lisible, et c'est le nombre qui a tranché. C'est tout ce qu'on demande à
un test d'équilibre, et c'est pour cela qu'il reste.
L'arithmétique du seuil est mince et c'est noté ici pour qu'elle se voie : base
`70`, moins `10`, minimum du reel `60`. Une créatrice dont c'est le seul
événement passe **exactement**, et seulement parce que la comparaison est `>=`.
Un test l'épingle : le jour où l'un des trois réglages bouge d'un point,
quelqu'un décidera au lieu de le découvrir.

---

## 2026-08-22 — La reprise : les freins existent, et deux d'entre eux tiennent

**Le salon referme depuis la journée, en un appui, sans confirmation.** Le
bouton vivait dans les réglages ; il est là où le salon regarde chaque matin.
Et il ne demande rien : une question de plus entre le gérant et sa porte est une
négociation, et il n'a personne à convaincre. Le geste se répare tout seul —
rien n'est effacé, l'administration peut rouvrir en le disant.

**La portée s'écrit au présent sur le bandeau.** La liste des réglages dit
« could open » d'une porte déjà close ; la journée parle d'une porte ouverte
pendant qu'on lit, et le temps du verbe est ce qui distingue un fait passé d'une
chose qui se produit. Les mots viennent du même aiguillage que la liste : deux
jeux pour les mêmes écrans finiraient par se contredire, et c'est le gérant qui
lirait la contradiction.

**« Tout » n'est pas interdit, il est écrit.** Le serveur n'a pas de valeur
« tout » : demander tout, c'est cocher les sept, et le gérant lit alors les sept
dans sa liste. Une valeur unique aurait été plus courte à écrire et plus facile
à lire pour l'administrateur — c'est exactement ce qu'on ne veut pas.

**Le troisième frein ne tient qu'à moitié, et il faut le dire.** Le compte des
reprises de l'appelant est servi sur la *réponse* à l'ouverture, donc après
l'appui. La planche le veut au moment de la demande : lu après coup, il retient
pour la suivante et non pour celle-ci — c'est-à-dire exactement le journal que
Design écarte, qui enregistre sans empêcher. Il est rendu là où il arrive, et le
manque est demandé plutôt que masqué.

**L'écran est monté sur la fiche de tournée assumée, et c'est provisoire.**
Aucune route ne liste les commerces côté administration ; c'est le seul endroit
du produit où un salon nommé est sous les yeux d'un administrateur. La place est
mauvaise — on ne pense pas « tournée » quand on cherche à débloquer un salon —
et le code le dit là où quelqu'un le lira.

---

## 2026-08-22 — L'attente : deux règles sur trois retirent quelque chose

**« Lent » veut dire « je ne sais pas si ça marche ».** Une partie de la lenteur
est réelle et se corrige en code ; le mot que les testeurs emploient couvre
autre chose. Ce qui produit la sensation n'est pas la durée mais l'incertitude :
rien n'a bougé, donc on appuie une seconde fois — et la lenteur perçue devient
mesurée.

**Les quatre durées sont des jetons, pas des nombres dans un écran.** Appui 100,
état 160, fondu 220, seuil 400. Elles disent *quand on montre*, pas comment on
décore.

**Rien ne clignote sous quatre cents millisecondes.** Le squelette ne part plus
au premier instant. La vue reste montée et vide pendant le seuil — ce n'est pas
un blanc, c'est ce qu'il y avait déjà, et sur une seconde ouverture il y a même
l'en-tête, qui vit hors des quatre états.

Le seuil ne gouverne **que** les indicateurs d'attente. Une réponse à un geste
part tout de suite ; l'enfoncement d'un bouton ne l'attend pas, et l'atténuation
d'une liste qui se recompose part à l'appui — ce n'est pas une attente, c'est un
remplacement.

**La photo réserve sa place avant d'arriver.** Le défaut n'était pas la lenteur
de l'image : c'était que la carte grandissait et poussait le texte qu'on lisait.
Une image lente dans une place réservée se remarque à peine ; une image rapide
qui redimensionne sa carte fait sauter la liste entière. Le fond est un aplat
`bg.deep` et non un blanc, qui se confondrait avec la surface de la carte.

Opacité seule, jamais d'échelle ni de translation : une photo qui glisse déplace
le texte voisin dans le regard, ce qui est exactement le défaut qu'on répare.

**La garde des squelettes attend maintenant le seuil.** Elle vérifie toujours la
même chose — chaque écran déclare sa silhouette — mais son `getByTestId` est
devenu un `findByTestId`. La règle a changé le moment, pas l'exigence.

**Une mutation a survécu, et elle avait raison de survivre.** Poser l'opacité
initiale à un ne changeait rien : un effet la remet à zéro à chaque source, ce
qui est le vrai mécanisme — sans lui, une vignette recyclée par une liste
montrerait la photo précédente à pleine opacité pendant que la suivante charge.
Il a fallu casser les deux pour que le test tombe, et c'est ce qui prouve
qu'il éprouve le mécanisme et non son écriture.

## 2026-08-22 — Le mur sert la vignette, et la vignette descend à 320

**Mesuré avant de décider.** Un fil de vingt salons à quatre prestations charge
quatre-vingts images d'un coup — la grille du mur est un `ScrollView` et un
`.map`, rien n'y est virtualisé. Photographies déjà réduites : 10,5 Mo. Photos
sorties d'un téléphone : 52 Mo. Le JSON qui les nomme : 50 Ko.

Autrement dit, **les images sont 99,5 % de ce qui part sur le réseau**, et toute
optimisation du JSON aurait été du temps perdu.

**Deux défauts distincts, et le premier annulait le second.** Le mur appelait
`urlDuMedia` — l'original, borné à 2000 pixels — et non `urlDeLaVignette`. La
dérivée existait, elle était réglée, et personne ne la demandait. Puis la
vignette elle-même valait 480 pixels, calibrés sur des cartes de 150 points que
la grille v3 ne rend plus.

Les cinq cadres qui lisent une vignette ont été mesurés : 100 points sur le mur,
64 sur la fiche, 56 dans la galerie et dans la carte, 40 × 52 dans la bande de
la visionneuse. Le plus grand demande 300 pixels à densité triple. **320 les
couvre tous, et rien de plus.**

**L'argument qui protégeait l'original ne tenait pas.** Le contrat disait « le
mur sert l'original » pour éviter deux cadrages du même salon selon sa position.
Or les deux dérivées bornent le grand côté **sans recadrer** : elles rendent le
même cadre, avec moins de pixels. Le commentaire décrivait aussi un héros de
520 points à fond perdu que la grille v3 ne rend plus. La fiche de salon, elle,
continue de demander l'original — c'est le seul endroit où une vignette serait
agrandie.

**La mémoire compte autant que les octets.** `Image` décode avant de réduire :
une image de 2000 × 2000 occupe seize mégaoctets quel que soit le cadre où on la
pose. Quatre-vingts d'un coup expliquent le défilement qui accroche avant même
que le réseau soit en cause.

**Le nouveau plafond ne se relit pas sur l'existant.** Une vignette déposée hier
reste à 480 : plus lourde que nécessaire, parfaitement correcte. Regénérer
demanderait un balayage de tout le dépôt pour un gain qui se réalise de lui-même
à mesure que les photos se remplacent.
## 2026-08-22 — Le sélecteur v3 : le nom devient un contrôle, sauf à la caisse

**La question posée par Design a été vérifiée avant d'écrire la phrase, et la
réponse est oui.** L'écran promet qu'un code d'un autre salon ne passera pas.
`_exiger_appartenance` est appelée sur la vérification **et** sur la
consommation, et deux tests d'API le prouvent — celui de la consommation ne
s'arrête pas au 403, il constate que la réservation reste `confirmed`. La
protection est réelle ; l'écran ne la porte pas, il évite de proposer le geste
qui la déclencherait, et les deux se cumulent.

**À la caisse, le nom n'est pas un contrôle.** Pas grisé — la règle du produit
l'interdit, un bouton grisé demande de deviner ce qui le débloque. Pas un
contrôle du tout, donc rien à refuser. On quitte la caisse, on change, on
revient : un geste de plus, et c'est le but. Servir un code du mauvais salon est
la seule erreur de ce parcours qu'on ne peut pas défaire — elle consomme la
réservation de quelqu'un d'autre, et `consumed` est terminal.

**Le quartier identifie, pas le nom.** Deux salons d'une enseigne portent le même
nom : « Vela Nail Studio » deux fois ne distingue rien. Le quartier prend le gras
et passe au-dessus, l'enseigne descend en second, l'adresse situe. Hors des
quartiers ouverts il n'y en a pas — l'adresse prend alors le relais, mais elle ne
titre pas : une rue en gras se lit comme une consigne, pas comme un lieu.

**`neighborhood` et `address` étaient servis et jetés.** `BusinessRead` les rend
depuis toujours ; le type de l'app n'en gardait que le nom, ce qui suffisait tant
que le nom identifiait. C'est la même classe de défaut que `creator_partie`,
`avatar_key` et `profil_url` — et la quatrième fois cette semaine.

**La phrase du comptoir ne se rend qu'à deux salons.** Pour un gérant qui n'en a
qu'un, elle inventerait un risque qui n'existe pas. La sortie est nommée sans
être offerte : dire « pour servir Little Havana, quittez la caisse » donne le
chemin sans mettre le geste à portée du doigt de quelqu'un qui tient un code.

## Ce que les tests ont trouvé

**Deux composants définis et jamais rendus.** Une insertion JSX perdue par une
assertion Python : les fonctions existaient, rien ne les appelait, et la suite
était verte. C'est le « tout passe » qui l'a dit — sur un lot qui ajoute deux
blocs visibles, une suite qui ne bouge pas d'un test est un signal, pas un
succès.

**Et la mutation qui compte a survécu au premier passage.** Rien n'éprouvait que
la barre retire l'affordance à la caisse : c'est la décision centrale de la
planche, et elle n'était tenue par aucun test. Le décor la monte maintenant deux
fois, même barre et mêmes salons, seule la route courante changeant — sans cette
paire, une barre qui n'offrirait jamais le contrôle passerait aussi.

**Un décor de test rendait ses réponses à la file.** La caisse lisant désormais
l'appartenance, la première réponse de retrait partait à la requête
d'appartenance et l'ordre des appels décidait du résultat. Il route par adresse,
ce qu'il aurait dû faire depuis le début : un écran qui ajoute une lecture ne
devrait pas décaler les réponses d'un test qui parle d'autre chose.

## Ce qui manque, et qui est demandé

Le compte de décisions du jour par salon — « 5 aujourd'hui » sur l'autre ligne.
Design le classe « souhaitable » et non « manquant », et le dit bien : sans lui
la liste reste utilisable et **perd sa raison d'être ouverte**. C'est ce chiffre
qui fait basculer un gérant qui ne savait pas qu'on l'attendait.

---

## 2026-08-22 — Fermer une offre : le dernier geste manquant du produit

`activerUneOffre` existait depuis la phase 2 et n'avait aucun appelant. Un salon
pouvait ouvrir une prestation à un palier et n'avait **aucun moyen de revenir
dessus** — l'écran du catalogue le documentait pourtant : « ouvrir et fermer
passe par sa propre route, c'est une transition d'état, elle laisse une trace au
journal ». La route était là, la trace était prévue, le bouton n'existait pas.

**Fermer n'est pas supprimer, et c'est toute la distinction.** Supprimer une
offre que des réservations citent réécrirait leur histoire ; le serveur le
refuse, et son commentaire le dit — « retirer sans supprimer : la seule voie
possible quand l'offre est réservée ». Fermer laisse tout en place et cesse
simplement de proposer.

**Une offre fermée reste à sa place**, et c'est voulu : la retirer de la liste
enlèverait le seul chemin pour la rouvrir. Elle dit ce qu'elle est — plus
proposée — et ce qu'elle n'a pas fait : les réservations passées la citent
toujours. C'est la phrase qui manque le plus à quiconque hésite à fermer.

**L'offre est celle de son palier.** Une prestation ouverte à deux paliers a deux
offres, et fermer l'une ne ferme pas l'autre. Le test le prouve sur un décor à
deux paliers — avec un seul, chercher l'offre par prestation ou par
(prestation, palier) rend la même chose, et la mutation survivait.

## Un test qui ne tombait qu'à certaines heures

`la-fiche-v3` vérifiait qu'un troisième créneau n'est **pas** annoncé, avec une
expression construite depuis l'heure formatée : `2:05 AM`. Elle mord dans
« 12:05 AM ». L'assertion d'absence échouait donc sur une heure bel et bien
absente — mais seulement quand le second créneau du décor tombait sur un midi ou
un minuit, c'est-à-dire à certaines heures de la journée et pas à d'autres.

Trouvé en écartant mes propres changements pour savoir si l'échec venait d'eux ;
il préexistait. `\b` n'aurait pas suffi — entre « 1 » et « 2 » il n'y a pas de
frontière de mot — c'est le début de chaîne ou une espace qui borne un horaire.
Un test qui ne casse qu'entre 21 h et 23 h passe des semaines à faire croire
qu'il tient.

## Ce qu'il reste après celui-ci

La garde `routes-sans-appelant` ne porte plus que `ouvrirUneReprise` et
`fermerLaReprise` : l'autre bout de la reprise de compte, qui attend l'écran
d'administration — **un produit différent de celui-ci**. Côté commerce et côté
créateur, plus aucune capacité du client n'est sans écran.
## 2026-08-22 — L'attente, la suite : la liste, la règle 3, et une garde qui a dû être refaite deux fois

**La liste qui se recompose s'atténue sans se vider**, et ça se pose une fois
dans `Ecran` plutôt que cinq fois dans cinq écrans. `useRequete` gardait déjà
les données pendant un rechargement et le signalait — il ne manquait que de le
montrer.

**Le seuil des quatre cents millisecondes ne s'applique pas à cette
atténuation.** Ce n'est pas un indicateur d'attente, c'est la réponse au geste,
au même titre que l'enfoncement d'un bouton. L'attendre ferait exactement ce que
la règle 1 veut éviter : un écran qui ne répond pas, donc un doute, donc un
second appui.

**Le test lit le départ de l'aller-retour, pas la valeur interpolée.** Les
animations de React Native sont pilotées par les images de rendu et non par les
minuteurs : avancer l'horloge de Jest ne déplace aucune opacité, et une
assertion sur la valeur affichée resterait à un en accusant le composant.

**La règle 3 n'avait rien à supprimer** — le produit la respecte déjà, et
`StatusMessage` n'a même pas de niveau `success`. La tranche est donc
entièrement la garde : une règle qui retire se défait toute seule, et une règle
écrite dans une note de composant est une intention qui ne survit pas à la
personne qui l'a écrite.

**Cette garde a été fausse deux fois, et les deux fois une mutation l'a dit.**
D'abord six participes fixes — « saved, sent, updated, created, added,
recorded » — et « Your booking has been cancelled » passait au vert. Puis, une
fois élargie à tout participe, elle attrapait deux messages d'erreur du
produit : « This account has been closed » n'annonce aucune réussite, il
explique un refus.

Ce qui distingue une confirmation d'un état est **la deuxième personne**. « Your
X has been … » félicite ; « This account has been … » constate. La garde est
donc scopée là-dessus, et la liste des innocentes porte les deux messages qui
l'avaient fait crier au loup.

**Un test échouait déjà sur `main`, et pas de mon fait.** `/2:04 AM/` trouve
« 12:04 AM » : l'assertion des créneaux suivants n'était pas ancrée, et elle ne
rougissait qu'aux heures où les deux formes se chevauchent. La suite passait le
jour et tombait la nuit sans que rien n'ait changé dans le code. Ancrée sur
« aucun chiffre devant », et vérifiée sous quatre fuseaux.
## 2026-08-22 — La confirmation d'adresse rend une page, pas du JSON

Le lien vise l'API et non l'application : celle-ci n'est pas forcément
installée, et aucun navigateur ne sait ouvrir un schéma privé à coup sûr. Cette
décision-là était bonne et ne change pas. Ce qui change est ce que l'API répond.

Elle rendait `UserRead`. Quelqu'un qui cliquait voyait
`{"id":"…","email":"…","role":"creator"}` — sur le tout premier geste qu'il fait
avec le produit, et sur le seul écran qui décide s'il continue.

**Une page, pas une redirection.** La redirection était l'autre forme possible,
et elle bute sur le cas de tout le monde à la première ouverture : l'application
n'est pas installée. Ce qui a fait choisir l'API plutôt que l'app vaut ici aussi
— la page répond toujours.

**Rien d'extérieur dans cette page.** Elle s'ouvre parfois dans le navigateur
intégré d'un client de messagerie, sur le réseau d'un salon : une feuille de
style distante ou une police téléchargée en ferait une page blanche.

**Le refus reçoit le même soin.** Un jeton déjà consommé est presque toujours
quelqu'un qui a cliqué deux fois ; `{"detail":"email_verification_invalid"}` se
lit comme une panne et fait renoncer quelqu'un dont l'adresse est confirmée. Le
code HTTP reste 400 : le navigateur n'en fait rien, et mentir sur le statut
troublerait ce qui lit vraiment les codes.

**Hors du schéma public.** Une page n'a pas de contrat d'API, et la laisser dans
`openapi.json` ferait croire à un client qu'il peut en lire la réponse. Elle
reste dans l'inventaire des routes publiques — celui-ci parcourt les routes de
l'application, pas le schéma, et une page publique doit continuer d'y figurer.

## 2026-08-22 — Un cache local, inscrit route par route

**Le cache est une option d'appel, jamais un défaut.** `useRequete` prend une
clé et un âge maximum ; sans eux, rien n'est rangé ni relu. Un cache posé par
défaut aurait fini par couvrir une route qui décide d'un geste, et le défaut se
serait vu chez un salon, pas chez nous.

Ce qui s'y range change en heures ou en jours : l'appartenance, le fil, la fiche
d'un salon, son catalogue, les paliers, les plans. **Ce qui n'y entre jamais est
la moitié qui compte** — disponibilité, journée du commerce, réservations,
contreparties, codes de retrait, reprises de compte. Une réponse d'il y a dix
minutes y ferait tenir un créneau déjà pris, ou dirait « personne n'est dans
votre compte » à quelqu'un chez qui on est entré.

**La clé porte une version.** Un champ retiré du contrat rendrait une réponse
d'hier incompatible avec l'écran d'aujourd'hui, et le défaut n'apparaîtrait que
chez ceux qui avaient déjà ouvert l'application — c'est-à-dire jamais en
développement. La version se change à la main ; c'est plus grossier qu'une
invalidation par champ, et c'est voulu : une invalidation fine se trompe en
silence, celle-ci jette tout et l'écran repart d'une requête.

**Tout part à la fermeture de session, et aussi à l'ouverture.** Une réponse en
cache est de la donnée personnelle. La purge à la déconnexion couvre le cas
normal ; celle à la connexion couvre l'application tuée sans déconnexion, où la
personne suivante verrait le fil et l'appartenance de la précédente le temps
d'un aller-retour.

Le vidage n'emporte que nos clés. `AsyncStorage.clear()` emporterait le salon
choisi, le repli de la barre et la préférence de notifications, qui ne sont pas
des réponses : quelqu'un qui se déconnecte retrouverait une application
dépréglée.

**Le cache ne remplace jamais une réponse déjà arrivée.** Il est lu en parallèle
de la requête et ne s'installe que si rien n'est encore là. Sur un réseau
rapide, la réponse revient avant que le stockage rende la main — et une
implémentation qui poserait le cache sans regarder l'état ferait reculer l'écran
d'un jour sous les yeux de quelqu'un qui lisait déjà la bonne réponse.

**Les tests partent d'un appareil neuf.** `AsyncStorage` est simulé par un objet
de module partagé par tous les tests d'un fichier : le premier qui charge un fil
range sa réponse, et le suivant — celui qui vérifie l'état de chargement —
trouve des données. Cinq tests sont tombés d'un coup à l'arrivée du cache, tous
pour cette raison, et aucun ne parlait de cache. Le vidage est donc dans
`jest.setup.js`.

## 2026-08-22 — Le mur est une liste, et `Ecran` sait en rendre une

**Le plafond suivant, invisible dans les octets.** Servir la vignette a ramené
un fil de vingt salons de 10,5 Mo à 0,8. Mais `Image` décode avant de réduire :
le coût du décodage ne dépend pas du cadre où l'on pose la photo, et une grille
en `ScrollView` + `.map` monte toutes ses rangées à la première image — quatre-
vingts `Image` d'un coup.

**Un mode `liste` sur `Ecran`, additif.** Le corps nominal passe en `FlatList`
quand l'écran fournit `liste` ; sans elle, rien ne change. Les états de
chargement, d'erreur et de vide restent dans le défileur ordinaire : ils
tiennent en un écran, et leur donner deux chemins de rendu doublerait ce qu'il
faut vérifier pour rien.

Les éléments portent un `ReactNode` déjà construit. C'est un **descripteur**,
pas un rendu : la fonction du composant ne s'exécute — et son image ne se monte
— que lorsque la liste décide d'afficher la rangée.

**Une seule construction du contenu.** `useMur` produit l'en-tête, les rangées
et le pied ; `SectionsParQuartier` les pose dans un bloc, le fil les confie au
défileur. Deux constructions du même mur finiraient par diverger, et c'est une
faute que ce dépôt a déjà commise ailleurs. Conséquence directe : les marges
vivent sur la rangée et non sur un conteneur, seule écriture qui rende la même
chose des deux côtés.

**Un crochet et non trois composants**, parce que les trois morceaux partagent
le quartier ouvert, qui est un état. Le couper en trois demanderait de remonter
cet état chez `FilScreen`, c'est-à-dire de le rendre responsable de quelque
chose qui n'appartient qu'au mur.

**Le rendu en bloc reste, et il sert.** Quand aucun quartier n'est déclaré — des
salons réservables mais non situés — `useMur` rend `null` et l'écran retombe
dessus. C'est aussi ce que montent les tests qui n'ont pas quatre-vingts images.

Les repères ont suivi : `le-mur` est porté par le défileur, qui tient désormais
les rangées, et `etat-nominal` enveloppe le tout pour que la table des quatre
états continue de voir le fil.

---

## 2026-08-22 — Les portraits : une limite du moment, pas un arbitrage

**La clé nue n'a jamais été choisie contre la vignette**, et c'est l'historique
qui le dit plutôt qu'un avis. Le repli de la route des médias date du 14 août,
la vignette d'avatar du 21 au soir, la grille de l'annuaire du 22 au matin : les
deux existaient quand le choix a été fait.

La raison écrite ne couvre qu'un cas — « sans abonnement la clé porte déjà
l'aperçu flouté, et la resuffixer ne rendrait rien ». C'est vrai de ce cas-là, et
la clé nue est la forme juste pour lui. L'autre cas le payait, faute de pouvoir
séparer les deux. `urlDuPortrait` les sépare, et c'est tout ce qu'elle fait.

**Le suffixe aveugle ne casse rien, il gaspille.** `@apercu@vignette` n'est pas
un 404 : la route voit la terminaison, la retire, trouve l'aperçu et sert la
bonne image. Le coût est une lecture de dépôt perdue par portrait — vingt par
ouverture d'annuaire, pour rendre exactement ce qu'une clé nue aurait rendu.

**Le test qui défendait la clé nue encodait une limite, pas une décision.** Sa
note de mutation — « c'est la terminaison qui distingue les deux » — parle de la
solidité de l'assertion et non de la justesse de la clé. La terminaison reste ce
que le test regarde ; seul ce qu'il attend sur le cas abonné a changé.

**S'arrêter devant ce test était juste, et le retourner ensuite aussi.** Un test
défendu par une note de mutation mérite qu'on cherche la raison avant de le
renverser. Il n'y avait pas de raison : il y avait une date.

**La pile du téléphone est virtualisée, la grille large reste un bloc.** Trois
colonnes en `flexWrap` ne sont pas une liste, et le contrat de `liste` rend un
élément par rangée sans notion de colonnes. Changer la disposition pour pouvoir
virtualiser serait prendre le problème par le mauvais bout.

Les deux chemins partagent la même fabrique de morceaux : ce qui change entre
eux est la façon de poser les fiches, pas ce qu'elles portent. Deux corps
finiraient par diverger, et c'est celui que personne ne regarde qui dériverait.

**Pas de crochet de fin de liste, et il n'en faut pas.** « Voir plus » est un
appui explicite, donc il vit dans le pied et défile sous la dernière fiche —
poser un `onEndReached` que rien n'exercerait serait du mécanisme sans emploi.
## 2026-08-22 — Deux vérifications de Design : l'espagnol, et les largeurs entre les deux maquettes

### Les libellés courts en espagnol

`type.label` fait onze points en capitales avec 1,4 d'interlettrage, et
`SegmentedTabs` le porte dans des cellules en `flex: 1`. Sur un téléphone de 390
points avec trois onglets, chaque cellule offre **103 points utiles** — une
douzaine de capitales.

> **Deux corrections du 2026-09-04.** L'écran des réservations est passé à
> quatre onglets : sa cellule fait **73,5 points**, pas 103. Et le modèle de
> largeur employé ici — `longueur × avance moyenne` — s'est révélé faux *dans sa
> forme* : confronté au rendu réel, l'écart allait de −14 % à +9 % selon le mot,
> parce qu'un caractère n'a pas de largeur fixe. Il se trompait dans le sens
> dangereux : il acceptait `Upcoming` (74,0 points rendus contre 65,8 annoncés,
> donc coupé) et refusait `In review` (67,7 rendus contre 74,0 annoncés, donc
> bon). La garde emploie maintenant une table d'avances **mesurée** dans un
> navigateur chargé de la police, qui reproduit le rendu à 0,4 point près.

**La mesure a trouvé pire que la question posée.** Design demandait de vérifier
l'espagnol ; « Awaiting their post » débordait **en anglais**, la langue des
maquettes. Personne n'avait mesuré dans aucune des deux, et c'est moi qui l'avais
rallongé — pour le rendre plus clair que « expected », ce qu'il est, mais à deux
lignes.

Deux libellés corrigés : « Not posted » / « Sin publicar », et « Nearby » /
« Cerca ». Les onze autres tiennent, l'espagnol compris.

**Rien n'était tronqué**, et c'est ce qui rendait le défaut invisible : la barre
enroule. Le défaut n'est pas une perte de texte mais un onglet à deux lignes
pendant que ses voisins en font une — qu'aucune garde cherchant un débordement
n'aurait vu.

### Les largeurs intermédiaires

Rien n'avait été composé entre 390 et 1512. Le seuil `expanded` vaut 900 : à
cette largeur, la barre latérale déployée prend 240 et il reste 660 au contenu.
Une colonne latérale fixe de 440 — le journal de la caisse — laissait alors
**196 points** au pavé de code, moins que ce qui l'accompagne. Les paliers
laissaient 276 à l'échelle contre 360 à la colonne des règles : l'explication
plus large que ce qu'elle explique.

**Là non plus rien ne débordait** : la colonne fixe tient sa largeur, c'est le
corps qui se comprime.

La question à poser n'est donc pas « l'écran est-il large » mais **« reste-t-il
la place »**. Chaque écran connaît la largeur de sa seconde colonne ; il la
donne, `placeDisponible` répond. La barre est comptée **déployée, toujours** :
son repli est une préférence d'appareil, et compter le pire fait scinder un peu
plus tard qu'il n'aurait été possible — jamais plus tôt qu'il ne faut, seul sens
dans lequel l'erreur est sans conséquence.

## Trois défauts de garde trouvés en écrivant ces deux-là

**Huit suites simulaient `useGabarit` avec un objet littéral.** Le jour où le
gabarit a gagné une fonction, les huit ont rendu `undefined` et l'appel a levé.
Recopier la règle dans chaque double aurait remplacé une panne franche par huit
copies qui dérivent en silence — un double qui ne suit plus ce qu'il double
éprouve un écran qui n'existe pas. La règle est donc extraite, et les doubles
l'appellent.

**Le seuil de 900 semblait redondant.** Avec des colonnes de 360 et 440,
l'arithmétique refuse déjà seule sous le seuil : la mutation qui le retirait
survivait. Une colonne étroite sépare les deux — 700 − 240 − 24 = 436, assez
pour deux colonnes de 150, et pourtant on ne scinde pas.

**Et la garde des libellés ne prouvait plus rien une fois les libellés
corrigés.** L'anglais tenant partout, ne vérifier que lui passait au vert. Elle
relève désormais ce qu'elle a visité, langue comprise, et le compare à ce qu'elle
devait visiter : retirer l'espagnol de la boucle casse le relevé.

---

## 2026-08-22 — La carte du commerce : les deux règles tiennent, leurs gardes non

L'écran n'avait pas été confronté à ses cadres depuis la bascule Ambre. **Les
deux règles se vérifient, et toutes deux tiennent** — ce n'est pas ce qui
manquait.

**Le fond.** `bg.sunken` vaut `#0E0C09` après la bascule, `bg.page` `#F9F8F7` :
la galerie est bien sur du sombre et la carte sur du clair. On regarde une photo
sur du sombre — le fond disparaît et l'image tient seule ; on lit un texte sur du
clair — une carte de salon est un document.

**La sortie.** `FeuilleDeSortie` s'ouvre avant l'appui, nomme le domaine plutôt
que l'adresse entière, et laisse rester.

## Ce qui manquait, c'était ce qui les tient

**La garde des fonds vérifiait qu'ils diffèrent, jamais lequel est lequel.**
Intervertir les deux — la galerie sur du clair, la carte sur du sombre — passait
sans un mot. C'est exactement ce qu'une bascule de palette peut faire : le
produit est passé en Ambre par les jetons, et une garde qui ne teste que la
différence ne dit rien du sens. Elle compare désormais les luminances relatives,
et exige un écart franc — deux gris voisins satisferaient une comparaison stricte
sans que rien ne se distingue à l'œil.

**Et la garde de la sortie prouvait qu'on prévient, pas qu'on attend.** Un écran
qui aurait ouvert le lien à l'appui **tout en** montrant la feuille passait :
l'avertissement serait alors une annonce après coup, le navigateur étant déjà
parti quand on la lit. `Linking.openURL` est maintenant espionné — rien ne part
avant la confirmation, et l'adresse exacte part après.

Deux mutations pour chacune, quatre chutes. Aucune de ces deux failles ne se
serait vue en relisant l'écran : il était juste. C'est le motif qui a coûté trois
campagnes à l'audience — un écran correct, des gardes qui ne le prouvaient pas.

---

## 2026-08-22 — Vérifier une hypothèse trouve souvent autre chose que ce qu'elle visait

Design a demandé de vérifier que les libellés courts tiennent **en espagnol** :
les maquettes sont en anglais, `type.label` fait onze points en capitales, et
l'espagnol est vingt à trente pour cent plus long. L'hypothèse était juste, la
méthode aussi.

**Le défaut était en anglais.** « Awaiting their post » débordait dans la langue
des maquettes — celle qu'on regarde depuis des mois, sur des cadres composés à la
main. Il avait été écrit une semaine plus tôt, en corrigeant un autre défaut, et
personne n'avait mesuré dans aucune des deux langues.

C'est la même chose plusieurs fois dans la même journée, et le compte vaut d'être
posé :

| Ce qu'on est allé vérifier | Ce qu'on a trouvé |
|---|---|
| Les libellés courts tiennent-ils en espagnol | Un libellé débordait **en anglais** |
| La galerie et la carte de la fiche sont mal placées | Bien placées ; **aucune ne répondait au doigt** |
| La carte du commerce a-t-elle raté la bascule Ambre | Les deux règles tenaient ; **leurs gardes non** |
| L'écran de validation d'adresse manque-t-il | Il existe ; **le lien rend du JSON au navigateur** |
| L'écran des paliers porte-t-il encore l'ancien système | Déjà en Ambre ; **il ouvrait sur un mécanisme** |
| `rattacherLaFiche` n'a pas d'écran | L'écran existe ; **il ignorait la session** |

Six fois, l'hypothèse a servi à faire regarder au bon endroit et s'est révélée
fausse sur sa cause. **Aucune de ces six n'aurait été trouvée sans elle**, et
aucune n'était ce qu'elle annonçait.

## Pourquoi c'est une méthode et non une série de hasards

**Une hypothèse fausse sur la cause est presque toujours juste sur le lieu.**
Quelqu'un a senti que quelque chose clochait là — un écran incompris deux fois,
un libellé qui paraît long, une porte qu'aucun testeur ne mentionne. Ce
sentiment vient d'une observation réelle ; c'est son explication qui est une
conjecture, parce qu'expliquer demande d'ouvrir le code et que remarquer ne le
demande pas.

**D'où la conduite** : aller au lieu, et **mesurer avant de corriger**. La
tentation est d'appliquer la correction annoncée — raccourcir l'espagnol,
déplacer la galerie, repasser la carte en Ambre. Elle produit du travail qui
n'était pas nécessaire et laisse le vrai défaut en place, avec la conviction
supplémentaire qu'on vient de s'en occuper.

**Et le corollaire, qui a servi trois fois aujourd'hui** : quand la mesure dit
que tout va bien, la question n'est pas close — elle se déplace. Un écran juste
dont rien ne prouve qu'il le reste est le motif qui a coûté trois campagnes à
l'audience. Vérifier que la règle tient, c'est ensuite vérifier ce qui la tient.
## 2026-08-23 — Le compte des reprises : le moment était le sujet, pas le nombre

**Lu après l'appui, il retenait pour la fois suivante.** C'est-à-dire qu'il
faisait ce qu'un journal fait — enregistrer sans empêcher —, ce que la planche
écarte dès sa première phrase. Ce qui retient est de se comparer à soi-même
**pendant qu'on écrit encore le motif**, quand on peut encore ne pas le faire.
Le compte est donc au-dessus du champ, avant tout le reste.

**Il ne refuse rien.** Un seuil qui refuserait se contournerait en attendant un
jour, et transformerait une mesure honnête en formalité à franchir.

**Et il ne bloque pas le formulaire.** Le compte est un miroir, pas une
condition : si sa route tombe, la reprise s'ouvre quand même. Faire dépendre
l'accès de support d'une route qui n'a rien à voir avec lui serait le rendre
indisponible le jour où tout va mal — c'est-à-dire le jour où l'on a besoin
d'entrer dans un compte.

**Une mutation a survécu, et c'est le décor qui était en cause.** Brancher le
bouton sur l'état du compte ne cassait rien : tous les décors répondaient, même
mal, donc la requête arrivait toujours en `pret`. Ce qui distingue les deux
implémentations est une route **qui échoue** — et c'est ce cas-là qui manquait.

**Un compte absent n'est pas un compte à zéro.** Lire `undefined` comme « aucune
reprise » annoncerait « ta première en sept jours » à quelqu'un qui en a ouvert
quinze : l'exact contraire de ce que la phrase existe pour faire. Rien plutôt
qu'un chiffre faux.

**Zéro, en revanche, se dit.** Un écran qui se tait quand il n'y a rien à
reprocher apprend que la phrase est un reproche ; la dire toujours en fait une
mesure, ce qu'elle est.
## 2026-08-23 — Le contraste se mesure, il ne se relit pas

**La capacité était là et personne ne l'appelait.** `luminance()` et
`contraste()` vivent dans le thème depuis longtemps, ils sont justes, et ils ne
servaient qu'à calculer l'opacité minimale d'un voile de photo. Cinq erreurs de
contraste ont été trouvées et corrigées à la main pendant ce temps.

**Des paires déclarées, jamais un produit croisé.** Toutes les combinaisons
possibles feraient tomber des paires que personne ne pose — une encre claire sur
une surface claire — et une vérification qui se trompe est pire qu'une
vérification absente : elle apprend à ignorer le rouge. Ce qui est dans la table
est ce qui existe à l'écran, avec sa raison.

**Les seuils ne sont pas tous à 4,5**, parce que le standard ne l'est pas : un
grand texte et une bordure qui délimite un contrôle demandent 3:1, et un élément
**inactif** n'est soumis à rien. Imposer un rapport à un bouton éteint
effacerait la seule chose que sa couleur dit.

**Ce que la garde ne fait pas est écrit dans son en-tête.** Elle mesure la
palette, pas les écrans : savoir sur quel fond un texte est posé demanderait de
calculer la mise en page. Une encre juste posée sur un fond qu'elle n'a pas le
droit de toucher lui échappe — et c'est exactement le défaut qu'elle a laissé
trouver à la main.

Ce qu'elle rattrape à la place est la **forme** du défaut. `ink.faint` est un
état, jamais une nuance de gris : écrit sans condition, c'est qu'on l'a pris
pour une couleur. Les quatre erreurs de l'historique ont toutes cette forme, la
quatrième ayant été trouvée en écrivant ce fichier — un libellé pressable à
2,46:1.

**Deux inscriptions honnêtes plutôt que deux corrections silencieuses.**
`ink.mute` sur `bg.deep` vaut 4,36 : la paire existe, elle ne tient qu'au titre
du grand texte, et le nombre est écrit sous les yeux de qui décidera. Les deux
encres de voile ne sont pas dans la table : elles se posent sur une photo, donc
sur rien de connu, et `opaciteMinimaleDuVoile` les mesure déjà dans deux autres
fichiers — que la garde vérifie exister, pour que le renvoi ne devienne pas un
tapis.

---

## 2026-08-23 — Deux défauts de campagne, et une garde qui mesurait à côté

**L'accueil débordait de 68 points, mesurés.** Les trois promesses du créateur
descendaient sous le haut du bouton et se dessinaient par-dessus. La garde de
bout en bout existait pourtant : elle mesurait `scrollHeight` du document, et le
document ne défilait pas — le débordement était **à l'intérieur** de la carte.
Une garde qui mesure la page entière ne dit rien de ce qui se chevauche dedans,
et celle-là est restée verte pendant que l'écran était cassé en campagne.

Ce qui décide n'est pas la longueur du texte, c'est la colonne : 171 points,
dix-neuf caractères par ligne en corps de 16. Les promesses passent donc en
légende sous le seuil, et gardent le corps au-dessus, où la contrainte n'existe
pas. Ce n'est pas une réduction pour faire tenir — c'est le rôle que ce texte a
déjà partout ailleurs, une ligne d'appui sous un titre de 22.

**Le champ : trois symptômes, un seul défaut.** « Carré, il sort des bords, fond
jaune » décrit une seule chose. Sur le web, `TextInput` est un `input` — un
enfant carré qui porte son propre fond. Le rayon vit sur le conteneur, qui ne
découpait pas, et l'autoremplissage rendait ce fond visible aux quatre coins.

Les deux moitiés se réparent séparément et il fallait les deux. `overflow:
hidden` sur le conteneur vaut sur toutes les plateformes et tient **tout** ce
qu'un enfant pourrait peindre, pas seulement ce qu'on avait prévu.

**La transition longue plutôt qu'une couleur.** L'astuce courante contre
l'autoremplissage est une ombre intérieure de la couleur du fond — mais elle
demande de connaître ce fond, et un champ posé tantôt sur `bg.surface`, tantôt
sur `bg.page`, la ferait mentir sur l'un des deux. Différer la transition
indéfiniment empêche la peinture d'arriver quel que soit ce qu'il y a derrière :
on ne corrige pas la couleur, on l'empêche.

**Les trois corrections sont vérifiées sur un vrai navigateur**, pas sur une
lecture du code : un défaut de disposition ne se prouve pas en `jest`, qui ne
pose rien. Chacune a été cassée à son tour, et la construction refaite à chaque
fois pour que la mesure porte sur ce qui tourne.

**La garde ne mesure qu'une langue, et elle le dit.** L'espagnol est plus long
et c'est lui qui décide de la hauteur réelle ; la bascule n'est pas atteignable
depuis l'accueil. Écrit dans le test plutôt que sous-entendu — une garde qui
laisserait croire qu'elle couvre les deux serait pire que celle-ci.

---

## 2026-08-24 — Une destination qui n'existait pas, et le `as never` qui l'a permis

**`navigate('paliers')` désignait un onglet qui n'a jamais existé.** Les onglets
du créateur sont `parcours`, `audience`, `reservations` et `reglages` ; l'écran
des paliers vit dans la pile du fil, sous `Paliers`. L'appui partait, React
Navigation ignorait le nom, et rien ne bougeait — ce qui se lit exactement comme
un texte non cliquable.

C'était **le seul chemin vers les paliers** depuis que la revue les a sortis du
fil. Le commentaire qui accompagne l'onglet le disait déjà : « sans ce passage,
la seule route vers les paliers serait l'état vide du fil, c'est-à-dire
accessible aux seuls créateurs qui n'ont rien à réserver ». Le passage existait
et ne passait nulle part.

**Le `as never` est ce qui l'a rendu possible.** Il existe parce que le
conteneur n'est pas typé sur une liste de routes ; il efface du même coup la
seule vérification qui aurait dit que le nom était faux. Une garde qui lit les
noms rend cette vérification sans reconstruire le typage.

**Deux gardes, parce qu'elles ne disent pas la même chose.** Celle des noms lit
la source et vérifie que toute destination visée est déclarée quelque part — la
cible imbriquée comprise, car `navigate('parcours', { screen: 'Paliers' })` en
nomme deux et les deux peuvent être fausses. Elle ne dit pas qu'on y arrive.
Celle de la coquille appuie et regarde l'écran qui vient.

**Le double de la coquille rendait une liste vide pour l'audience**, donc
l'écran montait son état vide et la ligne n'existait pas. Un décor qui répond
`[]` à tout monte un écran qui n'est pas celui qu'on éprouve — et la table
nommée passe maintenant avant le repli générique, sans quoi le décor n'aurait
aucun effet.

---

## 2026-08-23 — Les capitales sont une étiquette, jamais un porteur de phrase

Une campagne de test entière n'a pas trouvé où montrer son QR au commerce. Le
retour disait « le chemin a disparu avec la refonte ». Il n'avait pas disparu :
onglet « à venir » par défaut, `confirmed` dedans, filet d'encre, bouton,
écran, QR — tout était en place, et une garde le prouve maintenant depuis la
liste et non depuis l'écran seul.

Ce qui manquait était la **lisibilité du chemin**. La carte portait huit à dix
lignes, dont **une seule en corps de texte** — le nom de la prestation. Le reste
était en caption ou en mono capitales, et le bouton qui ouvre le code arrivait
en septième position, après quatre lignes en majuscules.

**Le volume n'était pas le défaut principal, la casse l'était.** Les capitales
détruisent la silhouette des mots, c'est-à-dire exactement ce qui permet de
balayer une liste sans la lire. Une durée, une date, une phrase mises en
majuscules obligent à épeler. Le mono capitales du système est l'étiquette : un
format, un réseau, un nom de mois — court, et lu comme un repère, pas comme une
information.

La règle vaut au-delà de cet écran, et trois autres endroits l'enfreignaient :
la date d'une reprise dans les réglages, et dans le bandeau de reprise une
phrase entière avec sa liste d'écrans puis deux dates d'affilée. Corrigés.

**Le corollaire de composition** : une liste répond à « qu'est-ce que je dois
faire », pas à « comment mon dossier est instruit ». L'échéance, l'arbitrage et
le numéro de tentative décrivaient l'instruction ; ils vivent sur l'écran de la
contrepartie, où la comparaison a un sens. Sur la liste ils coûtaient trois
lignes par carte pour une question qu'on n'y pose pas.

**Et le corollaire de vérification** : un champ qu'on retire d'un écran doit
être cherché ailleurs avant, pas après. L'adresse a failli disparaître du
produit — elle n'était rendue que sur cette liste, et l'écran du code, où l'on
part réellement, ne disait **rien** du salon, pas même son nom. Le schéma servi
ne le portait pas non plus. « Elle est déjà là-bas » se vérifie ; ici c'était
faux, et le retrait sans la vérification aurait fait perdre l'adresse.

**Le rapport entre les deux retours était un seul défaut.** « Impossible de
trouver où afficher le QR » et « il y a trop de texte » ne sont pas deux
observations : le chemin n'était pas rompu, il était noyé. Une composition trop
chargée ne se signale pas comme un défaut de composition — elle se signale
comme une fonction manquante.
## 2026-08-24 — Le fil v3.1 : la ligne unique paie la barre de recherche

**La recherche était servie et n'avait aucun bouton.** La route du fil accepte
`recherche` depuis des jours ; l'écran n'avait pas de quoi la remplir, donc une
capacité entière du produit n'existait pour personne.

**Les catégories passent sur une ligne défilante.** Deux lignes avec « All »
détaché prenaient 86 points ; une ligne de pilules en prend 34, et les 52 rendus
paient la barre à 48. Le chrome ne grandit pas, il se réorganise — ce qui
grandit est ce qui reste **collé**, et c'est le prix demandé.

Ce que la ligne unique perd est la garantie de tout voir : les deux dernières
catégories sont hors champ. C'est la recherche qui rachète le défilement, pas
l'inverse — une option cachée serait un cul-de-sac si rien d'autre ne la
trouvait.

**La bande collante vit dans les quatre états**, et c'est le vide qui l'impose :
un filtre qui ne rend rien doit avoir une sortie. Ma première écriture la
réservait à l'état nominal, et un test existant l'a dit tout de suite — il
gardait précisément cette règle.

**Le cœur est optimiste, et la mutation a d'abord survécu.** Avec un double qui
répond tout de suite, « remplir puis appeler » et « appeler puis remplir »
rendent le même écran. Une promesse qui ne se résout jamais sépare les deux : le
décor qui manquait est une réponse **qui ne vient pas**.

Le retour en arrière **oublie** au lieu de poser l'inverse : écrire
`!versFavori` écraserait un second appui parti entre-temps ; retirer la
dérogation rend la main à ce que le serveur dit, qui est la seule chose qu'on
sache encore.

**`brand.700` et non `brand.500` pour le cœur plein, et c'est mesuré.** La
planche demande l'orange de marque ; sur le voile blanc il donne 2,36:1, sous
les 3:1 qu'un élément graphique porteur d'information doit tenir. Or le
remplissage est **le seul signe** qui distingue « gardé » — le rendre à peine
visible revient à ne pas le rendre. `brand.700` est l'encre calibrée de la
marque, 5,29:1, déjà portée par les autres glyphes orange du produit.

**Le remplissage est une exception nommée**, avec sa garde. Le jeu d'icônes
n'avait pas de plein et son en-tête le dit ; le cœur y déroge parce que son état
*est* son remplissage. Une exception sans garde devient une porte : rien
n'empêcherait de poser `rempli` sur la coche ou l'alerte, et le jeu perdrait en
trois écrans ce que son en-tête promet.

**Une contradiction signalée et non tranchée.** La planche écrit « le favori
porte sur le salon, pas sur la prestation » ; le contrat livré fait l'inverse —
`est_favori` sur l'article, `POST` avec un `catalog_item_id`, et une liste de
prestations. Livré au niveau de la prestation, qui est le seul cohérent de bout
en bout. Feindre le niveau salon au-dessus d'une API d'articles aurait demandé
de deviner quels articles appartiennent au même cœur, et se serait trompé au
premier écart.

---

## 2026-08-24 — Le premier message que personne n'a demandé

**Deux notifications de favori arrivent, et elles ne ressemblent à rien de ce
que le produit envoie.** La règle qui a retiré les préférences par genre tient
parce que **tout ce que le produit dit aujourd'hui est transactionnel** : une
réservation qu'on a faite, une publication qu'on a envoyée, une décision qu'on
attend. Refuser ces messages-là revient à refuser de savoir ce qu'on a
soi-même déclenché — c'est pourquoi un mur d'interrupteurs ne servait à
personne.

Ces deux-là partent trois semaines après un cœur posé, un mardi, sans que
personne n'ait rien demandé. C'est la première fois que le produit parle de
lui-même, et c'est le genre de message dont l'absence de refus se paie en
désinstallations.

**L'interrupteur vit sur l'écran des favoris.** Dans les réglages, il serait un
interrupteur dont le sujet n'est pas à l'écran — exactement le défaut
diagnostiqué sur « profil et mise en ligne », un onglet dont on ne comprenait
pas l'objet. Sur la liste, il est au-dessus de la chose qu'il gouverne, et il
n'apparaît pas quand elle est vide : il n'y a alors rien dont on puisse être
prévenu.

**Un seul, pas un par favori.** Un par ligne recréerait le mur qu'on vient de
retirer, une case à la fois.

**Il n'est pas dessiné**, et c'est la même règle que partout ailleurs : un
interrupteur qui ne commande rien est pire que son absence. La place est
décidée et consignée ; le champ est demandé.

**Et la liste se lâche autant qu'elle se garde.** Le cœur y était décoratif,
avec pour raison que « retirer se fait là où l'on a posé ». C'était faux pour la
moitié des lignes : un salon qui ne paraît plus n'est dans aucun fil, donc son
favori n'aurait jamais eu d'endroit où être retiré — la liste se serait remplie
une fois pour toutes, et c'est l'état où elle doit le plus servir.
## 2026-08-23 — La publication d'un commerce reste un geste, jamais un effet de bord

La planche de la mise en ligne suppose que le bandeau « s'efface au dernier
point coché » : cocher la dernière condition publierait le salon. C'est
tranché contre elle. **Le dernier point rend la publication possible, il ne la
déclenche pas.**

La raison n'est pas technique — `activerLeCommerce` pourrait être appelé tout
seul. Elle est que publier est la seule décision du produit qui expose un
commerce à des inconnus : son nom, son adresse, ses prestations, ses créneaux.
Une décision de cette nature ne se prend pas par ricochet en cochant une case
de capacité. Un salon choisit le moment où il apparaît, et ce moment lui
appartient — il peut avoir une raison de le retarder que le produit ne connaît
pas.

**Et l'écran doit le dire, sinon la règle est invisible.** La confusion a lieu
à un instant précis : tout est vert, et rien ne s'est passé. Un gérant qui
croit être en ligne ne le vérifie pas — il attend des réservations qui ne
viendront jamais. La phrase vit donc sur l'état « prêt » seulement, entre le
compte et le bouton : elle répond à « pourquoi ne suis-je pas visible » juste
avant d'offrir le geste qui y répond. Sur un bandeau incomplet elle
répondrait à une question qu'on ne se pose pas encore, et diluerait les points
qui restent.

**Le corollaire, tranché en même temps** : le bandeau ne devient pas non plus
une ligne de confirmation après publication. La planche la veut — « vous êtes
en ligne · 41 créatrices peuvent vous réserver », effacée au bout de sept
jours. Les deux données manquent : aucune date de publication n'est servie,
donc la règle des sept jours n'a pas d'origine, et la portée locale ne vit que
sur les rapports. **Une ligne qui affirmerait l'une ou l'autre à l'estime serait
une confirmation fausse, et une confirmation fausse est pire que pas de
confirmation** — elle est crue. Le bandeau s'efface simplement.

**RENVERSÉ LE 2026-08-24, et la raison survit au renversement.** Les deux
données sont servies depuis les #308 et #310 — `en_ligne_depuis`,
`createurs_qui_peuvent_reserver` et `confirmation_jours` — et la ligne de
confirmation est composée. Ce qui était vrai reste vrai : elle ne devait pas
s'écrire *à l'estime*. Ce qui était faux est la phrase « ce n'est pas un report
en attendant les champs » — c'en était un, et je l'avais écrit comme une
décision définitive parce que rien n'était en cours pour les servir.

**La leçon est celle de l'audit du même jour, retournée contre moi.** Un
document qui dit « jamais » quand il veut dire « pas avec ce qu'on a » est faux
dès que ce qu'on a change. La formule juste était : *tant que la date de
publication et la portée locale ne sont pas servies, la ligne ne s'écrit pas.*
Elle nomme la condition, donc elle se périme d'elle-même — et personne n'a à se
demander si la décision tient encore.

**Mais une formulation ne se protège pas seule du temps, et l'autre moitié de la
leçon est un geste.** La conversation qui a livré la ligne avait la demande
directe de Daniel : sa livraison était juste. Ce qui a manqué est qu'elle a lu
`TASKS.md` pour **sa tâche** et non pour **son sujet**, et n'a donc pas vu
l'arbitrage rendu deux jours plus tôt.

`CLAUDE.md` écrit déjà ce coût pour les entrées dupliquées — « une copie
décochée d'une décision prise fait refaire un arbitrage déjà rendu ». Il vaut
mot pour mot pour une entrée **renversée**, qui est pire : elle est cochée, donc
elle a l'air à jour, et rien n'invite à la relire.

Deux gestes, dans les deux sens : **chercher le sujet dans les deux fichiers
avant de cocher**, et **nommer le renversement en une ligne dans le rapport**
quand il y en a un. Ici, c'est le hasard qui a joué — je n'ai vu la
contradiction que parce que la livraison m'avait nommé les fichiers touchés.

---

## 2026-08-24 — L'interrupteur posé, et un genre plutôt que deux

Le champ est arrivé avec le nom demandé, sur `app_user` et non sur le profil
créateur — la boîte d'envoi lit déjà l'utilisateur au moment de sortir, et
l'anonymisation vide le profil en gardant le compte. Rien n'en change pour
l'écran : le champ arrive sur `/me` comme la langue.

**L'interrupteur est optimiste, comme les deux autres gestes de cet écran.** Un
interrupteur qui attend le réseau se presse deux fois, et le second appui annule
le premier.

**Et le décor a dû être refait deux fois, pour la même raison qu'ailleurs.** Le
double rendait toujours l'ancienne valeur, donc l'interrupteur revenait et le
test accusait l'écran — un double qui ne se comporte pas comme le serveur
n'éprouve pas le produit. Puis, une fois qu'il répétait la valeur posée,
« basculer puis enregistrer » et « enregistrer puis basculer » rendaient le même
écran : c'est la troisième fois cette semaine qu'une réponse **qui ne vient
pas** est le seul décor qui sépare les deux.

**Un genre de notification, pas deux, et l'argument est celui du dépôt.** La
prestation qui devient accessible et le salon qui la rouvre disent la même chose
au lecteur — « tu peux la réserver maintenant » — et appellent le même geste.
Deux genres offriraient d'en couper un et pas l'autre, ce qui n'a pas de sens.
C'est exactement ce qui avait été tenu pour `collaboration.closed_no_fault`,
qui partage son genre avec la non-honoration. Invisible de l'écran, qui n'a
qu'un interrupteur dans les deux cas.

**Le refus se lit à la sortie, pas au dépôt.** La boîte range un identifiant et
non une adresse précisément pour que la préférence se relise au moment d'envoyer
— quelqu'un qui coupe l'avis entre les deux est entendu. Et l'écart porte sa
propre raison, distincte de « compte injoignable » : un refus ne doit pas se
lire comme une panne.

---

## 2026-08-24 — La grille large, mesurée puis virtualisée

**Le chiffre a décidé, comme annoncé.** Sur quatre-vingts créatrices : six
portraits montés sur le téléphone, **quatre-vingts** sur la grille large, pour
le même contenu. `Image` décode avant de réduire — c'est treize fois le même
coût, sur l'écran qui a le plus de place et pas le plus de mémoire.

`colonnes` entre donc au contrat de `liste`. Il ne se change pas en vol : React
Native refuse un `numColumns` qui bouge sur une liste montée, et le défileur
porte une clé qui en dépend — traverser le seuil le remonte, ce qui est déjà un
changement de disposition.

**Le bloc n'est pas mort pour autant** : il sert l'état d'erreur, où l'on rend
des données datées sous un bandeau. Une liste qu'on relit plutôt qu'on ne
parcourt n'a rien à virtualiser.

**La mesure reste comme garde.** Elle tient le chiffre et non la disposition :
elle tomberait aussi si quelqu'un remettait la grille en bloc, ce qui est le
seul retour en arrière possible.

**L'accueil se mesure maintenant dans les deux langues.** La bascule n'est pas
atteignable depuis l'écran, mais elle n'a pas à l'être : `expo-localization` lit
la langue du navigateur sur le web, et Playwright la pose. L'espagnol est plus
long, et c'est lui qui décide de la hauteur réelle — les deux tombent sous la
même mutation.

**Et une enquête abandonnée, dont le résultat vaut d'être écrit.** Le worker qui
ne sort pas proprement n'est pas un fichier : à un worker l'avertissement
disparaît, à deux il revient, et les deux moitiés de la suite le déclenchent
chacune. `--detectOpenHandles` sort propre parce qu'il force le mode série,
c'est-à-dire qu'il supprime la condition qu'on cherche. L'outil qui nommerait le
handle change le mode d'exécution qui le produit — c'est ce qui rend ce défaut
coûteux, et c'est consigné plutôt que laissé en « pas trouvé ».

---

## 2026-08-24 — `bg.sunken` est un fond sombre, et son nom dit le contraire

Retour de campagne sur la journée du commerce : « au niveau de *today only,
places today*, une zone noire apparaît avec un plus et un moins. Invisible sur
fond noir, incompréhensible. »

Le compteur de places n'avait rien perdu. `bg.sunken` est le plus sombre de la
palette — plus sombre encore que `bg.inverse` — et le fichier de jetons le range
explicitement dans le kit d'accommodation des deux écrans déclarés hors système.
Mais « sunken » se lit « renfoncement », et un renfoncement se pose d'instinct
sur une surface claire. **Le nom du jeton décrit son apparence dans un thème et
pas son rôle**, et c'est ce qui l'a rendu piégeux.

Huit surfaces s'y étaient trompées, et aucune ne rougissait :

- le compteur de places de la journée — le défaut signalé ;
- la piste d'une barre de progression des paliers : le vide peint en noir, si
  bien que le remplissage se lisait comme le manque. **Même famille que les
  barres par palier des rapports**, corrigées il y a des semaines ; celle-ci
  était restée ;
- un champ désactivé, noir avec son texte sombre dessus ;
- les jours indisponibles et les créneaux pris du sélecteur, qui passaient au
  plus appuyé de la grille alors qu'ils sont ce qu'on ne peut **pas** prendre —
  la forme disait l'inverse de l'état ;
- la ligne du salon courant dans la barre latérale, un bandeau noir ;
- deux fonds de média, incohérents avec `media.placeholder` qui existe pour ça.

Le renfoncement clair est `bg.deep`. Le fond d'un média est `media.placeholder`,
qui en porte la valeur sous le nom de son usage — et c'est la leçon générale :
**un jeton nommé par son rôle survit à un changement de palette, un jeton nommé
par son apparence ne survit pas.** `bg.sunken` aurait dû s'appeler quelque chose
comme `bg.onDark`.

Une garde nomme désormais les fichiers autorisés à le peindre. Elle n'interdit
pas — un écran sombre a le droit d'exister, la visionneuse en est un — elle
exige que ce soit écrit, donc décidé.

**Ce qu'aucun test ne pouvait voir.** Les contrastes sont éprouvés jeton par
jeton, et chaque paire employée ici est conforme *dans son thème*. Ce qui manque
est le croisement — quel fond avec quelle encre, dans quel fichier — et il ne se
lit qu'à l'écran, ou par une liste tenue à la main.

---

## 2026-08-24 — Un geste se replie, un état reste

L'écran du matin portait, avant la journée elle-même, une carte de cinq lignes
et deux contrôles pour ajuster les places du jour. Tous les jours, y compris
ceux où personne n'y touche.

C'est la règle des réservations, transposée : **une liste répond à « qu'est-ce
que je dois faire », pas à « comment on ajuste ».** La carte répondait à une
question qu'on se pose rarement, en tête de l'écran qui répond à celle qu'on se
pose chaque matin.

Le partage se fait sur une distinction que le produit applique déjà au bandeau
de mise en ligne : **un geste disparaît une fois rendu accessible, un état non
résolu a le droit de rester.** Une exception posée — jour fermé, places coupées
— est un état : le gérant doit le voir sans le chercher, sans quoi il se demande
pourquoi sa journée est vide. Une journée qui suit la semaine type est le cas
normal, et le cas normal n'occupe rien.

**Et le test se pose sur `exceptionId`, pas sur une comparaison de nombres.** Un
salon peut poser une exception qui rend le même compte que sa semaine type ; il
l'a posée, elle existe, et la replier la rendrait introuvable. Une implémentation
qui comparerait les deux nombres passerait tous les autres cas.

---

## 2026-08-24 — Un rang survit à une palette, une valeur non

La règle du jeton nommé par son rôle demandait une correction, et la correction
vaut mieux que la règle : **ce n'est pas le mot visuel qui tue, c'est le mot
absolu.**

`ink.soft`, `ink.mute`, `ink.faint`, `line.default` et `line.strong`, `bg.inverse`
sont tous des mots d'apparence, et tous survivent — parce qu'ils décrivent un
**rang** ou une **relation**, pas une valeur. « Le plus discret des encres »
reste vrai dans n'importe quelle palette ; « l'inverse de la page » aussi.
« Enfoncé » ne reste vrai que dans celle où on l'a écrit.

Le test à passer sur un nom de jeton est donc : *reste-t-il vrai si la palette
s'inverse ?*

Cinq noms ne le passaient pas, et sont renommés :

| avant | après | ce qu'il nommait |
|---|---|---|
| `bg.deep` | `bg.inset` | le creux, sur surface claire |
| `bg.sunken` | `bg.onDark` | le fond des écrans sombres |
| `line.ink` | `line.solo` | le filet qui sépare sans surface |
| `elevation.float` | `elevation.overlay` | l'ombre d'un calque au-dessus |

`bg.deep` et `bg.sunken` étaient le vrai piège : deux quasi-synonymes aux **deux
extrémités** de l'échelle de clarté. Huit surfaces s'y étaient trompées.

`size.hit` et `size.listRow` sont retirés — le premier doublait `size.touchMin`
à la même valeur, le second n'était lu nulle part.

**Le renommage touche la passation, et c'est voulu.** Une garde vérifie que
toute valeur énoncée par Design est celle de l'app ; un nom qui change d'un côté
seulement crée exactement la seconde vérité qu'elle interdit. Les documents
**archivés** de la v1.0 ne sont pas réécrits, ni l'export `.dc.html` de l'outil
de Design : ils enregistrent un état passé, et le réécrire serait un mensonge
d'un autre genre.

**La famille `mono` attend.** `type.mono`, `monoSmall`, `monoDisplay`,
`monoFigure` sont nommés par leur fonte — et `type.monoSmall` fait 11 px, comme
`type.label`, pour le même travail. La couche produit porte déjà `type.figure`
(44 px) à côté de `type.monoFigure` (32 px) du socle : deux jetons pour « un
nombre », l'un par rôle, l'autre par fonte. Soixante-trois appels sur deux
couches : c'est une tranche à part.

---

## 2026-08-24 — L'avertissement se distingue par son glyphe, pas par sa teinte

`status.warning` porte exactement les valeurs du neutre : sa surface est
`bg.inset`, son encre `ink.default`, son filet `line.solo`. Ce n'est pas une
palette qui aurait cessé d'honorer un rôle — **c'est une décision de Design** :
un ambre dans un système ambre se lirait comme la marque. L'avertissement est
donc neutre en couleur, et ce qui le distingue est un **glyphe obligatoire**.

D'où son mode de panne, qui lui est propre : **`status.warning` posé seul ne dit
rien.** Il rend les mêmes pixels que l'encre ordinaire, et l'auteur croit avoir
posé une alerte. Cinq endroits s'y étaient trompés — la pastille du sélecteur de
salon, un état « en pause » qui annonçait un défaut là où le message dit « rien
n'est perdu », deux motifs de refus dans des historiques, un libellé de tâche.
Aucun n'a été trouvé par relecture : le rendu est identique dans les deux cas,
et c'est le nom du jeton, pas l'écran, qui portait la fausse promesse.

Ce qui manquait n'était donc pas une teinte, mais la garde. Elle a trois verrous,
et aucun ne suffit seul :

1. **Le mécanisme** — `StatusMessage` rend le glyphe de l'avertissement, et le
   neutre n'en a pas. C'est la seule distinction qui reste ; un glyphe rendu à
   tous les niveaux passerait le premier test et ne distinguerait plus rien.
2. **La décision, épinglée** — les trois valeurs sont comparées aux neutres. Le
   jour où quelqu'un donne une teinte à l'avertissement, le test tombe : la
   règle du glyphe ne se justifie que par l'absence de teinte, et changer l'une
   sans revoir l'autre laisserait une règle sans sa raison.
3. **L'inventaire** — cinq fichiers peignent l'avertissement de leur propre
   main, et chacun déclare **ce qui** garantit son glyphe : la propriété `icone`
   obligatoire de `Bloc`, le champ `icone` du type `Cas`, une `Icone` alerte
   rendue à côté. Le garant se vérifie, il ne se déclare pas : sans cette
   moitié, un avertissement ajouté sans glyphe dans un fichier déjà listé
   passerait.

**Et une pastille qui appelle n'est pas une pastille qui alerte.** Le compte de
décisions du sélecteur portait `status.warning` : un salon qui attend n'est pas
en défaut. Il passe au pâle de la marque — attirer l'œil sans accuser, dans le
registre qui sert déjà à marquer la ligne active.

**Le défaut de la garde, trouvé en l'écrivant.** Son premier jet filtrait les
commentaires ligne à ligne, et dans un bloc `{/* … */}` les lignes **de suite**
ne commencent ni par `//` ni par `*`. Le fichier était donc compté comme
peignant ce qu'il se contentait d'expliquer — et la correction naturelle aurait
été de retirer la note, c'est-à-dire de perdre l'explication pour sauver la
garde. Les deux gardes de ce fichier retirent désormais les commentaires pour de
bon.
## 2026-08-24 — La configuration v3.1 : par objet, ce qui révèle la fréquence

**Deux portes deviennent trois de rang égal.** La v3 séparait par fréquence — le
geste rare d'un côté, le geste du matin sur la journée — et son seau « rare »
contenait deux fréquences confondues : un lieu se compose **une fois**, un
catalogue vit **en continu**. Séparer par objet révèle la fréquence que la
maille précédente avait manquée. Ce n'est donc pas une troisième découpe, c'est
la même appliquée jusqu'au bout.

**Les horaires rejoignent la couverture**, et c'est la conséquence la moins
évidente : des heures d'ouverture décrivent un endroit, pas une prestation. La
page de l'offre se réduit une seconde fois sans rien perdre.

**Le corps des horaires est extrait, pas dupliqué.** `HorairesScreen` garde sa
coquille pour la pile du téléphone ; le lieu rend le même corps. Deux corps
auraient fini par diverger, et c'est celui qu'on regarde le moins qui aurait
dérivé.

**L'état vide du catalogue redevient ce qu'il dit.** Tant que la galerie y
vivait, un commerce qui avait déposé ses photos n'était pas devant un écran
vide, et la condition portait les trois listes. L'écran ne parle plus que de
prestations : « vide » veut dire « aucune prestation ».

**La photo par prestation existait en base et nulle part ailleurs.**
`photo_key` était déclarée corrigeable, la route de dépôt existait, et rien ne
les reliait — aucun écran ne savait produire de clé. Une capacité déclarée que
rien ne sait exercer n'est pas une capacité, c'est un champ ; c'est le pendant
exact du champ accepté par un schéma et ignoré par un service.

Elle est **trouvable par son absence** : un cadre pointillé dans la liste, et
« needs a photo » en état. Aucun texte n'explique la fonction — un intitulé
« ajoutez une photo de prestation » aurait décrit une capacité au lieu de la
rendre évidente.

**Ce que je n'ai pas fait, et pourquoi.** La planche montre un tableau à quatre
colonnes avec panneau latéral, dessiné à 1512. Sur 390, quatre colonnes ne sont
pas des colonnes — et c'est le format que le commerce utilise au comptoir. La
vignette et l'état sont dans la liste, le reste était déjà dans le panneau de
correction ; le tableau demande une décision de disposition qui n'est pas
tranchée par la planche.

---

## 2026-08-24 — La capacité reste au lieu, et le résumé se répartit

**La capacité est une propriété de l'endroit.** Design la range avec les
horaires tout en notant qu'elle se règle à la fréquence d'un catalogue, et
laisse la question ouverte : si elle bouge souvent, elle appartiendrait à la
journée.

L'arbitrage retourne la question. Un nombre de fauteuils décrit le lieu, et
l'exception du jour existe déjà pour les écarts. **Si la capacité déclarée
bougeait souvent, ce serait le signe qu'elle est fausse, pas qu'elle est au
mauvais endroit** — la fréquence mesurerait une erreur de déclaration, pas un
besoin de déplacement.

**Le résumé de composition ne méritait pas un endroit mais trois.** Il disait à
un salon ce qui manque avant qu'il apparaisse ; sa table des matières est
partie, sa fonction reste.

Deux de ses trois nombres se comptent dans les écrans qui tiennent déjà la
matière : les prestations dans la liste des prestations, les jours ouverts sur
le lieu. Un appel pour un nombre qu'on peut compter serait un second appel pour
une donnée qu'on a en main, et deux comptes qui finiraient par diverger.

**La définition est recopiée du serveur, pas réinventée.** Le parent d'une gamme
n'est pas une prestation — il ne se réserve pas et ne s'affiche jamais seul — et
la visibilité se lit sur `is_effectively_available` : une variante dont le
parent est fermé n'apparaît nulle part quel que soit son propre interrupteur.
C'est le cas qu'on croit ouvert, et c'est la seconde mutation.

**Le troisième nombre n'est pas dérivable.** `en_ligne_depuis` vient du journal
d'audit, et il a un endroit tout trouvé : `VueDActivation`, que la journée
charge déjà et sur laquelle vit le bandeau de mise en ligne. **La règle des sept
jours l'attend depuis la v3** — c'était écrit dans `TASKS.md` le jour où le
bandeau a été composé sans elle. Demandé plutôt qu'obtenu par un second appel
sur l'écran le plus ouvert du produit.

---

## 2026-08-24 — Trois entrées dupliquées, et une décision que j'ai rouverte pour rien

**`TASKS.md` portait trois blocs en double**, chacun dans la même forme : une
version tranchée en haut, et la copie périmée d'origine plus bas. Deux d'entre
elles étaient encore décochées alors que la décision était prise.

C'est ce qui m'a fait écrire que la règle des sept jours « attend une date
depuis la v3 ». Elle n'attend rien : elle est **tranchée**, et le texte de la
version à jour dit pourquoi — les deux données manquent, la date de publication
et la portée locale, et « une ligne qui affirmerait l'une ou l'autre à l'estime
serait une confirmation fausse, ce qui est pire que l'absence de confirmation ».

`en_ligne_depuis` donne donc une **origine** à la règle des sept jours, et rien
de plus. La phrase que la planche veut écrire a besoin de la paire ; qui prend
la date décide en même temps de la portée, ou le bandeau reste ce qu'il est.

**Le fichier est le canal entre les conversations**, et c'est ce qui rend un
doublon coûteux : une copie décochée d'une décision prise fait refaire un
arbitrage déjà rendu. C'est exactement ce qui vient de m'arriver — j'ai lu la
copie, pas l'originale.

La cause est la même que celle déjà écrite dans `CLAUDE.md` pour les
suppressions : `TASKS.md` est une liste, deux sessions y ajoutent, et une
résolution qui garde les deux côtés duplique un bloc au lieu d'en perdre un.
Garder les deux reste la bonne règle — mais un doublon se relit, et celui-ci a
tenu assez longtemps pour tromper quelqu'un.
## 2026-08-24 — La famille mono fusionne vers ses noms de rôle

Quatre jetons nommés par leur fonte, quatre nommés par leur rôle, dans **une
seule table plate** : le socle préfixé `type.`, le produit portant déjà son
préfixe. Ce sont des frères, pas deux niveaux.

| avant | après | ce qu'il sert |
|---|---|---|
| `type.monoDisplay` | `type.figure` | le nombre qu'un écran met en avant |
| `type.monoFigure` | `type.figureSmall` | le nombre d'une ligne ou d'une carte |
| `type.mono` | `type.data` | une valeur lue exactement — date, identifiant, jauge |
| `type.monoSmall` | `type.dataLabel` | l'étiquette qui porte une donnée |

Les deux doublons du produit — `type.figure` à 44 px, `type.figureSmall` à 29 —
sont retirés au profit de l'échelle du socle. **Le socle gagne parce qu'il est
le contrat de Design** : retirer de son côté aurait demandé son accord, alors
que les doublons étaient à nous. Le produit garde `code` et `countdown`, qui
n'ont pas d'équivalent.

Le dernier couple règle une hésitation payée sur les réservations :
`type.label` (11 px, sans, capitales) porte des **mots**, `type.dataLabel`
(11 px, mono) porte une **donnée**. Le nom le dit désormais.

**Ce que la fusion a révélé, et qui valait plus qu'elle.** Le *même* score de
fiabilité était rendu par deux jetons : `monoDisplay` sur son écran de détail,
`figure` dans les règles des paliers. Deux écrans, un nombre, deux graisses. Ni
l'un ni l'autre n'était fautif isolément ; il fallait ouvrir les deux fichiers
de jetons côte à côte, ou les deux écrans, et personne ne fait ni l'un ni
l'autre.

---

## 2026-08-24 — Deux couches qui se masquent en silence

`Object.fromEntries` garde le dernier, et le produit est étalé en dernier. Une
clé du produit portant le nom d'une clé du socle **l'écrase sans rien dire** :
même variante appelée, autre taille, autre graisse, et aucun test ne bouge — le
nom existe toujours, il ne désigne simplement plus la même chose.

C'est un défaut plus grave que le nommage qui l'a fait remarquer, et il lui
survit : il ne se voit sur aucun écran isolé. Une garde le nomme désormais, et
elle a deux moitiés — la seconde parce qu'« aucun nom disputé » est vrai d'une
famille **vide**, et qu'un `variantes()` qui rendrait `[]` sur le produit ferait
taire la collision tout en perdant quatre variantes, sans un seul rouge.

**Cette seconde moitié a servi dans l'heure qui a suivi son écriture**, et pas
pour ce qu'elle visait. La garde de l'échelle des chiffres comparait la famille
à `familles.mono`, qui porte le **nom de la fonte** quand `fontFamily` porte le
**rôle** : la famille ressortait vide, et la règle passait au vert sur zéro
jeton. En la réparant, un défaut vivant est apparu.

**Les deux couches épellent la famille différemment.** La passation nomme la
fonte — « IBM Plex Mono » — parce qu'elle décrit un système ; le produit nomme
le rôle — « mono » — parce qu'il en consomme un. La fonction qui décide du rôle
ne connaissait que la première : **`type.code` et `type.countdown` sortaient en
sans**, c'est-à-dire le code de retrait montré au comptoir et son décompte. La
passation le spécifiait pourtant noir sur blanc — « Chiffres en `type.code`
(mono 76), lisibles à 1,20 m ».

Rien ne pouvait le dire : l'alphabet du code écarte déjà les caractères qui se
confondent, et un chiffre en sans reste un chiffre. C'est le même mode de panne
que l'avertissement sans glyphe — une règle écrite dans la passation, vraie,
et que rien n'exécutait.

**La règle qui l'aurait attrapé, et qui garde maintenant l'échelle : dans le
monospacé, la taille désigne le rôle.** Le corps a `body` et `bodyStrong` à
16 px, le titre a sa variante accentuée — ce sont des paires voulues, une
graisse distinguant deux emplois du même rang. Les chiffres n'ont pas de paires :
chaque cran est un usage, du code à six chiffres jusqu'à l'étiquette qui porte
une date.

---

## 2026-08-24 — Une décision tranchée remplace sa version antérieure

**Quatre doublons de plus, dont deux décochés.** Après les trois premiers, un
balayage complet en a trouvé quatre autres : la version périmée restée sous sa
remplaçante. Deux étaient encore décochées — « quatorze champs à instruire » et
« le compte des reprises arrive après l'ouverture » — alors que les deux
décisions étaient rendues.

La règle est maintenant dans `CLAUDE.md`, à côté de celle qui la produit :
garder les deux côtés vaut pour deux entrées **différentes** ; quand les deux
portent la même à deux stades, la tranchée remplace. Ce qui vaut d'être gardé de
la version d'avant va dans ce fichier-ci, dont c'est le rôle.

**Et la garde ne couvre qu'une forme, ce qui est écrit partout où on la lit.**
Elle attrape le titre repris presque mot pour mot — deux des sept paires. Elle
ne voit pas une version reformulée, et ce n'est pas un seuil à baisser : mesuré
sur les six paires trouvées et les quatre paires légitimes, **les deux familles
se chevauchent**, 0,45 à 1,0 contre 0,5 à 0,6. Descendre attraperait « niveau
1 » et « niveau 2 ».

Un dernier test affirme donc explicitement ce qu'elle laisse passer, en nommant
la paire qui a coûté la demi-heure. Une garde bornée qui dit sa borne n'est pas
la garde partielle que `CLAUDE.md` proscrit : celle-là manque la forme pour
laquelle elle a été écrite et fait croire la question réglée. Celle-ci couvre sa
forme entièrement, et écrit le reste au lieu de le suggérer.

---

## 2026-08-24 — `--maxWorkers=1` ne prouve rien sur une fuite de worker

Le raisonnement qui a coûté l'enquête précédente vaut d'être écrit, parce qu'il
paraît juste : « l'avertissement disparaît à un worker, donc ce n'est pas un
fichier ». À un worker, Jest s'exécute **en bande**, dans le processus
principal. Il n'y a plus de worker, donc plus rien qui puisse échouer à sortir.
La disparition ne dit rien du coupable.

`--detectOpenHandles` force le même mode, pour la même raison : il ne nommait
rien parce qu'en bande il n'y avait rien à nommer. **L'outil qui nomme le défaut
change le mode d'exécution qui le produit** — c'est ce qui rend cette classe de
défaut coûteuse, et c'est aussi ce qui la rend introuvable par relecture.

Ce qui force le mode worker sur deux fichiers est `--no-cache`. La décision de
Jest tient à `tests.length <= 20 && timings.length > 0 && areFastTests` : sans
horodatage en cache, la deuxième condition tombe et les workers tournent. La
bisection devient alors mécanique — chaque fichier avec un fichier propre :

```
npx jest --ci --maxWorkers=2 --no-cache __tests__/<candidat> __tests__/format.test.ts
```

Cent deux exécutions, huit minutes, cinq fichiers nommés, reproductibles trois
fois sur trois.

**Et l'avertissement n'est pas exigé en CI.** Il dépend d'un budget de démontage
de 500 ms sur un runner partagé, ce qui est le profil exact de la garde de durée
retirée après quatre CI rouges. Les trois causes sont tenues par des tests
unitaires, qui ne dépendent d'aucune machine.

---

## 2026-08-24 — Un geste optimiste qui échoue doit parler

Le signalement disait « les favoris ne marchent pas ». Le mécanisme, lui,
marchait : `POST` accepté, ligne en base, fil relu à `est_favori: true`, liste
rendue — vérifié dans un navigateur contre une vraie base.

Ce qui manquait est le pendant de l'appui optimiste, et on ne l'avait écrit qu'à
moitié. Remplir le cœur avant la réponse est juste : attendre le réseau pour un
geste sans conséquence est ce qui fait dire « lent ». Mais **le retour en
arrière était muet**, et un retour muet est indiscernable d'un appui qui n'a
jamais été enregistré. C'est la forme la plus coûteuse d'un échec : il ne laisse
rien à réessayer, rien à raconter, et il se conclut en « ça ne marche pas ».

La règle qui en sort, et qui vaut partout où l'on écrit avant de savoir : **un
geste optimiste porte deux retours, pas un.** Celui qui montre qu'on a compris,
et celui qui dit qu'on n'a pas su. Le second nomme ce qui a échoué — une liste
de douze favoris ne dit pas d'elle-même lequel n'est pas parti.

**Et le compte vient du serveur.** `favoris_total` est servi par le fil, qui
charge déjà l'ensemble des favoris pour poser `est_favori` : il ne coûte ni
requête ni jointure. Le dériver des cartes rendues aurait été faux de deux
façons — il aurait oublié les favoris hors du rayon, et il aurait changé en
marchant. Un chiffre qui bouge sans qu'on ait rien fait est pire qu'un chiffre
absent.

**Aucun parcours de bout en bout ne couvrait les favoris**, et c'est ce qui a
rendu le signalement invérifiable pendant une heure : la route était éprouvée
par pytest, l'écran par des doubles Jest, et la jonction par personne. Un double
répond ce qu'on lui fait dire — le chemin de la route, la forme du corps envoyé
et la relecture sont exactement ce qu'il rend invisible.

---

## 2026-08-24 — Un code qui a l'air de faire quelque chose est plus dur à trouver qu'un code absent

En branchant la veille et la luminosité de l'écran de code, la couture était
déjà là : `CodeScreen` appelait `activer()` en prenant le focus et
`desactiver()` en le perdant, depuis des semaines. Une propriété, un `useEffect`,
un nettoyage au démontage — tout ce qu'on écrit quand on fait la chose. Seule
l'implémentation n'existait pas : la propriété était optionnelle, aucun appelant
ne la remplissait, et les deux modules n'étaient pas installés.

**C'est ce qui explique que le défaut ait survécu si longtemps.** Une relecture
de `CodeScreen` montre un écran qui garde l'appareil éveillé. Une recherche du
mot « keepAwake » le trouve, avec un jeton à `true` à côté. Rien ne dit que la
chaîne s'arrête au dernier maillon — sauf à suivre la propriété jusqu'à son
appelant, ce que personne ne fait sur du code qui a l'air complet.

Un manque franc se cherche : l'écran n'aurait rien appelé, et la question
« où est-ce fait ? » n'aurait trouvé aucune réponse. Une couture vide répond à
la question par un endroit qui a la bonne forme.

**La leçon générale.** Les trois états ne se valent pas :

1. **Absent** — se cherche, et se trouve.
2. **Présent et non gardé** — marche, et peut casser.
3. **Déclaré et non implémenté** — ne marche pas, et se lit comme si.

Le troisième est le pire, et c'est celui qu'aucune relecture n'attrape. Deux
signes le trahissent, et les deux étaient là : une propriété optionnelle que
personne ne passe, et un jeton de configuration à `true` qui n'a pas d'appelant.
La garde des routes sans appelant existe pour la même raison, un étage plus
haut ; celle des champs servis aussi. Il manquait la même chose sur une couture
interne.
## 2026-08-24 — Deux sessions, la même trouvaille, une seule version gardée

Le fil v4 rend une carte par salon, et cette carte annonce « 4 services open to
you ». Le serveur comptait `sum(len(commerce.items))` — c'est-à-dire des
**offres**. Une prestation ouverte à deux paliers accessibles y comptait deux
fois.

Tant que le mur rendait une carte par offre, les deux coïncidaient à l'écran et
personne ne pouvait le voir. Au grain du salon, la somme des cartes aurait cessé
d'égaler l'en-tête du quartier — et c'est exactement le genre d'écart qui se
signale comme « le compte est faux », après quoi on cherche l'erreur là où il
n'y en a pas.

**`bind-agency-1a` et moi l'avons trouvé chacun de son côté, à une heure
d'intervalle**, et sa version est meilleure : un champ `prestations_ouvertes`
servi par salon, et les trois niveaux — salon, quartier, total — passant par la
même fonction. La mienne dédoublonnait dans l'écran, ce qui aurait tenu
aujourd'hui et menti le jour où la liste sera bornée.

J'ai jeté la mienne. Deux calculs de la même chose finissent par diverger, et
c'est celui qu'on regarde le moins qui ment — la règle vaut aussi entre deux
sessions qui travaillent en parallèle. Ce qui l'a rendu peu coûteux est d'avoir
annoncé ce que je touchais **avant** de pousser : le message est parti au début
de la tranche, sa PR est arrivée pendant, et il n'a fallu qu'un rebase.

**Le mot comptait autant que le nombre.** Un « service » est ce qu'on va faire
faire, pas le palier par lequel on l'atteint.

## 2026-08-24 — Le web ne démonte pas ce qu'on croit, quand on le croit

Le compte de la porte des favoris est servi par le fil, et la pile garde cet
écran monté sous la fiche : rien ne le rafraîchit au retour. La première
version incrémentait un signal **au démontage de la fiche**, pour n'envoyer
qu'une requête par visite plutôt qu'une par cœur pressé.

Elle ne marchait pas, et aucun test unitaire ne pouvait le dire : ils pilotent
la version à la main, donc ils éprouvaient le fil, jamais le moment où le signal
part. C'est le parcours de bout en bout qui l'a montré — le compte restait à
zéro après un retour.

Deux choses en sortent. La première : **un signal accroché à un cycle de vie de
navigation est un pari sur le navigateur**, et le pari se perd sur le web. Il
part maintenant au geste ; une requête de fil par cœur pressé est le prix, et
elle part pendant qu'on est ailleurs, sur un écran que rien ne redessine.

La seconde tient au test lui-même : `page.goBack()` **sort de l'application**.
La pile est atteinte par une navigation interne, il n'y a pas d'entrée
d'historique derrière elle, et le navigateur remonte à la page d'avant —
mesuré, il atterrit sur `about:blank`. Un parcours revient par le contrôle de
l'écran, comme un lecteur.

---

## 2026-08-24 — Un troisième mode de perte : la version d'avant

Deux façons de perdre du travail étaient déjà écrites dans `CLAUDE.md` : le
fichier **effacé**, que `git diff --diff-filter=D` nomme, et le `git reset
--soft origin/main` suivi d'un `git add -A`, qui enregistre le retrait de tout
ce qui a été fusionné entre-temps.

En voici une troisième, rencontrée en reportant une tranche sur une branche
propre :

```
git checkout -B ma-branche origin/main
git checkout autre-branche -- app/src app/__tests__
```

Le second `checkout` ne prend pas *mes* modifications, il prend **l'arbre entier
de l'autre branche** pour ces chemins. Tout fichier que `origin/main` a reçu
depuis que cette branche a divergé revient à sa version d'avant. Quatre fichiers
d'une PR fusionnée une heure plus tôt ont ainsi été ramenés en arrière.

**Et la garde ne pouvait pas le voir.** `--diff-filter=D` ne nomme que ce qui
n'existe plus ; ici tout existe, avec le bon nom, la bonne taille, et un contenu
plus ancien. Ce n'est pas une suppression, c'est une régression — le seul des
trois modes qui laisse l'arbre complet.

**Ce qui l'a rattrapé est une garde qui ne visait pas ça.** Les clés de
traduction ont réclamé deux clés appelées par les écrans de l'autre PR et
devenues introuvables, parce que mon `en.ts` était celui d'avant. Ni les types,
ni les tests des écrans concernés — ils étaient revenus en arrière **ensemble**,
donc cohérents entre eux.

C'est la leçon qui vaut d'être gardée : **une régression cohérente ne se voit
que depuis un point de vue qu'elle n'a pas emporté.** La garde des clés a
survécu parce qu'elle vit dans un fichier que je n'avais pas repris — et c'est
pour la même raison que les gardes transverses du dépôt valent plus cher que
les tests d'écran.

Le geste juste, quand on reporte : prendre les fichiers **un par un**, ou mieux,
`git diff origin/main...autre-branche -- <chemins> | git apply`, qui n'apporte
que l'écart. Et relire `git diff --stat origin/main` avant de commiter : un
fichier qu'on n'a pas touché n'a rien à y faire.

---

## 2026-08-25 — Une charge processeur ne reproduit pas l'intermittence, une vraie suite oui

L'intermittence de la suite `app` a été tranchée ailleurs : ce n'était pas une
fuite mais une **marge d'attente** — `asyncUtilTimeout` au défaut d'usine d'une
seconde, sur une machine dont les durées gonflaient d'un facteur vingt. La
correction est en place et mesurée.

Reste une observation qui n'entre pas dans cette explication et qui vaut d'être
gardée, parce qu'elle **économise une piste** à qui la reprendra : la signature
s'est produite une fois pendant que `pytest -n auto` tournait sur la même
machine — dix fichiers rouges, des durées de 30 à 90 s, tout au vert au passage
suivant à froid — et elle **ne se reproduit pas sous une charge processeur
seule**. Vingt-quatre boucles occupées, la suite passe entière.

Ce que ça élimine : si la charge y est pour quelque chose, ce n'est pas le
processeur. Ce serait la mémoire ou les entrées-sorties, que la suite `api`
consomme et qu'une boucle vide ne touche pas.

Ce que ça n'établit pas : que la charge soit encore en cause du tout. La marge
d'attente explique déjà tout ce qui a été observé, et une seconde cause n'est
pas nécessaire pour rendre compte des faits. L'observation est ici comme une
piste écartée, pas comme un diagnostic ouvert.

**Et c'est pourquoi elle est ici plutôt que dans `TASKS.md`.** Y laisser
« il faut bisecter cette famille » aurait fait refaire un arbitrage déjà rendu :
le fichier des tâches porte du travail, celui-ci porte l'histoire — y compris
les hypothèses qui se sont révélées fausses, qui sont précisément ce qu'on ne
veut pas voir reprendre.

---

## 2026-08-27 — Un test unitaire ne voit pas un défaut de rendu

`accessibilityState` n'était lu par personne sur le web. Mesuré dans
`node_modules` plutôt que supposé : `createDOMProps` de cette version de React
Native Web n'en contient **aucune mention**, il lit `aria-checked`,
`aria-selected`, `aria-expanded`, `aria-disabled`, `aria-busy` en propriétés de
premier rang et ignore l'objet.

Vingt endroits l'employaient — **tous les gestes à deux états de l'application**.
Le cœur d'un favori, le `Toggle`, les onglets, les jours d'un créneau, les
sélections de l'arbitrage. Sur le web, un lecteur d'écran lisait « garder en
favori » sans jamais dire si c'était fait. Sur mobile natif rien n'était cassé :
`accessibilityState` y est la seule propriété que React Native connaisse, donc le
défaut ne se voyait que là où l'application est réellement montrée.

**Ce qui n'a pas pu le voir.** Les tests unitaires du cœur lisaient
`props.accessibilityState` : la valeur **telle qu'écrite**, jamais telle que
rendue. Ils affirmaient `selected === false`, puis `selected === true` après
l'appui, et ils passaient — des deux côtés d'un état que personne n'entendait.
Aucune relecture ne les aurait dénoncés : ils vérifient exactement ce qu'ils
disent vérifier. C'est le sujet qui était faux, pas l'assertion.

La règle qui en sort : **un test qui lit une propriété telle qu'écrite ne prouve
rien du rendu.** Il vaut pour ce que le composant décide, jamais pour ce qui
arrive à l'écran ou au lecteur d'écran. Entre les deux il y a une bibliothèque,
et elle a le droit d'ignorer ce qu'on lui passe.

**Ce qui l'a vu, et par accident.** Un parcours de bout en bout cherchait un cœur
non encore posé — `[aria-checked="false"]` — et les prenait tous, parce que
l'attribut n'existait pas. Le filtre ne filtrait rien, l'appui retirait un favori
au lieu d'en poser un, et le compteur descendait au lieu de monter. Il a fallu
trois corrections successives pour comprendre : `selected` → `checked` dans
l'objet, puis le second composant, puis la lecture de `node_modules` qui a montré
que l'objet entier était ignoré. Les deux premières n'ont rien changé, et c'est
ce qui a fini par désigner la vraie cause.

Trois heures. Ce qui les aurait évitées est de regarder le DOM une fois, au lieu
de croire trois fois que la propriété était mal nommée.

**Le remède est un composant, pas une discipline.** `etatAccessible()` pose les
deux — l'objet pour le natif, les attributs pour le web — à un seul endroit. Le
refaire à chaque appel, c'est en oublier un ; et un état oublié ne se voit pas,
il s'entend chez quelqu'un qui n'est pas là pour le dire.


---

## 2026-08-29 — Un refus en cachait un autre, et le second attendait le premier

L'import de carte annonçait le PDF depuis la phase 9. Deux choses l'en
empêchaient, et **la seconde n'était visible que parce que la première la
couvrait** : la route de dépôt refusait les PDF sur leur signature, donc aucun
PDF n'atteignait jamais l'extracteur, qui les aurait envoyés au modèle dans un
bloc `image` — refusé par l'API pour `application/pdf`.

Corriger le dépôt seul aurait donc déplacé le refus d'un cran, d'un 415 lisible
vers une erreur de modèle qui ne dit rien. **Un défaut masqué par un autre ne se
corrige pas à moitié :** en levant une garde, on cherche ce qu'elle protégeait.

Ce qui l'a laissé passer est instructif. Les tests du service passent
`mime_type="application/pdf"` partout — le critère de fin de tâche disait « un
PDF de salon en anglais et un en espagnol » — mais avec un extracteur double, et
en appelant `service.creer` directement. **Le seul endroit qui décide du format
est la route, et aucun test ne la traversait avec des octets.** Un décor qui
nomme le cas sans emprunter le chemin où il se joue ne l'éprouve pas ; il en
donne le sentiment, ce qui est pire, et le critère de fin a été coché dessus.

## 2026-08-29 — Le prix lu vaut mieux que le prix saisi, et ne se montre pas

La composition a perdu son champ de prix le 2026-08-24 : le produit ne montre
aucun montant, et `price_cents` part à zéro. L'écran de relecture, lui, demandait
encore « Price in cents » — le seul montant du produit, sur le seul écran qui en
portait un, dans l'unité la moins lisible qui soit.

**Le prix extrait est conservé et transmis, jamais affiché ni saisi.** C'est la
lecture juste de la règle : le prix est une donnée de reporting, donc il n'a pas
à disparaître — il a à ne pas être un champ. Et ce que l'extraction lit vaut
mieux, comme donnée, que le zéro qu'enregistre la composition à la main.
---

## 2026-08-28 — Une garde dit ce qu'elle ne voit pas, ou elle fait croire qu'elle voit tout

La garde des traductions attrape les clés **appelées et absentes** : un `t('…')`
qui ne résout rien affiche une chaîne technique en clair à la place d'un titre,
et c'est arrivé deux fois dans la même journée.

Elle ne voit **jamais l'inverse**. Une clé déclarée que plus personne n'appelle
reste dans les deux catalogues sans qu'un test bouge — `murAutresQuartiers` a
survécu deux refontes du fil ainsi, et c'est un audit du guide produit qui l'a
trouvée, pas la suite.

**Et le second sens ne sera pas construit.** Il coûterait plus cher : il faudrait
résoudre les clés composées, qu'une quarantaine d'appels construisent et qu'aucune
analyse statique ne suit. Il rendrait moins : son verdict porte sur du texte
mort. Une clé orpheline pèse deux lignes ; une clé manquante s'affiche dans une
phrase, à un testeur, en pleine campagne.

**Ce qui se fait à la place tient en une ligne écrite dans la garde**, à
l'endroit où quelqu'un la consulte : la limite est nommée, avec sa raison et
avec le geste qui la remplace — les orphelines se retirent à la main, quand un
lot les rend telles.

C'est la même règle que sur les jetons et sur la passation, prise par l'autre
bout : une garde qui ne dit pas où elle s'arrête fait croire la question réglée
partout où elle passe.
## 2026-08-30 — Le second passage d'un semis est muet, et on lisait sa sortie

`resume_du_semis` relançait la commande de semis pour lire son résumé ; une
optimisation lui a fait lire la sortie du **second** passage, avec le
commentaire « qui dit exactement la même chose puisque c'est la même commande
sur la même base ». Cinquante secondes gagnées, et c'est vrai du résumé.

**C'est faux de tout ce qui est conditionnel au travail réellement fait.** Le
second passage repart d'une base que le premier a remplie : il ne repose rien,
donc il n'écarte rien, donc il ne dit rien de ce qu'il a écarté. Les lignes
« réservation écartée », « parcours écarté », « journée écartée chez … » sont
absentes de sa sortie — non parce que rien n'a été écarté, mais parce que rien
n'a été tenté.

Ce que ça a coûté : deux conversations ont cherché pendant une soirée pourquoi
un salon n'avait aucune réservation du jour, l'une et l'autre en lisant une
sortie vide et en concluant « le semis n'écarte rien ». La sortie du premier
passage a répondu en une minute — et la réponse était qu'en effet rien n'est
écarté, mais on ne pouvait pas le savoir de là.

**Un test qui s'appuierait dessus pour vérifier qu'un écart est signalé
passerait au vert sans rien voir.** C'est la même famille que la garde de
traduction qui ne voit pas les orphelines, à ceci près que la limite n'est pas
écrite : le commentaire affirme l'équivalence au lieu de la borner.

Et le défaut cherché ce soir-là était ailleurs, dans une variable que personne
ne regardait : **l'heure.** À 23 h à Miami, tous les créneaux du jour sont
derrière nous, les états de la journée se réduisent à `consumed` et un test qui
en exige trois tombe. Il ne tombe pas un jour sur sept, il tombe tous les
soirs — et il repasse au vert seul le lendemain matin, ce qui est la pire forme
du défaut : il guérit avant d'être compris.

---

## 2026-08-31 — Une horloge décalée ne franchit pas la frontière du processus

`libfaketime` a payé le jour de son installation : il a trouvé en cent secondes
un manque du semis qui demandait sinon d'attendre 23 h — la journée de Wynwood,
vide le soir faute d'un créneau libre le lendemain chez un salon à un poste.

**Et il a failli en inventer un.** À 23 h 20 simulées, l'état `unfulfilled`
disparaissait du jeu de données, sur la branche comme sur `main` nu. Tout
désignait un troisième défaut préexistant, de la même famille que les deux
autres : vrai une heure sur vingt-quatre, invisible le reste du temps.

Il n'y en avait aucun. `_mener` pose l'échéance avec `datetime.now(UTC)` —
l'horloge du **processus** — et `expirer_les_echeances` filtre sur
`clock_timestamp()`, l'horloge de **Postgres**. `faketime` décale la première et
pas la seconde : l'échéance reculée de deux heures tombait dans le futur de la
base, le balayage ne voyait rien, et l'état n'existait pas. En réalité les deux
horloges s'accordent, et l'état est bien produit.

**La règle qui en sort.** Une horloge décalée n'éprouve valablement que ce qui se
décide **entièrement dans le processus** : la composition d'une journée, les
bornes d'un écran, le choix d'un créneau. Dès qu'une valeur écrite en Python est
comparée à `now()` ou `clock_timestamp()` côté base, elle traverse une frontière
que l'outil ne franchit pas, et le verdict ne veut plus rien dire — ni le rouge,
ni le vert.

Ce qui a évité la correction inutile est d'être allé lire la requête du balayage
avant d'écrire quoi que ce soit. Le réflexe coûte une minute : **avant de croire
un rouge sous horloge décalée, demander quelle horloge décide.**


## 2026-09-01 — La carte de décision ne compte pas les abonnés, et la raison n'était nulle part

La planche v12 dessinait « 7 600 followers » sous le pseudonyme, dans le bloc du
créateur de la carte de décision. La v9 avait tranché l'inverse : un visage et un
lien disent **qui**, pas **combien**. Daniel confirme la v9.

**La raison tient toujours, et c'est elle qui décide.** On décide d'un
rendez-vous sur qui et quand. Le nombre d'abonnés, le compte de collaborations
et la ponctualité pèsent une décision et se lisent posément — ils restent sur la
fiche du créateur, qu'un lien de la carte ouvre en un geste. Rebecca peut donc
toujours évaluer un volume avant d'accepter ; elle ne l'a simplement pas sous les
yeux au moment de trancher, où il encombrerait sans servir.

**Ce qui rouvrirait la question** : une demande explicite venue de l'usage — un
salon qui refuse ou accepte à l'aveugle et le dit. Pas une planche.

**Et ce que rouvrir coûterait, précisé par `bind-agency-aa` après coup.** Le
chiffre n'est pas seulement absent de l'écran, il est absent du **contrat** :
`ReservationDuCommerce` porte vingt champs et aucun compteur d'audience —
`creator_id`, `creator_handle`, `creator_partie`, `creator_profil_url`,
`creator_avatar_key`, c'est-à-dire *qui* et rien d'autre. Le redessiner demande
donc une route et un agrégat **avant la première ligne d'écran**, et c'est une
raison de plus de ne pas le rouvrir sur une planche.

Ce qui existe déjà est le chemin : la pilule « Profile » ouvre la fiche depuis la
carte, en un geste, et les chiffres y sont.

**Mais le vrai enseignement n'est pas l'arbitrage, c'est où il vivait.** Il
n'existait que dans un commentaire de `JourneeScreen`, au-dessus du bloc
concerné. Ni `DECISIONS.md`, ni la passation. Personne qui compose une planche ne
lit un commentaire de code — donc rien ne pouvait empêcher la v12 de le
reproposer, et rien n'aurait empêché une v13.

C'est exactement le mécanisme que `CLAUDE.md` décrit pour la règle des PR en
conflit : *une règle rangée là où on ne la cherche pas ne protège personne*. La
règle est donc allée dans la passation, section 6, à côté des autres règles de
décision — c'est-à-dire dans le document que Design lit **avant** de dessiner —
et l'arbitrage ici, daté et avec ce qui le rouvrirait.

**Le coût évité se mesure** : `bind-agency-aa` a composé la v12 entière sans
ajouter la ligne, parce qu'il a lu le commentaire en passant. C'est de la chance,
pas un mécanisme. Le prochain aurait servi le champ, ce qui est un agrégat de
plus côté serveur, et l'aurait retiré après.

---

## 2026-09-02 — Un arbre de travail par session, parce que la règle du commit ne protège pas celui qui ne peut pas commiter

Deux conversations ont travaillé dans le même clone sans le savoir. L'une a
voulu changer de branche, git a refusé — des fichiers modifiés auraient été
écrasés — elle a fait `git stash -u` sans regarder, et elle a emporté quarante
fichiers qui n'étaient pas les siens.

**Ce mode de perte n'est pas celui déjà écrit ici.** Celui du journal demande de
se tromper de commande : basculer avec du travail en cours, ou faire un
`git checkout <branche> -- <chemin>` qui prend le fichier de l'autre branche.
Celui-ci ne demande rien. Aucune des deux sessions ne commet d'erreur : l'une
bascule sur sa propre branche, ce qui est son droit ; l'autre perd, sans jamais
avoir été prévenue qu'elle partageait un dossier.

Et le garde-fou habituel ne s'applique pas. « Commiter avant de bouger » suppose
qu'on puisse commiter et qu'on sache qu'il faut le faire ; ici la victime ne
voit pas venir la bascule, et il lui arrive de ne pas avoir la main sur git du
tout — c'était le cas ce soir-là dans une troisième session.

**Le geste qui l'évite tient en une ligne, et il est gratuit :**

```
git worktree add -b <branche> <chemin> origin/main
ln -s <clone>/app/node_modules <chemin>/app/node_modules
```

Un arbre par session. Le lien symbolique évite de réinstaller les dépendances,
qui sont la seule chose qui coûterait du temps. Deux minutes en tout, et le
partage de dossier cesse d'exister comme risque.

**Ce qui a rendu l'incident lisible plutôt que silencieux**, et qui mérite
d'être noté à part : le compte de quarante fichiers ne voulait rien dire. Ils
étaient l'écart avec un commit vieux de quelques heures, pas du travail neuf —
comparé à `origin/main`, le même arbre ne différait que sur sept fichiers, et
**en moins**. Il était en retard, pas en avance.

Trois sessions ont été réveillées pour un travail qui n'a jamais existé. La
leçon est la même que sur le semis : *une observation juste, une cause
inventée*. « Quarante fichiers modifiés » se lit comme « quarante fichiers de
travail » et ce n'est pas la même chose. La question à poser avant l'alarme est
`git diff origin/main --stat`, jamais `git status`.

## 2026-09-02 — La bande du comptoir passe de sept à quatorze jours

**Tranché en v11, renversé en v14.** L'entrée d'origine disait sept, avec sa
raison : « la créatrice cherche quand elle peut venir et regarde loin, le salon
regarde ce qu'il a à faire et sa semaine est l'horizon de son travail ; quatorze
barres de décisions demanderaient de défiler pour atteindre le seul jour qui
presse ».

L'argument valait tant que le jour qui presse pouvait être **plus loin que la
piste**. Il ne l'est pas : la bande s'ouvre sur le premier jour, et les suivants
ne se gagnent qu'en défilant vers l'avant. Allonger n'éloigne donc rien de ce
qu'on regardait déjà.

Ce que sept coûtait, en revanche, n'avait pas été vu : **un créateur réserve à
quinze jours.** La moitié de ce qu'un salon avait accepté tombait hors de sa
propre bande — la demande existait, la file la servait, et aucune case ne la
portait.

**Et le zéro remis n'est pas un aller-retour d'humeur.** Le « 0 » d'un jour sans
décision avait été retiré parce que sept chiffres à lire pour en retenir deux
noient la bande. À quatorze cases sur une piste qui défile, une case vide ne se
distingue plus d'une case pas encore chargée : ce n'est pas le retrait qui était
faux, c'est la longueur de la bande qui a changé la question. La table des
retraits de `components.md` le porte sous cette forme — barré, « remis en v14 »,
avec les deux raisons — parce qu'une table qui dirait seulement « retiré puis
remis » ne se relit pas.

## 2026-09-02 — Un glyphe se copie en entier, pas par son tracé

**La flèche de retour a pointé à droite sur tout le produit.** `retour` est
`fleche` retournée : `primitives.json` porte le **même** champ `d` pour les deux
et un `transform: rotate(180deg)` sur l'une. J'ai copié le tracé sans le champ.

Ce qui rend le cas instructif est que **ma propre garde est passée au vert** :
écrite pour vérifier que les glyphes ne sont pas retapés de mémoire, elle
comparait `d` et rien d'autre. Design a commis exactement la même erreur dans
son lecteur de primitives, le même jour, sans concertation.

`bind-agency-1a` en a tiré la formulation qui reste : **une garde qui ne compare
qu'un champ d'un objet à plusieurs champs n'éprouve que ce champ.** Élargie à
`d`, `transform`, `viewBox` et `strokeWidth`, elle a trouvé le défaut suivant
dans la minute — `coche` porte `strokeWidth: 2.4`, avec sa raison écrite dans la
primitive, et le produit traçait tout à `size.iconStroke`. Personne ne l'avait
lue parce que personne ne lisait ce champ.

Même famille que les cinq jetons inexistants de `components.md` : **un document
juste que rien ne confronte au produit cesse d'être juste.** Ici il l'était
depuis le début ; c'est le lecteur qui n'en lisait qu'un quart.

## 2026-09-03 — Un dossier converti, pas ajouté, pour ne pas pousser un score au plancher

**Le seed ne démontrait jamais « fermer sans faute ».** Les quatre dossiers
`revue_humaine` du jeu opposent tous trois motifs différents — le décor du
filtre « mixed reasons ». Aucun ne répète le même motif trois fois de suite,
donc `meme_motif_repete` ne se levait jamais et le bouton vedette de
l'arbitrage n'avait rien à ouvrir, même après un reseed.

Premier réflexe : ajouter une cinquième ligne dégradée à « plafonnée », la
créatrice qui porte déjà toutes les autres. `recalculer_les_scores` l'a refusé
— `demander_une_nouvelle_soumission` émet un `RESUBMIT_REQUIRED` à chaque
passage, y compris sur une revue jamais tranchée, et le cinquième dossier
faisait toucher le plancher que le garde-fou existe précisément pour éviter.

La correction retenue **convertit** un des quatre dossiers `revue_humaine`
existants (`weeks=1, days=2`, Brickell) en `revue_humaine_meme_motif` au lieu
d'en ajouter un. Le nombre d'événements de fiabilité ne change pas — seul le
motif répété diffère — donc le score reste celui déjà calibré. Trois dossiers
« mixed reasons » restent pour démontrer l'autre branche du tri, dont le plus
frais (deux jours) reste intact.
## 2026-09-03 — La reprise ouvrait une porte que rien ne savait franchir

L'audit fonctionnel de l'administration a trouvé que le parcours de reprise de
compte s'arrêtait net après l'ouverture : `ReprendreLeCompte` savait ouvrir un
accès, aucun écran ne menait ensuite au commerce repris, et `fermerLaReprise()`
— le geste de l'administration sur son propre accès — n'était appelé nulle
part côté client.

**`Navigation.tsx` tient maintenant la bascule.** `OngletsAdmin` porte l'état
de la reprise en cours et remplace sa propre barre d'onglets par un nouvel
`EcranDeReprise`, qui rejoue les écrans marchands (`ecransDuCommerce`, extrait
de `OngletsDuCommerceChoisi` pour ce second appelant) sur le `businessId` de la
reprise. Chaque écran marchand prenait déjà `businessId` en prop explicite,
jamais depuis un contexte — c'est ce qui a rendu l'extraction possible sans
toucher un seul écran.

**Le réglage du commerce reste hors de la reprise, délibérément.** Les
sections de pause et d'historique de `ReglagesScreen` sont gardées sur le rôle
de **la session connectée** (`business_member`), pas sur celui qu'on visite —
les y montrer sous une reprise aurait rendu un écran de réglages amputé, sans
le dire. `ecransDuCommerce` ne porte donc pas « reglages » ; chaque appelant
compose le sien.

**`fermerLaReprise` sort de la table `SANS_APPELANT`**
(`routes-sans-appelant.test.ts`), où elle portait depuis son ajout une raison
qui disait l'inverse de ce qu'on vient de construire : « l'administration se
retire en quittant, un bouton ne protège personne ». L'audit a demandé
explicitement le contraire — un geste distinct pour refermer son propre accès
— et c'est la décision qui tient maintenant. Trouvé seulement parce que la
suite complète tourne avant de pousser : cette garde ne touche ni
`Navigation.tsx` ni les écrans modifiés, rien ne l'aurait signalée autrement.

---

## 2026-09-03 — Le pool de connexions se déclare, et le fil créateur ne s'accélère pas plus loin

Un test de charge (20 puis 50 requêtes simultanées, trois routes) a montré le
fil créateur environ deux fois plus lent que la journée commerce et
l'arbitrage admin, sans aucune erreur. Deux corrections en ont découlé, et
l'une des deux n'a pas eu lieu — pour une raison qui mérite d'être écrite,
plutôt que de laisser croire à un oubli.

**Le pool de connexions était implicite.** `create_async_engine` ne déclarait
ni `pool_size` ni `max_overflow` : SQLAlchemy appliquait ses valeurs par
défaut (5 + 10 = 15), invisibles à la lecture du code. Il est maintenant à
10 + 10 = 20, explicite et commenté. Le déploiement tourne un seul processus
`uvicorn` sans `--workers` : ce pool n'est jamais partagé entre plusieurs
travailleurs, et vingt donne une marge mesurée plutôt que devinée — cinquante
requêtes simultanées passaient déjà sous la valeur par défaut, sans attente
observée. Rester modeste plutôt que de viser large : la production passe par
le *session pooler* de Supabase, pas une connexion directe, et une limite qui
lui appartient échoue de façon plus opaque qu'un dépassement de pool qu'on
contrôle.

**L'hypothèse sur le fil créateur était fausse, vérifiée plutôt que corrigée
à l'aveugle.** Elle supposait une distance calculée en Python après coup.
Elle est calculée en SQL depuis longtemps — `ST_Distance` sur une colonne
`Geography`, avec un index `GIST` dédié (`ix_business_geo`). Un profilage
direct du service, hors HTTP, confirme que son propre calcul prend
11,7 ms en moyenne pour retourner quinze commerces — rapide, et la majeure
partie de ce temps est de l'attente réseau vers Postgres, pas du calcul.

**Ce qui explique le reste, une fois le pool élargi.** Réévalué dans les
mêmes conditions, le fil créateur reste le plus lent des trois — moins
qu'avant (moyenne divisée par presque deux, p95 amélioré d'un quart), mais
toujours nettement devant les deux autres. Ce n'est pas une anomalie : c'est
la route qui fait le plus de travail réel par appel. Elle balaie
délibérément le rayon le plus large des options d'élargissement — pas le
rayon demandé — pour que « élargir à 25 km · 9 salons » ne mente jamais ; et
elle vérifie la disponibilité en cinq requêtes groupées, batching qui a déjà
remplacé cent vingt et une requêtes individuelles lors d'une correction
précédente. Les deux sont documentées comme volontaires dans `feed.py`, pas
comme une dette.

**La mise en cache n'a pas été ajoutée, et ce n'est pas un oubli.** Elle
aurait réduit le travail répété sans toucher au reste, mais elle va à
l'encontre d'une règle déjà écrite : « la disponibilité se calcule à la volée,
on ne matérialise pas de lignes de créneaux ». Un résultat de fil mis en
cache quelques secondes est exactement ce que cette règle refuse, sous une
autre forme — une réponse qui prétend être fraîche et ne l'est plus. La
question n'est pas technique, elle est produit : accepter une fenêtre de
staleness volontaire sur cet écran précis demande une décision, pas une
optimisation glissée dans une correction de charge.

## 2026-09-03 — Le pied de l'email ne porte pas d'adresse postale

**Tranché, après vérification juridique.** La planche Design du gabarit email
portait une adresse postale au pied de page, avec la note « à ajouter avant
l'envoi ». Daniel préférait n'y rien mettre, sans savoir si c'était une
option ou une obligation légale — la question a donc été vérifiée avant
d'écrire quoi que ce soit.

CAN-SPAM (US) exige une adresse postale pour un email **commercial** — but
publicitaire — mais exempte les messages **transactionnels/relationnels**.
Les seize gabarits du produit (vérification de compte, statut de
réservation, cycle de vie d'une collaboration, statut d'abonnement)
correspondent à cette exemption sur la lecture de leur contenu réel. GDPR
n'impose aucune adresse postale en pied d'email ; cette exigence, quand elle
existe en UE, vient de règles nationales distinctes (e-commerce, Impressum),
hors de portée d'un marché lancé à Miami.

Design a retiré la ligne et son jeton des deux langues de la planche : ce
n'était pas une exigence de composition, c'était son repli faute de cette
vérification. Le pied de l'email ne porte donc que deux lignes — pourquoi on
reçoit ceci, puis les liens — jamais une troisième. `EMAIL_POSTAL_ADDRESS`,
posée en configuration le temps que la question reste ouverte, a été
retirée : ce n'est plus une décision en attente.

## 2026-09-03 — Refus de géolocalisation web : détection par agent utilisateur, pas de redirection automatique

**Le défaut trouvé à l'audit.** `Platform.OS === 'web'` ne distingue rien :
Safari sur iPhone et Chrome de bureau rendent tous deux `'web'`. Rebecca a
reçu « cliquez sur l'icône cadenas à gauche de la barre d'adresse » sur
Safari mobile, qui n'a pas ce cadenas — l'icône réelle est « Aa », ailleurs.

**Détection par agent utilisateur (`navigator.userAgent`), fonction pure
testée sur des chaînes réelles.** C'est la seule source disponible sur le
web : React Native ne porte aucune API de détection de navigateur plus fine
que `Platform.OS`. La technique est connue pour être fragile — un agent
utilisateur peut être usurpé, et Apple modifie parfois son format — mais
c'est le seul signal qui existe, et le pire des deux mauvais choix est celui
qui reproduit le défaut d'origine : rien du tout.

**Le repli d'iPad depuis iPadOS 13** (qui se présente comme un Mac de
bureau) passe par `navigator.maxTouchPoints`, seul signal qui distingue les
deux une fois l'agent utilisateur identique — calculé une fois dans
`plateformeWebCourante`, jamais dans la fonction pure elle-même.

**Aucune redirection automatique vers les réglages n'existe depuis le web
sur iOS — vérifié, pas supposé.** `prefs:root=Privacy&path=LOCATION` est un
schéma d'URL privé qu'Apple bloque explicitement depuis Safari (« Safari
cannot open the page because the address is invalid »), et de plus en plus
même depuis une app native — iOS 18 a cassé jusqu'aux sous-chemins pour les
apps qui y avaient encore droit. Rien ne remplace donc le geste manuel :
`BlocPositionRefusee` mise sur deux parades à la place — un schéma composé
des primitives existantes (aucune icône neuve, `Icone` documente son jeu
comme volontairement court) et un bouton qui copie la marche à suivre.

**Le fil sans position se classe par popularité, citywide, sans
`distance_metres`.** Trier par distance n'a pas de sens sans position ; la
popularité — réservations consommées, 90 jours, la même fenêtre que
`suggestions_du_createur` — n'en a pas besoin. Nouvel endpoint plutôt qu'un
paramètre optionnel sur `GET /businesses` : les schémas existants portent
tous `distance_metres` en champ obligatoire, et le rendre nullable aurait
propagé le changement à l'annuaire, la carte de suggestion et l'écran des
paliers pour un besoin qui ne les concerne pas.

## 2026-09-03 — Notifications sur le web : ne rien demander qu'on ne puisse utiliser

**Deux mensonges, une seule cause.** `useNotificationsPush` gardait son entrée
par `Device.isDevice`, en affirmant en commentaire que c'était « le seul test
fiable » pour exclure le web. `expo-device` rend pourtant `isDevice: true`
**en dur** sur tout navigateur : la garde ne fermait jamais.

En production sur le web, une vraie fenêtre « Autoriser les notifications ? »
s'ouvrait donc juste après la connexion, sans qu'aucun écran ne l'ait
annoncée — ce que l'en-tête du module interdit explicitement par ailleurs
(« rien n'est demandé au premier écran »). Et même accordée, l'enregistrement
échouait : `getExpoPushTokenAsync` exige `notification.vapidPublicKey` dans
`app.json`, absente de ce dépôt.

**Le second mensonge était plus discret que le premier.** L'interrupteur des
réglages se dessinait sur `!refusees` seul. Sans rien en mémoire — le cas de
tout navigateur — il s'affichait « activé » **au premier rendu, avant toute
interaction**. Et `basculer` jetait le résultat de `enregistrerCeTerminal`
avant de poser « activé » quoi qu'il arrive.

**La correction pose la vraie question plutôt que de rafistoler la garde.**
`pushDisponible()` demande « un jeton est-il obtenable ici » : `Device.isDevice`
en natif, où il est juste, et la présence de la clé VAPID sur le web, lue **là
où `expo-notifications` la lit** — un drapeau à nous aurait fait deux vérités,
et c'est la nôtre qui aurait vieilli le jour où la clé arriverait.

**Pourquoi aucun test ne pouvait l'attraper.** Tous mockaient `expo-device`
avec `isDevice: true` en pensant décrire un téléphone — ce qui est exactement
ce que le web renvoie. Le décor du bug et celui du cas nominal étaient le
même, et c'est la forme que `CLAUDE.md` décrit : un décor qu'une
implémentation fautive produirait à l'identique ne prouve rien. Les tests
neufs éprouvent la plateforme, pas le mock.

**Ce qui reste ouvert et ne l'est pas par accident** : les notifications push
web resteront indisponibles tant que la clé VAPID n'est pas configurée. C'est
un choix en attente de la décision Expo/EAS, pas un renoncement — le jour où
la clé est posée dans `app.json`, `pushDisponible()` rend vrai sans qu'on
touche à une ligne.
## 2026-09-04 — `consumed` disait deux choses, et l'écran héritait des deux

**Le défaut.** `BookingStatus.CONSUMED` n'avait aucun état de sortie —
`frozenset()`, déclaré terminal. Une réservation servie gardait donc le même
statut qu'elle ait été publiée et acceptée, refusée, ou jamais rendue. Deux
écrans en héritaient : le compteur « à envoyer » de la créatrice grossissait
sans jamais redescendre, et l'onglet des terminées ne recevait jamais une
prestation honorée. Le badge « Honoured » que cet onglet sait dessiner était
donc du code que rien ne pouvait atteindre.

**Un seul état de sortie, et il ne dit pas l'issue.** `closed` répond à « reste-
t-il quelque chose à faire », qui est la question des onglets. *Laquelle* des
trois issues — approuvée, non honorée, fermée sans faute — reste portée par la
contrepartie, seul objet à la connaître. Deux états de sortie auraient recopié
sur la réservation un fait qui vit ailleurs, et deux sources du même fait
finissent par diverger.

**Ce qui a coûté le plus n'est pas l'état, c'est ce qui le lisait.** Huit
requêtes écrivaient `status == CONSUMED` pour dire « le salon a donné cette
prestation » — rapport, valeur offerte, popularité d'un quartier, occupation
d'un créneau. Ajouter la sortie sans les toucher aurait fait **fondre le rapport
du commerce au fur et à mesure que ses dossiers se ferment** : un chiffre juste
hier, faux aujourd'hui, et rien pour le signaler. D'où `STATUTS_SERVIS`, qui
nomme l'intention là où l'égalité la laissait deviner.

**Et la mutation a dit que ce trou n'était pas gardé.** En retirant `closed` de
`STATUTS_SERVIS`, les **soixante-douze** tests de rapport, de fil et de
disponibilité restaient verts : aucun ne passait par une réservation close,
parce qu'aucune n'existait avant ce jour. Le risque le plus cher du changement
était donc le seul entièrement non protégé, et seule la mutation l'a montré —
la relecture avait pourtant listé les huit sites un par un.

**Un défaut trouvé en chemin, et il vivait derrière du code mort.** L'onglet des
terminées écrivait « Accepted » sur une coche verte pour *toutes* ses lignes —
annulation, absence et expiration comprises. `issueDe` existait depuis le début
pour dire laquelle des quatre fins, et n'était appelée que par `LigneNue`, un
composant que plus rien ne montait : la fonction *paraissait* branchée. Un test
avait même figé le défaut, en affirmant qu'une réservation annulée affiche
« Accepted » — le décor attendait la valeur que le défaut produit.

La leçon n'est pas « supprimer le code mort », elle est plus précise : **une
fonction encore appelée par un composant orphelin ne se distingue pas, à la
relecture, d'une fonction branchée.** Le seul signal fiable était de partir du
rendu et de remonter, jamais de partir de la fonction et de chercher ses
appelants.

**Une mutation a aussi condamné un de mes propres décors.** Trois tests
vérifiaient que l'onglet des terminées montre la publication ; retirer `closed`
de la liste de statuts de l'onglet les laissait tous verts, parce que le montage
répond les mêmes lignes quelle que soit la requête. Il a fallu un test qui
observe l'URL appelée — le seul endroit où cette liste est observable.

**Et le rebase a trouvé ce qu'aucune suite n'aurait vu.** Pendant ce travail,
une autre conversation a fusionné « My posts : le filtre part au serveur »
(#437), qui fait demander au serveur les seules réservations `consumed` — avec
en commentaire la justification exacte : *« vérifié en base, aucune contrepartie
approuvée ne porte un autre statut de réservation »*. C'était vrai le jour où
elle l'a écrit.

La clôture le rend faux : une publication approuvée porte désormais `closed`.
Les deux changements sont justes séparément, et leur rencontre **vide l'écran
des publications en entier** — toutes, tout le temps, sans erreur nulle part.
Ni la suite de #437 ni la mienne ne pouvaient le voir : chacune était verte sur
sa propre branche, et le conflit git ne portait que sur les lignes voisines du
crochet extrait, pas sur le filtre.

Ce qui l'a attrapé est d'avoir lu ce que la version fusionnée *fait* avant de
résoudre, plutôt que de choisir un côté. La règle du dépôt dit déjà « on garde
la version fusionnée » ; ce cas ajoute qu'il faut la **lire**, parce qu'une
hypothèse vraie à l'écriture peut avoir cessé de l'être entre-temps — et que la
phrase qui la porte est un commentaire, que rien n'exécute.

---

## 2026-09-03 — `serve` est une dépendance déclarée, pas un téléchargement à l'exécution

**Le `webServer` de Playwright faisait `npx --yes serve`, et `serve` n'était
déclaré nulle part** — zéro occurrence dans `package.json` comme dans
`package-lock.json`. Le paquet était donc récupéré depuis npm à chaque
exécution de la e2e, sous le plafond de 120 s de `webServer.timeout`. Toute
lenteur du registre rendait la CI rouge sur du code juste.

**Le message ne dit rien de la cause** : « Timed out waiting 120000ms from
config.webServer », pas un mot sur npm ni sur le réseau. Il se lit comme « votre
application ne démarre pas », donc il accuse la dernière ligne écrite — et le
journal de l'API montrait pourtant `Application startup complete` et un
`GET /api/v1/health 200 OK`.

**Établi par contre-épreuve, pas par raisonnement.** J'ai relancé la e2e de
`main` sur un commit dont elle était verte : échec, deux fois de suite. Une
heure plus tard, `main` repassait au vert sans qu'une ligne bouge. Node est
épinglé par `.nvmrc` (v24.20.0) et `serve` n'avait pas été publié depuis six
mois — restait le téléchargement. Sans cette contre-épreuve, deux PR auraient
été soupçonnées à tort ; c'est exactement ce qui allait arriver.

`serve` est donc en `devDependency`, épinglé à 14.2.6, et l'appel est
`npx serve` sans `--yes` : le binaire vient de `node_modules`, que
`setup-node` restaure déjà de son cache. Vérifié en local — le serveur répond
200 en deux secondes, sans aucun appel au registre.
---

## 2026-09-03 — Le semis de nuit, et l'échéance d'arbitrage éloignée par le jeu lui-même

**La file d'arbitrage se vide douze heures après chaque semis, et la cause est
un délai de configuration, pas un défaut.** Mesuré sur la base plutôt que
déduit : les quatre dossiers `needs_human_review` du jeu de démonstration sont
en `resubmit_requested` avec une échéance à 11 h 58 du moment de la lecture —
c'est-à-dire `COLLABORATION_RESUBMIT_SECONDS`, douze heures, posé par
`demander_une_nouvelle_soumission` au troisième passage. `EXPIRABLES` contient
`resubmit_requested` : le balayage des échéances les fait donc tomber en
`unfulfilled`, et `file_de_revue_humaine` exclut ce statut. La file est pleine
pendant douze heures, puis vide pour toujours.

**Deux corrections, et elles ne se remplacent pas.** L'une remplit la file,
l'autre rafraîchit tout le reste : prendre la seconde seule laissait la file se
vider entre deux semis, prendre la première seule laissait le jeu vieillir sans
jamais repartir.

**1. Le jeu de données éloigne lui-même l'échéance de ses dossiers
d'arbitrage.** `eloigner_les_echeances_d_arbitrage` la porte à trente jours, sur
les seules lignes `needs_human_review` dont le statut est dans `EXPIRABLES` — et
cette liste est **importée** de `collaboration.EXPIRABLES`, jamais recopiée,
parce que la propriété défendue est exactement « ce que le balayage ferait
tomber ». C'est une exception nommée, comme `vieillir_un_releve` juste
au-dessus : aucun service ne sait déplacer le temps, et le seul autre moyen
serait d'attendre. Le compteur de tentatives, le drapeau de revue humaine et les
trois motifs restent produits par les services, comme le reste du jeu.

Trente jours n'a rien de fin : ce qui compte est que le nombre dépasse
franchement l'écart entre deux semis. Une valeur juste au-dessus — deux jours,
une semaine — rouvrirait le même défaut le jour où le semis automatique
s'arrêterait sans que personne s'en aperçoive.

**2. Le semis automatique est nocturne, et non périodique.** `DEMO_RESEED_HOUR`
porte une heure locale de Miami — 4 chez Render — au lieu d'une période. Une
période tombe à une heure différente chaque jour, donc finit mécaniquement par
tomber en pleine démonstration ; une heure de nuit tombe toujours quand personne
ne regarde. C'est ce qui rend acceptable ce que ce semis coûte.

**Le démarrage ne sème pas, et ne fait pas non plus sauter une nuit.**
`_jour_deja_seme` pose le jour en cours comme déjà semé si son heure est passée,
la veille sinon. Les deux moitiés divergent et comptent : poser « aujourd'hui »
dans les deux cas ferait attendre vingt-cinq heures à un service redémarré à
trois heures du matin ; poser « la veille » dans les deux ferait table rase dans
la minute à chaque fusion sur `main`, c'est-à-dire en plein jour. C'est le seul
endroit du dispositif où une erreur détruit des données au mauvais moment, d'où
deux cas de test qui se contredisent plutôt qu'un seul qui passerait sur les
deux implémentations.

**Un semis automatique écrase tout, sans alternative, et c'est la seule réponse
honnête à « est-ce que ça consomme ce que quelqu'un manipulait ».**
`seed.reset_schema()` exécute `TABLE_RASE`, qui `DROP TABLE ... CASCADE` sur
chaque table de `public` non rattachée à une extension — trente-sept sur la base
locale, `spatial_ref_sys` de PostGIS exceptée. Compté avant d'affirmer :
`app_user` 27 lignes, `booking` 248, `collaboration` 51, `creator_favorite` 5,
toutes supprimées. Il n'existe aucun mode partiel, aucun `ON CONFLICT`, aucune
notion de « ce qui a été ajouté depuis » : le jeu de données est écrit sur une
base neuve, c'est ce qui le rend rejouable, et c'est exactement ce qui le rend
destructeur. S'y ajoute une fenêtre d'une minute où l'application ne répond plus
rien d'utile — les tables sont supprimées, les migrations tournent — et où les
jetons d'accès en circulation désignent des comptes qui n'existent plus.

**Le coût est donc accepté, pas évité — et c'est l'heure qui le rend
acceptable.** Le défaut du code reste inerte : `demo_reseed_hour` vaut `None`,
et `.env.example` la laisse vide. Un défaut « raisonnable » aurait été emporté
par tout environnement neuf sans que personne ne le décide. Seul `render.yaml`
la pose à 4, pour la démonstration et pour elle seule.

**Le semis vit dans la boucle du worker, pas dans un job de la file, et ce n'est
pas un choix de style.** Un traitement tourne dans la transaction qui tient le
verrou de réclamation de sa propre ligne de `job` ; `TABLE_RASE` demande un
verrou exclusif sur cette même table. Le job attendrait sa propre transaction,
indéfiniment, et la boucle serait morte sans rien dire. Les vérifications
reprises sont celles de `scripts.deploiement`, dans le même ordre :
`verifier_la_cible` d'abord — un refus après table rase donnerait le même
message sur une base déjà détruite —, puis les deux compartiments d'objets,
parce que le semis y dépose des photos et échouerait *après* avoir effacé.

**`SEED_DATABASE_NAME` entre chez le worker, où un commentaire disait « il ne
sème pas ».** Elle ne déclenche rien : elle fait que l'activation échoue sur une
décision et non sur « SEED_DATABASE_NAME doit nommer explicitement la base ».

**Ce que le dépôt partagé a coûté ce jour-là, et qui n'est pas anecdotique.**
Trois sessions travaillaient dans le même répertoire. Un `git add -A` a happé le
fichier de travail d'une voisine dans un commit qui n'avait rien à voir ; sorti
à la main, mais rien ne l'aurait dit. Et la base de test est partagée : la suite
d'à côté supprimait `bind_test_gw0` pendant que la mienne s'y connectait, ce qui
ressort en `AdminShutdown` ou en « database does not exist » sur du code qui n'a
pas bougé — un diagnostic qu'on ne trouve qu'en comptant les processus `pytest`.
La règle qui en sort tient en une ligne : **ajouter les fichiers par leur
chemin, jamais `-A`**, et lire un échec de base comme une collision avant de le
lire comme un défaut.
## 2026-09-03 — Une base de test par exécution, et non par worker seulement

**Le nom ne portait que le worker, et c'est un demi-isolement qui se lit comme
un isolement complet.** `PYTEST_XDIST_WORKER` sépare les processus d'une même
exécution ; il ne dit rien de l'exécution elle-même. Deux exécutions parallèles
— le cas normal dès que deux conversations avancent dans le même répertoire —
ont chacune un `gw0`, donc visaient la même base. Chacune commence par
`DROP DATABASE ... WITH (FORCE)` : la seconde emportait celle de la première en
pleine exécution.

**Le symptôme accuse toujours la mauvaise chose.** L'échec ressort en « database
bind_test_gw0 does not exist », ou en `AdminShutdown: terminating connection due
to administrator command`, sur du code qui n'a pas bougé — donc sur la dernière
ligne qu'on vient d'écrire. Rencontré trois fois en deux jours, et jamais
compris avant d'avoir compté les processus `pytest` : `pgrep -f pytest` en
renvoyait cinq. Aucune trace, aucun message, aucun test ne le disait.

**L'empreinte vient de ce qui existe déjà, pas d'un mécanisme neuf.**
`PYTEST_XDIST_TESTRUNUID` est posée par xdist dans **chaque worker** d'une même
exécution, avec une valeur unique par exécution : c'est exactement la question,
et elle avait déjà sa réponse dans une variable que personne ne lisait.
`BIND_TEST_SESSION` la précède pour qui veut un nom à soi, et le numéro de
processus prend le relais en série, où xdist ne pose rien.

**Aucune des trois n'est tirée au hasard, et c'est la propriété qu'on éprouve.**
Un `uuid4()` dans la dérivation rendrait les deux tests de distinction verts —
les noms seraient bien différents — et le produit inutilisable : la base créée
au démarrage ne serait plus celle qu'on cherche au premier test. Les deux
familles d'implémentation ne divergent que sur la stabilité, d'où un test qui
appelle deux fois et compare, en plus de ceux qui comparent deux exécutions.
Vérifié par mutation dans les deux sens : le worker seul fait tomber trois
tests, l'identifiant aléatoire trois autres, et les deux jeux ne se recouvrent
qu'en partie.

**Le dépôt d'objets avait le même défaut, une ligne plus haut, et sa propre
docstring affirmait la question réglée.** `OBJECT_STORE_LOCAL_ROOT` n'était
suffixé que par le worker. La clé d'un objet est l'empreinte de son contenu :
deux processus qui sèment en même temps écrivent donc le **même** fichier, l'un
renomme `X.partiel` en `X`, l'autre ne retrouve plus le sien. C'est une
demi-correction, et une demi-correction est pire qu'aucune — elle protégeait les
workers d'une exécution, laissait deux exécutions se voler leurs fichiers, et le
commentaire au-dessus disait le problème résolu.

**Le diagnostic est parti sur la mauvaise piste, et c'est la mesure qui l'a
arrêté.** J'avais annoncé un plafond de connexions Postgres et j'allais monter
`max_connections`. Mesuré avant d'écrire : **pic de 17 connexions pour une suite
complète, sur un plafond de 100.** Le réglage n'aurait rien réglé, et il aurait
clos la question — le pire résultat possible. La vraie cause était écrite depuis
des semaines dans le fichier même, dans le commentaire qui expliquait pourquoi le
suffixe existait.

**L'empreinte est appelée, jamais recopiée.** Elle sert à la base et au dépôt.
Deux définitions de « quelle exécution suis-je » finiraient par diverger, et
c'est la seconde qu'on oublierait de corriger — la leçon est déjà écrite trois
fois dans ce fichier. Elle vit donc en tête de `conftest.py`, au-dessus des
imports, parce que le dépôt d'objets doit être posé avant que la configuration
ne soit construite ; d'où l'exemption `E402` sur ce seul fichier, avec sa raison.

**Ce que ça coûte.** Une exécution tuée par un `kill -9` laisse sa base derrière
elle, là où un nom fixe était repris au passage suivant. La commande de ramassage
est dans la docstring d'`empreinte_de_l_execution`. C'est le prix de l'isolement,
et il est plus bas que trois quarts d'heure de diagnostic sur un défaut qui
n'existe pas.

## 2026-09-03 — Une borne de largeur ne se vérifie pas contre elle-même

Rebecca a rapporté trois défauts sur l'administration — « barre de
recherche mal cadrée, tableau coupé, dates illisibles ». Les trois
avaient la même cause, et deux choses méritent d'être écrites : ce
qu'elle était, et pourquoi rien ne l'avait vue.

**La cause.** `Ecran` borne son contenu selon la `nature` que l'écran
déclare, et retombe sur `merchant` — 720 points, 672 utiles — quand
l'écran n'en déclare aucune. Quatre des cinq écrans de l'administration
n'en déclaraient pas, pour des tables de 888 à 984 points. Le cadre est
en `overflow: 'hidden'` et aucun de ces écrans n'a de défilement
horizontal : **ce qui dépasse n'est pas mal placé, il n'existe pas.**
Salons y perdait sa colonne d'action, c'est-à-dire le seul geste de
l'écran ; Creators le lien de profil, ce qui explique des « liens
Instagram qui ne marchent pas » alors que les liens fonctionnaient.

**Pourquoi rien ne l'avait vue.** Les tests rendent l'arbre sans mise en
page : une colonne hors cadre y est présente et interrogeable. La e2e ne
visite pas ces écrans. Le défaut ne pouvait se voir que dans un
navigateur, et il s'est vu en trente secondes dès qu'on en a ouvert un.

**Et la garde écrite pour l'empêcher est passée au vert sur un écran
encore coupé.** L'arbitrage déclarait déjà `reports` et restait coupé :
son panneau de détail prend 440 points fixes, donc la file recevait 712
pour 760. La borne `adminListeDetail` a été posée pour ça — et sa
première version oubliait les marges que `Ecran` pose *à l'intérieur*
d'elle. L'assertion écrite dans la foulée reproduisait la même omission,
donc elle confirmait le calcul au lieu de le confronter : verte, écran
cassé. C'est le navigateur qui a tranché.

La formulation qui reste : **une garde qui recalcule la formule qu'elle
doit vérifier n'éprouve que sa propre arithmétique.** Ce qu'il fallait
confronter n'était pas « la somme est-elle cohérente » mais « la place
réelle suffit-elle », et cette question a une seule réponse fiable, qui
est de la mesurer là où elle se pose.

Deux défauts ne se voyaient que parce que le premier les masquait : la
colonne d'action de Salons était comptée deux fois — déclarée dans
`COLONNES` *et* rendue par `fin`, donc la rangée dépassait son en-tête
de 168 points, exactement ce que le commentaire de `LARGEUR_ACTION`
jurait impossible — et son libellé se repliait sur deux lignes. Corriger
un cadrage rend visible ce qu'il cachait ; il faut donc regarder l'écran
après, pas seulement la mesure.

**`LienExterne`, enfin.** `Pressable` + `Linking.openURL` rend un
`<div role="link">` sur le web : le clic marche et rien d'autre — ni
clic-milieu, ni nouvel onglet, ni « copier l'adresse », et un
`window.open` hors ancre reste à la merci d'un bloqueur. Onze appels du
produit ont cette forme ; celui de l'annuaire admin est migré, les dix
autres attendent.

## 2026-09-03 — Un échec sans assertion n'est pas un échec de code

Quatre exécutions de la même suite jest, sur le même arbre, à quelques
minutes d'intervalle : **50 échecs, puis 19, puis 13, puis 0.** Les
fichiers nommés changeaient à chaque fois. Rien dans la sortie ne disait
que la machine était en cause — elle disait que des tests échouaient, et
elle donnait des noms.

Le tri tient en deux commandes, et il coûte trente secondes :

```
grep -c "Exceeded timeout" journal.log     # les échecs d'attente
grep -E "expect\(received" journal.log     # les échecs d'assertion
```

**Zéro assertion et N dépassements, c'est la machine.** Une seule
assertion, c'est le code. Ce soir-là : 100 dépassements, zéro assertion —
deux suites jest tournaient en parallèle, et des fichiers qui s'exécutent
en 2 s en mettaient 157.

**La règle générale.** Un échec d'attente — dépassement, connexion
refusée, base absente, serveur qui ne répond pas — **nomme toujours celui
qui attendait, jamais celui qui manquait.** Le symptôme désigne l'endroit
où l'on regarde, pas l'endroit où c'est cassé. Et l'endroit où l'on
regarde est presque toujours la dernière chose écrite, ce qui rend le
faux coupable très convaincant.

Trois cas de la même soirée, dans trois registres :

1. **La CI de la PR #447 était rouge sur `e2e`, verte sur `app`.** Même
   arbre, même commit, et le seul job qui tombait était celui qui attend
   un serveur : `Timed out waiting 120000ms from config.webServer`, trois
   lignes de journal, aucune autre erreur. La cause était l'absence de
   `serve` dans les dépendances — un téléchargement npm sous plafond de
   120 s, corrigé par la #448 d'une autre session. Sans son annonce
   préalable, j'aurais bisecté `Ecran.tsx` et `gabarit.tsx`, deux
   fichiers que tout l'écran traverse, donc les premiers suspects.
2. **Côté api, 57 erreurs sur `test_seed.py`** — toutes des `ERROR` de
   montage groupées sur un fichier, **zéro `FAILED` avec assertion**. Un
   `ERROR` groupé sans un seul `assert` en échec est un défaut de
   montage : la machine, ou une session voisine. C'était le dépôt
   d'objets local, suffixé par le seul `PYTEST_XDIST_WORKER`, donc
   partagé entre deux suites simultanées.
3. **Et la contre-épreuve coûteuse, qu'il faut savoir ne pas faire.**
   Établir « ce n'est pas mon code » en relançant la CI d'un commit connu
   vert, deux fois, puis en attendant qu'elle repasse seule, a coûté près
   d'une heure de CI. Le grep ci-dessus tranchait sur le premier journal.

**Le corollaire, qui est le vrai coût.** Devant un symptôme mal attribué,
le remède plausible supprime le symptôme sans toucher la cause — et
**clôt la question**, ce qui est pire que de ne rien faire. Deux fois ce
soir : monter `max_connections` aurait rendu la suite verte un jour sur
deux, alors que le pic mesuré était de 17 sur 100 ; et une garde de
largeur écrite en même temps que le code qu'elle vérifie a reproduit son
omission, donc elle est passée au vert sur un écran encore coupé. Dans
les deux cas, plus personne ne cherche ensuite.

### Complément — le troisième angle, celui qui parle quand tout est rouge

Les deux commandes ci-dessus se lisent **dans** un journal, et la colonne
des jobs se lit **entre** deux jobs du même run. Il reste un cas où ni
l'une ni l'autre ne répond : quand tous les jobs sont rouges, et qu'on
n'a qu'un seul run sous les yeux.

La question qui tranche alors vient de `bind-agency-1a`, et elle ne
demande aucun journal :

> **Est-ce que ça n'arrive qu'à moi ?**

Trois PR de trois branches différentes portant la même erreur au même
moment désignent l'infrastructure, sans qu'on ait à ouvrir quoi que ce
soit. C'est ce qui a établi la panne de `serve` : la même ligne
`Timed out waiting 120000ms from config.webServer` sur des travaux qui
n'avaient rien en commun.

Les trois angles répondent à la même question par des chemins différents,
et il est utile qu'ils soient trois — on n'a pas toujours les trois vues :

| Angle | Ce qu'on regarde | Muet quand |
|---|---|---|
| Assertions contre dépassements | un journal | on n'a pas encore le journal |
| Un job vert, un job rouge | un run | tous les jobs sont rouges |
| Plusieurs PR, même erreur | plusieurs runs | on est seul à livrer |

## 2026-09-04 — Fusionner une pile : ce qui ferme la PR enfant

Deux PR empilées — la seconde basée sur la branche de la première — se
fusionnent dans l'ordre, et deux pièges attendent au même moment. Le
premier coûte un rebase, le second est irréversible.

**Le piège cher, mesuré.** `gh pr merge <base> --delete-branch` a fermé
la PR enfant. Le journal d'événements de la #449 ne laisse pas de place à
l'interprétation :

```
base_ref_deleted · 2026-09-04T02:27:35Z
closed           · 2026-09-04T02:27:35Z
```

La même seconde. GitHub ferme une PR dont la base disparaît — et une PR
fermée dont la base n'existe plus **ne se rouvre pas** : `reopen` refuse,
et `--base main` répond `Cannot change the base branch of a closed pull
request`. Il a fallu en ouvrir une nouvelle, la #450, pour du travail
déjà écrit, testé et vert.

**Ce n'est pas `--delete-branch` qui ferme, c'est la suppression
effective de la base** — et la nuance est venue d'un contre-exemple.
`bind-agency-1a` avait fusionné une base avec le même drapeau sans que
son enfant ferme. Vérification : sa branche de base **existait encore**.
Le geste dangereux n'avait pas eu lieu.

**Pourquoi il n'avait pas eu lieu — hypothèse étayée, pas mécanisme
établi.** Le réglage du dépôt est `delete_branch_on_merge = false` :
personne ne supprime automatiquement. `gh` supprime lui-même, côté
client, **après** la fusion — donc seulement s'il est encore là quand
elle aboutit. Trois observations concordent :

| Fusion | Mode | Branche distante | Enfant |
|---|---|---|---|
| #438 | `--delete-branch` | existe encore | resté ouvert |
| #444 | `--auto --delete-branch` | existe encore | — |
| #447 | `--delete-branch`, **synchrone** | **supprimée** | **fermé** |

Concordantes, mais **la variable n'a pas été isolée** : il faudrait une
fusion `--auto` sur une PR immédiatement fusionnable pour séparer « `gh`
est parti » de « la fusion a tardé ». C'est écrit comme hypothèse parce
que trois observations qui vont dans le même sens ne sont pas une
expérience — et que se faire prendre par cette confusion est le sujet de
l'entrée précédente.

**La conduite, elle, ne dépend pas de l'hypothèse : sur une pile, ne pas
demander la suppression avant la dernière PR.** Elle coûte une branche
morte à nettoyer plus tard ; l'inverse coûte une PR.

**Et le piège qui ne coûte qu'un rebase.** Après une fusion *squash*, la
branche enfant se met en conflit : git rejoue des commits déjà présents
sous une autre identité. `git rebase origin/main` s'en sort en signalant
`patch contents already upstream` et en les laissant tomber — c'est ce
qui a marché ici. Viser explicitement l'ancêtre commun marche aussi, et
c'est la même idée que la règle déjà écrite plus haut sur
`git reset --soft "$(git merge-base HEAD origin/main)"` : **désigner le
point de divergence plutôt que supposer `origin/main`.** Deux remèdes
voisins pour deux pièges voisins — assez proches pour qu'une session les
ait confondus ce soir, et ait annoncé dans `CLAUDE.md` un `rebase --onto`
qui ne s'y trouve pas.

## 2026-09-04 — La bio d'une créatrice s'affiche, et l'objection qui la retenait reste vraie

**Renversement explicite.** `champs-servis.test.ts` portait
`CreateurDeLAnnuaire.bio` en « à instruire » depuis le contrat
commerce-scopé, avec une objection précise : la bio est du **texte
libre**, et le produit a déjà constaté qu'un champ libre peut porter un
pseudonyme — donc une adresse de contact hors BIND, donc un
contournement de la paroi payante que l'abonnement existe pour tenir.
La direction envisagée était le **retrait de la réponse**, pas
l'affichage.

**Elle s'affiche quand même, et l'objection n'est pas réfutée : elle est
payée.** Ce qui a tranché est ce que la rangée d'annuaire disait sans
elle — un pseudonyme, une ville, une distance. De quoi **reconnaître**
quelqu'un dont on a déjà entendu parler ; rien pour **choisir** entre
deux personnes qu'on découvre. Or choisir est la seule chose que cet
écran sert à faire, et c'est ce qu'un salon paie.

Le contournement reste possible et n'est pas mitigé ici. Ce qui rend le
coût acceptable : il existe déjà par le pseudonyme lui-même, que
l'annuaire affiche depuis toujours et qui suffit à retrouver quelqu'un
sur sa plateforme. La bio n'ouvre pas une porte fermée, elle élargit une
porte ouverte.

**Ce que ça a révélé, et qui était le vrai défaut.** La route
`PATCH /me/profile` existe depuis la création du profil, avec onze tests
derrière — et **aucun client ne l'appelait**. `monProfil` était déclarée
dans `app/src/api/routes.ts` sans méthode d'`Api`, donc sans écran, donc
sans données : `bio` et `city` étaient **nulles pour toutes les
créatrices**, jeu de démonstration compris. Afficher la bio sans
construire l'écran de saisie n'aurait donc rien affiché du tout.

Le chantier réel n'était pas « rendre un champ servi », c'était « fermer
un circuit ouvert aux deux bouts ». La garde `routes-sans-appelant` ne
pouvait pas le voir : elle inspecte les **méthodes** d'`Api`, pas les
entrées de `routes.ts`, et une route déclarée sans méthode lui est
invisible. C'est un angle mort connu de plus, du même genre que les
homonymies textuelles de `champs-servis`.

**Le formulaire vit dans `screens/reglages/` et non en `*Screen.tsx`.**
Cinq gardes de registre — couverture des écrans, quatre états, blocs,
squelettes, sélecteurs — s'appliquent au premier niveau de `screens/` et
ne sont pas récursives. Un sous-composant de réglages y échappe
légitimement : il n'est pas un écran, il n'a ni route ni retour, et
l'inscrire aux cinq registres aurait décrit une navigation qui n'existe
pas.
---

## 2026-09-04 — La mention attendue : un champ qui existait partout sauf là où on l'écrit

**Le défaut tenait en une phrase, et il était invisible depuis chaque bout.**
`tier_offer.required_mention` et `required_geotag` avaient leur colonne, leur
migration, leur recopie sur la contrepartie, et leur place dans **cinq** schémas
de lecture — fiche publique, contrepartie, file du commerce, journée, historique.
Ce qui manquait : `TierOfferCreate` était en `extra="forbid"` **sans les
champs**, il n'existait aucun `TierOfferUpdate`, aucune route ne les acceptait,
et le semis ne les posait pas.

Conséquence : `required_mention` valait `NULL` sur chaque ligne de chaque
environnement depuis la création de la colonne. Tout l'affichage étant gardé par
`required_mention ? … : null`, **il ne s'est jamais rendu une seule fois**. Vu
de l'écran de la créatrice, ça se lisait « le badge est peu clair » — un défaut
d'apparence, alors que la cause était qu'il n'y avait rien à afficher.

**Ce que ça dit du garde-fou qui aurait dû l'attraper.**
`test_schemas_ecrits.py` vérifie que tout champ d'un schéma d'écriture apparaît
en position d'écriture quelque part. Il ne pouvait pas voir ce défaut-ci :
`required_mention=` existe bel et bien dans le code — à
`collaboration.py:193`, où la contrepartie **recopie** l'offre. La garde
cherchait le nom, elle a trouvé le nom, et le nom appartenait à une lecture. Une
garde qui cherche une chaîne trouve les homonymes ; c'est le même mode d'échec
que la garde de traduction qui se satisfaisait d'une feuille sans son domaine.

**Trois asymétries, toutes dans le même sens : la créatrice en sait moins que
tout le monde.**

1. **L'email en disait plus que l'écran.** `collaboration.requirements.mention`
   porte « Mention {mention} in your post. » — la seule phrase impérative du
   produit — et n'était injectée que dans `collaboration.opened.body`. Le
   **rappel d'échéance** et la **demande de reprise** transportaient déjà la
   valeur jusqu'à la boîte d'envoi et ne l'écrivaient pas : deux gabarits à
   corriger, zéro ligne de Python. Or le rappel est précisément le message qu'on
   lit au moment de publier.
2. **Le commerce était mieux légendé que la personne qui exécute.** Côté
   commerce : « Expected mention », « What you asked for ». Côté créatrice, la
   valeur était posée **nue** — `@velanailstudio` suivi d'un bouton `COPY`, sans
   un mot pour dire ce que c'est ni ce qu'il faut en faire.
3. **Trois champs servis et câblés à `null`.** `business_name`, `item_name` et
   `platform` étaient assemblés par `CollaborationRead` et absents du type
   TypeScript ; l'écran passait donc `null` en dur. La ligne du lieu ne se
   rendait jamais — elle est gardée par le nom du salon — et la phrase du format
   tombait sur sa variante courte, sans dire sur quel réseau publier.

**Le test qui annonçait sa propre chute n'est pas tombé, et c'est le plus
instructif de la journée.** `la-preuve-v3.test.tsx` affirmait « le lieu ne se
rend pas tant que le nom du salon n'est pas servi », avec ce commentaire : « Ce
test tombera le jour où le champ arrivera, et c'est voulu ». Le champ est
arrivé, et le test est resté vert — son décor est casté (`as unknown as
Collaboration`) et ne portait pas `business_name`. `nomDuSalon` valait donc
`undefined` **avant comme après**, et l'assertion ne distinguait rien. Il a
fallu corriger le décor en même temps que le code. C'est exactement la règle du
dépôt sur les décors qui survivent à la mutation, rencontrée sur un test qui
prétendait par écrit être prêt à tomber.

**`instagram_handle` est un champ neuf, et distinct d'`instagram_url`.** Le
modèle disait déjà pourquoi : « le salon donne l'adresse qu'il veut montrer, qui
peut être une page de marque et non un compte ». On ne peut donc pas dériver le
pseudonyme de l'adresse, et une créatrice qui recopierait l'adresse citerait le
mauvais compte. Aucun remplissage rétroactif : il n'existe aucune règle sûre, et
une valeur devinée serait pire que son absence — elle serait proposée au salon
comme une valeur qu'il aurait donnée. Instagram seul ; TikTok n'a pas
d'intégration, et le jour où il en aura une, c'est une colonne de plus.

Nommage convenu avec la session voisine : `handle` nu reste à la créatrice
(`social_account.handle`, déjà en base et servi par trois schémas), le qualifié
va au nouveau. Le nom nu à ce qui existe déjà et qui est le plus nombreux.

**Le journal est celui de la configuration, pas celui de l'audit.** Une mention
est une **valeur** qui change ; ce qu'on relira est « qui a écrit quoi à la
place de quoi », que `record_transition` ne sait pas dire. L'audit garde les
bascules de l'offre — ouverte, fermée — et mêler les deux rendrait « a retiré
l'offre » et « a corrigé le pseudonyme » illisibles l'un à côté de l'autre.
D'où `CurrentUser` sur le `PATCH` en plus de `CurrentBusiness` : le journal de
configuration refuse d'écrire sans auteur humain.

**Sans rétroactivité, et c'est la propriété qui protège la créatrice.** Les
contreparties déjà nées gardent les critères figés à leur création — `SPEC.md`
§2.5. Changer la consigne sous quelqu'un qui a déjà consommé ferait tomber sa
publication pour un motif qui n'existait pas quand elle a publié.
## 2026-09-04 — Le quatrième onglet, et la garde de largeur qui se trompait dans le sens dangereux

**Le découpage des onglets est passé au serveur, et il n'avait plus le choix.**
L'app envoyait une liste de `BookingStatus` que le serveur appliquait. Ça tenait
tant qu'un onglet valait un ensemble de statuts de réservation ; ce n'est plus
vrai. « À envoyer » et « en revue » portent **tous les deux** `consumed` — ce
qui les sépare est le statut de la *contrepartie*, que le paramètre `status` ne
sait pas exprimer. Le motif repris est `FiltreDeContrepartie`, côté commerce,
qui a cette forme depuis plus longtemps : la créatrice était le seul des deux
bords à ne pas l'avoir.

**Une table de prédicats, pas une table de statuts.** La transposition littérale
du gabarit commerce ne marchait pas : la jointure sur `Collaboration` est
*externe*, et deux onglets sur quatre n'ont aucune contrainte de contrepartie —
un `Collaboration.status.in_(…)` poserait `NULL NOT IN (…)` sur leurs lignes et
les éliminerait toutes.

**« À envoyer » se définit par soustraction, et c'est ce qui garantit la
couverture.** Le nouvel onglet **découpe** dans l'ancien au lieu de s'ajouter à
côté : tout ce qui est `consumed` sans être en contrôle y reste, y compris un
état de contrepartie qu'on n'aurait pas prévu. C'est la réponse à la contrainte
du 2026-08-16 — « lier la lecture aux onglets ferait disparaître de l'interface
un statut qui existe en base » — et un test l'éprouve sur les huit
`BookingStatus`, pas sur les prédicats : comparer les prédicats reviendrait à
relire le code qu'on vient d'écrire.

**`status` survit, et ce n'est pas une hésitation.** Deux appelants ne sont pas
des onglets : « mes publications » veut `consumed` et `closed`, un ensemble qui
ne correspond à aucun onglet, et les réglages veulent tout l'historique sans
filtre. `onglet` prime quand les deux arrivent, ce qui laisse marcher une
version d'app antérieure.

**`a_envoyer` a été retiré.** Il disait exactement ce que dit désormais le compte
de l'onglet « à envoyer », et c'est la garde `champs-servis` qui l'a signalé dès
qu'il a perdu son lecteur. Son insight — le badge doit exclure les dossiers en
contrôle — n'est pas perdu : il est devenu la frontière entre deux onglets.

---

### La garde de largeur mesurait un modèle, pas un rendu

**Le point le plus instructif du chantier, et il a failli passer inaperçu.**
La consigne était de raccourcir `Por enviar` pour tenir dans la cellule de 73,5
points. La session voisine a fait remarquer que la formule de la garde —
`longueur × avance moyenne`, l'avance dérivée des jetons — n'avait jamais
rencontré un rendu. Mesuré dans un navigateur chargé de Plus Jakarta Sans :

| libellé | rendu | formule | écart |
|---|---:|---:|---:|
| `Upcoming` | **74,0** | 65,8 | −11 % |
| `Done` | 38,2 | 32,9 | −14 % |
| `In review` | **67,7** | 74,0 | +9 % |
| `Por enviar` | 79,9 | 82,2 | +3 % |

**L'écart n'est pas constant, il change de signe.** Ce n'est donc pas un
coefficient à corriger : le modèle « N points par caractère » est faux *dans sa
forme*, un caractère n'ayant pas de largeur fixe. C'est la distinction que la
voisine avait demandé de trancher en mesurant **trois** libellés au lieu d'un —
un écart constant aurait appelé un autre remède.

**Et il se trompait dans le sens dangereux.** Il acceptait `Upcoming`, qui
déborde de 0,5 point, et refusait `In review`, qui tient avec six points de
marge. Le vrai coupable n'était pas l'espagnol : `Upcoming` est devenu `Booked`,
et `Por enviar` n'a été raccourci en `A enviar` que parce qu'il débordait
réellement aussi.

Sans la mesure, on raccourcissait un libellé qui tenait, on gardait un libellé
coupé, et la garde passait au vert — **le pire résultat possible**, puisque
plus personne ne rouvre une question réglée.

**La garde emploie maintenant une table d'avances mesurée**, caractère par
caractère, qui reproduit le rendu à 0,4 point près. Mesurée en *paire* et non
isolément : un caractère seul porte son interlettrage de queue, la différence
entre « XX » et « X » donne l'avance qui s'accumule dans un mot. La méthode de
régénération est dans le fichier.

---

## 2026-09-04 — Le consentement de la créatrice, recueilli là où l'engagement a lieu

**Le bouton s'appelait déjà « Confirm booking », et rien n'était confirmé.**
L'écran affichait « à quoi tu t'engages » — contrepartie, mention, échéance,
règle d'annulation — puis laissait réserver d'un appui, sans qu'aucune trace
n'atteste que ce bloc ait été vu. Le produit avait pourtant le motif complet :
la prise en main d'une fiche fait accepter une version des conditions, refuse
l'écart, et l'écrit au journal d'audit. Il n'existait que du côté commerce.

**À la confirmation, jamais à la pose du garde.** `SPEC.md` §4.1 nomme l'acte :
« confirmation créateur » est la seule flèche que la créatrice tire elle-même
vers un état où le salon l'attend. Le `held` posé une milliseconde plus tôt
n'est qu'un verrou de capacité qui expire seul au bout de dix minutes ; y
recueillir un consentement produirait des acceptations enregistrées sur des
réservations qui n'ont jamais existé du point de vue du salon.

**Exigé à la route, facultatif au service — et c'est ce qui rend le chantier
possible sans rien casser.** `confirmer` a soixante-trois appelants : tests,
semis, autres services. Aucun ne parle de conditions, et leur imposer une
version leur ferait fabriquer une preuve qu'aucun humain n'a produite — le
journal ne vaudrait alors plus rien, puisqu'on ne saurait plus distinguer les
vraies. La route est le seul chemin qu'une créatrice emprunte, donc le seul
endroit où l'engagement existe. **Zéro test cassé**, ce que l'audit avait prédit
et que la suite a confirmé.

Un test garde chaque moitié, et c'est la paire qui compte : la route refuse un
corps absent, et une confirmation *par le service* ne laisse **aucune** trace
d'engagement. Sans le second, on pourrait croire la tolérance inoffensive.

**La preuve vit au journal d'audit, pas sur la réservation.** Même choix que la
prise en main, et sa raison est écrite là-bas : le journal est immuable et ne se
supprime pas avec la ligne, là où une colonne recopiée peut diverger sous un
`UPDATE`. Qui, quand, sur quelle version — les trois choses qu'on regardera le
jour où quelqu'un contestera. `transitionner` a gagné un `extra` pour cela ;
deux appelants s'en servaient déjà par d'autres chemins.

**La version est servie sur la fiche, pas sur l'offre.** La fiche est un objet
par écran, l'offre une ligne par prestation : le même mot répété douze fois dans
la même réponse ne dirait rien de plus. Et servie plutôt qu'écrite en dur côté
client — une constante dans l'app annoncerait encore l'ancienne le jour où le
texte change, et le serveur refuserait l'écart. Ce refus n'a de sens que si la
version vient de lui.

**Un code d'erreur distinct de celui de la prise en main.** Les deux refusent la
même chose et n'expliquent pas la même suite : « rechargez cette page » n'a
aucun sens sur un écran de créneau, où l'on revient choisir une heure.

**Le verrou porte aussi les reprises.** Les boutons « reprendre 16 h » appellent
la même fonction hors de la barre de confirmation ; sans le même `disabled`, le
consentement se contournait d'un appui.

**Ce que la mutation a montré, et qu'une relecture n'aurait pas vu.** Rendre la
bascule décorative — affichée, mais non lue par le verrou — laisse passer *tous*
les autres tests : le bouton marche, l'envoi part, la version est jointe. Un
seul cas distingue « on demande » de « on affiche », et c'est celui-là qu'il
fallait écrire.

## 2026-09-04 — Les centres d'intérêt : liste fermée, borne à l'écriture, et le filtre qui n'avait pas d'appelant

**Fermée plutôt que libre.** Même raisonnement que `Neighborhood`, et il tient
pour la même raison : c'est un axe de navigation. Deux créatrices qui
écriraient « ongles » et « nail art » ne se compteraient pas ensemble, et le
filtre annoncerait deux spécialités là où il y en a une. La liste est doublée
dans une contrainte `CHECK` — une validation Pydantic ne survit pas à un
`INSERT` écrit à la main, et une valeur inventée traverserait tout l'annuaire
sans jamais correspondre à un filtre, donc sans jamais se voir.

**Dix valeurs, plus fines que les six catégories de commerce.** La question
s'est posée de réutiliser `BusinessCategory` : zéro taxonomie inventée, et le
filtre correspondrait exactement à l'offre. Écartée parce que la catégorie
décrit ce qu'un commerce **est** — `beauty` couvre le coloriste et la
prothésiste ongulaire, et le catalogue du semis porte les deux sous cette
étiquette — alors que l'intérêt décrit ce qu'une créatrice **veut faire**. Les
confondre aurait ramené le filtre à l'axe qui existe déjà. Chaque valeur
retombe malgré tout sur une catégorie connue, sinon le filtre promettrait des
salons qu'aucun commerce ne peut servir.

**« Au moins un » est une règle d'écriture, pas une contrainte de base.** La
colonne est nullable et aucune ligne existante n'est reprise. L'autre option —
`NOT NULL` avec remplissage — aurait exigé d'attribuer un intérêt à des
créatrices qui n'ont rien choisi, et de le leur présenter ensuite comme une
valeur qu'elles auraient donnée. C'est la règle de `bio`, nulle pour tout le
monde tant que personne ne l'écrit. **Et la liste vide n'existe pas** : le
schéma la ramène à `NULL`, comme `_vide_vaut_absent` le fait déjà des chaînes
juste au dessus, sinon « je n'ai rien déclaré » aurait deux écritures et le
filtre devrait connaître les deux.

**Trois au plus, et le quatrième ne remplace pas le premier.** Faire tourner la
sélection aurait été plus permissif et bien pire : la créatrice aurait vu un
intérêt qu'elle a choisi disparaître sans l'avoir touché. Au dessus de la
borne, le geste ne fait rien et la ligne d'aide l'explique avant qu'on essaie.

**Ce que l'anonymisation efface, personne ne l'a décidé.** Le test de
complétude de `test_creator_profile.py` lit les colonnes du modèle et exige que
le jeu de départ pose chaque colonne personnelle : la colonne neuve l'a fait
tomber toute seule, avant qu'on se demande si trois intérêts identifient
quelqu'un. Ils le font, avec un quartier. C'est le second garde-fou de ce
dépôt qui trouve un oubli sans qu'on l'interroge.

### Le défaut le plus long : un filtre servi que rien n'appelait

`palier`, `reseau` et `distance_max_metres` sont déclarés par la route de
l'annuaire, appliqués par `_retenue`, et éprouvés par sept tests dont le
recalcul du total. Côté app, `annuaireDesCreateurs` n'envoyait que `limite` et
`decalage` — depuis l'origine.

**Rien ne pouvait le signaler.** Le serveur est correct et testé ; le client
est correct et testé ; la garde des champs servis regarde ce que les écrans
lisent, pas ce qu'ils envoient. Un paramètre optionnel qui n'est jamais passé
se comporte exactement comme un paramètre absent, et les deux côtés restent
verts. C'est le pendant exact du champ servi sans lecteur que ce dépôt attrape
déjà — la même faute par l'autre bout, et l'outillage ne couvrait que le
premier.

**Le piège à la couture : la pagination.** Brancher les filtres sans remettre
`suite` à zéro laissait les pages déjà chargées collées sous une première page
filtrée — des créatrices que le filtre venait d'écarter, sous un total qui ne
les comptait plus. La remise à zéro par salon existait déjà ; il lui manquait
une seconde cause. C'est ce que la mutation C éprouve, et le décor ne le
prouve que parce que la seconde page rend d'autres créatrices : sans cela,
« la suite a été jetée » et « la suite est restée » rendaient le même écran.

**`Platform` est déjà celui de React Native.** Importer le type du réseau
social sans alias dans `api/index.tsx` faisait passer `PlatformIOSStatic` pour
un réseau, et le typage l'acceptait à moitié — attrapé par `tsc`, pas par
relecture.

**La garde des clés de traduction passe à 44.** Les dix intérêts se composent à
deux endroits — la chip qui les fait choisir, la fiche d'annuaire qui les
montre — et une clé composée ne se résout pas sans exécuter le code. Le
plafond a été relevé, mais **ce que la garde y perd est rendu ailleurs** :
`centres-d-interet.test.ts` résout les dix clés dans les deux langues et lit la
liste dans l'énumération Python plutôt que de la recopier. Une liste recopiée à
la main aurait été exactement le décor que le code fautif produit — d'accord
avec ce qu'on vient d'écrire, y compris le jour où une valeur manquerait des
deux côtés à la fois.
---

## 2026-09-04 — La fiche d'une créatrice, et les abonnés qu'un commentaire avait exilés

**Le lien sortant n'a pas été supprimé, il a déménagé.** La rangée de l'annuaire
était une ancre vers Instagram : le seul geste de l'écran quittait le produit,
avant toute décision, et ce que l'abonnement achète restait derrière. Elle ouvre
la fiche ; l'ancre y est, avec les autres réseaux. Sortir reste possible et
cesse d'être obligatoire.

**Les conditions de visibilité sont extraites, pas recopiées.** L'annuaire liste,
la fiche ouvre, et les deux doivent décider pareil. Écrites deux fois, elles
finiraient par diverger — et l'écart ne se lirait pas comme un désaccord entre
deux fonctions : il se lirait comme une rangée qui mène à une page vide, sans
que rien à l'écran ne l'explique. Le test qui le tient compare **tous** les
champs de l'objet ; se contenter de l'identifiant laisserait le volume, le
palier et la distance diverger en silence. C'est la seule mutation — une fiche
plus stricte que la liste — qu'aucun autre test n'attrape.

**L'abonnement remonte au routeur.** Il était vérifié en ligne dans la route de
la liste. Une fiche qui ouvre exactement ce que la liste vend aurait pu naître
sans lui : un oubli d'une ligne, que rien n'aurait signalé, et un salon non
abonné aurait lu une par une les créatrices que la liste lui refuse.

**404 et non 403 hors du rayon, et le corps est indiscernable de celui d'un
identifiant inventé.** Distinguer les deux ferait de cette route un moyen de
sonder l'annuaire national, une requête à la fois.

**Un commentaire qui justifie un retrait par un écran inexistant vaut
suppression.** Les abonnés avaient quitté la grille en v9 avec une raison écrite
noir sur blanc — « l'audience appartient à la fiche qu'on ouvre pour décider,
pas à une liste qu'on parcourt ». La fiche n'existait pas. Le champ était donc
servi, lu par personne, porté « candidat au retrait » dans la table des champs
sans lecteur, et le raisonnement qui l'y tenait promettait un écran que personne
n'écrivait. C'est un mode de perte discret : la justification a l'air complète,
elle est même juste, et elle repose sur une chose qui n'existe pas. Le jour où
un commentaire renvoie à un écran, la question à poser est « est-il écrit ? ».

**Une exception d'homonyme se retire avec sa cause.** `audience_totale` était
dispensée de la détection parce que l'annuaire de l'administration la rendait et
que celui du commerce ne la rendait pas : sans la dispense, la ligne du second
passait pour périmée. La fiche la rend, la dispense n'a plus d'objet. Gardée,
elle aurait fait passer pour vivante une garde qui ne tenait plus rien.

**Une garde à deux cas force à exempter le troisième.** « Tout `onPress` de
l'annuaire est un lien qui sort » était juste tant que sortir était le seul
geste. La rangée ouvre une fiche : le geste est nouveau, il ne sort pas, et il
n'agit sur personne. La garde passe en trichotomie — sortir, ouvrir une fiche,
agir sur une créatrice — et seul le dernier reste interdit. Elle avait déjà été
élargie une fois, de « pas d'`onPress` » à « pas d'`onPress` qui ne sorte pas ».
La même correction, un cran plus tôt. Elle suit aussi l'écran : la fiche est
désormais là où un bouton « contacter » aurait le plus de sens à écrire, donc
c'est là qu'elle doit regarder.

## 2026-09-04 — Trois choses apprises en réparant une CI, et une quatrième sur les têtes d'Alembic

**`ruff` fait partie du job `api`, et une note de mémoire ne remplace pas la
commande.** #468 a échoué en trente-six secondes — trop court pour pytest.
Trente-neuf erreurs de style, aucune de logique. La consigne « lancer les
commandes exactes de la CI avant de pousser » était écrite, relue, et pas
appliquée : les PR précédentes étaient passées par chance, faute d'avoir dépassé
cent caractères. Le correctif a reformaté vingt-deux fichiers, ce qui pose à son
tour la question de savoir s'il a débordé.

**Et la vérification de ce débordement se fait contre la branche, pas contre le
dernier commit.** Comparer à `git show --name-only HEAD` a listé vingt fichiers
comme étrangers alors qu'ils étaient dans le premier commit de la branche. La
forme juste est `git diff --name-only origin/main...HEAD`. Un contrôle qui se
trompe est pire qu'un contrôle absent : celui-ci aurait fait annuler un
formatage légitime.

**`alembic heads` après tout rebase qui touche `alembic/versions/`, et c'est la
deuxième fois.** Le rebase est passé sans un conflit et laissait deux têtes : les
centres d'intérêt, fusionnés entre-temps par une conversation voisine,
descendaient du même parent que le portail d'âge. Git compare des noms de
fichiers, pas des `down_revision` — il n'avait rien à signaler et n'a rien
signalé. La question ne se retient pas, elle se pose, et elle se pose au même
moment que « la branche est-elle fusionnable ».

**Un nombre d'erreurs identique n'est pas une cause identique.** Deux fois 2010
erreurs de montage, à quelques heures d'écart : la première venait d'un `rm -f
.venv` lancé dans la même commande que `pytest`, la seconde d'une révision
fantôme dans la base de développement partagée. Le compte identique a fait
conclure à une répétition de la première, et relancer au lieu de lire.

---

## 2026-09-05 — Un champ écrivable que personne n'écrivait

**Le défaut est le même que celui qu'on venait de corriger, et il ne se
distingue pas à l'usage.** `required_mention` est devenu saisissable — route
`PATCH`, écran de composition, journal de configuration, affichage légendé côté
créatrice. Le semis, lui, ne le posait sur **aucune** des trente-quatre offres.
Vu de l'écran de réservation en production, c'est identique à avant : aucune
mention nulle part. Un champ qui passe de « impossible à écrire » à « personne
ne l'a écrit » produit exactement le même écran.

**Mesuré sur la base de démonstration réelle**, celle que sert
`bind-agency-1.onrender.com`, avant correction :

```
mention attendue : 0 offre sur 34
téléphone        : 4 salons sur 24
pseudonyme       : 0 salon
accord manuel    : 23 sur 24
```

**Les deux cas, jamais un seul.** Tout remplir serait le symétrique du défaut :
« ce salon n'exige aucune citation » n'existerait dans aucune démonstration, et
la ligne paraîtrait obligatoire. Une offre sur deux porte donc une mention, et
`required_geotag` suit un rythme différent — les deux sont indépendants côté
produit, et les voir toujours ensemble ferait croire le contraire.

**Le téléphone n'existait que sur les quatre salons écrits à la main.** Les
seize du marché n'en avaient aucun : un testeur qui ouvrait une fiche au hasard
avait une chance sur six de voir la ligne, et son absence se lisait comme un
manque du produit plutôt que du jeu de données. C'est le pendant exact de la
mention — la fiche affiche le téléphone depuis peu, et il n'y avait rien à
afficher.

**Vingt-trois salons sur vingt-quatre en validation manuelle.** La fiche annonce
depuis peu ce que l'appui déclenche — attendre une décision, ou être confirmé
d'office. La distinction existait à l'écran et n'était visible sur **aucun**
parcours. Cinq salons passent en confirmation d'office.

**Ce qu'on a failli « corriger » à tort.** Cinq salons n'ont aucune règle de
capacité, et j'avais d'abord annoncé qu'ils en manquaient sans raison. Vérifié
ensuite : ils sont tous `draft` ou `onboarding` — les fiches préparées en mode
terrain et le salon vierge — et **ils ne portent aucune offre**, donc ils ne
sont jamais réservables. Leur donner des horaires contredirait « faits saisis,
jamais d'engagements » et effacerait le cas de démonstration qu'ils portent.

**Trois gardes, mutées dans les deux sens.** Le champ vide fait tomber la
première, le champ partout aussi ; le téléphone retiré fait tomber la seconde.
Une garde qui n'exige qu'une borne — « au moins une mention » — laisserait
passer « toutes les offres en portent une », qui est l'autre moitié du défaut.
