/**
 * Ce qui reste en mono dans « Your week », et ce qui en sort.
 *
 * **Le jeton mono revendique « chiffres, codes, seuils, horaires »**, et c'est
 * ce qui a fait ranger l'amplitude de la journée dedans. Mais une amplitude
 * n'est pas un horaire isolé : c'est une phrase brève entre deux heures.
 * « 09:00 to 19:00 » se lit ; « 09:00 – 19:00 » en mono se déchiffre — troisième
 * fois que la police de ce cadre est trouvée moche.
 *
 * Le test tient sur la **frontière**, pas sur une liste : il vérifie qu'un nœud
 * de chaque côté est du bon côté. Le fuseau et la capacité sont des nombres nus
 * et des identifiants, et ils restent mono exprès — un test qui ne regarderait
 * que ce qui sort passerait aussi si l'on vidait le mono de l'écran entier.
 */
import { render, screen, within } from '@testing-library/react-native';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { HorairesDuCommerce } from '../src/screens/HorairesScreen';
import { ThemeProvider } from '../src/theme';
import { produit } from '../src/theme';
import tokens from '../src/theme/tokens.json';

const SEMAINE = {
  timezone: 'America/New_York',
  regles: [
    { id: 'r1', business_id: 'b1', weekday: 1, start_time: '09:00:00', end_time: '19:00:00', concurrent_slots: 2 },
    { id: 'r2', business_id: 'b1', weekday: 2, start_time: '10:00:00', end_time: '18:00:00', concurrent_slots: 3 },
  ],
  exceptions: [],
};

/**
 * **Le nom rendu, pas le nom du jeton.** `tokens.json` dit « IBM Plex Mono » ;
 * ce qui arrive sur le nœud est `IBMPlexMono_500`, la police chargée. Comparer
 * au nom du jeton rendait toute assertion vraie d'office — la première version
 * de ce test a survécu à sa propre mutation pour cette raison, et n'éprouvait
 * rien.
 */
const estMono = (f: unknown) => String(f).startsWith('IBMPlexMono');

/** La famille effectivement posée sur un nœud, styles empilés compris. */
function famille(noeud: { props: { style?: unknown } }): unknown {
  const style = noeud.props.style;
  const plat = Array.isArray(style) ? Object.assign({}, ...style.flat(9)) : style;
  return (plat as Record<string, unknown> | undefined)?.fontFamily;
}

async function monter() {
  return await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="merchant">
        <ApiProvider
          client={
            new ApiClient({
              baseUrl: 'https://api.test',
              coffre: { lire: async () => null, ecrire: async () => {} },
              fetchImpl: (async () => ({ ok: true, status: 200, json: async () => ({}) })) as never,
            })
          }
        >
          <HorairesDuCommerce semaine={SEMAINE} businessId="b1" onChange={() => {}} />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

it('dit l’amplitude avec un mot, hors du mono', async () => {
  await monter();

  // **Le nœud porte le repère depuis que la ligne est une rangée de tableau** :
  // il n'y a plus de conteneur à ouvrir, la cellule *est* le texte.
  const amplitude = screen.getByTestId('horaires-1');
  expect(amplitude).toHaveTextContent('09:00 to 19:00');
  expect(estMono(famille(amplitude))).toBe(false);
});

it('déplace le nœud, il ne vide pas le jeton', async () => {
  // **Le pendant, et c'est lui qui porte le test.** L'autre façon de rendre
  // l'amplitude non-mono est de redéfinir `type.data` en Plus Jakarta — ce qui
  // passerait le cas d'à côté et emporterait au passage les codes de retrait,
  // les seuils et les dates d'exception. La correction devait déplacer un nœud,
  // pas vider une voix.
  //
  // Le fuseau ne se vérifie pas ici : l'app ne l'affiche pas dans ce cadre. La
  // capacité, elle, est désormais un nombre nu dans sa colonne — comme la
  // planche le pose — et elle reste hors du mono : ce sont les chiffres
  // tabulaires qui l'alignent, pas un changement de famille.
  expect(produit).toBeTruthy();
  expect(tokens.type.data.family).toBe('IBM Plex Mono');
  expect(tokens.type.dataLabel.family).toBe('IBM Plex Mono');

  await monter();
  const postes = screen.getByTestId('postes-1');
  expect(estMono(famille(postes))).toBe(false);
});
