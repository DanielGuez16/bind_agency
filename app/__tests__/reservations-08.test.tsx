/**
 * Les réservations, contre leurs cadres 08a et 08b.
 *
 * Le deuxième écran du trou trouvé par le registre : `Lot 1 v1.1` employait les
 * jetons de la v1.0 sans avoir jamais été comparée cadre par cadre. **Repeint
 * n'est pas passé.**
 *
 * **La phrase du cadre est « chaque ligne dit ce qu'elle attend de toi ».** Trois
 * lignes se ressemblaient : celle qui demande un geste, celle qui attend un
 * contrôle, celle qui est close. On relisait les trois pour trouver laquelle
 * agissait — et l'écran d'envoi de preuve paraissait sans action parce que le
 * chemin qui y mène n'en portait pas.
 *
 * La règle est éprouvée en deux endroits : sur `attenteDe`, qui la décide sans
 * un pixel, et sur le rendu, qui doit s'y tenir.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { ApiClient, ApiProvider, type ReservationDuCreateur } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import {
  HistoriqueScreen,
  attenteDe,
  destination,
  grouperParMois,
  tempsRestant,
} from '../src/screens/HistoriqueScreen';
import { ThemeProvider } from '../src/theme';

/**
 * **Les heures sont relatives à maintenant, pas écrites en dur.**
 *
 * Ce décor portait `valid_until: '2026-08-16T18:00:00Z'`. Tant que cette date
 * était devant nous, il ne disait rien de faux ; passée, il affirmait qu'un
 * droit **périmé** ouvre encore le code de retrait — c'est-à-dire exactement le
 * défaut trouvé en campagne, inscrit dans le montage qui devait le surveiller.
 *
 * La règle existait déjà dans le fichier voisin, écrite après le même
 * accident : « une date figée finit par passer, et le jour où elle passe c'est
 * l'écran qui paraît cassé ». Elle vaut ici aussi.
 */
const DANS_TROIS_HEURES = new Date(Date.now() + 3 * 3_600_000).toISOString();
const IL_Y_A_UNE_HEURE = new Date(Date.now() - 3_600_000).toISOString();
const IL_Y_A_DEUX_HEURES = new Date(Date.now() - 2 * 3_600_000).toISOString();

function reservation(extra: Partial<ReservationDuCreateur> = {}): ReservationDuCreateur {
  return {
    booking_id: 'r1',
    status: 'consumed',
    starts_at: IL_Y_A_DEUX_HEURES,
    ends_at: IL_Y_A_UNE_HEURE,
    valid_until: DANS_TROIS_HEURES,
    approval_expires_at: null,
    created_at: '2026-08-14T09:00:00Z',
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

function contrepartie(statut: string, extra: Record<string, unknown> = {}) {
  return {
    collaboration_id: 'k1',
    status: statut,
    deadline_at: '2026-08-16T14:30:00Z',
    attempts_count: 1,
    needs_human_review: false,
    ...extra,
  };
}

async function monter(items: ReservationDuCreateur[]) {
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ items, compteurs: { consumed: items.length } }),
      }) as Response,
  });
  return await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={api}>
          <HistoriqueScreen onOuvrir={() => {}} />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('la règle : ce que la ligne attend, et de qui', () => {
  it('un code de retrait attend la créatrice, au comptoir', async () => {
    expect(attenteDe(reservation({ status: 'confirmed' }))).toBe('creatrice');
  });

  it('une publication demandée aussi, y compris à la reprise', async () => {
    for (const statut of ['pending', 'resubmit_requested']) {
      expect(attenteDe(reservation({ contrepartie: contrepartie(statut) as never }))).toBe(
        'creatrice',
      );
    }
  });

  it('une publication envoyée attend le contrôle, pas elle', async () => {
    for (const statut of ['submitted', 'under_review']) {
      expect(attenteDe(reservation({ contrepartie: contrepartie(statut) as never }))).toBe(
        'controle',
      );
    }
  });

  it('et une contrepartie close n’attend plus personne', async () => {
    // Le sens inverse : sans lui, une règle qui rendrait « créatrice » partout
    // passerait les trois tests précédents.
    for (const statut of ['approved', 'unfulfilled']) {
      expect(attenteDe(reservation({ contrepartie: contrepartie(statut) as never }))).toBeNull();
    }
  });
});

