"""Commerce, membres, plans et abonnements."""

import uuid
from datetime import datetime

import sqlalchemy as sa
from geoalchemy2 import Geography
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAt, UUIDPrimaryKey, enum_column, money_column
from app.models.enums import (
    BillingInterval,
    BusinessCategory,
    BusinessMemberRole,
    BusinessStatus,
    Locale,
    Neighborhood,
    SubscriptionStatus,
    SuspensionReason,
)


class Business(UUIDPrimaryKey, CreatedAt, Base):
    __tablename__ = "business"

    name: Mapped[str] = mapped_column(sa.Text, nullable=False)
    category: Mapped[BusinessCategory] = mapped_column(
        enum_column(BusinessCategory, "business_category"), nullable=False
    )
    # Nullables pendant l'onboarding : un géocodage peut échouer, adresse mal
    # saisie ou service indisponible, et l'inscription ne doit pas se bloquer
    # là-dessus. La garantie est reportée au passage en `active`, ci-dessous.
    address: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    #: Le quartier, déclaré par le commerce et choisi dans une liste fermée.
    #:
    #: **Une colonne, pas une lecture de l'adresse.** Le fil groupe dessus et en
    #: rend le compte : le déduire à la volée d'une chaîne libre ferait dépendre
    #: un axe de navigation de la façon dont chacun écrit sa rue.
    #:
    #: Nullable : un salon hors des quartiers ouverts n'en a pas, et il reste
    #: parfaitement réservable — il n'apparaît simplement dans aucun groupe.
    neighborhood: Mapped[Neighborhood | None] = mapped_column(
        enum_column(Neighborhood, "neighborhood"), nullable=True
    )
    geo: Mapped[object | None] = mapped_column(
        Geography(geometry_type="POINT", srid=4326, spatial_index=False), nullable=True
    )
    timezone: Mapped[str] = mapped_column(
        sa.Text, nullable=False, server_default=sa.text("'America/New_York'")
    )
    default_locale: Mapped[Locale] = mapped_column(
        enum_column(Locale, "locale"), nullable=False, server_default=Locale.EN.value
    )
    phone: Mapped[str | None] = mapped_column(sa.Text, nullable=True)

    # Seule et unique devise du commerce. Aucun montant de son catalogue ni de
    # ses réservations ne porte la sienne : c'est celle-ci qui fait foi.
    currency: Mapped[str] = mapped_column(sa.String(3), nullable=False)

    # Clé dans le stockage objet, jamais une URL. Une URL signée expire, une URL
    # publique fuit, et les deux se retrouveraient figées dans la base le jour
    # où l'on change de fournisseur. La clé, elle, ne dépend de personne : c'est
    # au moment de servir qu'on en fabrique un accès. Mêmes règles que les
    # preuves de publication.
    #
    # Nullable : un commerce fraîchement inscrit n'a pas encore de photo, et
    # exiger une image avant de pouvoir s'inscrire perdrait des commerces sur
    # une étape qui n'engage rien.
    cover_photo_key: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    #: La couverture verticale, pour le mur du fil.
    #:
    #: **Un champ à part, jamais un remplacement.** La couverture paysage sert
    #: encore la fiche et les listes ; la remplacer casserait ces deux usages
    #: pour un troisième. Le mur retombe sur elle quand celle-ci manque — un
    #: 16:9 recadré en 4:5 vaut mieux qu'un monogramme.
    #:
    #: Livrée en 1600 × 2000. Le dépôt borne le grand côté à 2000, donc ce
    #: format traverse sans rien perdre.
    cover_portrait_key: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    #: L'adresse de la carte du commerce, quand elle existe déjà en ligne.
    #:
    #: **Alternative ou complément aux pages déposées**, jamais un remplacement
    #: obligatoire : forcer un restaurant à photographier une carte déjà bien
    #: présentée sur son site serait absurde, et forcer l'inverse priverait un
    #: salon qui n'a qu'un tableau au mur. L'un ou l'autre suffit — c'est ce que
    #: la règle d'ouverture d'offre vérifie.
    menu_url: Mapped[str | None] = mapped_column(sa.Text, nullable=True)

    status: Mapped[BusinessStatus] = mapped_column(
        enum_column(BusinessStatus, "business_status"),
        nullable=False,
        server_default=BusinessStatus.ONBOARDING.value,
    )

    #: Le commerce tranche lui-même chaque réservation, ou les laisse passer.
    #:
    #: **Vrai par défaut.** Donner une prestation à quelqu'un qu'on n'a pas
    #: regardé est la décision qui demande un accord explicite, pas l'inverse :
    #: un commerce qui ne connaît pas ce réglage doit être protégé par lui, pas
    #: exposé par lui. L'automatique reste disponible pour qui a fait ce choix.
    #: Déclaré aux deux endroits, et ce n'est pas une redondance : le défaut
    #: serveur vaut pour ce qui est écrit hors ORM — la migration, un script —
    #: le défaut Python pour ce que l'ORM insère. Sans le second, inverser
    #: l'intention dans ce fichier ne change rien à l'exécution, et aucun test
    #: ne peut donc la garder.
    requires_booking_approval: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, default=True, server_default=sa.true()
    )

    #: Fin de la période de grâce, quand il y en a une.
    #:
    #: **Aucune carte bancaire n'est demandée à l'ouverture.** C'est la
    #: friction la plus forte du parcours, et elle arriverait au moment exact
    #: où le gérant vient de dire oui. Le salon ouvre, se montre, reçoit des
    #: réservations ; la question de l'abonnement se pose une fois qu'il a vu
    #: ce que ça donne.
    #:
    #: Nulle quand un abonnement vivant existe : il n'y a alors plus d'échéance
    #: à surveiller.
    grace_ends_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    #: Quand l'avertissement d'échéance est parti. **Sans cette date, le
    #: balayage préviendrait à chaque passage** : un salon recevrait le même
    #: message toutes les heures pendant trois jours, et cesserait de lire les
    #: suivants.
    grace_warned_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    #: Pourquoi il a quitté le fil. Voir `SuspensionReason` : les deux raisons
    #: ne se rattrapent pas de la même façon, et souscrire ne doit pas ramener
    #: en ligne un salon qui s'était mis en pause pour travaux.
    suspended_reason: Mapped[SuspensionReason | None] = mapped_column(
        enum_column(SuspensionReason, "suspension_reason"), nullable=True
    )

    __table_args__ = (
        # Un commerce ne devient actif, donc visible dans le fil créateur, que
        # localisable. Tant qu'il est en onboarding, il peut rester incomplet.
        sa.CheckConstraint("status <> 'active' OR geo IS NOT NULL", name="active_requires_geo"),
        sa.CheckConstraint(
            "status <> 'active' OR address IS NOT NULL", name="active_requires_address"
        ),
        # Suspendu et sans raison, ou avec une raison sans être suspendu : les
        # deux rendraient la colonne inutile. La seconde est celle qu'on
        # oublierait — un salon revenu en ligne dont la raison traîne encore
        # ferait croire à un retrait qui n'existe plus.
        sa.CheckConstraint(
            "(status = 'suspended') = (suspended_reason IS NOT NULL)",
            name="suspendu_dit_pourquoi",
        ),
        sa.Index("ix_business_geo", "geo", postgresql_using="gist"),
        sa.Index("ix_business_category_status", "category", "status"),
        # Le balayage des périodes de grâce : les échéances à venir, dans
        # l'ordre. Sans lui, il parcourt tous les commerces à chaque passage.
        sa.Index("ix_business_grace_ends_at", "grace_ends_at"),
    )


