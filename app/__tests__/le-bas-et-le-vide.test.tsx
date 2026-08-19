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
import { BasDuMur } from '../src/screens/mur/BasDuMur';
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

/**
 * **Le bilan est supprimé, et ce n'est pas un test à mettre à jour.**
 *
 * Les trois tests qui vivaient ici comptaient les salons, les quartiers et la
 * répartition par contrepartie, sous « you have seen everything within 3 km ».
 * La revue v3 supprime le pied : la fin d'une liste se voit, et la dire sur un
 * aplat d'encre en faisait un événement. Ce qu'ils protégeaient — « le compte
 * vient d'ici et non du serveur » — n'a plus d'objet puisqu'il n'y a plus de
 * compte. Les tordre pour qu'ils passent aurait fait croire que le bilan tient
 * encore quelque part.
 *
 * **La ligne du prochain palier est partie vers Audience**, et son test avec
 * elle : voir `paliers-depuis-audience`.
 */
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

