/**
 * La coquille : session, aiguillage par rôle, erreur globale.
 *
 * Ce qui est éprouvé ici n'est pas la mise en page, c'est ce qui arrive quand
 * les choses tournent mal. **Une session expirée ramène à la connexion avec un
 * message** — pas un écran blanc, pas un écran de chargement infini. **Un
 * compte suspendu le dit** plutôt que de laisser croire à un mot de passe
 * oublié. **Une trace technique n'atteint jamais l'écran.**
 *
 * Et l'aiguillage : chaque rôle n'a que ses onglets. Ce n'est pas une garantie
 * de sécurité — l'API refuse, et c'est elle qui décide — mais un onglet qui
 * répondrait 403 est pire qu'un onglet absent.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { AuthScreen } from '../src/screens/AuthScreen';
import { ReglagesScreen } from '../src/screens/ReglagesScreen';
import { SessionProvider, themeDuRole, useSession, type Utilisateur } from '../src/session';
import { FrontiereDErreur } from '../src/shell/FrontiereDErreur';
import { Navigation } from '../src/shell/Navigation';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider, tokens } from '../src/theme';
import { ZoneSure } from '../src/shell/ZoneSure';

// --------------------------------------------------------------------------
// plomberie
// --------------------------------------------------------------------------

function coffreDeTest(initial: { access_token: string; refresh_token: string } | null = null) {
  let contenu = initial;
  return {
    lire: async () => contenu,
    ecrire: async (jetons: typeof contenu) => {
      contenu = jetons;
    },
    get contenu() {
      return contenu;
    },
  };
}

const UTILISATEUR: Utilisateur = {
  id: 'u1',
  email: 'rebecca@bind.example',
  role: 'creator',
  status: 'active',
  locale: 'en',
};

/** Un serveur simulé, route par route. */
function serveur(table: Record<string, { status?: number; corps: unknown }>) {
  return async (url: RequestInfo | URL) => {
    const chemin = String(url);
    const trouve = Object.entries(table).find(([fragment]) => chemin.includes(fragment));
    if (!trouve) throw new TypeError(`route non simulée : ${chemin}`);
    const { status = 200, corps } = trouve[1];
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => corps,
    } as Response;
  };
}

/** Un iPhone à encoche : 47 points en haut, 34 pour l'indicateur d'accueil. */
const IPHONE_A_ENCOCHE = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function styleAplati(element: { props: { style?: unknown } }): Record<string, unknown> {
  const empile = (valeur: unknown): Record<string, unknown> =>
    Array.isArray(valeur)
      ? Object.assign({}, ...valeur.map(empile))
      : ((valeur as Record<string, unknown>) ?? {});
  return empile(element.props.style);
}

