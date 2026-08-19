/**
 * Le contrat de la preuve : ce que le commerce attend, là où l'on publie.
 *
 * **Ces lignes descendent de la liste des réservations.** Le partage de la
 * planche v3 est que la liste sert à décider d'agir et le détail à agir : le
 * format, la mention et le lieu ne servent qu'au moment où l'on compose la
 * publication. Une autre session les retire de sa liste quand ceux-ci passent.
 *
 * **La copie est la correction la moins visible et probablement la plus
 * utile.** Le premier motif de reprise du produit est une mention manquante ou
 * mal écrite ; un bouton de copie retire la faute de frappe du chemin.
 */
import * as Presse from 'expo-clipboard';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider, type Collaboration } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { PreuveScreen } from '../src/screens/PreuveScreen';
import { ThemeProvider } from '../src/theme';

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));

/**
 * **L'échéance est calculée, jamais figée.** Une date en dur finit dans le
 * passé, et le test affirmerait alors qu'une contrepartie périmée s'annonce
 * comme à venir. Ce dépôt a déjà payé ce défaut sur un `valid_until`.
 */
const ECHEANCE = new Date(Date.now() + 40 * 3_600_000).toISOString();

const CONTREPARTIE = {
  id: 'k1',
  booking_id: 'b1',
  tier_id: 't1',
  required_format: 'story',
  required_mention: '@velanailstudio',
  required_geotag: true,
  deadline_at: ECHEANCE,
  status: 'pending',
  attempts_count: 0,
  needs_human_review: false,
  approved_at: null,
  proofs: [],
} as unknown as Collaboration;

async function monter(contrepartie: Collaboration = CONTREPARTIE) {
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

describe('le contrat dit ce qu’on doit publier', () => {
  it('porte le format, la mention et l’échéance', async () => {
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId('contrat-de-la-preuve')).toBeTruthy());

    expect(screen.getByTestId('contrat-format')).toBeTruthy();
    // Sur la valeur elle-même : `toHaveTextContent` ne descend pas dans les
    // enfants d'une vue, et la ligne est une vue qui porte deux nœuds.
    expect(screen.getByText('@velanailstudio')).toBeTruthy();
    expect(screen.getByTestId('contrat-echeance')).toBeTruthy();
    await vue.unmount();
  });

  it('écrit l’échéance en jour nommé, jamais en date de machine', async () => {
    // **Elle s'écrivait sur `UTC`, c'est-à-dire le fuseau de personne** — quatre
    // heures d'écart à Miami, sur la seule date que la créatrice doit tenir.
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId('contrat-echeance')).toBeTruthy());

    const ligne = screen.getByTestId('contrat-echeance');
    expect(ligne).not.toHaveTextContent(/\d{2}\/\d{2}\/\d{4}/);
    expect(ligne).toHaveTextContent(new RegExp(en.parcours.preuveEcheanceAvant.trim()));
    await vue.unmount();
  });

  it('et le badge à trois barres a quitté cet écran', async () => {
    // La même correction que sur la fiche : le palier codé cède la place à la
    // phrase. Le garder à côté aurait donné deux fois la même information,
    // dont une illisible.
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId('contrat-de-la-preuve')).toBeTruthy());

    expect(screen.queryByTestId('badge-de-palier')).toBeNull();
    expect(screen.queryByText('STORY')).toBeNull();
    await vue.unmount();
  });
});

describe('la mention se copie', () => {
  it('met la valeur exacte dans le presse-papier', async () => {
    // **La valeur, pas la phrase qui l'entoure.** Copier « Mention
    // @velanailstudio » collerait le mot « Mention » dans la légende.
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId('contrat-mention-copier')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('contrat-mention-copier'));

    expect(Presse.setStringAsync).toHaveBeenCalledWith('@velanailstudio');
    await vue.unmount();
  });

  it('et le bouton dit que c’est fait', async () => {
    // Une copie ne produit rien de visible : un bouton qui ne change pas laisse
    // appuyer trois fois sans savoir si ça a marché.
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId('contrat-mention-copier')).toBeTruthy());
    expect(screen.getByTestId('contrat-mention-copier')).toHaveTextContent(
      en.parcours.preuveCopier.toUpperCase(),
    );

    await fireEvent.press(screen.getByTestId('contrat-mention-copier'));

    await waitFor(() =>
      expect(screen.getByTestId('contrat-mention-copier')).toHaveTextContent(
        en.parcours.preuveCopie.toUpperCase(),
      ),
    );
    await vue.unmount();
  });
});

describe('ce qui n’est pas servi ne s’invente pas', () => {
  it('sans mention exigée, la ligne n’existe pas', async () => {
    // Une ligne « aucune mention » ferait chercher ce qu'elle demande.
    const vue = await monter({
      ...CONTREPARTIE,
      required_mention: null,
    } as unknown as Collaboration);
    await waitFor(() => expect(screen.getByTestId('contrat-de-la-preuve')).toBeTruthy());

    expect(screen.queryByTestId('contrat-mention')).toBeNull();
    await vue.unmount();
  });

  it('et le lieu ne se rend pas tant que le nom du salon n’est pas servi', async () => {
    // **`required_geotag` vaut vrai dans ce montage**, et la ligne n'apparaît
    // pourtant pas : ce qu'on tape dans la plateforme est le **nom de
    // l'établissement**, que `Collaboration` ne porte pas. Une ligne
    // « identifiez le lieu » sans rien à copier raterait exactement ce que
    // cette planche corrige.
    //
    // Ce test tombera le jour où le champ arrivera, et c'est voulu : il dit
    // l'état du contrat, pas une intention.
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId('contrat-de-la-preuve')).toBeTruthy());

    expect(screen.queryByTestId('contrat-lieu')).toBeNull();
    await vue.unmount();
  });
});
