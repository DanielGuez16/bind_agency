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
 *
 * **L'image est celle de la publication, et c'était le défaut.** L'écran
 * montrait `item_photo_key` — la photo du **service au catalogue du salon**.
 * Une liste de mes publications illustrée par les images d'autrui n'est pas une
 * liste de mes publications : on y reconnaissait le salon, jamais ce qu'on y
 * avait fait. L'objet archivé existe depuis la phase 7, il ne descendait
 * simplement pas jusqu'ici.
 *
 * **La photo du service reste, en dernier recours.** Une capture de niveau 2
 * peut n'avoir qu'une adresse sans objet archivé ; un trou gris à la place
 * serait pire que l'image approchante, du moment que la ligne dit où mène le
 * lien.
 */
import { useEffect, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';

import { useApi, type ReservationDuCreateur } from '../api';
import { EmptyState, Icone, MediaFallback, Photo, SkeletonLignes, Texte } from '../components';
import { formatDate } from '../format';
import { useI18n } from '../i18n';
import { radius, useColors } from '../theme';
import { Ecran } from './Ecran';
import { useRequete } from './useRequete';

/** Le côté de la vignette. */
const VIGNETTE = 56;

/** Les réservations dont la contrepartie a été acceptée. */
export function publications(items: ReservationDuCreateur[]): ReservationDuCreateur[] {
  return items.filter((item) => item.contrepartie?.status === 'approved');
}

/**
 * L'image de la publication, quand elle est archivée.
 *
 * **Le droit de lecture se demande, il ne se déduit pas d'une clé.** Une preuve
 * n'est jamais servie par une adresse devinable : l'API délivre un droit court
 * et signé, et c'est lui qui ouvre l'objet. La créatrice y a droit sur **sa**
 * publication — le serveur le vérifie sur la réservation, pas sur ce que
 * l'écran demande.
 *
 * **Rien n'est tenté sans objet.** `post_a_une_image` faux veut dire qu'aucun
 * fichier n'a été archivé ; demander quand même rendrait un 404 qui s'afficherait
 * comme une panne du produit.
 */
function usePhotoDeLaPublication(
  proofId: string | null,
  aUneImage: boolean,
): string | null {
  const { api } = useApi();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!proofId || !aUneImage) {
      setUrl(null);
      return;
    }
    let vivant = true;
    void api
      .droitDeLireLaPreuve(proofId)
      .then((droit) => {
        if (vivant) setUrl(droit.url);
      })
      // **Avalé ici, et c'est la seule fois.** Sur la file du commerce une
      // image absente doit se dire : le salon approuve à l'aveugle sinon. Ici
      // la ligne reste lisible sans elle — le nom, le salon et la date sont là
      // — et un bandeau d'erreur par ligne ferait une page d'alertes.
      .catch(() => {
        if (vivant) setUrl(null);
      });
    return () => {
      vivant = false;
    };
  }, [api, aUneImage, proofId]);

  return url;
}

function Publication({ item }: { item: ReservationDuCreateur }) {
  const { api } = useApi();
  const { t, locale } = useI18n();
  const c = useColors();

  const contrepartie = item.contrepartie;
  const publiee = usePhotoDeLaPublication(
    contrepartie?.proof_id ?? null,
    contrepartie?.post_a_une_image ?? false,
  );
  // Le repli, et il est nommé : la photo du service n'est pas la publication,
  // elle en tient lieu quand rien n'a été archivé.
  const image = publiee ?? api.urlDeLaVignette(item.item_photo_key);
  const lien = contrepartie?.post_url ?? null;

  const ligne = (
    <View
      testID={`publication-${item.booking_id}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
    >
      <View
        style={{
          width: VIGNETTE,
          height: VIGNETTE,
          borderRadius: radius['radius.photo'],
          overflow: 'hidden',
          backgroundColor: c['media.placeholder'],
        }}
      >
        <Photo
          uri={image}
          hauteur={VIGNETTE}
          style={{ width: VIGNETTE }}
          testID={`publication-${item.booking_id}-image`}
          replit={<MediaFallback monogramme={item.business_name} height={VIGNETTE} />}
        />
      </View>
      <View style={{ flexShrink: 1, gap: 2 }}>
        {/* Même donnée, même défaut, même correction que la carte des
            réservations à venir : `duration_minutes` existait déjà sur ce
            type et seul le nom était rendu. */}
        <Texte variante="type.body">
          {item.duration_minutes
            ? t('parcours.prestationEtDuree', {
                prestation: item.item_name,
                minutes: item.duration_minutes,
              })
            : item.item_name}
        </Texte>
        <Texte variante="type.caption" couleur="ink.soft">
          {[
            item.business_name,
            // **Dans le fuseau du salon, comme partout ailleurs.** Une
            // publication datée sur le fuseau du téléphone changerait de
            // jour en voyageant, sur une liste qui dit ce qu'on a fait.
            item.starts_at ? formatDate(item.starts_at, locale, item.business_timezone) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Texte>
      </View>
      {/* **Le glyphe de sortie dit que la ligne quitte le produit.** Sans lui,
          une ligne pressable au milieu d'une liste qui ne l'est pas ailleurs ne
          se distingue qu'à l'appui. */}
      {lien ? (
        <View style={{ marginLeft: 'auto' }}>
          <Icone nom="sortie" couleur="ink.soft" taille={16} />
        </View>
      ) : null}
    </View>
  );

  // **Pressable seulement s'il y a où aller.** Une adresse d'origine n'existe
  // que si la créatrice l'a donnée ; une ligne qui répond sans rien ouvrir se
  // lit comme une panne.
  if (!lien) return ligne;

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={t('profil.publicationOuvrir', { prestation: item.item_name })}
      onPress={() => void Linking.openURL(lien)}
      testID={`publication-${item.booking_id}-ouvrir`}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {ligne}
    </Pressable>
  );
}

export function MesPublicationsScreen({ onRetour }: { onRetour: () => void }) {
  const { api } = useApi();
  const { t } = useI18n();

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
            <Publication key={item.booking_id} item={item} />
          ))}
        </View>
      )}
    </Ecran>
  );
}
