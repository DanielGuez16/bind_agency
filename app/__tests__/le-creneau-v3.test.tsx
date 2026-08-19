/**
 * L'écran des créneaux v3, monté.
 *
 * `la-bande-des-jours` éprouve les règles sans un pixel ; celui-ci dit ce que
 * l'écran **montre**. C'est la séparation que ce dépôt a déjà payée deux fois :
 * une garde qui lit une règle ne dit rien de ce qui arrive à l'œil.
 *
 * **Ce qui est protégé ici n'est pas une mise en page.** Un jour sans place qui
 * garde sa place et répond, un compte lisible sans ouvrir, un mot juste par
 * état : chacun est la correction d'un défaut nommé par la revue.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { ApiClient, ApiProvider, type FichePublique, type OffreDeLaFiche } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { CreneauxScreen } from '../src/screens/CreneauxScreen';
import { ThemeProvider } from '../src/theme';

const FUSEAU = 'America/New_York';

/**
 * Les dates de la bande, **calculées à chaque exécution**.
 *
 * La bande commence aujourd'hui chez le commerce : une date en dur en sortirait
 * au fil des semaines, et les jours du montage deviendraient invisibles sans
 * que rien ne le dise. Ce dépôt a déjà payé ce défaut sur un `valid_until`.
 */
function jourALIndex(rang: number): string {
  const base = new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU, dateStyle: 'short' }).format(
    new Date(),
  );
  const [a, m, j] = base.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, j + rang)).toISOString().slice(0, 10);
}

/**
 * **Une bande qui porte les quatre états, et c'est ce qui la rend utile.**
 *
 * Aujourd'hui est révolu, demain est fermé, le surlendemain est complet, et les
 * deux suivants sont ouverts. Sans les quatre dans le même montage, deux mots
 * pourraient rester interchangeables sans qu'aucun test ne tombe.
 */
const BANDE = [
  { jour: jourALIndex(0), ouvert: true, revolu: true, creneaux_libres: 0 },
  { jour: jourALIndex(1), ouvert: false, revolu: false, creneaux_libres: 0 },
  { jour: jourALIndex(2), ouvert: true, revolu: false, creneaux_libres: 0 },
  { jour: jourALIndex(3), ouvert: true, revolu: false, creneaux_libres: 2 },
  { jour: jourALIndex(4), ouvert: true, revolu: false, creneaux_libres: 6 },
];

const CRENEAUX = [
  { starts_at: `${jourALIndex(3)}T18:30:00Z`, ends_at: `${jourALIndex(3)}T19:15:00Z`, places_restantes: 2 },
  { starts_at: `${jourALIndex(3)}T20:00:00Z`, ends_at: `${jourALIndex(3)}T20:45:00Z`, places_restantes: 1 },
];

const OFFRE = {
  tier_offer_id: 'o1',
  catalog_item_id: 'i1',
  name: 'Gel manicure',
  duration_minutes: 45,
  requires_booking: true,
  content_format: 'story',
  platform: 'instagram',
  social_account_id: 's1',
  required_mention: '@velanailstudio',
  required_geotag: true,
  prochains_creneaux: [],
  obstacles: [],
  accessible: true,
} as unknown as OffreDeLaFiche;

const FICHE = {
  business_id: 'b1',
  name: 'Vela Nail Studio',
  timezone: FUSEAU,
  offres: [OFFRE],
} as unknown as FichePublique;

