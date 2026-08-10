/**
 * 13a · Publications reçues, 13b · contrôle.
 *
 * **Deux actions seulement : approuver, ou redemander avec un motif.** Il
 * n'existe aucun rejet définitif côté commerce — un refus rouvre avec une
 * nouvelle échéance. Offrir un bouton « rejeter » ferait fermer des dossiers
 * qu'on ne saurait plus rouvrir.
 *
 * **Le motif vient d'une liste fermée et il est obligatoire.** Une créatrice à
 * qui l'on dit « non conforme » sans dire pourquoi refera la même chose. Le
 * bouton est **retiré** tant qu'aucun motif n'est choisi.
 *
 * **Le filtre est facultatif.** Sans lui la liste rend tout, `unfulfilled`
 * compris, qu'aucun des trois onglets ne couvre.
 */
import { useState } from 'react';
import { View } from 'react-native';

import { useApi, type FiltreDeContrepartie, type LigneDeFile } from '../api';
import {
  Button,
  Chip,
  EmptyState,
  RangeeDeChips,
  SegmentedTabs,
  SkeletonLine,
  StatusMessage,
  Texte,
} from '../components';
import { useI18n } from '../i18n';
import { MOTIFS, libelleDuMotif, type MotifDeDecision } from './motifs';
import { Ecran } from './Ecran';
import { PreuveSoumise, SqueletteDePreuve } from './Preuve';
import { useRequete } from './useRequete';

const ONGLETS: { filtre: FiltreDeContrepartie; libelle: string }[] = [
  { filtre: 'to_review', libelle: 'commerce.filtreAControler' },
  { filtre: 'expected', libelle: 'commerce.filtreAttendue' },
  { filtre: 'approved', libelle: 'commerce.filtreApprouvee' },
];

export function PublicationsScreen({ businessId }: { businessId: string }) {
  const { api } = useApi();
  const { t } = useI18n();
  const [index, setIndex] = useState(0);

  const requete = useRequete<LigneDeFile[]>(
    (signal) => api.contrepartiesDuCommerce(businessId, ONGLETS[index].filtre, signal),
    { estVide: (lignes) => lignes.length === 0, dependances: [businessId, index] },
  );

  const onglets = (
    <SegmentedTabs
      testID="onglets"
      index={index}
      onChange={setIndex}
      items={ONGLETS.map((onglet) => ({ label: t(onglet.libelle) }))}
    />
  );

  return (
    <Ecran
      requete={requete}
      titre={t('commerce.publicationsTitre')}
      testID="ecran-publications"
      // **Le squelette ressemble à ce qui arrive.** Celui par défaut annonçait
      // trois cartes à grande image ; l'écran rendait des lignes de texte. Un
      // squelette qui promet autre chose fait attendre ce qui ne viendra pas,
      // et donne l'impression que l'écran a échoué à charger.
      squelette={
        <View style={{ gap: 12 }}>
          {[0, 1].map((rang) => (
            <View key={rang} style={{ gap: 6 }}>
              <SkeletonLine width={140} />
              <SkeletonLine width={200} />
              <SqueletteDePreuve />
            </View>
          ))}
        </View>
      }
      vide={
        <View style={{ gap: 8 }}>
          {onglets}
          <EmptyState
            title={t(ONGLETS[index].libelle)}
            body={t('commerce.publicationsVide')}
            testID="publications-vide"
          />
        </View>
      }
    >
      {(lignes) => (
        <View style={{ gap: 8 }}>
          {onglets}
          {lignes.map((ligne) => (
            <Controle key={ligne.collaboration_id} ligne={ligne} onDecide={requete.recharger} />
          ))}
        </View>
      )}
    </Ecran>
  );
}

function Controle({ ligne, onDecide }: { ligne: LigneDeFile; onDecide: () => void }) {
  const { api, messageDErreur } = useApi();
  const { t } = useI18n();
  const [motif, setMotif] = useState<MotifDeDecision | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);

  async function decider(approuve: boolean) {
    setEnvoi(true);
    setEchec(null);
    try {
      await api.deciderCommerce(ligne.collaboration_id, {
        approuve,
        reason: approuve ? undefined : (motif ?? undefined),
      });
      onDecide();
    } catch (erreur) {
      setEchec(messageDErreur(erreur));
    } finally {
      setEnvoi(false);
    }
  }

  const aDecider = ligne.status === 'submitted' || ligne.status === 'under_review';

  return (
    <View testID={`controle-${ligne.collaboration_id}`} style={{ gap: 6, paddingVertical: 8 }}>
      <Texte variante="type.label" ellipseSurNomPropre>
        {ligne.creator_handle ?? ligne.creator_first_name ?? ''}
      </Texte>
      <Texte variante="type.caption" couleur="text.secondary">
        {ligne.item_name} · {t('commerce.tentative', { n: ligne.attempts_count + 1 })}
      </Texte>

      {/* **Ce qu'on demande d'approuver.** L'écran ne le montrait pas : le
          commerce voyait un pseudonyme, une prestation, quatre motifs de refus
          et un bouton, sans rien de ce qui avait été publié. */}
      {aDecider || ligne.derniere_soumission ? (
        <PreuveSoumise
          soumission={ligne.derniere_soumission}
          mentionAttendue={ligne.required_mention}
          lieuAttendu={ligne.required_geotag}
        />
      ) : null}
      {ligne.dernier_motif ? (
        <Texte variante="type.caption" couleur="status.warning" testID="dernier-motif">
          {t('commerce.tentative', { n: ligne.attempts_count })} ·{' '}
          {libelleDuMotif(t, ligne.dernier_motif)}
        </Texte>
      ) : null}

      {echec ? <StatusMessage level="danger" body={echec} testID="echec" /> : null}

      {aDecider ? (
        <View style={{ gap: 8 }}>
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

          <Button
            label={t('commerce.approuver')}
            loading={envoi}
            onPress={() => decider(true)}
            testID="approuver"
          />
          {/* Retiré tant qu'aucun motif n'est choisi. Le griser demanderait de
              deviner ce qui le débloque. */}
          {motif ? (
            <Button
              label={t('commerce.redemander')}
              variant="secondary"
              loading={envoi}
              onPress={() => decider(false)}
              testID="redemander"
            />
          ) : (
            <Texte variante="type.caption" couleur="text.muted" testID="motif-obligatoire">
              {t('commerce.motifObligatoire')}
            </Texte>
          )}
        </View>
      ) : null}
    </View>
  );
}
