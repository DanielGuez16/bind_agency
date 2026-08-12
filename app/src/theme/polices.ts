/**
 * Les fichiers de fonte, et rien d'autre.
 *
 * **Le défaut que ce fichier corrige.** `tokens.json` nommait trois familles —
 * Familjen Grotesk, IBM Plex Sans, IBM Plex Mono — `Texte` les demandait par
 * `fontFamily`, et **aucune n'était chargée** : ni `expo-font`, ni un seul
 * fichier de fonte dans le dépôt. Chaque glyphe du produit tombait donc sur la
 * police système, SF Pro sur iPhone et Helvetica dans le navigateur. Les
 * maquettes, elles, les chargent depuis Google Fonts. C'est le seul écart de
 * rendu qui portait sur cent pour cent des écrans à la fois.
 *
 * **Les noms de famille restent dans les jetons.** Ce fichier ne les invente
 * pas : il les lit, et se contente de dire quel fichier correspond à quelle
 * graisse. Changer de direction artistique, c'est changer la ligne du jeton et
 * l'entrée correspondante ici — deux endroits adjacents, jamais un écran.
 *
 * **Pourquoi une entrée par graisse.** Sur iOS et Android, `fontWeight` ne
 * choisit pas un fichier : le système ne connaît que les noms enregistrés, et
 * une graisse absente est *synthétisée* — le moteur épaissit les fûts lui-même,
 * ce qui donne ce gras baveux qu'on reconnaît. Chaque graisse est donc
 * enregistrée sous son propre nom, et `Texte` demande ce nom-là plutôt qu'un
 * couple famille + graisse. Le web suit le même chemin, ce qui évite d'avoir
 * deux comportements à tenir d'accord.
 */
import { FamiljenGrotesk_400Regular } from '@expo-google-fonts/familjen-grotesk/400Regular';
import { FamiljenGrotesk_500Medium } from '@expo-google-fonts/familjen-grotesk/500Medium';
import { FamiljenGrotesk_600SemiBold } from '@expo-google-fonts/familjen-grotesk/600SemiBold';
import { FamiljenGrotesk_700Bold } from '@expo-google-fonts/familjen-grotesk/700Bold';
import { IBMPlexMono_400Regular } from '@expo-google-fonts/ibm-plex-mono/400Regular';
import { IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono/500Medium';
import { IBMPlexMono_600SemiBold } from '@expo-google-fonts/ibm-plex-mono/600SemiBold';
import { IBMPlexSans_400Regular } from '@expo-google-fonts/ibm-plex-sans/400Regular';
import { IBMPlexSans_500Medium } from '@expo-google-fonts/ibm-plex-sans/500Medium';
import { IBMPlexSans_600SemiBold } from '@expo-google-fonts/ibm-plex-sans/600SemiBold';

import brut from './tokens.json';

/** Les trois rôles de fonte du système. Les jetons disent quelle famille. */
export type RoleDeFonte = keyof typeof brut.typography.fontFamily;

/** Les graisses du système, en clair. */
export type Graisse = '400' | '500' | '600' | '700';

/**
 * Les fichiers, par **nom de famille tel qu'il est écrit dans les jetons**.
 *
 * La clé n'est pas le rôle mais la famille : deux rôles peuvent partager une
 * fonte — c'est le cas courant quand une direction artistique n'en retient que
 * deux — et le fichier ne doit alors être chargé qu'une fois.
 */
const FICHIERS: Record<string, Partial<Record<Graisse, unknown>>> = {
  'Familjen Grotesk': {
    '400': FamiljenGrotesk_400Regular,
    '500': FamiljenGrotesk_500Medium,
    '600': FamiljenGrotesk_600SemiBold,
    '700': FamiljenGrotesk_700Bold,
  },
  'IBM Plex Sans': {
    '400': IBMPlexSans_400Regular,
    '500': IBMPlexSans_500Medium,
    '600': IBMPlexSans_600SemiBold,
  },
  'IBM Plex Mono': {
    '400': IBMPlexMono_400Regular,
    '500': IBMPlexMono_500Medium,
    '600': IBMPlexMono_600SemiBold,
  },
};

/** Le nom sous lequel une graisse est enregistrée. « IBM Plex Sans 600 ». */
export function nomDeFonte(role: RoleDeFonte, graisse: string | number): string {
  const famille = brut.typography.fontFamily[role];
  const demandee = String(graisse) as Graisse;
  const disponibles = FICHIERS[famille];

  // Une graisse absente retombe sur la plus proche **présente**, jamais sur la
  // synthèse : mieux vaut un 500 réel qu'un 600 fabriqué par le moteur.
  const retenue = disponibles?.[demandee]
    ? demandee
    : ((['600', '500', '400', '700'] as Graisse[]).find((g) => disponibles?.[g]) ?? demandee);

  return `${famille} ${retenue}`;
}

/**
 * Ce qu'il faut charger au démarrage : uniquement les couples (famille,
 * graisse) que l'échelle typographique utilise réellement.
 *
 * Déduit des jetons plutôt qu'énuméré à la main. Une variante ajoutée à
 * l'échelle amène sa fonte sans qu'on y pense, et une variante retirée cesse
 * de coûter un fichier au démarrage.
 */
export function policesAcharger(): Record<string, unknown> {
  const echelles = Object.values(brut.typography.scale) as {
    fontFamily: string;
    fontWeight: string;
  }[];

  const a_charger: Record<string, unknown> = {};
  for (const echelle of echelles) {
    const role = echelle.fontFamily as RoleDeFonte;
    const nom = nomDeFonte(role, echelle.fontWeight);
    const famille = brut.typography.fontFamily[role];
    const graisse = nom.slice(famille.length + 1) as Graisse;
    const fichier = FICHIERS[famille]?.[graisse];
    if (fichier) a_charger[nom] = fichier;
  }

  // Le gras de la marque n'est dans aucune variante de l'échelle : le
  // monogramme le demande directement, et sans lui il serait synthétisé.
  const display = brut.typography.fontFamily.display;
  if (FICHIERS[display]?.['700']) a_charger[`${display} 700`] = FICHIERS[display]['700'];

  return a_charger;
}
