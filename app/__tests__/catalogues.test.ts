/**
 * Le plus important des trois tests : il échoue à la première clé oubliée.
 *
 * TypeScript attrape déjà l'oubli de structure via le type `Catalogue`, mais
 * pas l'oubli côté API — un nouveau code d'erreur ajouté au backend sans son
 * message ici passerait à travers. Ce test compare les deux catalogues entre
 * eux, et la liste des codes d'erreur avec ce que déclare l'API.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { catalogues } from '../src/i18n';
import { en } from '../src/i18n/en';
import { es } from '../src/i18n/es';

function clesAplaties(objet: unknown, prefixe = ''): string[] {
  if (typeof objet !== 'object' || objet === null) return [prefixe];
  return Object.entries(objet).flatMap(([cle, valeur]) =>
    clesAplaties(valeur, prefixe ? `${prefixe}.${cle}` : cle),
  );
}

describe('catalogues de traduction', () => {
  it('anglais et espagnol ont exactement le même jeu de clés', () => {
    const clesEn = clesAplaties(en).sort();
    const clesEs = clesAplaties(es).sort();

    expect(clesEs).toEqual(clesEn);
  });

  it('aucune valeur vide', () => {
    for (const [langue, catalogue] of Object.entries(catalogues)) {
      const vides = clesAplaties(catalogue).filter((cle) => {
        const valeur = cle
          .split('.')
          .reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], catalogue);
        return typeof valeur !== 'string' || valeur.trim() === '';
      });
      expect({ langue, vides }).toEqual({ langue, vides: [] });
    }
  });

  it('couvre toutes les raisons de refus d’éligibilité', () => {
    // Trouvé en écrivant l'écran des paliers : aucune raison de refus n'était
    // au catalogue, et l'écran affichait « undefined » à chaque obstacle. Les
    // raisons ne sont pas des `ErrorCode` — elles vivent dans leur propre
    // énumération — donc le test des codes d'erreur ne les voyait pas.
    const source = readFileSync(
      join(__dirname, '..', '..', 'api', 'app', 'services', 'eligibility.py'),
      { encoding: 'utf-8' },
    );
    const bloc = source.slice(source.indexOf('class RaisonRefus'));
    const raisons = [...bloc.slice(0, bloc.indexOf('\n\n\n')).matchAll(/= "([a-z_]+)"/g)].map(
      (m) => m[1],
    );

    expect(raisons.length).toBeGreaterThan(5);
    for (const raison of raisons) {
      expect(Object.keys(en.errors)).toContain(raison);
    }
  });

  it('couvre tous les codes d’erreur déclarés par l’API', () => {
    // Source de vérité : api/app/core/errors.py. Lu tel quel plutôt que
    // recopié, sinon la copie dérive sans que personne ne s'en aperçoive.
    const source = readFileSync(join(__dirname, '..', '..', 'api', 'app', 'core', 'errors.py'), {
      encoding: 'utf-8',
    });
    const codesApi = [...source.matchAll(/^\s{4}[A-Z_]+ = "([a-z_]+)"$/gm)].map((m) => m[1]);

    expect(codesApi.length).toBeGreaterThan(0);
    for (const code of codesApi) {
      expect(Object.keys(en.errors)).toContain(code);
    }
  });
});
