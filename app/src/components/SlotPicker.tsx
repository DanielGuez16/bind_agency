/**
 * Choix du jour et du créneau.
 *
 * **Un créneau pris reste visible.** Non pressable, mais montré : c'est ce qui
 * donne le rythme du salon. Une grille où ne restent que les trous laisse
 * croire à un commerce vide, ou à un bug.
 *
 * Même chose pour un jour sans disponibilité : il s'affiche en creux, il ne
 * disparaît pas de la rangée.
 */
import { Pressable, View } from 'react-native';

import { radius, useColors } from '../theme';
import { Texte } from './Texte';

export type Jour = {
  cle: string;
  /** Déjà traduit et abrégé par l'appelant : « lun. ». */
  jourCourt: string;
  /** Le quantième, en mono. */
  numero: string;
  disponible: boolean;
};

export function DayPicker({
  jours,
  selection,
  onChange,
  testID,
}: {
  jours: Jour[];
  selection: string;
  onChange: (cle: string) => void;
  testID?: string;
}) {
  const c = useColors();

  return (
    <View testID={testID} style={{ flexDirection: 'row', gap: 6 }}>
      {jours.map((jour) => {
        const choisi = jour.cle === selection;
        return (
          <Pressable
            key={jour.cle}
            accessibilityRole="button"
            accessibilityState={{ selected: choisi, disabled: !jour.disponible }}
            accessibilityLabel={`${jour.jourCourt} ${jour.numero}`}
            disabled={!jour.disponible}
            onPress={() => onChange(jour.cle)}
            style={({ pressed }) => ({
              flex: 1,
              height: 60,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              borderRadius: radius['radius.none'],
              borderWidth: 1,
              borderColor: choisi ? c['bg.inverse'] : c['line.default'],
              backgroundColor: choisi
                ? c['bg.inverse']
                : jour.disponible
                  ? 'transparent'
                  : c['bg.sunken'],
          opacity: pressed ? 0.7 : 1,
        })}
          >
            <Texte
              variante="type.caption"
              couleur={choisi ? 'ink.onDark' : jour.disponible ? 'ink.soft' : 'ink.faint'}
            >
              {jour.jourCourt}
            </Texte>
            <Texte
              variante="type.mono"
              couleur={choisi ? 'ink.onDark' : jour.disponible ? 'ink.default' : 'ink.faint'}
            >
              {jour.numero}
            </Texte>
          </Pressable>
        );
      })}
    </View>
  );
}

export type Creneau = {
  cle: string;
  /** Déjà mis en forme sur 24 h par l'appelant : « 14:30 ». */
  heure: string;
  pris: boolean;
};

export function SlotPicker({
  creneaux,
  selection,
  onChange,
  testID,
}: {
  creneaux: Creneau[];
  selection?: string;
  onChange: (cle: string) => void;
  testID?: string;
}) {
  const c = useColors();

  return (
    <View testID={testID} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {creneaux.map((creneau) => {
        const choisi = creneau.cle === selection;
        return (
          <Pressable
            key={creneau.cle}
            accessibilityRole="button"
            accessibilityState={{ selected: choisi, disabled: creneau.pris }}
            accessibilityLabel={creneau.heure}
            // Pris : visible, mais pas pressable. Le masquer effacerait le
            // rythme du salon.
            disabled={creneau.pris}
            onPress={() => onChange(creneau.cle)}
            style={({ pressed }) => ({
              minHeight: 44,
              paddingVertical: 11,
              paddingHorizontal: 16,
              borderRadius: radius['radius.none'],
              borderWidth: 1,
              borderColor: choisi ? c['brand.700'] : c['line.default'],
              backgroundColor: choisi
                ? c['brand.50']
                : creneau.pris
                  ? c['bg.sunken']
                  : 'transparent',
          opacity: pressed ? 0.7 : 1,
        })}
          >
            <Texte
              variante="type.mono"
              couleur={creneau.pris ? 'ink.faint' : 'ink.default'}
              style={{ fontSize: 15 }}
            >
              {creneau.heure}
            </Texte>
          </Pressable>
        );
      })}
    </View>
  );
}
