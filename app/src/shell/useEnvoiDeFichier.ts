/**
 * Un envoi de fichier : sa progression, et le premier plan comme condition.
 *
 * **C'est le seul endroit du produit où l'attente est assez longue pour qu'un
 * filet qui parcourt mente.** Une photo sur le réseau d'un salon prend des
 * secondes ; un filet qui boucle dit « ça travaille » sans dire si l'on est au
 * début ou à la fin, et quelqu'un qui ne sait pas quitte l'écran.
 *
 * **L'envoi ne part qu'au premier plan, et s'arrête s'il le quitte.** Un envoi
 * en arrière-plan qui échoue laisse croire qu'il a fini — c'est la pire des
 * issues, parce qu'elle ne se signale jamais : la créatrice range son téléphone
 * en pensant sa contrepartie tenue, et l'apprend au délai dépassé. Couper est
 * moins bon qu'aboutir, et infiniment meilleur que mentir.
 *
 * Le fichier survit à l'interruption comme il survit à l'échec : c'est la même
 * question — réessayer ou abandonner — et elle se tranche sur ce qu'on voit.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

type Action = (progression: (part: number) => void, signal: AbortSignal) => Promise<unknown>;

export type EtatDEnvoi = {
  /** Vrai pendant que ça monte. */
  enVol: boolean;
  /**
   * Entre 0 et 1, ou nul quand la plateforme ne sait pas mesurer.
   *
   * **Nul plutôt que zéro.** Un serveur derrière un proxy qui réécrit la taille
   * ne donne aucune longueur ; afficher « 0 % » qui ne bougerait jamais serait
   * pire que de n'afficher qu'un mot.
   */
  part: number | null;
  /** Le fichier qui n'est pas passé, gardé pour le renvoyer sans rouvrir la galerie. */
  aRenvoyer: string | null;
  /** Vrai quand c'est l'application quittée qui a coupé, et non le réseau. */
  interrompu: boolean;
};

const AU_REPOS: EtatDEnvoi = { enVol: false, part: null, aRenvoyer: null, interrompu: false };

export function useEnvoiDeFichier() {
  const [etat, setEtat] = useState<EtatDEnvoi>(AU_REPOS);
  const enCours = useRef<AbortController | null>(null);
  /** Le dernier envoi, pour le reprendre au retour sans rouvrir la galerie. */
  const dernier = useRef<{ uri: string; action: Action } | null>(null);
  /**
   * Vrai dès que les octets sont tous partis.
   *
   * **C'est ce qui décide si la reprise est automatique.** Un envoi coupé
   * pendant la montée n'a rien laissé au serveur : le reprendre ne coûte que
   * des octets. Coupé **après**, le fichier est déposé et le rattachement a pu
   * partir — reprendre ajouterait une seconde photo à la galerie. On garde
   * alors le bouton, et c'est la créatrice qui tranche.
   */
  const monteeFinie = useRef(false);

  /**
   * **Couper au départ du premier plan.**
   *
   * `inactive` compte autant que `background` : sur iOS c'est l'état du
   * sélecteur d'applications et du volet de contrôle, où l'envoi continuerait
   * sans que rien ne soit à l'écran pour le dire.
   */
  useEffect(() => {
    const abonnement = AppState.addEventListener('change', (etatDeLApp) => {
      if (etatDeLApp === 'active') {
        // **La reprise au retour, et c'est le geste qu'on attend.** Quitter
        // l'application une seconde pour vérifier sa story est exactement ce
        // qu'une créatrice fait à ce moment-là : rester en échec produirait la
        // panne qu'on venait d'éviter.
        //
        // Seulement si la montée n'était pas finie : au-delà, le fichier est
        // déjà chez le serveur, le rattachement a pu partir, et reprendre
        // ajouterait un doublon. Le bouton reste, et c'est elle qui tranche.
        const aReprendre = dernier.current;
        if (aReprendre && !monteeFinie.current) void lancer(aReprendre.uri, aReprendre.action);
        return;
      }
      if (!enCours.current) return;
      enCours.current.abort();
      enCours.current = null;
      setEtat((precedent) => ({ ...precedent, enVol: false, interrompu: true }));
    });
    return () => abonnement.remove();
  }, []);

  const lancer = useCallback(
    async (uri: string, action: Action) => {
      // **Rien ne part hors du premier plan.** Le crochet coupe ce qui est en
      // vol ; refuser de démarrer ferme l'autre moitié — un geste posé pendant
      // que l'application se range n'a personne pour en lire l'issue.
      // **Refuser seulement ce qu'on sait.** `currentState` vaut `unknown` sur
      // certaines plateformes et au tout premier rendu ; traiter l'inconnu
      // comme de l'arrière-plan interdirait un envoi parfaitement légitime, ce
      // qui est le défaut inverse et tout aussi silencieux.
      if (AppState.currentState === 'background' || AppState.currentState === 'inactive') {
        setEtat({ enVol: false, part: null, aRenvoyer: uri, interrompu: true });
        return false;
      }

      const controleur = new AbortController();
      enCours.current = controleur;
      dernier.current = { uri, action };
      monteeFinie.current = false;
      setEtat({ enVol: true, part: null, aRenvoyer: uri, interrompu: false });

      try {
        await action((part) => {
          if (controleur.signal.aborted) return;
          if (part >= 1) monteeFinie.current = true;
          setEtat((precedent) => (precedent.enVol ? { ...precedent, part } : precedent));
        }, controleur.signal);
        dernier.current = null;
        setEtat(AU_REPOS);
        return true;
      } catch (erreur) {
        // L'interruption est déjà dite par l'écouteur : ne pas l'écraser par un
        // message de réseau, qui enverrait chercher une panne qui n'existe pas.
        setEtat((precedent) =>
          precedent.interrompu
            ? { ...precedent, enVol: false }
            : { enVol: false, part: null, aRenvoyer: uri, interrompu: false },
        );
        throw erreur;
      } finally {
        if (enCours.current === controleur) enCours.current = null;
      }
    },
    [],
  );

  const oublier = useCallback(() => {
    dernier.current = null;
    setEtat(AU_REPOS);
  }, []);

  return { ...etat, envoyer: lancer, oublier };
}
