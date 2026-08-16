/**
 * Quelle branche la racine affiche.
 *
 * **Ici et pas dans `App.tsx`, pour qu'un test puisse la lire.** Importer
 * `App` depuis un test tire `expo-font`, puis `expo-asset`, qui n'existe pas
 * hors appareil : la suite échoue au chargement du fichier. Une fonction pure
 * qui décide d'une clé n'a besoin de rien de tout cela.
 */

/**
 * Le nom de la branche affichée par la racine.
 *
 * Il ne sert qu'à donner une `key` qui change quand le contenu change : c'est
 * ce qui remonte le `Fondu` et rejoue la transition. Les valeurs elles-mêmes ne
 * sont lues nulle part — seul compte le fait qu'elles diffèrent.
 *
 * **Le rétablissement n'y figure pas**, et ce n'est pas un oubli : `Coquille`
 * rend `Patience` par un retour anticipé, au-dessus de tout le reste. Sortir de
 * cet état monte l'arbre entier, donc le `Fondu` avec lui — la transition la
 * plus fréquente de l'application, celle de chaque ouverture, est couverte par
 * le montage et n'a besoin d'aucune clé.
 */
export function brancheDeLaRacine(
  jetonDeReprise: string | null,
  session: { etat: string; vientDeSInscrire?: boolean },
): string {
  if (jetonDeReprise) return 'prise-en-main';
  if (session.etat !== 'connecte') return 'connexion';
  return session.vientDeSInscrire ? 'bienvenue' : 'application';
}
