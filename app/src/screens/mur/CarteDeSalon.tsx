/**
 * Un salon du fil : une photo, et ce qu'il contient écrit dessous.
 *
 * **La photo n'est plus dans une carte, elle *est* l'objet.** Un cadre blanc
 * bordé autour d'une image, dans un fil de photos, encadre ce qui n'a pas
 * besoin de l'être : il ajoute une seconde silhouette rectangulaire autour de
 * la première, et c'est celle du cadre qu'on voit d'abord. Rectangle arrondi de
 * 16, rien autour, le texte dessous sans fond ni filet ni ombre.
 *
 * **Et la photo passe de 96 à 210 points.** Une bande de 96 en tête d'une boîte
 * de texte est une vignette d'illustration ; c'est le texte qui domine. Le
 * squelette du mur annonçait d'ailleurs 280 × 210 depuis le début — la carte et
 * son chargement se contredisaient à chaque ouverture, et c'est le chargement
 * qui avait raison.
 *
 * **Le grain du fil change, et c'est ce que la v4 corrige.** Un salon
 * apparaissait autant de fois qu'il avait de prestations ouvertes, et la fiche
 * en révélait d'autres : « on voit trois services alors qu'il y en a beaucoup
 * plus ». Le compte était juste des deux côtés — c'est la composition qui le
 * faisait lire comme un défaut.
 *
 * **Mais revenir au salon rouvrirait l'ambiguïté que l'inversion avait
 * fermée**, et elle ne se referme pas en *annonçant* qu'on choisira à
 * l'intérieur. Une phrase de plus est précisément ce qui produisait
 * l'incompréhension. Elle se referme en **montrant** : la carte porte deux
 * prestations nommées et « and 2 more inside ». Une carte qui contient deux
 * lignes visibles ne peut pas être prise pour une seule chose — le pluriel est
 * dans le dessin, pas dans la légende.
 *
 * **Les prestations gardent leur nom en clair.** Elles ne redeviennent pas un
 * sous-titre : ce sont des lignes, avec leur palier. Le salon reprend le
 * premier rang parce qu'il est le contenant, pas parce que ce qu'on y fait
 * redevient secondaire.
 *
 * **Et chaque palier dit ce à quoi il engage.** `TierBadge` situe, il
 * n'informe pas — sa propre brique l'écrit : « c'est la phrase qui informe,
 * pas le badge, et elle accompagne toujours le badge sur une carte ». Ce mur
 * était le seul endroit du produit à la rendre fausse, donc le seul où « POST »
 * devait porter seul le délai et la nature de l'engagement. Les testeurs de la
 * fiche v3 avaient déjà buté là-dessus, en cherchant le réseau dans un badge
 * qui n'a jamais porté que le palier ; la fiche l'a corrigé, le mur non.
 *
 * **Un cœur y est revenu, et c'est un renversement assumé.** « La carte
 * contient quatre prestations, un cœur y désignerait quoi ? » disait la
 * version précédente de ce commentaire, en écartant le cœur du salon pour de
 * bon. Il ne désigne plus une prestation : il en garde plusieurs d'un geste —
 * les deux nommées et le reste, pas seulement ce que la carte montre. La
 * question qui bloquait n'a pas trouvé de réponse, elle a changé de sens :
 * ce cœur-ci n'a jamais prétendu garder *une* prestation.
 *
 * **Rempli seulement quand tout est gardé.** Un salon dont trois prestations
 * sur quatre sont en favori se lit comme « pas encore fait », pas comme
 * « à moitié fait » — il n'existe pas de cœur mi-plein dans le système, et en
 * inventer un pour ce seul endroit aurait ajouté une troisième lecture au
 * même glyphe. Appuyer dessus complète ce qui manque ; appuyer dessus quand
 * tout est déjà gardé retire tout, symétriquement.
 *
 * **`CoeurDeLaCarte` est la même brique qu'ailleurs**, exportée depuis
 * `ApercuDePrestation.tsx` plutôt que recopiée : même dessin, même rôle
 * `switch`, même annonce d'état. Seule la phrase change, parce qu'elle nomme
 * plusieurs services et non un seul.
 *
 * **Le quartier a quitté la phrase du compte.** « 4 services open to you in
 * Brickell » disait deux choses d'un trait, dont une déjà écrite deux lignes
 * plus haut, dans la ligne du salon. Le quartier situe le lieu ; le compte dit
 * ce qui est ouvert. Les mêler faisait lire le compte comme un total *du
 * quartier* — l'exact contresens qu'on cherchait à éviter.
 */
import { Pressable, View } from 'react-native';

import type { ContentFormat } from '../../api';
import {
  CoeurDeLaCarte,
  Icone,
  LigneDeContrepartie,
  MediaFallback,
  Photo,
  Texte,
  TierBadge,
  useEnfoncement,
} from '../../components';
import { formatDistance, formatNumber } from '../../format';
import { useI18n } from '../../i18n';
import { radius, useColors } from '../../theme';