class BusinessMember(UUIDPrimaryKey, Base):
    __tablename__ = "business_member"

    business_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("business.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("app_user.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[BusinessMemberRole] = mapped_column(
        enum_column(BusinessMemberRole, "business_member_role"), nullable=False
    )

    __table_args__ = (sa.UniqueConstraint("business_id", "user_id"),)


class SubscriptionPlan(UUIDPrimaryKey, Base):
    """Tarification en données, jamais en constantes dans le code.

    Porte sa propre devise : les plans sont au niveau plateforme, ils ne sont
    rattachés à aucun commerce.
    """

    __tablename__ = "subscription_plan"

    category: Mapped[BusinessCategory] = mapped_column(
        enum_column(BusinessCategory, "business_category"), nullable=False
    )
    name: Mapped[str] = mapped_column(sa.Text, nullable=False)
    price_cents: Mapped[int] = money_column(nullable=False)
    currency: Mapped[str] = mapped_column(sa.String(3), nullable=False)
    billing_interval: Mapped[BillingInterval] = mapped_column(
        enum_column(BillingInterval, "billing_interval"), nullable=False
    )
    features: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=sa.text("'{}'"))
    is_active: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.text("true")
    )

    __table_args__ = (sa.CheckConstraint("price_cents >= 0", name="price_cents_positive"),)


