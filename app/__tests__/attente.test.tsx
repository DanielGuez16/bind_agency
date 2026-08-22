/**
 * L'attente : ce qu'on ne montre pas, et ce qui ne pousse rien.
 *
 * **« Lent » veut dire « je ne sais pas si ça marche ».** Ce qui produit la
 * sensation de lenteur n'est pas la durée, c'est l'incertitude : rien n'a bougé,
 * donc on appuie une seconde fois — et la lenteur perçue devient mesurée.
 *
 * **Les deux décors divergents sont des absences**, ce qui est inhabituel. Une
 * implémentation qui montre le squelette tout de suite rend un écran qui a
 * l'air correct : la silhouette est là, la garde des squelettes passe. Ce qui
 * la distingue est le premier instant, et c'est celui qu'on écrit.
 */
import { act, render, screen } from '@testing-library/react-native';
import { View } from 'react-native';

import { ApiClient, ApiProvider } from '../src/api';
import { Photo, SkeletonLignes } from '../src/components';
import { I18nProvider } from '../src/i18n';
import { Ecran } from '../src/screens/Ecran';
import { motion, ThemeProvider, couleurs } from '../src/theme';

const api = new ApiClient({
  baseUrl: 'https://api.test',
  coffre: { lire: async () => null, ecrire: async () => {} },
  fetchImpl: (async () =>
    ({ ok: true, status: 200, json: async () => ({}) }) as Response) as unknown as typeof fetch,
});

function Cadre({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={api}>{children}</ApiProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

const EN_CHARGEMENT = {
  etat: 'chargement' as const,
  donnees: null,
  vide: false,
  erreur: null,
  recharger: () => {},
};

describe('rien ne clignote sous le seuil', () => {
  it('le squelette n’est pas là au premier instant', async () => {
    await render(
      <Cadre>
        <Ecran
          requete={EN_CHARGEMENT as never}
          titre="x"
          squelette={<SkeletonLignes combien={3} testID="squelette-x" />}
        >
          {() => null}
        </Ecran>
      </Cadre>,
    );

    // L'état existe — la vue reste montée, ce n'est pas un blanc — mais il ne
    // montre rien. Un indicateur qui vient et s'en va en deux cents
    // millisecondes est un défaut visuel, pas une information.
    expect(screen.getByTestId('etat-chargement')).toBeTruthy();
    expect(screen.queryByTestId('squelette-x')).toBeNull();
  });

  it('et il arrive une fois le seuil franchi', async () => {
    jest.useFakeTimers();
    try {
      await render(
        <Cadre>
          <Ecran
            requete={EN_CHARGEMENT as never}
            titre="x"
            squelette={<SkeletonLignes combien={3} testID="squelette-x" />}
          >
            {() => null}
          </Ecran>
        </Cadre>,
      );

      expect(screen.queryByTestId('squelette-x')).toBeNull();
      // **Juste avant le seuil, toujours rien.** Sans cette moitié, une
      // implémentation qui montre tout de suite passerait la seconde
      // assertion et le test ne prouverait rien.
      await act(async () => {
        jest.advanceTimersByTime(motion.seuilDAttente - 1);
      });
      expect(screen.queryByTestId('squelette-x')).toBeNull();

      await act(async () => {
        jest.advanceTimersByTime(2);
      });
      expect(screen.getByTestId('squelette-x')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('une photo n’agrandit pas sa carte', () => {
  const aplat = (noeud: { props: { style: unknown } }) => {
    const style = [noeud.props.style].flat(9).filter(Boolean) as Record<string, unknown>[];
    return Object.assign({}, ...style) as Record<string, unknown>;
  };

  it('la zone a sa hauteur et son fond avant que l’image arrive', async () => {
    await render(
      <Cadre>
        <Photo uri="https://exemple.test/a.jpg" hauteur={96} testID="zone" />
      </Cadre>,
    );

    const style = aplat(screen.getByTestId('zone') as never);
    // **C'est tout le sujet.** Sans hauteur, la carte grandit à l'arrivée de la
    // photo et pousse le texte qu'on lisait ; sans aplat, on voit la surface de
    // la carte au travers et rien ne dit qu'une image est attendue.
    expect(style.height).toBe(96);
    expect(style.backgroundColor).toBe(couleurs['bg.deep']);
  });

  it('la zone reste, et garde sa hauteur, quand il n’y a pas de photo', async () => {
    await render(
      <Cadre>
        <Photo uri={null} hauteur={96} testID="zone" replit={<View testID="repli" />} />
      </Cadre>,
    );

    expect(aplat(screen.getByTestId('zone') as never).height).toBe(96);
    expect(screen.getByTestId('repli')).toBeTruthy();
    expect(screen.queryByTestId('zone-image')).toBeNull();
  });

  it('l’image part invisible : elle se fond, elle n’apparaît pas', async () => {
    await render(
      <Cadre>
        <Photo uri="https://exemple.test/a.jpg" hauteur={96} testID="zone" />
      </Cadre>,
    );

    // Le parent animé de l'image porte l'opacité. À zéro tant que `onLoad`
    // n'a pas répondu — une photo qui apparaît d'un coup est un clignotement,
    // quelle que soit sa vitesse.
    const image = screen.getByTestId('zone-image');
    const anime = image.parent as unknown as { props: { style: unknown } };
    const style = aplat(anime);
    expect(String(style.opacity)).toBe('0');
  });

  it('et elle ne se déplace ni ne change d’échelle', async () => {
    await render(
      <Cadre>
        <Photo uri="https://exemple.test/a.jpg" hauteur={96} testID="zone" />
      </Cadre>,
    );

    // Une photo qui glisse ou qui grandit déplace le texte voisin dans le
    // regard : c'est le défaut qu'on répare, pas une façon de le décorer.
    const anime = screen.getByTestId('zone-image').parent as unknown as {
      props: { style: unknown };
    };
    expect(aplat(anime).transform).toBeUndefined();
  });
});

describe('les quatre durées sont dans les jetons', () => {
  it('et aucune n’est écrite dans un écran', () => {
    expect(motion.appui).toBe(100);
    expect(motion.etat).toBe(160);
    expect(motion.fondu).toBe(220);
    expect(motion.seuilDAttente).toBe(400);
  });
});
