/**
 * L'écran de code de retrait.
 *
 * Il est hors du registre des quatre états — il garde son dernier code quoi
 * qu'il arrive, y compris hors ligne — mais il porte la règle la plus sensible
 * du produit : **un code appartient à une réservation et à une seule**. Un
 * écran qui en affiche un autre laisse consommer une prestation à la place
 * d'une autre, au comptoir, sans que rien ne le signale.
 */
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { ThemeProvider } from '../src/theme';
import { CodeScreen } from '../src/screens/CodeScreen';
import { en } from '../src/i18n/en';
import { destination } from '../src/screens/HistoriqueScreen';

jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));

const coffre = { lire: async () => null, ecrire: async () => {} };

/**
 * Toutes les tailles de texte de l'arbre rendu, avec leur hauteur de ligne.
 *
 * L'arbre sérialisé plutôt qu'une requête par type : elle ne rendrait que les
 * `Text` que la bibliothèque reconnaît comme tels, et le débordement se produit
 * sur le style final, après fusion — c'est lui qu'il faut lire.
 */
function taillesDeTexte(noeud: unknown): { fontSize: number; lineHeight: number }[] {
  if (noeud === null || typeof noeud !== 'object') return [];
  const { props, children } = noeud as {
    props?: { style?: unknown };
    children?: unknown[] | null;
  };
  const style = StyleSheet.flatten(props?.style as never) as {
    fontSize?: number;
    lineHeight?: number;
  } | null;

  const ici =
    style?.fontSize !== undefined
      ? [{ fontSize: style.fontSize, lineHeight: style.lineHeight ?? 0 }]
      : [];
  return [...ici, ...(children ?? []).flatMap(taillesDeTexte)];
}

/** Un code par réservation, comme le serveur en rend. */
const CODES: Record<
  string,
  {
    payload: string;
    code: string;
    manual_code: string;
    business_name: string;
    business_address: string | null;
  }
> = {
  // `payload` porte l'identifiant du **code**, pas celui de la réservation.
  // C'est le serveur qui le forme, et c'est lui qu'on encode : les deux ne se
  // ressemblent pas, et c'est ce qui rend la confusion invisible à l'œil.
  'reservation-a': {
    payload: 'code-a:111111',
    code: '111111',
    manual_code: 'AAA111',
    business_name: 'Studio Brickell',
    business_address: '1200 Brickell Ave, Miami',
  },
  // Le serveur rend le code de secours déjà groupé.
  // Sans adresse : le salon peut n'en avoir aucune servie, et l'écran doit
  // alors se taire plutôt que rendre une ligne vide.
  'reservation-b': {
    payload: 'code-b:222222',
    code: '222222',
    manual_code: 'BBB 222',
    business_name: 'Wynwood Nails',
    business_address: null,
  },
};

function client(compteur?: { appels: string[] }) {
  return new ApiClient({
    baseUrl: 'https://api.test',
    coffre,
    fetchImpl: async (url) => {
      const chemin = String(url);
      compteur?.appels.push(chemin);
      const id = chemin.match(/bookings\/([^/]+)\/code/)?.[1] ?? '';
      return {
        ok: true,
        status: 200,
        json: async () => ({ ...CODES[id], seconds_remaining: 30 }),
      } as Response;
    },
  });
}

