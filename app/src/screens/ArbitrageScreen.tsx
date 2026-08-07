/**
 * 16a · File des contreparties en revue humaine, et arbitrage.
 *
 * **L'arbitre tranche dans le vocabulaire du commerce, plus une issue qui n'est
 * qu'à lui.** Approuver et redemander disent la même chose des deux côtés ; lui
 * donner un second langage obligerait chacun à traduire. Clore en non honoré
 * n'appartient qu'à lui : c'est la seule décision du produit qui ne se rouvre
 * pas.
 *
 * **Sans cet écran, un dossier sorti de la boucle y reste pour toujours.** À la
 * troisième tentative, le drapeau se lève et la mécanique s'arrête sans
 * trancher : si personne ne peut trancher ensuite, le créateur attend et le
 * commerce attend.
 *
 * **Un motif est obligatoire hors approbation**, et il vient de la liste
 * fermée du commerce — le même vocabulaire, encore.
 */
import { useState } from 'react';
import { View } from 'react-native';

import { useApi, type IssueDArbitrage, type LigneDeFile } from '../api';
import {
  Chip,
  DecisionBar,
  EmptyState,
  RangeeDeChips,
  StatusMessage,
  Texte,
} from '../components';
import { useI18n } from '../i18n';
import { Ecran } from './Ecran';
import { MOTIFS } from './PublicationsScreen';
import { useRequete } from './useRequete';

export function ArbitrageScreen() {
  const { api } = useApi();
  const { t } = useI18n();

  const requete = useRequete<LigneDeFile[]>((signal) => api.fileDArbitrage(signal), {
    estVide: (lignes) => lignes.length === 0,
  });

  return (
    <Ecran
      requete={requete}
      titre={t('admin.arbitrageTitre')}
      testID="ecran-arbitrage"
      vide={
        <EmptyState
          title={t('admin.arbitrageTitre')}
          body={t('admin.arbitrageVide')}
          testID="arbitrage-vide"
        />
      }
    >
      {(lignes) => (
        <View style={{ gap: 12 }}>
          {lignes.map((ligne) => (
            <Dossier key={ligne.collaboration_id} ligne={ligne} onTranche={requete.recharger} />
          ))}
        </View>
      )}
    </Ecran>
  );
}

function Dossier({ ligne, onTranche }: { ligne: LigneDeFile; onTranche: () => void }) {
  const { api, messageDErreur } = useApi();
  const { t } = useI18n();
  const [motif, setMotif] = useState<string | null>(null);
  const [echec, setEchec] = useState<string | null>(null);

  async function arbitrer(issue: IssueDArbitrage) {
    setEchec(null);
    try {
      await api.arbitrer(ligne.collaboration_id, {
        issue,
        reason: issue === 'approve' ? undefined : (motif ? t(motif) : undefined),
      });
      onTranche();
    } catch (erreur) {
      setEchec(messageDErreur(erreur));
    }
  }

  return (
    <View testID={`dossier-${ligne.collaboration_id}`} style={{ gap: 6 }}>
      {/* L'arbitre voit exactement ce que le commerce voyait : une vue plus
          pauvre l'obligerait à décider avec moins d'information que celui dont
          il révise la décision. */}
      <Texte variante="type.label" ellipseSurNomPropre>
        {ligne.business_name}
      </Texte>
      <Texte variante="type.caption" couleur="text.secondary">
        {ligne.creator_handle ?? ''} · {ligne.item_name} ·{' '}
        {t('commerce.tentative', { n: ligne.attempts_count })}
      </Texte>
      {ligne.dernier_motif ? (
        <Texte variante="type.caption" couleur="status.warning" testID="dernier-motif">
          {ligne.dernier_motif}
        </Texte>
      ) : null}

      <RangeeDeChips>
        {MOTIFS.map((cle) => (
          <Chip
            key={cle}
            label={t(cle)}
            selected={motif === cle}
            onPress={() => setMotif(motif === cle ? null : cle)}
          />
        ))}
      </RangeeDeChips>

      {echec ? <StatusMessage level="danger" body={echec} testID="echec" /> : null}

      {/* `DecisionBar` retire d'elle-même les décisions qui exigent un motif
          tant qu'il manque. L'approbation reste toujours offerte. */}
      <DecisionBar
        testID={`decisions-${ligne.collaboration_id}`}
        motif={motif ?? undefined}
        decisions={[
          {
            cle: 'approve',
            label: t('admin.issueApprove'),
            touche: 'A',
            approbation: true,
            onPress: () => void arbitrer('approve'),
          },
          {
            cle: 'resubmit',
            label: t('admin.issueResubmit'),
            touche: 'R',
            onPress: () => void arbitrer('resubmit'),
          },
          {
            cle: 'unfulfilled',
            label: t('admin.issueUnfulfilled'),
            touche: 'N',
            onPress: () => void arbitrer('unfulfilled'),
          },
        ]}
      />
    </View>
  );
}
