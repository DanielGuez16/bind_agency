/**
 * L'annulation : ce que l'écran écrit, et surtout ce qu'il n'écrit pas.
 *
 * **La formulation est le sujet, pas le mécanisme.** Passé la fenêtre, annuler
 * et ne pas venir coûtent la même chose au score : le mentionner ne fait que
 * donner à croire qu'on peut encore l'éviter. « Annuler coûtera à ton score »
 * et « ça compte comme une absence, mais le salon peut encore donner ta place »
 * décrivent les mêmes conséquences — la première fait renoncer, la seconde fait
 * annuler.
 *
 * **Le décor divergent est donc lexical**, et c'est inhabituel. Une
 * implémentation qui rend la bonne feuille avec la mauvaise phrase passe tous
 * les tests de structure : le bouton est là, la route est bonne, la feuille
 * s'ouvre. C'est exactement l'écran que cette planche remplace. Les gardes
 * ci-dessous lisent donc les mots.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider, type ReservationDuCreateur } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { es } from '../src/i18n/es';
import { HistoriqueScreen } from '../src/screens/HistoriqueScreen';
import { ThemeProvider } from '../src/theme';

const DANS_TROIS_HEURES = new Date(Date.now() + 3 * 3_600_000 + 26 * 60_000).toISOString();
const DANS_DEUX_JOURS = new Date(Date.now() + 2 * 86_400_000).toISOString();
const IL_Y_A_UNE_HEURE = new Date(Date.now() - 3_600_000).toISOString();
const DANS_UNE_HEURE = new Date(Date.now() + 3_600_000).toISOString();

function reservation(extra: Partial<ReservationDuCreateur> = {}): ReservationDuCreateur {
  return {
    booking_id: 'r1',
    status: 'confirmed',
    starts_at: DANS_TROIS_HEURES,
    ends_at: DANS_DEUX_JOURS,
    valid_until: DANS_DEUX_JOURS,
    approval_expires_at: null,
    annulation_sans_frais_jusqu_a: IL_Y_A_UNE_HEURE,
    created_at: IL_Y_A_UNE_HEURE,
    business_id: 'b1',
    business_name: 'Vela Nail Studio',
    business_category: 'beauty',
    business_address: '120 NE 41st St',
    business_timezone: 'America/New_York',
    business_cover_photo_key: null,
    item_name: 'Gel manicure',
    item_photo_key: null,
    duration_minutes: 45,
    platform: 'instagram',
    content_format: 'story',
    contrepartie: null,
    ...extra,
  } as unknown as ReservationDuCreateur;
}

async function monter(items: ReservationDuCreateur[]) {
  const envois: { url: string; method: string }[] = [];
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      envois.push({ url: String(url), method });
      return {
        ok: true,
        status: 200,
        json: async () => ({ items, compteurs: { confirmed: items.length } }),
      } as Response;
    }) as unknown as typeof fetch,
  });
  const vue = await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={api}>
          <HistoriqueScreen onOuvrir={() => {}} />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
  const annulations = () => envois.filter((e) => e.url.includes('/cancel'));
  return { vue, annulations };
}

describe('ce que l’écran n’écrit jamais', () => {
  /**
   * **Les quatre phrases de la colonne « jamais », et leurs formes.** Une garde
   * qui ne chercherait que l'exemple exact laisserait passer les trois autres
   * façons d'écrire la même faute — c'est arrivé sur la garde des rendus
   * asynchrones, qui n'a rien vu pendant des semaines.
   */
  const INTERDITS = [
    /cost.*(score|reliability)/i,
    /(score|reliability).*(drop|lose|lost|cost)/i,
    /\bpoints?\b/i,
    /are you sure/i,
    /\bwarning\b/i,
    /\blate cancell?ation\b/i,
  ];

  const INTERDITS_ES = [
    /(costará|coste).*(puntuación|fiabilidad)/i,
    /(puntuación|fiabilidad).*(baja|pierdes|perderás)/i,
    /\bpuntos\b/i,
    /estás segura/i,
    /\baviso\b/i,
  ];

  const phrases = (bloc: Record<string, string>) =>
    Object.entries(bloc)
      .filter(([cle]) => cle.startsWith('annuler'))
      .map(([cle, valeur]) => `${cle} = ${valeur}`);

  it('aucune phrase d’annulation ne chiffre le coût ni ne menace le score, en anglais', () => {
    const fautives = phrases(en.parcours as unknown as Record<string, string>).filter((phrase) =>
      INTERDITS.some((interdit) => interdit.test(phrase)),
    );
    expect(fautives).toEqual([]);
  });

  it('ni en espagnol', () => {
    const fautives = phrases(es.parcours as unknown as Record<string, string>).filter((phrase) =>
      INTERDITS_ES.some((interdit) => interdit.test(phrase)),
    );
    expect(fautives).toEqual([]);
  });

  it('la garde regarde bien quelque chose', () => {
    // Sans ceci, une clé renommée viderait la liste et le test passerait au
    // vert en n'ayant rien lu.
    expect(phrases(en.parcours as unknown as Record<string, string>).length).toBeGreaterThan(6);
    expect(INTERDITS.some((i) => i.test('annulerX = this will cost your score'))).toBe(true);
    expect(INTERDITS.some((i) => i.test('annulerX = Are you sure?'))).toBe(true);
  });
});

