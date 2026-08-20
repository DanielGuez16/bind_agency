/**
 * Ce qu'une reprise reproche, et ce qu'elle ne reproche pas.
 *
 * **L'écran renvoyait recommencer sans dire quoi corriger.** Le motif existait
 * depuis toujours — code fermé, choisi par le commerce, écrit au journal — et
 * il n'arrivait pas jusqu'au seul écran qui doit le porter.
 *
 * **Ce que ces tests éprouvent d'abord est la phrase « ce qui allait »**, parce
 * que c'est elle qui peut mentir. Nommer le manque ne se trompe pas : il est
 * servi. Rassurer, si : une implémentation qui rassurerait toujours sur la
 * mention, ou qui rassurerait sur une exigence que le contrat n'a jamais posée,
 * afficherait « la mention y était » à quelqu'un à qui on n'a jamais demandé de
 * mention. Chaque cas ci-dessous est choisi pour **diverger** de l'une de ces
 * implémentations-là.
 */
import { render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider, type Collaboration } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { PreuveScreen } from '../src/screens/PreuveScreen';
import { lireLaReprise } from '../src/screens/preuve/reprise';
import { ThemeProvider } from '../src/theme';

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));

/** Calculée : une date en dur finit par passer, et le décor affirmerait alors
 * qu'une échéance périmée est à venir. Ce dépôt a déjà payé ce défaut. */
const ECHEANCE = new Date(Date.now() + 40 * 3_600_000).toISOString();

const REPRISE = {
  id: 'k1',
  booking_id: 'b1',
  tier_id: 't1',
  required_format: 'story',
  required_mention: '@velanailstudio',
  required_geotag: true,
  deadline_at: ECHEANCE,
  secondes_avant_echeance: 40 * 3600,
  status: 'resubmit_requested',
  attempts_count: 1,
  needs_human_review: false,
  approved_at: null,
  dernier_motif: 'missing_location',
  proofs: [],
} as unknown as Collaboration;

async function monter(contrepartie: Collaboration = REPRISE) {
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: (async () =>
      ({ ok: true, status: 200, json: async () => contrepartie }) as Response) as never,
  });

  return render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={api}>
          <PreuveScreen collaborationId="k1" />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('ce qui allait se déduit du contrat, jamais d’un réflexe', () => {
  const CONTRAT_COMPLET = { required_mention: '@velanailstudio', required_geotag: true };

  it('le lieu manque : la mention est intacte, et pas le lieu', () => {
    expect(lireLaReprise('missing_location', CONTRAT_COMPLET)).toEqual({
      motif: 'missing_location',
      intactes: ['mention'],
    });
  });

  it('la mention manque : c’est le lieu qui est intact, pas la mention', () => {
    // **Le cas qui diverge de « rassure toujours sur la mention ».** C'est la
    // phrase de la planche, et une implémentation qui la recopierait passerait
    // le test précédent sans rien avoir compris.
    expect(lireLaReprise('missing_mention', CONTRAT_COMPLET)).toEqual({
      motif: 'missing_mention',
      intactes: ['lieu'],
    });
  });

  it('une exigence jamais posée n’est pas « intacte »', () => {
    // **Le cas qui diverge de « rassure sur tout ce que le motif ne vise
    // pas ».** Sans mention exigée, « la mention y était » invente une
    // conformité sur une exigence qui n'existe pas — et le fait exactement au
    // moment où la créatrice cherche ce qu'elle a raté.
    expect(lireLaReprise('missing_location', { required_mention: null, required_geotag: true }))
      .toEqual({ motif: 'missing_location', intactes: [] });
  });

  it('un motif qui ne vise ni l’un ni l’autre les laisse tous deux intacts', () => {
    expect(lireLaReprise('wrong_format', CONTRAT_COMPLET)).toEqual({
      motif: 'wrong_format',
      intactes: ['mention', 'lieu'],
    });
  });

  it('une phrase d’avant le vocabulaire fermé ne se déduit pas', () => {
    // Elle se rend telle quelle — la taire vaudrait moins — mais rien ne s'en
    // déduit : le code ne sait pas ce qu'elle vise.
    expect(lireLaReprise('Le cadrage ne va pas', CONTRAT_COMPLET)).toEqual({
      motif: null,
      intactes: [],
    });
  });

  it('et sans motif, il n’y a pas de reprise à lire', () => {
    expect(lireLaReprise(null, CONTRAT_COMPLET)).toBeNull();
    // Un champ absent, sur une route qui ne le porterait pas encore : `undefined`
    // n'est pas `null`, et une garde écrite en `=== null` aurait rendu
    // « undefined » en guise de motif.
    expect(lireLaReprise(undefined as unknown as null, CONTRAT_COMPLET)).toBeNull();
  });
});

