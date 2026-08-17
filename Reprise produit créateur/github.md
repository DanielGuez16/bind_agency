# Source

repo: DanielGuez16/bind_agency
branch: main
path: app/src, design_handoff_bind

## Last sync

date: 2026-08-17T18:25:35Z

### Updated in this project

- `brand.500` passé de `#F26B21` à `#FF5E00`, la valeur du vectoriel de la fondatrice — propagé dans les huit maquettes et `tokens.json`.
- `brand.600` éclairci de `#D2500F` à `#DA5510` : l'ancienne valeur était sur le point de croisement où ni l'encre ni le blanc ne passent. Réponse écrite dans `QUESTION-brand600.md`.
- Table de contraste complétée de l'état appuyé, jamais mesuré jusqu'ici ; raisonnement au `PASSATION-v1.0.md` §3 bis.
- Les trois satins sont à re-rendre : leurs stops portaient les deux valeurs changées (`$stale` dans `tokens.json`).

- Nouvelle direction BIND AGENCY (v1.0) : système refait — `tokens.json`, `components.md`, `PASSATION-v1.0.md`. Orange unique, neutres chauds, Outfit + Bodoni Moda, angle droit, paliers en matière.
- Écran des paliers créateur refait en échelle d'échange (v0.7) : deux colonnes give / get, progression par la matière, règles enfin écrites.
- Coquille de bureau dessinée pour les trois rôles : barre latérale de 240 repliable en rail de 72, barre de titre de 56, largeurs de contenu bornées.
- Connexion refaite en deux portes, créateur et commerce, chacune avec sa promesse ; le bouton reste visible à l'état désactivé.
- Rapports commerce dotés de deux graphiques en barres — amendement à `components.md` §17.
- Caisse, arbitrage, états vides, favicon et déclinaisons de la marque livrés ; passation v0.6 écrite.

## Screen map

| Écran du projet | Fichiers du dépôt |
| --- | --- |
| Current UI (recreation) 03 · Fil | `app/src/screens/FilScreen.tsx`, `app/src/components/Cards.tsx` |
| Current UI (recreation) 04 · Fiche | `app/src/screens/FicheScreen.tsx` |
| v0.5 · 00a/00b Welcome | nouveau — pas d'écran source |
| v0.5 · 01a/01b Sign up, sign in | `app/src/screens/AuthScreen.tsx` |
| v0.5 · 02a–02d Discover | `app/src/screens/FilScreen.tsx`, `app/src/screens/RaisonDuVide.tsx`, `app/src/components/Cards.tsx`, `app/src/components/Skeleton.tsx` |
| v0.5 · 03a Filters | `app/src/components/Chip.tsx` |
| v0.5 · 03b–03d Search | nouveau — pas d'écran source |
| v0.5 · 03e Category | `app/src/screens/FilScreen.tsx` |
| v0.5 · 04a–04c Salon page | `app/src/screens/FicheScreen.tsx`, `app/src/components/TierBadge.tsx` |
| v0.6 · 05a–05c Gabarit de bureau | `app/src/shell/Navigation.tsx`, `app/src/theme/tokens.json`, `design_handoff_bind/rules.md` |
| v0.6 · 06a/06b Connexion | `app/src/screens/AuthScreen.tsx`, `app/src/components/Button.tsx`, `app/src/components/TextField.tsx` |
| v0.6 · 07a Rapports | `app/src/screens/ReportingScreen.tsx`, `app/src/components/Cards.tsx` |
| v0.6 · 07b Caisse | `app/src/screens/RedemptionScreen.tsx`, `app/src/components/CodeInput.tsx` |
| v0.6 · 08a Arbitrage | `app/src/screens/ArbitrageScreen.tsx`, `app/src/components/Admin.tsx`, `app/src/screens/motifs.ts` |
| v0.6 · 09a–09c États vides | `app/src/components/EmptyState.tsx`, `app/src/screens/RaisonDuVide.tsx` |
| v0.6 · 10 Marque et favicon | `app/src/components/Logo.tsx`, `app/src/screens/AudienceScreen.tsx` |
| v0.7 · 11a–11b Paliers mobile | `app/src/screens/PaliersScreen.tsx`, `app/src/components/TierBadge.tsx`, `app/src/screens/obstacle.ts` |
| v0.7 · 11c Prestations d'un palier | `app/src/screens/FilScreen.tsx`, `app/src/components/Cards.tsx` |
| v0.7 · 11d Règles des paliers | nouveau — pas d'écran source |
| v0.7 · 11e Cause commune | `app/src/screens/PaliersScreen.tsx`, `app/src/screens/RaisonDuVide.tsx` |
| v0.7 · 12a Paliers bureau | `app/src/screens/PaliersScreen.tsx`, `app/src/shell/Navigation.tsx` |

## Répondu à l'implémentation

| Note | Réponse |
| --- | --- |
| `QUESTION-brand600.md` | Issue 2, valeur `#DA5510` plutôt que `#D65310`. Libellé en encre conservé à l'appui — l'option blanche gagnait en mesure mais perdait sur le gabarit de bureau, seul endroit où l'appui se regarde. |

## En cours

Les huit écrans à reprendre dans le système v1.0, un par un. Deux valeurs non
figées faute de visuels : `brand.500` et la géométrie du logo. Un arbitrage en
attente : la suppression de la couleur de rôle (`PASSATION-v1.0.md` §8).

Découverte créateur sur bureau en grille de 3 à 4 cartes : règle posée dans
`PASSATION-v0.6.md` §2, écran non dessiné.
