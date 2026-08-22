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
import { Animated, View } from 'react-native';

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
    expect(style.backgroundColor).toBe(couleurs['media.placeholder']);
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
    //
    // **Le nombre, pas sa chaîne.** La première écriture comparait `String()`
    // de la valeur animée à « 0 » : `Animated.Value(1)` rendait la même chose,
    // et la mutation qui posait l'opacité à un survivait sans rien casser. Le
    // rendu résout la valeur en nombre, et c'est lui qui distingue les deux.
    const image = screen.getByTestId('zone-image');
    const anime = image.parent as unknown as { props: { style: unknown } };
    expect(aplat(anime).opacity).toBe(0);
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

/**
 * Une liste qui se recompose ne se vide pas.
 *
 * **Le décor divergent est le contenu pendant l'attente.** Une implémentation
 * qui repasse par l'état de chargement rend un écran qui a l'air de
 * fonctionner : la nouvelle liste finit par arriver. Ce qu'elle détruit est le
 * repère du doigt — l'écran clignote, et l'on ne sait plus où l'on était. Le
 * test lit donc **ce qui est encore là** pendant la recomposition.
 */
describe('une liste qui se recompose ne se vide pas', () => {
  const PRETE = {
    etat: 'pret' as const,
    donnees: ['un', 'deux'],
    vide: false,
    vuA: 0,
    rechargement: false,
    recharger: () => {},
  };

  it('l’ancienne reste montée et lisible pendant qu’on recharge', async () => {
    const vue = await render(
      <Cadre>
        <Ecran requete={PRETE as never} titre="x">
          {(lignes: string[]) => (
            <View testID="liste">
              {lignes.map((l) => (
                <View key={l} testID={`ligne-${l}`} />
              ))}
            </View>
          )}
        </Ecran>
      </Cadre>,
    );

    vue.rerender(
      <Cadre>
        <Ecran requete={{ ...PRETE, rechargement: true } as never} titre="x">
          {(lignes: string[]) => (
            <View testID="liste">
              {lignes.map((l) => (
                <View key={l} testID={`ligne-${l}`} />
              ))}
            </View>
          )}
        </Ecran>
      </Cadre>,
    );

    // **Ni squelette ni vide.** Vider avant de remplir fait clignoter l'écran
    // et perdre le repère du doigt.
    expect(screen.getByTestId('ligne-un')).toBeTruthy();
    expect(screen.getByTestId('ligne-deux')).toBeTruthy();
    expect(screen.queryByTestId('etat-chargement')).toBeNull();
  });

  it('et elle s’atténue dès l’appui, sans attendre le seuil', async () => {
    /**
     * **On éprouve le départ de l'aller-retour, pas la valeur interpolée.**
     * Les animations de React Native sont pilotées par les images de rendu et
     * non par les minuteurs, donc avancer l'horloge de Jest ne déplace aucune
     * opacité : une assertion sur la valeur affichée resterait à un et
     * accuserait le composant. Ce qui se vérifie est que la descente vers
     * vingt-cinq pour cent **part au rendu de la recomposition** — une
     * implémentation qui attendrait le seuil n'aurait encore rien lancé.
     */
    const timing = jest.spyOn(Animated, 'timing');
    try {
      const corps = (lignes: string[]) => <View testID={`liste-${lignes.length}`} />;
      const vue = await render(
        <Cadre>
          <Ecran requete={PRETE as never} titre="x">
            {corps}
          </Ecran>
        </Cadre>,
      );
      timing.mockClear();

      await act(async () => {
        vue.rerender(
          <Cadre>
            <Ecran requete={{ ...PRETE, rechargement: true } as never} titre="x">
              {corps}
            </Ecran>
          </Cadre>,
        );
      });

      const versQuoi = timing.mock.calls.map((appel) => (appel[1] as { toValue: number }).toValue);
      // La descente à vingt-cinq pour cent, puis la remontée : un seul
      // aller-retour, déclaré d'un coup pour ne pas pouvoir être interrompu.
      expect(versQuoi).toEqual([0.25, 1]);
      // Et chaque moitié dure la moitié du fondu — la séquence entière tient
      // ses deux cent vingt millisecondes même si la donnée revient en
      // quarante, sans quoi l'atténuation deviendrait un clignotement.
      const durees = timing.mock.calls.map((appel) => (appel[1] as { duration: number }).duration);
      expect(durees).toEqual([motion.fondu / 2, motion.fondu / 2]);
    } finally {
      timing.mockRestore();
    }
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
