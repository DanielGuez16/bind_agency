/**
 * La fiche v3 : deux questions par prestation, et rien de codé.
 *
 * **La cause trouvée par Design.** Une ligne portait cinq informations de
 * nature différente — nom, durée, badge à trois barres, date brute, bouton —
 * dont deux codées. Elle pose en fait deux questions : **qu'est-ce que je
 * donne** et **quand je viens**. Ce que ces tests protègent est cette
 * séparation, pas une mise en page : le jour où quelqu'un remet le badge sur
 * cet écran, ou recolle la date brute, c'est ici que ça tombe.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider, type FichePublique } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { formatHeure } from '../src/format';
import { FicheScreen } from '../src/screens/FicheScreen';
import { ThemeProvider } from '../src/theme';

/**
 * **Le créneau est calculé à partir de maintenant, et c'est délibéré.**
 *
 * Un `prochains_creneaux` figé à une date en dur finirait par tomber dans le
 * passé, et le test affirmerait alors qu'un créneau périmé s'annonce comme
 * « aujourd'hui ». Ce dépôt a déjà payé exactement ce défaut sur un
 * `valid_until`. La date de référence se construit donc à chaque exécution.
 */
function dansNHeures(n: number): string {
  return new Date(Date.now() + n * 3_600_000).toISOString();
}

/** Le jour de la semaine chez le commerce, lundi valant 0. */
const JOUR_DE_LA_SEMAINE = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
  }).format(new Date()),
);

const OFFRE = {
  tier_offer_id: 'o1',
  catalog_item_id: 'i1',
  tier_id: 't1',
  name: 'Gel manicure',
  description: null,
  price_cents: 4500,
  currency: 'USD',
  duration_minutes: 45,
  requires_booking: true,
  photo_key: null,
  leaves_choice: false,
  platform: 'instagram',
  content_format: 'story',
  required_mention: null,
  required_geotag: false,
  value_ratio: null,
  accessible: true,
  social_account_id: 's1',
  obstacles: [],
  prochains_creneaux: [dansNHeures(2), dansNHeures(5), dansNHeures(7)],
};

const FICHE = {
  business_id: 'b1',
  name: 'Vela Nail Studio',
  category: 'beauty',
  address: '120 NE 41st St, Wynwood',
  // **Le fuseau du salon, pas celui de la machine.** Un repère de jour se
  // calcule là où l'on se présente au comptoir ; un test qui poserait `UTC`
  // passerait sur une machine à Londres et tomberait sur une autre.
  timezone: 'America/New_York',
  phone: null,
  cover_photo_key: 'photos/b1/facade',
  photos: ['photos/b1/salle', 'photos/b1/vitrine'],
  menu_pages: [] as string[],
  menu_url: null as string | null,
  // **Les sept plages, servies depuis peu.** Le montage les porte parce que la
  // fiche les lit : les omettre ferait tomber l'écran sur un champ absent, et
  // c'est exactement ce qu'un montage qui fabrique une réponse que le serveur
  // ne produit pas laisse passer.
  horaires: [
    // Le jour d'aujourd'hui chez le commerce, pour que l'étiquette ait une
    // ligne à trouver quelle que soit la date d'exécution.
    { weekday: JOUR_DE_LA_SEMAINE, start_time: '09:00:00', end_time: '13:00:00' },
    { weekday: JOUR_DE_LA_SEMAINE, start_time: '14:30:00', end_time: '19:00:00' },
  ],
  offres: [OFFRE],
} as unknown as FichePublique;

function clientDe(fiche: FichePublique) {
  return new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: (async () => ({ ok: true, status: 200, json: async () => fiche })) as never,
  });
}

