/**
 * Icônes.
 *
 * Vingt-quatre points, trait 1,75, jamais de remplissage : les valeurs
 * viennent de `size.icon` et `size.iconStroke`, pas d'une constante locale.
 *
 * Le jeu est volontairement court. Chaque icône ajoutée est une chose de plus
 * à traduire visuellement, et la plupart des écrans se passent d'icône — un mot
 * dit ce qu'une icône suggère.
 *
 * **Chaque glyphe est construit, pas suggéré.** Les premiers étaient des traits
 * approchants : `reglages` était un rond entouré de huit rayons, ce qui ne se
 * lit pas comme un réglage mais comme un soleil, et `personne` un arc sans
 * corps. Un glyphe dont on doit deviner le sujet ne vaut pas la place qu'il
 * prend. Les réglages sont maintenant trois curseurs — le geste, pas l'astre.
 *
 * **Un tracé par icône, plus de cercles à part.** Les cercles vivaient dans une
 * table parallèle, ce qui obligeait à lire deux endroits pour savoir à quoi
 * ressemble un glyphe. Un arc s'écrit dans un chemin.
 *
 * **Une exception au « jamais de remplissage », et une seule.** Le cœur des
 * favoris porte son état dans son remplissage : un cœur en contour et un cœur
 * plein ne sont pas deux icônes, ce sont les deux états d'une même. Le rendre
 * par deux glyphes obligerait à choisir dehors ce que l'icône sait déjà, et
 * une pastille ou une teinte de trait diraient « sélectionné » là où le geste
 * dit « gardé ».
 *
 * `rempli` reste faux partout ailleurs : la règle tient pour tout le reste du
 * jeu, et ce n'est pas une porte ouverte à un second glyphe plein.
 */
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { size, useColors, type ColorName } from '../theme';

export type NomIcone =
  | 'chevron'
  | 'croix'
  | 'coche'
  | 'coeur'
  | 'loupe'
  | 'horloge'
  | 'lieu'
  | 'appareil-photo'
  // Les onglets. Un jeu volontairement court : chaque icône ajoutée est une
  // chose de plus à traduire visuellement, et une barre d'onglets qui en
  // compte plus de cinq a un autre problème.
  | 'paliers'
  | 'calendrier'
  | 'personne'
  | 'reglages'
  | 'image'
  | 'rapport'
  | 'liste'
  | 'cadenas'
  | 'etincelle'
  | 'fleche'
  // Ce qui fait monter, ce qui fait redescendre : les deux blocs de règles des
  // paliers. Une flèche dit le sens sans le mot, et le mot reste écrit.
  | 'monte'
  | 'descend'
  | 'retour'
  // Révéler un mot de passe, et le remasquer. Deux icônes et non une : l'œil
  // barré dit ce que l'action fera, l'œil seul dit ce qu'on regarde, et les
  // confondre laisse l'utilisateur deviner dans quel état il se trouve.
  | 'oeil'
  | 'oeil-barre'
  // **Le glyphe d'avertissement, et il n'est pas décoratif.** Depuis la v1.0,
  // l'avertissement n'a plus de teinte : un ambre dans un système orange se
  // lit comme une mise en avant de marque et non comme une alerte. Le glyphe
  // est donc le seul marqueur qui lui reste, et il est obligatoire.
  | 'alerte'
  // La carte du commerce : une feuille et ses lignes. Volontairement **pas**
  // l'icône d'image — c'est ce qui distingue les deux accès de la fiche à
  // l'œil, avant même d'avoir lu les deux mots.
  | 'carte'
  // Ce qui sort de l'application. Il remplace le chevron sur une ligne qui
  // mène dehors : la différence se voit **avant** l'appui, pas après.
  | 'sortie'
  // **Les deux réseaux, et ils manquaient entièrement.** L'écran d'audience
  // nommait « Instagram » et « TikTok » en toutes lettres sans rien montrer :
  // deux lignes identiques à l'œil, alors que c'est la marque qu'on cherche du
  // regard sur un écran de comptes. Tracés monochromes dans le trait du
  // système — les deux chartes fournissent des fichiers officiels, qui les
  // remplaceront à l'intégration.
  | 'instagram'
  | 'tiktok';

