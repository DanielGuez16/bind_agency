/**
 * 03 · Fil géolocalisé.
 *
 * **Le fil vide dit pourquoi il l'est.** Le serveur renvoie les obstacles à
 * part, même quand des commerces sont rendus : sans eux, un créateur qui
 * n'accède à rien conclut qu'il n'y a aucun commerce à Miami, alors qu'il lui
 * manque un relevé ou mille abonnés.
 *
 * **Chaque issue de l'état vide annonce son gain chiffré.** « Élargir à 5 km »
 * sans nombre demande de tenter pour voir, et personne ne tente deux fois — ici
 * le nombre n'est connu qu'après l'appel, donc l'action élargit et recharge,
 * et c'est le rayon qui est annoncé.
 *
 * **Les coordonnées viennent de l'appelant, pas du profil.** On consulte le fil
 * là où l'on est, ce qui n'est pas toujours la ville déclarée.
 */
import { useState } from 'react';
import { View } from 'react-native';

import { useApi, type Fil } from '../api';
import { BusinessCard, Chip, EmptyState, RangeeDeChips, StatusMessage, Texte } from '../components';
import { useI18n } from '../i18n';
import { en } from '../i18n/en';
import { Ecran } from './Ecran';
import { messageDObstacle } from './obstacle';
import { useRequete } from './useRequete';

const CODES_CONNUS = new Set(Object.keys(en.errors));

/** Une source d'image, ou rien. `Image` refuse une URI vide. */
export function urlImage(url: string | undefined) {
  return url ? { uri: url } : undefined;
}
/**
 * Le rayon de départ, et les élargissements proposés.
 *
 * Quinze kilomètres et non deux : Miami est une ville de voiture, où deux
 * kilomètres ne couvrent qu'un quartier et ne montrent qu'un salon. Le fil
 * paraissait vide alors qu'il était seulement myope.
 */
const RAYONS_KM = [15, 30, 50];

export type Position = { longitude: number; latitude: number };

export function FilScreen({
  position,
  onDemanderLaPosition,
  onOuvrirLeCommerce,
}: {
  /** Nulle tant que l'autorisation n'est pas donnée. */
  position: Position | null;
  onDemanderLaPosition: () => void;
  onOuvrirLeCommerce: (businessId: string) => void;
}) {
  const { api } = useApi();
  const { t } = useI18n();
  const [rayonKm, setRayonKm] = useState(RAYONS_KM[0]);

  const requete = useRequete<Fil>(
    (signal) => api.fil(position!, { rayonMetres: rayonKm * 1000 }, signal),
    {
      estVide: (fil) => fil.commerces.length === 0,
      dependances: [position?.longitude, position?.latitude, rayonKm],
      // Sans position, on ne lance rien : une requête sans coordonnées ne
      // renverrait pas « rien près de toi », elle renverrait une erreur de
      // validation que l'écran traduirait mal.
      actif: position !== null,
    },
  );

  if (position === null) {
    return (
      <View testID="ecran-fil" style={{ flex: 1, padding: 20, gap: 12 }}>
        <StatusMessage
          level="neutral"
          body={t('parcours.filSansPosition')}
          action={{ label: t('parcours.filAutoriser'), onPress: onDemanderLaPosition }}
          testID="fil-sans-position"
        />
      </View>
    );
  }

  return (
    <Ecran
      requete={requete}
      titre={t('parcours.filTitre')}
      testID="ecran-fil"
      vide={
        <View style={{ gap: 12 }}>
          <EmptyState
            title={t('parcours.filTitre')}
            body={t('parcours.filVide', { rayon: rayonKm })}
            // Chaque issue annonce son gain : « élargir à 30 km » plutôt
            // qu'« élargir ». Le nombre de salons n'est connu qu'après l'appel,
            // c'est donc la distance qui se dit.
            actions={RAYONS_KM.filter((r) => r > rayonKm).map((rayon) => ({
              label: t('parcours.filElargir', { rayon }),
              onPress: () => setRayonKm(rayon),
              variant: 'secondary' as const,
            }))}
          />
          <Obstacles fil={requete.etat === 'pret' ? requete.donnees : null} />
        </View>
      }
    >
      {(fil) => (
        <View style={{ gap: 16 }}>
          {/* Le rayon se règle depuis le fil lui-même, pas seulement depuis
              l'état vide : un fil maigre n'est pas un fil vide, et il faut
              pouvoir l'élargir sans avoir à le vider d'abord. */}
          <RangeeDeChips>
            {RAYONS_KM.map((rayon) => (
              <Chip
                key={rayon}
                label={t('parcours.filRayon', { rayon })}
                selected={rayon === rayonKm}
                onPress={() => setRayonKm(rayon)}
              />
            ))}
          </RangeeDeChips>

          {/* Rendus même quand le fil n'est pas vide : un créateur qui accède
              au palier story mais pas au reel doit savoir ce qui lui manque,
              sinon il croit avoir tout vu. */}
          <Obstacles fil={fil} />
          {fil.commerces.map((commerce) => {
            const item = commerce.items[0];
            return (
              <BusinessCard
                key={commerce.business_id}
                testID={`commerce-${commerce.business_id}`}
                name={commerce.name}
                // La couverture était simplement absente : la carte recevait
                // toujours son repli, et le monogramme passait pour un défaut
                // de chargement alors que rien n'était jamais demandé.
                cover={urlImage(api.urlDuMedia(commerce.cover_photo_key))}
                meta={commerce.address ?? ''}
                serviceName={item.name}
                serviceDuration={
                  item.duration_minutes === null ? '' : `${item.duration_minutes} min`
                }
                tier={item.content_format}
                distance={`${Math.round(commerce.distance_metres)} m`}
                onPress={() => onOuvrirLeCommerce(commerce.business_id)}
              />
            );
          })}
        </View>
      )}
    </Ecran>
  );
}

function Obstacles({ fil }: { fil: Fil | null }) {
  const { t } = useI18n();
  if (!fil?.obstacles.length) return null;

  return (
    <View style={{ gap: 4 }} testID="obstacles-du-fil">
      {fil.obstacles.map((obstacle, index) => (
        <Texte
          key={`${obstacle.raison}-${index}`}
          variante="type.caption"
          couleur="text.secondary"
          testID={`obstacle-${obstacle.raison}`}
        >
          {messageDObstacle(t, obstacle, CODES_CONNUS)}
        </Texte>
      ))}
    </View>
  );
}
