/**
 * 01c · Audience certifiée, et 01d · en vérification, sans relevé.
 *
 * **Un chiffre appartient à un compte, et à une date.** C'est la phrase que la
 * planche met en titre, et elle commande toute la composition : un bloc par
 * compte connecté, le réseau en tête, le relevé daté sous les valeurs. L'écran
 * empilait auparavant des lignes de données sans dire à qui elles étaient —
 * deux réseaux y partageaient visuellement un chiffre.
 *
 * **Un compte connecté est une carte, un compte à connecter est une ligne : la
 * forme dit l'état avant le mot.** L'écran rendait deux boutons blancs
 * identiques, l'un sous l'autre, **y compris pour un réseau déjà rattaché** —
 * il proposait donc de connecter ce qui l'était. Ce n'est pas une question
 * d'allure : les deux objets n'ont pas la même action, et rien ne le disait.
 *
 * **Le seul orange de l'écran est « Connect »**, parce que c'est la seule
 * action. Le reste est de l'information.
 *
 * **Ses abonnés sont sa donnée, et ils sont datés.** Le chiffre vient du
 * dernier relevé ; sans date il passerait pour celui d'aujourd'hui alors qu'il
 * peut avoir une semaine.
 *
 * **Sans relevé, on écrit « pas encore mesuré », jamais zéro.** Afficher zéro
 * abonné à quelqu'un qui en a douze mille est un défaut qu'il signalera avant
 * nous.
 *
 * **Aucune promesse de délai sur la vérification.** On donne la date de
 * démarrage — le compteur de jours se calcule ici — et les signaux jugés. Une
 * promesse tenue par une file d'attente humaine se brise le premier jour de
 * charge, auprès de gens qui n'ont rien fait de mal.
 *
 * **C'est ici qu'on rattache un réseau.** L'écran listait les comptes sans
 * offrir d'en ajouter un : le fil et les paliers renvoyaient vers un écran qui
 * disait « aucune mesure » et s'arrêtait là. L'action existe donc dans les deux
 * états, avec des comptes et sans.
 *
 * Le geste vit dans `useRattachement`, en un seul exemplaire : cet écran en
 * portait sa propre copie, dont le corps s'est vidé sans que rien ne le
 * signale — l'appui ne produisait plus rien du tout.
 *
 * **Un compte venu d'un autre fournisseur le dit.** Un compte rattaché en
 * démonstration porte un jeton qui n'existe chez personne : le jour où le mode
 * passe en réel, il devient irrécupérable. Le fil et les paliers proposent
 * pourtant « reconnecter », et le faire créerait un **autre** compte en
 * laissant celui-ci mort à côté. La ligne le dit ici, où le geste se ferait.
 */
import { Pressable, View } from 'react-native';

import {
  useApi,
  type AudienceDuCompte,
  type FiabiliteDuCreateur,
  type PlateformeConnectable,
  type ProchainPalier,
  type SignalJuge,
  type VerificationDuCompte,
  type VueDesPaliers,
} from '../api';
import {
  Apparition,
  Button,
  DataRow,
  Icone,
  Jauge,
  SkeletonLignes,
  StatusMessage,
  Texte,
} from '../components';
import { formatDate, formatDateTime, formatNumber } from '../format';
import { useI18n, type SupportedLocale } from '../i18n';
import { en } from '../i18n/en';
import { translateErrorCode } from '../i18n/errors';
import { useRattachement } from '../shell/rattacherUnReseau';
import { elevationDeCarte, radius, size, useColors } from '../theme';
import { Ecran } from './Ecran';
import { messageDObstacle, nomDePlateforme } from './obstacle';
import { etatDuCompte, tombeeLe, type EtatDuCompte } from './audience/etat';
import { seuilDesAbonnes } from './audience/seuil';
import { useRequete } from './useRequete';

