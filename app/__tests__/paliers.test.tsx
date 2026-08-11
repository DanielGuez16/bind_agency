/**
 * L'échelle des paliers : les règles que la mise en page ne montre pas.
 *
 * L'écran est celui que personne n'a compris en le lisant. Ce qui l'a rendu
 * illisible ne se voit pas dans une capture — c'est un ordre, un regroupement
 * et une bascule à 60 %. Ce sont ces trois-là qu'on éprouve ici ; le rendu, lui,
 * est couvert par les quatre états dans `ecrans-createur`.
 *
 * Le gabarit est simulé pour le bureau, la coquille étant mesurée pour de vrai
 * dans `coquille-mesuree` : ce qu'on vérifie ici est ce que l'écran fait de la
 * largeur, pas d'où elle vient.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { PaliersScreen, grouperParPlateforme } from '../src/screens/PaliersScreen';
import { ReglesScreen } from '../src/screens/ReglesScreen';
import { ThemeProvider } from '../src/theme';

const mockGabarit = { large: false };
jest.mock('../src/shell/gabarit', () => ({
  ...jest.requireActual('../src/shell/gabarit'),
  useGabarit: () => ({ largeur: mockGabarit.large ? 1512 : 390, large: mockGabarit.large }),
}));

beforeEach(() => {
  mockGabarit.large = false;
});

// --------------------------------------------------------------------------
// plomberie
// --------------------------------------------------------------------------

function client(vue: unknown): ApiClient {
  return new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => vue }) as Response,
  });
}

function Cadre({ children, api }: { children: ReactNode; api: ApiClient }) {
  return (
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={api}>{children}</ApiProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

async function monter(noeud: ReactElement, vue: unknown) {
  const api = client(vue);
  const rendu = await render(<Cadre api={api}>{noeud}</Cadre>);
  await waitFor(() => expect(screen.getByTestId('etat-nominal')).toBeTruthy());
  return rendu;
}

// --------------------------------------------------------------------------
// jeux de données
// --------------------------------------------------------------------------

function palier(
  format: 'story' | 'post' | 'reel',
  overrides: Record<string, unknown> = {},
  platform = 'instagram',
) {
  return {
    tier_id: `${platform}-${format}`,
    platform,
    content_format: format,
    min_followers: 1000,
    min_completed_collabs: 0,
    min_reliability_score: null,
    display_order: 1,
    accessible: true,
    social_account_id: 'c1',
    obstacles: [] as unknown[],
    offres_disponibles: 12,
    ...overrides,
  };
}

/** Assez près pour être chiffré : 7 600 sur 10 000, soit 76 %. */
const PROCHE = {
  raison: 'not_enough_followers',
  requis: 10000,
  constate: 7600,
  ecart: 2400,
  depuis: null,
};

/** Trop loin : 1 200 sur 50 000, soit 2,4 %. */
const LOIN = {
  raison: 'not_enough_followers',
  requis: 50000,
  constate: 1200,
  ecart: 48800,
  depuis: null,
};

const COLLABS = {
  raison: 'not_enough_completed_collabs',
  requis: 10,
  constate: 1,
  ecart: 9,
  depuis: null,
};

/** La cause qui ferme tout : elle porte sur le compte, pas sur un palier. */
const JETON_MORT = {
  raison: 'account_token_invalid',
  requis: null,
  constate: null,
  ecart: null,
  depuis: '2026-08-01T10:00:00Z',
};

const FIABILITE = { reliability_score: '92.00', completed_collabs_count: 12 };

function vueDe(paliers: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    creator_id: 'u1',
    is_new_creator: false,
    fiabilite: FIABILITE,
    paliers,
    ...overrides,
  };
}

/** L'ordre réel des barreaux à l'écran, lu sur l'arbre rendu. */
function ordreAffiche(): string[] {
  return screen
    .getAllByTestId(/^palier-/)
    .map((noeud) => String(noeud.props.testID).replace('palier-', ''));
}