async function monter(bande = BANDE) {
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: (async (url: RequestInfo | URL) =>
      ({
        ok: true,
        status: 200,
        json: async () =>
          String(url).includes('/availability/summary') ? bande : CRENEAUX,
      }) as Response) as unknown as typeof fetch,
  });

  return render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={api}>
          <CreneauxScreen fiche={FICHE} offre={OFFRE} onReserve={() => {}} />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('la bande montre les quatorze jours, sans en sauter', () => {
  it('rend chaque jour de la bande, y compris ceux sans place', async () => {
    // **Le défaut que la v3 corrige.** L'écran listait les jours **qui avaient
    // des créneaux** : un salon fermé le jeudi voyait son jeudi disparaître, et
    // la bande passait du mercredi au vendredi sans rien dire. Un calendrier
    // qui saute des jours laisse croire qu'ils n'existent pas.
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId(`jour-${jourALIndex(3)}`)).toBeTruthy());

    for (const rang of [0, 1, 2, 3, 4]) {
      expect(screen.getByTestId(`jour-${jourALIndex(rang)}`)).toBeTruthy();
    }
    await vue.unmount();
  });

  it('porte le compte sur les jours ouverts, et le mot sur les autres', async () => {
    // C'est toute la raison des 64 points : on choisit sans ouvrir. Une grille
    // de sept colonnes tiendrait à 46, assez pour un quantième et pas pour un
    // compte — il faudrait appuyer sur chaque jour pour savoir.
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId(`jour-${jourALIndex(4)}-etat`)).toBeTruthy());

    expect(screen.getByTestId(`jour-${jourALIndex(4)}-etat`)).toHaveTextContent('6');
    expect(screen.getByTestId(`jour-${jourALIndex(1)}-etat`)).toHaveTextContent(
      en.parcours.creneauxEtatCourt.ferme.toUpperCase(),
    );
    await vue.unmount();
  });

  it('et les trois mots des jours sans place ne se confondent pas', async () => {
    // **Fermé, complet et révolu, dans la même bande.** Un montage qui n'en
    // porterait qu'un passerait ce test sans jamais éprouver que les deux
    // autres existent — et c'est précisément l'interchangeabilité que la
    // planche interdit.
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId(`jour-${jourALIndex(0)}-etat`)).toBeTruthy());

    const mot = (rang: number) =>
      String(JSON.stringify(screen.getByTestId(`jour-${jourALIndex(rang)}-etat`)));

    expect(mot(0)).toContain(en.parcours.creneauxEtatCourt.revolu.toUpperCase());
    expect(mot(1)).toContain(en.parcours.creneauxEtatCourt.ferme.toUpperCase());
    expect(mot(2)).toContain(en.parcours.creneauxEtatCourt.complet.toUpperCase());
    await vue.unmount();
  });

  it('s’ouvre sur le premier jour qui a de la place', async () => {
    // Les trois premiers du montage n'ont pas de place, chacun pour une raison
    // différente. Ouvrir sur l'un d'eux demanderait un geste avant de voir quoi
    // que ce soit.
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId('barre-de-confirmation')).toBeTruthy());

    // Le jour ouvert porte ses heures ; aucun panneau d'explication.
    expect(screen.queryByTestId('jour-sans-place')).toBeNull();
    // Et la barre dit ce qu'il reste à faire, plutôt que de disparaître : elle
    // s'évanouissait tant qu'aucune heure n'était choisie, et l'écran changeait
    // de hauteur au premier appui.
    expect(screen.getByTestId('quoi-faire')).toBeTruthy();
    await vue.unmount();
  });
});

