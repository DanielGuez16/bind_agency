/**
 * L'audience v3 : chaque chiffre dit ce qu'il ouvre.
 *
 * **L'écran le plus faible du produit, signalé sur trois campagnes.** « C'est
 * pas très joli » et « on sait pas ce que c'est » sont le même défaut vu de
 * deux côtés : un tableau de bord sans conséquence n'a pas de raison d'être
 * regardé, donc rien n'y organise le regard.
 *
 * **Ce que ces tests éprouvent en premier est le seuil**, parce que c'est la
 * seule chose ici qui puisse être fausse plutôt que laide. Un nombre d'abonnés
 * est servi ; le palier qu'il vise se déduit, et une déduction se trompe. Trois
 * implémentations fausses passeraient un décor recopié de la planche : celle
 * qui pose le seuil du palier suivant quel que soit son réseau, celle qui le
 * pose quel que soit l'obstacle, et celle qui remplit la jauge avec le compte
 * du compte au lieu du constat du palier. Chaque cas ci-dessous est choisi pour
 * **diverger** de l'une d'elles.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { render, screen, waitFor, within } from '@testing-library/react-native';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { AudienceScreen } from '../src/screens/AudienceScreen';
import { FiabiliteScreen } from '../src/screens/FiabiliteScreen';
import { etatDuCompte, tombeeLe } from '../src/screens/audience/etat';
import { seuilDesAbonnes } from '../src/screens/audience/seuil';
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
  avg_views: 2140,
  engagement_rate: '4.2 %',
  captured_at: '2026-08-14T09:12:00Z',
  reconnectable: true,
};

/** Le palier post, fermé faute d'abonnés : 7 600 sur 10 000, il en manque 2 400. */
const PROCHAIN = {
  tier_id: 't2',
  platform: 'instagram',
  content_format: 'post',
  obstacle: {
    raison: 'not_enough_followers',
    requis: 10000,
    constate: 7600,
    ecart: 2400,
    depuis: null,
  },
  commerces_dans_le_rayon: null,
};

const VUE = {
  creator_id: 'u1',
  is_new_creator: false,
  fiabilite: {
    reliability_score: '92',
    completed_collabs_count: 12,
    // Les neuf du serveur, dans son ordre — du plus favorable au plus coûteux.
    composantes: [
      { evenement: 'collab_completed', sens: 'up' },
      { evenement: 'published_on_time', sens: 'up' },
      { evenement: 'published_late', sens: 'down' },
      { evenement: 'first_pass_compliant', sens: 'up' },
      { evenement: 'resubmit_required', sens: 'down' },
      { evenement: 'no_show', sens: 'down' },
      { evenement: 'unfulfilled', sens: 'down' },
      { evenement: 'business_rating', sens: 'neutral' },
      { evenement: 'abusive_report', sens: 'neutral' },
    ],
  },
  paliers: [],
  prochain_palier: PROCHAIN,
};

