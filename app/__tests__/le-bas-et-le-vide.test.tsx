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
          <BasDuMur {...props} />
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
describe('le pied ne porte plus que le retour en haut', () => {
  /**
   * **Les trois tests de rayon partent avec les sorties qu'ils éprouvaient.**
   * « Élargir à 30 km, 14 salons » et « revenir à 15 km » étaient la seule
   * façon de changer de rayon quand ils ont été écrits ; le curseur les
   * remplace, du kilomètre à cinquante, en tête du mur et sur l'état vide. Les
   * tordre pour qu'ils passent aurait fait croire que ces deux marches tiennent
   * encore quelque part.
   *
   * Ce que le curseur ne remplace pas — remonter en haut d'une liste qu'on
   * vient de parcourir — reste, et son test avec.
   */
  it('rend le retour en haut quand on lui donne le chemin', async () => {
    const remonter = jest.fn();
    await monter(fil(), { onRemonter: remonter });
    await waitFor(() => expect(screen.getByTestId('sortie-remonter')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('sortie-remonter'));
    expect(remonter).toHaveBeenCalledTimes(1);
  });

  it('et se tait quand aucun chemin n’est fourni', async () => {
    await monter(fil());
    await waitFor(() => expect(screen.getByTestId('bas-du-mur')).toBeTruthy());

    expect(screen.queryByTestId('sortie-remonter')).toBeNull();
  });
});

