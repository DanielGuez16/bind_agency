/**
 * Le mur : six formats, une seule gouttière, et rien qui ressemble à une carte.
 *
 * **Ce fichier ne décide rien.** L'ordre vient de `cycle.ts`, les trois règles
 * de `regles.ts` ; ici on pose des pixels. C'est ce découpage qui permet
 * d'éprouver la promesse — « personne ne décide quel salon mérite le grand
 * format » — sans monter six composants.
 *
 * **Le mur sert l'original, jamais la vignette.** Celle-ci est bornée à 480 px
 * sur le grand côté : sur un héros de 520 points à fond perdu, elle serait
 * agrandie trois fois. Et une seule source pour tous les formats, même là où un
 * triptyque de 158 points s'en contenterait — deux sources donneraient deux
 * cadrages du même salon selon sa position dans le cycle, ce que le mur existe
 * précisément pour éviter.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { Image, Pressable, View } from 'react-native';

import { useApi, type CommerceDuFil, type Fil } from '../../api';
import { Texte } from '../../components';
import { useEnfoncement } from '../../components/Mouvement';
import { useI18n } from '../../i18n';
import { formatNumber } from '../../format';
import { useColors, voileDEncre } from '../../theme';
import { CYCLE, enBlocs, FILET, type Bloc, type Format } from './cycle';
import {
  accentDe,
  porteLApercuDeGalerie,
  typographieDe,
  VIGNETTES_DE_GALERIE,
  voileDe,
  VOILE,
} from './regles';

/** La contrepartie, qui tient la place qu'un prix occuperait ailleurs. */
function contrepartieDe(t: ReturnType<typeof useI18n>['t'], contenu: string): string {
  if (contenu === 'reel') return t('parcours.murUnReel');
  if (contenu === 'post') return t('parcours.murUnPost');
  return t('parcours.murUnStory');
}

/**
 * Une photo de salon, quel que soit son format.
 *
 * **Aucune valeur en argent.** Ce qui tiendrait la place d'un prix ailleurs est
 * ici la durée et la contrepartie : « 45 min · one story ». C'est ce qu'une
 * créatrice engage, et la seule grandeur comparable du produit.
 */
