/**
 * Ce que la file d'arbitrage apprend sur nous, et où on le lit.
 *
 * **La route existait, servie, et personne ne la lisait.**
 * `/admin/collaborations/motifs-qui-reviennent` rend `{motif, dossiers,
 * dossiers_touches}` depuis qu'elle a été écrite. Chaque « fermer sans faute »
 * est le constat qu'une demande n'a pas été transmise ; cette route dit
 * lesquelles reviennent, et rien à l'écran ne le disait.
 *
 * **Ce que ces tests éprouvent d'abord est le rapport entre les deux nombres**,
 * parce que c'est la seule chose ici qui puisse être fausse plutôt que laide.
 * Un décor où `dossiers` et `dossiers_touches` sont égaux ne distingue pas un
 * écran qui rend les deux d'un écran qui rend deux fois le même — c'est
 * exactement le décor qu'on écrirait sans y penser, et il ne prouverait rien.
 * Ils divergent donc partout ici.
 */
import { render, screen, waitFor } from '@testing-library/react-native';

// La file en tableau n'existe qu'en grand écran, et c'est le gabarit où
// l'arbitrage se travaille. Le pied se lit sous la file dans les deux.
jest.mock('../src/shell/gabarit', () => ({
  ...jest.requireActual('../src/shell/gabarit'),
  useGabarit: () => ({
    largeur: 1512,
    large: true,
    place: (besoin: number) =>
      (require('../src/shell/placeDisponible') as typeof import('../src/shell/placeDisponible'))
        .placeDisponible(1512, besoin),
  }),
}));

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { ArbitrageScreen } from '../src/screens/ArbitrageScreen';
import { ThemeProvider } from '../src/theme';

const DANS_DEUX_JOURS = new Date(Date.now() + 48 * 3_600_000).toISOString();

function dossier(id: string) {
  return {
    collaboration_id: id,
    booking_id: `b-${id}`,
    status: 'under_review',
    required_format: 'post',
    required_mention: '@casabruma',
    required_geotag: true,
    deadline_at: DANS_DEUX_JOURS,
    attempts_count: 3,
    needs_human_review: true,
    created_at: DANS_DEUX_JOURS,
    business_id: `biz-${id}`,
    business_name: 'Casa Bruma Spa',
    creator_id: `c-${id}`,
    creator_first_name: 'Sofia',
    creator_last_name: null,
    creator_handle: 'sofia.rz',
    creator_partie: false,
    platform: 'instagram',
    item_name: 'Signature facial',
    dernier_motif: 'missing_location',
    tentatives: [],
    repetitions_du_dernier_motif: 3,
    meme_motif_repete: true,
    derniere_soumission: null,
  };
}

/**
 * Le décor répond **par chemin**, et l'agrégat peut tomber tout seul.
 *
 * Un décor qui rend la même forme à toutes les routes est le défaut qui s'est
 * produit cinq fois sur ce dépôt : la file servie à l'agrégat lui donnerait des
 * lignes sans motif, affichées sans que rien ne tombe.
 */
function monter({
  lignes = [dossier('a1b2c3d4-0000')],
  motifs = [] as unknown[],
  motifsEchouent = false,
}: {
  lignes?: unknown[];
  motifs?: unknown[];
  motifsEchouent?: boolean;
} = {}) {
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: (async (url: unknown) => {
      if (String(url).includes('motifs-qui-reviennent')) {
        if (motifsEchouent) {
          return {
            ok: false,
            status: 500,
            json: async () => ({ detail: 'internal_error' }),
          } as Response;
        }
        return { ok: true, status: 200, json: async () => motifs } as Response;
      }
      return { ok: true, status: 200, json: async () => lignes } as Response;
    }) as unknown as typeof fetch,
  });

  return render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="admin">
        <ApiProvider client={api}>
          <ArbitrageScreen />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

/**
 * Les `testID` de l'arbre rendu, dans l'ordre où ils y sont.
 *
 * **Et non `JSON.stringify` de l'arbre**, qui a été la première forme écrite
 * ici : l'arbre porte des contextes React, donc des cycles, et la sérialisation
 * lève avant d'avoir rien comparé. Le parcours, lui, ne regarde que ce qu'on
 * lui demande.
 */
function ordreDesTestID(noeud: unknown, trouves: string[] = []): string[] {
  if (noeud === null || typeof noeud !== 'object') return trouves;
  if (Array.isArray(noeud)) {
    for (const enfant of noeud) ordreDesTestID(enfant, trouves);
    return trouves;
  }
  const element = noeud as { props?: Record<string, unknown>; children?: unknown };
  const cle = element.props?.testID;
  if (typeof cle === 'string') trouves.push(cle);
  ordreDesTestID(element.children, trouves);
  return trouves;
}

const M = (motif: string, dossiers: number, dossiers_touches: number) => ({
  motif,
  dossiers,
  dossiers_touches,
});

