/**
 * Les fichiers de fonte, et rien d'autre.
 *
 * **Le défaut que ce fichier corrige.** `tokens.json` nommait trois familles,
 * `Texte` les demandait par `fontFamily`, et **aucune n'était chargée** : ni
 * `expo-font`, ni un seul fichier de fonte dans le dépôt. Chaque glyphe du
 * produit tombait donc sur la police système, SF Pro sur iPhone et Helvetica
 * dans le navigateur. Les maquettes, elles, les chargent depuis Google Fonts.
 * C'est le seul écart de rendu qui portait sur cent pour cent des écrans à la
 * fois.
 *
 * **Les noms de famille restent dans les jetons.** Ce fichier ne les invente
 * pas : il les lit, et se contente de dire quel fichier correspond à quelle
 * graisse. Changer de direction artistique, c'est changer la ligne du jeton et
 * l'entrée correspondante ici — deux endroits adjacents, jamais un écran.
 * C'est ce qui rend une bascule de direction tenable : une famille entre en
 * remplacement de Familjen Grotesk et d'IBM Plex Sans sans qu'un seul écran
 * change de ligne.
 *
 * **Pourquoi une entrée par graisse.** Sur iOS et Android, `fontWeight` ne
 * choisit pas un fichier : le système ne connaît que les noms enregistrés, et
 * une graisse absente est *synthétisée* — le moteur épaissit les fûts lui-même,
 * ce qui donne ce gras baveux qu'on reconnaît. Chaque graisse est donc
 * enregistrée sous son propre nom, et `Texte` demande ce nom-là plutôt qu'un
 * couple famille + graisse. Le web suit le même chemin, ce qui évite d'avoir
 * deux comportements à tenir d'accord.
 *
 * **Et pourquoi l'italique est un nom, pas un attribut.** Même raison, même
 * conséquence, en pire : `fontStyle: 'italic'` sur une face romaine produit un
 * *oblique synthétique*, c'est-à-dire la romaine penchée, là où une vraie
 * italique est un autre dessin — axes, ductus, parfois d'autres lettres.
 *
 * **Le mécanisme survit à son motif, et c'est délibéré.** La v1.0 faisait de
 * l'accent une seconde voix, qui devait être un fichier ; la v1.1 en fait une
 * graisse et ne charge plus aucune italique. Rien n'oblige à retirer la voix du
 * modèle pour autant : elle ne coûte qu'un paramètre par défaut, et la retirer
 * signifierait la réécrire entièrement le jour où une direction en redemande
 * une. Ce qui est retiré, ce sont les fichiers — une garde vérifie qu'aucun
 * italique n'est chargé, pas que le code serait incapable d'en charger un.
 */
import { Platform } from 'react-native';

import produit from './produit.json';

