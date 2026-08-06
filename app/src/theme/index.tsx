/**
 * Thème et jetons.
 *
 * **`tokens.json` est la source.** Il est copié tel quel du dossier de
 * passation, sans retouche : le retranscrire en TypeScript aurait créé une
 * seconde vérité, et c'est la seconde qu'on oublie de mettre à jour quand le
 * design bouge. Un test compare les deux fichiers.
 *
 * **Aucune couleur écrite en dur nulle part.** Un test parcourt les sources et
 * refuse tout littéral hexadécimal hors de ce dossier. Une couleur en dur
 * survit au changement de thème et ne se voit qu'en mode clair, chez le
 * commerce, à la lumière du jour.
 *
 * **Le thème suit le rôle, et l'utilisateur peut le forcer.** Créateur en
 * sombre — navigation, le soir, photos plein cadre ; commerce en clair — il
 * travaille en pleine journée sur un téléphone posé au comptoir, souvent près
 * d'une vitrine, où le sombre perd son contraste perçu.
 *
 * **L'écran de code ignore tout cela.** Il n'appelle pas `useTheme` : ses deux
 * couleurs sont exportées à part, et le test des couleurs en dur les tolère
 * explicitement à cet endroit. Un code de retrait doit se lire à 1,20 m dans un
 * salon très éclairé ; le laisser suivre le thème le rendrait illisible une
 * fois sur deux.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import brut from './tokens.json';

export type ThemeName = 'dark' | 'light';
export type Role = 'creator' | 'merchant' | 'admin';

/** Les jetons de couleur, à plat : `color.dark['bg.canvas']`. */
export type ColorTokens = (typeof brut)['color']['dark'];
export type ColorName = keyof ColorTokens;

const CLE_STOCKAGE = 'bind.theme.override';

/** Le rôle administrateur travaille sur écran large, en clair comme le commerce. */
const THEME_PAR_ROLE: Record<Role, ThemeName> = {
  creator: 'dark',
  merchant: 'light',
  admin: 'light',
};

export const tokens = brut;
export const typography = brut.typography.scale;
export const radius = brut.radius;
export const spacing = brut.spacing;
export const density = brut.density;
export const size = brut.size;
export const breakpoint = brut.breakpoint;
export const motion = brut.motion;
export const tierTokens = brut.tier;

/**
 * Les deux seules couleurs qui ne viennent pas d'un thème.
 *
 * Exportées ici plutôt qu'écrites dans l'écran : le test des couleurs en dur
 * n'a ainsi qu'un seul endroit à tolérer, et la valeur reste comparable au
 * fichier de jetons.
 */
export const codeColors = { fg: brut.code.fg, bg: brut.code.bg } as const;

export function themeForRole(role: Role): ThemeName {
  return THEME_PAR_ROLE[role];
}

type ThemeValue = {
  name: ThemeName;
  role: Role;
  color: ColorTokens;
  /**
   * Densité du rôle : le commerce est plus dense, il lit des listes longues.
   *
   * `gap` est normalisé — la passation le nomme `cardGap` côté créateur et
   * `rowGap` côté commerce, ce qui décrit la même chose et obligerait chaque
   * appelant à savoir de quel rôle il dépend.
   */
  density: { screenPadding: number; gap: number; rowHeight: number };
  /** Nul tant que l'utilisateur n'a rien forcé : le rôle décide alors. */
  override: ThemeName | null;
  setOverride: (theme: ThemeName | null) => void;
};

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({
  role = 'creator',
  initialTheme,
  children,
}: {
  role?: Role;
  /** Force le thème sans passer par le stockage. Réservé aux tests. */
  initialTheme?: ThemeName;
  children: ReactNode;
}) {
  const [override, setOverrideState] = useState<ThemeName | null>(initialTheme ?? null);
  const systeme = useColorScheme();

  useEffect(() => {
    if (initialTheme) return;
    // Le choix persiste : quelqu'un qui a forcé le clair ne veut pas le
    // reforcer à chaque ouverture.
    void AsyncStorage.getItem(CLE_STOCKAGE).then((valeur) => {
      if (valeur === 'dark' || valeur === 'light') setOverrideState(valeur);
    });
  }, [initialTheme]);

  const setOverride = useCallback((theme: ThemeName | null) => {
    setOverrideState(theme);
    void (theme === null
      ? AsyncStorage.removeItem(CLE_STOCKAGE)
      : AsyncStorage.setItem(CLE_STOCKAGE, theme));
  }, []);

  const value = useMemo<ThemeValue>(() => {
    // Le thème système n'est délibérément pas consulté : le rôle décide, parce
    // qu'un commerce en sombre perd son contraste au comptoir quel que soit le
    // réglage de son téléphone. `systeme` est lu pour que le composant se
    // rafraîchisse si l'utilisateur bascule, sans changer le résultat.
    void systeme;
    const name = override ?? themeForRole(role);
    return {
      name,
      role,
      color: brut.color[name],
      density:
        role === 'merchant'
          ? {
              screenPadding: brut.density.merchant.screenPadding,
              gap: brut.density.merchant.rowGap,
              rowHeight: brut.density.merchant.rowHeight,
            }
          : {
              screenPadding: brut.density.creator.screenPadding,
              gap: brut.density.creator.cardGap,
              rowHeight: brut.density.creator.rowHeight,
            },
      override,
      setOverride,
    };
  }, [override, role, setOverride, systeme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (value === null) {
    // Lever plutôt que retomber sur le thème sombre : un composant rendu hors
    // du fournisseur afficherait des couleurs de créateur chez un commerce, et
    // personne ne s'en apercevrait avant une capture d'écran.
    throw new Error('useTheme hors de ThemeProvider');
  }
  return value;
}

/** Raccourci : `const c = useColors(); c['bg.canvas']`. */
export function useColors(): ColorTokens {
  return useTheme().color;
}
