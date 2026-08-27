/**
 * Ce qui commande le mur, et qui reste pendant qu'on le parcourt.
 *
 * **La ligne unique paie la barre de recherche.** Les catégories sur deux
 * lignes avec « All » détaché prenaient 86 points ; en une ligne de pilules
 * elles en prennent 34. Les 52 rendus paient la barre à 48 : le chrome ne
 * grandit pas, il se réorganise.
 *
 * Ce qui grandit est ce qui reste **collé**. Deux barres permanentes coûtent
 * 104 points sur 728, un septième de l'écran, tout le temps — c'est le prix
 * demandé, et il se paie parce que la recherche rend la ligne unique
 * défendable.
 *
 * **Ce que la ligne unique perd, et pourquoi c'est accepté.** Sept catégories
 * sur une ligne de 354 points : les deux dernières sont hors champ. Une option
 * cachée serait un cul-de-sac si rien d'autre ne la trouvait — avec une barre
 * au-dessus, « massage » se tape. C'est la recherche qui rachète le
 * défilement, pas l'inverse.
 *
 * **Chercher et garder ne se posent pas au même endroit.** La recherche est une
 * barre : elle s'adresse à l'écran entier. Le cœur est sur l'objet, et celui
 * d'ici n'en est pas un — c'est la porte vers la liste, posée au bout de la
 * barre parce qu'elle regarde l'écran, pas une prestation.
 */
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import type { BusinessCategory, Fil } from '../../api';
import { Icone, Texte } from '../../components';
import { formatNumber } from '../../format';
import { useI18n } from '../../i18n';
import { radius, size, useColors } from '../../theme';
import { etatAccessible } from '../../components/etatAccessible';

/** La marge latérale de l'écran, celle que le reste du fil respecte. */
const MARGE = 16;