// --------------------------------------------------------------------------
// l'ordre et le regroupement
// --------------------------------------------------------------------------

describe('l’échelle monte', () => {
  it('trie par format croissant, quel que soit l’ordre du serveur', async () => {
    // La progression ne se voit que si elle monte. Servie dans l'ordre de la
    // base, l'échelle n'en est plus une, et il ne reste qu'une liste.
    await monter(
      <PaliersScreen />,
      vueDe([palier('reel'), palier('story'), palier('post')]),
    );

    expect(ordreAffiche()).toEqual(['instagram-story', 'instagram-post', 'instagram-reel']);
  });

  it('groupe par plateforme sans jamais mélanger les formats', () => {
    // Six cartes mélangées cassent l'échelle : « story fermé » sous « story
    // ouvert » se lit comme une contradiction.
    const groupes = grouperParPlateforme([
      palier('reel', {}, 'tiktok'),
      palier('story', { accessible: false }),
      palier('post', {}, 'tiktok'),
      palier('reel'),
    ] as never);

    expect(groupes.map((g) => g.platform)).toEqual(['tiktok', 'instagram']);
    expect(groupes[0].paliers.map((p) => p.content_format)).toEqual(['post', 'reel']);
    expect(groupes[1].paliers.map((p) => p.content_format)).toEqual(['story', 'reel']);
  });

  it('n’affiche que les paliers de la plateforme choisie', async () => {
    await monter(
      <PaliersScreen />,
      vueDe([
        palier('story'),
        palier('post'),
        palier('story', {}, 'tiktok'),
        palier('post', {}, 'tiktok'),
      ]),
    );

    expect(ordreAffiche()).toEqual(['instagram-story', 'instagram-post']);

    await fireEvent.press(screen.getByLabelText(/TikTok/));
    expect(ordreAffiche()).toEqual(['tiktok-story', 'tiktok-post']);
  });

  it('compte les paliers ouverts de chaque onglet', async () => {
    await monter(
      <PaliersScreen />,
      vueDe([
        palier('story'),
        palier('post', { accessible: false, obstacles: [PROCHE] }),
        palier('story', { accessible: false, obstacles: [LOIN] }, 'tiktok'),
      ]),
    );

    expect(screen.getByLabelText(`Instagram · ${en.tiers.openCount.replace('{{count}}', '1')}`)).toBeTruthy();
    expect(screen.getByLabelText(`TikTok · ${en.tiers.openCount.replace('{{count}}', '0')}`)).toBeTruthy();
  });

  it('ne pose pas d’onglet quand une seule plateforme est connectée', async () => {
    // Un onglet unique n'offre aucun choix et répète un nom déjà donné.
    await monter(<PaliersScreen />, vueDe([palier('story'), palier('post')]));

    expect(screen.queryByTestId('onglets-plateforme')).toBeNull();
  });
});

// --------------------------------------------------------------------------
// l'échange, et sa projection
// --------------------------------------------------------------------------

describe('ce que je donne, ce que j’obtiens', () => {
  it('passe les deux intitulés au conditionnel sur un palier fermé', async () => {
    // La seule variation de copie entre ouvert et fermé, et elle suffit à dire
    // que le second est une projection.
    await monter(
      <PaliersScreen />,
      vueDe([palier('story'), palier('post', { accessible: false, obstacles: [PROCHE] })]),
    );

    expect(screen.getByText(en.tiers.giveLabel)).toBeTruthy();
    expect(screen.getByText(en.tiers.getLabel)).toBeTruthy();
    expect(screen.getByText(en.tiers.giveLabelLocked)).toBeTruthy();
    expect(screen.getByText(en.tiers.getLabelLocked)).toBeTruthy();
  });

  it('désigne le premier palier fermé, et lui seul', async () => {
    // C'est le seul objectif de l'écran. Deux objectifs n'en font aucun.
    await monter(
      <PaliersScreen />,
      vueDe([
        palier('story'),
        palier('post', { accessible: false, obstacles: [PROCHE] }),
        palier('reel', { accessible: false, obstacles: [LOIN] }),
      ]),
    );

    expect(screen.getAllByTestId('etat-prochain')).toHaveLength(1);
    expect(screen.getByText(en.tiers.furtherAhead)).toBeTruthy();
    expect(screen.getByText(en.tiers.openToYou)).toBeTruthy();
  });
});

