/**
 * Le parcours de reprise, de bout en bout : depuis l'onglet des salons
 * jusqu'aux écrans du commerce repris, et retour.
 *
 * **Le parcours s'arrêtait net après l'ouverture.** `ReprendreLeCompte`
 * savait ouvrir une reprise et le disait ; rien ensuite ne menait à un seul
 * écran du commerce, et `fermerLaReprise()` — le geste de l'administration
 * sur son propre accès — n'était appelé nulle part dans l'app. Les deux
 * moitiés existaient côté serveur depuis le début ; c'est la navigation qui
 * manquait.
 *
 * **Ce fichier monte l'arbre entier**, contrairement à
 * `commerces-administration.test.tsx` qui n'éprouve que ce que la rangée
 * *envoie*. Le sujet ici est ce que `Navigation.tsx` en *fait* : remplacer sa
 * propre barre d'onglets par celle du commerce, prêter les vrais écrans
 * marchands sur le `businessId` de la reprise, et laisser « reglages » de
 * côté — c'est le réglage du **commerce**, gardé pour la session qui l'a
 * réellement rejoint, pas pour l'administration qui le visite.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { SessionProvider, themeDuRole, useSession, type Utilisateur } from '../src/session';
import { Navigation } from '../src/shell/Navigation';
import { ThemeProvider } from '../src/theme';

function coffreDeTest(initial: { access_token: string; refresh_token: string } | null) {
  let contenu = initial;
  return {
    lire: async () => contenu,
    ecrire: async (jetons: typeof contenu) => {
      contenu = jetons;
    },
  };
}

const ADMIN: Utilisateur = {
  id: 'a1',
  email: 'rebecca@bind.example',
  role: 'admin',
  status: 'active',
  locale: 'en',
  email_verified_at: '2026-08-01T10:00:00Z',
  favoris_me_previennent: true,
  deletion_effective_at: null,
};

/** Un iPhone à encoche, comme dans les autres tests de coquille. */
const IPHONE_A_ENCOCHE = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function Sous({ children }: { children: ReactNode }) {
  const session = useSession();
  const role = session.etat === 'connecte' ? session.utilisateur.role : 'admin';
  return (
    <ThemeProvider role={themeDuRole(role)}>
      <ApiProvider client={session.client}>{children}</ApiProvider>
    </ThemeProvider>
  );
}

function Cadre({ children, fetchImpl }: { children: ReactNode; fetchImpl: typeof fetch }) {
  return (
    <SafeAreaProvider initialMetrics={IPHONE_A_ENCOCHE}>
      <I18nProvider initialLocale="en">
        <SessionProvider
          baseUrl="https://api.test"
          coffre={coffreDeTest({ access_token: 'a', refresh_token: 'r' })}
          fetchImpl={fetchImpl}
        >
          <Sous>{children}</Sous>
        </SessionProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

/**
 * Un serveur qui se souvient d'une seule chose : la reprise sur `b1`
 * est-elle ouverte.
 *
 * **Avec état, et non une table figée.** Le parcours qu'on éprouve traverse
 * l'ouverture *et* la fermeture du même accès ; une table figée décrirait un
 * salon qui reste « repris » après qu'on a fermé, ou l'inverse, et
 * masquerait exactement le défaut que ce fichier existe pour attraper.
 */
function serveur(repriseOuverteAuDepart: boolean) {
  let repriseOuverte = repriseOuverteAuDepart;
  const appels: { chemin: string; methode: string }[] = [];

  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const chemin = String(url);
    const methode = init?.method ?? 'GET';
    appels.push({ chemin, methode });
    const rendre = (corps: unknown, status = 200) =>
      ({ ok: status < 300, status, json: async () => corps }) as Response;

    if (chemin.endsWith('/me')) return rendre(ADMIN);

    if (chemin.includes('/admin/businesses') && methode === 'GET') {
      return rendre({
        items: [
          {
            business_id: 'b1',
            name: 'Ocean Beauty Studio',
            category: 'beauty',
            neighborhood: 'wynwood',
            status: 'active',
            reprise_en_cours: repriseOuverte,
            created_at: '2026-03-14T15:00:00Z',
          },
        ],
        total: 1,
      });
    }

    if (chemin.includes('/support-access/recent')) {
      return rendre({ reprises_recentes_de_l_appelant: 0, fenetre_en_jours: 7 });
    }

    if (chemin.includes('/support-access')) {
      if (methode === 'POST') {
        const corps = JSON.parse(String(init?.body));
        repriseOuverte = true;
        return rendre({
          id: 'r1',
          business_id: 'b1',
          admin_name: 'Rebecca',
          reason: corps.reason,
          scope: corps.scope,
          spontaneous: corps.spontaneous,
          started_at: '2026-09-03T10:00:00Z',
          expires_at: '2026-09-03T11:00:00Z',
          ended_at: null,
          reprises_recentes_de_l_appelant: 1,
          fenetre_en_jours: 7,
        });
      }
      if (methode === 'DELETE') {
        repriseOuverte = false;
        return rendre({});
      }
    }

    // L'écran du jour, seul onglet du commerce qui se monte sans qu'on le
    // sollicite : c'est le premier de `ecransDuCommerce`.
    if (chemin.includes('/bookings')) {
      return rendre({ jour: '2026-09-03', timezone: 'UTC', debut: '', fin: '', items: [], a_trancher: [] });
    }

    // La file d'arbitrage et les autres listes de l'administration : le
    // premier onglet d'`OngletsAdmin` s'y sert au montage.
    if (chemin.includes('/admin/')) return rendre([]);

    return rendre({});
  }) as unknown as typeof fetch;

  return { fetchImpl, appels, estOuverte: () => repriseOuverte };
}

