/**
 * 18a · Plans d'abonnement.
 *
 * **Le seul écran du produit qui affiche des montants.** Il est réservé au rôle
 * administrateur, et rien de ce qu'il montre n'est repris ailleurs.
 *
 * **Le revenu mensuel vient du serveur.** Un plan annuel et un plan mensuel
 * n'ont pas la même unité ; laisser l'écran diviser par douze ferait d'une
 * règle de facturation une décision de mise en page, à réécrire dans chaque
 * client.
 *
 * **Lecture seule, et l'écran le dit une fois, en haut.** La modification d'un
 * plan touche la facturation et attend Stripe : offrir un champ modifiable ici
 * ferait croire à une action qui n'existe pas. Le dire vaut mieux que ne rien
 * dire, et **mieux que de griser un bouton** — un bouton grisé promet qu'il
 * s'allumera, et rien ici ne s'allumera. La règle de la maison est que l'action
 * impossible est retirée ; la mention en haut est ce qui la remplace, une seule
 * fois, plutôt que six fois en gris.
 *
 * **Trois lignes ne se rempliront jamais** (campagne 2). Le catalogue compte
 * trois plans et n'a pas vocation à grossir : cet écran ne gagnera pas sa
 * largeur en lignes, il la gagne en contexte. Le revenu total et le nombre de
 * salons abonnés passent en tête — ce sont les deux nombres qu'on vient
 * chercher — et chaque ligne dit son intervalle de facturation et son état.
 *
 * **Rien ne s'additionne entre devises.** Le total n'existe que si tous les
 * plans partagent la même ; sinon l'écran le dit et n'additionne pas. Un total
 * faux est pire qu'un total absent, surtout sur le seul écran du produit qui
 * affiche de l'argent.
 */
import { View } from 'react-native';

import { useApi, type PlanAdministrateur } from '../api';
import {
  EmptyState,
  SkeletonLignes,
  TableHeader,
  TableRow,
  Texte,
  type Colonne,
} from '../components';
import { useI18n } from '../i18n';
import { Ecran } from './Ecran';
import { useRequete } from './useRequete';

export function PlansScreen() {
  const { api } = useApi();
  const { t } = useI18n();

  const requete = useRequete<PlanAdministrateur[]>((signal) => api.plans(signal), {
    estVide: (plans) => plans.length === 0,
  });

  const colonnes: Colonne[] = [
    { cle: 'name', label: t('admin.plansTitre'), largeur: 200 },
    { cle: 'intervalle', label: t('admin.plansIntervalle'), largeur: 100 },
    { cle: 'prix', label: t('admin.plansPrix'), largeur: 110, chiffre: true },
    { cle: 'abonnes', label: t('admin.plansAbonnes'), largeur: 90, chiffre: true },
    { cle: 'actifs', label: t('admin.plansActifs'), largeur: 90, chiffre: true },
    { cle: 'mrr', label: t('admin.plansMrr'), largeur: 130, chiffre: true },
  ];

  return (
    <Ecran
      requete={requete}
      titre={t('admin.plansTitre')}
      squelette={<SkeletonLignes combien={3} testID="squelette-plans" />}
      testID="ecran-plans"
      vide={<EmptyState title={t('admin.plansTitre')} body={t('admin.plansVide')} />}
    >
      {(plans) => {
        const totaux = totaliser(plans);

        return (
          <View style={{ gap: 20 }}>
            <Texte variante="type.label" couleur="ink.mute" testID="lecture-seule">
              {t('admin.plansLectureSeule')}
            </Texte>

            <Totaux totaux={totaux} />

            <View>
              <TableHeader colonnes={colonnes} />
              {plans.map((plan) => (
                <TableRow
                  key={plan.plan_id}
                  testID={`plan-${plan.plan_id}`}
                  colonnes={colonnes}
                  valeurs={{
                    name: plan.is_active ? plan.name : `${plan.name} · ${t('admin.plansInactif')}`,
                    intervalle:
                      plan.billing_interval === 'yearly'
                        ? t('admin.plansAnnuel')
                        : t('admin.plansMensuel'),
                    prix: montant(plan.price_cents, plan.currency),
                    // **Zéro se dit en mots.** « 0 » dans une colonne de
                    // chiffres se lit comme une mesure ; un plan que personne
                    // n'a pris est une information d'une autre nature.
                    abonnes:
                      plan.subscriptions_count === 0
                        ? t('admin.plansSansPreneur')
                        : String(plan.subscriptions_count),
                    actifs: String(plan.active_subscriptions_count),
                    mrr: montant(plan.mrr_cents, plan.currency),
                  }}
                />
              ))}
              {/* La ligne de total. Elle manquait depuis la campagne 1 : un
                  tableau de montants sans somme oblige à additionner de tête. */}
              <TableRow
                testID="plans-total"
                colonnes={colonnes}
                valeurs={{
                  name: t('admin.plansTotal'),
                  intervalle: '',
                  prix: '',
                  abonnes: String(totaux.abonnes),
                  actifs: String(totaux.actifs),
                  mrr: totaux.devise ? montant(totaux.mrrCents, totaux.devise) : '—',
                }}
              />
            </View>

            {/* **Un mensuel calculé n'est pas un prix mensuel.** Un plan
                facturé à l'année porte un revenu mensuel qui est la division du
                serveur ; posé dans la même colonne qu'un prix mensuel, il se
                lit comme un tarif. La note le dit là où le chiffre est, pas
                dans une légende générale. */}
            {plans.some((plan) => plan.billing_interval === 'yearly') ? (
              <Texte variante="type.caption" couleur="ink.mute" testID="note-annuel">
                {t('admin.plansNoteAnnuel')}
              </Texte>
            ) : null}

            {totaux.devise === null ? (
              <Texte variante="type.caption" couleur="ink.mute" testID="devises-melees">
                {t('admin.plansDevisesMelees')}
              </Texte>
            ) : null}
          </View>
        );
      }}
    </Ecran>
  );
}