function PhotoDuSalon({
  commerce,
  format,
  onOuvrir,
  testID,
}: {
  commerce: CommerceDuFil;
  format: Exclude<Format, 'respiration'>;
  onOuvrir: (businessId: string) => void;
  testID: string;
}) {
  const { api } = useApi();
  const { t, locale } = useI18n();
  const c = useColors();
  const enfoncement = useEnfoncement();

  const item = commerce.items[0];
  const typo = typographieDe(format);
  const accent = accentDe(item?.content_format ?? 'story');
  const sens = voileDe(format);

  // Le portrait d'abord, le paysage en repli : rien ne casse là où la
  // couverture paysage sert déjà, et le mur prend la mieux cadrée des deux.
  const source = api.urlDuMedia(commerce.cover_portrait_key ?? commerce.cover_photo_key);
  const quartier = commerce.neighborhood ? t(`quartiers.${commerce.neighborhood}`) : null;
  const surtitre = [t(`categories.${commerce.category}`), quartier]
    .filter(Boolean)
    .join(' · ')
    .toUpperCase();

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={commerce.name}
      onPress={() => onOuvrir(commerce.business_id)}
      onPressIn={enfoncement.onPressIn}
      onPressOut={enfoncement.onPressOut}
      style={{ flex: 1, backgroundColor: c['bg.deep'], overflow: 'hidden' }}
    >
      {source ? (
        <Image
          testID={`${testID}-photo`}
          source={{ uri: source }}
          resizeMode="cover"
          style={{ position: 'absolute', width: '100%', height: '100%' }}
        />
      ) : null}

      {/* **Le voile de la bande est à l'horizontale.** C'est le seul format
          assez court pour que le texte doive vivre à côté de l'image plutôt que
          dessous : à 150 points, un voile du bas mangerait la moitié de la
          hauteur pour loger deux lignes. */}
      <LinearGradient
        testID={`${testID}-voile`}
        colors={
          VOILE[sens].map(voileDEncre) as unknown as readonly [
            string,
            string,
            string,
          ]
        }
        locations={sens === 'bas' ? [0, 0.52, 1] : [0, 0.58, 1]}
        start={sens === 'bas' ? { x: 0, y: 0 } : { x: 0, y: 0 }}
        end={sens === 'bas' ? { x: 0, y: 1 } : { x: 1, y: 0 }}
        style={{ position: 'absolute', width: '100%', height: '100%' }}
      />

      {/* La pastille de distance, ou le badge — jamais les deux en orange. */}
      <View style={{ position: 'absolute', top: 14, left: 14, flexDirection: 'row', gap: 6 }}>
        <View
          testID={`${testID}-distance`}
          style={{
            paddingHorizontal: 9,
            paddingVertical: 3,
            backgroundColor: accent.distanceEnOrange ? c['brand.500'] : c['scrim.badge'],
          }}
        >
          <Texte variante="type.monoSmall" style={{ color: c['ink.default'] }}>
            {`${formatNumber(Math.round(commerce.distance_metres), locale)} m`}
          </Texte>
        </View>
        {accent.badgeEnOrange ? (
          <View
            testID={`${testID}-badge`}
            style={{ paddingHorizontal: 9, paddingVertical: 3, backgroundColor: c['brand.500'] }}
          >
            <Texte variante="type.monoSmall" style={{ color: c['ink.default'] }}>
              {(item?.content_format ?? '').toUpperCase()}
            </Texte>
          </View>
        ) : null}
      </View>

      {porteLApercuDeGalerie(format) ? <ApercuDeGalerie testID={testID} /> : null}

      <View
        style={
          sens === 'bas'
            ? { marginTop: 'auto', padding: 16, gap: 3 }
            : { marginTop: 'auto', marginBottom: 'auto', padding: 16, gap: 3, maxWidth: '62%' }
        }
      >
        <Texte variante="type.monoSmall" style={{ color: c['ink.onDark'] }}>
          {surtitre}
        </Texte>
        <Texte
          testID={`${testID}-nom`}
          variante="type.section"
          style={{ color: c['ink.onScrim'], fontSize: typo.nom, lineHeight: typo.nom * 1.15 }}
        >
          {commerce.name}
        </Texte>
        {/* **Sous 15, la prestation tombe et le nom reste seul.** Un triptyque
            ne porte jamais trois lignes : les trois deviendraient illisibles
            ensemble plutôt que l'une d'elles utile. */}
        {typo.avecPrestation && item ? (
          <Texte variante="type.caption" testID={`${testID}-prestation`} style={{ color: c['ink.onDark'] }}>
            {[item.name, item.duration_minutes ? `${item.duration_minutes} min` : null,
              contrepartieDe(t, item.content_format)]
              .filter(Boolean)
              .join(' · ')}
          </Texte>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * L'aperçu de galerie, sur le héros de position 4 **et lui seul**.
 *
 * Les deux héros font 520 et 470 : sans cette différence, l'œil ne les
 * distingue pas et le cycle donne l'impression de répéter un format au lieu
 * d'en tenir six. Ce n'est donc pas une décoration.
 */
function ApercuDeGalerie({ testID }: { testID: string }) {
  const c = useColors();
  return (
    <View
      testID={`${testID}-galerie`}
      style={{ position: 'absolute', right: 14, bottom: 14, flexDirection: 'row', gap: FILET }}
    >
      {Array.from({ length: VIGNETTES_DE_GALERIE }, (_, rang) => (
        <View
          key={rang}
          style={{ width: 44, height: 44, backgroundColor: c['scrim.badgeOnDark'] }}
        />
      ))}
    </View>
  );
}

/**
 * La respiration : la porte du quartier qu'elle annonce, pas une bannière.
 *
 * **Elle ne s'ouvre que sur un quartier qu'on n'a pas encore croisé.** « Tu
 * n'as rien vu dans Coral Gables » se dit de ce qui est au-dessus, pas de ce
 * qui est hors du rayon — et le salon juste dessous en vient. Sans quartier à
 * annoncer, le panneau garde sa hauteur et se tait : la géométrie du cycle ne
 * se négocie pas avec le contenu.
 */
function Respiration({
  quartier,
  commerces,
  distanceMetres,
  testID,
}: {
  quartier: string | null;
  commerces: number;
  distanceMetres: number | null;
  testID: string;
}) {
  const { t, locale } = useI18n();
  const c = useColors();

  return (
    <View
      testID={testID}
      style={{
        backgroundColor: c['bg.deep'],
        paddingHorizontal: 22,
        paddingVertical: 24,
        justifyContent: 'center',
        gap: 6,
      }}
    >
      {quartier ? (
        <>
          <Texte variante="type.monoSmall" couleur="ink.mute">
            {t('parcours.murRienVuDans').toUpperCase()}
          </Texte>
          {/* Le Didone, une fois tous les huit salons. Sur environ trois
              hauteurs d'écran de photos, on en croise un — c'est l'intensité
              que la direction propose pour un écran ouvert dix fois par jour. */}
          <Texte variante="type.heading" testID={`${testID}-quartier`}>
            {quartier}
          </Texte>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Texte variante="type.caption" couleur="brand.700" testID={`${testID}-promesse`}>
              {commerces === 1
                ? t('parcours.murVoirLeSalon')
                : t('parcours.murVoirLesSalons', { count: formatNumber(commerces, locale) })}
            </Texte>
            {distanceMetres === null ? null : (
              <Texte variante="type.monoSmall" couleur="ink.mute">
                {`${formatNumber(Math.round(distanceMetres / 100) / 10, locale)} km`}
              </Texte>
            )}
          </View>
        </>
      ) : null}
    </View>
  );
}

/** Un bloc porteur : ses salons côte à côte, séparés du filet. */
function BlocDeSalons({
  bloc,
  rang,
  onOuvrir,
}: {
  bloc: Bloc<CommerceDuFil>;
  rang: number;
  onOuvrir: (businessId: string) => void;
}) {
  return (
    <View
      testID={`bloc-${rang}-${bloc.format}`}
      style={{ height: bloc.hauteur, flexDirection: 'row', gap: FILET }}
    >
      {bloc.salons.map((commerce) => (
        <PhotoDuSalon
          key={commerce.business_id}
          commerce={commerce}
          format={bloc.format as Exclude<Format, 'respiration'>}
          onOuvrir={onOuvrir}
          testID={`salon-${commerce.business_id}`}
        />
      ))}
    </View>
  );
}

/**
 * Le mur entier.
 *
 * **Trois pixels séparent toujours deux photos**, à l'horizontale comme à la
 * verticale, y compris de part et d'autre d'une respiration. C'est la seule
 * mesure constante de l'écran, et c'est elle qui fait tenir six formats
 * ensemble sans qu'aucun ne ressemble à une carte.
 */
export function Mur({
  fil,
  onOuvrir,
}: {
  fil: Fil;
  onOuvrir: (businessId: string) => void;
}) {
  const { t } = useI18n();
  const blocs = enBlocs(fil.commerces);

  /** Les quartiers déjà croisés au-dessus d'un bloc donné. */
  const vusAvant = (rang: number) =>
    new Set(
      blocs
        .slice(0, rang)
        .flatMap((bloc) => bloc.salons)
        .map((commerce) => commerce.neighborhood)
        .filter(Boolean),
    );

  return (
    <View style={{ gap: FILET }} testID="le-mur">
      {blocs.map((bloc, rang) => {
        if (bloc.format !== 'respiration') {
          return <BlocDeSalons key={rang} bloc={bloc} rang={rang} onOuvrir={onOuvrir} />;
        }

        // Le quartier du salon qui suit, s'il n'a pas déjà été croisé.
        const suivant = blocs[rang + 1]?.salons[0]?.neighborhood ?? null;
        const inedit = suivant && !vusAvant(rang).has(suivant) ? suivant : null;
        const compte = inedit ? fil.quartiers.find((q) => q.quartier === inedit) : undefined;

        return (
          <View key={rang} style={{ height: bloc.hauteur }}>
            <Respiration
              testID={`respiration-${bloc.cycle}`}
              quartier={inedit ? t(`quartiers.${inedit}`) : null}
              commerces={compte?.commerces ?? 0}
              distanceMetres={compte?.distance_metres ?? null}
            />
          </View>
        );
      })}
    </View>
  );
}

/**
 * Le mur au chargement : la géométrie exacte du cycle, en aplats.
 *
 * **Rien ne saute quand les images arrivent**, parce que les blocs gris ont
 * déjà la hauteur et la découpe qu'elles auront. C'est ce qui distingue un
 * squelette d'un indicateur : l'un tient la place, l'autre l'annonce.
 *
 * **Aucune animation de pulsation.** Sur des aplats de cette taille elle donne
 * le tournis — le squelette du système en porte une, justifiée sur des lignes
 * de texte, et elle ne se transpose pas à un écran fait de surfaces pleines.
 */
export function MurEnChargement({ cycles = 1 }: { cycles?: number }) {
  const c = useColors();
  const positions = Array.from({ length: cycles }, () => CYCLE).flat();

  return (
    <View style={{ gap: FILET }} testID="mur-en-chargement">
      {positions.map((position, rang) => (
        <View
          key={rang}
          testID={`chargement-${rang}-${position.format}`}
          style={{ height: position.hauteur, flexDirection: 'row', gap: FILET }}
        >
          {Array.from({ length: Math.max(position.salons, 1) }, (_, colonne) => (
            <View
              key={colonne}
              style={{
                flex: 1,
                backgroundColor: position.salons === 0 ? c['bg.deep'] : c['line.default'],
              }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}
