/**
 * Le premier écran du produit : une vidéo en fond, et les deux portes.
 *
 * **Deux orientations, choisies sur le format réel.** L'écran est en plein
 * écran ; une vidéo 16:9 sur un téléphone tenu droit ne peut donner que des
 * bandes noires ou un recadrage qui coupe le sujet, et une 9:16 sur un écran
 * large a le défaut symétrique. Le choix se fait sur la forme mesurée du
 * conteneur — plus haut que large, on prend la verticale — et non sur le
 * système d'exploitation : un iPad en paysage n'est pas un téléphone, et une
 * fenêtre de navigateur étroite n'est pas un écran de bureau.
 *
 * **Rien n'est obligatoire, et chaque absence a son repli.** L'orientation qui
 * manque cède la place à l'autre, avec le recadrage le moins mauvais ; si
 * aucune vidéo ne charge, l'affiche seule ; si elle manque aussi, les portes
 * sur le fond du thème. **Jamais un écran vide** : c'est la première chose
 * qu'on voit du produit, et un rectangle noir y ressemblerait à une panne.
 *
 * **La vidéo est muette et ne se commande pas.** Un fond n'a ni bouton de
 * lecture ni barre de progression : ce serait proposer une action dont on
 * n'attend rien. Elle boucle, et elle se tait — un son qui démarre seul sur un
 * premier écran est le plus sûr moyen de faire fermer l'onglet.
 */
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { Image, View } from 'react-native';

import { useApi, type MediasPlateforme } from '../api';
import { Texte } from '../components';
import { useI18n } from '../i18n';
import type { RoleInscriptible } from '../session';
import { useColors } from '../theme';
import { ChoixDeLaPorte } from './ChoixDeLaPorte';

/**
 * Ce qu'on affiche en fond, une fois l'orientation choisie et les replis faits.
 *
 * Séparé du rendu et exporté : c'est la seule règle de cet écran qui mérite
 * d'être éprouvée seule, et la tester au travers d'un lecteur vidéo demanderait
 * de simuler un lecteur pour vérifier une suite de `??`.
 */
export function fondDAccueil(
  home: MediasPlateforme['home'] | null,
  portrait: boolean,
): { video: string | null; affiche: string | null } {
  if (home === null) return { video: null, affiche: null };

  // L'orientation voulue d'abord, l'autre ensuite. Un fond mal cadré vaut
  // mieux que pas de fond du tout, et le recadrage central est le moins
  // mauvais des deux maux.
  const video = portrait
    ? (home.video_portrait_key ?? home.video_key)
    : (home.video_key ?? home.video_portrait_key);

  // L'affiche suit **la vidéo retenue**, pas l'orientation demandée : une
  // affiche verticale sous une vidéo paysage recadrerait au chargement, puis
  // la vidéo démarrerait sur un autre cadrage, et le saut se verrait.
  const memeSens = portrait === (video === home.video_portrait_key && video !== null);
  const affichePreferee = portrait ? home.poster_portrait_key : home.poster_key;
  const afficheDeSecours = portrait ? home.poster_key : home.poster_portrait_key;

  return {
    video,
    affiche: (memeSens ? affichePreferee : afficheDeSecours) ?? affichePreferee ?? afficheDeSecours,
  };
}

export function AccueilScreen({
  onChoisir,
  onSeConnecter,
}: {
  onChoisir: (role: RoleInscriptible) => void;
  onSeConnecter: () => void;
}) {
  const { api } = useApi();
  const { t } = useI18n();
  const c = useColors();

  const [medias, setMedias] = useState<MediasPlateforme | null>(null);
  const [forme, setForme] = useState({ largeur: 0, hauteur: 0 });

  useEffect(() => {
    let vivant = true;
    // Une erreur ne se remonte pas : l'accueil sans fond reste un accueil, et
    // afficher « impossible de charger la vidéo » sur le premier écran du
    // produit serait pire que le fond manquant.
    void api
      .mediasPlateforme()
      .then((rendus) => vivant && setMedias(rendus))
      .catch(() => {});
    return () => {
      vivant = false;
    };
  }, [api]);

  const portrait = forme.hauteur > forme.largeur;
  const { video, affiche } = fondDAccueil(medias?.home ?? null, portrait);

  const lecteur = useVideoPlayer((video && api.urlDuMedia(video)) || null, (instance) => {
    instance.loop = true;
    instance.muted = true;
    instance.play();
  });

  return (
    <View
      testID="ecran-accueil"
      style={{ flex: 1, backgroundColor: c['bg.canvas'] }}
      onLayout={({ nativeEvent }) =>
        setForme({
          largeur: Math.round(nativeEvent.layout.width),
          hauteur: Math.round(nativeEvent.layout.height),
        })
      }
    >
      {/* L'affiche est **sous** la vidéo et non à sa place : elle reste pendant
          le chargement, puis la vidéo la recouvre sans que l'écran clignote. */}
      {affiche ? (
        <Image
          testID="affiche-accueil"
          source={{ uri: api.urlDuMedia(affiche) ?? undefined }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          resizeMode="cover"
        />
      ) : null}

      {video ? (
        <VideoView
          testID="video-accueil"
          player={lecteur}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          contentFit="cover"
          nativeControls={false}
          // Un fond ne se met pas en plein écran et ne part pas en image dans
          // l'image : ce sont des commandes, et il n'y a rien à commander.
          allowsFullscreen={false}
          allowsPictureInPicture={false}
        />
      ) : null}

      {/* Un voile : le texte des portes se pose sur une image dont on ne
          maîtrise ni la luminosité ni le contraste. Sans lui, la promesse
          devient illisible sur un plan clair. */}
      {video || affiche ? (
        <View
          testID="voile-accueil"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: c['scrim.mid'],
          }}
        />
      ) : null}

      <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
        <ChoixDeLaPorte onChoisir={onChoisir} onSeConnecter={onSeConnecter} />
        {video || affiche ? null : (
          // Aucun fond : on ne laisse pas un vide inexpliqué sous les portes.
          <Texte variante="type.caption" couleur="text.muted" testID="accueil-sans-fond">
            {t('accueil.sansFond')}
          </Texte>
        )}
      </View>
    </View>
  );
}
