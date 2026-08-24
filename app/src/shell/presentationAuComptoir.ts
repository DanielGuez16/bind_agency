/**
 * Ce que l'appareil doit faire pendant qu'on présente un code au comptoir.
 *
 * **Deux réglages, une seule situation.** L'écran ne doit ni s'éteindre ni
 * rester sombre pendant qu'une créatrice tend son téléphone à un commerçant :
 * l'un fait recommencer le geste, l'autre le fait échouer en plein soleil. La
 * passation les demande tous les deux depuis la v1.0 — « luminosité forcée au
 * maximum, veille désactivée, restauration à la sortie » — et `produit.json` les
 * déclarait à `true`.
 *
 * **Aucun des deux n'existait.** Ni `expo-keep-awake` ni `expo-brightness`
 * n'était installé, et rien ne les appelait : deux jetons à `true` se lisaient
 * comme deux interrupteurs allumés. C'est le pire des trois états — pire qu'une
 * règle absente, qu'on chercherait ; pire qu'une règle non gardée, qui marche.
 *
 * **La restauration est la moitié difficile.** Forcer la luminosité est une
 * ligne ; la rendre est ce qui manque toujours, et son absence laisse un
 * téléphone à fond pendant tout le reste de la journée. La valeur d'avant est
 * donc lue **avant** d'écrire, et rendue à la sortie — jamais remise à une
 * constante, qui serait une valeur inventée à la place de celle du propriétaire.
 *
 * **Rien de tout cela ne peut faire échouer l'écran.** C'est le seul écran du
 * produit dont la panne se voit au comptoir, devant quelqu'un. Une plateforme
 * sans l'API, une permission refusée, un module absent du build web : chaque
 * appel est enveloppé, et l'écran s'affiche de toute façon. Un code lisible sur
 * un écran qui s'éteint vaut infiniment mieux qu'une exception.
 */
import * as Brightness from 'expo-brightness';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

/** L'étiquette du verrou : elle isole le nôtre de ceux qu'un autre écran poserait. */
const VERROU = 'code-de-retrait';

/**
 * La luminosité d'avant, à rendre en sortant.
 *
 * `null` signifie « rien à rendre » — soit qu'on n'a pas encore activé, soit que
 * la lecture a échoué. Dans les deux cas on ne touche à rien en sortant, ce qui
 * est le comportement sûr : écrire une valeur qu'on n'a pas lue reviendrait à
 * choisir à la place de quelqu'un.
 */
let luminositeDAvant: number | null = null;

async function sansBruit(geste: () => Promise<unknown>): Promise<void> {
  try {
    await geste();
  } catch {
    // Voir l'en-tête : cet écran ne tombe pas.
  }
}

export const presentationAuComptoir = {
  activer(): void {
    void sansBruit(() => activateKeepAwakeAsync(VERROU));
    void sansBruit(async () => {
      // **Lire avant d'écrire, et une seule fois.** Deux activations sans sortie
      // entre elles — un remontage de l'écran — enregistreraient le maximum
      // comme « valeur d'avant », et la sortie ne rendrait plus rien.
      if (luminositeDAvant === null) {
        luminositeDAvant = await Brightness.getBrightnessAsync();
      }
      await Brightness.setBrightnessAsync(1);
    });
  },

  desactiver(): void {
    void sansBruit(async () => deactivateKeepAwake(VERROU));
    void sansBruit(async () => {
      if (luminositeDAvant === null) return;
      const rendre = luminositeDAvant;
      luminositeDAvant = null;
      await Brightness.setBrightnessAsync(rendre);
    });
  },
};
