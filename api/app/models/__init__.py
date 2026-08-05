"""Modèles SQLAlchemy.

Chaque module de modèle devra être importé ici pour qu'Alembic le voie à
l'autogénération.
"""

from app.models.base import Base

__all__ = ["Base"]
