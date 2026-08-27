/**
 * L'aperçu d'une prestation dans le fil.
 *
 * **C'est la prestation qui porte le titre, et le salon qui l'attribue.** Les
 * testeurs demandaient « est-ce une activité ou un commerce » ; la revue a
 * proposé d'ajouter une catégorie, et ce n'était pas le défaut. La carte
 * montrait le salon à 22 points sur la photo et la prestation à 16 en dessous :
 * l'objet de la réservation était **subordonné au lieu qui l'héberge**. Une
 * catégorie « activités » n'y changeait rien, puisque chaque carte du fil est
 * déjà une prestation — elle les aurait toutes rassemblées, et la confusion
 * serait restée entière à l'intérieur de chaque catégorie. Ce n'est pas un
 * manque de rangement, c'est une inversion de hiérarchie, et elle se corrige
 * ici : le nom de la prestation en titre, « salon · durée » en attribution,
 * comme un plat porte le nom du restaurant en second.
 *
 * **Plus aucun chrome.** Ni bordure, ni ombre, ni fond, ni voile sur la photo.
 * Il reste une image arrondie posée sur la page, trois lignes et un badge —
 * et c'est ce qui permet d'en montrer deux par ligne sans que rien devienne
 * illisible. La densité vient de ce qu'on retire, pas de ce qu'on rétrécit.
 *
 * **La case du badge a une hauteur fixe, occupée ou vide.** Sans elle, une
 * rangée dont les aperçus portent une contrepartie mesure 27 points de plus
 * que la même sans, et la hauteur du mur se met à dépendre de la donnée : deux
 * colonnes côte à côte se décalent, et la grille cesse d'être une grille.
 *
 * **La distance ne s'écrit plus.** Elle est portée par la section de quartier,
 * qui situe mieux qu'un nombre de mètres — et le tri par distance lui survit,
 * puisqu'il ordonne les sections. Retirer l'affichage n'a coûté le repère
 * géographique que le temps de le remettre au bon niveau.
 */
import { Pressable, View } from 'react-native';

import { useI18n } from '../i18n';
import { radius, useColors } from '../theme';
import { useEnfoncement } from './Mouvement';
import { MediaFallback } from './Cards';
import { Icone } from './Icone';
import { Photo } from './Photo';
import { Texte } from './Texte';

/**
 * La hauteur de la case du badge, occupée ou non.
 *
 * Elle vaut la hauteur du badge lui-même — approche comprise — et rien de plus.
 * Une case plus haute que son contenu ferait un blanc que personne n'a demandé
 * entre l'attribution et la rangée suivante.
 */
export const CASE_DU_BADGE = 27;

/** La hauteur de l'image, sur une colonne de deux. */
export const IMAGE_DE_L_APERCU = 100;

export type ApercuDePrestationProps = {
  /** Le nom de la prestation. C'est lui qui porte le titre. */
  nom: string;
  /** Le nom du salon, en attribution. */
  salon: string;
  /** La durée en minutes. `null` quand le catalogue ne la porte pas. */
  dureeMinutes: number | null;
  /**
   * La contrepartie — story, post, reel — ou `null`.
   *
   * `null` laisse la case **vide et présente**. C'est le cas d'une prestation
   * qu'aucun palier ne demande de contrepartie nommée ; la case reste pour que
   * la rangée garde sa hauteur.
   */
  contrepartie: string | null;
  /** L'image du salon. Absente : le repli au monogramme, jamais un trou. */
  photo?: string | null;
  onPress?: () => void;
  /**
   * Le cœur, et son état.
   *
   * **Absent quand `onFavori` l'est** : une carte hors du mur — un aperçu dans
   * une fiche, dans un récapitulatif — n'a rien à garder de côté, et un cœur
   * qui ne répond pas est pire qu'un cœur absent.
   */
  estFavori?: boolean;
  onFavori?: () => void;
  testID?: string;
};

