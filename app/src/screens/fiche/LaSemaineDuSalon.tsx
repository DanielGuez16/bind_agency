/**
 * Les sept jours du salon, et ce qu'ils ne disent pas.
 *
 * **L'étiquette du jour ne suffisait pas.** « Ouvert jusqu'à 19 h » répond à
 * « puis-je y aller maintenant » ; elle ne répond pas à « quand puis-je y
 * aller », qui est la question qu'on se pose devant une prestation qu'on
 * réserve pour plus tard. Et elle disparaît dès qu'aucun créneau du jour ne
 * prouve l'ouverture — donc précisément les jours où l'on planifie.
 *
 * **Hebdomadaire, et l'écran le dit.** Le serveur sert les règles, pas les
 * exceptions : un jour férié y paraît ouvert. L'étiquette du jour pouvait se
 * taire faute de preuve ; une grille, elle, affirme sept lignes. Le dire coûte
 * une phrase et évite d'envoyer quelqu'un devant une porte close.
 *
 * **Repliée par défaut.** Sept lignes en tête de fiche pousseraient les
 * prestations sous la ligne de flottaison, pour une information qu'on ne
 * consulte pas à chaque visite.
 */
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import type { PlageHebdomadaire } from '../../api';
import { Icone, Texte } from '../../components';
import { useI18n } from '../../i18n';
import { useColors } from '../../theme';
import { plagesDuJour, semaineComplete } from '../horaires';

/** Les clés des sept jours, dans l'ordre de `weekday` — lundi vaut 0. */
const NOMS = [
  'composition.lundi',
  'composition.mardi',
  'composition.mercredi',
  'composition.jeudi',
  'composition.vendredi',
  'composition.samedi',
  'composition.dimanche',
] as const;

export function LaSemaineDuSalon({
  horaires,
  testID = 'la-semaine-du-salon',
}: {
  horaires: PlageHebdomadaire[];
  testID?: string;
}) {
  const { t } = useI18n();
  const c = useColors();
  const [ouverte, setOuverte] = useState(false);

  // **Rien plutôt qu'une grille de sept « fermé ».** Un salon qui n'a composé
  // aucune plage n'est pas fermé toute la semaine : il n'a rien renseigné, et
  // l'écrire fermé serait faux.
  if (horaires.length === 0) return null;

  const semaine = semaineComplete(horaires);

  return (
    <View testID={testID} style={{ gap: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(ouverte ? 'parcours.ficheSemaineFermer' : 'parcours.ficheSemaineOuvrir')}
        onPress={() => setOuverte((avant) => !avant)}
        hitSlop={8}
        testID={`${testID}-bascule`}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Icone nom="horloge" couleur="ink.soft" taille={16} />
        <Texte variante="type.body" couleur="ink.soft" style={{ flex: 1 }}>
          {t('parcours.ficheSemaineTitre')}
        </Texte>
        <Icone nom={ouverte ? 'monte' : 'descend'} couleur="ink.soft" taille={16} />
      </Pressable>

      {ouverte ? (
        <View style={{ gap: 4 }}>
          {semaine.map(({ jour, plages }) => {
            const texte = plagesDuJour(plages);
            return (
              <View
                key={jour}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
                testID={`${testID}-jour-${jour}`}
              >
                <Texte variante="type.caption" couleur="ink.soft" style={{ width: 44 }}>
                  {t(NOMS[jour])}
                </Texte>
                {/* **Un jour sans plage se dit « fermé », il ne se tait pas.**
                    Une ligne vide se lirait comme une donnée manquante. */}
                <Texte
                  variante="type.caption"
                  couleur={texte ? 'ink.default' : 'ink.mute'}
                  style={{ flex: 1 }}
                >
                  {texte ?? t('composition.ferme')}
                </Texte>
              </View>
            );
          })}
          {/* **Ce que la grille ne sait pas.** Le serveur sert les règles de la
              semaine, jamais les fermetures ponctuelles : sans cette ligne, un
              jour férié s'y lirait ouvert. */}
          <Texte
            variante="type.caption"
            couleur="ink.mute"
            style={{ marginTop: 4, borderTopWidth: 1, borderTopColor: c['line.default'], paddingTop: 6 }}
            testID={`${testID}-reserve`}
          >
            {t('parcours.ficheSemaineReserve')}
          </Texte>
        </View>
      ) : null}
    </View>
  );
}