const CHEMINS: Record<Exclude<NomIcone, 'instagram'>, string> = {
  chevron: 'M9.5 5.5L16 12l-6.5 6.5',
  croix: 'M6 6l12 12M18 6L6 18',
  coche: 'M4.5 12.5l5 5L19.5 7',
  // **Le cœur, fourni par Design : le jeu n'en avait pas.** Un seul tracé
  // fermé, symétrique, qui se remplit sans changer de forme — c'est ce qui
  // permet aux deux états d'être la même icône.
  coeur:
    'M12 20.3C6.6 16.5 3.6 13.1 3.6 9.7A4.9 4.9 0 0 1 12 6.7a4.9 4.9 0 0 1 8.4 3c0 3.4-3 6.8-8.4 10.6z',
  // Le disque et son manche, dans le même chemin que le reste du jeu.
  loupe: 'M10.8 18.1a7.3 7.3 0 100-14.6 7.3 7.3 0 000 14.6zM16.1 16.1l4.4 4.4',
  // Cadran et aiguilles, en un seul tracé fermé puis rouvert.
  horloge: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7.5V12l3.2 2',
  lieu: 'M12 21.5c4.4-4.6 6.6-8.2 6.6-11a6.6 6.6 0 10-13.2 0c0 2.8 2.2 6.4 6.6 11zM12 12.6a2.6 2.6 0 100-5.2 2.6 2.6 0 000 5.2z',
  'appareil-photo':
    'M3.5 8.5h3.2l1.7-2.2h7.2l1.7 2.2h3.2v11h-17zM12 17a3.4 3.4 0 100-6.8 3.4 3.4 0 000 6.8z',
  // Trois barres croissantes : le même glyphe que le badge de palier, pour
  // que l'onglet et le badge se répondent.
  paliers: 'M5.5 20v-5M12 20V9M18.5 20V4',
  calendrier: 'M4 6.5h16v14H4zM4 11h16M8.5 3.5v4M15.5 3.5v4M8 15h2M14 15h2',
  // Tête et épaules. L'arc seul se lisait comme un pont.
  personne: 'M12 12.2a4 4 0 100-8 4 4 0 000 8zM4.8 20.5a7.2 7.2 0 0114.4 0',
  // Trois curseurs. Ce qu'on règle se règle, ça ne rayonne pas.
  reglages:
    'M4 7h9M17 7h3M4 12h3M11 12h9M4 17h9M17 17h3M15 7a2 2 0 10-4 0 2 2 0 004 0M9 12a2 2 0 10-4 0 2 2 0 004 0M15 17a2 2 0 10-4 0 2 2 0 004 0',
  image: 'M3.5 4.5h17v15h-17zM3.5 15.5l4.5-4.5 4 4M13 13l3-3 4.5 4.5M15.5 9.2a1.2 1.2 0 102.4 0 1.2 1.2 0 00-2.4 0',
  rapport: 'M3.5 20.5h17M7 20.5v-6.5M12 20.5V7M17 20.5v-4',
  liste: 'M8 6.5h12M8 12h12M8 17.5h8M4 6.5h.01M4 12h.01M4 17.5h.01',
  // Deux flèches divergentes : ce qui s'ouvre, ce qui se débloque.
  cadenas: 'M7 10.5V8a5 5 0 0110 0M5.5 10.5h13v10h-13zM12 14.5v2.5',
  etincelle: 'M12 3.5l1.9 4.9 4.9 1.9-4.9 1.9L12 17.1l-1.9-4.9L5.2 10.3l4.9-1.9zM18.5 16.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z',
  fleche: 'M4.5 12h15M13.5 6l6 6-6 6',
  // La même flèche, retournée : le retour et l'avance se répondent.
  monte: 'M12 19.5V5M6 11l6-6 6 6',
  descend: 'M12 4.5V19M6 13l6 6 6-6',
  retour: 'M19.5 12h-15M10.5 6l-6 6 6 6',
  oeil: 'M2.5 12S6.2 5.5 12 5.5 21.5 12 21.5 12 17.8 18.5 12 18.5 2.5 12 2.5 12zM12 14.8a2.8 2.8 0 100-5.6 2.8 2.8 0 000 5.6z',
  'oeil-barre':
    'M9.9 5.8A8.8 8.8 0 0112 5.5c5.8 0 9.5 6.5 9.5 6.5a17 17 0 01-2.9 3.6M6.4 7.7A17 17 0 002.5 12S6.2 18.5 12 18.5c1 0 2-.2 2.9-.5M10 10a2.8 2.8 0 004 4M4 4l16 16',
  // Un triangle et une barre. La forme du triangle porte l'alerte à elle
  // seule, ce qu'aucun rond ne fait : c'est ce qui reste quand la couleur est
  // partie.
  alerte: 'M12 3.8L21.7 20.4H2.3zM12 9.8v4.6M12 17.3h.01',
  carte: 'M6 3.5h12v17H6zM9 8h6M9 12h6M9 16h4',
  // Un cadre échancré et une flèche qui en sort. L'échancrure est ce qui fait
  // lire « sortir » plutôt que « agrandir ».
  sortie: 'M10 4.5H5.5v15h15V15M14 4.5h5.5V10M19 5L11 13',
  // **Instagram n'est pas un chemin, et c'est pourquoi il n'est pas ici.**
  // Il se dessine en trois éléments — voir `INSTAGRAM` plus bas. Ce qui vivait
  // à cette clé était un tracé recomposé de mémoire : un cadre en arcs au lieu
  // d'un rectangle arrondi, et un témoin en arc de 0,6 de rayon qui se
  // remplissait par l'épaisseur du trait au lieu d'être plein. Rien à
  // l'affichage ne signalait l'invention. `assets/primitives.json` existe
  // précisément pour ça, et sa première règle est de copier le tracé sans le
  // retaper.
  // La hampe, sa boucle, et le drapeau qui s'en détache.
  tiktok: 'M14.2 3v10.9a3.6 3.6 0 11-3-3.55M14.2 3.4c.5 2.3 2.1 3.9 4.6 4.2',
};

