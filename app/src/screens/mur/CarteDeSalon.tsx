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
 * **Aucun cœur ici.** La carte contient quatre prestations : un cœur y
 * désignerait quoi ? Le favori porte sur la prestation, donc il vit sur la
 * fiche, ligne par ligne. Le seul cœur du fil est la porte de la barre de
 * recherche, et c'est elle qui porte le compte.
 *
 * **Le quartier a quitté la phrase du compte.** « 4 services open to you in
 * Brickell » disait deux choses d'un trait, dont une déjà écrite deux lignes
 * plus haut, dans la ligne du salon. Le quartier situe le lieu ; le compte dit
 * ce qui est ouvert. Les mêler faisait lire le compte comme un total *du
 * quartier* — l'exact contresens qu'on cherchait à éviter.
 */
import { Pressable, View } from 'react-native';

import type { ContentFormat } from '../../api';
import { Icone, MediaFallback, Photo, Texte, TierBadge, useEnfoncement } from '../../components';
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
};

export function CarteDeSalon({
  nom,
  quartierNomme,
  distanceMetres,
  photo,
  ouvertes,
  prestations,
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
            style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}
          >
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
