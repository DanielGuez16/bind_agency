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
  it('additionne ce qui partage une devise et une périodicité', () => {
    expect(
      totaliser([
        plan({ mrr_cents: 19_800, subscriptions_count: 2, active_subscriptions_count: 2 }),
        plan({ plan_id: 'p2', mrr_cents: 8_908, subscriptions_count: 1, active_subscriptions_count: 1 }),
      ] as never),
    ).toEqual([
      { devise: 'USD', periodicite: 'monthly', revenuCents: 28_708, abonnes: 3, actifs: 3 },
    ]);
  });

  it('rend deux totaux plutôt qu’un tiret quand les devises diffèrent', () => {
    // **Un tiret ne dit rien**, et c'était la seule chose que l'écran affichait
    // alors du revenu. Aucun taux de change n'est stocké : un chiffre combiné
    // serait inventé, deux chiffres séparés sont chacun vrais.
    const totaux = totaliser([plan(), plan({ plan_id: 'p2', currency: 'EUR' })] as never);
    expect(totaux.map((groupe) => groupe.devise).sort()).toEqual(['EUR', 'USD']);
  });

  it('et ne mélange pas un mensuel avec un annuel de la même devise', () => {
    // **Le cas qui diverge de « groupe par devise ».** Additionner un mensuel
    // et un annuel en dollars donnerait un nombre qui n'est ni l'un ni l'autre,
    // et il aurait l'air juste — c'est le pire des chiffres faux.
    const totaux = totaliser([
      plan({ mrr_cents: 10_000 }),
      plan({ plan_id: 'p2', mrr_cents: 240_000, billing_interval: 'yearly' }),
    ] as never);
    expect(totaux).toHaveLength(2);
    expect(totaux.map((groupe) => groupe.revenuCents).sort((a, b) => a - b)).toEqual([
      10_000, 240_000,
    ]);
  });
});

describe('l’écran des plans', () => {
  it('porte le revenu et les salons abonnés en tête', async () => {
    await monter([plan(), plan({ plan_id: 'p2', mrr_cents: 8_908, subscriptions_count: 1, active_subscriptions_count: 1 })]);
    await waitFor(() => expect(screen.getByTestId('totaux')).toBeTruthy());

    expect(
      within(screen.getByTestId('total-USD-monthly')).getByText('287.08 USD'),
    ).toBeTruthy();
    expect(within(screen.getByTestId('total-abonnes')).getByText('3')).toBeTruthy();
  });

  it('ferme le tableau par une ligne de total', async () => {
    // Elle manquait depuis la campagne 1 : un tableau de montants sans somme
    // oblige à additionner de tête.
    await monter([plan()]);
    await waitFor(() => expect(screen.getByTestId('plans-total-USD-monthly')).toBeTruthy());

    expect(
      within(screen.getByTestId('plans-total-USD-monthly')).getByText('198.00 USD'),
    ).toBeTruthy();
  });

  it('montre deux totaux plutôt qu’un tiret, et dit pourquoi', async () => {
    // **Le tiret est parti.** Il était la seule chose que l'écran affichait du
    // revenu dès que deux devises se croisaient — c'est-à-dire dans le cas
    // qu'il existe pour traiter.
    await monter([plan(), plan({ plan_id: 'p2', currency: 'EUR' })]);
    await waitFor(() => expect(screen.getByTestId('devises-melees')).toBeTruthy());

    expect(screen.getByTestId('total-USD-monthly')).toBeTruthy();
    expect(screen.getByTestId('total-EUR-monthly')).toBeTruthy();
    expect(screen.queryByText('—')).toBeNull();
    // La règle se dit là où elle s'applique : aucun taux de change n'est stocké.
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

describe('lecture seule, dite une fois', () => {
  it('annonce la lecture seule en haut, et ne grise aucun bouton', async () => {
    // **Un bouton grisé promet qu'il s'allumera**, et rien ici ne s'allumera :
    // la modification touche la facturation et attend Stripe. La règle de la
    // maison est que l'action impossible est retirée ; la mention en haut est
    // ce qui la remplace, une seule fois, plutôt que six fois en gris.
    await monter([plan()]);
    await waitFor(() => expect(screen.getByTestId('lecture-seule')).toBeTruthy());

    const { readFileSync } = require('fs') as typeof import('fs');
    const { join } = require('path') as typeof import('path');
    const source = readFileSync(join(__dirname, '..', 'src', 'screens', 'PlansScreen.tsx'), 'utf-8');
    expect(/disabled/.test(source)).toBe(false);
    expect(/<Button/.test(source)).toBe(false);
  });

  it('avertit qu’un mensuel calculé n’est pas un prix mensuel', async () => {
    // Posé dans la même colonne qu'un prix mensuel, le revenu mensuel d'un plan
    // annuel se lit comme un tarif.
    await monter([plan({ billing_interval: 'yearly' })]);
    await waitFor(() => expect(screen.getByTestId('note-annuel')).toBeTruthy());
  });

  it('et se tait quand aucun plan n’est annuel', async () => {
    // Une note qui ne concerne rien de ce qui est à l'écran apprend à ignorer
    // les notes.
    await monter([plan()]);
    await waitFor(() => expect(screen.getByTestId('ecran-plans')).toBeTruthy());
    expect(screen.queryByTestId('note-annuel')).toBeNull();
  });
});
