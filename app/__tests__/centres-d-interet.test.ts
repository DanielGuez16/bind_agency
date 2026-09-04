/**
 * La liste fermée doit être la même des deux côtés.
 *
 * **Ce que la garde des clés de traduction ne peut plus voir.** L'écran
 * compose sa clé — `t(`interets.${valeur}`)` — et une clé composée ne se
 * résout pas sans exécuter le code : la garde générale la compte et passe son
 * chemin. La couverture qu'elle perd est rendue ici, sur les dix valeurs.
 *
 * **Et la liste est lue dans l'énumération Python, pas recopiée.** Une liste
 * tenue à la main serait exactement le décor que le code fautif produit : elle
 * serait d'accord avec ce qu'on vient d'écrire, y compris le jour où on aurait
 * oublié une valeur des deux côtés à la fois. Une valeur déclarée par l'écran
 * mais absente du serveur passerait la saisie et se ferait refuser par la
 * `CHECK` de `creator_profile`, sous une erreur qui ne dit rien.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { en } from '../src/i18n/en';
import { es } from '../src/i18n/es';
import { CENTRES_D_INTERET, INTERETS_MAXIMUM, basculer } from '../src/screens/interets/liste';

function valeursDuServeur(): string[] {
  const source = readFileSync(
    join(__dirname, '..', '..', 'api', 'app', 'models', 'enums.py'),
    'utf-8',
  );
  const bloc = source.slice(source.indexOf('class CentreDInteret'));
  return [...bloc.slice(0, bloc.indexOf('\nclass ')).matchAll(/^\s+\w+ = "(\w+)"$/gm)].map(
    (m) => m[1],
  );
}

describe('la liste fermée des centres d’intérêt', () => {
  it('porte exactement les valeurs du serveur, dans le même ordre', () => {
    const serveur = valeursDuServeur();

    // Le volume d'abord : le jour où la lecture du fichier casse, elle rendrait
    // une liste vide et l'égalité passerait sur deux vides.
    expect(serveur.length).toBeGreaterThanOrEqual(10);
    expect([...CENTRES_D_INTERET]).toEqual(serveur);
  });

  it('et chaque valeur a son libellé dans les deux langues', () => {
    const sansAnglais = CENTRES_D_INTERET.filter(
      (valeur) => typeof en.interets[valeur] !== 'string',
    );
    const sansEspagnol = CENTRES_D_INTERET.filter(
      (valeur) => typeof es.interets[valeur] !== 'string',
    );

    expect(sansAnglais).toEqual([]);
    // Le sens qu'on ne relit pas est celui qui souffre.
    expect(sansEspagnol).toEqual([]);
  });
});

describe('cocher et décocher', () => {
  it('ajoute, retire, et refuse le quatrième sans rien remplacer', () => {
    // **Le cas qui diverge.** Faire tourner la sélection au delà de la borne
    // serait plus permissif et bien pire : la créatrice verrait un intérêt
    // qu'elle a choisi disparaître sans l'avoir touché. Le décor l'attrape
    // parce qu'il vérifie que les trois premiers sont **encore là**, et pas
    // seulement que la longueur vaut trois.
    const trois = basculer(basculer(basculer([], 'coiffure'), 'ongles'), 'maquillage');
    expect(trois).toEqual(['coiffure', 'ongles', 'maquillage']);
    expect(trois.length).toBe(INTERETS_MAXIMUM);

    const quatrieme = basculer(trois, 'fitness');
    expect(quatrieme).toEqual(['coiffure', 'ongles', 'maquillage']);

    // Décocher reste possible quand la borne est atteinte, sinon on ne
    // pourrait plus jamais changer d'avis.
    expect(basculer(trois, 'ongles')).toEqual(['coiffure', 'maquillage']);
  });
});
