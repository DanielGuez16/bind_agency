"""un abonnement peut être incomplet

Stripe ouvre un abonnement en `incomplete` tant que le premier paiement n'a pas
abouti — c'est le comportement de `payment_behavior=default_incomplete`, et
c'est celui qu'on veut : un commerce ne participe pas avant d'avoir payé.

**Deux choses à changer, et l'autogénération n'en voit qu'une.** L'énumération
est rendue en `VARCHAR` + `CHECK`, jamais en type natif. Élargir la colonne sans
réécrire la contrainte laisse un `CHECK` qui refuse toujours la nouvelle valeur,
et le défaut n'apparaît qu'à la première insertion — au moment où un commerce
tente de s'abonner. La contrainte est donc retirée, la colonne élargie, la
contrainte reposée avec le jeu complet.

L'ordre compte : retirer la contrainte **avant** d'élargir. L'inverse ferait
échouer l'élargissement sur des lignes que l'ancienne contrainte accepte encore.

Revision ID: c4639ddeb226
Revises: f05a2b2458c7
Create Date: 2026-08-07
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c4639ddeb226"
down_revision: str | Sequence[str] | None = "f05a2b2458c7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Le nom **court**. La convention de nommage du métadonnées préfixe déjà par
#: `ck_<table>_`, et passer le nom complet à `op` le préfixerait une seconde
#: fois — la suppression viserait alors une contrainte qui n'existe pas.
CONTRAINTE = "subscription_status"

ANCIENS = ("trialing", "active", "past_due", "canceled")
NOUVEAUX = ("incomplete", *ANCIENS)


def _valeurs(valeurs: tuple[str, ...]) -> str:
    return ", ".join(f"'{valeur}'" for valeur in valeurs)


def upgrade() -> None:
    op.drop_constraint(CONTRAINTE, "subscription", type_="check")

    # `incomplete` fait dix caractères ; la colonne en portait huit, taillée sur
    # `past_due`. Sans cet élargissement, l'insertion serait tronquée ou
    # refusée selon le mode du serveur.
    op.alter_column(
        "subscription",
        "status",
        existing_type=sa.VARCHAR(length=8),
        type_=sa.VARCHAR(length=10),
        existing_nullable=False,
    )

    op.create_check_constraint(CONTRAINTE, "subscription", f"status IN ({_valeurs(NOUVEAUX)})")


def downgrade() -> None:
    """Le retour n'est possible que si plus rien n'est `incomplete`.

    On ne réécrit pas les lignes : un abonnement incomplet ramené à `canceled`
    ferait disparaître un paiement en attente, et à `active` ferait participer
    un commerce qui n'a pas payé. Les deux sont pires que le refus.
    """
    restants = (
        op.get_bind()
        .execute(sa.text("SELECT count(*) FROM subscription WHERE status = 'incomplete'"))
        .scalar_one()
    )
    if restants:
        raise RuntimeError(
            f"{restants} abonnement(s) en « incomplete » : le retour arrière les rendrait "
            "invalides. Tranchez-les avant, dans un sens ou dans l'autre."
        )

    op.drop_constraint(CONTRAINTE, "subscription", type_="check")
    op.alter_column(
        "subscription",
        "status",
        existing_type=sa.VARCHAR(length=10),
        type_=sa.VARCHAR(length=8),
        existing_nullable=False,
    )
    op.create_check_constraint(CONTRAINTE, "subscription", f"status IN ({_valeurs(ANCIENS)})")