async function monter(fiche: FichePublique = FICHE) {
  return render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={clientDe(fiche)}>
          <FicheScreen businessId="b1" onReserver={() => {}} />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('une prestation pose deux questions, une ligne chacune', () => {
  it('écrit le palier et le réseau en toutes lettres, sans badge', async () => {
    // **C'est la correction entière.** Le badge à trois barres disait le
    // palier ; les testeurs y cherchaient le réseau, qu'il n'a jamais porté.
    // Les deux sont maintenant dans la phrase — et le test vérifie **les
    // deux**, parce qu'écrire le réseau en laissant le palier codé aurait
    // corrigé la moitié du malentendu.
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId('ligne-contrepartie')).toBeTruthy());

    const ligne = screen.getByTestId('ligne-contrepartie');
    expect(ligne).toHaveTextContent(/story/);
    expect(ligne).toHaveTextContent(/Instagram/);
    expect(ligne).toHaveTextContent(/48/);
    await vue.unmount();
  });

  it('et le badge codé a bien quitté cet écran', async () => {
    // Le sens inverse, et il compte : la phrase pouvait très bien être ajoutée
    // **à côté** du badge, ce qui aurait donné trois informations pour deux.
    // Le badge survit ailleurs — sur le fil et sur les paliers — donc son
    // absence ne peut se vérifier qu'ici.
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId('offre-o1')).toBeTruthy());

    expect(screen.queryByTestId('badge-de-palier')).toBeNull();
    // Le mot en capitales est la forme du badge ; la phrase l'écrit en bas de
    // casse. Le trouver en capitales voudrait dire qu'un badge est revenu.
    expect(screen.queryByText(en.parcours.reserver.toUpperCase())).toBeNull();
    expect(screen.queryByText('STORY')).toBeNull();
    await vue.unmount();
  });

  it('dit le créneau en repère humain, jamais en date brute', async () => {
    // « 08/08/2026, 14:30 » demandait de calculer. Le créneau du montage est à
    // deux heures d'ici : c'est aujourd'hui, sauf à cheval sur minuit — le
    // test accepte donc aujourd'hui **ou** demain, et refuse la date.
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId('prochain-creneau')).toBeTruthy());

    const ligne = screen.getByTestId('prochain-creneau');
    const aujourdhui = en.parcours.ficheProchainAujourdhui.trim();
    const demain = en.parcours.ficheProchainDemain.trim();
    expect(
      ligne.props.children !== undefined &&
        (String(JSON.stringify(ligne)).includes(aujourdhui) ||
          String(JSON.stringify(ligne)).includes(demain)),
    ).toBe(true);
    // Une date au format machine n'apparaît nulle part sur la ligne.
    expect(ligne).not.toHaveTextContent(/\d{2}\/\d{2}\/\d{4}/);
    await vue.unmount();
  });

  it('annonce les créneaux suivants à côté du bouton, et pas au-delà de deux', async () => {
    // Ils occupent la place que le bouton libère et disent qu'il y a un choix.
    // **Le montage en porte quatre**, et c'est ce qui sépare les deux
    // implémentations : avec trois, « tous les suivants » et « les deux
    // suivants » rendent la même ligne. Le quatrième doit manquer, sinon la
    // ligne devient la liste que l'écran des créneaux porte déjà.
    const creneaux = [dansNHeures(2), dansNHeures(4), dansNHeures(6), dansNHeures(8)];
    const vue = await monter({
      ...FICHE,
      offres: [{ ...OFFRE, prochains_creneaux: creneaux }],
    } as unknown as FichePublique);
    await waitFor(() => expect(screen.getByTestId('autres-creneaux')).toBeTruthy());

    const heure = (iso: string) => formatHeure(iso, 'en', FICHE.timezone);
    const ligne = screen.getByTestId('autres-creneaux');
    expect(ligne).toHaveTextContent(new RegExp(heure(creneaux[1])));
    expect(ligne).toHaveTextContent(new RegExp(heure(creneaux[2])));
    expect(ligne).not.toHaveTextContent(new RegExp(heure(creneaux[3])));
    // Et le premier n'y est pas : il est déjà sur la ligne de l'horloge, et le
    // répéter ferait croire à un créneau de plus.
    expect(ligne).not.toHaveTextContent(new RegExp(heure(creneaux[0])));
    await vue.unmount();
  });

  it('et se tait quand il n’y a qu’un créneau', async () => {
    // « et aussi » suivi de rien serait pire que le silence.
    const vue = await monter({
      ...FICHE,
      offres: [{ ...OFFRE, prochains_creneaux: [dansNHeures(2)] }],
    } as unknown as FichePublique);
    await waitFor(() => expect(screen.getByTestId('reserver')).toBeTruthy());

    expect(screen.queryByTestId('autres-creneaux')).toBeNull();
    await vue.unmount();
  });
});

