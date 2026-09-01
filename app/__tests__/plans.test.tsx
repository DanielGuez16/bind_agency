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
import { StyleSheet } from 'react-native';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { PlansScreen, totaliser } from '../src/screens/PlansScreen';
import { dureeLisible, partsParCategorie } from '../src/screens/plans/duree';
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

async function monter(plans: unknown[], locale: 'en' | 'es' = 'en') {
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => plans }) as Response,
  });
  return render(
    <I18nProvider initialLocale={locale}>
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

    // **Le montant que l'utilisateur voit, pas celui que le code compose.**
    // L'écrire avec `formatMoney` prouverait seulement que la fonction s'appelle
    // elle-même ; le littéral prouve la sortie.
    expect(within(screen.getByTestId('total-mrr')).getByText('$287.08')).toBeTruthy();
    expect(within(screen.getByTestId('total-abonnes')).getByText('3')).toBeTruthy();
  });

  it('ferme le tableau par une ligne de total', async () => {
    // Elle manquait depuis la campagne 1 : un tableau de montants sans somme
    // oblige à additionner de tête.
    await monter([plan()]);
    await waitFor(() => expect(screen.getByTestId('plans-total')).toBeTruthy());

    expect(within(screen.getByTestId('plans-total')).getByText('$198.00')).toBeTruthy();
  });

  /**
   * **Le seul écran du produit qui montre des montants, et il les composait à
   * la main.** `${(cents / 100).toFixed(2)} ${devise}` rend « 198.00 USD » dans
   * toutes les langues : point décimal et code de devise, alors que le reste de
   * l'écran passe à la virgule en espagnol. `formatMoney` existait dans
   * `format.ts`, avec `Intl` et la langue — et personne ne l'appelait.
   *
   * **Le décor divergent est la langue**, pas le nombre : en anglais les deux
   * implémentations rendent des chaînes différentes mais également plausibles,
   * et seul l'espagnol montre que l'une des deux ne regarde pas la langue.
   */
  it('en espagnol, le montant est espagnol', async () => {
    await monter([plan()], 'es');
    await waitFor(() => expect(screen.getByTestId('plans-total')).toBeTruthy());

    expect(within(screen.getByTestId('plans-total')).getByText('198,00 US$')).toBeTruthy();
  });

  it('la ligne de lecture seule est du texte, pas une étiquette', async () => {
    // **Deux faits joints par un point médian ne font pas une étiquette.** Elle
    // comptait quarante-sept signes en capitales espacées ; la règle de la
    // passation (§13 ter) borne une étiquette à vingt-quatre signes, au-delà
    // c'est du texte. On éprouve la casse rendue plutôt que le nom du jeton :
    // c'est ce que l'œil reçoit, et un jeton peut changer de nom.
    await monter([plan()]);
    await waitFor(() => expect(screen.getByTestId('lecture-seule')).toBeTruthy());

    const style = StyleSheet.flatten(screen.getByTestId('lecture-seule').props.style);
    expect(style.textTransform).not.toBe('uppercase');
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

describe('la durée médiane, et ce qu’on a le droit d’en dire', () => {
  const AVEC = (extra: Record<string, unknown>) =>
    ({
      duree_mediane_terminee_jours: 213,
      abonnements_termines: 12,
      duree_mediane_en_cours_jours: 90,
      abonnements_en_cours: 4,
      abonnes_par_categorie: [],
      ...extra,
    }) as never;

  it('rend les mois et l’effectif, jamais le nombre seul', () => {
    // « 7 mois » sorti de trois départs se lit comme un fait ; l'effectif à
    // côté est ce qui empêche de le croire.
    expect(dureeLisible(AVEC({}))).toMatchObject({ mois: 7, sur: 12, minoritaire: false });
  });

  it('et signale quand la médiane parle au nom d’une minorité', () => {
    // **Le cas qui diverge de « affiche le nombre ».** Trois départs contre
    // trente-et-un abonnements qui courent : la médiane terminée ne mesure
    // alors que les mécontents, et le dire vaut mieux que la corriger.
    expect(
      dureeLisible(AVEC({ abonnements_termines: 3, abonnements_en_cours: 31 })),
    ).toMatchObject({ minoritaire: true, enCours: 31 });
  });

  it('nulle sans abonnement terminé, jamais zéro', () => {
    // « 0 mois » se lirait « ils partent tout de suite », qui est le contraire
    // de ce que dit l'absence de mesure.
    expect(dureeLisible(AVEC({ duree_mediane_terminee_jours: null }))).toBeNull();
    expect(dureeLisible(AVEC({ abonnements_termines: 0 }))).toBeNull();
  });

  it('et l’absence des champs ne fait pas tomber le calcul', () => {
    expect(dureeLisible({} as never)).toBeNull();
  });
});

describe('qui prend chaque plan', () => {
  const PLAN = (lignes: { categorie: string; abonnes: number; abonnes_actifs: number }[]) =>
    ({ abonnes_par_categorie: lignes }) as never;

  it('la plus fournie donne l’échelle, pas le total', () => {
    // **Le cas qui diverge de « rapporte au total ».** Une barre rapportée au
    // total écraserait les quatre lignes d'un plan où une catégorie domine —
    // et c'est précisément ce plan-là qu'on vient lire.
    const parts = partsParCategorie(
      PLAN([
        { categorie: 'nails', abonnes: 61, abonnes_actifs: 54 },
        { categorie: 'hair', abonnes: 43, abonnes_actifs: 40 },
      ]),
    );
    expect(parts[0].fraction).toBe(1);
    expect(parts[1].fraction).toBeCloseTo(43 / 61);
  });

  it('une catégorie à zéro garde sa ligne et sa barre vide', () => {
    // « Ce plan n'a jamais séduit un salon d'ongles » est exactement ce qu'on
    // vient lire, et une ligne retirée le tairait.
    const parts = partsParCategorie(
      PLAN([
        { categorie: 'spa', abonnes: 8, abonnes_actifs: 8 },
        { categorie: 'nails', abonnes: 0, abonnes_actifs: 0 },
      ]),
    );
    expect(parts).toHaveLength(2);
    expect(parts[1]).toMatchObject({ categorie: 'nails', abonnes: 0, fraction: 0 });
  });

  it('et porte combien restent, pas seulement combien ont souscrit', () => {
    // C'est l'écart qui porte l'argument : souscrire peu et partir vite dit
    // que le plan est trop cher ; souscrire massivement et rester dit qu'il est
    // trop bas. Le seul total ne dirait ni l'un ni l'autre.
    const parts = partsParCategorie(PLAN([{ categorie: 'nails', abonnes: 61, abonnes_actifs: 54 }]));
    expect(parts[0]).toMatchObject({ abonnes: 61, actifs: 54 });
  });
});
