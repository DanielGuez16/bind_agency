import type { PorteeDeReprise } from '../../api';

/**
 * Le nom d'un écran ouvert, en toutes lettres.
 *
 * **Un aiguillage et non une clé composée.** `t(`…${ecran}`)` se lirait mieux
 * et ne se vérifierait nulle part : la garde des traductions ne résout pas les
 * clés composées, elle les compte. Écrit ainsi, TypeScript exige les sept cas —
 * une portée ajoutée côté serveur ne compile plus tant que personne ne l'a
 * nommée, ce qui est exactement le moment où il faut y penser.
 */
export function nomDeLEcran(ecran: PorteeDeReprise, t: (cle: string) => string): string {
  switch (ecran) {
    case 'fiche':
      return t('reglages.porteeFiche');
    case 'catalogue':
      return t('reglages.porteeCatalogue');
    case 'agenda':
      return t('reglages.porteeAgenda');
    case 'contreparties':
      return t('reglages.porteeContreparties');
    case 'annuaire':
      return t('reglages.porteeAnnuaire');
    case 'abonnement':
      return t('reglages.porteeAbonnement');
    case 'chiffres':
      return t('reglages.porteeChiffres');
  }
}
