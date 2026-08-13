/**
 * La prise en main d'une fiche préparée, et le mode terrain qui l'émet.
 *
 * **Ce que ce fichier garde : le lien ne demande jamais plus que ce qu'il faut
 * pour s'engager.** Le gérant arrive sans compte, voit ce qui a été préparé en
 * son nom, et donne trois choses — une adresse, un mot de passe, un accord. Un
 * écran qui lui redemanderait son adresse postale ou ses horaires referait au
 * comptoir la demi-heure que ce dispositif existe pour lui épargner.
 *
 * **Un `fireEvent` non attendu fait échouer le test suivant.** Quatre tests
 * passaient, tous ceux d'après restaient bloqués en chargement — sur des écrans
 * parfaitement sains. J'ai cherché du côté d'un client partagé, d'un plafond de
 * rendus, de l'ordre des tests ; c'était une mise à jour d'état qui tombait
 * hors de `act` et se rejouait dans le test d'après. Le garde-fou de discipline
 * du dépôt le dit en une ligne, et c'est lui qui a fini par le trouver.
 *
 * Trois autres propriétés comptent. **Un lien mort ne dit pas pourquoi** — le
 * serveur ne distingue pas inconnu, expiré, consommé et révoqué, et l'écran non
 * plus. **La version des conditions repart telle qu'elle a été montrée**, sans
 * quoi on écrirait au journal une acceptation que personne n'a produite. Et
 * **assumer une fiche ne la publie pas** : l'écran le dit, faute de quoi un
 * salon chercherait ses réservations pendant deux jours.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { PriseEnMainScreen } from '../src/screens/PriseEnMainScreen';
import { ThemeProvider } from '../src/theme';

const coffre = { lire: async () => null, ecrire: async () => {} };

const APERCU = {
  business_name: 'Salon Ocean',
  address: '100 Ocean Drive, Miami',
  phone: null,
  prestations_preparees: 12,
  plages_preparees: 6,
  terms_version: '2026-01',
};

function clientDe(
  table: Record<string, unknown>,
  espion?: (chemin: string, corps: unknown) => void,
): ApiClient {
  return new ApiClient({
    baseUrl: 'https://api.test',
    coffre,
    fetchImpl: async (url, init) => {
      const chemin = String(url);
      if (init?.body) espion?.(chemin, JSON.parse(String(init.body)));
      const trouve = Object.entries(table).find(([fragment]) => chemin.includes(fragment));
      if (!trouve) throw new Error(`route non simulée : ${chemin}`);
      return { ok: true, status: 200, json: async () => trouve[1] } as Response;
    },
  });
}

/**
 * Un client neuf par appel, et non une instance partagée.
 *
 * Un `ApiClient` porte l'état de sa dernière rotation de jeton ; partagé entre
 * deux tests, il fait échouer le second sur un écran parfaitement sain, et
 * l'échec se lit comme un défaut de l'écran. Trouvé en écrivant ce fichier :
 * trois tests tombaient d'affilée à cause d'une constante de module.
 */
function clientQuiRefuseLeJeton() {
  return new ApiClient({
    baseUrl: 'https://api.test',
    coffre,
    fetchImpl: async () =>
      ({ ok: false, status: 404, json: async () => ({ detail: 'handover_invalid' }) }) as Response,
  });
}

/**
 * Asynchrone, comme partout ailleurs dans cette suite.
 *
 * Un rendu non attendu laisse ses mises à jour d'état tomber dans le test
 * *suivant* : React se plaint d'un rendu hors `act`, et c'est le test d'après
 * qui échoue, sur un écran parfaitement sain. Un garde-fou du dépôt cherche
 * précisément cette forme.
 */
async function monter(noeud: ReactElement, client: ApiClient) {
  function Cadre({ children }: { children: ReactNode }) {
    return (
      <I18nProvider initialLocale="en">
        <ThemeProvider role="merchant">
          <ApiProvider client={client}>{children}</ApiProvider>
        </ThemeProvider>
      </I18nProvider>
    );
  }
  return render(<Cadre>{noeud}</Cadre>);
}

// --------------------------------------------------------------------------
// on montre avant de demander
// --------------------------------------------------------------------------

