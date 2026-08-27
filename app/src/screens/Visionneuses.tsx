/**
 * Les deux visionneuses plein écran, et ce qui les sépare.
 *
 * **Une carte se lit, une galerie se regarde.** C'est toute la règle du lot 4,
 * et elle tient dans une couleur de fond : la galerie reste sur `bg.onDark`,
 * la carte s'ouvre sur `bg.page`. On regarde une photo sur du sombre, où rien
 * ne dispute la lumière à l'image ; on lit un texte sur du clair, parce qu'une
 * page de carte est faite d'encre sur du papier et qu'un fond noir autour la
 * fait paraître grise.
 *
 * Les deux objets ne se consomment pas de la même façon — l'un se fait
 * défiler, l'autre se lit en s'arrêtant — et c'est la seule chose qui distingue
 * les deux écrans. Elle suffit, et un test la tient : deux fonds différents,
 * chacun le sien.
 *
 * ---
 *
 * **Une page de carte est toujours une photographie.** Jamais du texte
 * recomposé, jamais une liste de plats reconstituée à partir d'une extraction.
 * BIND ne dépouille pas la carte d'un commerce : ce qu'il montre est ce que le
 * commerce a affiché, avec sa mise en page, ses prix et ses fautes de frappe.
 * Recomposer reviendrait à republier la carte sous notre nom, et à répondre
 * d'une erreur de lecture devant un client qui a commandé autre chose.
 *
 * Une garde le tient : cette visionneuse ne connaît que des clés de stockage et
 * une `Image`, et rien de ce qui touche à l'extraction n'y entre.
 *
 * ---
 *
 * **Le zoom n'y est pas, et ce n'est pas un oubli.** La planche demande une
 * page pincée pour zoomer ; le pincement n'existe pas en React Native sans une
 * bibliothèque de gestes, et en ajouter une pour un geste ne se décide pas dans
 * une tranche de composition. La page est rendue en `contain` sur une feuille
 * qui occupe la hauteur disponible — lisible sur un téléphone tenu à trente
 * centimètres, ce qui est la distance de lecture d'une carte.
 */
import { useState } from 'react';
import { Image, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';

import { useApi } from '../api';
import { Button, Icone, Texte } from '../components';
import { useI18n } from '../i18n';
import { radius, useColors } from '../theme';
import { etatAccessible } from '../components/etatAccessible';

/**
 * Le fond de chaque visionneuse.
 *
 * Exporté et nommé plutôt qu'écrit deux fois dans deux composants : c'est la
 * règle du lot, et une règle qui vit à deux endroits finit par n'en tenir qu'un.
 */
export const FOND_DES_VISIONNEUSES = {
  /** On regarde une photo sur du sombre. */
  galerie: 'bg.onDark',
  /** On lit un texte sur du clair. */
  carte: 'bg.page',
} as const;

/** La barre du haut, commune aux deux : fermer, dire quoi, dire où on en est. */
function Chrome({
  titre,
  detail,
  position,
  surEncre,
  onFermer,
  testID,
}: {
  titre: string;
  /** Le nom de la page, quand la donnée le porte. Rien sinon. */
  detail?: string | null;
  position: string;
  surEncre: boolean;
  onFermer: () => void;
  testID?: string;
}) {
  const c = useColors();
  const { t } = useI18n();
  const encre = surEncre ? 'ink.onDark' : 'ink.default';
  const sourd = surEncre ? 'line.strong' : 'ink.mute';

  return (
    <View
      testID={testID}
      style={{
        height: 48,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingHorizontal: 20,
        borderBottomWidth: 1,
        borderBottomColor: c[surEncre ? 'line.onDark' : 'line.default'],
      }}
    >
      {/* Le bouton de fermeture répond, comme tout ce qui se presse. Il était
          couvert par une dispense posée sur le fichier entier — écrite pour un
          fond de visionneuse qui n'existe plus. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.fermer')}
        hitSlop={12}
        onPress={onFermer}
        testID="fermer-la-visionneuse"
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      >
        <Icone nom="croix" couleur={encre} taille={22} />
      </Pressable>
      <Texte variante="type.bodyStrong" couleur={encre} style={{ flex: 1 }}>
        {titre}
      </Texte>
      {/* Le nom de la page est du **chrome**, hors de la feuille : posé
          dessus, il se lirait comme un titre de la carte elle-même, et BIND
          n'écrit rien sur la carte d'un commerce. */}
      {detail ? (
        <Texte variante="type.dataLabel" couleur={sourd} testID="nom-de-la-page">
          {detail}
        </Texte>
      ) : null}
      <Texte variante="type.dataLabel" couleur={encre} testID="position-dans-la-visionneuse">
        {position}
      </Texte>
    </View>
  );
}

/** Les points de pagination. Celui qu'on regarde est une barre, pas un point. */
function Points({ total, courant, surEncre }: { total: number; courant: number; surEncre: boolean }) {
  const c = useColors();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: 10 }}
    >
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          testID={`point-${i}`}
          style={{
            width: i === courant ? 18 : 6,
            height: 6,
            backgroundColor: c[
              i === courant ? (surEncre ? 'ink.onDark' : 'ink.default') : 'line.strong'
            ],
          }}
        />
      ))}
    </View>
  );
}