/** Les codes que l'interface sait traduire. Un code inconnu se dit tel quel. */
const CODES_CONNUS = new Set(Object.keys(en.errors));

/** Les réseaux branchés. Snapchat n'a pas d'accès partenaire. */
const RESEAUX: PlateformeConnectable[] = ['instagram', 'tiktok'];

/**
 * Ce qu'on écrit à la place d'une valeur qu'on n'a pas relevée.
 *
 * **Un tiret cadratin, et jamais zéro.** Afficher « 0 abonné » à quelqu'un qui
 * en a douze mille est la pire chose que cet écran puisse faire — c'est la
 * planche qui le dit, et elle a raison : le chiffre est la raison d'être de
 * l'écran, et se tromper dessus discrédite tout le reste. Le tiret ne se lit
 * pas comme une quantité, ce qui est exactement sa fonction.
 */
const TIRET = '—';

type Vue = {
  audience: AudienceDuCompte[];
  verification: VerificationDuCompte[];
  /** Ce qui compte pour les paliers, et qui ne vient pas de l'audience. */
  paliers: VueDesPaliers;
};

/** Depuis combien de jours le contrôle dure. Jamais un délai promis. */
function joursDepuis(debut: string): number {
  return Math.max(1, Math.floor((Date.now() - new Date(debut).getTime()) / 86_400_000) + 1);
}

export function AudienceScreen({
  onVoirMesPaliers,
  onVoirLeScore,
  onRetour,
}: {
  onVoirMesPaliers?: () => void;
  onVoirLeScore?: () => void;
  /** L'écran n'est plus un onglet : sans retour, on n'en sort qu'en changeant d'onglet. */
  onRetour?: () => void;
} = {}) {
  const { api, messageDErreur } = useApi();
  const { t } = useI18n();
  const c = useColors();

  const requete = useRequete<Vue>(
    async (signal) => ({
      audience: await api.monAudience(signal),
      verification: await api.maVerification(signal),
      // **Le score et le palier suivant ne sont pas de l'audience**, et c'est
      // pourtant ici qu'on vient les chercher : ce sont les deux autres
      // grandeurs qui ouvrent une prestation. Un seul appel pour les deux —
      // les demander séparément donnerait deux lectures d'un même état à deux
      // instants.
      paliers: await api.mesPaliers({}, signal),
    }),
    { estVide: (v) => v.audience.length === 0 },
  );

  // **Le rattachement vit au niveau de l'écran, pas dans la liste.** Il sert
  // deux gestes qui sont le même appel : connecter un réseau qui manque, et
  // réautoriser un compte dont le jeton est tombé. Deux exemplaires du crochet
  // donneraient deux états de chargement, et l'un des deux tournerait dans le
  // vide pendant que l'autre travaille.
  const { ouverture, echec, connecter } = useRattachement({
    api,
    traduire: (code) => translateErrorCode(t, code),
    messageDErreur,
    onRattache: requete.recharger,
  });

  return (
    <Ecran
      requete={requete}
      titre={t('parcours.audienceTitre')}
      onRetour={onRetour}
      squelette={<SkeletonLignes combien={5} testID="squelette-audience" />}
      testID="ecran-audience"
      vide={
        <View style={{ gap: 12 }}>
          <StatusMessage level="neutral" body={t('parcours.audienceVide')} testID="audience-vide" />
          <ARattacher
            reseaux={RESEAUX}
            ouverture={ouverture}
            echec={echec}
            connecter={connecter}
          />
        </View>
      }
    >
      {({ audience, verification, paliers }) => {
        const connectes = new Set(audience.map((compte) => compte.platform));
        return (
          <View style={{ gap: 13 }}>
            {audience.map((compte) => (
              <CarteDuCompte
                key={compte.social_account_id}
                compte={compte}
                controle={verification.find(
                  (v) => v.social_account_id === compte.social_account_id,
                )}
                prochain={paliers.prochain_palier}
                onReconnecter={() => void connecter(compte.platform as PlateformeConnectable)}
                reconnexionEnCours={ouverture === compte.platform}
              />
            ))}

            {/* **Une ligne, pas une carte, et seulement pour ce qui manque.**
                L'écran rendait un bouton par réseau, y compris pour celui qui
                était déjà rattaché : il proposait de connecter ce qui l'était.
                Ce qui reste est ce qu'on peut encore faire. */}
            <ARattacher
              reseaux={RESEAUX.filter((reseau) => !connectes.has(reseau))}
              ouverture={ouverture}
              echec={echec}
              connecter={connecter}
            />

            <CarteDuScore fiabilite={paliers.fiabilite} onVoirLeDetail={onVoirLeScore} />

            {/* **Le passage vers les paliers, sorti du fil.** Il y annonçait un
                nombre de prestations ; ici il n'en annonce aucun, et c'est
                voulu : le compte du fil était borné au rayon, et le répéter sur
                un écran qui ne connaît pas la position aurait donné deux
                nombres différents pour la même phrase. */}
            {onVoirMesPaliers ? (
              <View
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 3,
                  borderRadius: radius['radius.lg'],
                  backgroundColor: c['bg.surface'],
                  borderWidth: 1,
                  borderColor: c['line.default'],
                  ...elevationDeCarte(),
                }}
              >
                <Ligne
                  titre={t('parcours.audienceVoirMesPaliers')}
                  sous={t('parcours.audienceVoirMesPaliersSous')}
                  onPress={onVoirMesPaliers}
                  testID="voir-mes-paliers"
                />
              </View>
            ) : null}
          </View>
        );
      }}
    </Ecran>
  );
}