describe('prise en main', () => {
  it('montre ce qui a été préparé avant de demander quoi que ce soit', async () => {
    await monter(
      <PriseEnMainScreen jeton="j1" onTermine={jest.fn()} />,
      clientDe({ '/handover/j1': APERCU }),
    );

    await waitFor(() => expect(screen.getByTestId('fiche-preparee')).toBeTruthy());
    expect(screen.getByText('Salon Ocean')).toBeTruthy();
    expect(screen.getByText('100 Ocean Drive, Miami')).toBeTruthy();
    // Les nombres, pas la liste : le gérant reconnaît son salon sans que le
    // lien devienne une lecture complète de sa fiche.
    expect(screen.getByTestId('ce-qui-est-pret')).toHaveTextContent(/12/);
    expect(screen.getByTestId('ce-qui-est-pret')).toHaveTextContent(/6/);
  });

  it('ne demande que trois choses', async () => {
    await monter(
      <PriseEnMainScreen jeton="j1" onTermine={jest.fn()} />,
      clientDe({ '/handover/j1': APERCU }),
    );
    await waitFor(() => expect(screen.getByTestId('fiche-preparee')).toBeTruthy());

    // **Le cœur du dispositif.** Tout le reste a été saisi au comptoir ; le
    // redemander referait la demi-heure qu'on vient d'économiser.
    expect(screen.getByTestId('champ-email')).toBeTruthy();
    expect(screen.getByTestId('champ-mot-de-passe')).toBeTruthy();
    expect(screen.getByTestId('bascule-conditions')).toBeTruthy();
    expect(screen.queryByTestId('champ-adresse')).toBeNull();
    expect(screen.queryByTestId('champ-telephone')).toBeNull();
  });

  it('dit que prendre la fiche ne la publie pas', async () => {
    await monter(
      <PriseEnMainScreen jeton="j1" onTermine={jest.fn()} />,
      clientDe({ '/handover/j1': APERCU }),
    );

    await waitFor(() => expect(screen.getByTestId('fiche-preparee')).toBeTruthy());
    expect(screen.getByText(en.priseEnMain.pasEncoreEnLigne)).toBeTruthy();
  });

  it('n’ouvre pas avant que les conditions soient acceptées', async () => {
    await monter(
      <PriseEnMainScreen jeton="j1" onTermine={jest.fn()} />,
      clientDe({ '/handover/j1': APERCU }),
    );
    await waitFor(() => expect(screen.getByTestId('fiche-preparee')).toBeTruthy());

    await fireEvent.changeText(screen.getByTestId('champ-email'), 'gerant@salon.example');
    await fireEvent.changeText(screen.getByTestId('champ-mot-de-passe'), 'un-mot-de-passe');

    expect(screen.getByTestId('valider-prise-en-main').props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });
  it('un lien mort ne dit pas pourquoi il est mort', async () => {
    await monter(<PriseEnMainScreen jeton="j1" onTermine={jest.fn()} />, clientQuiRefuseLeJeton());

    await waitFor(() => expect(screen.getByTestId('prise-en-main-lien-mort')).toBeTruthy());
    // **Un seul message pour les quatre raisons.** Le message énumère les
    // possibilités — « expiré, ou déjà utilisé » — sans dire laquelle
    // s'applique : c'est le serveur qui refuse de les distinguer, et l'écran
    // n'a rien de plus à montrer.
    expect(screen.getByText(en.priseEnMain.lienMortAide)).toBeTruthy();
    // Et jamais le code technique, qui ne dit rien à un gérant.
    expect(screen.queryByText(/handover_invalid/)).toBeNull();
  });
  it('renvoie la version des conditions telle qu’elle a été montrée', async () => {
    const partis: { chemin: string; corps: unknown }[] = [];
    const client = clientDe(
      { '/handover/j1': APERCU },
      (chemin, corps) => partis.push({ chemin, corps }),
    );
    const termine = jest.fn();
    await monter(<PriseEnMainScreen jeton="j1" onTermine={termine} />, client);
    await waitFor(() => expect(screen.getByTestId('fiche-preparee')).toBeTruthy());

    await fireEvent.changeText(screen.getByTestId('champ-email'), 'gerant@salon.example');
    await fireEvent.changeText(screen.getByTestId('champ-mot-de-passe'), 'un-mot-de-passe');
    // `fireEvent(nœud, 'press')` et non `fireEvent.press` : la seconde forme
    // remonte l'arbre à la recherche d'un gestionnaire et n'atteint pas la
    // bascule, dont le `Pressable` porte le sien directement.
    await fireEvent(screen.getByTestId('bascule-conditions'), 'press');
    await fireEvent(screen.getByTestId('valider-prise-en-main'), 'press');

    await waitFor(() => expect(partis).toHaveLength(1));
    expect(partis[0].corps).toMatchObject({
      email: 'gerant@salon.example',
      terms_version: '2026-01',
    });
    // **Attendre la fin, et pas seulement le départ.** Sans cette ligne, les
    // dernières mises à jour d'état tombent après la fin du test, dans le
    // suivant — qui échoue alors sur un écran parfaitement sain.
    await waitFor(() => expect(termine).toHaveBeenCalledWith('gerant@salon.example'));
  });

});