function Cadre({
  children,
  coffre,
  fetchImpl,
}: {
  children: ReactNode;
  coffre: ReturnType<typeof coffreDeTest>;
  fetchImpl: typeof fetch;
}) {
  return (
    // Les marges système sont fournies ici comme dans `App` : la barre
    // d'onglets les lit pour poser son décalage du bas, et sans fournisseur
    // elle lève — ce qui est le bon comportement, une barre qui ignore
    // l'indicateur d'accueil coupe ses libellés.
    <SafeAreaProvider initialMetrics={IPHONE_A_ENCOCHE}>
      <I18nProvider initialLocale="en">
        <SessionProvider baseUrl="https://api.test" coffre={coffre} fetchImpl={fetchImpl}>
          <Sous>{children}</Sous>
        </SessionProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

/** Reproduit l'ordre de `App.tsx` : thème depuis le rôle, puis client d'API. */
function Sous({ children }: { children: ReactNode }) {
  const session = useSession();
  const role = session.etat === 'connecte' ? session.utilisateur.role : 'creator';
  return (
    <ThemeProvider role={themeDuRole(role)}>
      <ApiProvider client={session.client}>{children}</ApiProvider>
    </ThemeProvider>
  );
}

/** Affiche l'état de session, pour l'observer sans monter la navigation. */
function Sonde() {
  const session = useSession();
  return (
    <View>
      <Text testID="etat">{session.etat}</Text>
      <Text testID="motif">
        {session.etat === 'anonyme' ? (session.motif ?? 'aucun') : ''}
      </Text>
      <Text testID="role">
        {session.etat === 'connecte' ? session.utilisateur.role : ''}
      </Text>
      <Text testID="jeton">{session.jetonDAcces ?? ''}</Text>
    </View>
  );
}

// --------------------------------------------------------------------------
// rétablissement au démarrage
// --------------------------------------------------------------------------

describe('rétablissement', () => {
  it('sans jeton, va directement à la connexion sans motif', async () => {
    const coffre = coffreDeTest(null);
    await render(
      <Cadre coffre={coffre} fetchImpl={serveur({}) as typeof fetch}>
        <Sonde />
      </Cadre>,
    );

    await waitFor(() => expect(screen.getByTestId('etat')).toHaveTextContent('anonyme'));
    expect(screen.getByTestId('motif')).toHaveTextContent('aucun');
  });

  it('avec un jeton valide, rétablit la session et son rôle', async () => {
    const coffre = coffreDeTest({ access_token: 'a', refresh_token: 'r' });
    await render(
      <Cadre
        coffre={coffre}
        fetchImpl={serveur({ '/me': { corps: UTILISATEUR } }) as typeof fetch}
      >
        <Sonde />
      </Cadre>,
    );

    await waitFor(() => expect(screen.getByTestId('etat')).toHaveTextContent('connecte'));
    expect(screen.getByTestId('role')).toHaveTextContent('creator');
  });

  it('avec un jeton mort, efface la session et dit pourquoi', async () => {
    // Le cas qui produisait un écran blanc : le jeton existe, il ne vaut plus
    // rien, et personne ne le disait.
    const coffre = coffreDeTest({ access_token: 'mort', refresh_token: 'mort' });
    await render(
      <Cadre
        coffre={coffre}
        fetchImpl={
          serveur({
            '/auth/refresh': { status: 401, corps: { detail: 'invalid_refresh_token' } },
            '/me': { status: 401, corps: { detail: 'authentication_required' } },
          }) as typeof fetch
        }
      >
        <Sonde />
      </Cadre>,
    );

    await waitFor(() => expect(screen.getByTestId('etat')).toHaveTextContent('anonyme'));
    expect(screen.getByTestId('motif')).toHaveTextContent('session_expiree');
    expect(coffre.contenu).toBeNull();
  });

  it('garde la session quand c’est le réseau qui manque', async () => {
    // On ne jette pas quelqu'un dehors parce qu'il ouvre l'app sous un tunnel.
    const coffre = coffreDeTest({ access_token: 'a', refresh_token: 'r' });
    await render(
      <Cadre
        coffre={coffre}
        fetchImpl={
          (async () => {
            throw new TypeError('offline');
          }) as unknown as typeof fetch
        }
      >
        <Sonde />
      </Cadre>,
    );

    await waitFor(() => expect(screen.getByTestId('etat')).toHaveTextContent('anonyme'));
    expect(screen.getByTestId('motif')).toHaveTextContent('aucun');
    expect(coffre.contenu).not.toBeNull();
  });
});

// --------------------------------------------------------------------------
// connexion
// --------------------------------------------------------------------------

describe('connexion', () => {
  async function monterAuth(fetchImpl: typeof fetch, coffre = coffreDeTest(null)) {
    function AvecAuth() {
      const session = useSession();
      if (session.etat === 'retablissement') return null;
      return (
        <>
          <Sonde />
          {session.etat === 'anonyme' ? <AuthScreen motif={session.motif} /> : null}
        </>
      );
    }
    await render(
      <Cadre coffre={coffre} fetchImpl={fetchImpl}>
        <AvecAuth />
      </Cadre>,
    );
    await waitFor(() => expect(screen.getByTestId('ecran-auth')).toBeTruthy());
    return coffre;
  }

  it('ouvre une session et relit le rôle depuis le serveur', async () => {
    // Le rôle ne se déduit pas d'un jeton décodé côté client : ce serait
    // laisser l'appareil se déclarer administrateur.
    const coffre = await monterAuth(
      serveur({
        '/auth/login': { corps: { access_token: 'a', refresh_token: 'r' } },
        '/me': { corps: { ...UTILISATEUR, role: 'admin' } },
      }) as typeof fetch,
    );

    await fireEvent.changeText(screen.getByTestId('champ-email'), 'admin@bind.example');
    await fireEvent.changeText(screen.getByTestId('champ-mot-de-passe'), 'un-mot-de-passe-long');
    await fireEvent.press(screen.getByTestId('valider'));

    await waitFor(() => expect(screen.getByTestId('role')).toHaveTextContent('admin'));
    expect(coffre.contenu).toEqual({ access_token: 'a', refresh_token: 'r' });
  });

  it('retire le bouton tant que la saisie est incomplète', async () => {
    // Retiré, pas grisé : l'aide sous le champ dit déjà ce qui manque.
    await monterAuth(serveur({}) as typeof fetch);
    expect(screen.queryByTestId('valider')).toBeNull();

    await fireEvent.changeText(screen.getByTestId('champ-email'), 'a@b.example');
    expect(screen.queryByTestId('valider')).toBeNull();

    await fireEvent.changeText(screen.getByTestId('champ-mot-de-passe'), 'douze-caracteres');
    expect(screen.getByTestId('valider')).toBeTruthy();
  });

  it('traduit un refus, sans jamais montrer le code', async () => {
    await monterAuth(
      serveur({
        '/auth/login': { status: 401, corps: { detail: 'invalid_credentials' } },
      }) as typeof fetch,
    );

    await fireEvent.changeText(screen.getByTestId('champ-email'), 'a@b.example');
    await fireEvent.changeText(screen.getByTestId('champ-mot-de-passe'), 'mauvais-mot-de-passe');
    await fireEvent.press(screen.getByTestId('valider'));

    await waitFor(() => expect(screen.getByTestId('echec-auth')).toBeTruthy());
    expect(screen.getByText(en.errors.invalid_credentials)).toBeTruthy();
    expect(screen.queryByText('invalid_credentials')).toBeNull();
  });

  it('dit qu’un compte est suspendu, et le distingue d’une session expirée', async () => {
    // L'API répond 401 partout ailleurs sans distinguer ; la connexion, elle,
    // rend `account_not_active`. C'est le seul endroit où on l'apprend.
    await monterAuth(
      serveur({
        '/auth/login': { status: 403, corps: { detail: 'account_not_active' } },
      }) as typeof fetch,
    );

    await fireEvent.changeText(screen.getByTestId('champ-email'), 'a@b.example');
    await fireEvent.changeText(screen.getByTestId('champ-mot-de-passe'), 'un-mot-de-passe-long');
    await fireEvent.press(screen.getByTestId('valider'));

    await waitFor(() => expect(screen.getByTestId('motif')).toHaveTextContent('compte_suspendu'));
  });

  it('ne propose jamais le rôle administrateur à l’inscription', async () => {
    // L'API l'accepte ; l'offrir dans un formulaire public ferait de
    // « administrateur » une case à cocher.
    await monterAuth(serveur({}) as typeof fetch);
    await fireEvent.press(screen.getByTestId('basculer'));

    expect(screen.getByText(en.auth.roleCreator)).toBeTruthy();
    expect(screen.getByText(en.auth.roleMerchant)).toBeTruthy();
    for (const mot of [/admin/i]) {
      expect(screen.queryByText(mot)).toBeNull();
    }
  });
});

// --------------------------------------------------------------------------
// déconnexion
// --------------------------------------------------------------------------

describe('déconnexion', () => {
  it('ferme la session localement même si le serveur ne répond pas', async () => {
    // Un serveur injoignable ne doit pas laisser quelqu'un connecté sur un
    // téléphone qu'il vient de rendre.
    const coffre = coffreDeTest({ access_token: 'a', refresh_token: 'r' });
    let premierAppel = true;

    await render(
      <Cadre
        coffre={coffre}
        fetchImpl={
          (async (url: RequestInfo | URL) => {
            if (String(url).includes('/me') && premierAppel) {
              premierAppel = false;
              return { ok: true, status: 200, json: async () => UTILISATEUR } as Response;
            }
            throw new TypeError('offline');
          }) as unknown as typeof fetch
        }
      >
        <Sonde />
        <ReglagesScreen />
      </Cadre>,
    );

    await waitFor(() => expect(screen.getByTestId('etat')).toHaveTextContent('connecte'));
    await fireEvent.press(screen.getByTestId('se-deconnecter'));

    await waitFor(() => expect(screen.getByTestId('etat')).toHaveTextContent('anonyme'));
    expect(screen.getByTestId('motif')).toHaveTextContent('deconnexion');
    expect(coffre.contenu).toBeNull();
  });
});

// --------------------------------------------------------------------------
// thème par rôle
// --------------------------------------------------------------------------

describe('thème', () => {
  it('associe chaque rôle de l’API à son thème', () => {
    // Deux vocabulaires : `business_member` en base, `merchant` au design.
    expect(themeDuRole('creator')).toBe('creator');
    expect(themeDuRole('business_member')).toBe('merchant');
    expect(themeDuRole('admin')).toBe('admin');
  });
});

// --------------------------------------------------------------------------
// erreur globale
// --------------------------------------------------------------------------

describe('frontière d’erreur', () => {
  function Tombe(): never {
    throw new Error('TypeError: Cannot read properties of undefined (reading « offres »)');
  }

  it('n’affiche jamais la trace technique', async () => {
    const bruit = jest.spyOn(console, 'error').mockImplementation(() => {});

    await render(
      <I18nProvider initialLocale="en">
        <ThemeProvider role="creator">
          <FrontiereDErreur>
            <Tombe />
          </FrontiereDErreur>
        </ThemeProvider>
      </I18nProvider>,
    );

    expect(screen.getByTestId('ecran-erreur-globale')).toBeTruthy();
    expect(screen.getByText(en.global.erreurCorps)).toBeTruthy();
    // Rien de la trace ne remonte à l'écran.
    expect(screen.queryByText(/TypeError/)).toBeNull();
    expect(screen.queryByText(/undefined/)).toBeNull();

    // Elle est journalisée, en revanche : c'est le seul endroit du produit où
    // l'on veut la pile entière.
    expect(bruit).toHaveBeenCalled();
    bruit.mockRestore();
  });

  it('offre une issue plutôt qu’un cul-de-sac', async () => {
    const bruit = jest.spyOn(console, 'error').mockImplementation(() => {});

    await render(
      <I18nProvider initialLocale="en">
        <ThemeProvider role="creator">
          <FrontiereDErreur>
            <Tombe />
          </FrontiereDErreur>
        </ThemeProvider>
      </I18nProvider>,
    );

    // Sans bouton, un plantage demande de tuer l'application et de la relancer.
    expect(screen.getByTestId('rejouer')).toBeTruthy();
    bruit.mockRestore();
  });

  it('laisse passer ce qui ne tombe pas', async () => {
    // Le pendant : une frontière qui afficherait toujours son écran d'erreur
    // passerait les deux tests précédents.
    await render(
      <I18nProvider initialLocale="en">
        <ThemeProvider role="creator">
          <FrontiereDErreur>
            <Text testID="contenu">tout va bien</Text>
          </FrontiereDErreur>
        </ThemeProvider>
      </I18nProvider>,
    );

    expect(screen.getByTestId('contenu')).toBeTruthy();
    expect(screen.queryByTestId('ecran-erreur-globale')).toBeNull();
  });
});

// --------------------------------------------------------------------------
// aiguillage par rôle
// --------------------------------------------------------------------------

describe('aiguillage par rôle', () => {
  /**
   * Monte la navigation réelle pour un rôle donné.
   *
   * Le serveur simulé répond à tout par une réponse vide : ce qui est vérifié
   * n'est pas le contenu des écrans — ils ont leurs propres tests — mais quels
   * onglets existent.
   */
  async function monterPour(role: Utilisateur['role']) {
    // Certaines routes rendent une liste, d'autres un objet. Servir la
    // mauvaise forme ferait tomber un écran et le test accuserait la
    // navigation d'un défaut qui serait le sien.
    const LISTES = ['/me/audience', '/me/verification', '/admin/', '/collaborations'];
    const OBJETS: Record<string, unknown> = {
      '/me/tiers': { creator_id: 'u1', is_new_creator: true, paliers: [] },
      '/me/bookings': { items: [], compteurs: {} },
      '/businesses': { commerces: [], obstacles: [] },
      '/bookings': { jour: '2026-08-08', timezone: 'UTC', debut: '', fin: '', items: [] },
      '/reporting': { reservations: 0, par_palier: [], par_item: [] },
      '/activation': [],
    };

    const fetchImpl = (async (url: RequestInfo | URL) => {
      const chemin = String(url);
      const rendre = (corps: unknown) =>
        ({ ok: true, status: 200, json: async () => corps }) as Response;

      if (chemin.includes('/me/businesses')) {
        return rendre([{ id: 'b1', name: 'Ocean Beauty Studio' }]);
      }
      if (chemin.endsWith('/me')) return rendre({ ...UTILISATEUR, role });
      if (LISTES.some((fragment) => chemin.includes(fragment))) return rendre([]);

      const trouve = Object.entries(OBJETS).find(([fragment]) => chemin.includes(fragment));
      return rendre(trouve ? trouve[1] : {});
    }) as unknown as typeof fetch;

    function AvecNavigation() {
      const session = useSession();
      if (session.etat !== 'connecte') return null;
      return <Navigation role={session.utilisateur.role} />;
    }

    await render(
      <Cadre coffre={coffreDeTest({ access_token: 'a', refresh_token: 'r' })} fetchImpl={fetchImpl}>
        <AvecNavigation />
      </Cadre>,
    );
    await waitFor(() => expect(screen.getByText(en.onglets.reglages)).toBeTruthy());
  }

  /** Les libellés d'onglets présents à l'écran. */
  function onglets(): string[] {
    return Object.values(en.onglets).filter((libelle) => screen.queryAllByText(libelle).length > 0);
  }

  it('le créateur voit ses cinq onglets, et aucun autre', async () => {
    await monterPour('creator');
    const vus = onglets();

    expect(vus).toEqual(
      expect.arrayContaining([
        en.onglets.fil,
        en.onglets.paliers,
        en.onglets.reservations,
        en.onglets.audience,
        en.onglets.reglages,
      ]),
    );
    // Un onglet qui répondrait 403 est pire qu'un onglet absent.
    for (const interdit of [en.onglets.journee, en.onglets.arbitrage, en.onglets.plans]) {
      expect(vus).not.toContain(interdit);
    }
  });

  it('le commerce voit les siens, et pas ceux du créateur', async () => {
    await monterPour('business_member');
    const vus = onglets();

    expect(vus).toEqual(
      expect.arrayContaining([
        en.onglets.journee,
        en.onglets.publications,
        en.onglets.reporting,
        en.onglets.activation,
        en.onglets.reglages,
      ]),
    );
    for (const interdit of [en.onglets.paliers, en.onglets.audience, en.onglets.arbitrage]) {
      expect(vus).not.toContain(interdit);
    }
  });

  it('l’administrateur ne voit ni fil ni caisse', async () => {
    await monterPour('admin');
    const vus = onglets();

    expect(vus).toEqual(
      expect.arrayContaining([en.onglets.arbitrage, en.onglets.plans, en.onglets.reglages]),
    );
    for (const interdit of [en.onglets.fil, en.onglets.journee, en.onglets.paliers]) {
      expect(vus).not.toContain(interdit);
    }
  });

  it('la barre d’onglets laisse la place à l’indicateur d’accueil', async () => {
    await monterPour('creator');

    // Les libellés se lisaient « Nearbv », « Bookinas », « Settinas » : la
    // barre s'arrêtait au bord de l'écran et l'indicateur d'accueil recouvrait
    // leur dernière ligne de pixels. La marge du bas ne peut pas venir de
    // `ZoneSure` — la barre est collée au bord, et l'y remonter laisserait une
    // bande de fond dessous.
    const barre = screen.getByText(en.onglets.fil);
    const marges = IPHONE_A_ENCOCHE.insets;

    // On remonte jusqu'au conteneur qui porte la hauteur : le libellé lui-même
    // n'a que sa typographie.
    type Noeud = { parent: Noeud | null; props: { style?: unknown } };
    let noeud: Noeud | null = barre as unknown as Noeud;
    let trouve: Record<string, unknown> | null = null;
    while (noeud !== null && trouve === null) {
      const style = styleAplati(noeud);
      if (typeof style.paddingBottom === 'number') trouve = style;
      noeud = noeud.parent;
    }

    expect(trouve).not.toBeNull();
    expect(trouve!.paddingBottom as number).toBeGreaterThanOrEqual(marges.bottom);
  });

  it('les réglages sont joignables depuis les trois rôles', async () => {
    // C'est le seul chemin vers la déconnexion : l'oublier dans un arbre
    // enfermerait quelqu'un dans une session qu'il ne peut pas quitter.
    for (const role of ['creator', 'business_member', 'admin'] as const) {
      const rendu = await monterPour(role);
      expect(screen.queryAllByText(en.onglets.reglages).length).toBeGreaterThan(0);
      void rendu;
    }
  });
});

// --------------------------------------------------------------------------
// zone sûre
// --------------------------------------------------------------------------

describe('zone sûre', () => {
  /**
   * Les marges d'un iPhone à encoche.
   *
   * `initialMetrics` est le seul moyen de les éprouver hors appareil : un
   * navigateur ne rend pas `env(safe-area-inset-top)`, et un simulateur
   * n'entre pas dans une suite de tests. Ces valeurs sont celles d'un
   * iPhone 13.
   */

  it('décale le contenu sous l’encoche, au niveau de la coquille', async () => {
    // Le titre passait dessous et se coupait, sur **tous** les écrans. Traité
    // ici plutôt qu'écran par écran : un écran qui l'oublierait rouvrirait le
    // défaut, et l'oubli ne se voit que sur un appareil à encoche.
    await render(
      <SafeAreaProvider initialMetrics={IPHONE_A_ENCOCHE}>
        <I18nProvider initialLocale="en">
          <ThemeProvider role="creator">
            <ZoneSure>
              <Text testID="contenu">titre</Text>
            </ZoneSure>
          </ThemeProvider>
        </I18nProvider>
      </SafeAreaProvider>,
    );

    const zone = screen.getByTestId('zone-sure');
    expect(styleAplati(zone).paddingTop).toBe(47);
    // Le bas est laissé à la barre d'onglets, qui pose le sien : l'ajouter ici
    // la ferait flotter au-dessus du bord.
    expect(styleAplati(zone).paddingBottom ?? 0).toBe(0);
  });

  it('ne laisse pas la bande d’encoche transparente', async () => {
    // Sans couleur, elle laisse voir la racine — blanche — et coupe l'écran
    // d'une barre claire en haut d'un thème sombre.
    await render(
      <SafeAreaProvider initialMetrics={IPHONE_A_ENCOCHE}>
        <I18nProvider initialLocale="en">
          <ThemeProvider role="creator">
            <ZoneSure>
              <Text>titre</Text>
            </ZoneSure>
          </ThemeProvider>
        </I18nProvider>
      </SafeAreaProvider>,
    );

    expect(styleAplati(screen.getByTestId('zone-sure')).backgroundColor).toBe(
      tokens.color.dark['bg.canvas'],
    );
  });
});