/**
 * Un compte connecté : une carte, sa marque en tête, ses chiffres situés.
 *
 * **Le logo manquait entièrement**, et c'est la première chose qu'on cherche du
 * regard sur un écran de comptes. « Instagram » et « TikTok » en toutes lettres
 * donnaient deux lignes identiques à l'œil.
 *
 * **Aucun nombre n'apparaît seul**, et c'est la correction de fond. L'écran
 * portait trois chiffres qui décrivent une créatrice sans lui dire quoi en
 * faire — « c'est pas très joli » et « on sait pas ce que c'est » sont le même
 * défaut vu de deux côtés. Les abonnés portent le seuil qu'ils visent,
 * l'engagement et les vues sont regroupés sous la phrase qui dit à quoi ils
 * servent : ce qu'un salon regarde en ouvrant le profil.
 *
 * **La date reste sous les valeurs.** Un chiffre sans date passe pour celui
 * d'aujourd'hui alors qu'il peut avoir une semaine, et c'est sur ce chiffre
 * qu'un palier s'ouvre ou se ferme.
 */
function CarteDuCompte({
  compte,
  controle,
  prochain,
  onReconnecter,
  reconnexionEnCours,
}: {
  compte: AudienceDuCompte;
  controle: VerificationDuCompte | undefined;
  /** Le palier fermé le plus proche, pour le seuil des abonnés. Voir `seuil.ts`
   * pour les trois conditions qui décident s'il concerne cette carte. */
  prochain: ProchainPalier | null;
  onReconnecter: () => void;
  reconnexionEnCours: boolean;
}) {
  const { t, locale } = useI18n();
  const c = useColors();
  const enRevue = compte.verification_status === 'needs_review';
  const etat = etatDuCompte(compte);
  const seuil = seuilDesAbonnes(compte, prochain);

  return (
    <View
      testID={`compte-${compte.social_account_id}`}
      style={{
        gap: 14,
        padding: 16,
        borderRadius: radius['radius.lg'],
        backgroundColor: c['bg.surface'],
        borderWidth: 1,
        borderColor: c['line.default'],
        // « Un coin de 18 px sans ombre flotte au lieu de se poser » : §2.
        ...elevationDeCarte(),
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Icone nom={compte.platform === 'tiktok' ? 'tiktok' : 'instagram'} taille={26} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Texte variante="type.bodyStrong">{nomDePlateforme(compte.platform)}</Texte>
          {/* **Un pseudonyme n'est pas un code.** Il était en mono, comme un
              identifiant qu'on lit caractère par caractère pour le recopier ;
              « @casabruma » se lit d'un mot. Même défaut que les dates en mono,
              et même correction. */}
          {compte.handle ? (
            <Texte variante="type.caption" couleur="ink.mute" ellipseSurNomPropre>
              {compte.handle}
            </Texte>
          ) : null}
        </View>
        <Pastille etat={etat} testID={`etat-${compte.social_account_id}`} />
      </View>

      {/* **Ce que l'autorisation tombée change vraiment.** La planche écrivait
          « les paliers restent où ils étaient » : c'est faux, et vérifié dans
          `eligibility.py` — un compte qui n'est plus actif porte
          `account_token_invalid` sur **chaque** palier, donc ils se ferment
          tous. Ce qui est vrai est l'autre moitié : l'éligibilité n'est
          évaluée qu'à la création d'une réservation, jamais ensuite, donc ce
          qui est engagé n'est pas touché. La phrase dit les deux. */}
      {etat === 'suspendu' ? (
        <View
          testID="autorisation-suspendue"
          style={{
            gap: 7,
            padding: 16,
            borderRadius: radius['radius.md'],
            backgroundColor: c['bg.inset'],
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
            <View style={{ marginTop: 4 }}>
              <Icone nom="alerte" taille={18} />
            </View>
            <Texte variante="type.bodyStrong" style={{ flex: 1 }}>
              {t('parcours.audienceAutorisationFinie', {
                reseau: nomDePlateforme(compte.platform),
              })}
            </Texte>
          </View>
          <Texte variante="type.body" couleur="ink.soft">
            {compte.captured_at
              ? t('parcours.audienceGeleAu', {
                  date: formatDate(compte.captured_at, locale, 'UTC'),
                })
              : t('parcours.audienceGeleSansReleve')}
          </Texte>
          {/* **Depuis quand, et pas seulement « finie ».** Sans cette date, la
              seule façon de le savoir était de heurter l'obstacle d'un palier —
              c'est-à-dire de découvrir la panne au moment de réserver. */}
          {tombeeLe(compte.token_expires_at) ? (
            <Texte variante="type.caption" couleur="ink.mute" testID="autorisation-tombee-le">
              {t('parcours.audienceAutorisationTombeeLe', {
                date: formatDate(compte.token_expires_at as string, locale, 'UTC'),
              })}
            </Texte>
          ) : null}
          {compte.reconnectable ? (
            <View style={{ alignSelf: 'flex-start', marginTop: 3 }}>
              <Button
                label={t('parcours.audienceReconnecter')}
                loading={reconnexionEnCours}
                onPress={onReconnecter}
                testID={`reconnecter-${compte.platform}`}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {/* **Le cartouche des abonnés : le chiffre, son seuil, et ce qu'il
          ouvre.** L'aplat clair de marque l'isole des deux mesures d'en
          dessous, qui ne visent aucun seuil et n'ouvrent rien. */}
      <View
        testID="cartouche-abonnes"
        style={{
          gap: 5,
          padding: 14,
          paddingHorizontal: 16,
          borderRadius: radius['radius.md'],
          backgroundColor: c['brand.50'],
        }}
      >
        <Texte variante="type.label" couleur="ink.mute">
          {etat === 'suspendu'
            ? t('parcours.audienceAbonnesDernierReleve')
            : t('parcours.followers')}
        </Texte>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
          {/* Le chiffre gelé passe en encre douce : il est vrai, il n'est plus
              courant. Et le tiret est la valeur quand il n'y a pas de relevé,
              donc il se lit — ink.mute, jamais ink.faint. */}
          <Texte
            variante="type.figureSmall"
            couleur={etat === 'a-jour' ? 'ink.default' : 'ink.mute'}
            testID="abonnes"
          >
            {compte.followers_count === null
              ? TIRET
              : formatNumber(compte.followers_count, locale)}
          </Texte>
          {seuil ? (
            <Texte variante="type.caption" couleur="ink.soft" testID="abonnes-seuil">
              {t('parcours.audienceSurSeuil', { seuil: formatNumber(seuil.requis, locale) })}
            </Texte>
          ) : null}
        </View>

        {seuil ? (
          <>
            <Jauge fraction={seuil.fraction} piste="brand.100" testID="abonnes-jauge" />
            <Texte variante="type.caption" couleur="ink.soft" testID="abonnes-ouvre">
              {t('parcours.audienceOuvreLePalier', {
                manque: formatNumber(seuil.ecart, locale),
                format: seuil.format.toUpperCase(),
              })}
            </Texte>
          </>
        ) : null}

        {/* **Le palier suivant ne disparaît pas quand ce n'est pas d'abonnés
            qu'il s'agit.** Sans cette ligne, un palier fermé pour un score
            trop bas ou un relevé périmé cesserait d'être dit sur cet écran :
            la jauge est muette, et le silence se lirait comme « rien à
            viser ». */}
        {!seuil && prochain && prochain.platform === compte.platform ? (
          <Texte variante="type.caption" couleur="ink.soft" testID="prochain-palier">
            {messageDObstacle(t, prochain.obstacle, CODES_CONNUS, prochain.platform, locale)}
          </Texte>
        ) : null}

        {/* **La phrase du dépôt, pas celle de la planche.** Design écrit
            « first reading within a day of connecting » : c'est une promesse de
            délai, et la cadence du relevé est de la configuration. La phrase
            existante dit ce qui compte vraiment — que le tiret n'est pas un
            zéro — sans promettre une heure que personne ne tient. */}
        {etat === 'premiere-lecture' ? (
          <Texte variante="type.caption" couleur="ink.soft" testID="aucun-releve">
            {t('parcours.audienceAucunReleve')}
          </Texte>
        ) : null}
        {etat === 'suspendu' && compte.captured_at ? (
          <Texte variante="type.caption" couleur="ink.soft" testID="abonnes-date-du-gel">
            {t('parcours.audienceLeJour', {
              date: formatDate(compte.captured_at, locale, 'UTC'),
            })}
          </Texte>
        ) : null}
      </View>

      {/* **Les deux mesures que le commerce regarde, sous la phrase qui le
          dit.** Elles étaient deux nombres orphelins à côté des abonnés, au
          même poids qu'eux, alors qu'elles n'ouvrent aucun palier : elles
          servent à convaincre, pas à débloquer. Les taire serait pire — les
          vues sont la seule mesure d'audience constatée plutôt que déclarée. */}
      {etat !== 'suspendu' ? (
        <View style={{ gap: 8 }} testID="ce-que-voit-un-salon">
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Mesure
              etiquette={t('parcours.engagement')}
              valeur={compte.engagement_rate ?? TIRET}
              testID="engagement"
            />
            <Mesure
              etiquette={t('parcours.vuesMoyennes')}
              valeur={
                compte.avg_views === null ? TIRET : formatNumber(compte.avg_views, locale)
              }
              testID="vues-moyennes"
            />
          </View>
          <Texte variante="type.caption" couleur="ink.mute">
            {compte.captured_at
              ? `${t('parcours.audienceCeQueVoitUnSalon')} ${t('parcours.audienceReleveDu', {
                  date: formatDateTime(compte.captured_at, locale, 'UTC'),
                })}`
              : t('parcours.audienceCeQueVoitUnSalon')}
          </Texte>
        </View>
      ) : null}

      {!compte.reconnectable ? (
        <StatusMessage
          level="warning"
          body={t('errors.social_account_from_other_provider')}
          testID="compte-d-un-autre-fournisseur"
        />
      ) : null}

      {enRevue && controle ? (
        <View style={{ gap: 6 }} testID="controle-en-cours">
          <StatusMessage
            level="warning"
            title={t('parcours.verificationTitre')}
            body={`${t('parcours.verificationEnCours')} ${t('parcours.verificationDepuis', {
              date: formatDate(controle.started_at, locale, 'UTC'),
            })}`}
          />
          {/* **Ce qui est déjà acquis, plutôt qu'une roue qui tourne.** Un
              contrôle qui dure sans rien montrer se lit comme une panne. */}
          <Texte variante="type.label" couleur="ink.soft">
            {t('parcours.audienceDejaAcquis')}
          </Texte>
          {controle.signaux.map((signal) => (
            <SignalAcquis key={signal.signal} signal={signal} locale={locale} />
          ))}
          <Texte variante="type.dataLabel" couleur="ink.mute" testID="jour-du-controle">
            {t('parcours.audienceJourN', { n: String(joursDepuis(controle.started_at)) })}
          </Texte>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Le mot d'état, en pastille.
 *
 * **Aucun n'est en rouge.** Une autorisation qui expire est un fait de la
 * plateforme et non un manquement ; le vert de « à jour » est le seul état qui
 * mérite une teinte, parce qu'il est le seul à dire qu'il n'y a rien à faire.
 */
function Pastille({ etat, testID }: { etat: EtatDuCompte; testID: string }) {
  const { t } = useI18n();
  const c = useColors();
  const vivant = etat === 'a-jour';
  const mot = {
    'a-jour': 'parcours.audienceEtatAJour',
    suspendu: 'parcours.audienceEtatSuspendu',
    'premiere-lecture': 'parcours.audienceEtatPremiereLecture',
  }[etat];

  return (
    <View
      testID={testID}
      style={{
        borderRadius: radius['radius.sm'],
        backgroundColor: vivant ? c['status.success.surface'] : c['bg.inset'],
        paddingHorizontal: 10,
        paddingVertical: 5,
      }}
    >
      <Texte variante="type.label" couleur={vivant ? 'status.success.text' : 'ink.soft'}>
        {t(mot)}
      </Texte>
    </View>
  );
}

/** Une mesure et son étiquette, à poids égal de sa voisine. */
function Mesure({
  etiquette,
  valeur,
  testID,
}: {
  etiquette: string;
  valeur: string;
  testID: string;
}) {
  return (
    <View style={{ flex: 1, minWidth: 0, gap: 2 }} testID={testID}>
      <Texte variante="type.label" couleur="ink.mute">
        {etiquette}
      </Texte>
      <Texte variante="type.data">{valeur}</Texte>
    </View>
  );
}

/**
 * Un signal du contrôle, avec ce qui est constaté **et** ce qui est requis.
 *
 * **Les deux étaient servis et aucun n'était rendu.** `SignalJuge` porte
 * `constate` et `requis` depuis toujours ; l'écran n'affichait que le verdict,
 * si bien qu'« Account age : falls short » ne disait ni de combien ni depuis
 * quand. Un verdict sans ses termes ne se conteste pas, et ne s'améliore pas
 * non plus.
 */
function SignalAcquis({ signal, locale }: { signal: SignalJuge; locale: SupportedLocale }) {
  const { t } = useI18n();
  const ecrire = (valeur: string | number | null) =>
    valeur === null ? null : typeof valeur === 'number' ? formatNumber(valeur, locale) : valeur;

  const constate = ecrire(signal.constate);
  const requis = ecrire(signal.requis);

  return (
    <DataRow
      label={t(`signaux.${signal.signal}`)}
      testID={`signal-${signal.signal}`}
      value={
        constate === null
          ? t(`verdicts.${signal.verdict}`)
          : requis === null
            ? constate
            : `${constate} / ${requis}`
      }
    />
  );
}

/**
 * Le score, en deux niveaux : son chiffre ici, sa mécanique un écran plus loin.
 *
 * **Le bloc répétait en détail ce que la ligne annonçait.** Il posait le score,
 * les collaborations tenues et l'obstacle du palier suivant les uns sous les
 * autres, au même poids, sur un écran dont c'est déjà le troisième sujet. Ce
 * qui a une conséquence tient en deux lignes ; le reste — ce qui le monte, ce
 * qui le descend, et les deux choses qu'il ne fait jamais — est une lecture, et
 * une lecture se range derrière un chevron.
 *
 * **Sa barre est en brand.500.** Deux barres identiques en tout sauf la teinte
 * promettraient que la teinte porte un sens, et le système n'a aucune couleur
 * pour « le score est bas » : l'avertissement n'a pas de teinte et le danger est
 * réservé à ce qui est cassé. Une barre unique, dans la seule couleur de
 * surface de marque, ne promet rien qu'elle ne tienne.
 *
 * **Sans historique, un tiret et une phrase, jamais un zéro.** Afficher 0 sur
 * 100 à une nouvelle créatrice serait la pénaliser d'être nouvelle. Et la
 * phrase dit explicitement que cela ne coûte rien : sans elle, un tiret à côté
 * de « ouvre les paliers hauts » se lit comme une porte fermée.
 */
function CarteDuScore({
  fiabilite,
  onVoirLeDetail,
}: {
  fiabilite: FiabiliteDuCreateur;
  onVoirLeDetail?: () => void;
}) {
  const { t } = useI18n();
  const c = useColors();
  const brut = fiabilite.reliability_score;
  const score = brut === null ? null : Number(brut);
  const lisible = score !== null && Number.isFinite(score);

  return (
    <View
      testID="carte-du-score"
      style={{
        gap: 12,
        padding: 16,
        borderRadius: radius['radius.lg'],
        backgroundColor: c['bg.surface'],
        borderWidth: 1,
        borderColor: c['line.default'],
        ...elevationDeCarte(),
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Texte variante="type.bodyStrong">{t('parcours.audienceScore')}</Texte>
          <Texte variante="type.caption" couleur="ink.mute">
            {t('parcours.audienceScoreOuvre')}
          </Texte>
        </View>
        <Texte
          variante="type.figureSmall"
          couleur={lisible ? 'ink.default' : 'ink.mute'}
          testID="score-de-fiabilite"
        >
          {lisible ? String(score) : TIRET}
        </Texte>
      </View>

      {lisible ? (
        <Jauge fraction={score / 100} testID="score-jauge" />
      ) : (
        <View
          testID="score-pas-encore"
          style={{
            gap: 4,
            padding: 12,
            paddingHorizontal: 14,
            borderRadius: radius['radius.md'],
            backgroundColor: c['bg.inset'],
          }}
        >
          <Texte variante="type.bodyStrong">{t('parcours.audiencePasEncoreDeScore')}</Texte>
          <Texte variante="type.caption" couleur="ink.soft">
            {t('parcours.audiencePasEncoreDeScoreDetail')}
          </Texte>
        </View>
      )}

      {onVoirLeDetail ? (
        <Ligne
          titre={t('parcours.audienceScoreCeQuiLeFait')}
          onPress={onVoirLeDetail}
          testID="voir-le-score"
        />
      ) : null}
    </View>
  );
}

/**
 * Une ligne qui mène ailleurs : son mot, et le chevron qui dit qu'elle mène.
 *
 * Quarante-quatre points de haut au minimum — c'est la cible tactile du
 * système, et une ligne de 13 px sans hauteur imposée tombe en dessous.
 */
function Ligne({
  titre,
  sous,
  onPress,
  testID,
}: {
  titre: string;
  sous?: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      style={({ pressed }) => ({
        minHeight: size.touchMin,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Texte variante={sous ? 'type.bodyStrong' : 'type.caption'} couleur="ink.soft">
          {titre}
        </Texte>
        {sous ? (
          <Texte variante="type.caption" couleur="ink.mute">
            {sous}
          </Texte>
        ) : null}
      </View>
      <Icone nom="chevron" couleur="brand.700" taille={20} />
    </Pressable>
  );
}

/**
 * Les réseaux qu'il reste à rattacher : une ligne chacun, jamais une carte.
 *
 * **La forme dit l'état avant le mot.** Un compte connecté est une carte avec
 * ses valeurs ; un réseau à connecter est une ligne avec son action, et rien
 * ne les confond. L'écran rendait deux boutons blancs identiques, l'un sous
 * l'autre, **y compris pour un réseau déjà rattaché**.
 *
 * Rien quand il n'en reste aucun : un titre de section au-dessus du vide est
 * une promesse qui ne mène nulle part.
 *
 * Composant du module, pas fonction imbriquée : déclarée dans le corps de
 * l'écran, elle changeait d'identité à chaque rendu, et React démontait puis
 * remontait tout le sous-arbre à chaque frappe.
 */
function ARattacher({
  reseaux,
  ouverture,
  echec,
  connecter,
}: {
  reseaux: PlateformeConnectable[];
  /** Le réseau dont l'autorisation est en cours d'ouverture, s'il y en a un. */
  ouverture: PlateformeConnectable | null;
  echec: string | null;
  connecter: (reseau: PlateformeConnectable) => void | Promise<unknown>;
}) {
  const { t } = useI18n();
  const c = useColors();

  if (reseaux.length === 0) return null;

  return (
    <Apparition>
      <View style={{ gap: 8 }} testID="rattacher-un-reseau">
        <Texte variante="type.label" couleur="ink.soft">
          {t('parcours.audienceConnecter')}
        </Texte>
        {echec ? <StatusMessage level="danger" body={echec} testID="echec-connexion" /> : null}
        {reseaux.map((reseau) => (
          <View
            key={reseau}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              paddingHorizontal: 16,
              paddingVertical: 14,
              borderRadius: radius['radius.lg'],
              // **Creusée, quand la carte est surélevée.** La planche oppose
              // « une carte à ombre » à « une ligne à filet » — la forme disant
              // l'état avant le mot — mais dessine sa ligne en blanc à filet,
              // c'est-à-dire avec les trois marques d'une carte. Deux surfaces
              // blanches à filet ne se distinguent plus, et la règle des rayons
              // les obligerait toutes deux à porter l'ombre. Le neutre en
              // retrait dit la même chose sans rien contredire : ce qui est
              // posé et blanc est à vous, ce qui est creusé ne l'est pas encore.
              backgroundColor: c['bg.inset'],
            }}
            testID={`ligne-${reseau}`}
          >
            {/* **En ink.mute, quand celui d'un compte connecté est en encre
                pleine.** La marque est là dans les deux cas ; c'est son poids
                qui dit lequel des deux est à vous. */}
            <Icone
              nom={reseau === 'tiktok' ? 'tiktok' : 'instagram'}
              couleur="ink.mute"
              taille={26}
            />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Texte variante="type.bodyStrong">{nomDePlateforme(reseau)}</Texte>
              <Texte variante="type.caption" couleur="ink.mute">
                {t('parcours.audienceNonConnecte')}
              </Texte>
            </View>
            {/* **Le seul orange de l'écran**, parce que c'est la seule action. */}
            <Button
              label={t('parcours.audienceConnecterAction')}
              loading={ouverture === reseau}
              onPress={() => void connecter(reseau)}
              testID={`connecter-${reseau}`}
            />
          </View>
        ))}
      </View>
    </Apparition>
  );
}
