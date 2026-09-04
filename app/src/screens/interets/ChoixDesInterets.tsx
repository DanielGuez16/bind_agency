/**
 * La rangée de chips par laquelle on choisit des centres d'intérêt.
 *
 * **Le même composant des deux côtés du marché**, et c'est ce qui garantit
 * que le salon filtre sur exactement ce que la créatrice a pu déclarer. Deux
 * rangées écrites séparément divergeraient au premier ajout de valeur.
 *
 * **La borne est optionnelle, parce que les deux gestes diffèrent.** La
 * créatrice déclare ce qu'elle couvre, et trois suffisent — au delà elle
 * n'est plus filtrable. Le salon, lui, cherche : cocher cinq intérêts est une
 * requête large, pas une déclaration, et la borner n'aurait rien à protéger.
 */
import { View } from 'react-native';

import type { CentreDInteret } from '../../api';
import { Chip, RangeeDeChips, Texte } from '../../components';
import { useI18n } from '../../i18n';

import { CENTRES_D_INTERET, basculer } from './liste';

export function ChoixDesInterets({
  choisis,
  onChange,
  maximum,
  aide,
  testID,
}: {
  choisis: readonly CentreDInteret[];
  onChange: (suivants: CentreDInteret[]) => void;
  /** Absent : autant qu'on veut. Présent : les chips éteintes cessent de répondre. */
  maximum?: number;
  /** La ligne qui explique la borne, écrite avant qu'on bute dedans. */
  aide?: string;
  testID?: string;
}) {
  const { t } = useI18n();
  const plein = maximum !== undefined && choisis.length >= maximum;

  return (
    <View style={{ gap: 8 }} testID={testID}>
      {aide ? (
        <Texte variante="type.caption" couleur="ink.soft">
          {aide}
        </Texte>
      ) : null}
      <RangeeDeChips>
        {CENTRES_D_INTERET.map((valeur) => {
          const actif = choisis.includes(valeur);
          return (
            <Chip
              key={valeur}
              label={t(`interets.${valeur}`)}
              selected={actif}
              // Éteinte et la borne atteinte : la chip ne répond plus. Elle
              // reste visible plutôt que retirée — une liste qui rétrécit
              // pendant qu'on choisit fait perdre ce qu'on cherchait.
              onPress={
                actif || !plein ? () => onChange(basculer(choisis, valeur)) : undefined
              }
              testID={`interet-${valeur}`}
            />
          );
        })}
      </RangeeDeChips>
    </View>
  );
}
