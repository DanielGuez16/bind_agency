/**
 * La bannière de compte non confirmé, et l'accueil du retour de lien.
 *
 * Trois choses valent d'être éprouvées, et aucune n'est l'apparence de la
 * bannière :
 *
 * — **elle ne se montre qu'à qui elle s'adresse.** Une bannière d'avertissement
 *   permanente pour tout le monde serait pire qu'aucune ;
 * — **le retour au premier plan relit le compte.** C'est le seul accueil que le
 *   retour de lien puisse recevoir : le lien vise l'API, pas l'application,
 *   donc l'application n'est jamais rappelée — elle revient ;
 * — **« déjà vérifiée » n'est pas une erreur.** Le serveur répond 409, et c'est
 *   la bonne nouvelle : quelqu'un qui vient de confirmer et qui redemande un
 *   lien parce qu'il n'a rien vu bouger doit voir la bannière partir, pas un
 *   message d'échec.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AppState, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { SessionProvider, themeDuRole, useSession, type Utilisateur } from '../src/session';
import { BanniereDeVerification } from '../src/shell/BanniereDeVerification';
import { ThemeProvider } from '../src/theme';

const JETONS = { access_token: 'a', refresh_token: 'r' };

function coffreDeTest() {
  let contenu: typeof JETONS | null = JETONS;
  return {
    lire: async () => contenu,
    ecrire: async (jetons: typeof contenu) => {
      contenu = jetons;
    },
  };
}

function compte(verifie: boolean): Utilisateur {
  return {
    id: 'u1',
    email: 'rebecca@bind.example',
    role: 'creator',
    status: 'active',
    locale: 'en',
    email_verified_at: verifie ? '2026-08-01T10:00:00Z' : null,
  };
}

/**
 * Un serveur qui répond `/me` **par une file**, pas par une valeur figée.
 *
 * C'est ce qui permet d'éprouver un changement d'état côté serveur — confirmé
 * entre deux lectures — sans quoi le test du retour au premier plan
 * n'éprouverait que le fait qu'on relit, jamais qu'on en tient compte.
 */
function serveur(comptes: Utilisateur[], renvoi: { status: number } = { status: 204 }) {
  const appels: string[] = [];
  const file = [...comptes];
  const fetchImpl = async (url: RequestInfo | URL) => {
    const chemin = String(url);
    appels.push(chemin);
    if (chemin.includes('/verify-email/resend')) {
      return {
        ok: renvoi.status < 300,
        status: renvoi.status,
        json: async () => ({ error: { code: 'email_already_verified' } }),
      } as Response;
    }
    if (chemin.includes('/me')) {
      const corps = file.length > 1 ? file.shift()! : file[0];
      return { ok: true, status: 200, json: async () => corps } as Response;
    }
    throw new TypeError(`route non simulée : ${chemin}`);
  };
  return { fetchImpl: fetchImpl as unknown as typeof fetch, appels };
}

function Cadre({ children, fetchImpl }: { children: ReactNode; fetchImpl: typeof fetch }) {
  return (
    <SafeAreaProvider
      initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}
    >
      <I18nProvider initialLocale="en">
        <SessionProvider baseUrl="https://api.test" coffre={coffreDeTest()} fetchImpl={fetchImpl}>
          <Sous>{children}</Sous>
        </SessionProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

function Sous({ children }: { children: ReactNode }) {
  const session = useSession();
  const role = session.etat === 'connecte' ? session.utilisateur.role : 'creator';
  return (
    <ThemeProvider role={themeDuRole(role)}>
      <ApiProvider client={session.client}>
        <View>
          {/* **Le témoin de session.** Sans lui, un test qui conclut à
              l'absence de bannière conclurait aussi bien sur une session pas
              encore établie — c'est-à-dire sur rien. Il dit à quel moment
              l'absence commence à vouloir dire quelque chose. */}
          <Text testID="etat-session">{session.etat}</Text>
          {children}
        </View>
      </ApiProvider>
    </ThemeProvider>
  );
}

/** Capture l'abonné au premier plan, que rien n'émet dans un test. */
function premierPlan() {
  const abonnes: ((etat: string) => void)[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, h: (e: string) => void) => {
    abonnes.push(h);
    return { remove: () => undefined };
  }) as never);
  return async () => {
    await act(async () => {
      for (const abonne of abonnes) abonne('active');
    });
  };
}

afterEach(() => jest.restoreAllMocks());

describe('la bannière de compte non confirmé', () => {
  it('se montre à un compte non confirmé', async () => {
    const { fetchImpl } = serveur([compte(false)]);
    await render(<Cadre fetchImpl={fetchImpl}><BanniereDeVerification /></Cadre>);

    expect(await screen.findByTestId('banniere-verification')).toBeTruthy();
    expect(screen.getByText(/rebecca@bind.example/)).toBeTruthy();
  });

  it('et jamais à un compte confirmé', async () => {
    const { fetchImpl } = serveur([compte(true)]);
    await render(<Cadre fetchImpl={fetchImpl}><BanniereDeVerification /></Cadre>);

    // On attend que la session soit établie avant de conclure à l'absence :
    // sans cette attente, le test passerait aussi sur une bannière qui met un
    // rendu de plus à paraître — c'est-à-dire sur rien du tout.
    await waitFor(() => expect(screen.getByTestId('etat-session')).toHaveTextContent('connecte'));
    expect(screen.queryByTestId('banniere-verification')).toBeNull();
  });

  it('renvoie un lien, et le dit', async () => {
    const { fetchImpl, appels } = serveur([compte(false)]);
    await render(<Cadre fetchImpl={fetchImpl}><BanniereDeVerification /></Cadre>);

    const bouton = await screen.findByTestId('renvoyer-verification');
    await fireEvent.press(bouton);

    expect(appels.some((a) => a.includes('/me/verify-email/resend'))).toBe(true);
    expect(screen.getByText(/on its way to rebecca@bind.example/)).toBeTruthy();
  });

  it('s’efface au retour au premier plan quand l’adresse a été confirmée entre-temps', async () => {
    const emettre = premierPlan();
    const { fetchImpl } = serveur([compte(false), compte(true)]);
    await render(<Cadre fetchImpl={fetchImpl}><BanniereDeVerification /></Cadre>);

    expect(await screen.findByTestId('banniere-verification')).toBeTruthy();

    await emettre();

    await waitFor(() => expect(screen.queryByTestId('banniere-verification')).toBeNull());
  });

  it('traite « déjà vérifiée » comme une bonne nouvelle, pas comme un échec', async () => {
    const { fetchImpl } = serveur([compte(false), compte(true)], { status: 409 });
    await render(<Cadre fetchImpl={fetchImpl}><BanniereDeVerification /></Cadre>);

    const bouton = await screen.findByTestId('renvoyer-verification');
    await fireEvent.press(bouton);

    await waitFor(() => expect(screen.queryByTestId('banniere-verification')).toBeNull());
    expect(screen.queryByText(/could not be sent/)).toBeNull();
  });
});
