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
 *
 * **L'arbitre voit ce que le commerce voit, et davantage.** Il lui manquait
 * tout ce sur quoi porte la décision : la publication d'origine, l'aperçu
 * archivé, et les demandes précédentes. Il tranchait sur un pseudonyme, un nom
 * de prestation et une phrase — pour la décision la plus lourde du produit, et
 * la seule qui ne se rouvre pas.
 *
 * **L'historique, et non le seul dernier motif.** Trois fois le même reproche
 * et trois reproches différents n'appellent pas la même décision : c'est la
 * répétition qui justifie l'escalade, et elle n'était nulle part.
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
import { PreuveSoumise } from './Preuve';
import { MOTIFS, libelleDuMotif, type MotifDeDecision } from './motifs';
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
  const [motif, setMotif] = useState<MotifDeDecision | null>(null);
  const [echec, setEchec] = useState<string | null>(null);

  async function arbitrer(issue: IssueDArbitrage) {
    setEchec(null);
    try {
      await api.arbitrer(ligne.collaboration_id, {
        issue,
        // Le code, jamais le libellé traduit : c'est ce que le journal garde,
        // et c'est ce qui permettra de le relire dans une autre langue.
        reason: issue === 'approve' ? undefined : (motif ?? undefined),
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

      {/* **Ce sur quoi porte la décision.** La publication d'origine et
          l'aperçu archivé, exactement comme le commerce les voit : une vue plus
          pauvre obligerait l'arbitre à réviser une décision avec moins
          d'information que celui qui l'a prise. */}
      <PreuveSoumise
        soumission={ligne.derniere_soumission}
        mentionAttendue={ligne.required_mention}
        lieuAttendu={ligne.required_geotag}
      />

      {/* **Les demandes précédentes, dans l'ordre.** C'est l'historique qui
          justifie l'escalade. */}
      {ligne.tentatives.length > 0 ? (
        <View style={{ gap: 2 }} testID="historique">
          {ligne.tentatives.map((tentative, rang) => (
            <Texte
              key={`${tentative.demandee_le}-${rang}`}
              variante="type.caption"
              couleur="status.warning"
              testID={rang === ligne.tentatives.length - 1 ? 'dernier-motif' : undefined}
            >
              {t('commerce.tentative', { n: rang + 1 })} · {libelleDuMotif(t, tentative.motif)}
              {tentative.par === 'admin' ? ` · ${t('admin.arbitrageParLAdministration')}` : ''}
            </Texte>
          ))}
        </View>
      ) : null}

      <RangeeDeChips>
        {MOTIFS.map((cle) => (
          <Chip
            key={cle}
            label={libelleDuMotif(t, cle)}
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