// --------------------------------------------------------------------------
// la règle des 60 %
// --------------------------------------------------------------------------

describe('l’écart au seuil', () => {
  it('chiffre et jauge à partir de 60 % du seuil', async () => {
    await monter(
      <PaliersScreen />,
      vueDe([palier('post', { accessible: false, obstacles: [PROCHE] })]),
    );

    expect(screen.getByTestId('jauge-not_enough_followers')).toBeTruthy();
    expect(screen.getByText('7,600 / 10,000')).toBeTruthy();
    expect(
      screen.getByText(
        en.obstacles.ecart.replace('{{manque}}', '2,400').replace('{{requis}}', '10,000'),
      ),
    ).toBeTruthy();
  });

  it('n’affiche ni jauge ni délai en dessous', async () => {
    // **La règle à ne pas perdre.** Une barre presque vide décourage plus
    // qu'elle n'informe, et une projection de rythme serait un engagement que
    // le produit ne tient pas. Le seuil, et rien d'autre.
    await monter(
      <PaliersScreen />,
      vueDe([palier('reel', { accessible: false, obstacles: [LOIN] })]),
    );

    expect(screen.queryByTestId('jauge-not_enough_followers')).toBeNull();
    expect(screen.getByText(en.obstacles.horizon.replace('{{requis}}', '50,000'))).toBeTruthy();
    // Le seuil est là, l'écart ne l'est pas : « il te manque 48 800 abonnés »
    // n'apprend qu'une chose, que ce n'est pas pour soi.
    expect(screen.getByText('50,000')).toBeTruthy();
    expect(screen.queryByText(/48,800/)).toBeNull();
  });

  it('traite chaque obstacle pour lui-même', async () => {
    // Un palier peut porter une barre pour les abonnés et un horizon pour les
    // collaborations : la bascule est par obstacle, pas par palier.
    await monter(
      <PaliersScreen />,
      vueDe([palier('post', { accessible: false, obstacles: [PROCHE, COLLABS] })]),
    );

    expect(screen.getByTestId('jauge-not_enough_followers')).toBeTruthy();
    expect(screen.queryByTestId('jauge-not_enough_completed_collabs')).toBeNull();
    expect(screen.getByTestId('obstacle-not_enough_completed_collabs')).toBeTruthy();
  });

  it('nomme ce qui manque au lieu de dire « fermé »', async () => {
    // Le défaut de la campagne précédente : un palier fermé annonçait
    // « Locked » sans dire ce qui manquait, alors que l'API renvoie tous les
    // obstacles avec leur écart.
    await monter(
      <PaliersScreen />,
      vueDe([palier('post', { accessible: false, obstacles: [PROCHE, COLLABS] })]),
    );

    expect(screen.getByText(en.obstacles.nom.not_enough_followers)).toBeTruthy();
    expect(screen.getByText(en.obstacles.nom.not_enough_completed_collabs)).toBeTruthy();
    expect(screen.getByText(en.tiers.toUnlock)).toBeTruthy();
  });
});

// --------------------------------------------------------------------------
// une seule cause ferme tout
// --------------------------------------------------------------------------

