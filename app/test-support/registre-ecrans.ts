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
  'CatalogueScreen.tsx',
  'HorairesScreen.tsx',
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
 * quoi qu'il arrive, y compris hors ligne — c'est sa règle, pas un oubli.
 * `BienvenueScreen` ne charge rien : il explique et propose. Les trois derniers
 * sont la dette d'avant le système de design.
 */
export const HORS_REGISTRE = [
  // L'accueil ne charge pas une donnée à quatre états : il charge un fond, et
  // son absence n'est pas une erreur — c'est un des cas prévus. Un état « en
  // échec » y afficherait « impossible de charger la vidéo » sur la première
  // chose qu'on voit du produit, ce qui est pire que le fond manquant.
  'AccueilScreen.tsx',
  'BienvenueScreen.tsx',
  // Une table des matières : trois portes, aucune requête. Lui inventer quatre
  // états demanderait de lui inventer une donnée à charger.
  'ConfigurationScreen.tsx',
  // La connexion et les réglages ne chargent pas de données à quatre états :
  // le premier attend une saisie, le second lit la session et le catalogue,
  // tous deux déjà en mémoire. Ils sont éprouvés par les tests de la coquille.
  'AuthScreen.tsx',
  'ReglagesScreen.tsx',
  'CodeScreen.tsx',
  'HealthScreen.tsx',
  'MenuReviewScreen.tsx',
  'RedemptionScreen.tsx',
] as const;
