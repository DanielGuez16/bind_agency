/**
 * 02a · Les paliers du créateur. Un échange ordonné, pas un historique.
 *
 * **Le seul écran que personne n'a compris en le lisant** — y compris celle qui
 * a conçu le système, qui a cru y voir ses anciennes publications. La cause
 * était structurelle : l'écran énumérait des **états**, « Story · Instagram ·
 * Ouvert », six fois en cartes identiques. Une liste de formats de publication
 * accompagnés d'un état se lit comme un historique. Rien dans la forme ne
 * disait qu'il s'agissait d'un droit d'accès, ni que ces droits étaient
 * ordonnés.
 *
 * **Chaque palier est un échange, en deux colonnes.** Ce que je donne à gauche,
 * ce que j'obtiens à droite, séparés par un filet. Sur un palier fermé les deux
 * intitulés passent au conditionnel — « you would give », « you would get » —
 * et c'est la seule variation de copie entre ouvert et fermé : elle suffit à
 * dire que le second est une projection.
 *
 * **La progression est portée par la matière, jamais par la couleur.** Contour,
 * teinte, aplat : la même échelle que le `TierBadge`, portée à la taille de la
 * carte. Elle se lit en niveaux de gris, ce qui reste la règle du produit.
 *
 * **La plateforme est orthogonale à l'échelle, donc elle passe en onglets.**
 * L'API répond par couples plateforme × format, soit jusqu'à six cartes. Six
 * cartes mélangées cassent l'échelle : « story fermé » sous « story ouvert » se
 * lit comme une contradiction, et la progression disparaît. Sous l'onglet,
 * trois barreaux et trois seulement.
 *
 * **L'écart n'est chiffré qu'à partir de 60 % du seuil.** En dessous, le palier
 * est un horizon : le seuil, une phrase, et surtout aucune barre — une jauge
 * presque vide décourage plus qu'elle n'informe, et une projection de rythme
 * serait un engagement que le produit ne tient pas. La bascule vit dans
 * `formeDe`, jamais dans la mise en page.
 *
 * **Aucun palier fermé n'est atténué.** Ni opacité, ni compactage, ni repli.
 * C'est une divergence assumée avec la fiche salon, où un palier fermé passe à
 * 0,75 : là-bas il encombre, ici il oriente. Un palier fermé porte
 * l'information la plus utile de l'écran — ce qui manque, et ce que cela
 * ouvrirait.
 *
 * **Quand la même cause ferme tous les paliers, elle passe devant.** Un compte
 * absent, en vérification ou sans relevé ferme les six d'un coup. La raison est
 * annoncée en tête avec son issue, l'échelle reste lisible dessous, et la cause
 * commune est **retirée de chaque barreau** : la répéter six fois, c'est six
 * fois la même mauvaise nouvelle et aucune action. Un palier qu'elle seule
 * ferme n'est pas perdu, il est en pause — et quatre mots le disent.
 */
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { useApi, type Obstacle, type PalierAccessible, type VueDesPaliers } from '../api';
import {
  Apparition,
  EnTeteDEcran,
  Filet,
  Icone,
  LigneDeContrepartie,
  SegmentedTabs,
  SkeletonLignes,
  StatusMessage,
  Texte,
  TierBadge,
  type Palier,
} from '../components';
import { formatNumber } from '../format';
import { useI18n } from '../i18n';
import { en } from '../i18n/en';
import { useGabarit } from '../shell/gabarit';
import { type ColorName, elevationDeCarte, matiereDePalier, radius, tierTokens, useColors, useTheme } from '../theme';
import { Ecran } from './Ecran';
import { Jauge, ReglesDesPaliers } from './ReglesDesPaliers';
import { RaisonDuVide } from './RaisonDuVide';
import { formeDe, messageDObstacle, nomDePlateforme } from './obstacle';
import { AGES } from './cacheDesReponses';
import { useRequete } from './useRequete';

const CODES_CONNUS = new Set(Object.keys(en.errors));

/** L'ordre des formats. Celui des jetons, jamais celui de la base. */
const ORDRE = tierTokens.order as readonly Palier[];

/**
 * Les obstacles qui ne se lèvent pas en gagnant des abonnés.
 *
 * Ils portent sur le compte, pas sur un palier. Quand ils sont communs à tous,
 * les cartes n'ont plus rien à dire d'utile et la raison passe devant.
 */
const BLOQUANTS = new Set([
  'no_social_account',
  'account_rejected',
  'account_token_invalid',
  'account_under_review',
  'no_metrics',
  'metrics_stale',
]);

