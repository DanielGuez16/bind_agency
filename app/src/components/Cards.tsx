/**
 * Cartes et rangées.
 *
 * **La photo est le contenu, pas une vignette.** Une carte de salon occupe la
 * largeur et donne à la couverture la moitié de sa hauteur ; le nom se pose
 * dessus, sur un voile de lisibilité. Des images de la taille d'un timbre
 * faisaient d'un fil de salons de beauté une liste de texte.
 *
 * **Le voile est un dégradé, pas un rectangle.** Un aplat sombre sur le bas de
 * l'image la salit ; un dégradé qui part de rien et finit opaque garde la photo
 * lisible et le texte détaché, quelle que soit la photo dessous. Ses trois
 * arrêts viennent des jetons.
 *
 * **La hauteur d'une carte ne change jamais selon la présence d'une photo.**
 * Un fil dont les cartes se déforment selon les images est illisible au
 * défilement, et un salon sans photo paraîtrait puni.
 *
 * **Le repli d'image ne se commente pas côté créateur.** Un monogramme neutre.
 * Côté commerce, il devient une tâche — « Photo manquante · ajouter » — parce
 * que c'est quelqu'un qui peut la faire qui la lit.
 */
import { Animated, Image, Pressable, View, type ImageSourcePropType } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { radius, useColors, useTheme } from '../theme';
import { Button } from './Button';
import { useEnfoncement } from './Mouvement';
import { Texte } from './Texte';
import { TierBadge, LigneDeContrepartie, type Palier } from './TierBadge';

/** La hauteur de couverture d'une carte de salon. La photo mène la carte. */
const COUVERTURE = 208;

/**
 * Le voile de lisibilité posé sur une photo.
 *
 * Transparent en haut, opaque en bas : le texte se lit sur n'importe quelle
 * image sans que l'image disparaisse. Les trois arrêts sont des jetons — un
 * dégradé écrit en dur ne suit pas le thème, et il y en a deux.
 */
export function VoileDeLisibilite({ hauteur }: { hauteur?: number }) {
  const c = useColors();
  return (
    <LinearGradient
      pointerEvents="none"
      colors={[c['scrim.top'], c['scrim.mid'], c['scrim.bottom']]}
      locations={[0, 0.55, 1]}
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: hauteur ?? '70%' }}
    />
  );
}

// --------------------------------------------------------------------------

export type MediaFallbackProps = {
  /** Deux lettres, tirées du nom. Jamais une icône générique. */
  monogramme: string;
  height: number;
  /** Côté commerce, l'absence de photo est une tâche, pas un défaut. */
  commeTache?: boolean;
  labelTache?: string;
  testID?: string;
};

export function MediaFallback({
  monogramme,
  height,
  commeTache,
  labelTache,
  testID,
}: MediaFallbackProps) {
  const c = useColors();
  return (
    <View
      testID={testID}
      style={{
        height,
        backgroundColor: c['media.placeholder'],
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
      }}
    >
      <Texte variante="type.title" couleur="media.placeholderText">
        {monogramme.slice(0, 2).toUpperCase()}
      </Texte>
      {commeTache && labelTache ? (
        <Texte variante="type.caption" couleur="status.warning">
          {labelTache}
        </Texte>
      ) : null}
    </View>
  );
}

// --------------------------------------------------------------------------

export type BusinessCardProps = {
  name: string;
  meta: string;
  serviceName: string;
  /** Déjà mise en forme par l'appelant : « 45 min ». Jamais un nombre nu. */
  serviceDuration: string;
  tier: Palier;
  /** Déjà mise en forme : « 320 m ». */
  distance?: string;
  cover?: ImageSourcePropType;
  labelPhotoManquante?: string;
  action?: { label: string; onPress: () => void };
  onPress?: () => void;
  testID?: string;
};

