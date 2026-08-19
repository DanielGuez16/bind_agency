/**
 * L'en-tête du fil : le marché, ce qu'on regarde, et par quoi le trancher.
 *
 * **Les catégories sont du texte souligné, sans pastille.** C'est la navigation
 * des sites de vêtements, et la revue la demandait : une rangée de pastilles
 * pèse autant que le contenu qu'elle filtre. Le soulignement est **serré sous
 * le mot** et non ancré au bas de la bande — sur deux lignes, un soulignement
 * de bande flotterait à trente points du mot qu'il désigne.
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
  onCategorie,
}: {
  /** Nul tant que le fil n'a pas répondu : l'en-tête se rend quand même. */
  fil: Fil | null;
  /** La catégorie en vigueur. `null` : toutes. */
  categorie: BusinessCategory | null;
  onCategorie: (categorie: BusinessCategory | null) => void;
}) {
  const { t, locale } = useI18n();
  const c = useColors();

  // `fil === null` et non `fil?.` : le serveur rend toujours `categories`, et
  // un repli sur l'absence du champ masquerait un montage de test qui fabrique
  // une réponse que le serveur ne produit pas — ce qui s'est déjà produit cinq
  // fois sur ce même écran.
  const categories = fil === null ? [] : fil.categories;

  return (
    <View testID="entete-du-mur">
      <View style={{ paddingBottom: 16, gap: 2 }}>
        {/* **Le compte n'apparaît qu'une fois filtré.** Sans filtre, « MIAMI »
            suffit : le nombre total de prestations de la ville ne se compare à
            rien et ne se retient pas. Filtré, il dit ce que le filtre ouvre,
            et c'est la seule question qu'on se pose à ce moment-là. */}
        <Texte variante="type.monoSmall" couleur="ink.soft" testID="entete-marche">
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

      {/* Sous deux catégories il n'y a pas de choix à offrir : « All » et
          l'unique entrée rendent le même mur. La bande entière tombe, y compris
          « All », qui ne se retire alors de quoi que ce soit. */}
      {categories.length < 2 ? null : (
        <View
          testID="entete-categories"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingBottom: 6,
            borderBottomWidth: 1,
            borderBottomColor: c['line.default'],
          }}
        >
          <MotDeNavigation
            label={t('parcours.murToutesLesCategories')}
            actif={categorie === null}
            onPress={() => onCategorie(null)}
            testID="categorie-toutes"
          />
          {/* Le filet qui détache l'issue des six catégories. Il ne descend pas
              jusqu'au filet du bas : c'est un séparateur entre deux mots, pas
              une colonne. */}
          <View
            testID="filet-de-l-issue"
            style={{ width: 1, height: 14, backgroundColor: c['line.strong'] }}
          />
          <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
            {categories.map((compte) => (
              <View key={compte.categorie} style={{ marginRight: 10 }}>
                <MotDeNavigation
                  label={t(`categories.${compte.categorie}`)}
                  actif={categorie === compte.categorie}
                  // Réappuyer sur la catégorie en vigueur la retire : le geste
                  // qui a filtré est celui qu'on refait pour défiltrer, et il
                  // n'y a rien à chercher ailleurs.
                  onPress={() =>
                    onCategorie(categorie === compte.categorie ? null : compte.categorie)
                  }
                  testID={`categorie-${compte.categorie}`}
                />
              </View>
            ))}
          </View>
        </View>
      )}
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