describe('un jour sans place répond, au lieu de refuser l’appui', () => {
  it('dit pourquoi, et propose les deux jours ouverts les plus proches', async () => {
    // **Refuser l'appui sans rien dire était l'autre façon de faire
    // disparaître le jour.** Le sélecteur précédent le rendait `disabled`.
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId(`jour-${jourALIndex(1)}`)).toBeTruthy());

    await fireEvent.press(screen.getByTestId(`jour-${jourALIndex(1)}`));

    await waitFor(() => expect(screen.getByTestId('jour-sans-place')).toBeTruthy());
    expect(screen.getByTestId('sans-place-ferme')).toBeTruthy();
    // Les deux suivants qui ont de la place, dans l'ordre, en avant d'abord.
    expect(screen.getByTestId(`proche-${jourALIndex(3)}`)).toBeTruthy();
    expect(screen.getByTestId(`proche-${jourALIndex(4)}`)).toBeTruthy();
    await vue.unmount();
  });

  it('et le mot du panneau suit l’état, pas un mot pour trois', async () => {
    // Le complet et le révolu portent des phrases différentes : « tout est
    // pris » n'est pas « c'est fini pour aujourd'hui », et la seconde invite à
    // revenir demain là où la première fait renoncer.
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId(`jour-${jourALIndex(2)}`)).toBeTruthy());

    await fireEvent.press(screen.getByTestId(`jour-${jourALIndex(2)}`));
    await waitFor(() => expect(screen.getByTestId('sans-place-complet')).toBeTruthy());

    await fireEvent.press(screen.getByTestId(`jour-${jourALIndex(0)}`));
    await waitFor(() => expect(screen.getByTestId('sans-place-revolu')).toBeTruthy());
    await vue.unmount();
  });

  it('appuyer sur un jour proposé y emmène vraiment', async () => {
    // **La moitié qui manque le plus souvent.** Un bouton qui porte le bon
    // libellé et ne change rien passerait le test au-dessus.
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId(`jour-${jourALIndex(1)}`)).toBeTruthy());
    await fireEvent.press(screen.getByTestId(`jour-${jourALIndex(1)}`));
    await waitFor(() => expect(screen.getByTestId(`proche-${jourALIndex(3)}`)).toBeTruthy());

    await fireEvent.press(screen.getByTestId(`proche-${jourALIndex(3)}`));

    await waitFor(() => expect(screen.queryByTestId('jour-sans-place')).toBeNull());
    await vue.unmount();
  });

  it('et se tait sur les propositions quand il n’y en a aucune', async () => {
    // Une rangée de boutons vide sous « aucune place » serait une promesse de
    // plus qui ne mène nulle part, sur l'écran qui vient d'en refuser une.
    const vue = await monter([
      { jour: jourALIndex(0), ouvert: false, revolu: false, creneaux_libres: 0 },
      { jour: jourALIndex(1), ouvert: false, revolu: false, creneaux_libres: 0 },
    ]);
    await waitFor(() => expect(screen.getByTestId('jour-sans-place')).toBeTruthy());

    expect(screen.getByTestId('aucun-jour-proche')).toBeTruthy();
    await vue.unmount();
  });
});

describe('l’engagement est écrit avant d’être pris', () => {
  it('nomme le palier, le réseau et l’échéance une fois l’heure choisie', async () => {
    // C'est le seul moment du parcours où l'engagement peut être dit avant
    // d'être pris. Après le bouton, il n'est plus une information.
    const vue = await monter();
    // Les deux créneaux du montage tombent l'après-midi chez le commerce —
    // 18:30 et 20:00 en UTC font 14:30 et 16:00 à New York. Le groupe du matin
    // n'existe donc pas, et le viser aurait fait échouer le test sur sa propre
    // arithmétique de fuseau plutôt que sur ce qu'il prétend éprouver.
    await waitFor(() => expect(screen.getByTestId('apres-midi')).toBeTruthy());
    // L'engagement n'apparaît qu'une fois l'heure choisie : avant, il
    // annoncerait une échéance qu'on ne peut pas calculer.
    expect(screen.queryByTestId('engagement')).toBeNull();

    await fireEvent.press(within(screen.getByTestId('apres-midi')).getAllByRole('button')[0]);

    await waitFor(() => expect(screen.getByTestId('engagement')).toBeTruthy());
    expect(screen.getByTestId('engagement-contrepartie')).toHaveTextContent(/story/);
    expect(screen.getByTestId('engagement-contrepartie')).toHaveTextContent(/Instagram/);
    // La mention et le lieu, les deux éléments contrôlés : les découvrir sur
    // l'écran de preuve serait les découvrir trop tard.
    expect(screen.getByTestId('engagement-mention')).toHaveTextContent(/velanailstudio/);
    await vue.unmount();
  });

  it('et l’annulation vit dans le même bloc, pas dans des conditions', async () => {
    // Ce qu'on risque en ne venant pas fait partie de ce à quoi on s'engage ;
    // le ranger ailleurs revient à ne le dire qu'à ceux qui le cherchent.
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId('apres-midi')).toBeTruthy());
    await fireEvent.press(within(screen.getByTestId('apres-midi')).getAllByRole('button')[0]);

    await waitFor(() => expect(screen.getByTestId('si-vous-ne-venez-pas')).toBeTruthy());
    expect(screen.getByTestId('si-vous-ne-venez-pas')).toHaveTextContent(/24/);
    await vue.unmount();
  });
});
