"""Filtres de comparaison de schéma, partagés par Alembic et par les tests.

Les CHECK produits par `sa.Enum(native_enum=False, create_constraint=True)` sont
marqués `_type_bound` par SQLAlchemy. Le plugin de comparaison d'Alembic les lit
en base mais ne les reconnaît pas côté métadonnées : sans filtre, chaque
autogénération propose de les supprimer, ce qui retirerait en silence toute la
validation des enums. Ils sont donc exclus des deux côtés de la comparaison.

`spatial_ref_sys` appartient à l'extension PostGIS, pas au schéma applicatif.
"""

import sqlalchemy as sa

EXTENSION_OWNED_TABLES = frozenset({"spatial_ref_sys"})

# L'image postgis installe aussi postgis_topology et postgis_tiger_geocoder dans
# la base de développement, et ajoute leurs schémas au search_path. Une base
# créée depuis template1 — celle des tests, celle de la CI — ne les a pas.
APPLICATION_SCHEMA = "public"


def type_bound_check_names(metadata: sa.MetaData) -> frozenset[str]:
    """Noms des CHECK engendrés par un type, à ne jamais comparer."""
    return frozenset(
        str(constraint.name)
        for table in metadata.tables.values()
        for constraint in table.constraints
        if isinstance(constraint, sa.CheckConstraint)
        and getattr(constraint, "_type_bound", False)
        and constraint.name is not None
    )


def make_include_object(metadata: sa.MetaData):
    """Construit le prédicat `include_object` attendu par Alembic."""
    ignored_checks = type_bound_check_names(metadata)

    def include_object(object_, name, type_, reflected, compare_to):  # noqa: ARG001
        if type_ == "table":
            if name in EXTENSION_OWNED_TABLES:
                return False
            if object_.schema is not None and object_.schema != APPLICATION_SCHEMA:
                return False
        if type_ == "check_constraint":
            return name not in ignored_checks
        return True

    return include_object
