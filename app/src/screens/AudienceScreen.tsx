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
import { View } from 'react-native';

import {
  useApi,
  type AudienceDuCompte,
  type FiabiliteDuCreateur,
  type PlateformeConnectable,
  type SignalJuge,
  type VerificationDuCompte,
} from '../api';
import {
  Apparition,
  Button,
  DataRow,
  SkeletonLignes,
  StatusMessage,
  Texte,
  vibration,
} from '../components';
import { formatDate, formatDateTime, formatNumber } from '../format';
import { useI18n, type SupportedLocale } from '../i18n';
import { translateErrorCode } from '../i18n/errors';
import { useRattachement } from '../shell/rattacherUnReseau';
import { useColors } from '../theme';
import { Ecran } from './Ecran';
import { nomDePlateforme } from './obstacle';
import { useRequete } from './useRequete';

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
  fiabilite: FiabiliteDuCreateur;
};

/** Depuis combien de jours le contrôle dure. Jamais un délai promis. */
function joursDepuis(debut: string): number {
  return Math.max(1, Math.floor((Date.now() - new Date(debut).getTime()) / 86_400_000) + 1);
}

export function AudienceScreen() {
  const { api, messageDErreur } = useApi();
  const { t, locale } = useI18n();

  const requete = useRequete<Vue>(
    async (signal) => ({
      audience: await api.monAudience(signal),
      verification: await api.maVerification(signal),
      // **Le score et les collaborations ne sont pas de l'audience**, et c'est
      // pourtant ici qu'on vient les chercher : la planche les met sur cet
      // écran sous « ce qui compte pour les paliers », parce que ce sont les
      // deux autres grandeurs qui ouvrent une prestation. Les laisser sur le
      // seul écran des paliers obligeait à les découvrir en cherchant.
      fiabilite: (await api.mesPaliers({}, signal)).fiabilite,
    }),
    { estVide: (v) => v.audience.length === 0 },
  );

  return (
    <Ecran
      requete={requete}
      titre={t('parcours.audienceTitre')}
      squelette={<SkeletonLignes combien={5} testID="squelette-audience" />}
      testID="ecran-audience"
      vide={
        <View style={{ gap: 12 }}>
          <StatusMessage level="neutral" body={t('parcours.audienceVide')} testID="audience-vide" />
          <ARattacher
            reseaux={RESEAUX}
            api={api}
            messageDErreur={messageDErreur}
            onFait={requete.recharger}
          />
        </View>
      }
    >
      {({ audience, verification, fiabilite }) => {
        const connectes = new Set(audience.map((compte) => compte.platform));
        return (
          <View style={{ gap: 16 }}>
            {audience.map((compte) => (
              <CarteDuCompte
                key={compte.social_account_id}
                compte={compte}
                controle={verification.find(
                  (v) => v.social_account_id === compte.social_account_id,
                )}
              />
            ))}

            {/* **Une ligne, pas une carte, et seulement pour ce qui manque.**
                L'écran rendait un bouton par réseau, y compris pour celui qui
                était déjà rattaché : il proposait de connecter ce qui l'était.
                Ce qui reste est ce qu'on peut encore faire. */}
            <ARattacher
              reseaux={RESEAUX.filter((reseau) => !connectes.has(reseau))}
              api={api}
              messageDErreur={messageDErreur}
              onFait={requete.recharger}
            />

            <CeQuiComptePourLesPaliers fiabilite={fiabilite} />
          </View>
        );
      }}
    </Ecran>
  );
}

/**
 * Un compte connecté : une carte, son réseau en tête, ses valeurs datées.
 *
 * **La date est sous les valeurs et non ailleurs.** Un chiffre sans date passe
 * pour celui d'aujourd'hui alors qu'il peut avoir une semaine, et c'est sur ce
 * chiffre qu'un palier s'ouvre ou se ferme.
 */
