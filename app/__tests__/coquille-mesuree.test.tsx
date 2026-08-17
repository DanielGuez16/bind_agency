/**
 * La coquille, mesurée pour de vrai.
 *
 * **Le test qui manquait, et dont l'absence a coûté un produit inutilisable sur
 * ordinateur.** Les huit tests de grand écran écrits pendant la refonte
 * remplacent tous `useGabarit` par une valeur fixe. Ils prouvent que les
 * composants savent se rendre **quand on leur dit** que l'écran est large ; ils
 * ne prouvent à aucun moment que quelque chose le leur dit, ni que ce qu'ils
 * rendent alors est visible.
 *
 * Celui-ci ne remplace rien. Il monte la coquille dans l'ordre exact de
 * `App.tsx`, envoie une **vraie** mesure de disposition au conteneur que
 * `GabaritProvider` observe, et regarde ce qui apparaît. C'est le chemin
 * complet : l'événement de disposition, le contexte, le seuil, la barre
 * d'onglets et son remplacement.
 *
 * Ce qu'il aurait attrapé : la barre latérale était bien rendue, et masquée par
 * le `display: 'none'` posé sur le conteneur qui la porte. Ni barre latérale,
 * ni barre d'onglets — aucune navigation, sur le seul écran d'où l'on peut
 * atteindre les autres.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { SessionProvider, themeDuRole, useSession } from '../src/session';
import { GabaritProvider } from '../src/shell/gabarit';
import { Navigation } from '../src/shell/Navigation';
import { ZoneSure } from '../src/shell/ZoneSure';
import { ThemeProvider, breakpoint } from '../src/theme';

const MARGES = {
  frame: { x: 0, y: 0, width: 1512, height: 982 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const UTILISATEUR = {
  id: 'u1',
  email: 'ocean@bind.example',
  role: 'business_member',
  locale: 'en',
  status: 'active',
};

const REPONSES: Record<string, unknown> = {
  '/me/businesses': [{ id: 'b1', name: 'Ocean Beauty Studio' }],
  '/bookings': {
    jour: '2026-08-11',
    timezone: 'America/New_York',
    debut: '',
    fin: '',
    items: [],
    a_trancher: [],
  },
  '/reporting': { reservations: 0, par_palier: [], par_item: [], par_semaine: [] },
  '/activation': [],
};

const fetchImpl = (async (url: RequestInfo | URL) => {
  const chemin = String(url);
  const rendre = (corps: unknown) =>
    ({ ok: true, status: 200, json: async () => corps }) as Response;

  if (chemin.endsWith('/me')) return rendre(UTILISATEUR);
  const trouve = Object.entries(REPONSES).find(([fragment]) => chemin.includes(fragment));
  return rendre(trouve ? trouve[1] : []);
}) as unknown as typeof fetch;

function Sous({ children }: { children: ReactNode }) {
  const session = useSession();
  const role = session.etat === 'connecte' ? session.utilisateur.role : 'creator';
  return (
    <ThemeProvider role={themeDuRole(role)}>
      <ApiProvider client={session.client}>{children}</ApiProvider>
    </ThemeProvider>
  );
}

function AvecNavigation() {
  const session = useSession();
  if (session.etat !== 'connecte') return null;
  return <Navigation role={session.utilisateur.role} />;
}

/** L'ordre exact de `App.tsx`. Tout écart ici rendrait le test décoratif. */
async function monterLaCoquille() {
  const rendu = await render(
    <SafeAreaProvider initialMetrics={MARGES}>
      <I18nProvider initialLocale="en">
        <SessionProvider
          baseUrl="https://api.test"
          coffre={{ lire: async () => ({ access_token: 'a', refresh_token: 'r' }), ecrire: async () => {} }}
          fetchImpl={fetchImpl}
        >
          <Sous>
            <ZoneSure>
              <GabaritProvider>
                <AvecNavigation />
              </GabaritProvider>
            </ZoneSure>
          </Sous>
        </SessionProvider>
      </I18nProvider>
    </SafeAreaProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('gabarit')).toBeTruthy());
  return rendu;
}

/** Le style d'un nœud, tableau ou non. */
function aplati(noeud: { props?: { style?: unknown } }): Record<string, unknown> {
  const style = noeud.props?.style;
  return Array.isArray(style)
    ? Object.assign({}, ...style.filter(Boolean))
    : ((style as Record<string, unknown>) ?? {});
}

