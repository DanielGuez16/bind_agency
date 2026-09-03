/**
 * Chaque état de tournée a son mot, dans les deux langues.
 *
 * **Le défaut, vu par capture d'écran.** La carte écrivait
 * `[MISSING "en.terrain.etat.claimed" TRANSLATION]` à l'utilisateur. Ce n'était
 * pas une clé oubliée : le bloc portait quatre clés françaises — `preparee`,
 * `lien-ouvert`, `lien-expire`, `assumee` — héritées d'avant que
 * `EtatDeLaTournee` se fixe sur les cinq valeurs du serveur. **Aucune ne
 * correspondait**, donc aucun état ne se traduisait ; on ne l'a vu que sur la
 * carte qu'on regardait.
 *
 * **Pourquoi rien ne le disait.** La clé est composée —
 * `t(\`terrain.etat.${etat}\`)` — donc `tsc` ne la voit pas, et la garde des
 * catalogues compare les catalogues entre eux : deux catalogues faux à
 * l'identique restent d'accord. Ce qui manquait est la confrontation au
 * **type**, seul endroit où les cinq valeurs sont écrites.
 */
import { en } from '../src/i18n/en';
import { es } from '../src/i18n/es';

/**
 * Les cinq états, recopiés du type.
 *
 * Écrits ici parce qu'un type TypeScript n'existe pas à l'exécution. C'est la
 * seule duplication du fichier, et c'est elle qu'on éprouve : le jour où le
 * serveur en ajoute un, ce test tombe et demande les deux mots.
 */
const ETATS = [
  'prepared',
  'never_opened',
  'opened_not_claimed',
  'blocked_on_commitment',
  'claimed',
] as const;

it('les deux catalogues portent les cinq états', () => {
  for (const catalogue of [en, es]) {
    for (const etat of ETATS) {
      const mot = (catalogue.terrain.etat as Record<string, string>)[etat];
      expect(typeof mot).toBe('string');
      expect(mot.length).toBeGreaterThan(0);
    }
  }
});

it('et n’en portent aucun de plus', () => {
  // **Le pendant, et il porte le test.** Ajouter les cinq bonnes clés à côté
  // des quatre périmées aurait passé le cas d'à côté — et laissé quatre clés
  // mortes que la prochaine relecture aurait crues vivantes.
  for (const catalogue of [en, es]) {
    expect(Object.keys(catalogue.terrain.etat).sort()).toEqual([...ETATS].sort());
  }
});
