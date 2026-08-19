/**
 * Les rangées par quartier : ce que montre une catégorie choisie.
 *
 * **Le mur reste le fil par défaut.** Ces rangées sont l'autre direction de la
 * planche « Fil v2 », et Design l'a tranché lui-même : « le mur de 1a peut être
 * le fil par défaut, et les rangées de 1b devenir ce que montre une catégorie
 * choisie ». Le mur répond à « je descends sans intention » ; les rangées
 * répondent à « je cherche quelque chose près de chez moi », qui est exactement
 * ce qu'on vient de dire en appuyant sur une catégorie.
 *
 * **Filtrer ne change pas la structure, seulement ce qu'il y a dedans.** Les
 * quartiers restent l'ossature ; c'est le nombre par quartier qui devient
 * l'information utile.
 *
 * **L'inégalité des cartes est le rythme, pas une hiérarchie de mérite.** La
 * première d'une rangée est plus large : c'est le salon le plus proche du
 * quartier, et rien d'autre ne le désigne. Les suivantes dépassent le bord
 * droit, ce qui annonce le glissement sans flèche — une flèche dirait qu'il y a
 * un bouton, alors qu'il y a un geste.
 *
 * **Le titre de quartier reste au jeton.** La planche descend le titre de
 * quartier à 28 px sur ce seul écran, contre 34 pour `type.heading`. La raison
 * de trancher pour le jeton a changé sans que la décision change : c'était le
 * plancher d'un serif, tombé avec lui ; c'est maintenant que la planche est
 * une v1.0 et que Design n'a pas réédité les treize. Suivre un écart relevé
 * sur une planche périmée serait figer une valeur que personne n'a revue sous
 * la nouvelle direction. L'écart reste écrit dans `TASKS.md`.
 */
