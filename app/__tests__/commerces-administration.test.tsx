/**
 * L'onglet des salons, côté administration.
 *
 * Ce qu'il répare dépasse la mise en page : l'écran de reprise était greffé sur
 * la fiche de tournée, donc on ne pouvait reprendre **que les salons venus du
 * terrain**. Un salon inscrit tout seul était hors d'atteinte du support, et
 * rien ne le disait.
 *
 * Les tests portent donc sur les trois propriétés qui font tenir l'écran :
 * tous les états sont listés, lire n'ouvre rien, et le bord de la liste se dit.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { CommercesScreen, PLAFOND } from '../src/screens/CommercesScreen';
import { ThemeProvider } from '../src/theme';

const coffre = { lire: async () => null, ecrire: async () => {} };

/**
 * Un fragment, et non le texte entier.
 *
 * `toHaveTextContent` compare **tout** le contenu quand on lui donne une
 * chaîne : sur une ligne qui porte un nom, un quartier, un état et un bouton,
 * l'assertion échoue alors que le mot cherché y est. Le piège se paie deux fois
 * — la première à l'écrire, la seconde à croire que l'écran ne rend rien.
 */
function fragment(texte: string) {
  return new RegExp(texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

function salon(extra: Record<string, unknown> = {}) {
  return {
    business_id: 'b1',
    name: 'Vela Nail Studio',
    category: 'beauty',
    neighborhood: 'wynwood',
    status: 'active',
    reprise_en_cours: false,
    // **Une date écrite, et sans danger ici.** La règle des décors interdit les
    // dates figées quand le verdict dépend du calendrier ; une date
    // d'inscription n'a aucun seuil — elle se rend, elle ne se compare pas.
    created_at: '2026-08-12T09:00:00Z',
    ...extra,
  };
}

/**
 * Ce que chaque appel a demandé, pour éprouver que la recherche part au serveur.
 *
 * `total` par défaut est le nombre de lignes rendues — le cas ordinaire, où la
 * recherche tient sous la borne. Les tests du bord le posent au-dessus : c'est
 * **le serveur** qui dit combien la recherche a trouvé, et l'écran ne peut plus
 * le déduire de ce qu'il affiche.
 */
function clientDe(
  reponse: (recherche: string | null) => unknown[],
  demandes: string[] = [],
  total?: number,
) {
  return new ApiClient({
    baseUrl: 'https://api.test',
    coffre,
    fetchImpl: async (url) => {
      const chemin = String(url);
      if (!chemin.includes('/admin/businesses')) {
        throw new Error(`route non simulée : ${chemin}`);
      }
      const recherche = new URL(chemin, 'https://api.test').searchParams.get('recherche');
      demandes.push(recherche ?? '');
      const items = reponse(recherche);
      return {
        ok: true,
        status: 200,
        json: async () => ({ items, total: total ?? items.length }),
      } as Response;
    },
  });
}

function monter(api: ApiClient) {
  return render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="admin">
        <ApiProvider client={api}>
          <CommercesScreen />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('la liste des salons', () => {
  it('porte tous les états, pas seulement les ouverts', async () => {
    // **C'est le point de l'écran.** Un salon en inscription est celui qu'on
    // vient débloquer, un suspendu celui dont on vient comprendre pourquoi :
    // ne lister que les ouverts écarterait les deux cas qui motivent une
    // reprise. Le décor porte donc les quatre états — un décor à quatre salons
    // « actifs » passerait aussi bien sur une liste filtrée.
    await monter(
      clientDe(() => [
        salon({ business_id: 'b1', status: 'draft' }),
        salon({ business_id: 'b2', status: 'onboarding' }),
        salon({ business_id: 'b3', status: 'active' }),
        salon({ business_id: 'b4', status: 'suspended' }),
      ]),
    );
    await waitFor(() => expect(screen.getByTestId('commerce-b1')).toBeTruthy());

    expect(screen.getByTestId('commerce-b1')).toHaveTextContent(fragment(en.admin.commerceDraft));
    expect(screen.getByTestId('commerce-b2')).toHaveTextContent(fragment(en.admin.commerceOnboarding));
    expect(screen.getByTestId('commerce-b3')).toHaveTextContent(fragment(en.admin.commerceActive));
    expect(screen.getByTestId('commerce-b4')).toHaveTextContent(fragment(en.admin.commerceSuspended));
  });

  it('et lire la liste n’ouvre rien', async () => {
    // La propriété qui permet de la rendre large. Le formulaire de reprise
    // n'existe qu'après un geste, et le geste n'est toujours pas la reprise :
    // il ouvre le champ où l'on écrit le motif que le salon lira mot pour mot.
    await monter(clientDe(() => [salon()]));
    await waitFor(() => expect(screen.getByTestId('commerce-b1')).toBeTruthy());

    expect(screen.queryByTestId('reprendre-le-compte')).toBeNull();

    await act(async () => {
      await fireEvent.press(screen.getByTestId('reprendre-b1'));
    });
    await waitFor(() => expect(screen.getByTestId('reprendre-le-compte')).toBeTruthy());
  });

  it('n’ouvre aucune ligne, et ne propose qu’un mot', async () => {
    // **La retenue s'obtient en n'offrant qu'une porte, pas en avertissant.**
    // Un écran qui laisserait consulter puis dirait « attention » aurait déjà
    // laissé consulter. Ce qui existe est « reprendre », qui coûte un motif
    // écrit à la main et que le salon lira mot pour mot.
    //
    // La rangée n'est donc pas pressable — et ne s'annonce pas comme telle : un
    // `Pressable` de rôle « button » sans geste fait dire à un lecteur d'écran
    // qu'il y a un bouton sur chaque ligne d'une table qui n'en porte aucun.
    await monter(clientDe(() => [salon()]));
    await waitFor(() => expect(screen.getByTestId('commerce-b1')).toBeTruthy());

    expect(screen.getByTestId('commerce-b1').props.accessibilityRole).toBeUndefined();
    expect(screen.getByTestId('commerce-b1').props.onPress).toBeUndefined();

    // Et le seul geste de la rangée est celui-là.
    expect(screen.getByTestId('reprendre-b1')).toBeTruthy();
  });

  it('dit qu’on est déjà dedans, et ne propose pas d’y entrer deux fois', async () => {
    // Le champ est vrai pour **l'appelant** : savoir qu'un collègue est entré
    // ne change pas ce que je peux faire. Ce qu'il empêche est d'ouvrir une
    // seconde reprise sur un salon où l'on est déjà.
    await monter(clientDe(() => [salon({ reprise_en_cours: true })]));
    await waitFor(() => expect(screen.getByTestId('commerce-b1')).toBeTruthy());

    expect(screen.getByTestId('reprise-en-cours-b1')).toBeTruthy();
    expect(screen.queryByTestId('reprendre-b1')).toBeNull();
  });
});

describe('la recherche', () => {
  it('part au serveur, et non dans la liste rendue', async () => {
    // **Un filtre local mentirait exactement là où il sert.** Il ne verrait
    // que les cent premiers, c'est-à-dire pas celui qu'on cherche quand on ne
    // le trouve pas. La divergence est ici : un filtre local n'émettrait
    // jamais de seconde requête.
    const demandes: string[] = [];
    await monter(
      clientDe(
        (recherche) => (recherche ? [salon({ business_id: 'b9', name: 'Wynwood Nails' })] : [salon()]),
        demandes,
      ),
    );
    await waitFor(() => expect(screen.getByTestId('commerce-b1')).toBeTruthy());

    await act(async () => {
      await fireEvent.changeText(screen.getByTestId('recherche-commerces'), 'wyn');
    });
    await waitFor(() => expect(screen.getByTestId('commerce-b9')).toBeTruthy());

    expect(demandes).toContain('wyn');
    expect(screen.queryByTestId('commerce-b1')).toBeNull();
  });

  it('et la barre survit au vide, sinon on ne peut plus l’effacer', async () => {
    // Un filtre qui ne rend rien doit avoir une sortie. Sans la barre, l'écran
    // vide est un cul-de-sac dont on ne ressort qu'en changeant d'onglet.
    await monter(clientDe((recherche) => (recherche ? [] : [salon()])));
    await waitFor(() => expect(screen.getByTestId('commerce-b1')).toBeTruthy());

    await act(async () => {
      await fireEvent.changeText(screen.getByTestId('recherche-commerces'), 'zzz');
    });
    await waitFor(() => expect(screen.getByTestId('etat-vide')).toBeTruthy());

    expect(screen.getByTestId('recherche-commerces')).toBeTruthy();
    expect(screen.getByTestId('etat-vide')).toHaveTextContent(fragment(en.admin.commercesVideRecherche));
  });
});

describe('le bord de la liste', () => {
  it('se dit avec son remède', async () => {
    // **Sans cette ligne, un salon au-delà du centième se lit comme un salon
    // qui n'existe pas.** Et sans son remède elle constate une limite sans
    // donner de conduite : « resserrer le nom » est ce qui distingue un plafond
    // d'un cul-de-sac, sur un écran dont c'est justement la question.
    await monter(
      clientDe(
        () => Array.from({ length: PLAFOND }, (_, i) => salon({ business_id: `b${i}` })),
        [],
        742,
      ),
    );
    await waitFor(() => expect(screen.getByTestId('commerce-b0')).toBeTruthy());

    // **Le total vient du serveur.** « 100 salons » était tout ce que l'écran
    // pouvait dire d'une recherche qui en ramène sept cent quarante-deux, et
    // c'est ce chiffre-là qui donne au plafond son sens : sans lui, la phrase
    // dit qu'on tronque sans dire de combien.
    const compte = screen.getByTestId('compte-commerces');
    expect(compte).toHaveTextContent(fragment(String(PLAFOND)));
    expect(compte).toHaveTextContent(/742/);
    expect(screen.getByTestId('plafond-commerces')).toHaveTextContent(/narrow the name/i);
  });

  it('et se tait quand elle ne l’est pas', async () => {
    // Le cas qui fait diverger les deux implémentations : une mention
    // permanente ne distinguerait plus rien, et c'est la distinction qui est
    // l'information.
    await monter(
      clientDe(() =>
        Array.from({ length: PLAFOND - 1 }, (_, i) => salon({ business_id: `b${i}` })),
      ),
    );
    await waitFor(() => expect(screen.getByTestId('commerce-b0')).toBeTruthy());

    expect(screen.queryByTestId('plafond-commerces')).toBeNull();
    expect(screen.getByTestId('compte-commerces')).not.toHaveTextContent(/narrow the name/i);
  });
});
