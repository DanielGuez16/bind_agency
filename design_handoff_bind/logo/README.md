# Le logotype

`LOGO-BIND-source.png` — **le fichier de la fondatrice**, 2090 × 980, deux
couleurs franches sur fond transparent, signature « CRÉATEUR DE LIEN » comprise.
C'est la source ; tout le reste en dérive.

`vectoriser.sh` régénère les deux SVG. Ne pas retoucher les chemins à la main —
ni ici, ni dans `app/src/components/logotype.ts`, qui porte la même trace.

## Ce que la vectorisation fait

Le PNG est séparé en **deux masques** par la couleur : les lettres et le fût du
« ! » d'un côté, le point de l'autre. Chacun passe par `potrace` sur **la même
toile**, sans recadrage — c'est ce qui garantit que les deux chemins s'alignent.

La signature est coupée avant la trace : le mot occupe y 26–708, elle occupe
y 813–961, et la coupe tombe à 760, franchement entre les deux.

## Ce que la mesure dit

Le tracé a été **comparé à la source**, pas cru :

| | recouvrement | écart de contour |
| --- | --- | --- |
| encre | 99,75 % | ≤ 1 px |
| point | 99,22 % | ≤ 1 px |

Un pixel est la largeur de l'antialiasing de la source : le tracé ne s'en écarte
nulle part davantage.

**La coupe oblique du D** — ce qu'aucune fonte ne donne, et la raison pour
laquelle l'approximation ne tenait pas — mesure **-1,835°** sur la source comme
sur le tracé.

## Un écart relevé, et non corrigé

Le point de la fondatrice est `#FF5E00`. Le point du produit est `brand.500`,
`#F26B21`, parce que c'est ce que `tokens.json → logo.wordmark.dot` prescrit
« dans tous les cas ». Les SVG livrés ici portent la couleur du **produit**, pas
celle du PNG : le fichier source reste la référence de forme, les jetons celle
de couleur. À arbitrer si l'écart n'est pas voulu.
