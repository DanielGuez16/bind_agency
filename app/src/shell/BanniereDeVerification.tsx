/**
 * « Confirme ton adresse », au-dessus de tout le reste.
 *
 * ## Pourquoi dans la coquille et pas sur un écran
 *
 * Le compte non confirmé n'est pas un état d'écran, c'est un état de compte :
 * il suit la personne du fil aux paliers, et un rappel posé sur un seul écran
 * serait absent de celui où le refus tombe. La bannière vit donc là où vit la
 * session, au-dessus de la navigation, et se retire d'elle-même quand la
 * session apprend que l'adresse a été confirmée.
 *
 * ## Pourquoi elle n'empêche rien
 *
 * **Elle avertit, elle ne barre pas.** Quelqu'un qui vient de s'inscrire peut
 * parcourir le fil, ouvrir des salons, regarder ses paliers ; ce sont la
 * réservation et la mise en ligne que le serveur refuse. Une porte fermée dès
 * l'accueil ferait perdre la seule chose qui donne envie de confirmer — avoir
 * vu ce qu'il y a derrière.
 *
 * ## L'accueil du retour de lien
 *
 * Le lien du courriel vise l'API et s'ouvre dans un navigateur : c'est délibéré
 * côté serveur, un lien qui viserait l'application supposerait qu'elle est
 * installée. L'application n'est donc jamais appelée — **elle est revenue**.
 * D'où le seul accueil qui existe vraiment ici : au retour au premier plan, on
 * relit le compte. La personne confirme dans son navigateur, revient, et la
 * bannière a disparu sans qu'elle ait rien eu à toucher.
 *
 * C'est aussi pourquoi le renvoi relit le compte quoi qu'il arrive. Le serveur
 * répond 409 sur une adresse déjà confirmée : sans cette relecture, le geste le
 * plus naturel de quelqu'un qui vient de confirmer — « ça n'a pas marché, je
 * redemande un lien » — afficherait une erreur pour annoncer une réussite.
 */
import { useCallback, useEffect, useState } from 'react';
import { AppState, View } from 'react-native';

import { StatusMessage } from '../components';
import { useI18n } from '../i18n';
import { useSession } from '../session';

/** Où en est le renvoi. Trois états, et le repos n'en est pas un quatrième. */
type Envoi = 'repos' | 'en-cours' | 'parti' | 'echec';

export function BanniereDeVerification() {
  const session = useSession();
  const { t } = useI18n();
  const [envoi, setEnvoi] = useState<Envoi>('repos');

  const relire = session.relireLeCompte;

  // **Le retour au premier plan.** C'est l'instant exact où quelqu'un revient
  // de sa boîte mail, et le seul signal dont on dispose puisque le lien ne
  // rappelle pas l'application. Sur le web, `AppState` suit la visibilité de
  // l'onglet, ce qui couvre le même geste : on change d'onglet, on confirme,
  // on revient.
  useEffect(() => {
    const abonnement = AppState.addEventListener('change', (etat) => {
      if (etat === 'active') void relire();
    });
    return () => abonnement.remove();
  }, [relire]);

  const renvoyer = useCallback(async () => {
    setEnvoi('en-cours');
    try {
      await session.renvoyerLaVerification();
      setEnvoi('parti');
    } catch {
      // Y compris le 409 « déjà vérifiée » : `renvoyerLaVerification` a relu le
      // compte avant de propager, donc la bannière est déjà en train de
      // disparaître et cet état ne sera pas rendu.
      setEnvoi('echec');
    }
  }, [session]);

  // Connecté et non confirmé, sinon rien. **Nul veut dire « pas encore »** : un
  // compte qui n'a jamais eu d'adresse à confirmer n'existe pas, l'inscription
  // en exige une.
  if (session.etat !== 'connecte' || session.utilisateur.email_verified_at !== null) {
    return null;
  }

  const corps =
    envoi === 'parti'
      ? t('verification.envoye', { email: session.utilisateur.email ?? '' })
      : envoi === 'echec'
        ? t('verification.echec')
        : t('verification.corps', { email: session.utilisateur.email ?? '' });

  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
      <StatusMessage
        level="warning"
        title={t('verification.titre')}
        body={corps}
        testID="banniere-verification"
        action={{
          label: envoi === 'parti' ? t('verification.renvoyerEncore') : t('verification.renvoyer'),
          onPress: () => void renvoyer(),
          loading: envoi === 'en-cours',
          loadingLabel: t('verification.envoiEnCours'),
          variant: 'secondary',
          testID: 'renvoyer-verification',
        }}
      />
    </View>
  );
}
