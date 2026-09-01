/**
 * Comment y aller. **Une action, plus un bloc.**
 *
 * **L'adresse est écrite une fois, en tête de la fiche.** Ce bloc s'intitulait
 * « Where it is » et la répétait à trois lignes d'elle-même, précédée d'un
 * titre qui annonçait ce que le lecteur venait de lire. Chacune des trois
 * lignes était juste ; ensemble elles disaient une seule chose trois fois.
 *
 * **Ce qui reste est le geste, et lui seul l'agrandit.** Un lien de treize
 * points au bas d'un bloc est une note de fin ; c'est pourtant la seule chose
 * qu'on vienne y faire — partir. Il prend donc toute la largeur, un glyphe
 * cerclé, deux lignes, et une cible d'un seul tenant.
 *
 * **La distance reste, parce qu'elle n'est écrite nulle part ailleurs.** Elle
 * dépend d'où l'on est à l'instant où l'on regarde ; l'adresse, elle, situe une
 * fois qu'on a décidé. Le nombre décide, donc il accompagne le geste.
 *
 * **Ce bloc n'est pas une carte à tuiles, et c'est une décision.** Une vraie
 * carte demande un fournisseur, une clé et une facturation à l'appel : trois
 * choses qui se tranchent avec celui qui paie, pas dans un écran. Ce qui est
 * livrable sans rien signer répond déjà aux deux questions qu'on se pose ici —
 * *est-ce loin*, et *emmène-moi* — la seconde en passant la main au plan du
 * téléphone, qui sait faire l'itinéraire mieux qu'une vignette.
 *
 * **La distance se calcule ici et non au serveur.** Elle dépend d'où l'on est
 * à l'instant où l'on regarde ; la demander à la fiche la figerait à la
 * position du chargement, et l'écran est ouvert longtemps.
 */
import { Linking, Pressable, View } from 'react-native';

import { Icone, Texte } from '../../components';
import { formatDistance } from '../../format';
import { useI18n } from '../../i18n';
import { elevationDeCarte, radius, useColors } from '../../theme';

/** Le rayon moyen de la Terre, en mètres. */
const RAYON_TERRESTRE = 6_371_000;

/**
 * La distance à vol d'oiseau entre deux points, en mètres.
 *
 * **À vol d'oiseau, et l'écran ne prétend pas autre chose.** Un itinéraire est
 * toujours plus long ; ce qu'on cherche ici est l'ordre de grandeur qui décide
 * entre « j'y vais à pied » et « je prends la voiture », et la ligne droite y
 * suffit. Le plan du téléphone donnera le vrai trajet.
 */
export function distanceAVolDOiseau(
  a: { longitude: number; latitude: number },
  b: { longitude: number; latitude: number },
): number {
  const enRadians = (degres: number) => (degres * Math.PI) / 180;
  const dLat = enRadians(b.latitude - a.latitude);
  const dLon = enRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(enRadians(a.latitude)) * Math.cos(enRadians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * RAYON_TERRESTRE * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * L'adresse d'un plan, dans la langue des plateformes.
 *
 * **Une seule adresse pour les trois cibles, et c'est délibéré.** `maps.apple.com`
 * ouvre Plans sur iOS, une page web ailleurs — y compris sur Android et au
 * navigateur. Le schéma `geo:` serait plus juste sur Android mais ne mène nulle
 * part sur le web, qui est la cible que la démonstration distribue : une page
 * qui montre le point vaut mieux qu'un lien mort.
 */
export function adresseDuPlan(
  point: { longitude: number; latitude: number },
  nom: string,
): string {
  const q = encodeURIComponent(nom);
  return `https://maps.apple.com/?q=${q}&ll=${point.latitude},${point.longitude}`;
}

export function OuEstLeLieu({
  nom,
  lieu,
  position,
  testID = 'ou-est-le-lieu',
}: {
  nom: string;
  /** Nul quand le géocodage n'a rien résolu : le bloc se tait alors. */
  lieu: { longitude: number; latitude: number } | null;
  /** Nulle tant que la créatrice n'a pas partagé sa position. */
  position: { longitude: number; latitude: number } | null;
  testID?: string;
}) {
  const { t, locale } = useI18n();
  const c = useColors();

  // **Sans coordonnées, rien.** L'adresse est déjà rendue plus haut sur la
  // fiche ; un bloc qui la répéterait sans rien ajouter serait une ligne de
  // plus à lire pour apprendre ce qu'on vient de lire.
  if (lieu === null) return null;

  const metres = position === null ? null : distanceAVolDOiseau(position, lieu);

  return (
    <Pressable
      testID={testID}
      accessibilityRole="link"
      accessibilityLabel={t('parcours.ouEstLeLieuOuvrir')}
      onPress={() => void Linking.openURL(adresseDuPlan(lieu, nom))}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        // **La cible est la carte entière.** Un lien au bas d'un bloc demande
        // de viser treize points de texte ; ici la ligne se presse d'un bout à
        // l'autre, ce qui est aussi ce que sa hauteur promet.
        padding: 16,
        borderRadius: radius['radius.lg'],
        backgroundColor: c['bg.surface'],
        borderWidth: 1,
        borderColor: c['line.default'],
        opacity: pressed ? 0.7 : 1,
        // « Un coin de 18 px sans ombre flotte au lieu de se poser » : la règle
        // vaut des douze surfaces, pas d'une seule.
        ...elevationDeCarte(),
      })}
    >
      {/* Le glyphe cerclé, en teinte de marque : c'est la seule chose de la
          fiche qui fasse sortir du produit, et elle a droit à sa pastille. */}
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: radius['radius.pill'],
          backgroundColor: c['brand.50'],
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icone nom="lieu" couleur="brand.700" taille={20} />
      </View>

      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Texte variante="type.bodyStrong">{t('parcours.ouEstLeLieuOuvrir')}</Texte>
        {/* **La distance en second, et jamais inventée.** Absente tant que la
            position n'est pas partagée, et on ne la réclame pas ici : le fil
            l'a déjà demandée là où elle sert. */}
        {metres === null ? (
          <Texte variante="type.body" couleur="ink.soft" testID={`${testID}-sans-position`}>
            {t('parcours.ouEstLeLieuSansPosition')}
          </Texte>
        ) : (
          <Texte variante="type.body" couleur="ink.soft" testID={`${testID}-distance`}>
            {t('parcours.ouEstLeLieuDistance', { distance: formatDistance(metres, locale) })}
          </Texte>
        )}
      </View>

      {/* Le glyphe de sortie, et non un chevron : la différence se voit avant
          l'appui, pas après — cela quitte le produit. */}
      <Icone nom="sortie" couleur="ink.soft" taille={18} />
    </Pressable>
  );
}
