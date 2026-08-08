/**
 * 12a · La journée du comptoir.
 *
 * **L'heure est celle du commerce, découpée dans son fuseau.** Le serveur rend
 * les bornes qu'il a réellement utilisées ; l'écran les affiche telles quelles
 * plutôt que de recalculer, sinon deux découpages coexisteraient et l'un des
 * deux serait faux.
 *
 * **Les droits sans créneau figurent dans la liste**, après le planning. Ils se
 * présentent au comptoir ce jour-là comme les autres ; les omettre ferait
 * arriver quelqu'un qui n'est sur aucune liste.
 *
 * **Ce qui attend une décision passe devant.** Une réservation en attente tient
 * une place et bloque une créatrice qui ne peut rien faire d'autre que patienter
 * ; la laisser au milieu du planning, dans l'ordre des heures, la ferait
 * découvrir en la cherchant. Le bloc disparaît quand il est vide.
 *
 * **Se désister n'est pas constater une absence.** Deux actions distinctes,
 * jamais deux libellés de la même : l'une ne pénalise personne, l'autre inscrit
 * un événement négatif au dossier de la créatrice. Les réunir sous un même
 * bouton ferait de la pénalité une case à cocher.
 *
 * **Aucun montant.** L'écran de journée n'est pas un état de caisse.
 */
import { useState } from 'react';
import { View } from 'react-native';

import { useApi, type JourneeDuCommerce, type ReservationDuCommerce } from '../api';
import {
  Apparition,
  Button,
  DataRow,
  EmptyState,
  Filet,
  StatusMessage,
  TextField,
  Texte,
  vibration,
} from '../components';
import { useI18n } from '../i18n';
import { useTheme } from '../theme';
import { Ecran } from './Ecran';
import { useRequete } from './useRequete';

export function JourneeScreen({ businessId, jour }: { businessId: string; jour?: string }) {
  const { api } = useApi();
  const { t } = useI18n();

  const requete = useRequete<JourneeDuCommerce>(
    (signal) => api.journeeDuCommerce(businessId, jour, signal),
    { estVide: (journee) => journee.items.length === 0, dependances: [businessId, jour] },
  );

  return (
    <Ecran
      requete={requete}
      titre={t('commerce.journeeTitre')}
      testID="ecran-journee"
      vide={
        <EmptyState
          title={t('commerce.journeeTitre')}
          body={t('commerce.journeeVide')}
          testID="journee-vide"
        />
      }
    >
      {(journee) => {
        // La file vient du serveur, pas d'un filtre sur la journée : une
        // décision à prendre pour après-demain n'est dans aucune journée qu'on
        // ouvre, et la filtrer ici l'aurait laissée invisible.
        const aTrancher = journee.a_trancher;
        const planning = journee.items.filter((r) => r.status !== 'awaiting_business');

        return (
          <View style={{ gap: 16 }}>
            {aTrancher.length > 0 ? (
              <View style={{ gap: 10 }} testID="a-trancher">
                <Texte variante="type.label" couleur="text.secondary">
                  {t('commerce.aTrancher', { count: aTrancher.length })}
                </Texte>
                {aTrancher.map((reservation, rang) => (
                  <Apparition key={reservation.booking_id} rang={rang}>
                    <Decision
                      reservation={reservation}
                      timezone={journee.timezone}
                      onFait={requete.recharger}
                    />
                  </Apparition>
                ))}
                <Filet marge={4} />
              </View>
            ) : null}

            <View style={{ gap: 4 }}>
              {planning.map((reservation) => (
                <Ligne
                  key={reservation.booking_id}
                  reservation={reservation}
                  timezone={journee.timezone}
                  onFait={requete.recharger}
                />
              ))}
            </View>
          </View>
        );
      }}
    </Ecran>
  );
}

/**
 * L'heure du rendez-vous, dans le fuseau du commerce.
 *
 * Sur un droit sans créneau il n'y a pas d'heure. En inventer une ferait
 * attendre quelqu'un à une heure que personne ne lui a donnée.
 */
