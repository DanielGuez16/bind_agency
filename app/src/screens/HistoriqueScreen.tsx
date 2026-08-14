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
import { Pressable, View } from 'react-native';

import {
  useApi,
  type BookingStatus,
  type HistoriqueDuCreateur,
  type ReservationDuCreateur,
} from '../api';
import {
  Apparition,
  EmptyState,
  SegmentedTabs,
  ServiceRow,
  StatusMessage,
  Texte,
} from '../components';
import { useI18n, type SupportedLocale } from '../i18n';
import { formatDateTime } from '../format';
import { Ecran } from './Ecran';
import { useRequete } from './useRequete';

/** Les trois onglets, et les statuts que chacun couvre. */
const ONGLETS: { cle: string; libelle: string; statuts: BookingStatus[] }[] = [
  {
    cle: 'a-venir',
    libelle: 'parcours.ongletAVenir',
    // `awaiting_business` est à venir, pas en cours : la place est tenue et le
    // rendez-vous existe. Le ranger ailleurs le ferait disparaître de l'onglet
    // où on le cherche, pendant les quelques heures qui comptent.
    statuts: ['held', 'awaiting_business', 'confirmed'],
  },
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
  const { t, locale } = useI18n();
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
          {vue.items.map((reservation, rang) => {
            const ouvrable = destination(reservation) !== null;
            return (
              <Apparition key={reservation.booking_id} rang={rang}>
              <Pressable
                testID={`reservation-${reservation.booking_id}`}
                accessibilityRole={ouvrable ? 'button' : undefined}
                accessibilityLabel={ouvrable ? reservation.business_name : undefined}
                // Pressable seulement quand il y a quelque chose derrière. Une
                // ligne qui répond au doigt sans rien ouvrir apprend à ne plus
                // essayer, et c'est tout l'écran qui devient inerte.
                disabled={!ouvrable}
                onPress={() => onOuvrir(reservation)}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
              >
                <ServiceRow
                  name={reservation.business_name}
                  meta={heureLocaleDuCommerce(reservation, locale)}
                  tier={reservation.content_format}
                  right={
                    <Texte variante="type.caption" couleur="ink.soft">
                      {ouvrable ? t(`parcours.ouvrir_${destination(reservation)}`) : ''}
                    </Texte>
                  }
                />
                {/* L'attente se dit, avec ce qu'elle implique. Une ligne muette
                    entre « réservé » et « code disponible » se lit comme une
                    panne, et c'est le moment où l'on écrit au support. */}
                {reservation.status === 'awaiting_business' ? (
                  <StatusMessage
                    level="neutral"
                    body={t('parcours.enAttenteDuSalon')}
                    testID={`en-attente-${reservation.booking_id}`}
                  />
                ) : null}
                <Texte variante="type.caption" couleur="ink.soft">
                  {reservation.item_name}
                </Texte>
                {reservation.contrepartie ? (
                  <Texte
                    variante="type.caption"
                    couleur="ink.soft"
                    testID={`contrepartie-${reservation.booking_id}`}
                  >
                    {t(`contrepartie.${reservation.contrepartie.status}`)}
                  </Texte>
                ) : null}
              </Pressable>
              </Apparition>
            );
          })}
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
 * Ce qu'une ligne ouvre, ou rien.
 *
 * **Une réservation confirmée mène à son code de retrait.** C'est le geste
 * principal du produit, et il n'était atteignable qu'immédiatement après la
 * confirmation : fermer l'application faisait perdre le code jusqu'au rendez-
 * vous. Une prestation consommée mène à sa contrepartie, où l'on envoie la
 * preuve. Le reste ne mène nulle part, et ne se prétend donc pas pressable.
 *
 * **Confirmée seulement, ni retenue ni en attente du salon.** Le code naît à la
 * confirmation ; une réservation retenue n'en a pas, et une réservation que le
 * salon n'a pas encore acceptée non plus — le serveur refuse dans les deux cas.
 * La ligne proposait « voir le code » sur une réservation qui n'en avait aucun.
 */
export function destination(
  reservation: ReservationDuCreateur,
): 'code' | 'preuve' | null {
  if (reservation.status === 'confirmed') return 'code';
  if (reservation.contrepartie) return 'preuve';
  return null;
}

/**
 * L'heure du rendez-vous, dans le fuseau du commerce.
 *
 * Sur un item sans créneau, il n'y a pas d'heure : c'est une fenêtre de
 * validité. En inventer une afficherait un rendez-vous qui n'existe pas.
 */
function heureLocaleDuCommerce(
  reservation: ReservationDuCreateur,
  locale: SupportedLocale,
): string {
  const instant = reservation.starts_at ?? reservation.valid_until;
  // `toLocaleString` sans options rendait « 11/08/2026 16:45:00 » : un mois en
  // chiffres, que la moitié du monde lit à l'envers, et des secondes sur un
  // rendez-vous en salon. `formatDateTime` porte le format de la maison —
  // mois en lettres, heure à la minute.
  return formatDateTime(instant, locale, reservation.business_timezone);
}