/** Ce que la plateforme envoie quand elle a posé la vue. Rien de simulé. */
async function mesurer(largeur: number) {
  await fireEvent(screen.getByTestId('gabarit'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: largeur, height: 982 } },
  });
}

describe('la coquille, mesurée', () => {
  // **Le repli est retenu par appareil**, et le stockage simulé survit d'un
  // test à l'autre : sans ce nettoyage, un test qui replie le rail décide de
  // l'état de départ des suivants, et deux d'entre eux ont effectivement changé
  // de sens en cours d'écriture.
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('affiche une navigation au-delà du seuil', async () => {
    // **Le test qui manquait.** Sans navigation, on ne peut atteindre aucun
    // autre écran : c'est le défaut le plus grave possible sur une coquille.
    await monterLaCoquille();
    await mesurer(1512);

    const barre = await screen.findByTestId('barre-laterale');
    expect(barre).toBeTruthy();

    // **Rendue et visible.** Regarder son seul style ne suffisait pas : elle
    // était dans l'arbre, et c'est le conteneur qui la porte qui était en
    // `display: 'none'`. On remonte donc toute la chaîne jusqu'à la racine.
    for (let noeud: (typeof barre) | null = barre; noeud; noeud = noeud.parent) {
      const style = Array.isArray(noeud.props?.style)
        ? Object.assign({}, ...noeud.props.style)
        : (noeud.props?.style ?? {});
      expect(style.display).not.toBe('none');
    }
  });

  it('donne toujours un moyen de changer d’écran, à toute largeur', async () => {
    // La propriété qui compte, indépendamment de la forme qu'elle prend :
    // une barre latérale en grand, une barre d'onglets en petit, jamais rien.
    await monterLaCoquille();

    for (const largeur of [390, breakpoint.expanded - 1, breakpoint.expanded, 1512]) {
      await mesurer(largeur);
      await waitFor(() =>
        expect(screen.queryAllByText(en.onglets.reglages).length).toBeGreaterThan(0),
      );
    }
  });

  it('remplace les onglets du bas par la barre latérale, sans perdre les deux', async () => {
    await monterLaCoquille();

    await mesurer(390);
    expect(screen.queryByTestId('barre-laterale')).toBeNull();

    await mesurer(1512);
    expect(await screen.findByTestId('barre-laterale')).toBeTruthy();
  });

  it('n’écrit pas le titre de l’écran deux fois', async () => {
    // En grand, il vit dans la barre de titre. Le laisser aussi dans le flux
    // donnait « Today » au-dessus de « Today ».
    await monterLaCoquille();
    await mesurer(1512);

    await waitFor(() => expect(screen.getByTestId('barre-de-titre')).toBeTruthy());

    // **Deux, et pas trois.** La ligne de la barre latérale nomme l'onglet, la
    // barre de titre nomme l'écran : la maquette porte les deux, et ils ne
    // disent pas la même chose. Le troisième était le titre laissé dans le
    // flux sous la barre — « Today » au-dessus de « Today ».
    expect(screen.queryAllByText(en.onglets.journee)).toHaveLength(2);
  });

  it('donne à chaque colonne la largeur que la passation lui fixe', async () => {
    // La géométrie complète, mesurée : 240 de barre latérale et 400 de liste.
    // Le « vide énorme à droite » relevé en ligne n'était pas un défaut de
    // bornage — c'était la barre latérale absente, qui laissait 1512 à
    // répartir au lieu de 1272.
    await monterLaCoquille();
    await mesurer(1512);

    const barre = await screen.findByTestId('barre-laterale');
    expect(aplati(barre).width).toBe(breakpoint.sidebarWidth);
  });

  /**
   * Replie le rail, quel que soit l'état retenu au montage.
   *
   * La préférence est persistée par appareil, et le stockage simulé garde donc
   * ce qu'un test précédent y a écrit : presser sans regarder déplierait le
   * rail une fois sur deux, et le test le plus important passerait à côté.
   */
  async function replier() {
    await waitFor(() => expect(screen.getByTestId('basculer-le-repli')).toBeTruthy());
    if (aplati(screen.getByTestId('barre-laterale')).width !== breakpoint.sidebarRailWidth) {
      await fireEvent.press(screen.getByTestId('basculer-le-repli'));
    }
    await waitFor(() =>
      expect(aplati(screen.getByTestId('barre-laterale')).width).toBe(
        breakpoint.sidebarRailWidth,
      ),
    );
  }

  /** L'étiquette est cachée des lecteurs d'écran : on la cherche telle quelle. */
  const etiquette = (nom: string) =>
    screen.queryByTestId(`etiquette-${nom}`, { includeHiddenElements: true });

  it('replié, le libellé revient au survol — et au focus', async () => {
    // **Le rail était une colonne de pictogrammes muets.** Le libellé n'existait
    // que dans l'arbre d'accessibilité : un lecteur d'écran savait lire le rail,
    // un œil devait deviner. La planche Desktop v0.6 demande l'étiquette depuis
    // qu'elle existe.
    await monterLaCoquille();
    await mesurer(1512);
    await replier();

    const ligne = await screen.findByTestId('ligne-journee');
    expect(etiquette('journee')).toBeNull();

    await fireEvent(ligne, 'pointerEnter');
    expect(etiquette('journee')).toHaveTextContent(en.onglets.journee);

    await fireEvent(ligne, 'pointerLeave');
    expect(etiquette('journee')).toBeNull();

    // Le clavier traverse le même rail : le survol seul déplacerait le manque
    // au lieu de le combler.
    await fireEvent(ligne, 'focus');
    expect(etiquette('journee')).toBeTruthy();
  });

  it('et l’étiquette ne se fait pas annoncer deux fois', async () => {
    // Le libellé est déjà sur la ligne, dans son `accessibilityLabel` : une
    // étiquette lisible par un lecteur d'écran ferait dire « Today, Today ».
    // C'est aussi pourquoi la chercher demande `includeHiddenElements`.
    await monterLaCoquille();
    await mesurer(1512);
    await replier();

    await fireEvent(await screen.findByTestId('ligne-journee'), 'pointerEnter');

    expect(etiquette('journee')).toBeTruthy();
    expect(screen.queryByTestId('etiquette-journee')).toBeNull();
  });

  it('et ne s’affiche jamais quand la barre est dépliée', async () => {
    // Le sens inverse : dépliée, le libellé est déjà sur la ligne. Une
    // étiquette par-dessus le doublerait et sortirait de la barre pour rien.
    await monterLaCoquille();
    await mesurer(1512);
    expect(aplati(screen.getByTestId('barre-laterale')).width).toBe(breakpoint.sidebarWidth);

    await fireEvent(await screen.findByTestId('ligne-journee'), 'pointerEnter');

    expect(etiquette('journee')).toBeNull();
  });

  it('le pointeur qui quitte une ligne n’efface pas l’étiquette d’une autre', async () => {
    // **Le geste réel est un glissement, pas deux clics.** Selon la vitesse, le
    // pointeur peut entrer dans la ligne suivante avant d'avoir quitté la
    // précédente ; effacer sans regarder laquelle referme alors l'étiquette qui
    // venait de s'ouvrir, et le rail clignote sous la main.
    await monterLaCoquille();
    await mesurer(1512);
    await replier();

    const premiere = await screen.findByTestId('ligne-journee');
    const seconde = await screen.findByTestId('ligne-publications');

    await fireEvent(premiere, 'pointerEnter');
    await fireEvent(seconde, 'pointerEnter');
    await fireEvent(premiere, 'pointerLeave');

    expect(etiquette('publications')).toBeTruthy();
  });

  it('l’étiquette se place sur la ligne survolée, pas sur la première', async () => {
    // Elle est posée **hors du défileur**, qui rognerait ce qui déborde à
    // droite : sa position vient donc de la disposition rapportée par la ligne.
    // La déduire du rang la ferait glisser au premier changement de densité.
    await monterLaCoquille();
    await mesurer(1512);
    await replier();

    const seconde = await screen.findByTestId('ligne-publications');
    await fireEvent(seconde, 'layout', {
      nativeEvent: { layout: { x: 0, y: 92, width: 48, height: 44 } },
    });
    await fireEvent(seconde, 'pointerEnter');

    expect(aplati(etiquette('publications')!).top).toBe(92);
  });

  it('porte le nom du commerce sous la marque', async () => {
    // Le contexte de la session : la barre latérale porte ce que la barre du
    // bas ne pouvait pas.
    await monterLaCoquille();
    await mesurer(1512);

    await waitFor(() => expect(screen.getByText('Ocean Beauty Studio')).toBeTruthy());
  });
});
