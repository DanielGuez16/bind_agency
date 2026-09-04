"""le portail d'age a l'inscription

Revision ID: a1c7e4f92b30
Revises: d4e980bb7072
Create Date: 2026-09-04

Écrite à la main, et pour trois raisons que l'autogénération ne voit pas.

**La colonne est nullable, et resserrée par une contrainte plutôt que par
`NOT NULL`.** `date_of_birth` doit disparaître à l'anonymisation — c'est une
donnée personnelle — donc elle ne peut pas être `NOT NULL`. Ce qui la garde est
`birth_date_unless_anonymized`, le patron exact d'`email` et `password_hash`,
nullables pour la même raison et jamais nulles sur un compte vivant.

**Les comptes existants ne sont pas remplis, et c'est le point délicat.**
Personne ne leur a jamais demandé leur date de naissance. Leur en poser une —
même un 1er janvier — fabriquerait une déclaration qui n'a pas eu lieu, sur le
champ dont toute la valeur est précisément d'avoir été déclaré. Le dépôt a déjà
tranché ce genre de cas : « le défaut inconfortable est le seul honnête ».

La contrainte est donc posée **NOT VALID** : elle garde tout ce qui s'écrit à
partir d'aujourd'hui sans prétendre que le passé la respectait. Les comptes
d'avant restent lisibles, et leur date reste nulle — ce qui se lit correctement
comme « jamais demandé », et non comme « vérifié ».

**Le trigger d'anonymisation est réécrit**, pas remplacé. Il porte sa liste de
colonnes en dur, et rien ne la compare à ce que le service efface : une colonne
personnelle oubliée là resterait réinscriptible après anonymisation, ce qui est
exactement le défaut que le trigger existe pour empêcher.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a1c7e4f92b30"
down_revision: str | Sequence[str] | None = "19a8ece72f1e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


#: Le corps du trigger de gel du compte, **augmenté** de la date de naissance
#: et du nom d'affichage.
#:
#: **Recopié depuis `89f621c1f80f` mot pour mot**, y compris les messages : une
#: migration doit pouvoir se rejouer telle quelle dans dix ans. La première
#: version de ce fichier les avait réécrits de mémoire — en reprenant ceux du
#: trigger du *profil*, qui est un autre texte — et la seule chose qui l'a dit
#: est un test qui cherchait la phrase exacte.
FONCTION_APRES = """
CREATE OR REPLACE FUNCTION app_user_reject_deanonymization() RETURNS trigger AS $$
BEGIN
    IF OLD.status = 'anonymized' THEN
        IF NEW.status <> 'anonymized' THEN
            RAISE EXCEPTION 'un compte anonymise ne peut pas etre reactive'
                USING ERRCODE = 'restrict_violation';
        END IF;

        IF NEW.email IS NOT NULL
           OR NEW.phone IS NOT NULL
           OR NEW.password_hash IS NOT NULL
           OR NEW.date_of_birth IS NOT NULL
           OR NEW.display_name IS NOT NULL THEN
            RAISE EXCEPTION 'un compte anonymise ne peut pas recouvrer ses donnees personnelles'
                USING ERRCODE = 'restrict_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
"""

#: Le corps d'avant, pour que `downgrade` restaure au lieu de supprimer.
FONCTION_AVANT = """
CREATE OR REPLACE FUNCTION app_user_reject_deanonymization() RETURNS trigger AS $$
BEGIN
    IF OLD.status = 'anonymized' THEN
        IF NEW.status <> 'anonymized' THEN
            RAISE EXCEPTION 'un compte anonymise ne peut pas etre reactive'
                USING ERRCODE = 'restrict_violation';
        END IF;

        IF NEW.email IS NOT NULL
           OR NEW.phone IS NOT NULL
           OR NEW.password_hash IS NOT NULL THEN
            RAISE EXCEPTION 'un compte anonymise ne peut pas recouvrer ses donnees personnelles'
                USING ERRCODE = 'restrict_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
"""


def upgrade() -> None:
    op.add_column("app_user", sa.Column("date_of_birth", sa.Date(), nullable=True))
    op.add_column(
        "app_user", sa.Column("age_verified_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("app_user", sa.Column("age_minimum_applique", sa.Integer(), nullable=True))

    # **NOT VALID**, voir la docstring : elle garde l'avenir sans mentir sur le
    # passé. `create_check_constraint` ne le sait pas faire, d'où le SQL.
    op.execute(
        "ALTER TABLE app_user ADD CONSTRAINT ck_app_user_birth_date_unless_anonymized "
        "CHECK (status = 'anonymized' OR date_of_birth IS NOT NULL) NOT VALID"
    )
    # Celle-ci est validée : aucune ligne existante ne porte l'une des deux
    # colonnes, donc elle est vraie du passé comme de l'avenir.
    op.create_check_constraint(
        "age_mark_together",
        "app_user",
        "(age_verified_at IS NULL) = (age_minimum_applique IS NULL)",
    )

    op.execute(FONCTION_APRES)


def downgrade() -> None:
    op.execute(FONCTION_AVANT)
    op.drop_constraint(op.f("ck_app_user_age_mark_together"), "app_user", type_="check")
    op.execute("ALTER TABLE app_user DROP CONSTRAINT ck_app_user_birth_date_unless_anonymized")
    op.drop_column("app_user", "age_minimum_applique")
    op.drop_column("app_user", "age_verified_at")
    op.drop_column("app_user", "date_of_birth")
