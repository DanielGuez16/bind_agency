"""la reservation se ferme quand sa contrepartie est tranchee

Revision ID: c7d4e1a90b52
Revises: 59427812e134
Create Date: 2026-09-04 09:12:44.201883+00:00

Écrite à la main, sur le modèle de `b9802e6028a8` qui a ajouté
`awaiting_business` : l'autogénération ne voit pas qu'un enum applicatif est un
VARCHAR plus une contrainte CHECK, et laisserait la contrainte d'origine — le
schéma accepterait la colonne et refuserait la valeur, à l'exécution, sur la
première contrepartie approuvée.

**Pas d'`alter_column` ici.** `closed` fait six caractères et la colonne est déjà
en VARCHAR(17) depuis l'ajout d'`awaiting_business` ; seule la contrainte change.

**La reprise des données n'est pas un supplément, c'est le point.** Sans elle,
toutes les réservations déjà servies dont la publication a été tranchée restent
`consumed` : le compteur « à envoyer » garde son chiffre gonflé, l'onglet des
terminées reste vide de tout ce qui a été honoré, et le défaut qu'on corrige
survit exactement là où on l'a constaté — sur le jeu de démonstration.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "c7d4e1a90b52"
down_revision: str | Sequence[str] | None = "59427812e134"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Le nom **court**. La convention de nommage du métadata le préfixe une
#: seconde fois ; le passer préfixé produirait `ck_booking_ck_booking_…`.
CONTRAINTE = "booking_status"

AVANT = ("held", "awaiting_business", "confirmed", "consumed", "cancelled", "no_show", "expired")
APRES = (
    "held",
    "awaiting_business",
    "confirmed",
    "consumed",
    "closed",
    "cancelled",
    "no_show",
    "expired",
)

#: Les trois façons dont un dossier de publication se termine. Recopiées plutôt
#: qu'importées : une migration doit dire ce qu'elle a fait le jour où elle l'a
#: fait, et un `frozenset` du code applicatif change sous elle.
ISSUES_TERMINALES = ("approved", "unfulfilled", "closed_no_fault")


def _check(valeurs: tuple[str, ...]) -> str:
    liste = ", ".join(f"'{valeur}'" for valeur in valeurs)
    return f"status IN ({liste})"


def _liste(valeurs: tuple[str, ...]) -> str:
    return ", ".join(f"'{valeur}'" for valeur in valeurs)


def upgrade() -> None:
    op.drop_constraint(CONTRAINTE, "booking", type_="check")
    op.create_check_constraint(CONTRAINTE, "booking", _check(APRES))

    # **La contrainte d'abord, la reprise ensuite.** L'inverse écrirait une
    # valeur que la contrainte en place refuse encore.
    op.execute(
        f"""
        UPDATE booking
           SET status = 'closed'
         WHERE status = 'consumed'
           AND EXISTS (
                 SELECT 1
                   FROM collaboration
                  WHERE collaboration.booking_id = booking.id
                    AND collaboration.status IN ({_liste(ISSUES_TERMINALES)})
               )
        """
    )


def downgrade() -> None:
    # `closed` retourne à `consumed`, l'état d'où il vient et dont il ne se
    # distingue que par l'issue de la contrepartie — laquelle est intacte. Rien
    # ne se perd : l'ancien code recalculait cette distinction à la lecture.
    op.execute("UPDATE booking SET status = 'consumed' WHERE status = 'closed'")

    op.drop_constraint(CONTRAINTE, "booking", type_="check")
    op.create_check_constraint(CONTRAINTE, "booking", _check(AVANT))
