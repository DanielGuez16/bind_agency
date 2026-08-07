/**
 * 05a · Choix du créneau, 05b · confirmation.
 *
 * **Un créneau pris reste visible.** Il donne le rythme du salon ; une grille
 * où ne restent que les trous laisse croire à un commerce vide, ou à un bug.
 *
 * **La réservation naît en `held`.** Le droit n'est acquis qu'à la
 * confirmation, et c'est elle qui crée le code. Le laisser en attente
 * silencieuse ferait croire à une place gardée qui ne l'est pas.
 */
import { useState } from 'react';
import { View } from 'react-native';

import { useApi, type Creneau as CreneauApi, type FichePublique, type OffreDeLaFiche } from '../api';
import { Button, EmptyState, SlotPicker, StatusMessage, Texte } from '../components';
import { useI18n } from '../i18n';
import { Ecran } from './Ecran';
import { useRequete } from './useRequete';

export function CreneauxScreen({
  fiche,
  offre,
  onReserve,
}: {
  fiche: FichePublique;
  offre: OffreDeLaFiche;
  onReserve: (bookingId: string) => void;
}) {
  const { api, messageDErreur } = useApi();
  const { t } = useI18n();
  const [choisi, setChoisi] = useState<string | undefined>();
  const [envoi, setEnvoi] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);

  const requete = useRequete<CreneauApi[]>(
    (signal) => api.disponibilite(fiche.business_id, offre.catalog_item_id, signal),
    { estVide: (creneaux) => creneaux.length === 0, dependances: [offre.catalog_item_id] },
  );

  async function reserver() {
    if (!offre.social_account_id) return;
    setEnvoi(true);
    setEchec(null);
    try {
      const booking = await api.reserver({
        tier_offer_id: offre.tier_offer_id,
        social_account_id: offre.social_account_id,
        starts_at: offre.requires_booking ? choisi : null,
      });
      await api.confirmerLaReservation(booking.id);
      onReserve(booking.id);
    } catch (erreur) {
      // Le message vient du catalogue : `booking_slot_unavailable` dit à
      // quelqu'un que la place vient d'être prise, pas « erreur 409 ».
      setEchec(messageDErreur(erreur));
      // La place a peut-être été prise pendant l'hésitation : on relit.
      requete.recharger();
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Ecran
      requete={requete}
      titre={t('parcours.creneauxTitre')}
      testID="ecran-creneaux"
      vide={<EmptyState title={t('parcours.creneauxTitre')} body={t('parcours.creneauxVide')} />}
    >
      {(creneaux) => (
        <View style={{ gap: 12 }}>
          <Texte variante="type.heading">{offre.name}</Texte>

          <SlotPicker
            creneaux={creneaux.map((creneau) => ({
              cle: creneau.starts_at,
              heure: new Date(creneau.starts_at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              }),
              pris: creneau.places_restantes <= 0,
            }))}
            selection={choisi}
            onChange={setChoisi}
          />

          {echec ? <StatusMessage level="danger" body={echec} testID="echec-reservation" /> : null}

          {/* Retiré tant qu'aucun créneau n'est choisi : le griser demanderait
              de deviner ce qui manque. */}
          {choisi || !offre.requires_booking ? (
            <Button
              label={t('parcours.confirmer')}
              size="lg"
              loading={envoi}
              onPress={reserver}
              testID="confirmer"
            />
          ) : null}
        </View>
      )}
    </Ecran>
  );
}
