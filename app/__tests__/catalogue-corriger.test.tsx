/**
 * Corriger une prestation, et le refus de la supprimer.
 *
 * **La règle vient de ce qu'une réservation raconte.** Douze réservations
 * passées citent une prestation de quarante-cinq minutes ; la passer à
 * soixante-quinze réécrirait leur histoire. La photo, l'orthographe et la
 * description ne racontent rien de ce qui s'est passé.
 *
 * **Ce que ces tests éprouvent est le refus**, parce que c'est là que l'écran
 * peut mentir : une prestation réservée qui disparaîtrait laisserait douze
 * réservations pointer vers rien.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { CatalogueScreen } from '../src/screens/CatalogueScreen';
import {
  CORRIGEABLES,
  DEMANDENT_UNE_AUTRE,
  gesteDeRetrait,
  suiteDuRefus,
} from '../src/screens/catalogue/corriger';
import { ThemeProvider } from '../src/theme';

const ITEM = {
  id: 'i1',
  business_id: 'b1',
  parent_item_id: null,
  name: 'Gel manicure',
  description: null,
  price_cents: 4_000,
  duration_minutes: 45,
  requires_booking: true,
  photo_key: null,
  leaves_choice: false,
  source: 'manual' as const,
  is_available: true,
  is_effectively_available: true,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
};

describe('ce qui se corrige, et ce qui demande une autre prestation', () => {
  it('les deux listes ne se recouvrent jamais', () => {
    // **Un champ dans les deux serait une règle qui se contredit** : il
    // s'éditerait en place *et* créerait une nouvelle prestation, et le premier
    // des deux gestes écrit gagnerait.
    const communs = CORRIGEABLES.filter((champ) =>
      (DEMANDENT_UNE_AUTRE as readonly string[]).includes(champ),
    );
    expect(communs).toEqual([]);
  });

  it('la durée n’est pas corrigeable, et c’est tout le sujet', () => {
    expect(CORRIGEABLES as readonly string[]).not.toContain('duration_minutes');
    expect(DEMANDENT_UNE_AUTRE as readonly string[]).toContain('duration_minutes');
  });

  it('le refus de suppression se lit sur son code, pas sur son message', () => {
    // Un message dépend de la langue ; un code ne dépend de rien. Et tout autre
    // échec reste un échec — le traiter comme un refus proposerait de fermer
    // une prestation sur une panne de réseau.
    expect(suiteDuRefus('catalog_item_has_bookings')).toBe('fermer');
    expect(suiteDuRefus('internal_error')).toBeNull();
    expect(suiteDuRefus(null)).toBeNull();
  });
});

describe('à l’écran', () => {
  async function monter(surSuppression: () => Response) {
    const api = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: { lire: async () => null, ecrire: async () => {} },
      fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
        const chemin = String(url);
        if (init?.method === 'DELETE') return surSuppression();
        if (chemin.includes('/catalog-items')) {
          return { ok: true, status: 200, json: async () => [ITEM] } as Response;
        }
        return { ok: true, status: 200, json: async () => [] } as Response;
      }) as unknown as typeof fetch,
    });
    return await render(
      <I18nProvider initialLocale="en">
        <ThemeProvider role="merchant">
          <ApiProvider client={api}>
            <CatalogueScreen businessId="b1" />
          </ApiProvider>
        </ThemeProvider>
      </I18nProvider>,
    );
  }

  const ACCEPTE = () => ({ ok: true, status: 204, json: async () => null }) as Response;
  const REFUSE = () =>
    ({
      ok: false,
      status: 409,
      json: async () => ({ detail: 'catalog_item_has_bookings' }),
    }) as Response;

  it('le refus dit pourquoi, et propose le geste qui reste', async () => {
    // **Douze réservations citent cette prestation.** Les laisser pointer vers
    // rien réécrirait une histoire ; fermer arrête les nouvelles et garde les
    // anciennes lisibles.
    await monter(REFUSE);
    await waitFor(() => expect(screen.getByTestId('retirer-i1')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('retirer-i1'));

    await waitFor(() => expect(screen.getByTestId('refus-suppression-i1')).toBeTruthy());
    expect(screen.getByTestId('fermer-plutot-i1')).toBeTruthy();
  });

  it('et rien de tout cela n’apparaît quand la suppression passe', async () => {
    // Sans cette moitié, la garde passerait sur un écran qui afficherait le
    // refus quoi qu'il arrive.
    await monter(ACCEPTE);
    await waitFor(() => expect(screen.getByTestId('retirer-i1')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('retirer-i1'));

    await waitFor(() => expect(screen.queryByTestId('refus-suppression-i1')).toBeNull());
  });

  it('la correction n’offre ni durée ni palier, et dit pourquoi', async () => {
    // Sans la phrase, un gérant cherche la durée, ne la trouve pas, et conclut
    // que l'écran est incomplet — au lieu d'apprendre la règle.
    await monter(ACCEPTE);
    await waitFor(() => expect(screen.getByTestId('corriger-i1')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('corriger-i1'));

    await waitFor(() => expect(screen.getByTestId('correction-i1')).toBeTruthy());
    expect(screen.getByTestId('corriger-nom-i1')).toBeTruthy();
    expect(screen.getByTestId('corriger-description-i1')).toBeTruthy();
    expect(screen.getByText(en.composition.corrigerPortee)).toBeTruthy();
    // Ni durée, ni palier, ni contrepartie.
    expect(screen.queryByTestId('corriger-duree-i1')).toBeNull();
  });

  it('et le bouton d’enregistrement reste absent tant que rien ne change', async () => {
    // Retiré, jamais grisé : c'est la règle du dépôt, et un bouton grisé n'est
    // pas une information.
    await monter(ACCEPTE);
    await waitFor(() => expect(screen.getByTestId('corriger-i1')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('corriger-i1'));
    await waitFor(() => expect(screen.getByTestId('correction-i1')).toBeTruthy());

    expect(screen.queryByTestId('enregistrer-correction-i1')).toBeNull();

    await fireEvent.changeText(screen.getByTestId('corriger-nom-i1'), 'Gel manicure, long');
    await waitFor(() => expect(screen.getByTestId('enregistrer-correction-i1')).toBeTruthy());
  });
});


/**
 * **Le décor qui compte est celui du champ absent.** `reservations_count` est
 * neuf : les réponses en vol, les décors écrits avant lui et les caches ne le
 * portent pas. Une implémentation qui écrit `item.reservations_count > 0`
 * rend `undefined > 0` — c'est-à-dire `false` — et tombe donc juste par
 * accident ici ; mais la même écriture avec `!== 0` proposerait d'archiver une
 * prestation vierge. Les deux cas sont écrits, et le premier est celui d'où
 * part la sixième leçon du dépôt : lire un champ neuf **faux**, jamais égal.
 */
