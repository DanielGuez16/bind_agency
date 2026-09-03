/**
 * Le panneau d'un refus, et le fil de secours qui l'accompagne.
 *
 * **Deux défauts, un seul décor.** Le schéma « Aa » ne doit apparaître que
 * là où l'icône existe vraiment — Safari et les autres navigateurs iOS,
 * jamais Android ni un ordinateur de bureau, dont le texte parle d'un
 * cadenas. Et un écran bloqué n'est plus un écran vide : `SectionFilPopulaire`
 * doit apparaître dès que la position est refusée, indisponible, ou sans
 * réponse — jamais pendant les deux états qui ne durent qu'un rendu.
 */
import { render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { FilScreen } from '../src/screens/FilScreen';
import type { EtatDePosition } from '../src/shell/usePosition';
import { ThemeProvider } from '../src/theme';

const coffre = { lire: async () => null, ecrire: async () => {} };

const UN_SALON = {
  business_id: 'b1',
  nom: 'Ocean Beauty Studio',
  category: 'beauty',
  neighborhood: 'south_beach',
  prestations: 4,
};

function fetchImpl(avecSalons: boolean): typeof fetch {
  return (async (url: string | URL | Request) => {
    const chemin = String(url);
    if (chemin.includes('/businesses/populaire')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ salons: avecSalons ? [UN_SALON] : [] }),
      } as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as Response;
  }) as typeof fetch;
}

function cadre(etat: EtatDePosition, avecSalons = true) {
  return (
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider
          client={new ApiClient({ baseUrl: 'https://api.test', coffre, fetchImpl: fetchImpl(avecSalons) })}
        >
          <FilScreen
            position={null}
            etatDeLaPosition={etat}
            onDemanderLaPosition={() => {}}
            onVoirMesFavoris={() => {}}
            onOuvrirLeCommerce={() => {}}
          />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

describe('le schéma « Aa » n’apparaît que là où l’icône existe', () => {
  it('sur Safari iOS', async () => {
    await render(cadre({ etat: 'refusee', ouReactiver: 'web_ios_safari' }));
    await waitFor(() => expect(screen.getByTestId('fil-schema-aa')).toBeTruthy());
    expect(screen.getByTestId('fil-copier-instructions')).toBeTruthy();
  });

  it('sur un autre navigateur iOS', async () => {
    await render(cadre({ etat: 'refusee', ouReactiver: 'web_ios_autre' }));
    await waitFor(() => expect(screen.getByTestId('fil-schema-aa')).toBeTruthy());
  });

  it('jamais sur Android', async () => {
    await render(cadre({ etat: 'refusee', ouReactiver: 'web_android' }));
    await waitFor(() => expect(screen.getByTestId('fil-sans-position')).toBeTruthy());
    expect(screen.queryByTestId('fil-schema-aa')).toBeNull();
  });

  it('jamais sur un ordinateur de bureau', async () => {
    await render(cadre({ etat: 'refusee', ouReactiver: 'web_desktop' }));
    await waitFor(() => expect(screen.getByTestId('fil-sans-position')).toBeTruthy());
    expect(screen.queryByTestId('fil-schema-aa')).toBeNull();
  });
});

describe('le fil de secours', () => {
  it('apparaît sur un refus', async () => {
    await render(cadre({ etat: 'refusee', ouReactiver: 'web_desktop' }));
    await waitFor(() => expect(screen.getByTestId('fil-populaire')).toBeTruthy());
    expect(screen.getByText('Ocean Beauty Studio')).toBeTruthy();
  });

  it('apparaît quand le relevé n’aboutit pas', async () => {
    await render(cadre({ etat: 'indisponible' }));
    await waitFor(() => expect(screen.getByTestId('fil-populaire')).toBeTruthy());
  });

  it('apparaît sans réponse de la demande', async () => {
    await render(cadre({ etat: 'sans_reponse' }));
    await waitFor(() => expect(screen.getByTestId('fil-populaire')).toBeTruthy());
  });

  it('n’apparaît pas pendant les deux états qui ne durent qu’un rendu', async () => {
    // `jamais_demandee` et `en_cours` : la demande part ou tourne déjà, et un
    // appel réseau pour une liste qui va disparaître au rendu suivant ne
    // rapporterait rien.
    await render(cadre({ etat: 'jamais_demandee' }));
    expect(screen.queryByTestId('fil-populaire')).toBeNull();

    await render(cadre({ etat: 'en_cours' }));
    expect(screen.queryByTestId('fil-populaire')).toBeNull();
  });

  it('reste silencieux quand la liste est vide, plutôt que d’ajouter un second message', async () => {
    await render(cadre({ etat: 'refusee', ouReactiver: 'web_desktop' }, false));
    await waitFor(() => expect(screen.getByTestId('fil-sans-position')).toBeTruthy());
    expect(screen.queryByTestId('fil-populaire')).toBeNull();
  });
});