class Subscription(UUIDPrimaryKey, Base):
    __tablename__ = "subscription"

    # RESTRICT : un abonnement est une trace de facturation, il ne disparaît pas
    # avec le commerce.
    business_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("business.id", ondelete="RESTRICT"), nullable=False
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("subscription_plan.id", ondelete="RESTRICT"), nullable=False
    )
    status: Mapped[SubscriptionStatus] = mapped_column(
        enum_column(SubscriptionStatus, "subscription_status"), nullable=False
    )
    current_period_end: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    stripe_customer_id: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    stripe_subscription_id: Mapped[str | None] = mapped_column(sa.Text, nullable=True)

    __table_args__ = (
        sa.UniqueConstraint("stripe_subscription_id"),
        sa.Index("ix_subscription_business_id", "business_id"),
    )


class BusinessPhoto(UUIDPrimaryKey, CreatedAt, Base):
    """Une photo de la galerie d'un commerce.

    **Distincte de `cover_photo_key`, et volontairement.** La couverture est ce
    que la carte du fil montre — une seule image, choisie pour tenir en petit et
    survivre à un recadrage. La galerie est ce que la fiche déroule. Les
    confondre obligerait la première photo à jouer deux rôles qui n'ont ni le
    même cadrage ni la même fonction.

    **La position est unique par commerce, et l'unicité est différée.**
    Réordonner une galerie, c'est réécrire toutes les positions : à contrainte
    immédiate, la deuxième ligne écrite entrerait en collision avec la troisième
    avant que celle-ci ait bougé, et il faudrait passer par des valeurs
    intermédiaires. `DEFERRABLE INITIALLY DEFERRED` laisse la transaction se
    contredire en son milieu et vérifie à la fin, ce qui est exactement la
    sémantique voulue.
    """

    __tablename__ = "business_photo"

    business_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("business.id", ondelete="CASCADE"), nullable=False
    )
    #: La clé dans le dépôt objet, sous un préfixe public. Jamais une adresse :
    #: l'URL se compose à la lecture, et le fournisseur peut changer.
    storage_key: Mapped[str] = mapped_column(sa.Text, nullable=False)
    #: Le rang dans la galerie, à partir de zéro. C'est l'ordre que la fiche
    #: publique respecte.
    position: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    #: Ce que la photo montre, pour qui ne la voit pas. Facultatif : une
    #: description obligatoire se remplit de « photo ».
    alt_text: Mapped[str | None] = mapped_column(sa.Text, nullable=True)

    __table_args__ = (
        sa.CheckConstraint("position >= 0", name="business_photo_position_positive"),
        sa.UniqueConstraint(
            "business_id",
            "position",
            name="uq_business_photo_position",
            deferrable=True,
            initially="DEFERRED",
        ),
        sa.Index("ix_business_photo_business_position", "business_id", "position"),
    )


class BusinessMenuPage(UUIDPrimaryKey, CreatedAt, Base):
    """Une page de la carte d'un commerce.

    **Distincte de la galerie, et c'est tout l'objet.** La galerie montre le
    lieu : on la fait défiler, on se fait une idée, on passe. La carte se
    *consulte* : on l'ouvre pour y chercher un plat et un prix. Deux gestes
    différents, donc deux entrées différentes sur la fiche — les mêler ferait
    chercher une entrecôte entre deux photos de salle.

    **Plusieurs pages, parce qu'une carte tient rarement sur une.** Entrées et
    plats d'un côté, desserts et boissons de l'autre : une seule image
    obligerait à photographier un dépliant entier de trop loin pour être lu.

    Le mécanisme est **exactement** celui de la galerie — clé de dépôt, position
    unique différée, retrait qui referme le trou. Le recopier plutôt que le
    partager est délibéré : les deux ont le même mécanisme aujourd'hui et pas la
    même raison d'être, et une abstraction commune ferait qu'un plafond changé
    pour l'une bougerait pour l'autre.
    """

    __tablename__ = "business_menu_page"

    business_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("business.id", ondelete="CASCADE"), nullable=False
    )
    #: La clé dans le dépôt objet, sous un préfixe public : une carte se lit
    #: depuis la fiche publique, avant toute session.
    storage_key: Mapped[str] = mapped_column(sa.Text, nullable=False)
    #: Le rang dans la carte, à partir de zéro. Une carte se lit dans l'ordre
    #: où elle est reliée, et c'est le commerce qui le connaît.
    position: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    #: Ce que la page montre, pour qui ne la voit pas. Facultatif.
    alt_text: Mapped[str | None] = mapped_column(sa.Text, nullable=True)

    __table_args__ = (
        sa.CheckConstraint("position >= 0", name="business_menu_page_position_positive"),
        sa.UniqueConstraint(
            "business_id",
            "position",
            name="uq_business_menu_page_position",
            deferrable=True,
            initially="DEFERRED",
        ),
        sa.Index("ix_business_menu_page_business_position", "business_id", "position"),
    )
