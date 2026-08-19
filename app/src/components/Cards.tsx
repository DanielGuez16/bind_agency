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
import type { ReactNode } from 'react';
import { Animated, Image, Pressable, View, type ImageSourcePropType } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { elevationDeCarte, radius, useColors, useTheme } from '../theme';
import { Button } from './Button';
import { useEnfoncement } from './Mouvement';
import { Texte } from './Texte';
import { TierBadge, LigneDeContrepartie, type Palier } from './TierBadge';

/**
 * Le **rapport** de la couverture d'une carte, et non sa hauteur.
 *
 * Les couvertures sont déposées en 16:9 — c'est ce que demande `A-FOURNIR.md`
 * et ce que le semis range. Une boîte de hauteur fixe ne retombe sur ce rapport
 * qu'à une seule largeur d'écran : partout ailleurs, `resizeMode="cover"` rogne
 * pour remplir, et ce qu'il rogne est le sujet. Sur un iPhone, la devanture
 * perdait son enseigne.
 *
 * Le rapport, lui, tient à toutes les largeurs : la boîte suit l'image au lieu
 * que l'image suive la boîte. La hauteur reste identique d'une carte à l'autre
 * — c'est la largeur qui la fixe, et elle est la même pour toutes.
 */
const RAPPORT_COUVERTURE = 16 / 9;

/**
 * Le voile de lisibilité posé sur une photo.
 *
 * Transparent en haut, opaque en bas : la photo reste visible sans que le fond
 * du texte devienne quelconque. Les arrêts sont des jetons — un dégradé écrit
 * en dur ne suit pas le système.
 *
 * **Ce voile adoucit, il ne garantit rien.** C'est une distinction qui a coûté
 * un défaut : sur un dégradé, l'opacité sous un texte dépend de l'endroit exact
 * où ce texte tombe, donc de la hauteur de la carte, donc du terminal. Mesuré
 * sur la pire photo possible — une blanche —, `ink.onScrim` ne tient qu'à
 * partir d'un voile à 0,61 et `ink.onScrimMuted` qu'à 0,735 ; des trois arrêts
 * du système, **seul `scrim.photoBottom` les dépasse**. Un texte posé ailleurs
 * que sur cet arrêt-là est illisible sur une photo claire, et le prouver
 * demanderait de connaître une mise en page qu'on ne connaît pas.
 *
 * D'où le partage : le dégradé fait la transition, et le texte porte **sa
 * propre bande** à `scrim.photoBottom` — voir `BandeDeTexteSurPhoto`. La
 * lisibilité cesse alors de dépendre d'une hauteur.
 */
export function VoileDeLisibilite({ hauteur }: { hauteur?: number }) {
  const c = useColors();
  return (
    <LinearGradient
      pointerEvents="none"
      // S'arrête à `modal` : ce qui suit est la bande du texte, qui porte son
      // fond elle-même. Descendre jusqu'à `photoBottom` ici ferait deux
      // couches sombres empilées, et la photo perdrait son dernier tiers pour
      // rien.
      colors={[c['scrim.photoTop'], c['scrim.modal']]}
      locations={[0, 1]}
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: hauteur ?? '70%' }}
    />
  );
}

/**
 * La bande sur laquelle un texte se pose, au-dessus d'une photo.
 *
 * **Un fond, pas un dégradé.** C'est tout l'intérêt : `scrim.photoBottom` donne
 * 12,10:1 à `ink.onScrim` et 7,72:1 à `ink.onScrimMuted` sur une photo blanche,
 * et ces deux nombres ne dépendent ni de la hauteur de la carte, ni du
 * terminal, ni de l'endroit où la ligne tombe. Un dégradé, lui, donne un
 * chiffre différent à chaque pixel — et sur les cartes du fil, les deux lignes
 * tombaient à 0,65 et 0,76 d'opacité, c'est-à-dire à la limite pour l'une et
 * en dessous pour l'autre selon la taille de l'écran.
 */
export function BandeDeTexteSurPhoto({
  children,
  testID,
}: {
  children: ReactNode;
  testID?: string;
}) {
  const c = useColors();
  return (
    <View testID={testID} style={{ padding: 14, gap: 2, backgroundColor: c['scrim.photoBottom'] }}>
      {children}
    </View>
  );
}

// --------------------------------------------------------------------------

