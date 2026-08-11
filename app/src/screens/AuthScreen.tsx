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

import { useApi } from '../api';
import { Apparition, Button, Marque, StatusMessage, TextField, Texte } from '../components';
import { useI18n } from '../i18n';
import { useSession, type MotifDeSortie, type RoleInscriptible } from '../session';
import { radius, spacing, useColors, useTheme } from '../theme';
import { useGabarit } from '../shell/gabarit';
import { ChoixDeLaPorte } from './ChoixDeLaPorte';

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
  const complet = email.includes('@') && reste === 0;

  if (inscription && etape === 'choix') {
    return (
      <ScrollView
        testID="ecran-auth"
        style={{ flex: 1, backgroundColor: c['bg.canvas'] }}
        contentContainerStyle={{
          padding: density.screenPadding,
          flexGrow: 1,
          justifyContent: 'center',
          alignSelf: 'center',
        }}
        keyboardShouldPersistTaps="handled"
      >
        <ChoixDeLaPorte
          onChoisir={(choisi) => {
            setRole(choisi);
            setEtape('formulaire');
          }}
          onSeConnecter={() => {
            setInscription(false);
            setEtape('formulaire');
          }}
        />
      </ScrollView>
    );
  }

  /**
   * Le panneau d'encre : la promesse franchie, et ce qui vient ensuite.
   *
   * **Il vaut aussi pour la connexion.** Il était conditionné à l'inscription,
   * et l'écran le plus visité du produit restait donc une colonne de 480
   * centrée dans du vide — exactement le défaut de fond que la v0.6 devait
   * corriger, laissé sur la première chose qu'on voit. Se connecter n'a pas de
   * porte à rappeler ; le panneau y porte alors la promesse commune, celle qui
   * vaut pour les deux côtés du produit.
   */
  const suffixe = role === 'creator' ? 'Createur' : 'Commerce';
  const panneau = (
    <View
      testID="panneau-de-promesse"
      style={{
        width: PANNEAU,
        padding: spacing['space.8'],
        gap: spacing['space.6'],
        borderRadius: radius['radius.xl'],
        backgroundColor: c['bg.inverse'],
        justifyContent: 'center',
      }}
    >
      {inscription ? (
        <Texte variante="type.label" style={{ color: c['text.inverse'] }}>
          {(role === 'creator' ? t('auth.roleCreator') : t('auth.roleMerchant')).toUpperCase()}
        </Texte>
      ) : (
        <Marque taille={30} couleur="text.inverse" />
      )}
      <Texte variante="type.heading" style={{ color: c['text.inverse'] }}>
        {inscription
          ? t(role === 'creator' ? 'auth.porteCreateur' : 'auth.porteCommerce')
          : t('auth.accroche')}
      </Texte>
      {inscription ? null : (
        <Texte style={{ color: c['text.inverse'] }}>{t('auth.sousAccroche')}</Texte>
      )}
      <View style={{ gap: spacing['space.4'] }}>
        {(inscription ? [1, 2, 3] : []).map((rang) => (
          <View key={rang} style={{ flexDirection: 'row', gap: spacing['space.3'] }}>
            <Texte variante="type.mono" style={{ color: c['accent.default'] }}>
              {String(rang).padStart(2, '0')}
            </Texte>
            <Texte style={{ color: c['text.inverse'], flex: 1 }}>
              {t(`auth.etape${suffixe}${rang}`)}
            </Texte>
          </View>
        ))}
      </View>
    </View>
  );

  return (
    <ScrollView
      testID="ecran-auth"
      style={{ flex: 1, backgroundColor: c['bg.canvas'] }}
      contentContainerStyle={{
        padding: density.screenPadding,
        flexGrow: 1,
        justifyContent: 'center',
        alignSelf: 'center',
      }}
      keyboardShouldPersistTaps="handled"
    >
      <View
        style={{
          flexDirection: 'row',
          gap: spacing['space.8'],
          alignItems: 'stretch',
        }}
      >
        {/* Le panneau n'existe qu'en grand : en compact il prendrait toute la
            première page et repousserait les champs sous la ligne de flottaison. */}
        {large ? panneau : null}

        <View style={{ width: large ? FORMULAIRE : undefined, gap: 16, justifyContent: 'center' }}>
          <Apparition>
            <View style={{ alignItems: 'flex-start', gap: 18, paddingBottom: 6 }}>
              {/* La marque en grand : c'est le premier écran, et le seul où
                  l'on a la place de la montrer. Ailleurs, le signe suffit. */}
              {large ? null : <Marque taille={44} />}
              {inscription ? (
                <Button
                  label={t('common.retour')}
                  variant="ghost"
                  fullWidth={false}
                  onPress={() => setEtape('choix')}
                  testID="revenir-aux-portes"
                />
              ) : null}
              <Texte variante="type.display">
                {inscription ? t('auth.titreInscription') : t('auth.titreConnexion')}
              </Texte>
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
            helpText={
              reste > 0
                ? t('auth.resteACombler', { requis: CARACTERES_REQUIS, reste })
                : t('auth.motDePasseComplet', { requis: CARACTERES_REQUIS })
            }
            testID="champ-mot-de-passe"
          />

          {/* La jauge dit ce qui manque, en clair. Elle n'apparaît qu'une fois
              la saisie commencée : « 0 / 12 » devant un champ vide sonne comme
              un reproche avant d'avoir rien fait. */}
          {inscription && motDePasse.length > 0 && reste > 0 ? (
            <Texte variante="type.mono" couleur="text.muted" testID="jauge">
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
            <Texte variante="type.caption" couleur="text.muted">
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
