/**
 * 04 · Fiche commerce.
 *
 * **Un palier fermé reste visible et dit pourquoi.** C'est la divergence
 * assumée avec le fil : le fil filtre parce qu'il propose, la fiche informe
 * parce qu'elle décrit. Mais une offre fermée doit être **visiblement** non
 * réservable — pas de bouton, un motif — sinon on recrée le fil qui montre des
 * choses indisponibles.
 *
 * **Le bouton est retiré, pas grisé.** Un bouton grisé demande de deviner ce
 * qui le débloque ; son absence, accompagnée de l'obstacle, ne demande rien.
 *
 * **Ce que le commerce attend est rappelé avant la réservation.** Mention et
 * tag de lieu sont les deux éléments contrôlés ; les découvrir sur l'écran de
 * preuve serait les découvrir trop tard.
 */
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Image, Linking, Modal, Pressable, View } from 'react-native';

import { useApi, type FichePublique, type OffreDeLaFiche } from '../api';
import {
  Button,
  Icone,
  LigneDeContrepartie,
  MediaFallback,
  SkeletonFiche,
  Texte,
  type NomIcone,
} from '../components';
import { formatHeure, formatNumber, jourCivil, repereDuCreneau } from '../format';
import { fermeAujourdhui } from './horaires';
import { useI18n } from '../i18n';
import { urlImage } from './FilScreen';
import { elevationDeCarte, elevationFlottante, radius, useTheme } from '../theme';
import { Ecran } from './Ecran';
import { EcartAuSeuil } from './PaliersScreen';
import { nomDePlateforme } from './obstacle';
import { useRequete } from './useRequete';
import { VisionneuseDeCarte, VisionneuseDeGalerie } from './Visionneuses';

/**
 * La vignette d'une prestation : 64 points, comme la planche.
 *
 * Elle a doublé — 44 auparavant — parce qu'elle a changé de rôle : elle
 * illustrait une ligne de liste, elle accompagne maintenant un bloc dont le
 * titre fait 22 points. À 44 sous un titre de cette taille, elle passait pour
 * une puce.
 */
const VIGNETTE_DE_L_OFFRE = 64;

/**
 * Ce qui s'atténue sur une prestation fermée : l'image, et rien d'autre.
 *
 * Le bloc entier était à 75 %, ce qui effaçait **l'explication** en même temps
 * que la prestation — c'est-à-dire le seul élément utile d'un bloc fermé.
 */
const OPACITE_FERMEE = 0.6;

/**
 * Combien de créneaux suivants s'écrivent à côté du bouton.
 *
 * Deux : ils disent qu'il y a un choix, ce qu'un bouton seul ne dit pas. Trois
 * commencerait à être une liste, et une liste appartient à l'écran des
 * créneaux.
 */
const AUTRES_CRENEAUX = 2;

/** La hauteur de la couverture, relevée sur la planche. */
const HAUTEUR_DE_COUVERTURE = 270;

