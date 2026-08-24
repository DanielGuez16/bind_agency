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
import { readFileSync } from 'fs';
import { join } from 'path';
import type { ReactNode } from 'react';

import { ApiProvider, type CollaborationStatus } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { ReglagesScreen } from '../src/screens/ReglagesScreen';
import { SessionProvider, themeDuRole, useSession, type Utilisateur } from '../src/session';
import { compterOuRien, CONTREPARTIES_EN_COURS, PAGE } from '../src/screens/reglages/suppression';
import { couleurs, ThemeProvider } from '../src/theme';

const UTILISATEUR: Utilisateur = {
  id: 'u1',
  email: 'rebecca@bind.example',
  role: 'creator',
  status: 'active',
  locale: 'en',
  email_verified_at: '2026-08-01T10:00:00Z',
  favoris_me_previennent: true,
  deletion_effective_at: null,
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

/**
 * Un serveur simulé, route par route, avec `/me` par défaut.
 *
 * `/me` est relu après chaque geste : les tests qui font avancer l'état le
 * changent en cours de route, comme le vrai serveur.
 */
function serveurDe(
  table: Record<string, (init?: RequestInit) => { status: number; corps: unknown }> = {},
): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    const chemin = String(url);
    const trouve = Object.entries(table).find(([fragment]) => chemin.includes(fragment));
    if (trouve) {
      const { status, corps } = trouve[1](init);
      return { ok: status >= 200 && status < 300, status, json: async () => corps } as Response;
    }
    // **La vérification du mot de passe passe par la connexion.** La
    // suppression ne prend pas de corps ; c'est la seule vérification honnête
    // disponible, et le décor doit donc la servir.
    if (chemin.includes('/auth/login')) {
      const corps = JSON.parse(String(init?.body ?? '{}'));
      return corps.password === MOT_DE_PASSE
        ? ({ ok: true, status: 200, json: async () => ({ access_token: 'a2', refresh_token: 'r2' }) } as Response)
        : ({ ok: false, status: 401, json: async () => ({ detail: 'invalid_credentials' }) } as Response);
    }
    if (chemin.includes('/me')) {
      return { ok: true, status: 200, json: async () => moi } as Response;
    }
    throw new TypeError(`route non simulée : ${chemin}`);
  }) as unknown as typeof fetch;
}

const MOT_DE_PASSE = 'tourbillon-cactus-91-vermeil';

/**
 * Ouvre la confirmation et la remplit.
 *
 * **Le geste n'est plus un appui.** La campagne dit qu'on craint d'appuyer sans
 * le vouloir, pas de ne pas pouvoir revenir : retaper son adresse et son mot de
 * passe ne se fait pas par accident, et c'est ce que ces trois lignes coûtent
 * au test comme à la lectrice.
 */
async function armerLaSuppression(motDePasse: string = MOT_DE_PASSE) {
  if (screen.queryByTestId('ouvrir-la-suppression')) {
    await fireEvent.press(screen.getByTestId('ouvrir-la-suppression'));
  }
  await fireEvent.changeText(screen.getByTestId('suppression-identifiant'), UTILISATEUR.email ?? '');
  await fireEvent.changeText(screen.getByTestId('suppression-mot-de-passe'), motDePasse);
}

/** Une réservation réduite à ce que le comptage lit : le statut de sa contrepartie. */
function reservationAvec(status: CollaborationStatus) {
  return {
    booking_id: `b-${status}`,
    contrepartie: { collaboration_id: `c-${status}`, status, deadline_at: '2026-09-01T12:00:00Z', attempts_count: 1, needs_human_review: false },
  };
}

/** Le compte tel que le serveur le rend, mutable au fil d'un test. */
let moi: Utilisateur = UTILISATEUR;

beforeEach(() => {
  moi = UTILISATEUR;
});

function Sous({ children }: { children: ReactNode }) {
  const session = useSession();
  const role = session.etat === 'connecte' ? session.utilisateur.role : 'creator';
  return (
    <ThemeProvider role={themeDuRole(role)}>
      <ApiProvider client={session.client}>{children}</ApiProvider>
    </ThemeProvider>
  );
}