describe('chaque ligne dit ce qu’elle attend de toi', () => {
  it('celle qui demande un geste porte un bouton', async () => {
    await monter([reservation({ contrepartie: contrepartie('pending') as never })]);
    await waitFor(() => expect(screen.getByTestId('agir-r1')).toBeTruthy());

    expect(screen.queryByTestId('rien-a-faire-r1')).toBeNull();
  });

  it('celle qui attend un contrôle le dit en mots, sans bouton grisé', async () => {
    // **Un bouton gris se presse quand même, et ne répond pas.** L'action
    // impossible se retire, elle ne se grise pas — c'est déjà la règle de la
    // bibliothèque, et cet écran ne la tenait pas.
    await monter([reservation({ contrepartie: contrepartie('submitted') as never })]);
    await waitFor(() => expect(screen.getByTestId('rien-a-faire-r1')).toBeTruthy());

    expect(screen.queryByTestId('agir-r1')).toBeNull();
    expect(screen.getByTestId('reservation-r1').props.accessibilityRole).toBeUndefined();
  });

  it('l’échéance s’affiche, elle était servie et rendue nulle part', async () => {
    // Le statut seul ne dit pas jusqu'à quand, et c'est la seule chose qui
    // décide s'il faut agir ce soir ou la semaine prochaine.
    await monter([reservation({ contrepartie: contrepartie('pending') as never })]);
    await waitFor(() => expect(screen.getByTestId('echeance-r1')).toBeTruthy());

    expect(screen.getByTestId('echeance-r1')).toHaveTextContent(/16/);
  });

  it('la tentative n’apparaît qu’à partir de la seconde', async () => {
    // « Tentative 1 sur 3 » sur une première publication annonce un échec
    // qui n'a pas eu lieu.
    await monter([reservation({ contrepartie: contrepartie('pending') as never })]);
    await waitFor(() => expect(screen.getByTestId('agir-r1')).toBeTruthy());
    expect(screen.queryByTestId('tentative-r1')).toBeNull();

    await monter([
      reservation({ contrepartie: contrepartie('resubmit_requested', { attempts_count: 2 }) as never }),
    ]);
    await waitFor(() => expect(screen.getByTestId('tentative-r1')).toBeTruthy());
    expect(screen.getByTestId('tentative-r1')).toHaveTextContent(/\b2\b/);
  });

  it('le badge porte le palier et le réseau', async () => {
    // La même prestation peut exister sur deux comptes : « one story » ne dit
    // pas sur lequel publier, et publier sur le mauvais ne compte pas.
    await monter([reservation({ contrepartie: contrepartie('pending') as never })]);
    await waitFor(() => expect(screen.getByTestId('palier-r1')).toBeTruthy());

    const badge = screen.getByTestId('palier-r1');
    expect(badge).toHaveTextContent(/STORY/);
    expect(badge).toHaveTextContent(/INSTAGRAM/);
  });

  it('la prestation passe devant le salon', async () => {
    // L'écran mettait le nom du salon en tête : c'est ce dont on se souvient
    // le moins. Ce qu'on cherche dans dix lignes est ce qu'on a réservé.
    await monter([reservation({ contrepartie: contrepartie('pending') as never })]);
    await waitFor(() => expect(screen.getByTestId('reservation-r1')).toBeTruthy());

    const textes = screen
      .getAllByText(/Gel manicure|Vela Nail Studio/)
      .map((n) => String(n.props.children));
    expect(textes[0]).toContain('Gel manicure');
  });
});


// --------------------------------------------------------------------------
// le droit périmé
// --------------------------------------------------------------------------

/**
 * **Le bloquant de campagne, et il n'était visible que là.**
 *
 * Une réservation confirmée que personne n'a servie garde son statut pour
 * toujours : le diagramme n'a pas de flèche de `confirmed` vers `expired`. Passé
 * `valid_until`, le serveur refuse le code — `redemption_booking_not_redeemable`
 * — et l'écran continuait de proposer « Voir le code ». Le message d'erreur
 * s'affichait à la place du QR, au comptoir, le jour du rendez-vous.
 */
describe('un droit périmé', () => {
  it("n'ouvre plus le code de retrait", async () => {
    const perimee = reservation({ status: 'confirmed', valid_until: IL_Y_A_UNE_HEURE });

    expect(destination(perimee)).toBeNull();
    expect(attenteDe(perimee)).toBeNull();
  });

  it('ouvre encore le code tant qu’il court', async () => {
    // L'autre sens. Une règle qui fermerait toujours passerait le test
    // précédent sans rien garantir, et le code deviendrait inatteignable.
    const vivante = reservation({ status: 'confirmed', valid_until: DANS_TROIS_HEURES });

    expect(destination(vivante)).toBe('code');
    expect(attenteDe(vivante)).toBe('creatrice');
  });

  it('garde la porte de la publication si une contrepartie court', async () => {
    // Le rendez-vous est passé, la prestation a été servie : la publication
    // reste due. Fermer les deux portes ferait perdre la contrepartie avec le
    // code.
    const perimee = reservation({
      status: 'confirmed',
      valid_until: IL_Y_A_UNE_HEURE,
      contrepartie: contrepartie('pending'),
    } as never);

    expect(destination(perimee)).toBe('preuve');
  });

  it('le dit à la créatrice au lieu de retirer le bouton en silence', async () => {
    await monter([reservation({ status: 'confirmed', valid_until: IL_Y_A_UNE_HEURE })]);

    expect(await screen.findByTestId('droit-perime-r1')).toBeTruthy();
    expect(screen.queryByTestId('agir-r1')).toBeNull();
  });
});

