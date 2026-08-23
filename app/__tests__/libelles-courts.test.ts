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
  { ecran: 'réservations', cles: ['parcours.ongletAVenir', 'parcours.ongletEnCours', 'parcours.ongletTerminees'] },
  { ecran: 'publications', cles: ['commerce.filtreAControler', 'commerce.filtreApprouvee', 'commerce.filtreAttendue'] },
  { ecran: 'caisse', cles: ['redemption.scanTab', 'redemption.manualTab'] },
  { ecran: 'prestations du palier', cles: ['tiers.prestationsProches', 'tiers.prestationsToutes'] },
];

/** Le téléphone le plus étroit que le produit vise, marges de l'écran déduites. */
const TELEPHONE = 390;
const MARGE_DE_L_ECRAN = 16;
const MARGE_DE_LA_CELLULE = 8;

/**
 * L'avance moyenne d'une capitale, en points, interlettrage compris.
 *
 * Tirée des jetons plutôt que posée : le jour où l'échelle change, la garde
 * suit au lieu de mentir.
 */
const AVANCE =
  tokens.type.label.size * 0.62 + Number.parseFloat(tokens.type.label.tracking);

const lire = (catalogue: Record<string, unknown>, cle: string): string => {
  const valeur = cle.split('.').reduce<unknown>((n, p) => (n as Record<string, unknown>)?.[p], catalogue);
  if (typeof valeur !== 'string') throw new Error(`clé absente : ${cle}`);
  return valeur;
};

const largeur = (texte: string) => texte.toUpperCase().length * AVANCE;

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
