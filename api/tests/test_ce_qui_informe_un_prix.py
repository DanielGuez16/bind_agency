"""Ce qui informe un prix : la durée, la catégorie des abonnés, et la portée.

La fondatrice n'ouvre pas l'écran des plans pour lire un rapport, elle l'ouvre
pour décider d'un prix. Sept mois pour un plan contre onze pour un autre à prix
double dit que le second n'est pas trop cher — et aucun total ne le disait.

**La question de la censure, tranchée en ne la tranchant pas.** Une durée
terminée est un fait ; une durée courue est un minimum. Les mélanger rend un
nombre dont personne ne peut dire ce qu'il mesure. Les deux médianes sont donc
servies séparément, chacune avec son effectif, et c'est le schéma qui dit
laquelle est laquelle.

Chaque règle est éprouvée sur le décor où deux implémentations **divergent** :

— la médiane terminée, sur un décor qui porte **aussi** des abonnements en
  cours. Sans eux, « terminés seulement » et « tous » rendraient le même
  nombre ;
— la médiane et non la moyenne, sur une série où les deux diffèrent
  franchement ;
— la catégorie des **abonnés**, sur un plan dont la catégorie propre est autre.
  Sans cet écart, `Business.category` et `SubscriptionPlan.category` seraient
  indiscernables.
"""

import uuid
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Subscription, SubscriptionPlan
from app.models.enums import (
    BillingInterval,
    BusinessCategory,
    SubscriptionStatus,
)
from app.services import plans as service
from app.services import portee_locale
from tests.test_activation import commerce_en_cours


async def _plan(session: AsyncSession, *, categorie=BusinessCategory.BEAUTY, nom="Essentiel"):
    ligne = SubscriptionPlan(
        category=categorie,
        name=nom,
        price_cents=9_900,
        currency="USD",
        billing_interval=BillingInterval.MONTHLY,
        features={},
    )
    session.add(ligne)
    await session.flush()
    return ligne


async def _abonnement(
    session: AsyncSession,
    *,
    plan: SubscriptionPlan,
    jours: int,
    termine: bool,
    categorie=BusinessCategory.BEAUTY,
    statut=SubscriptionStatus.ACTIVE,
):
    """Un abonnement d'une durée choisie, terminé ou courant."""
    business, _ = await commerce_en_cours(session)
    await session.execute(
        sa.update(type(business)).where(type(business).id == business.id).values(category=categorie)
    )
    debut = datetime.now(UTC) - timedelta(days=jours)
    session.add(
        Subscription(
            business_id=business.id,
            plan_id=plan.id,
            status=SubscriptionStatus.CANCELED if termine else statut,
            started_at=debut,
            ended_at=datetime.now(UTC) if termine else None,
            stripe_subscription_id=f"sub_{uuid.uuid4().hex[:16]}",
        )
    )
    await session.flush()
    return business


async def _lu(session: AsyncSession, plan: SubscriptionPlan):
    return {p.plan_id: p for p in await service.lister(session)}[plan.id]


# --------------------------------------------------------------------------
# la durée
# --------------------------------------------------------------------------


async def test_la_mediane_terminee_ignore_les_abonnements_en_cours(
    session: AsyncSession,
) -> None:
    """**Le décor qui diverge : trois finis, deux qui courent.**

    Les deux en cours sont bien plus longs. Une médiane calculée sur tout
    rendrait un autre nombre, et personne ne saurait lequel des deux il lit.
    """
    plan = await _plan(session)
    for jours in (100, 200, 300):
        await _abonnement(session, plan=plan, jours=jours, termine=True)
    for jours in (900, 1000):
        await _abonnement(session, plan=plan, jours=jours, termine=False)

    lu = await _lu(session, plan)

    assert lu.duree_mediane_terminee_jours == 200
    assert lu.abonnements_termines == 3
    # Et les courants sont comptés à part, jamais mélangés.
    assert lu.abonnements_en_cours == 2
    assert lu.duree_mediane_en_cours_jours == 950