function CarteDuCompte({
  compte,
  controle,
}: {
  compte: AudienceDuCompte;
  controle: VerificationDuCompte | undefined;
}) {
  const { t, locale } = useI18n();
  const c = useColors();
  const enRevue = compte.verification_status === 'needs_review';

  return (
    <View
      testID={`compte-${compte.social_account_id}`}
      style={{
        gap: 10,
        padding: 16,
        backgroundColor: c['bg.surface'],
        borderWidth: 1,
        borderColor: c['line.default'],
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Texte variante="type.bodyStrong">{nomDePlateforme(compte.platform)}</Texte>
          {compte.handle ? (
            <Texte variante="type.caption" couleur="ink.soft" ellipseSurNomPropre>
              {compte.handle}
            </Texte>
          ) : null}
        </View>
        {/* Le jour n, sans objectif annoncé : aucun écran de ce lot ne promet
            de délai, parce qu'une promesse tenue par une file d'attente
            humaine se brise le premier jour de charge. */}
        <Texte variante="type.monoSmall" couleur="ink.soft" testID={`etat-${compte.social_account_id}`}>
          {enRevue && controle
            ? t('parcours.audienceJourN', { n: String(joursDepuis(controle.started_at)) })
            : t('parcours.audienceCertifie').toUpperCase()}
        </Texte>
      </View>

      <View style={{ flexDirection: 'row', gap: 24 }}>
        <Valeur
          etiquette={t('parcours.followers')}
          valeur={
            compte.followers_count === null
              ? TIRET
              : formatNumber(compte.followers_count, locale)
          }
        />
        <Valeur
          etiquette={t('parcours.engagement')}
          valeur={compte.engagement_rate ?? TIRET}
        />
      </View>

      {/* **Le relevé, ou son absence dite comme telle.** « Pas encore mesuré »
          en toutes lettres plutôt qu'un vide : c'est la seule façon de
          distinguer une valeur nulle d'une valeur non relevée, et la
          confusion entre les deux est le défaut que cet écran doit éviter. */}
      {compte.captured_at ? (
        <Texte variante="type.monoSmall" couleur="ink.mute" testID="date-du-releve">
          {t('parcours.audienceReleveDu', {
            date: formatDateTime(compte.captured_at, locale, 'UTC'),
          }).toUpperCase()}
        </Texte>
      ) : (
        <Texte variante="type.caption" couleur="ink.soft" testID="aucun-releve">
          {t('parcours.audienceAucunReleve')}
        </Texte>
      )}

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
        </View>
      ) : null}
    </View>
  );
}

/** Une valeur et son étiquette. La valeur d'abord à l'œil, l'étiquette dessus. */
function Valeur({ etiquette, valeur }: { etiquette: string; valeur: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Texte variante="type.monoSmall" couleur="ink.mute">
        {etiquette.toUpperCase()}
      </Texte>
      <Texte variante="type.section">{valeur}</Texte>
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
 * Ce qui compte pour les paliers, en dehors de l'audience.
 *
 * Les abonnés ouvrent des paliers, mais pas seuls : les collaborations tenues
 * et le score de fiabilité en ouvrent aussi, et personne ne va les chercher sur
 * un autre écran. **Le score nul se dit « pas encore de score »**, jamais zéro :
 * la distinction sépare un débutant de quelqu'un de peu fiable, et l'inverser
 * accuserait exactement celui qui n'a rien fait.
 */
function CeQuiComptePourLesPaliers({ fiabilite }: { fiabilite: FiabiliteDuCreateur }) {
  const { t, locale } = useI18n();

  return (
    <View style={{ gap: 6 }} testID="ce-qui-compte">
      <Texte variante="type.label" couleur="ink.soft">
        {t('parcours.audienceCeQuiCompte')}
      </Texte>
      <DataRow
        label={t('parcours.audienceCollaborations')}
        value={formatNumber(fiabilite.completed_collabs_count, locale)}
        chiffre
        testID="collaborations-tenues"
      />
      <DataRow
        label={t('parcours.audienceScore')}
        value={
          fiabilite.reliability_score === null
            ? t('parcours.audiencePasEncoreDeScore')
            : t('parcours.audienceScoreSur', { score: fiabilite.reliability_score })
        }
        chiffre={fiabilite.reliability_score !== null}
        testID="score-de-fiabilite"
      />
    </View>
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
  api,
  messageDErreur,
  onFait,
}: {
  reseaux: PlateformeConnectable[];
  api: ReturnType<typeof useApi>['api'];
  messageDErreur: (erreur: unknown) => string;
  /** Le compte existe côté serveur : on relit plutôt que de le croire. */
  onFait: () => void;
}) {
  const { t } = useI18n();
  const { ouverture, echec, connecter } = useRattachement({
    api,
    traduire: (code) => translateErrorCode(t, code),
    messageDErreur,
    onRattache: onFait,
  });

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
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
            testID={`ligne-${reseau}`}
          >
            <View style={{ flex: 1 }}>
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
