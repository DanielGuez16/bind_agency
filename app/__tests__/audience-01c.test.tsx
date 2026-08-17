/**
 * L'audience, contre ses cadres 01c et 01d.
 *
 * **L'écran le plus faible du produit, dit deux fois en campagne de test.** Le
 * registre des planches donne la raison : `Lot 1 v1.1` est la seule planche
 * sans entrée nulle part. Ses écrans emploient les bons jetons — ils ont
 * traversé la migration v1.0 — donc rien ne signalait qu'ils n'avaient jamais
 * été confrontés à leurs cadres. **Repeint n'est pas passé**, et c'est
 * précisément le mode d'échec qui ne laisse aucun écran laid derrière lui.
 *
 * Ce que la planche exige et qui manquait, éprouvé ici : un bloc par compte
 * plutôt que des chiffres empilés sans propriétaire ; une ligne et non une
 * carte pour ce qu'il reste à connecter ; les termes du contrôle et non son
 * seul verdict ; et ce qui compte pour les paliers en dehors des abonnés.
 */
import { render, screen, waitFor, within } from '@testing-library/react-native';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { AudienceScreen } from '../src/screens/AudienceScreen';
import { ThemeProvider } from '../src/theme';

const COMPTE = {
  social_account_id: 'c1',
  platform: 'instagram',
  handle: '@lea.mrl',
  status: 'active',
  verification_status: 'verified',
  followers_count: 7600,
  following_count: 300,
  media_count: 128,
  avg_views: null,
  engagement_rate: '4.2 %',
  captured_at: '2026-08-14T09:12:00Z',
  reconnectable: true,
};

const PALIERS = {
  creator_id: 'u1',
  is_new_creator: false,
  fiabilite: { reliability_score: '92', completed_collabs_count: 12 },
  paliers: [],
};

async function monter(reponses: Record<string, unknown>) {
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: async (url: RequestInfo | URL) => {
      const chemin = String(url);
      const trouve = Object.entries(reponses).find(([f]) => chemin.includes(f));
      return { ok: true, status: 200, json: async () => (trouve ? trouve[1] : []) } as Response;
    },
  });
  return await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={api}>
          <AudienceScreen />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

const NOMINAL = { '/me/audience': [COMPTE], '/me/verification': [], '/me/tiers': PALIERS };

describe('un chiffre appartient à un compte, et à une date', () => {
  it('chaque compte porte son réseau, son identifiant et son relevé', async () => {
    // L'écran empilait des lignes de données sans dire à qui elles étaient :
    // deux réseaux y auraient partagé visuellement un chiffre.
    await monter(NOMINAL);
    await waitFor(() => expect(screen.getByTestId('compte-c1')).toBeTruthy());

    const carte = within(screen.getByTestId('compte-c1'));
    expect(carte.getByText('Instagram')).toBeTruthy();
    expect(carte.getByText('@lea.mrl')).toBeTruthy();
    expect(carte.getByText('7,600')).toBeTruthy();
    expect(carte.getByText('4.2 %')).toBeTruthy();
    expect(carte.getByTestId('date-du-releve')).toBeTruthy();
  });
});

describe('un compte connecté est une carte, un réseau à connecter est une ligne', () => {
  it('ce qui est déjà rattaché ne se propose plus', async () => {
    // **Le défaut que la planche nomme.** L'écran rendait un bouton par
    // réseau, y compris pour celui qui était rattaché : il proposait de
    // connecter ce qui l'était, dans une forme identique à l'autre.
    await monter(NOMINAL);
    await waitFor(() => expect(screen.getByTestId('compte-c1')).toBeTruthy());

    expect(screen.queryByTestId('connecter-instagram')).toBeNull();
    expect(screen.getByTestId('connecter-tiktok')).toBeTruthy();
    expect(
      within(screen.getByTestId('ligne-tiktok')).getByText(en.parcours.audienceNonConnecte),
    ).toBeTruthy();
  });

  it('et quand tout est rattaché, la section entière disparaît', async () => {
    // Un titre de section au-dessus du vide est une promesse qui ne mène
    // nulle part.
    await monter({
      ...NOMINAL,
      '/me/audience': [COMPTE, { ...COMPTE, social_account_id: 'c2', platform: 'tiktok' }],
    });
    await waitFor(() => expect(screen.getByTestId('compte-c2')).toBeTruthy());

    expect(screen.queryByTestId('rattacher-un-reseau')).toBeNull();
  });
});

describe('le contrôle montre ses termes, pas son verdict seul', () => {
  it('« constaté / requis » plutôt que « falls short »', async () => {
    // **Les deux étaient servis et aucun n'était rendu.** `SignalJuge` porte
    // `constate` et `requis` depuis toujours ; l'écran n'affichait que le
    // verdict, si bien qu'« ancienneté : insuffisante » ne disait ni de
    // combien ni depuis quand. Un verdict sans ses termes ne se conteste pas,
    // et ne s'améliore pas non plus.
    await monter({
      ...NOMINAL,
      '/me/audience': [{ ...COMPTE, verification_status: 'needs_review' }],
      '/me/verification': [
        {
          social_account_id: 'c1',
          platform: 'instagram',
          handle: '@lea.mrl',
          verification_status: 'needs_review',
          started_at: '2026-08-14T10:00:00Z',
          reviewed_at: null,
          signaux: [
            { signal: 'anciennete', verdict: 'tenu', constate: '4 yrs', requis: '1 yr' },
            { signal: 'engagement', verdict: 'ignore_mecanisme_absent', constate: null, requis: null },
          ],
        },
      ],
    });
    await waitFor(() => expect(screen.getByTestId('signal-anciennete')).toBeTruthy());

    expect(within(screen.getByTestId('signal-anciennete')).getByText('4 yrs / 1 yr')).toBeTruthy();
    // Sans termes, le verdict reste : c'est tout ce qu'on a à dire.
    expect(
      within(screen.getByTestId('signal-engagement')).getByText(en.verdicts.ignore_mecanisme_absent),
    ).toBeTruthy();
  });
});

describe('ce qui compte pour les paliers, en dehors des abonnés', () => {
  it('les collaborations tenues et le score, sur cet écran', async () => {
    // Les abonnés ouvrent des paliers, mais pas seuls, et personne ne va
    // chercher les deux autres grandeurs sur un écran séparé.
    await monter(NOMINAL);
    await waitFor(() => expect(screen.getByTestId('ce-qui-compte')).toBeTruthy());

    expect(within(screen.getByTestId('collaborations-tenues')).getByText('12')).toBeTruthy();
    expect(within(screen.getByTestId('score-de-fiabilite')).getByText(/92/)).toBeTruthy();
  });

  it('et un score nul se dit « pas encore », jamais zéro', async () => {
    // **Nul veut dire neutre, pas zéro.** La distinction sépare un débutant de
    // quelqu'un de peu fiable ; l'inverser accuse exactement celui qui n'a
    // rien fait.
    await monter({
      ...NOMINAL,
      '/me/tiers': { ...PALIERS, fiabilite: { reliability_score: null, completed_collabs_count: 0 } },
    });
    await waitFor(() => expect(screen.getByTestId('score-de-fiabilite')).toBeTruthy());

    const score = within(screen.getByTestId('score-de-fiabilite'));
    expect(score.getByText(en.parcours.audiencePasEncoreDeScore)).toBeTruthy();
    expect(score.queryByText(/\b0\s*\/\s*100\b/)).toBeNull();
  });
});
