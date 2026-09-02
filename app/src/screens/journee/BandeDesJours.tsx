/**
 * La quinzaine du comptoir : quatorze jours, et ce que chacun porte à trancher.
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
 *
 * **L'allongement à quatorze est gratuit, et c'est ce qui le rend possible.**
 * La case portait déjà son compte ; la piste passe de 496 à 1000 points pour
 * 354 visibles sans qu'une seule mesure change — quatorze cases de 64 et treize
 * intervalles de 8. Une bande dont il aurait fallu ouvrir les jours pour savoir
 * ce qu'ils portent aurait doublé le tâtonnement en doublant sa longueur.
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
              // **L'annonce dit ce que la case montre, y compris le zéro et le
              // jour fermé.** Une case qui affiche « 0 » et s'annonce « mardi
              // 15 » laisserait croire à la voix qu'elle n'a pas tout lu.
              accessibilityLabel={
                jour.ouvert
                  ? t('commerce.jourAvecDecisions', {
                      jour: `${nomDeJour(jour.jour, locale)} ${quantieme(jour.jour)}`,
                      count: jour.decisions,
                    })
                  : `${nomDeJour(jour.jour, locale)} ${quantieme(jour.jour)}, ${t('commerce.journeeFerme')}`
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
              {/**
                * **Un zéro plutôt que rien, et c'est un renversement.** Cette
                * ligne posait une espace : « un 0 sur chaque jour calme ferait
                * sept chiffres à lire pour en retenir deux ». À sept cases
                * tenant toutes dans l'écran, l'argument portait — le vide se
                * lisait comme un vide.
                *
                * À quatorze sur une piste qui défile, il s'inverse : **une case
                * vide ne se distingue plus d'une case pas encore arrivée**, et
                * l'on retourne ouvrir le jour pour savoir laquelle des deux on
                * regarde. Le chiffre est ce qui dit que la réponse est là.
                *
                * `ink.mute` et non `ink.faint`, qui est réservé à ce qui ne
                * doit pas être lu — 2,46:1 sur la page. Un chiffre posé pour
                * être lu ne peut pas y vivre. Sur la case choisie, en revanche,
                * `ink.faint` est l'encre claire du fond sombre et rend 7,03:1 :
                * même jeton, l'autre versant.
                */}
              <Texte
                variante="type.dataLabel"
                couleur={
                  choisi
                    ? 'ink.faint'
                    : !jour.ouvert
                      ? 'ink.soft'
                      : porte
                        ? 'brand.700'
                        : 'ink.mute'
                }
                testID={`jour-${jour.jour}-decisions`}
              >
                {jour.ouvert
                  ? formatNumber(jour.decisions, locale)
                  : t('commerce.journeeFerme').toUpperCase()}
              </Texte>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
