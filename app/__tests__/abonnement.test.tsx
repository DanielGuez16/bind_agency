/**
 * L'abonnement du commerce : la contrepartie de ce qu'on facture.
 *
 * **Le trou du produit, et il était complet côté serveur.** Lire l'état, lister
 * les plans, souscrire, résilier — quatre routes, un client qui savait les
 * appeler, et aucun écran. L'annuaire refusait sur un 402 qui ne menait nulle
 * part : un commerce qui butait sur le mur n'avait aucun chemin vers l'autre
 * côté.
 *
 * **Ce que ces tests éprouvent est la traduction des états**, parce que c'est ce
 * qui peut être faux : « incomplete » ne dit rien à un gérant, et le traduire
 * mal ouvre l'annuaire à qui ne paie pas ou le ferme à qui paie.
 */
import { render, screen, waitFor, within } from '@testing-library/react-native';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { AbonnementScreen } from '../src/screens/AbonnementScreen';
import { adresseDePaiement, etatDeLAbonnement } from '../src/screens/abonnement/etat';
import { ThemeProvider } from '../src/theme';

const ABO = (extra: Record<string, unknown> = {}) => ({
  id: 'a1',
  plan_id: 'p1',
  status: 'active',
  current_period_end: null,
  checkout_url: null,
  ...extra,
});

describe('l’état d’un abonnement, en mots de gérant', () => {
  it('en cours, quel que soit le mot de Stripe', () => {
    expect(etatDeLAbonnement(ABO({ status: 'active' }) as never)).toBe('actif');
    // Une période d'essai est un abonnement qui court : l'annuaire est ouvert.
    expect(etatDeLAbonnement(ABO({ status: 'trialing' }) as never)).toBe('actif');
  });

  it('aucun abonnement se distingue d’un abonnement résilié', () => {
    // **Les deux mènent à choisir un plan, et ce ne sont pas les mêmes gens.**
    // L'un n'a jamais payé, l'autre a arrêté — les confondre ferait dire
    // « bienvenue » à quelqu'un qui revient.
    expect(etatDeLAbonnement(null)).toBe('aucun');
    expect(etatDeLAbonnement(undefined)).toBe('aucun');
    expect(etatDeLAbonnement(ABO({ status: 'canceled' }) as never)).toBe('resilie');
  });

  it('un prélèvement échoué n’est pas une résiliation', () => {
    // L'accès tient encore : le traiter comme résilié fermerait la porte à
    // quelqu'un qui n'a qu'une carte à mettre à jour.
    expect(etatDeLAbonnement(ABO({ status: 'past_due' }) as never)).toBe('impaye');
  });

  it('et un statut inconnu ne s’invente ni dans un sens ni dans l’autre', () => {
    // **Le cas qui diverge d'un `default` optimiste.** Stripe ajoute des
    // statuts ; le traiter comme actif ouvrirait l'annuaire à qui ne paie pas,
    // et comme résilié fermerait la porte à qui paie. « Le paiement n'est pas
    // terminé » n'affirme aucun accès et propose de rouvrir l'adresse.
    expect(etatDeLAbonnement(ABO({ status: 'paused' }) as never)).toBe('paiement-a-finir');
  });
});

describe('l’adresse de paiement ne se rouvre pas n’importe quand', () => {
  it('sur un paiement inachevé, elle est là', () => {
    expect(
      adresseDePaiement(ABO({ status: 'incomplete', checkout_url: 'https://pay' }) as never),
    ).toBe('https://pay');
  });

  it('mais jamais sur un abonnement en cours', () => {
    // **Le cas qui diverge de « rends l'adresse dès qu'elle existe ».** Le
    // serveur peut la servir encore ; rouvrir une page de paiement à quelqu'un
    // qui paie déjà lui ferait craindre un second prélèvement.
    expect(
      adresseDePaiement(ABO({ status: 'active', checkout_url: 'https://pay' }) as never),
    ).toBeNull();
  });
});