describe('la carte le dit sur l’écran', () => {
  it('nomme le manque en toutes lettres, jamais par son code', async () => {
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId('reprise-motif')).toBeTruthy());

    expect(screen.getByText(en.parcours.repriseManqueLieu)).toBeTruthy();
    // Le code lui-même n'apparaît nulle part : c'est un identifiant d'API, et
    // il ne se traduit pas.
    expect(screen.queryByText('missing_location')).toBeNull();
    await vue.unmount();
  });

  it('dit aussi ce qui allait, et le geste qui reste', async () => {
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId('reprise-suite')).toBeTruthy());

    // **En expression régulière, jamais en chaîne.** Sur une chaîne,
    // `toHaveTextContent` compare le contenu **entier** : les deux assertions
    // auraient exigé que la phrase ne soit que l'une ou que l'autre, et
    // seraient tombées sur la phrase juste.
    const suite = screen.getByTestId('reprise-suite');
    expect(suite).toHaveTextContent(new RegExp(en.parcours.repriseIntacteMention));
    expect(suite).toHaveTextContent(new RegExp(en.parcours.repriseActionLieu));
    await vue.unmount();
  });

  it('et se tait sur ce qui allait quand rien n’était exigé d’autre', async () => {
    const vue = await monter({
      ...REPRISE,
      required_mention: null,
    } as unknown as Collaboration);
    await waitFor(() => expect(screen.getByTestId('reprise-motif')).toBeTruthy());

    // La carte reste, le geste reste ; seule la phrase de réassurance part.
    const suite = screen.getByTestId('reprise-suite');
    expect(suite).toHaveTextContent(new RegExp(en.parcours.repriseActionLieu));
    expect(suite).not.toHaveTextContent(new RegExp(en.parcours.repriseIntacteMention));
    await vue.unmount();
  });

  it('n’a pas la couleur d’une alerte', async () => {
    // **La planche est explicite** : un refus rouvre avec une nouvelle
    // échéance, il ne clôt pas. Une carte rouge ferait lire un dossier perdu.
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId('reprise-motif')).toBeTruthy());

    const aplati = (style: unknown): Record<string, unknown> =>
      Array.isArray(style)
        ? Object.assign({}, ...style.map(aplati))
        : ((style ?? {}) as Record<string, unknown>);

    const fond = aplati(screen.getByTestId('reprise-motif').props.style).backgroundColor;
    const alerte = aplati(screen.getByTestId('reprise-manque').props.style).backgroundColor;
    // Le fond neutre du thème, et l'encart blanc par-dessus : deux surfaces
    // distinctes, dont aucune n'est une couleur d'état.
    expect(fond).not.toBe(alerte);
    expect(String(fond)).not.toMatch(/^#(E|F)[0-9A-F]{1,2}(3|4)/i);
    await vue.unmount();
  });

  it('ne s’affiche pas quand rien n’est redemandé', async () => {
    const vue = await monter({
      ...REPRISE,
      status: 'pending',
    } as unknown as Collaboration);
    await waitFor(() => expect(screen.getByTestId('contrat-de-la-preuve')).toBeTruthy());

    expect(screen.queryByTestId('reprise-motif')).toBeNull();
    await vue.unmount();
  });

  it('et la phrase générique reprend la main sur un dossier sans motif codé', async () => {
    // Le motif est obligatoire depuis que le vocabulaire est fermé ; une
    // reprise demandée avant ne le porte pas, et un écran muet vaudrait moins
    // que la phrase générique.
    const vue = await monter({
      ...REPRISE,
      dernier_motif: null,
    } as unknown as Collaboration);
    await waitFor(() => expect(screen.getByTestId('nouvelle-soumission')).toBeTruthy());

    expect(screen.queryByTestId('reprise-motif')).toBeNull();
    await vue.unmount();
  });
});
