/**
 * État vide.
 *
 * **Jamais un cul-de-sac.** Chaque issue proposée annonce son gain chiffré —
 * « Élargir à 5 km · 9 salons ». Une issue sans chiffre demande de tenter pour
 * voir, et personne ne tente deux fois.
 *
 * Côté commerce, la formule d'encouragement est remplacée par des repères
 * chiffrés sur sept jours : un commerçant ne veut pas être rassuré, il veut
 * savoir si son catalogue est le problème.
 *
 * **v0.6 : un bloc typographique, pas un titre sur du blanc.** Le cercle de 54
 * a disparu — il ne disait rien et occupait la place du titre. Sur grand écran
 * le titre monte à 52/56 : un état vide y est le seul contenu de la page, et
 * lui laisser la taille d'un titre de section le fait passer pour un incident
 * de chargement. Les chiffres, eux, se lisent en mono 44 : ce sont eux qu'on
 * vient chercher quand rien ne s'est passé.
 */
import { View } from 'react-native';

import { radius, useTheme } from '../theme';
import { useGabarit } from '../shell/gabarit';
import { Button, type ButtonProps } from './Button';
import { Texte } from './Texte';

export type EmptyStateProps = {
  title: string;
  body: string;
  /** Une à trois. Chacune annonce son gain chiffré dans son libellé. */
  actions?: ButtonProps[];
  /** Repères chiffrés, côté commerce. Remplacent toute formule creuse. */
  reperes?: { label: string; valeur: string }[];
  /**
   * Les chiffres qu'on vient chercher quand rien ne s'est passé — « 18 réglés
   * en 7 jours », « 4 h de délai médian ». En mono 44 : plus gros que le
   * corps, parce qu'ils sont l'information et non son commentaire.
   */
  chiffres?: { valeur: string; label: string }[];
  testID?: string;
};

export function EmptyState({
  title,
  body,
  actions = [],
  reperes,
  chiffres,
  testID,
}: EmptyStateProps) {
  const { role, color: c } = useTheme();
  const { large } = useGabarit();
  const centre = role === 'creator';

  return (
    <View
      testID={testID}
      style={{
        gap: 12,
        alignItems: centre ? 'center' : 'flex-start',
        paddingVertical: 24,
      }}
    >
      <Texte
        variante={large ? 'type.screenTitle' : 'type.screenTitle'}
        align={centre ? 'center' : 'left'}
        // Sur grand écran, l'état vide est tout le contenu de la page : lui
        // laisser une taille de titre de section le fait passer pour un
        // chargement qui n'a pas abouti.

        testID="etat-vide-titre"
      >
        {title}
      </Texte>
      <Texte
        couleur="ink.soft"
        align={centre ? 'center' : 'left'}
        style={large ? { fontSize: 18, lineHeight: 26 } : undefined}
      >
        {body}
      </Texte>

      {chiffres?.length ? (
        <View
          testID="etat-vide-chiffres"
          style={{ flexDirection: 'row', gap: 32, paddingVertical: 8, flexWrap: 'wrap' }}
        >
          {chiffres.map((chiffre) => (
            <View key={chiffre.label} style={{ gap: 2 }}>
              <Texte variante="type.figure">
                {chiffre.valeur}
              </Texte>
              <Texte variante="type.caption" couleur="ink.soft">
                {chiffre.label}
              </Texte>
            </View>
          ))}
        </View>
      ) : null}

      {reperes?.length ? (
        <View
          style={{
            alignSelf: 'stretch',
            borderRadius: radius['radius.lg'],
            borderWidth: 1,
            borderColor: c['line.default'],
          }}
        >
          {reperes.map((repere, i) => (
            <View
              key={repere.label}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingHorizontal: 12,
                paddingVertical: 10,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: c['line.default'],
              }}
            >
              <Texte variante="type.caption" couleur="ink.soft">
                {repere.label}
              </Texte>
              <Texte variante="type.data">{repere.valeur}</Texte>
            </View>
          ))}
        </View>
      ) : null}

      {actions.length ? (
        <View style={{ alignSelf: 'stretch', gap: 8 }}>
          {actions.slice(0, 3).map((action) => (
            <Button key={action.label} {...action} />
          ))}
        </View>
      ) : null}
    </View>
  );
}
