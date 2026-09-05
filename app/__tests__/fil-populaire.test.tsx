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
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

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

describe('la consigne de réactivation tient en une phrase', () => {
  /**
   * **Le schéma « Aa » a été retiré, et ses deux gardes avec lui.**
   * Signalé en production : le dessin du menu Safari et le paragraphe qui
   * distinguait le réglage général du réglage par site se lisaient comme un
   * mode d'emploi, et personne ne le suivait jusqu'au bout. Ce qui reste est
   * une phrase, la même forme sur les quatre plateformes.
   *
   * Ce qui est éprouvé ici n'est donc plus « le dessin paraît au bon
   * endroit » mais « la consigne reste courte et propre à la plateforme » —
   * la seconde moitié n'a jamais été gardée et c'est elle qui compte.
   */
  it('nomme les réglages de l’iPhone, sans détour par le menu du navigateur', async () => {
    await render(cadre({ etat: 'refusee', ouReactiver: 'web_ios_safari' }));
    await waitFor(() => expect(screen.getByTestId('fil-sans-position')).toBeTruthy());

    expect(screen.queryByText(/iPhone Settings/)).toBeTruthy();
    // Le détour retiré : plus une seule mention du menu du navigateur.
    expect(screen.queryByText(/Website Settings/)).toBeNull();
    expect(screen.queryByText(/“Aa”/)).toBeNull();
    expect(screen.queryByTestId('fil-schema-aa')).toBeNull();
  });

  it('et reste propre à la plateforme, sinon une seule phrase aurait suffi partout', async () => {
    // **Le cas qui diverge.** Si on avait remplacé les quatre variantes par un
    // texte unique, le test ci-dessus passerait tout de même. Android nomme sa
    // barre d'adresse, pas les réglages de l'iPhone.
    await render(cadre({ etat: 'refusee', ouReactiver: 'web_android' }));
    await waitFor(() => expect(screen.getByTestId('fil-sans-position')).toBeTruthy());

    expect(screen.queryByText(/iPhone/)).toBeNull();
    expect(screen.queryByText(/lock icon/)).toBeTruthy();
  });
});

describe('« réessayer » répond même quand rien ne change', () => {
  /**
   * **Signalé en production : le bouton semblait mort.** Il ne l'était pas —
   * il relançait bien un cycle de permission. Mais sur un refus déjà acquis,
   * le navigateur répond sans rien afficher, et l'écran revenait exactement
   * là où il était. L'appui était donc indiscernable d'un bouton inerte.
   */
  it('dit « toujours bloqué » au lieu de ne rien faire de visible', async () => {
    await render(cadre({ etat: 'refusee', ouReactiver: 'web_ios_safari' }));
    await waitFor(() => expect(screen.getByTestId('fil-reessayer')).toBeTruthy());

    // Rien avant l'appui : la ligne répond au geste, elle ne décore pas l'écran.
    expect(screen.queryByTestId('fil-essai-sans-effet')).toBeNull();

    await fireEvent.press(screen.getByTestId('fil-reessayer'));

    await waitFor(() => expect(screen.getByTestId('fil-essai-sans-effet')).toBeTruthy());
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