/** Là où l'échelle s'arrête et où les règles commencent, sur grand écran. */
const LARGEUR_DE_L_ECHELLE = 720;
const LARGEUR_DES_REGLES = 360;
/** Le bandeau de format, sur grand écran : à gauche, en colonne. */
const LARGEUR_DU_BANDEAU = 150;
/**
 * Le rayon sur lequel se comptent les prestations proches.
 *
 * Le même que celui d'où part le fil : deux valeurs différentes feraient dire
 * « neuf à moins de quinze kilomètres » ici et en montreraient douze là-bas.
 */
export const RAYON_DES_PALIERS_KM = 15;

/** La colonne « ce que je donne » en bureau. Fixe, pour aligner les barreaux. */
const LARGEUR_DU_DON = 210;

export function PaliersScreen({
  prenom = null,
  /**
   * D'où l'on est. Nulle, les comptes de proximité restent nuls et l'écran
   * n'écrit que le total — « on ne sait pas où vous êtes » ne se dit pas
   * « aucune près de chez vous ».
   */
  position = null,
  rayonKm = RAYON_DES_PALIERS_KM,
  onRetour,
  onConnecterUnReseau,
  onVoirMonAudience,
  onLireLesRegles,
  onVoirLesPrestations,
}: {
  /**
   * Le prénom, résolu par la coquille.
   *
   * L'écran ne lit pas la session lui-même : il deviendrait impossible à
   * monter sans elle, et c'est le genre de dépendance qui se propage d'un
   * écran au suivant jusqu'à ce que plus rien ne se teste isolément.
   */
  prenom?: string | null;
  position?: { longitude: number; latitude: number } | null;
  rayonKm?: number;
  /** Mène là où l'on rattache un réseau. Absent chez qui n'y a pas accès. */
  onConnecterUnReseau?: () => void;
  onVoirMonAudience?: () => void;
  /**
   * Le retour vers le fil.
   *
   * **L'écran n'est plus un onglet, il est une explication.** On l'ouvre depuis
   * la ligne qui annonce ce qui est ouvert, et on en revient — un écran empilé
   * sans retour est un cul-de-sac sur les plateformes qui n'ont pas de geste
   * système pour reculer.
   */
  onRetour?: () => void;
  /** Mobile seulement : en bureau les règles sont la colonne de droite. */
  onLireLesRegles?: () => void;
  /**
   * Mène à la découverte filtrée sur ce palier.
   *
   * Absent tant que le fil ne sait pas filtrer par palier : une porte qui
   * annonce « les 12 prestations » et ouvre sur le catalogue entier ment plus
   * qu'elle ne rend service. Sans elle, le compte reste affiché sans être
   * cliquable — c'est déjà un des états prévus, celui du palier fermé.
   */
  onVoirLesPrestations?: (palier: PalierAccessible) => void;
}) {
  const { api } = useApi();
  const { t, locale } = useI18n();
  // **La place, et non la largeur.** La colonne des règles est fixe : sans la place, elle passe sous l'échelle.
  // Au seuil de bascule il ne restait que quelques centaines de points
  // au corps, sans que rien ne déborde — c'est la comparaison des deux
  // colonnes qui dit le défaut, pas un dépassement.
  const { place } = useGabarit();
  const large = place(LARGEUR_DES_REGLES);

  // **Les comptes de proximité étaient nuls partout**, parce que personne ne
  // les demandait : le serveur les rend, l'écran les lit, et aucune coordonnée
  // ne partait. « Neuf prestations chez six salons » ne pouvait donc jamais
  // s'écrire.
  const requete = useRequete<VueDesPaliers>(
    (signal) => api.mesPaliers({ autourDe: position, rayonMetres: rayonKm * 1000 }, signal),
    {
    // Vide veut dire « aucun palier configuré », un cas de plateforme. Un
    // créateur sans accès n'est **pas** vide : il a des paliers à lire, tous
    // fermés, et c'est justement l'écran qui doit le lui expliquer.
    estVide: (vue) => vue.paliers.length === 0,
    dependances: [position?.longitude, position?.latitude],
    // Les seuils sont de la configuration ; ce qui bouge dans cette réponse
    // sont les comptes de proximité, et un compte d'hier vaut mieux qu'un
    // écran vide pendant qu'on le recompte. Le rayon est dans la clé, la
    // position non — elle change de quelques mètres à chaque relevé.
    cache: { cle: `mes-paliers.${rayonKm}`, ageMax: AGES.configuration },
  },
  );

  return (
    <Ecran
      requete={requete}
      testID="ecran-paliers"
      squelette={<SkeletonLignes combien={6} testID="squelette-paliers" />}
      nature="creator"
      onRetour={onRetour}
      titre={t('parcours.tiersTitre')}
      entete={
        // En grand écran le titre vit déjà dans la barre de titre : le répéter
        // ici donnerait « Your tiers » au-dessus de « Your tiers », le défaut
        // relevé ailleurs dans la coquille.
        large ? undefined : (
          <EnTeteDEcran
            titre={t('parcours.tiersTitre')}
            surtitre={prenom ? t('tiers.greeting', { prenom }) : null}
            testID="entete-paliers"
          />
        )
      }
      vide={<StatusMessage level="neutral" body={t('parcours.tiersVide')} />}
    >
      {(vue) => (
        <Echelle
          vue={vue}
          issues={{ onConnecterUnReseau, onVoirMonAudience }}
          onLireLesRegles={onLireLesRegles}
          onVoirLesPrestations={onVoirLesPrestations}
        />
      )}
    </Ecran>
  );
}

