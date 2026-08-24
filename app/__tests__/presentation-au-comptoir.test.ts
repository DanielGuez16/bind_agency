/**
 * L'écran qui ne s'éteint pas, et qui rend ce qu'il a pris.
 *
 * **Trois états, et celui-ci était le pire.** Une règle absente se cherche ; une
 * règle non gardée marche ; une règle **déclarée et non implémentée** ne marche
 * pas et se lit comme si elle marchait. `produit.json` portait
 * `forceMaxBrightness: true` et `keepAwake: true`, la passation les annonçait
 * depuis la v1.0, et aucun des deux modules n'était installé.
 *
 * Le coût était réel et se voyait au comptoir : un écran qui s'éteint pendant
 * qu'on tend son téléphone, et un code illisible en plein soleil — la condition
 * que la passation nomme précisément, « lisibles à 1,20 m dans un salon très
 * éclairé ».
 *
 * **La restauration est la moitié qu'on oublie**, et c'est donc celle qui est
 * éprouvée le plus : forcer est une ligne, rendre est ce qui manque toujours, et
 * son absence laisse un téléphone à fond pour le reste de la journée.
 */
import * as Brightness from 'expo-brightness';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import { presentationAuComptoir } from '../src/shell/presentationAuComptoir';

jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn(async () => {}),
  deactivateKeepAwake: jest.fn(),
}));

/**
 * Un double qui **simule** la luminosité au lieu de rendre une constante.
 *
 * C'est ce qui fait diverger les deux implémentations. Un double qui rendrait
 * toujours 0,4 laisserait passer celle qui relit la valeur à chaque activation :
 * elle lirait 0,4 une seconde fois, alors qu'en vrai elle lirait 1 — le maximum
 * qu'elle vient d'écrire — et la restauration rendrait le maximum. Le décor doit
 * donc porter l'écriture, sans quoi le test s'exerce sur un appareil qui n'existe
 * pas.
 */
jest.mock('expo-brightness', () => {
  const etat = { valeur: 0.4 };
  return {
    __etat: etat,
    getBrightnessAsync: jest.fn(async () => etat.valeur),
    setBrightnessAsync: jest.fn(async (v: number) => {
      etat.valeur = v;
    }),
  };
});

const attendre = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  jest.clearAllMocks();
  (Brightness as unknown as { __etat: { valeur: number } }).__etat.valeur = 0.4;
});

describe('présenter un code au comptoir', () => {
  it('tient l’écran éveillé et le met au maximum', async () => {
    presentationAuComptoir.activer();
    await attendre();

    expect(activateKeepAwakeAsync).toHaveBeenCalled();
    expect(Brightness.setBrightnessAsync).toHaveBeenCalledWith(1);
  });

  it('et rend la luminosité d’avant en sortant, pas une valeur choisie', async () => {
    // **La moitié qui manque toujours.** Remettre à une constante — 0,5, ou le
    // maximum — serait choisir à la place du propriétaire du téléphone. C'est
    // la valeur lue avant d'écrire qui est rendue, et c'est pour cela qu'on la
    // lit avant plutôt que de la deviner après.
    presentationAuComptoir.activer();
    await attendre();
    presentationAuComptoir.desactiver();
    await attendre();

    expect(deactivateKeepAwake).toHaveBeenCalled();
    expect(Brightness.setBrightnessAsync).toHaveBeenLastCalledWith(0.4);
  });

  it('et deux activations d’affilée ne perdent pas la valeur d’avant', async () => {
    // **Le cas où les deux implémentations divergent.** Un remontage de l'écran
    // active deux fois sans sortie entre les deux : lire à chaque activation
    // enregistrerait le maximum comme « valeur d'avant », et la sortie ne
    // rendrait plus rien. Une implémentation naïve passe les deux tests du
    // dessus et échoue ici, sur le seul cas qui arrive vraiment.
    presentationAuComptoir.activer();
    await attendre();
    presentationAuComptoir.activer();
    await attendre();
    presentationAuComptoir.desactiver();
    await attendre();

    expect(Brightness.setBrightnessAsync).toHaveBeenLastCalledWith(0.4);
  });

  it('et une plateforme sans l’API ne fait pas tomber l’écran', async () => {
    // C'est le seul écran du produit dont la panne se voit devant quelqu'un. Un
    // code lisible sur un écran qui s'éteint vaut mieux qu'une exception.
    (Brightness.getBrightnessAsync as jest.Mock).mockRejectedValueOnce(new Error('indisponible'));
    (activateKeepAwakeAsync as jest.Mock).mockRejectedValueOnce(new Error('indisponible'));

    expect(() => presentationAuComptoir.activer()).not.toThrow();
    await attendre();
    expect(() => presentationAuComptoir.desactiver()).not.toThrow();
    await attendre();
  });
});
