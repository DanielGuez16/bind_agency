/**
 * Ce que la file apprend sur nous, au pied de la file.
 *
 * **Chaque « fermer sans faute » est le constat qu'une demande n'a pas été
 * transmise.** L'écran d'arbitrage tranche dossier par dossier ; il ne dit
 * nulle part lesquels de ces constats reviennent. Un motif qui boucle sur
 * beaucoup de dossiers n'appelle pas un arbitrage de plus, il appelle une
 * exigence réécrite — dans le libellé d'un palier, dans la fiche d'un salon, ou
 * dans le vocabulaire fermé lui-même.
 *
 * **Au pied, et non en tête.** La question ne se pose qu'après le travail :
 * mise en haut, elle repousserait la file — c'est-à-dire ce pour quoi on ouvre
 * l'écran — et se lirait vingt fois par jour sans jamais rien déclencher. Elle
 * paraît aussi sur la file vide, qui est le moment où elle se lit le mieux :
 * plus rien à trancher, et la question devient « pourquoi ces trois-là
 * reviennent-elles ».
 *
 * **Deux nombres et aucun verdict.** Le rapport départage un motif difficile
 * d'un motif incompréhensible — « la mention manque » sur cent dossiers dont
 * deux bouclent n'est pas le même problème que sur douze dont dix. Écrire ce
 * verdict à la place du lecteur demanderait un seuil, et un seuil de plus dans
 * un écran est un seuil que personne ne relit. Les deux nombres côte à côte
 * font l'argument, et le rapport se lit sans arithmétique.
 *
 * **L'ordre vient du serveur.** Il trie sur le nombre de dossiers qui bouclent.
 * Retrier sur le rapport ferait remonter un motif vu deux fois, ce qui est du
 * bruit et non un signal.
 */
import { View } from 'react-native';

import type { MotifQuiRevient } from '../../api';
import { DataRow, Texte } from '../../components';
import { useI18n } from '../../i18n';
import { useColors } from '../../theme';
import { libelleDuMotif } from '../motifs';

export function MotifsQuiReviennent({
  motifs,
  testID = 'motifs-qui-reviennent',
}: {
  motifs: readonly MotifQuiRevient[];
  testID?: string;
}) {
  const { t } = useI18n();
  const c = useColors();

  // **Rien à dire plutôt qu'un second état vide.** Aucun motif ne boucle est
  // une bonne nouvelle, et la file vide la dit déjà ; un cadre qui l'annonce
  // ferait deux blocs pour un seul silence.
  if (motifs.length === 0) return null;

  return (
    <View testID={testID} style={{ gap: 4, marginTop: 24 }}>
      <Texte variante="type.section">{t('admin.motifsQuiReviennentTitre')}</Texte>
      <Texte variante="type.caption" couleur="ink.soft">
        {t('admin.motifsQuiReviennentAide')}
      </Texte>
      <View
        style={{
          marginTop: 8,
          borderTopWidth: 1,
          borderTopColor: c['line.default'],
        }}
      >
        {motifs.map((ligne) => (
          <DataRow
            key={ligne.motif}
            testID={`motif-qui-revient-${ligne.motif}`}
            label={libelleDuMotif(t, ligne.motif)}
            value={t('admin.motifBoucle', {
              dossiers: ligne.dossiers,
              touches: ligne.dossiers_touches,
            })}
            chiffre
          />
        ))}
      </View>
    </View>
  );
}