// --------------------------------------------------------------------------
// 08b · ce qu'il reste, et 08c · les mois
// --------------------------------------------------------------------------

describe('le temps restant, isolé', () => {
  const ECHEANCE = '2026-08-16T14:30:00Z';
  const instant = (decalageHeures: number) =>
    new Date(ECHEANCE).getTime() - decalageHeures * 3_600_000;

  it('compte en heures sous deux jours', () => {
    // « 31 H » se comprend sans calcul, et c'est lui qui décide si l'on publie
    // ce soir ou demain.
    expect(tempsRestant(ECHEANCE, instant(31))).toBe('31 h');
  });

  it('bascule en jours au-delà de deux', () => {
    // « 71 H » est exact et illisible quand « 2 J » suffit à décider.
    expect(tempsRestant(ECHEANCE, instant(71))).toBe('2 j');
    expect(tempsRestant(ECHEANCE, instant(48))).toBe('2 j');
    expect(tempsRestant(ECHEANCE, instant(47))).toBe('47 h');
  });

  it('ne rend rien quand l’échéance est passée', () => {
    // Une contrepartie en retard est déjà close par le balayage ; « −3 H » sur
    // une ligne encore ouverte se lirait comme une dette.
    expect(tempsRestant(ECHEANCE, instant(-3))).toBeNull();
  });
});

describe('les mois, isolés', () => {
  it('groupe dans l’ordre reçu, sans retrier', () => {
    // Le serveur a déjà décidé ; retrier ici ferait diverger l'écran de sa
    // pagination.
    const groupes = grouperParMois(
      [
        reservation({ booking_id: 'a', starts_at: '2026-08-08T14:00:00Z' }),
        reservation({ booking_id: 'b', starts_at: '2026-08-02T14:00:00Z' }),
        reservation({ booking_id: 'c', starts_at: '2026-07-28T14:00:00Z' }),
      ],
      'en',
    );

    expect(groupes.map((g) => g.mois)).toEqual(['AUGUST 2026', 'JULY 2026']);
    expect(groupes[0].items.map((r) => r.booking_id)).toEqual(['a', 'b']);
  });

  it('range selon le fuseau du commerce, pas celui du lecteur', () => {
    // **L'instant est choisi pour discriminer.** Le 1er août à 02 h UTC est le
    // 31 juillet à 22 h à Miami : grouper sur le fuseau du lecteur rangerait la
    // ligne en août, celui du commerce la range en juillet — et c'est le mois
    // où la créatrice se souvient d'y être allée.
    //
    // Le premier essai portait 05 h UTC, qui est le 1er août des deux côtés :
    // le test passait sans rien départager.
    const groupes = grouperParMois(
      [reservation({ starts_at: '2026-08-01T02:00:00Z' })],
      'en',
    );

    expect(groupes[0].mois).toBe('JULY 2026');
  });

  it('sépare deux janviers consécutifs', () => {
    // Sans l'année, « JANUARY » les confond, et l'historique d'une créatrice
    // fidèle en compte deux avant sa deuxième année.
    const groupes = grouperParMois(
      [
        reservation({ booking_id: 'a', starts_at: '2027-01-10T14:00:00Z' }),
        reservation({ booking_id: 'b', starts_at: '2026-01-10T14:00:00Z' }),
      ],
      'en',
    );

    expect(groupes).toHaveLength(2);
  });
});

describe('08c · les terminées, groupées', () => {
  it('pose un intertitre par mois sur les terminées', async () => {
    await monter([
      reservation({ booking_id: 'a', status: 'cancelled', starts_at: '2026-08-08T14:00:00Z' }),
      reservation({ booking_id: 'b', status: 'cancelled', starts_at: '2026-07-28T14:00:00Z' }),
    ]);
    await waitFor(() => expect(screen.getByTestId('onglets')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText(new RegExp(en.parcours.ongletTerminees)));

    expect(screen.getByTestId('mois-AUGUST 2026')).toBeTruthy();
    expect(screen.getByTestId('mois-JULY 2026')).toBeTruthy();
  });

  it('ne groupe pas les deux autres onglets', async () => {
    // Ils portent deux ou trois lignes : un intertitre y coûterait plus qu'il
    // ne rend, et découperait une liste qui se lit d'un coup.
    await monter([reservation({ status: 'consumed' })]);
    await waitFor(() => expect(screen.getByTestId('onglets')).toBeTruthy());

    expect(screen.queryByTestId(/^mois-/)).toBeNull();
  });
});