/** Le défilement paginé, commun aux deux : une page occupe exactement l'écran. */
function Pages({
  cles,
  largeur,
  surCourante,
  rendre,
}: {
  cles: string[];
  largeur: number;
  surCourante: (rang: number) => void;
  rendre: (cle: string, rang: number) => React.ReactNode;
}) {
  return (
    <ScrollView
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      // Le rang se lit sur le décalage réel, jamais sur celui qu'on vient de
      // demander : un défilement interrompu à mi-chemin revient en arrière, et
      // la pastille dirait alors une page qu'on ne regarde pas.
      onMomentumScrollEnd={({ nativeEvent }) =>
        surCourante(Math.round(nativeEvent.contentOffset.x / Math.max(largeur, 1)))
      }
      style={{ flex: 1 }}
      testID="pages-de-la-visionneuse"
    >
      {cles.map((cle, rang) => (
        <View key={cle} style={{ width: largeur }}>
          {rendre(cle, rang)}
        </View>
      ))}
    </ScrollView>
  );
}

// --------------------------------------------------------------------------

export type VisionneuseDeCarteProps = {
  /** Les clés des pages, dans l'ordre où la carte se lit. */
  pages: string[];
  /** Le nom de chaque page, quand il est connu. Aligné sur `pages`. */
  noms?: (string | null)[];
  onFermer: () => void;
  /** Réserver sans repasser par la fiche : elle a ouvert la carte pour décider. */
  onReserver?: () => void;
  labelReserver?: string;
};

/**
 * 24b · La carte, en pages.
 *
 * **Sur os, pas sur encre.** On lit.
 *
 * **La page est montée sur une feuille blanche**, avec sa marge : une
 * photographie de carte posée à même le fond se confondrait avec le fond, et
 * la feuille dit qu'il y a un objet, pris quelque part, qu'on regarde.
 *
 * **Le bouton de réservation suit la lectrice.** Elle a ouvert la carte pour
 * décider ; la renvoyer à la fiche pour appuyer lui ferait refaire le chemin
 * en sens inverse avec la décision déjà prise.
 */
