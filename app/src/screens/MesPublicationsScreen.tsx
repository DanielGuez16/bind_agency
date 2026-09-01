/**
 * Ce que j'ai publié, et pour qui.
 *
 * **Aucune route ne sert cette liste, et il n'en faut pas une.** Une
 * publication est une contrepartie honorée : `/me/bookings` porte déjà les
 * réservations et l'état de leur contrepartie. Ouvrir une route pour recomposer
 * la même chose ferait deux sources du même fait, qui finiraient par diverger —
 * c'est exactement ce que le menu du commerce a évité en lisant le catalogue
 * plutôt qu'en recomptant.
 *
 * **Honorée veut dire acceptée, pas envoyée.** Une preuve soumise et en cours
 * de contrôle n'est pas une publication : la compter ici ferait dire à
 * quelqu'un qu'il a tenu un engagement que le salon peut encore refuser.
 */
import { View } from 'react-native';

import { useApi, type ReservationDuCreateur } from '../api';
import { EmptyState, Photo, SkeletonLignes, Texte } from '../components';
import { formatDate } from '../format';
import { useI18n } from '../i18n';
import { radius } from '../theme';
import { Ecran } from './Ecran';
import { useRequete } from './useRequete';

/** Les réservations dont la contrepartie a été acceptée. */
export function publications(items: ReservationDuCreateur[]): ReservationDuCreateur[] {
  return items.filter((item) => item.contrepartie?.status === 'approved');
}

export function MesPublicationsScreen({ onRetour }: { onRetour: () => void }) {
  const { api } = useApi();
  const { t, locale } = useI18n();

  const requete = useRequete<ReservationDuCreateur[]>(
    async (signal) => publications((await api.mesReservations({}, signal)).items),
    { estVide: (liste) => liste.length === 0 },
  );

  return (
    <Ecran
      requete={requete}
      titre={t('profil.mesPublications')}
      onRetour={onRetour}
      squelette={<SkeletonLignes combien={5} testID="squelette-publications" />}
      testID="ecran-mes-publications"
      vide={
        <EmptyState
          title={t('profil.publicationsVideTitre')}
          body={t('profil.publicationsVideCorps')}
          testID="publications-vide"
        />
      }
    >
      {(liste) => (
        <View style={{ gap: 12 }} testID="liste-des-publications">
          {liste.map((item) => (
            <View
              key={item.booking_id}
              testID={`publication-${item.booking_id}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
            >
              {api.urlDeLaVignette(item.item_photo_key) ? (
                <Photo
                  uri={api.urlDeLaVignette(item.item_photo_key)}
                  hauteur={56}
                  style={{ width: 56, borderRadius: radius['radius.photo'] }}
                />
              ) : null}
              <View style={{ flexShrink: 1, gap: 2 }}>
                <Texte variante="type.body">{item.item_name}</Texte>
                <Texte variante="type.caption" couleur="ink.soft">
                  {[
                    item.business_name,
                    // **Dans le fuseau du salon, comme partout ailleurs.** Une
                    // publication datée sur le fuseau du téléphone changerait de
                    // jour en voyageant, sur une liste qui dit ce qu'on a fait.
                    item.starts_at
                      ? formatDate(item.starts_at, locale, item.business_timezone)
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Texte>
              </View>
            </View>
          ))}
        </View>
      )}
    </Ecran>
  );
}
