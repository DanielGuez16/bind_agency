/**
 * Ce qu'une reprise reproche, et ce qu'elle ne reproche pas.
 *
 * **Le seul écran qui doit porter le reproche était le seul à ne pas l'avoir.**
 * L'écran créateur disait « une nouvelle soumission a été demandée » et rien de
 * plus : il invitait à recommencer sans dire quoi corriger. Le code du dernier
 * refus voyage désormais jusqu'ici — le même que la file du commerce lit, relu
 * du journal d'audit.
 *
 * **Et il doit dire aussi ce qui allait.** C'est la règle de la planche v3, et
 * elle tient à ce qu'un manque non borné se lit comme un tout à refaire :
 * « la mention manque » sur une story tournée, montée et publiée laisse croire
 * qu'il faut la retourner. « La mention manque, le lieu y était » dit la même
 * chose et demande trente secondes.
 *
 * **Ce qui allait se déduit du contrat, jamais de rien.** Le commerce choisit
 * **un** motif dans une liste fermée — c'est le reproche entier tel qu'il est
 * enregistré — donc les autres exigences du contrat n'ont pas bloqué. Les
 * autres exigences **du contrat** : une mention qui n'a jamais été demandée
 * n'était pas « là », et l'annoncer comme intacte inventerait une conformité
 * sur une exigence qui n'existe pas. Quand il ne reste rien à rassurer, la
 * ligne ne s'écrit pas.
 */
import { MOTIFS, type MotifDeDecision } from '../motifs';

/** Les deux exigences que le créateur peut corriger sans rien retourner. */
export type ExigenceIntacte = 'mention' | 'lieu';

export type Reprise = {
  /**
   * Le motif codé, quand c'en est un. `null` pour une phrase écrite avant le
   * vocabulaire fermé : elle se rend telle quelle, et rien ne s'en déduit.
   */
  motif: MotifDeDecision | null;
  /** Ce que le refus n'a pas nommé, et que le contrat exigeait pourtant. */
  intactes: ExigenceIntacte[];
};

/** L'exigence que chaque motif met en cause. `null` quand il n'en vise aucune :
 * un format inattendu ou une capture illisible ne disent rien de la mention ni
 * du lieu, qui restent donc tous deux intacts. */
const VISEE: Record<MotifDeDecision, ExigenceIntacte | null> = {
  missing_mention: 'mention',
  missing_location: 'lieu',
  wrong_format: null,
  low_quality: null,
};

export function lireLaReprise(
  dernierMotif: string | null,
  contrat: { required_mention: string | null; required_geotag: boolean },
): Reprise | null {
  // **Falsy et non `=== null`.** Une route qui n'aurait pas encore le champ
  // le laisse absent, et `undefined !== null` aurait rendu « undefined » en
  // guise de motif. La chaîne vide se traite pareil : elle ne reproche rien.
  if (!dernierMotif) return null;

  const connu = (MOTIFS as readonly string[]).includes(dernierMotif);
  if (!connu) return { motif: null, intactes: [] };

  const motif = dernierMotif as MotifDeDecision;
  const visee = VISEE[motif];

  // L'ordre est celui de la planche : la mention avant le lieu, comme dans le
  // contrat juste au-dessus. Une phrase qui les inverserait se lirait comme un
  // second sujet.
  const exigees: ExigenceIntacte[] = [];
  if (contrat.required_mention !== null) exigees.push('mention');
  if (contrat.required_geotag) exigees.push('lieu');

  return { motif, intactes: exigees.filter((exigence) => exigence !== visee) };
}
