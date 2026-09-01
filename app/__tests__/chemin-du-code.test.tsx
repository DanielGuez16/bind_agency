/**
 * Le chemin vers le code de retrait, depuis la liste.
 *
 * **C'est le seul geste sans lequel rien ne se consomme.** La créatrice arrive
 * au comptoir et montre un code ; s'il n'est pas atteignable, la prestation ne
 * se sert pas et toute la boucle du produit s'arrête là.
 *
 * **Trois pièces gardées séparément, et leur jonction ne l'était pas.**
 * `attenteDe` dit que la ligne attend un geste, `destination` dit lequel, et la
 * pile monte l'écran — chacune avait son test, aucun ne traversait les trois.
 * Une refonte qui déplace la liste les laisse toutes vertes et le parcours
 * mort, ce qui est exactement ce qu'on redoute d'une v3.
 *
 * Cette garde part donc de la liste et finit sur l'écran, en pressant ce qu'une
 * créatrice presserait.
 */
import { NavigationContainer } from '@react-navigation/native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { PileDesReservations } from '../src/shell/Navigation';
import { ThemeProvider } from '../src/theme';

const DANS_UNE_HEURE = new Date(Date.now() + 3600e3).toISOString();
const DEMAIN = new Date(Date.now() + 86_400e3).toISOString();

/**
 * Une réservation confirmée dont le droit court encore.
 *
 * **Les dates sont relatives à maintenant, jamais figées.** Un `valid_until`
 * écrit en dur finit par passer, et le test affirme alors qu'un droit périmé
 * ouvre le code — le dépôt s'est déjà fait prendre ainsi.
 */
const CONFIRMEE = {
  booking_id: 'r1',
  status: 'confirmed',
  starts_at: DANS_UNE_HEURE,
  ends_at: DANS_UNE_HEURE,
  valid_until: DEMAIN,
  approval_expires_at: null,
  created_at: DANS_UNE_HEURE,
  business_id: 'b1',
  business_name: 'Vela Nail Studio',
  business_category: 'beauty',
  business_address: null,
  business_timezone: 'America/New_York',
  business_cover_photo_key: null,
  item_name: 'Gel manicure',
  item_photo_key: null,
  duration_minutes: 45,
  platform: 'instagram',
  content_format: 'story',
  contrepartie: null,
};

function clientDe(items: unknown[]) {
  return new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: async (url) => {
      const chemin = String(url);
      // **L'ordre compte** : le code vit sur `/bookings/{id}/code`, qui contient
      // `/bookings`. Tester la liste en premier lui donnait la réponse de la
      // liste, et l'écran d'arrivée plantait sur un champ absent — ce qui se lit
      // exactement comme une navigation qui n'aboutit pas.
      if (chemin.includes('/code')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            booking_id: 'r1',
            payload: 'c1:4H2K9P',
            code: '4H2K9P',
            manual_code: '4H2K9P',
            seconds_remaining: 120,
            rotation_seconds: 30,
          }),
        } as Response;
      }
      // La liste.
      return {
        ok: true,
        status: 200,
        json: async () => ({ items, compteurs: {} }),
      } as Response;
    },
  });
}

async function monter(items: unknown[]) {
  return render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={clientDe(items)}>
          <NavigationContainer>
            <PileDesReservations />
          </NavigationContainer>
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('le code de retrait est atteignable depuis la liste', () => {
  it('la ligne d’une réservation confirmée porte le geste, sous le bon titre', async () => {
    await monter([CONFIRMEE]);
    // **L'onglet ouvert n'est plus « à venir ».** Depuis la v7 les onglets
    // suivent l'ordre de ce qu'on doit faire : ce qui court contre une échéance
    // passe devant un rendez-vous de la semaine prochaine.
    await fireEvent.press(screen.getByLabelText(new RegExp(en.parcours.ongletAVenir)));
    await waitFor(() => expect(screen.getByTestId('reservation-r1')).toBeTruthy());

    // **Les deux sections de « à venir » partent avec la v10** : une carte dit
    // elle-même ce qu'elle attend, par sa ligne du haut et par sa pilule. Ce
    // qui reste à vérifier est que le geste est là, et qu'il nomme le code.
    expect(screen.getByTestId('agir-r1')).toHaveTextContent(en.parcours.action_code);
  });

  it('et l’appui mène à l’écran du code', async () => {
    // **La jonction, qu'aucun test ne traversait.** C'est elle qui disparaît
    // quand une refonte déplace la liste, en laissant les trois pièces vertes.
    await monter([CONFIRMEE]);
    await waitFor(() => expect(screen.getByTestId('agir-r1')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('agir-r1'));

    await waitFor(() => expect(screen.getByTestId('ecran-code')).toBeTruthy());
  });

  it('ne le propose pas quand le droit a expiré', async () => {
    // La divergence : même réservation, même statut, seule la validité change.
    // Sans ce cas, un écran qui proposerait toujours le code passerait aussi —
    // et le serveur refuse alors, ce qui se lit comme une panne le jour du
    // rendez-vous.
    const perimee = { ...CONFIRMEE, valid_until: new Date(Date.now() - 3600e3).toISOString() };
    await monter([perimee]);
    await waitFor(() => expect(screen.getByTestId('reservation-r1')).toBeTruthy());

    expect(screen.queryByTestId('agir-r1')).toBeNull();

    // **Et la ligne dit pourquoi.** C'est le cas le plus probable d'un
    // « je ne trouve pas le code » : une base semée il y a des jours, un droit
    // arrivé à terme, et un bouton qui disparaît. Sans cette phrase la ligne se
    // tait, et l'absence se lit comme un chemin perdu plutôt que comme un droit
    // expiré.
    expect(screen.getByTestId('droit-perime-r1')).toBeTruthy();
  });
});
