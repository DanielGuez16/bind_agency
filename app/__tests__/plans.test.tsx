/**
 * Les plans d'abonnement, sur grand écran.
 *
 * « Un tableau de trois lignes flottant au milieu du vide, sans total, sans
 * action, sans contexte. » Trois plans **sont** le catalogue : cet écran ne se
 * remplira jamais de lignes, il doit gagner sa largeur en contexte.
 *
 * La règle qui compte ici est celle qui peut produire un chiffre faux : on
 * n'additionne pas deux devises. C'est le seul écran du produit qui affiche de
 * l'argent, et un total faux y est pire qu'un total absent.
 */
import { render, screen, waitFor, within } from '@testing-library/react-native';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { PlansScreen, totaliser } from '../src/screens/PlansScreen';
import { ThemeProvider } from '../src/theme';

function plan(over: Record<string, unknown> = {}) {
  return {
    plan_id: 'p1',
    name: 'Essentiel',
    category: 'beauty',
    price_cents: 9_900,
    currency: 'USD',
    billing_interval: 'monthly',
    features: {},
    is_active: true,
    subscriptions_count: 2,
    active_subscriptions_count: 2,
    mrr_cents: 19_800,
    ...over,
  };
}

async function monter(plans: unknown[]) {
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => plans }) as Response,
  });
  return render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="admin">
        <ApiProvider client={api}>
          <PlansScreen />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('la somme, isolée', () => {
  it('additionne ce qui partage une devise', () => {
    expect(
      totaliser([
        plan({ mrr_cents: 19_800, subscriptions_count: 2, active_subscriptions_count: 2 }),
        plan({ plan_id: 'p2', mrr_cents: 8_908, subscriptions_count: 1, active_subscriptions_count: 1 }),
      ] as never),
    ).toEqual({ mrrCents: 28_708, abonnes: 3, actifs: 3, devise: 'USD' });
  });

  it('refuse d’additionner deux devises', () => {
    // Un total faux est pire qu'un total absent, et il n'y a aucun taux de
    // change dans ce produit pour en fabriquer un juste.
    const totaux = totaliser([plan(), plan({ plan_id: 'p2', currency: 'EUR' })] as never);
    expect(totaux.devise).toBeNull();
  });
});

describe('l’écran des plans', () => {
  it('porte le revenu et les salons abonnés en tête', async () => {
    await monter([plan(), plan({ plan_id: 'p2', mrr_cents: 8_908, subscriptions_count: 1, active_subscriptions_count: 1 })]);
    await waitFor(() => expect(screen.getByTestId('totaux')).toBeTruthy());

    expect(within(screen.getByTestId('total-mrr')).getByText('287.08 USD')).toBeTruthy();
    expect(within(screen.getByTestId('total-abonnes')).getByText('3')).toBeTruthy();
  });

  it('ferme le tableau par une ligne de total', async () => {
    // Elle manquait depuis la campagne 1 : un tableau de montants sans somme
    // oblige à additionner de tête.
    await monter([plan()]);
    await waitFor(() => expect(screen.getByTestId('plans-total')).toBeTruthy());

    expect(within(screen.getByTestId('plans-total')).getByText('198.00 USD')).toBeTruthy();
  });

  it('n’additionne pas deux devises, et le dit', async () => {
    await monter([plan(), plan({ plan_id: 'p2', currency: 'EUR' })]);
    await waitFor(() => expect(screen.getByTestId('devises-melees')).toBeTruthy());

    expect(within(screen.getByTestId('total-mrr')).getByText('—')).toBeTruthy();
    expect(screen.getByText(en.admin.plansDevisesMelees)).toBeTruthy();
  });

  it('dit l’intervalle de chaque plan, pas celui du premier', async () => {
    // L'écran affichait `plans[0].billing_interval` en légende, brut et non
    // traduit : le plan annuel se voyait annoncer « monthly ».
    await monter([plan(), plan({ plan_id: 'p2', billing_interval: 'yearly' })]);
    await waitFor(() => expect(screen.getByTestId('plan-p2')).toBeTruthy());

    expect(within(screen.getByTestId('plan-p1')).getByText(en.admin.plansMensuel)).toBeTruthy();
    expect(within(screen.getByTestId('plan-p2')).getByText(en.admin.plansAnnuel)).toBeTruthy();
    expect(screen.queryByText('monthly')).toBeNull();
  });

  it('écrit en mots le plan que personne n’a pris', async () => {
    // « 0 » dans une colonne de chiffres se lit comme une mesure ; un plan
    // sans preneur est une information d'une autre nature.
    await monter([plan({ subscriptions_count: 0, active_subscriptions_count: 0, mrr_cents: 0 })]);
    await waitFor(() => expect(screen.getByTestId('plan-p1')).toBeTruthy());

    expect(within(screen.getByTestId('plan-p1')).getByText(en.admin.plansSansPreneur)).toBeTruthy();
  });
});
