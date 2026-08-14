/**
 * Le choix du rôle, **avant** le formulaire.
 *
 * **Deux portes, deux promesses.** Le rôle se choisissait au milieu de
 * l'inscription, sur une paire de pastilles entre le mot de passe et le bouton
 * — c'est-à-dire au moment où l'on remplit un formulaire, pas au moment où l'on
 * décide de quoi on a besoin. Un créateur et un salon ne viennent pas chercher
 * la même chose : la première question doit être laquelle des deux, et la
 * réponse doit s'accompagner de ce qu'elle engage.
 *
 * **Trois points concrets par porte, pas un argumentaire.** Ce qu'on ouvre, ce
 * qu'on donne, ce qu'on ne donne pas. « Aucune commission, aucun abonnement »
 * en dit plus long à un salon que n'importe quelle promesse d'audience.
 *
 * Sur grand écran les deux cartes de 440 sont côte à côte, parce que le choix
 * se fait en les comparant. En compact elles s'empilent, dans le même ordre.
 */
import { View } from 'react-native';

import { Button, Icone, Marque, Texte, TitreAccentue } from '../components';
import { useI18n } from '../i18n';
import { useGabarit } from '../shell/gabarit';
import { breakpoint, radius, spacing, useColors, type ColorName } from '../theme';
import type { RoleInscriptible } from '../session';

/** La largeur d'une porte. La passation la fixe, et elle ne s'étire pas. */
const LARGEUR_DE_PORTE = 440;

type Porte = {
  role: RoleInscriptible;
  teinte: ColorName;
  etiquette: string;
  promesse: string;
  points: string[];
  action: string;
  testID: string;
};

