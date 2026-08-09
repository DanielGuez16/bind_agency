/**
 * Choisir une capture, la regarder, puis l'envoyer.
 *
 * **Le maillon final de la boucle.** Le bouton n'ouvrait rien : une créatrice
 * pouvait publier, et rien ne pouvait le prouver. Tout le reste du produit —
 * les paliers, la réservation, le code — n'aboutissait nulle part.
 *
 * **Deux temps, jamais un.** On choisit, on regarde, puis on envoie. Un envoi
 * déclenché par la sélection ferait partir la mauvaise image sans recours, et
 * c'est une image qu'un commerce va juger.
 *
 * **Le refus de permission n'est pas une erreur.** Refuser l'accès à ses photos
 * est un choix ; le dire comme une panne le rendrait inquiétant. On explique ce
 * qui est demandé et on renvoie vers les réglages du téléphone, parce qu'un
 * second appui ne redemandera rien une fois le refus posé.
 *
 * **Le poids se vérifie ici aussi.** Le serveur refuse au-delà de la limite ;
 * l'apprendre après avoir attendu la fin d'un envoi de vingt mégaoctets sur un
 * réseau de salon est une punition. On mesure avant de partir.
 *
 * **Le format story reste en capture manuelle.** Une story disparaît en
 * vingt-quatre heures et n'a pas d'adresse publique stable : il n'y a rien à
 * récupérer automatiquement, et c'est acté.
 */
import { useState } from 'react';
import { Image, Linking, View } from 'react-native';

import * as ImagePicker from 'expo-image-picker';

import { useApi } from '../api';
import { Button, StatusMessage, Texte, vibration } from '../components';
import { useI18n } from '../i18n';
import { radius, useTheme } from '../theme';

/** La hauteur de l'aperçu. Assez pour juger ce qu'on s'apprête à envoyer. */
const APERCU = 300;

/**
 * Le plafond, en octets. **Doit valoir celui du serveur.**
 *
 * Recopié plutôt que demandé : une requête pour connaître une limite ajouterait
 * un aller-retour à chaque ouverture d'écran. Le risque est qu'ils divergent ;
 * un test compare les deux valeurs.
 */
export const POIDS_MAXIMAL = 8 * 1024 * 1024;

type Choisi = { uri: string; taille: number | null };

type Etat =
  | { etat: 'repos' }
  | { etat: 'choisi'; media: Choisi }
  | { etat: 'envoi'; media: Choisi }
  | { etat: 'echec'; media: Choisi | null; message: string };

export function EnvoiDePreuve({
  collaborationId,
  onEnvoye,
}: {
  collaborationId: string;
  onEnvoye: () => void;
}) {
  const { api, messageDErreur } = useApi();
  const { t } = useI18n();
  const { color: c } = useTheme();
  const [vue, setVue] = useState<Etat>({ etat: 'repos' });

  const media = 'media' in vue ? vue.media : null;

  /** Le résultat d'un sélecteur, quel qu'il soit. */
  function retenir(resultat: ImagePicker.ImagePickerResult) {
    if (resultat.canceled) return;
    const actif = resultat.assets[0];
    if (!actif) return;

    // Mesuré avant de partir : apprendre le refus après l'envoi d'un fichier
    // de vingt mégaoctets sur le réseau d'un salon est une punition.
    if (actif.fileSize != null && actif.fileSize > POIDS_MAXIMAL) {
      vibration.echec();
      setVue({
        etat: 'echec',
        media: null,
        message: t('parcours.preuveTropLourde', {
          poids: Math.round(POIDS_MAXIMAL / (1024 * 1024)),
        }),
      });
      return;
    }

    setVue({ etat: 'choisi', media: { uri: actif.uri, taille: actif.fileSize ?? null } });
  }

  async function depuisLaGalerie() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return refuser('parcours.preuvePermissionGalerie');
    retenir(
      await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.9,
      }),
    );
  }

  async function parLAppareilPhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return refuser('parcours.preuvePermissionCamera');
    retenir(await ImagePicker.launchCameraAsync({ quality: 0.9 }));
  }

  /**
   * Un refus de permission, dit comme un choix et non comme une panne.
   *
   * Avec la seule issue qui existe : les réglages du téléphone. Redemander ne
   * sert à rien une fois le refus posé, et proposer de réessayer ferait
   * appuyer sur un bouton qui n'ouvre plus rien.
   */
  function refuser(cle: string) {
    setVue({ etat: 'echec', media: null, message: t(cle) });
  }

  async function envoyer() {
    if (!media) return;
    setVue({ etat: 'envoi', media });
    vibration.action();
    try {
      const { screenshot_key } = await api.televerserUneCapture(media.uri);
      await api.soumettreLaPreuve(collaborationId, { screenshot_key });
      vibration.reussite();
      onEnvoye();
    } catch (erreur) {
      vibration.echec();
      setVue({ etat: 'echec', media, message: messageDErreur(erreur) });
    }
  }

  return (
    <View style={{ gap: 12 }} testID="envoi-de-preuve">
      {media ? (
        <View
          style={{
            height: APERCU,
            borderRadius: radius['radius.lg'],
            overflow: 'hidden',
            backgroundColor: c['bg.sunken'],
          }}
        >
          <Image
            source={{ uri: media.uri }}
            style={{ width: '100%', height: APERCU }}
            resizeMode="contain"
            testID="apercu-du-choix"
          />
        </View>
      ) : null}

      {vue.etat === 'echec' ? (
        <View style={{ gap: 8 }}>
          <StatusMessage level="danger" body={vue.message} testID="echec-envoi" />
          {/* La seule issue d'un refus de permission. Présente seulement quand
              c'en est un : un bouton vers les réglages après une panne réseau
              enverrait chercher au mauvais endroit. */}
          {vue.media === null ? (
            <Button
              label={t('parcours.preuveOuvrirReglages')}
              variant="secondary"
              onPress={() => void Linking.openSettings()}
              testID="ouvrir-les-reglages"
            />
          ) : null}
        </View>
      ) : null}

      {vue.etat === 'envoi' ? (
        <StatusMessage
          level="neutral"
          body={t('parcours.preuveEnvoiEnCours')}
          testID="envoi-en-cours"
        />
      ) : null}

      {media ? (
        <Button
          label={t('parcours.preuveEnvoyerCelle_ci')}
          size="lg"
          loading={vue.etat === 'envoi'}
          onPress={() => void envoyer()}
          testID="confirmer-l-envoi"
        />
      ) : null}

      <Texte variante="type.caption" couleur="text.secondary">
        {t('parcours.preuveCommentFaire')}
      </Texte>

      <Button
        label={t(media ? 'parcours.preuveChoisirAutre' : 'parcours.preuveDepuisGalerie')}
        variant={media ? 'secondary' : 'primary'}
        onPress={() => void depuisLaGalerie()}
        testID="choisir-dans-la-galerie"
      />
      <Button
        label={t('parcours.preuvePrendrePhoto')}
        variant="secondary"
        onPress={() => void parLAppareilPhoto()}
        testID="prendre-une-photo"
      />
    </View>
  );
}
