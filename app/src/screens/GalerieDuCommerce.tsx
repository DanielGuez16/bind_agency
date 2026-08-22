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
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { useApi, type PhotoDuCommerce } from '../api';
import { Icone, StatusMessage, Texte, vibration } from '../components';
import { Photo } from '../components';
import { useI18n } from '../i18n';
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

  async function agir(action: () => Promise<unknown>) {
    setEnvoi(true);
    setEchec(null);
    vibration.action();
    try {
      await action();
      onChange();
    } catch (erreur) {
      vibration.echec();
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

    await agir(() => api.ajouterUnePhoto(businessId, choisie.uri));
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
                  variante="type.monoSmall"
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
