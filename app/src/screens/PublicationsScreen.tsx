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
 *
 * ## La composition, et ce qu'elle répare
 *
 * **La file était une pile plate.** Chaque dossier était un `View` à `gap: 6`,
 * sans surface ni séparation : cinq contrôles se suivaient sans que rien dise
 * où l'un finissait et où le suivant commençait. Pire, tout s'y présentait au
 * même poids — le pseudonyme, la preuve, les quatre motifs de refus et les deux
 * boutons — de sorte qu'on ne distinguait pas ce qu'on juge de ce avec quoi on
 * tranche.
 *
 * **La grammaire des surfaces s'applique ici comme aux réservations.** Une
 * carte à ombre demande une décision, une carte à filet informe. Un dossier
 * qu'un arbitre a en main informe, il ne demande plus rien — c'est la même
 * distinction que le champ `needs_human_review` porte déjà dans les données, et
 * elle devient visible.
 *
 * **Une seule décision est ouverte à la fois, et c'est ce qui rend l'orange
 * tenable.** Le bloc de marque est un signe de ponctuation : cinq boutons
 * pleins dans une colonne n'en sont plus un. La file d'arbitrage a tranché la
 * même question et son argument vaut ici — « on parcourt la file, on ouvre un
 * dossier, on tranche, et le suivant est déjà sous les yeux ». La preuve, elle,
 * reste visible sur **tous** les dossiers : c'est ce qu'on vient lire, et la
 * cacher derrière un geste ferait payer un clic pour voir avant de décider.
 *
 * **Le premier dossier à trancher est ouvert d'emblée.** Un écran qui demande
 * un clic avant de rien proposer ne sert que ceux qui savent déjà qu'il y a
 * quelque chose à ouvrir — c'est le défaut que la campagne 2 avait relevé sur
 * l'arbitrage, et il ne se répète pas ici.
 */
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { useApi, type FiltreDeContrepartie, type LigneDeFile } from '../api';
import {
  Button,
  Chip,
  EmptyState,
  Filet,
  RangeeDeChips,
  SegmentedTabs,
  SkeletonLine,
  StatusMessage,
  Texte,
  TextField,
} from '../components';
import { useI18n } from '../i18n';
import { elevationDeCarte, radius, useColors } from '../theme';
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
import { nomDuCreateur } from './nomDuCreateur';
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

/** Un dossier attend la décision du salon, et non celle d'un arbitre. */
export function aTrancherParLeSalon(ligne: LigneDeFile): boolean {
  return (
    (ligne.status === 'submitted' || ligne.status === 'under_review') && !ligne.needs_human_review
  );
}

export function PublicationsScreen({ businessId }: { businessId: string }) {
  const { api } = useApi();
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const [ouvert, setOuvert] = useState<string | null>(null);

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
      {(lignes) => {
        // Le dossier ouvert, et à défaut le premier qui attend le salon. Jamais
        // un dossier qui informe : ouvrir « approuvée » n'ouvre rien.
        const aTrancher = lignes.filter(aTrancherParLeSalon);
        const actif =
          aTrancher.find((ligne) => ligne.collaboration_id === ouvert)?.collaboration_id ??
          aTrancher[0]?.collaboration_id ??
          null;

        return (
          <View style={{ gap: 12 }}>
            {onglets}
            {lignes.map((ligne) => (
              <Controle
                key={ligne.collaboration_id}
                ligne={ligne}
                ouvert={ligne.collaboration_id === actif}
                onOuvrir={() => setOuvert(ligne.collaboration_id)}
                onDecide={requete.recharger}
              />
            ))}
          </View>
        );
      }}
    </Ecran>
  );
}

function Controle({
  ligne,
  ouvert,
  onOuvrir,
  onDecide,
}: {
  ligne: LigneDeFile;
  /** Le dossier qui porte la décision. Un seul à la fois, donc un seul orange. */
  ouvert: boolean;
  onOuvrir: () => void;
  onDecide: () => void;
}) {
  const { api, messageDErreur } = useApi();
  const { t } = useI18n();
  const c = useColors();
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
  const aDecider = aTrancherParLeSalon(ligne);

  return (
    <Pressable
      testID={`controle-${ligne.collaboration_id}`}
      // Pressable seulement là où il y a une décision à déplacer. Une carte qui
      // répond au doigt sans rien ouvrir apprend à ne plus essayer.
      disabled={!aDecider || ouvert}
      onPress={onOuvrir}
      accessibilityRole={aDecider && !ouvert ? 'button' : undefined}
      style={({ pressed }) => ({
        opacity: pressed ? 0.7 : 1,
        gap: 8,
        padding: 16,
        borderRadius: radius['radius.lg'],
        backgroundColor: c['bg.surface'],
        // **La grammaire des surfaces.** Une carte à ombre demande une
        // décision, une carte à filet informe. Un dossier en arbitrage informe :
        // le salon ne doit plus trancher, et sa carte cesse de le lui proposer.
        ...(aDecider
          ? elevationDeCarte()
          : { borderWidth: 1, borderColor: c['line.default'] }),
      })}
    >
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
        {nomDuCreateur(ligne, t)}
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

      {aDecider && ouvert ? (
        <View style={{ gap: 8 }}>
          {/* Ce qui est au-dessus est ce qu'on juge ; ce qui suit est ce avec
              quoi l'on tranche. Sans ce trait, les quatre motifs de refus se
              lisaient comme une donnée du dossier de plus. */}
          <Filet />
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
      ) : aDecider ? (
        // **Le dossier suivant dit qu'il attend**, plutôt que de ne rien dire.
        // Une carte à ombre sans un mot laisserait chercher pourquoi elle est
        // en avant sans rien proposer.
        <Texte variante="type.caption" couleur="brand.700" testID={`a-trancher-${ligne.collaboration_id}`}>
          {t('commerce.ouvrirPourTrancher')}
        </Texte>
      ) : null}
    </Pressable>
  );
}
