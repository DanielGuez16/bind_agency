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

/**
 * Ce que la plateforme a dit de la dernière preuve soumise.
 *
 * La contrepartie rend toutes ses preuves ; c'est la plus récente qui vient
 * d'être créée. Lire la première donnerait le verdict d'une soumission
 * précédente, souvent celle qui avait été refusée.
 */
function verdictDe(contrepartie: Collaboration): boolean | null {
  const derniere = contrepartie.proofs?.at(-1);
  return derniere ? derniere.verifiee : null;
}

/**
 * La borne de la note, telle que le serveur la pose.
 *
 * Cinq cents caractères : `collaboration.note` porte une contrainte de base du
 * même nombre. Le champ s'arrête donc là où le serveur refuserait, plutôt que
 * de laisser écrire une phrase qui sera coupée à l'envoi.
 */
const LONGUEUR_DE_LA_NOTE = 500;
import { Image, Linking, View } from 'react-native';

import * as ImagePicker from 'expo-image-picker';

import { useApi, type Collaboration } from '../api';
import { Button, StatusMessage, TextField, Texte, vibration } from '../components';
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
  | { etat: 'echec'; media: Choisi | null; message: string }
  /**
   * Envoyée, et ce que la plateforme en a dit.
   *
   * `verifiee` nulle veut dire « la question ne s'est pas posée » — niveau 2 ou
   * 3 — et non « la vérification a échoué ». Les deux se disent autrement, et
   * les confondre accuserait la créatrice d'un silence de la plateforme.
   */
  | { etat: 'rendu'; media: Choisi; verifiee: boolean | null };

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
  const [note, setNote] = useState('');

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
      // La note part avec la soumission, jamais séparément : envoyée après,
      // elle arriverait sur un dossier déjà refusé, et le commerce l'aurait
      // lue une fois sa décision prise.
      const propre = note.trim();
      const contrepartie = await api.soumettreLaPreuve(collaborationId, {
        screenshot_key,
        ...(propre ? { note: propre } : {}),
      });
      vibration.reussite();
      // **Le résultat se montre avant de quitter l'écran.** Il répond à la
      // question que l'incitation vient de poser, et l'annoncer ailleurs — ou
      // pas du tout — ferait de l'incitation une phrase sans suite.
      setVue({ etat: 'rendu', media, verifiee: verdictDe(contrepartie) });
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
            borderRadius: radius['radius.none'],
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

      {/* **L'autre moitié du canal.** Le commerce refuse avec un code, et le
          créateur resoumettait sans un mot : un dossier arrivait en arbitrage
          après trois allers-retours sans qu'aucune phrase ait été échangée.
          Facultative — une soumission conforme n'a rien à expliquer, et un
          champ obligatoire se remplirait de « rien à signaler ». */}
      {/* Le résultat, avant de quitter l'écran. Il répond à la question que
          l'incitation vient de poser. */}
      {vue.etat === 'rendu' ? (
        <StatusMessage
          // Neutre dans les deux cas : une contrepartie attestée n'est pas
          // un avertissement, et une vérifiée n'est pas encore approuvée — le
          // commerce doit toujours la contrôler. Le titre porte la différence.
          level="neutral"
          title={t(vue.verifiee ? 'parcours.preuveVerifiee' : 'parcours.preuveAttestee')}
          body={t(vue.verifiee ? 'parcours.preuveVerifieeAide' : 'parcours.preuveAttesteeAide')}
          action={{ label: t('common.retour'), onPress: onEnvoye, variant: 'secondary' }}
          testID={vue.verifiee ? 'preuve-verifiee' : 'preuve-attestee'}
        />
      ) : null}

      {/* **L'incitation, avant l'envoi et pas après.** Soumettre vite fait
          vérifier la publication par la plateforme elle-même ; attendre laisse
          la parole et une capture. C'est la seule chose que la créatrice peut
          décider à cet instant, et elle ne peut la décider qu'en la sachant. */}
      {media && vue.etat !== 'rendu' ? (
        <StatusMessage
          level="neutral"
          body={t('parcours.preuveVite')}
          testID="incitation-a-soumettre-vite"
        />
      ) : null}

      {media && vue.etat !== 'rendu' ? (
        <TextField
          label={t('parcours.preuveNote')}
          value={note}
          onChangeText={setNote}
          helpText={t('parcours.preuveNoteAide')}
          lignes={3}
          maxLength={LONGUEUR_DE_LA_NOTE}
          testID="note-de-la-preuve"
        />
      ) : null}

      {media && vue.etat !== 'rendu' ? (
        <Button
          label={t('parcours.preuveEnvoyerCelle_ci')}
          size="lg"
          loading={vue.etat === 'envoi'}
          onPress={() => void envoyer()}
          testID="confirmer-l-envoi"
        />
      ) : null}

      <Texte variante="type.caption" couleur="ink.soft">
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