export function BarreDuMur({
  fil,
  categorie,
  onCategorie,
  recherche,
  onRecherche,
  onVoirLesFavoris,
  favorisGardes = 0,
}: {
  /** Nul tant que le fil n'a pas répondu : la barre se rend quand même. */
  fil: Fil | null;
  categorie: BusinessCategory | null;
  onCategorie: (categorie: BusinessCategory | null) => void;
  recherche: string;
  onRecherche: (texte: string) => void;
  onVoirLesFavoris: () => void;
  /**
   * Combien de prestations sont gardées, **en tout**.
   *
   * Servi par le fil et non compté sur ce qu'il rend : la porte mène à la liste
   * entière, et un compte borné par le rayon changerait en marchant. Zéro
   * n'écrit rien — voir plus bas.
   */
  favorisGardes?: number;
}) {
  const { t, locale } = useI18n();
  const c = useColors();

  // `fil === null` et non `fil?.` : le serveur rend toujours `categories`, et
  // un repli sur l'absence du champ masquerait un montage de test qui fabrique
  // une réponse que le serveur ne produit pas.
  const categories = fil === null ? [] : fil.categories;

  return (
    <View
      testID="barre-du-mur"
      style={{
        gap: 10,
        // **Le haut manquait.** La zone sûre est posée par la coquille, mais la
        // bande venait s'y coller sans respirer : sur un appareil à encoche, le
        // champ de recherche touchait le bord de l'écran.
        paddingTop: 10,
        paddingBottom: 10,
        backgroundColor: c['bg.page'],
        borderBottomWidth: 1,
        borderBottomColor: c['line.default'],
      }}
    >
      {/* La marge latérale vit sur la rangée et non sur la bande : la ligne des
          catégories défile d'un bord à l'autre et la perdrait. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: MARGE,
        }}
      >
        <View
          style={{
            flex: 1,
            minWidth: 0,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            height: 48,
            paddingHorizontal: 14,
            borderRadius: radius['radius.pill'],
            backgroundColor: c['bg.surface'],
            borderWidth: 1,
            borderColor: c['line.default'],
            // Le champ est un enfant carré qui porte son propre fond : sans
            // découpe, l'autoremplissage du navigateur le montre aux quatre
            // coins d'une barre qu'on croyait arrondie.
            overflow: 'hidden',
          }}
        >
          <Icone nom="loupe" couleur="ink.mute" taille={20} />
          <TextInput
            testID="champ-recherche"
            accessibilityLabel={t('parcours.filRechercher')}
            value={recherche}
            onChangeText={onRecherche}
            placeholder={t('parcours.filRechercher')}
            placeholderTextColor={c['ink.mute']}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            style={{ flex: 1, color: c['ink.default'], fontSize: 15, lineHeight: 23 }}
          />
          {recherche.length > 0 ? (
            <Pressable
              testID="effacer-la-recherche"
              accessibilityRole="button"
              accessibilityLabel={t('parcours.filEffacerLaRecherche')}
              onPress={() => onRecherche('')}
              // La croix est petite ; la cible ne l'est pas.
              hitSlop={12}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Icone nom="croix" couleur="ink.mute" taille={18} />
            </Pressable>
          ) : null}
        </View>

        {/* **La porte vers les favoris, en pilule au bout de la barre.**
            Elle regarde l'écran et non une prestation : c'est pour cela
            qu'elle est ici, et c'est aussi pourquoi elle est le **seul** cœur
            du fil depuis la v4. La carte de salon n'en porte plus — elle
            contient quatre prestations, un cœur y désignerait quoi ?

            **Rempli avec son compte, vide sans.** Le remplissage n'y dit pas
            « celui-ci est gardé » comme sur une ligne de prestation : il dit
            qu'il y a quelque chose derrière la porte. Sans favori, la porte
            reste ouvrable et se tait — la liste vide explique mieux qu'une
            pastille à zéro, qui apprend à ne plus regarder la pastille. */}
        <Pressable
          testID="voir-mes-favoris"
          accessibilityRole="button"
          // **Le compte est dans le nom, pas seulement dans la pilule.** Un
          // chiffre posé à côté d'une icône n'existe pas pour un lecteur
          // d'écran, et c'est justement l'information qui dit qu'il s'est passé
          // quelque chose.
          accessibilityLabel={
            favorisGardes > 0
              ? t('parcours.filVoirMesFavorisCompte', { count: favorisGardes })
              : t('parcours.filVoirMesFavoris')
          }
          onPress={onVoirLesFavoris}
          style={({ pressed }) => ({
            height: size.touchMin,
            borderRadius: radius['radius.pill'],
            backgroundColor: c['bg.surface'],
            borderWidth: 1,
            borderColor: c['line.default'],
            flexDirection: 'row',
            alignItems: 'center',
            gap: 7,
            paddingHorizontal: favorisGardes > 0 ? 15 : 13,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Icone
            nom="coeur"
            couleur={favorisGardes > 0 ? 'brand.700' : 'ink.default'}
            taille={22}
            rempli={favorisGardes > 0}
            testID="coeur-de-la-porte"
          />
          {favorisGardes > 0 ? (
            <Texte variante="type.data" testID="compte-des-favoris">
              {formatNumber(favorisGardes, locale)}
            </Texte>
          ) : null}
        </Pressable>
      </View>

      {/* Sous deux catégories il n'y a pas de choix à offrir : « All » et
          l'unique entrée rendent le même mur. La bande entière tombe, y compris
          « All », qui ne se retire alors de quoi que ce soit. */}
      {categories.length < 2 ? null : (
        <ScrollView
          testID="bande-des-categories"
          horizontal
          showsHorizontalScrollIndicator={false}
          // Le contenu défile, le conteneur ne grandit pas : c'est ce qui tient
          // les 34 points quel que soit le nombre de catégories ouvertes.
          // **Le retrait à gauche manquait**, et la première pilule touchait le
          // bord. Il est dans le contenu et non sur le conteneur : sur le
          // conteneur, il rognerait la zone qui défile.
          contentContainerStyle={{
            flexDirection: 'row',
            gap: 8,
            paddingLeft: MARGE,
            paddingRight: 16,
          }}
        >
          <Pilule
            label={t('parcours.murToutesLesCategories')}
            actif={categorie === null}
            onPress={() => onCategorie(null)}
            testID="categorie-toutes"
          />
          {categories.map((compte) => (
            <Pilule
              key={compte.categorie}
              label={t(`categories.${compte.categorie}`)}
              actif={categorie === compte.categorie}
              // Réappuyer sur la catégorie en vigueur la retire : le geste qui
              // a filtré est celui qu'on refait pour défiltrer.
              onPress={() =>
                onCategorie(categorie === compte.categorie ? null : compte.categorie)
              }
              testID={`categorie-${compte.categorie}`}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

/**
 * Une catégorie, en pilule.
 *
 * **Pleine quand elle est en vigueur, contour sinon.** Le soulignement de la
 * version d'avant tenait sur deux lignes alignées ; sur une ligne qui défile,
 * il se perd au bord du champ. Une pilule pleine se reconnaît à moitié sortie.
 */
function Pilule({
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
    <Pressable
      testID={testID}
      accessibilityRole="button"
      {...etatAccessible({ selected: actif })}
      onPress={onPress}
      style={({ pressed }) => ({
        height: 34,
        paddingHorizontal: 14,
        borderRadius: radius['radius.pill'],
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: actif ? c['bg.inverse'] : c['bg.surface'],
        borderWidth: 1,
        borderColor: actif ? c['bg.inverse'] : c['line.default'],
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Texte variante="type.caption" couleur={actif ? 'ink.onDark' : 'ink.default'}>
        {label}
      </Texte>
    </Pressable>
  );
}
