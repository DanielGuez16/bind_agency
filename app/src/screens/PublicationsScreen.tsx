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
  TextField,
} from '../components';
import { useI18n } from '../i18n';
import { MOTIFS, libelleDuMotif, type MotifDeDecision } from './motifs';

/**
 * La borne du serveur, recopiée.
 *
 * Recopiée plutôt que demandée : une requête pour connaître une limite
 * ajouterait un aller-retour à chaque ouverture d'écran. Le risque est qu'elles
 * divergent ; un test compare les deux valeurs.
 */
export const NOTE_MAXIMUM = 500;
import { Ecran } from './Ecran';
import { PreuveSoumise, SqueletteDePreuve } from './Preuve';
import { useRequete } from './useRequete';

/**
 * Les trois onglets, **dans l'ordre où l'on s'en sert**.
 *
 * Ce qui demande un geste vient d'abord ; ce qui est réglé ensuite ; ce qui
 * n'attend personne en dernier. « Attendues » se trouvait au milieu, entre les
 * deux seuls onglets où le salon a quelque chose à faire ou à vérifier — il
 * fallait le traverser pour aller de l'un à l'autre, alors qu'il ne demande
 * rien.
 *
 * `expected` porte le libellé « en attente de sa publication » et non
 * « attendues » : le premier mot ne disait ni de qui ni de quoi. Ce sont des
 * contreparties engagées dont la publication n'est pas encore arrivée, et le
 * salon n'a rien à y faire — ce qui est précisément la raison de les mettre en
 * dernier.
 */
const ONGLETS: { filtre: FiltreDeContrepartie; libelle: string }[] = [
  { filtre: 'to_review', libelle: 'commerce.filtreAControler' },
  { filtre: 'approved', libelle: 'commerce.filtreApprouvee' },
  { filtre: 'expected', libelle: 'commerce.filtreAttendue' },
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
  const [note, setNote] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);

  async function decider(approuve: boolean) {
    setEnvoi(true);
    setEchec(null);
    try {
      await api.deciderCommerce(ligne.collaboration_id, {
        approuve,
        reason: approuve ? undefined : (motif ?? undefined),
        // **Jamais sans motif.** Le serveur refuse une note seule, jusque dans
        // une contrainte de base ; l'app ne tente pas de l'y faire entrer.
        note: approuve ? undefined : note.trim() || undefined,
      });
      onDecide();
    } catch (erreur) {
      setEchec(messageDErreur(erreur));
    } finally {
      setEnvoi(false);
    }
  }

  // **Un dossier qu'un arbitre a en main ne se décide plus ici.** Le champ
  // était rendu et lu nulle part : deux décisions pouvaient partir sur le même
  // dossier, celle du salon et celle de l'arbitrage.
  const aDecider =
    (ligne.status === 'submitted' || ligne.status === 'under_review') &&
    !ligne.needs_human_review;

  return (
    <View testID={`controle-${ligne.collaboration_id}`} style={{ gap: 6, paddingVertical: 8 }}>
      {/* **Une ligne sans personne se lit comme une panne.** Les trois champs
          de nom sont nuls quand le compte a été anonymisé, et la chaîne de `??`
          finissait sur une chaîne vide : le commerce voyait une contrepartie
          sans créatrice. Elle n'est pas inconnue, elle est partie — et c'est ce
          que la suppression de compte a promis de lui montrer. */}
      <Texte
        variante="type.label"
        couleur={ligne.creator_partie ? 'ink.mute' : 'ink.default'}
        ellipseSurNomPropre={!ligne.creator_partie}
        testID={`createur-${ligne.collaboration_id}`}
      >
        {ligne.creator_partie
          ? t('commerce.creatricePartie')
          : (ligne.creator_handle ?? ligne.creator_first_name ?? '')}
      </Texte>
      <Texte variante="type.caption" couleur="ink.soft">
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
      {/* **Ce que la créatrice a écrit en soumettant.** Lu au même endroit que
          sa preuve : sinon le commerce décide en ayant vu l'image sans avoir
          lu la phrase, ce qui est exactement la situation qu'on répare. */}
      {ligne.derniere_soumission?.note ? (
        <View style={{ gap: 2 }} testID="note-du-createur">
          <Texte variante="type.label" couleur="ink.soft">
            {t('commerce.noteDuCreateur')}
          </Texte>
          <Texte variante="type.caption">{ligne.derniere_soumission.note}</Texte>
        </View>
      ) : null}

      {ligne.dernier_motif ? (
        <Texte variante="type.caption" couleur="status.warning.text" testID="dernier-motif">
          {t('commerce.tentative', { n: ligne.attempts_count })} ·{' '}
          {libelleDuMotif(t, ligne.dernier_motif)}
        </Texte>
      ) : null}

      {ligne.needs_human_review ? (
        <StatusMessage
          level="neutral"
          body={t('commerce.enArbitrage')}
          testID={`en-arbitrage-${ligne.collaboration_id}`}
        />
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

          {/* **Le champ n'apparaît qu'avec un motif choisi.** Une note ne
              voyage jamais seule — le serveur le refuse — et offrir la saisie
              avant le motif ferait écrire une phrase qui serait rejetée. */}
          {motif ? (
            <TextField
              label={t('commerce.noteLabel')}
              placeholder={t('commerce.notePlaceholder')}
              helpText={t('commerce.noteAide')}
              value={note}
              onChangeText={setNote}
              lignes={3}
              maxLength={NOTE_MAXIMUM}
              testID="note"
            />
          ) : null}

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
            <Texte variante="type.caption" couleur="ink.mute" testID="motif-obligatoire">
              {t('commerce.motifObligatoire')}
            </Texte>
          )}
        </View>
      ) : null}
    </View>
  );
}
