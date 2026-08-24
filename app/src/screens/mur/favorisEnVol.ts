import { useCallback, useState } from 'react';

/**
 * Les cœurs qu'on vient de toucher, avant que le serveur réponde.
 *
 * **L'appui est optimiste.** Le cœur se remplit avant la réponse et revient en
 * arrière si elle échoue. Un favori n'est pas une réservation : attendre le
 * réseau pour un geste sans conséquence est exactement ce qui fait dire
 * « lent ». Ce qui produit la sensation de lenteur n'est pas la durée, c'est
 * l'incertitude — rien n'a bougé, donc on appuie une seconde fois.
 *
 * **Une table de dérogations, pas une copie du fil.** Recopier les
 * quatre-vingts articles pour en changer un ferait deux vérités du même
 * contenu, et la seconde survivrait au rechargement du fil en le contredisant.
 * Ici, ce qui n'a pas été touché n'existe pas : la réponse du serveur reste la
 * source, et la table ne porte que l'écart.
 *
 * **L'écart se referme au rechargement.** Quand le fil revient avec l'état à
 * jour, la dérogation devient inutile — la garder ferait resurgir un vieux
 * geste sur une donnée neuve. `oublier` est appelé par l'écran quand la
 * requête repart.
 */
export function useFavorisEnVol(actions: {
  mettre: (catalogItemId: string) => Promise<unknown>;
  retirer: (catalogItemId: string) => Promise<unknown>;
}) {
  const [enVol, setEnVol] = useState<Record<string, boolean>>({});

  const estFavori = useCallback(
    (catalogItemId: string, servi: boolean) => enVol[catalogItemId] ?? servi,
    [enVol],
  );

  const basculer = useCallback(
    (catalogItemId: string, versFavori: boolean) => {
      setEnVol((avant) => ({ ...avant, [catalogItemId]: versFavori }));

      const appel = versFavori ? actions.mettre : actions.retirer;
      void appel(catalogItemId).catch(() => {
        // **Le retour en arrière ne remet pas « l'inverse », il oublie.** Poser
        // `!versFavori` écraserait un second appui parti entre-temps ; retirer
        // la dérogation rend la main à ce que le serveur dit, qui est la seule
        // chose qu'on sache encore.
        setEnVol((avant) => {
          const suite = { ...avant };
          delete suite[catalogItemId];
          return suite;
        });
      });
    },
    [actions],
  );

  const oublier = useCallback(() => setEnVol({}), []);

  return { estFavori, basculer, oublier };
}
