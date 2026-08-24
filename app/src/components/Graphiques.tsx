/**
 * Les deux seuls graphiques du produit.
 *
 * **Amendement à `components.md` §17**, qui les excluait tous. Ce qui est
 * autorisé : des barres, et une évolution dans le temps. Ce qui ne l'est pas,
 * et qui n'est pas ici : dégradé, ombre, troisième dimension, légende
 * flottante, courbe lissée, axe secondaire. Une couleur par série.
 *
 * **Rien n'est dessiné en SVG.** Une barre est une `View` avec une hauteur ;
 * une ligne de repère est une bordure. Sortir une bibliothèque de graphiques
 * pour quinze rectangles ferait entrer un moteur de rendu, ses thèmes et ses
 * animations dans un produit qui a déjà les siens — et aucun de ses réglages
 * par défaut ne respecterait les règles ci-dessus.
 *
 * **La hauteur est la seule variable.** Pas de largeur qui varie, pas
 * d'espacement qui se resserre : deux barres de même valeur doivent se lire
 * identiques où qu'elles soient dans la série.
 */
import { View } from 'react-native';

import { radius, spacing, tierTokens, useColors } from '../theme';
import { Texte } from './Texte';
import { TierBadge, type Palier } from './TierBadge';

/** La hauteur du cadre des barres verticales. Assez pour lire un écart de 1. */
const HAUTEUR = 132;

/** Trois lignes de repère, comme la passation le fixe. Ni deux, ni cinq. */
const REPERES = 3;

export type BarreVerticale = { etiquette: string; valeur: number };

/**
 * Une évolution dans le temps : douze semaines, une barre par semaine.
 *
 * **Les semaines vides sont des barres à zéro, pas des trous.** Une série qui
 * saute les semaines sans publication resserre l'axe et fait croire à une
 * régularité qui n'existe pas — c'est la déformation la plus courante d'un
 * graphique de barres, et la seule que celui-ci pouvait commettre.
 */
export function BarresParPeriode({
  series,
  titre,
  soustitre,
  testID,
}: {
  series: BarreVerticale[];
  titre: string;
  soustitre?: string;
  testID?: string;
}) {
  const c = useColors();
  // Le maximum affiché, jamais zéro : diviser par lui donnerait des hauteurs
  // infinies sur une série entièrement vide.
  const sommet = Math.max(1, ...series.map((point) => point.valeur));

  return (
    <View style={{ gap: spacing['space.3'] }} testID={testID}>
      <View style={{ gap: 2 }}>
        <Texte variante="type.label">{titre}</Texte>
        {soustitre ? (
          <Texte variante="type.caption" couleur="ink.soft">
            {soustitre}
          </Texte>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', gap: spacing['space.2'] }}>
        {/* L'échelle, en chiffres. Un graphique dont on ne peut pas lire les
            valeurs oblige à survoler, ce qu'un doigt ne fait pas. */}
        <View style={{ height: HAUTEUR, justifyContent: 'space-between' }}>
          {Array.from({ length: REPERES }, (_, rang) => (
            <Texte key={rang} variante="type.mono" couleur="ink.mute" style={{ fontSize: 11 }}>
              {Math.round((sommet * (REPERES - 1 - rang)) / (REPERES - 1))}
            </Texte>
          ))}
        </View>

        <View style={{ flex: 1 }}>
          <View style={{ height: HAUTEUR, justifyContent: 'space-between' }}>
            {Array.from({ length: REPERES }, (_, rang) => (
              <View
                key={rang}
                style={{ borderBottomWidth: 1, borderBottomColor: c['line.default'] }}
              />
            ))}
          </View>

          {/* Les barres se posent par-dessus les repères, alignées en bas. */}
          <View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: HAUTEUR,
              flexDirection: 'row',
              alignItems: 'flex-end',
              gap: 4,
            }}
          >
            {series.map((point) => (
              <View
                key={point.etiquette}
                testID={`barre-${point.etiquette}`}
                accessibilityLabel={`${point.etiquette} : ${point.valeur}`}
                style={{
                  flex: 1,
                  // Une barre à zéro garde un trait : elle dit « rien », ce
                  // qui n'est pas la même chose que « pas de donnée ».
                  height: Math.max(1, (point.valeur / sommet) * HAUTEUR),
                  backgroundColor: c['brand.700'],
                  borderTopLeftRadius: radius['radius.sm'],
                  borderTopRightRadius: radius['radius.sm'],
                }}
              />
            ))}
          </View>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 4, paddingLeft: 28 }}>
        {series.map((point) => (
          <Texte
            key={point.etiquette}
            variante="type.mono"
            couleur="ink.mute"
            align="center"
            style={{ flex: 1, fontSize: 11 }}
          >
            {point.etiquette}
          </Texte>
        ))}
      </View>
    </View>
  );
}

export type BarreDePalier = { palier: Palier; valeur: number };

/**
 * La répartition par palier : trois barres horizontales, un seul remplissage.
 *
 * **La raison d'hier est remplacée, et le code qui la portait était mort.** Ces
 * barres empruntaient les teintes de palier — « la couleur y porte déjà un sens
 * ailleurs » — mais les trois jeux de teintes de palier ont été supprimés au
 * passage à l'ambre. `tier.story` ne résout plus rien : la barre recevait
 * `backgroundColor: undefined` et **ne se voyait pas du tout**. Aucun test n'a
 * bougé, parce qu'aucun ne regardait la couleur.
 *
 * **Et même vivante, la teinte se lisait à l'envers.** Sur une barre, la
 * densité encode l'ampleur ; la matière du `TierBadge` va du contour clair au
 * plein, si bien que le palier le plus fourni était le plus vide. Un seul
 * remplissage, donc, et la matière descend dans le badge posé à côté du
 * chiffre, où elle encode le palier et rien d'autre.
 */
export function BarresParPalier({
  series,
  titre,
  testID,
}: {
  series: BarreDePalier[];
  titre: string;
  testID?: string;
}) {
  const c = useColors();
  const sommet = Math.max(1, ...series.map((ligne) => ligne.valeur));

  return (
    <View style={{ gap: spacing['space.3'] }} testID={testID}>
      <Texte variante="type.label">{titre}</Texte>

      {series.map((ligne) => (
        <View
          key={ligne.palier}
          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing['space.3'] }}
        >
          <View style={{ width: 76 }}>
            <TierBadge tier={ligne.palier} size="sm" testID={`badge-${ligne.palier}`} />
          </View>
          {/* La piste sous la barre : sans elle, une barre à 3 % se lit comme
              une barre absente, et « presque rien » n'est pas « rien ». */}
          <View
            style={{
              flex: 1,
              height: 10,
              justifyContent: 'center',
              backgroundColor: c['bg.inset'],
              borderRadius: radius['radius.pill'],
              overflow: 'hidden',
            }}
          >
            <View
              testID={`barre-${ligne.palier}`}
              accessibilityLabel={`${ligne.palier} : ${ligne.valeur}`}
              style={{
                width: `${Math.max(1, (ligne.valeur / sommet) * 100)}%`,
                height: 10,
                backgroundColor: c['brand.500'],
                borderRadius: radius['radius.pill'],
              }}
            />
          </View>
          <Texte variante="type.mono" style={{ width: 36 }} align="right">
            {ligne.valeur}
          </Texte>
        </View>
      ))}
    </View>
  );
}

/** Les trois paliers, dans l'ordre des jetons. Jamais dans celui de la base. */
export const PALIERS: Palier[] = Object.keys(tierTokens) as Palier[];
