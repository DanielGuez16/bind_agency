/**
 * Toute destination nommée existe.
 *
 * **Le défaut que cette garde attrape a coûté le seul chemin vers les
 * paliers.** `conteneur.navigate('paliers' as never)` désignait un onglet qui
 * n'a jamais existé : les onglets du créateur sont `parcours`, `audience`,
 * `reservations` et `reglages`, et l'écran des paliers vit dans la pile du fil.
 * L'appui partait, React Navigation ignorait le nom, et rien ne bougeait — ce
 * qui se lit exactement comme un texte non cliquable.
 *
 * **C'est le `as never` qui l'a rendu possible.** Il existe parce que le
 * conteneur n'est pas typé sur une liste de routes ; il efface du même coup la
 * seule vérification qui aurait dit que le nom était faux. Une garde qui lit
 * les noms rend cette vérification, sans typage à reconstruire.
 *
 * **Elle lit la source plutôt que de monter les écrans.** Monter la navigation
 * entière pour appuyer sur chaque chemin coûterait une minute par exécution et
 * n'attraperait que les chemins qu'on aurait pensé à parcourir. Les noms, eux,
 * sont tous là.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = readFileSync(
  join(__dirname, '..', 'src', 'shell', 'Navigation.tsx'),
  'utf-8',
);

/** Tout ce qui est déclaré : onglets et écrans de pile, du même geste. */
function destinationsDeclarees(): Set<string> {
  return new Set([...SOURCE.matchAll(/\.Screen\s+name="([^"]+)"/g)].map(([, nom]) => nom));
}

/**
 * Tout ce qui est visé, la cible imbriquée comprise.
 *
 * `navigate('parcours', { screen: 'Paliers' })` en nomme deux, et les deux
 * peuvent être faux. Ne lire que le premier laisserait passer exactement la
 * moitié du défaut.
 */
function destinationsVisees(): { nom: string; ligne: number }[] {
  const vues: { nom: string; ligne: number }[] = [];

  for (const trouve of SOURCE.matchAll(/navigate\(\s*'([^']+)'/g)) {
    vues.push({ nom: trouve[1], ligne: ligneDe(trouve.index ?? 0) });
  }
  for (const trouve of SOURCE.matchAll(/screen:\s*'([^']+)'/g)) {
    vues.push({ nom: trouve[1], ligne: ligneDe(trouve.index ?? 0) });
  }
  return vues;
}

function ligneDe(position: number): number {
  return SOURCE.slice(0, position).split('\n').length;
}

describe('la navigation ne vise que ce qui existe', () => {
  it('chaque destination nommée est déclarée quelque part', () => {
    const declarees = destinationsDeclarees();

    const introuvables = destinationsVisees()
      .filter(({ nom }) => !declarees.has(nom))
      .map(({ nom, ligne }) => `Navigation.tsx:${ligne} — « ${nom} » n'est déclaré nulle part`);

    expect(introuvables).toEqual([]);
  });

  it('la garde regarde bien quelque chose', () => {
    // Sans ceci, une expression qui ne trouve plus rien passerait au vert en
    // n'ayant lu aucun nom — et c'est le genre de garde qui se tait pendant
    // des mois.
    expect(destinationsDeclarees().size).toBeGreaterThan(12);
    expect(destinationsVisees().length).toBeGreaterThan(12);
  });

  it('et elle attrape un nom inventé, comme un nom imbriqué inventé', () => {
    const declarees = destinationsDeclarees();
    expect(declarees.has('paliers')).toBe(false);
    expect(declarees.has('Paliers')).toBe(true);
    // La casse compte : React Navigation ne rapproche pas les deux, et c'est
    // précisément par là que le défaut est passé.
    expect(declarees.has('parcours')).toBe(true);
  });
});