function monter(bookingId: string, api: ApiClient) {
  return render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={api}>
          <CodeScreen bookingId={bookingId} />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

/**
 * Ce que le QR encode réellement.
 *
 * **C'est devenu le seul point d'observation du code**, depuis que les six
 * chiffres ne s'affichent plus : ils ne se saisissaient pas, ne désignaient rien
 * seuls, et se confondaient avec le code de secours, qui se dicte.
 *
 * On lit la valeur passée au composant de QR et non une propriété du bloc :
 * c'est elle que la caisse scannera. `includeHiddenElements` parce que le bloc
 * est masqué aux lecteurs d'écran — un QR ne se lit pas à voix haute.
 */
function charge(vue: typeof screen): string {
  const bloc = vue.getByTestId('qr', { includeHiddenElements: true });
  return bloc.props.children.props.value as string;
}

it('affiche le code de la réservation ouverte, pas celui de la précédente', async () => {
  const api = client();
  const { rerender } = await monter('reservation-a', api);
  await waitFor(() => expect(charge(screen)).toBe(CODES['reservation-a'].payload));

  // Ouvrir une autre réservation depuis la liste réutilise l'écran : la
  // navigation change ses paramètres sans le démonter. Le code affiché n'avait
  // pas expiré, l'écran ne redemandait donc rien et gardait celui de la
  // réservation précédente — le même code et le même QR pour toutes.
  await rerender(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={api}>
          <CodeScreen bookingId="reservation-b" />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );

  await waitFor(() => expect(charge(screen)).toBe(CODES['reservation-b'].payload));
  expect(screen.getByTestId('secours')).toHaveTextContent(/BBB 222/);
});

it("n'affiche jamais le code d'une réservation à côté du numéro d'une autre", async () => {
  const api = client();
  const { rerender } = await monter('reservation-a', api);
  await waitFor(() => expect(charge(screen)).toBe(CODES['reservation-a'].payload));

  await rerender(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={api}>
          <CodeScreen bookingId="reservation-b" />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );

  // Entre les deux, l'écran repart de son état d'attente plutôt que de montrer
  // l'ancien code une fraction de seconde : le QR porte
  // `identifiant:code`, et un identifiant neuf collé à un code périmé est
  // scannable, faux, et refusé à la caisse sans explication.
  await waitFor(() => expect(charge(screen)).toBe(CODES['reservation-b'].payload));
  expect(screen.queryByText(/111111/)).toBeNull();
});

it('ne demande le code qu’une fois à l’ouverture', async () => {
  const compteur = { appels: [] as string[] };
  await monter('reservation-a', client(compteur));
  await waitFor(() => expect(screen.getByTestId('qr', { includeHiddenElements: true })).toBeTruthy());

  // Le décompte est piloté localement à partir de l'échéance rendue ; il ne
  // rappelle qu'à l'expiration. L'attente est enveloppée : le battement écrit
  // dans l'état, et hors `act` React le signale sans faire échouer — un
  // avertissement qu'on finit par ne plus lire.
  await act(async () => {
    await new Promise((suite) => setTimeout(suite, 1_200));
  });
  expect(compteur.appels).toHaveLength(1);
});

it('aucun texte de l’écran ne déborde de sa ligne', async () => {
  const vue = await monter('reservation-a', client());
  await waitFor(() => expect(screen.getByTestId('qr', { includeHiddenElements: true })).toBeTruthy());

  // Le code de secours est dicté au comptoir : c'est le seul recours quand le
  // QR ne passe pas. Sa taille avait été augmentée sans sa hauteur de ligne,
  // qui restait celle de l'échelle mono — plus courte que les glyphes. Ils
  // débordaient vers le haut et chevauchaient le libellé « or read this out ».
  //
  // La règle est vérifiée sur tout l'écran plutôt que sur cette taille-là :
  // c'est la classe de faute qui compte, pas la constante. Les trois blocs
  // grossissent leur texte, les trois peuvent la commettre.
  const styles = taillesDeTexte(vue.toJSON());
  expect(styles.length).toBeGreaterThan(0);

  for (const style of styles) {
    expect(style.lineHeight).toBeGreaterThanOrEqual(style.fontSize);
  }
});

describe('quand le serveur refuse', () => {
  const clientQuiRefuse = () =>
    new ApiClient({
      baseUrl: 'https://api.test',
      coffre,
      fetchImpl: async () =>
        ({
          ok: false,
          status: 409,
          json: async () => ({ detail: 'redemption_booking_not_redeemable' }),
        }) as Response,
    });

  it('dit pourquoi plutôt que d’attendre sans fin', async () => {
    // Une réservation dont le droit a expiré : le serveur refuse le code. La
    // règle « hors ligne, on garde ce qui est à l'écran » ne s'applique pas,
    // il n'y a rien à garder — et l'attente tournait indéfiniment.
    await monter('reservation-a', clientQuiRefuse());

    await waitFor(() => expect(screen.getByTestId('etat-refus')).toBeTruthy());
    expect(screen.queryByTestId('etat-chargement')).toBeNull();
    expect(screen.getByText(en.parcours.codeIndisponible)).toBeTruthy();
    // Jamais le code brut du catalogue.
    expect(screen.queryByText(/redemption_booking_not_redeemable/)).toBeNull();
  });

  it('garde le code déjà affiché quand le réseau tombe ensuite', async () => {
    let repond = true;
    const api = new ApiClient({
      baseUrl: 'https://api.test',
      coffre,
      fetchImpl: async (url) => {
        if (!repond) throw new TypeError('offline');
        const id = String(url).match(/bookings\/([^/]+)\/code/)?.[1] ?? '';
        return {
          ok: true,
          status: 200,
          json: async () => ({ ...CODES[id], seconds_remaining: 1 }),
        } as Response;
      },
    });

    await monter('reservation-a', api);
    await waitFor(() => expect(charge(screen)).toBe(CODES['reservation-a'].payload));

    // Le code expire, la relecture échoue : il reste à l'écran, parce qu'au
    // comptoir c'est la seule chose à montrer et qu'il y est encore valide.
    repond = false;
    await act(async () => {
      await new Promise((suite) => setTimeout(suite, 1_500));
    });
    expect(charge(screen)).toBe(CODES['reservation-a'].payload);
    expect(screen.queryByTestId('etat-refus')).toBeNull();
  });
});

describe('ce qu’une ligne de réservation ouvre', () => {
  /**
   * **`valid_until` fait partie de la ligne, et le décor l'omettait.**
   *
   * Le serveur le rend sur chaque réservation ; l'omettre ici rendait la
   * fabrique moins fidèle que ce qu'elle imite, et la règle du droit périmé
   * n'était éprouvée sur rien. Il est donc porté, et loin devant par défaut :
   * un cas qui veut un droit échu le dit.
   */
  const DANS_DEUX_HEURES = new Date(Date.now() + 2 * 3_600_000).toISOString();
  const IL_Y_A_DEUX_HEURES = new Date(Date.now() - 2 * 3_600_000).toISOString();
  const ligne = (
    status: string,
    contrepartie: unknown = null,
    valid_until: string = DANS_DEUX_HEURES,
  ) => ({ status, contrepartie, valid_until }) as never;

  it('mène au code une fois confirmée, jamais pendant qu’elle est retenue', () => {
    expect(destination(ligne('confirmed'))).toBe('code');
    // Le code naît à la confirmation. La ligne l'annonçait sur une réservation
    // retenue, où le serveur refuse : le geste principal du produit menait à
    // un écran qui ne pouvait rien afficher.
    expect(destination(ligne('held'))).toBeNull();
  });

  it('ne mène nulle part quand le droit est échu', () => {
    // Le même défaut, un cran plus loin : `confirmed` ne veut pas dire
    // consommable. Rien ne fait sortir de `confirmed` une réservation que
    // personne n'a servie, et le serveur refuse alors le code.
    expect(destination(ligne('confirmed', null, IL_Y_A_DEUX_HEURES))).toBeNull();
  });

  it('mène à la preuve quand la contrepartie existe, et nulle part sinon', () => {
    expect(destination(ligne('consumed', { collaboration_id: 'c1' }))).toBe('preuve');
    expect(destination(ligne('consumed'))).toBeNull();
    expect(destination(ligne('cancelled'))).toBeNull();
  });
});

it('groupe le code de secours une seule fois', async () => {
  await monter('reservation-b', client());
  await waitFor(() => expect(charge(screen)).toBe(CODES['reservation-b'].payload));

  // Le serveur groupe déjà par trois. Regrouper son résultat donnait
  // « BBB  22 2 » : trois groupes faux sur le code qu'on dicte au comptoir,
  // là où le QR ne passe pas.
  expect(screen.getByTestId('secours')).toHaveTextContent(/BBB 222/);
  expect(screen.queryByText(/BBB {2}/)).toBeNull();
});


describe('ce que le QR encode', () => {
  it("encode la charge formée par l'API, jamais une composition locale", async () => {
    const api = client();
    await monter('reservation-a', api);
    await waitFor(() => expect(charge(screen)).toBe(CODES['reservation-a'].payload));

    const encode = charge(screen);

    // L'app composait `bookingId:code`. Le QR se lisait parfaitement et la
    // caisse le refusait : l'identifiant attendu est celui du code de retrait.
    // Le test compare à ce que le serveur a rendu, pas à une chaîne recopiée.
    expect(encode).toBe(CODES['reservation-a'].payload);
    expect(encode).not.toContain('reservation-a');
  });

  it('n’affiche plus les six chiffres, ni le décompte', async () => {
    // **Le défaut réparé.** Deux codes se ressemblaient : le nombre tournant,
    // qui ne se saisit pas et ne désigne rien seul, et le code de secours, qui
    // se dicte. Un commerçant a essayé de taper le premier. Une légende sous
    // les chiffres ne suffisait pas — ce qui trompe est la forme, pas l'absence
    // d'explication.
    const api = client();
    await monter('reservation-a', api);
    await waitFor(() => expect(screen.getByTestId('qr', { includeHiddenElements: true })).toBeTruthy());

    // Le nombre n'est plus nulle part à l'écran, sous aucune forme.
    expect(screen.queryByTestId('chiffres')).toBeNull();
    expect(screen.queryByText('111111')).toBeNull();
    expect(screen.queryByText(/1\s*1\s*1\s*1\s*1\s*1/)).toBeNull();

    // **Le décompte part avec le reste, et c'est tenable pour une raison qui
    // n'est pas esthétique** : le code tourne côté serveur, donc l'écran n'a
    // rien à promettre sur sa durée. Ce qu'il montre reste valable tant qu'il
    // est affiché.
    expect(screen.queryByTestId('compte-a-rebours')).toBeNull();
    // Ce qui reste : le QR, et le seul code qui se dicte.
    expect(screen.getByTestId('secours')).toHaveTextContent(/AAA 111/);
  });
});

/**
 * **Show code se vide entièrement.**
 *
 * Pas de titre, pas de nom de salon, pas d'adresse : l'écran s'ouvre depuis une
 * réservation, donc le contexte est déjà su, et ce qu'on y fait tient en un
 * geste — le tendre. On ne consulte pas une adresse depuis cet écran ; on y est
 * déjà, le téléphone à la main.
 *
 * **Les deux sens sont éprouvés.** Le QR et le code de secours doivent rester,
 * sans quoi ce test passerait aussi bien sur un écran vide.
 */
describe('où l’on va', () => {
  it('ne porte ni salon, ni adresse, ni titre', async () => {
    await monter('reservation-a', client());
    await waitFor(() => expect(screen.getByTestId('etat-nominal')).toBeTruthy());

    expect(screen.queryByTestId('ou-aller')).toBeNull();
    expect(screen.queryByTestId('adresse')).toBeNull();
    expect(screen.queryByTestId('titre-code')).toBeNull();
    expect(screen.getByTestId('secours')).toBeTruthy();
  });
});