async def test_c_est_une_mediane_et_non_une_moyenne(session: AsyncSession) -> None:
    """Un seul abonné parti au bout d'un an fausse une moyenne sur douze.

    Le décor porte une valeur aberrante : la moyenne rendrait 1 020, la médiane
    rend 20. Sans cet écart, les deux se confondraient.
    """
    plan = await _plan(session)
    for jours in (10, 20, 30, 4_000):
        await _abonnement(session, plan=plan, jours=jours, termine=True)

    lu = await _lu(session, plan)

    assert lu.duree_mediane_terminee_jours == 25
    assert lu.duree_mediane_terminee_jours != round((10 + 20 + 30 + 4_000) / 4)


async def test_sans_abonnement_termine_la_mediane_est_nulle(session: AsyncSession) -> None:
    """Nulle et non zéro : zéro se lirait « ils partent tout de suite »."""
    plan = await _plan(session)
    await _abonnement(session, plan=plan, jours=50, termine=False)

    lu = await _lu(session, plan)

    assert lu.duree_mediane_terminee_jours is None
    assert lu.abonnements_termines == 0
    # Le courant, lui, est bien là : le vide de l'un n'est pas le vide de l'autre.
    assert lu.duree_mediane_en_cours_jours == 50


async def test_un_abonnement_sans_date_d_ouverture_n_entre_dans_aucun_calcul(
    session: AsyncSession,
) -> None:
    """Il est écarté, pas compté à zéro.

    Ce sont les lignes antérieures aux colonnes de dates. Zéro dirait « parti
    tout de suite », ce qui est un mensonge sur le prix — et le nombre servi à
    côté de la médiane est ce qui dit combien on a réellement mesuré.
    """
    plan = await _plan(session)
    await _abonnement(session, plan=plan, jours=100, termine=True)
    sans_date = await _abonnement(session, plan=plan, jours=100, termine=True)
    await session.execute(
        sa.update(Subscription)
        .where(Subscription.business_id == sans_date.id)
        .values(started_at=None, ended_at=None)
    )
    await session.flush()

    lu = await _lu(session, plan)

    assert lu.abonnements_termines == 1
    assert lu.duree_mediane_terminee_jours == 100
    # Il compte quand même comme abonné : c'est la durée qu'on ignore, pas lui.
    assert lu.subscriptions_count == 2


# --------------------------------------------------------------------------
# la catégorie des abonnés
# --------------------------------------------------------------------------


async def test_la_categorie_servie_est_celle_des_abonnes_et_non_celle_du_plan(
    session: AsyncSession,
) -> None:
    """**Le décor qui distingue les deux.**

    Le plan s'adresse à la beauté ; ses abonnés sont deux salons de beauté et
    un un musée. Servir `SubscriptionPlan.category` rendrait « beauté »
    partout et raterait tout l'intérêt — montrer qu'un plan n'a jamais séduit
    une catégorie.
    """
    plan = await _plan(session, categorie=BusinessCategory.BEAUTY)
    await _abonnement(
        session, plan=plan, jours=10, termine=False, categorie=BusinessCategory.BEAUTY
    )
    await _abonnement(
        session, plan=plan, jours=20, termine=False, categorie=BusinessCategory.BEAUTY
    )
    await _abonnement(
        session, plan=plan, jours=30, termine=False, categorie=BusinessCategory.MUSEUM
    )

    lu = await _lu(session, plan)
    par_categorie = {c.categorie: c for c in lu.abonnes_par_categorie}

    assert par_categorie[BusinessCategory.BEAUTY].abonnes == 2
    assert par_categorie[BusinessCategory.MUSEUM].abonnes == 1
    # Le plus gros contingent en tête : c'est celui qui décide du prix.
    assert lu.abonnes_par_categorie[0].categorie is BusinessCategory.BEAUTY


