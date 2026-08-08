/**
 * Rattacher un compte social, et revenir.
 *
 * **Le rappel d'autorisation n'arrive pas sur le téléphone.** Meta le poste à
 * l'adresse déclarée dans l'application Meta, qui désigne l'API — un tunnel en
 * développement, un domaine en production. L'app, elle, tourne ailleurs. Rien
 * ne la ramène toute seule.
 *
 * D'où les deux moitiés de ce module :
 *
 * **On dit au serveur où revenir.** L'adresse est celle de l'app, construite
 * par `expo-linking` : `exp://192.168.4.54:8081/--/oauth` sous Expo Go,
 * `bind://oauth` dans une application compilée. Le serveur la garde avec
 * l'état OAuth et redirige dessus une fois le compte rattaché — c'est la seule
 * façon de traverser, puisque le rappel et l'app ne sont pas sur la même
 * machine.
 *
 * **On ouvre une session d'authentification, pas un navigateur.**
 * `openAuthSessionAsync` surveille la barre d'adresse et **referme le
 * navigateur** dès qu'elle atteint l'adresse de retour. `Linking.openURL`
 * envoie dans Safari et n'en revient jamais : la personne se retrouve devant
 * une réponse JSON, doit revenir à la main, et l'app ne sait rien.
 *
 * **Le résultat est un fait, pas un secret.** La redirection ne porte qu'un
 * statut : le jeton a été échangé côté serveur, et le compte existe déjà quand
 * l'app reprend la main. Elle relit ses comptes par une route authentifiée
 * plutôt que de croire un paramètre d'URL.
 */
import { useCallback, useState } from 'react';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import type { Api, PlateformeConnectable } from '../api';
import { vibration } from '../components';

/**
 * Le chemin de retour dans l'app.
 *
 * Fixe : le serveur n'accepte que les schémas déclarés, et une adresse qui
 * changerait d'un écran à l'autre demanderait de toutes les déclarer.
 */
const CHEMIN_DE_RETOUR = 'oauth';

export type Issue =
  /** Le compte est rattaché côté serveur. À l'app de relire ses comptes. */
  | { issue: 'rattache' }
  /** La personne a fermé le navigateur, ou est revenue en arrière. */
  | { issue: 'abandon' }
  /** Le serveur a refusé. `code` est un code du catalogue, déjà traduisible. */
  | { issue: 'echec'; code: string | null };

/** L'adresse à laquelle le serveur doit renvoyer. */
export function adresseDeRetour(): string {
  return Linking.createURL(CHEMIN_DE_RETOUR);
}

export async function rattacherUnReseau(
  api: Api,
  plateforme: PlateformeConnectable,
): Promise<Issue> {
  const retour = adresseDeRetour();
  const { authorization_url } = await api.connecterUnReseau(plateforme, retour);

  const resultat = await WebBrowser.openAuthSessionAsync(authorization_url, retour);

  // `dismiss` et `cancel` : la personne a fermé la vue elle-même. Ce n'est pas
  // un échec — lui montrer une erreur pour un geste volontaire est agressif.
  if (resultat.type !== 'success') return { issue: 'abandon' };

  const parametres = Linking.parse(resultat.url).queryParams ?? {};
  const statut = typeof parametres.statut === 'string' ? parametres.statut : null;

  if (statut === 'rattache') return { issue: 'rattache' };
  return { issue: 'echec', code: typeof parametres.code === 'string' ? parametres.code : null };
}


/**
 * L'état d'un rattachement en cours, et le geste qui le lance.
 *
 * **Un seul exemplaire.** Les deux écrans qui proposent de rattacher un réseau
 * portaient chacun leur copie de cette dizaine de lignes. L'une d'elles s'est
 * retrouvée avec un `try` vide : l'appui posait l'état de chargement, ne
 * faisait rien, et le retirait aussitôt. Aucune erreur, aucune vue, rien —
 * exactement le silence qu'on cherche à supprimer partout ailleurs. Deux copies
 * d'une même logique, c'est une copie qui peut se vider sans qu'on le voie.
 *
 * **Un appui produit toujours quelque chose.** Chargement, puis la vue
 * d'autorisation, puis l'un des trois résultats. Un abandon ne dit rien —
 * fermer la vue est un geste volontaire, y répondre par une erreur est
 * agressif — mais tous les autres chemins parlent.
 */
export function useRattachement({
  api,
  traduire,
  messageDErreur,
  onRattache,
}: {
  api: Api;
  /** Traduit un code du catalogue. Fourni par l'écran, qui a le `t`. */
  traduire: (code: string | null) => string;
  messageDErreur: (erreur: unknown) => string;
  onRattache: () => void;
}) {
  const [ouverture, setOuverture] = useState<PlateformeConnectable | null>(null);
  const [echec, setEchec] = useState<string | null>(null);

  const connecter = useCallback(
    async (plateforme: PlateformeConnectable) => {
      setOuverture(plateforme);
      setEchec(null);
      vibration.action();
      try {
        const resultat = await rattacherUnReseau(api, plateforme);

        if (resultat.issue === 'rattache') {
          vibration.reussite();
          onRattache();
          return;
        }
        if (resultat.issue === 'echec') {
          vibration.echec();
          setEchec(traduire(resultat.code));
        }
      } catch (erreur) {
        // L'ouverture elle-même a échoué : personne n'est encore parti, et un
        // écran muet passe pour un bouton mort.
        vibration.echec();
        setEchec(messageDErreur(erreur));
      } finally {
        setOuverture(null);
      }
    },
    [api, messageDErreur, onRattache, traduire],
  );

  return { ouverture, echec, connecter };
}
