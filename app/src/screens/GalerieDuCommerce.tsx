/**
 * La galerie photos, dans la section catalogue de la configuration.
 *
 * **Deux flèches par ligne, pas de glisser-déposer.** Le glisser n'existe pas
 * en React Native sans bibliothèque tierce, et pour dix à douze photos deux
 * flèches suffisent : elles marchent sur les deux plateformes, se comprennent
 * sans apprentissage, et sont accessibles au lecteur d'écran — ce qu'un
 * glisser-déposer n'est jamais.
 *
 * **Chaque déplacement envoie l'ordre complet.** Le serveur exige la liste
 * entière et refuse un ordre partiel ; envoyer « cette photo passe en 2 »
 * laisserait au serveur le soin de deviner ce que deviennent les autres, et
 * chaque client devinerait autrement.
 *
 * **« Définir comme couverture » est le geste qu'on cherche en premier**, et il
 * ne passe pas par la galerie : la couverture est un champ du commerce, changé
 * par la route qui existe déjà. En créer une seconde ferait deux vérités sur la
 * même donnée.
 */
import * as ImagePicker from 'expo-image-picker';
import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { useApi, type PhotoDuCommerce } from '../api';
import { Button, Icone, StatusMessage, Texte, vibration } from '../components';
import { Photo } from '../components';
import { useI18n } from '../i18n';
import { useEnvoiDeFichier } from '../shell/useEnvoiDeFichier';
import { radius, useColors } from '../theme';

