/**
 * Les raccourcis clavier de l'arbitrage, et les quatre fois où ils se taisent.
 *
 * **Le défaut réparé.** `DecisionBar` dessinait une pastille « A », « R », « N »
 * à côté de chaque décision, et rien n'écoutait le clavier. La pastille est une
 * promesse : quelqu'un qui traite vingt dossiers à la chaîne la croit, appuie,
 * et rien ne se passe — puis il cesse d'y croire et clique, ce qui est plus
 * lent que s'il n'y avait jamais eu de pastille.
 *
 * **La touche « N » est la raison de tout ce fichier.** L'arbitre écrit un
 * motif dans un champ de texte avant de clore un dossier en non honoré. Si le
 * raccourci écoutait sans discernement, taper « non conforme » déclencherait
 * `N` — la seule décision du produit qui ne se rouvre pas — au premier
 * caractère. Un raccourci qui ne sait pas se taire est plus dangereux que pas
 * de raccourci du tout.
 *
 * Il se tait donc :
 *
 * 1. **Quand la frappe vient d'un champ de saisie** — `input`, `textarea`, ou
 *    tout élément éditable. C'est le cas ci-dessus.
 * 2. **Quand une touche de modification est tenue.** `Cmd+R` recharge la page,
 *    `Ctrl+N` ouvre une fenêtre : les intercepter volerait un geste du système
 *    pour en faire une décision définitive.
 * 3. **Quand la touche n'est pas déclarée.** L'appelant liste ce qu'il sert ;
 *    le reste passe.
 * 4. **Hors du web.** Il n'y a pas de clavier physique à écouter sur un
 *    téléphone, et `document` n'y existe pas.
 *
 * **La casse ne compte pas.** « A » sur la pastille, `a` sous le doigt : exiger
 * la majuscule demanderait de tenir Maj, donc une touche de modification, donc
 * la règle 2 — le raccourci ne se déclencherait jamais.
 */
import { useEffect } from 'react';
import { Platform } from 'react-native';

/** Les balises dont une frappe ne doit jamais sortir. */
const SAISIES = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * La frappe vient-elle d'un endroit où quelqu'un écrit.
 *
 * Exportée pour être éprouvée seule : c'est la fonction qui décide si « non
 * conforme » clôt un dossier, et elle mérite mieux qu'un test au travers d'un
 * rendu.
 */
export function frappeDansUneSaisie(cible: unknown): boolean {
  if (cible === null || typeof cible !== 'object') return false;
  const element = cible as { tagName?: unknown; isContentEditable?: unknown };

  if (typeof element.tagName === 'string' && SAISIES.has(element.tagName.toUpperCase())) {
    return true;
  }
  // Un éditeur riche n'est ni `input` ni `textarea`. Le produit n'en a pas
  // aujourd'hui ; l'oublier serait laisser le piège ouvert pour le jour où.
  return element.isContentEditable === true;
}

export type Raccourci = {
  /** La lettre affichée sur la pastille. Comparée sans tenir compte de la casse. */
  touche: string;
  action: () => void;
};

/**
 * Écoute le clavier tant que le composant est monté.
 *
 * Les raccourcis sont relus à chaque rendu et non figés au montage : la barre
 * de décision retire ses issues tant qu'aucun motif n'est choisi, et un
 * raccourci qui survivrait à son bouton ferait exactement ce que le bouton
 * refuse de faire.
 */
export function useRaccourcis(raccourcis: Raccourci[]): void {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const fenetre = globalThis as unknown as {
      document?: {
        addEventListener: (type: string, ecouteur: (evenement: unknown) => void) => void;
        removeEventListener: (type: string, ecouteur: (evenement: unknown) => void) => void;
      };
    };
    const document = fenetre.document;
    if (!document) return;

    function surTouche(brut: unknown) {
      const evenement = brut as {
        key?: string;
        target?: unknown;
        ctrlKey?: boolean;
        metaKey?: boolean;
        altKey?: boolean;
        preventDefault?: () => void;
      };

      if (evenement.ctrlKey || evenement.metaKey || evenement.altKey) return;
      if (frappeDansUneSaisie(evenement.target)) return;

      const touche = (evenement.key ?? '').toLowerCase();
      const trouve = raccourcis.find((r) => r.touche.toLowerCase() === touche);
      if (!trouve) return;

      // Seulement une fois qu'on sert la touche : l'annuler plus tôt volerait
      // des frappes qu'on ne traite pas.
      evenement.preventDefault?.();
      trouve.action();
    }

    document.addEventListener('keydown', surTouche);
    return () => document.removeEventListener('keydown', surTouche);
  }, [raccourcis]);
}
