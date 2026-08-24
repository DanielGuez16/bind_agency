/**
 * Une carte par salon, et elle montre ce qu'elle contient.
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
 * **Le quartier est nommé dans la phrase du compte.** « 4 services open to
 * you » seul se lit comme un total, et c'est la phrase qu'on lit — le nom du
 * quartier posé au-dessus ne suffit pas. Sans quartier déclaré, la phrase
 * tombe sur sa variante courte : la section « Ailleurs à Miami » porte alors
 * la portée.
 */
import { Pressable, View } from 'react-native';

import type { ContentFormat } from '../../api';
import { Icone, MediaFallback, Photo, Texte, TierBadge, useEnfoncement } from '../../components';
import { formatDistance, formatNumber } from '../../format';
import { useI18n } from '../../i18n';
import { radius, useColors } from '../../theme';

/** La hauteur de la couverture. La planche l'écrit, et elle ne se calcule pas. */
export const COUVERTURE_DE_LA_CARTE = 96;

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
    quartierNomme === null
      ? t('parcours.carteServicesOuverts', { count: compte })
      : t('parcours.carteServicesOuvertsAu', { count: compte, quartier: quartierNomme });
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
      style={{
        borderRadius: radius['radius.lg'],
        backgroundColor: c['bg.surface'],
        borderWidth: 1,
        borderColor: c['line.default'],
        overflow: 'hidden',
      }}
    >
      {/* La hauteur est connue avant l'image : ce qui arrive fond, il ne
          pousse rien. */}
      <Photo
        uri={photo}
        hauteur={COUVERTURE_DE_LA_CARTE}
        testID={testID ? `${testID}-photo` : undefined}
        replit={<MediaFallback monogramme={nom} height={COUVERTURE_DE_LA_CARTE} />}
      />

      <View style={{ paddingHorizontal: 16, paddingTop: 13, flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <Texte variante="type.titreDApercu" ellipseSurNomPropre testID={testID ? `${testID}-nom` : undefined}>
            {nom}
          </Texte>
          <Texte variante="type.caption" couleur="ink.soft">
            {situation}
          </Texte>
        </View>
        <Icone nom="chevron" couleur="ink.soft" taille={20} />
      </View>

      <View style={{ paddingHorizontal: 16, paddingTop: 11, paddingBottom: 6 }}>
        <Texte variante="type.label" couleur="brand.700" testID={testID ? `${testID}-compte` : undefined}>
          {ouverts.toUpperCase()}
        </Texte>
      </View>

      <View style={{ paddingHorizontal: 16, paddingBottom: 14, gap: 7 }}>
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
