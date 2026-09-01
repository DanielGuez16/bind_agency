/**
 * La semaine du comptoir : sept jours, et ce que chacun porte à trancher.
 *
 * **La même forme que la bande de créneaux du créateur, et pour la même
 * raison.** Des onglets à trois ou quatre entrées ne tiennent pas une semaine,
 * et une liste continue mélange des jours qui n'appellent pas les mêmes gestes.
 *
 * Ce qu'une bande donne et qu'une liste ne donnerait pas : **un jour sans
 * décision se voit sans être ouvert**. C'est une information au même titre
 * qu'une décision — savoir qu'il n'y a rien vendredi vaut d'être su sans
 * appuyer sur vendredi.
 *
 * **64 points par jour**, comme chez le créateur : à 46 — la largeur d'une
 * grille de sept colonnes sur 390 — une case tient un quantième et rien
 * d'autre, et l'on choisirait en tâtonnant.
 */
import { Pressable, ScrollView, View } from 'react-native';

import { Texte } from '../../components';
import { etatAccessible } from '../../components/etatAccessible';
import { formatNumber, moisDeLaDate, nomDeJour, quantieme } from '../../format';
import { useI18n } from '../../i18n';
import { radius, useColors } from '../../theme';
import type { JourDeDecisions } from '../../api';

/** La largeur d'un jour, relevée sur la planche. */
export const LARGEUR_DU_JOUR = 64;

export function BandeDesJours({
  jours,
  selection,
  onChoisir,
  testID = 'bande-des-jours',
}: {
  jours: JourDeDecisions[];
  selection: string | null;
  onChoisir: (jour: string) => void;
  testID?: string;
}) {
  const { t, locale } = useI18n();
  const c = useColors();

  // Deux mois quand la semaine chevauche — « AUGUST · SEPTEMBER » plutôt qu'un
  // seul mois qui serait faux la moitié du temps.
  const mois = [...new Set(jours.map((jour) => moisDeLaDate(jour.jour, locale)))].join(' · ');

  return (
    <View style={{ gap: 8 }}>
      <Texte variante="type.dataLabel" couleur="ink.mute" testID="mois-de-la-bande">
        {mois.toUpperCase()}
      </Texte>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8 }}
        testID={testID}
      >
        {jours.map((jour) => {
          const choisi = jour.jour === selection;
          const porte = jour.decisions > 0;
          return (
            <Pressable
              key={jour.jour}
              testID={`jour-${jour.jour}`}
              accessibilityRole="button"
              {...etatAccessible({ selected: choisi })}
              // **Le compte entre dans l'annonce.** Le nom et le quantième
              // seuls diraient « mardi 1 » à qui n'a que la voix, c'est-à-dire
              // exactement ce que la bande sert à ne plus avoir à ouvrir.
              accessibilityLabel={
                porte
                  ? t('commerce.jourAvecDecisions', {
                      jour: `${nomDeJour(jour.jour, locale)} ${quantieme(jour.jour)}`,
                      count: jour.decisions,
                    })
                  : `${nomDeJour(jour.jour, locale)} ${quantieme(jour.jour)}`
              }
              onPress={() => onChoisir(jour.jour)}
              style={({ pressed }) => ({
                width: LARGEUR_DU_JOUR,
                borderRadius: radius['radius.md'],
                paddingVertical: 10,
                alignItems: 'center',
                gap: 3,
                backgroundColor: choisi
                  ? c['bg.inverse']
                  : jour.ouvert
                    ? c['bg.surface']
                    : c['bg.inset'],
                // Le jour fermé n'a pas de filet : c'est ce qui le distingue
                // d'un jour ouvert non choisi, sans le griser.
                borderWidth: !choisi && jour.ouvert ? 1 : 0,
                borderColor: c['line.default'],
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Texte
                variante="type.dataLabel"
                couleur={choisi ? 'ink.faint' : jour.ouvert ? 'ink.mute' : 'ink.soft'}
              >
                {nomDeJour(jour.jour, locale).toUpperCase()}
              </Texte>
              <Texte
                variante="type.section"
                couleur={choisi ? 'ink.onDark' : jour.ouvert ? 'ink.default' : 'ink.soft'}
              >
                {formatNumber(quantieme(jour.jour), locale)}
              </Texte>
              {/* **Rien plutôt qu'un zéro.** Un « 0 » sur chaque jour calme
                  ferait sept chiffres à lire pour en retenir deux, et la bande
                  perdrait ce qui la rend lisible d'un coup d'œil. La case reste
                  à la même hauteur : c'est un vide, pas une case plus courte. */}
              <Texte
                variante="type.dataLabel"
                couleur={choisi ? 'ink.faint' : 'brand.700'}
                testID={`jour-${jour.jour}-decisions`}
              >
                {porte ? formatNumber(jour.decisions, locale) : ' '}
              </Texte>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
