/**
 * Fermer aujourd'hui, ou couper une place : l'exception, là où elle se décide.
 *
 * **Un geste fréquent n'a pas la même place qu'un geste rare.** Composer son
 * offre et fermer un jeudi ne se font pas à la même fréquence, donc pas au même
 * endroit : le catalogue et la semaine type se revoient quelques fois par an et
 * gardent leur écran ; l'exception se décide en marchant, souvent le matin même,
 * et doit être à portée de l'écran du matin.
 *
 * **Elle écrit dans la même donnée que la semaine type**, pas dans un second
 * modèle : une ligne d'exception sur une date. Rien ne se duplique, et la
 * semaine type reste la seule règle générale.
 *
 * **Elle rappelle ce qu'elle ne touche pas.** Fermer aujourd'hui arrête les
 * nouvelles réservations et garde celles qui sont prises — c'est la première
 * question que se pose un gérant avant d'appuyer, et ne pas y répondre fait
 * renoncer au geste ou le fait faire à tort.
 *
 * **Repliée tant que rien n'est posé.** C'était une carte de cinq lignes et deux
 * contrôles, en tête de l'écran le plus ouvert du produit, tous les jours — y
 * compris les jours où personne ne touche à rien. Elle répondait à « comment
 * ajuste-t-on aujourd'hui », question qu'on se pose rarement, en haut de l'écran
 * qui répond à « qu'est-ce que je fais aujourd'hui ».
 *
 * La distinction est celle que le bandeau de mise en ligne applique déjà : **un
 * geste disparaît une fois rendu accessible, un état non résolu reste**. Une
 * exception posée — jour fermé, places coupées — est un état : le gérant doit le
 * voir sans le chercher, sans quoi il se demande pourquoi sa journée est vide.
 * Une journée qui suit la semaine type n'est pas un état, c'est le cas normal,
 * et il n'a rien à occuper.
 *
 * **Sa propre requête, et seulement pour aujourd'hui.** La semaine type ne
 * concerne pas la journée qu'on regarde ; la charger dans la requête principale
 * la ferait payer à chaque ouverture de l'écran le plus utilisé du produit,
 * y compris sur les jours passés où le geste n'a aucun sens.
 */
import { useState } from 'react';
import { View } from 'react-native';

import { useApi, type ExceptionDeCapacite, type RegleDeCapacite } from '../../api';
import { Button, Stepper, StatusMessage, Texte } from '../../components';
import { useI18n } from '../../i18n';
import { elevationDeCarte, radius, useColors } from '../../theme';
import { useRequete } from '../useRequete';
import { placesDuJour } from './exception';

export function ExceptionDuJour({
  businessId,
  jour,
  /** Les postes réellement ouverts aujourd'hui, exceptions comprises. */
  postesEffectifs,
  onFait,
}: {
  businessId: string;
  /** La date civile du salon, « 2026-08-18 ». */
  jour: string;
  postesEffectifs: number | null;
  onFait: () => void;
}) {
  const { api, messageDErreur } = useApi();
  const { t } = useI18n();
  const c = useColors();
  const [envoi, setEnvoi] = useState(false);
  /** Ouverte à la demande, quand aucune exception n'est posée. */
  const [deplie, setDeplie] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);

  const requete = useRequete<{ regles: RegleDeCapacite[]; exceptions: ExceptionDeCapacite[] }>(
    async (signal) => {
      const [regles, exceptions] = await Promise.all([
        api.reglesDeCapacite(businessId, signal),
        api.exceptionsDeCapacite(businessId, signal),
      ]);
      return { regles, exceptions };
    },
    { estVide: () => false, dependances: [businessId, jour] },
  );

  // Rien tant qu'on ne sait pas : un bloc d'action posé sur une inconnue ferait
  // couper une place qu'on croit connaître.
  if (requete.etat !== 'pret') return null;

  const etat = placesDuJour({
    jour,
    regles: requete.donnees.regles,
    exceptions: requete.donnees.exceptions,
    postesEffectifs,
  });
  if (etat === null) return null;

  async function agir(geste: () => Promise<unknown>) {
    setEchec(null);
    setEnvoi(true);
    try {
      await geste();
      onFait();
      requete.recharger();
    } catch (erreur) {
      setEchec(messageDErreur(erreur));
    } finally {
      setEnvoi(false);
    }
  }

  // **Ce qui décide de la forme.** Une exception posée sur cette date est un
  // état ; son absence est le cas normal. `exceptionId` et non une comparaison
  // de nombres : un salon peut poser une exception qui rend le même compte que
  // la semaine, et elle reste une exception qu'il a posée.
  const posee = etat.ferme || etat.exceptionId !== null;

  if (!posee && !deplie) {
    return (
      <View style={{ flexDirection: 'row' }}>
        <Button
          label={t('commerce.exceptionAjuster')}
          variant="ghost"
          size="sm"
          fullWidth={false}
          onPress={() => setDeplie(true)}
          testID="ajuster-aujourdhui"
        />
      </View>
    );
  }

  return (
    <View
      testID="exception-du-jour"
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
      <Texte variante="type.label" couleur="brand.700">
        {t('commerce.exceptionAujourdhui')}
      </Texte>

      {etat.ferme ? (
        <>
          <Texte variante="type.bodyStrong" testID="ferme-aujourdhui">
            {t('commerce.exceptionFerme')}
          </Texte>
          <View style={{ alignSelf: 'flex-start' }}>
            <Button
              label={t('commerce.exceptionRouvrir')}
              variant="secondary"
              loading={envoi}
              onPress={() =>
                void agir(() => api.supprimerUneException(businessId, etat.exceptionId as string))
              }
              testID="rouvrir-aujourdhui"
            />
          </View>
        </>
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Texte variante="type.bodyStrong">{t('commerce.exceptionPlaces')}</Texte>
              {/* **Ce que dit la semaine type, à côté du nombre du jour.** Sans
                  ce repère, on ne sait pas si l'on regarde une exception déjà
                  posée ou la règle générale — et on la repose. */}
              <Texte variante="type.caption" couleur="ink.mute" testID="places-de-la-semaine">
                {t('commerce.exceptionDansLaSemaine', { places: etat.dansLaSemaine })}
              </Texte>
            </View>
            <Stepper
              value={etat.places}
              min={1}
              max={5}
              onChange={(places) =>
                void agir(() => api.limiterLesPlaces(businessId, jour, places))
              }
              testID="places-du-jour"
            />
          </View>

          <View style={{ alignSelf: 'flex-start' }}>
            <Button
              label={t('commerce.exceptionFermer')}
              variant="secondary"
              loading={envoi}
              onPress={() => void agir(() => api.fermerUneJournee(businessId, jour))}
              testID="fermer-aujourdhui"
            />
          </View>
        </>
      )}

      {/* **Ce que le geste ne touche pas**, et c'est la question qu'on se pose
          avant d'appuyer. */}
      <Texte variante="type.caption" couleur="ink.soft">
        {t('commerce.exceptionReservationsGardees')}
      </Texte>

      {echec ? <StatusMessage level="danger" body={echec} testID="echec-exception" /> : null}
    </View>
  );
}
