/**
 * Le mur : un quartier ouvert, les autres en carrés au pied.
 *
 * **Le quartier n'est pas une troisième bande de navigation.** Empiler
 * catégories, quartiers et filtres au-dessus du contenu aurait reproduit
 * exactement le défaut que la revue signale — la navigation prenant toute la
 * place avant qu'on ait vu une prestation. Le quartier structure donc le mur
 * lui-même : la section la plus proche est ouverte et porte ses prestations,
 * les autres sont des carrés en pied de mur qu'on appuie pour dérouler. Toute
 * la ville tient dans un écran.
 *
 * **La distance ordonne sans jamais s'écrire.** Le serveur rend les quartiers
 * du plus proche au plus lointain, distance du salon le plus proche à l'appui.
 * C'est ce champ qui décide de l'ordre des sections et du quartier ouvert par
 * défaut ; aucun nombre de mètres n'apparaît. Le tri par distance survit donc à
 * la disparition de son affichage — et il est désormais servi plutôt que
 * dérivé carte par carte.
 *
 * **L'unité rendue est la prestation, pas le salon.** Un salon qui ouvre trois
 * prestations occupe trois aperçus, et c'est la conséquence directe de
 * l'inversion de hiérarchie : le fil montre ce qui se réserve. La grille se
 * lit donc « quatre à cinq prestations d'un coup » là où le mur en montrait
 * une.
 *
 * **Deux par ligne, et pas trois.** À trois, la colonne tombe à 111 points :
 * « Brow lamination » passe sur trois lignes et la prestation redevient
 * illisible. On aurait densifié l'écran en cassant la correction qu'il porte.
 */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  useApi,
  type BusinessCategory,
  type CommerceDuFil,
  type Fil,
  type Neighborhood,
} from '../../api';
import { CASE_DU_BADGE, IMAGE_DE_L_APERCU, Texte } from '../../components';
import { CarteDeSalon, type PrestationDeLaCarte } from './CarteDeSalon';
import { Photo } from '../../components';
import { useEnfoncement } from '../../components/Mouvement';
import { formatNumber } from '../../format';
import { useI18n } from '../../i18n';
import { radius, useColors } from '../../theme';

/** La marge latérale du mur, la seule de l'écran. */
export const MARGE_DU_MUR = 18;

/** L'écart entre deux colonnes, et entre deux rangées. */
const GOUTTIERE = 12;
const INTERLIGNE = 16;

/** La vignette du quartier ouvert, et celle d'un carré. */
const VIGNETTE_OUVERTE = 44;
const VIGNETTE_DU_CARRE = 52;

/**
 * Un salon à rendre, avec ce qu'il contient.
 *
 * **Le grain a changé en v4 : une carte par salon, plus une par prestation.**
 * Un salon apparaissait autant de fois qu'il avait de prestations ouvertes, et
 * la fiche en révélait d'autres — « on voit trois services alors qu'il y en a
 * beaucoup plus ». Le compte était juste des deux côtés ; c'est la composition
 * qui le faisait lire comme un défaut.
 *
 * **Aplatir ici et non au serveur.** Le fil sert des commerces avec leurs
 * items, ce dont la fiche a besoin telle quelle ; l'écran en tire ce qu'il
 * montre. Demander une seconde forme au serveur aurait fait deux vérités du
 * même contenu.
 */
type SalonDuMur = {
  businessId: string;
  nom: string;
  quartier: Neighborhood | null;
  distanceMetres: number;
  photo: string | null;
  /**
   * Combien de prestations lui sont ouvertes, **servi**.
   *
   * Pas `prestations.length` : la carte n'en nomme que deux, et le serveur
   * compte sur l'ensemble. Pas `items.length` non plus, qui compterait des
   * offres — un article ouvert au story et au reel fait deux contreparties
   * légitimes et une seule prestation.
   */
  ouvertes: number;
  prestations: PrestationDeLaCarte[];
};

