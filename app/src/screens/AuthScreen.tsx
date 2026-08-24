/**
 * Connexion et inscription.
 *
 * **Le rôle se choisit avant le formulaire, sur deux portes.** Il se choisissait
 * au milieu de l'inscription, sur une paire de pastilles entre le mot de passe
 * et le bouton — au moment où l'on remplit, pas au moment où l'on décide. Un
 * créateur et un salon ne viennent pas chercher la même chose ; `ChoixDeLaPorte`
 * pose la question d'abord, avec ce que chaque réponse engage.
 *
 * **Le formulaire garde le contexte de la porte franchie.** Sur grand écran, un
 * panneau d'encre reprend la promesse choisie et ses trois étapes : sans lui, le
 * formulaire est deux champs dans du vide, et l'on ne sait plus ce qu'on est en
 * train de créer.
 *
 * **Se connecter ne passe pas par les portes.** Qui a déjà un compte a déjà un
 * rôle ; le lui redemander serait une question dont on connaît la réponse.
 *
 * **Le rôle administrateur ne se choisit pas.** L'API l'accepte, mais l'offrir
 * dans un formulaire public ferait de « administrateur » une case à cocher.
 * Ces comptes se créent autrement.
 *
 * **Le motif de sortie s'affiche ici**, parce que c'est ici qu'on revient :
 * session expirée, compte suspendu, déconnexion. Un écran de connexion muet
 * après une expiration laisse croire à un bug.
 */
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useApi } from '../api';
import { Apparition, Button, Marque, StatusMessage, TextField, Texte } from '../components';
import { useI18n } from '../i18n';
import { useSession, type MotifDeSortie, type RoleInscriptible } from '../session';
import { radius, spacing, useColors, useTheme } from '../theme';
import { useGabarit } from '../shell/gabarit';
import { AccueilScreen } from './AccueilScreen';

/** Le minimum imposé par l'API. La jauge s'y adosse plutôt que de le redire. */
const CARACTERES_REQUIS = 12;

/** La largeur du panneau d'encre, et celle du formulaire. */
const PANNEAU = 604;
const FORMULAIRE = 480;

const MESSAGE_DE_SORTIE: Record<MotifDeSortie, { cle: string; niveau: 'danger' | 'neutral' }> = {
  session_expiree: { cle: 'auth.sessionExpiree', niveau: 'neutral' },
  compte_suspendu: { cle: 'auth.compteSuspendu', niveau: 'danger' },
  deconnexion: { cle: 'auth.deconnexion', niveau: 'neutral' },
};

