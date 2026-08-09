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

describe('les codes du serveur ne s’affichent jamais bruts', () => {
  /**
   * Le défaut : « business_member » sous les yeux d'un commerçant,
   * « awaiting_business » dans une journée, un signal de vérification affiché
   * sous son identifiant. Chaque fois, une chaîne oubliée.
   *
   * Le piège en corrigeant est d'inventer des clés qui ne correspondent à rien
   * — c'est arrivé ici même, avec cinq signaux plausibles et faux. Ce test
   * compare le catalogue aux valeurs que le serveur déclare vraiment.
   */
  const FAMILLES = [
    { section: 'roles', enumeration: 'UserRole' },
    { section: 'contrepartie', enumeration: 'CollaborationStatus' },
    { section: 'signaux', enumeration: 'Signal' },
    { section: 'verdicts', enumeration: 'VerdictSignal' },
  ] as const;

  /** Les valeurs d'une énumération Python, lues dans la source de l'API. */
  function valeursDe(nom: string): string[] {
    const { readFileSync, readdirSync } = require('fs') as typeof import('fs');
    const { join } = require('path') as typeof import('path');
    const racine = join(__dirname, '..', '..', 'api', 'app');

    const fichiers: string[] = [];
    const parcourir = (dossier: string) => {
      for (const entree of readdirSync(dossier, { withFileTypes: true })) {
        const chemin = join(dossier, entree.name);
        if (entree.isDirectory()) parcourir(chemin);
        else if (entree.name.endsWith('.py')) fichiers.push(chemin);
      }
    };
    parcourir(racine);

    for (const chemin of fichiers) {
      const source = readFileSync(chemin, 'utf-8');
      const debut = source.indexOf(`class ${nom}(StrEnum)`);
      if (debut === -1) continue;
      const fin = source.indexOf('\nclass ', debut + 1);
      const bloc = source.slice(debut, fin === -1 ? undefined : fin);
      return [...bloc.matchAll(/^\s+[A-Z_]+ = "([a-z_]+)"$/gm)].map((m) => m[1]);
    }
    throw new Error(`énumération introuvable : ${nom}`);
  }

  it.each(FAMILLES)('$section couvre toutes les valeurs de $enumeration', ({ section, enumeration }) => {
    const valeurs = valeursDe(enumeration);
    expect(valeurs.length).toBeGreaterThan(0);

    for (const valeur of valeurs) {
      expect(Object.keys((en as Record<string, object>)[section])).toContain(valeur);
      expect(Object.keys((es as Record<string, object>)[section])).toContain(valeur);
    }
  });
});
