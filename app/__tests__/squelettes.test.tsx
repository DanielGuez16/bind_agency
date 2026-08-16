/**
 * Le squelette dit la forme de ce qui arrive, ou il ne sert à rien.
 *
 * **Ce que ça répare.** `Ecran` rend par défaut trois cartes à photo de 150
 * pixels — la géométrie de `BusinessCard`. Elle est juste sur le fil et fausse
 * partout ailleurs : le reporting rend des chiffres et des barres, les horaires
 * un tableau de sept lignes, les créneaux une grille, la fiche et la preuve un
 * objet unique et non une liste de trois. Le contenu chassait alors une
 * silhouette qui ne lui ressemblait pas, et toute la page se réorganisait au
 * moment précis où on commençait à lire. Un squelette de la mauvaise forme ne
 * masque pas l'attente, il rend le saut plus spectaculaire.
 *
 * **Une garde, pas six tests d'écran.** Chaque écran de la liste doit montrer
 * *son* squelette **et** ne pas montrer celui par défaut. Vérifier seulement la
 * présence du sien laisserait passer un écran qui rendrait les deux ; vérifier
 * seulement l'absence du défaut laisserait passer un écran sans squelette du
 * tout. Les deux sens, sur chaque écran.
 *
 * **Les squelettes sont masqués aux technologies d'assistance** — ils ne
 * portent aucune information et les faire annoncer reviendrait à lire
 * « chargement » sept fois. D'où `includeHiddenElements` partout ici.
 */
import { render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { AnnuaireScreen } from '../src/screens/AnnuaireScreen';
import { CreneauxScreen } from '../src/screens/CreneauxScreen';
import { FicheScreen } from '../src/screens/FicheScreen';
import { HorairesScreen } from '../src/screens/HorairesScreen';
import { PreuveScreen } from '../src/screens/PreuveScreen';
import { ReportingScreen } from '../src/screens/ReportingScreen';
import { ThemeProvider } from '../src/theme';

/** Ne répond jamais : l'écran reste en chargement aussi longtemps qu'on veut. */
const clientQuiNeRepondJamais = new ApiClient({
  baseUrl: 'https://api.test',
  coffre: { lire: async () => null, ecrire: async () => {} },
  fetchImpl: () => new Promise<Response>(() => {}),
});

const CAS = [
  {
    nom: 'reporting',
    role: 'merchant',
    squelette: 'squelette-reporting',
    forme: 'des chiffres et des barres',
    noeud: <ReportingScreen businessId="b1" />,
  },
  {
    nom: 'horaires',
    role: 'merchant',
    squelette: 'squelette-horaires',
    forme: 'un tableau de sept jours',
    noeud: <HorairesScreen businessId="b1" />,
  },
  {
    nom: 'annuaire',
    role: 'merchant',
    squelette: 'squelette-annuaire',
    forme: 'des lignes de créateurs',
    noeud: <AnnuaireScreen businessId="b1" />,
  },
  {
    nom: 'fiche',
    role: 'creator',
    squelette: 'squelette-fiche',
    forme: 'une fiche unique',
    noeud: <FicheScreen businessId="b1" onReserver={jest.fn()} />,
  },
  {
    nom: 'preuve',
    role: 'creator',
    squelette: 'squelette-preuve',
    forme: 'une contrepartie unique',
    noeud: <PreuveScreen collaborationId="k1" />,
  },
  {
    nom: 'creneaux',
    role: 'creator',
    squelette: 'squelette-creneaux',
    forme: 'une grille de créneaux',
    noeud: <CreneauxScreen fiche={{ id: 'b1', name: 'X' } as never} offre={{ name: 'Y' } as never} onReserve={jest.fn()} />,
  },
] as const;

function Cadre({ role, children }: { role: 'creator' | 'merchant'; children: ReactNode }) {
  return (
    <I18nProvider initialLocale="en">
      <ThemeProvider role={role}>
        <ApiProvider client={clientQuiNeRepondJamais}>{children}</ApiProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

const cache = { includeHiddenElements: true } as const;

describe('le squelette a la forme de ce qui arrive', () => {
  it.each(CAS.map((c) => [c.nom, c] as const))('%s montre le sien', async (_nom, cas) => {
    await render(<Cadre role={cas.role}>{cas.noeud}</Cadre>);

    expect(screen.getByTestId('etat-chargement')).toBeTruthy();
    expect(screen.getByTestId(cas.squelette, cache)).toBeTruthy();
  });

  it.each(CAS.map((c) => [c.nom, c] as const))(
    '%s ne promet pas de cartes à photo',
    async (_nom, cas) => {
      // L'autre sens, et c'est celui qui a de la valeur : un écran qui rendrait
      // les deux passerait le test ci-dessus sans que le défaut ait disparu.
      await render(<Cadre role={cas.role}>{cas.noeud}</Cadre>);

      expect(screen.queryByTestId('squelette-par-defaut', cache)).toBeNull();
    },
  );
});