describe('lequel des deux gestes une prestation offre', () => {
  it('jamais réservée : elle se supprime vraiment', () => {
    expect(gesteDeRetrait({ archived_at: null, reservations_count: 0 })).toEqual({
      geste: 'supprimer',
    });
  });

  it('déjà réservée : elle s’archive, et le bouton porte le nombre', () => {
    expect(gesteDeRetrait({ archived_at: null, reservations_count: 12 })).toEqual({
      geste: 'archiver',
      reservations: 12,
    });
  });

  it('jamais les deux : archiver et supprimer ne coexistent pas', () => {
    for (const n of [0, 1, 12]) {
      const { geste } = gesteDeRetrait({ archived_at: null, reservations_count: n });
      expect(['supprimer', 'archiver']).toContain(geste);
    }
  });

  it('le champ absent vaut « aucune réservation », pas « une »', () => {
    expect(gesteDeRetrait({}).geste).toBe('supprimer');
    expect(gesteDeRetrait({ reservations_count: null }).geste).toBe('supprimer');
  });

  it('déjà archivée : elle n’offre plus rien, l’archivage ne se rejoue pas', () => {
    expect(gesteDeRetrait({ archived_at: '2026-08-01T00:00:00Z', reservations_count: 12 })).toEqual({
      geste: 'aucun',
    });
    // Y compris à zéro réservation : ce n'est pas le compte qui décide ici.
    expect(gesteDeRetrait({ archived_at: '2026-08-01T00:00:00Z', reservations_count: 0 })).toEqual({
      geste: 'aucun',
    });
  });
});


