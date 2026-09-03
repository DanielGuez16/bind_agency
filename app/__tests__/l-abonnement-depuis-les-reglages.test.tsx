/**
 * L'abonnement s'atteint depuis les réglages du commerce.
 *
 * **Il existait, il fonctionnait, et personne ne pouvait l'ouvrir.** Sa seule
 * entrée était le mur de l'annuaire — lequel ne s'affiche qu'à un salon **sans**
 * abonnement. Un salon abonné ne pouvait donc ni voir sa formule, ni en
 * changer, ni résilier : la moitié des gestes que l'écran sait faire n'avait
 * aucun chemin.
 *
 * C'est la famille de la carte du fil : construit, branché, et derrière une
 * porte que personne n'ouvre. Rien ne pouvait le dire — l'écran a ses propres
 * tests, et ils passaient tous.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { AbonnementScreen } from '../src/screens/AbonnementScreen';
import { ReglagesScreen } from '../src/screens/ReglagesScreen';
import { I18nProvider } from '../src/i18n';
import { ThemeProvider } from '../src/theme';
import { SessionProvider } from '../src/session';
import { ApiClient, ApiProvider } from '../src/api';

const client = () =>
  new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: (async () => ({ ok: true, status: 200, json: async () => ({}) })) as never,
  });

async function monter(props: Parameters<typeof ReglagesScreen>[0] = {}) {
  return await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="merchant">
        <ApiProvider client={client()}>
          <SessionProvider
            baseUrl="https://api.test"
            coffre={{ lire: async () => null, ecrire: async () => {} }}
            fetchImpl={(async () => ({ ok: true, status: 200, json: async () => ({}) })) as never}
          >
            <ReglagesScreen {...props} />
          </SessionProvider>
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

it('porte une entrée vers l’abonnement, et elle mène quelque part', async () => {
  const ouvrir = jest.fn();
  await monter({ onVoirLAbonnement: ouvrir });

  await waitFor(() => expect(screen.getByTestId('ouvrir-l-abonnement')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('ouvrir-l-abonnement'));
  expect(ouvrir).toHaveBeenCalled();

  // **Sous le même intertitre que la pause, parce que c'est le même sujet.**
  // La formule portait son propre titre, en rangée pressable avec un chevron
  // de sortie ; la pause portait le sien, en bouton. Deux rangs là où le salon
  // n'en lit qu'un — ce qu'il peut faire de son commerce.
  expect(
    within(screen.getByTestId('section-commerce')).getByTestId('ouvrir-l-abonnement'),
  ).toBeTruthy();
});

it('et ne la rend pas là où il n’y a rien à ouvrir', async () => {
  // **Le pendant.** Un créateur n'a pas d'abonnement, et un compte dont le
  // commerce n'existe pas encore n'a pas de salon à abonner : rendre la ligne
  // partout donnerait une entrée qui ne mène nulle part, ce qui est pire que
  // l'absence qu'on vient de corriger.
  await monter();

  expect(screen.queryByTestId('ouvrir-l-abonnement')).toBeNull();
  expect(screen.queryByTestId('abonnement-depuis-les-reglages')).toBeNull();
});

it('rend le retour en flèche seule, sans le mot qui redit le geste', async () => {
  /**
   * **Quatrième signalement sur la même chose.** « Back » écrit à côté d'une
   * flèche vers la gauche redit ce que la flèche fait, et sur une sous-page de
   * menu il écrivait « More » — le nom de l'endroit qu'on venait de quitter,
   * répété en haut de chaque page qu'on y ouvrait.
   *
   * Ce que le mot apportait ne disparaît pas : il vit dans le libellé
   * accessible, où il répond à « où revient-on » pour qui n'a pas l'écran sous
   * les yeux. Le décor l'exige dans les deux sens — pas de texte rendu, et
   * l'annonce entière conservée.
   */
  await monter({ onRetour: () => {} });

  const retour = await waitFor(() => screen.getByTestId('retour-des-reglages'));
  expect(retour.props.accessibilityLabel).toBe('Back');
  expect(within(retour).queryByText('Back')).toBeNull();
});

/** Ce que le serveur rend a Ocean : trois formules, et l'une souscrite. */
const PLANS = [
  { id: 'p1', name: 'Essentiel', price_cents: 9900, currency: 'USD', billing_interval: 'monthly', features: {} },
  { id: 'p2', name: 'Studio', price_cents: 19900, currency: 'USD', billing_interval: 'monthly', features: {} },
];
const ABONNEMENT = { id: 'a1', plan_id: 'p1', status: 'active', current_period_end: null, checkout_url: null };

it('nomme et chiffre la formule en cours', async () => {
  /**
   * **L'écran servait « actif » et un bouton d'arrêt, rien d'autre.** Le plan
   * et son prix étaient dans la même réponse depuis toujours — `plan_id` d'un
   * côté, la grille de l'autre — et personne ne les rapprochait : un commerce
   * ne pouvait pas lire ce qu'il payait sur l'écran de ce qu'il paie.
   *
   * Le décor porte **deux** formules et n'en souscrit qu'une : un écran qui
   * afficherait la première de la liste passerait un décor à un seul plan.
   */
  await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="merchant">
        <ApiProvider
          client={
            new ApiClient({
              baseUrl: 'https://api.test',
              coffre: { lire: async () => null, ecrire: async () => {} },
              fetchImpl: (async (url: RequestInfo | URL) => ({
                ok: true,
                status: 200,
                json: async () =>
                  String(url).includes('/plans') ? PLANS : ABONNEMENT,
              })) as never,
            })
          }
        >
          <AbonnementScreen businessId="b1" />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );

  await waitFor(() => expect(screen.getByTestId('abonnement-actif')).toBeTruthy());
  expect(screen.getByTestId('formule-nom')).toHaveTextContent('Essentiel');
  expect(screen.getByTestId('formule-prix')).toHaveTextContent('$99.00');
  // Et pas celle qu'on n'a pas prise.
  expect(screen.getByTestId('formule-nom')).not.toHaveTextContent('Studio');
});

it('propose les autres formules à un abonné, et pas la sienne', async () => {
  /**
   * **Le renversement.** L'écran masquait la grille à un abonné — « il l'a déjà
   * choisie » —, ce qui était vrai tant que changer était impossible : la seule
   * sortie était de résilier d'abord, donc d'accepter de n'avoir plus rien pour
   * espérer avoir autre chose.
   *
   * Le décor souscrit **la première** des deux formules : un écran qui
   * masquerait la dernière de la liste, ou qui les montrerait toutes, passerait
   * un décor à un seul plan.
   */
  await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="merchant">
        <ApiProvider
          client={
            new ApiClient({
              baseUrl: 'https://api.test',
              coffre: { lire: async () => null, ecrire: async () => {} },
              fetchImpl: (async (url: RequestInfo | URL) => ({
                ok: true,
                status: 200,
                json: async () => (String(url).includes('/plans') ? PLANS : ABONNEMENT),
              })) as never,
            })
          }
        >
          <AbonnementScreen businessId="b1" />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );

  await waitFor(() => expect(screen.getByTestId('plans-souscriptibles')).toBeTruthy());
  // L'autre formule s'offre…
  expect(screen.getByTestId('souscrire-p2')).toBeTruthy();
  // …et celle qu'on a déjà ne porte pas de bouton, qui partirait chercher un refus.
  expect(screen.queryByTestId('souscrire-p1')).toBeNull();
  expect(screen.getByTestId('formule-actuelle-p1')).toBeTruthy();
});
