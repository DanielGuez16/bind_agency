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
 * **Aucun montant.** L'écran de journée n'est pas un état de caisse.
 */
import { View } from 'react-native';

import { useApi, type JourneeDuCommerce, type ReservationDuCommerce } from '../api';
import { DataRow, EmptyState, Texte } from '../components';
import { useI18n } from '../i18n';
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
      {(journee) => (
        <View style={{ gap: 4 }}>
          {journee.items.map((reservation) => (
            <Ligne key={reservation.booking_id} reservation={reservation} timezone={journee.timezone} />
          ))}
        </View>
      )}
    </Ecran>
  );
}

function Ligne({
  reservation,
  timezone,
}: {
  reservation: ReservationDuCommerce;
  timezone: string;
}) {
  const { t } = useI18n();

  // Sur un droit sans créneau, il n'y a pas d'heure. En inventer une ferait
  // attendre quelqu'un à une heure que personne ne lui a donnée.
  const heure = reservation.starts_at
    ? new Date(reservation.starts_at).toLocaleTimeString([], {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : t('commerce.journeeSansCreneau');

  const nom =
    [reservation.creator_first_name, reservation.creator_last_name].filter(Boolean).join(' ') ||
    reservation.creator_handle ||
    '';

  return (
    <View testID={`reservation-${reservation.booking_id}`}>
      <DataRow label={heure} value={nom} />
      <Texte variante="type.caption" couleur="text.secondary">
        {reservation.item_name} · {reservation.status}
      </Texte>
    </View>
  );
}