/**
 * La largeur d'une carte, et la hauteur de son 4:3.
 *
 * **280 par 210, et c'est une mesure.** Les photos arrivent en 4:3 ; une bande
 * de 96 en jetait plus de la moitié. Ces deux valeurs vivaient dans un
 * composant que plus rien ne rendait, d'où le squelette les lisait — elles
 * reviennent ici, où la carte les applique enfin.
 */
export const LARGEUR_DE_LA_CARTE = 280;
export const PHOTO_DE_LA_CARTE = 210;

/**
 * Combien de prestations la carte nomme avant de compter le reste.
 *
 * **Deux, et le nombre porte tout le raisonnement.** Une seule ligne se lirait
 * comme le sujet de la carte — l'ambiguïté qu'on vient de fermer. Trois
 * remplirait l'écran d'un seul salon et rendrait le fil impraticable. Deux est
 * le plus petit nombre qui rende le pluriel visible.
 */
export const PRESTATIONS_NOMMEES = 2;

export type PrestationDeLaCarte = {
  catalogItemId: string;
  nom: string;
  /** Le palier par lequel elle est ouverte. `null` quand aucun ne le nomme. */
  contrepartie: ContentFormat | null;
  /** Servie par le fil, jamais recalculée : c'est la même vérité que la fiche. */
  estFavori: boolean;
};

/**
 * Ce que le cœur du salon a besoin de savoir faire, et rien de plus.
 *
 * **La même forme que `favoris` sur `CoeurDeLOffre`**, dans `FicheScreen.tsx` —
 * c'est directement le retour de `useFavorisEnVol`, sans adaptateur : deux
 * cœurs qui liraient la bascule différemment finiraient par la lire faux l'un
 * des deux.
 */
export type FavorisDeLaCarte = {
  estFavori: (catalogItemId: string, servi: boolean) => boolean;
  basculer: (catalogItemId: string, versFavori: boolean, servi: boolean, nom: string) => void;
};

