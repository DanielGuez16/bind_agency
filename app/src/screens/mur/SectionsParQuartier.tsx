/**
 * Le fil v5 : des rangées horizontales par catégorie.
 *
 * **La largeur de la carte était le vrai sujet, et c'était arithmétique.** « On
 * ne voit rien » était une mesure : une grille de deux sur 354 points donne des
 * colonnes de 171, et une photo de 100 de haut y fait un letterbox de 1,71:1 —
 * sur des images qui arrivent en 4:3. Un quart de chaque cadrage jeté, dix-sept
 * mille pixels rendus. En rangée horizontale, une carte de 280 porte un 4:3
 * entier : **3,4 fois la surface, sans recadrage**.
 *
 * **Et le quartier redevient une étiquette.** Il avait été fait colonne
 * vertébrale du fil, alors que la fondatrice l'avait déjà écarté au
 * démarchage : il filtre trop fort comme axe, et Miami est une ville de
 * voiture. Il vit maintenant dans la ligne d'attribution, avec le salon et la
 * distance — et reste une pilule de filtre pour qui le veut.
 *
 * **L'axe est la catégorie, que l'API sert.** C'est la même décision qui règle
 * les deux reproches : la rangée donne la largeur *et* l'axe.
 *
 * **« Le plus près de toi » ouvre le fil sans filtrer.** Tout afficher, puis
 * préciser — les catégories viennent après, chacune avec son compte et sa
 * sortie vers tout.
 *
 * **Ce qui a traversé les trois fils reste intact** : la prestation porte le
 * titre, le salon est l'attribution, et le compte dit ce qui est ouvert chez
 * lui. C'est le seul acquis qu'on ne rejoue pas.
 */
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import {
  useApi,
  type BusinessCategory,
  type CommerceDuFil,
  type Fil,
  type ItemDuFil,
} from '../../api';
import { CASE_DU_BADGE, Texte } from '../../components';
import {
  CarteDeSalon,
  LARGEUR_DE_LA_CARTE,
  PHOTO_DE_LA_CARTE,
  type FavorisDeLaCarte,
  type PrestationDeLaCarte,
} from './CarteDeSalon';
import { formatNumber } from '../../format';
import { useI18n } from '../../i18n';
import { radius, useColors } from '../../theme';

/** La marge latérale du mur, la seule de l'écran. */
export const MARGE_DU_MUR = 18;

/** L'écart entre deux cartes d'une rangée. */
const GOUTTIERE = 12;

/**
 * Une prestation à rendre, aplatie depuis un commerce.
 *
 * **La prestation porte le titre, le salon l'attribution.** C'est l'acquis des
 * trois fils précédents, et le seul que la v5 ne rejoue pas. Ce que la carte
 * ajoute est le **reste ouvert du salon** : elle nomme une prestation et mène à
 * un lieu, ce qui est exactement ce qui manquait à la v0.5.
 */
export type PrestationDuFil = {
  cle: string;
  nom: string;
  salon: string;
  businessId: string;
  categorie: BusinessCategory;
  quartier: string | null;
  distanceMetres: number;
  contrepartie: ItemDuFil['content_format'] | null;
  /** Ce que le salon ouvre en plus de celle-ci. Zéro : rien à annoncer. */
  autres: number;
  photo: string | null;
};

/** L'URL de la vignette d'un média, ou `null`. */
function media(
  api: { urlDeLaVignette: (cle: string | null) => string | undefined },
  cle: string | null,
) {
  return api.urlDeLaVignette(cle) ?? null;
}

/**
 * Les prestations d'un fil, à plat et **dédoublonnées par article**.
 *
 * Le même article ouvert à deux paliers accessibles fait deux offres et une
 * seule prestation : deux cartes du même nom sous deux badges se liraient comme
 * un doublon. On garde la première rencontrée, donc l'ordre du serveur — qui
 * est celui de la distance.
 */
