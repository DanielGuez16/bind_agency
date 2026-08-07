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
  StatusMessage,
  Texte,
} from '../components';
import { useI18n } from '../i18n';
import { Ecran } from './Ecran';
import { useRequete } from './useRequete';

const ONGLETS: { filtre: FiltreDeContrepartie; libelle: string }[] = [
  { filtre: 'to_review', libelle: 'commerce.filtreAControler' },
  { filtre: 'expected', libelle: 'commerce.filtreAttendue' },
  { filtre: 'approved', libelle: 'commerce.filtreApprouvee' },
];

/** La liste fermée. Aucun motif libre : il ne se traduirait pas. */
export const MOTIFS = [
  'commerce.motifMention',
  'commerce.motifLieu',
  'commerce.motifFormat',
  'commerce.motifQualite',
] as const;

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
  const [motif, setMotif] = useState<string | null>(null);
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

      {/* Ce qui était attendu, en face de ce qui a été rendu. */}
      {ligne.required_mention ? (
        <Texte variante="type.caption" couleur="text.secondary" testID="mention-attendue">
          {ligne.required_mention}
        </Texte>
      ) : null}
      {ligne.dernier_motif ? (
        <Texte variante="type.caption" couleur="status.warning" testID="dernier-motif">
          {ligne.dernier_motif}
        </Texte>
      ) : null}

      {echec ? <StatusMessage level="danger" body={echec} testID="echec" /> : null}

      {aDecider ? (
        <View style={{ gap: 8 }}>
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
