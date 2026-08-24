import { useCallback, useMemo, useState } from 'react';

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
 *
 * **Et un échec se dit.** Le retour en arrière était muet : le cœur se
 * remplissait, revenait, et rien ne distinguait « je n'ai pas su enregistrer »
 * de « tu n'as pas appuyé ». C'est exactement ce qu'on lit comme « les favoris
 * ne marchent pas » — le geste échoue *et* le produit se tait, donc il n'y a
 * rien à raconter au support et rien à réessayer. `echec` porte le nom de la
 * prestation, parce qu'un message qui ne nomme rien laisse chercher laquelle.
 */
export function useFavorisEnVol(actions: {
  mettre: (catalogItemId: string) => Promise<unknown>;
  retirer: (catalogItemId: string) => Promise<unknown>;
}) {
  /**
   * Ce qui a été touché : où l'on va, et d'où l'on venait.
   *
   * **Les deux, et non le seul « où l'on va ».** Le compte de la porte est un
   * écart par rapport au total servi ; sans l'état d'origine, un second appui
   * qui ramène le cœur à sa valeur servie compterait comme un retrait de plus.
   */
  const [enVol, setEnVol] = useState<Record<string, { vers: boolean; servi: boolean }>>({});
  const [echec, setEchec] = useState<string | null>(null);

  const estFavori = useCallback(
    (catalogItemId: string, servi: boolean) => enVol[catalogItemId]?.vers ?? servi,
    [enVol],
  );

  /**
   * De combien le total servi a bougé, en tenant compte des appuis en vol.
   *
   * Seules les dérogations qui **diffèrent** de l'état servi comptent : revenir
   * sur son propre appui ne retranche rien au total, il annule sa propre
   * addition.
   */
  const ecart = useMemo(
    () =>
      Object.values(enVol).reduce(
        (somme, { vers, servi }) => somme + (vers === servi ? 0 : vers ? 1 : -1),
        0,
      ),
    [enVol],
  );

  const basculer = useCallback(
    (catalogItemId: string, versFavori: boolean, servi: boolean, nom: string) => {
      // Un nouvel appui est une nouvelle tentative : l'échec d'avant n'a plus
      // à rester à l'écran pendant qu'on retente.
      setEchec(null);
      setEnVol((avant) => ({ ...avant, [catalogItemId]: { vers: versFavori, servi } }));

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
        setEchec(nom);
      });
    },
    [actions],
  );

  const oublier = useCallback(() => setEnVol({}), []);

  return { estFavori, basculer, oublier, ecart, echec };
}
