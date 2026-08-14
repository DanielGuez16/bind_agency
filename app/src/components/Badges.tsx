/**
 * Badges de profil.
 *
 * **Il n'existe aucun badge négatif dans le système.** Un profil ne porte que
 * ce qui a été fait ; ce qui a mal tourné vit dans le score de fiabilité, qui
 * n'est pas public.
 *
 * **Deux badges au maximum**, comportement d'abord. Au-delà, ils cessent d'être
 * lus et deviennent une texture.
 *
 * Le badge de vague a été retiré : une vague est une cohorte que quelqu'un
 * ouvre et ferme, et rien en base ne la porte. La dériver d'un horodatage
 * d'inscription inventerait une décision que personne n'a prise.
 */
import { View } from 'react-native';

import { produit } from '../theme';
import { Chip } from './Chip';

const MAX_VISIBLE = produit.badge.maxVisible;

export type BadgeDeProfil =
  | { genre: 'comportement'; label: string }
  | { genre: 'nouveau'; label: string };

/** L'ordre du jeton, pas un ordre écrit ici. */
const RANG: Record<BadgeDeProfil['genre'], number> = {
  comportement: produit.badge.priority.indexOf('behaviour'),
  nouveau: produit.badge.priority.indexOf('newcomer'),
};

export function BadgesDeProfil({
  badges,
  testID,
}: {
  badges: BadgeDeProfil[];
  testID?: string;
}) {
  const visibles = [...badges].sort((a, b) => RANG[a.genre] - RANG[b.genre]).slice(0, MAX_VISIBLE);

  return (
    <View testID={testID} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {visibles.map((badge) => (
        <Chip key={`${badge.genre}:${badge.label}`} label={badge.label} />
      ))}
    </View>
  );
}

/**
 * Chip de comportement, cumulable et jamais décroissante.
 *
 * `zero` n'existe pas : « 0 publication livrée » se tait. Un compteur à zéro
 * affiché est un reproche, et le système n'en fait pas.
 */
export function chipDeComportement(nombre: number, label: string): BadgeDeProfil | null {
  return nombre > 0 ? { genre: 'comportement', label } : null;
}
