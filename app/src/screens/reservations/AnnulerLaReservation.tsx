import { useState } from 'react';
import { View } from 'react-native';

import { useApi, type ReservationDuCreateur } from '../../api';
import { Button, StatusMessage, Texte, vibration } from '../../components';
import { useI18n } from '../../i18n';
import { porteeDeLAnnulation } from './annulation';

/**
 * Annuler une réservation, et le dire avant de le faire.
 *
 * **Deux appuis, et le second n'est pas une politesse.** `cancelled` est un
 * état terminal : rien ne revient dessus, et la place repart au salon. Un
 * bouton unique dans une liste qu'on parcourt au pouce annulerait un
 * rendez-vous par frôlement.
 *
 * **La conséquence est écrite entre les deux appuis, pas après.** Sur une
 * réservation confirmée avec un créneau, annuler trop près de l'heure ne
 * l'annule pas : elle devient une absence, qui pèse sur la fiabilité et que
 * l'historique range au passif. La créatrice doit le lire pendant qu'elle peut
 * encore renoncer — le lui apprendre par une pastille rouge le lendemain
 * serait lui avoir tendu un piège.
 *
 * **Ce que l'écran ne dit pas est quand.** Le seuil est un réglage et il n'est
 * pas servi ; l'inventer ici le ferait dériver au premier ajustement. La phrase
 * porte donc la conséquence sans l'heure. C'est moins utile que « libre jusqu'à
 * 14 h 30 », et c'est ce qu'on sait.
 */
export function AnnulerLaReservation({
  reservation,
  onAnnulee,
}: {
  reservation: ReservationDuCreateur;
  onAnnulee: () => void;
}) {
  const { api, messageDErreur } = useApi();
  const { t } = useI18n();
  const [confirme, setConfirme] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);

  const portee = porteeDeLAnnulation(reservation);
  if (portee === 'close') return null;

  async function annuler() {
    setEchec(null);
    setEnvoi(true);
    try {
      await api.annulerLaReservation(reservation.booking_id);
      vibration.action();
      onAnnulee();
    } catch (erreur) {
      setEchec(messageDErreur(erreur));
      vibration.echec();
    } finally {
      setEnvoi(false);
    }
  }

  if (!confirme) {
    return (
      <View style={{ flexDirection: 'row' }}>
        <Button
          label={t('parcours.annuler')}
          size="sm"
          variant="ghost"
          fullWidth={false}
          onPress={() => setConfirme(true)}
          testID={`annuler-${reservation.booking_id}`}
        />
      </View>
    );
  }

  return (
    <View style={{ gap: 8 }} testID={`confirmer-annulation-${reservation.booking_id}`}>
      {portee === 'peut-couter' ? (
        <StatusMessage
          level="warning"
          body={t('parcours.annulerPeutCouter')}
          testID={`annuler-avertissement-${reservation.booking_id}`}
        />
      ) : (
        <Texte
          variante="type.caption"
          couleur="ink.soft"
          testID={`annuler-libre-${reservation.booking_id}`}
        >
          {t('parcours.annulerSansFrais')}
        </Texte>
      )}

      {echec ? (
        <StatusMessage
          level="danger"
          body={echec}
          testID={`annuler-echec-${reservation.booking_id}`}
        />
      ) : null}

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button
          label={t('parcours.annulerConfirmer')}
          size="sm"
          variant="ghost"
          fullWidth={false}
          loading={envoi}
          onPress={() => void annuler()}
          testID={`annuler-oui-${reservation.booking_id}`}
        />
        <Button
          label={t('parcours.annulerGarder')}
          size="sm"
          variant="ghost"
          fullWidth={false}
          onPress={() => {
            setConfirme(false);
            setEchec(null);
          }}
          testID={`annuler-non-${reservation.booking_id}`}
        />
      </View>
    </View>
  );
}
