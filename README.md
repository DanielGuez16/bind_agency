# BIND

Place de marché bilatérale entre commerces de proximité et créateurs de contenu
locaux. Le créateur ne reçoit jamais d'argent : il obtient un droit de consommer
un item précis chez un commerce précis, débloqué par paliers.

- `CLAUDE.md` — contexte permanent du dépôt
- `SPEC.md` — source de vérité fonctionnelle
- `TASKS.md` — liste de travail
- `DECISIONS.md` — décisions techniques datées
- `DEMO.md` — démarrer et parcourir le produit, comptes du jeu de données

---

## Démarrer

Prérequis : Python 3.12, Node 24 (`nvm use`), Docker.

```
make install     # venv, dépendances Python et Node, .env copiés depuis les exemples
make dev         # Postgres + API sur http://localhost:8010
make app         # app Expo, touche `w` pour le web
```

`make` sans argument liste les cibles.

| Cible | Effet |
|---|---|
| `make install` | venv Python, dépendances, `npm install`, `.env` initialisés |
| `make db-up` | démarre Postgres et attend qu'il réponde |
| `make db-down` | arrête Postgres, conserve le volume |
| `make dev` | API sur `http://localhost:8010` |
| `make dev-lan` | API accessible depuis le réseau local, pour un appareil physique |
| `make app` | serveur Expo |
| `make test` | les deux suites |
| `make test-api` | pytest sur une base de test dédiée |
| `make test-app` | jest sur l'app |
| `make lint` | ruff sur l'API, types TypeScript sur l'app |
| `make fmt` | reformate |
| `make migrate` | applique les migrations Alembic |
| `make clean` | supprime conteneur, volume et venv |

Vérifier que le socle tient :

```
curl http://localhost:8010/api/v1/health
```

`200` si la base répond, `503` avec le nom de la dépendance en défaut sinon.
Documentation interactive sur `http://localhost:8010/api/v1/docs`.

---

## Ports

Décalés par rapport aux valeurs habituelles, d'autres projets occupent déjà les
ports standards sur la machine de développement (voir `DECISIONS.md`).

| Service | Port |
|---|---|
| Postgres | 5434 |
| API | 8010 |
| Expo web | 8081 |

---

## Langues

L'API **ne renvoie jamais de texte destiné à l'affichage**. Elle renvoie un code
stable — `email_already_used`, `not_a_member` — et c'est l'application qui le
traduit. Corriger une formulation ne demande donc pas de redéployer le backend.

- Catalogue des codes : [api/app/core/errors.py](api/app/core/errors.py), source de vérité
- Messages émis par le serveur lui-même (emails à venir) : [api/app/locales/](api/app/locales/)
- Catalogues de l'app : [app/src/i18n/](app/src/i18n/)

Ajouter un code d'erreur demande de le poser dans `ErrorCode` **et** dans les
deux catalogues de l'app. Trois tests tiennent la chaîne : un refus de tout code
renvoyé hors catalogue, une comparaison des clés anglaises et espagnoles, et le
typage TypeScript qui rejette une clé manquante à la compilation.

Le contenu saisi par les commerces — noms et descriptions d'items — n'est jamais
traduit. La devise vient du commerce, jamais de la langue.

---

## Configuration

Aucune variable n'a de valeur de repli dans le code : une variable absente fait
échouer le démarrage. Voir `api/.env.example` et `app/.env.example`.

`TEST_DATABASE_URL` doit désigner une base distincte de `DATABASE_URL` — la
session pytest la crée et la détruit, et refuse de tourner sinon.

---

## Structure

```
api/                Backend FastAPI
  app/core/         configuration, sécurité, session base
  app/models/       modèles SQLAlchemy
  app/schemas/      schémas Pydantic
  app/services/     logique métier
  app/routers/      routes HTTP
  app/integrations/ adaptateurs par plateforme sociale
  app/workers/      tâches de fond
  alembic/          migrations
  tests/
app/                Application Expo (créateur et commerce)
docs/
```

La logique métier vit dans `services/`. Les routes valident, appellent un
service, renvoient. Aucune requête base directement dans un routeur.
