/**
 * La bibliothèque.
 *
 * Point d'entrée unique : un écran importe d'ici, jamais d'un fichier précis.
 * C'est ce qui permet de déplacer un composant sans toucher aux écrans, et ce
 * qui rend visible, en une ligne de `git diff`, l'ajout d'une dix-huitième
 * famille.
 */
export { Texte, type TexteProps, type Variante } from './Texte';
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './Button';
export { TextField, type TextFieldProps } from './TextField';
export { RangeeDeValeurs, Stepper, type RangeeDeValeursProps, type StepperProps } from './Stepper';
export { Toggle, type ToggleProps } from './Toggle';
export { SegmentedTabs, type SegmentedTabsProps } from './SegmentedTabs';
export { Chip, RangeeDeChips, type ChipProps } from './Chip';
export { Icone, type NomIcone } from './Icone';
export { Marque, PLANCHER_DU_LOGOTYPE } from './Logo';
export { PaveDeSaisie, TOUCHES } from './PaveDeSaisie';
export {
  BarresParPalier,
  BarresParPeriode,
  PALIERS,
  type BarreDePalier,
  type BarreVerticale,
} from './Graphiques';
export {
  Apparition,
  Fondu,
  useEnfoncement,
  useMouvementReduit,
  vibration,
} from './Mouvement';
export { EnTeteDEcran, Filet, prenomDe, type Compteur } from './EnTete';
export { LigneDeContrepartie, TierBadge, type Palier, type TierBadgeProps } from './TierBadge';
export { BadgesDeProfil, chipDeComportement, type BadgeDeProfil } from './Badges';
export { ApercuDePrestation, CASE_DU_BADGE, IMAGE_DE_L_APERCU } from './ApercuDePrestation';
export type { ApercuDePrestationProps } from './ApercuDePrestation';
export {
  DataRow,
  MediaFallback,
  ServiceRow,
  BandeDeTexteSurPhoto,
  VoileDeLisibilite,
  type DataRowProps,
  type MediaFallbackProps,
  type ServiceRowProps,
} from './Cards';
export { StatusMessage, type Niveau, type StatusMessageProps } from './StatusMessage';
export { TitreAccentue, type TitreAccentueProps } from './TitreAccentue';
export { FiletSegmente, type FiletSegmenteProps } from './FiletSegmente';
export {
  SurfaceSatin,
  CADRAGE_DU_SATIN,
  ENCRE_DU_SATIN,
  imageDuSatin,
  POSE_DU_SATIN,
  HAUTEUR_MINIMALE_DU_SATIN,
  type SurfaceSatinProps,
  type VarianteDeSatin,
} from './SurfaceSatin';
export { EmptyState, type EmptyStateProps } from './EmptyState';
export {
  SkeletonBox,
  SkeletonFiche,
  SkeletonGrille,
  SkeletonLignes,
  SkeletonLine,
} from './Skeleton';
export {
  ALPHABET,
  CodeInput,
  LONGUEUR,
  TAILLE_DE_GROUPE,
  groupesDeRangs,
  type CodeInputProps,
} from './CodeInput';
export {
  CodeGlyphs,
  Countdown,
  ManualCode,
  PickupCodeSurface,
  QrBlock,
} from './PickupCode';
export { DayPicker, SlotPicker, type Creneau, type Jour } from './SlotPicker';
export {
  DecisionBar,
  DetailPanel,
  KeyHint,
  TableHeader,
  TableRow,
  Toolbar,
  type Colonne,
  type Decision,
} from './Admin';