/** Un groupe d'onglet : une plateforme et ses trois formats, dans l'ordre. */
type Groupe = { platform: string; paliers: PalierAccessible[]; ouverts: number };

/**
 * Regroupe par plateforme et trie par format croissant.
 *
 * Exporté pour être éprouvé sans écran : l'ordre est une règle produit — la
 * progression ne se voit que si elle monte — et non une mise en page.
 */
export function grouperParPlateforme(paliers: PalierAccessible[]): Groupe[] {
  const groupes: Groupe[] = [];

  for (const palier of paliers) {
    let groupe = groupes.find((g) => g.platform === palier.platform);
    if (!groupe) {
      groupe = { platform: palier.platform, paliers: [], ouverts: 0 };
      groupes.push(groupe);
    }
    groupe.paliers.push(palier);
    if (palier.accessible) groupe.ouverts += 1;
  }

  for (const groupe of groupes) {
    groupe.paliers.sort(
      (a, b) =>
        ORDRE.indexOf(a.content_format as Palier) - ORDRE.indexOf(b.content_format as Palier),
    );
  }
  return groupes;
}

/** L'état d'un barreau. Quatre, et un seul par palier. */
export type EtatDuBarreau = 'ouvert' | 'prochain' | 'lointain' | 'enPause';

function Echelle({
  vue,
  issues,
  onLireLesRegles,
  onVoirLesPrestations,
}: {
  vue: VueDesPaliers;
  issues: { onConnecterUnReseau?: () => void; onVoirMonAudience?: () => void };
  onLireLesRegles?: () => void;
  onVoirLesPrestations?: (palier: PalierAccessible) => void;
}) {
  const { t, locale } = useI18n();
  const { large } = useGabarit();
  const [plateforme, setPlateforme] = useState<string | null>(null);

  // Les obstacles que **tous** les paliers partagent : ceux-là ne parlent pas
  // d'un palier mais du compte, et un seul geste les lève.
  const communs = vue.paliers.length
    ? vue.paliers[0].obstacles.filter((obstacle) =>
        vue.paliers.every((autre) => autre.obstacles.some((o) => o.raison === obstacle.raison)),
      )
    : [];
  const bloquant = communs.some((o) => BLOQUANTS.has(o.raison));
  const raisonsCommunes = new Set(bloquant ? communs.map((o) => o.raison) : []);

  const groupes = grouperParPlateforme(vue.paliers);
  const index = Math.max(
    0,
    groupes.findIndex((g) => g.platform === plateforme),
  );
  const courant = groupes[index];
  const paliers = courant?.paliers ?? [];

  // Le palier le plus généreux de **la liste affichée** donne l'échelle des
  // barres. C'est là que la générosité croissante devient visible sans lecture.
  //
  const sommet = Math.max(1, ...paliers.map((p) => p.offres_disponibles));

  const propres = (palier: PalierAccessible) =>
    palier.obstacles.filter((o) => !raisonsCommunes.has(o.raison));

  /**
   * Le palier ouvert le plus généreux, et lui seul.
   *
   * **La réponse à la question qu'on vient poser.** Ce n'est pas une somme :
   * `offres_disponibles` compte les offres **de ce palier**, et une même
   * prestation proposée à deux paliers y figure deux fois. Additionner les
   * paliers ouverts annoncerait un catalogue plus grand que le vrai — le genre
   * de nombre que personne ne vérifie parce qu'il reste plausible.
   *
   * Le plus généreux plutôt que le plus haut : c'est celui qui ouvre le plus,
   * et c'est ce qu'on veut savoir. Nul quand rien n'est ouvert — le titre se
   * tait alors, et l'échelle dit ce qui manque.
   */
  const meilleurOuvert = paliers
    .filter((palier) => palier.accessible && palier.offres_disponibles > 0)
    .reduce<PalierAccessible | null>(
      (garde, palier) =>
        garde === null || palier.offres_disponibles > garde.offres_disponibles ? palier : garde,
      null,
    );

  // Le premier fermé de l'échelle, et lui seul, est un objectif. Quand une
  // cause commune ferme tout, aucun ne l'est : le prochain geste est de
  // réparer le compte, pas de viser un palier.
  const prochain = bloquant ? null : (paliers.find((p) => !p.accessible)?.tier_id ?? null);

  const etatDe = (palier: PalierAccessible): EtatDuBarreau => {
    if (palier.accessible) return 'ouvert';
    // Rien d'autre que la cause commune ne le ferme : il était ouvert, il le
    // redeviendra. « En pause, pas perdu » — c'est la question qu'on se pose
    // devant cet écran, et quatre mots y répondent.
    if (bloquant && propres(palier).length === 0) return 'enPause';
    return palier.tier_id === prochain ? 'prochain' : 'lointain';
  };

  const echelle = (
    <View style={{ gap: 14, flex: 1 }}>
      {bloquant ? (
        <>
          <RaisonDuVide obstacles={communs} issues={issues} testID="paliers-bloques" />
          {/* Pourquoi l'échelle est encore là, sous une mauvaise nouvelle. */}
          <Texte variante="type.label" couleur="ink.soft" style={{ fontWeight: '400' }} testID="encore-la">
            {t('tiers.stillWaiting')}
          </Texte>
        </>
      ) : null}

      {/* **Ce qu'on peut réserver, avant comment le système marche.** L'écran
          s'ouvrait sur le principe — « plus le format engage, plus il ouvre » —
          en bandeau d'encre avec trois barres qui montent. C'est une règle, et
          une règle bien écrite : elle a fait lire l'écran comme la description
          d'un mécanisme, deux campagnes de suite. La question qu'une créatrice
          vient poser est « qu'est-ce que je peux réserver maintenant », et la
          réponse tenait dans un chiffre au milieu d'un barreau.
          Le principe n'est pas retiré, il descend : il explique l'échelle une
          fois qu'on a vu ce qu'elle ouvre. */}
      {!bloquant && meilleurOuvert ? (
        <Apparition>
          <Texte variante="type.screenTitle" testID="ce-qui-est-ouvert">
            {t('tiers.ouvertMaintenant', {
              count: meilleurOuvert.offres_disponibles,
              palier: t(`parcours.format_${meilleurOuvert.content_format}`),
            })}
          </Texte>
        </Apparition>
      ) : null}

      {vue.is_new_creator ? (
        <Apparition rang={1}>
          <StatusMessage
            level="neutral"
            title={t('tiers.newCreatorBadge')}
            body={t('tiers.newCreatorHelp')}
            testID="badge-nouveau"
          />
        </Apparition>
      ) : null}

      {/* Un seul réseau connecté : l'onglet unique n'offrirait aucun choix et
          répéterait un nom déjà donné par chaque obstacle. */}
      {groupes.length > 1 ? (
        <SegmentedTabs
          testID="onglets-plateforme"
          index={index}
          onChange={(i) => setPlateforme(groupes[i].platform)}
          items={groupes.map((groupe) => ({
            label: `${nomDePlateforme(groupe.platform)} · ${t('tiers.openCount', {
              count: groupe.ouverts,
            })}`,
          }))}
        />
      ) : null}

      {paliers.map((palier, rang) => (
        <Apparition key={palier.tier_id} rang={rang + 2}>
          <BarreauDePalier
            palier={palier}
            etat={etatDe(palier)}
            obstacles={propres(palier)}
            sommet={sommet}
            onVoirLesPrestations={onVoirLesPrestations}
          />
        </Apparition>
      ))}

      {/* Le principe, après l'échelle : il explique ce qu'on vient de voir au
          lieu de le précéder. */}
      {!bloquant ? <BandeauDePrincipe /> : null}

      {/* Le compte porte sur tout BIND, pas sur le rayon : sans cette ligne,
          « 12 prestations » se lit comme « 12 autour de moi ». */}
      <Texte variante="type.caption" couleur="ink.mute" testID="portee-des-comptes">
        {t('tiers.opensHelp')}
      </Texte>

      {/* En bureau les règles sont à droite : une porte vers elles y mènerait
          à ce qu'on a déjà sous les yeux. */}
      {!large && onLireLesRegles ? <PorteDesRegles onPress={onLireLesRegles} /> : null}
    </View>
  );

  if (!large) return echelle;

  return (
    <View style={{ flexDirection: 'row', gap: 24, alignItems: 'flex-start' }}>
      <View style={{ flex: 1, maxWidth: LARGEUR_DE_L_ECHELLE }}>{echelle}</View>
      <View style={{ width: LARGEUR_DES_REGLES }}>
        <ReglesDesPaliers fiabilite={vue.fiabilite} testID="regles-en-colonne" />
      </View>
    </View>
  );
}