/**
 * L'URL de la **vignette** d'un média, ou `null`.
 *
 * **Le mur demandait l'original, et c'était l'essentiel de sa lenteur.** Les
 * trois cadres de cet écran font 100, 52 et 44 points ; l'original est borné à
 * 2000 pixels. Mesuré sur un fil de vingt salons — quatre-vingts images, la
 * grille ci-dessous ne virtualise pas et les charge toutes d'un coup : 10,5 Mo
 * de photographies déjà réduites, 52 Mo de photos sorties d'un téléphone,
 * contre 50 Ko pour le JSON qui les nomme. La vignette ramène le premier chiffre
 * à 0,8 Mo.
 *
 * Le poids n'est même pas le pire : `Image` décode avant de réduire, et une
 * image de 2000 × 2000 occupe seize mégaoctets en mémoire quel que soit le
 * cadre où on la pose. Quatre-vingts d'un coup, c'est ce qui fait ramer le
 * défilement sur un téléphone modeste.
 *
 * **Aucun cadrage ne change.** Vignette et original bornent tous deux le grand
 * côté sans recadrer — c'est écrit dans `images.py` — donc la même photo garde
 * le même cadre, seulement moins de pixels. Ce qui aurait fait deux cadrages,
 * ce serait deux dérivées de rapports différents ; il n'y en a pas.
 *
 * `urlDeLaVignette` rend `undefined` quand la clé est nulle ; les composants
 * demandent `null`. La conversion se fait ici, une fois : la répéter à chaque
 * appel laisserait passer celui qu'on oublie, et un `undefined` sur un prop
 * optionnel ne se distingue pas d'un prop absent.
 */
function media(
  api: { urlDeLaVignette: (cle: string | null) => string | undefined },
  cle: string | null,
) {
  return api.urlDeLaVignette(cle) ?? null;
}

/**
 * Les salons d'un lot, avec leurs prestations **dédoublonnées**.
 *
 * **Le même article ouvert à deux paliers accessibles fait deux offres et une
 * seule prestation.** Le mur d'avant en tirait deux cartes, ce qui était voulu
 * à ce grain-là ; une carte de salon qui listerait deux fois « Gel manicure »
 * sous deux badges se lirait comme un doublon. On garde la première offre
 * rencontrée, donc l'ordre du serveur.
 *
 * **Le compte, lui, ne se déduit pas d'ici.** `prestations_ouvertes` est servi,
 * et c'est ce qui garantit que la somme des cartes égale l'en-tête du quartier :
 * les deux passent par la même fonction côté serveur. Le compter sur ce que la
 * carte a reçu marcherait aujourd'hui et mentirait le jour où la liste sera
 * bornée.
 */
function salonsDe(
  commerces: CommerceDuFil[],
  urlDuMedia: (cle: string | null) => string | null,
): SalonDuMur[] {
  return commerces.map((commerce) => {
    const vues = new Set<string>();
    const prestations: PrestationDeLaCarte[] = [];
    for (const item of commerce.items) {
      if (vues.has(item.catalog_item_id)) continue;
      vues.add(item.catalog_item_id);
      prestations.push({
        catalogItemId: item.catalog_item_id,
        nom: item.name,
        contrepartie: item.content_format,
      });
    }
    return {
      businessId: commerce.business_id,
      nom: commerce.name,
      quartier: commerce.neighborhood,
      distanceMetres: commerce.distance_metres,
      ouvertes: commerce.prestations_ouvertes,
      // La couverture du salon, et non la photo d'une prestation : la carte
      // montre le lieu, et ce qu'on y fait est écrit en dessous.
      photo: urlDuMedia(commerce.cover_photo_key),
      prestations,
    };
  });
}

/**
 * Le mur en trois morceaux, pour que la grille puisse être virtualisée.
 *
 * **Ce que ça répare.** Le mur était un bloc : un `.map` sur toutes les
 * rangées, dans le défileur de l'écran. Un fil de vingt salons montait donc
 * quatre-vingts `Image` à la première image, et `Image` décode avant de
 * réduire — le coût ne dépend pas du cadre où on pose la photo. Le poids du
 * réseau a été réglé en servant la vignette ; ce qui restait est le décodage.
 *
 * **Un crochet et non trois composants.** Les trois morceaux partagent le
 * quartier ouvert, qui est un état : le couper en trois composants demanderait
 * de le remonter d'un cran chez l'appelant, c'est-à-dire de rendre `FilScreen`
 * responsable d'un état qui n'appartient qu'au mur.
 *
 * `SectionsParQuartier` reste et compose les trois morceaux dans un bloc : les
 * écrans et les tests qui la montaient continuent de la monter, et le mur en
 * bloc est exactement ce qu'il faut partout où il n'y a pas quatre-vingts
 * images — à commencer par un décor de test.
 */