/**
 * Le bouton, à l'écran, quand la prestation a une histoire.
 *
 * **Le décor divergent est la route, pas le mot.** Une implémentation qui
 * change le libellé et continue d'appeler `DELETE` passerait un test qui ne
 * lit que le texte : elle afficherait « archive, 12 bookings cite this » et
 * supprimerait — ou plutôt se ferait refuser, et le gérant verrait un échec
 * après avoir lu une promesse. Ce qui est vérifié ici est donc **ce qui part
 * sur le réseau**.
 */
describe('archiver, à l’écran', () => {
  async function monterAvec(item: Record<string, unknown>) {
    const envois: { url: string; method: string }[] = [];
    const api = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: { lire: async () => null, ecrire: async () => {} },
      fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
        const chemin = String(url);
        envois.push({ url: chemin, method: (init?.method ?? 'GET').toUpperCase() });
        const methode = (init?.method ?? 'GET').toUpperCase();
        if (methode !== 'GET') {
          return { ok: true, status: 200, json: async () => null } as Response;
        }
        if (chemin.includes('/catalog-items')) {
          return { ok: true, status: 200, json: async () => [item] } as Response;
        }
        // Les paliers et les offres : des listes, comme le décor du dessus.
        return { ok: true, status: 200, json: async () => [] } as Response;
      }) as unknown as typeof fetch,
    });
    const vue = await render(
      <I18nProvider initialLocale="en">
        <ThemeProvider role="merchant">
          <ApiProvider client={api}>
            <CatalogueScreen businessId="b1" />
          </ApiProvider>
        </ThemeProvider>
      </I18nProvider>,
    );
    return { vue, envois };
  }

  it('le bouton porte le nombre, et appelle la route d’archive', async () => {
    const { envois } = await monterAvec({ ...ITEM, reservations_count: 12, archived_at: null });

    const bouton = await screen.findByTestId('retirer-i1');
    expect(bouton).toHaveTextContent(/12 bookings cite this/i);

    await fireEvent.press(bouton);

    await waitFor(() =>
      expect(envois.some((e) => e.method === 'POST' && e.url.includes('/archive'))).toBe(true),
    );
    // Et surtout : rien n'a été supprimé.
    expect(envois.filter((e) => e.method === 'DELETE')).toEqual([]);
  });

  it('une seule réservation ne dit pas « 1 bookings »', async () => {
    await monterAvec({ ...ITEM, reservations_count: 1, archived_at: null });

    expect(await screen.findByTestId('retirer-i1')).toHaveTextContent(/1 booking cites this/i);
  });

  it('jamais réservée : le bouton supprime, et le dit sans nombre', async () => {
    const { envois } = await monterAvec({ ...ITEM, reservations_count: 0, archived_at: null });

    const bouton = await screen.findByTestId('retirer-i1');
    expect(bouton).toHaveTextContent(/remove/i);

    await fireEvent.press(bouton);

    await waitFor(() => expect(envois.some((e) => e.method === 'DELETE')).toBe(true));
    expect(envois.filter((e) => e.url.includes('/archive'))).toEqual([]);
  });

  it('remplacer crée la neuve et archive l’ancienne, en un seul appel', async () => {
    // **Le décor divergent est le nombre d'appels.** Une implémentation qui
    // crée puis archive en deux temps rend le même écran ; mais une panne
    // entre les deux laisse le catalogue avec les deux prestations, ou avec
    // aucune. Ce qui est vérifié est donc qu'il n'y a **pas** d'appel à
    // `/archive` : le serveur fait les deux dans la même transaction.
    const { envois } = await monterAvec({ ...ITEM, reservations_count: 12, archived_at: null });

    await fireEvent.press(await screen.findByTestId('ouvrir-remplacement-i1'));
    // Le formulaire part des valeurs de l'ancienne : rien à retaper.
    expect(await screen.findByTestId('remplacer-i1')).toBeTruthy();

    await fireEvent.press(await screen.findByTestId('publier-la-prestation'));

    await waitFor(() =>
      expect(envois.some((e) => e.method === 'POST' && e.url.includes('/replace'))).toBe(true),
    );
    expect(envois.filter((e) => e.url.includes('/archive'))).toEqual([]);
    expect(envois.filter((e) => e.method === 'DELETE')).toEqual([]);
  });

  it('déjà archivée : plus de bouton du tout', async () => {
    await monterAvec({ ...ITEM, reservations_count: 12, archived_at: '2026-08-01T00:00:00Z' });

    await waitFor(() => expect(screen.queryByTestId('corriger-i1')).toBeTruthy());
    expect(screen.queryByTestId('retirer-i1')).toBeNull();
    // Et pas de remplacement non plus : une archive ne se remplace pas, elle
    // a déjà cédé la place à ce qui la suit.
    expect(screen.queryByTestId('ouvrir-remplacement-i1')).toBeNull();
  });
});

