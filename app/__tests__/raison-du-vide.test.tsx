/**
 * Pourquoi un écran est vide, et ce qu'on propose d'y faire.
 *
 * **Le défaut signalé n'était pas le vide, c'était le silence.** Un compte en
 * vérification, un compte sans relevé et un créateur au milieu d'un désert
 * voyaient la même page presque nue — trois situations, trois actions
 * différentes, aucune montrée. Ce test porte sur la règle de choix, pas sur la
 * mise en page : c'est elle qui décide ce que quelqu'un va faire ensuite.
 */
import { render, screen } from '@testing-library/react-native';

import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { ThemeProvider } from '../src/theme';
import { RaisonDuVide, raisonPrincipale } from '../src/screens/RaisonDuVide';

const obstacle = (raison: string, depuis: string | null = null) =>
  ({ raison, requis: null, constate: null, ecart: null, depuis }) as never;

function monter(obstacles: unknown[], issues = {}) {
  return render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <RaisonDuVide obstacles={obstacles as never} issues={issues} rayonKm={15} />
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('la raison qui commande', () => {
  it('remonte la chaîne : sans compte, le reste ne veut rien dire', () => {
    // Un compte neuf en porte trois à la fois. Les afficher côte à côte
    // donnerait trois actions dont deux sont sans effet tant que la première
    // n'est pas levée.
    const { cas } = raisonPrincipale([
      obstacle('not_enough_followers'),
      obstacle('no_metrics'),
      obstacle('no_social_account'),
    ]);
    expect(typeof cas === 'string' ? cas : cas.cle).toBe('no_social_account');
  });

  it('distingue la vérification du manque de relevé', () => {
    // Les deux se sont présentés ensemble sur un vrai compte, et les deux
    // appellent une phrase différente : l'une dit d'attendre, l'autre dit
    // qu'on est en train de mesurer.
    const enRevue = raisonPrincipale([obstacle('account_under_review'), obstacle('no_metrics')]);
    expect(typeof enRevue.cas === 'string' ? enRevue.cas : enRevue.cas.cle).toBe(
      'account_under_review',
    );

    const sansReleve = raisonPrincipale([obstacle('no_metrics')]);
    expect(typeof sansReleve.cas === 'string' ? sansReleve.cas : sansReleve.cas.cle).toBe(
      'no_metrics',
    );
  });

  it('résume les conditions chiffrées en « aucun palier ouvert »', () => {
    const { cas } = raisonPrincipale([
      obstacle('not_enough_followers'),
      obstacle('reliability_too_low'),
    ]);
    expect(cas).toBe('aucun_palier');
  });

  it('sans obstacle, la distance est la seule explication qui reste', () => {
    expect(raisonPrincipale([]).cas).toBe('rien_autour');
  });

  it('garde les autres obstacles, sans les perdre', () => {
    // Les masquer ferait combler le premier pour découvrir le second.
    const { autres } = raisonPrincipale([
      obstacle('no_metrics'),
      obstacle('account_under_review'),
    ]);
    expect(autres.map((o) => o.raison)).toEqual(['no_metrics']);
  });
});

describe('ce que l’écran montre', () => {
  it('nomme la vérification et n’annonce aucun délai', async () => {
    await monter([obstacle('account_under_review', '2026-08-07T10:00:00Z')]);

    expect(screen.getByText(en.vide.account_under_reviewTitre)).toBeTruthy();
    // Aucune promesse tenue par une file d'attente humaine.
    expect(screen.queryByText(/\d+ ?(days?|hours?|h\b)/i)).toBeNull();
  });

  it('ne propose d’élargir que si la distance est en cause', async () => {
    const elargir = [{ label: 'Widen to 30 km', onPress: () => {} }];

    await monter([obstacle('no_metrics')], { elargir });
    expect(screen.queryByTestId('elargir')).toBeNull();

    await monter([], { elargir });
    expect(screen.getByTestId('elargir')).toBeTruthy();
  });

  it('n’affiche pas de bouton quand il n’y a rien à faire', async () => {
    // Un compte refusé attend une personne, pas un geste. Un bouton qui ne
    // mène nulle part est pire que pas de bouton.
    await monter([obstacle('account_rejected')], { onConnecterUnReseau: () => {} });
    expect(screen.queryByTestId('issue-du-vide')).toBeNull();
  });

  it('n’affiche pas d’issue quand l’écran ne sait pas où mener', async () => {
    await monter([obstacle('no_social_account')]);
    expect(screen.queryByTestId('issue-du-vide')).toBeNull();

    await monter([obstacle('no_social_account')], { onConnecterUnReseau: () => {} });
    expect(screen.getByTestId('issue-du-vide')).toBeTruthy();
  });

  it('couvre tous les codes du catalogue de refus', () => {
    // Un code du serveur sans cas ici retomberait sur « aucun palier ouvert »,
    // ce qui serait faux pour un compte expiré ou refusé.
    const CODES = [
      'no_social_account',
      'account_rejected',
      'account_token_invalid',
      'account_under_review',
      'no_metrics',
      'metrics_stale',
      'not_enough_followers',
      'not_enough_completed_collabs',
      'reliability_too_low',
    ];
    for (const code of CODES) {
      const { cas } = raisonPrincipale([obstacle(code)]);
      expect(cas).not.toBe('rien_autour');
    }
  });
});