describe('la fenêtre se nomme par une heure', () => {
  it('dans la fenêtre : jusqu’à quelle heure c’est libre', async () => {
    await monter([reservation({ annulation_sans_frais_jusqu_a: DANS_UNE_HEURE })]);

    expect(await screen.findByTestId('annuler-fenetre-r1')).toHaveTextContent(
      /free to cancel until \d/i,
    );
  });

  it('passé la fenêtre : un fait au passé, sans conséquence annoncée', async () => {
    await monter([reservation({ annulation_sans_frais_jusqu_a: IL_Y_A_UNE_HEURE })]);

    const ligne = await screen.findByTestId('annuler-fenetre-r1');
    expect(ligne).toHaveTextContent(/free cancellation ended at \d/i);
    // La conséquence appartient à la feuille : la ligne ne l'annonce pas.
    expect(ligne).not.toHaveTextContent(/absence/i);
  });

  it('sans échéance servie, aucune heure n’est inventée', async () => {
    await monter([reservation({ annulation_sans_frais_jusqu_a: null, status: 'held' })]);

    expect(await screen.findByTestId('annuler-r1')).toBeTruthy();
    expect(screen.queryByTestId('annuler-fenetre-r1')).toBeNull();
  });

  // **Un rendu par cas, et non une boucle.** Rendre l'annulation difficile ne
  // produit pas des présences, ça produit des absences silencieuses — donc le
  // bouton se vérifie dans les deux états. Deux rendus dans un même test
  // demandent un démontage entre les deux, qui détache `screen` pour la suite
  // du fichier : le cas suivant ne trouvait plus rien et l'échec accusait le
  // composant.
  it.each([
    ['dans la fenêtre', () => DANS_UNE_HEURE],
    ['passé la fenêtre', () => IL_Y_A_UNE_HEURE],
  ])('le bouton est là et n’est jamais grisé — %s', async (_nom, echeance) => {
    await monter([reservation({ annulation_sans_frais_jusqu_a: echeance() })]);

    const bouton = await screen.findByTestId('annuler-r1');
    expect(bouton).toBeTruthy();
    expect(bouton.props.accessibilityState?.disabled).toBeFalsy();
  });
});

describe('la feuille, passé la fenêtre', () => {
  it('met le coût en face de l’alternative, et nomme le salon', async () => {
    await monter([reservation()]);

    await fireEvent.press(await screen.findByTestId('annuler-r1'));

    const consequence = await screen.findByTestId('annulation-consequence-r1');
    // « comme une absence » **et** « mais le salon peut encore donner ta
    // place » : la seconde moitié est celle qui fait annuler, et une
    // implémentation qui ne garderait que la première ferait renoncer.
    expect(consequence).toHaveTextContent(/counts as an absence/i);
    expect(consequence).toHaveTextContent(/Vela Nail Studio can still give your slot/i);
  });

  it('nomme la valeur de prévenir, et écrit la réversibilité', async () => {
    await monter([reservation()]);

    await fireEvent.press(await screen.findByTestId('annuler-r1'));

    const bloc = await screen.findByTestId('annulation-vaut-mieux-r1');
    expect(bloc).toHaveTextContent(/worth more than not coming/i);
    // Le seul nombre de l'écran, et ce n'est pas le coût. La minute exacte
    // n'est pas asservie ici : elle dépend du temps écoulé entre le décor et
    // l'assertion, et un runner lent la ferait basculer. Le calcul lui-même
    // est éprouvé à la minute près sur `delaiAvantLeCreneau`.
    expect(bloc).toHaveTextContent(/gives them 3 h \d+ to fill it/i);
    // La réversibilité : une conséquence définitive fait fuir.
    expect(bloc).toHaveTextContent(/reliability recovers/i);
  });

  it('le bouton est un geste envers quelqu’un, pas un renoncement', async () => {
    await monter([reservation()]);

    await fireEvent.press(await screen.findByTestId('annuler-r1'));

    expect(await screen.findByTestId('annuler-oui-r1')).toHaveTextContent(
      /cancel and tell Vela Nail Studio/i,
    );
    expect(await screen.findByTestId('annuler-non-r1')).toHaveTextContent(/keep it, I am going/i);
  });

  it('dans la fenêtre, la feuille ne parle pas d’absence', async () => {
    await monter([reservation({ annulation_sans_frais_jusqu_a: DANS_UNE_HEURE })]);

    await fireEvent.press(await screen.findByTestId('annuler-r1'));

    const consequence = await screen.findByTestId('annulation-consequence-r1');
    expect(consequence).toHaveTextContent(/nothing is held against you/i);
    expect(consequence).not.toHaveTextContent(/absence/i);
    // Et l'argument de l'alternative n'a pas lieu d'être : rien ne coûte.
    expect(screen.queryByTestId('annulation-vaut-mieux-r1')).toBeNull();
  });
});

describe('ce qui part sur le réseau', () => {
  it('ouvrir la feuille n’annule rien', async () => {
    const { annulations } = await monter([reservation()]);

    await fireEvent.press(await screen.findByTestId('annuler-r1'));

    expect(await screen.findByTestId('feuille-annulation-r1')).toBeTruthy();
    expect(annulations()).toEqual([]);
  });

  it('le second appui annule, et sur la bonne route', async () => {
    const { annulations } = await monter([reservation()]);

    await fireEvent.press(await screen.findByTestId('annuler-r1'));
    await fireEvent.press(await screen.findByTestId('annuler-oui-r1'));

    await waitFor(() => expect(annulations()).toHaveLength(1));
    expect(annulations()[0].method).toBe('POST');
    expect(annulations()[0].url).toContain('/bookings/r1/cancel');
  });

  it('renoncer referme sans rien envoyer', async () => {
    const { annulations } = await monter([reservation()]);

    await fireEvent.press(await screen.findByTestId('annuler-r1'));
    await fireEvent.press(await screen.findByTestId('annuler-non-r1'));

    await waitFor(() => expect(screen.queryByTestId('feuille-annulation-r1')).toBeNull());
    expect(annulations()).toEqual([]);
    expect(await screen.findByTestId('annuler-r1')).toBeTruthy();
  });
});
