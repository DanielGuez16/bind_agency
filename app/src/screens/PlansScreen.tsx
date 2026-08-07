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
 * **Lecture seule.** La modification d'un plan touche la facturation et attend
 * Stripe : offrir un champ modifiable ici ferait croire à une action qui
 * n'existe pas.
 */
import { View } from 'react-native';

import { useApi, type PlanAdministrateur } from '../api';
import { EmptyState, TableHeader, TableRow, Texte, type Colonne } from '../components';
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
    { cle: 'prix', label: t('admin.plansPrix'), largeur: 110, chiffre: true },
    { cle: 'abonnes', label: t('admin.plansAbonnes'), largeur: 90, chiffre: true },
    { cle: 'actifs', label: t('admin.plansActifs'), largeur: 90, chiffre: true },
    { cle: 'mrr', label: t('admin.plansMrr'), largeur: 130, chiffre: true },
  ];

  return (
    <Ecran
      requete={requete}
      titre={t('admin.plansTitre')}
      testID="ecran-plans"
      vide={<EmptyState title={t('admin.plansTitre')} body={t('admin.plansVide')} />}
    >
      {(plans) => (
        <View>
          <TableHeader colonnes={colonnes} />
          {plans.map((plan) => (
            <TableRow
              key={plan.plan_id}
              testID={`plan-${plan.plan_id}`}
              colonnes={colonnes}
              valeurs={{
                name: plan.name,
                prix: montant(plan.price_cents, plan.currency),
                abonnes: String(plan.subscriptions_count),
                actifs: String(plan.active_subscriptions_count),
                mrr: montant(plan.mrr_cents, plan.currency),
              }}
            />
          ))}
          <Texte variante="type.caption" couleur="text.muted">
            {plans[0]?.billing_interval}
          </Texte>
        </View>
      )}
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
