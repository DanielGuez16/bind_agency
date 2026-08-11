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
import { Pressable, View } from 'react-native';

import { useApi, type IssueDArbitrage, type LigneDeFile } from '../api';
import {
  Button,
  Chip,
  PALIERS,
  Toolbar,
  DecisionBar,
  DetailPanel,
  EmptyState,
  RangeeDeChips,
  StatusMessage,
  TableHeader,
  TableRow,
  Texte,
  type Colonne,
} from '../components';
import { useI18n } from '../i18n';
import { ECART_DES_COLONNES, useGabarit } from '../shell/gabarit';
import { useColors } from '../theme';
import { Ecran } from './Ecran';
import { PreuveSoumise } from './Preuve';
import { MOTIFS, libelleDuMotif, type MotifDeDecision } from './motifs';
import { useRequete } from './useRequete';

export function ArbitrageScreen() {
  const { api } = useApi();
  const { t } = useI18n();

  const { large } = useGabarit();
  const requete = useRequete<LigneDeFile[]>((signal) => api.fileDArbitrage(signal), {
    estVide: (lignes) => lignes.length === 0,
  });

  return (
    <Ecran
      requete={requete}
      titre={t('admin.arbitrageTitre')}
      nature="reports"
      testID="ecran-arbitrage"
      vide={
        <EmptyState
          title={t('admin.arbitrageTitre')}
          body={t('admin.arbitrageVide')}
          testID="arbitrage-vide"
        />
      }
    >
      {(lignes) =>
        large ? (
          <TableDArbitrage lignes={lignes} onTranche={requete.recharger} />
        ) : (
          <View style={{ gap: 12 }}>
            {lignes.map((ligne) => (
              <Dossier key={ligne.collaboration_id} ligne={ligne} onTranche={requete.recharger} />
            ))}
          </View>
        )
      }
    </Ecran>
  );
}

/** Les colonnes de la file, à largeur fixe. Les chiffres sont à droite. */
const COLONNES: Colonne[] = [
  { cle: 'commerce', label: 'Business', largeur: 168 },
  { cle: 'createur', label: 'Creator', largeur: 128 },
  { cle: 'prestation', label: 'Service', largeur: 176 },
  { cle: 'palier', label: 'Tier', largeur: 76 },
  { cle: 'tentatives', label: 'Attempts', largeur: 84, chiffre: true },
  { cle: 'echeance', label: 'Flagged', largeur: 84, chiffre: true },
];

/**
 * La file en tableau, et le dossier ouvert à droite.
 *
 * **Le tableau occupe sa colonne, le panneau est fixé.** Arbitrer se fait en
 * comparant : on parcourt la file, on ouvre un dossier, on tranche, et le
 * suivant est déjà sous les yeux. Un dossier qui remplacerait la file à chaque
 * ouverture ferait perdre la place à chaque décision.
 *
 * **Les actions de masse se limitent aux approbations**, comme le veut
 * `components.md` §16. Refuser en lot demanderait un motif commun à des
 * dossiers qu'on n'a pas ouverts — c'est exactement la décision qu'il ne faut
 * pas rendre facile.
 */