export function BusinessCard({
  name,
  meta,
  serviceName,
  serviceDuration,
  tier,
  distance,
  cover,
  labelPhotoManquante,
  action,
  onPress,
  testID,
}: BusinessCardProps) {
  const { color: c, role } = useTheme();
  const enfoncement = useEnfoncement(Boolean(onPress));

  return (
    <Animated.View style={enfoncement.style}>
      <Pressable
        testID={testID}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={onPress ? name : undefined}
        onPress={onPress}
        onPressIn={enfoncement.onPressIn}
        onPressOut={enfoncement.onPressOut}
        style={{
          borderRadius: radius['radius.xl'],
          borderWidth: 1,
          borderColor: c['border.subtle'],
          backgroundColor: c['bg.surface'],
          overflow: 'hidden',
        }}
      >
        <View testID="couverture" style={{ height: COUVERTURE, justifyContent: 'flex-end' }}>
          {cover ? (
            <Image
              source={cover}
              style={{ position: 'absolute', width: '100%', height: COUVERTURE }}
              resizeMode="cover"
            />
          ) : (
            <MediaFallback
              monogramme={name}
              height={COUVERTURE}
              commeTache={role === 'merchant'}
              labelTache={labelPhotoManquante}
            />
          )}

          <VoileDeLisibilite />

          <View style={{ position: 'absolute', top: 10, right: 10 }}>
            <TierBadge tier={tier} size="sm" onPhoto />
          </View>
          {distance ? (
            <View
              style={{
                position: 'absolute',
                top: 10,
                left: 10,
                paddingVertical: 3,
                paddingHorizontal: 8,
                borderRadius: radius['radius.full'],
                backgroundColor: c['badge.scrim'],
              }}
            >
              <Texte variante="type.mono" couleur="text.primary" style={{ fontSize: 11 }}>
                {distance}
              </Texte>
            </View>
          ) : null}

          {/* Le nom sur la photo. C'est lui qu'on cherche en faisant défiler,
              et le mettre sous l'image le renvoyait à la troisième ligne. */}
          <View style={{ padding: 14, gap: 2 }}>
            <Texte
              variante="type.title"
              ellipseSurNomPropre
              // Le texte est posé sur le voile, pas sur une surface : sa
              // couleur ne suit pas le thème mais le voile, qui est sombre
              // dans les deux.
              couleur="text.onScrim"
            >
              {name}
            </Texte>
            <Texte variante="type.caption" couleur="text.onScrimMuted">
              {meta}
            </Texte>
          </View>
        </View>

        <View style={{ padding: 14, gap: 6 }}>
          <Texte variante="type.bodyStrong">{`${serviceName} · ${serviceDuration}`}</Texte>
          <LigneDeContrepartie tier={tier} />
          {action ? (
            <View style={{ marginTop: 6 }}>
              <Button label={action.label} onPress={action.onPress} />
            </View>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

// --------------------------------------------------------------------------

export type ServiceRowProps = {
  name: string;
  meta: string;
  tier: Palier;
  thumbnail?: ImageSourcePropType;
  right?: React.ReactNode;
  testID?: string;
};

export function ServiceRow({ name, meta, tier, thumbnail, right, testID }: ServiceRowProps) {
  const c = useColors();
  return (
    <View
      testID={testID}
      style={{
        height: 64,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 12,
        borderBottomWidth: 1,
        borderBottomColor: c['border.subtle'],
      }}
    >
      <View style={{ width: 44, height: 44, borderRadius: radius['radius.sm'], overflow: 'hidden' }}>
        {thumbnail ? (
          <Image source={thumbnail} style={{ width: 44, height: 44 }} resizeMode="cover" />
        ) : (
          <MediaFallback monogramme={name} height={44} />
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Texte variante="type.label">{name}</Texte>
        <Texte variante="type.mono" couleur="text.secondary" style={{ fontSize: 12 }}>
          {meta}
        </Texte>
      </View>
      <TierBadge tier={tier} size="sm" />
      {right}
    </View>
  );
}

// --------------------------------------------------------------------------

export type DataRowProps = {
  label: string;
  value: string;
  /** Les chiffres passent en `type.mono` : ils s'alignent d'une ligne à l'autre. */
  chiffre?: boolean;
  testID?: string;
};

export function DataRow({ label, value, chiffre, testID }: DataRowProps) {
  const c = useColors();
  return (
    <View
      testID={testID}
      style={{
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: c['border.subtle'],
      }}
    >
      <Texte variante="type.caption" couleur="text.secondary" style={{ flexShrink: 1 }}>
        {label}
      </Texte>
      <Texte variante={chiffre ? 'type.mono' : 'type.body'} align="right" style={{ flexShrink: 1 }}>
        {value}
      </Texte>
    </View>
  );
}
