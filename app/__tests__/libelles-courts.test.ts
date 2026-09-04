/**
 * Les libellés d'onglets tiennent, dans les deux langues.
 *
 * **Les maquettes sont toutes en anglais.** `type.label` fait onze points en
 * capitales avec 1,4 d'interlettrage, et l'espagnol est vingt à trente pour
 * cent plus long : un libellé calibré à l'œil sur l'anglais passe à deux lignes
 * en espagnol. Design l'avait corrigé une fois, parce qu'on l'avait vu — jamais
 * systématiquement.
 *
 * **Et la mesure a trouvé pire que la question posée.** « Awaiting their post »
 * débordait **en anglais**, la langue des maquettes : personne n'avait mesuré
 * dans aucune des deux. C'est moi qui l'avais rallongé, pour le rendre plus
 * clair que « expected ».
 *
 * ## Ce que cette garde mesure, et ce qu'elle ne mesure pas
 *
 * Elle **estime** une largeur : onze points en demi-gras donnent une avance
 * moyenne d'environ 6,8 points par capitale, plus l'interlettrage. Ce n'est pas
 * une mise en page, c'est un ordre de grandeur — et il suffit, parce que le cas
 * qu'on cherche est celui où un libellé dépasse d'une demi-largeur, jamais d'un
 * point. Une marge est laissée pour cela.
 *
 * Rien n'est tronqué quand ça dépasse : la barre enroule. Le défaut n'est donc
 * pas une perte de texte mais un onglet qui passe à deux lignes pendant que ses
 * voisins en font une — ce qu'aucune garde cherchant un débordement ne verrait.
 */
import { en } from '../src/i18n/en';
import { es } from '../src/i18n/es';
import tokens from '../src/theme/tokens.json';

/**
 * Les libellés qui vivent dans une cellule d'onglet, par écran.
 *
 * Énumérés et non déduits : `SegmentedTabs` reçoit ses items d'un tableau que
 * chaque écran construit à sa façon, et une extraction textuelle en manquerait
 * la moitié en silence — ce qui est exactement la façon dont ce défaut a vécu.
 */
const ONGLETS: { ecran: string; cles: string[] }[] = [
  { ecran: 'réservations', cles: [
      'parcours.ongletAVenir',
      'parcours.ongletEnCours',
      'parcours.ongletEnRevue',
      'parcours.ongletTerminees',
    ] },
  { ecran: 'publications', cles: ['commerce.filtreAControler', 'commerce.filtreApprouvee', 'commerce.filtreAttendue'] },
  { ecran: 'caisse', cles: ['redemption.scanTab', 'redemption.manualTab'] },
  { ecran: 'prestations du palier', cles: ['tiers.prestationsProches', 'tiers.prestationsToutes'] },
];

/** Le téléphone le plus étroit que le produit vise, marges de l'écran déduites. */
const TELEPHONE = 390;
const MARGE_DE_L_ECRAN = 16;
const MARGE_DE_LA_CELLULE = 8;

/**
 * L'avance de chaque capitale, en points, interlettrage compris.
 *
 * **Mesurée dans un navigateur, pas calculée — et c'est tout le sujet.** La
 * garde employait `longueur × avance moyenne`, avec une avance dérivée des
 * jetons. Le modèle est faux **dans sa forme** : un caractère n'a pas de
 * largeur fixe. Confronté au rendu réel de Plus Jakarta Sans, l'écart allait
 * de −14 % à +9 % selon le mot — et il se trompait dans le sens dangereux.
 *
 * Deux exemples, mesurés le 2026-09-04 sur une cellule de 73,5 pt :
 *
 * - `Upcoming` rend **74,0 pt** quand la formule annonçait 65,8. La garde
 *   l'aurait laissé passer alors qu'il déborde ;
 * - `In review` rend **67,7 pt** quand la formule annonçait 74,0. La garde le
 *   refusait alors qu'il tient.
 *
 * Autrement dit, elle acceptait un libellé coupé et en rejetait un bon. On
 * s'apprêtait à raccourcir de l'espagnol contre un nombre que personne n'avait
 * vérifié.
 *
 * **Régénérer** : rendre chaque caractère doublé puis simple dans un navigateur
 * chargé de la police, et prendre la différence — un caractère isolé porte son
 * interlettrage de queue, la paire donne l'avance qui s'accumule dans un mot.
 * La table reproduit alors les largeurs mesurées à 0,4 pt près.
 */
