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
import { useEvent, useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { AppState, Image, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useApi, type MediasPlateforme } from '../api';
import { CADRAGE_DU_SATIN, imageDuSatin } from '../components';
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
  // `ZoneSure` laisse le bas à la barre d'onglets, qui n'existe pas avant la
  // connexion : sans cette marge, le lien de connexion se termine sous la
  // barre d'accueil de l'iPhone, atteignable mais impressable.
  const marges = useSafeAreaInsets();

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

  /**
   * **La lecture se redemande après le montage.** L'appel de la fabrique part
   * avant que l'élément soit attaché au document : sur le web, un navigateur
   * qui n'a pas encore d'élément n'a rien à lire, et la promesse se perd sans
   * bruit. Le redemander une fois la vue posée est ce qui fait démarrer.
   */
  useEffect(() => {
    if (!video) return;
    lecteur.muted = true;
    lecteur.loop = true;
    lecteur.play();
  }, [lecteur, video]);

  /**
   * **La boucle, garantie deux fois.** `loop` posé sur le lecteur suffit en
   * principe ; il s'appliquait ici avant que l'élément existe, et la vidéo
   * s'arrêtait sur sa dernière image. Reprendre au premier signal de fin ne
   * coûte rien et ferme le cas.
   */
  useEventListener(lecteur, 'playToEnd', () => {
    lecteur.currentTime = 0;
    lecteur.play();
  });

  /**
   * **Reprendre au retour au premier plan.**
   *
   * Les navigateurs suspendent la lecture quand l'onglet passe derrière, et
   * rien ne la reprend au retour : il fallait recharger la page. Sur mobile,
   * l'application mise en arrière-plan donne le même résultat par un autre
   * chemin — c'est le même besoin, et `AppState` couvre les deux : sur le web,
   * `react-native-web` l'adosse à `visibilitychange`.
   *
   * **On ne relance que ce qui est en pause.** Rappeler `play()` sur une vidéo
   * qui joue déjà ne coûte rien mais ne dit rien non plus ; la garde rend
   * l'intention lisible.
   *
   * Le cas de qui refuse la lecture automatique n'en souffre pas : `play()` y
   * est refusé comme au premier appel, `playing` reste faux, et l'affiche reste
   * en place. Elle ne clignote pas, parce que c'est l'état réel du lecteur qui
   * la commande — jamais la demande qu'on vient de lui faire.
   */
  useEffect(() => {
    if (!video) return;
    const abonnement = AppState.addEventListener('change', (etat) => {
      if (etat === 'active' && !lecteur.playing) lecteur.play();
    });
    return () => abonnement.remove();
  }, [lecteur, video]);

  /**
   * L'affiche s'efface **quand la vidéo joue vraiment**, pas quand on la
   * demande. Superposées, les deux se voyaient l'une sur l'autre — une image de
   * fond, puis la même par-dessus. Et l'effacer trop tôt ferait clignoter
   * l'écran chez qui refuse la lecture automatique.
   */
  const joue = useEvent(lecteur, 'playingChange', { isPlaying: false })?.isPlaying ?? false;

  return (
    <View
      testID="ecran-accueil"
      // `overflow` : le média couvre en débordant, et un débordement qui
      // élargit le conteneur produirait exactement la couture verticale et la
      // bande sombre relevées à droite.
      style={{ flex: 1, overflow: 'hidden', backgroundColor: c['bg.page'] }}
      onLayout={({ nativeEvent }) =>
        setForme({
          largeur: Math.round(nativeEvent.layout.width),
          hauteur: Math.round(nativeEvent.layout.height),
        })
      }
    >
      {/* **Le satin est le fond, toujours, et il ne bouge jamais.**
          
          C'est la correction d'un défaut qu'une campagne de test a rapporté
          comme « la vidéo met plusieurs secondes à démarrer ». La vidéo n'était
          pas lente : le manifeste des médias arrive par un aller-retour, et
          tant qu'il n'était pas là, `video` et `affiche` valaient tous deux
          `null` — l'écran rendait alors une **composition entièrement
          différente**, satin dans le flux et portes sans en-tête, puis
          basculait sur la composition vidéo une seconde plus tard.

          Ce que le testeur voyait n'était pas un démarrage lent : c'était la
          première chose que montre le produit qui se réorganisait sous ses
          yeux. Un délai se supporte ; une page qui se refait, non.

          Le satin cesse donc d'être une composition de repli pour devenir la
          couche du dessous. La composition est la même à la milliseconde zéro
          et à l'arrivée du manifeste : mêmes couches, même voile, même encre,
          même en-tête au même endroit. Ce qui arrive ensuite ne remplace rien,
          ça s'intercale. */}
      <Image
        testID="satin-accueil"
        source={imageDuSatin('drape')}
        style={[StyleSheet.absoluteFillObject, { width: '100%', height: '100%' }]}
        resizeMode={CADRAGE_DU_SATIN}
        // Décorative : elle ne porte aucun sens qu'un lecteur d'écran doive
        // annoncer, et la nommer ferait dire « dégradé orange » avant le titre.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />

      {/* L'affiche est **sous** la vidéo et non à sa place : elle reste pendant
          le chargement, puis la vidéo la recouvre sans que l'écran clignote. */}
      {affiche && !joue ? (
        <Image
          testID="affiche-accueil"
          source={{ uri: api.urlDuMedia(affiche) ?? undefined }}
          style={[StyleSheet.absoluteFillObject, { width: '100%', height: '100%' }]}
          resizeMode="cover"
        />
      ) : null}

      {video ? (
        <VideoView
          testID="video-accueil"
          player={lecteur}
          style={[StyleSheet.absoluteFillObject, { width: '100%', height: '100%' }]}
          contentFit="cover"
          // **Sans `playsInline`, Safari refuse la lecture automatique** et
          // bascule en plein écran : c'est l'attribut que le navigateur exige,
          // avec `muted`, pour laisser une vidéo démarrer seule.
          playsInline
          nativeControls={false}
          // Un fond ne se met pas en plein écran et ne part pas en image dans
          // l'image : ce sont des commandes, et il n'y a rien à commander.
          allowsFullscreen={false}
          allowsPictureInPicture={false}
        />
      ) : null}

      {/* **Un voile adoucit, il ne garantit rien** — et celui-ci avait fini par
          faire les deux mal.

          Il valait `photoBottom` en haut et en bas, `modal` au milieu : entre
          0,88 et 0,55 sur toute la surface. C'était la seule protection du
          texte à l'époque où le texte n'en avait pas d'autre. Depuis, chaque
          ligne de cet écran a reçu son propre fond — l'en-tête sa bande à
          12,10:1, les deux portes leurs cartes opaques, et le lien de
          connexion sa bande à son tour. Le voile ne protégeait donc plus rien
          que lui-même, et il le payait cher : mesuré au navigateur sur une
          vidéo unie, il n'en laissait passer que **18 % en haut et 48 % au
          mieux**. Un bleu vif arrivait à l'œil en (31, 43, 46), un gris
          d'ardoise. C'est ce qui a été rapporté comme « la vidéo n'apparaît
          plus » : elle jouait, elle était bien au-dessus du satin, et on ne la
          voyait pas.

          Le même calcul vaut contre le satin, qui est une surface de marque :
          l'écrasement à 12 % rendait l'orange de la fondatrice presque noir.

          Il redevient donc ce qu'un voile est — `photoTop`, une seule valeur,
          celle que le système nomme pour adoucir le haut d'une photo. Il lie
          l'image à la page et ne prétend plus rien garantir, parce que ce qui
          doit l'être l'est ailleurs, par des fonds qui ne dépendent ni de la
          hauteur du contenu, ni du terminal, ni de ce qui a fini de charger.

          **Un aplat et non plus un dégradé** : la pente n'existait que pour
          couvrir davantage aux deux bouts, là où vivaient les deux textes qui
          portent maintenant leur bande. */}
      <View
        testID="voile-accueil"
        style={[StyleSheet.absoluteFillObject, { backgroundColor: c['scrim.photoTop'] }]}
        pointerEvents="none"
      />

      {/**
       * **Le contenu défile.** Il tenait dans un `View` en `flex: 1` centré :
       * sur un écran de bureau la hauteur suffit, sur un iPhone les deux
       * cartes empilées dépassent largement. Ce qui dépasse d'un `View` est
       * coupé — le titre sortait par le haut et « Already have an account? »
       * par le bas, hors d'atteinte. L'app n'a qu'une adresse et aucune route
       * web : un créateur déjà inscrit n'avait plus aucun chemin vers son
       * compte depuis son téléphone.
       *
       * `flexGrow: 1` avec `justifyContent: 'center'` garde le centrage tant
       * que le contenu tient, et laisse défiler dès qu'il déborde. Un
       * `flex: 1` sur le conteneur de contenu ferait l'inverse : il bornerait
       * la hauteur du contenu à celle de la fenêtre, et le défilement ne
       * servirait plus à rien.
       */}
      <ScrollView
        testID="accueil-defilant"
        style={{ flex: 1 }}
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          padding: 24,
          paddingBottom: 24 + marges.bottom,
        }}
        // Le fond reste visible sous le contenu : la vidéo est derrière, et un
        // fond opaque de liste la masquerait.
        showsVerticalScrollIndicator={false}
      >
        {/* **`surMedia` ne se calcule plus**, il est vrai. Il l'était déjà
            dès qu'une photo arrivait ; il l'est désormais tout le temps, parce
            que le satin et son voile sont là dès la première image. Une
            constante à la place d'un booléen calculé, c'est exactement ce que
            « la composition ne change pas » veut dire. */}
        <ChoixDeLaPorte onChoisir={onChoisir} onSeConnecter={onSeConnecter} surMedia />
      </ScrollView>
    </View>
  );
}
