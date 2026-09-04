"""centres d'interet du createur

**Une liste fermee, pour la meme raison que les quartiers.** C'est un axe de
navigation : le salon filtre son annuaire dessus. Deux creatrices qui
ecriraient « ongles » et « nail art » ne se compteraient pas ensemble, et le
filtre annoncerait deux specialites la ou il y en a une. La liste est donc
doublee dans une contrainte, parce qu'une validation Pydantic ne survit pas a
un INSERT ecrit a la main.

**Plus fine que `business_category`, et c'est le but.** La categorie decrit ce
qu'un commerce *est* — `beauty` couvre le coloriste et la prothesiste ongulaire
sous la meme etiquette. L'interet decrit ce qu'une creatrice *veut faire* : les
confondre ramenerait le filtre a l'axe qui existe deja.

**Aucun remplissage retroactif, volontairement.** Aucune creatrice inscrite
avant ce champ n'a choisi quoi que ce soit, et lui attribuer un interet a la
migration inventerait une donnee qu'elle n'a pas donnee. La colonne est donc
nullable et le « au moins un » ne vaut qu'au moment ou elle remplit le champ,
pas a l'existence de la ligne — la meme regle que `bio`, nulle pour tout le
monde tant que personne ne l'ecrit.

**Trois au plus.** Celle qui coche tout n'est plus filtrable, et le salon qui
cherche une specialiste la trouverait partout. Zero ne s'ecrit pas : le schema
ramene la liste vide a NULL, sinon « je n'ai rien declare » aurait deux
ecritures et le filtre devrait connaitre les deux.

Revision ID: 19a8ece72f1e
Revises: d4e980bb7072
Create Date: 2026-09-04 16:23:33.224967+00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "19a8ece72f1e"
down_revision: Union[str, Sequence[str], None] = "d4e980bb7072"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("creator_profile", sa.Column("interests", sa.ARRAY(sa.Text()), nullable=True))
    op.create_check_constraint(
        op.f("ck_creator_profile_interets_connus"),
        "creator_profile",
        "interests IS NULL OR interests <@ ARRAY['coiffure', 'ongles', 'soin_du_visage', 'massage_et_spa', 'maquillage', 'restaurant', 'cafe_et_brunch', 'fitness', 'culture', 'famille']::text[]",
    )
    op.create_check_constraint(
        op.f("ck_creator_profile_interets_entre_un_et_trois"),
        "creator_profile",
        "interests IS NULL OR (cardinality(interests) BETWEEN 1 AND 3)",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        op.f("ck_creator_profile_interets_entre_un_et_trois"), "creator_profile", type_="check"
    )
    op.drop_constraint(op.f("ck_creator_profile_interets_connus"), "creator_profile", type_="check")
    op.drop_column("creator_profile", "interests")