const AVANCES: Record<string, number> = {
  " ": 3.33,
  "0": 9.28,
  "1": 5.72,
  "2": 7.98,
  "3": 8.13,
  "4": 8.5,
  "5": 8.17,
  "6": 8.02,
  "7": 7.5,
  "8": 8.34,
  "9": 8.02,
  "A": 9.02,
  "B": 9.02,
  "C": 9.95,
  "D": 9.55,
  "E": 8.02,
  "F": 7.83,
  "G": 10.34,
  "H": 9.47,
  "I": 4.39,
  "J": 5.69,
  "K": 8.78,
  "L": 7.33,
  "M": 11.02,
  "N": 9.53,
  "O": 11.06,
  "P": 8.5,
  "Q": 11.06,
  "R": 8.59,
  "S": 8.52,
  "T": 7.25,
  "U": 9.23,
  "V": 8.91,
  "W": 12.48,
  "X": 8.44,
  "Y": 8.53,
  "Z": 7.73,
  "\u00b7": 5.22,
  "\u00c1": 9.02,
  "\u00c9": 8.02,
  "\u00cd": 4.39,
  "\u00d1": 9.53,
  "\u00d3": 11.06,
  "\u00da": 9.23,
  "\u00dc": 9.23,
};

/** Faute de mieux pour un caractère hors table : la plus large connue. */
const AVANCE_INCONNUE = Math.max(...Object.values(AVANCES));

const lire = (catalogue: Record<string, unknown>, cle: string): string => {
  const valeur = cle.split('.').reduce<unknown>((n, p) => (n as Record<string, unknown>)?.[p], catalogue);
  if (typeof valeur !== 'string') throw new Error(`clé absente : ${cle}`);
  return valeur;
};

const largeur = (texte: string) =>
  [...texte.toUpperCase()].reduce((total, c) => total + (AVANCES[c] ?? AVANCE_INCONNUE), 0);

describe('les libellés d’onglets tiennent dans les deux langues', () => {
  /**
   * Ce que la garde a réellement mesuré, langue comprise.
   *
   * **Sans ce relevé, retirer l'espagnol de la boucle ne casse rien.** Une fois
   * les libellés corrigés, l'anglais tient partout : une garde qui ne
   * vérifierait que lui passerait au vert et ne dirait plus rien de la langue
   * qui posait problème. C'est la mutation qui l'a montré — le décor ne
   * distinguait pas les deux implémentations.
   */
  const visites: string[] = [];

  afterAll(() => {
    const attendus = ONGLETS.flatMap(({ cles }) => cles.flatMap((c) => [`en:${c}`, `es:${c}`]));
    expect([...visites].sort()).toEqual(attendus.sort());
  });

  for (const { ecran, cles } of ONGLETS) {
    const cellule = (TELEPHONE - 2 * MARGE_DE_L_ECRAN) / cles.length - 2 * MARGE_DE_LA_CELLULE;

    it(`${ecran} — ${cles.length} onglets, ${Math.round(cellule)} pt par cellule`, () => {
      for (const cle of cles) {
        for (const [langue, catalogue] of [['en', en], ['es', es]] as const) {
          const texte = lire(catalogue as never, cle);
          visites.push(`${langue}:${cle}`);
          expect({ cle, langue, tient: largeur(texte) <= cellule }).toEqual({
            cle,
            langue,
            tient: true,
          });
        }
      }
    });
  }

  it('et la mesure sait dire non', () => {
    // **Sans ce cas, la garde ne prouverait que sa propre indulgence.** Le
    // libellé qui débordait vraiment — « Awaiting their post », dix-neuf
    // caractères — doit être refusé par la règle telle qu'elle est écrite.
    const cellule = (TELEPHONE - 2 * MARGE_DE_L_ECRAN) / 3 - 2 * MARGE_DE_LA_CELLULE;
    expect(largeur('Awaiting their post') > cellule).toBe(true);
    expect(largeur('Falta su publicación') > cellule).toBe(true);
    // Et elle accepte ce qui tient, sinon elle refuserait tout.
    expect(largeur('Not posted') <= cellule).toBe(true);
  });
});
