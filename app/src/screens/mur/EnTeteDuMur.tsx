/**
 * L'en-tête du fil : le marché, ce qu'on regarde, et par quoi le trancher.
 *
 * **Les catégories ont quitté cet en-tête.** Elles étaient du texte souligné
 * sur deux lignes, ici, et elles défilaient avec le contenu. La v3.1 les met en
 * une ligne de pilules qui reste collée — c'est `BarreDuMur` qui les porte, et
 * ce qui reste ici ne bouge plus : le marché, et ce qu'on regarde.
 *
 * La catégorie en vigueur reste connue de cet en-tête, parce qu'elle **nomme le
 * titre** : « Discover » sans filtre, le nom de la catégorie sinon. C'est une
 * lecture, pas une commande.
 *
 * **Aucun défilement horizontal.** Les six catégories tiennent sur deux lignes
 * en `flexWrap`. Une rangée qui défile cache ses dernières options derrière un
 * geste que rien n'annonce ; ici tout est visible d'un coup, et c'est la
 * condition pour qu'un filtre soit un choix plutôt qu'une découverte.
 *
 * **« All » est détaché par un filet vertical.** Ce n'est pas une catégorie de
 * plus : c'est l'issue, le geste qui retire le filtre. Le poser dans la même
 * suite que les six aurait demandé de le reconnaître au libellé.
 *
 * **Le marché se nomme, le quartier non.** « MIAMI » est le marché où BIND
 * ouvre — une donnée du produit, pas une position résolue. La v2.1 refusait de
 * nommer un lieu et elle avait raison : le quartier **où l'on est** n'est
 * connu de personne, il n'y a pas de géocodage inverse, et l'annoncer aurait
 * été plausible et invérifiable. Nommer la ville que le produit dessert entière
 * ne pose pas cette question.
 *
 * **Aucun bouton de recherche.** La planche en dessine un, rond, en tête à
 * droite. Rien ne le sert : il n'y a pas d'écran de recherche dans le produit,
 * et la passation §7 le tranche — « le bouton impossible est retiré, jamais
 * grisé ». Il reviendra avec l'écran qu'il ouvre.
 */
import { View } from 'react-native';

import type { BusinessCategory, Fil } from '../../api';
import { Texte } from '../../components';
import { formatNumber } from '../../format';
import { useI18n } from '../../i18n';
import { useColors } from '../../theme';

/** L'épaisseur du soulignement, et sa distance au mot. */
const SOULIGNEMENT = 2;
const SOUS_LE_MOT = 4;

export function EnTeteDuMur({
  fil,
  categorie,
}: {
  /** Nul tant que le fil n'a pas répondu : l'en-tête se rend quand même. */
  fil: Fil | null;
  /** La catégorie en vigueur. `null` : toutes. Elle nomme le titre. */
  categorie: BusinessCategory | null;
}) {
  const { t, locale } = useI18n();
  const c = useColors();

  return (
    <View testID="entete-du-mur">
      <View style={{ paddingBottom: 16, gap: 2 }}>
        {/* **Le compte n'apparaît qu'une fois filtré.** Sans filtre, « MIAMI »
            suffit : le nombre total de prestations de la ville ne se compare à
            rien et ne se retient pas. Filtré, il dit ce que le filtre ouvre,
            et c'est la seule question qu'on se pose à ce moment-là. */}
        <Texte variante="type.dataLabel" couleur="ink.soft" testID="entete-marche">
          {(fil === null || categorie === null
            ? t('parcours.filMarche')
            : t('parcours.filMarcheEtCompte', {
                marche: t('parcours.filMarche'),
                count: formatNumber(fil.total_prestations, locale),
              })
          ).toUpperCase()}
        </Texte>
        <Texte variante="type.screenTitle" testID="entete-titre">
          {categorie === null
            ? t('parcours.filDecouvrir')
            : t(`categories.${categorie}`)}
        </Texte>
      </View>

    </View>
  );
}

/**
 * Un mot de la bande, et son soulignement quand il est actif.
 *
 * **Le soulignement est une bordure du mot, pas une barre posée dessous.**
 * C'est ce qui le fait suivre la largeur du mot et rester à quatre points de
 * lui, y compris sur la seconde ligne du `flexWrap`. Une barre absolue aurait
 * demandé de mesurer le texte, et se serait décalée à la première traduction
 * plus longue.
 */
function MotDeNavigation({
  label,
  actif,
  onPress,
  testID,
}: {
  label: string;
  actif: boolean;
  onPress: () => void;
  testID: string;
}) {
  const c = useColors();

  return (
    <View
      testID={testID}
      // Le soulignement vit sur la vue et non sur le texte : `borderBottomWidth`
      // sur un `Text` est ignoré sur Android, où il faut `textDecorationLine` —
      // qui, lui, colle au texte et ne se règle ni en épaisseur ni en distance.
      style={{
        borderBottomWidth: actif ? SOULIGNEMENT : 0,
        borderBottomColor: c['ink.default'],
        paddingBottom: actif ? SOUS_LE_MOT : SOUS_LE_MOT + SOULIGNEMENT,
      }}
    >
      <Texte
        variante={actif ? 'type.navigationActive' : 'type.navigation'}
        couleur={actif ? 'ink.default' : 'ink.soft'}
        onPress={onPress}
        testID={`${testID}-mot`}
      >
        {label}
      </Texte>
    </View>
  );
}