export function prestationsDuFil(
  commerces: CommerceDuFil[],
  urlDuMedia: (cle: string | null) => string | null,
  nomDuQuartier: (quartier: string) => string,
): PrestationDuFil[] {
  return commerces.flatMap((commerce) => {
    const vues = new Set<string>();
    const prestations: PrestationDuFil[] = [];
    for (const item of commerce.items) {
      if (vues.has(item.catalog_item_id)) continue;
      vues.add(item.catalog_item_id);
      prestations.push({
        cle: item.catalog_item_id,
        nom: item.name,
        salon: commerce.name,
        businessId: commerce.business_id,
        categorie: commerce.category,
        quartier: commerce.neighborhood === null ? null : nomDuQuartier(commerce.neighborhood),
        distanceMetres: commerce.distance_metres,
        contrepartie: item.content_format,
        // **Servi, jamais compté ici.** Le serveur compte les prestations
        // distinctes du salon ; le déduire de ce que le fil rend donnerait un
        // nombre juste aujourd'hui et faux le jour où la liste sera bornée.
        autres: Math.max(0, commerce.prestations_ouvertes - 1),
        photo: urlDuMedia(item.photo_key ?? commerce.cover_photo_key),
      });
    }
    return prestations;
  });
}

/**
 * Les salons d'une rangée, une carte chacun.
 *
 * **Le mur montait les prestations à plat, et la v5 demande le salon.** Le signe
 * qui le trahissait : chaque carte portait « et 2 autres à l'intérieur » au
 * grain de la prestation, donc trois cartes du même salon répétaient la même
 * phrase pour des prestations posées juste à côté.
 *
 * La carte n'en nomme que deux et compte le reste ; le compte vient du serveur,
 * par la même fonction que l'en-tête du quartier — c'est ce qui fait que la
 * somme des cartes égale ce que le quartier annonce.
 */
export function salonsDuFil(
  commerces: CommerceDuFil[],
  urlDuMedia: (cle: string | null) => string | null,
  nomDuQuartier: (quartier: string) => string,
): SalonDuFil[] {
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
        estFavori: item.est_favori,
      });
    }
    return {
      cle: commerce.business_id,
      businessId: commerce.business_id,
      nom: commerce.name,
      categorie: commerce.category,
      quartierNomme:
        commerce.neighborhood === null ? null : nomDuQuartier(commerce.neighborhood),
      distanceMetres: commerce.distance_metres,
      photo: urlDuMedia(commerce.cover_photo_key),
      ouvertes: commerce.prestations_ouvertes,
      prestations,
    };
  });
}

export type SalonDuFil = {
  cle: string;
  businessId: string;
  nom: string;
  categorie: BusinessCategory;
  quartierNomme: string | null;
  distanceMetres: number;
  photo: string | null;
  ouvertes: number;
  prestations: PrestationDeLaCarte[];
};

/** Combien de cartes une rangée porte au plus. Au-delà, « tout voir ». */
const CARTES_PAR_RANGEE = 10;

/**
 * Le favori sans son appelant, pour un montage qui n'en a pas besoin.
 *
 * Sans lui, chaque test qui monte le mur sans favoris devrait en fournir un
 * factice — c'est ce que `SectionsParQuartier` fait déjà pour les écrans qui
 * la montent telle quelle.
 */
const FAVORIS_NEUTRES: FavorisDeLaCarte = {
  estFavori: (_catalogItemId, servi) => servi,
  basculer: () => {},
};

/**
 * Le fil en rangées, pour que chacune puisse défiler seule.
 *
 * Un crochet et non des composants : la catégorie choisie est un état, et le
 * remonter chez l'appelant rendrait `FilScreen` responsable de ce qui
 * n'appartient qu'au mur.
 */
