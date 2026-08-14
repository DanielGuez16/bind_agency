/**
 * Les deux règles du lot 4, tenues mécaniquement.
 *
 * **Une carte se lit, une galerie se regarde.** La galerie reste sur l'encre,
 * la carte s'ouvre sur l'os. C'est la seule chose qui distingue les deux
 * visionneuses, et une règle qui tient à une seule propriété est exactement
 * celle qu'un jour quelqu'un uniformise en passant — « les deux visionneuses
 * n'ont pas le même fond » ressemble à une incohérence tant qu'on ne sait pas
 * que c'en est le sujet.
 *
 * **Une page de carte est toujours une photographie.** Jamais du texte
 * recomposé : BIND ne dépouille pas la carte d'un commerce. Ce n'est pas une
 * préférence esthétique — recomposer reviendrait à republier la carte sous
 * notre nom, et à répondre d'une erreur de lecture devant une créatrice qui a
 * commandé autre chose que ce qu'elle croyait.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { couleurs, ThemeProvider } from '../src/theme';
import {
  FOND_DES_VISIONNEUSES,
  VisionneuseDeCarte,
  VisionneuseDeGalerie,
} from '../src/screens/Visionneuses';

const coffre = { lire: async () => null, ecrire: async () => {} };

function client(): ApiClient {
  return new ApiClient({
    baseUrl: 'https://api.test',
    coffre,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) as Response,
  });
}

async function monter(noeud: ReactElement) {
  function Cadre({ children }: { children: ReactNode }) {
    return (
      <I18nProvider initialLocale="en">
        <ThemeProvider role="creator">
          <ApiProvider client={client()}>{children}</ApiProvider>
        </ThemeProvider>
      </I18nProvider>
    );
  }
  return render(<Cadre>{noeud}</Cadre>);
}

function style(element: { props: { style?: unknown } }): Record<string, unknown> {
  const empile = (valeur: unknown): Record<string, unknown> =>
    Array.isArray(valeur)
      ? Object.assign({}, ...valeur.map(empile))
      : ((valeur as Record<string, unknown>) ?? {});
  return empile(element.props.style);
}

const PAGES = ['photos/cartes/b1/a', 'photos/cartes/b1/b'];
const PHOTOS = ['photos/b1/salle', 'photos/b1/terrasse'];

describe('on regarde une photo sur du sombre, on lit un texte sur du clair', () => {
  it('la galerie s’ouvre sur l’encre', async () => {
    await monter(<VisionneuseDeGalerie photos={PHOTOS} onFermer={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('visionneuse-de-galerie')).toBeTruthy());

    expect(style(screen.getByTestId('visionneuse-de-galerie')).backgroundColor).toBe(
      couleurs['bg.sunken'],
    );
  });

  it('la carte s’ouvre sur l’os', async () => {
    await monter(<VisionneuseDeCarte pages={PAGES} onFermer={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('visionneuse-de-carte')).toBeTruthy());

    expect(style(screen.getByTestId('visionneuse-de-carte')).backgroundColor).toBe(
      couleurs['bg.page'],
    );
  });

  it('et les deux fonds diffèrent, ce qui est tout le sujet', () => {
    // **Le sens inverse compte autant.** Une garde qui vérifierait seulement
    // que chacune a « un fond » passerait le jour où les deux se retrouvent sur
    // le même — et c'est précisément la faute qu'on craint, parce qu'elle
    // ressemble à une mise en cohérence.
    expect(FOND_DES_VISIONNEUSES.galerie).not.toBe(FOND_DES_VISIONNEUSES.carte);
    expect(couleurs[FOND_DES_VISIONNEUSES.galerie]).not.toBe(
      couleurs[FOND_DES_VISIONNEUSES.carte],
    );
  });
});

describe('une page de carte est toujours une photographie', () => {
  it('la visionneuse rend une image, et l’original', async () => {
    await monter(<VisionneuseDeCarte pages={PAGES} onFermer={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('page-de-carte-0')).toBeTruthy());

    const page = screen.getByTestId('page-de-carte-0');
    expect(page.props.source.uri).toContain(PAGES[0]);
    // Ni recadrée ni réduite : une carte recadrée perd une colonne de prix, et
    // c'est celle qu'on cherchait ; une vignette de 480 points ne se lit pas.
    expect(page.props.resizeMode).toBe('contain');
    expect(page.props.source.uri).not.toContain('@vignette');
  });

  it('et rien de l’extraction n’entre dans cet écran', () => {
    // **BIND ne dépouille pas la carte.** L'extraction existe dans le produit —
    // elle sert au commerce à créer ses items depuis sa carte, avec validation.
    // Ce qu'elle ne fait jamais est alimenter ce que la créatrice lit : ce
    // qu'on lui montre est la photographie du commerce, avec sa mise en page,
    // ses prix et ses fautes de frappe.
    //
    // La garde cherche les noms par lesquels une recomposition arriverait :
    // un import de carte, une charge extraite, un texte de plat.
    const source = readFileSync(
      join(__dirname, '..', 'src', 'screens', 'Visionneuses.tsx'),
      'utf-8',
    );
    const lignes = source
      .split('\n')
      .filter((ligne) => !/^\s*(\/\/|\*|\/\*)/.test(ligne));

    for (const interdit of [
      'MenuImport',
      'menuImport',
      'extracted',
      'extraction',
      'depouill',
      'ligneDeCarte',
      'plats',
    ]) {
      expect({ interdit, present: lignes.some((l) => l.includes(interdit)) }).toEqual({
        interdit,
        present: false,
      });
    }
  });

  it('la garde attrape ce qu’elle vise, et pas la prose qui l’explique', () => {
    // Une garde qui crierait sur son propre commentaire se ferait désactiver.
    const commentaire = ['   * BIND ne dépouille pas la carte.', '  // extraction'];
    const code = ["  const plats = extracted.map((p) => p.name);"];

    const utile = (l: string) => !/^\s*(\/\/|\*|\/\*)/.test(l);
    expect(commentaire.filter(utile)).toEqual([]);
    expect(code.filter(utile)).toEqual(code);
  });
});
