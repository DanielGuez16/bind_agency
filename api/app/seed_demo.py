"""Enrichissement de démonstration : les états que le jeu de base ne produit pas.

Le jeu de départ pose trois commerces et trois créateurs. Il suffit à éprouver
les invariants, pas à parcourir le produit : tout écran de contrepartie y est
vide, le back office n'a rien à arbitrer, et aucun commerce ne sait ce que sa
participation lui a rapporté.

**Rien n'est posé à la main.** Chaque état est obtenu en appelant le service qui
le produit — réserver, confirmer, consommer, soumettre, contrôler. C'est la
règle du jeu de données depuis le premier jour, et c'est ce qui distingue une
démonstration d'une mise en scène : ce qu'on montre est ce que le produit fait.

Les rares exceptions sont **nommées** et portent leur raison : reculer un
horodatage pour qu'une échéance soit dépassée, ou vieillir un relevé pour
produire un compte périmé. Aucun service ne sait remonter le temps, et le seul
autre moyen serait d'attendre.

**Les dates sont relatives à aujourd'hui.** Un jeu figé au 3 août montre des
réservations passées en octobre, et la démonstration commence par une
explication.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

import httpx
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.demo_images import COUVERTURE, PRESTATION, image
from app.integrations.object_store import get_object_store
from app.integrations.social_demo import DemoSocialProvider
from app.models import (
    Booking,
    Business,
    BusinessMember,
    CatalogItem,
    Collaboration,
    Job,
    SocialAccount,
    SocialMetricsSnapshot,
    SubscriptionPlan,
    Tier,
    TierOffer,
    User,
)
from app.models.enums import (
    BillingInterval,
    BookingStatus,
    BusinessCategory,
    BusinessStatus,
    JobStatus,
    JobType,
    Locale,
    Platform,
    SocialAccountStatus,
    UserRole,
    VerificationStatus,
)
from app.schemas.collaboration import MotifDeDecision
from app.services import auth as auth_service
from app.services import availability as availability_service
from app.services import booking as booking_service
from app.services import booking_states, eligibility
from app.services import collaboration as collaboration_service
from app.services import creator_profile as profile_service
from app.services import metrics as metrics_service
from app.services import proof as proof_service
from app.services import redemption as redemption_service
from app.services import reliability as reliability_service
from app.services import social_accounts as social_account_service
from app.services.audit import Actor
from app.services.storage import archiver_la_publication

MOT_DE_PASSE = "bind-donnees-de-depart-2026"


@dataclass(frozen=True, slots=True)
class ResumeDemo:
    createurs: int
    reservations: int
    contreparties: int
    jobs: int
    photos: int
    plans: int
    abonnements: int


# --------------------------------------------------------------------------
# photos
# --------------------------------------------------------------------------


async def poser_les_photos(session: AsyncSession) -> int:
    """Une couverture par commerce **actif**, une photo par prestation réservable.

    Le parent d'une gamme n'en reçoit pas : il ne s'affiche jamais seul, et lui
    en donner une ferait apparaître une image que personne ne voit.

    Un commerce encore en inscription n'en reçoit pas non plus, et c'est la
    raison d'être du seul qui soit dans cet état : il montre ce qu'on voit le
    jour où l'on s'inscrit. Lui poser une couverture le rendait présentable, et
    l'écran d'activation n'avait plus rien à réclamer — alors que « ouvert mais
    invisible faute de photo » est précisément l'état qu'il doit expliquer.
    """
    depot = get_object_store()
    posees = 0

    actifs = await session.scalars(
        sa.select(Business).where(Business.status == BusinessStatus.ACTIVE)
    )
    for business in actifs.all():
        cle = await depot.deposer(image(business.name, COUVERTURE), prefixe="photos/business")
        business.cover_photo_key = cle
        posees += 1

    items = (
        await session.scalars(sa.select(CatalogItem).where(CatalogItem.requires_booking.is_(True)))
    ).all()
    for item in items:
        cle = await depot.deposer(image(item.name, PRESTATION), prefixe="photos/item")
        item.photo_key = cle
        posees += 1

    await session.flush()
    return posees


# --------------------------------------------------------------------------
# créateurs, à tous les états
# --------------------------------------------------------------------------


async def _creer(
    session: AsyncSession,
    *,
    email: str,
    handle: str,
    followers: int,
    locale: Locale = Locale.EN,
    prenom: str | None = None,
    nom: str | None = None,
    media_count: int | None = None,
    token_ttl: timedelta = timedelta(days=60),
) -> tuple[User, SocialAccount]:
    """Un créateur, par le parcours complet : inscription, OAuth, relevé."""
    user = await auth_service.register(
        session, email=email, password=MOT_DE_PASSE, role=UserRole.CREATOR, locale=locale
    )
    if prenom or nom:
        # Le nom est exigé à la première réservation, et il sert au contrôle de
        # cohérence. Un créateur sans nom ne peut pas réserver : le poser ici,
        # par le service, évite d'avoir des profils qui bloquent en démonstration.
        await profile_service.update_profile(
            session, user_id=user.id, modifications={"first_name": prenom, "last_name": nom}
        )

    fournisseur = DemoSocialProvider(
        platform=Platform.INSTAGRAM,
        handle=handle,
        followers=followers,
        media_count=media_count,
        token_ttl=token_ttl,
    )
    url = await social_account_service.start_authorization(session, user=user, provider=fournisseur)
    rattachement = await social_account_service.complete_authorization(
        session,
        state=httpx.URL(url).params["state"],
        code=f"demo-{handle}",
        provider=fournisseur,
    )
    compte = rattachement.compte
    await metrics_service.refresh_profile_metrics(session, account=compte, provider=fournisseur)
    return user, compte


async def creer_les_createurs(session: AsyncSession) -> dict[str, tuple[User, SocialAccount]]:
    """Les cinq états qu'un créateur peut présenter à l'ouverture de l'app.

    Chacun rend un écran différent, et c'est le seul moyen de vérifier qu'aucun
    de ces écrans n'est vide ou cassé.
    """
    createurs: dict[str, tuple[User, SocialAccount]] = {}

    # 1. Débutante : sous le premier palier, aucun historique. L'écran des
    #    paliers doit l'orienter, pas lui montrer une porte sans serrure.
    createurs["debutante"] = await _creer(
        session,
        email="camila@bind.example",
        handle="camila.newcomer",
        followers=640,
        locale=Locale.ES,
        prenom="Camila",
        nom="Rojas",
    )

    # 2. Confirmée : tous les paliers ouverts, et c'est elle qui parcourra le
    #    fil et réservera pendant la démonstration.
    createurs["confirmee"] = await _creer(
        session,
        email="rebecca@bind.example",
        handle="rebecca.miami",
        followers=64_000,
        prenom="Rebecca",
        nom="Alvarez",
    )

    # 3. Plafonnée : l'audience ouvrirait tout, le score ferme le haut. Le score
    #    lui-même est produit plus bas, par des événements réels.
    createurs["plafonnee"] = await _creer(
        session,
        email="mateo@bind.example",
        handle="mateo.wynwood",
        followers=22_000,
        locale=Locale.ES,
        prenom="Mateo",
        nom="Duarte",
    )

    # 4. En vérification : l'écran persistant, daté, sans promesse de délai.
    createurs["en_controle"] = await _creer(
        session,
        email="sofia@bind.example",
        handle="sofia.brickell",
        followers=11_500,
        prenom="Sofía",
        nom="Iglesias",
        # Peu de publications pour un compte de cette taille : c'est le signal
        # de volume qui manque, et le contrôle de cohérence le relève de
        # lui-même. Rien n'est forcé.
        media_count=6,
    )

    # 5. Autorisation expirée : jeton déjà mort à l'échange. Le fournisseur le
    #    rend tel quel, le service l'enregistre, et le balayage des jetons le
    #    trouvera périmé — sans qu'aucune ligne soit écrite à la main.
    createurs["expiree"] = await _creer(
        session,
        email="nina@bind.example",
        handle="nina.design",
        followers=31_000,
        prenom="Nina",
        nom="Costa",
        token_ttl=timedelta(days=-2),
    )
    return createurs


async def marquer_les_etats_de_compte(session: AsyncSession, createurs: dict) -> None:
    """Les deux états qu'aucun service ne sait produire à la demande.

    `needs_review` est normalement prononcé par le contrôle de cohérence quand
    un signal manque, et il l'est effectivement pour `sofia` — on le vérifie
    plutôt que de le poser. L'expiration du jeton, elle, se constate : le
    fournisseur a rendu une échéance passée, et c'est le statut du compte qui
    doit suivre. C'est le balayage de fond qui le fait en production ; ici on
    l'applique directement, faute de pouvoir attendre son passage.
    """
    _, compte_expire = createurs["expiree"]
    await session.execute(
        sa.update(SocialAccount)
        .where(SocialAccount.id == compte_expire.id)
        .values(status=SocialAccountStatus.EXPIRED)
    )

    _, compte_controle = createurs["en_controle"]
    await session.refresh(compte_controle)
    if compte_controle.verification_status is not VerificationStatus.NEEDS_REVIEW:
        # Le contrôle n'a pas prononcé ce qu'on attendait : le dire plutôt que
        # de forcer la valeur, sinon la démonstration montrerait un écran que
        # le produit ne sait plus produire.
        raise RuntimeError(
            "sofia devait passer en revue de cohérence et ne l'a pas fait : "
            "le contrôle ne relève plus le signal de volume"
        )
    await session.flush()


# --------------------------------------------------------------------------
# réservations et contreparties
# --------------------------------------------------------------------------


async def _premier_creneau(
    session: AsyncSession,
    business_id: uuid.UUID,
    item_id: uuid.UUID,
    *,
    depuis: datetime | None = None,
) -> datetime | None:
    creneaux = await availability_service.creneaux_libres(
        session, business_id=business_id, catalog_item_id=item_id, depuis=depuis, limite=1
    )
    return creneaux[0].starts_at if creneaux else None


async def _reserver(
    session: AsyncSession,
    *,
    createur: User,
    compte: SocialAccount,
    offre: TierOffer,
    pas_avant: datetime | None = None,
) -> Booking | None:
    item = await session.get(CatalogItem, offre.catalog_item_id)
    if item is None:
        return None

    creneau = (
        await _premier_creneau(session, offre.business_id, item.id, depuis=pas_avant)
        if item.requires_booking
        else None
    )
    if item.requires_booking and creneau is None:
        return None

    try:
        return await booking_service.creer(
            session,
            creator_id=createur.id,
            demande=booking_service.DemandeDeReservation(
                tier_offer_id=offre.id, social_account_id=compte.id, starts_at=creneau
            ),
        )
    except booking_service.BookingError as erreur:
        # Palier fermé, créneau pris : la démonstration se passe de cette
        # ligne-là plutôt que de forcer le passage. Mais elle le **dit** — un
        # jeu de données qui saute la moitié de ce qu'il devait produire, en
        # silence, se découvre pendant la démonstration.
        print(f"  réservation écartée ({type(erreur).__name__}) : {erreur}")
        return None


async def _accepter_si_besoin(session, booking, *, membre_id) -> None:
    """Fait passer l'accord du commerce quand il est requis.

    Le jeu de données emprunte le chemin du produit plutôt que d'écrire l'état :
    depuis que la validation est le défaut, une réservation confirmée par le
    créateur s'arrête en attente, et poser `confirmed` à la main aurait produit
    un jeu de données qui ne ressemble à rien de ce que le produit fabrique.
    """
    if booking.status is not BookingStatus.AWAITING_BUSINESS:
        return
    await booking_states.trancher(
        session,
        booking=booking,
        business_id=booking.business_id,
        user_id=membre_id,
        accepte=True,
    )


async def _reculer(session: AsyncSession, booking: Booking, de: timedelta) -> None:
    """Vieillit une réservation. La seule façon de fabriquer du passé.

    Nommée, isolée, et sans effet sur les règles : ce qui bouge est
    l'horodatage de création, pas un statut. C'est ce qui permet au reporting
    de montrer autre chose qu'une seule journée.
    """
    await session.execute(
        sa.update(Booking)
        .where(Booking.id == booking.id)
        .values(created_at=booking.created_at - de)
    )


async def composer_les_parcours(session: AsyncSession, createurs: dict) -> tuple[int, int]:
    """Des réservations dans chaque état, et des contreparties dans chaque état.

    L'ordre suit le parcours réel : réserver, confirmer, consommer au comptoir,
    publier, contrôler. Chaque bifurcation — annulation, absence, non-conformité
    — part d'une réservation qui a suivi le même chemin jusque-là.
    """
    confirmee, compte_confirmee = createurs["confirmee"]
    plafonnee, compte_plafonnee = createurs["plafonnee"]

    async def offre_pour(createur: User) -> TierOffer | None:
        """Une offre que ce créateur peut **réellement** réserver, maintenant.

        Prendre une offre au hasard produisait quatre refus de suite : les
        paliers supérieurs demandent des collaborations achevées, et une
        créatrice sans historique n'y accède pas. C'est le produit qui a
        raison — le jeu de données doit s'y plier, et non l'inverse.

        L'éligibilité est réévaluée à chaque appel : la première contrepartie
        approuvée incrémente le compteur, ce qui ouvre le palier suivant. La
        démonstration montre donc une progression réelle, pas une liste posée.
        """
        verdict = await eligibility.evaluer_createur(session, createur.id)
        ouverts = verdict.paliers_accessibles
        if not ouverts:
            return None
        return await session.scalar(
            sa.select(TierOffer)
            .join(Tier, Tier.id == TierOffer.tier_id)
            .where(
                TierOffer.is_active.is_(True),
                Tier.is_active.is_(True),
                TierOffer.tier_id.in_(ouverts),
            )
            .order_by(Tier.display_order.desc(), TierOffer.created_at)
            .limit(1)
        )

    premiere = await offre_pour(confirmee)
    if premiere is None:
        return 0, 0

    reservations = 0
    contreparties = 0
    proprietaire = Actor.system()

    async def membre_de(business_id: uuid.UUID) -> uuid.UUID | None:
        """L'identifiant du membre qui tranche. Nul quand il n'y en a pas."""
        membre = await session.scalar(
            sa.select(BusinessMember).where(BusinessMember.business_id == business_id).limit(1)
        )
        return membre.user_id if membre else None

    async def confirmer_jusqu_au_bout(booking, createur_id: uuid.UUID) -> None:
        """Confirmation créateur, puis accord du commerce si sa validation est
        active. Le jeu de données emprunte les deux portes du produit."""
        await booking_states.confirmer(session, booking=booking, creator_id=createur_id)
        membre_id = await membre_de(booking.business_id)
        if membre_id is not None:
            await _accepter_si_besoin(session, booking, membre_id=membre_id)

    async def caissier_de(business_id: uuid.UUID) -> Actor:
        """Le membre du commerce qui sert au comptoir."""
        from app.models import BusinessMember

        membre = await session.scalar(
            sa.select(BusinessMember).where(BusinessMember.business_id == business_id).limit(1)
        )
        if membre is None:
            return proprietaire
        user = await session.get(User, membre.user_id)
        return Actor.from_user(user) if user else proprietaire

    # --- 0. en attente du commerce --------------------------------------
    #
    # L'état neuf de la v0.5 : la créatrice a confirmé, le salon n'a pas encore
    # tranché. Sans lui, la file du commerce est vide à la démonstration et
    # personne ne voit à quoi sert le nouvel écran.
    booking = await _reserver(
        session,
        createur=confirmee,
        compte=compte_confirmee,
        offre=premiere,
        pas_avant=datetime.now(UTC) + timedelta(days=2),
    )
    if booking:
        await session.execute(
            sa.update(Business)
            .where(Business.id == booking.business_id)
            .values(requires_booking_approval=True)
        )
        await booking_states.confirmer(session, booking=booking, creator_id=confirmee.id)
        reservations += 1

    # --- 1. à venir, simplement confirmée -------------------------------
    booking = await _reserver(session, createur=confirmee, compte=compte_confirmee, offre=premiere)
    if booking:
        await confirmer_jusqu_au_bout(booking, confirmee.id)
        reservations += 1

    # --- 2. annulée par la créatrice ------------------------------------
    #
    # Le créneau doit être à plus de vingt-quatre heures : en deçà, la règle
    # transforme une annulation en absence, et c'est ce qu'elle a fait au
    # premier essai. Le jeu de données ne contourne pas la règle, il lui donne
    # les conditions qu'elle exige.
    booking = await _reserver(
        session,
        createur=confirmee,
        compte=compte_confirmee,
        offre=premiere,
        pas_avant=datetime.now(UTC) + timedelta(days=3),
    )
    if booking:
        await confirmer_jusqu_au_bout(booking, confirmee.id)
        await booking_states.annuler(session, booking=booking, creator_id=confirmee.id)
        await _reculer(session, booking, timedelta(days=9))
        reservations += 1

    # --- 3. absence constatée par le commerce ---------------------------
    pour_plafonnee = await offre_pour(plafonnee)
    booking = (
        await _reserver(session, createur=plafonnee, compte=compte_plafonnee, offre=pour_plafonnee)
        if pour_plafonnee
        else None
    )
    if booking:
        await confirmer_jusqu_au_bout(booking, plafonnee.id)
        # L'absence ne se constate qu'après l'heure prévue. Reculer le créneau
        # est le seul moyen de la produire sans attendre — et la fin se
        # recalcule depuis la durée figée, jamais choisie au jugé : une
        # contrainte de base vérifie que les trois façons de dire la même chose
        # coïncident.
        debut = datetime.now(UTC) - timedelta(hours=3)
        await session.execute(
            sa.update(Booking)
            .where(Booking.id == booking.id)
            .values(
                starts_at=debut,
                ends_at=debut + timedelta(minutes=booking.duration_minutes or 0),
            )
        )
        await session.refresh(booking)
        await booking_states.marquer_absent(
            session,
            booking=booking,
            actor=await caissier_de(booking.business_id),
            reason="la créatrice ne s'est pas présentée",
        )
        await _reculer(session, booking, timedelta(days=12))
        reservations += 1

    # --- 4 à 7. consommées, avec leurs quatre issues de contrepartie ----
    # Six issues, et les six existent réellement en base à la fin. `attendue`
    # est l'état d'une contrepartie qui vient de naître — celui qu'a le
    # créateur juste après avoir été servi.
    #
    # **Qui fait quoi n'est pas indifférent.** Les issues dégradées produisent
    # des événements de fiabilité, et les donner toutes à la même créatrice lui
    # ferait un score de quarante — alors que le jeu doit montrer une créatrice
    # vérifiée **avec un bon score**. Un premier essai l'avait fait, et cela
    # s'est vu au moment de vérifier le jeu obtenu.
    issues = (
        ("approuvee", timedelta(days=6), "confirmee"),
        ("approuvee", timedelta(days=11), "confirmee"),
        ("attendue", timedelta(days=1), "confirmee"),
        ("soumise", timedelta(hours=6), "confirmee"),
        ("deuxieme_tentative", timedelta(days=3), "plafonnee"),
        ("revue_humaine", timedelta(days=2), "plafonnee"),
        ("non_honoree", timedelta(days=15), "plafonnee"),
    )
    for issue, age, qui in issues:
        createur, compte = createurs[qui]
        offre = await offre_pour(createur)
        booking = (
            await _reserver(session, createur=createur, compte=compte, offre=offre)
            if offre
            else None
        )
        if booking is None:
            continue

        await confirmer_jusqu_au_bout(booking, createur.id)
        code = await redemption_service.code_du_booking(session, booking=booking)
        caissier = await caissier_de(booking.business_id)
        if code is not None:
            await redemption_service.marquer_consomme(
                session, redemption_code_id=code.id, par_user_id=caissier.user_id
            )
        await booking_states.consommer(session, booking=booking, actor=caissier)
        reservations += 1

        contrepartie = await collaboration_service.du_booking(session, booking.id)
        if contrepartie is None:
            continue
        contreparties += 1

        await _mener(session, contrepartie, issue=issue, caissier=caissier, createur=createur)
        await _reculer(session, booking, age)

    # --- 8. en garde, non confirmée -------------------------------------
    #
    # L'état d'une réservation qui vient d'être prise et pas encore confirmée.
    # Elle expire toute seule au bout de dix minutes : c'est l'écran que voit
    # quelqu'un qui hésite, et le balayage la reprendra.
    offre = await offre_pour(confirmee)
    booking = (
        await _reserver(
            session,
            createur=confirmee,
            compte=compte_confirmee,
            offre=offre,
            pas_avant=datetime.now(UTC) + timedelta(days=5),
        )
        if offre
        else None
    )
    if booking:
        reservations += 1

    # --- une journée qui existe, dans chaque salon ------------------------
    reservations += await _une_reservation_aujourd_hui(
        session,
        createur=confirmee,
        compte=compte_confirmee,
        confirmer=confirmer_jusqu_au_bout,
    )

    await session.flush()
    return reservations, contreparties


async def _une_reservation_aujourd_hui(
    session: AsyncSession,
    *,
    createur: User,
    compte: SocialAccount,
    confirmer,
) -> int:
    """Au moins une réservation confirmée aujourd'hui, dans **chaque** salon actif.

    Sans elle, l'écran « Aujourd'hui » du commerce disait « rien de réservé »
    sur un jeu de données fraîchement semé — ce qui était exact et inutilisable.
    Les réservations tombaient sur le premier créneau libre à partir de
    maintenant, donc presque toujours demain, et toutes sur le même salon :
    `offre_pour` n'en rendait qu'une seule, la mieux classée. Trois salons sur
    quatre n'avaient jamais eu la moindre ligne.

    La conséquence dépassait l'affichage : la caisse ne s'atteignait que depuis
    une ligne de la journée, et un écran vide la rendait inaccessible. Aucun
    code ne pouvait être validé, la boucle du produit ne se fermait jamais.

    **Le créneau vient de la disponibilité réelle, jamais posé.** On demande
    d'abord ce qui reste aujourd'hui à partir de maintenant ; à défaut — une
    journée coupée à midi, semée l'après-midi — ce qui existait plus tôt dans la
    journée. Un salon qui n'ouvre pas du tout aujourd'hui n'en reçoit pas : lui
    en inventer une contredirait ses propres horaires.
    """
    posees = 0

    actifs = (
        await session.scalars(sa.select(Business).where(Business.status == BusinessStatus.ACTIVE))
    ).all()

    for business in actifs:
        offre = await session.scalar(
            sa.select(TierOffer)
            .join(Tier, Tier.id == TierOffer.tier_id)
            .join(CatalogItem, CatalogItem.id == TierOffer.catalog_item_id)
            .where(
                TierOffer.business_id == business.id,
                TierOffer.is_active.is_(True),
                Tier.is_active.is_(True),
                CatalogItem.requires_booking.is_(True),
                CatalogItem.is_available.is_(True),
            )
            .order_by(Tier.display_order, TierOffer.created_at)
            .limit(1)
        )
        if offre is None:
            continue

        fuseau = ZoneInfo(business.timezone)
        maintenant = datetime.now(UTC)
        ouverture = datetime.combine(maintenant.astimezone(fuseau).date(), time.min, tzinfo=fuseau)
        fin_du_jour = ouverture + timedelta(days=1)

        creneau = None
        for depuis in (maintenant, ouverture):
            candidat = await _premier_creneau(
                session, business.id, offre.catalog_item_id, depuis=depuis
            )
            if candidat is not None and candidat < fin_du_jour:
                creneau = candidat
                break

        if creneau is None:
            print(f"  aucune place aujourd'hui chez {business.name} : ses horaires font foi")
            continue

        try:
            booking = await booking_service.creer(
                session,
                creator_id=createur.id,
                demande=booking_service.DemandeDeReservation(
                    tier_offer_id=offre.id,
                    social_account_id=compte.id,
                    starts_at=creneau,
                ),
            )
        except booking_service.BookingError as erreur:
            print(f"  journée du jour écartée chez {business.name} ({type(erreur).__name__})")
            continue

        await confirmer(booking, createur.id)
        posees += 1

    return posees


async def _mener(
    session: AsyncSession,
    contrepartie: Collaboration,
    *,
    issue: str,
    caissier: Actor,
    createur: User,
) -> None:
    """Conduit une contrepartie jusqu'à l'état voulu, par les services.

    `pending` reste tel quel : c'est déjà un état, celui d'une publication
    attendue, et il n'y a rien à faire pour l'obtenir.
    """
    if issue == "attendue":
        # Rien à faire : `pending` est déjà l'état d'une publication attendue.
        # C'est le seul cas où ne rien faire est la bonne action.
        return

    if issue == "non_honoree":
        # L'échéance dépassée fait tomber le dossier — par le balayage, pas à
        # la main. On recule l'échéance et on laisse le job faire son travail.
        await session.execute(
            sa.update(Collaboration)
            .where(Collaboration.id == contrepartie.id)
            .values(deadline_at=datetime.now(UTC) - timedelta(hours=2))
        )
        await collaboration_service.expirer_les_echeances(session)
        return

    await _soumettre(session, contrepartie, createur=createur, marque="1")
    await session.refresh(contrepartie)

    if issue == "soumise":
        # Soumise et pas encore contrôlée : c'est ce que le commerce voit dans
        # son onglet « à contrôler », et ce que la créatrice voit en attente.
        return

    if issue == "approuvee":
        await collaboration_service.approuver(session, collaboration=contrepartie, actor=caissier)
        return

    # Une première demande de nouvelle soumission : le dossier est en deuxième
    # tentative, exactement comme après un contrôle non conforme.
    await collaboration_service.demander_une_nouvelle_soumission(
        session,
        collaboration=contrepartie,
        actor=caissier,
        reason=MotifDeDecision.MENTION_MANQUANTE,
    )

    if issue != "revue_humaine":
        return

    # Trois passages lèvent le drapeau de revue humaine. On refait le tour
    # complet plutôt que d'incrémenter le compteur : c'est le compteur qui doit
    # être la conséquence, pas la cause.
    for rang, motif in enumerate(
        (MotifDeDecision.LIEU_MANQUANT, MotifDeDecision.FORMAT_INATTENDU), start=2
    ):
        await session.refresh(contrepartie)
        await _soumettre(session, contrepartie, createur=createur, marque=str(rang))
        await session.refresh(contrepartie)
        await collaboration_service.demander_une_nouvelle_soumission(
            session, collaboration=contrepartie, actor=caissier, reason=motif
        )


async def _soumettre(
    session: AsyncSession, contrepartie: Collaboration, *, createur: User, marque: str
) -> None:
    """Une soumission complète : dépôt de la capture, puis archivage.

    La capture est réellement déposée dans le dépôt d'objets, et le service
    d'archivage la relit pour calculer son empreinte. C'est le chemin de
    niveau 3, celui qui fonctionne aujourd'hui.
    """
    cle = await get_object_store().deposer(
        image(f"preuve-{contrepartie.id}-{marque}", PRESTATION), prefixe="proofs/upload"
    )
    capture = await archiver_la_publication(
        session,
        social_account_id=(await _compte_du_booking(session, contrepartie.booking_id)),
        source_url=None,
        screenshot_key=cle,
    )
    if capture is None:
        return
    await proof_service.soumettre(
        session,
        collaboration=contrepartie,
        capture=capture,
        actor=Actor.from_user(createur),
    )


async def _compte_du_booking(session: AsyncSession, booking_id: uuid.UUID) -> uuid.UUID:
    booking = await session.get(Booking, booking_id)
    assert booking is not None  # noqa: S101 - la contrepartie référence sa réservation
    return booking.social_account_id


# --------------------------------------------------------------------------
# le reste : score, jobs, plans
# --------------------------------------------------------------------------


async def recalculer_les_scores(session: AsyncSession, createurs: dict) -> None:
    """Les scores viennent des événements, jamais d'un chiffre posé.

    Poser `reliability_score = 41` donnerait le même écran et ne prouverait
    rien : le jour où le calcul change, la démonstration mentirait. Ici
    l'absence, les resoumissions et la non-honoration ont déjà produit leurs
    événements ; on recalcule et on constate.

    Le résultat est **vérifié** : la créatrice confirmée doit finir au-dessus de
    la plafonnée. Si l'inverse se produit — c'est arrivé au premier essai, où
    toutes les issues dégradées lui étaient tombées dessus — le jeu de données
    ne montre plus ce qu'il annonce.
    """
    for user, _ in createurs.values():
        await reliability_service.rafraichir(session, creator_id=user.id)

    confirmee = await profile_service.get_profile(session, createurs["confirmee"][0].id)
    plafonnee = await profile_service.get_profile(session, createurs["plafonnee"][0].id)

    if confirmee.reliability_score is None or plafonnee.reliability_score is None:
        raise RuntimeError("aucun score calculé : le moteur de fiabilité ne produit plus rien")
    if confirmee.reliability_score <= plafonnee.reliability_score:
        raise RuntimeError(
            f"la créatrice confirmée ({confirmee.reliability_score}) n'est pas au-dessus de "
            f"la plafonnée ({plafonnee.reliability_score}) : le jeu ne montre pas ce qu'il annonce"
        )


async def poser_les_jobs(session: AsyncSession) -> int:
    """Des jobs, dont un épuisé, pour que le back office ne soit pas vide.

    L'épuisement s'obtient en faisant échouer le job autant de fois que la
    configuration l'autorise — par le service, boucle après boucle. Poser
    `status = exhausted` sauterait précisément la mécanique que l'écran
    d'administration sert à surveiller.
    """
    comptes = (await session.scalars(sa.select(SocialAccount).limit(3))).all()
    if not comptes:
        return 0

    from app.services import jobs as jobs_service

    poses = 0
    for compte in comptes:
        await jobs_service.planifier(
            session,
            job_type=JobType.TOKEN_REFRESH,
            target_id=compte.id,
            run_after=datetime.now(UTC) + timedelta(days=30),
        )
        poses += 1

    # Le dernier échoue jusqu'à l'épuisement.
    #
    # Un seul job doit être dû pendant la boucle. `reclamer` prend le prochain
    # dû, quel qu'il soit : depuis que le rattachement planifie lui-même deux
    # travaux par compte, les douze tentatives se répartissaient sur une
    # dizaine de jobs et aucun n'atteignait son épuisement. Le jeu de données
    # rendait alors un back office sans rien à montrer, sans que rien ne le
    # signale — c'est le test de l'épuisement qui l'a dit.
    await session.execute(sa.update(Job).values(run_after=datetime.now(UTC) + timedelta(days=30)))
    cible = await session.scalar(
        sa.select(Job.id).where(
            Job.target_id == comptes[-1].id, Job.job_type == JobType.TOKEN_REFRESH
        )
    )
    await session.execute(
        sa.update(Job).where(Job.id == cible).values(run_after=sa.func.clock_timestamp())
    )
    for _ in range(12):
        reclames = await jobs_service.reclamer(session, limite=1)
        if not reclames:
            break
        etat = await jobs_service.echouer(
            session, reclames[0], erreur="la plateforme a refusé le jeton (démonstration)"
        )
        if etat is JobStatus.EXHAUSTED:
            break
        await session.execute(
            sa.update(Job)
            .where(Job.id == reclames[0].id)
            .values(run_after=sa.func.clock_timestamp())
        )

    await session.flush()
    return poses


async def poser_les_plans(session: AsyncSession) -> int:
    """Trois plans, dont un annuel : l'écran d'administration a besoin des deux
    intervalles pour que la mensualisation se voie."""
    plans = (
        ("Essentiel", BusinessCategory.BEAUTY, 9_900, BillingInterval.MONTHLY),
        ("Studio", BusinessCategory.BEAUTY, 19_900, BillingInterval.MONTHLY),
        ("Essentiel annuel", BusinessCategory.BEAUTY, 106_900, BillingInterval.YEARLY),
    )
    for nom, categorie, prix, intervalle in plans:
        session.add(
            SubscriptionPlan(
                category=categorie,
                name=nom,
                price_cents=prix,
                currency="USD",
                billing_interval=intervalle,
                features={"slots_month": 20 if prix < 15_000 else 60},
            )
        )
    await session.flush()
    return len(plans)


async def abonner_les_commerces(session: AsyncSession) -> int:
    """Deux commerces abonnés, un non. Par le service, avec le fournisseur du mode.

    Sans abonnement, l'écran d'administration des plans affiche trois lignes à
    zéro et un revenu nul : il existe, il ne montre rien. Deux abonnés sur trois
    donnent un chiffre à lire **et** un plan que personne n'a pris, ce qui est
    la vraie question qu'on se pose devant cet écran.

    Le fournisseur est celui que la configuration déclare — `log` par défaut.
    Aucune clé, aucun appel réseau, et le même chemin qu'en production.
    """
    from app.integrations.billing import get_billing_provider
    from app.services import subscription as subscription_service

    plans = list(
        (
            await session.scalars(
                sa.select(SubscriptionPlan).order_by(SubscriptionPlan.price_cents)
            )
        ).all()
    )
    if not plans:
        return 0

    actifs = list(
        (
            await session.scalars(
                sa.select(Business)
                .where(Business.status == BusinessStatus.ACTIVE)
                .order_by(Business.name)
            )
        ).all()
    )

    provider = get_billing_provider()
    poses = 0
    for rang, business in enumerate(actifs[:2]):
        membre = await session.scalar(
            sa.select(BusinessMember).where(BusinessMember.business_id == business.id).limit(1)
        )
        if membre is None:
            continue
        acteur = await session.get(User, membre.user_id)
        if acteur is None:
            continue

        await subscription_service.souscrire(
            session,
            business=business,
            plan_id=plans[rang % len(plans)].id,
            actor=acteur,
            provider=provider,
        )
        poses += 1

    await session.flush()
    return poses


async def vieillir_un_releve(session: AsyncSession, createurs: dict) -> None:
    """Un relevé périmé, pour que l'obstacle daté se démontre.

    `metrics_stale` porte la date du dernier relevé, et c'est elle qui
    s'affiche. Sans un compte réellement périmé, cet écran ne se voit jamais.
    """
    _, compte = createurs["expiree"]
    await session.execute(
        sa.update(SocialMetricsSnapshot)
        .where(SocialMetricsSnapshot.social_account_id == compte.id)
        .values(captured_at=datetime.now(UTC) - timedelta(days=21))
    )


async def enrichir(session: AsyncSession) -> ResumeDemo:
    """Tout l'enrichissement, dans l'ordre où les dépendances l'imposent."""
    photos = await poser_les_photos(session)
    plans = await poser_les_plans(session)

    createurs = await creer_les_createurs(session)
    await marquer_les_etats_de_compte(session, createurs)

    reservations, contreparties = await composer_les_parcours(session, createurs)
    await recalculer_les_scores(session, createurs)
    await vieillir_un_releve(session, createurs)
    jobs = await poser_les_jobs(session)
    abonnements = await abonner_les_commerces(session)

    return ResumeDemo(
        createurs=len(createurs),
        reservations=reservations,
        contreparties=contreparties,
        jobs=jobs,
        photos=photos,
        plans=plans,
        abonnements=abonnements,
    )