function heureDe(reservation: ReservationDuCommerce, timezone: string, sansCreneau: string) {
  return reservation.starts_at
    ? new Date(reservation.starts_at).toLocaleTimeString([], {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : sansCreneau;
}

function nomDe(reservation: ReservationDuCommerce) {
  return (
    [reservation.creator_first_name, reservation.creator_last_name].filter(Boolean).join(' ') ||
    reservation.creator_handle ||
    ''
  );
}

function Ligne({
  reservation,
  timezone,
  onFait,
}: {
  reservation: ReservationDuCommerce;
  timezone: string;
  onFait: () => void;
}) {
  const { t } = useI18n();

  return (
    <View testID={`reservation-${reservation.booking_id}`}>
      <DataRow
        label={heureDe(reservation, timezone, t('commerce.journeeSansCreneau'))}
        value={nomDe(reservation)}
      />
      <Texte variante="type.caption" couleur="text.secondary">
        {/* Le statut traduit, jamais son code. `awaiting_business` affiché tel
            quel se lisait comme une chaîne oubliée — parce que c'en était une. */}
        {reservation.item_name} · {t(`commerce.statut_${reservation.status}`)}
      </Texte>
      {reservation.status === 'confirmed' ? (
        <MotifPuisAction
          libelle={t('commerce.seDesister')}
          aide={t('commerce.seDesisterAide')}
          variante="danger"
          testID={`desister-${reservation.booking_id}`}
          onValider={(motif, api) => api.seDesisterDeLaReservation(reservation.booking_id, motif)}
          onFait={onFait}
        />
      ) : null}
    </View>
  );
}

/** Une réservation en attente : la créatrice, l'heure, et les deux issues. */
function Decision({
  reservation,
  timezone,
  onFait,
}: {
  reservation: ReservationDuCommerce;
  timezone: string;
  onFait: () => void;
}) {
  const { api, messageDErreur } = useApi();
  const { t } = useI18n();
  const { color: c } = useTheme();

  const [envoi, setEnvoi] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);

  async function accorder() {
    setEnvoi(true);
    setEchec(null);
    vibration.action();
    try {
      await api.accorderLaReservation(reservation.booking_id);
      vibration.reussite();
      onFait();
    } catch (erreur) {
      vibration.echec();
      setEchec(messageDErreur(erreur));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <View
      testID={`decision-${reservation.booking_id}`}
      style={{
        gap: 10,
        padding: 14,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: c['border.default'],
        backgroundColor: c['bg.surface'],
      }}
    >
      <DataRow
        label={heureDe(reservation, timezone, t('commerce.journeeSansCreneau'))}
        value={nomDe(reservation)}
      />
      <Texte variante="type.caption" couleur="text.secondary">
        {reservation.item_name}
      </Texte>

      {echec ? <StatusMessage level="danger" body={echec} testID="echec-decision" /> : null}

      <Button
        label={t('commerce.accorder')}
        loading={envoi}
        onPress={() => void accorder()}
        testID={`accorder-${reservation.booking_id}`}
      />
      <MotifPuisAction
        libelle={t('commerce.refuser')}
        aide={t('commerce.refuserAide')}
        variante="secondary"
        testID={`refuser-${reservation.booking_id}`}
        onValider={(motif, api) => api.refuserLaReservation(reservation.booking_id, motif)}
        onFait={onFait}
      />
    </View>
  );
}

/**
 * Une action qui exige un motif : le bouton ouvre le champ, le champ valide.
 *
 * En deux temps et non en une boîte de dialogue : la créatrice lira ce texte,
 * et une saisie obligatoire posée devant quelqu'un qui voulait juste refuser se
 * remplit de « ok ». Le bouton de validation reste absent tant que le motif est
 * trop court — retiré, jamais grisé.
 */
function MotifPuisAction({
  libelle,
  aide,
  variante,
  testID,
  onValider,
  onFait,
}: {
  libelle: string;
  aide: string;
  variante: 'secondary' | 'danger';
  testID: string;
  onValider: (motif: string, api: ReturnType<typeof useApi>['api']) => Promise<unknown>;
  onFait: () => void;
}) {
  const { api, messageDErreur } = useApi();
  const { t } = useI18n();

  const [ouvert, setOuvert] = useState(false);
  const [motif, setMotif] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);

  /** Trois caractères : le serveur exige la même chose, et refuse « no ». */
  const suffisant = motif.trim().length >= 3;

  async function valider() {
    setEnvoi(true);
    setEchec(null);
    vibration.action();
    try {
      await onValider(motif.trim(), api);
      vibration.reussite();
      setOuvert(false);
      setMotif('');
      onFait();
    } catch (erreur) {
      vibration.echec();
      setEchec(messageDErreur(erreur));
    } finally {
      setEnvoi(false);
    }
  }

  if (!ouvert) {
    return (
      <Button
        label={libelle}
        variant={variante}
        onPress={() => setOuvert(true)}
        testID={testID}
      />
    );
  }

  return (
    <View style={{ gap: 8 }} testID={`${testID}-motif`}>
      <TextField
        label={libelle}
        value={motif}
        onChangeText={setMotif}
        helpText={aide}
        testID={`${testID}-champ`}
      />
      {echec ? <StatusMessage level="danger" body={echec} testID="echec-decision" /> : null}
      {suffisant ? (
        <Button
          label={t('commerce.envoyerLeMotif')}
          variant={variante}
          loading={envoi}
          onPress={() => void valider()}
          testID={`${testID}-valider`}
        />
      ) : null}
      <Button
        label={t('common.annuler')}
        variant="ghost"
        onPress={() => {
          setOuvert(false);
          setMotif('');
          setEchec(null);
        }}
        testID={`${testID}-renoncer`}
      />
    </View>
  );
}