export function useMur(
  fil: Fil | null,
  categorie: BusinessCategory | null,
  onOuvrir: (businessId: string) => void,
  onCategorie?: (categorie: BusinessCategory) => void,
  favoris: FavorisDeLaCarte = FAVORIS_NEUTRES,
): { entete: React.ReactNode; elements: { cle: string; rendu: React.ReactNode }[]; pied: React.ReactNode } | null {
  const { api, } = useApi();
  const { t, locale } = useI18n();

  if (fil === null) return null;

  const toutes = salonsDuFil(
    fil.commerces,
    (cle) => media(api, cle),
    (quartier) => t(`quartiers.${quartier}`),
  );
  if (toutes.length === 0) return null;

  const rangee = (
    cle: string,
    titre: string,
    prestations: SalonDuFil[],
    total: number,
    onTout?: () => void,
  ) => ({ cle, titre, prestations, total: formatNumber(total, locale), onTout });

  const rangees = [
    // **La première rangée n'est pas une catégorie.** « Le plus près de toi »
    // ouvre le fil sans rien filtrer : tout afficher, puis préciser. C'est
    // l'ordre que la campagne réclame, et il se lit dans la composition.
    rangee('proches', t('parcours.murLePlusPres'), toutes, fil.total_prestations),
    // Puis les catégories, dans l'ordre du serveur — celui du fil rendu, pas
    // un tri refait ici.
    ...fil.categories
      .filter((compte) => categorie === null || compte.categorie === categorie)
      .map((compte) =>
        rangee(
          compte.categorie,
          t(`categories.${compte.categorie}`),
          toutes.filter((prestation) => prestation.categorie === compte.categorie),
          compte.prestations,
          onCategorie ? () => onCategorie(compte.categorie) : undefined,
        ),
      ),
    // Une rangée sans carte ne se rend pas : le compte du serveur couvre le
    // rayon entier, la rangée ne montre que ce qui est chargé.
  ].filter((element) => element.prestations.length > 0);

  const elements = rangees.map((element, index) => ({
    cle: element.cle,
    rendu: (
      <RangeeDuFil
        key={element.cle}
        titre={element.titre}
        total={element.total}
        prestations={element.prestations.slice(0, CARTES_PAR_RANGEE)}
        favoris={favoris}
        onOuvrir={onOuvrir}
        onTout={element.onTout}
        // **Le filet sépare, donc il ne ferme pas.** Sous la dernière rangée il
        // ne distingue plus rien de rien : il tracerait un trait au-dessus du
        // vide, juste avant la barre d'onglets.
        avecFilet={index < rangees.length - 1}
        testID={`rangee-${element.cle}`}
      />
    ),
  }));

  return { entete: null, elements, pied: null };
}

/**
 * Une rangée : un titre, son compte, et des cartes qui défilent.
 *
 * **La carte suivante déborde de la bande**, et c'est la convention du
 * défilement horizontal — ici sur du contenu, ce que `rules.md` §3 autorise
 * précisément là et nulle part ailleurs.
 */
