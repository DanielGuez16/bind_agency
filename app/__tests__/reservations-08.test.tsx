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
  sectionAVenir,
  surfaceDe,
  tempsRestant,
  verbeDeLaContrepartie,
} from '../src/screens/HistoriqueScreen';
import { couleurs, ThemeProvider } from '../src/theme';

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

/**
 * Une échéance **relative**, pas une date écrite.
 *
 * Elle était figée au 16 août 2026. La date est passée, `tempsRestant` a rendu
 * `null`, et la ligne « il reste 31 h » a cessé d'être rendue — sans qu'un seul
 * test rougisse, parce que celui qui existait lisait la ligne d'échéance, elle
 * inconditionnelle. Le décor a pourri en silence et personne n'a pu le voir.
 *
 * C'est la même faute que le `valid_until` figé de l'an dernier. Un décor qui
 * porte une date écrite en dur ne dit pas la même chose selon le jour où on le
 * lit, et un test dont le verdict dépend du calendrier ne prouve rien.
 */
const DANS_31_H = () => new Date(Date.now() + 31 * 3_600_000).toISOString();

function contrepartie(statut: string, extra: Record<string, unknown> = {}) {
  return {
    collaboration_id: 'k1',
    status: statut,
    deadline_at: DANS_31_H(),
    attempts_count: 1,
    needs_human_review: false,
    ...extra,
  };
}