function TableDArbitrage({
  lignes,
  onTranche,
}: {
  lignes: LigneDeFile[];
  onTranche: () => void;
}) {
  const { t } = useI18n();
  const { api } = useApi();
  const c = useColors();
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [format, setFormat] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  // Filtré à l'écran, sur ce qui est déjà chargé : la file d'arbitrage tient
  // en quelques dizaines de dossiers, et un aller-retour serveur pour trois
  // chips coûterait plus que le tri lui-même.
  const visibles = format ? lignes.filter((l) => l.required_format === format) : lignes;

  /**
   * Le dossier ouvert, et à défaut le premier de la file.
   *
   * **Il ne s'ouvrait sur rien.** L'écran montrait alors une ligne de tableau
   * et deux tiers de vide — ce que la campagne 2 a relevé. Arbitrer se fait en
   * comparant : le premier dossier doit être là quand on arrive, sinon le
   * panneau ne sert qu'à ceux qui savent déjà qu'il existe.
   */
  const dossier =
    visibles.find((ligne) => ligne.collaboration_id === ouvert) ?? visibles[0] ?? null;

  async function approuverLaSelection() {
    setEnCours(true);
    try {
      // Une par une : l'API tranche un dossier à la fois, et une route de lot
      // rendrait « approuver dix » aussi peu coûteux qu'« approuver un ».
      for (const identifiant of selection) {
        await api.arbitrer(identifiant, { issue: 'approve' });
      }
      setSelection([]);
      onTranche();
    } finally {
      setEnCours(false);
    }
  }

  return (
    <View style={{ flexDirection: 'row', gap: ECART_DES_COLONNES }}>
      <View style={{ flex: 1, gap: 8 }}>
        {/* **La barre d'outils est toujours là** (campagne 2). Elle
            n'apparaissait qu'une fois une case cochée : à l'arrivée, l'écran
            n'avait qu'un en-tête, une ligne, et rien qui dise combien de
            dossiers attendent ni comment les trier. Les actions de masse, en
            revanche, restent absentes tant que rien n'est coché — un bouton
            grisé n'est pas une information. */}
        <Toolbar
          testID="barre-d-outils"
          compteurSelection={
            selection.length > 0 ? t('admin.selection', { count: selection.length }) : undefined
          }
          actionsDeMasse={
            selection.length > 0 ? (
              <Button
                label={t('admin.approuverLaSelection')}
                size="sm"
                fullWidth={false}
                loading={enCours}
                onPress={approuverLaSelection}
                testID="approuver-la-selection"
              />
            ) : undefined
          }
        >
          <Chip
            label={
              visibles.length === 1
                ? t('admin.dossiersUnSeul')
                : t('admin.dossiersEnAttente', { count: visibles.length })
            }
            testID="compteur-de-file"
          />
          {/* Un filtre par format. Trois dossiers ne se trient pas, trente
              si — et c'est la file d'un jour chargé. */}
          <Chip
            label={t('admin.filtreTous')}
            onPress={() => setFormat(null)}
            selected={format === null}
            testID="filtre-tous"
          />
          {PALIERS.map((palier) => (
            <Chip
              key={palier}
              label={palier.toUpperCase()}
              onPress={() => setFormat(palier)}
              selected={format === palier}
              testID={`filtre-${palier}`}
            />
          ))}
        </Toolbar>

        <TableHeader colonnes={COLONNES} testID="entete-de-file" />
        {visibles.map((ligne) => (
          <View
            key={ligne.collaboration_id}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
          >
            {/* Cocher n'ouvre pas, et ouvrir ne coche pas. Les deux gestes
                mènent à des décisions différentes : l'un approuve en lot sans
                regarder, l'autre ouvre pour regarder. */}
            <Pressable
              testID={`cocher-${ligne.collaboration_id}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selection.includes(ligne.collaboration_id) }}
              hitSlop={8}
              onPress={() =>
                setSelection((precedente) =>
                  precedente.includes(ligne.collaboration_id)
                    ? precedente.filter((cle) => cle !== ligne.collaboration_id)
                    : [...precedente, ligne.collaboration_id],
                )
              }
              style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                borderWidth: 1,
                borderColor: selection.includes(ligne.collaboration_id)
                  ? c['accent.default']
                  : c['border.default'],
                backgroundColor: selection.includes(ligne.collaboration_id)
                  ? c['accent.default']
                  : 'transparent',
              }}
            />
            <View style={{ flex: 1 }}>
          <TableRow
            colonnes={COLONNES}
            actif={ligne.collaboration_id === ouvert}
            onPress={() => setOuvert(ligne.collaboration_id)}
            testID={`ligne-${ligne.collaboration_id}`}
            valeurs={{
              commerce: ligne.business_name,
              createur: ligne.creator_handle ?? '—',
              prestation: ligne.item_name,
              palier: ligne.required_format.toUpperCase(),
              tentatives: String(ligne.attempts_count),
              echeance: quandRestant(ligne.deadline_at),
            }}
          />
            </View>
          </View>
        ))}
      </View>

      {dossier ? (
        <DetailPanel
          titre={dossier.business_name}
          identifiant={`collab_${dossier.collaboration_id.slice(0, 8)}`}
          testID="dossier-ouvert"
        >
          <View style={{ padding: 12 }}>
            <Dossier ligne={dossier} onTranche={onTranche} />
          </View>
        </DetailPanel>
      ) : null}
    </View>
  );
}

/** « 2 d », « 6 h ». Ce qui reste avant l'échéance, jamais une date brute. */
function quandRestant(echeance: string): string {
  const heures = Math.round((new Date(echeance).getTime() - Date.now()) / 3_600_000);
  if (heures <= 0) return '0 h';
  return heures >= 48 ? `${Math.round(heures / 24)} d` : `${heures} h`;
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
