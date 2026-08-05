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
