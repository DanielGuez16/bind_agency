/**
 * Un fil déjà vu s'affiche avant que la requête revienne.
 *
 * **La règle des 400 ms n'était vraie qu'au second lancement.** Le premier
 * partait d'un écran de chargement, alors que la réponse de la veille est
 * presque toujours la bonne — des salons n'apparaissent pas en une nuit.
 *
 * Ce fichier éprouve les quatre choses qui rendent ce cache défendable, et
 * chacune sur le décor où deux implémentations **divergent** :
 *
 * — il s'affiche, et donc il sert à quelque chose ;
 * — passé son âge il ne s'affiche plus, sinon il ment avec l'aplomb du frais ;
 * — il ne remplace jamais une réponse déjà arrivée, ce qui est le cas du
 *   réseau rapide et celui qu'on casserait sans y penser ;
 * — il part avec la session, dans les deux sens — à la sortie et à l'entrée.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { AGES, PREFIXE, ecrireAuCache, lireDuCache, viderLeCache } from '../src/screens/cacheDesReponses';
import { useRequete } from '../src/screens/useRequete';

const CLE = 'fil.10.toutes';

/** Une sonde : elle rend ce que la requête donne, et rien d'autre. */
function Sonde({
  charger,
  cache,
}: {
  charger: () => Promise<string>;
  cache?: { cle: string; ageMax: number };
}) {
  const requete = useRequete<string>(() => charger(), { estVide: () => false, cache });
  return (
    <Text testID="etat">
      {requete.etat === 'pret' ? `pret:${requete.donnees}` : requete.etat}
    </Text>
  );
}

/** Une promesse qu'on résout à la main, pour tenir la requête ouverte. */
function differee<T>() {
  let resoudre!: (valeur: T) => void;
  const promesse = new Promise<T>((r) => {
    resoudre = r;
  });
  return { promesse, resoudre };
}

describe('ce qu’on a déjà vu s’affiche avant la réponse', () => {
  it('rend la réponse rangée pendant que la requête est encore en vol', async () => {
    await ecrireAuCache(CLE, 'le fil d’hier', Date.now() - 60_000);
    const lente = differee<string>();

    const vue = await render(
      <Sonde charger={() => lente.promesse} cache={{ cle: CLE, ageMax: AGES.contenu }} />,
    );

    // **La requête n'a pas répondu, et l'écran montre quelque chose.** Sans
    // lecture du cache, il serait sur `chargement` — c'est exactement la
    // divergence entre les deux implémentations.
    await waitFor(() => expect(screen.getByTestId('etat')).toHaveTextContent('pret:le fil d’hier'));

    lente.resoudre('le fil d’aujourd’hui');
    await waitFor(() =>
      expect(screen.getByTestId('etat')).toHaveTextContent('pret:le fil d’aujourd’hui'),
    );
    await vue.unmount();
  });

  it('mais pas au-delà de son âge : un fil de la semaine dernière vaut moins qu’un chargement', async () => {
    await ecrireAuCache(CLE, 'le fil de la semaine dernière', Date.now() - AGES.contenu - 1_000);
    const lente = differee<string>();

    const vue = await render(
      <Sonde charger={() => lente.promesse} cache={{ cle: CLE, ageMax: AGES.contenu }} />,
    );

    // **Le décor pose une entrée valide, seulement vieille.** Sans elle — un
    // cache vide — une implémentation qui ignore l'âge rendrait le même
    // `chargement`, et le test ne dirait rien.
    await waitFor(() => expect(screen.getByTestId('etat')).toHaveTextContent('chargement'));
    expect(screen.getByTestId('etat')).not.toHaveTextContent('semaine dernière');

    lente.resoudre('le fil d’aujourd’hui');
    await waitFor(() =>
      expect(screen.getByTestId('etat')).toHaveTextContent('pret:le fil d’aujourd’hui'),
    );
    await vue.unmount();
  });

  it('et ne remplace jamais une réponse déjà arrivée', async () => {
    // **Le cas du réseau rapide.** La requête répond avant que le stockage
    // rende la main ; une implémentation qui poserait le cache sans regarder
    // l'état courant ferait reculer l'écran d'un jour, sous les yeux de
    // quelqu'un qui lisait déjà la bonne réponse.
    await ecrireAuCache(CLE, 'le fil d’hier', Date.now() - 60_000);

    const vue = await render(
      <Sonde
        charger={() => Promise.resolve('le fil d’aujourd’hui')}
        cache={{ cle: CLE, ageMax: AGES.contenu }}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('etat')).toHaveTextContent('pret:le fil d’aujourd’hui'),
    );
    // Laisse le temps à la lecture du stockage de retomber après coup.
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('etat')).toHaveTextContent('pret:le fil d’aujourd’hui');
    await vue.unmount();
  });

  it('range la réponse pour le prochain lancement', async () => {
    const vue = await render(
      <Sonde
        charger={() => Promise.resolve('le fil')}
        cache={{ cle: CLE, ageMax: AGES.contenu }}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('etat')).toHaveTextContent('pret:le fil'));

    await waitFor(async () => expect(await lireDuCache<string>(CLE)).not.toBeNull());
    expect((await lireDuCache<string>(CLE))?.donnees).toBe('le fil');
    await vue.unmount();
  });

  it('et ne range rien du tout pour une route non inscrite', async () => {
    // **C'est la moitié qui compte.** Une journée, une disponibilité, un code
    // de retrait décident d'un geste à l'instant où on les lit : les ranger
    // ferait tenir un créneau déjà pris. L'absence d'option est la seule chose
    // qui les en empêche, et rien d'autre ne le vérifierait.
    const vue = await render(<Sonde charger={() => Promise.resolve('la journée')} />);
    await waitFor(() => expect(screen.getByTestId('etat')).toHaveTextContent('pret:la journée'));

    const clefs = await AsyncStorage.getAllKeys();
    expect(clefs.filter((cle) => cle.startsWith(PREFIXE))).toEqual([]);
    await vue.unmount();
  });
});

describe('le cache part avec la session', () => {
  it('vider n’emporte que nos clés, et laisse le reste de l’appareil', async () => {
    await ecrireAuCache(CLE, 'le fil', Date.now());
    await AsyncStorage.setItem('bind.commerce.choisi', 'b1');

    await viderLeCache();

    expect(await lireDuCache(CLE)).toBeNull();
    // **Le salon choisi, le repli de la barre, la préférence de notifications
    // ne sont pas des réponses.** `AsyncStorage.clear()` les emporterait, et
    // quelqu'un qui se déconnecte retrouverait une application dépréglée.
    expect(await AsyncStorage.getItem('bind.commerce.choisi')).toBe('b1');
  });
});