export function FicheScreen({
  businessId,
  onReserver,
  onRetour,
}: {
  businessId: string;
  onReserver: (offre: OffreDeLaFiche, fiche: FichePublique) => void;
  /** Le retour de la pile. Sur le web il n'y a ni geste ni bouton système :
   * sans lui, on ne quitte l'écran qu'en changeant d'onglet. */
  onRetour?: () => void;
}) {
  const { api } = useApi();
  const { t, locale } = useI18n();

  const requete = useRequete<FichePublique>((signal) => api.fichePublique(businessId, signal), {
    estVide: (fiche) => fiche.offres.length === 0,
    dependances: [businessId],
  });

  /**
   * Ce qui est ouvert par-dessus la fiche.
   *
   * **Une seule valeur pour trois états**, et non trois booléens : deux
   * visionneuses ouvertes en même temps est un état qui n'existe pas, et le
   * rendre représentable serait s'engager à le gérer.
   */
  const [ouvert, setOuvert] = useState<'galerie' | 'carte' | 'sortie' | null>(null);

  return (
    <Ecran
      onRetour={onRetour} requete={requete} squelette={<SkeletonFiche testID="squelette-fiche" />} testID="ecran-fiche">
      {(fiche) => {
        // Le serveur rend les offres dans son ordre ; on ne le rejoue pas, on
        // le partitionne. Un tri refait ici déciderait quelle prestation passe
        // devant, ce que le produit ne fait jamais.
        // **La preuve d'ouverture, prise sur ce qui est déjà servi.** Un
        // créneau aujourd'hui sort du calcul de capacité réel, exceptions
        // comprises : il prouve que le salon ouvre. L'absence ne prouve rien.
        const ouvreAujourdhui = fiche.offres.some((offre) =>
          offre.prochains_creneaux.some(
            (creneau) => jourCivil(creneau, fiche.timezone) === jourCivil(new Date(), fiche.timezone),
          ),
        );
        const fermeture = fermeAujourdhui(fiche.horaires, fiche.timezone, ouvreAujourdhui);

        const ouvertes = fiche.offres.filter((offre) => offre.accessible);
        const fermees = fiche.offres.filter((offre) => !offre.accessible);
        return (
        <View style={{ gap: 18 }}>
          {/* **La galerie s'ouvre depuis la couverture elle-même.** Elle
              n'avait pas été mentionnée dans la revue, et c'était le signe
              qu'elle ne se voyait pas : une ligne « 12 photos » sous l'adresse
              se lit comme une rubrique, un compte posé sur l'image se lit comme
              la promesse que l'objet en cache onze autres. */}
          <Couverture
            fiche={fiche}
            onOuvrirLaGalerie={() => setOuvert('galerie')}
          />

          <View style={{ gap: 10 }}>
            <View style={{ gap: 3 }}>
              <Texte variante="type.screenTitle" ellipseSurNomPropre>
                {fiche.name}
              </Texte>
              {fiche.address ? (
                <Texte variante="type.body" couleur="ink.soft">
                  {fiche.address}
                </Texte>
              ) : null}
            </View>
            {/* **Les deux étiquettes de la planche, dont l'horaire.** Il
                manquait faute de champ ; le champ est arrivé. Il est
                hebdomadaire et ignore les exceptions, donc il se croise avec
                une preuve d'ouverture prise sur les créneaux du jour — voir
                `horaires.ts`. Absent quand rien ne le prouve : cacher une
                information vraie coûte moins qu'envoyer quelqu'un devant une
                porte close. */}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {fermeture ? (
                <Etiquette
                  texte={t('parcours.ficheOuvertJusqua', { heure: fermeture })}
                  testID="horaire-du-jour"
                />
              ) : null}
              <Etiquette texte={t(`categories.${fiche.category}`)} testID="categorie" />
            </View>
          </View>

          {/* **La carte devient une ligne nommée, entre l'identité et les
              prestations.** C'est là qu'on la cherche : avant de choisir, pas
              après. Elle se consulte, la galerie se fait défiler — les ranger
              ensemble ferait chercher un plat entre deux photos de salle. */}
          <AccesALaCarte
            fiche={fiche}
            onOuvrirLaCarte={() => setOuvert('carte')}
            onSortirVersLeLien={() => setOuvert('sortie')}
          />

          {/* **Les deux visionneuses sont plein écran, par-dessus la fiche.**
              Dépliées dans le flux, elles auraient rendu la fiche interminable
              et forcé à faire défiler une carte au milieu d'une liste d'offres.
              Une carte se lit en s'arrêtant : il lui faut l'écran. */}
          <Modal
            visible={ouvert === 'galerie'}
            animationType="fade"
            onRequestClose={() => setOuvert(null)}
          >
            <VisionneuseDeGalerie photos={fiche.photos} onFermer={() => setOuvert(null)} />
          </Modal>

          <Modal
            visible={ouvert === 'carte'}
            animationType="fade"
            onRequestClose={() => setOuvert(null)}
          >
            <VisionneuseDeCarte
              pages={fiche.menu_pages}
              onFermer={() => setOuvert(null)}
              // Réserver depuis la carte n'existe que s'il y a quelque chose à
              // réserver : sur une fiche dont toutes les offres sont fermées,
              // un bouton mènerait à un refus.
              onReserver={
                premiereOffreOuverte(fiche)
                  ? () => {
                      setOuvert(null);
                      onReserver(premiereOffreOuverte(fiche)!, fiche);
                    }
                  : undefined
              }
            />
          </Modal>

          <Modal
            visible={ouvert === 'sortie'}
            animationType="fade"
            transparent
            onRequestClose={() => setOuvert(null)}
          >
            <Voile onFermer={() => setOuvert(null)}>
              <FeuilleDeSortie
                nom={fiche.name}
                lien={fiche.menu_url ?? ''}
                onOuvrir={() => {
                  setOuvert(null);
                  if (fiche.menu_url) void Linking.openURL(fiche.menu_url);
                }}
                onRester={() => setOuvert(null)}
              />
            </Voile>
          </Modal>

          <View style={{ gap: 12 }}>
            <Texte variante="type.section">{t('parcours.ficheOffres')}</Texte>
            {/* **Les ouvertes d'abord, les fermées ensuite, séparées par un
                titre.** Mêlées, une prestation fermée se lisait comme une
                erreur d'affichage ; le séparateur dit ce qui commence, et la
                règle du produit — visible ici, jamais dans le fil — cesse
                d'être un mystère. */}
            {ouvertes.map((offre) => (
              <Offre
                key={offre.tier_offer_id}
                offre={offre}
                // Le fuseau du salon : un « prochain créneau » se lit là où il
                // a lieu, jamais dans le fuseau du téléphone.
                timezone={fiche.timezone}
                onReserver={() => onReserver(offre, fiche)}
              />
            ))}
            {fermees.length ? (
              <SeparateurNomme texte={t('parcours.fichePasEncore')} testID="pas-encore-ouvert" />
            ) : null}
            {fermees.map((offre) => (
              <Offre
                key={offre.tier_offer_id}
                offre={offre}
                timezone={fiche.timezone}
                onReserver={() => onReserver(offre, fiche)}
              />
            ))}
          </View>
        </View>
        );
      }}
    </Ecran>
  );
}

