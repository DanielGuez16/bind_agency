/**
 * La marge des attentes asynchrones, et ce qu'elle protège.
 *
 * **Le symptôme :** un fichier rouge par-ci par-là sur la suite complète,
 * jamais le même, jamais reproductible en isolation, toujours un `waitFor` qui
 * expire — jamais une assertion fausse.
 *
 * **Ce qui tranche est que les deux ensembles observés ne se recoupent pas.**
 * Quatre fichiers d'un côté, deux de l'autre, aucun commun : si c'était une
 * fuite, ce serait toujours les mêmes. C'est donc la marge, pas les fichiers.
 *
 * **Mesuré :** douze passages de la suite entière, un rouge, deux fichiers
 * dedans, leurs durées gonflées à dix-neuf et trente et une secondes là où ils
 * en mettent une. Puis douze passages après le réglage, tous verts. Douze
 * contre douze ne **prouve** pas — un défaut d'un sur douze demanderait
 * beaucoup plus pour être écarté par le seul comptage — mais l'argument ne
 * repose pas sur ce comptage : il repose sur le fait qu'un défaut d'usine
 * d'une seconde ne survit pas à une exécution qui ralentit d'un facteur vingt.
 *
 * Ce test-ci garde le réglage, qui se perdrait sans bruit : le supprimer ne
 * fait rien tomber tant que la machine n'est pas chargée, et c'est exactement
 * ce qui l'a laissé passer la première fois.
 */
import { render, screen, waitFor } from '@testing-library/react-native';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

/** Un écran qui met deux secondes à afficher ce qu'on attend de lui. */
function Lent() {
  const [pret, setPret] = useState(false);
  useEffect(() => {
    const minuteur = setTimeout(() => setPret(true), 2_000);
    return () => clearTimeout(minuteur);
  }, []);
  return <View>{pret ? <Text testID="arrive">là</Text> : null}</View>;
}

it('une attente de deux secondes tient, là où le défaut d’usine lâche à une', async () => {
  // **Deux secondes, et c'est le nombre qui compte.** Sous le défaut de la
  // bibliothèque — mille millisecondes — ce test échoue ; avec la marge, il
  // passe. C'est la seule façon d'éprouver le réglage par ce qu'il fait plutôt
  // que par sa valeur.
  await render(<Lent />);

  await waitFor(() => expect(screen.getByTestId('arrive')).toBeTruthy());
});
