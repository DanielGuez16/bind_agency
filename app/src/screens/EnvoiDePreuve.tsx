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

/** Ce que la dernière preuve a produit, pour la contrepartie. */
function raisonsDe(contrepartie: Collaboration): string[] {
  return contrepartie.proofs?.at(-1)?.raisons_de_non_verification ?? [];
}

/**
 * Les trois états de la vérification, nommés.
 *
 * **Nul n'est pas faux.** Nul veut dire que la question ne s'est pas posée —
 * une preuve de niveau 2 ou 3 — et faux qu'elle s'est posée et que la réponse
 * est non. Les rendre identiques faisait croire à une vérification passée là où
 * elle avait échoué.
 */
function etatDeLaVerification(verifiee: boolean | null): 'verifiee' | 'ecart' | 'attestee' {
  if (verifiee === true) return 'verifiee';
  if (verifiee === false) return 'ecart';
  return 'attestee';
}

/**
 * La borne de la note, telle que le serveur la pose.
 *
 * Cinq cents caractères : `collaboration.note` porte une contrainte de base du
 * même nombre. Le champ s'arrête donc là où le serveur refuserait, plutôt que
 * de laisser écrire une phrase qui sera coupée à l'envoi.
 */
const LONGUEUR_DE_LA_NOTE = 500;

/** La borne du serveur sur `source_url`, recopiée — un test compare les deux. */
const LONGUEUR_DE_L_ADRESSE = 1000;
import { Linking, View } from 'react-native';

import * as ImagePicker from 'expo-image-picker';
import { VideoView, useVideoPlayer } from 'expo-video';

import { useApi, type Collaboration } from '../api';
import { Button, Photo, StatusMessage, TextField, Texte, vibration } from '../components';
import { useI18n } from '../i18n';
import { useEnvoiDeFichier } from '../shell/useEnvoiDeFichier';
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
/**
 * Le plafond, **recopié du serveur** (`proof_upload_max_bytes`).
 *
 * Relevé à quinze mégaoctets avec l'arrivée de la vidéo : huit refusaient la
 * quasi-totalité des reels, c'est-à-dire le format même que le brief demande.
 * C'est la taille que le compartiment est vérifié accepter au déploiement —
 * pas un chiffre choisi au jugé.
 */
export const POIDS_MAXIMAL = 15 * 1024 * 1024;

type Choisi = { uri: string; taille: number | null; estUneVideo: boolean };

/**
 * Le seuil au-delà duquel l'échéance change la conduite, et non le ton.
 *
 * **Douze heures**, parce que c'est la borne au-delà de laquelle il reste une
 * nuit : « demain matin » est une réponse, « dans six heures » n'en est pas
 * une. Le nombre est ici et pas dans une phrase de traduction — c'est une règle
 * du produit, pas un mot.
 */
const HEURES_QUI_PRESSENT = 12;

/**
 * Le plafond d'essais, recopié du serveur — `collaboration_max_attempts`.
 *
 * Il n'est pas servi sur la contrepartie ; le recopier est le seul moyen
 * d'écrire « toujours 1 sur 3 », et c'est la phrase qui porte toute la règle.
 * Le jour où le seuil bouge, cette ligne ment : demandé au contrat.
 */
const MAX_TENTATIVES = 3;

function presseParLEcheance(echeance: string, maintenant: number = Date.now()): boolean {
  const reste = Date.parse(echeance) - maintenant;
  // **Une échéance illisible ne presse pas.** Sans date, on ne sait rien ; en
  // déduire l'urgence ferait pousser quelqu'un qui a tout son temps.
  if (Number.isNaN(reste)) return false;
  return reste <= HEURES_QUI_PRESSENT * 3_600_000;
}

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
  | { etat: 'rendu'; media: Choisi; verifiee: boolean | null; raisons: string[] };

