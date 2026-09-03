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
 *
 * **Et au pied, ce que la file apprend sur nous.** L'écran tranchait dossier
 * par dossier sans jamais dire lesquels de ces constats reviennent. Un motif
 * qui boucle sur beaucoup de dossiers n'appelle pas un arbitrage de plus, il
 * appelle une exigence réécrite. Au pied et non en tête : la question ne se
 * pose qu'après le travail, et en haut elle repousserait la file.
 *
 * **« Contrepartie » est le mot du produit, pas celui de l'écran.** Le titre
 * disait « Counterparts under review », et un administrateur qui ouvre cet
 * onglet ne cherche pas une contrepartie : il cherche une publication qu'un
 * salon et une créatrice n'ont pas su trancher entre eux. Le mot juste est
 * celui de la chose examinée — une publication —, et l'état est « en revue ».
 *
 * Le mot « arbitrage » reste dans le code et dans l'onglet : c'est le geste,
 * et il est exact. Ce qui changeait est le nom de ce qu'on regarde. */
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { useApi, type IssueDArbitrage, type LigneDeFile, type MotifQuiRevient } from '../api';
import {
  Button,
  Chip,
  DecisionBar,
  DetailPanel,
  EmptyState,
  Icone,
  PALIERS,
  motDuPalier,
  RangeeDeChips,
  SkeletonLignes,
  StatusMessage,
  TableHeader,
  TableRow,
  Texte,
  TextField,
  Toolbar,
  type Colonne,
} from '../components';
import { formatDate } from '../format';
import { useI18n } from '../i18n';
import { ECART_DES_COLONNES, useGabarit } from '../shell/gabarit';
import { radius, tierTokens, useColors, size } from '../theme';
import { Ecran } from './Ecran';
import { PreuveSoumise } from './Preuve';
import { MOTIFS, libelleDApprobation, libelleDuMotif, type MotifDeDecision } from './motifs';
import { NOTE_MAXIMUM } from './PublicationsScreen';
import { formeDuMalentendu, motDeLaForme } from './arbitrage/formeDuMalentendu';
import { MotifsQuiReviennent } from './arbitrage/MotifsQuiReviennent';
import { useRequete } from './useRequete';
import { nomDuCreateur } from './nomDuCreateur';
import { etatAccessible } from '../components/etatAccessible';

/** Ce que l'écran charge : la file, et ce qu'elle apprend sur nous. */
type Arbitrage = { lignes: LigneDeFile[]; motifs: MotifQuiRevient[] };

export function ArbitrageScreen() {
  const { api } = useApi();
  const { t } = useI18n();

  const { large } = useGabarit();
  /**
   * Les deux requêtes ensemble, et l'agrégat ne peut pas cacher la file.
   *
   * **Ensemble**, parce que deux `useRequete` feraient deux cycles d'attente
   * sur un écran qui n'en montre qu'un : le second squelette apparaîtrait sous
   * une file déjà lisible, ce que la règle des 400 ms existe pour éviter.
   *
   * **Et l'agrégat est rattrapé.** C'est le pied de page d'un écran dont le
   * seul rôle est de débloquer des dossiers arrêtés : si `motifs-qui-reviennent`
   * tombe, la file doit s'afficher quand même. Sans ce `catch`, un agrégat en
   * panne mettrait l'écran entier en erreur et laisserait quinze dossiers
   * bloqués pour une statistique.
   */
  const requete = useRequete<Arbitrage>(
    async (signal) => {
      const [lignes, motifs] = await Promise.all([
        api.fileDArbitrage(signal),
        api.motifsQuiReviennent(signal).catch(() => [] as MotifQuiRevient[]),
      ]);
      return { lignes, motifs };
    },
    { estVide: ({ lignes }) => lignes.length === 0 },
  );

  // Sur la file vide, l'état vide vient de l'écran et non des données : le pied
  // s'y compose donc à la main, avec ce que la requête a rapporté.
  const motifs = requete.etat === 'pret' ? requete.donnees.motifs : [];

  return (
    <Ecran
      requete={requete}
      titre={t('admin.arbitrageTitre')}
      nature="reports"
      squelette={<SkeletonLignes combien={5} testID="squelette-arbitrage" />}
      testID="ecran-arbitrage"
      vide={
        <View style={{ gap: 12 }}>
          <EmptyState
            title={t('admin.arbitrageTitre')}
            body={t('admin.arbitrageVide')}
            testID="arbitrage-vide"
          />
          {/* **Plus rien à trancher est le moment où la question se lit le
              mieux.** Trois motifs qui bouclent sur une file vide disent que le
              travail n'est pas fini, il a seulement changé d'endroit. */}
          <MotifsQuiReviennent motifs={motifs} />
        </View>
      }
    >
      {({ lignes, motifs: quiReviennent }) => (
        <View>
          {large ? (
            <TableDArbitrage lignes={lignes} onTranche={requete.recharger} />
          ) : (
            <View style={{ gap: 12 }}>
              {lignes.map((ligne) => (
                <Dossier key={ligne.collaboration_id} ligne={ligne} onTranche={requete.recharger} />
              ))}
            </View>
          )}
          <MotifsQuiReviennent motifs={quiReviennent} />
        </View>
      )}
    </Ecran>
  );
}

