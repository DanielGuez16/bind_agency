/**
 * 08 · Historique du créateur.
 *
 * **Les compteurs d'onglets arrivent avant la liste.** Ils viennent de la même
 * réponse, calculés sur tout l'historique et non sur la page : un onglet qui
 * annonce « 3 » parce que la première page en contient trois ment dès la
 * seconde.
 *
 * **Chaque onglet a son propre état vide.** Un historique où seul l'onglet
 * « à venir » est vide n'est pas un historique vide, et lui montrer le même
 * message serait faux.
 *
 * **L'heure s'affiche dans le fuseau du commerce.** Un rendez-vous se prend là
 * où il a lieu ; l'afficher dans le fuseau du téléphone ferait rater des
 * rendez-vous à quiconque voyage.
 */
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import {
  useApi,
  type BookingStatus,
  type HistoriqueDuCreateur,
  type ReservationDuCreateur,
} from '../api';
import { EmptyState, SegmentedTabs, ServiceRow, Texte } from '../components';
import { useI18n } from '../i18n';
import { Ecran } from './Ecran';
import { useRequete } from './useRequete';

/** Les trois onglets, et les statuts que chacun couvre. */
const ONGLETS: { cle: string; libelle: string; statuts: BookingStatus[] }[] = [
  { cle: 'a-venir', libelle: 'parcours.ongletAVenir', statuts: ['held', 'confirmed'] },
  { cle: 'en-cours', libelle: 'parcours.ongletEnCours', statuts: ['consumed'] },
  {
    cle: 'terminees',
    libelle: 'parcours.ongletTerminees',
    // `expired`, `cancelled` et `no_show` sont des fins, pas des absences. Les
    // omettre ferait disparaître de l'écran des réservations dont quelqu'un se
    // souvient.
    statuts: ['cancelled', 'no_show', 'expired'],
  },
];

export function HistoriqueScreen({
  onOuvrir,
}: {
  onOuvrir: (reservation: ReservationDuCreateur) => void;
}) {
  const { api } = useApi();
  const { t } = useI18n();
  const [index, setIndex] = useState(0);

  const statuts = ONGLETS[index].statuts;
  const requete = useRequete<HistoriqueDuCreateur>(
    (signal) => api.mesReservations({ statuts }, signal),
    { estVide: (vue) => vue.items.length === 0, dependances: [index] },
  );

  // Les compteurs sont ceux de la réponse, quel que soit l'onglet lu : ils
  // portent sur tout l'historique.
  const compteurs = useMemo(() => {
    const source =
      requete.etat === 'pret'
        ? requete.donnees.compteurs
        : requete.etat === 'erreur' && requete.donnees
          ? requete.donnees.compteurs
          : null;
    return ONGLETS.map((onglet) =>
      source === null
        ? undefined
        : onglet.statuts.reduce((total, statut) => total + (source[statut] ?? 0), 0),
    );
  }, [requete]);

  return (
    <Ecran
      requete={requete}
      titre={t('parcours.historiqueTitre')}
      testID="ecran-historique"
      vide={
        <View style={{ gap: 12 }}>
          <Onglets index={index} onChange={setIndex} compteurs={compteurs} />
          <EmptyState
            title={t(ONGLETS[index].libelle)}
            body={t('parcours.historiqueVide')}
            testID="onglet-vide"
          />
        </View>
      }
    >
      {(vue) => (
        <View style={{ gap: 12 }}>
          <Onglets index={index} onChange={setIndex} compteurs={compteurs} />
          {vue.items.map((reservation) => (
            <View key={reservation.booking_id} testID={`reservation-${reservation.booking_id}`}>
              <ServiceRow
                name={reservation.business_name}
                meta={heureLocaleDuCommerce(reservation)}
                tier={reservation.content_format}
                right={
                  <Texte variante="type.caption" couleur="text.secondary">
                    {reservation.item_name}
                  </Texte>
                }
              />
              {reservation.contrepartie ? (
                <Texte
                  variante="type.caption"
                  couleur="text.secondary"
                  testID={`contrepartie-${reservation.booking_id}`}
                >
                  {reservation.contrepartie.status}
                </Texte>
              ) : null}
            </View>
          ))}
        </View>
      )}
    </Ecran>
  );
}

function Onglets({
  index,
  onChange,
  compteurs,
}: {
  index: number;
  onChange: (i: number) => void;
  compteurs: (number | undefined)[];
}) {
  const { t } = useI18n();
  return (
    <SegmentedTabs
      testID="onglets"
      index={index}
      onChange={onChange}
      items={ONGLETS.map((onglet, i) => ({
        label: t(onglet.libelle),
        count: compteurs[i],
      }))}
    />
  );
}

/**
 * L'heure du rendez-vous, dans le fuseau du commerce.
 *
 * Sur un item sans créneau, il n'y a pas d'heure : c'est une fenêtre de
 * validité. En inventer une afficherait un rendez-vous qui n'existe pas.
 */
function heureLocaleDuCommerce(reservation: ReservationDuCreateur): string {
  const instant = reservation.starts_at ?? reservation.valid_until;
  return new Date(instant).toLocaleString([], { timeZone: reservation.business_timezone });
}