describe('l’écran', () => {
  async function monter(reponses: Record<string, unknown>) {
    const api = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: { lire: async () => null, ecrire: async () => {} },
      fetchImpl: (async (url: RequestInfo | URL) => {
        const chemin = String(url);
        const trouve = Object.entries(reponses).find(([f]) => chemin.includes(f));
        return { ok: true, status: 200, json: async () => (trouve ? trouve[1] : null) } as Response;
      }) as unknown as typeof fetch,
    });
    return await render(
      <I18nProvider initialLocale="en">
        <ThemeProvider role="merchant">
          <ApiProvider client={api}>
            <AbonnementScreen businessId="b1" />
          </ApiProvider>
        </ThemeProvider>
      </I18nProvider>,
    );
  }

  const PLAN = {
    id: 'p1',
    name: 'Studio',
    price_cents: 9_900,
    currency: 'EUR',
    billing_interval: 'monthly',
    features: {},
  };

  it('dit ce que l’abonnement ouvre, avant son prix', async () => {
    // « Passer à l'offre supérieure » ne dit rien ; ce qu'on paie est la
    // visibilité, et c'est exactement ce que l'annuaire refuse.
    await monter({ '/subscription': null, '/plans': [PLAN] });
    await waitFor(() => expect(screen.getByTestId('plans-souscriptibles')).toBeTruthy());

    expect(screen.getByText(en.abonnement.ceQueCaOuvre)).toBeTruthy();
    expect(screen.getByTestId('souscrire-p1')).toBeTruthy();
  });

  it('et prévient que le paiement sort du produit', async () => {
    // Même règle que le profil public d'une créatrice : la différence se voit
    // avant l'appui, pas après.
    await monter({ '/subscription': null, '/plans': [PLAN] });
    await waitFor(() => expect(screen.getByTestId('paiement-sort-du-produit')).toBeTruthy());
  });

  it('un abonnement en cours ne propose pas de reprendre le sien', async () => {
    /**
     * **Renversé le 2026-09-02, et la moitié qui comptait reste.** Ce test
     * exigeait que la grille disparaisse entièrement pour un abonné — « il l'a
     * déjà choisie ». C'était vrai tant que changer de formule était
     * impossible : la seule sortie était de résilier d'abord, c'est-à-dire
     * d'accepter de n'avoir plus rien pour espérer avoir autre chose.
     *
     * Le serveur bascule maintenant en une transaction. La grille se rend donc
     * aussi à un abonné — ce que fait toute application qui vend un
     * abonnement — et ce qui reste garanti est ce que la règle protégeait
     * réellement : **on ne peut pas reprendre celui qu'on a déjà**, ce que le
     * serveur refuse et qu'un bouton irait chercher pour rien.
     */
    await monter({ '/subscription': ABO(), '/plans': [PLAN] });
    await waitFor(() => expect(screen.getByTestId('abonnement-actif')).toBeTruthy());

    expect(screen.getByTestId('plans-souscriptibles')).toBeTruthy();
    expect(screen.queryByTestId('souscrire-p1')).toBeNull();
    expect(screen.getByTestId('formule-actuelle-p1')).toBeTruthy();
    expect(screen.getByTestId('resilier')).toBeTruthy();
  });

  it('un paiement inachevé se reprend, il ne se recommence pas', async () => {
    await monter({
      '/subscription': ABO({ status: 'incomplete', checkout_url: 'https://pay' }),
      '/plans': [PLAN],
    });
    await waitFor(() => expect(screen.getByTestId('paiement-a-finir')).toBeTruthy());

    expect(screen.getByTestId('reprendre-le-paiement')).toBeTruthy();
    expect(
      within(screen.getByTestId('paiement-a-finir')).getByText(
        en.abonnement.paiementAFinirAide,
      ),
    ).toBeTruthy();
  });
});
