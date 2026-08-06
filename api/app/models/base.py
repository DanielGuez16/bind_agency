"""Base déclarative, conventions de nommage et briques communes.

La `naming_convention` est posée avant la première migration : sans elle, une
contrainte anonyme créée aujourd'hui serait impossible à supprimer proprement
dans une migration ultérieure.

Postgres tronque les identifiants à 63 caractères. Les noms générés par la
convention sont vérifiés par un test ; toute contrainte qui dépasse doit être
nommée explicitement plutôt que laissée à la troncature.
"""

import uuid
from datetime import datetime
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_N_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

POSTGRES_IDENTIFIER_MAX_LENGTH = 63


class Base(DeclarativeBase):
    metadata = sa.MetaData(naming_convention=NAMING_CONVENTION)


def enum_column(enum_class: type[StrEnum], name: str) -> sa.Enum:
    """Enum applicatif rendu en VARCHAR + CHECK, jamais en type ENUM natif.

    Altérer un enum natif en migration est un piège dont on se passe.
    `values_callable` est indispensable : sans lui SQLAlchemy stockerait le nom
    du membre (`CREATOR`) et non sa valeur (`creator`).
    """
    return sa.Enum(
        enum_class,
        name=name,
        native_enum=False,
        create_constraint=True,
        validate_strings=True,
        values_callable=lambda cls: [member.value for member in cls],
    )


def money_column(**kwargs: object) -> Mapped[int]:
    """Montant en centimes. Entier 64 bits, jamais de flottant ni de Numeric.

    Aucune colonne de devise n'accompagne un montant : la devise est portée par
    le commerce, ou par le plan d'abonnement pour ce qui est au niveau
    plateforme.
    """
    return mapped_column(sa.BigInteger, **kwargs)  # type: ignore[arg-type]


class UUIDPrimaryKey:
    """Clé primaire UUID générée côté application.

    Pas de séquence entière : les identifiants de commerces et de réservations
    circulent dans des URL et des codes, ils ne doivent pas être énumérables.
    """

    # sort_order négatif : la clé primaire reste la première colonne de la
    # table plutôt que d'être reléguée après les colonnes du modèle.
    id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid, primary_key=True, default=uuid.uuid4, sort_order=-100
    )


class CreatedAt:
    """Instant de création, à la précision de l'instruction.

    `clock_timestamp()` et non `now()` : ce dernier est figé pour toute la
    transaction, si bien que dix lignes créées à la suite prétendraient l'avoir
    été au même instant. Le mixin étant partagé par neuf tables, corriger ici
    ferme la question pour toutes — y compris celles dont personne n'ordonne
    encore les lignes, mais dont quelqu'un le fera.
    """

    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("clock_timestamp()"),
        sort_order=100,
    )
