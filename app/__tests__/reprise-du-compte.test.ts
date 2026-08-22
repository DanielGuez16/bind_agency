/**
 * Ce que le salon lit d'une reprise, et ce qu'il ne doit pas confondre.
 *
 * **Le décor divergent est celui de l'échéance passée sans fermeture.** C'est
 * le seul où les deux implémentations rendent un verdict différent : celle qui
 * lit `ended_at` seul dit « en cours » pour toujours, celle qui confond
 * expiration et fermeture dit « refermée » d'une reprise que personne n'a
 * refermée. Le service écrit que c'est la seconde qui devrait gêner — une
 * porte laissée ouverte jusqu'au bout n'est pas une porte qu'on a fermée.
 */
import type { RepriseDuCompte } from '../src/api';
import { etatDeLaReprise, repriseEnCours } from '../src/screens/journee/reprise';

const IL_Y_A_DEUX_HEURES = new Date(Date.now() - 2 * 3_600_000).toISOString();
const IL_Y_A_UNE_HEURE = new Date(Date.now() - 3_600_000).toISOString();
const DANS_UNE_HEURE = new Date(Date.now() + 3_600_000).toISOString();

function reprise(extra: Partial<RepriseDuCompte> = {}): RepriseDuCompte {
  return {
    id: 'r1',
    business_id: 'b1',
    admin_user_id: 'a1',
    reason: 'Fixing the weekly hours.',
    started_at: IL_Y_A_DEUX_HEURES,
    expires_at: DANS_UNE_HEURE,
    ended_at: null,
    ...extra,
  } as unknown as RepriseDuCompte;
}

describe('une reprise échue n’est pas une reprise fermée', () => {
  it('échue sans fermeture : expirée, et surtout pas refermée', () => {
    expect(etatDeLaReprise(reprise({ expires_at: IL_Y_A_UNE_HEURE, ended_at: null }))).toBe(
      'expiree',
    );
  });

  it('refermée : quelqu’un a agi, et la date le dit', () => {
    expect(
      etatDeLaReprise(reprise({ expires_at: DANS_UNE_HEURE, ended_at: IL_Y_A_UNE_HEURE })),
    ).toBe('refermee');
  });

  it('refermée avant l’échéance reste refermée, pas expirée', () => {
    // L'ordre des deux tests compte : une implémentation qui regarde
    // l'échéance d'abord rendrait « expirée » sur une reprise close hier.
    expect(
      etatDeLaReprise(reprise({ expires_at: IL_Y_A_UNE_HEURE, ended_at: IL_Y_A_DEUX_HEURES })),
    ).toBe('refermee');
  });

  it('le champ absent ne vaut pas « refermée »', () => {
    const sansLeChamp = { expires_at: DANS_UNE_HEURE } as unknown as RepriseDuCompte;
    expect(etatDeLaReprise(sansLeChamp)).toBe('en-cours');
  });

  it('une échéance illisible laisse le bandeau allumé', () => {
    // Éteindre sur une date qu'on n'a pas su lire cacherait une reprise en
    // cours — l'erreur qui compte n'est pas d'afficher de trop.
    expect(etatDeLaReprise(reprise({ expires_at: 'pas une date' }))).toBe('en-cours');
  });
});

describe('laquelle court', () => {
  it('une réponse qui n’est pas une liste éteint le bandeau, sans lever', () => {
    // Le type l'affirme, le réseau ne le garantit pas. Sur l'écran le plus
    // ouvert du produit, se taire vaut mieux que tomber.
    expect(repriseEnCours({} as never)).toBeNull();
    expect(repriseEnCours('<html>502</html>' as never)).toBeNull();
  });

  it('aucune quand la liste est vide, nulle, ou toute close', () => {
    expect(repriseEnCours([])).toBeNull();
    expect(repriseEnCours(null)).toBeNull();
    expect(repriseEnCours([reprise({ ended_at: IL_Y_A_UNE_HEURE })])).toBeNull();
    expect(repriseEnCours([reprise({ expires_at: IL_Y_A_UNE_HEURE })])).toBeNull();
  });

  it('la plus récemment ouverte, quand deux administrateurs sont entrés', () => {
    const ancienne = reprise({ id: 'vieille', started_at: IL_Y_A_DEUX_HEURES });
    const fraiche = reprise({ id: 'fraiche', started_at: IL_Y_A_UNE_HEURE });
    // Dans les deux ordres : une implémentation qui prend le premier de la
    // liste passe l'un et tombe sur l'autre.
    expect(repriseEnCours([ancienne, fraiche])?.id).toBe('fraiche');
    expect(repriseEnCours([fraiche, ancienne])?.id).toBe('fraiche');
  });

  it('ignore les closes pour choisir parmi les ouvertes', () => {
    const close = reprise({ id: 'close', started_at: IL_Y_A_UNE_HEURE, ended_at: IL_Y_A_UNE_HEURE });
    const ouverte = reprise({ id: 'ouverte', started_at: IL_Y_A_DEUX_HEURES });
    // La close est *plus récente* : une implémentation qui trie avant de
    // filtrer la choisirait, et le bandeau citerait un motif périmé.
    expect(repriseEnCours([close, ouverte])?.id).toBe('ouverte');
  });
});
