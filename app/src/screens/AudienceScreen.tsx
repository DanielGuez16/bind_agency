/**
 * 01c · Audience certifiée, et 01b · état du contrôle.
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
  type PlateformeConnectable,
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
import { formatDate, formatNumber } from '../format';
import { useI18n } from '../i18n';
import { translateErrorCode } from '../i18n/errors';
import { useRattachement } from '../shell/rattacherUnReseau';
import { Ecran } from './Ecran';
import { nomDePlateforme } from './obstacle';
import { useRequete } from './useRequete';

/** Les réseaux branchés. Snapchat n'a pas d'accès partenaire. */
const RESEAUX: PlateformeConnectable[] = ['instagram', 'tiktok'];

type Vue = { audience: AudienceDuCompte[]; verification: VerificationDuCompte[] };

export function AudienceScreen() {
  const { api, messageDErreur } = useApi();
  const { t, locale } = useI18n();

  const requete = useRequete<Vue>(
    async (signal) => ({
      audience: await api.monAudience(signal),
      verification: await api.maVerification(signal),
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
          <Rattacher api={api} messageDErreur={messageDErreur} onFait={requete.recharger} />
        </View>
      }
    >
      {({ audience, verification }) => (
        <View style={{ gap: 16 }}>
          {audience.map((compte) => {
            const controle = verification.find(
              (v) => v.social_account_id === compte.social_account_id,
            );
            return (
              <View key={compte.social_account_id} style={{ gap: 4 }}>
                <Texte variante="type.bodyStrong" ellipseSurNomPropre>
                  {compte.handle ?? compte.platform}
                </Texte>

                <DataRow
                  label={t('parcours.followers')}
                  // Nul et non zéro : « pas encore mesuré » n'est pas « zéro ».
                  value={
                    compte.followers_count === null
                      ? t('parcours.jamaisMesure')
                      // Séparateur de milliers : « 128000 » se compte à la
                      // main, chiffre par chiffre, sur le nombre qui est la
                      // raison d'être de l'écran.
                      : formatNumber(compte.followers_count, locale)
                  }
                  chiffre={compte.followers_count !== null}
                />
                <DataRow
                  label={t('parcours.posts')}
                  value={
                    compte.media_count === null
                      ? t('parcours.jamaisMesure')
                      : formatNumber(compte.media_count, locale)
                  }
                  chiffre={compte.media_count !== null}
                />
                {compte.engagement_rate !== null ? (
                  <DataRow
                    label={t('parcours.engagement')}
                    value={compte.engagement_rate}
                    chiffre
                  />
                ) : null}

                {/* La date du relevé. Sans elle, le chiffre est illisible. */}
                <Texte variante="type.caption" couleur="ink.mute" testID="date-du-releve">
                  {compte.captured_at
                    ? t('parcours.mesureLe', {
                        date: formatDate(compte.captured_at, locale, 'UTC'),
                      })
                    : t('parcours.jamaisMesure')}
                </Texte>

                {!compte.reconnectable ? (
                  <StatusMessage
                    level="warning"
                    body={t('errors.social_account_from_other_provider')}
                    testID="compte-d-un-autre-fournisseur"
                  />
                ) : null}

                {controle?.verification_status === 'needs_review' ? (
                  <View style={{ gap: 6 }} testID="controle-en-cours">
                    <StatusMessage
                      level="warning"
                      title={t('parcours.verificationTitre')}
                      // Le texte ne contient aucune durée annoncée : ni
                      // objectif, ni estimation. Seulement la date de départ.
                      body={`${t('parcours.verificationEnCours')} ${t('parcours.verificationDepuis', {
                        date: formatDate(controle.started_at, locale, 'UTC'),
                      })}`}
                    />
                    <Texte variante="type.caption" couleur="ink.soft">
                      {t('parcours.verificationSignaux')}
                    </Texte>
                    {controle.signaux.map((signal) => (
                      <DataRow
                        key={signal.signal}
                        label={t(`signaux.${signal.signal}`)}
                        value={t(`verdicts.${signal.verdict}`)}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
          <Rattacher api={api} messageDErreur={messageDErreur} onFait={requete.recharger} />
        </View>
      )}
    </Ecran>
  );
}

/**
 * Les boutons de rattachement.
 *
 * Composant du module, pas fonction imbriquée : déclarée dans le corps de
 * l'écran, elle changeait d'identité à chaque rendu, et React démontait puis
 * remontait tout le sous-arbre à chaque frappe.
 */
function Rattacher({
  api,
  messageDErreur,
  onFait,
}: {
  api: ReturnType<typeof useApi>['api'];
  messageDErreur: (erreur: unknown) => string;
  /** Le compte existe côté serveur : on relit plutôt que de le croire. */
  onFait: () => void;
}) {
  const { t, locale } = useI18n();
  const { ouverture, echec, connecter } = useRattachement({
    api,
    traduire: (code) => translateErrorCode(t, code),
    messageDErreur,
    onRattache: onFait,
  });

  return (
    <Apparition>
      <View style={{ gap: 8 }} testID="rattacher-un-reseau">
        <Texte variante="type.label" couleur="ink.soft">
          {t('parcours.audienceConnecter')}
        </Texte>
        {echec ? <StatusMessage level="danger" body={echec} testID="echec-connexion" /> : null}
        {RESEAUX.map((reseau) => (
          <Button
            key={reseau}
            label={nomDePlateforme(reseau)}
            variant="secondary"
            loading={ouverture === reseau}
            onPress={() => void connecter(reseau)}
            testID={`connecter-${reseau}`}
          />
        ))}
      </View>
    </Apparition>
  );
}
