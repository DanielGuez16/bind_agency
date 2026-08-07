/**
 * Les quatre états d'un écran, une fois pour toutes.
 *
 * **Un écran sans état d'erreur n'est pas fini.** Les écrire à la main dans
 * chaque écran garantit qu'il en manquera un quelque part, et que ce sera
 * l'erreur — celle qu'on ne voit pas en développant, parce que le serveur
 * répond. Ici les quatre existent par construction, et un test les parcourt
 * tous sur tous les écrans.
 *
 * **Le vide n'est pas l'erreur.** Une liste vide est une réponse valide qui
 * demande une conduite — élargir le rayon, changer de jour — là où une erreur
 * demande de réessayer. Les confondre ferait proposer « réessayer » à quelqu'un
 * dont la requête a parfaitement fonctionné.
 *
 * **Le rafraîchissement se fait à l'ouverture d'écran et sur geste, rien de
 * plus.** Pas de sondage, pas de canal poussé : ils n'existent pas côté
 * serveur, et en simuler donnerait une fraîcheur que le produit ne tient pas.
 *
 * **Une donnée périmée s'affiche datée plutôt que masquée.** `vuA` porte
 * l'instant du dernier chargement réussi : pendant un rechargement, l'écran
 * continue de montrer ce qu'il avait, marqué de sa date.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type EtatDeRequete<T> =
  | { etat: 'chargement' }
  | { etat: 'pret'; donnees: T; vide: boolean; vuA: number; rechargement: boolean }
  | { etat: 'erreur'; erreur: unknown; donnees: T | null; vuA: number | null };

export type Requete<T> = EtatDeRequete<T> & {
  /** Le geste. Recharge sans effacer ce qui est à l'écran. */
  recharger: () => void;
};

export type OptionsDeRequete<T> = {
  /**
   * Ce qui décide qu'une réponse est vide.
   *
   * Obligatoire, et sans valeur par défaut : « vide » ne se devine pas. Une
   * liste vide l'est, un objet dont toutes les listes sont vides aussi, un
   * objet avec un seul champ nul ne l'est pas forcément. Le laisser deviner
   * ferait afficher un état vide sur une réponse pleine, ou l'inverse.
   */
  estVide: (donnees: T) => boolean;
  /** Rejoue la requête quand une de ces valeurs change. */
  dependances?: readonly unknown[];
  /** Ne lance rien tant que c'est faux. Pour un écran qui attend une position. */
  actif?: boolean;
};

export function useRequete<T>(
  charger: (signal: AbortSignal) => Promise<T>,
  { estVide, dependances = [], actif = true }: OptionsDeRequete<T>,
): Requete<T> {
  const [etat, setEtat] = useState<EtatDeRequete<T>>({ etat: 'chargement' });
  const [tour, setTour] = useState(0);

  // La fonction de chargement change à chaque rendu chez la plupart des
  // appelants — une lambda dans le JSX. La garder dans une référence évite de
  // la mettre en dépendance, ce qui relancerait la requête à chaque rendu.
  const chargerRef = useRef(charger);
  chargerRef.current = charger;

  const estVideRef = useRef(estVide);
  estVideRef.current = estVide;

  useEffect(() => {
    if (!actif) return;

    const horloge = new AbortController();
    let vivant = true;

    // Un rechargement ne repasse pas par « chargement » : l'écran garde ce
    // qu'il montrait, marqué en rechargement. Le vider ferait clignoter une
    // liste que l'utilisateur était en train de lire.
    setEtat((precedent) =>
      precedent.etat === 'pret' ? { ...precedent, rechargement: true } : precedent,
    );

    chargerRef
      .current(horloge.signal)
      .then((donnees) => {
        if (!vivant) return;
        setEtat({
          etat: 'pret',
          donnees,
          vide: estVideRef.current(donnees),
          vuA: Date.now(),
          rechargement: false,
        });
      })
      .catch((erreur: unknown) => {
        if (!vivant || horloge.signal.aborted) return;
        // On garde les données précédentes : une erreur de rechargement ne
        // doit pas effacer ce qui était lisible. L'écran les affichera datées.
        setEtat((precedent) => ({
          etat: 'erreur',
          erreur,
          donnees: precedent.etat === 'pret' ? precedent.donnees : null,
          vuA: precedent.etat === 'pret' ? precedent.vuA : null,
        }));
      });

    return () => {
      vivant = false;
      horloge.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour, actif, ...dependances]);

  const recharger = useCallback(() => setTour((n) => n + 1), []);

  return { ...etat, recharger };
}