/**
 * Le principe, et son diagramme.
 *
 * **Le seul endroit du produit où les trois formats se voient ensemble**, et ce
 * qui fait tenir la promesse des trois secondes : trois barres qui montent
 * disent la règle avant que la phrase soit lue.
 *
 * **Les trois barres portent la matière du palier, pas sa teinte.** Depuis la
 * v1.0 il n'y a plus qu'une teinte de marque : ce sont le contour, la teinte et
 * l'aplat qui montent. La progression reste ordinale — de moins de matière à
 * plus de matière — et elle se lit en niveaux de gris, ce que trois couleurs ne
 * garantissaient qu'en théorie.
 *
 * Le bandeau est posé sur l'encre, et les matières y sont prises dans leur
 * variante sombre : contour et teinte s'éclaircissent, l'aplat ne bouge pas.
 */
function BandeauDePrincipe() {
  const { t, locale } = useI18n();
  const c = useColors();
  const { large } = useGabarit();

  const hauteurs: Record<Palier, number> = large
    ? { story: 16, post: 32, reel: 50 }
    : { story: 18, post: 34, reel: 52 };

  return (
    <Apparition>
      <View
        testID="bandeau-de-principe"
        style={{
          borderRadius: radius['radius.lg'],
          backgroundColor: c['bg.inverse'],
          padding: large ? 20 : 16,
          gap: large ? 0 : 12,
          flexDirection: large ? 'row' : 'column',
          alignItems: large ? 'center' : undefined,
        }}
      >
        <Texte
          variante={large ? 'type.bodyStrong' : 'type.body'}
          couleur="ink.onDark"
          style={{ flex: large ? 1 : undefined, fontWeight: large ? '400' : undefined }}
          testID="principe"
        >
          {t('tiers.principe')}
        </Texte>

        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: large ? 10 : 8,
            width: large ? 200 : undefined,
          }}
        >
          {ORDRE.map((palier) => {
            const m = matiereDePalier(palier, true);
            return (
              <View key={palier} style={{ flex: 1, gap: 6 }}>
                <View
                  testID={`principe-barre-${palier}`}
                  style={{
                    height: hauteurs[palier],
                    backgroundColor: c[m.surface],
                    borderWidth: m.epaisseur,
                    borderColor: m.bordure === 'transparent' ? 'transparent' : c[m.bordure],
                  }}
                />
                <Texte variante="type.monoSmall" couleur={m.texte} style={{ fontSize: 10 }}>
                  {tierTokens[palier].label[locale] ?? tierTokens[palier].label.en}
                </Texte>
              </View>
            );
          })}
        </View>
      </View>
    </Apparition>
  );
}