async function monter(reponses: Record<string, unknown>, noeud = <AudienceScreen />) {
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
        <ApiProvider client={api}>{noeud}</ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

const NOMINAL = { '/me/audience': [COMPTE], '/me/verification': [], '/me/tiers': VUE };

describe('le seuil des abonnés se déduit, donc il peut mentir', () => {
  it('sur le bon réseau, il donne le seuil, l’écart et la part', () => {
    expect(seuilDesAbonnes({ platform: 'instagram' }, PROCHAIN as never)).toEqual({
      requis: 10000,
      constate: 7600,
      ecart: 2400,
      fraction: 0.76,
      format: 'post',
    });
  });

  it('mais rien du tout quand le palier suivant est sur un autre réseau', () => {
    // **Le cas qui diverge de « pose le seuil dans toutes les cartes ».** Le
    // palier fermé le plus proche peut être sur TikTok pendant qu'on regarde
    // la carte Instagram : sa jauge ferait alors compter les abonnés d'un
    // compte vers un palier qui n'en dépend pas.
    expect(seuilDesAbonnes({ platform: 'tiktok' }, PROCHAIN as never)).toBeNull();
  });

  it('ni quand le palier est fermé pour autre chose que des abonnés', () => {
    // **Le cas qui diverge de « une jauge dès qu'il y a un palier suivant ».**
    // Une barre d'abonnés sous un obstacle de score promet un levier qui ne
    // débloque rien.
    const score = { ...PROCHAIN, obstacle: { ...PROCHAIN.obstacle, raison: 'reliability_score_too_low' } };
    expect(seuilDesAbonnes({ platform: 'instagram' }, score as never)).toBeNull();
  });

  it('et la part vient du constat du palier, jamais du compte', () => {
    // **Le cas qui diverge de « remplis la jauge avec followers_count ».** Les
    // deux valeurs coïncident presque toujours, et c'est ce qui rend l'erreur
    // invisible : ici elles divergent, et seule la source du palier donne une
    // jauge cohérente avec la phrase qui l'accompagne.
    const decale = {
      ...PROCHAIN,
      obstacle: { ...PROCHAIN.obstacle, constate: 5000, ecart: 5000 },
    };
    const seuil = seuilDesAbonnes({ platform: 'instagram' }, decale as never);
    expect(seuil?.fraction).toBe(0.5);
    expect(seuil?.ecart).toBe(5000);
  });

  it('un seuil nul ne se divise pas', () => {
    const zero = { ...PROCHAIN, obstacle: { ...PROCHAIN.obstacle, requis: 0 } };
    expect(seuilDesAbonnes({ platform: 'instagram' }, zero as never)).toBeNull();
  });

  it('et l’absence du champ se traite comme son absence de valeur', () => {
    expect(seuilDesAbonnes({ platform: 'instagram' }, null)).toBeNull();
    expect(seuilDesAbonnes({ platform: 'instagram' }, undefined as never)).toBeNull();
  });
});

describe('l’état d’un compte, et l’ordre de ses trois questions', () => {
  it('à jour quand il est actif et relevé', () => {
    expect(etatDuCompte({ status: 'active', captured_at: '2026-08-14T09:12:00Z' })).toBe('a-jour');
  });

  it('en première lecture quand rien n’a encore été relevé', () => {
    expect(etatDuCompte({ status: 'active', captured_at: null })).toBe('premiere-lecture');
  });

  it('et suspendu l’emporte sur la première lecture, jamais l’inverse', () => {
    // **L'ordre est le sujet, et c'est la seule des trois réponses qui puisse
    // mentir.** Un compte dont l'autorisation est tombée n'a par construction
    // plus de relevé courant : poser « lit-on ? » en premier afficherait
    // « READING » sur un compte que personne ne lit plus.
    expect(etatDuCompte({ status: 'expired', captured_at: null })).toBe('suspendu');
    expect(etatDuCompte({ status: 'revoked', captured_at: '2026-08-04T09:00:00Z' })).toBe('suspendu');
  });
});

describe('la carte de compte porte ce que la planche demande', () => {
  it('sa marque, son état, et son seuil', async () => {
    await monter(NOMINAL);
    await waitFor(() => expect(screen.getByTestId('compte-c1')).toBeTruthy());

    const carte = within(screen.getByTestId('compte-c1'));
    expect(carte.getByTestId('etat-c1')).toHaveTextContent(
      new RegExp(en.parcours.audienceEtatAJour, 'i'),
    );
    // Le chiffre, le seuil qu'il vise, et le palier qu'il ouvre : aucun des
    // trois n'est lisible sans les deux autres.
    expect(carte.getByTestId('abonnes')).toHaveTextContent('7,600');
    // En expression régulière : sur une chaîne, `toHaveTextContent`
    // compare le contenu **entier**, et « of 10,000 » n'est pas « 10,000 ».
    expect(carte.getByTestId('abonnes-seuil')).toHaveTextContent(/10,000/);
    expect(carte.getByTestId('abonnes-ouvre')).toHaveTextContent(/2,400/);
    expect(carte.getByTestId('abonnes-ouvre')).toHaveTextContent(/POST/);
    expect(carte.getByTestId('abonnes-jauge')).toBeTruthy();
  });

  it('et le palier suivant reste dit même sans jauge à montrer', async () => {
    // **Sans cette ligne, l'information disparaîtrait de l'écran.** La jauge se
    // tait sur un obstacle qui n'est pas d'abonnés ; le silence se lirait
    // comme « rien à viser ».
    const autre = {
      ...VUE,
      prochain_palier: {
        ...PROCHAIN,
        obstacle: { raison: 'not_enough_completed_collabs', requis: 3, constate: 1, ecart: 2, depuis: null },
      },
    };
    await monter({ ...NOMINAL, '/me/tiers': autre });
    await waitFor(() => expect(screen.getByTestId('compte-c1')).toBeTruthy());

    const carte = within(screen.getByTestId('compte-c1'));
    expect(carte.queryByTestId('abonnes-jauge')).toBeNull();
    expect(carte.getByTestId('prochain-palier')).toBeTruthy();
  });

  it('une autorisation tombée se dit sans accuser, et dit ce qu’elle change', async () => {
    await monter({
      ...NOMINAL,
      '/me/audience': [{ ...COMPTE, status: 'expired' }],
    });
    await waitFor(() => expect(screen.getByTestId('autorisation-suspendue')).toBeTruthy());

    const carte = within(screen.getByTestId('compte-c1'));
    expect(carte.getByTestId('etat-c1')).toHaveTextContent(
      new RegExp(en.parcours.audienceEtatSuspendu, 'i'),
    );
    // **Le geste est offert là où il se fait**, et le chiffre gelé garde sa
    // date : il est vrai, il n'est plus courant.
    expect(carte.getByTestId('reconnecter-instagram')).toBeTruthy();
    expect(carte.getByTestId('abonnes-date-du-gel')).toBeTruthy();
    // Et les deux mesures que le commerce regarde disparaissent : elles ne sont
    // plus lues, les afficher gelées à côté d'un chiffre gelé ferait trois
    // valeurs périmées pour une seule date.
    expect(carte.queryByTestId('ce-que-voit-un-salon')).toBeNull();
  });

  it('et elle dit depuis quand elle est tombée', async () => {
    // « Expirée il y a trois jours » et « expirée en mars » n'appellent pas la
    // même réaction : la première se répare d'un geste, la seconde explique
    // pourquoi plus rien ne s'ouvre depuis des mois.
    await monter({
      ...NOMINAL,
      '/me/audience': [
        { ...COMPTE, status: 'expired', token_expires_at: '2026-08-04T09:00:00Z' },
      ],
    });
    await waitFor(() => expect(screen.getByTestId('autorisation-tombee-le')).toBeTruthy());

    expect(screen.getByTestId('autorisation-tombee-le')).toHaveTextContent(/2026/);
  });

  it('mais se tait quand la date est à venir', async () => {
    // **Le cas qui diverge de « rends la date dès qu'elle existe ».** Un compte
    // révoqué avant l'échéance de son jeton porte une date **future** : écrire
    // « expire le 3 octobre » sous « il faut réautoriser » dirait le contraire
    // du bloc qui la porte. C'est le décor que la planche ne montre pas et que
    // le serveur produit.
    await monter({
      ...NOMINAL,
      '/me/audience': [
        { ...COMPTE, status: 'revoked', token_expires_at: '2099-01-01T00:00:00Z' },
      ],
    });
    await waitFor(() => expect(screen.getByTestId('autorisation-suspendue')).toBeTruthy());

    expect(screen.queryByTestId('autorisation-tombee-le')).toBeNull();
  });

  it('la date de chute, en pur : passée oui, future non, absente non', () => {
    const maintenant = new Date('2026-08-20T12:00:00Z');
    expect(tombeeLe('2026-08-04T09:00:00Z', maintenant)).toBe('2026-08-04T09:00:00Z');
    expect(tombeeLe('2026-09-04T09:00:00Z', maintenant)).toBeNull();
    expect(tombeeLe(null, maintenant)).toBeNull();
    expect(tombeeLe(undefined, maintenant)).toBeNull();
    expect(tombeeLe('pas une date', maintenant)).toBeNull();
  });

  it('sans relevé, un tiret et sa phrase, jamais un zéro', async () => {
    await monter({
      ...NOMINAL,
      '/me/audience': [{ ...COMPTE, followers_count: null, captured_at: null }],
    });
    await waitFor(() => expect(screen.getByTestId('aucun-releve')).toBeTruthy());

    const carte = within(screen.getByTestId('compte-c1'));
    expect(carte.getByTestId('abonnes')).toHaveTextContent('—');
    expect(carte.queryByText('0')).toBeNull();
  });
});

describe('le score, un écran plus loin', () => {
  it('donne son chiffre, sa définition, et ce qui le bouge dans les deux sens', async () => {
    await monter({ '/me/tiers': VUE }, <FiabiliteScreen />);
    await waitFor(() => expect(screen.getByTestId('score-en-grand')).toBeTruthy());

    expect(screen.getByTestId('score-en-grand')).toHaveTextContent('92');
    expect(screen.getByText(en.parcours.scoreDefinition)).toBeTruthy();
    // **Ce qui monte avant ce qui descend**, et pas l'inverse : commencer par
    // les pénalités transforme une explication en avertissement.
    expect(screen.getByTestId('ce-qui-monte')).toBeTruthy();
    expect(screen.getByTestId('ce-qui-descend')).toBeTruthy();
    expect(screen.getByText(en.parcours.scoreSeRepare)).toBeTruthy();
  });

  it('et les deux garanties sont sur l’écran, pas dans un document', async () => {
    // Une promesse enterrée dans les conditions d'utilisation n'est pas une
    // promesse, c'est une clause. Une note de 0 à 100 sans ces deux phrases se
    // lit comme un classement, ce qu'elle n'est précisément pas.
    await monter({ '/me/tiers': VUE }, <FiabiliteScreen />);
    await waitFor(() => expect(screen.getByTestId('ce-qu-il-ne-fait-jamais')).toBeTruthy());

    expect(screen.getByText(en.parcours.scoreJamaisCompare)).toBeTruthy();
    expect(screen.getByText(en.parcours.scoreJamaisMontre)).toBeTruthy();
  });

  it('range les événements par le sens que le serveur donne, pas par le sien', async () => {
    // **Le cas qui diverge d'une liste récitée.** Le décor sert `no_show` en
    // hausse — ce qu'il n'est pas dans la grille d'aujourd'hui. Un écran qui
    // porterait ses sept événements en dur le rangerait en baisse et rendrait
    // exactement le même écran que la planche : le test survivrait à la
    // mutation sans avoir rien éprouvé. Ici les deux divergent, et c'est le
    // serveur qui décide.
    await monter(
      {
        '/me/tiers': {
          ...VUE,
          fiabilite: {
            ...VUE.fiabilite,
            composantes: [
              { evenement: 'no_show', sens: 'up' },
              { evenement: 'collab_completed', sens: 'down' },
            ],
          },
        },
      },
      <FiabiliteScreen />,
    );
    await waitFor(() => expect(screen.getByTestId('ce-qui-monte')).toBeTruthy());

    expect(screen.getByTestId('ce-qui-monte-no_show')).toBeTruthy();
    expect(screen.getByTestId('ce-qui-descend-collab_completed')).toBeTruthy();
  });

  it('donne une section aux neutres, parce qu’ils existent', async () => {
    // « Ce qui affecte le score » doit pouvoir dire « ceci ne l'affecte pas ».
    // Taire les poids nuls ferait disparaître de l'écran quelque chose qui peut
    // réapparaître au premier réglage.
    await monter({ '/me/tiers': VUE }, <FiabiliteScreen />);
    await waitFor(() => expect(screen.getByTestId('sans-effet')).toBeTruthy());

    expect(screen.getByTestId('sans-effet-abusive_report')).toBeTruthy();
    expect(screen.getByText(en.parcours.evenementsDuScore.abusive_report)).toBeTruthy();
  });

  it('et une section vide ne se rend pas du tout', async () => {
    // Sans cette moitié, la garde du dessus passerait sur un écran qui poserait
    // les trois intitulés quoi qu'il arrive — un titre au-dessus du vide.
    await monter(
      {
        '/me/tiers': {
          ...VUE,
          fiabilite: { ...VUE.fiabilite, composantes: [{ evenement: 'no_show', sens: 'down' }] },
        },
      },
      <FiabiliteScreen />,
    );
    await waitFor(() => expect(screen.getByTestId('ce-qui-descend')).toBeTruthy());

    expect(screen.queryByTestId('ce-qui-monte')).toBeNull();
    expect(screen.queryByTestId('sans-effet')).toBeNull();
  });

  it('un code que l’interface ne sait pas dire ne s’affiche pas brut', async () => {
    // « resubmit_required » posé tel quel sur un écran d'explication se lit
    // comme une chaîne oubliée, parce que c'en serait une. Le silence n'est pas
    // la bonne réponse non plus — c'est la garde du dessous qui doit tomber.
    await monter(
      {
        '/me/tiers': {
          ...VUE,
          fiabilite: {
            ...VUE.fiabilite,
            composantes: [
              { evenement: 'un_evenement_de_demain', sens: 'down' },
              { evenement: 'no_show', sens: 'down' },
            ],
          },
        },
      },
      <FiabiliteScreen />,
    );
    await waitFor(() => expect(screen.getByTestId('ce-qui-descend')).toBeTruthy());

    expect(screen.queryByText(/un_evenement_de_demain/)).toBeNull();
    expect(screen.getByTestId('ce-qui-descend-no_show')).toBeTruthy();
  });

  it('et les neuf codes du serveur ont tous leur phrase', () => {
    // **La garde qui doit tomber le jour où un dixième arrive.** Le silence de
    // l'écran sur un code inconnu est un repli, pas une réponse : sans ce test,
    // un événement ajouté côté serveur disparaîtrait de la liste sans que rien
    // ne le signale, et « ce qui affecte votre score » en tairait un.
    //
    // Lu dans l'énumération Python, et non recopié : une liste tenue à la main
    // ici serait exactement le décor que le code fautif produit.
    const source = readFileSync(
      join(__dirname, '..', '..', 'api', 'app', 'models', 'enums.py'),
      'utf-8',
    );
    const bloc = source.slice(source.indexOf('class ReliabilityEventType'));
    const codes = [...bloc.slice(0, bloc.indexOf('\nclass ')).matchAll(/^\s+\w+ = "(\w+)"$/gm)].map(
      (m) => m[1],
    );

    expect(codes.length).toBeGreaterThanOrEqual(9);
    expect(codes.filter((code) => !(code in en.parcours.evenementsDuScore))).toEqual([]);
  });

  it('sans historique, un tiret et la phrase qui dit que ça ne coûte rien', async () => {
    await monter(
      { '/me/tiers': { ...VUE, fiabilite: { reliability_score: null, completed_collabs_count: 0 } } },
      <FiabiliteScreen />,
    );
    await waitFor(() => expect(screen.getByTestId('score-pas-encore-detail')).toBeTruthy());

    expect(screen.getByTestId('score-en-grand')).toHaveTextContent('—');
    // Le « sur 100 » part avec le chiffre : « — out of 100 » se lirait comme
    // une note de zéro.
    expect(screen.queryByTestId('score-sur-cent')).toBeNull();
    expect(screen.getByText(en.parcours.audiencePasEncoreDeScoreDetail)).toBeTruthy();
  });
});
