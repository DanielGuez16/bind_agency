/**
 * Cartes et rangées.
 *
 * **La hauteur d'une carte ne change jamais selon la présence d'une photo.**
 * Un fil dont les cartes se déforment selon les images est illisible au
 * défilement, et un salon sans photo paraîtrait puni.
 *
 * **Le repli d'image ne se commente pas côté créateur.** Un monogramme neutre.
 * Côté commerce, il devient une tâche — « Photo manquante · ajouter » — parce
 * que c'est quelqu'un qui peut la faire qui la lit.
 */
import { Pressable, View, type ImageSourcePropType } from 'react-native';
import { Image } from 'react-native';

import { radius, useColors, useTheme } from '../theme';
import { Button } from './Button';
import { Texte } from './Texte';
import { TierBadge, LigneDeContrepartie, type Palier } from './TierBadge';

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

  return (
    <Pressable
      testID={testID}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? name : undefined}
      onPress={onPress}
      style={{
        borderRadius: radius['radius.lg'],
        borderWidth: 1,
        borderColor: c['border.subtle'],
        backgroundColor: c['bg.surface'],
        overflow: 'hidden',
      }}
    >
      <View testID="couverture" style={{ height: 150 }}>
        {cover ? (
          <Image source={cover} style={{ width: '100%', height: 150 }} resizeMode="cover" />
        ) : (
          <MediaFallback
            monogramme={name}
            height={150}
            commeTache={role === 'merchant'}
            labelTache={labelPhotoManquante}
          />
        )}
        <View style={{ position: 'absolute', top: 8, right: 8 }}>
          <TierBadge tier={tier} size="sm" onPhoto />
        </View>
        {distance ? (
          <View
            style={{
              position: 'absolute',
              bottom: 8,
              left: 8,
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
      </View>

      <View style={{ padding: 12, gap: 6 }}>
        {/* Le nom d'un salon est un nom propre : c'est le seul endroit où
            l'ellipse est permise. */}
        <Texte variante="type.title" ellipseSurNomPropre>
          {name}
        </Texte>
        <Texte variante="type.caption" couleur="text.secondary">
          {meta}
        </Texte>
        <View style={{ height: 1, backgroundColor: c['border.subtle'], marginVertical: 2 }} />
        <Texte variante="type.bodyStrong">{`${serviceName} · ${serviceDuration}`}</Texte>
        <LigneDeContrepartie tier={tier} />
        {action ? (
          <View style={{ marginTop: 4 }}>
            <Button label={action.label} onPress={action.onPress} />
          </View>
        ) : null}
      </View>
    </Pressable>
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