describe('le bouton cesse d’être la surface dominante', () => {
  it('ne s’étire plus sur toute la largeur', async () => {
    // **316 points contre 89.** Trois aplats orange pleine largeur empilés
    // faisaient trois promotions. Le bouton du système est déjà une pilule ;
    // il s'étirait parce que `fullWidth` vaut `true` par défaut. Le test lit
    // `alignSelf`, qui est ce que ce défaut produit — vérifier une largeur en
    // points supposerait une mise en page que le test ne fait pas.
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId('reserver')).toBeTruthy());

    const aplati = (style: unknown): Record<string, unknown> =>
      Array.isArray(style)
        ? Object.assign({}, ...style.map(aplati))
        : ((style ?? {}) as Record<string, unknown>);

    expect(aplati(screen.getByTestId('reserver').props.style).alignSelf).not.toBe('stretch');
    await vue.unmount();
  });
});

describe('une prestation fermée reste lisible', () => {
  const FERMEE = {
    ...OFFRE,
    accessible: false,
    prochains_creneaux: [],
    obstacles: [
      {
        raison: 'not_enough_followers',
        requis: 50_000,
        constate: 32_000,
        ecart: 18_000,
        depuis: null,
      },
    ],
  };

  it('garde son opacité pleine, et n’atténue que la vignette', async () => {
    // **C'est le défaut que la revue nomme.** À 75 % sur le bloc entier,
    // l'explication devenait illisible en même temps que la prestation —
    // c'est-à-dire le seul élément utile d'un bloc fermé.
    const vue = await monter({ ...FICHE, offres: [FERMEE] } as unknown as FichePublique);
    await waitFor(() => expect(screen.getByTestId('offre-fermee')).toBeTruthy());

    const aplati = (style: unknown): Record<string, unknown> =>
      Array.isArray(style)
        ? Object.assign({}, ...style.map(aplati))
        : ((style ?? {}) as Record<string, unknown>);

    const bloc = aplati(screen.getByTestId('offre-o1').props.style);
    const vignette = aplati(screen.getByTestId('offre-vignette').props.style);

    expect(bloc.opacity ?? 1).toBe(1);
    // **Et la vignette, elle, s'atténue.** Sans cette moitié, un bloc qui ne
    // distinguerait plus du tout l'ouvert du fermé passerait le test.
    expect(Number(vignette.opacity)).toBeLessThan(1);
    await vue.unmount();
  });

  it('porte l’obstacle dans un encart, avec son chiffre dans la phrase', async () => {
    // L'obstacle passe d'une légende en gris à un encart à lui. Les mêmes
    // codes que sur l'écran des paliers : deux vocabulaires pour un même refus
    // feraient croire à deux causes.
    const vue = await monter({ ...FICHE, offres: [FERMEE] } as unknown as FichePublique);
    await waitFor(() => expect(screen.getByTestId('offre-fermee')).toBeTruthy());

    expect(screen.getByTestId('obstacle-not_enough_followers')).toBeTruthy();
    // 32 000 sur 50 000 dépasse les 60 % : l'écart se chiffre et la barre se
    // dessine. C'est la règle de la v0.7, et elle vit dans `formeDe`.
    expect(screen.getByTestId('jauge-not_enough_followers')).toBeTruthy();
    await vue.unmount();
  });

  it('et sous 60 %, le seuil sans la barre', async () => {
    // Le sens inverse. Une barre presque vide décourage plus qu'elle n'informe,
    // et un test qui n'éprouverait que le cas chiffré laisserait la bascule
    // libre de disparaître.
    const vue = await monter({
      ...FICHE,
      offres: [
        {
          ...FERMEE,
          obstacles: [
            {
              raison: 'not_enough_followers',
              requis: 50_000,
              constate: 4_000,
              ecart: 46_000,
              depuis: null,
            },
          ],
        },
      ],
    } as unknown as FichePublique);
    await waitFor(() => expect(screen.getByTestId('offre-fermee')).toBeTruthy());

    expect(screen.getByTestId('obstacle-not_enough_followers')).toBeTruthy();
    expect(screen.queryByTestId('jauge-not_enough_followers')).toBeNull();
    await vue.unmount();
  });

  it('sépare les fermées des ouvertes par un titre qui dit ce qui commence', async () => {
    // Mêlée aux autres, une prestation fermée se lisait comme une erreur
    // d'affichage. Le montage porte les deux : avec une seule, le séparateur
    // se rendrait ou non sans que ça prouve quoi que ce soit.
    const vue = await monter({
      ...FICHE,
      offres: [OFFRE, { ...FERMEE, tier_offer_id: 'o2' }],
    } as unknown as FichePublique);
    await waitFor(() => expect(screen.getByTestId('pas-encore-ouvert')).toBeTruthy());

    expect(screen.getByTestId('offre-o1')).toBeTruthy();
    expect(screen.getByTestId('offre-o2')).toBeTruthy();
    await vue.unmount();
  });

  it('et pas de séparateur quand tout est ouvert', async () => {
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId('offre-o1')).toBeTruthy());

    expect(screen.queryByTestId('pas-encore-ouvert')).toBeNull();
    await vue.unmount();
  });
});

