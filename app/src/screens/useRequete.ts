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
 *
 * **Et ce qu'on a déjà vu s'affiche avant que le réseau réponde**, quand
 * l'appelant a inscrit une clé de cache. La règle des 400 ms n'était vraie
 * qu'au second lancement : un fil consulté hier repartait d'un écran de
 * chargement, alors que la réponse d'hier est presque toujours la bonne.
 *
 * L'inscription est **au cas par cas** et jamais par défaut : un cache posé
 * partout finirait par couvrir une route qui décide d'un geste. Voir
 * `cacheDesReponses.ts` pour ce qui s'y range et ce qui n'y entre jamais.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { ecrireAuCache, lireDuCache } from './cacheDesReponses';

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
  /**
   * Où ranger la dernière réponse réussie, et jusqu'à quel âge la montrer.
   *
   * **Omis par défaut, et c'est la bonne valeur.** Une route qui décide d'un
   * geste — une disponibilité, une journée, un code de retrait — ne s'inscrit
   * pas ici : une réponse d'il y a dix minutes y ferait tenir un créneau déjà
   * pris. Voir `cacheDesReponses.ts`.
   *
   * `cle` doit désigner la requête **et ses paramètres** : deux salons sous la
   * même clé se montreraient l'un pour l'autre, ce qui est pire qu'un écran de
   * chargement.
   */
  cache?: { cle: string; ageMax: number };
};

export function useRequete<T>(
  charger: (signal: AbortSignal) => Promise<T>,
  { estVide, dependances = [], actif = true, cache }: OptionsDeRequete<T>,
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

    // **Le cache ne court jamais après la requête.** Il est lu en parallèle, et
    // il ne s'installe que si rien n'est encore arrivé : une réponse fraîche
    // qui reviendrait avant la lecture du stockage ne doit pas se faire
    // remplacer par ce qu'on avait hier. C'est le cas du réseau rapide, et
    // c'est celui qu'on casserait sans y penser.
    if (cache) {
      void (async () => {
        const entree = await lireDuCache<T>(cache.cle);
        if (!vivant || entree === null) return;
        if (Date.now() - entree.vuA > cache.ageMax) return;
        setEtat((precedent) =>
          precedent.etat === 'chargement'
            ? {
                etat: 'pret',
                donnees: entree.donnees,
                vide: estVideRef.current(entree.donnees),
                vuA: entree.vuA,
                // **Marqué en rechargement, parce qu'il l'est.** L'écran sait
                // déjà rendre cet état — c'est celui du geste de rafraîchir —
                // et il porte la date, donc rien ne se présente comme frais.
                rechargement: true,
              }
            : precedent,
        );
      })();
    }

    chargerRef
      .current(horloge.signal)
      .then((donnees) => {
        if (!vivant) return;
        const vuA = Date.now();
        setEtat({
          etat: 'pret',
          donnees,
          vide: estVideRef.current(donnees),
          vuA,
          rechargement: false,
        });
        // Après l'affichage, jamais avant : l'écriture est asynchrone, et la
        // faire attendre à l'écran paierait le cache au moment précis où il
        // devait faire gagner du temps.
        if (cache) void ecrireAuCache(cache.cle, donnees, vuA);
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
  }, [tour, actif, cache?.cle, cache?.ageMax, ...dependances]);

  const recharger = useCallback(() => setTour((n) => n + 1), []);

  return { ...etat, recharger };
}
