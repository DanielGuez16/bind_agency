/**
 * Une carte du fil : une prestation, son salon, et ce qu'il ouvre en plus.
 *
 * **280 par 210, et c'est une mesure.** Les photos arrivent en 4:3 ; une
 * colonne de 171 avec une image de 100 en jetait un quart et n'en rendait que
 * dix-sept mille pixels. Ici le cadrage passe entier — 3,4 fois la surface.
 *
 * **Le quartier est dans l'attribution, plus dans la structure.** « Vela Nail
 * Studio · Wynwood · 320 m » : le lieu se lit sur la carte, il ne range plus le
 * fil.
 *
 * **Et « +3 more here » est ce qui la sauve.** Une carte qui nomme une
 * prestation mène à un lieu : sans ce compte, on croirait que le salon n'offre
 * que celle-là — c'était le défaut de la v0.5, et c'est la seule différence
 * avec elle.
 */
import { Pressable, View } from 'react-native';

import { MediaFallback, Photo, Texte, TierBadge, useEnfoncement } from '../../components';
import { formatDistance } from '../../format';
import { useI18n } from '../../i18n';
import { radius, useColors } from '../../theme';
import type { PrestationDuFil } from './SectionsParQuartier';

/** La largeur d'une carte, et la hauteur de son 4:3. La planche les écrit. */
export const LARGEUR_DE_LA_CARTE = 280;
export const PHOTO_DE_LA_CARTE = 210;

export function CarteDuFil({
  prestation,
  onPress,
  testID,
}: {
  prestation: PrestationDuFil;
  onPress: () => void;
  testID?: string;
}) {
  const { t, locale } = useI18n();
  const c = useColors();
  const enfoncement = useEnfoncement(true);

  // « Vela Nail Studio · Wynwood · 320 m », et sans le quartier quand il n'est
  // pas déclaré. Le séparateur appartient à la jointure, jamais aux morceaux :
  // le composer par concaténation laisserait un « · » orphelin.
  const attribution = [
    prestation.salon,
    prestation.quartier,
    formatDistance(prestation.distanceMetres, locale),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${prestation.nom} — ${attribution}`}
      onPress={onPress}
      onPressIn={enfoncement.onPressIn}
      onPressOut={enfoncement.onPressOut}
      style={{
        width: LARGEUR_DE_LA_CARTE,
        borderRadius: radius['radius.lg'],
        backgroundColor: c['bg.surface'],
        borderWidth: 1,
        borderColor: c['line.default'],
        overflow: 'hidden',
      }}
    >
      <Photo
        uri={prestation.photo}
        hauteur={PHOTO_DE_LA_CARTE}
        testID={testID ? `${testID}-photo` : undefined}
        replit={<MediaFallback monogramme={prestation.salon} height={PHOTO_DE_LA_CARTE} />}
      />
      <View style={{ padding: 15, paddingTop: 13, gap: 4 }}>
        <Texte
          variante="type.titreDApercu"
          ellipseSurNomPropre
          testID={testID ? `${testID}-nom` : undefined}
        >
          {prestation.nom}
        </Texte>
        <Texte
          variante="type.caption"
          couleur="ink.soft"
          ellipseSurNomPropre
          testID={testID ? `${testID}-attribution` : undefined}
        >
          {attribution}
        </Texte>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 2 }}>
          {prestation.contrepartie === null ? null : (
            <TierBadge tier={prestation.contrepartie} size="sm" />
          )}
          {/* **Zéro ne s'écrit pas.** « +0 more here » ferait chercher ce qui
              n'existe pas ; un salon qui n'ouvre que celle-ci n'a rien de plus
              à annoncer. */}
          {prestation.autres > 0 ? (
            <Texte
              variante="type.caption"
              couleur="ink.soft"
              testID={testID ? `${testID}-autres` : undefined}
            >
              {t('parcours.murEncoreIci', { count: prestation.autres })}
            </Texte>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