/**
 * Des centimes entiers vers une somme lisible.
 *
 * La division par cent se fait à l'affichage et nulle part ailleurs : les
 * montants restent des entiers partout dans le produit, parce qu'un flottant
 * finit toujours par perdre un centime.
 */
function montant(cents: number, devise: string): string {
  return `${(cents / 100).toFixed(2)} ${devise}`;
}

/** Ce que l'écran additionne, et la devise commune s'il y en a une. */
type Totaux = { mrrCents: number; abonnes: number; actifs: number; devise: string | null };

/**
 * Les sommes, et le refus d'additionner ce qui ne s'additionne pas.
 *
 * Exporté pour être éprouvé sans écran : « ne pas totaliser deux devises » est
 * une règle, pas une mise en page — et c'est la seule de cet écran qui puisse
 * produire un chiffre faux.
 */
export function totaliser(plans: PlanAdministrateur[]): Totaux {
  const devises = new Set(plans.map((plan) => plan.currency));

  return {
    mrrCents: plans.reduce((somme, plan) => somme + plan.mrr_cents, 0),
    abonnes: plans.reduce((somme, plan) => somme + plan.subscriptions_count, 0),
    actifs: plans.reduce((somme, plan) => somme + plan.active_subscriptions_count, 0),
    devise: devises.size === 1 ? [...devises][0] : null,
  };
}

/**
 * Les deux nombres qu'on vient chercher sur cet écran.
 *
 * Un tableau de trois lignes au milieu du vide ne dit pas ce qu'il faut en
 * retenir. Le revenu mensuel et le nombre de salons abonnés le disent avant
 * qu'on lise le détail.
 */
function Totaux({ totaux }: { totaux: Totaux }) {
  const { t } = useI18n();

  return (
    <View
      testID="totaux"
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 24, paddingBottom: 4 }}
    >
      <View style={{ width: 260, gap: 2 }} testID="total-mrr">
        <Texte variante="type.figure">
          {totaux.devise ? montant(totaux.mrrCents, totaux.devise) : '—'}
        </Texte>
        <Texte variante="type.caption" couleur="ink.soft">
          {t('admin.plansMrrTotal')}
        </Texte>
      </View>
      <View style={{ width: 260, gap: 2 }} testID="total-abonnes">
        <Texte variante="type.figure">
          {String(totaux.actifs)}
        </Texte>
        <Texte variante="type.caption" couleur="ink.soft">
          {t('admin.plansSalonsAbonnes')}
        </Texte>
      </View>
    </View>
  );
}