async function monter(
  items: ReservationDuCreateur[],
  locale: 'en' | 'es' = 'en',
  onglet?: string,
) {
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
    <I18nProvider initialLocale={locale}>
      <ThemeProvider role="creator">
        <ApiProvider client={api}>
          <HistoriqueScreen onOuvrir={() => {}} ongletDemande={onglet} />
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

  it('la carte se tait sur l’instruction du dossier', async () => {
    // **Ce que la liste ne porte plus, et pourquoi.** L'échéance, l'arbitrage
    // et le numéro de tentative décrivent comment le dossier est instruit ; la
    // liste répond à « qu'est-ce que je dois faire ». Trois lignes sur chaque
    // carte pour une question qu'on ne pose pas ici.
    //
    // Aucune n'est perdue : l'échéance est éprouvée sur l'écran de la
    // contrepartie par `la-preuve-v3` (`contrat-echeance`), l'arbitrage et la
    // tentative par `la-reprise`. Ce test dit où elles ne sont **pas**, et le
    // retrait n'a de sens que parce que les autres disent où elles sont.
    await monter([
      reservation({
        contrepartie: contrepartie('resubmit_requested', {
          attempts_count: 2,
          needs_human_review: true,
        }) as never,
      }),
    ]);
    await waitFor(() => expect(screen.getByTestId('reservation-r1')).toBeTruthy());

    expect(screen.queryByTestId('echeance-r1')).toBeNull();
    expect(screen.queryByTestId('en-arbitrage-r1')).toBeNull();
    expect(screen.queryByTestId('tentative-r1')).toBeNull();

    // **Le décor porte les trois causes en même temps.** Une contrepartie
    // `pending` à première tentative ne rendrait aucune des trois de toute
    // façon : le test passerait au vert sans que rien n'ait été retiré, et
    // c'est exactement l'implémentation qu'on vient d'écarter.
  });

  it('mais elle garde ce qui reste, qui décide du geste', async () => {
    // Le retrait s'arrête là. « 31 h » dit s'il faut publier ce soir ; c'est
    // une décision, pas une instruction de dossier.
    await monter([reservation({ contrepartie: contrepartie('pending') as never })]);
    await waitFor(() => expect(screen.getByTestId('reste-r1')).toBeTruthy());

    // **Sans capitales.** Elles détruisent la silhouette des mots, donc ce qui
    // permet de balayer une liste sans la lire.
    const reste = screen.getByTestId('reste-r1');
    expect(reste).not.toHaveTextContent(/LEFT|RESTE|QUEDAN/);
    expect(reste).toHaveTextContent(/left/i);
  });

  it('le format ouvre la carte, et le réseau y est un glyphe', async () => {
    // **La v10 met le réseau et le format en tête.** Un coup d'œil suffit alors
    // à savoir où et quoi avant de lire le nom. Le réseau devient un glyphe :
    // la même prestation peut exister sur deux comptes, et un logo se reconnaît
    // plus vite qu'un mot en capitales.
    await monter([reservation({ contrepartie: contrepartie('pending') as never })]);
    await waitFor(() => expect(screen.getByTestId('palier-r1')).toBeTruthy());

    const badge = screen.getByTestId('palier-r1');
    expect(badge).toHaveTextContent(/story/i);
    // **Plus de capitales espacées, et plus de mono.** Elles détruisent la
    // silhouette des mots — ce qui permet de balayer une liste sans la lire.
    expect(badge).not.toHaveTextContent(/STORY/);
  });

  it('et le format y est traduit, pas recopié', async () => {
    // **Le cas où les deux implémentations divergent.** En anglais, `story`
    // majusculé donne « STORY » — la valeur brute et la traduction rendent le
    // même mot, et l'assertion au-dessus passe quelle que soit celle qu'on a
    // écrite. L'espagnol les sépare : « historia » contre « story ». C'est
    // donc là que le test se pose, et pas ailleurs.
    await monter([reservation({ contrepartie: contrepartie('pending') as never })], 'es');
    await waitFor(() => expect(screen.getByTestId('palier-r1')).toBeTruthy());

    const badge = screen.getByTestId('palier-r1');
    expect(badge).toHaveTextContent(/historia/i);
    expect(badge).not.toHaveTextContent(/story/i);
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

describe('08c · les terminées, la même carte que les deux autres', () => {
  /**
   * **Le groupement par mois et le quantième partent avec la v10.** « Personne
   * ne cite une collaboration par son rang » : la date remplace l'échéance à sa
   * place dans la carte, et l'état accepté prend celle de l'action. Trois
   * onglets, une carte, et l'histoire cesse d'avoir une grammaire à elle.
   */
  it('ne groupe plus, et porte l’état à la place de l’action', async () => {
    const finie = reservation({ booking_id: 'r-finie', status: 'cancelled' });
    await monter([finie], 'en', 'terminees');
    await waitFor(() => expect(screen.getByTestId('onglets')).toBeTruthy());

    expect(screen.queryByTestId(/^mois-/)).toBeNull();
    expect(screen.getByTestId('etat-r-finie')).toHaveTextContent(en.parcours.reservationAcceptee);
    // Et aucune action : il n'y a plus rien à faire, et un bouton gris se
    // presse quand même sans répondre.
    expect(screen.queryByTestId('agir-r-finie')).toBeNull();
  });
});

describe('à venir · deux sections nommées par leur verbe', () => {
  it('sépare ce qu’on attend de moi de ce qu’on attend du salon', () => {
    // L'onglet mêlait les deux sans le dire, et l'on ne savait pas en le
    // parcourant s'il y avait quelque chose à faire.
    expect(sectionAVenir(reservation({ status: 'confirmed' }))).toBe('moi');
    expect(sectionAVenir(reservation({ status: 'awaiting_business' }))).toBe('salon');
  });

  it('range une garde du côté de la créatrice', () => {
    // Une place tenue attend qu'elle confirme, pas que le salon tranche : la
    // ranger sous « le salon décide » la ferait attendre pour rien.
    expect(sectionAVenir(reservation({ status: 'held' }))).toBe('moi');
  });
});

describe('en cours · le titre est le verbe', () => {
  it('dit publier, corriger ou attendre, jamais la prestation', () => {
    const avec = (statut: string) =>
      verbeDeLaContrepartie(reservation({ contrepartie: contrepartie(statut) as never }));

    expect(avec('pending')).toBe('publier');
    expect(avec('resubmit_requested')).toBe('corriger');
    expect(avec('submitted')).toBe('controle');
    expect(avec('under_review')).toBe('controle');
  });

  it('ne donne aucun verbe à une contrepartie close', () => {
    // Un verbe la ferait paraître ouverte.
    expect(verbeDeLaContrepartie(reservation({ contrepartie: contrepartie('approved') as never }))).toBeNull();
    expect(verbeDeLaContrepartie(reservation({ contrepartie: null }))).toBeNull();
  });
});

describe('la grammaire des surfaces', () => {
  it('donne l’ombre à ce qui demande, le filet à ce qui informe', () => {
    const demande = reservation({ contrepartie: contrepartie('pending') as never });
    const informe = reservation({ contrepartie: contrepartie('submitted') as never });

    expect(surfaceDe(demande, 'en-cours')).toBe('demande');
    expect(surfaceDe(informe, 'en-cours')).toBe('informe');
  });

  it('donne le contour d’encre à ce qui revient', () => {
    // Une reprise demande, comme la publication attendue — et le test doit
    // donc les faire **diverger** : une implémentation qui rendrait « demande »
    // pour les deux passerait un décor qui ne montre que la reprise.
    const reprise = reservation({ contrepartie: contrepartie('resubmit_requested') as never });
    const premiere = reservation({ contrepartie: contrepartie('pending') as never });

    expect(surfaceDe(reprise, 'en-cours')).toBe('reprise');
    expect(surfaceDe(premiere, 'en-cours')).toBe('demande');

    // Et l'onglet garde le dernier mot : une reprise close est de l'histoire,
    // pas un reproche qu'on ressort.
    expect(surfaceDe(reprise, 'terminees')).toBe('histoire');
  });

  it('rend l’historique en ligne nue, quoi qu’il ait demandé autrefois', () => {
    // Le « moche » venait d'un traitement d'action appliqué à de l'histoire :
    // une carte à ombre pour une liste qui ne demande rien.
    const close = reservation({ status: 'cancelled', contrepartie: null });
    const jadis = reservation({ status: 'consumed', contrepartie: contrepartie('pending') as never });

    expect(surfaceDe(close, 'terminees')).toBe('histoire');
    expect(surfaceDe(jadis, 'terminees')).toBe('histoire');
  });
});

/**
 * Ce que la carte peint, et ce que le bouton mesure.
 *
 * Les deux points que Design réclamait et que l'écran n'avait pas : la pilule
 * dimensionnée sur son texte, et le contour d'encre pour la reprise. Éprouvés
 * sur le rendu et non sur la fonction pure — `surfaceDe` peut rendre le bon mot
 * pendant que la carte l'ignore, et c'est arrivé ailleurs.
 */
describe('ce que la carte peint', () => {
  const styleDe = (element: { props: { style?: unknown } }): Record<string, unknown> => {
    const brut = element.props.style;
    const pile = Array.isArray(brut) ? brut.flat(Infinity) : [brut];
    return Object.assign({}, ...pile.filter(Boolean));
  };

  it('peint la même carte dans les trois onglets', async () => {
    /**
     * **La grammaire à trois surfaces part avec la v10.** Une carte à ombre
     * demandait, un contour d'encre reprochait, un filet informait : trois
     * traitements pour une liste où c'est désormais la ligne du haut qui dit
     * l'état — rien à venir, l'échéance en cours d'envoi, l'acceptation une
     * fois fini. Le fond ne porte plus l'information, donc il ne varie plus.
     */
    const reprise = reservation({
      booking_id: 'reprise',
      status: 'consumed',
      contrepartie: contrepartie('resubmit_requested') as never,
    });
    const premiere = reservation({
      booking_id: 'premiere',
      status: 'consumed',
      contrepartie: contrepartie('pending') as never,
    });

    await monter([reprise, premiere]);

    const carteReprise = styleDe(screen.getByTestId('reservation-reprise'));
    const cartePremiere = styleDe(screen.getByTestId('reservation-premiere'));

    expect(carteReprise.borderColor).toBe(cartePremiere.borderColor);
    expect(carteReprise.borderColor).not.toBe(couleurs['line.solo']);
    // « Un coin de 18 px sans ombre flotte au lieu de se poser » : les deux la
    // portent, et l'égalité seule ne le dirait pas — deux cartes sans ombre
    // sont égales elles aussi.
    expect(carteReprise.shadowOpacity ?? 0).toBeGreaterThan(0);
    expect(cartePremiere.shadowOpacity ?? 0).toBeGreaterThan(0);
  });

  it('dimensionne le bouton d’action sur son texte', async () => {
    const aPublier = reservation({
      booking_id: 'agir',
      status: 'consumed',
      contrepartie: contrepartie('pending') as never,
    });

    await monter([aPublier]);

    // `fullWidth` vaut `true` par défaut et pose `alignSelf: 'stretch'` : c'est
    // ce qui étirait la pilule sur toute la carte.
    const bouton = screen.getByTestId('agir-agir');
    expect(styleDe(bouton).alignSelf).not.toBe('stretch');

    // **Et il faut la rangée, sinon le `false` ne se voit pas.** En colonne,
    // `alignSelf` non posé retombe sur l'étirement du parent : le bouton
    // reprendrait toute la largeur avec exactement ce style-là. La première
    // version de ce test s'arrêtait à l'assertion ci-dessus, et la mutation qui
    // retirait la rangée passait au vert — le décor ne distinguait pas les deux
    // implémentations. C'est donc l'axe du parent qu'on regarde.
    const rangee = bouton.parent?.parent;
    expect(styleDe(rangee as never).flexDirection).toBe('row');
  });
});


/**
 * Le titre de l'onglet en cours est le verbe, et il ne l'était pas.
 *
 * **`verbeDeLaContrepartie` était calculé, testé, et jamais rendu.** Il ne
 * servait qu'à choisir une surface ; la carte affichait la prestation, quand la
 * question de cet onglet est « qu'est-ce qu'on attend de moi ». C'est la
 * décision centrale de la planche v3 pour cet onglet, et elle n'était pas à
 * l'écran.
 *
 * **Le décor divergent est celui qui reste sur la prestation** — et il a fallu
 * une mutation pour le trouver juste. La première version opposait les deux
 * onglets, ce qui ne prouvait rien : une réservation « à venir » n'a jamais de
 * contrepartie, donc les deux implémentations rendaient le même verdict et
 * « je rends le verbe partout » survivait. Ce qui décide vraiment est la
 * **présence d'une contrepartie**, et c'est sur elle que le cas diverge.
 */
describe('le titre est la prestation, et le format ouvre la carte', () => {
  const EN_COURS = (statut: string) =>
    reservation({
      booking_id: 'r-verbe',
      status: 'consumed',
      contrepartie: contrepartie(statut) as never,
    });

  /**
   * **Le verbe quitte le titre avec la v10.** Il y avait été mis parce que la
   * carte ne disait pas ce qu'on attendait ; ce rôle passe à la ligne du haut —
   * le glyphe du réseau et le format — et à la pilule d'action, qui nomme le
   * geste là où on le fait. Le titre redevient ce qu'on cherche dans dix
   * lignes : ce qu'on a réservé.
   *
   * **Le cas divergent est la reprise.** Une carte sans contrepartie rendrait
   * la prestation dans les deux implémentations ; c'est ici que « je titre le
   * verbe » se verrait encore.
   */
  it('titre la prestation même quand une reprise est demandée', async () => {
    await monter([EN_COURS('resubmit_requested')]);

    const carte = await screen.findByTestId('reservation-r-verbe');
    // La durée rejoint le nom sur cette même ligne depuis R2.6 — le titre
    // reste la prestation, il porte juste un second fait désormais.
    expect(within(carte).getByText('Gel manicure · 45 min')).toBeTruthy();
    expect(within(carte).queryByTestId('verbe-r-verbe')).toBeNull();
    // Le format ouvre la carte, et c'est lui qui dit ce qu'on doit rendre.
    expect(within(carte).getByTestId('palier-r-verbe')).toHaveTextContent(/story/i);
  });

  it('et l’action nomme le geste, là où on le fait', async () => {
    await monter([EN_COURS('resubmit_requested')]);

    const carte = await screen.findByTestId('reservation-r-verbe');
    expect(within(carte).getByTestId('agir-r-verbe')).toHaveTextContent(
      en.parcours.action_preuve,
    );
  });
});

describe('l’historique se continue au-delà de la première page', () => {
  it('demande chaque suite au curseur de la dernière ligne reçue, et les empile', async () => {
    // **Le même défaut de fond que « My posts ».** L'écran s'arrêtait à la
    // page par défaut du serveur : au-delà de la cinquantième réservation,
    // l'historique cessait d'en être un sans que rien ne le dise.
    //
    // **Deux pages pleines, donc deux appuis, et c'est ce qui fait diverger
    // les deux implémentations.** Avec un seul appui, prendre le curseur sur
    // la première page ou sur l'ensemble chargé donne la même valeur : la
    // mutation survit. C'est au second appui qu'un curseur figé sur la
    // première page redemanderait la page déjà lue, en boucle.
    const demandes: string[] = [];
    const page = (n: number) =>
      Array.from({ length: 50 }, (_, i) =>
        reservation({
          booking_id: `p${n}-${i}`,
          created_at: `2026-0${n}-${String((i % 28) + 1).padStart(2, '0')}T09:00:00Z`,
        }),
      );
    const pages = [page(8), page(7), [reservation({ booking_id: 'fin', created_at: '2026-06-01T09:00:00Z' })]];
    const api = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: { lire: async () => null, ecrire: async () => {} },
      fetchImpl: async (url) => {
        const items = pages[demandes.length] ?? [];
        demandes.push(String(url));
        return { ok: true, status: 200, json: async () => ({ items, compteurs: {} }) } as Response;
      },
    });
    await render(
      <I18nProvider initialLocale="en">
        <ThemeProvider role="creator">
          <ApiProvider client={api}>
            <HistoriqueScreen onOuvrir={() => {}} ongletDemande="en-cours" />
          </ApiProvider>
        </ThemeProvider>
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('voir-plus-historique')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('voir-plus-historique'));
    await waitFor(() => expect(screen.getByTestId('reservation-p7-0')).toBeTruthy());
    expect(demandes[1]).toContain(encodeURIComponent(pages[0][49].created_at));

    // **Le second appui, celui qui compte.** Le curseur doit avoir avancé
    // jusqu'au bout de la SECONDE page, pas être resté sur la première.
    await fireEvent.press(screen.getByTestId('voir-plus-historique'));
    await waitFor(() => expect(screen.getByTestId('reservation-fin')).toBeTruthy());
    expect(demandes[2]).toContain(encodeURIComponent(pages[1][49].created_at));
    expect(demandes[2]).not.toContain(encodeURIComponent(pages[0][49].created_at));

    // Les trois pages sont là : la suite s'ajoute, elle ne remplace pas.
    expect(screen.getByTestId('reservation-p8-0')).toBeTruthy();
    // Et la dernière n'était pas pleine : plus rien à proposer.
    expect(screen.queryByTestId('voir-plus-historique')).toBeNull();
    // **Un délai explicite, parce que ce test est lourd par nature.** Trois
    // pages font cent une lignes, chacune montée sous une `Apparition` — la
    // pagination ne se prouve pas sur moins, puisqu'une page « pleine » vaut
    // cinquante. Le défaut n'est donc pas le test qui attend, c'est ce qu'il
    // rend, et le plafond par défaut de cinq secondes le rendait tributaire
    // de la charge de la machine.
  }, 20_000);

  it('et ne propose rien quand la première page n’est pas pleine', async () => {
    await monter([reservation({ booking_id: 'seule' })], 'en', 'en-cours');
    await waitFor(() => expect(screen.getByTestId('ecran-historique')).toBeTruthy());

    expect(screen.queryByTestId('voir-plus-historique')).toBeNull();
  });
});
