/**
 * Ce que chaque parcours a besoin de savoir. Rien de plus.
 *
 * Les comptes viennent du jeu de données, qui les crée par les mêmes services
 * que le produit — aucune ligne posée à la main. Le mot de passe est celui
 * qu'il imprime en fin d'exécution.
 */
import { expect, type Page } from '@playwright/test';

/** Le mot de passe de tous les comptes du jeu de données. */
export const MOT_DE_PASSE = 'bind-donnees-de-depart-2026';

/**
 * Une créatrice à soixante-quatre mille abonnés : ses paliers sont ouverts, et
 * elle peut réserver. Choisie pour cela — une créatrice débutante prouverait
 * seulement que l'écran des obstacles s'affiche.
 */
export const CREATRICE = 'rebecca@bind.example';

/** Les largeurs où la navigation doit exister. */
export const LARGEURS = {
  /** Un iPhone. La barre du bas. */
  telephone: { width: 390, height: 844 },
  /** Une tablette au seuil. C'est ici que la bascule se joue. */
  tablette: { width: 900, height: 1200 },
  /** Un écran de bureau. La barre latérale. */
  bureau: { width: 1512, height: 982 },
} as const;

/**
 * Se connecte et attend que la coquille soit montée.
 *
 * Passe par les vrais champs et le vrai bouton : injecter un jeton dans le
 * stockage sauterait exactement la partie qu'on veut éprouver.
 */
export async function seConnecter(page: Page, email: string): Promise<void> {
  await page.goto('/');

  // L'accueil ouvre sur les deux portes ; se connecter est un lien de bas.
  await page.getByTestId('vers-connexion').click();

  await page.getByTestId('champ-email').fill(email);
  await page.getByTestId('champ-mot-de-passe').fill(MOT_DE_PASSE);
  await page.getByTestId('valider').click();

  // **On attend la navigation, pas la coquille.** `zone-sure` apparaît avant
  // que les onglets soient montés : s'arrêter là faisait lire un écran encore
  // vide, et le test échouait sur une absence qui n'en était pas une.
  await expect(page.getByText('Settings', { exact: true }).first()).toBeVisible();
}

/**
 * Les libellés d'onglets visibles, quelle que soit la barre qui les porte.
 *
 * C'est le point du test de navigation : peu importe que ce soit la barre du
 * bas ou la latérale, il faut qu'un chemin existe.
 */
export async function ongletsVisibles(page: Page): Promise<string[]> {
  const candidats = ['Nearby', 'Tiers', 'Bookings', 'Audience', 'Settings', 'Today', 'Checkout'];
  const vus: string[] = [];
  for (const libelle of candidats) {
    if (await page.getByText(libelle, { exact: true }).first().isVisible().catch(() => false)) {
      vus.push(libelle);
    }
  }
  return vus;
}

/**
 * Accorde la position et attend que le fil charge.
 *
 * **Le geste est explicite dans le produit**, et le test le refait : rien n'est
 * demandé au démarrage, parce qu'une autorisation réclamée avant d'avoir montré
 * à quoi elle sert se refuse. L'autorisation du navigateur est déjà donnée par
 * la configuration — ce qui manque est le clic.
 */
export async function accorderLaPosition(page: Page): Promise<void> {
  const bouton = page.getByText('Share my location', { exact: true }).first();
  if (await bouton.isVisible().catch(() => false)) {
    await bouton.click();
  }
  await expect(page.getByTestId('etat-nominal')).toBeVisible({ timeout: 30_000 });
}