async def test_une_categorie_partie_reste_comptee_et_se_voit_dans_l_ecart(
    session: AsyncSession,
) -> None:
    """Tous statuts confondus, avec les actifs à côté.

    Une catégorie qui a souscrit puis est partie a quelque chose à dire sur le
    prix ; la compter à zéro l'effacerait, et c'est précisément le signal
    qu'on cherche.
    """
    plan = await _plan(session)
    await _abonnement(session, plan=plan, jours=10, termine=True, categorie=BusinessCategory.MUSEUM)
    await _abonnement(
        session, plan=plan, jours=10, termine=False, categorie=BusinessCategory.MUSEUM
    )

    lu = await _lu(session, plan)
    bien_etre = {c.categorie: c for c in lu.abonnes_par_categorie}[BusinessCategory.MUSEUM]

    assert bien_etre.abonnes == 2
    assert bien_etre.abonnes_actifs == 1


async def test_un_plan_sans_abonne_rend_une_liste_vide(session: AsyncSession) -> None:
    """Vide, et non une ligne à zéro par catégorie.

    Une liste de zéros ne se lit pas, et ferait croire à un échantillon là où
    il n'y a rien.
    """
    plan = await _plan(session)

    lu = await _lu(session, plan)

    assert lu.abonnes_par_categorie == ()
    assert lu.subscriptions_count == 0


# --------------------------------------------------------------------------
# le compte par palier pour une prestation
# --------------------------------------------------------------------------


async def test_le_compte_par_palier_est_un_total_et_non_un_gain(
    session: AsyncSession,
) -> None:
    """**Ce qu'aucune composition des gains ne donne.**

    Les deux paliers sont ouverts chez ce salon : leur gain vaut donc zéro à
    tous les deux, et `gains_par_palier` ne les liste même pas. La phrase
    « ces N créatrices deviennent M si je monte d'un palier » demande pourtant
    ces deux nombres.
    """
    from app.schemas.tier_offers import TierOfferCreate
    from app.services import tier_offers as tier_offer_service
    from tests.test_booking_create import REEL, STORY, monter_le_decor
    from tests.test_qui_est_la import TOUT_PRES, _createur_situe

    decor = await monter_le_decor(session, tier_id=STORY)
    await tier_offer_service.create_offer(
        session,
        business_id=decor["business"].id,
        payload=TierOfferCreate(tier_id=REEL, catalog_item_id=decor["item"].id),
    )
    # Trois créatrices qui ouvrent le story, une seule qui ouvre le reel.
    for _ in range(3):
        await _createur_situe(session, ou=TOUT_PRES, followers=5_000)
    await _createur_situe(session, ou=TOUT_PRES, followers=60_000)

    par_palier = {
        ligne.tier_id: ligne
        for ligne in await portee_locale.creatrices_par_palier(session, business=decor["business"])
    }

    assert par_palier[STORY].creatrices == 4
    assert par_palier[REEL].creatrices == 0, "le reel exige aussi des collaborations menées"

    # Et les gains ne disent rien de ces deux nombres : les deux paliers sont
    # ouverts, donc absents de la liste des gains.
    portee = await portee_locale.autour_du_commerce(session, business=decor["business"])
    gains = {g.tier_id for g in portee.gains_par_palier}
    assert STORY not in gains
    assert REEL not in gains


async def test_tous_les_paliers_sont_comptes_meme_ceux_que_le_salon_n_offre_pas(
    session: AsyncSession,
) -> None:
    """La question porte sur un palier qu'on n'offre peut-être pas encore.

    Ne compter que les paliers offerts rendrait la phrase impossible dans le
    sens qui l'intéresse le plus — monter d'un palier.
    """
    from tests.test_booking_create import REEL, STORY, monter_le_decor
    from tests.test_qui_est_la import TOUT_PRES, _createur_situe

    decor = await monter_le_decor(session, tier_id=STORY)
    await _createur_situe(session, ou=TOUT_PRES, followers=5_000)

    lignes = await portee_locale.creatrices_par_palier(session, business=decor["business"])
    identifiants = {ligne.tier_id for ligne in lignes}

    assert STORY in identifiants
    assert REEL in identifiants, "le palier non offert doit être compté aussi"
