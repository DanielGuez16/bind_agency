/**
 * Les trois liens publics : ce qui part, et ce qui se montre.
 *
 * **La conversion se teste sans écran** — c'est une règle, pas une
 * composition — et le rendu sur les deux cas qui décident : aucun lien, et
 * un seul.
 */
import { render, screen } from '@testing-library/react-native';

import { I18nProvider } from '../src/i18n';
import { LesLiensDuSalon } from '../src/screens/fiche/LesLiensDuSalon';
import { aEnvoyer } from '../src/screens/lieu/LesLiensPublics';
import { ThemeProvider } from '../src/theme';

const RIEN = { instagram_url: null, tiktok_url: null, website_url: null };

async function monter(liens: typeof RIEN) {
  return await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <LesLiensDuSalon liens={liens} />
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('ce qui part au serveur', () => {
  it('vider un champ le retire, plutôt que d’envoyer une adresse vide', () => {
    // **Le cas divergent.** Sans la conversion, `''` part tel quel : la fiche
    // rendrait alors un lien vers nulle part, et le salon croirait l'avoir
    // retiré. Une chaîne vide et `null` sont deux choses pour le serveur.
    expect(aEnvoyer({ instagram_url: '', tiktok_url: '   ', website_url: null })).toEqual(RIEN);
  });

  it('et une adresse renseignée part sans ses espaces', () => {
    expect(
      aEnvoyer({ instagram_url: '  https://instagram.com/vela  ', tiktok_url: null, website_url: null }),
    ).toEqual({ ...RIEN, instagram_url: 'https://instagram.com/vela' });
  });
});

describe('ce que la fiche montre', () => {
  it('rien du tout quand le salon n’a rien renseigné', async () => {
    await monter(RIEN);
    expect(screen.queryByTestId('liens-du-salon')).toBeNull();
  });

  it('et seulement ceux qui existent', async () => {
    await monter({ ...RIEN, instagram_url: 'https://instagram.com/vela' });
    expect(screen.getByTestId('liens-du-salon-instagram')).toBeTruthy();
    expect(screen.queryByTestId('liens-du-salon-tiktok')).toBeNull();
    expect(screen.queryByTestId('liens-du-salon-site')).toBeNull();
  });
});
