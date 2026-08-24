/**
 * La bande de quatorze jours, et son issue vers toutes les dates.
 *
 * **Un jour sans place se sélectionne et répond.** Le sélecteur précédent le
 * rendait `disabled` : l'appui ne faisait rien, et refuser sans rien dire était
 * l'autre façon de faire disparaître le jour. Il s'ouvre maintenant sur ce
 * qu'il a à dire, et sur les deux jours ouverts les plus proches.
 *
 * **64 points par jour, et c'est ce qui porte le compte.** À 46 — la largeur
 * d'une grille de sept colonnes sur 390 — une case tient un quantième et rien
 * d'autre. On choisirait alors en appuyant sur chaque jour pour savoir ce qu'il
 * contient, c'est-à-dire en tâtonnant.
 */
import { Pressable, ScrollView, View } from 'react-native';

import { Texte } from '../../components';
import { formatNumber, moisDeLaDate, nomDeJour, quantieme } from '../../format';
import { useI18n } from '../../i18n';
import { radius, useColors } from '../../theme';
import type { JourDeDisponibilite } from '../../api';
import { etatDuJour } from './bande';

/** La largeur d'un jour, relevée sur la planche. */
export const LARGEUR_DU_JOUR = 64;

export function BandeDeJours({
  jours,
  selection,
  onChoisir,
  onToutesLesDates,
  testID = 'bande-des-jours',
}: {
  jours: JourDeDisponibilite[];
  selection: string | null;
  onChoisir: (cle: string) => void;
  /** L'issue vers la feuille mensuelle. Absente : la ligne ne se rend pas. */
  onToutesLesDates?: () => void;
  testID?: string;
}) {
  const { t, locale } = useI18n();
  const c = useColors();

  // Le mois de la bande. Deux quand elle chevauche : « AUGUST · SEPTEMBER »
  // plutôt qu'un seul mois qui serait faux la moitié du temps.
  const mois = [
    ...new Set(
      jours.map((jour) => moisDeLaDate(jour.jour, locale)),
    ),
  ].join(' · ');

  return (
    <View style={{ gap: 8 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <Texte variante="type.dataLabel" couleur="ink.mute" testID="mois-de-la-bande">
          {mois.toUpperCase()}
        </Texte>
        {onToutesLesDates ? (
          <Texte
            variante="type.label"
            couleur="brand.700"
            onPress={onToutesLesDates}
            testID="toutes-les-dates"
          >
            {t('parcours.creneauxToutesLesDates').toUpperCase()}
          </Texte>
        ) : null}
      </View>

      {/* **Elle défile, et c'est la seule de l'application.** Quatorze jours à
          64 points font 1008 : aucune largeur de téléphone ne les tient. Le
          défilement horizontal est admis ici parce que rien n'y est caché — les
          cinq premiers jours suffisent au cas quotidien, et ce qui suit est du
          même genre, pas des options qu'on ne soupçonnerait pas. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8 }}
        testID={testID}
      >
        {jours.map((jour) => {
          const choisi = jour.jour === selection;
          const etat = etatDuJour(jour);
          const ouvert = etat === 'ouvert';
          return (
            <Pressable
              key={jour.jour}
              testID={`jour-${jour.jour}`}
              accessibilityRole="button"
              accessibilityState={{ selected: choisi }}
              accessibilityLabel={`${nomDeJour(jour.jour, locale)} ${quantieme(jour.jour)}`}
              onPress={() => onChoisir(jour.jour)}
              style={({ pressed }) => ({
                width: LARGEUR_DU_JOUR,
                borderRadius: radius['radius.md'],
                paddingVertical: 10,
                alignItems: 'center',
                gap: 3,
                backgroundColor: choisi
                  ? c['bg.inverse']
                  : ouvert
                    ? c['bg.surface']
                    : c['bg.inset'],
                // Le jour sans place n'a pas de filet : c'est ce qui le
                // distingue d'un jour ouvert non choisi, sans le griser.
                borderWidth: !choisi && ouvert ? 1 : 0,
                borderColor: c['line.default'],
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Texte
                variante="type.dataLabel"
                couleur={choisi ? 'ink.faint' : ouvert ? 'ink.mute' : 'ink.soft'}
              >
                {nomDeJour(jour.jour, locale).toUpperCase()}
              </Texte>
              <Texte
                variante="type.section"
                couleur={choisi ? 'ink.onDark' : ouvert ? 'ink.default' : 'ink.soft'}
              >
                {formatNumber(quantieme(jour.jour), locale)}
              </Texte>
              <Texte
                variante="type.dataLabel"
                couleur={choisi ? 'ink.faint' : ouvert ? 'brand.700' : 'ink.soft'}
                testID={`jour-${jour.jour}-etat`}
              >
                {/* **Le compte, ou le mot de l'état.** Trois mots distincts et
                    non un seul : « fermé », « complet » et « écoulé » ne sont
                    pas interchangeables, et c'est la moitié de ce que la
                    planche corrige. */}
                {ouvert
                  ? formatNumber(jour.creneaux_libres, locale)
                  : t(`parcours.creneauxEtatCourt.${etat}`).toUpperCase()}
              </Texte>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
