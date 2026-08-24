/**
 * Une réponse qui n'arrive jamais — et qui s'arrête quand on l'annule.
 *
 * **Le décor qui ne se résout jamais est le seul qui sépare deux
 * implémentations.** « Remplir puis appeler » et « appeler puis remplir »
 * rendent le même écran contre un double qui répond tout de suite ; un écran
 * gardé en chargement ne montre son squelette que si la réponse tarde. Ces
 * tests-là ne peuvent pas s'en passer.
 *
 * **Mais `new Promise(() => {})` ne modélise pas un réseau lent, il modélise un
 * `fetch` qui ignore son signal** — ce que le vrai ne fait jamais. La
 * conséquence était mesurable : le client pose une échéance en minuteur et ne
 * l'éteint qu'en `finally`, donc jamais ; le minuteur pendait quinze secondes
 * après la fin du test, le worker Jest ne pouvait pas sortir, et la suite
 * affichait « A worker process has failed to exit gracefully » à **chaque**
 * exécution. Quatre décors sur cinq tenaient cet avertissement à eux seuls.
 *
 * Le coût n'est pas l'avertissement, c'est ce qu'il interdit : tant qu'il sort
 * toujours, il ne dit plus rien quand une vraie fuite arrive.
 *
 * Ce double-ci ne répond pas davantage. Il écoute seulement l'annulation, comme
 * `fetch` le fait, et rejette alors — ce qui laisse le `finally` du client
 * éteindre son échéance. Le démontage d'un test annule ; le minuteur meurt
 * avec.
 */
export function reponseQuiNArrivePas(init?: { signal?: AbortSignal | null }): Promise<Response> {
  return new Promise<Response>((_resoudre, rejeter) => {
    const arret = () => rejeter(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    // **Déjà annulée compte aussi.** L'appelant peut avoir quitté l'écran
    // avant que la requête parte : s'abonner ne suffit pas, l'événement est
    // passé, et la promesse resterait en vol pour toujours.
    if (init?.signal?.aborted) {
      arret();
      return;
    }
    init?.signal?.addEventListener('abort', arret);
  });
}
