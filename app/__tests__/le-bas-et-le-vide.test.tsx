/**
 * Les deux cadres qui encadrent le mur : le vide, et le bas.
 *
 * Ils ont la même règle sous deux formes : **un aperçu vaut mieux qu'une
 * promesse, et les deux issues portent leur nombre**. « Élargir à 30 km » sans
 * chiffre demande de tenter pour voir, et personne ne tente deux fois.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider, type CommerceDuFil, type Fil } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { BasDuMur } from '../src/screens/mur/Mur';
import { ThemeProvider } from '../src/theme';

function salon(rang: number, format = 'story'): CommerceDuFil {
  return {
    business_id: `b${rang}`,
    name: `Salon ${rang}`,
    category: 'beauty',
    address: null,
    cover_photo_key: null,
    cover_portrait_key: null,
    neighborhood: 'wynwood',
    distance_metres: 100 * rang,
    items: [
      {
        tier_offer_id: `o${rang}`,
        catalog_item_id: `i${rang}`,
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
        content_format: format,
        value_ratio: null,
      },
    ],
  } as unknown as CommerceDuFil;
}

function fil(extra: Partial<Fil> = {}): Fil {
  return {
    commerces: [salon(1), salon(2, 'post'), salon(3, 'reel')],
    obstacles: [],
    rayon_metres: 15000,
    total_prestations: 3,
    categories: [],
    rayons: [],
    quartiers: [
      { quartier: 'wynwood', commerces: 2, prestations: 3, distance_metres: 200 },
      { quartier: 'brickell', commerces: 1, prestations: 1, distance_metres: 900 },
    ],
    prochain_palier: null,
    ...extra,
  } as unknown as Fil;
}

async function monter(donnees: Fil, props: Record<string, unknown> = {}) {
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => donnees }) as Response,
  });
  return render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={api}>
          <BasDuMur fil={donnees} rayonKm={15} {...props} />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('le bas du mur compte ce qui a été vu', () => {
  it('les salons et les quartiers, tels que le fil les rend', async () => {
    // **Pas « vingt » parce que la planche l'illustre.** Le compte vient de ce
    // qui est rendu : le jeu de démonstration en a dix-neuf visibles, et le
    // pied doit dire dix-neuf.
    await monter(fil());
    await waitFor(() => expect(screen.getByTestId('bas-du-mur')).toBeTruthy());

    expect(screen.getByTestId('bilan-salons')).toHaveTextContent(/\b3\b/);
    expect(screen.getByTestId('bilan-quartiers')).toHaveTextContent(/\b2\b/);
  });

  it('et la répartition par contrepartie, comptée ici', async () => {
    // « Il compte ce qui a été **vu** par palier » : c'est un décompte des
    // salons rendus, pas une statistique du serveur.
    await monter(fil());
    await waitFor(() => expect(screen.getByTestId('par-contrepartie')).toBeTruthy());

    for (const format of ['story', 'post', 'reel']) {
      expect(screen.getByTestId(`vu-${format}`)).toHaveTextContent(new RegExp('^1' + format.toUpperCase()));
    }
  });

  it('et ne montre pas une contrepartie que personne n’a croisée', async () => {
    // Le sens inverse : un « 0 REEL » sur un fil sans reel occuperait la place
    // d'une information pour dire une absence que personne n'a cherchée.
    await monter(fil({ commerces: [salon(1), salon(2)] }));
    await waitFor(() => expect(screen.getByTestId('par-contrepartie')).toBeTruthy());

    expect(screen.getByTestId('vu-story')).toBeTruthy();
    expect(screen.queryByTestId('vu-post')).toBeNull();
    expect(screen.queryByTestId('vu-reel')).toBeNull();
  });
});

describe('les deux sorties portent leur nombre', () => {
  it('l’élargissement dit ce qu’il ouvrirait', async () => {
    await monter(
      fil({ rayons: [{ rayon_metres: 30000, commerces: 14, prestations: 20 }] as Fil['rayons'] }),
      { onElargir: jest.fn() },
    );
    await waitFor(() => expect(screen.getByTestId('sortie-elargir')).toBeTruthy());

    const sortie = screen.getByTestId('sortie-elargir');
    expect(sortie).toHaveTextContent(/\b30\b/);
    expect(sortie).toHaveTextContent(/\b14\b/);
  });

  it('et un élargissement qui n’ouvrirait rien ne se propose pas', async () => {
    // **Une issue à zéro est un cul-de-sac chiffré**, ce qui est pire qu'une
    // issue absente : elle promet un geste dont on revient bredouille.
    await monter(
      fil({ rayons: [{ rayon_metres: 30000, commerces: 0, prestations: 0 }] as Fil['rayons'] }),
      { onElargir: jest.fn() },
    );
    await waitFor(() => expect(screen.getByTestId('bas-du-mur')).toBeTruthy());

    expect(screen.queryByTestId('sortie-elargir')).toBeNull();
  });

  it('et resserrer est une annulation, sans nombre', async () => {
    // **Les deux autres sorties portent leur nombre parce qu'elles promettent
    // un gain qu'on ne peut pas deviner.** Celle-ci ramène à l'état d'où l'on
    // vient, qu'on a vu : lui coller un compte demanderait une requête pour
    // dire ce qu'on savait déjà. Ce qu'elle doit dire est où elle ramène.
    const revenir = jest.fn();
    await monter(fil(), { rayonKm: 30, resserrer: { versKm: 15, onPress: revenir } });
    await waitFor(() => expect(screen.getByTestId('sortie-resserrer')).toBeTruthy());

    const sortie = screen.getByTestId('sortie-resserrer');
    expect(sortie).toHaveTextContent(/\b15\b/);
    expect(sortie).not.toHaveTextContent(/\b30\b/);

    await fireEvent.press(sortie);
    expect(revenir).toHaveBeenCalledTimes(1);
  });

  it('sans chemin fourni, la sortie ne s’affiche pas', async () => {
    await monter(
      fil({ rayons: [{ rayon_metres: 30000, commerces: 14, prestations: 20 }] as Fil['rayons'] }),
    );
    await waitFor(() => expect(screen.getByTestId('bas-du-mur')).toBeTruthy());

    expect(screen.queryByTestId('sortie-elargir')).toBeNull();
    expect(screen.queryByTestId('sortie-remonter')).toBeNull();
    expect(screen.queryByTestId('sortie-resserrer')).toBeNull();
  });
});

describe('la seule fois où le fil parle des paliers', () => {
  const PROCHAIN = {
    tier_id: 't2',
    content_format: 'post',
    commerces_de_plus: 6,
    obstacle: { raison: 'not_enough_followers', requis: 10000, constate: 7600, ecart: 2400, depuis: null },
  };

  it('nomme le palier, ce qu’il ouvrirait, et ce qui manque', async () => {
    // Depuis que les paliers ont quitté les onglets, c'est le seul endroit du
    // produit où une créatrice croise ce qui lui manque sans l'avoir cherché.
    await monter(fil({ prochain_palier: PROCHAIN as unknown as Fil['prochain_palier'] }));
    await waitFor(() => expect(screen.getByTestId('prochain-palier')).toBeTruthy());

    const pied = screen.getByTestId('prochain-palier');
    expect(pied).toHaveTextContent(/post/);
    expect(pied).toHaveTextContent(/\b6\b/);
    expect(pied).toHaveTextContent(/2400|2 400/);
    expect(pied).toHaveTextContent(/10000|10 000/);
  });

  it('et se tait quand il n’y a pas de palier suivant', async () => {
    // **Ce n'est pas un repli défensif, c'est un état que le produit atteint :**
    // tout ouvert, ou aucun palier atteignable. Promettre un palier qui n'existe
    // pas serait pire que se taire.
    await monter(fil({ prochain_palier: null }));
    await waitFor(() => expect(screen.getByTestId('bas-du-mur')).toBeTruthy());

    expect(screen.queryByTestId('prochain-palier')).toBeNull();
  });
});
