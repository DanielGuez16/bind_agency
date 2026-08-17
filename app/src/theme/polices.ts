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
 * C'est ce qui rend la bascule v1.0 tenable : Bodoni Moda et Outfit entrent en
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
 * *oblique synthétique*, c'est-à-dire la romaine penchée. Sur un Didone, dont
 * l'italique est un dessin entièrement différent — axes, empattements, ductus —
 * l'écart entre le vrai italique et la romaine penchée est celui qui distingue
 * la direction artistique de son imitation. La v1.0 fait de l'accent un
 * changement de **voix** à l'intérieur d'une famille : cette voix doit être un
 * fichier.
 */
import { Platform } from 'react-native';

import produit from './produit.json';

import { BodoniModa_400Regular } from '@expo-google-fonts/bodoni-moda/400Regular';
import { BodoniModa_400Regular_Italic } from '@expo-google-fonts/bodoni-moda/400Regular_Italic';
import { BodoniModa_500Medium } from '@expo-google-fonts/bodoni-moda/500Medium';
import { BodoniModa_500Medium_Italic } from '@expo-google-fonts/bodoni-moda/500Medium_Italic';
import { BodoniModa_600SemiBold } from '@expo-google-fonts/bodoni-moda/600SemiBold';
import { BodoniModa_600SemiBold_Italic } from '@expo-google-fonts/bodoni-moda/600SemiBold_Italic';
import { BodoniModa_700Bold } from '@expo-google-fonts/bodoni-moda/700Bold';
import { BodoniModa_700Bold_Italic } from '@expo-google-fonts/bodoni-moda/700Bold_Italic';
import { IBMPlexMono_400Regular } from '@expo-google-fonts/ibm-plex-mono/400Regular';
import { IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono/500Medium';
import { IBMPlexMono_600SemiBold } from '@expo-google-fonts/ibm-plex-mono/600SemiBold';
import { Outfit_300Light } from '@expo-google-fonts/outfit/300Light';
import { Outfit_400Regular } from '@expo-google-fonts/outfit/400Regular';
import { Outfit_500Medium } from '@expo-google-fonts/outfit/500Medium';
import { Outfit_600SemiBold } from '@expo-google-fonts/outfit/600SemiBold';
import { Outfit_700Bold } from '@expo-google-fonts/outfit/700Bold';

import { familles, type RoleDeFonte, typography } from './echelle';

export type { RoleDeFonte };

/** Les graisses du système, en clair. */
export type Graisse = '300' | '400' | '500' | '600' | '700';

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
 * L'italique n'est déclaré que là où il existe et où le système s'en sert :
 * Bodoni Moda, qui porte le mot accentué. Outfit et IBM Plex Mono n'en ont
 * aucun emploi, et en charger un coûterait un fichier au démarrage pour rien.
 */
const FICHIERS: Record<string, Record<Voix, Faces>> = {
  'Bodoni Moda': {
    normal: {
      '400': BodoniModa_400Regular,
      '500': BodoniModa_500Medium,
      '600': BodoniModa_600SemiBold,
      '700': BodoniModa_700Bold,
    },
    italic: {
      '400': BodoniModa_400Regular_Italic,
      '500': BodoniModa_500Medium_Italic,
      '600': BodoniModa_600SemiBold_Italic,
      '700': BodoniModa_700Bold_Italic,
    },
  },
  Outfit: {
    normal: {
      // Le 300 n'est encore demandé par aucune variante de l'échelle : il est
      // déclaré parce que le sigle B!ND de la v1.0 est « trait fin, monoline »
      // et qu'un moteur ne sait pas amaigrir une face. Il ne coûte rien tant
      // que rien ne le demande : `policesAcharger` ne pose que ce que
      // l'échelle nomme, sans exception.
      '300': Outfit_300Light,
      '400': Outfit_400Regular,
      '500': Outfit_500Medium,
      '600': Outfit_600SemiBold,
      '700': Outfit_700Bold,
    },
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
const REPLI: Graisse[] = ['600', '500', '400', '700', '300'];

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
 * jamais — et sans pile il atterrit sur sa fonte par défaut, un Times. Un
 * Didone du XVIIIe remplacé par une romaine de journal est le contraire de la
 * direction, et ça se voit sur le premier écran.
 *
 * C'est la seule part de la correction de fonte de Design qui s'applique ici :
 * le produit charge des TTF statiques par graisse, donc il n'a ni axe `opsz` à
 * retirer ni graisse à épingler.
 *
 * **Séparée de `nomDeFonte`, et il a fallu le payer pour le comprendre.** Ce
 * nom sert deux choses : écrire un style, et **enregistrer** la face auprès
 * d'`expo-font`. Composer la pile dans `nomDeFonte` a donc enregistré une
 * famille appelée « BodoniModa_400Regular, Didot, … » — plus aucune face posée,
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