function RangeeDuFil({
  titre,
  total,
  prestations,
  favoris,
  onOuvrir,
  onTout,
  avecFilet,
  testID,
}: {
  titre: string;
  total: string;
  prestations: SalonDuFil[];
  favoris: FavorisDeLaCarte;
  onOuvrir: (businessId: string) => void;
  onTout?: () => void;
  /** Faux sur la dernière rangée : un séparateur ne ferme pas une liste. */
  avecFilet: boolean;
  testID: string;
}) {
  const { t } = useI18n();
  const c = useColors();

  return (
    <View
      testID={testID}
      style={{
        gap: 10,
        paddingBottom: 20,
        // **Ce qui sépare deux rangées, maintenant que les cartes n'ont plus de
        // contour.** Un filet d'un point sous le dernier rang dit où la section
        // finit ; c'était le cadre de chaque carte qui le disait avant, à douze
        // exemplaires pour une seule information.
        borderBottomWidth: avecFilet ? 1 : 0,
        borderBottomColor: c['line.default'],
        marginBottom: avecFilet ? 20 : 0,
      }}
    >
      <View
        style={{
          paddingHorizontal: MARGE_DU_MUR,
          flexDirection: 'row',
          alignItems: 'baseline',
          gap: 12,
        }}
      >
        <Texte variante="type.section" style={{ flex: 1, minWidth: 0 }} ellipseSurNomPropre>
          {titre}
        </Texte>
        {/* **Le compte est la sortie.** « All 34 » dit ce qu'il y a et y mène :
            un chiffre sans destination fait chercher où l'on voit les autres. */}
        {onTout ? (
          <Pressable
            accessibilityRole="button"
            onPress={onTout}
            hitSlop={8}
            testID={`${testID}-tout`}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Texte variante="type.label" couleur="brand.700">
              {t('parcours.murToutVoir', { count: total })}
            </Texte>
          </Pressable>
        ) : (
          <Texte variante="type.label" couleur="brand.700" testID={`${testID}-compte`}>
            {t('parcours.murToutVoir', { count: total })}
          </Texte>
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          flexDirection: 'row',
          gap: GOUTTIERE,
          paddingHorizontal: MARGE_DU_MUR,
        }}
      >
        {prestations.map((salon) => (
          <CarteDeSalon
            key={salon.cle}
            nom={salon.nom}
            quartierNomme={salon.quartierNomme}
            distanceMetres={salon.distanceMetres}
            photo={salon.photo}
            ouvertes={salon.ouvertes}
            prestations={salon.prestations}
            favoris={favoris}
            onPress={() => onOuvrir(salon.businessId)}
            // **Le testID porte la rangée.** Le même salon paraît dans « le
            // plus près » et dans sa catégorie : sans ce préfixe, deux nœuds
            // partagent un identifiant et toute requête devient ambiguë.
            testID={`${testID}-apercu-${salon.cle}`}
          />
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * Le mur en bloc, pour les écrans et les tests qui le montent tel quel.
 *
 * Il compose les mêmes rangées que la liste : deux constructions du même mur
 * finiraient par diverger, et c'est la seconde qu'on ne regarde plus.
 */
export function SectionsParQuartier({
  fil,
  categorie,
  favoris,
  onOuvrir,
}: {
  fil: Fil;
  categorie: BusinessCategory | null;
  /** Absent : le cœur du salon lit le fil servi, et ne bascule rien. */
  favoris?: FavorisDeLaCarte;
  onOuvrir: (businessId: string) => void;
}) {
  const mur = useMur(fil, categorie, onOuvrir, undefined, favoris);
  if (mur === null) return null;

  return (
    <View testID="le-mur">
      {mur.elements.map((element) => element.rendu)}
    </View>
  );
}

/**
 * Le squelette du fil, avec la géométrie qu'il annonce.
 *
 * **Rien ne saute quand les images arrivent** : les blocs gris ont déjà la
 * largeur et la hauteur des cartes — 280 par 210, la photo en 4:3. C'est ce qui
 * distingue un squelette d'un indicateur.
 *
 * **Il vit à côté de ce qu'il imite.** Rangé ailleurs, il garde la géométrie de
 * la veille sans que rien ne le signale — c'est arrivé une fois sur cet écran,
 * où il portait encore la carte d'un fil qui n'en avait plus.
 */
export function MurEnChargement({ rangees = 2 }: { rangees?: number }) {
  const c = useColors();
  const aplat = { backgroundColor: c['line.default'] };

  return (
    <View testID="mur-en-chargement" style={{ gap: 20 }}>
      {Array.from({ length: rangees }, (_, rang) => (
        <View key={rang} style={{ gap: 10 }}>
          <View style={{ paddingHorizontal: MARGE_DU_MUR }}>
            <View style={{ height: 22, width: '45%', borderRadius: radius['radius.sm'], ...aplat }} />
          </View>
          <View style={{ flexDirection: 'row', gap: GOUTTIERE, paddingHorizontal: MARGE_DU_MUR }}>
            {[0, 1].map((colonne) => (
              <View key={colonne} style={{ width: LARGEUR_DE_LA_CARTE, gap: 9 }}>
                <View
                  style={{
                    height: PHOTO_DE_LA_CARTE,
                    borderRadius: radius['radius.photo'],
                    ...aplat,
                  }}
                />
                <View style={{ gap: 4 }}>
                  <View style={{ height: 16, borderRadius: radius['radius.sm'], ...aplat }} />
                  <View
                    style={{ height: 12, width: '80%', borderRadius: radius['radius.sm'], ...aplat }}
                  />
                  <View style={{ height: CASE_DU_BADGE }} />
                </View>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}