/**
 * L'aperçu d'une vidéo choisie.
 *
 * **Il n'existait pas, et `Photo` rendait un cadre vide.** Un choix qui ne
 * s'affiche pas se lit comme un choix qui n'a pas pris : la créatrice
 * recommence, ou envoie autre chose. `expo-video` était déjà dans les
 * dépendances sans un seul appelant.
 *
 * Muet et en boucle : c'est une vérification de ce qu'on s'apprête à envoyer,
 * pas une lecture. Du son qui démarre seul dans un salon serait une surprise
 * désagréable, et les commandes natives inviteraient à regarder plutôt qu'à
 * vérifier.
 */
function ApercuVideo({ uri }: { uri: string }) {
  const lecteur = useVideoPlayer(uri, (instance) => {
    instance.loop = true;
    instance.muted = true;
    instance.play();
  });

  return (
    <VideoView
      player={lecteur}
      style={{ height: APERCU, borderRadius: radius['radius.lg'] }}
      contentFit="contain"
      nativeControls={false}
      testID="apercu-du-choix"
    />
  );
}

export function EnvoiDePreuve({
  collaborationId,
  tentatives,
  echeance,
  timezone,
  onEnvoye,
}: {
  collaborationId: string;
  /** Combien d'essais ont déjà été **comptés**. Un échec réseau n'en est pas un. */
  tentatives: number;
  /** L'échéance de publication. C'est elle qui porte l'urgence, jamais l'échec. */
  echeance: string;
  timezone: string;
  onEnvoye: () => void;
}) {
  const { api, messageDErreur } = useApi();
  const { t } = useI18n();
  const { color: c } = useTheme();
  const [vue, setVue] = useState<Etat>({ etat: 'repos' });
  /**
   * Ce qui est monté, entre 0 et 1, ou nul quand la plateforme ne mesure pas.
   *
   * **La capture est le plus lourd des quatre envois du produit**, et le seul
   * dont l'issue engage une contrepartie : un filet qui parcourt y dit « ça
   * travaille » sans dire si l'on en est au début ou à la fin.
   */
  const envoiDeFichier = useEnvoiDeFichier();
  const [note, setNote] = useState('');
  /**
   * **L'adresse de la publication, et elle n'était demandée nulle part.**
   *
   * Le schéma l'accepte, la méthode de client la transporte, l'écran du
   * commerce sait l'ouvrir — et aucun écran ne la remplissait. Le salon n'avait
   * donc jamais que la capture, alors que c'est le lien qui permet de vérifier
   * que la publication est en ligne et qu'elle y est restée.
   *
   * **Demandée, pas exigée.** Une story n'a pas toujours d'adresse publique, et
   * bloquer l'envoi sur ce champ ferait perdre une contrepartie pour un détail
   * de forme — alors que la capture seule est déjà une preuve valable, de
   * niveau 3. Elle sert aussi à tenter le niveau 2, ce qui est l'autre raison de
   * la demander plutôt que de s'en passer.
   */
  const [adresse, setAdresse] = useState('');

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

    setVue({
      etat: 'choisi',
      media: {
        uri: actif.uri,
        taille: actif.fileSize ?? null,
        // `type` vient du sélecteur ; l'absence se lit comme une image, qui
        // est le cas de tous les choix d'avant la vidéo.
        estUneVideo: actif.type === 'video',
      },
    });
  }

  async function depuisLaGalerie() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return refuser('parcours.preuvePermissionGalerie');
    retenir(
      // **La vidéo est acceptée, et son absence n'était pas anodine.** Deux
      // des trois `ContentFormat` du produit sont vidéo par nature — un reel
      // toujours, une story le plus souvent. Restreint aux images, ce
      // sélecteur ne laissait déposer que la capture d'écran d'une vidéo,
      // c'est-à-dire le niveau de preuve le plus faible pour le format où
      // l'on aurait pu avoir le média lui-même.
      await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        quality: 0.9,
      }),
    );
  }

  async function parLAppareilPhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return refuser('parcours.preuvePermissionCamera');
    // **`mediaTypes` explicite, alors qu'il était implicite.** Sans lui la
    // caméra retombe sur les images seules : le sélecteur aurait accepté une
    // vidéo et pas l'appareil photo, ce qui est le genre d'écart qu'on ne
    // découvre qu'en filmant.
    retenir(
      await ImagePicker.launchCameraAsync({ mediaTypes: ['images', 'videos'], quality: 0.9 }),
    );
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

  /**
   * L'envoi de la capture, sous la même règle que les trois autres chemins.
   *
   * **C'est celui-ci qui comptait le plus, et il était le dernier sans.** Un
   * envoi de capture qui part en arrière-plan et échoue laisse une créatrice
   * ranger son téléphone en pensant sa contrepartie tenue — elle l'apprend au
   * délai dépassé, quand il n'y a plus rien à faire. Les trois chemins du
   * commerce avaient la règle ; le seul dont l'issue engage quelqu'un ne
   * l'avait pas.
   *
   * **Toute la suite passe par le crochet, dépôt et soumission ensemble.** La
   * reprise automatique ne se déclenche que si la montée n'était pas finie —
   * donc avant que la clé existe, donc avant qu'une soumission ait pu partir.
   * Rejouer l'ensemble ne peut alors rien produire en double.
   */
  async function envoyer() {
    if (!media) return;
    const capture = media;
    setVue({ etat: 'envoi', media: capture });
    vibration.action();
    try {
      await envoiDeFichier.envoyer(capture.uri, (progression) =>
        deposerEtSoumettre(capture, progression),
      );
    } catch (erreur) {
      setVue({ etat: 'echec', media: capture, message: messageDErreur(erreur) });
      vibration.echec();
    }
  }

  async function deposerEtSoumettre(
    capture: Choisi,
    progression: (part: number) => void,
  ) {
    const { screenshot_key } = await api.televerserUneCapture(capture.uri, progression);
      // La note part avec la soumission, jamais séparément : envoyée après,
      // elle arriverait sur un dossier déjà refusé, et le commerce l'aurait
      // lue une fois sa décision prise.
      const propre = note.trim();
      const lien = adresse.trim();
      const contrepartie = await api.soumettreLaPreuve(collaborationId, {
        screenshot_key,
        // Vide, elle ne part pas : le serveur distingue « pas d'adresse » d'une
        // chaîne vide, et une chaîne vide s'écrirait en base comme une adresse.
        ...(lien ? { source_url: lien } : {}),
        ...(propre ? { note: propre } : {}),
      });
      vibration.reussite();
      // **Le résultat se montre avant de quitter l'écran.** Il répond à la
      // question que l'incitation vient de poser, et l'annoncer ailleurs — ou
      // pas du tout — ferait de l'incitation une phrase sans suite.
      setVue({
        etat: 'rendu',
        media: capture,
        verifiee: verdictDe(contrepartie),
        raisons: raisonsDe(contrepartie),
      });
  }

  return (
    <View style={{ gap: 12 }} testID="envoi-de-preuve">
      {/* **`Photo`, et non une `Image` posée à la main.** Les deux aperçus de
          la preuve — celui-ci et celui de la preuve envoyée — montaient leur
          image d'un coup, à pleine opacité, sur un aplat qui n'était pas celui
          des médias. Le composant apporte le fondu, l'aplat `media.placeholder`
          et le respect du mouvement réduit ; sans lui, chaque écran refaisait
          ces trois choses de son côté, et aucun ne les refaisait pareil. */}
      {media ? (
        media.estUneVideo ? (
          // **Une vidéo ne s'affiche pas dans `Photo`.** Elle y rendait un
          // cadre vide, ce qui se lit comme un choix qui n'a pas pris — et la
          // créatrice renvoie alors autre chose. `expo-video` était déjà
          // installé et n'avait aucun appelant.
          <ApercuVideo uri={media.uri} />
        ) : (
          <Photo
            uri={media.uri}
            hauteur={APERCU}
            cadrage="contain"
            style={{ borderRadius: radius['radius.lg'] }}
            testID="apercu-du-choix"
          />
        )
      ) : null}
      {/* **Tranché : l'aperçu ne recadre jamais.** Une capture avec les barres
          système est une preuve valable — ce qui compte est qu'on voie la
          publication, la mention et le lieu. Exiger un cadrage propre ferait
          échouer des preuves honnêtes, et ferait de cet écran un contrôle de
          forme là où il ne vérifie qu'un fait. `contain` le montre entier, et
          cette ligne le dit plutôt que de le laisser deviner. */}
      {media ? (
        <Texte variante="type.caption" couleur="ink.soft" testID="apercu-entier">
          {t('parcours.preuveApercuEntier')}
        </Texte>
      ) : null}

      {vue.etat === 'echec' ? (
        <View style={{ gap: 8 }}>
          {/* **Un échec réseau n'est pas une erreur de la créatrice, et c'est
              l'écran qui doit le dire.** Il décide entre réessayer et
              abandonner, et tout le reste en découle : rien ne se vide, rien ne
              se compte, rien ne devient rouge. Un formulaire efface et
              recommence ; ici il n'y a rien à corriger.

              **Neutre et non cramoisi**, donc — un rouge dirait qu'elle a mal
              fait quelque chose. L'urgence, elle, est portée par l'échéance, en
              bas : le même échec est anodin à deux jours et pressant à six
              heures.

              Le refus de permission garde son message tel quel : celui-là *est*
              une chose à corriger, et il porte sa propre issue. */}
          {vue.media === null ? (
            <>
              <StatusMessage level="danger" body={vue.message} testID="echec-envoi" />
              {/* La seule issue d'un refus de permission. Présente seulement
                  quand c'en est un : un bouton vers les réglages après une
                  panne réseau enverrait chercher au mauvais endroit. */}
              <Button
                label={t('parcours.preuveOuvrirReglages')}
                variant="secondary"
                onPress={() => void Linking.openSettings()}
                testID="ouvrir-les-reglages"
              />
            </>
          ) : (
            <StatusMessage
              level="neutral"
              title={t('parcours.preuveEchecTitre')}
              body={`${t('parcours.preuveEchecCorps')}\n\n${t('parcours.preuveEchecTentative', {
                n: tentatives + 1,
                total: MAX_TENTATIVES,
              })}`}
              testID="echec-envoi"
            />
          )}
        </View>
      ) : null}

      {/* **Interrompu n'est pas échoué.** L'application a quitté le premier
          plan — souvent pour aller vérifier la story qu'on est en train de
          prouver — et la capture est toujours là. Le crochet la reprend seul si
          la montée n'était pas finie. */}
      {envoiDeFichier.interrompu ? (
        <StatusMessage
          level="neutral"
          body={t('parcours.preuveEnvoiInterrompu')}
          testID="envoi-interrompu"
        />
      ) : null}

      {vue.etat === 'envoi' ? (
        <StatusMessage
          level="neutral"
          body={
            envoiDeFichier.part === null
              ? t('parcours.preuveEnvoiEnCours')
              : t('composition.photoEnvoiPart', {
                  part: Math.round(envoiDeFichier.part * 100),
                })
          }
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
          // **Trois états, et l'écran n'en distinguait que deux.** `verifiee`
          // vaut vrai, faux, ou nul — et nul veut dire « la question ne s'est
          // pas posée », pas « la réponse est non ». Le type le disait déjà :
          // « les deux se disent autrement — attestée d'un côté, ne correspond
          // pas de l'autre ». Rendus identiques, ils faisaient croire à une
          // vérification passée là où elle avait échoué.
          //
          // Neutre dans les trois cas : une contrepartie attestée n'est pas un
          // avertissement, une vérifiée n'est pas encore approuvée, et un écart
          // constaté n'est pas un refus — le commerce tranche.
          level="neutral"
          title={t(`parcours.preuve_${etatDeLaVerification(vue.verifiee)}`)}
          body={
            // **Les raisons, quand il y en a.** « Ne correspond pas » sans ses
            // termes se subit : c'est le verdict sans ses termes, la faute
            // corrigée le matin même sur les signaux de l'audience.
            vue.verifiee === false && vue.raisons.length > 0
              ? `${t('parcours.preuve_ecart_aide')}\n\n${vue.raisons.join('\n')}`
              : t(`parcours.preuve_${etatDeLaVerification(vue.verifiee)}_aide`)
          }
          action={{ label: t('common.retour'), onPress: onEnvoye, variant: 'secondary' }}
          testID={`preuve-${etatDeLaVerification(vue.verifiee)}`}
        />
      ) : null}

      {/* **L'incitation, avant l'envoi et pas après.** Soumettre vite fait
          vérifier la publication par la plateforme elle-même ; attendre laisse
          la parole et une capture. C'est la seule chose que la créatrice peut
          décider à cet instant, et elle ne peut la décider qu'en la sachant. */}
      {media && vue.etat !== 'rendu' ? (
        <StatusMessage
          level="neutral"
          title={t('parcours.preuveViteTitre')}
          body={t('parcours.preuveVite')}
          testID="incitation-a-soumettre-vite"
        />
      ) : null}

      {/* **Avant la note.** C'est le champ qui décide de ce que le salon
          pourra vérifier ; la note explique, l'adresse prouve. */}
      {media && vue.etat !== 'rendu' ? (
        <TextField
          label={t('parcours.preuveAdresse')}
          value={adresse}
          onChangeText={setAdresse}
          helpText={t('parcours.preuveAdresseAide')}
          maxLength={LONGUEUR_DE_L_ADRESSE}
          testID="adresse-de-la-publication"
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
          /* **L'état d'envoi vient du crochet autant que de `vue`.** La reprise
             au retour au premier plan relance sans passer par `envoyer` : sans
             cette lecture, l'écran resterait sur « réessayer » pendant qu'un
             envoi vole, et un second appui enverrait la capture deux fois. */
          label={t(
            vue.etat === 'echec' && !envoiDeFichier.enVol
              ? 'parcours.preuveReessayer'
              : 'parcours.preuveEnvoyerCelle_ci',
          )}
          size="lg"
          loading={vue.etat === 'envoi' || envoiDeFichier.enVol}
          onPress={() => void envoyer()}
          testID="confirmer-l-envoi"
        />
      ) : null}

      {/* **C'est l'échéance qui porte l'urgence, et elle seule.** Le même échec
          est anodin à deux jours et pressant à six heures ; la conduite change
          avec elle, pas le ton du bandeau. Elle se lit sous le bouton parce que
          c'est là qu'on décide de réessayer maintenant ou plus tard. */}
      {media && vue.etat !== 'rendu' ? (
        <Texte variante="type.caption" couleur="ink.soft" testID="echeance-de-l-envoi">
          {presseParLEcheance(echeance)
            ? t('parcours.preuveEcheanceProche')
            : t('parcours.preuveEcheanceTient')}
        </Texte>
      ) : null}

      <Texte variante="type.caption" couleur="ink.soft">
        {t('parcours.preuveCommentFaire')}
      </Texte>

      {/* **Ce qui sera refusé, dit avant de choisir.** Le poids n'existait que
          dans le message d'erreur : on l'apprenait après avoir choisi, parfois
          après avoir attendu l'envoi sur le réseau d'un salon. Le dire ici ne
          coûte qu'une ligne et évite le seul aller-retour que cet écran
          impose.

          Aucune durée ni ratio annoncés — parce qu'il n'y en a aucun. Le
          produit n'a qu'une contrainte objective, le poids, éprouvée des deux
          côtés ; en inventer une seconde ici la rendrait vraie à l'écran et
          fausse au serveur. */}
      <Texte variante="type.caption" couleur="ink.soft" testID="preuve-contraintes">
        {t('parcours.preuveContraintes', { poids: Math.round(POIDS_MAXIMAL / (1024 * 1024)) })}
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