/**
 * 24a · Les deux accès de la fiche, et ils ne se mêlent jamais.
 *
 * **Une carte se lit, une galerie se regarde.** Ce sont deux gestes, pas deux
 * façons de voir la même chose : ranger les pages de la carte dans le
 * carrousel des photos ferait chercher une entrecôte entre deux vues de salle,
 * et ferait passer une page de menu pour une photo du lieu.
 *
 * **Deux lignes de la même carte, avec le même chevron.** Ni l'une ni l'autre
 * n'est un onglet caché ou une option de second rang : elles ont la même
 * hauteur, la même structure et la même affordance, et seuls leur glyphe et
 * leur libellé les distinguent.
 *
 * **La ligne de la carte est en teinte**, parce qu'elle est ce que la
 * créatrice vient chercher quand une prestation lui laisse un choix. C'est la
 * seule teinte de l'écran, et elle désigne — elle ne promeut pas.
 *
 * **Rien du tout quand il n'y a rien.** Un salon de beauté n'a pas de carte, et
 * une ligne vide serait un cul-de-sac de plus.
 *
 * **Le lien seul porte le glyphe de sortie, pas le chevron** : la différence se
 * voit avant l'appui, pas après.
 */
function AccesALaCarte({
  fiche,
  onOuvrirLaCarte,
  onSortirVersLeLien,
}: {
  fiche: FichePublique;
  onOuvrirLaCarte: () => void;
  onSortirVersLeLien: () => void;
}) {
  const { t, locale } = useI18n();
  const { color: c } = useTheme();

  const aDesPages = fiche.menu_pages.length > 0;
  const aUnLien = Boolean(fiche.menu_url);

  // Rien du tout quand il n'y a rien. Un salon de beauté n'a pas de carte, et
  // une ligne vide serait un cul-de-sac de plus.
  if (!aDesPages && !aUnLien) return null;

  return (
    <LigneDAcces
      glyphe="carte"
      // Le glyphe de sortie **remplace** le chevron quand la carte n'existe
      // qu'ailleurs. Deux flèches différentes pour deux destinations, et la
      // seconde se lit sans avoir été apprise.
      sortie={!aDesPages}
      titre={t('parcours.ficheCarte')}
      detail={
        aDesPages
          ? t('parcours.ficheCartePages', {
              count: formatNumber(fiche.menu_pages.length, locale),
            })
          : t('parcours.ficheCarteSurLeurSite')
      }
      onPress={aDesPages ? onOuvrirLaCarte : onSortirVersLeLien}
      testID="acces-carte"
    />
  );
}

