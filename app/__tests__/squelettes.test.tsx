/**
 * Le squelette dit la forme de ce qui arrive, ou il ne sert à rien.
 *
 * **Ce que ça répare.** `Ecran` rendait par défaut trois cartes à photo de 150
 * pixels — la géométrie de la carte du fil. Elle était juste sur le fil et
 * fausse partout ailleurs ; la v3 l'a rendue fausse **partout**, le fil ne
 * rendant plus de cartes. Le défaut est maintenant une liste de lignes, qui ne
 * ressemble à rien en particulier. La garde ne change pas pour autant : un
 * défaut neutre reste un défaut, et un écran qui rend un tableau ou une grille
 * doit toujours déclarer sa silhouette. Ce que le défaut promettait à tort : le reporting rend des chiffres et des barres, les horaires
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
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

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

/**
 * Les écrans qui doivent porter leur propre squelette, vérifiés **sur la
 * source** et non en les montant.
 *
 * Monter les dix-sept écrans demanderait autant de décors, et un décor incomplet
 * ferait échouer la garde pour une raison qui n'a rien à voir avec le squelette.
 * Ici on vérifie la seule chose qui compte : l'écran passe une prop `squelette`
 * à `Ecran`. Les six cas montés au-dessus prouvent, eux, que la prop arrive
 * bien à l'écran — les deux ensemble couvrent la chaîne.
 */
const DOIVENT_AVOIR_LEUR_SQUELETTE = [
  'ActivationScreen.tsx',
  // Le fil était la seule exception : son contenu était bien une liste de
  // cartes à photo, et le défaut y était juste. Il ne l'est plus — le fil est
  // devenu le mur, six formats dans un ordre fixe, et le squelette du système
  // promettrait trois cartes là où arrivent un héros, un duo et un triptyque.
  'FilScreen.tsx',
  'AnnuaireScreen.tsx',
  'ArbitrageScreen.tsx',
  'AudienceScreen.tsx',
  'CatalogueScreen.tsx',
  'CreneauxScreen.tsx',
  'FicheScreen.tsx',
  'HistoriqueScreen.tsx',
  'HorairesScreen.tsx',
  'JourneeScreen.tsx',
  'PaliersScreen.tsx',
  'PrestationsDuPalierScreen.tsx',
  'PlansScreen.tsx',
  'PreuveScreen.tsx',
  'PublicationsScreen.tsx',
  'ReglesScreen.tsx',
  'ReportingScreen.tsx',
  'TerrainScreen.tsx',
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

describe('les écrans dont le contenu n’est pas une carte à photo', () => {
  it.each(DOIVENT_AVOIR_LEUR_SQUELETTE.map((f) => [f] as const))(
    '%s passe son propre squelette',
    (fichier) => {
      // Le défaut d'`Ecran` promet trois cartes à photo de 150 px. Il n'est
      // juste que sur le fil ; partout ailleurs il fait sauter la page à
      // l'arrivée des données, au moment précis où on commençait à lire.
      const source = readFileSync(join(__dirname, '..', 'src', 'screens', fichier), 'utf8');

      expect(source).toMatch(/squelette=\{/);
    },
  );

  it('la liste couvre tous les écrans sauf le fil, qui rend vraiment des cartes', () => {
    // **L'autre sens.** Une liste qu'on oublie d'étendre laisse un écran neuf
    // hériter du défaut sans que rien ne le dise — c'est exactement comme ça
    // que quinze écrans sur dix-huit s'étaient retrouvés à mentir.
    const dossier = join(__dirname, '..', 'src', 'screens');
    const passentParEcran = readdirSync(dossier).filter(
      (f) =>
        /Screen\.tsx$/.test(f) &&
        /<Ecran\b/.test(readFileSync(join(dossier, f), 'utf8')),
    );

    const sansSquelette = passentParEcran.filter(
      (f) => !DOIVENT_AVOIR_LEUR_SQUELETTE.includes(f as never),
    );

    // **Plus aucune exception.** Le fil était la dernière, et elle est tombée
    // avec le mur : un écran fait de six formats ne peut pas hériter d'un
    // défaut qui promet trois cartes. Cette liste dit désormais « tous », et
    // c'est le seul état où elle n'a plus à être relue.
    expect(sansSquelette).toEqual([]);
  });
});

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

describe('et le défaut lui-même ne promet aucune forme', () => {
  it('c’est une liste de lignes, jamais une carte, une fiche ou une grille', async () => {
    // **La règle que ce fichier énonce, appliquée au défaut.** Les deux tests
    // au-dessus vérifient que six écrans déclarent leur silhouette ; aucun ne
    // dit ce que reçoit le septième, celui qui l'oublie. Le défaut a été une
    // carte à photo pendant tout ce temps — la forme la plus affirmative du
    // produit — et personne ne l'aurait vu changer.
    //
    // **Une liste de lignes est le bon défaut parce qu'elle n'affirme rien.**
    // Une fiche promet un objet unique, une grille promet des colonnes, une
    // carte promet une image : chacune fait sauter la page si elle se trompe.
    // Des lignes de texte ressemblent à ce qu'on sait d'un écran dont on ne
    // sait rien.
    //
    // Le test lit la source plutôt que de monter un écran sans squelette : il
    // n'y en a pas, et en fabriquer un pour l'occasion créerait exactement le
    // cas que la garde d'à côté interdit.
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const source = readFileSync(join(__dirname, '..', 'src', 'screens', 'Ecran.tsx'), 'utf-8');

    const defaut = /<(Skeleton\w+) testID="squelette-par-defaut"/.exec(source);
    expect(defaut?.[1]).toBe('SkeletonLignes');
    // Et il n'est rendu qu'une fois : trois cartes empilées étaient une
    // promesse de liste en plus d'une promesse de forme.
    expect(source.match(/squelette-par-defaut/g)).toHaveLength(1);
  });
});