export function GalerieDuCommerce({
  businessId,
  photos,
  couverture,
  onChange,
}: {
  businessId: string;
  photos: PhotoDuCommerce[];
  /** La clé de la couverture actuelle, pour marquer la ligne qui la porte. */
  couverture: string | null;
  onChange: () => void;
}) {
  const { api, messageDErreur } = useApi();
  const { t } = useI18n();
  const c = useColors();
  const [echec, setEchec] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  /**
   * Le fichier choisi, gardé jusqu'à ce qu'il parte.
   *
   * **C'était une variable locale qui mourait avec la fonction.** Un envoi qui
   * échouait laissait un message et rien d'autre : le fichier était perdu, et
   * réessayer voulait dire rouvrir la galerie et le retrouver. C'est le cas que
   * le défaut de téléversement rendait certain, et celui qui décide si l'on
   * réessaie ou si l'on abandonne.
   */
  const envoiDeFichier = useEnvoiDeFichier();

  /** L'échec du tour en cours, lisible tout de suite — `echec` ne l'est qu'au rendu suivant. */
  const echecCourant = useRef(false);

  async function agir(action: () => Promise<unknown>) {
    setEnvoi(true);
    setEchec(null);
    echecCourant.current = false;
    vibration.action();
    try {
      await action();
      onChange();
    } catch (erreur) {
      vibration.echec();
      echecCourant.current = true;
      setEchec(messageDErreur(erreur));
    } finally {
      setEnvoi(false);
    }
  }

  /**
   * Choisit une image et l'ajoute.
   *
   * **Un refus de permission se dit comme un choix, pas comme une panne.** La
   * seule issue est les réglages du téléphone, et c'est ce qu'on nomme —
   * réessayer ne redemandera rien, le système ne repose la question qu'une
   * fois.
   */
  async function choisirEtEnvoyer() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setEchec(t('composition.galeriePermission'));
      return;
    }

    const resultat = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    });
    const choisie = resultat.canceled ? null : resultat.assets[0];
    if (!choisie) return;

    await envoyer(choisie.uri);
  }

  /**
   * L'envoi, sans passer par `agir`.
   *
   * **`agir` avale l'erreur pour la poser à l'écran** — c'est ce qu'on veut des
   * autres gestes, et c'est exactement ce qu'il ne faut pas ici : le crochet
   * conclurait au succès et effacerait le fichier gardé. L'échec doit remonter
   * jusqu'à lui pour qu'il sache qu'il n'y a pas eu d'issue.
   */
  async function envoyer(uri: string) {
    setEchec(null);
    vibration.action();
    try {
      await envoiDeFichier.envoyer(uri, async (progression) => {
        await api.ajouterUnePhoto(businessId, uri, progression);
        onChange();
      });
    } catch (erreur) {
      vibration.echec();
      setEchec(messageDErreur(erreur));
    }
  }

  /** Échange deux rangs et envoie l'ordre complet. */
  function deplacer(rang: number, vers: number) {
    const ordre = photos.map((photo) => photo.id);
    [ordre[rang], ordre[vers]] = [ordre[vers], ordre[rang]];
    return agir(() => api.ordonnerLesPhotos(businessId, ordre));
  }

  return (
    <View style={{ gap: 10 }} testID="galerie-du-commerce">
      <Texte variante="type.label" couleur="ink.soft">
        {t('composition.galerieTitre')}
      </Texte>
      <Texte variante="type.caption" couleur="ink.mute">
        {t('composition.galerieAide')}
      </Texte>

      {echec ? <StatusMessage level="danger" body={echec} testID="echec-galerie" /> : null}

      {photos.length === 0 ? (
        <Texte variante="type.caption" couleur="ink.mute" testID="galerie-vide">
          {t('composition.galerieVide')}
        </Texte>
      ) : null}

      {photos.map((photo, rang) => {
        const estCouverture = photo.storage_key === couverture;
        return (
          <View
            key={photo.id}
            testID={`photo-${photo.id}`}
            accessibilityLabel={t('composition.galerieRang', {
              rang: rang + 1,
              total: photos.length,
            })}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              padding: 8,
              borderRadius: radius['radius.none'],
              borderWidth: 1,
              borderColor: estCouverture ? c['brand.700'] : c['line.default'],
              backgroundColor: c['bg.surface'],
            }}
          >
            {/* Une grille de vignettes : le commerce vérifie son ordre, il ne
                regarde pas ses photos en détail depuis cet écran. */}
            <Photo
              uri={api.urlDeLaVignette(photo.storage_key)}
              hauteur={56}
              style={{ width: 56, borderRadius: radius['radius.none'] }}
            />

            <View style={{ flex: 1, gap: 2 }}>
              {estCouverture ? (
                <Texte
                  variante="type.dataLabel"
                  couleur="brand.700"
                  testID={`couverture-${photo.id}`}
                >
                  {t('composition.galerieEstCouverture')}
                </Texte>
              ) : (
                <Pressable
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                  accessibilityRole="button"
                  disabled={envoi}
                  onPress={() => void agir(() => api.definirLaCouverture(businessId, photo.storage_key))}
                  testID={`definir-couverture-${photo.id}`}
                >
                  <Texte variante="type.caption" couleur="brand.700">
                    {t('composition.galerieCouverture')}
                  </Texte>
                </Pressable>
              )}
              {photo.alt_text ? (
                <Texte variante="type.caption" couleur="ink.mute" ellipseSurNomPropre>
                  {photo.alt_text}
                </Texte>
              ) : null}
            </View>

            {/* Une flèche absente plutôt que grisée, comme partout ailleurs :
                la première photo ne peut pas monter, et un bouton gris invite
                à appuyer pour découvrir qu'il ne fait rien. */}
            {rang > 0 ? (
              <Pressable
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                accessibilityRole="button"
                accessibilityLabel={t('composition.galerieMonter')}
                disabled={envoi}
                hitSlop={8}
                onPress={() => void deplacer(rang, rang - 1)}
                testID={`monter-${photo.id}`}
              >
                <Icone nom="monte" couleur="ink.soft" taille={20} />
              </Pressable>
            ) : null}
            {rang < photos.length - 1 ? (
              <Pressable
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                accessibilityRole="button"
                accessibilityLabel={t('composition.galerieDescendre')}
                disabled={envoi}
                hitSlop={8}
                onPress={() => void deplacer(rang, rang + 1)}
                testID={`descendre-${photo.id}`}
              >
                <Icone nom="descend" couleur="ink.soft" taille={20} />
              </Pressable>
            ) : null}

            <Pressable
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
              accessibilityRole="button"
              accessibilityLabel={t('composition.galerieRetirer')}
              disabled={envoi}
              hitSlop={8}
              onPress={() => void agir(() => api.retirerUnePhoto(businessId, photo.id))}
              testID={`retirer-${photo.id}`}
            >
              <Icone nom="croix" couleur="status.danger.text" taille={18} />
            </Pressable>
          </View>
        );
      })}

      {/* Ajouter est en pied, après ce qui existe : la galerie se lit avant
          de s'allonger, et un bouton en tête ferait passer l'ajout pour le
          geste principal d'un écran qui sert surtout à ordonner. */}
      {/* **Un envoi de photo prend des secondes, pas des millisecondes.** Le
          seuil des 400 ms suppose une réponse ; sur le réseau d'un salon il n'y
          en a pas avant plusieurs secondes, et le bouton n'était que désactivé
          — rien ne bougeait, et l'on conclut que l'appui n'a pas pris.

          Pas de pourcentage : `fetch` n'en donne aucun, et une barre qui
          avancerait sans mesure serait une invention. Ce qui se dit est que ça
          travaille. */}
      {envoiDeFichier.enVol ? (
        <Texte variante="type.caption" couleur="ink.soft" testID="envoi-en-cours">
          {envoiDeFichier.part === null
            ? t('composition.photoEnvoiEnCours')
            : t('composition.photoEnvoiPart', { part: Math.round(envoiDeFichier.part * 100) })}
        </Texte>
      ) : null}

      {/* **Interrompu n'est pas échoué.** C'est l'application qui a quitté le
          premier plan, pas le réseau qui a manqué : le dire autrement enverrait
          chercher une panne qui n'existe pas. */}
      {envoiDeFichier.interrompu ? (
        <StatusMessage
          level="neutral"
          body={t('composition.photoEnvoiInterrompu')}
          testID="envoi-interrompu"
        />
      ) : null}

      {/* **L'échec garde le fichier.** Réessayer n'a pas à rouvrir la galerie. */}
      {/* **Pas pendant qu'un envoi vole**, et c'est la reprise automatique qui
          l'impose. Un réessai par le bouton passe par `envoyer`, qui efface
          `echec` — donc la garde n'y sert à rien. La reprise au retour au
          premier plan, elle, rejoue l'action **sans passer par l'écran** :
          `echec` reste posé, et sans cette condition le bouton inviterait à un
          geste déjà en cours. Un second appui enverrait la même photo deux
          fois.

          Non gardé par un test : le décor qui l'atteindrait doit simuler un
          passage en arrière-plan **pendant** un envoi, sur un écran monté avec
          son sélecteur d'images. Le crochet, lui, est éprouvé séparément — c'est
          là que vit la règle. */}
      {!envoiDeFichier.enVol &&
      (echec || envoiDeFichier.interrompu) &&
      envoiDeFichier.aRenvoyer ? (
        <View style={{ flexDirection: 'row' }}>
          <Button
            label={t('composition.photoReessayer')}
            size="sm"
            variant="secondary"
            fullWidth={false}
            onPress={() => void envoyer(envoiDeFichier.aRenvoyer as string)}
            testID="reessayer-l-envoi"
          />
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        disabled={envoi}
        onPress={() => void choisirEtEnvoyer()}
        testID="ajouter-une-photo"
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          minHeight: 48,
          borderRadius: radius['radius.none'],
          borderWidth: 1,
          borderStyle: 'dashed',
          borderColor: c['line.default'],
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Icone nom="image" couleur="brand.700" taille={20} />
        <Texte variante="type.label" couleur="brand.700">
          {t('composition.galerieAjouter')}
        </Texte>
      </Pressable>

      <Texte variante="type.caption" couleur="ink.mute">
        {t('composition.galerieCouvertureAide')}
      </Texte>
    </View>
  );
}
