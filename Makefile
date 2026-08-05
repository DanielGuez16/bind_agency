.DEFAULT_GOAL := help

API      := api
APP      := app
VENV     := $(API)/.venv
PY       := $(VENV)/bin/python
PYTHON   ?= python3.12
COMPOSE  := docker compose

.PHONY: help install db-up db-down db-logs dev app test test-api test-app lint fmt migrate clean

help: ## Liste les cibles disponibles
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

install: ## Crée le venv, installe les dépendances Python et Node
	$(PYTHON) -m venv $(VENV)
	$(PY) -m pip install --upgrade pip
	$(PY) -m pip install -e "$(API)[dev]"
	@test -f $(API)/.env || cp $(API)/.env.example $(API)/.env
	@test -f $(APP)/.env || cp $(APP)/.env.example $(APP)/.env
	cd $(APP) && npm install

db-up: ## Démarre Postgres et attend qu'il réponde
	$(COMPOSE) up -d --wait db

db-down: ## Arrête Postgres (le volume est conservé)
	$(COMPOSE) down

db-logs: ## Suit les logs de Postgres
	$(COMPOSE) logs -f db

dev: db-up ## Lance l'API sur http://localhost:8010
	cd $(API) && ../$(VENV)/bin/uvicorn app.main:app --reload --port 8010

app: ## Lance l'app Expo (appuyer sur `w` pour le build web)
	cd $(APP) && npx expo start

test: test-api test-app ## Lance les deux suites

test-api: db-up ## Lance pytest sur une base de test dédiée
	cd $(API) && .venv/bin/pytest -q

test-app: ## Lance jest sur l'app
	cd $(APP) && npx jest

lint: ## Vérifie le style Python et les types de l'app
	$(PY) -m ruff check $(API)
	$(PY) -m ruff format --check $(API)
	cd $(APP) && npx tsc --noEmit

fmt: ## Reformate le code Python
	$(PY) -m ruff format $(API)
	$(PY) -m ruff check --fix $(API)

migrate: db-up ## Applique les migrations Alembic
	cd $(API) && .venv/bin/alembic upgrade head

clean: ## Supprime le conteneur, son volume et les artefacts locaux
	$(COMPOSE) down -v
	rm -rf $(VENV) $(API)/.pytest_cache $(API)/.ruff_cache