function PorteDesRegles({ onPress }: { onPress: () => void }) {
  const { t, locale } = useI18n();
  const c = useColors();

  return (
    <Pressable
      testID="porte-des-regles"
      accessibilityRole="button"
      accessibilityLabel={t('tiers.rulesEntry')}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 16,
        borderRadius: radius['radius.lg'],
        borderWidth: 1,
        borderColor: c['line.default'],
        backgroundColor: c['bg.surface'],
          opacity: pressed ? 0.7 : 1,
          // Même défaut que la carte de configuration, et même raison de ne pas
          // l'avoir vu : l'inventaire ne lisait pas les styles fonction, donc
          // aucune carte pressable n'était comptée.
          ...elevationDeCarte(),
        })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Texte variante="type.bodyStrong">{t('tiers.rulesEntry')}</Texte>
        <Texte variante="type.caption" couleur="ink.mute">
          {t('tiers.rulesEntryHelp')}
        </Texte>
      </View>
      <Icone nom="chevron" couleur="brand.700" taille={20} />
    </Pressable>
  );
}

/**
 * Un barreau de l'échelle : ce que je donne, ce que j'obtiens.
 *
 * En bureau le bandeau de format passe à gauche : les trois matières s'empilent
 * alors en colonne, et la progression contour → teinte → aplat se lit
 * verticalement, sans avoir à comparer trois en-têtes éloignés.
 */
