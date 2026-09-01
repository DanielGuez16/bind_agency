/**
 * Où c'est, et à quelle distance.
 *
 * **Le calcul se teste sans écran** : c'est une règle, pas une composition.
 * Le rendu, lui, se teste sur les trois cas qui décident — sans coordonnées,
 * sans position, et avec les deux.
 */
import { render, screen } from '@testing-library/react-native';

import { I18nProvider } from '../src/i18n';
import { adresseDuPlan, distanceAVolDOiseau, OuEstLeLieu } from '../src/screens/fiche/OuEstLeLieu';
import { ThemeProvider } from '../src/theme';

const SALON = { longitude: -80.1918, latitude: 25.7617 };

async function monter(props: Partial<React.ComponentProps<typeof OuEstLeLieu>> = {}) {
  return await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <OuEstLeLieu nom="Vela Nail Studio" lieu={SALON} position={null} {...props} />
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('la distance à vol d’oiseau', () => {
  it('rend zéro sur le même point, et ne lève pas', () => {
    expect(distanceAVolDOiseau(SALON, SALON)).toBe(0);
  });

  it('mesure un degré de latitude à cent onze kilomètres près', () => {
    // **Un repère vérifiable à la main.** Un degré de latitude vaut 111,2 km
    // partout sur le globe : si la formule se trompe d'un facteur, ce cas le
    // dit, là où deux points de Miami rendraient un nombre invérifiable.
    const metres = distanceAVolDOiseau(
      { longitude: 0, latitude: 0 },
      { longitude: 0, latitude: 1 },
    );
    expect(Math.round(metres / 1000)).toBe(111);
  });
});

describe('le bloc « où c’est »', () => {
  it('se tait quand le géocodage n’a rien résolu', async () => {
    await monter({ lieu: null });
    expect(screen.queryByTestId('ou-est-le-lieu')).toBeNull();
  });

  it('dit ce qui manque plutôt qu’une distance inventée', async () => {
    await monter({ position: null });
    expect(screen.getByTestId('ou-est-le-lieu-sans-position')).toBeTruthy();
    expect(screen.queryByTestId('ou-est-le-lieu-distance')).toBeNull();
  });

  it('et rend la distance dès que la position est connue', async () => {
    await monter({ position: { longitude: -80.1918, latitude: 25.7707 } });
    expect(screen.getByTestId('ou-est-le-lieu-distance')).toHaveTextContent(/1\.0 km|1 km|990 m/);
  });
});

describe('l’adresse ne s’y écrit plus', () => {
  it('ne répète pas ce que la tête de fiche a déjà dit', async () => {
    // **Le bloc s'intitulait « Where it is » et répétait l'adresse à trois
    // lignes d'elle-même**, sous un titre qui annonçait ce qu'on venait de
    // lire. Ce qui reste est le geste : partir. Les deux sens sont ici — sans
    // la seconde assertion, un bloc entièrement vide passerait aussi.
    const vue = await monter({ position: { longitude: -80.19, latitude: 25.76 } });

    expect(screen.queryByText(/120 NE 41st/)).toBeNull();
    expect(screen.getByTestId('ou-est-le-lieu-distance')).toBeTruthy();
    await vue.unmount();
  });
});

describe('l’adresse du plan', () => {
  it('porte le point et le nom, échappé', () => {
    const url = adresseDuPlan(SALON, 'Vela Nail Studio');
    expect(url).toContain('ll=25.7617,-80.1918');
    expect(url).toContain('Vela%20Nail%20Studio');
  });
});