/**
 * La couverture, et le compte de photos posé dessus.
 *
 * **La galerie n'avait pas été mentionnée dans la revue**, et c'était le signe
 * qu'elle ne se voyait pas : une ligne « 12 photos » sous l'adresse se lit
 * comme une rubrique parmi d'autres. Posé **sur** l'image, le compte annonce
 * que l'objet lui-même en cache onze autres — c'est l'image qui invite, pas
 * une entrée de liste.
 *
 * **Sans photo, pas de couverture.** Un aplat gris de 270 points en tête d'une
 * fiche serait une absence qui prend plus de place que ce qu'elle remplace ;
 * l'identité remonte alors d'elle-même.
 */
function Couverture({
  fiche,
  onOuvrirLaGalerie,
}: {
  fiche: FichePublique;
  onOuvrirLaGalerie: () => void;
}) {
  const { api } = useApi();
  const { t, locale } = useI18n();
  const { color: c } = useTheme();

  // **La première photo de la galerie sert de couverture par défaut.** Sans ce
  // repli, un salon qui a douze photos et pas de couverture déclarée perdait
  // l'entrée de sa galerie tout entière : elle vit maintenant sur l'image, et
  // sans image il n'y a plus de porte. La première photo est une photo du lieu
  // — c'est ce que la galerie contient — donc elle tient ce rôle sans mentir.
  const source = urlImage(api.urlDuMedia(fiche.cover_photo_key ?? fiche.photos[0] ?? null));
  if (!source) return null;

  const compte = fiche.photos.length;

  return (
    <View testID="couverture" style={{ height: HAUTEUR_DE_COUVERTURE }}>
      <Image source={source} resizeMode="cover" style={{ width: '100%', height: '100%' }} />
      {compte > 0 ? (
        <Pressable
          testID="acces-galerie"
          accessibilityRole="button"
          accessibilityLabel={t('parcours.fichePhotosDetail', {
            count: formatNumber(compte, locale),
          })}
          onPress={onOuvrirLaGalerie}
          // **La seule porte vers la galerie, et elle ne répondait pas.** Une
          // pastille posée sur une photo ressemble déjà à une étiquette ; sans
          // retour à l'appui, rien ne distingue le moment où on l'a pressée du
          // moment où on a touché l'image. C'est ce qui la faisait passer pour
          // une légende.
          style={({ pressed }) => ({
            opacity: pressed ? 0.7 : 1,
            position: 'absolute',
            right: 18,
            bottom: 16,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 7,
            paddingHorizontal: 14,
            paddingVertical: 7,
            borderRadius: radius['radius.pill'],
            // Le voile de badge, et non un blanc écrit ici : c'est le jeton du
            // système pour ce qui se pose sur une image dont on ne sait rien.
            backgroundColor: c['scrim.badge'],
          })}
        >
          <Icone nom="image" couleur="ink.default" taille={16} />
          <Texte variante="type.label">
            {t('parcours.fichePhotosCompte', { count: formatNumber(compte, locale) })}
          </Texte>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Une étiquette de la fiche : un fait, jamais une action. */
function Etiquette({ texte, testID }: { texte: string; testID?: string }) {
  const { color: c } = useTheme();
  return (
    <View
      testID={testID}
      style={{
        borderRadius: radius['radius.sm'],
        backgroundColor: c['bg.deep'],
        paddingHorizontal: 11,
        paddingVertical: 6,
      }}
    >
      <Texte variante="type.label">{texte.toUpperCase()}</Texte>
    </View>
  );
}

/**
 * Un titre de section entre deux filets.
 *
 * Il dit **ce qui commence**, et c'est ce qui manquait : mêlée aux autres, une
 * prestation fermée se lisait comme une erreur d'affichage.
 */
function SeparateurNomme({ texte, testID }: { texte: string; testID: string }) {
  const { color: c } = useTheme();
  return (
    <View
      testID={testID}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 4 }}
    >
      <View style={{ flex: 1, height: 1, backgroundColor: c['line.default'] }} />
      <Texte variante="type.monoSmall" couleur="ink.mute">
        {texte.toUpperCase()}
      </Texte>
      <View style={{ flex: 1, height: 1, backgroundColor: c['line.default'] }} />
    </View>
  );
}

/** Une des deux lignes. Elles sont la même chose, et c'est le sujet. */
function LigneDAcces({
  glyphe,
  titre,
  detail,
  teinte = false,
  sortie = false,
  avecFilet = false,
  onPress,
  testID,
}: {
  glyphe: NomIcone;
  titre: string;
  detail: string;
  teinte?: boolean;
  sortie?: boolean;
  avecFilet?: boolean;
  onPress: () => void;
  testID: string;
}) {
  const { color: c } = useTheme();
  const encre = teinte ? 'brand.700' : 'ink.default';

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${titre} · ${detail}`}
      onPress={onPress}
      style={({ pressed }) => ({
        opacity: pressed ? 0.7 : 1,
        minHeight: 60,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 13,
        paddingHorizontal: 16,
        backgroundColor: teinte ? c['brand.50'] : 'transparent',
        borderBottomWidth: avecFilet ? 1 : 0,
        borderBottomColor: c['line.default'],
      })}
    >
      <Icone nom={glyphe} couleur={encre} taille={22} />
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Texte variante="type.bodyStrong" couleur={encre}>
          {titre}
        </Texte>
        <Texte variante="type.caption" couleur="ink.mute">
          {detail}
        </Texte>
      </View>
      <Icone nom={sortie ? 'sortie' : 'chevron'} couleur={teinte ? 'brand.700' : 'ink.mute'} taille={20} />
    </Pressable>
  );
}

/**
 * 24c · Ce qu'on dit avant de laisser partir.
 *
 * **Un lien qui s'ouvre sans prévenir, au milieu d'un parcours de réservation,
 * fait perdre le fil à qui revient** — et sur un téléphone, « revenir » n'est
 * pas toujours un geste évident.
 *
 * Trois choses, dans cet ordre : où l'on va, ce qu'on y trouvera, et surtout ce
 * qui ne se perd pas. La dernière est celle qui compte : ce n'est pas le départ
 * qui inquiète, c'est de croire qu'on perd la réservation en cours.
 *
 * **Le domaine s'écrit avant le départ**, en mono. Une adresse annoncée est une
 * adresse qu'on reconnaît en arrivant ; une adresse cachée derrière un verbe
 * fait arriver quelque part sans savoir où.
 */
function FeuilleDeSortie({
  nom,
  lien,
  onOuvrir,
  onRester,
}: {
  nom: string;
  lien: string;
  onOuvrir: () => void;
  onRester: () => void;
}) {
  const { t } = useI18n();
  const { color: c } = useTheme();

  return (
    <View testID="feuille-de-sortie" style={{ gap: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
        <Icone nom="sortie" couleur="ink.default" taille={24} />
        <Texte variante="type.heading" style={{ flex: 1 }}>
          {t('parcours.sortieTitre')}
        </Texte>
      </View>
      <Texte couleur="ink.soft">{t('parcours.sortieCorps', { nom })}</Texte>

      <View style={{ backgroundColor: c['bg.deep'], padding: 14 }}>
        <Texte variante="type.mono" ellipseSurNomPropre testID="domaine-de-sortie">
          {domaineDe(lien)}
        </Texte>
      </View>

      {/* Ce qui ne se perd pas. C'est la ligne qui décide, pas les deux
          au-dessus : personne n'hésite à lire une carte, on hésite à quitter
          une page qu'on a mis trois minutes à trouver. */}
      <Texte variante="type.caption" couleur="ink.mute">
        {t('parcours.sortieRassure')}
      </Texte>

      <View style={{ gap: 10 }}>
        <Button label={t('parcours.sortieOuvrir')} onPress={onOuvrir} testID="ouvrir-la-carte-en-ligne" />
        <Button
          label={t('parcours.sortieRester')}
          variant="secondary"
          onPress={onRester}
          testID="rester-ici"
        />
      </View>
    </View>
  );
}

/**
 * Le domaine seul, sans le protocole ni le chemin.
 *
 * **C'est le domaine qui dit où l'on va**, pas le chemin : `osteriarota.com` se
 * reconnaît, `https://osteriarota.com/fr/carte-du-soir?src=bind` se lit trois
 * fois et n'apprend rien de plus. Exportée pour être éprouvée seule — une
 * adresse mal découpée annoncerait un domaine qui n'est pas celui où l'on
 * arrive, et c'est le seul mensonge que cette feuille pourrait dire.
 */
export function domaineDe(lien: string): string {
  const sansProtocole = lien.replace(/^[a-z]+:\/\//i, '');
  const sansChemin = sansProtocole.split(/[/?#]/)[0];
  return sansChemin.replace(/^www\./i, '') || lien;
}



/**
 * Une prestation, et les deux questions qu'elle pose.
 *
 * **La cause trouvée par Design.** Une ligne portait cinq informations de
 * nature différente — le nom, la durée, un badge à trois barres, une date brute
 * et un bouton — dont deux codées. Elle pose en fait deux questions :
 * **qu'est-ce que je donne** et **quand je viens**. Une ligne chacune, un
 * glyphe chacune, le mot qui décide en gras. Le reste était du remplissage.
 *
 * **Le badge codé disparaît d'ici.** Il disait le palier ; les testeurs y
 * cherchaient le réseau, qu'il n'a jamais porté. Les deux sont maintenant
 * écrits côte à côte. Il survit sur le fil, où une carte n'a pas la place d'une
 * phrase, et sur l'écran des paliers, où il est le sujet.
 *
 * **Le bouton passe de 316 à 89 points.** Trois aplats orange pleine largeur
 * empilés faisaient trois promotions. Il est maintenant dimensionné sur son
 * texte, et l'orange cesse d'être la surface dominante sans disparaître.
 *
 * **Une prestation fermée garde son opacité pleine.** À 75 %, l'explication
 * devenait illisible en même temps que la prestation — c'est-à-dire que le seul
 * élément utile d'un bloc fermé était celui qu'on effaçait. Seule la vignette
 * s'atténue, et l'obstacle prend un encart à lui.
 */
function Offre({
  offre,
  timezone,
  onReserver,
}: {
  offre: OffreDeLaFiche;
  timezone: string;
  onReserver: () => void;
}) {
  const { color: c } = useTheme();
  const { t, locale } = useI18n();
  const { api } = useApi();

  const attendu = [
    offre.required_mention ? t('parcours.ficheMention', { mention: offre.required_mention }) : null,
    offre.required_geotag ? t('parcours.ficheLieu') : null,
  ].filter(Boolean);

  const vignette = urlImage(api.urlDeLaVignette(offre.photo_key));
  const creneaux = offre.prochains_creneaux;

  return (
    <View
      testID={`offre-${offre.tier_offer_id}`}
      style={{
        borderRadius: radius['radius.lg'],
        backgroundColor: c['bg.surface'],
        padding: 18,
        gap: 14,
        // **Le filet remplace l'ombre sur ce qui est fermé, et c'est la
        // distinction qui reste quand l'opacité s'en va.** Une prestation
        // ouverte se pose sur la page ; une fermée est décrite, pas offerte.
        ...(offre.accessible
          ? elevationDeCarte()
          : { borderWidth: 1, borderColor: c['line.default'] }),
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Texte variante="type.section" testID="offre-nom">
            {offre.name}
          </Texte>
          {offre.duration_minutes === null ? null : (
            <Texte variante="type.caption" couleur="ink.mute">
              {t('parcours.ficheDuree', {
                count: formatNumber(offre.duration_minutes, locale),
              })}
            </Texte>
          )}
        </View>
        <View
          testID="offre-vignette"
          style={{
            width: VIGNETTE_DE_L_OFFRE,
            height: VIGNETTE_DE_L_OFFRE,
            borderRadius: radius['radius.photo'],
            overflow: 'hidden',
            // **La seule chose qui s'atténue sur une prestation fermée.**
            // L'image n'informe pas, elle attire ; la retirer entièrement
            // ferait un trou, la laisser pleine ferait une promesse.
            opacity: offre.accessible ? 1 : OPACITE_FERMEE,
          }}
        >
          {vignette ? (
            <Image source={vignette} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          ) : (
            <MediaFallback monogramme={offre.name} height={VIGNETTE_DE_L_OFFRE} />
          )}
        </View>
      </View>

      <View style={{ gap: 8 }}>
        {/* **Ce que je donne.** Le palier en gras dans la phrase, le réseau par
            sa marque : c'est la correction entière du badge codé. */}
        <LigneAGlyphe glyphe="paliers" testID="ligne-contrepartie">
          <LigneDeContrepartie
            tier={offre.content_format}
            plateforme={nomDePlateforme(offre.platform)}
          />
        </LigneAGlyphe>

        {/* **Quand je viens.** Absente d'une prestation fermée : il n'y a pas
            de créneau à annoncer pour ce qu'on ne peut pas prendre, et en
            montrer un ferait de l'obstacle une formalité. */}
        {offre.accessible ? (
          <LigneAGlyphe glyphe="horloge" testID="prochain-creneau">
            <ProchainCreneau creneaux={creneaux} timezone={timezone} />
          </LigneAGlyphe>
        ) : null}
      </View>

      {/* **La raison d'ouvrir la carte avant de réserver.** Sans cette ligne,
          « Menu du jour » se réserve comme une manucure : on croit savoir ce
          qu'on prend. */}
      {offre.leaves_choice ? (
        <Texte variante="type.caption" couleur="ink.mute" testID="laisse-un-choix">
          {t('parcours.offreLaisseUnChoix')}
        </Texte>
      ) : null}
      {attendu.length ? (
        <Texte variante="type.caption" couleur="ink.mute" testID="attendu">
          {t('parcours.ficheAttendu', { quoi: attendu.join(' · ') })}
        </Texte>
      ) : null}

      {offre.accessible ? (
        <ActionDeLOffre
          creneaux={creneaux}
          requiertReservation={offre.requires_booking}
          timezone={timezone}
          onReserver={onReserver}
        />
      ) : (
        <ObstacleDeLOffre offre={offre} />
      )}
    </View>
  );
}

/** Une ligne de la prestation : son glyphe, et ce qu'elle dit. */
function LigneAGlyphe({
  glyphe,
  children,
  testID,
}: {
  glyphe: NomIcone;
  children: ReactNode;
  testID: string;
}) {
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9 }}>
      {/* Deux points de retrait : le glyphe s'aligne sur la hauteur d'x de la
          première ligne et non sur le haut de sa boîte, faute de quoi il
          flotte au-dessus du texte qu'il désigne. */}
      <View style={{ marginTop: 2 }}>
        <Icone nom={glyphe} couleur="ink.soft" taille={18} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
    </View>
  );
}

/**
 * Le prochain créneau, en repère humain.
 *
 * « 08/08/2026, 14:30 » demandait de calculer. Au-delà d'une semaine la date
 * complète revient : « mardi » y devient ambigu, et le mot cesse d'être plus
 * court que la date.
 */
function ProchainCreneau({ creneaux, timezone }: { creneaux: string[]; timezone: string }) {
  const { t, locale } = useI18n();

  if (creneaux.length === 0) {
    return (
      <Texte variante="type.body" couleur="ink.soft">
        {t('parcours.ficheComplet')}
      </Texte>
    );
  }

  const repere = repereDuCreneau(creneaux[0], locale, timezone);
  const cle =
    repere.quand === 'aujourdhui'
      ? 'parcours.ficheProchainAujourdhui'
      : repere.quand === 'demain'
        ? 'parcours.ficheProchainDemain'
        : repere.quand === 'jour'
          ? 'parcours.ficheProchainJour'
          : 'parcours.ficheProchainDate';

  // La phrase se coupe sur l'heure, qui est le mot qui décide : elle est en
  // gras, le reste ne l'est pas. Deux clés plutôt qu'un balisage dans la
  // traduction — une traductrice ne doit pas avoir à placer une balise.
  return (
    <Texte variante="type.body" couleur="ink.soft">
      {t(cle, { jour: repere.libelle })}
      <Texte variante="type.bodyStrong" couleur="ink.default">
        {repere.heure}
      </Texte>
    </Texte>
  );
}

/**
 * Le bouton et ce qui l'accompagne.
 *
 * **Une pilule dimensionnée sur son texte**, et non un aplat pleine largeur.
 * Trois aplats orange empilés faisaient trois promotions ; l'orange reste, il
 * cesse d'être la surface dominante.
 *
 * **Les créneaux suivants tiennent à côté du bouton.** Ils occupent la place
 * que le bouton libère, et disent qu'il y a un choix — ce qu'un bouton seul ne
 * dit pas. Absents quand il n'y en a qu'un : « et aussi » suivi de rien serait
 * pire que le silence.
 */
function ActionDeLOffre({
  creneaux,
  requiertReservation,
  timezone,
  onReserver,
}: {
  creneaux: string[];
  requiertReservation: boolean;
  timezone: string;
  onReserver: () => void;
}) {
  const { t, locale } = useI18n();

  // Retiré, pas grisé, quand il ne reste plus rien à prendre.
  if (creneaux.length === 0 && requiertReservation) return null;

  const autres = creneaux.slice(1, 1 + AUTRES_CRENEAUX);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      {/* **`fullWidth={false}`, et c'est tout ce qu'il fallait.** Le bouton du
          système est déjà une pilule ; il s'étirait parce que `fullWidth` vaut
          `true` par défaut, et personne ne l'avait dit non. Les 316 points
          venaient de là. La largeur exacte reste celle que l'écart intérieur du
          système donne — la planche en mesure 89 avec un écart de 24, le nôtre
          est à 16 : c'est un réglage de jeton, pas de cet écran. */}
      <Button
        label={t('parcours.reserver')}
        onPress={onReserver}
        fullWidth={false}
        testID="reserver"
      />
      {autres.length ? (
        <Texte variante="type.caption" couleur="ink.mute" style={{ flex: 1 }} testID="autres-creneaux">
          {t('parcours.ficheAussiLibre', {
            heures: autres.map((iso) => formatHeure(iso, locale, timezone)).join(', '),
          })}
        </Texte>
      ) : null}
    </View>
  );
}

/**
 * Ce qui manque, dans un encart à lui.
 *
 * **« Pas assez visible » venait d'une ligne de légende sous un bloc à 75 %
 * d'opacité.** L'obstacle passe de treize points en gris à seize en gras, avec
 * son chiffre dans la phrase, et l'encart le sépare de la prestation qu'il
 * ferme au lieu de le noyer dedans.
 *
 * **Les mêmes codes que sur l'écran des paliers**, et le même composant : deux
 * vocabulaires pour un même refus feraient croire à deux causes. C'est aussi
 * lui qui porte la règle des 60 % — l'écart se chiffre et la barre se dessine
 * au-dessus, en dessous il ne reste que le seuil.
 */
function ObstacleDeLOffre({ offre }: { offre: OffreDeLaFiche }) {
  const { t } = useI18n();
  const { color: c } = useTheme();

  return (
    <View
      testID="offre-fermee"
      style={{
        borderRadius: radius['radius.md'],
        backgroundColor: c['bg.deep'],
        padding: 14,
        gap: 9,
      }}
    >
      {offre.obstacles.map((obstacle, index) => (
        <EcartAuSeuil
          key={`${obstacle.raison}-${index}`}
          obstacle={obstacle}
          platform={offre.platform}
          teinte="brand.500"
        />
      ))}
      {/* **La règle du produit, dite par l'écran lui-même.** Une prestation
          fermée reste visible sur la fiche et n'apparaît jamais dans le fil ;
          sans cette phrase, sa présence ici se lit comme une erreur. */}
      <Texte variante="type.caption" couleur="ink.soft" testID="pourquoi-visible">
        {t('parcours.ficheFerme')}
      </Texte>
    </View>
  );
}

/**
 * La première offre réservable, s'il y en a une.
 *
 * Sert au bouton de la visionneuse : la lectrice a ouvert la carte pour
 * décider, et lui offrir de réserver ce qu'elle ne peut pas réserver serait
 * lui promettre un refus.
 */
function premiereOffreOuverte(fiche: FichePublique): OffreDeLaFiche | null {
  return fiche.offres.find((offre) => offre.accessible) ?? null;
}

/**
 * Le voile d'une feuille, et ce qu'il fait de l'appui à côté.
 *
 * Appuyer hors de la feuille la ferme : c'est le geste qu'on tente d'abord, et
 * ne pas l'écouter oblige à chercher un bouton pour annuler une action qu'on
 * n'a pas commencée.
 */
function Voile({ children, onFermer }: { children: ReactNode; onFermer: () => void }) {
  const { color: c } = useTheme();
  return (
    <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: c['scrim.modal'] }}>
      <Pressable
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        onPress={onFermer}
        style={{ flex: 1 }}
        testID="voile-de-la-feuille"
      />
      <View
        style={{
          backgroundColor: c['bg.surface'],
          padding: 20,
          paddingBottom: 26,
          ...elevationFlottante(),
        }}
      >
        {children}
      </View>
    </View>
  );
}
