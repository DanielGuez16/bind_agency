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
 */
import { View } from 'react-native';

import { useApi, type AudienceDuCompte, type VerificationDuCompte } from '../api';
import { DataRow, StatusMessage, Texte } from '../components';
import { useI18n } from '../i18n';
import { Ecran } from './Ecran';
import { useRequete } from './useRequete';

type Vue = { audience: AudienceDuCompte[]; verification: VerificationDuCompte[] };

export function AudienceScreen() {
  const { api } = useApi();
  const { t } = useI18n();

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
      testID="ecran-audience"
      vide={
        <StatusMessage level="neutral" body={t('parcours.audienceVide')} testID="audience-vide" />
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
                <Texte variante="type.heading" ellipseSurNomPropre>
                  {compte.handle ?? compte.platform}
                </Texte>

                <DataRow
                  label={t('parcours.followers')}
                  // Nul et non zéro : « pas encore mesuré » n'est pas « zéro ».
                  value={
                    compte.followers_count === null
                      ? t('parcours.jamaisMesure')
                      : String(compte.followers_count)
                  }
                  chiffre={compte.followers_count !== null}
                />
                <DataRow
                  label={t('parcours.posts')}
                  value={
                    compte.media_count === null
                      ? t('parcours.jamaisMesure')
                      : String(compte.media_count)
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
                <Texte variante="type.caption" couleur="text.muted" testID="date-du-releve">
                  {compte.captured_at
                    ? t('parcours.mesureLe', {
                        date: new Date(compte.captured_at).toLocaleDateString(),
                      })
                    : t('parcours.jamaisMesure')}
                </Texte>

                {controle?.verification_status === 'needs_review' ? (
                  <View style={{ gap: 6 }} testID="controle-en-cours">
                    <StatusMessage
                      level="warning"
                      title={t('parcours.verificationTitre')}
                      // Le texte ne contient aucune durée annoncée : ni
                      // objectif, ni estimation. Seulement la date de départ.
                      body={`${t('parcours.verificationEnCours')} ${t('parcours.verificationDepuis', {
                        date: new Date(controle.started_at).toLocaleDateString(),
                      })}`}
                    />
                    <Texte variante="type.caption" couleur="text.secondary">
                      {t('parcours.verificationSignaux')}
                    </Texte>
                    {controle.signaux.map((signal) => (
                      <DataRow
                        key={signal.signal}
                        label={signal.signal}
                        value={signal.verdict}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
    </Ecran>
  );
}
