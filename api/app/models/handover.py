"""La prise en main d'une fiche préparée sur le terrain.

**Pourquoi cette table existe.** La fondatrice démarche en physique, tablette à
la main. Elle peut saisir des *faits* — nom, adresse, horaires, carte des
prestations, photos — aussi bien que le salon, et c'est là que sont les trente
minutes qui font renoncer au comptoir. Elle ne peut pas poser les
*engagements* : le mot de passe, l'acceptation des conditions, la mise en ligne.
Si elle les posait, personne ne pourrait dire qui a accepté quoi, elle
détiendrait les identifiants d'un tiers, et le premier litige n'aurait aucune
réponse.

Cette table est exactement la charnière entre les deux : le jeton qui passe la
fiche préparée à celui qui l'assume.

**Le jeton n'est pas stocké.** Seule son empreinte l'est, comme partout
ailleurs : un jeton en clair en base ouvrirait tous les salons préparés le jour
d'une fuite. La comparaison se fait sur l'empreinte, jamais sur le jeton.

**Un seul vivant par commerce.** Renvoyer le lien à un gérant qui l'a perdu
émet un nouveau jeton et révoque l'ancien. Sans cela, un lien envoyé trois fois
laisserait trois portes ouvertes, dont deux que personne ne surveille.

**Rien ne s'efface, tout se date.** Émis, utilisé, révoqué, expiré : ces quatre
dates sont ce qui permet de lire, des mois plus tard, le taux de conversion du
démarchage physique — le seul chiffre qui dira si la tournée vaut le
déplacement.
"""

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPrimaryKey, enum_column
from app.models.enums import HandoverChannel


class BusinessHandover(UUIDPrimaryKey, Base):
    """Le droit, à usage unique et borné dans le temps, d'assumer une fiche."""

    __tablename__ = "business_handover"

    # CASCADE : une invitation n'a aucun sens sans le commerce qu'elle invite à
    # prendre. **La preuve de l'engagement, elle, ne vit pas ici** — elle est
    # écrite au journal d'audit, que rien ne modifie ni ne supprime. C'est ce
    # qui permet à un prospect qui n'a rien donné de disparaître proprement
    # sans emporter la trace de ce que quelqu'un a un jour accepté.
    business_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("business.id", ondelete="CASCADE"), nullable=False
    )

    #: L'empreinte du jeton, jamais le jeton. `bytea`, même traitement que le
    #: secret d'un code de retrait et que les jetons OAuth.
    token_hash: Mapped[bytes] = mapped_column(sa.LargeBinary, nullable=False)

    #: Par où il est parti. Le QR ne porte pas de destination : la personne qui
    #: scanne est celle qui est devant la tablette, et c'est précisément ce qui
    #: en fait le meilleur chemin quand le décideur est là.
    channel: Mapped[HandoverChannel] = mapped_column(
        enum_column(HandoverChannel, "handover_channel"), nullable=False
    )
    #: L'adresse à laquelle le lien a été envoyé. Nulle pour un QR. Conservée
    #: pour le support — « où l'ai-je envoyé » est la première question quand
    #: un gérant dit ne rien avoir reçu.
    destination: Mapped[str | None] = mapped_column(sa.Text, nullable=True)

    #: RESTRICT : savoir qui a préparé la fiche est le fondement de la mesure
    #: du démarchage. Cet utilisateur ne disparaît pas en silence.
    issued_by_user_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("app_user.id", ondelete="RESTRICT"), nullable=False
    )
    #: `clock_timestamp()` : émettre un nouveau jeton révoque le précédent dans
    #: la même transaction, et `now()` leur donnerait le même instant — le
    #: journal ne saurait plus lequel a remplacé l'autre. Même correction que
    #: sur les jetons de rafraîchissement.
    issued_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("clock_timestamp()")
    )
    expires_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)

    used_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    #: Qui a assumé la fiche. Le compte créé à la prise en main, ou celui qui
    #: existait déjà et s'est rattaché.
    used_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("app_user.id", ondelete="RESTRICT"), nullable=True
    )
    #: La version des conditions acceptée à cet instant. **Une version, pas un
    #: booléen** : « il a accepté » ne vaut rien si l'on ne sait pas quoi. Elle
    #: vient de la configuration, jamais d'une constante dans le code.
    accepted_terms_version: Mapped[str | None] = mapped_column(sa.Text, nullable=True)

    revoked_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)

    __table_args__ = (
        sa.UniqueConstraint("token_hash"),
        # Utilisé, révoqué : jamais les deux. Un jeton consommé puis « révoqué »
        # laisserait croire qu'on a fermé une porte qui était déjà franchie.
        sa.CheckConstraint(
            "used_at IS NULL OR revoked_at IS NULL", name="pas_utilise_et_revoque_a_la_fois"
        ),
        # Ce qu'une prise en main porte, elle le porte entièrement : qui, et sur
        # quelle version des conditions. Sans l'équivalence, on finirait par
        # avoir des fiches assumées dont on ne sait ni par qui ni sur quoi —
        # exactement ce que ce dispositif existe pour éviter.
        sa.CheckConstraint(
            "(used_at IS NULL) = (used_by_user_id IS NULL AND accepted_terms_version IS NULL)",
            name="prise_en_main_a_son_auteur_et_sa_version",
        ),
        sa.CheckConstraint("expires_at > issued_at", name="expire_apres_emission"),
        # Le jeton vivant d'un commerce, et la liste de suivi de la fondatrice.
        sa.Index("ix_business_handover_business_id_issued_at", "business_id", "issued_at"),
    )