export function useMur(
  fil: Fil | null,
  categorie: BusinessCategory | null,
  onOuvrir: (businessId: string) => void,
): { entete: React.ReactNode; elements: { cle: string; rendu: React.ReactNode }[]; pied: React.ReactNode } | null {
  const { api } = useApi();
  const { t, locale } = useI18n();
  const c = useColors();

  // **Le quartier ouvert est un état, pas une dérivation.** Le serveur rend la
  // liste triée et le premier est le plus proche ; le garder en état est ce qui
  // permet d'en ouvrir un autre. Il est réinitialisé par la clé de rendu quand
  // le fil change de catégorie ou de rayon — voir `FilScreen`.
  const [ouvert, setOuvert] = useState<Neighborhood | null>(
    fil?.quartiers[0]?.quartier ?? null,
  );

  // Un quartier qui a disparu de la réponse — filtre resserré, rayon réduit —
  // ne doit pas laisser le mur vide en gardant un état devenu faux. On retombe
  // sur le plus proche, qui est toujours le premier rendu.
  const quartierOuvert =
    fil?.quartiers.find((compte) => compte.quartier === ouvert)?.quartier ??
    fil?.quartiers[0]?.quartier ??
    null;

  if (fil === null) return null;

  /**
   * Les salons qu'aucun quartier ne situe, du plus proche au plus lointain.
   *
   * **Ils n'apparaissaient nulle part**, et le mur ne le disait pas : le fil
   * d'une créatrice dont aucun salon n'a déclaré de quartier rendait zéro carte
   * et aucun état vide — une barre de recherche au-dessus d'un mur blanc. Le
   * cas est courant et **mixte** : les salons démarchés portent un quartier,
   * ceux qui s'inscrivent seuls parfois pas.
   *
   * Une section nommée en fin de mur plutôt qu'un repli sur liste plate : un
   * repli ajouterait une seconde mise en page dont l'apparition dépendrait
   * d'une donnée invisible, et le cas mixte n'y entrerait de toute façon pas.
   */
  const ailleurs = salonsDe(
    fil.commerces.filter((commerce) => commerce.neighborhood === null),
    (cle) => media(api, cle),
  ).sort((a, b) => a.distanceMetres - b.distanceMetres);

  if (quartierOuvert === null && ailleurs.length === 0) return null;

  const compteOuvert = fil.quartiers.find((compte) => compte.quartier === quartierOuvert);
  const salons =
    quartierOuvert === null
      ? []
      : salonsDe(
          fil.commerces.filter((commerce) => commerce.neighborhood === quartierOuvert),
          (cle) => media(api, cle),
        );
  const autres = fil.quartiers.filter((compte) => compte.quartier !== quartierOuvert);

  const entete =
    quartierOuvert === null ? null : (
      <EnTeteDeSection
        quartier={quartierOuvert}
        salons={compteOuvert?.commerces ?? 0}
        prestations={compteOuvert?.prestations ?? 0}
        categorie={categorie}
        photo={media(
          api,
          fil.commerces.find((commerce) => commerce.neighborhood === quartierOuvert)
            ?.cover_photo_key ?? null,
        )}
      />
    );

  /**
   * Un élément par salon, et **l'élément porte ses marges**.
   *
   * En bloc, le conteneur pouvait les poser pour tous ; en liste, il n'y a pas
   * de conteneur — chaque carte est posée seule par le défileur. Les mettre sur
   * la carte est donc la seule écriture qui rende la même chose des deux côtés.
   */
  const carte = (salon: SalonDuMur) => (
    <View
      key={salon.businessId}
      testID="carte-du-mur"
      style={{ paddingHorizontal: MARGE_DU_MUR, paddingBottom: INTERLIGNE }}
    >
      <CarteDeSalon
        nom={salon.nom}
        quartierNomme={salon.quartier === null ? null : t(`quartiers.${salon.quartier}`)}
        distanceMetres={salon.distanceMetres}
        photo={salon.photo}
        ouvertes={salon.ouvertes}
        prestations={salon.prestations}
        onPress={() => onOuvrir(salon.businessId)}
        testID={`salon-${salon.businessId}`}
      />
    </View>
  );

  const elements = [
    ...salons.map((salon) => ({ cle: salon.businessId, rendu: carte(salon) })),
    // **La section des non situés vit dans les éléments, pas dans le pied.**
    // Le pied porte la navigation entre quartiers ; ceci est du contenu, et le
    // ranger là le sortirait de la liste virtualisée au moment précis où une
    // ville en compterait beaucoup.
    ...(ailleurs.length === 0
      ? []
      : [
          {
            cle: 'ailleurs',
            rendu: (
              <View
                key="ailleurs"
                testID="ailleurs-en-ville"
                style={{
                  paddingHorizontal: MARGE_DU_MUR,
                  paddingTop: quartierOuvert === null ? 10 : 6,
                  paddingBottom: 10,
                  gap: 2,
                }}
              >
                <Texte variante="type.titreDApercu">{t('parcours.murAilleurs')}</Texte>
                <Texte variante="type.caption" couleur="ink.soft" testID="ailleurs-compte">
                  {t('parcours.murAilleursCorps', {
                    count: formatNumber(ailleurs.length, locale),
                  })}
                </Texte>
              </View>
            ),
          },
          ...ailleurs.map((salon) => ({ cle: salon.businessId, rendu: carte(salon) })),
        ]),
  ];

  const pied =
    autres.length > 0 ? (
      <View
        testID="autres-quartiers"
        style={{
          borderTopWidth: 1,
          borderTopColor: c['line.default'],
          paddingHorizontal: MARGE_DU_MUR,
          paddingVertical: 10,
          gap: 8,
        }}
      >
        <Texte variante="type.dataLabel" couleur="ink.soft">
          {t('parcours.murAutresQuartiers').toUpperCase()}
        </Texte>
        {/* **Ils défilent, ils ne s'entassent pas.** Tous rendus d'un coup sur
            une rangée fixe, les quatrième et cinquième quartiers se serraient
            jusqu'à couper leur nom — un nom de quartier tronqué ne désigne plus
            rien. Ils gardent maintenant leur largeur et sortent du champ, le
            suivant en amorce : c'est du contenu, et `rules.md` §3 réserve
            précisément cette dérogation au contenu. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ flexDirection: 'row', gap: 10, paddingRight: MARGE_DU_MUR }}
        >
          {autres.map((compte) => (
            <CarreDeQuartier
              key={compte.quartier}
              quartier={compte.quartier}
              prestations={compte.prestations}
              photo={media(
                api,
                fil.commerces.find((commerce) => commerce.neighborhood === compte.quartier)
                  ?.cover_photo_key ?? null,
              )}
              onPress={() => setOuvert(compte.quartier)}
            />
          ))}
        </ScrollView>
      </View>
    ) : null;

  return { entete, elements, pied };
}

/**
 * Le mur en un bloc, pour les écrans qui n'ont pas quatre-vingts images.
 *
 * **Elle reste, et elle rend exactement les mêmes éléments.** Ce n'est pas une
 * seconde version du mur : `useMur` produit les rangées, et cette fonction les
 * pose dans un conteneur au lieu de les confier à un défileur. Deux
 * constructions du même contenu finiraient par diverger — c'est la faute qu'on
 * a déjà vue ailleurs dans ce dépôt, et la seule façon de ne pas la refaire est
 * qu'il n'y ait qu'une construction.
 */
export function SectionsParQuartier({
  fil,
  categorie,
  onOuvrir,
}: {
  fil: Fil;
  /** La catégorie en vigueur, qui nomme le compte de la section. */
  categorie: BusinessCategory | null;
  onOuvrir: (businessId: string) => void;
}) {
  const mur = useMur(fil, categorie, onOuvrir);
  if (mur === null) return null;

  return (
    <View testID="le-mur" style={{ gap: 8 }}>
      {mur.entete}
      <View testID="grille-des-prestations">
        {mur.elements.map((element) => element.rendu)}
      </View>
      {mur.pied}
    </View>
  );
}

/**
 * La tête de la section ouverte.
 *
 * Le chevron pointe vers le bas — la section est déroulée. Il ne se referme
 * pas : refermer le seul quartier ouvert laisserait un mur sans prestations,
 * et l'écran n'a alors plus rien à montrer. On ouvre un autre quartier, ce qui
 * referme celui-ci ; c'est le même geste, avec une destination.
 */
function EnTeteDeSection({
  quartier,
  salons,
  prestations,
  categorie,
  photo,
}: {
  quartier: Neighborhood;
  /** Combien de salons ce quartier porte, dans le fil rendu. */
  salons: number;
  prestations: number;
  /** La catégorie en vigueur, qui nomme le compte. `null` : toutes. */
  categorie: BusinessCategory | null;
  photo: string | null;
}) {
  const { t, locale } = useI18n();
  const c = useColors();
  // Résolu une fois : le nom sert au titre et à la phrase, et une clé composée
  // écrite trois fois élargit d'autant ce que la garde des traductions ne peut
  // pas résoudre.
  const nomDuQuartier = t(`quartiers.${quartier}`);

  return (
    <View
      testID="quartier-ouvert"
      style={{
        paddingHorizontal: MARGE_DU_MUR,
        paddingTop: 10,
        paddingBottom: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <View
        style={{
          width: VIGNETTE_OUVERTE,
          height: VIGNETTE_OUVERTE,
          borderRadius: radius['radius.md'],
          overflow: 'hidden',
          backgroundColor: c['media.placeholder'],
        }}
      >
        {/* La place était déjà réservée ; il manquait le fondu. Une photo qui
            apparaît d'un coup est un clignotement, quelle que soit sa vitesse. */}
        <Photo uri={photo} style={{ flex: 1 }} testID="quartier-ouvert-photo" />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Texte variante="type.titreDApercu" testID="quartier-ouvert-nom">
          {nomDuQuartier}
        </Texte>
        {/* **Deux clés, pas une phrase à trous.** « 18 services open to you »
            et « 6 nail services » ne sont pas la même phrase avec un mot en
            plus : la seconde place la catégorie avant le nom commun, ce que
            l'espagnol n'ordonne pas comme l'anglais. Les composer aurait donné
            une traduction juste dans une langue et bancale dans l'autre.
 
            **Et le quartier est nommé dans la phrase, pas seulement au-dessus.**
            Un testeur a lu « 3 services open to you » comme un total de ville
            alors que c'était le compte du quartier ouvert ; le nom posé sur la
            ligne du dessus ne suffisait pas, parce que c'est la phrase qu'on
            lit. Le compte des salons vient avec, pour la même raison : il donne
            à la phrase une portée qu'aucun chiffre seul n'a. */}
        <Texte variante="type.caption" couleur="ink.soft" testID="quartier-ouvert-compte">
          {categorie === null
            ? t('parcours.murServicesOuverts', {
                salons: formatNumber(salons, locale),
                count: formatNumber(prestations, locale),
                quartier: nomDuQuartier,
              })
            : t('parcours.murServicesDeCategorie', {
                salons: formatNumber(salons, locale),
                count: formatNumber(prestations, locale),
                categorie: t(`categories.${categorie}`),
                quartier: nomDuQuartier,
              })}
        </Texte>
      </View>
    </View>
  );
}

/**
 * Un carré de quartier : sa photo, son compte, son nom.
 *
 * **Quatre carrés tiennent en 119 points** là où quatre sections repliées en
 * auraient pris 272. C'est ce qui permet de montrer toute la ville sans
 * pousser les prestations hors de l'écran — la forme littérale que la planche
 * demande, et la raison pour laquelle elle la demande.
 */
function CarreDeQuartier({
  quartier,
  prestations,
  photo,
  onPress,
}: {
  quartier: Neighborhood;
  prestations: number;
  photo: string | null;
  onPress: () => void;
}) {
  const { t, locale } = useI18n();
  const c = useColors();
  const enfoncement = useEnfoncement();

  return (
    <Pressable
      testID={`carre-${quartier}`}
      accessibilityRole="button"
      accessibilityLabel={t(`quartiers.${quartier}`)}
      onPress={onPress}
      onPressIn={enfoncement.onPressIn}
      onPressOut={enfoncement.onPressOut}
      style={{ flex: 1, minWidth: 0, gap: 5 }}
    >
      <View
        style={{
          height: VIGNETTE_DU_CARRE,
          borderRadius: radius['radius.md'],
          overflow: 'hidden',
          backgroundColor: c['media.placeholder'],
        }}
      >
        <Photo uri={photo} style={{ ...StyleSheet.absoluteFillObject }} />
        {/* Le compte se pose sur la photo, dans un cartouche opaque : posé
            dessous, il ajouterait une ligne à quatre colonnes de 80 points et
            le nom du quartier n'aurait plus la place de s'écrire. */}
        <View
          testID={`carre-${quartier}-compte`}
          style={{
            position: 'absolute',
            right: 5,
            bottom: 5,
            borderRadius: radius['radius.sm'],
            backgroundColor: c['scrim.badge'],
            paddingHorizontal: 6,
            paddingVertical: 2,
          }}
        >
          <Texte variante="type.dataLabel">{formatNumber(prestations, locale)}</Texte>
        </View>
      </View>
      <Texte variante="type.caption" ellipseSurNomPropre>
        {t(`quartiers.${quartier}`)}
      </Texte>
    </Pressable>
  );
}

/**
 * Le mur au chargement : la géométrie exacte de la grille, en aplats.
 *
 * **Rien ne saute quand les images arrivent**, parce que les blocs gris ont
 * déjà la hauteur et la découpe qu'elles auront — image de 100, trois lignes,
 * case de contrepartie comprise. C'est ce qui distingue un squelette d'un
 * indicateur : l'un tient la place, l'autre l'annonce.
 *
 * **Il vit dans ce fichier, à côté de ce qu'il imite.** Rangé ailleurs, il
 * garde la géométrie de la veille sans que rien ne le signale — c'est arrivé
 * une fois sur ce même écran, où le squelette portait encore la carte à photo
 * d'un fil qui n'en avait plus.
 */
export function MurEnChargement({ rangees = 3 }: { rangees?: number }) {
  const c = useColors();
  const aplat = { backgroundColor: c['line.default'] };

  return (
    <View testID="mur-en-chargement" style={{ gap: 8 }}>
      <View
        style={{
          paddingHorizontal: MARGE_DU_MUR,
          paddingTop: 10,
          paddingBottom: 8,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <View
          style={{
            width: VIGNETTE_OUVERTE,
            height: VIGNETTE_OUVERTE,
            borderRadius: radius['radius.md'],
            ...aplat,
          }}
        />
        <View style={{ flex: 1, gap: 5 }}>
          <View style={{ height: 16, width: '45%', borderRadius: radius['radius.sm'], ...aplat }} />
          <View style={{ height: 12, width: '70%', borderRadius: radius['radius.sm'], ...aplat }} />
        </View>
      </View>

      <View
        style={{ paddingHorizontal: MARGE_DU_MUR, paddingBottom: 18, gap: INTERLIGNE }}
      >
        {Array.from({ length: rangees }, (_, rang) => (
          <View key={rang} style={{ flexDirection: 'row', gap: GOUTTIERE }}>
            {[0, 1].map((colonne) => (
              <View key={colonne} style={{ flex: 1, minWidth: 0, gap: 9 }}>
                <View
                  style={{
                    height: IMAGE_DE_L_APERCU,
                    borderRadius: radius['radius.photo'],
                    ...aplat,
                  }}
                />
                <View style={{ gap: 4 }}>
                  <View style={{ height: 16, borderRadius: radius['radius.sm'], ...aplat }} />
                  <View
                    style={{ height: 12, width: '80%', borderRadius: radius['radius.sm'], ...aplat }}
                  />
                  {/* La case de contrepartie, vide comme elle peut l'être en
                      vrai : la remplir d'un aplat ferait un squelette plus
                      chargé que l'écran qu'il annonce. */}
                  <View style={{ height: CASE_DU_BADGE }} />
                </View>
              </View>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}
