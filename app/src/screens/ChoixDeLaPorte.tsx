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

import { Button, Icone, Marque, Texte } from '../components';
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
      teinte: 'role.creator',
      etiquette: t('auth.roleCreator'),
      promesse: t('auth.porteCreateur'),
      points: [t('auth.porteCreateurA'), t('auth.porteCreateurB'), t('auth.porteCreateurC')],
      action: t('auth.porteCreateurAction'),
      testID: 'porte-createur',
    },
    {
      role: 'business_member',
      teinte: 'role.merchant',
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
      <Marque taille={30} couleur={surMedia ? 'text.onScrim' : 'accent.default'} />

      <View style={{ gap: spacing['space.2'], maxWidth: 720 }}>
        {/* Nommée : c'est sur elle que la suite de bout en bout lit la police
            réellement employée. Sans point d'accroche, la seule façon de
            vérifier qu'un texte emploie la fonte serait de deviner un
            sélecteur, qui casserait au premier changement de structure. */}
        <Texte
          variante="type.display"
          couleur={surMedia ? 'text.onScrim' : 'text.primary'}
          testID="promesse-accueil"
        >
          {t('auth.accroche')}
        </Texte>
        <Texte couleur={surMedia ? 'text.onScrimMuted' : 'text.secondary'}>
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
              borderRadius: radius['radius.xl'],
              borderWidth: 1,
              borderColor: c['border.subtle'],
              backgroundColor: c['bg.surface'],
            }}
          >
            <Texte variante="type.label" style={{ color: c[porte.teinte] }}>
              {porte.etiquette.toUpperCase()}
            </Texte>
            <Texte variante="type.title">{porte.promesse}</Texte>

            <View style={{ gap: spacing['space.3'], flex: 1 }}>
              {porte.points.map((point) => (
                <View key={point} style={{ flexDirection: 'row', gap: spacing['space.2'] }}>
                  <Icone nom="coche" couleur="text.muted" taille={18} />
                  <Texte couleur="text.secondary" style={{ flex: 1 }}>
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
