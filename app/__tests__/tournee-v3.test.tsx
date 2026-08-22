/**
 * La tournée v3 : des faits d'un côté, des engagements de l'autre.
 *
 * **La règle qui dessine les deux écrans.** Un nom, une adresse, des horaires
 * sont vrais indépendamment de qui les saisit — la fondatrice peut donc les
 * porter. Un mot de passe, des conditions acceptées, une mise en ligne
 * n'existent que par celui qui les pose, et rien ne peut les préparer à sa
 * place. Ce n'est pas une simplification pour aller vite au comptoir : c'est la
 * seule forme que le mode terrain puisse avoir.
 *
 * **Et le bilan répond à une autre question que les trois autres écrans.** Eux
 * servent une visite ; celui-ci se lit assis, et demande si la tournée valait le
 * déplacement. Ce que ces tests éprouvent d'abord est donc l'arithmétique — la
 * seule chose ici qui puisse être fausse plutôt que laide.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { mainsDeLaFiche } from '../src/screens/terrain/mains';
import { bilanDeTournee } from '../src/screens/terrain/tournee';

const FICHE = (extra: Record<string, unknown> = {}) => ({
  business_id: 'b1',
  name: 'Studio Lume',
  status: 'draft',
  address: null,
  prepared_at: '2026-08-19T09:00:00Z',
  issued_at: null,
  expires_at: null,
  used_at: null,
  revoked_at: null,
  channel: null,
  ...extra,
});

const REMISE = (voie: 'qr' | 'email', extra: Record<string, unknown> = {}) =>
  FICHE({
    issued_at: '2026-08-19T10:00:00Z',
    expires_at: '2026-08-26T10:00:00Z',
    channel: voie,
    ...extra,
  });

describe('le mode terrain ne porte aucun engagement', () => {
  it('ni mot de passe, ni conditions, ni mise en ligne', () => {
    // **La règle centrale de la planche, et elle se vérifie sur la source.**
    // Un champ ajouté « pour aller plus vite au comptoir » ferait préparer un
    // engagement à la place de quelqu'un — un salon préparé n'est pas un salon
    // inscrit, il n'a pas d'utilisateur et n'apparaît dans aucun fil.
    //
    // Sur la source et non sur le rendu : ce qu'on veut tenir est qu'aucun
    // champ de ce genre n'existe, et un champ conditionnel ne se voit pas en
    // montant l'écran dans son état nominal.
    const source = readFileSync(
      join(__dirname, '..', 'src', 'screens', 'TerrainScreen.tsx'),
      'utf-8',
    );
    // Les commentaires expliquent précisément pourquoi ces champs sont absents :
    // ils ne comptent pas.
    const code = source
      .split('\n')
      .filter((ligne) => !/^\s*(\/\/|\*|\/\*)/.test(ligne))
      .join('\n');

    for (const interdit of [/secureTextEntry/, /password/i, /\bterms\b/i, /Toggle/]) {
      expect({ interdit: String(interdit), trouve: interdit.test(code) }).toEqual({
        interdit: String(interdit),
        trouve: false,
      });
    }
  });
});

describe('le bilan de la tournée', () => {
  it('compte les remises, les reprises, et le délai médian', () => {
    const bilan = bilanDeTournee([
      FICHE(),
      REMISE('qr', { used_at: '2026-08-19T14:00:00Z' }),
      REMISE('email', { used_at: '2026-08-20T10:00:00Z' }),
      REMISE('email'),
    ] as never);

    expect(bilan).toMatchObject({ preparees: 4, remises: 3, activees: 2 });
    // Quatre heures et vingt-quatre heures : la médiane de deux valeurs est
    // leur moyenne.
    expect(bilan.delaiMedianHeures).toBe(14);
  });

  it('une fiche retirée compte dans les remises', () => {
    // **La visite a bien eu lieu.** L'oublier flatterait le taux d'activation,
    // qui est précisément le chiffre sur lequel on décide de la méthode.
    const bilan = bilanDeTournee([REMISE('qr', { revoked_at: '2026-08-20T09:00:00Z' })] as never);
    expect(bilan.remises).toBe(1);
  });

  it('sépare les deux voies, parce que c’est l’écart qui décide', () => {
    // **Le cas qui diverge d'un taux global.** Deux voies aux rendements très
    // différents donnent un taux moyen qui ne décrit ni l'une ni l'autre — et
    // c'est précisément la comparaison qu'on vient chercher.
    const bilan = bilanDeTournee([
      REMISE('qr', { used_at: '2026-08-19T14:00:00Z' }),
      REMISE('qr', { used_at: '2026-08-19T15:00:00Z' }),
      REMISE('email', { used_at: '2026-08-20T10:00:00Z' }),
      REMISE('email'),
      REMISE('email'),
    ] as never);

    const parVoie = Object.fromEntries(bilan.voies.map((voie) => [voie.voie, voie.taux]));
    expect(parVoie.qr).toBe(1);
    expect(parVoie.email).toBeCloseTo(1 / 3);
  });

  it('et ne rend pas de taux sur zéro remise', () => {
    // « 0 % » se lit comme un échec ; l'absence de données n'en est pas un.
    const bilan = bilanDeTournee([REMISE('qr', { used_at: '2026-08-19T14:00:00Z' })] as never);
    expect(bilan.voies.find((voie) => voie.voie === 'email')?.taux).toBeNull();
  });

  it('un délai négatif ne compte pas', () => {
    // Une activation antérieure à la remise est une donnée incohérente, pas un
    // délai de moins zéro : la faire entrer dans la médiane la fausserait sans
    // que rien ne le dise.
    const bilan = bilanDeTournee([
      REMISE('qr', { issued_at: '2026-08-19T10:00:00Z', used_at: '2026-08-18T10:00:00Z' }),
    ] as never);
    expect(bilan.delaiMedianHeures).toBeNull();
  });

  it('sans aucune activation, le délai est nul et jamais zéro', () => {
    // Zéro heure se lirait « ils activent tout de suite », qui est le contraire
    // de ce qui se passe.
    expect(bilanDeTournee([REMISE('email')] as never).delaiMedianHeures).toBeNull();
  });

  it('et une liste absente ne fait pas tomber le bilan', () => {
    expect(bilanDeTournee(null)).toMatchObject({ preparees: 0, remises: 0 });
  });
});

describe('qui a préparé, et qui a remis', () => {
  const MAINS = (prepared: string | null, remis: string | null) =>
    mainsDeLaFiche({ prepared_by: prepared, remis_par: remis });

  it('la même main ne s’écrit qu’une fois', () => {
    // **Le cas courant.** Écrire son adresse deux fois sur la même ligne
    // n'ajoute rien et allonge une liste qu'on parcourt.
    expect(MAINS('amelie@bind.example', 'amelie@bind.example')).toEqual({
      preparee: 'amelie@bind.example',
      remiseParUnAutre: null,
    });
  });

  it('et deux mains différentes se disent toutes les deux', () => {
    // **Le cas qui diverge de « n'affiche que le préparateur ».** Préparer
    // quarante fiches au bureau et en remettre vingt en tournée sont deux
    // gestes, et c'est là que la comparaison des méthodes commence.
    expect(MAINS('amelie@bind.example', 'theo@bind.example')).toMatchObject({
      preparee: 'amelie@bind.example',
      remiseParUnAutre: 'theo@bind.example',
    });
  });

  it('une fiche remise sans préparateur connu dit qui l’a remise', () => {
    // C'est la seule main qu'on ait : la taire laisserait la ligne muette.
    expect(MAINS(null, 'theo@bind.example').remiseParUnAutre).toBe('theo@bind.example');
  });

  it('et rien de tout cela ne fait tomber une fiche sans main', () => {
    expect(MAINS(null, null)).toEqual({ preparee: null, remiseParUnAutre: null });
    expect(mainsDeLaFiche({} as never)).toEqual({ preparee: null, remiseParUnAutre: null });
  });
});
