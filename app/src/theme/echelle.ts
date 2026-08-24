/**
 * L'échelle typographique, normalisée pour React Native.
 *
 * **Un module à part, et pas un bout de `index.tsx`.** `polices.ts` a besoin de
 * l'échelle pour savoir quels fichiers charger, et `index.tsx` a besoin de
 * `polices.ts` pour nommer une fonte : les mettre ensemble ferait un cycle.
 * L'échelle est la seule chose que les deux partagent, elle vit donc entre eux.
 *
 * **Ce que fait ce fichier, et ce qu'il ne fait pas.** Il traduit la forme dans
 * laquelle un designer écrit un jeton — `family`, `size`, `weight`, `style` —
 * vers celle que React Native attend. Il n'ajoute aucune valeur, ne corrige
 * aucune taille, et n'invente aucune variante. Une traduction n'est pas une
 * seconde vérité tant qu'elle ne décide de rien.
 */
import produitBrut from './produit.json';
import brut from './tokens.json';

/** Les trois rôles de fonte du système. Les jetons disent quelle famille. */
export type RoleDeFonte = 'display' | 'sans' | 'mono';

/** Les familles, telles que les jetons les nomment. */
export const familles: Record<RoleDeFonte, string> = {
  display: brut.font.display,
  sans: brut.font.sans,
  mono: brut.font.mono,
};

type VarianteBrute = {
  /** Absente sur tout ce qui n'est pas du mono : Design ne la nomme que là. */
  family?: string;
  weight: number;
  size: number;
  lineHeight: number;
  /** L'approche, en vocabulaire CSS : « -0.02em », « 1.4px », « 0 ». */
  tracking?: string;
  transform?: string;
};

/**
 * L'approche, convertie en points.
 *
 * **Design l'écrit en unités CSS parce que c'est le vocabulaire d'une maquette**,
 * et React Native veut des points. Un `em` dépend de la taille — −0,02 em vaut
 * −0,88 à 44 px et −0,48 à 32 — donc la conversion ne peut se faire qu'ici, au
 * seul endroit qui connaît les deux. La recopier en points dans les jetons
 * créerait la seconde vérité que la garde de la passation existe pour interdire.
 */
function approcheEnPoints(tracking: string | undefined, taille: number): number | undefined {
  if (tracking === undefined || tracking === '0') return undefined;
  const em = /^(-?[\d.]+)em$/.exec(tracking);
  if (em) return Number(em[1]) * taille;
  const px = /^(-?[\d.]+)px$/.exec(tracking);
  if (px) return Number(px[1]);
  throw new Error(
    `Approche « ${tracking} » non reconnue. Les jetons s'écrivent en em ou en px ; ` +
      "une unité muette produirait un texte sans approche au lieu d'une erreur.",
  );
}

/**
 * Le rôle de fonte d'une variante.
 *
 * Design ne nomme la famille que sur le mono, parce que **tout le reste partage
 * la même** : « une seule famille de texte, l'accent est une graisse ». Le rôle
 * survit pourtant à la famille — le jour où une direction sépare à nouveau les
 * titres du corps, c'est cette fonction qui change, pas douze variantes.
 */
function roleDe(nom: string, brute: VarianteBrute): RoleDeFonte {
  // **Les deux couches épellent la famille différemment, et il faut les deux.**
  // La passation nomme la fonte — « IBM Plex Mono » — parce qu'elle décrit un
  // système ; le produit nomme le rôle — « mono » — parce qu'il en consomme un.
  // La comparaison ne connaissait que la première : `type.code` et
  // `type.countdown`, c'est-à-dire **le code montré au comptoir et son
  // décompte**, sortaient en sans. Rien ne pouvait le dire — l'alphabet du code
  // écarte déjà les caractères qui se confondent, et un chiffre en sans reste
  // un chiffre.
  if (brute.family === brut.font.mono || brute.family === 'mono') return 'mono';
  return nom.startsWith('display') || nom.startsWith('heading') ? 'display' : 'sans';
}

/** La forme que React Native attend, dérivée du jeton sans rien y ajouter. */
export type EchelleTypo = {
  fontFamily: RoleDeFonte;
  fontWeight: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing?: number;
  fontStyle?: 'italic';
  textTransform?: 'uppercase';
};

function normaliser(nom: string, brute: VarianteBrute): EchelleTypo {
  const approche = approcheEnPoints(brute.tracking, brute.size);
  return {
    fontFamily: roleDe(nom, brute),
    fontWeight: String(brute.weight),
    fontSize: brute.size,
    lineHeight: brute.lineHeight,
    ...(approche === undefined ? {} : { letterSpacing: approche }),
    ...(brute.transform === 'uppercase' ? { textTransform: 'uppercase' as const } : {}),
  };
}

/**
 * `$onBrandRule`, `$pourquoi` et compagnie documentent des règles ; ce ne sont
 * pas des variantes, et les traiter comme telles poserait une fonte nulle sur
 * un texte que personne n'aurait demandé.
 */
const variantes = (source: object, prefixe: string) =>
  Object.entries(source)
    .filter(([nom]) => !nom.startsWith('$'))
    .map(([nom, valeur]) => [`${prefixe}${nom}`, normaliser(nom, valeur as VarianteBrute)] as const);

/**
 * L'échelle complète, préfixée `type.`.
 *
 * Le préfixe n'est pas cosmétique : `type.body` se cherche dans un écran,
 * `body` s'y trouve deux cents fois. Il vit ici plutôt que dans le fichier de
 * jetons, qui reste la copie exacte de la passation.
 *
 * Les quatre variantes de `produit.json` — code, compte à rebours et les deux
 * repères chiffrés — portent déjà leur préfixe : elles appartiennent au
 * produit et non à la marque, et l'écrire dans leur clé le rappelle.
 */
const DU_SOCLE = variantes(brut.type, 'type.');
const DU_PRODUIT = variantes(produitBrut.type, '');

/**
 * Les noms que les deux couches se disputent, s'il y en a.
 *
 * **`Object.fromEntries` garde le dernier, et le produit est étalé en dernier.**
 * Une clé du produit qui porterait le nom d'une clé du socle l'écraserait donc
 * **en silence** : même variante, autre taille, autre graisse, et aucun test ne
 * bouge — le nom existe toujours, il ne désigne simplement plus la même chose.
 *
 * C'est un défaut plus grave qu'un nom mal choisi, parce qu'il ne se voit sur
 * aucun écran isolé : il faut ouvrir les deux fichiers de jetons côte à côte, ce
 * que personne ne fait. Il est exporté plutôt que levé — une exception au
 * chargement ferait tomber l'application entière sur une faute qui appartient à
 * la construction, et le moment de la dire est l'intégration continue.
 */
export const collisionsDeCouches: string[] = DU_SOCLE.map(([nom]) => nom).filter((nom) =>
  DU_PRODUIT.some(([autre]) => autre === nom),
);

export const typography: Record<string, EchelleTypo> = Object.fromEntries([
  ...DU_SOCLE,
  ...DU_PRODUIT,
]);

export type Variante = keyof typeof typography;