export function BarreauDePalier({
  palier,
  etat,
  obstacles,
  sommet,
  onVoirLesPrestations,
}: {
  palier: PalierAccessible;
  etat: EtatDuBarreau;
  /** Les obstacles propres au palier : la cause commune est déjà en tête. */
  obstacles: Obstacle[];
  /** Le plus généreux de la liste. Donne l'échelle de la barre « you get ». */
  sommet: number;
  onVoirLesPrestations?: (palier: PalierAccessible) => void;
}) {
  const { t, locale } = useI18n();
  const c = useColors();
  const { large } = useGabarit();

  const format = palier.content_format as Palier;
  // **Le bandeau prend la matière du palier, plus sa teinte `subtle`.** Les
  // trois teintes distinctes n'existent plus ; ce qui distingue les paliers est
  // la façon dont l'unique orange est posé, à l'échelle de la carte comme à
  // celle du badge.
  const m = matiereDePalier(format);
  const plein = m.matiere === 'solid';
  const fondDuBandeau = c[m.surface];
  // **La bordure de la carte suit la matière, sans la copier.** L'aplat n'a pas
  // de filet sur le badge — c'est ce qui le rend plein — mais la carte en a
  // besoin pour se détacher du fond : `brand.500`, comme la teinte.
  const bordureDeCarte: ColorName = m.matiere === 'solid' ? 'brand.500' : m.bordure as ColorName;
  // Sur le corps de la carte, qui est papier, l'encre de marque est toujours
  // `brand.700` : c'est la seule valeur de la rampe qui s'écrit.
  const encre: ColorName = 'brand.700';

  const ouvert = etat === 'ouvert';
  // La seule variation de copie entre ouvert et fermé. Elle suffit à dire que
  // le second est une projection.
  const donne = ouvert ? t('tiers.giveLabel') : t('tiers.giveLabelLocked');
  const obtient = ouvert ? t('tiers.getLabel') : t('tiers.getLabelLocked');

  const porteOuverte = ouvert && palier.offres_disponibles > 0 && Boolean(onVoirLesPrestations);

  const bandeau = (
    <View
      testID={`bandeau-${palier.tier_id}`}
      style={{
        backgroundColor: fondDuBandeau,
        padding: large ? 14 : 10,
        paddingHorizontal: 14,
        gap: large ? 10 : 0,
        flexDirection: large ? 'column' : 'row',
        alignItems: large ? 'flex-start' : 'center',
        width: large ? LARGEUR_DU_BANDEAU : undefined,
        borderBottomWidth: large ? 0 : 1,
        borderRightWidth: large ? 1 : 0,
        borderColor: plein ? fondDuBandeau : c[bordureDeCarte],
      }}
    >
      <TierBadge tier={format} />
      {large ? null : <View style={{ flex: 1 }} />}
      <EtatDuPalier etat={etat} teinte={m.texte} plein={plein} />
    </View>
  );

      {/* **La porte n'existait qu'en bureau, et c'est le défaut.** Le compte
      est une porte — « douze prestations vous sont ouvertes » répond à la
      question qu'on se pose en ouvrant l'application — mais
      `large && porteOuverte` la retirait du téléphone, c'est-à-dire de
      l'appareil où une créatrice lit cet écran. Le nombre s'affichait et ne
      menait nulle part, exactement ce que l'écran 11c avait été écrit pour
      corriger. */}
  /**
   * La porte, en bureau seulement — et ce n'est pas un oubli.
   *
   * Sur téléphone elle existe aussi, mais en pleine largeur au pied de la
   * carte, sous un filet : la rangée d'échange y porte déjà le don et le
   * compte, et une troisième colonne écraserait les deux. Deux emplacements
   * pour un même geste, chacun dicté par la place disponible.
   */
  const porte = porteOuverte ? (
    <Pressable
      testID={`vers-prestations-${palier.tier_id}`}
      accessibilityRole="button"
      accessibilityLabel={t('tiers.seeServices', { count: palier.offres_disponibles })}
      onPress={() => onVoirLesPrestations?.(palier)}
      style={({ pressed }) => ({
        minHeight: 40,
        justifyContent: 'center',
        alignItems: large ? undefined : 'center',
        paddingHorizontal: 14,
        borderRadius: radius['radius.lg'],
        borderWidth: 1,
        borderColor: c[bordureDeCarte],
      opacity: pressed ? 0.7 : 1,
    })}
    >
      <Texte variante="type.label" couleur={encre}>
        {t('tiers.seeShort')}
      </Texte>
    </Pressable>
  ) : null;

  const echange = (
    <View
      style={{
        padding: large ? 16 : 14,
        flexDirection: 'row',
        alignItems: large ? 'center' : 'stretch',
        gap: large ? 20 : 12,
      }}
    >
      <View style={{ width: large ? LARGEUR_DU_DON : undefined, flex: large ? undefined : 1, minWidth: 0, gap: 4 }}>
        <Texte variante="type.caption" couleur="ink.mute">
          {donne}
        </Texte>
        <LigneDeContrepartie tier={format} />
      </View>

      <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: c['line.default'] }} />

      <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
        <Texte variante="type.caption" couleur="ink.mute">
          {obtient}
        </Texte>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
          <Texte variante="type.figureSmall" testID={`ouvre-${palier.tier_id}`}>
            {formatNumber(palier.offres_disponibles, locale)}
          </Texte>
          <Texte variante="type.caption" couleur="ink.soft">
            {t('tiers.services')}
          </Texte>
        </View>
        <Jauge
          part={palier.offres_disponibles / sommet}
          teinte={encre}
          testID={`part-${palier.tier_id}`}
        />
      </View>

      {large ? porte : null}

    </View>
  );

  // **L'ombre est portée par la vue extérieure, et c'est obligatoire.** Celle
  // du dessous clippe son contenu — c'est ce qui fait épouser le coin de 18 px
  // à ses bandes internes — et sur iOS une vue qui clippe coupe sa propre ombre
  // au même bord. Les deux ne peuvent pas vivre sur le même nœud. La vue
  // extérieure reprend le rayon et le fond, parce qu'iOS calcule l'ombre depuis
  // la couche opaque : sans fond, il n'y a rien dont projeter la silhouette.
  return (
    <View
      style={{
        borderRadius: radius['radius.lg'],
        backgroundColor: c['bg.surface'],
        ...elevationDeCarte(),
      }}
    >
      <View
        testID={`palier-${palier.tier_id}`}
        style={{
          borderRadius: radius['radius.lg'],
          // Le prochain palier porte deux pixels. C'est le seul objectif de
          // l'écran, et l'épaisseur le dit sans couleur.
          borderWidth: etat === 'prochain' ? 2 : 1,
          // Le prochain palier porte deux pixels d'encre et non d'orange : un filet
          // orange de 2 px posé contre un bandeau orange ne se voyait plus.
          borderColor: etat === 'prochain' ? c['line.ink'] : c[bordureDeCarte],
          backgroundColor: c['bg.surface'],
          overflow: 'hidden',
          flexDirection: large ? 'row' : 'column',
        }}
      >
        {bandeau}
        <View style={{ flex: large ? 1 : undefined, minWidth: 0 }}>
          {echange}

          {obstacles.length > 0 ? (
            <View style={{ paddingHorizontal: large ? 16 : 14, paddingBottom: large ? 16 : 14, gap: 10 }}>
              <Filet />
              <Texte variante="type.label" couleur="ink.soft">
                {t('tiers.toUnlock')}
              </Texte>
              {/* Tous les obstacles, dans l'ordre du serveur. N'en montrer qu'un
                  ferait combler le premier pour découvrir le second, puis le
                  troisième. */}
              {obstacles.map((obstacle, index) => (
                <EcartAuSeuil
                  key={`${obstacle.raison}-${index}`}
                  obstacle={obstacle}
                  platform={palier.platform}
                  teinte={encre}
                />
              ))}
            </View>
          ) : null}

          {/* Sur un palier fermé le compte n'est pas cliquable — il n'y a rien à
              réserver. Il reste affiché : c'est l'argument. */}
          {!large && porteOuverte ? (
            <Pressable
              testID={`vers-prestations-${palier.tier_id}`}
              accessibilityRole="button"
              onPress={() => onVoirLesPrestations?.(palier)}
              style={({ pressed }) => ({
                minHeight: 48,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingHorizontal: 14,
                borderTopWidth: 1,
                borderTopColor: c['line.default'],
            opacity: pressed ? 0.7 : 1,
          })}
            >
              <Texte variante="type.bodyStrong" couleur={encre} style={{ flex: 1 }}>
                {t('tiers.seeServices', { count: palier.offres_disponibles })}
              </Texte>
              <Icone nom="chevron" couleur={encre} taille={20} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function EtatDuPalier({
  etat,
  teinte,
  plein,
}: {
  etat: EtatDuBarreau;
  teinte: ColorName;
  plein: boolean;
}) {
  const { t, locale } = useI18n();
  const c = useColors();

  if (etat === 'ouvert') {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} testID="etat-ouvert">
        <Icone nom="coche" couleur="status.success.text" taille={16} />
        <Texte variante="type.label" couleur="status.success.text">
          {t('tiers.openToYou')}
        </Texte>
      </View>
    );
  }

  if (etat === 'prochain') {
    // Une pastille, pas une phrase : c'est une désignation, pas un état.
    return (
      <View
        testID="etat-prochain"
        style={{
          paddingVertical: 3,
          paddingHorizontal: 9,
          borderRadius: radius['radius.pill'],
          // `brand.500` et non `brand.700` : c'est une surface, et l'encre par
          // dessus donne 6,1:1 là où le blanc échouerait à cette taille.
          backgroundColor: c['brand.500'],
        }}
      >
        <Texte variante="type.monoSmall" couleur="ink.onBrand" style={{ fontSize: 10 }}>
          {t('tiers.nextForYou')}
        </Texte>
      </View>
    );
  }

  const libelle = etat === 'enPause' ? t('tiers.pausedNotLost') : t('tiers.furtherAhead');
  return (
    <Texte
      variante="type.label"
      testID={etat === 'enPause' ? 'etat-en-pause' : 'etat-lointain'}
      // Sur un aplat, le texte porte la couleur d'écriture du palier ; ailleurs
      // celle du thème. Un `text.secondary` sur l'aplat violet serait illisible.
      couleur={etat === 'enPause' ? 'status.warning.text' : plein ? (`${teinte}.onTier` as ColorName) : 'ink.soft'}
    >
      {libelle}
    </Texte>
  );
}

/**
 * Un obstacle chiffrable : au-dessus de 60 %, le compte et sa barre ; en
 * dessous, le seuil et l'horizon.
 *
 * **La bascule vit ici**, dans `formeDe`, et non dans l'écran : c'est une règle
 * produit, et elle est éprouvée sans mise en page.
 *
 * Un obstacle sans nom court — un compte à reconnecter, un relevé à attendre —
 * garde sa phrase entière. Le découper en « nom / valeur » demanderait un nom
 * à quelque chose qui n'est pas une quantité.
 */
export function EcartAuSeuil({
  obstacle,
  platform,
  teinte,
}: {
  obstacle: Obstacle;
  platform: string;
  teinte: ColorName;
}) {
  const { t, locale } = useI18n();
  const { large } = useGabarit();

  const forme = formeDe(obstacle);
  const cleDuNom = `obstacles.nom.${obstacle.raison}`;
  const nom = t(cleDuNom);
  // `t` rend la clé brute quand elle manque : c'est le signal que cet obstacle
  // n'est pas une quantité, et qu'il doit rester une phrase.
  const chiffrable = nom !== cleDuNom && (forme.forme === 'ecart' || forme.forme === 'horizon');

  if (!chiffrable) {
    return (
      <Texte
        variante="type.caption"
        couleur="ink.soft"
        testID={`obstacle-${obstacle.raison}`}
      >
        {messageDObstacle(t, obstacle, CODES_CONNUS, platform, locale)}
      </Texte>
    );
  }

  const requis = formatNumber(forme.requis, locale);
  const phrase =
    forme.forme === 'ecart'
      ? t('obstacles.ecart', { manque: forme.manque, requis: forme.requis })
      : // Le seuil, et rien d'autre. Aucune projection de rythme : une barre
        // presque vide décourage plus qu'elle n'informe.
        t('obstacles.horizon', { requis: forme.requis });

  const valeur =
    forme.forme === 'ecart'
      ? `${formatNumber(forme.requis - forme.manque, locale)} / ${requis}`
      : requis;

  return (
    <View style={{ gap: 7 }} testID={`obstacle-${obstacle.raison}`}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: large ? 16 : 10,
          justifyContent: 'space-between',
        }}
      >
        <Texte variante="type.label" style={{ width: large ? LARGEUR_DU_DON : undefined, fontWeight: '400' }}>
          {nom}
        </Texte>
        {/* En bureau la barre tient sur la même ligne que le seuil ; en mobile
            elle passe dessous, faute de place pour les trois. */}
        {large ? (
          forme.forme === 'ecart' ? (
            <View style={{ flex: 1 }}>
              <Jauge
                part={(forme.requis - forme.manque) / forme.requis}
                teinte={teinte}
                hauteur={10}
                testID={`jauge-${obstacle.raison}`}
              />
            </View>
          ) : (
            <Texte variante="type.caption" couleur="ink.soft" style={{ flex: 1 }}>
              {phrase}
            </Texte>
          )
        ) : null}
        <Texte variante="type.mono" style={{ fontSize: 13 }}>
          {valeur}
        </Texte>
      </View>

      {!large && forme.forme === 'ecart' ? (
        <Jauge
          part={(forme.requis - forme.manque) / forme.requis}
          teinte={teinte}
          hauteur={10}
          testID={`jauge-${obstacle.raison}`}
        />
      ) : null}

      {!large || forme.forme === 'ecart' ? (
        <Texte variante="type.caption" couleur="ink.soft">
          {phrase}
        </Texte>
      ) : null}
    </View>
  );
}
