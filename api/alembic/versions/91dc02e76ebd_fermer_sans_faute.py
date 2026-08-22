"""fermer sans faute

Revision ID: 91dc02e76ebd
Revises: c9ddb3eb1e67
Create Date: 2026-08-22 00:41:02.071632+00:00

"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "91dc02e76ebd"
down_revision: Union[str, Sequence[str], None] = "c9ddb3eb1e67"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """La quatrième issue de l'arbitrage entre dans le vocabulaire.

    **Écrite à la main, et l'autogénération n'y peut rien.** Une énumération
    applicative se rend en VARCHAR + CHECK : ajouter une valeur ne change
    aucune colonne, et la comparaison de schéma ne lit pas la liste. Alembic a
    produit un `pass`. Sans ces lignes, la première clôture sans faute serait
    refusée par la base — et le défaut ne se verrait qu'en exploitation, sur le
    seul dossier que personne ne sait plus trancher.
    """
    op.drop_constraint("collaboration_status", "collaboration", type_="check")
    op.create_check_constraint(
        "collaboration_status",
        "collaboration",
        "status IN ('pending', 'submitted', 'under_review', 'approved', 'resubmit_requested', 'unfulfilled', 'closed_no_fault')",
    )


def downgrade() -> None:
    """Les dossiers clos sans faute redeviennent non honorés.

    **Une conversion et non une suppression.** Ces dossiers sont clos ; les
    effacer perdrait l'historique d'un salon, et les laisser ferait échouer la
    contrainte restreinte. `unfulfilled` est le plus proche voisin — c'est
    d'ailleurs ce qu'ils auraient été sans cette issue — au prix d'une faute
    qu'ils n'ont pas commise. Le journal d'audit, lui, garde la vérité : il
    porte la transition d'origine, et il est immuable.
    """
    op.execute("UPDATE collaboration SET status = 'unfulfilled' WHERE status = 'closed_no_fault'")
    op.drop_constraint("collaboration_status", "collaboration", type_="check")
    op.create_check_constraint(
        "collaboration_status",
        "collaboration",
        "status IN ('pending', 'submitted', 'under_review', 'approved', 'resubmit_requested', 'unfulfilled')",
    )