/**
 * Fermer une offre sans supprimer la prestation.
 *
 * **Le catalogue se composait sans se corriger.** Un salon pouvait ouvrir une
 * prestation à un palier et n'avait aucun moyen de revenir dessus : la route
 * existait depuis la phase 2, aucun écran ne l'appelait. C'était le dernier
 * geste manquant du produit.
 *
 * **Fermer n'est pas supprimer**, et c'est toute la distinction : supprimer une
 * offre que des réservations citent réécrirait leur histoire — le serveur le
 * refuse. Fermer laisse tout en place et cesse simplement de la proposer.
 */
describe('fermer une offre', () => {
  const PALIER = {
    id: 't1',
    platform: 'instagram',
    content_format: 'story',
    min_followers: 1000,
    min_completed_collabs: 0,
    min_reliability_score: null,
    value_ratio_hint: null,
    display_order: 1,
  };

  const offre = (actif: boolean) => ({
    id: 'o1',
    business_id: 'b1',
    tier_id: 't1',
    catalog_item_id: 'i1',
    platform: 'instagram',
    content_format: 'story',
    item_name: 'Gel nails',
    is_active: actif,
    is_effectively_offered: actif,
    created_at: '2026-08-01T10:00:00Z',
  });

  async function monterAvecOffre(actif: boolean) {
    const envois: { url: string; method: string; corps: unknown }[] = [];
    const api = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: { lire: async () => null, ecrire: async () => {} },
      fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
        const chemin = String(url);
        const methode = (init?.method ?? 'GET').toUpperCase();
        envois.push({
          url: chemin,
          method: methode,
          corps: init?.body ? JSON.parse(String(init.body)) : null,
        });
        if (methode !== 'GET') return { ok: true, status: 200, json: async () => null } as Response;
        if (chemin.includes('/catalog-items')) {
          return {
            ok: true,
            status: 200,
            json: async () => [{ ...ITEM, reservations_count: 12, archived_at: null }],
          } as Response;
        }
        if (chemin.includes('/tier-offers')) {
          return { ok: true, status: 200, json: async () => [offre(actif)] } as Response;
        }
        if (chemin.includes('/tiers')) {
          return { ok: true, status: 200, json: async () => [PALIER] } as Response;
        }
        return { ok: true, status: 200, json: async () => [] } as Response;
      }) as unknown as typeof fetch,
    });
    const vue = await render(
      <I18nProvider initialLocale="en">
        <ThemeProvider role="merchant">
          <ApiProvider client={api}>
            <CatalogueScreen businessId="b1" />
          </ApiProvider>
        </ThemeProvider>
      </I18nProvider>,
    );
    return { vue, envois };
  }

  it('ferme l’offre du palier qu’on ferme, et pas celle de l’autre', async () => {
    // **La divergence : une prestation ouverte à deux paliers.** Avec un seul,
    // chercher l'offre par prestation ou par (prestation, palier) rend la même
    // chose, et la mutation survit. Ici les deux implémentations donnent des
    // identifiants différents — fermer le story ne doit pas fermer le reel.
    const envois: { url: string; corps: unknown }[] = [];
    const REEL = { ...PALIER, id: 't2', content_format: 'reel', display_order: 2 };
    const api = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: { lire: async () => null, ecrire: async () => {} },
      fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
        const chemin = String(url);
        const methode = (init?.method ?? 'GET').toUpperCase();
        if (methode !== 'GET') {
          envois.push({ url: chemin, corps: init?.body ? JSON.parse(String(init.body)) : null });
          return { ok: true, status: 200, json: async () => null } as Response;
        }
        if (chemin.includes('/catalog-items')) {
          return {
            ok: true,
            status: 200,
            json: async () => [{ ...ITEM, reservations_count: 12, archived_at: null }],
          } as Response;
        }
        if (chemin.includes('/tier-offers')) {
          return {
            ok: true,
            status: 200,
            json: async () => [offre(true), { ...offre(true), id: 'o2', tier_id: 't2' }],
          } as Response;
        }
        if (chemin.includes('/tiers')) {
          return { ok: true, status: 200, json: async () => [PALIER, REEL] } as Response;
        }
        return { ok: true, status: 200, json: async () => [] } as Response;
      }) as unknown as typeof fetch,
    });
    await render(
      <I18nProvider initialLocale="en">
        <ThemeProvider role="merchant">
          <ApiProvider client={api}>
            <CatalogueScreen businessId="b1" />
          </ApiProvider>
        </ThemeProvider>
      </I18nProvider>,
    );

    await fireEvent.press(await screen.findByTestId('basculer-offre-o2'));

    await waitFor(() => expect(envois).toHaveLength(1));
    // C'est `o2` qui se ferme, pas `o1` : la ligne du reel porte l'offre du
    // reel, et fermer l'une laisse l'autre ouverte.
    expect(envois[0].url).toContain('/o2/activation');
    expect(envois[0].url).not.toContain('/o1/');
  });

  it('ferme l’offre sans rien supprimer', async () => {
    const { envois } = await monterAvecOffre(true);

    const bouton = await screen.findByTestId('basculer-offre-o1');
    await fireEvent.press(bouton);

    await waitFor(() =>
      expect(envois.some((e) => e.method === 'PUT' && e.url.includes('/activation'))).toBe(true),
    );
    const appel = envois.find((e) => e.url.includes('/activation'));
    expect(appel?.corps).toEqual({ is_active: false });

    // **La distinction qui fait tout ce lot.** Douze réservations citent cette
    // prestation : la supprimer réécrirait leur histoire, et le serveur le
    // refuse. Rien ne part en DELETE.
    expect(envois.filter((e) => e.method === 'DELETE')).toEqual([]);
  });

  it('rouvre une offre fermée, et dit ce que fermer n’a pas fait', async () => {
    // La divergence : même décor, seul `is_active` change. Un écran qui
    // proposerait toujours « fermer » passerait le test précédent.
    const { envois } = await monterAvecOffre(false);

    expect(await screen.findByTestId('offre-fermee-o1')).toHaveTextContent(
      /past bookings still show it/i,
    );

    await fireEvent.press(screen.getByTestId('basculer-offre-o1'));

    await waitFor(() =>
      expect(envois.some((e) => e.url.includes('/activation'))).toBe(true),
    );
    expect(envois.find((e) => e.url.includes('/activation'))?.corps).toEqual({ is_active: true });
  });
});
