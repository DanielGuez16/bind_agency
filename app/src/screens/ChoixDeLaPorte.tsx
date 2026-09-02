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
 * **Une porte se nomme, elle ne se plaide pas.** Ce qu'on ouvre, ce
 * qu'on donne, ce qu'on ne donne pas. « Aucune commission, aucun abonnement »
 * en dit plus long à un salon que n'importe quelle promesse d'audience.
 *
 * Sur grand écran les deux cartes de 440 sont côte à côte, parce que le choix
 * se fait en les comparant. En compact elles s'empilent, dans le même ordre.
 */
import { View } from 'react-native';

import type { ReactNode } from 'react';

import { BandeDeTexteSurPhoto, Button, Icone, Marque, Texte, TitreAccentue } from '../components';
import { useI18n } from '../i18n';
import { useGabarit } from '../shell/gabarit';
import { breakpoint, type ColorName, elevationDeCarte, radius, spacing, useColors } from '../theme';
import type { RoleInscriptible } from '../session';

/** La largeur d'une porte. La passation la fixe, et elle ne s'étire pas. */
/**
 * La hauteur de la marque sur l'accueil.
 *
 * Trente points, comme la planche : c'est le premier écran, elle a la place, et
 * bien au-dessus du plancher du logotype — on y lit les quatre lettres, donc
 * c'est le mot et non la marque compacte.
 */
const MARQUE = 30;