export function CarteDeSalon({
  nom,
  quartierNomme,
  distanceMetres,
  photo,
  ouvertes,
  prestations,
  favoris,
  onPress,
  testID,
}: {
  nom: string;
  /**
   * Le quartier **déjà traduit**, ou `null` pour un salon non situé.
   *
   * Traduit par l'appelant et non ici : la garde des clés de traduction ne
   * résout pas une clé composée, et le mur en construit déjà une pour son
   * en-tête. En ajouter une seconde pour la même valeur aurait élargi ce que la
   * garde ne peut pas voir, sans rien gagner.
   */
  quartierNomme: string | null;
  distanceMetres: number;
  photo: string | null;
  /**
   * Combien de prestations lui sont ouvertes, **servi et non compté ici**.
   *
   * La carte n'en nomme que deux ; le nombre porte sur l'ensemble. Et il vient
   * du serveur, qui le calcule par la même fonction que l'en-tête du quartier —
   * c'est ce qui fait que la somme des cartes égale ce que le quartier annonce.
   */
  ouvertes: number;
  /** Les prestations à nommer, **dédoublonnées et dans l'ordre du serveur**. */
  prestations: readonly PrestationDeLaCarte[];
  favoris: FavorisDeLaCarte;
  onPress: () => void;
  testID?: string;
}) {
  const { t, locale } = useI18n();
  const c = useColors();
  const enfoncement = useEnfoncement(true);

  const situation = [quartierNomme, formatDistance(distanceMetres, locale)]
    .filter(Boolean)
    .join(' · ');
  const compte = formatNumber(ouvertes, locale);
  const ouverts =
    ouvertes === 1
      ? t('parcours.carteServiceOuvertUn')
      : t('parcours.carteServicesOuverts', { count: compte });
  const restants = ouvertes - PRESTATIONS_NOMMEES;

  /**
   * **Toutes, ou pas encore toutes.** Un salon sans prestation chargée ne
   * peut pas être « déjà gardé » — `every` sur un tableau vide rendrait vrai,
   * et un cœur plein sur une carte sans ligne mentirait sur ce qu'il promet.
   */
  const tousGardes =
    prestations.length > 0 &&
    prestations.every((prestation) => favoris.estFavori(prestation.catalogItemId, prestation.estFavori));

  /**
   * **Un geste, jusqu'à `prestations.length` appels — jamais plus qu'il ne
   * faut.** Rebasculer une prestation déjà dans l'état visé la reposterait
   * pour rien : `estFavori` dit où elle en est déjà, en tenant compte d'un
   * appui encore en vol.
   */
  function basculerToutes() {
    const cible = !tousGardes;
    for (const prestation of prestations) {
      if (favoris.estFavori(prestation.catalogItemId, prestation.estFavori) !== cible) {
        favoris.basculer(prestation.catalogItemId, cible, prestation.estFavori, prestation.nom);
      }
    }
  }

  // **Le singulier existe, comme pour le compte de la carte.** Un salon
  // n'ouvrant qu'une prestation garderait « 1 services » sans lui — la même
  // faute que `carteServiceOuvertUn` corrige déjà pour le compte.
  const libelleDuCoeur = t(
    prestations.length === 1
      ? tousGardes
        ? 'parcours.carteCoeurRetirerUn'
        : 'parcours.carteCoeurGarderUn'
      : tousGardes
        ? 'parcours.carteCoeurRetirer'
        : 'parcours.carteCoeurGarder',
    { nom, count: formatNumber(prestations.length, locale) },
  );

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      // Le nom du bouton porte ce que la carte annonce : un lecteur d'écran
      // qui n'entendrait que le salon ne saurait pas qu'il en contient quatre.
      accessibilityLabel={`${nom} — ${situation} — ${ouverts}`}
      onPress={onPress}
      onPressIn={enfoncement.onPressIn}
      onPressOut={enfoncement.onPressOut}
      style={{ width: LARGEUR_DE_LA_CARTE, gap: 10 }}
    >
      {/* L'arrondi de la photo, celui de toute image du système — et non celui
          de la carte, puisqu'il n'y a plus de carte. La hauteur est connue
          avant l'image : ce qui arrive fond, il ne pousse rien. */}
      <View
        style={{
          borderRadius: radius['radius.photo'],
          overflow: 'hidden',
          backgroundColor: c['media.placeholder'],
        }}
      >
        <Photo
          uri={photo}
          hauteur={PHOTO_DE_LA_CARTE}
          testID={testID ? `${testID}-photo` : undefined}
          replit={<MediaFallback monogramme={nom} height={PHOTO_DE_LA_CARTE} />}
        />
        {/* **Un cœur, pas quatre.** Il garde toutes les prestations du salon
            d'un geste — les deux nommées ci-dessous et le reste qu'on ne voit
            pas — plutôt qu'un cœur par ligne, qui redemanderait d'ouvrir la
            fiche pour finir ce que la carte prétend déjà faire. */}
        <CoeurDeLaCarte
          actif={tousGardes}
          onPress={basculerToutes}
          label={libelleDuCoeur}
          testID={testID ? `${testID}-coeur` : undefined}
        />
      </View>

      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <Texte variante="type.titreDApercu" ellipseSurNomPropre testID={testID ? `${testID}-nom` : undefined}>
            {nom}
          </Texte>
          <Texte
            variante="type.caption"
            couleur="ink.soft"
            testID={testID ? `${testID}-situation` : undefined}
          >
            {situation}
          </Texte>
        </View>
        <Icone nom="chevron" couleur="ink.soft" taille={20} />
      </View>

      <Texte variante="type.label" couleur="brand.700" testID={testID ? `${testID}-compte` : undefined}>
        {ouverts.toUpperCase()}
      </Texte>

      <View style={{ gap: 7 }}>
        {prestations.slice(0, PRESTATIONS_NOMMEES).map((prestation) => (
          <View
            key={prestation.catalogItemId}
            testID={testID ? `${testID}-ligne-${prestation.catalogItemId}` : undefined}
            style={{ gap: 2 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              {/* `ellipseSurNomPropre` : un nom de prestation est un nom
                  propre de catalogue, et il se tronque plutôt que de pousser le
                  badge hors de la carte. */}
              <Texte variante="type.body" ellipseSurNomPropre style={{ flex: 1, minWidth: 0 }}>
                {prestation.nom}
              </Texte>
              {prestation.contrepartie === null ? null : (
                <TierBadge tier={prestation.contrepartie} size="sm" />
              )}
            </View>

            {/* **Le badge situe, la phrase informe** — et c'est la brique
                elle-même qui le dit : « elle accompagne toujours le badge sur
                une carte ». Ce mur était le seul endroit du produit à rendre
                `TierBadge` sans elle, donc le seul où « POST » devait porter
                seul ce qu'il ne porte pas : sous quel délai, et qu'il s'agit
                d'un engagement à tenir.

                **La forme courte, sans `plateforme`.** L'autre nomme le réseau
                et met le palier en gras — c'est celle de la fiche, qui a la
                place. Ici la ligne est déjà serrée entre un nom ellipsé et un
                badge ; la forme courte existe pour exactement ce cas, et elle
                passe sous la ligne plutôt qu'à côté, où elle écraserait le nom
                qu'on est venu lire. */}
            {prestation.contrepartie === null ? null : (
              <LigneDeContrepartie
                tier={prestation.contrepartie}
                testID={
                  testID ? `${testID}-contrepartie-${prestation.catalogItemId}` : undefined
                }
              />
            )}
          </View>
        ))}
        {/* **« and 2 more inside », jamais « and 0 ».** Le reste ne s'écrit que
            s'il existe : une carte à deux prestations est déjà entièrement
            montrée, et annoncer un reste vide ferait chercher ce qui n'est pas
            caché. */}
        {restants > 0 ? (
          <Texte
            variante="type.caption"
            couleur="ink.soft"
            testID={testID ? `${testID}-reste` : undefined}
          >
            {t('parcours.carteEtEncore', { count: formatNumber(restants, locale) })}
          </Texte>
        ) : null}
      </View>
    </Pressable>
  );
}
