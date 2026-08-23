/**
 * Le pied du fil : les sorties qui restent quand on est arrivé en bas.
 *
 * **Ce fichier portait un mur de six formats, et il n'en reste rien.** Le
 * cycle — deux héros, un triptyque, une bande, une respiration tous les huit
 * salons — répondait à « on descend sans intention ». La revue v3 pose une
 * autre question : « qu'est-ce que je réserve », et la réponse est une grille
 * de prestations rangée par quartier. Une mosaïque de photos de salons est
 * exactement la forme qui donnait le lieu pour l'objet ; la garder à côté
 * aurait laissé deux compositions pour un même contenu, et c'est le défaut que
 * la v3 corrige. `cycle.ts`, `regles.ts` et les rangées par quartier partent
 * avec elle. Voir `SectionsParQuartier`, qui porte aussi le squelette : un
 * squelette vit à côté de la géométrie qu'il imite, sinon les deux dérivent
 * sans que rien ne le dise.
 */
import { View } from 'react-native';

import type { Fil } from '../../api';
import { Texte } from '../../components';
import { formatNumber } from '../../format';
import { useI18n } from '../../i18n';
import { useColors } from '../../theme';

/**
 * Le bas du fil : les sorties, et rien d'autre.
 *
 * **« You have seen everything » est supprimé**, et avec lui le bilan sombre
 * qu'il coiffait. La fin d'une liste se voit ; la dire est du bruit, et le dire
 * sur un aplat d'encre en faisait un événement. Ce qui reste n'annonce rien :
 * ce sont les deux ou trois chemins qui restent quand on est arrivé en bas.
 *
 * **La ligne du prochain palier est partie vers Audience.** Elle était ici
 * parce que le fil était le seul écran qu'on ouvrait ; les abonnés, le score et
 * les paliers vivent maintenant ensemble, ce qui est le même sujet au même
 * endroit.
 *
 * **Les sorties, elles, restent.** Rien de la revue ne les vise, et les
 * retirer laisserait un créateur au fond d'un rayon trop étroit sans moyen de
 * l'élargir — une régression sur les chips que la planche v2 avait déjà
 * remplacées.
 */
export function BasDuMur({
  fil,
  rayonKm,
  onElargir,
  resserrer,
  onRemonter,
}: {
  fil: Fil;
  rayonKm: number;
  onElargir?: (rayonKm: number) => void;
  /**
   * Revenir au rayon de départ, et lequel. Absent quand on y est déjà.
   *
   * **C'est une annulation, pas une issue chiffrée.** Les deux autres sorties
   * portent leur nombre parce qu'elles promettent un gain qu'on ne peut pas
   * deviner ; celle-ci ramène à l'état d'où l'on vient, qu'on a vu. Lui coller
   * un compte demanderait une requête pour dire ce qu'on savait déjà.
   *
   * **Provisoire, et la place définitive est ailleurs.** Le rayon appartient à
   * la feuille de filtres, qui n'existe pas encore. En attendant, `rayons` ne
   * rend jamais un rayon plus étroit que celui en vigueur : sans ce chemin,
   * élargir serait sans retour, ce qui est une régression sur les chips que la
   * planche a remplacées.
   */
  resserrer?: { versKm: number; onPress: () => void };
  onRemonter?: () => void;
}) {
  const { t, locale } = useI18n();
  const c = useColors();

  const plusLarge = fil.rayons.find((rayon) => rayon.commerces > 0);

  return (
    <View testID="bas-du-mur" style={{ paddingHorizontal: 18, paddingVertical: 18, gap: 8 }}>
      <View style={{ gap: 8, alignItems: 'flex-start' }}>
        {plusLarge && onElargir ? (
          <Texte
            variante="type.body"
            couleur="brand.700"
            testID="sortie-elargir"
            onPress={() => onElargir(Math.round(plusLarge.rayon_metres / 1000))}
          >
            {t('parcours.filElargirCompte', {
              rayon: formatNumber(Math.round(plusLarge.rayon_metres / 1000), locale),
              count: formatNumber(plusLarge.commerces, locale),
            })}
          </Texte>
        ) : null}
        {/* **Un seul objet porte le geste et sa cible.** Deux props — un
            rappel et un nombre — se seraient dédoublées, et il aurait fallu
            garder contre le cas où l'une arrive sans l'autre : une garde de
            plus pour une seule chose. */}
        {resserrer ? (
          <Texte
            variante="type.body"
            couleur="brand.700"
            testID="sortie-resserrer"
            onPress={resserrer.onPress}
          >
            {t('parcours.murResserrer', { rayon: formatNumber(resserrer.versKm, locale) })}
          </Texte>
        ) : null}
        {onRemonter ? (
          <Texte
            variante="type.body"
            // **`ink.mute` et non `ink.faint`.** Ce libellé est pressable : il
            // porte un geste, donc il se lit. `ink.faint` vaut 2,46:1 sur la
            // page — le jeton l'écrit lui-même : « ne porte jamais de texte à
            // lire », et « trois erreurs de contraste sur quatre, dans
            // l'historique de ce projet, viennent d'un ink.faint employé comme
            // couleur de texte ». Celle-ci était la quatrième.
            style={{ color: c['ink.mute'] }}
            testID="sortie-remonter"
            onPress={onRemonter}
          >
            {t('parcours.murRepartirDuHaut')}
          </Texte>
        ) : null}
      </View>

    </View>
  );
}