async function monterAdmin(repriseOuverteAuDepart = false) {
  const { fetchImpl, appels, estOuverte } = serveur(repriseOuverteAuDepart);
  function AvecNavigation() {
    const session = useSession();
    if (session.etat !== 'connecte') return null;
    return <Navigation role={session.utilisateur.role} />;
  }
  await render(
    <Cadre fetchImpl={fetchImpl}>
      <AvecNavigation />
    </Cadre>,
  );
  await waitFor(() => expect(screen.getAllByText(en.onglets.arbitrage).length).toBeGreaterThan(0));
  return { appels, estOuverte };
}

describe('ouvrir une reprise neuve mène droit dans le commerce', () => {
  it('le bandeau porte le motif et la portée qu’on vient d’écrire, et « Your days » est atteignable', async () => {
    await monterAdmin(false);

    await fireEvent.press(screen.getAllByText(en.onglets.commerces)[0]);
    await waitFor(() => expect(screen.getByTestId('ecran-commerces')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('reprendre-b1'));
    await waitFor(() => expect(screen.getByTestId('champ-motif')).toBeTruthy());

    await fireEvent.changeText(
      screen.getByTestId('champ-motif'),
      'A guest complained the last post never went up',
    );
    await fireEvent.press(screen.getByTestId('portee-fiche'));
    await fireEvent.press(screen.getByTestId('ouvrir-la-reprise'));

    // **Le parcours qui manquait.** L'ouverture seule ne suffisait pas — il
    // fallait atterrir dans le commerce, pas rester sur un accusé de
    // réception.
    await waitFor(() => expect(screen.getByTestId('bandeau-reprise-admin')).toBeTruthy());

    expect(screen.getByTestId('reprise-admin-motif')).toHaveTextContent(
      /A guest complained the last post never went up/,
    );
    expect(screen.getByTestId('reprise-admin-portee')).toHaveTextContent(
      new RegExp(en.reglages.porteeFiche),
    );

    // L'écran du jour du commerce, atteignable — c'était le trou.
    expect(screen.getAllByText(en.onglets.journee).length).toBeGreaterThan(0);
    // **Et « Settings » n'y est pas.** Ce n'est pas un oubli : les sections de
    // pause et d'historique de `ReglagesScreen` sont gardées sur le rôle de la
    // session connectée, pas sur celui qu'on visite. Les y montrer aurait
    // rendu un écran de réglages amputé, silencieusement.
    expect(screen.queryAllByText(en.onglets.reglages)).toHaveLength(0);
  });

  it('la flèche de retour quitte sans fermer, et la barre de l’administration revient', async () => {
    const { appels } = await monterAdmin(false);

    await fireEvent.press(screen.getAllByText(en.onglets.commerces)[0]);
    await waitFor(() => expect(screen.getByTestId('ecran-commerces')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('reprendre-b1'));
    await waitFor(() => expect(screen.getByTestId('champ-motif')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('champ-motif'), 'Checking a booking dispute');
    await fireEvent.press(screen.getByTestId('portee-agenda'));
    await fireEvent.press(screen.getByTestId('ouvrir-la-reprise'));
    await waitFor(() => expect(screen.getByTestId('bandeau-reprise-admin')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('reprise-admin-retour'));

    await waitFor(() => expect(screen.queryByTestId('bandeau-reprise-admin')).toBeNull());
    // L'onglet des salons de l'administration redevient joignable.
    expect(screen.getAllByText(en.onglets.commerces).length).toBeGreaterThan(0);

    // **Et rien n'a fermé l'accès.** Revenir regarder autre chose n'est pas
    // renoncer à la reprise : aucun appel `DELETE` n'a dû partir.
    expect(appels.some((a) => a.chemin.includes('/support-access') && a.methode === 'DELETE')).toBe(
      false,
    );
  });
});

describe('revenir sur une reprise déjà ouverte, et la fermer', () => {
  it('n’a pas de motif à raconter, et « Close my access » referme vraiment', async () => {
    const { appels, estOuverte } = await monterAdmin(true);

    await fireEvent.press(screen.getAllByText(en.onglets.commerces)[0]);
    await waitFor(() => expect(screen.getByTestId('ecran-commerces')).toBeTruthy());

    // **Aucun second formulaire.** La ligne dit qu'on est déjà dedans ; y
    // entrer ne redemande ni motif ni portée.
    expect(screen.queryByTestId('reprendre-b1')).toBeNull();
    await fireEvent.press(screen.getByTestId('reprise-en-cours-b1'));

    await waitFor(() => expect(screen.getByTestId('bandeau-reprise-admin')).toBeTruthy());
    // **Pas de `detail` en revenant depuis la liste.** La ligne ne sait que
    // l'ouverture existe, pas ce qu'elle porte — le redemander retarderait
    // l'entrée pour une phrase qui ne bloque rien.
    expect(screen.queryByTestId('reprise-admin-motif')).toBeNull();

    await fireEvent.press(screen.getByTestId('reprise-admin-fermer'));

    await waitFor(() =>
      expect(
        appels.some((a) => a.chemin.includes('/admin/businesses/b1/support-access') && a.methode === 'DELETE'),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.queryByTestId('bandeau-reprise-admin')).toBeNull());
    expect(estOuverte()).toBe(false);
    // L'administration a bien été rendue à ses propres onglets.
    expect(screen.getAllByText(en.onglets.commerces).length).toBeGreaterThan(0);
  });
});