import { IBMPlexMono_400Regular } from '@expo-google-fonts/ibm-plex-mono/400Regular';
import { IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono/500Medium';
import { IBMPlexMono_600SemiBold } from '@expo-google-fonts/ibm-plex-mono/600SemiBold';
import { PlusJakartaSans_400Regular } from '@expo-google-fonts/plus-jakarta-sans/400Regular';
import { PlusJakartaSans_500Medium } from '@expo-google-fonts/plus-jakarta-sans/500Medium';
import { PlusJakartaSans_600SemiBold } from '@expo-google-fonts/plus-jakarta-sans/600SemiBold';
import { PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans/700Bold';
import { PlusJakartaSans_800ExtraBold } from '@expo-google-fonts/plus-jakarta-sans/800ExtraBold';

import { familles, type RoleDeFonte, typography } from './echelle';

export type { RoleDeFonte };

/** Les graisses du système, en clair. */
export type Graisse = '400' | '500' | '600' | '700' | '800';

/** Les deux voix d'une famille. Un fichier chacune, jamais une synthèse. */
export type Voix = 'normal' | 'italic';

type Faces = Partial<Record<Graisse, unknown>>;

/**
 * Les fichiers, par **nom de famille tel qu'il est écrit dans les jetons**.
 *
 * La clé n'est pas le rôle mais la famille : deux rôles peuvent partager une
 * fonte — c'est le cas courant quand une direction artistique n'en retient que
 * deux — et le fichier ne doit alors être chargé qu'une fois.
 *
 * **Plus aucun italique, et ce paragraphe disait le contraire.** Il expliquait
 * que Bodoni Moda portait le mot accentué en italique. Le Didone est retiré et
 * l'accent est devenu une graisse dans la seule famille du système : il n'y a
 * plus de seconde voix à charger.
 */
const FICHIERS: Record<string, Record<Voix, Faces>> = {
  'Plus Jakarta Sans': {
    normal: {
      '400': PlusJakartaSans_400Regular,
      '500': PlusJakartaSans_500Medium,
      '600': PlusJakartaSans_600SemiBold,
      '700': PlusJakartaSans_700Bold,
      '800': PlusJakartaSans_800ExtraBold,
    },
    // **Aucun italique, et c'est un choix du système.** L'accent était un
    // italique d'une autre famille ; il est devenu une graisse de celle-ci.
    // Charger une face que rien ne demande coûte un fichier au démarrage.
    italic: {},
  },
  'IBM Plex Mono': {
    normal: {
      '400': IBMPlexMono_400Regular,
      '500': IBMPlexMono_500Medium,
      '600': IBMPlexMono_600SemiBold,
    },
    italic: {},
  },
};

/** L'ordre de repli : on préfère toujours une graisse réelle à une synthèse. */
const REPLI: Graisse[] = ['600', '500', '400', '700', '800'];

/**
 * Le nom sous lequel une graisse est enregistrée. « Outfit_600 », «
 * BodoniModa_500Italic ».
 *
 * **Sans espace ni chiffre isolé, et c'est la correction d'un défaut qui
 * rendait tout le produit en police système.** Le nom était « IBM Plex Sans
 * 600 » ; `react-native-web` écrit `fontFamily` **verbatim**, sans guillemets,
 * ce qui donnait `font-family: IBM Plex Sans 600`. En CSS, un nom de famille
 * non guillemeté est une suite d'identifiants, et un identifiant ne peut pas
 * commencer par un chiffre : `600` invalidait la déclaration **entière**, que
 * le navigateur jetait en silence. Les fontes étaient déclarées, servies,
 * chargées — et pas une ligne de texte ne les employait.
 *
 * Un seul identifiant, commençant par une lettre : valide non guillemeté,
 * donc à l'abri de toute couche qui oublierait de citer. L'italique se suffixe
 * au même endroit, pour la même raison.
 */
/**
 * La pile de repli, **sur le web uniquement**.
 *
 * Sur appareil, `fontFamily` désigne un fichier chargé : il n'y a pas de repli
 * et une famille inconnue ne rend rien de bon. Sur le web, le navigateur
 * choisit seul tant que la fonte n'est pas arrivée — ou si elle ne vient
 * jamais — et sans pile il atterrit sur sa fonte par défaut, un Times. Une
 * romaine de journal sous une direction géométrique est le contraire de ce
 * qu'elle dit, et ça se voit sur le premier écran.
 *
 * C'est la seule part de la correction de fonte de Design qui s'applique ici :
 * le produit charge des TTF statiques par graisse, donc il n'a ni axe `opsz` à
 * retirer ni graisse à épingler.
 *
 * **Séparée de `nomDeFonte`, et il a fallu le payer pour le comprendre.** Ce
 * nom sert deux choses : écrire un style, et **enregistrer** la face auprès
 * d'`expo-font`. Composer la pile dans `nomDeFonte` a donc enregistré une
 * famille appelée « PlusJakartaSans_400Regular, Avenir Next, … » — plus aucune face posée,
 * et toutes les fontes du web perdues. Les tests unitaires n'ont rien vu : ils
 * lisent le nom rendu, pas ce que le navigateur enregistre. C'est la suite de
 * bout en bout qui l'a dit.
 */
export function pileDeFontes(role: RoleDeFonte, graisse: string | number, voix: Voix = 'normal'): string {
  const nom = nomDeFonte(role, graisse, voix);
  if (Platform.OS !== 'web') return nom;
  return [nom, ...produit.repli[role]].map((f) => (f.includes(' ') ? `"${f}"` : f)).join(', ');
}

export function nomDeFonte(
  role: RoleDeFonte,
  graisse: string | number,
  voix: Voix = 'normal',
): string {
  const famille = familles[role];
  const demandee = String(graisse) as Graisse;

  // Une voix absente retombe sur la romaine plutôt que de rendre un nom qui
  // n'est enregistré nulle part : mieux vaut un romain que la police système.
  const disponibles = FICHIERS[famille]?.[voix];
  const retenueVoix = disponibles && Object.keys(disponibles).length > 0 ? voix : 'normal';
  const faces = FICHIERS[famille]?.[retenueVoix];

  // Une graisse absente retombe sur la plus proche **présente**, jamais sur la
  // synthèse : mieux vaut un 500 réel qu'un 600 fabriqué par le moteur.
  const retenue = faces?.[demandee] ? demandee : (REPLI.find((g) => faces?.[g]) ?? demandee);

  // L'espace disparaît, la graisse se rattache : « Bodoni Moda » + « 500 » +
  // italique donne « BodoniModa_500Italic ». La famille reste celle des jetons.
  return `${famille.replace(/\s+/g, '')}_${retenue}${retenueVoix === 'italic' ? 'Italic' : ''}`;
}

/**
 * Ce qu'il faut charger au démarrage : uniquement les couples (famille,
 * graisse, voix) que l'échelle typographique utilise réellement.
 *
 * Déduit des jetons plutôt qu'énuméré à la main. Une variante ajoutée à
 * l'échelle amène sa fonte sans qu'on y pense, et une variante retirée cesse
 * de coûter un fichier au démarrage.
 */
export function policesAcharger(): Record<string, unknown> {
  const echelles = Object.values(typography);

  const a_charger: Record<string, unknown> = {};

  const poser = (role: RoleDeFonte, graisse: string, voix: Voix) => {
    const nom = nomDeFonte(role, graisse, voix);
    const famille = familles[role];
    // La graisse et la voix retenues se relisent sur le nom : `nomDeFonte` a pu
    // retomber sur d'autres que celles demandées, et charger les demandées
    // poserait un fichier sous un nom que personne n'utilise.
    const suffixe = nom.slice(nom.lastIndexOf('_') + 1);
    const retenueVoix: Voix = suffixe.endsWith('Italic') ? 'italic' : 'normal';
    const retenue = suffixe.replace('Italic', '') as Graisse;
    const fichier = FICHIERS[famille]?.[retenueVoix]?.[retenue];
    if (fichier) a_charger[nom] = fichier;
  };

  for (const echelle of echelles) {
    poser(echelle.fontFamily, echelle.fontWeight, echelle.fontStyle === 'italic' ? 'italic' : 'normal');
  }

  return a_charger;
}