export function ChoixDeLaPorte({
  onChoisir,
  onSeConnecter,
  surMedia = false,
}: {
  onChoisir: (role: RoleInscriptible) => void;
  onSeConnecter: () => void;
  /**
   * Posé sur une vidéo ou une photo. Les couleurs de texte ordinaires y sont
   * illisibles : elles sont calculées pour un fond du thème, pas pour un ciel
   * de Miami. Le système a deux jetons pour ce cas, et ce sont eux qu'il faut.
   */
  surMedia?: boolean;
}) {
  const { t } = useI18n();
  const c = useColors();
  const { large } = useGabarit();

  const portes: Porte[] = [
    {
      role: 'creator',
      teinte: 'brand.700',
      etiquette: t('auth.roleCreator'),
      promesse: t('auth.porteCreateur'),
      points: [t('auth.porteCreateurA'), t('auth.porteCreateurB'), t('auth.porteCreateurC')],
      action: t('auth.porteCreateurAction'),
      testID: 'porte-createur',
    },
    {
      role: 'business_member',
      teinte: 'ink.mute',
      etiquette: t('auth.roleMerchant'),
      promesse: t('auth.porteCommerce'),
      points: [t('auth.porteCommerceA'), t('auth.porteCommerceB'), t('auth.porteCommerceC')],
      action: t('auth.porteCommerceAction'),
      testID: 'porte-commerce',
    },
  ];

  return (
    // **Tout vit dans la même grille.** Le lien « Already have an account? »
    // était collé au bord droit de l'écran, seul, à plus de mille points des
    // cartes : il partageait la largeur du viewport au lieu de celle du
    // contenu. Borné et centré, il retrouve sa place au-dessus d'elles.
    <View
      testID="choix-de-la-porte"
      style={{
        gap: spacing['space.6'],
        width: '100%',
        maxWidth: large ? breakpoint.contentMaxCreator : undefined,
        alignSelf: 'center',
      }}
    >
      {/* **L'en-tête vit ici, et nulle part ailleurs.** Il a porté un prop
          `avecEnTete` le temps que l'accueil le lui prenne sur un satin ; c'est
          précisément ce déplacement qui refaisait la page une seconde après
          l'ouverture. Le satin est passé en fond, l'en-tête est revenu, et le
          prop est parti avec la bascule qu'il servait. */}
      {/* Le seul écran, avec l'accueil, où la marque **se présente** : le sigle
          y porte sa signature, qu'aucun autre écran ne répète. */}
      <Marque taille={30} couleur={surMedia ? 'ink.onScrim' : 'ink.default'} signature />

      <View style={{ gap: spacing['space.2'], maxWidth: 720 }}>
        {/* Nommée : c'est sur elle que la suite de bout en bout lit la police
            réellement employée. Sans point d'accroche, la seule façon de
            vérifier qu'un texte emploie la fonte serait de deviner un
            sélecteur, qui casserait au premier changement de structure.

            **Le bloc de l'écran est ici**, et il n'y en a pas d'autre : c'est
            un écran de seuil, qu'on ne voit qu'une fois. Une garde compte. */}
        <TitreAccentue
          texte={t('auth.accroche')}
          motAccentue={t('auth.accrocheAccent')}
          taille="heading"
          bloc
          couleur={surMedia ? 'ink.onScrim' : 'ink.default'}
          testID="promesse-accueil"
        />
        {/* **La sous-ligne est blanche sur un média, pas sourde.** Mesuré sur
            le satin de l'accueil sous son voile : `ink.onScrimMuted` y donne
            3,83:1, sous le seuil, quand `ink.onScrim` donne 6,00:1. La nuance
            sourde n'était défendable que sur un fond clair connu ; sur un voile
            posé au-dessus d'une image quelconque, elle ne l'a jamais été. */}
        <Texte couleur={surMedia ? 'ink.onScrim' : 'ink.soft'}>
          {t('auth.sousAccroche')}
        </Texte>
      </View>

      <View
        style={{
          flexDirection: large ? 'row' : 'column',
          gap: spacing['space.4'],
          alignItems: large ? 'stretch' : undefined,
        }}
      >
        {/* Les cartes occupent la grille au lieu de se caler à gauche : deux
            cartes de 440 dans 1512 laissaient la moitié droite vide. Elles
            gardent leur largeur de référence comme plancher et s'étendent
            à parts égales — c'est la comparaison d'un regard qui compte. */}
        {portes.map((porte) => (
          <View
            key={porte.role}
            testID={porte.testID}
            style={{
              // Bornée et non étirée : deux cartes qui occupent tout l'écran
              // cessent d'être comparables d'un regard.
              flex: large ? 1 : undefined,
              minWidth: large ? LARGEUR_DE_PORTE : undefined,
              gap: spacing['space.4'],
              padding: spacing['space.5'],
              borderRadius: radius['radius.none'],
              borderWidth: 1,
              borderColor: c['line.default'],
              backgroundColor: c['bg.surface'],
            }}
          >
            {/* **Les deux portes ne se distinguent plus par une teinte.** La
                v1.0 n'a qu'une encre de marque : elle va à celle qu'on veut
                voir en premier, la créatrice, et l'autre reste en sourd. Ce
                qui les sépare est le texte de la carte, pas sa couleur. */}
            <Texte variante="type.label" couleur={porte.teinte}>
              {porte.etiquette.toUpperCase()}
            </Texte>
            <Texte variante="type.section">{porte.promesse}</Texte>

            <View style={{ gap: spacing['space.3'], flex: 1 }}>
              {porte.points.map((point) => (
                <View key={point} style={{ flexDirection: 'row', gap: spacing['space.2'] }}>
                  <Icone nom="coche" couleur="ink.mute" taille={18} />
                  <Texte couleur="ink.soft" style={{ flex: 1 }}>
                    {point}
                  </Texte>
                </View>
              ))}
            </View>

            <Button
              label={porte.action}
              onPress={() => onChoisir(porte.role)}
              testID={`choisir-${porte.role}`}
            />
          </View>
        ))}
      </View>

      {/* **Un lien secondaire, donc en bas.** Il vivait en haut à droite, seul
          contre le bord : un élément d'en-tête, alors qu'il ne s'adresse qu'à
          ceux dont la réponse est « ni l'une ni l'autre ». Sous les cartes et
          centré, il ne dispute plus la place à la promesse. */}
      <View style={{ alignItems: 'center' }}>
        <Button
          label={t('auth.versConnexion')}
          variant="ghost"
          fullWidth={false}
          onPress={onSeConnecter}
          testID="vers-connexion"
        />
      </View>
    </View>
  );
}
