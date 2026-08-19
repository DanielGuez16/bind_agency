/**
 * L'en-tête d'un écran.
 *
 * **Chaque écran commence par quelque chose à regarder.** Ils commençaient tous
 * par un titre nu, puis du texte : rien ne distinguait un écran d'un autre au
 * premier coup d'œil, et rien ne disait à qui on parlait. Un prénom, un chiffre,
 * une marque — n'importe lequel des trois donne un point d'entrée.
 *
 * **Le prénom, pas le nom complet ni l'adresse.** L'adresse électronique est un
 * identifiant, pas une façon de s'adresser à quelqu'un. Quand on ne connaît que
 * l'adresse, on prend ce qui précède l'arobase, et si cela ne ressemble à rien
 * on se passe de salutation plutôt que d'écrire « Bonjour utilisateur ».
 *
 * **Les compteurs sont des faits, pas une décoration.** Chacun porte son
 * libellé ; un nombre seul sous un titre ne se relie à rien.
 */
import { View } from 'react-native';

import { type ColorName, elevationDeCarte, radius, useColors, useTheme } from '../theme';
import { Apparition } from './Mouvement';
import { Texte } from './Texte';

/**
 * Le prénom tiré d'un nom ou d'une adresse, ou rien.
 *
 * Rien plutôt qu'un repli : « Bonjour » suivi d'un identifiant technique se
 * remarque immédiatement, et sonne comme une lettre non fusionnée.
 */
export function prenomDe(nomOuAdresse: string | null | undefined): string | null {
  if (!nomOuAdresse) return null;
  const avantArobase = nomOuAdresse.split('@')[0] ?? '';
  const premier = avantArobase.split(/[.\-_\s+]/)[0] ?? '';
  // Un fragment d'une lettre, ou qui porte un chiffre, n'est pas un prénom.
  if (premier.length < 2 || /\d/.test(premier)) return null;
  return premier.charAt(0).toUpperCase() + premier.slice(1).toLowerCase();
}

export type Compteur = {
  valeur: string;
  libelle: string;
  /**
   * La teinte du chiffre. Portée par le compteur et non choisie par l'en-tête :
   * c'est le sens du compteur qui décide — un palier prend sa couleur, un
   * retard prend celle de l'alerte.
   */
  teinte?: ColorName;
};

export function EnTeteDEcran({
  titre,
  surtitre,
  compteurs,
  droite,
  testID,
}: {
  titre: string;
  /** Une ligne au-dessus du titre : la salutation, la ville, la date. */
  surtitre?: string | null;
  compteurs?: Compteur[];
  /** Un contrôle aligné à droite du titre — la marque, un bouton. */
  droite?: React.ReactNode;
  testID?: string;
}) {
  const c = useColors();
  const { density } = useTheme();

  return (
    <Apparition testID={testID}>
      <View style={{ gap: 12, paddingBottom: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12 }}>
          <View style={{ flex: 1, gap: 2 }}>
            {surtitre ? (
              <Texte variante="type.label" couleur="brand.700" testID="surtitre">
                {surtitre}
              </Texte>
            ) : null}
            <Texte variante="type.screenTitle">{titre}</Texte>
          </View>
          {droite}
        </View>

        {compteurs && compteurs.length > 0 ? (
          <View
            testID="compteurs"
            style={{
              flexDirection: 'row',
              borderRadius: radius['radius.lg'],
              backgroundColor: c['bg.surface'],
              borderWidth: 1,
              borderColor: c['line.default'],
              paddingVertical: 10,
              // « Un coin de 18 px sans ombre flotte au lieu de se poser » : passation §2.
              ...elevationDeCarte(),
            }}
          >
            {compteurs.map((compteur, index) => (
              <View
                key={compteur.libelle}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  gap: 2,
                  // Un filet entre les colonnes, jamais autour : le cadre est
                  // déjà porté par la carte.
                  borderLeftWidth: index === 0 ? 0 : 1,
                  borderLeftColor: c['line.default'],
                }}
              >
                <Texte variante="type.section" couleur={compteur.teinte ?? 'brand.700'}>
                  {compteur.valeur}
                </Texte>
                <Texte variante="type.caption" couleur="ink.soft" align="center">
                  {compteur.libelle}
                </Texte>
              </View>
            ))}
          </View>
        ) : null}
      </View>
      <View style={{ height: density.screenPadding === 20 ? 4 : 0 }} />
    </Apparition>
  );
}

/**
 * Un filet de séparation entre deux blocs d'un écran.
 *
 * Nommé plutôt que réécrit à chaque fois : une `View` de un point de haut
 * revenait dans cinq écrans avec cinq couleurs choisies au jugé.
 */
export function Filet({ marge = 0 }: { marge?: number }) {
  const c = useColors();
  return (
    <View style={{ height: 1, backgroundColor: c['line.default'], marginVertical: marge }} />
  );
}