describe('la galerie et la carte cessent d’être invisibles', () => {
  it('le compte de photos est posé sur la couverture', async () => {
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId('couverture')).toBeTruthy());

    expect(screen.getByTestId('acces-galerie')).toHaveTextContent(/2/);
    await vue.unmount();
  });

  it('et l’entrée survit à un salon sans couverture déclarée', async () => {
    // **Le cas qu'un montage complet n'éprouve jamais.** La galerie s'ouvrant
    // depuis l'image, un salon qui a des photos et pas de couverture perdait sa
    // porte entière. La première photo tient ce rôle — c'est une photo du lieu.
    const vue = await monter({
      ...FICHE,
      cover_photo_key: null,
    } as unknown as FichePublique);
    await waitFor(() => expect(screen.getByTestId('couverture')).toBeTruthy());

    expect(screen.getByTestId('acces-galerie')).toBeTruthy();
    await vue.unmount();
  });

  it('et pas de couverture du tout quand il n’y a aucune image', async () => {
    // Un aplat gris de 270 points en tête d'une fiche est une absence qui prend
    // plus de place que ce qu'elle remplace.
    const vue = await monter({
      ...FICHE,
      cover_photo_key: null,
      photos: [],
    } as unknown as FichePublique);
    await waitFor(() => expect(screen.getByTestId('offre-o1')).toBeTruthy());

    expect(screen.queryByTestId('couverture')).toBeNull();
    expect(screen.queryByTestId('acces-galerie')).toBeNull();
    await vue.unmount();
  });
});

