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

import { Texte } from '../../components';
import { useI18n } from '../../i18n';
import { useColors } from '../../theme';

/**
 * Le bas du fil : le retour en haut, et rien d'autre.
 *
 * **« You have seen everything » est supprimé**, et avec lui le bilan sombre
 * qu'il coiffait. La fin d'une liste se voit ; la dire est du bruit, et le dire
 * sur un aplat d'encre en faisait un événement.
 *
 * **La ligne du prochain palier est partie vers Audience.** Elle était ici
 * parce que le fil était le seul écran qu'on ouvrait ; les abonnés, le score et
 * les paliers vivent maintenant ensemble, ce qui est le même sujet au même
 * endroit.
 *
 * **Et les deux sorties de rayon partent à leur tour.** Elles ont été gardées
 * tant qu'élargir sans elles aurait laissé un créateur au fond d'un rayon trop
 * étroit ; la note qui les portait le disait elle-même — « provisoire, la place
 * définitive est ailleurs, le rayon appartient à la feuille de filtres, qui
 * n'existe pas encore ». Elle existe : c'est le curseur de rayon, en tête du
 * mur et sur l'état vide, qui va du kilomètre à cinquante.
 *
 * Les garder à côté ferait **deux commandes pour un même réglage**, dont une
 * qui ne connaît que deux marches — et deux façons de changer la même valeur
 * finissent par diverger, ou par se contredire à l'écran.
 *
 * Ce qui reste, parce que le curseur ne le remplace pas : remonter en haut
 * d'une liste qu'on vient de parcourir.
 */
export function BasDuMur({
  onRemonter,
}: {
  onRemonter?: () => void;
}) {
  const { t } = useI18n();
  const c = useColors();

  return (
    <View testID="bas-du-mur" style={{ paddingHorizontal: 18, paddingVertical: 18, gap: 8 }}>
      <View style={{ gap: 8, alignItems: 'flex-start' }}>
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