/** Les colonnes de la file, à largeur fixe. Les chiffres sont à droite. */
const COLONNES: Colonne[] = [
  { cle: 'commerce', label: 'Business', largeur: 168 },
  { cle: 'createur', label: 'Creator', largeur: 128 },
  { cle: 'prestation', label: 'Service', largeur: 176 },
  { cle: 'palier', label: 'Tier', largeur: 76 },
  // **« 3 · same » et non « 3 ».** Le nombre seul mettait deux dossiers très
  // différents sur la même ligne : trois refus pour le même motif disent que la
  // demande n'a jamais été comprise, trois motifs différents disent l'inverse.
  // Même nombre de pixels, décision opposée.
  { cle: 'tentatives', label: 'Reasons', largeur: 104 },
  { cle: 'echeance', label: 'Flagged', largeur: 84, chiffre: true },
];

/**
 * Ce que la colonne « Reasons » écrit : « 3 · same », « 3 · mixed », ou le
 * nombre seul.
 *
 * **Le mot n'apparaît qu'à partir de deux reproches.** Un motif unique n'est pas
 * « le même motif répété », et écrire « 1 · same » ferait lire une répétition là
 * où il n'y a qu'un premier refus.
 */
function colonneDesMotifs(ligne: LigneDeFile, t: (cle: string) => string): string {
  const forme = formeDuMalentendu(ligne);
  const mot = motDeLaForme(forme);
  if (mot === null) return String(forme.compte || ligne.attempts_count);
  return `${forme.compte} · ${t(mot === 'meme' ? 'admin.formeMeme' : 'admin.formeMelange')}`;
}

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
  const { t, locale } = useI18n();
  const { api } = useApi();
  const c = useColors();
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [format, setFormat] = useState<string | null>(null);
  /**
   * La forme retenue, ou toutes.
   *
   * **Deux axes indépendants, et non un interrupteur à côté d'une liste.**
   * « Même motif » était un booléen posé près des formats : les deux se
   * cumulaient sans que rien ne le dise, et « Tous » ne remettait à zéro que le
   * format — l'interrupteur restait allumé sous une étiquette qui annonçait
   * l'inverse.
   *
   * Chaque axe a donc son « toutes », et chacun est exclusif chez lui. Ils se
   * combinent toujours, mais cette fois l'écran le montre.
   *
   * **Et « motifs différents » apparaît**, que `motDeLaForme` calculait depuis
   * toujours sans qu'aucun filtre l'offre. C'est pourtant la décision opposée :
   * trois refus pour le même motif disent que la demande n'a jamais été
   * comprise, trois motifs différents disent l'inverse. L'arbitre ne pouvait
   * isoler que la première moitié.
   */
  const [forme, setForme] = useState<'meme' | 'melange' | null>(null);
  const [enCours, setEnCours] = useState(false);

  // Filtré à l'écran, sur ce qui est déjà chargé : la file d'arbitrage tient
  // en quelques dizaines de dossiers, et un aller-retour serveur pour trois
  // chips coûterait plus que le tri lui-même.
  const visibles = lignes.filter((ligne) => {
    if (format && ligne.required_format !== format) return false;
    // **Le filtre porte sur la forme, pas sur le nombre.** C'est la seule
    // distinction qui change l'arbitre à convoquer, et la file d'un jour chargé
    // mélange les deux sans qu'on puisse les séparer de l'œil.
    if (forme && motDeLaForme(formeDuMalentendu(ligne)) !== forme) return false;
    return true;
  });

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
          {/* **Premier axe : le format.** Trois dossiers ne se trient pas,
              trente si — et c'est la file d'un jour chargé. */}
          <Chip
            label={t('admin.filtreTousFormats')}
            onPress={() => setFormat(null)}
            selected={format === null}
            testID="filtre-tous"
          />
          {/* **Le mot du jeton, pas la clé en capitales.** `palier.toUpperCase()`
              rendait « STORY », « POST », « REEL » — juste en anglais par
              coïncidence, puisque le libellé anglais est la clé en majuscules.
              En espagnol il écrivait « POST » là où le jeton dit
              « PUBLICACIÓN », et rien ne pouvait le dire : la chaîne n'est pas
              dans les catalogues, elle est dans `produit.json`. */}
          {PALIERS.map((palier) => (
            <Chip
              key={palier}
              label={motDuPalier(palier, locale)}
              onPress={() => setFormat(palier)}
              selected={format === palier}
              testID={`filtre-${palier}`}
            />
          ))}

          {/* **Second axe : la forme du malentendu.** Une file de trente
              dossiers mêle ceux que le produit a ratés et ceux où la créatrice
              n'a pas suivi : ce ne sont pas les mêmes décisions, et les séparer
              d'un appui vaut mieux que de les lire un par un. */}
          <Chip
            label={t('admin.filtreToutesFormes')}
            onPress={() => setForme(null)}
            selected={forme === null}
            testID="filtre-toutes-formes"
          />
          <Chip
            label={t('admin.filtreMemeMotif')}
            onPress={() => setForme('meme')}
            selected={forme === 'meme'}
            testID="filtre-meme-motif"
          />
          <Chip
            label={t('admin.filtreMotifsDifferents')}
            onPress={() => setForme('melange')}
            selected={forme === 'melange'}
            testID="filtre-motifs-differents"
          />
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
              {...etatAccessible({ checked: selection.includes(ligne.collaboration_id) })}
              hitSlop={8}
              onPress={() =>
                setSelection((precedente) =>
                  precedente.includes(ligne.collaboration_id)
                    ? precedente.filter((cle) => cle !== ligne.collaboration_id)
                    : [...precedente, ligne.collaboration_id],
                )
              }
              style={({ pressed }) => ({
                width: 18,
                height: 18,
                borderRadius: radius['radius.lg'],
                borderWidth: 1,
                // **En encre, comme la rangée.** Une case cochée par ligne est
                // de l'ornement répété, pas de la navigation : quinze lignes
                // sélectionnées faisaient quinze marques d'ambre sur un écran
                // où l'ambre ne doit dire qu'une chose, où l'on est.
                borderColor: selection.includes(ligne.collaboration_id)
                  ? c['line.solo']
                  : c['line.default'],
                backgroundColor: selection.includes(ligne.collaboration_id)
                  ? c['ink.default']
                  : 'transparent',
          opacity: pressed ? 0.7 : 1,
        })}
            />
            <View style={{ flex: 1 }}>
          <TableRow
            colonnes={COLONNES}
            actif={ligne.collaboration_id === ouvert}
            onPress={() => setOuvert(ligne.collaboration_id)}
            testID={`ligne-${ligne.collaboration_id}`}
            valeurs={{
              commerce: ligne.business_name,
              createur: nomDuCreateur(ligne, t, '—'),
              prestation: ligne.item_name,
              palier: ligne.required_format.toUpperCase(),
              tentatives: colonneDesMotifs(ligne, t),
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

/**
 * L'attendu et le constaté, face à face.
 *
 * **Le défaut de campagne était double.** Le bouton ne disait pas ce qu'il
 * approuvait — corrigé plus bas — et l'écran ne montrait nulle part *ce qui
 * cloche*. L'arbitre lisait une exigence d'un côté, un motif de l'autre, et
 * faisait le rapprochement de tête, vingt fois d'affilée.
 *
 * **Le constaté vient du reproche, pas d'une lecture automatique, et l'écran le
 * dit.** Aux niveaux 2 et 3, la preuve ne porte ni auteur, ni format, ni
 * mention : rien qui puisse être comparé à l'exigence. Écrire « conforme » en
 * face d'une ligne que personne n'a vérifiée serait une affirmation que le
 * produit ne peut pas tenir devant un salon qui conteste. Seule la ligne
 * désignée par le dernier motif porte un constat, et c'est un constat humain.
 *
 * L'échéance fait exception : elle se compare vraiment, des deux côtés, à tous
 * les niveaux. C'est la seule ligne où le constaté est une mesure.
 */
function AttenduEtConstate({
  ligne,
  dernierMotif,
}: {
  ligne: LigneDeFile;
  dernierMotif: string | null;
}) {
  const { t, locale } = useI18n();

  const soumis = ligne.derniere_soumission;
  const lignes: { cle: string; attendu: string; manque: boolean }[] = [];

  if (ligne.required_mention) {
    lignes.push({
      cle: 'mention',
      attendu: t('commerce.preuveMention', { mention: ligne.required_mention }),
      manque: dernierMotif === 'missing_mention',
    });
  }
  if (ligne.required_geotag) {
    lignes.push({
      cle: 'lieu',
      attendu: t('commerce.preuveLieu'),
      manque: dernierMotif === 'missing_location',
    });
  }
  // Le mot du palier, celui que le badge écrit et que le commerce a choisi.
  // Une seconde liste de noms de format divergerait au premier ajout.
  const motDuFormat =
    tierTokens[ligne.required_format].label[locale] ??
    tierTokens[ligne.required_format].label.en;
  lignes.push({
    cle: 'format',
    attendu: t('admin.attenduFormat', { format: motDuFormat }),
    manque: dernierMotif === 'wrong_format',
  });

  if (lignes.length === 0 && !soumis) return null;

  return (
    <View style={{ gap: 4 }} testID="attendu-et-constate">
      <Texte variante="type.label" couleur="ink.soft">
        {t('admin.attenduEtConstate')}
      </Texte>
      {lignes.map((l) => (
        <View
          key={l.cle}
          testID={`exigence-${l.cle}`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
        >
          {/* Le glyphe est le marqueur, pas la couleur : dans ce système
              l'avertissement n'a plus de teinte, et une ligne « manquante »
              reconnue à sa seule nuance se perdrait en niveaux de gris. */}
          {l.manque ? <Icone nom="alerte" couleur="status.warning.rule" taille={16} /> : null}
          <Texte
            variante="type.caption"
            couleur={l.manque ? 'ink.default' : 'ink.soft'}
            style={{ flex: 1 }}
          >
            {l.attendu}
          </Texte>
          {l.manque ? (
            <Texte variante="type.label" couleur="ink.default" testID={`manque-${l.cle}`}>
              {t('admin.constateManquant')}
            </Texte>
          ) : null}
        </View>
      ))}

      {/* L'échéance, la seule ligne qui se mesure vraiment des deux côtés. */}
      {soumis ? (
        <View style={{ flexDirection: 'row', gap: 8 }} testID="exigence-echeance">
          <Texte variante="type.caption" couleur="ink.soft" style={{ flex: 1 }}>
            {t('admin.echeanceAttendue', {
              date: formatDate(ligne.deadline_at, locale, 'UTC'),
            })}
          </Texte>
          <Texte variante="type.caption" couleur="ink.soft">
            {t('admin.echeanceConstatee', {
              date: formatDate(soumis.platform_published_at ?? soumis.submitted_at, locale, 'UTC'),
            })}
          </Texte>
        </View>
      ) : null}

      {/* Ce que le constaté vaut. Une phrase, une fois, et jamais un « conforme »
          en face d'une ligne que personne n'a vérifiée. */}
      {soumis && soumis.capture_method !== 'api' ? (
        <Texte variante="type.caption" couleur="ink.mute" testID="constat-humain">
          {t('admin.constatHumain')}
        </Texte>
      ) : null}
    </View>
  );
}

/**
 * Une issue, rattachée à son dossier.
 *
 * Le créateur, la prestation, le commerce : les trois choses qui distinguent
 * deux dossiers de la file. Le nom du commerce vient en dernier — c'est le
 * titre du panneau, donc le plus redondant des trois.
 */
export function surCeDossier(
  t: (cle: string, valeurs?: Record<string, string | number>) => string,
  ligne: LigneDeFile,
  issue: string,
): string {
  return t('admin.issueSurDossier', {
    issue,
    createur: nomDuCreateur(ligne, t, '—'),
    prestation: ligne.item_name,
    commerce: ligne.business_name,
  });
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
  const [note, setNote] = useState('');
  const [echec, setEchec] = useState<string | null>(null);
  const [notesOuvertes, setNotesOuvertes] = useState(false);

  const forme = formeDuMalentendu(ligne);

  // **Le reproche qui a mis ce dossier là.** C'est lui que l'approbation
  // accepte, et c'est donc lui que le bouton doit nommer.
  const dernierMotif = ligne.tentatives.at(-1)?.motif ?? null;
  const approbation = libelleDApprobation(t, dernierMotif);

  /**
   * Fermer sans faute : le produit n'a pas su transmettre la demande.
   *
   * **Elle ne demande pas de motif.** Les trois autres décisions en exigent un
   * parce qu'elles reprochent quelque chose ; celle-ci ne reproche rien, et
   * demander de nommer un tort avant de dire qu'il n'y en a pas serait la
   * contredire.
   *
   * **Et elle ne touche pas au score, sans même écrire un événement neutre.**
   * C'était ma demande, et la session des routes l'a refusée avec un meilleur
   * argument : un score nul est ignoré comme condition de palier, alors qu'un
   * score qui existe est comparé à un seuil. Un événement de poids nul ne
   * bougerait pas le score — il le ferait **exister**, et une créatrice dont
   * ce serait le premier événement perdrait un palier pour un dossier qu'on
   * ferme précisément sans lui rien reprocher.
   */
  const clotureSansFaute = {
    cle: 'close_no_fault' as const,
    label: t('admin.issueCloreSansFaute'),
    accessibilityLabel: surCeDossier(t, ligne, t('admin.issueCloreSansFaute')),
    touche: 'C',
    // Comme l'approbation : offerte sans motif, parce qu'elle n'en reproche pas.
    approbation: true,
    onPress: () => void arbitrer('close_no_fault'),
  };

  async function arbitrer(issue: IssueDArbitrage) {
    setEchec(null);
    try {
      await api.arbitrer(ligne.collaboration_id, {
        issue,
        // Le code, jamais le libellé traduit : c'est ce que le journal garde,
        // et c'est ce qui permettra de le relire dans une autre langue.
        reason: issue === 'approve' ? undefined : (motif ?? undefined),
        // La note l'accompagne et ne le remplace pas. Le serveur refuse une
        // note seule, jusque dans une contrainte de base.
        note: issue === 'approve' ? undefined : note.trim() || undefined,
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
      <Texte variante="type.caption" couleur="ink.soft">
        {nomDuCreateur(ligne, t)} · {ligne.item_name} ·{' '}
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

      <AttenduEtConstate ligne={ligne} dernierMotif={dernierMotif} />

      {/* **Les trois motifs alignés, et rien de plus par défaut.** C'est une
          phrase de six mots au lieu d'un journal, et elle suffit à savoir de
          quel côté est l'incompréhension : trois fois le même motif disent que
          la demande n'a jamais été comprise, trois motifs différents disent
          l'inverse. */}
      {forme.compte > 0 ? (
        <View style={{ gap: 6 }} testID="historique">
          {forme.compte > 1 ? (
            <Texte variante="type.bodyStrong" testID="forme-du-malentendu">
              {/* **La phrase compte la suite, la colonne compte les
                  reproches.** Elle affirme une répétition : elle doit donc
                  dire combien de fois **de suite**, pas combien de refus en
                  tout. « Format, mention, mention, mention » fait quatre
                  reproches et trois fois la même chose, et écrire quatre ici
                  serait faux. */}
              {forme.meme
                ? t('admin.formeMemeChose', { n: ligne.repetitions_du_dernier_motif })
                : t('admin.formeChosesDifferentes', { n: forme.compte })}
            </Texte>
          ) : null}

          <View style={{ gap: 2 }}>
            {ligne.tentatives.map((tentative, rang) => (
              <View
                key={`${tentative.demandee_le}-${rang}`}
                style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}
              >
                <Texte variante="type.data" couleur="ink.mute">
                  {rang + 1}
                </Texte>
                {/* **Un motif passé n'avertit pas, il raconte.** Il portait
                    `status.warning.text`, sans glyphe — donc rien, la teinte de
                    l'avertissement étant neutre : ce qui le distingue est son
                    glyphe, et un glyphe sur chaque ligne d'un historique serait
                    du bruit. */}
                <Texte
                  variante="type.caption"
                  couleur="ink.default"
                  style={{ flex: 1 }}
                  testID={rang === ligne.tentatives.length - 1 ? 'dernier-motif' : undefined}
                >
                  {libelleDuMotif(t, tentative.motif)}
                  {tentative.par === 'admin' ? ` · ${t('admin.arbitrageParLAdministration')}` : ''}
                </Texte>
              </View>
            ))}
          </View>

          {/* **Les notes existent, et elles sont repliées.** Un arbitre qui les
              lit toutes avant de regarder la preuve juge une correspondance au
              lieu d'un fait — il se met à arbitrer la politesse. Elles s'ouvrent
              à la demande, et le bouton dit combien il en ouvre. */}
          {ligne.tentatives.some((tentative) => tentative.note) ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setNotesOuvertes((avant) => !avant)}
              testID="lire-les-notes"
              style={({ pressed }) => ({
                minHeight: size.touchMin,
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Texte variante="type.caption" couleur="brand.700">
                {notesOuvertes
                  ? t('admin.replierLesNotes')
                  : t('admin.lireLesNotes', {
                      n: ligne.tentatives.filter((tentative) => tentative.note).length,
                    })}
              </Texte>
            </Pressable>
          ) : null}

          {notesOuvertes
            ? ligne.tentatives.map((tentative, rang) =>
                tentative.note ? (
                  <Texte
                    key={`note-${tentative.demandee_le}-${rang}`}
                    variante="type.caption"
                    couleur="ink.soft"
                    testID={`note-tentative-${rang}`}
                  >
                    {t('commerce.tentative', { n: rang + 1 })} · {tentative.note}
                  </Texte>
                ) : null,
              )
            : null}
        </View>
      ) : null}

      {ligne.derniere_soumission?.note ? (
        <View style={{ gap: 2 }} testID="note-du-createur">
          <Texte variante="type.label" couleur="ink.soft">
            {t('commerce.noteDuCreateur')}
          </Texte>
          <Texte variante="type.caption">{ligne.derniere_soumission.note}</Texte>
        </View>
      ) : null}

      <RangeeDeChips>
        {MOTIFS.map((cle) => (
          <Chip
            key={cle}
            label={libelleDuMotif(t, cle)}
            selected={motif === cle}
            onPress={() => setMotif(motif === cle ? null : cle)}
            // **Ancré sur le code, pas sur le libellé.** Depuis que les motifs
            // s'alignent au-dessus sans leur numéro, le même mot apparaît deux
            // fois dans le panneau : un sélecteur de test qui cherche le texte
            // trouve les deux et ne dit plus lequel il presse.
            testID={`motif-${cle}`}
          />
        ))}
      </RangeeDeChips>

      {/* Le champ n'apparaît qu'avec un motif : une note ne voyage jamais
          seule, et l'offrir avant ferait écrire une phrase qui serait rejetée. */}
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

      {echec ? <StatusMessage level="danger" body={echec} testID="echec" /> : null}

      {/* `DecisionBar` retire d'elle-même les décisions qui exigent un motif
          tant qu'il manque. L'approbation reste toujours offerte.

          **Chaque issue nomme son objet.** « Approve » seul ne disait pas ce
          qu'on approuvait : à l'œil, le panneau au-dessus le dit ; à l'oreille
          et dans un journal d'accessibilité, la barre arrive seule, et trois
          boutons identiques d'un dossier à l'autre ne se distinguent plus. Le
          libellé nomme donc la publication, et le nom accessible ajoute de qui
          et de quelle prestation il s'agit. */}
      {/* **Ce que « fermer sans faute » veut dire, là où on hésite.** Un
          arbitre qui découvre une quatrième issue au moment de trancher a
          besoin de savoir ce qu'elle coûte à qui — et la réponse est : à
          personne. Sous les boutons et nulle part ailleurs : dans une page
          d'aide, personne ne la lirait. */}
      {forme.meme ? (
        <Texte variante="type.caption" couleur="ink.soft" testID="clore-sans-faute-aide">
          {t('admin.issueCloreSansFauteAide')}
        </Texte>
      ) : null}

      <DecisionBar
        testID={`decisions-${ligne.collaboration_id}`}
        motif={motif ?? undefined}
        decisions={[
          // **L'ordre suit la forme du dossier, et c'est tout son objet.** Sur
          // un dossier où le même motif boucle, « fermer sans faute » passe
          // devant : ni approuver ni refuser n'est juste, et l'arbitre qui
          // tranche vingt dossiers à la chaîne appuie sur le premier. Sur un
          // dossier à motifs mélangés, « approuver » reprend la première place.
          ...(forme.meme ? [clotureSansFaute] : []),
          {
            cle: 'approve',
            // **Le bouton nomme son écart.** « Approve » seul ne disait pas ce
            // qu'on approuvait ; dans une file où l'on tranche vingt dossiers
            // à la chaîne, un verbe seul finit par vouloir dire « suivant ».
            // Quand il n'y a rien à excuser, il redevient simple : l'écart
            // n'existe que s'il y en a un.
            label: approbation,
            accessibilityLabel: surCeDossier(t, ligne, approbation),
            touche: 'A',
            approbation: true,
            onPress: () => void arbitrer('approve'),
          },
          {
            cle: 'resubmit',
            label: t('admin.issueResubmit'),
            accessibilityLabel: surCeDossier(t, ligne, t('admin.issueResubmit')),
            touche: 'R',
            onPress: () => void arbitrer('resubmit'),
          },
          {
            cle: 'unfulfilled',
            label: t('admin.issueUnfulfilled'),
            accessibilityLabel: surCeDossier(t, ligne, t('admin.issueUnfulfilled')),
            touche: 'N',
            onPress: () => void arbitrer('unfulfilled'),
          },
          ...(forme.meme ? [] : [clotureSansFaute]),
        ]}
      />
    </View>
  );
}
