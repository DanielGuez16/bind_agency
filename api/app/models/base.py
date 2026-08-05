"""Base déclarative commune à tous les modèles.

Vide de tout modèle à ce stade : le modèle de données est la tâche suivante de
la phase 1. `alembic/env.py` lit les métadonnées d'ici pour l'autogénération.
"""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass
