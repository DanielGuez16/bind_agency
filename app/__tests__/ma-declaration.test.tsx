/**
 * Ce qu'on a déclaré se lit sur le profil, et pas seulement dans le formulaire.
 *
 * **Le défaut n'était pas une section manquante, c'était une asymétrie.** La
 * bio et les centres d'intérêt partent à l'annuaire des salons depuis qu'ils
 * existent ; leur autrice ne les revoyait qu'en rouvrant les réglages. Le
 * profil montrait une identité qu'elle n'a pas choisie — pseudonyme, avatar,
 * audience — et taisait celle qu'elle a écrite.
 */
import { render, screen } from '@testing-library/react-native';

import { I18nProvider } from '../src/i18n';
import { MaDeclaration } from '../src/screens/profil/MaDeclaration';
import { ThemeProvider } from '../src/theme';

async function monter(
  bio: string | null,
  interets: Parameters<typeof MaDeclaration>[0]['interets'],
) {
  return render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <MaDeclaration bio={bio} interets={interets} />
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('la section « à propos »', () => {
  it('rend la bio et les intérêts, chacun dans sa forme', async () => {
    await monter('Nails and skin, Wynwood.', ['ongles', 'soin_du_visage']);

    expect(screen.getByTestId('ma-declaration-bio')).toBeTruthy();
    // En pastilles, et par leur libellé traduit — pas par leur valeur brute.
    expect(screen.getByTestId('ma-declaration-interet-ongles')).toBeTruthy();
    expect(screen.getByText('Nails')).toBeTruthy();
    expect(screen.getByText('Facials')).toBeTruthy();
    // Rien n'invite à remplir ce qui est déjà rempli.
    expect(screen.queryByTestId('ma-declaration-vide')).toBeNull();
  });

  it('invite quand rien n’est déclaré, au lieu de rendre une carte muette', async () => {
    await monter(null, null);

    expect(screen.getByTestId('ma-declaration-vide')).toBeTruthy();
    expect(screen.queryByTestId('ma-declaration-bio')).toBeNull();
  });

  it('et une bio seule n’invite plus, même sans un seul intérêt', async () => {
    // **Le cas qui diverge.** Une implémentation qui invite dès qu'il manque
    // *quelque chose* — pas d'intérêts, donc invitation — passe les deux tests
    // ci-dessus et tombe ici. Le vide qui appelle un geste est le vide
    // complet ; une bio écrite sans intérêt est un profil rempli à sa façon,
    // et lui réclamer la suite serait une dette morale sans contrepartie.
    await monter('Nails and skin, Wynwood.', []);

    expect(screen.getByTestId('ma-declaration-bio')).toBeTruthy();
    expect(screen.queryByTestId('ma-declaration-vide')).toBeNull();
  });
});