describe('quand le compte est en cause', () => {
  it('annonce la cause une fois et la retire des barreaux', async () => {
    // Six fois la même mauvaise nouvelle, c'est six fois aucune action.
    await monter(
      <PaliersScreen />,
      vueDe([
        palier('story', { accessible: false, obstacles: [JETON_MORT] }),
        palier('post', { accessible: false, obstacles: [JETON_MORT, PROCHE] }),
      ]),
    );

    expect(screen.getByTestId('paliers-bloques')).toBeTruthy();
    expect(screen.queryByTestId('obstacle-account_token_invalid')).toBeNull();
    // Ce qui reste propre au palier, lui, est bien là.
    expect(screen.getByTestId('obstacle-not_enough_followers')).toBeTruthy();
  });

  it('dit qu’un palier acquis est en pause, pas perdu', async () => {
    // C'est la question qu'on se pose devant cet écran, et quatre mots y
    // répondent. Sans eux, chacun suppose le pire.
    await monter(
      <PaliersScreen />,
      vueDe([
        palier('story', { accessible: false, obstacles: [JETON_MORT] }),
        palier('post', { accessible: false, obstacles: [JETON_MORT, PROCHE] }),
      ]),
    );

    expect(screen.getByTestId('etat-en-pause')).toBeTruthy();
    expect(screen.getByText(en.tiers.stillWaiting)).toBeTruthy();
    // Aucun objectif désigné : le prochain geste est de réparer le compte,
    // pas de viser un palier.
    expect(screen.queryByTestId('etat-prochain')).toBeNull();
  });
});

// --------------------------------------------------------------------------
// les règles, et le score
// --------------------------------------------------------------------------

describe('les règles des paliers', () => {
  it('montre le score, sa jauge et ses deux garanties', async () => {
    await monter(<ReglesScreen />, vueDe([palier('story')]));

    expect(screen.getByTestId('score-de-fiabilite')).toHaveTextContent('92');
    expect(screen.getByTestId('garanties-du-score')).toBeTruthy();
    expect(screen.getByText(en.tiers.rulesUp)).toBeTruthy();
    expect(screen.getByText(en.tiers.rulesDown)).toBeTruthy();
  });

  it('n’invente pas de score à qui n’en a pas encore', async () => {
    // Nul veut dire neutre, jamais zéro. Une barre vide se lit comme un zéro,
    // et ferait d'un débutant quelqu'un de peu fiable.
    await monter(
      <ReglesScreen />,
      vueDe([palier('story')], {
        is_new_creator: true,
        fiabilite: { reliability_score: null, completed_collabs_count: 0 },
      }),
    );

    expect(screen.queryByTestId('score-de-fiabilite')).toBeNull();
    expect(screen.getByTestId('fiabilite-sans-score')).toBeTruthy();
    // La définition et les garanties restent : c'est ce qu'on vient lire.
    expect(screen.getByTestId('garanties-du-score')).toBeTruthy();
  });

  it('dit ce qui ne compte pas contre soi', async () => {
    // La première question posée, et y répondre coûte une ligne.
    await monter(<ReglesScreen />, vueDe([palier('story')]));

    expect(screen.getByTestId('regles-sans-consequence')).toHaveTextContent(/never counts against/);
  });
});

// --------------------------------------------------------------------------
// grand écran
// --------------------------------------------------------------------------

describe('sur grand écran', () => {
  it('pose les règles en colonne plutôt qu’en écran séparé', async () => {
    mockGabarit.large = true;
    await monter(<PaliersScreen onLireLesRegles={jest.fn()} />, vueDe([palier('story')]));

    expect(screen.getByTestId('regles-en-colonne')).toBeTruthy();
    // Une porte vers ce qu'on a déjà sous les yeux mènerait nulle part.
    expect(screen.queryByTestId('porte-des-regles')).toBeNull();
  });

  it('garde la porte des règles en compact', async () => {
    await monter(<PaliersScreen onLireLesRegles={jest.fn()} />, vueDe([palier('story')]));

    expect(screen.getByTestId('porte-des-regles')).toBeTruthy();
    expect(screen.queryByTestId('regles-en-colonne')).toBeNull();
  });

  it('n’écrit pas le titre deux fois', async () => {
    // En grand il vit dans la barre de titre ; le laisser aussi dans le flux
    // donnait « Your tiers » au-dessus de « Your tiers ».
    mockGabarit.large = true;
    await monter(<PaliersScreen prenom="Lea" />, vueDe([palier('story')]));

    expect(screen.queryByTestId('entete-paliers')).toBeNull();
  });
});
