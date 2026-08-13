/**
 * Où en est une fiche préparée, lu sur ses dates.
 *
 * Une fonction pure, dans son propre fichier : elle n'a besoin ni d'un rendu ni
 * d'un client, et la mêler aux tests d'écran ferait porter à quatre assertions
 * de logique le coût d'un arbre React.
 *
 * **Ce qu'elle garde : l'ordre des conditions.** « Assumée » l'emporte sur tout
 * le reste — une fiche prise en main la veille de l'expiration se lirait
 * « lien expiré » si l'ordre était inversé, et la mesure du démarchage
 * compterait un échec là où il y a eu une signature.
 */
import { etatDeLaFiche } from '../src/screens/TerrainScreen';

// --------------------------------------------------------------------------
// l'état d'une fiche, lu sur ses dates
// --------------------------------------------------------------------------

describe('état d’une fiche préparée', () => {
  const base = {
    business_id: 'p1',
    name: 'Salon Ocean',
    status: 'draft' as const,
    address: null,
    prepared_at: '2026-08-01T10:00:00Z',
    issued_at: null,
    expires_at: null,
    used_at: null,
    revoked_at: null,
    channel: null,
  };
  const maintenant = new Date('2026-08-13T12:00:00Z');

  it('préparée tant qu’aucun lien n’est parti', () => {
    expect(etatDeLaFiche(base, maintenant)).toBe('preparee');
  });

  it('lien ouvert quand il est émis et pas encore échu', () => {
    expect(
      etatDeLaFiche(
        { ...base, issued_at: '2026-08-12T10:00:00Z', expires_at: '2026-08-20T10:00:00Z' },
        maintenant,
      ),
    ).toBe('lien-ouvert');
  });

  it('lien expiré passé son terme', () => {
    expect(
      etatDeLaFiche(
        { ...base, issued_at: '2026-08-01T10:00:00Z', expires_at: '2026-08-08T10:00:00Z' },
        maintenant,
      ),
    ).toBe('lien-expire');
  });

  it('revient à « préparée » quand le lien a été révoqué', () => {
    // Révoquer ne recule pas la fiche : elle attend toujours, et le geste qui
    // s'offre est bien d'en émettre un nouveau.
    expect(
      etatDeLaFiche(
        {
          ...base,
          issued_at: '2026-08-12T10:00:00Z',
          expires_at: '2026-08-20T10:00:00Z',
          revoked_at: '2026-08-12T11:00:00Z',
        },
        maintenant,
      ),
    ).toBe('preparee');
  });

  it('assumée l’emporte sur tout le reste', () => {
    // **Y compris sur un lien expiré.** Une fiche prise en main la veille de
    // l'expiration se lirait « lien expiré » si l'ordre des conditions était
    // inversé — et la mesure du démarchage compterait un échec là où il y a eu
    // une signature.
    expect(
      etatDeLaFiche(
        {
          ...base,
          issued_at: '2026-08-01T10:00:00Z',
          expires_at: '2026-08-08T10:00:00Z',
          used_at: '2026-08-02T10:00:00Z',
        },
        maintenant,
      ),
    ).toBe('assumee');
  });
});
