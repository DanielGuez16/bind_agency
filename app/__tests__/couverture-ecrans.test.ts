/**
 * Tout écran est couvert, ou nommé comme ne l'étant pas.
 *
 * C'est le test qui empêche les quatre états d'être une intention : sans lui,
 * un écran écrit sans entrée au registre passerait entre les mailles, et c'est
 * exactement l'écran qu'on écrit vite qui en aurait le plus besoin.
 */
import { readdirSync } from 'fs';
import { join } from 'path';

import { ECRANS_COMMERCE, ECRANS_CREATEUR, HORS_REGISTRE } from '../test-support/registre-ecrans';

describe('couverture des écrans', () => {
  const fichiers = readdirSync(join(__dirname, '..', 'src', 'screens'))
    .filter((f) => f.endsWith('Screen.tsx'))
    .sort();

  it('chaque écran est dans un registre, ou nommé hors registre', () => {
    const declares = [...ECRANS_CREATEUR, ...ECRANS_COMMERCE, ...HORS_REGISTRE].sort();
    expect(fichiers).toEqual(declares);
  });

  it('aucun écran n’est déclaré deux fois', () => {
    const declares = [...ECRANS_CREATEUR, ...ECRANS_COMMERCE, ...HORS_REGISTRE];
    expect(new Set(declares).size).toBe(declares.length);
  });

  it('la liste hors registre ne grossit pas', () => {
    // Huit : la connexion et les réglages, qui ne chargent rien à quatre
    // états ; l'écran de code, qui garde son dernier code y compris hors
    // ligne ; l'accueil après inscription, qui explique et propose sans rien
    // charger ; la table des matières de la configuration, qui n'a que trois
    // portes ; et les trois écrans de la dette d'avant le système de design.
    // Ce test tombe si quelqu'un y range un écran de plus pour éviter d'écrire
    // ses états. Le plafond ne monte qu'avec sa raison, écrite dans la liste.
    //
    // Passé à neuf pour l'accueil : il charge un fond, et l'absence de ce fond
    // n'est pas une erreur mais un des cas prévus. Un état « en échec » y
    // afficherait « impossible de charger la vidéo » sur la première chose
    // qu'on voit du produit — pire que le fond manquant.
    //
    // Passé à dix pour la prise en main : elle s'ouvre avant la porte
    // d'authentification, sur un lien et sans compte. Un lien mort n'y est pas
    // une erreur de chargement mais le cas prévu, et un bouton « réessayer »
    // n'y réessaierait rien. Ses trois états ont leur propre fichier.
    //
    // Passé à onze pour la création d'un commerce : elle n'est pas un écran
    // monté par le navigateur mais le contenu de l'état vide de l'écran
    // d'attente. Le chargement et l'erreur sont ceux de la requête
    // d'appartenance, rendus par l'`Ecran` qui l'enveloppe ; le formulaire
    // lui-même ne charge rien.
    expect(HORS_REGISTRE).toHaveLength(11);
  });
});
