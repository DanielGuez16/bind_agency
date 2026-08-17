/**
 * L'en-tête du mur : ce que le rayon ouvre, et par quoi le trancher.
 *
 * Le rayon avec son compte, la marque, puis les catégories avec les leurs. Ce
 * qui existait ici — « Near you », un bonjour et des chips de rayon —
 * répondait à une autre question : le titre nommait l'écran, et le seul réglage
 * offert était de chercher plus loin.
 *
 * **La navigation n'attend pas la donnée.** Le rayon est un état local, la
 * chip « All » ne dépend de rien : les deux sont là avant le premier appel, et
 * le compte comme les catégories viennent s'y poser. C'est la règle écrite sur
 * le cadre A de la planche, et elle vaut mieux qu'un en-tête qui apparaît d'un
 * coup — un écran qui se compose sous les yeux a déjà coûté un diagnostic sur
 * l'accueil.
 *
 * **Aucun lieu n'est nommé ici, et c'est tranché.** La planche veut le quartier
 * **où l'on est** — son cadre du vide affiche « Key Biscayne » alors qu'aucun
 * salon n'y répond, donc le nom ne vient pas du fil. Rien ne sait le résoudre :
 * il n'y a pas de géocodage inverse, et la ville du profil est un champ libre
 * qui dit où l'on habite. Le quartier du salon le plus proche avait été rendu à
 * sa place ; il tombe. **Annoncer un lieu qu'on ne peut pas vérifier est la
 * classe de défaut que ce dépôt passe ses journées à corriger** — plausible,
 * invérifiable de l'autre côté, et donc jamais relevé. L'en-tête porte le
 * rayon, le compte et les catégories, et rien qui situe.
 *
 * **Les chips ne sont pas la liste des catégories du produit, mais celles qui
 * mènent quelque part.** `Fil.categories` ignore le filtre en vigueur : la
 * rangée ne bouge donc pas quand on filtre, et une catégorie qui n'a rien de
 * réservable ici n'y figure pas. Proposer « Museum · 0 » serait un cul-de-sac
 * chiffré, la même faute que l'élargissement qui n'ouvre rien.
 *
 * **Et sous deux catégories, la rangée disparaît.** Une chip seule à côté
 * d'« All » est un interrupteur qui ne commande rien : les deux états montrent
 * le même mur. Le produit a déjà retiré un réglage pour cette raison exacte.
 */
import { View } from 'react-native';

import type { BusinessCategory, Fil } from '../../api';
import { Chip, Marque, RangeeDeChips, Texte } from '../../components';
import { formatNumber } from '../../format';
import { useI18n } from '../../i18n';

/**
 * La hauteur de la marque dans l'en-tête.
 *
 * Dix-sept points, comme la planche, et bien au-dessus du plancher de
 * `Marque` : on a ici la place de lire les quatre lettres, donc c'est le
 * logotype et non la marque compacte.
 */
const MARQUE = 17;

export function EnTeteDuMur({
  fil,
  rayonKm,
  categorie,
  onCategorie,
}: {
  /** Nul tant que le fil n'a pas répondu : l'en-tête se rend quand même. */
  fil: Fil | null;
  rayonKm: number;
  /** La catégorie en vigueur. `null` : toutes. */
  categorie: BusinessCategory | null;
  onCategorie: (categorie: BusinessCategory | null) => void;
}) {
  const { t, locale } = useI18n();

  // `fil === null` et non `fil?.` : le serveur rend toujours `categories`, et
  // un repli sur l'absence du champ masquerait un montage de test qui fabrique
  // une réponse que le serveur ne produit pas — ce qui s'est déjà produit cinq
  // fois sur ce même écran.
  const categories = fil === null ? [] : fil.categories;

  return (
    <View style={{ gap: 12 }} testID="entete-du-mur">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {/* Le rayon est connu avant l'appel, son compte après. Deux clés
            plutôt qu'une concaténation : « 15 km · 20 » et « 15 km » ne sont
            pas la même phrase, et l'espagnol ne les ponctue pas forcément
            comme l'anglais. */}
        <Texte variante="type.monoSmall" couleur="ink.soft" testID="entete-rayon">
          {(fil === null
            ? t('parcours.filRayon', { rayon: formatNumber(rayonKm, locale) })
            : t('parcours.murRayonEtCompte', {
                rayon: formatNumber(rayonKm, locale),
                count: formatNumber(fil.commerces.length, locale),
              })
          ).toUpperCase()}
        </Texte>

        <View style={{ flex: 1 }} />
        <Marque taille={MARQUE} testID="entete-marque" />
      </View>

      {/* Sous deux catégories il n'y a pas de choix à offrir : « All » et
          l'unique chip rendent le même mur. La rangée entière tombe, y compris
          « All », qui ne se retire pas de quoi que ce soit. */}
      {categories.length < 2 ? null : (
        <View testID="entete-categories">
          <RangeeDeChips>
            <Chip
              label={t('parcours.murToutesLesCategories')}
              selected={categorie === null}
              onPress={() => onCategorie(null)}
              testID="categorie-toutes"
            />
            {categories.map((compte) => (
              <Chip
                key={compte.categorie}
                label={t(`categories.${compte.categorie}`)}
                compte={compte.commerces}
                selected={categorie === compte.categorie}
                // Réappuyer sur la catégorie en vigueur la retire : c'est le
                // « Clear » du cadre 03b, posé sur la chip elle-même plutôt
                // qu'à côté — le geste qui a filtré est celui qu'on refait
                // pour défiltrer, et il n'y a rien à chercher.
                onPress={() =>
                  onCategorie(categorie === compte.categorie ? null : compte.categorie)
                }
                testID={`categorie-${compte.categorie}`}
              />
            ))}
          </RangeeDeChips>
        </View>
      )}
    </View>
  );
}