import { Image, Pressable, ScrollView, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { useApi, type CommerceDuFil, type Fil } from '../../api';
import { Texte } from '../../components';
import { useEnfoncement } from '../../components/Mouvement';
import { formatNumber } from '../../format';
import { useI18n, type SupportedLocale } from '../../i18n';
import { useColors, voileDEncre } from '../../theme';
import { VOILE } from './regles';
import { enRangees, type ApercuDeLaSuite, type Rangee } from './rangees';

/**
 * La géométrie, relevée sur la planche.
 *
 * La première carte est plus large de 66 points : c'est assez pour que
 * l'inégalité se voie sans que la seconde cesse de porter un nom.
 */
const CARTE = { premiere: 216, suivante: 150, hauteur: 250 } as const;
const ECART = 5;
const MARGE = 18;

/** La distance, en mètres sous le kilomètre et en kilomètres au-delà. */
function distance(metres: number, locale: SupportedLocale): string {
  if (metres < 1000) return `${formatNumber(Math.round(metres), locale)} m`;
  return `${formatNumber(Math.round(metres / 100) / 10, locale)} km`;
}

/**
 * Une carte de salon.
 *
 * **Aucune valeur en argent**, ici comme sur le mur : ce qui tiendrait la place
 * d'un prix ailleurs est la durée et la contrepartie. Et la prestation ne
 * s'écrit que sur la carte large — c'est la même règle que le mur, où le texte
 * suit la largeur et non la hauteur : à 150 points, un nom et une prestation
 * deviennent illisibles ensemble plutôt que l'un des deux utile.
 */
function CarteDeSalon({
  commerce,
  premiere,
  onOuvrir,
}: {
  commerce: CommerceDuFil;
  premiere: boolean;
  onOuvrir: (businessId: string) => void;
}) {
  const { api } = useApi();
  const { locale } = useI18n();
  const c = useColors();
  const enfoncement = useEnfoncement();

  const item = commerce.items[0];
  const source = api.urlDuMedia(commerce.cover_portrait_key ?? commerce.cover_photo_key);

  return (
    <Pressable
      testID={`salon-${commerce.business_id}`}
      accessibilityRole="button"
      accessibilityLabel={commerce.name}
      onPress={() => onOuvrir(commerce.business_id)}
      onPressIn={enfoncement.onPressIn}
      onPressOut={enfoncement.onPressOut}
      style={{
        width: premiere ? CARTE.premiere : CARTE.suivante,
        height: CARTE.hauteur,
        backgroundColor: c['bg.deep'],
        overflow: 'hidden',
      }}
    >
      {source ? (
        <Image
          testID={`salon-${commerce.business_id}-photo`}
          source={{ uri: source }}
          resizeMode="cover"
          style={{ position: 'absolute', width: '100%', height: '100%' }}
        />
      ) : null}
      <LinearGradient
        colors={VOILE.bas.map(voileDEncre) as unknown as readonly [string, string, string]}
        locations={[0, 0.52, 1]}
        style={{ position: 'absolute', width: '100%', height: '100%' }}
      />
      <View style={{ marginTop: 'auto', padding: 13, gap: 3 }}>
        <Texte variante="type.monoSmall" style={{ color: c['ink.onDark'] }}>
          {distance(commerce.distance_metres, locale).toUpperCase()}
        </Texte>
        <Texte
          testID={`salon-${commerce.business_id}-nom`}
          variante="type.section"
          style={{ color: c['ink.onScrim'] }}
        >
          {commerce.name}
        </Texte>
        {premiere && item ? (
          <Texte
            variante="type.caption"
            testID={`salon-${commerce.business_id}-prestation`}
            style={{ color: c['ink.onDark'] }}
          >
            {[item.name, item.duration_minutes ? `${item.duration_minutes} min` : null]
              .filter(Boolean)
              .join(' · ')}
          </Texte>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * La carte d'os qui ferme une rangée courte.
 *
 * **Une rangée courte ne se cache pas.** Sous trois salons, rien ne dépasse le
 * bord droit : le glissement ne s'annonce plus et la rangée ressemble à une
 * erreur de chargement. Cette carte dit ce qu'il y a plus loin, ce qui est à la
 * fois l'information manquante et la preuve que rien n'a échoué.
 *
 * **Elle ne s'appuie pas, et c'est voulu.** Ce qu'elle annonce est la rangée
 * juste en dessous, déjà sur le même écran : un lien qui ferait défiler de deux
 * cents points promettrait un déplacement que le geste fait déjà. C'est le même
 * traitement que la respiration du mur, qui nomme un quartier, le compte, le
 * situe, et ne prétend pas être une porte.
 */
function ApercuDeLaSuivante({ suite }: { suite: ApercuDeLaSuite }) {
  const { t, locale } = useI18n();
  const c = useColors();

  return (
    <View
      testID="apercu-de-la-suite"
      style={{
        width: CARTE.suivante,
        height: CARTE.hauteur,
        backgroundColor: c['bg.sunken'],
        padding: 16,
        justifyContent: 'flex-end',
        gap: 8,
      }}
    >
      <Texte variante="type.monoSmall" couleur="ink.soft">
        {`${t(`quartiers.${suite.quartier}`)} · ${distance(suite.distanceMetres, locale)}`.toUpperCase()}
      </Texte>
      <Texte variante="type.body" couleur="ink.soft">
        {suite.commerces === 1
          ? t('parcours.rangeeSuiteUn')
          : t('parcours.rangeeSuite', { count: formatNumber(suite.commerces, locale) })}
      </Texte>
    </View>
  );
}

/** Une rangée : son titre, son compte, et son balayage. */
function RangeeDeQuartier({
  rangee,
  onOuvrir,
}: {
  rangee: Rangee;
  onOuvrir: (businessId: string) => void;
}) {
  const { t, locale } = useI18n();

  return (
    <View style={{ gap: 9 }} testID={`rangee-${rangee.quartier ?? 'ailleurs'}`}>
      <View
        style={{ paddingHorizontal: MARGE, flexDirection: 'row', alignItems: 'baseline', gap: 10 }}
      >
        <Texte variante="type.heading" testID={`rangee-${rangee.quartier ?? 'ailleurs'}-titre`}>
          {rangee.quartier ? t(`quartiers.${rangee.quartier}`) : t('parcours.rangeeAilleurs')}
        </Texte>
        {/* Le compte de la rangée, et non celui du quartier dans le fil : ce
            qu'on veut savoir est combien de cartes on va balayer. */}
        <Texte variante="type.monoSmall" couleur="ink.soft">
          {formatNumber(rangee.salons.length, locale)}
        </Texte>
      </View>

      {/* **Le seul défilement horizontal du produit, et il porte sa raison.**
          La bibliothèque interdit le glissement horizontal aux rangées de
          chips, parce qu'une option qui sort de l'écran n'existe pas pour qui
          n'y pense pas. Ici l'inverse est vrai : ce qui sort de l'écran est du
          contenu, pas un réglage, et le dépassement est ce qui annonce le
          geste. Une rangée qui reviendrait à la ligne perdrait les deux axes
          qui font toute la direction. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: ECART, paddingLeft: MARGE, paddingRight: MARGE }}
      >
        {rangee.salons.map((commerce, rang) => (
          <CarteDeSalon
            key={commerce.business_id}
            commerce={commerce}
            premiere={rang === 0}
            onOuvrir={onOuvrir}
          />
        ))}
        {rangee.suite ? <ApercuDeLaSuivante suite={rangee.suite} /> : null}
      </ScrollView>
    </View>
  );
}

export function RangeesParQuartier({
  fil,
  onOuvrir,
}: {
  fil: Fil;
  onOuvrir: (businessId: string) => void;
}) {
  const rangees = enRangees(fil);

  return (
    <View style={{ gap: 18 }} testID="rangees-par-quartier">
      {rangees.map((rangee) => (
        <RangeeDeQuartier
          key={rangee.quartier ?? 'ailleurs'}
          rangee={rangee}
          onOuvrir={onOuvrir}
        />
      ))}
    </View>
  );
}