export function ApercuDePrestation({
  nom,
  salon,
  dureeMinutes,
  contrepartie,
  photo,
  onPress,
  estFavori = false,
  onFavori,
  testID,
}: ApercuDePrestationProps) {
  const c = useColors();
  const enfoncement = useEnfoncement(Boolean(onPress));

  // « Vela Nail Studio · 45 min », et « Vela Nail Studio » seul sans durée. Le
  // séparateur appartient à la jointure et non aux morceaux : le composer par
  // concaténation laisserait un « · » orphelin le jour où la durée manque.
  const attribution = [salon, dureeMinutes === null ? null : `${dureeMinutes} min`]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      testID={testID}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? `${nom} — ${attribution}` : undefined}
      onPress={onPress}
      onPressIn={enfoncement.onPressIn}
      onPressOut={enfoncement.onPressOut}
      // `flex: 1` et `minWidth: 0` : sans le second, un nom long pousse la
      // colonne au lieu de se replier, et les deux colonnes cessent d'être
      // égales. C'est le défaut qui se voit sur « Brow lamination » et sur
      // aucun des noms courts qu'on essaie d'abord.
      style={{ flex: 1, minWidth: 0, gap: 9 }}
    >
      {/* **La hauteur est connue avant l'image.** C'était déjà le cas ici ; ce
          qui manquait est le fondu — une photo qui apparaît d'un coup est un
          clignotement, quelle que soit sa vitesse. */}
      <View>
        <Photo
          uri={photo}
          hauteur={IMAGE_DE_L_APERCU}
          style={{ borderRadius: radius['radius.photo'] }}
          testID={testID ? `${testID}-photo` : undefined}
          replit={<MediaFallback monogramme={salon} height={IMAGE_DE_L_APERCU} />}
        />
        {onFavori ? (
          <CoeurDeLaCarte
            actif={estFavori}
            onPress={onFavori}
            testID={testID ? `${testID}-coeur` : undefined}
          />
        ) : null}
      </View>

      <View style={{ gap: 4 }}>
        <Texte
          variante="type.titreDApercu"
          testID={testID ? `${testID}-nom` : undefined}
        >
          {nom}
        </Texte>
        <Texte
          variante="type.caption"
          couleur="ink.soft"
          testID={testID ? `${testID}-attribution` : undefined}
          // Le seul des trois textes qui s'ellipse : c'est un nom propre de
          // salon, et le tronquer perd un mot qu'on retrouve sur la fiche. Le
          // nom de la prestation, lui, se replie sur deux lignes plutôt que de
          // se couper — c'est ce qu'on est venu lire.
          ellipseSurNomPropre
        >
          {attribution}
        </Texte>

        {/* La case, toujours rendue. Nommée pour qu'un test puisse vérifier
            qu'elle tient sa hauteur quand elle est vide — c'est l'état qu'on
            n'écrit jamais dans un montage, et donc le seul qui casse. */}
        <View
          testID={testID ? `${testID}-case-contrepartie` : undefined}
          style={{ height: CASE_DU_BADGE, justifyContent: 'center' }}
        >
          {contrepartie ? (
            <View
              testID={testID ? `${testID}-contrepartie` : undefined}
              style={{
                alignSelf: 'flex-start',
                borderRadius: radius['radius.sm'],
                backgroundColor: c['brand.100'],
                paddingHorizontal: 9,
                paddingVertical: 4,
              }}
            >
              {/* **`brand.900` et non `brand.700`.** La planche pose l'ambre
                  moyen sur l'ambre clair : mesuré, c'est 4,19:1, sous le 4,5
                  qu'un texte de cette taille demande. Le dernier cran de la
                  rampe donne 8,84:1 et garde l'ambre sur ambre que la planche
                  veut. La teinte était l'intention, la valeur était le défaut —
                  et c'est la quatrième réserve de contraste de cette direction,
                  mesurée et non relue. */}
              <Texte variante="type.dataLabel" couleur="brand.900">
                {contrepartie.toUpperCase()}
              </Texte>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}


/**
 * Le cœur, posé sur la photo.
 *
 * **Chercher et garder ne se posent pas au même endroit.** La recherche est une
 * barre : elle s'adresse à l'écran entier. Le cœur est sur l'objet, et il ne
 * s'adresse qu'à lui. Aucun des deux n'emprunte la forme de l'autre.
 *
 * **Trente-deux points, sous la cible de quarante-quatre**, et c'est admis pour
 * deux raisons qui tiennent ensemble : la zone tactile déborde le dessin de six
 * points de chaque côté, et la carte entière reste pressable autour — rater le
 * cœur ouvre la fiche, ce qui n'est pas une erreur destructrice.
 *
 * **Le voile blanc existe déjà** pour les pastilles de photo : le cœur
 * n'introduit aucune surface nouvelle.
 */
function CoeurDeLaCarte({
  actif,
  onPress,
  testID,
}: {
  actif: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const { t } = useI18n();
  const c = useColors();

  return (
    <Pressable
      testID={testID}
      // **`switch` et `checked`, comme le `Toggle` du dépôt.** L'intention
      // était juste — « l'état, pas seulement l'action » — mais le couple
      // choisi ne la tenait pas : `selected` sur un `button` ne produit aucun
      // attribut que React Native Web sache rendre, donc l'état n'était annoncé
      // nulle part. Un cœur est un interrupteur ; il en a le rôle et l'état.
      accessibilityRole="switch"
      // `aria-checked` pour le web — la seule que cette version de React Native
      // Web lise — et `accessibilityState` pour le natif, qui ne connaît qu'elle.
      aria-checked={actif}
      accessibilityState={{ checked: actif }}
      accessibilityLabel={t(actif ? 'parcours.filRetirerDesFavoris' : 'parcours.filMettreEnFavori')}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        position: 'absolute',
        top: 8,
        right: 8,
        width: 32,
        height: 32,
        borderRadius: radius['radius.pill'],
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: c['scrim.badge'],
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {/* **`brand.700` et non `brand.500`, et c'est mesuré.** La planche
          demande l'orange de marque ; sur le voile blanc de la pastille il
          donne 2,36:1, sous les 3:1 qu'un élément graphique porteur
          d'information doit tenir. Or le remplissage est ici **le seul signe**
          qui distingue « gardé » de « pas gardé » : le rendre à peine visible
          revient à ne pas le rendre. `brand.700` est l'encre calibrée de la
          marque — 5,29:1 — et c'est déjà elle que portent les autres glyphes
          orange du produit. */}
      <Icone
        nom="coeur"
        couleur={actif ? 'brand.700' : 'ink.default'}
        taille={18}
        rempli={actif}
      />
    </Pressable>
  );
}