describe('les motifs qui reviennent', () => {
  it('rend les deux nombres, et ce sont bien deux nombres différents', async () => {
    // **Le rapport est l'argument.** « La mention manque » sur cent dossiers
    // dont deux bouclent est un motif difficile ; sur douze dont dix, c'est un
    // motif incompréhensible, et ce n'est pas le même travail qui l'éteint. Un
    // écran qui n'afficherait que `dossiers` passerait un décor où les deux
    // sont égaux, et ne dirait rien de ce qui décide.
    await monter({ motifs: [M('missing_location', 10, 12)] });

    await waitFor(() => expect(screen.getByTestId('motifs-qui-reviennent')).toBeTruthy());
    const ligne = screen.getByTestId('motif-qui-revient-missing_location');
    expect(ligne).toHaveTextContent(/10 looping/);
    expect(ligne).toHaveTextContent(/12 raised/);
  });

  it('nomme le motif dans le vocabulaire fermé, pas par son code', async () => {
    // Le même vocabulaire des deux côtés : l'arbitre lit ce que le salon a
    // choisi. Afficher `missing_location` ferait lire du code à l'écran.
    await monter({ motifs: [M('missing_location', 10, 12)] });

    await waitFor(() => expect(screen.getByTestId('motifs-qui-reviennent')).toBeTruthy());
    expect(screen.getByTestId('motif-qui-revient-missing_location')).toHaveTextContent(
      new RegExp(en.commerce.motifLieu),
    );
  });

  it('garde l’ordre du serveur, et ne retrie pas sur le rapport', async () => {
    // **Le cas où les deux ordres divergent**, et c'est celui qu'on écrit en
    // premier. Le serveur trie sur le nombre de dossiers qui bouclent ; un
    // écran qui retrierait sur le rapport ferait remonter un motif vu deux
    // fois — 2 sur 2 fait 100 %, et c'est du bruit, pas un signal.
    await monter({
      motifs: [M('missing_location', 9, 100), M('wrong_format', 2, 2)],
    });

    await waitFor(() => expect(screen.getByTestId('motifs-qui-reviennent')).toBeTruthy());
    const ordre = ordreDesTestID(screen.toJSON());
    expect(ordre.indexOf('motif-qui-revient-missing_location')).toBeGreaterThan(-1);
    expect(ordre.indexOf('motif-qui-revient-missing_location')).toBeLessThan(
      ordre.indexOf('motif-qui-revient-wrong_format'),
    );
  });

  it('se lit au pied de la file, pas au-dessus', async () => {
    // La question ne se pose qu'après le travail. En tête, elle repousserait la
    // file — c'est-à-dire ce pour quoi on ouvre l'écran — et se lirait vingt
    // fois par jour sans jamais rien déclencher.
    //
    // La position se lit sur l'arbre rendu : c'est grossier, et cela suffit à
    // attraper la seule erreur qui compte ici, le bloc monté avant la liste.
    await monter({ motifs: [M('missing_location', 10, 12)] });

    await waitFor(() => expect(screen.getByTestId('motifs-qui-reviennent')).toBeTruthy());
    const ordre = ordreDesTestID(screen.toJSON());
    expect(ordre.indexOf('ligne-a1b2c3d4-0000')).toBeGreaterThan(-1);
    expect(ordre.indexOf('ligne-a1b2c3d4-0000')).toBeLessThan(
      ordre.indexOf('motifs-qui-reviennent'),
    );
  });

  it('paraît aussi sur la file vide, qui est le moment où il se lit le mieux', async () => {
    // Plus rien à trancher, et la question devient « pourquoi ces trois-là
    // reviennent-elles ». Un bloc rendu seulement dans le corps disparaîtrait
    // exactement là.
    await monter({ lignes: [], motifs: [M('missing_location', 10, 12)] });

    await waitFor(() => expect(screen.getByTestId('arbitrage-vide')).toBeTruthy());
    expect(screen.getByTestId('motifs-qui-reviennent')).toBeTruthy();
  });

  it('et ne dit rien du tout quand aucun motif ne boucle', async () => {
    // Aucun motif qui boucle est une bonne nouvelle, et la file vide la dit
    // déjà. Un cadre qui l'annonce ferait deux blocs pour un seul silence.
    await monter({ lignes: [], motifs: [] });

    await waitFor(() => expect(screen.getByTestId('arbitrage-vide')).toBeTruthy());
    expect(screen.queryByTestId('motifs-qui-reviennent')).toBeNull();
  });

  it('un agrégat qui tombe ne cache pas la file', async () => {
    // L'écran n'existe que pour débloquer des dossiers arrêtés : si personne ne
    // tranche, le créateur attend et le commerce attend. Mettre l'écran entier
    // en erreur pour une statistique de pied de page laisserait quinze dossiers
    // bloqués.
    await monter({ motifsEchouent: true });

    await waitFor(() => expect(screen.getByTestId('ligne-a1b2c3d4-0000')).toBeTruthy());
    expect(screen.queryByTestId('motifs-qui-reviennent')).toBeNull();
    expect(screen.queryByTestId('etat-erreur')).toBeNull();
  });
});
