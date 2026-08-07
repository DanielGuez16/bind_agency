/**
 * Quel écran est couvert par quel registre.
 *
 * Vit à part des deux fichiers de test parce que les deux en ont besoin, et
 * qu'un écran ajouté doit se déclarer **une** fois. Chaque fichier de test
 * vérifie que son registre correspond à sa liste ici, et un test de couverture
 * vérifie que l'union couvre tout `src/screens`.
 *
 * Sans ce croisement, un écran ajouté sans entrée au registre échapperait aux
 * quatre tests d'état sans que rien ne le signale.
 */
export const ECRANS_CREATEUR = [
  'AudienceScreen.tsx',
  'CreneauxScreen.tsx',
  'FicheScreen.tsx',
  'FilScreen.tsx',
  'HistoriqueScreen.tsx',
  'PaliersScreen.tsx',
  'PreuveScreen.tsx',
] as const;

export const ECRANS_COMMERCE = [
  'ActivationScreen.tsx',
  'ArbitrageScreen.tsx',
  'JourneeScreen.tsx',
  'PlansScreen.tsx',
  'ReportingScreen.tsx',
  'PublicationsScreen.tsx',
] as const;

/**
 * Les écrans que le registre ne couvre pas, et pourquoi.
 *
 * `CodeScreen` n'a pas de requête à quatre états : il garde son dernier code
 * quoi qu'il arrive, y compris hors ligne — c'est sa règle, pas un oubli. Les
 * trois autres sont la dette d'avant le système de design.
 */
export const HORS_REGISTRE = [
  'CodeScreen.tsx',
  'HealthScreen.tsx',
  'MenuReviewScreen.tsx',
  'RedemptionScreen.tsx',
] as const;
