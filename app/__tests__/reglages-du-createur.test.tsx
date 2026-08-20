/**
 * Les réglages du créateur : deux natures, un seul cramoisi.
 *
 * La revue a rendu trois reproches — « c'est moche, il y a trop de réglages,
 * les boutons sont colorés pour rien » — et les trois portent sur la même
 * chose : une colonne unique où une préférence sans conséquence et une
 * suppression définitive se présentaient au même poids, la couleur des boutons
 * tenant lieu de hiérarchie. Ce qui est éprouvé ici, ce sont les décisions
 * prises pour y répondre, pas le dessin qui en découle.
 *
 * Trois d'entre elles se perdraient en silence : la teinte reprise par un
 * second bouton, la bascule de thème remise « pour la symétrie », et le
 * diagnostic ramené au grand jour parce qu'il est plus commode de le trouver.
 * Chacune a sa garde.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { ReglagesScreen } from '../src/screens/ReglagesScreen';
import { SessionProvider, themeDuRole, useSession, type Utilisateur } from '../src/session';
import { couleurs, ThemeProvider } from '../src/theme';

const UTILISATEUR: Utilisateur = {
  id: 'u1',
  email: 'rebecca@bind.example',
  role: 'creator',
  status: 'active',
  locale: 'en',
  email_verified_at: '2026-08-01T10:00:00Z',
};

function coffreDeTest() {
  let contenu: { access_token: string; refresh_token: string } | null = {
    access_token: 'a',
    refresh_token: 'r',
  };
  return {
    lire: async () => contenu,
    ecrire: async (jetons: typeof contenu) => {
      contenu = jetons;
    },
  };
}

const serveur = (async (url: RequestInfo | URL) => {
  if (String(url).includes('/me')) {
    return { ok: true, status: 200, json: async () => UTILISATEUR } as Response;
  }
  throw new TypeError(`route non simulée : ${String(url)}`);
}) as unknown as typeof fetch;

function Sous({ children }: { children: ReactNode }) {
  const session = useSession();
  const role = session.etat === 'connecte' ? session.utilisateur.role : 'creator';
  return <ThemeProvider role={themeDuRole(role)}>{children}</ThemeProvider>;
}

/** L'écran monté comme dans l'application : session, langue, thème du rôle. */
async function poser() {
  await render(
    <I18nProvider initialLocale="en">
      <SessionProvider baseUrl="https://api.test" coffre={coffreDeTest()} fetchImpl={serveur}>
        <Sous>
          <ReglagesScreen />
        </Sous>
      </SessionProvider>
    </I18nProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('ecran-reglages')).toBeTruthy());
}

/** Les styles d'un nœud, aplatis — un tableau de styles est courant ici. */
function styleAplati(element: { props: { style?: unknown } }): Record<string, unknown> {
  const brut = element.props.style;
  const pile = Array.isArray(brut) ? brut.flat(Infinity) : [brut];
  return Object.assign({}, ...pile.filter(Boolean));
}

describe('les réglages du créateur', () => {
  it('sépare ce qu’on règle de ce qui met fin', async () => {
    await poser();

    // Les deux régions existent et sont distinctes. C'est la décision de
    // structure : une préférence qu'on change dix fois sans conséquence n'a
    // rien à faire dans la même pile qu'une sortie de l'application.
    expect(screen.getByTestId('preferences')).toBeTruthy();
    const partir = screen.getByTestId('partir');

    // Et la suppression est dans la seconde, pas dans la première. Le test
    // vaut par cette assertion : deux régions dont l'une contiendrait la
    // langue et la suppression n'aurait rien réglé.
    expect(partir).toContainElement(screen.getByTestId('bloc-suppression'));
    expect(partir).toContainElement(screen.getByTestId('se-deconnecter'));
    expect(screen.getByTestId('preferences')).not.toContainElement(
      screen.getByTestId('bloc-suppression'),
    );
  });

  it('ne teinte que la suppression, et la déconnexion reste neutre', async () => {
    await poser();

    const cramoisi = couleurs['status.danger.rule'];

    // Le bloc porte la nature de la décision.
    expect(styleAplati(screen.getByTestId('bloc-suppression')).borderColor).toBe(cramoisi);

    // La déconnexion ne la porte pas — nulle part dans ses styles. Chercher
    // seulement `borderColor` laisserait passer un fond ou un texte cramoisi,
    // qui produirait exactement les « boutons colorés pour rien » de la revue.
    const style = styleAplati(screen.getByTestId('se-deconnecter'));
    expect(Object.values(style)).not.toContain(cramoisi);
    expect(Object.values(style)).not.toContain(couleurs['status.danger.surface']);
  });

  it('propose la suppression sans la promettre : inactive, et elle dit pourquoi', async () => {
    await poser();

    const bouton = screen.getByTestId('supprimer-mon-compte');
    // La route n'existe pas encore. Un bouton qui appelle dans le vide serait
    // pire que pas de bouton : il rendrait 200 dans la tête de la lectrice.
    expect(bouton.props.accessibilityState?.disabled).toBe(true);

    // Et il ne laisse pas deviner ce qui le débloque — c'est la seule chose
    // qui autorise un bouton grisé plutôt que son retrait.
    expect(screen.getByTestId('suppression-indisponible')).toHaveTextContent(
      en.reglages.supprimerBientot,
    );

    // Les conséquences sont lisibles avant la décision, pas après. Le texte
    // exact, sinon un libellé vidé de ses trois règles passerait.
    expect(screen.getByTestId('suppression-consequences')).toHaveTextContent(
      en.reglages.supprimerCorps,
    );
  });

  it('n’offre aucune bascule de thème', async () => {
    await poser();

    // La v1.0 l'a retirée : un seul jeu de couleurs, et `theme.$userOverrideRetire`
    // dans les jetons en garde la trace. Un interrupteur qui ne commande rien
    // fait douter des réglages voisins — c'est le reproche de la revue, et le
    // remettre « pour la symétrie » le recréerait.
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByText(/theme|thème|dark|light/i)).toBeNull();
  });

  it('range le diagnostic derrière un appui long', async () => {
    await poser();

    // Absent au repos : c'est un outil de développement, et il occupait plus
    // de place que les préférences qu'une créatrice vient changer.
    expect(screen.queryByTestId('diagnostic')).toBeNull();

    await fireEvent(screen.getByTestId('ligne-stockage'), 'longPress');
    await waitFor(() => expect(screen.getByTestId('diagnostic')).toBeTruthy());

    // Un appui simple ne l'ouvre pas : sans quoi le geste serait découvrable
    // par accident, et le range-t-on encore ?
    await fireEvent(screen.getByTestId('ligne-stockage'), 'longPress');
    await waitFor(() => expect(screen.queryByTestId('diagnostic')).toBeNull());
    await fireEvent.press(screen.getByTestId('ligne-stockage'));
    expect(screen.queryByTestId('diagnostic')).toBeNull();
  });
});