/**
 * Instagram : trois éléments, pas un chemin unique.
 *
 * Copié tel quel de `design_handoff_bind/assets/primitives.json`. Le petit
 * cercle est **rempli**, pas tracé — et son rayon passe à 1,15 à 16 points et
 * moins, comme la primitive le note.
 */
function Instagram({ trait, taille, epaisseur }: { trait: string; taille: number; epaisseur: number }) {
  return (
    <>
      <Rect x="3" y="3" width="18" height="18" rx="5.4" stroke={trait} strokeWidth={epaisseur} />
      <Circle cx="12" cy="12" r="4.2" stroke={trait} strokeWidth={epaisseur} />
      <Circle cx="17.4" cy="6.7" r={taille <= 16 ? 1.15 : 1.3} fill={trait} />
    </>
  );
}

export function Icone({
  nom,
  couleur = 'ink.default',
  teinte,
  taille = size.icon,
  rempli = false,
  testID,
}: {
  nom: NomIcone;
  couleur?: ColorName;
  /**
   * Une couleur déjà résolue, quand elle vient d'ailleurs que du thème — la
   * barre d'onglets donne la sienne, tirée du thème de navigation qui est
   * lui-même construit sur nos jetons. La retraduire ici créerait une seconde
   * source, et c'est la seconde qui dérive.
   */
  teinte?: string;
  /** Vingt-quatre par défaut. Plus grande sur un état vide, qui a de la place. */
  taille?: number;
  /**
   * Le glyphe est plein plutôt que tracé.
   *
   * Réservé au cœur, dont l'état **est** le remplissage. Ailleurs le jeu n'a
   * pas de plein, et ce n'est pas un réglage à découvrir : c'est une exception
   * nommée, écrite dans l'en-tête du module.
   */
  rempli?: boolean;
  testID?: string;
}) {
  const c = useColors();
  const trait = teinte ?? c[couleur];
  return (
    <Svg
      testID={testID}
      width={taille}
      height={taille}
      viewBox="0 0 24 24"
      fill="none"
      // Décorative par défaut : le sens est porté par le texte à côté. Une
      // icône annoncée deux fois double la lecture d'écran sans rien ajouter.
      accessibilityElementsHidden
    >
      {nom === 'instagram' ? (
        <Instagram
          trait={trait}
          taille={taille}
          epaisseur={(size.iconStroke * taille) / size.icon}
        />
      ) : (
      <Path
        d={CHEMINS[nom]}
        // Plein : le trait reste, de la même couleur. Sans lui, le glyphe
        // maigrit d'un demi-point au remplissage et le cœur paraît sauter.
        fill={rempli ? trait : 'none'}
        stroke={trait}
        strokeWidth={(size.iconStroke * taille) / size.icon}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      )}
    </Svg>
  );
}
