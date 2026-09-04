/**
 * Le rayon, au kilomètre près, plutôt qu'en deux marches.
 *
 * **Le serveur acceptait déjà n'importe quel rayon entre cent mètres et cent
 * kilomètres, et l'écran n'en proposait que deux.** Les élargissements servis
 * par le fil — quinze puis vingt-cinq — répondent à une autre question : « où
 * y a-t-il quelque chose », c'est-à-dire le prochain palier qui ouvre des
 * salons. Ils restent, en bas du mur, parce qu'ils promettent un compte qu'on
 * ne peut pas deviner. Celui-ci répond à « jusqu'où j'accepte d'aller », qui
 * est une préférence et non une découverte, et aucune liste de deux valeurs ne
 * peut la porter : à Miami, entre le quartier à pied et la ville en voiture, il
 * y a tout ce qui compte.
 *
 * **Le pas est le kilomètre, et le minimum un.** Cent mètres est ce que le
 * serveur tolère, pas ce qu'un curseur doit offrir : quatre-vingt-dix-neuf
 * positions y seraient perdues sous le pouce, pour un fil qui serait vide sur
 * presque toutes. Le maximum reste sous le plafond serveur — un curseur qui
 * peut demander ce que l'API refuse est un curseur qui casse.
 */
import { useState } from 'react';
import { View } from 'react-native';
import Slider from '@react-native-community/slider';

import { Texte } from '../../components';
import { formatNumber } from '../../format';
import { useI18n } from '../../i18n';
import { useColors } from '../../theme';

/** Le plus court qu'on propose. Voir l'en-tête : le pas est le kilomètre. */
export const RAYON_MIN_KM = 1;

/**
 * Le plus long.
 *
 * Cinquante et non cent : le serveur accepte cent, et un rayon de cent
 * kilomètres depuis Miami tombe dans l'océan sur plus de la moitié de son
 * disque. La moitié de la course du curseur serait dépensée sur de l'eau.
 */
export const RAYON_MAX_KM = 50;

export function RayonDeRecherche({
  rayonKm,
  onChange,
  testID = 'rayon-de-recherche',
}: {
  rayonKm: number;
  /** Appelé quand le doigt se lève, pas à chaque pixel. Voir plus bas. */
  onChange: (rayonKm: number) => void;
  testID?: string;
}) {
  const { t, locale } = useI18n();
  const c = useColors();

  /**
   * La valeur pendant le glissement.
   *
   * **Le libellé suit le doigt, la requête ne le suit pas.** Servir à chaque
   * position rendue enverrait une trentaine de requêtes pour un geste, et le
   * fil se rechargerait sous la main — chaque réponse remplaçant la précédente
   * dans le désordre où elles reviennent. `onSlidingComplete` ne part qu'une
   * fois, au relâchement ; l'affichage, lui, doit répondre tout de suite, sans
   * quoi on ne sait pas ce qu'on est en train de choisir.
   */
  const [enCours, setEnCours] = useState<number | null>(null);
  const affiche = enCours ?? rayonKm;

  return (
    <View testID={testID} style={{ gap: 4 }}>
      <Texte variante="type.label" couleur="ink.soft" testID={`${testID}-valeur`}>
        {t('parcours.filRayon', { rayon: formatNumber(affiche, locale) })}
      </Texte>
      <Slider
        testID={`${testID}-curseur`}
        value={rayonKm}
        minimumValue={RAYON_MIN_KM}
        maximumValue={RAYON_MAX_KM}
        step={1}
        onValueChange={setEnCours}
        onSlidingComplete={(valeur) => {
          setEnCours(null);
          // Le pas est entier, mais la valeur revient en flottant sur iOS.
          // L'arrondi est ici plutôt que chez l'appelant : c'est ce composant
          // qui promet des kilomètres entiers.
          onChange(Math.round(valeur));
        }}
        minimumTrackTintColor={c['brand.700']}
        maximumTrackTintColor={c['line.default']}
        thumbTintColor={c['brand.700']}
        accessibilityLabel={t('parcours.filRayonAide')}
        style={{ width: '100%' }}
      />
    </View>
  );
}