export function AuthScreen({ motif }: { motif: MotifDeSortie | null }) {
  const { t } = useI18n();
  const { density } = useTheme();
  const c = useColors();
  const { large } = useGabarit();
  const { messageDErreur } = useApi();
  const { connecter, inscrire } = useSession();
  // Aucune barre d'onglets avant la connexion : la marge du bas, que
  // `ZoneSure` laisse à la barre, n'a personne pour la poser ici.
  const marges = useSafeAreaInsets();

  // `choix` n'existe qu'à l'inscription : se connecter n'a pas de porte.
  /**
   * **Les portes sont l'entrée, pas une étape cachée derrière un lien.**
   * L'écran démarrait sur « Sign in », et les deux portes n'apparaissaient
   * qu'après avoir pressé « No account yet? » : on demandait donc de se
   * connecter à quelqu'un qui n'a pas encore de compte. La maquette 06a montre
   * l'inverse — le choix occupe l'écran, et « Already have an account? » n'est
   * qu'un lien de coin.
   *
   * Une exception : quelqu'un renvoyé ici par une session expirée a un compte.
   * Lui montrer les portes serait lui demander de choisir un rôle qu'il a
   * déjà.
   */
  const revient = motif !== null;
  const [etape, setEtape] = useState<'choix' | 'formulaire'>(revient ? 'formulaire' : 'choix');
  const [inscription, setInscription] = useState(!revient);
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  /**
   * La confirmation, **à l'inscription seulement**.
   *
   * Un mot de passe masqué se saisit à l'aveugle : une faute de frappe crée un
   * compte auquel personne ne peut se connecter, et le seul recours est de
   * recommencer avec une autre adresse. À la connexion elle n'a aucun sens — le
   * serveur dit déjà si c'est le bon.
   */
  const [confirmation, setConfirmation] = useState('');
  const [role, setRole] = useState<RoleInscriptible>('creator');
  const [envoi, setEnvoi] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);

  async function valider() {
    setEnvoi(true);
    setEchec(null);
    try {
      if (inscription) await inscrire(email.trim(), motDePasse, role);
      else await connecter(email.trim(), motDePasse);
    } catch (erreur) {
      // Le catalogue traduit : `invalid_credentials` dit « identifiants
      // incorrects », jamais « 401 ».
      setEchec(messageDErreur(erreur));
    } finally {
      setEnvoi(false);
    }
  }

  const sortie = motif ? MESSAGE_DE_SORTIE[motif] : null;
  const reste = Math.max(0, CARACTERES_REQUIS - motDePasse.length);
  /**
   * **Comparée seulement une fois la seconde saisie commencée.** Annoncer
   * « elles ne correspondent pas » sur un champ vide est un reproche avant
   * d'avoir rien fait — la même raison qui retient la jauge.
   */
  const discordent = inscription && confirmation.length > 0 && confirmation !== motDePasse;
  // À l'inscription, la confirmation fait partie de « complet » : le bouton
  // reste fermé tant que les deux saisies diffèrent, plutôt que de créer un
  // compte dont le mot de passe n'est pas celui qu'on croit avoir tapé.
  const complet =
    email.includes('@') && reste === 0 && (!inscription || confirmation === motDePasse);

  if (inscription && etape === 'choix') {
    // **L'accueil occupe l'écran.** Il ne s'inscrit pas dans le conteneur
    // centré du formulaire, qui lui imposerait des marges et une largeur
    // bornée — une vidéo de fond qui s'arrête à 480 n'est pas un fond.
    return (
      <AccueilScreen
        onChoisir={(choisi) => {
          setRole(choisi);
          setEtape('formulaire');
        }}
        onSeConnecter={() => {
          setInscription(false);
          setEtape('formulaire');
        }}
      />
    );
  }

  /**
   * **Le panneau d'encre est parti, sans être remplacé.**
   *
   * Il existait pour donner un contexte au formulaire : il reprenait la
   * promesse de la porte franchie et ses trois étapes. Sur la connexion, il
   * expliquait donc le produit à quelqu'un **qui a déjà un compte** —
   * c'est-à-dire à la seule personne qui n'a pas besoin qu'on le lui explique.
   *
   * Et rien ne le remplace : une colonne de 420 centrée dans du blanc est ce
   * qu'un formulaire de connexion doit être. Le vide qu'on lui reprochait
   * venait de sa largeur, pas de son absence de voisin.
   */

  return (
    <ScrollView
      testID="ecran-auth"
      style={{ flex: 1, backgroundColor: c['bg.page'] }}
      contentContainerStyle={{
        padding: density.screenPadding,
        paddingBottom: density.screenPadding + marges.bottom,
        flexGrow: 1,
        justifyContent: 'center',
        alignSelf: 'center',
      }}
      keyboardShouldPersistTaps="handled"
    >
      <View>
        <View style={{ width: large ? FORMULAIRE : undefined, gap: 16, justifyContent: 'center' }}>
          <Apparition>
            <View style={{ alignItems: large ? 'flex-start' : 'center', gap: 18, paddingBottom: 6 }}>
              {/* **La marque ouvre l'écran, et elle est centrée en compact.**
                  C'est elle qui dit où l'on est, à la place du titre. En grand,
                  la colonne est déjà centrée dans la page et la marque revient
                  à gauche, alignée sur les champs. */}
              <Marque taille={26} />
              {inscription ? (
                <Button
                  label={t('common.retour')}
                  variant="ghost"
                  fullWidth={false}
                  onPress={() => setEtape('choix')}
                  testID="revenir-aux-portes"
                />
              ) : null}
              {/* **Le titre disparaît en compact.** Deux champs nommés et un
                  bouton disent déjà où l'on est ; la marque juste au-dessus le
                  confirme. En grand, la colonne flotte au milieu d'une page
                  vide et le titre lui rend un point d'entrée — c'est ce que la
                  planche montre, et la différence tient à la place. */}
              {large ? (
                <Texte variante="type.screenTitle">
                  {inscription ? t('auth.titreInscription') : t('auth.titreConnexion')}
                </Texte>
              ) : null}
            </View>
          </Apparition>

          {/* Pourquoi on est revenu ici. Effacé dès qu'on saisit quelque chose. */}
          {sortie && !echec && email === '' ? (
            <StatusMessage level={sortie.niveau} body={t(sortie.cle)} testID="motif-de-sortie" />
          ) : null}

          <TextField
            label={t('auth.email')}
            value={email}
            onChangeText={setEmail}
            keyboard="default"
            testID="champ-email"
          />
          <TextField
            label={t('auth.motDePasse')}
            value={motDePasse}
            onChangeText={setMotDePasse}
            // Masqué, et relisable. Il s'affichait en clair : douze caractères
            // en grand, sur le premier écran du produit, dans un salon ou un
            // café. Et masquer sans donner le moyen de relire fait ressaisir
            // trois fois la même chaîne sur un clavier de téléphone.
            secret
            labelRevelation={{
              montrer: t('auth.montrerLeMotDePasse'),
              masquer: t('auth.masquerLeMotDePasse'),
            }}
            helpText={
              reste > 0
                ? t('auth.resteACombler', { requis: CARACTERES_REQUIS, reste })
                : t('auth.motDePasseComplet', { requis: CARACTERES_REQUIS })
            }
            testID="champ-mot-de-passe"
          />

          {inscription ? (
            <TextField
              label={t('auth.confirmation')}
              value={confirmation}
              onChangeText={setConfirmation}
              secret
              labelRevelation={{
                montrer: t('auth.montrerLeMotDePasse'),
                masquer: t('auth.masquerLeMotDePasse'),
              }}
              helpText={discordent ? t('auth.confirmationDiscordante') : undefined}
              testID="champ-confirmation"
            />
          ) : null}

          {/* La jauge dit ce qui manque, en clair. Elle n'apparaît qu'une fois
              la saisie commencée : « 0 / 12 » devant un champ vide sonne comme
              un reproche avant d'avoir rien fait. */}
          {inscription && motDePasse.length > 0 && reste > 0 ? (
            <Texte variante="type.data" couleur="ink.mute" testID="jauge">
              {t('auth.jauge', { saisi: motDePasse.length, requis: CARACTERES_REQUIS })}
            </Texte>
          ) : null}

          {echec ? <StatusMessage level="danger" body={echec} testID="echec-auth" /> : null}

          {/* **Le bouton reste visible, désactivé.** `components.md` §1 fait
              disparaître l'action impossible, et la passation v0.6 nomme cette
              exception : c'est une action qui redeviendra possible dès qu'on
              aura fini de taper. Le retirer laissait un écran sans issue
              visible — on remplissait deux champs sans voir où cela menait. */}
          <Button
            label={inscription ? t('auth.sInscrire') : t('auth.seConnecter')}
            loadingLabel={inscription ? t('auth.inscriptionEnCours') : t('auth.connexionEnCours')}
            size="lg"
            disabled={!complet}
            loading={envoi}
            onPress={valider}
            testID="valider"
          />

          {inscription ? (
            <Texte variante="type.caption" couleur="ink.mute">
              {t(role === 'creator' ? 'auth.autrePorteCreateur' : 'auth.autrePorteCommerce')}
            </Texte>
          ) : null}

          <Button
            label={inscription ? t('auth.versConnexion') : t('auth.versInscription')}
            variant="ghost"
            onPress={() => {
              const versInscription = !inscription;
              setInscription(versInscription);
              setEtape(versInscription ? 'choix' : 'formulaire');
              setEchec(null);
            }}
            testID="basculer"
          />
        </View>
      </View>
    </ScrollView>
  );
}