/** L'écran monté comme dans l'application : session, langue, thème du rôle. */
async function poser(fetchImpl: typeof fetch = serveurDe()) {
  await render(
    <I18nProvider initialLocale="en">
      <SessionProvider baseUrl="https://api.test" coffre={coffreDeTest()} fetchImpl={fetchImpl}>
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

    // **Le cramoisi a quitté le bloc pour le bouton.** Le pavé encadré et
    // teinté attirait la main autant qu'il l'avertissait, et la campagne dit
    // que le risque est d'appuyer sans le vouloir. La nature de la décision se
    // porte maintenant là où on appuie, et seulement une fois la confirmation
    // ouverte.
    await armerLaSuppression();
    expect(styleAplati(screen.getByTestId('supprimer-mon-compte'))).toMatchObject({});
    expect(JSON.stringify(styleAplati(screen.getByTestId('supprimer-mon-compte')))).toContain(
      cramoisi,
    );

    // La déconnexion ne la porte pas — nulle part dans ses styles. Chercher
    // seulement `borderColor` laisserait passer un fond ou un texte cramoisi,
    // qui produirait exactement les « boutons colorés pour rien » de la revue.
    const style = styleAplati(screen.getByTestId('se-deconnecter'));
    expect(Object.values(style)).not.toContain(cramoisi);
    expect(Object.values(style)).not.toContain(couleurs['status.danger.surface']);
  });

  it('ouvre le délai, et bascule sur l’échéance et le retour', async () => {
    const dans30Jours = '2026-09-19T12:00:00Z';
    let demandes = 0;

    await poser(
      serveurDe({
        '/me/deletion': () => {
          demandes += 1;
          moi = { ...UTILISATEUR, deletion_effective_at: dans30Jours };
          return { status: 202, corps: moi };
        },
      }),
    );

    await armerLaSuppression();
    await fireEvent.press(screen.getByTestId('supprimer-mon-compte'));

    // Le bouton de suppression cède la place au retour : le bloc n'est plus
    // une proposition, il est un état du compte.
    await waitFor(() => expect(screen.getByTestId('annuler-la-suppression')).toBeTruthy());
    expect(demandes).toBe(1);
    expect(screen.queryByTestId('supprimer-mon-compte')).toBeNull();

    // Et l'échéance est datée. Sans elle, « éliminación en curso » ne dit pas
    // combien de temps il reste pour changer d'avis.
    expect(screen.getByTestId('suppression-consequences')).toHaveTextContent(/Sep 19, 2026/);
  });

  it('annule la demande et redonne le bouton', async () => {
    moi = { ...UTILISATEUR, deletion_effective_at: '2026-09-19T12:00:00Z' };
    let methode: string | undefined;

    await poser(
      serveurDe({
        '/me/deletion': (init) => {
          methode = init?.method;
          moi = UTILISATEUR;
          return { status: 200, corps: moi };
        },
      }),
    );

    await waitFor(() => expect(screen.getByTestId('annuler-la-suppression')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('annuler-la-suppression'));

    await waitFor(() => expect(screen.getByTestId('ouvrir-la-suppression')).toBeTruthy());
    // `DELETE` sur la demande, pas un `POST` sur un chemin d'annulation : ce
    // qu'on retire est la ressource créée par le geste précédent.
    expect(methode).toBe('DELETE');
  });

  it('le bouton n’existe qu’une fois les deux champs justes', async () => {
    // **Le sens inverse, et c'est lui qui porte la protection.** Sans cette
    // moitié, un bouton rendu dès l'ouverture passerait tous les tests du
    // dessus — c'est-à-dire exactement l'appui accidentel qu'on vient de
    // retirer. Vérifié par mutation : sans elle, la garde survivait.
    await poser();
    await waitFor(() => expect(screen.getByTestId('ouvrir-la-suppression')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('ouvrir-la-suppression'));
    expect(screen.queryByTestId('supprimer-mon-compte')).toBeNull();

    // L'adresse seule ne suffit pas.
    await fireEvent.changeText(
      screen.getByTestId('suppression-identifiant'),
      UTILISATEUR.email ?? '',
    );
    expect(screen.queryByTestId('supprimer-mon-compte')).toBeNull();

    // Une autre adresse non plus, même avec le mot de passe.
    await fireEvent.changeText(screen.getByTestId('suppression-identifiant'), 'autre@bind.example');
    await fireEvent.changeText(screen.getByTestId('suppression-mot-de-passe'), MOT_DE_PASSE);
    expect(screen.queryByTestId('supprimer-mon-compte')).toBeNull();

    await armerLaSuppression();
    expect(screen.getByTestId('supprimer-mon-compte')).toBeTruthy();
  });

  it('et un mot de passe faux le dit, sans rien supprimer', async () => {
    let demandes = 0;
    await poser(serveurDe({ '/me/deletion': () => { demandes += 1; return { status: 202, corps: moi }; } }));

    await armerLaSuppression('pas-le-bon-mot-de-passe');
    await fireEvent.press(screen.getByTestId('supprimer-mon-compte'));

    await waitFor(() =>
      expect(screen.getByTestId('suppression-echec')).toHaveTextContent(
        en.reglages.supprimerMotDePasseFaux,
      ),
    );
    expect(demandes).toBe(0);
  });

  it('dit combien de contreparties bloquent, en les comptant lui-même', async () => {
    // Le 409 porte le code seul. Trois réservations dont **deux** engagent
    // encore : une approuvée ne compte pas, et c'est tout l'intérêt du test —
    // un comptage qui prendrait la liste entière rendrait trois.
    await poser(
      serveurDe({
        '/me/deletion': () => ({
          status: 409,
          // `detail` est une chaîne, pas un objet : c'est la forme que
          // `errorCodeFromResponse` lit, et un objet y vaut « pas de code ».
          corps: { detail: 'deletion_blocked_by_collaboration' },
        }),
        '/me/bookings': () => ({
          status: 200,
          corps: {
            items: [
              reservationAvec('pending'),
              reservationAvec('resubmit_requested'),
              reservationAvec('approved'),
            ],
            compteurs: {},
          },
        }),
      }),
    );

    await armerLaSuppression();

    await fireEvent.press(screen.getByTestId('supprimer-mon-compte'));

    await waitFor(() =>
      expect(screen.getByTestId('suppression-echec')).toHaveTextContent(
        en.reglages.supprimerBloque.replace('{{count}}', '2'),
      ),
    );

    // Et le bloc reste une proposition : rien n'a été ouvert.
    expect(screen.getByTestId('supprimer-mon-compte')).toBeTruthy();
    expect(screen.queryByTestId('annuler-la-suppression')).toBeNull();
  });

  it('retombe sur la phrase du catalogue quand il ne peut pas compter', async () => {
    // La liste ne répond pas : annoncer « zéro contrepartie » sur un refus qui
    // en invoque une serait pire que la phrase générique.
    await poser(
      serveurDe({
        '/me/deletion': () => ({
          status: 409,
          // `detail` est une chaîne, pas un objet : c'est la forme que
          // `errorCodeFromResponse` lit, et un objet y vaut « pas de code ».
          corps: { detail: 'deletion_blocked_by_collaboration' },
        }),
        '/me/bookings': () => ({ status: 500, corps: { detail: 'internal_error' } }),
      }),
    );

    await armerLaSuppression();

    await fireEvent.press(screen.getByTestId('supprimer-mon-compte'));

    await waitFor(() =>
      expect(screen.getByTestId('suppression-echec')).toHaveTextContent(
        en.errors.deletion_blocked_by_collaboration,
      ),
    );
  });

  it('n’offre aucune bascule de thème', async () => {
    await poser();

    // La v1.0 l'a retirée : un seul jeu de couleurs, et `theme.$userOverrideRetire`
    // dans les jetons en garde la trace. Un interrupteur qui ne commande rien
    // fait douter des réglages voisins — c'est le reproche de la revue, et le
    // remettre « pour la symétrie » le recréerait.
    // **Ce qu'on interdit est la bascule de *thème*, pas tout interrupteur.**
    // La première forme cherchait `switch` tout court : elle attrapait donc les
    // notifications de cet appareil au même titre qu'un réglage de couleurs,
    // alors que l'un commande quelque chose et l'autre ne commandait rien.
    // Une garde qui confond les deux force à l'exempter, et une garde exemptée
    // ne garde plus rien.
    const interrupteurs = screen.queryAllByRole('switch');
    for (const interrupteur of interrupteurs) {
      expect(interrupteur.props.accessibilityLabel).not.toMatch(/theme|thème|dark|light/i);
    }
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

/**
 * Le comptage des contreparties tient une liste que le serveur tient aussi.
 *
 * **Deux langages, deux fichiers, une seule vérité.** Le 409 ne porte pas le
 * nombre — c'est une décision assumée côté serveur — donc l'application compte.
 * Compter veut dire recopier `account_deletion.EN_COURS`, et une copie dérive :
 * le jour où un statut s'ajoute là-bas, l'écran annoncerait « une contrepartie »
 * quand le serveur en refuse deux, et le refus deviendrait incompréhensible.
 *
 * La garde lit la constante Python plutôt que de la redire : redire une liste
 * dans un test, c'est en tenir trois au lieu de deux.
 */
describe('les statuts qui engagent, des deux côtés', () => {
  it('la liste de l’app est celle du serveur', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', 'api', 'app', 'services', 'account_deletion.py'),
      'utf8',
    );

    // Le bloc `EN_COURS = frozenset({ … })`, et lui seul : `CollaborationStatus`
    // apparaît ailleurs dans le fichier, et prendre tout le fichier ferait
    // passer la garde pour n'importe quelle liste.
    const bloc = /EN_COURS\s*=\s*frozenset\(\s*\{([\s\S]*?)\}\s*\)/.exec(source);
    expect(bloc).not.toBeNull();

    const duServeur = [...bloc![1].matchAll(/CollaborationStatus\.([A-Z_]+)/g)]
      .map((m) => m[1].toLowerCase())
      .sort();

    expect(duServeur.length).toBeGreaterThan(0);
    expect([...CONTREPARTIES_EN_COURS].sort()).toEqual(duServeur);
  });
});

describe('compter, ou se taire', () => {
  const enCours = () => reservationAvec('pending');

  it('compte les contreparties qui engagent encore, et elles seules', () => {
    expect(
      compterOuRien([
        reservationAvec('pending'),
        reservationAvec('under_review'),
        reservationAvec('approved'),
        reservationAvec('unfulfilled'),
        { booking_id: 'sans', contrepartie: null },
      ] as never),
    ).toBe(2);
  });

  it('se tait dès que la page est pleine, car elle peut en cacher', () => {
    // Le cas où les deux implémentations divergent : à `PAGE - 1` on répond un
    // nombre, à `PAGE` on refuse. Sans ce couple, une version qui compte
    // toujours rendrait la même chose que la bonne sur toute liste courte.
    expect(compterOuRien(Array.from({ length: PAGE - 1 }, enCours) as never)).toBe(PAGE - 1);
    expect(compterOuRien(Array.from({ length: PAGE }, enCours) as never)).toBeNull();
  });
});
