"""un profil anonymise ne se reecrit pas

`app_user` avait déjà son garde-fou : un compte passé en `anonymized` ne peut
plus en sortir. `creator_profile`, lui, n'en avait aucun — les champs personnels
y étaient simplement mis à `NULL`, et rien n'empêchait de les remplir à nouveau.

Cela n'avait pas d'occasion de se produire tant qu'aucune route n'écrivait ces
champs. La tâche « Profil créateur en écriture » en crée une, et l'anonymisation
cesserait d'être définitive au premier chemin d'écriture qui oublierait de
vérifier — un import, une reprise de données, un futur écran d'administration.

Le trigger refuse de repasser un champ personnel effacé à une valeur non nulle
quand `anonymized_at` est posé. Il n'interdit pas les autres écritures :
`reliability_score` et `completed_collabs_count` restent des faits sur des
collaborations qui ont eu lieu, et doivent pouvoir être recalculés.

Revision ID: fd260f31365f
Revises: 32248e23a751
Create Date: 2026-08-06 15:10:00.000000+00:00

"""

from alembic import op

revision: str = "fd260f31365f"
down_revision: str | None = "32248e23a751"
branch_labels: str | None = None
depends_on: str | None = None

FONCTION = """
CREATE OR REPLACE FUNCTION creator_profile_stays_anonymized()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.anonymized_at IS NOT NULL THEN
        IF NEW.anonymized_at IS NULL THEN
            RAISE EXCEPTION 'creator_profile %: anonymisation irreversible', OLD.user_id;
        END IF;

        IF NEW.first_name IS NOT NULL
            OR NEW.last_name IS NOT NULL
            OR NEW.city IS NOT NULL
            OR NEW.bio IS NOT NULL
            OR NEW.geo IS NOT NULL
        THEN
            RAISE EXCEPTION
                'creator_profile %: un champ personnel efface ne se remplit pas', OLD.user_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
"""

TRIGGER = """
CREATE TRIGGER creator_profile_stays_anonymized
BEFORE UPDATE ON creator_profile
FOR EACH ROW EXECUTE FUNCTION creator_profile_stays_anonymized();
"""


def upgrade() -> None:
    op.execute(FONCTION)
    op.execute(TRIGGER)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS creator_profile_stays_anonymized ON creator_profile")
    op.execute("DROP FUNCTION IF EXISTS creator_profile_stays_anonymized()")