export function VisionneuseDeCarte({
  pages,
  noms,
  onFermer,
  onReserver,
  labelReserver,
}: VisionneuseDeCarteProps) {
  const { api } = useApi();
  const { t } = useI18n();
  const c = useColors();
  const { width } = useWindowDimensions();
  const [courante, setCourante] = useState(0);

  return (
    <View
      testID="visionneuse-de-carte"
      style={{ flex: 1, backgroundColor: c[FOND_DES_VISIONNEUSES.carte] }}
    >
      <Chrome
        titre={t('parcours.carteTitre')}
        detail={noms?.[courante] ?? null}
        position={`${courante + 1} / ${pages.length}`}
        surEncre={false}
        onFermer={onFermer}
      />

      <Pages
        cles={pages}
        largeur={width}
        surCourante={setCourante}
        rendre={(cle, rang) => (
          <View style={{ flex: 1, padding: 16 }}>
            <View
              style={{
                flex: 1,
                padding: 8,
                backgroundColor: c['bg.surface'],
                borderWidth: 1,
                borderColor: c['line.strong'],
                borderRadius: radius['radius.none'],
              }}
            >
              <Image
                testID={`page-de-carte-${rang}`}
                // **L'original, jamais la vignette.** Une carte se lit, et une
                // réduction de quatre cent quatre-vingts points ne se lit pas.
                source={{ uri: api.urlDuMedia(cle) ?? undefined }}
                // `contain` et non `cover` : une carte recadrée perd une
                // colonne de prix, et c'est celle qu'on cherchait.
                resizeMode="contain"
                style={{ flex: 1, width: '100%' }}
              />
            </View>
          </View>
        )}
      />

      <Points total={pages.length} courant={courante} surEncre={false} />

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          padding: 16,
          backgroundColor: c['bg.surface'],
          borderTopWidth: 1,
          borderTopColor: c['line.default'],
        }}
      >
        {/* La bande de vignettes : elle sert à sauter, pas à décorer. Sur une
            carte de huit pages, retrouver les desserts en glissant sept fois
            est ce qui fait fermer l'écran. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', gap: 7 }}>
            {pages.map((cle, rang) => (
              <Pressable
                key={cle}
                accessibilityRole="button"
                accessibilityLabel={t('parcours.cartePage', { rang: rang + 1 })}
                {...etatAccessible({ selected: rang === courante })}
                onPress={() => setCourante(rang)}
                testID={`vignette-de-carte-${rang}`}
                style={({ pressed }) => ({
                  width: 40,
                  height: 52,
                  borderWidth: rang === courante ? 2 : 1,
                  borderColor: c[rang === courante ? 'line.solo' : 'line.strong'],
                  // La page courante est pleine, les autres en retrait. Une
                  // opacité plutôt qu'un voile : c'est la seule propriété
                  // animable du système, et rien ne se pose par-dessus.
                  //
                  // **Les deux opacités se multiplient**, elles ne se
                  // remplacent pas : posée en tête, celle de l'appui était
                  // écrasée par celle du rang, et la vignette ne répondait
                  // qu'à condition d'être déjà la page courante.
                  opacity: (rang === courante ? 1 : 0.5) * (pressed ? 0.7 : 1),
                })}
              >
                <Image
                  source={{ uri: api.urlDeLaVignette(cle) ?? undefined }}
                  resizeMode="cover"
                  style={{ width: '100%', height: '100%' }}
                />
              </Pressable>
            ))}
          </View>
        </ScrollView>

        {onReserver ? (
          <Button
            label={labelReserver ?? t('parcours.reserver')}
            size="sm"
            fullWidth={false}
            onPress={onReserver}
            testID="reserver-depuis-la-carte"
          />
        ) : null}
      </View>
    </View>
  );
}

// --------------------------------------------------------------------------

/**
 * La galerie plein écran d'une fiche salon.
 *
 * **Sur encre, et c'est une exception assumée du système.** La passation la
 * déclare hors thème avec l'écran de code : une photo se regarde sur du sombre,
 * où rien ne dispute la lumière à l'image. Le chrome y est minimal pour la
 * même raison — chaque élément d'interface est une chose de plus qui n'est pas
 * la photo.
 */
export function VisionneuseDeGalerie({
  photos,
  depuis = 0,
  onFermer,
}: {
  photos: string[];
  /** La photo par laquelle on entre, quand on a appuyé sur l'une d'elles. */
  depuis?: number;
  onFermer: () => void;
}) {
  const { api } = useApi();
  const { t } = useI18n();
  const c = useColors();
  const { width } = useWindowDimensions();
  const [courante, setCourante] = useState(depuis);

  return (
    <View
      testID="visionneuse-de-galerie"
      style={{ flex: 1, backgroundColor: c[FOND_DES_VISIONNEUSES.galerie] }}
    >
      <Chrome
        titre={t('parcours.galerieTitre')}
        position={`${courante + 1} / ${photos.length}`}
        surEncre
        onFermer={onFermer}
      />

      <Pages
        cles={photos}
        largeur={width}
        surCourante={setCourante}
        rendre={(cle, rang) => (
          <Image
            testID={`photo-de-galerie-${rang}`}
            source={{ uri: api.urlDuMedia(cle) ?? undefined }}
            resizeMode="contain"
            style={{ flex: 1, width: '100%' }}
          />
        )}
      />

      <Points total={photos.length} courant={courante} surEncre />
    </View>
  );
}