type Porte = {
  role: RoleInscriptible;
  teinte: ColorName;
  etiquette: string;
  promesse: string;
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
      action: t('auth.porteCreateurAction'),
      testID: 'porte-createur',
    },
    {
      role: 'business_member',
      teinte: 'ink.mute',
      etiquette: t('auth.roleMerchant'),
      promesse: t('auth.porteCommerce'),
      action: t('auth.porteCommerceAction'),
      testID: 'porte-commerce',
    },
  ];

  return (
    <View
      testID="choix-de-la-porte"
      style={{
        flex: 1,
        gap: spacing['space.4'],
        width: '100%',
        maxWidth: large ? breakpoint.contentMaxCreator : undefined,
        alignSelf: 'center',
      }}
    >
      {/* **La marque ouvre l'écran, centrée.** Elle portait une bande de
          lisibilité tant qu'un média passait dessous ; il n'y en a plus, donc
          plus rien à protéger — le fond est celui de la page, et les encres
          sont calibrées pour lui. */}
      <View style={{ alignItems: 'center', paddingTop: spacing['space.4'] }}>
        <Marque taille={MARQUE} testID="logotype" />
      </View>

      {/* **Le titre reste, la sous-ligne part.** Ce qu'elle disait — l'échange,
          l'absence d'argent — est déjà dit par les puces des deux portes,
          mieux et deux fois. Un premier écran qui dit deux fois la même chose
          la dit une fois de trop. */}
      <TitreAccentue
        texte={t('auth.accroche')}
        motAccentue={t('auth.accrocheAccent')}
        taille="heading"
        bloc
        testID="promesse-accueil"
      />

      {/* **Côte à côte, même en mobile, et c'est la contrainte qui dessine
          tout.** Sur 390 × 844, barre d'état et marge basse retirées, il reste
          728 points : deux cartes empilées n'y tiennent pas, deux cartes à
          côté oui. C'est ce qui supprime le défilement d'un écran dont le seul
          travail est de faire choisir un rôle. */}
      <View style={{ flexDirection: 'row', gap: spacing['space.3'] }}>
        {portes.map((porte) => (
          <View
            key={porte.role}
            testID={porte.testID}
            style={{
              flex: 1,
              minWidth: 0,
              gap: spacing['space.4'],
              paddingVertical: spacing['space.5'],
              paddingHorizontal: spacing['space.4'],
              borderRadius: radius['radius.lg'],
              backgroundColor: c['bg.surface'],
              // « Un coin de 18 px sans ombre flotte au lieu de se poser » :
              // passation §2. Le filet part avec la mise côte à côte : deux
              // cartes voisines à filet donnent une couture au milieu de
              // l'écran, là où l'ombre les sépare sans la dessiner.
              ...elevationDeCarte(),
            }}
          >
            {/* **L'intitulé tient sur deux lignes, et c'est ce qui l'autorise à
                être gros.** Deux colonnes de 171 points ne portent pas
                « CREATOR ACCOUNT » sur une ligne au-delà de 13 points, ce qui
                n'est pas « en gros ». Empilé, chaque mot tient à 22 en graisse
                800. Le second mot porte le rôle, et c'est le seul endroit de
                l'écran où l'orange s'écrit. */}
            <View>
              <Texte variante="type.porte" testID={`${porte.testID}-role`}>
                {porte.role === 'creator'
                  ? t('auth.porteRoleCreateur').toUpperCase()
                  : t('auth.porteRoleCommerce').toUpperCase()}
              </Texte>
              <Texte variante="type.porte" couleur="brand.700">
                {t('auth.porteCompte').toUpperCase()}
              </Texte>
            </View>

            {/* **Une ligne, et c'est ce que la carte disait déjà.** Chaque
                porte portait, sous son intitulé, **trois phrases** de douze à
                quinze mots : une cinquantaine de mots par carte, sur l'écran qui
                a deux secondes pour dire ce qu'est BIND. Elles sont parties.

                **Et la promesse d'une ligne n'était rendue nulle part.** Le
                champ existait dans l'objet depuis toujours, personne ne
                l'affichait — la carte montrait l'intitulé, les trois phrases,
                le bouton. En retirant les phrases sans rendre la promesse, il
                ne restait qu'un titre et un bouton séparés par un vide de
                quatre cents points : « on ne voit rien » était devenu vrai
                autrement.

                C'est elle qui dit ce qu'on fait ici. Le reste appartient aux
                écrans d'inscription, où quelqu'un a décidé de lire. */}
            <Texte
              variante="type.body"
              couleur="ink.soft"
              testID={`${porte.testID}-promesse`}
            >
              {porte.promesse}
            </Texte>

            {/* **Un seul aplat orange pour deux portes de poids égal.** Le rôle
                créateur est celui qu'on attend en masse ; la porte commerce a
                le même intitulé, la même taille et un contour d'encre. C'est un
                ordre de fréquence, pas de valeur. */}
            <Button
              label={porte.action}
              variant={porte.role === 'creator' ? 'primary' : 'secondary'}
              onPress={() => onChoisir(porte.role)}
              testID={`choisir-${porte.role}`}
            />
          </View>
        ))}
      </View>

      {/* **Un lien secondaire, donc en bas.** Il ne s'adresse qu'à ceux dont la
          réponse est « ni l'une ni l'autre ». Sa bande de lisibilité part avec
          le média : il se pose maintenant sur la page, où `brand.700` est
          l'encre calibrée. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing['space.2'],
          paddingVertical: spacing['space.3'],
        }}
      >
        {/* **Une seule fois « already ».** La ligne portait « Already with
            us? » suivi de « Already have an account? Sign in » : deux fois la
            même question, dont une sans réponse. Le lien porte la question et
            le geste, ce qui suffit. */}
        <Texte
          variante="type.bodyStrong"
          couleur="brand.700"
          onPress={onSeConnecter}
          testID="vers-connexion"
        >
          {t('auth.versConnexion')}
        </Texte>
      </View>
    </View>
  );
}

/**
 * **L'enveloppe est partie avec le média.** Elle posait une bande de lisibilité
 * sous le titre et sous le lien de connexion, garantie à 12,10:1 quoi qu'il y
 * ait derrière. Il n'y a plus rien derrière : le fond est celui de la page, et
 * une bande sur une surface du thème n'est plus une protection, c'est un
 * rectangle gris au milieu d'un écran clair.
 */
