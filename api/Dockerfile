# Image de l'API.
#
# **Deux étapes.** La première installe les dépendances, la seconde ne garde
# que le résultat : l'image finale ne porte ni compilateur ni cache de paquets,
# ce qui la fait démarrer plus vite — et sur un hébergeur qui endort le service,
# la vitesse de démarrage est ce qu'on regarde.
#
# **Aucun secret ici.** Ni identifiant, ni clé, ni URL de base : tout arrive par
# l'environnement, posé chez l'hébergeur. Une image se pousse dans un registre
# et se lit ; ce qu'elle contient est public par construction.
#
# **`psycopg[binary]`** évite d'avoir à compiler contre libpq : pas de
# `build-essential`, pas de `libpq-dev`, et une image deux fois plus petite.

FROM python:3.12-slim AS build

WORKDIR /app

# Les métadonnées d'abord, le code ensuite : tant que les dépendances ne
# bougent pas, cette couche est réutilisée et la construction ne réinstalle
# rien.
COPY pyproject.toml ./
RUN python -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
 && /opt/venv/bin/pip install --no-cache-dir .

FROM python:3.12-slim

# `PYTHONUNBUFFERED` : sans lui, les journaux restent dans un tampon et
# n'arrivent chez l'hébergeur qu'au redémarrage — c'est-à-dire jamais quand on
# en a besoin.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/opt/venv/bin:$PATH"

WORKDIR /app

COPY --from=build /opt/venv /opt/venv
COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app
COPY scripts ./scripts

# Utilisateur sans privilège. Une API qui tourne en `root` n'en a pas besoin,
# et le jour où une faille permet d'écrire un fichier, la différence compte.
RUN useradd --create-home --uid 10001 bind \
 && chown -R bind:bind /app
USER bind

# L'hébergeur impose son port par `PORT`. La valeur par défaut sert au
# développement et aux essais locaux de l'image.
ENV PORT=8010
EXPOSE 8010

# **Le schéma est migré avant que le premier octet soit servi.**
#
# Rien ne l'appliquait : ni ce fichier, ni `render.yaml`. Le schéma ne bougeait
# que lorsque quelqu'un lançait `make demo-seed` à la main, tandis que le code
# déployé avançait à chaque fusion. Les deux ont divergé, et l'API a servi des
# 500 sur toutes les routes qui lisent un commerce — une colonne que le code
# demandait et que la base n'avait pas. La panne s'est présentée comme un défaut
# d'authentification, puis comme une panne réseau.
#
# **Au démarrage et non en pré-déploiement** : la commande de pré-déploiement de
# Render demande un plan payant, celui-ci est gratuit. Le coût est une poignée
# de secondes à chaque réveil, sur un démarrage à froid qui en prend déjà
# soixante ; `alembic upgrade head` ne fait rien quand il n'y a rien à faire.
#
# **`&&` et non `;`** : une migration qui échoue empêche l'API de démarrer.
# Servir avec un schéma dont on sait qu'il est faux est ce qu'on corrige ici.
#
# `sh -c` : `PORT` doit être développé au démarrage, pas figé à la
# construction.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