describe('les deux formes de la contrepartie s’accordent', () => {
  it('le délai composé est celui que la phrase courte écrit déjà', async () => {
    // **Deux vérités qui pourraient diverger sans qu'on le voie.** La phrase
    // courte vit dans `produit.json` en toutes lettres — « One story within
    // 48 h » — et la longue se compose de trois morceaux, dont `delaiHeures`.
    // Rien d'autre ne les rapproche : un jour où le délai d'un palier change,
    // il changera dans l'une et pas dans l'autre, et les deux écrans qui les
    // rendent diront deux choses.
    //
    // Le test lit le nombre **dans la prose** plutôt que de le recopier ici :
    // une constante écrite dans le test serait une troisième vérité.
    const produit = require('../src/theme/produit.json');

    for (const palier of produit.tier.order as string[]) {
      const config = produit.tier[palier];
      const dansLaProse = /(\d+)\s*h/.exec(config.counterpart.en);
      expect({ palier, trouve: dansLaProse !== null }).toEqual({ palier, trouve: true });
      expect({ palier, heures: Number(dansLaProse![1]) }).toEqual({
        palier,
        heures: config.delaiHeures,
      });
    }
  });
});

/**
 * Les deux portes de la fiche, et pourquoi elles passaient inaperçues.
 *
 * Les testeurs n'ont mentionné ni la galerie ni la carte. Elles existaient
 * pourtant, bien placées : une pastille comptée sur la couverture, une ligne
 * nommée entre l'identité et les prestations. Ce qui leur manquait est plus
 * discret — **aucune des deux ne répondait au doigt**. Une dispense de la garde
 * du retour au toucher, posée sur le fichier entier pour un voile de fermeture,
 * les couvrait toutes les deux.
 *
 * Une pastille posée sur une photo ressemble déjà à une étiquette ; sans retour
 * à l'appui, rien ne distingue le moment où on l'a pressée du moment où on a
 * touché l'image. C'est ce qui la fait lire comme une légende.
 */
describe('la galerie et la carte se voient, et répondent', () => {
  it('la pastille de la galerie ouvre la visionneuse', async () => {
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId('acces-galerie')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('acces-galerie'));

    await waitFor(() => expect(screen.getByTestId('visionneuse-de-galerie')).toBeTruthy());
    await vue.unmount();
  });

  it('la ligne de la carte ouvre ses pages', async () => {
    const vue = await monter({
      ...FICHE,
      menu_pages: ['p1', 'p2'],
    } as unknown as FichePublique);
    await waitFor(() => expect(screen.getByTestId('acces-carte')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('acces-carte'));

    await waitFor(() => expect(screen.getByTestId('visionneuse-de-carte')).toBeTruthy());
    await vue.unmount();
  });

  it('et n’annonce pas de carte à un salon qui n’en a pas', async () => {
    // La divergence : le décor de base n'a ni page ni lien, et la ligne ne se
    // rend pas. Sans ce cas, un écran qui afficherait toujours la ligne
    // passerait le test précédent — et mènerait à une visionneuse vide.
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId('couverture')).toBeTruthy());

    expect(screen.queryByTestId('acces-carte')).toBeNull();
    await vue.unmount();
  });

  it('les deux portes répondent à l’appui', () => {
    // **Sur la source, et c'est délibéré.** L'état pressé d'un `Pressable` ne
    // se rend pas dans l'arbre de test : ce qui se vérifie est que le style est
    // une fonction de `pressed`, c'est-à-dire que la réponse existe. La garde
    // générale dit la même chose pour tout le produit ; ce test la redit ici
    // parce que ces deux nœuds ont vécu des mois sous une dispense.
    const source = readFileSync(
      join(__dirname, '..', 'src', 'screens', 'FicheScreen.tsx'),
      'utf-8',
    );

    for (const marqueur of ['acces-galerie', 'onPress={onPress}']) {
      const depuis = source.indexOf(marqueur);
      expect({ marqueur, trouve: depuis !== -1 }).toEqual({ marqueur, trouve: true });
      // Le style suit la balise de près : on lit la fenêtre qui la contient.
      const fenetre = source.slice(depuis, depuis + 700);
      expect({ marqueur, repond: /style=\{\(\{ pressed \}\)/.test(fenetre) }).toEqual({
        marqueur,
        repond: true,
      });
    }
  });
});
