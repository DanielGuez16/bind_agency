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
export { LigneDeContrepartie, TierBadge, type Palier, type TierBadgeProps } from './TierBadge';
export { BadgesDeProfil, chipDeComportement, type BadgeDeProfil } from './Badges';
export {
  BusinessCard,
  DataRow,
  MediaFallback,
  ServiceRow,
  type BusinessCardProps,
  type DataRowProps,
  type MediaFallbackProps,
  type ServiceRowProps,
} from './Cards';
export { StatusMessage, type Niveau, type StatusMessageProps } from './StatusMessage';
export { EmptyState, type EmptyStateProps } from './EmptyState';
export { SkeletonBox, SkeletonCard, SkeletonLine } from './Skeleton';
export { ALPHABET, CodeInput, LONGUEUR, type CodeInputProps } from './CodeInput';
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
