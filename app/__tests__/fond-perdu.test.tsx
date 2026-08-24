/**
 * Le fil va au bord, et le reste garde sa marge.
 *
 * **Le mur perd la moitié de son effet encadré.** Ses photos sont des surfaces
 * pleines : vingt points de papier autour les transforment en cartes, ce que le
 * mur existe précisément pour ne pas être. Et sur les rangées par quartier, ce
 * sont les cartes qui **dépassent le bord droit** qui annoncent le glissement —
 * la planche est explicite, « sans flèche ». Dépassant le bord d'une boîte en
 * retrait, elles l'annoncent moins.
 *
 * La règle qui en sort et que ce fichier éprouve : **`Ecran` marge ce qu'il
 * compose, l'appelant marge ce qu'il fournit.** Le bandeau d'erreur et le
 * squelette par défaut sont écrits dans `Ecran`, donc ils gardent leur marge
 * même à fond perdu. L'en-tête, le corps, l'état vide et un squelette fourni
 * viennent de l'écran, qui seul sait lesquels de ses blocs touchent le bord.
 *
 * **Une marge négative aurait été plus courte à écrire et fausse.** Elle se
 * serait fait rogner par le défileur sur un téléphone, où le conteneur occupe
 * déjà toute la largeur — et sur un grand écran, où il est plus étroit que le
 * défileur, elle serait passée. Un défaut qui n'apparaît que sous le seuil de
 * largeur est exactement ce qu'aucun test de rendu ne voit.
 */
import { render, screen, waitFor, within } from '@testing-library/react-native';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { FilScreen } from '../src/screens/FilScreen';
import { ThemeProvider } from '../src/theme';

const FIL = {
  commerces: [
    {
      business_id: 'b1',
      name: 'Salon Ocean',
      category: 'beauty',
      address: null,
      cover_photo_key: null,
      cover_portrait_key: null,
      neighborhood: 'wynwood',
      distance_metres: 320,
      prestations_ouvertes: 1,
      // **Une prestation, et non une liste vide.** Le fil rend des cartes de
      // prestation depuis la v5 : un commerce sans article ne pose aucune
      // carte, et le mur n'existe alors pas.
      items: [
        {
          tier_offer_id: 'o1',
          catalog_item_id: 'i1',
          tier_id: 't1',
          social_account_id: 's1',
          name: 'Gel manicure',
          description: null,
          price_cents: 4500,
          currency: 'USD',
          duration_minutes: 45,
          requires_booking: true,
          photo_key: null,
          platform: 'instagram',
          content_format: 'story',
          value_ratio: null,
          est_favori: false,
        },
      ],
    },
  ],
  obstacles: [],
  rayon_metres: 15_000,
  total_prestations: 1,
  categories: [{ categorie: 'beauty', commerces: 1, prestations: 1 }],
  rayons: [],
  quartiers: [{ quartier: 'wynwood', commerces: 1, prestations: 1, distance_metres: 320 }],
  prochain_palier: null,
};

/** Le style d'un nœud, tableau ou non. */
function aplati(noeud: { props?: { style?: unknown } }): Record<string, unknown> {
  const style = noeud.props?.style;
  return Array.isArray(style)
    ? Object.assign({}, ...style.filter(Boolean))
    : ((style as Record<string, unknown>) ?? {});
}

/**
 * Tout ce qui peut poser une marge sur un nœud.
 *
 * **`contentContainerStyle` et non `style` seulement.** La marge de l'écran vit
 * exactement là, sur le `ScrollView` — et une première version de ce fichier ne
 * lisait que `style` : elle passait au vert avec le fond perdu débranché,
 * c'est-à-dire sur le défaut qu'elle prétendait interdire. Trouvée par mutation,
 * pas par relecture.
 */
function marges(noeud: { props?: { style?: unknown; contentContainerStyle?: unknown } }) {
  const conteneur = noeud.props?.contentContainerStyle;
  return {
    ...aplati(noeud),
    ...(Array.isArray(conteneur)
      ? Object.assign({}, ...conteneur.filter(Boolean))
      : ((conteneur as Record<string, unknown>) ?? {})),
  };
}

async function monter(reponse: { ok: boolean; corps: unknown }) {
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: async () =>
      ({
        ok: reponse.ok,
        status: reponse.ok ? 200 : 500,
        json: async () => reponse.corps,
      }) as Response,
  });

  return await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={api}>
          <FilScreen
            position={{ longitude: -80.19, latitude: 25.76 }}
            onDemanderLaPosition={() => {}}
            onVoirMesFavoris={() => {}}
            onOuvrirLeCommerce={() => {}}
          />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('le fil rend ses marges, et les repose lui-même', () => {
  it('le mur touche les bords', async () => {
    await monter({ ok: true, corps: FIL });
    await waitFor(() => expect(screen.getByTestId('le-mur')).toBeTruthy());

    // On remonte du mur jusqu'à la racine : aucune marge latérale sur le
    // chemin. Regarder le seul style du mur ne prouverait rien — c'est un
    // conteneur au-dessus qui posait les vingt points.
    for (
      let noeud: ReturnType<typeof screen.getByTestId> | null = screen.getByTestId('le-mur');
      noeud;
      noeud = noeud.parent
    ) {
      const style = marges(noeud);
      for (const clef of ['padding', 'paddingHorizontal', 'paddingLeft', 'marginLeft']) {
        expect(style[clef] ?? 0).toBe(0);
      }
    }
  });

  /** Le titre de la première rangée, qui est le premier texte du mur. */
  const dansLaRangee = () => within(screen.getByTestId('rangee-proches')).getByText(/Closest/);

  it('mais le texte du fil garde la sienne', async () => {
    // La contrepartie du fond perdu : les blocs de texte portent leur marge,
    // et elle se voit là où elle est. Sans elle, le nom du quartier commencerait
    // au ras du verre.
    //
    // **La cible a changé deux fois.** Le test lisait « douze prestations vous
    // sont ouvertes », parti vers Audience ; puis la tête de quartier, partie
    // avec le mur vertical. Le repère est maintenant le titre d'une rangée,
    // qui est le premier texte du mur — et c'est le bon : cette ligne-là est
    // **dans** le mur, alors que la première était au-dessus de lui.
    await monter({ ok: true, corps: FIL });
    await waitFor(() => expect(dansLaRangee()).toBeTruthy());

    let marge = 0;
    for (
      let noeud: ReturnType<typeof screen.getByTestId> | null =
        dansLaRangee();
      noeud;
      noeud = noeud.parent
    ) {
      const style = marges(noeud);
      marge += Number(style.paddingHorizontal ?? 0) + Number(style.padding ?? 0);
    }
    expect(marge).toBeGreaterThan(0);
  });

  it('et le bandeau d’erreur aussi, parce qu’`Ecran` le compose', async () => {
    // **La règle : `Ecran` marge ce qu'il compose, l'appelant ce qu'il
    // fournit.** Le bandeau d'erreur est écrit dans `Ecran` et n'a aucune
    // raison de toucher le bord ; l'écran qui demande le fond perdu ne le voit
    // même pas passer.
    await monter({ ok: false, corps: { detail: 'boom' } });
    await waitFor(() => expect(screen.getByTestId('etat-erreur')).toBeTruthy());

    expect(aplati(screen.getByTestId('etat-erreur')).paddingHorizontal).toBeGreaterThan(0);
  });
});