export type MediaFallbackProps = {
  /** Deux lettres, tirées du nom. Jamais une icône générique. */
  monogramme: string;
  /** Une hauteur fixe, ou `'100%'` pour épouser une boîte au rapport imposé. */
  height: number | '100%';
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
      <Texte variante="type.section" couleur="media.placeholderText">
        {monogramme.slice(0, 2).toUpperCase()}
      </Texte>
      {commeTache && labelTache ? (
        <Texte variante="type.caption" couleur="status.warning.text">
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
  // **L'ombre est portée par la vue extérieure, et c'est obligatoire.** La
  // carte clippe son contenu — `overflow: 'hidden'`, pour que la couverture
  // épouse le coin de 18 px — et sur iOS une vue qui clippe ne peut pas porter
  // d'ombre : elle la coupe au même bord. Les deux ne peuvent donc pas vivre
  // sur le même nœud. La vue extérieure reprend aussi le fond et le rayon,
  // parce qu'iOS calcule l'ombre depuis la couche opaque : sans fond, il n'y a
  // rien dont projeter la silhouette et l'ombre ne sort pas.
  return (
    <Animated.View
      style={[
        enfoncement.style,
        {
          borderRadius: radius['radius.lg'],
          backgroundColor: c['bg.surface'],
          ...elevationDeCarte(),
        },
      ]}
    >
      <Pressable
        testID={testID}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={onPress ? name : undefined}
        onPress={onPress}
        onPressIn={enfoncement.onPressIn}
        onPressOut={enfoncement.onPressOut}
        style={{
          borderRadius: radius['radius.lg'],
          borderWidth: 1,
          borderColor: c['line.default'],
          backgroundColor: c['bg.surface'],
          overflow: 'hidden',
        }}
      >
        <View
          testID="couverture"
          style={{ aspectRatio: RAPPORT_COUVERTURE, justifyContent: 'flex-end' }}
        >
          {cover ? (
            <Image
              source={cover}
              // La boîte est au rapport de l'image : « cover » ne rogne donc
              // rien, il remplit. Le voile et le nom se posent par-dessus sans
              // rien retrancher au cadre.
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
              resizeMode="cover"
            />
          ) : (
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
              <MediaFallback
                monogramme={name}
                height="100%"
                commeTache={role === 'merchant'}
                labelTache={labelPhotoManquante}
              />
            </View>
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
                borderRadius: radius['radius.pill'],
                backgroundColor: c['scrim.badge'],
              }}
            >
              <Texte variante="type.mono" couleur="ink.default" style={{ fontSize: 11 }}>
                {distance}
              </Texte>
            </View>
          ) : null}

          {/* Le nom sur la photo. C'est lui qu'on cherche en faisant défiler,
              et le mettre sous l'image le renvoyait à la troisième ligne.

              **Sur sa propre bande, pas sur la queue du dégradé.** Les deux
              lignes tombaient à 0,65 et 0,76 d'opacité selon la hauteur de la
              carte — au-dessus du seuil pour l'une, en dessous pour l'autre, et
              impossible à prouver dans les deux cas. */}
          <BandeDeTexteSurPhoto testID="bande-du-nom">
            <Texte
              variante="type.section"
              ellipseSurNomPropre
              // Le texte est posé sur le voile, pas sur une surface : sa
              // couleur ne suit pas le fond de l'écran mais celui de la bande.
              couleur="ink.onScrim"
            >
              {name}
            </Texte>
            <Texte variante="type.caption" couleur="ink.onScrimMuted">
              {meta}
            </Texte>
          </BandeDeTexteSurPhoto>
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
        borderBottomColor: c['line.default'],
      }}
    >
      <View style={{ width: 44, height: 44, borderRadius: radius['radius.lg'], overflow: 'hidden' }}>
        {thumbnail ? (
          <Image source={thumbnail} style={{ width: 44, height: 44 }} resizeMode="cover" />
        ) : (
          <MediaFallback monogramme={name} height={44} />
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Texte variante="type.label">{name}</Texte>
        <Texte variante="type.mono" couleur="ink.soft" style={{ fontSize: 12 }}>
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
        borderBottomColor: c['line.default'],
      }}
    >
      <Texte variante="type.caption" couleur="ink.soft" style={{ flexShrink: 1 }}>
        {label}
      </Texte>
      <Texte variante={chiffre ? 'type.mono' : 'type.body'} align="right" style={{ flexShrink: 1 }}>
        {value}
      </Texte>
    </View>
  );
}
