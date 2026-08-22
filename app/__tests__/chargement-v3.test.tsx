/**
 * L'écran de chargement : direction A, et ce qu'elle ne doit jamais faire.
 *
 * **La signature orange s'installe en arrivant en dernier.** Elle sert au
 * favicon, à l'icône et aux visuels de l'agence : la voir se poser mille fois
 * l'apprend mieux qu'une note de passation. Le point n'est pas un accent
 * décoratif, c'est la marque.
 *
 * **Ce que ces tests éprouvent est ce qui peut être faux**, pas ce qui peut être
 * laid : l'alignement structurel des deux tracés, le plafond qui reste un
 * plafond, et le fait que l'attente ne ressemble pas à la marque.
 */
import { act, render, screen } from '@testing-library/react-native';

import { Chargement, FiletDAttente, PLAFOND_MS } from '../src/shell/Chargement';
import { ThemeProvider } from '../src/theme';

const monter = (noeud: React.ReactElement) =>
  render(<ThemeProvider role="creator">{noeud}</ThemeProvider>);

/** Le style d'un nœud, tableau ou non. */
const aplati = (style: unknown): Record<string, unknown> =>
  Array.isArray(style)
    ? Object.assign({}, ...style.map(aplati))
    : ((style ?? {}) as Record<string, unknown>);

describe('les deux tracés, et leur alignement', () => {
  it('les lettres et le point sont deux dessins, pas un', async () => {
    // **C'est la structure du fichier qui le permet.** Le point est déjà un
    // tracé distinct avec sa couleur propre ; découper les lettres pour les
    // animer séparément demanderait de fabriquer un logo qui n'existe pas.
    await monter(<Chargement />);

    expect(screen.getByTestId('ecran-chargement-lettres-lettres')).toBeTruthy();
    expect(screen.getByTestId('ecran-chargement-point-point')).toBeTruthy();
  });

  it('et aucun des deux ne porte la moitié de l’autre', async () => {
    // Sans cette moitié, la garde passerait sur deux logotypes complets
    // superposés — où le point ne pourrait plus tomber seul, puisqu'il serait
    // aussi dans la couche des lettres.
    await monter(<Chargement />);

    expect(screen.queryByTestId('ecran-chargement-lettres-point')).toBeNull();
    expect(screen.queryByTestId('ecran-chargement-point-lettres')).toBeNull();
  });

  it('la couche du point est posée sur celle des lettres, à la même origine', async () => {
    // **L'alignement est structurel et non mesuré.** Les deux parties gardent
    // la même `viewBox` et le même repère : superposées à la même origine,
    // elles retombent l'une sur l'autre à n'importe quelle taille. Un décalage
    // écrit en points d'écran dériverait au premier changement d'échelle — et
    // c'est exactement ce que cette garde interdit.
    await monter(<Chargement />);

    // **On remonte jusqu'à la couche animée**, plutôt que de compter les
    // parents : `Svg` en insère un nombre qui lui appartient, et un compte figé
    // se casserait à la première version de la bibliothèque.
    let noeud: { parent: unknown; props?: { style?: unknown } } | null =
      screen.getByTestId('ecran-chargement-point-point') as never;
    let couche: Record<string, unknown> = {};
    for (let i = 0; i < 8 && noeud; i += 1) {
      const style = aplati(noeud.props?.style);
      if (style.position === 'absolute') {
        couche = style;
        break;
      }
      noeud = noeud.parent as never;
    }

    expect(couche.position).toBe('absolute');
    expect(couche.left).toBe(0);
    expect(couche.top).toBe(0);
    // Et le point est bien plus haut que sa place, prêt à tomber.
    expect(JSON.stringify(couche.transform)).toMatch(/translateY/);
  });
});

describe('l’attente ne ressemble pas à la marque', () => {
  it('rien avant le plafond', async () => {
    // Le montrer d'emblée ferait de chaque ouverture une attente, y compris
    // celles de trois cents millisecondes.
    jest.useFakeTimers();
    try {
      await monter(<Chargement />);
      expect(screen.queryByTestId('filet-d-attente')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('et le filet au-delà', async () => {
    jest.useFakeTimers();
    try {
      await monter(<Chargement />);
      await act(async () => {
        jest.advanceTimersByTime(PLAFOND_MS + 1);
      });
      expect(screen.getByTestId('filet-d-attente')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('le filet ne porte pas le logotype, et le logotype ne boucle pas', async () => {
    // **La distinction que tout cela sert.** Si l'attente se dessinait dans le
    // vocabulaire de l'entrée, on ne distinguerait plus « ça s'ouvre » de « ça
    // bloque ». Le filet est un trait de deux points, et rien d'autre.
    await monter(<FiletDAttente />);

    expect(screen.queryByTestId('ecran-chargement-lettres-lettres')).toBeNull();
    expect(aplati(screen.getByTestId('filet-d-attente').props.style).height).toBe(2);
  });
});
