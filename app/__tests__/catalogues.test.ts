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
