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
import { useMemo, useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { Linking, Modal, Pressable, View } from 'react-native';

import { useApi, type FichePublique, type OffreDeLaFiche, type Platform } from '../api';
import {
  Button,
  Icone,
  LigneDeContrepartie,
  MediaFallback,
  SkeletonFiche,
  StatusMessage,
  Texte,
  type NomIcone,
} from '../components';
import { Photo } from '../components';
import { formatHeure, formatNumber, jourCivil, repereDuCreneau } from '../format';
import { fermeAujourdhui } from './horaires';
import { useI18n } from '../i18n';
import { urlImage } from './FilScreen';
import { elevationDeCarte, elevationFlottante, radius, useTheme } from '../theme';
import { Ecran } from './Ecran';
import { useGabarit } from '../shell/gabarit';
import { LesLiensDuSalon } from './fiche/LesLiensDuSalon';
import { OuEstLeLieu } from './fiche/OuEstLeLieu';
import { EcartAuSeuil } from './PaliersScreen';
import { glypheDePlateforme, nomDePlateforme } from './obstacle';
import { AGES } from './cacheDesReponses';
import { useFavorisEnVol } from './mur/favorisEnVol';
import { useRequete } from './useRequete';
import { VisionneuseDeCarte, VisionneuseDeGalerie } from './Visionneuses';
import { etatAccessible } from '../components/etatAccessible';

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
const HAUTEUR_DE_COUVERTURE = 330;

/**
 * Sur quelle hauteur l'image se dissout dans la page.
 *
 * **Sans bord dur, et c'est tout le point.** Une photo qui s'arrête net sur un
 * trait horizontal découpe l'écran en deux : au-dessus une image, en dessous
 * une page, et le nom du salon tombe juste sous la coupure. Le dégradé rend la
 * frontière introuvable — l'image devient le haut de la page au lieu d'être un
 * bandeau posé dessus.
 *
 * **Cent trente points sur trois cent trente**, soit un gros tiers : moins,
 * la transition redevient une bande visible ; plus, elle mange le cadrage.
 */
const DISSOLUTION_DE_LA_COUVERTURE = 130;

/** La pastille du retour, posée sur l'image. */
const PASTILLE_DE_RETOUR = 40;

export function FicheScreen({
  businessId,
  position = null,
  onReserver,
  onRetour,
  onConnecterUnReseau,
  onFavoriBascule,
}: {
  businessId: string;
  /**
   * Où est la créatrice, pour dire la distance.
   *
   * Nulle tant qu'elle n'a pas partagé sa position, et l'écran le dit plutôt
   * que de la réclamer : le fil l'a déjà demandée là où elle sert.
   */
  position?: { longitude: number; latitude: number } | null;
  onReserver: (offre: OffreDeLaFiche, fiche: FichePublique) => void;
  /** Le retour de la pile. Sur le web il n'y a ni geste ni bouton système :
   * sans lui, on ne quitte l'écran qu'en changeant d'onglet. */
  onRetour?: () => void;
  /**
   * Brancher le réseau qui manque. Absent, le bloc reste un constat.
   *
   * **Ce n'est pas un refus, c'est ce qu'un compte de plus rapporterait.** Un
   * palier fermé faute de compte se répare en deux minutes ; le dire sans
   * offrir le geste laisse la créatrice chercher où.
   */
  onConnecterUnReseau?: () => void;
  /**
   * Un cœur vient de basculer. Le fil s'en sert pour redemander son compte.
   *
   * Il ne porte pas le sens du geste — ajout ou retrait — parce que le fil ne
   * recopie pas le nombre : il le redemande. Deux vérités du même compte
   * finiraient par diverger, et c'est celle qu'on regarde le moins qui ment.
   */
  onFavoriBascule?: () => void;
}) {
  const { api } = useApi();
  const { t, locale } = useI18n();

  const requete = useRequete<FichePublique>((signal) => api.fichePublique(businessId, signal), {
    estVide: (fiche) => fiche.offres.length === 0,
    dependances: [businessId],
    // **La clé porte l'identifiant du salon.** Sans lui, deux fiches se
    // montreraient l'une pour l'autre le temps d'un aller-retour, ce qui est
    // pire qu'un écran de chargement : on croirait avoir ouvert la bonne.
    cache: { cle: `fiche.${businessId}`, ageMax: AGES.contenu },
  });

  /**
   * Ce qui est ouvert par-dessus la fiche.
   *
   * **Une seule valeur pour trois états**, et non trois booléens : deux
   * visionneuses ouvertes en même temps est un état qui n'existe pas, et le
   * rendre représentable serait s'engager à le gérer.
   */
  const [ouvert, setOuvert] = useState<'galerie' | 'carte' | 'sortie' | null>(null);

  /**
   * **Les cœurs de la fiche, optimistes.** C'est ici qu'ils vivent depuis la
   * v4 : le favori porte sur la prestation, et la carte du fil en contient
   * plusieurs. La table ne garde que l'écart avec ce que le serveur a servi —
   * recopier les offres ferait deux vérités du même contenu.
   *
   * **Une même prestation ouverte à deux paliers fait deux lignes et un
   * favori.** La table est donc indexée par `catalog_item_id` : toucher l'une
   * remplit l'autre, ce qui est le comportement juste et ce que le serveur
   * rendra au rechargement.
   */
  const favoris = useFavorisEnVol(
    useMemo(
      () => ({
        mettre: (id: string) => api.mettreEnFavori(id).then(() => onFavoriBascule?.()),
        retirer: (id: string) => api.retirerDesFavoris(id).then(() => onFavoriBascule?.()),
      }),
      [api, onFavoriBascule],
    ),
  );

  /**
   * La marge que le corps pose, puisque l'écran est à fond perdu.
   *
   * Lue aux mêmes jetons qu'`Ecran` : deux valeurs écrites à la main
   * finiraient par diverger, et la couverture se décalerait d'un point du
   * texte qu'elle surplombe.
   */
  const { large } = useGabarit();
  const { density } = useTheme();
  const margeDeLaFiche = large ? density.screenPaddingLarge : density.screenPadding;

  return (
    <Ecran
      requete={requete}
      // **À fond perdu, pour la couverture et pour elle seule.** Le corps pose
      // sa marge lui-même, un cran plus bas ; c'est la règle d'`Ecran` — il
      // marge ce qu'il compose, l'appelant marge ce qu'il fournit.
      bordAbord
      squelette={<SkeletonFiche testID="squelette-fiche" />}
      testID="ecran-fiche"
    >
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
              la promesse que l'objet en cache onze autres.

              **Hors de la marge, et elle est la seule.** Une image qui s'arrête
              à dix-huit points de chaque bord est une vignette ; ce que la
              planche compose est une image qui *est* le haut de l'écran, et sa
              dissolution n'a de sens que si elle va d'un bord à l'autre. Tout
              ce qui la suit reprend la marge, posée ici — voir `bordAbord`. */}
          <Couverture
            fiche={fiche}
            onOuvrirLaGalerie={() => setOuvert('galerie')}
            onRetour={onRetour}
          />

          <View style={{ paddingHorizontal: margeDeLaFiche, gap: 18 }}>
            {/* **Sans couverture, la pastille revient dans le flux.** Elle vit
                sur l'image quand il y en a une ; un salon sans photo n'en a
                pas, et une fiche sans retour ne se quitte qu'en changeant
                d'onglet. */}
            {onRetour && !sourceDeCouverture(api, fiche) ? (
              <PastilleDeRetour onRetour={onRetour} flottante={false} />
            ) : null}
          <View style={{ gap: 10 }}>
            <View style={{ gap: 3 }}>
              <Texte variante="type.screenTitle" ellipseSurNomPropre>
                {fiche.name}
              </Texte>
              {fiche.address ? (
                // **Une épingle, et l'adresse entière.** L'adresse n'était
                // déjà tronquée nulle part — pas ici, pas ailleurs dans le
                // parcours créatrice, sweep fait — il ne lui manquait que le
                // repère visuel qui la distingue d'une ligne de texte
                // ordinaire.
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Icone nom="lieu" couleur="ink.soft" taille={16} />
                  <Texte variante="type.body" couleur="ink.soft" style={{ flexShrink: 1 }}>
                    {fiche.address}
                  </Texte>
                </View>
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

            {/* **Où le salon se montre ailleurs, avec son identité.** Le
                composant existait, testé, et n'était monté nulle part : le
                salon renseignait ses liens, le serveur les servait sur cette
                fiche, et personne ne les lisait. Il vit ici parce que c'est
                ce qu'on regarde avant de s'engager — voir à quoi ressemble le
                compte du salon dit si l'association convient — et il rend
                `null` quand rien n'est renseigné. */}
            <LesLiensDuSalon liens={fiche} />
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

          {/* **Où c'est, juste après ce que c'est.** Le fil annonçait « 190 m »
              et la fiche laissait le lieu redevenir une adresse à lire. La
              question se pose ici, entre l'identité et le choix d'une
              prestation : y aller à pied ou non change ce qu'on réserve. */}
          <OuEstLeLieu
            nom={fiche.name}
            lieu={
              fiche.longitude !== null && fiche.latitude !== null
                ? { longitude: fiche.longitude, latitude: fiche.latitude }
                : null
            }
            position={position}
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
            {/* **Un cœur qui échoue le dit.** Le retour en arrière était muet :
                le cœur se remplissait, revenait, et rien ne distinguait « je
                n'ai pas su enregistrer » de « tu n'as pas appuyé ». C'est
                exactement ce qui se lit comme « les favoris ne marchent
                pas ». */}
            {favoris.echec === null ? null : (
              <StatusMessage
                level="danger"
                body={t('parcours.filFavoriEchec', { prestation: favoris.echec })}
                testID="favori-non-enregistre"
              />
            )}

            {/* **Deux ensembles nommés et comptés, plus un titre et un
                séparateur.** Mêlées, une prestation fermée se lisait comme une
                erreur d'affichage. Comptées, les deux répondent d'un coup à
                « pourquoi trois ici et quatre là » : ce n'est pas le même
                ensemble, et l'écran le dit avant qu'on le demande. */}
            {ouvertes.length ? (
              <SectionDOffres
                titre={t('parcours.ficheOuvertes', {
                  count: formatNumber(ouvertes.length, locale),
                })}
                teintee
                testID="offres-ouvertes"
              >
                {ouvertes.map((offre) => (
                  <Offre
                    key={offre.tier_offer_id}
                    offre={offre}
                    // Le fuseau du salon : un « prochain créneau » se lit là
                    // où il a lieu, jamais dans le fuseau du téléphone.
                    timezone={fiche.timezone}
                    favoris={favoris}
                    onReserver={() => onReserver(offre, fiche)}
                  />
                ))}
              </SectionDOffres>
            ) : null}

            {fermees.length ? (
              <SectionDOffres
                titre={t('parcours.fichePasEncoreCompte', {
                  count: formatNumber(fermees.length, locale),
                })}
                testID="offres-fermees"
              >
                {/* **Ce qu'un compte connecté rapporterait, avant la liste.**
                    Un palier fermé faute de compte n'est pas un refus : c'est
                    deux réservations de plus, à deux minutes de distance. Le
                    dire après la liste des fermées le noierait dans le
                    constat. */}
                <ComptesQuiOuvriraient
                  offres={fermees}
                  onConnecter={onConnecterUnReseau}
                />
                {fermees.map((offre) => (
                  <Offre
                    key={offre.tier_offer_id}
                    offre={offre}
                    timezone={fiche.timezone}
                    favoris={favoris}
                    onReserver={() => onReserver(offre, fiche)}
                  />
                ))}
              </SectionDOffres>
            ) : null}
          </View>
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
        !aDesPages
          ? t('parcours.ficheCarteSurLeurSite')
          : fiche.menu_pages.length === 1
            ? t('parcours.ficheCartePagesUne')
            : t('parcours.ficheCartePages', {
                count: formatNumber(fiche.menu_pages.length, locale),
              })
      }
      onPress={aDesPages ? onOuvrirLaCarte : onSortirVersLeLien}
      testID="acces-carte"
    />
  );
}

/**
 * Le retour, seul dans sa pastille.
 *
 * **La flèche y est seule, et rien d'autre n'y entre.** Elle voyageait avec le
 * mot « Back » au-dessus du titre : sur un écran dont le premier objet est une
 * photo pleine largeur, cette ligne repoussait l'image d'un cran et lui retirait
 * son entrée. Un libellé ferait grandir la pastille en bouton, et un bouton posé
 * sur une photo se lit comme une action *sur la photo*.
 *
 * **Elle existe aussi sans image, et c'est la moitié qui compte.** Un salon qui
 * n'a pas de photo n'a pas de couverture ; une pastille qui ne vivrait que sur
 * l'image laisserait cette fiche-là sans issue — un écran de pile ne se quitte
 * pas autrement sur le web, où il n'y a ni geste ni bouton système.
 */
function PastilleDeRetour({
  onRetour,
  flottante,
}: {
  onRetour: () => void;
  /** Posée sur l'image quand il y en a une, dans le flux sinon. */
  flottante: boolean;
}) {
  const { t } = useI18n();
  const { color: c } = useTheme();

  return (
    <Pressable
      testID="retour"
      accessibilityRole="button"
      accessibilityLabel={t('common.retour')}
      onPress={onRetour}
      hitSlop={12}
      style={({ pressed }) => ({
        ...(flottante ? { position: 'absolute', top: 16, left: 18 } : { alignSelf: 'flex-start' }),
        width: PASTILLE_DE_RETOUR,
        height: PASTILLE_DE_RETOUR,
        borderRadius: radius['radius.pill'],
        alignItems: 'center',
        justifyContent: 'center',
        // Le voile de badge sur l'image — le jeton de ce qui se pose sur un
        // cadrage dont on ne sait rien. Dans le flux il n'y a rien à voiler.
        backgroundColor: flottante ? c['scrim.badge'] : 'transparent',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Icone nom="retour" couleur="ink.default" taille={20} />
    </Pressable>
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
/**
 * L'image de couverture, résolue — ou rien.
 *
 * **Une seule règle, lue à deux endroits.** La couverture s'efface sans photo,
 * et le corps doit alors reprendre le retour. Deux conditions écrites
 * séparément finiraient par diverger — et la fiche qui perdrait son issue
 * serait précisément celle que personne ne compose pour l'essayer : un salon
 * sans photo.
 *
 * **La première photo de la galerie sert de couverture par défaut.** Sans ce
 * repli, un salon qui a douze photos et pas de couverture déclarée perdait
 * l'entrée de sa galerie tout entière.
 */
function sourceDeCouverture(
  api: ReturnType<typeof useApi>['api'],
  fiche: FichePublique,
): { uri: string } | null {
  return urlImage(api.urlDuMedia(fiche.cover_photo_key ?? fiche.photos[0] ?? null)) ?? null;
}

function Couverture({
  fiche,
  onOuvrirLaGalerie,
  onRetour,
}: {
  fiche: FichePublique;
  onOuvrirLaGalerie: () => void;
  /**
   * Le retour, posé **sur** l'image.
   *
   * **La flèche est seule dans sa pastille.** Elle voyageait avec le mot
   * « Back » au-dessus du titre, dans le flux : sur un écran dont le premier
   * objet est une photo pleine largeur, une ligne de texte au-dessus repousse
   * l'image d'un cran et lui retire son entrée. La pastille est ronde, la
   * flèche y est seule, et rien d'autre n'y entre — un libellé la ferait
   * grandir en bouton, et un bouton posé sur une photo se lit comme une action
   * *sur la photo*.
   */
  onRetour?: () => void;
}) {
  const { api } = useApi();
  const { t, locale } = useI18n();
  const { color: c } = useTheme();

  const source = sourceDeCouverture(api, fiche);
  if (!source) return null;

  const compte = fiche.photos.length;

  return (
    <View testID="couverture" style={{ height: HAUTEUR_DE_COUVERTURE }}>
      {/* **La couverture a déjà sa hauteur**, et c'est ce qui empêchait la
          fiche entière de sauter. Il manquait le fondu — sur la plus grande
          image du produit, une apparition d'un coup se voit le plus. */}
      <Photo uri={source.uri} style={{ flex: 1 }} testID="couverture-photo" />

      {/* **La dissolution, et non un bord.** Du transparent vers la couleur de
          la page : l'image finit sans qu'on puisse dire où. `pointerEvents` à
          « none » parce qu'elle recouvre le bas de la photo, et une nappe qui
          arrête l'appui rendrait la pastille des photos inatteignable sur sa
          moitié haute. */}
      <LinearGradient
        testID="couverture-dissolution"
        pointerEvents="none"
        colors={[`${c['bg.page']}00`, c['bg.page']]}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: DISSOLUTION_DE_LA_COUVERTURE,
        }}
      />

      {onRetour ? <PastilleDeRetour onRetour={onRetour} flottante /> : null}

      {compte > 0 ? (
        <Pressable
          testID="acces-galerie"
          accessibilityRole="button"
          accessibilityLabel={
            compte === 1
              ? t('parcours.fichePhotosDetailUne')
              : t('parcours.fichePhotosDetail', { count: formatNumber(compte, locale) })
          }
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
            {compte === 1
              ? t('parcours.fichePhotosCompteUne')
              : t('parcours.fichePhotosCompte', { count: formatNumber(compte, locale) })}
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
        backgroundColor: c['bg.inset'],
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
      <Texte variante="type.dataLabel" couleur="ink.mute">
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

      <View style={{ backgroundColor: c['bg.inset'], padding: 14 }}>
        <Texte variante="type.data" ellipseSurNomPropre testID="domaine-de-sortie">
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
  favoris,
  onReserver,
}: {
  offre: OffreDeLaFiche;
  timezone: string;
  /**
   * Le cœur de cette ligne. **Sur les deux ensembles**, et c'est voulu :
   * garder une prestation qu'on ne peut pas encore réserver est exactement le
   * cas où l'avis de réouverture sert.
   */
  favoris: {
    estFavori: (catalogItemId: string, servi: boolean) => boolean;
    basculer: (
      catalogItemId: string,
      versFavori: boolean,
      servi: boolean,
      nom: string,
    ) => void;
  };
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
          <Photo
            uri={vignette?.uri}
            style={{ flex: 1 }}
            replit={<MediaFallback monogramme={offre.name} height={VIGNETTE_DE_L_OFFRE} />}
          />
        </View>
        <CoeurDeLOffre offre={offre} favoris={favoris} />
      </View>

      {/* **Ce qu'on donne est dans le bloc du service, sous un filet.**
          Séparée du nom par un simple écart, la contrepartie flottait entre
          deux prestations : on ne savait plus laquelle des deux elle
          concernait. Le filet la rattache — au-dessus ce qu'on prend, en
          dessous ce qu'on rend, et les deux sont la même carte.

          Un filet et non un second bloc : ce sont deux moitiés d'un contrat,
          pas deux objets. */}
      <View
        style={{
          gap: 8,
          paddingTop: 12,
          borderTopWidth: 1,
          borderTopColor: c['line.default'],
        }}
      >
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

/**
 * Un ensemble d'offres, nommé et **compté**.
 *
 * **Le compte est ce qui répare la plainte.** « Trois services ici, quatre
 * là » n'était pas une erreur : le fil ne montre que ce qui se réserve, la
 * fiche montre l'étagère entière. Un seul mot pour les deux ensembles laissait
 * le lecteur conclure qu'un des deux mentait. Nommer et compter chacun répond
 * avant qu'on demande.
 *
 * L'en-tête teinté désigne l'ensemble réservable — la seule teinte de cette
 * liste. Le second en-tête est neutre : ce qui n'est pas encore ouvert ne se
 * met pas en avant, il s'explique.
 */
function SectionDOffres({
  titre,
  teintee = false,
  children,
  testID,
}: {
  titre: string;
  teintee?: boolean;
  children: ReactNode;
  testID: string;
}) {
  const { color: c } = useTheme();

  return (
    <View testID={testID} style={{ gap: 12 }}>
      <View
        style={{
          borderRadius: radius['radius.md'],
          backgroundColor: teintee ? c['brand.50'] : c['bg.inset'],
          paddingVertical: 9,
          paddingHorizontal: 14,
        }}
      >
        <Texte
          variante="type.label"
          couleur={teintee ? 'brand.700' : 'ink.soft'}
          testID={`${testID}-titre`}
        >
          {titre.toUpperCase()}
        </Texte>
      </View>
      {children}
    </View>
  );
}

/**
 * Ce qu'un compte de plus ouvrirait, avec son geste.
 *
 * **La plainte se retourne en argument.** Un testeur a lu « trois services »
 * sur le fil et quatre sur la fiche : la quatrième était ouverte au palier
 * TikTok, et elle n'a pas de compte TikTok. Ce n'est pas une erreur de compte,
 * c'est une réservation qui l'attend de l'autre côté d'un branchement de deux
 * minutes.
 *
 * **Groupé par plateforme, et compté.** « Connecte TikTok » sans nombre ne
 * fait renoncer personne à renoncer ; « 2 services de plus » est ce qui décide.
 * Une plateforme n'apparaît que si elle ouvrirait quelque chose — c'est la même
 * règle que les pastilles de catégorie du fil, qu'on retire au lieu de griser.
 *
 * **Rien du tout quand rien ne tient à un compte.** Des abonnés qui manquent
 * ne se branchent pas, et proposer un geste qui n'y peut rien serait pire que
 * de se taire.
 */
function ComptesQuiOuvriraient({
  offres,
  onConnecter,
}: {
  offres: OffreDeLaFiche[];
  onConnecter?: () => void;
}) {
  const { t, locale } = useI18n();
  const { color: c } = useTheme();

  const parPlateforme = new Map<Platform, number>();
  for (const offre of offres) {
    // **Seulement le compte manquant.** Une offre fermée pour des abonnés
    // insuffisants *et* sans compte serait comptée ici alors qu'un branchement
    // ne l'ouvrirait pas : on exige que ce soit le seul obstacle.
    const raisons = new Set(offre.obstacles.map((obstacle) => obstacle.raison));
    if (raisons.size !== 1 || !raisons.has('no_social_account')) continue;
    parPlateforme.set(offre.platform, (parPlateforme.get(offre.platform) ?? 0) + 1);
  }

  if (parPlateforme.size === 0) return null;

  return (
    <View testID="comptes-qui-ouvriraient" style={{ gap: 10 }}>
      {[...parPlateforme.entries()].map(([plateforme, combien]) => (
        <View
          key={plateforme}
          testID={`connecter-${plateforme}`}
          style={{
            borderRadius: radius['radius.md'],
            backgroundColor: c['bg.surface'],
            borderWidth: 1,
            borderColor: c['line.default'],
            padding: 14,
            gap: 10,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {glypheDePlateforme(plateforme) === null ? null : (
              <Icone nom={glypheDePlateforme(plateforme)!} couleur="ink.default" taille={20} />
            )}
            <Texte variante="type.bodyStrong" style={{ flex: 1, minWidth: 0 }}>
              {t('parcours.ficheCompteOuvrirait', {
                count: formatNumber(combien, locale),
                reseau: nomDePlateforme(plateforme),
              })}
            </Texte>
          </View>
          {onConnecter ? (
            <Button
              label={t('parcours.ficheConnecter', { reseau: nomDePlateforme(plateforme) })}
              variant="secondary"
              size="sm"
              onPress={onConnecter}
              testID={`connecter-${plateforme}-action`}
            />
          ) : null}
        </View>
      ))}
    </View>
  );
}

/**
 * Le cœur d'une ligne de prestation. **L'interrupteur, et rien d'autre.**
 *
 * Il se colore et se remplit ; il ne porte aucun compte. Le compte appartient
 * à la porte du fil, où il dit ce qu'on trouvera derrière — sur une ligne, il
 * compterait un sous-ensemble d'une seule chose.
 *
 * **`brand.700` et non `brand.500`, et c'est mesuré** : 2,36:1 sur blanc pour
 * le 500, sous les 3:1 qu'un élément graphique porteur d'information doit
 * tenir. Or le remplissage est ici le seul signe qui distingue « gardé » de
 * « pas gardé ».
 *
 * **La cible fait 36, dans une ligne que la carte entoure.** Plus petit, le
 * doigt manque ; plus gros, il déborde sur le nom.
 */
function CoeurDeLOffre({
  offre,
  favoris,
}: {
  offre: OffreDeLaFiche;
  favoris: {
    estFavori: (catalogItemId: string, servi: boolean) => boolean;
    basculer: (
      catalogItemId: string,
      versFavori: boolean,
      servi: boolean,
      nom: string,
    ) => void;
  };
}) {
  const { t } = useI18n();
  const actif = favoris.estFavori(offre.catalog_item_id, offre.est_favori);

  return (
    <Pressable
      testID={`offre-${offre.tier_offer_id}-coeur`}
      accessibilityRole="switch"
      // **`checked`, et non `selected`.** Un interrupteur annonce son état par
      // `checked` — c'est ce que fait `Toggle`, le composant du dépôt qui porte
      // le même rôle. Avec `selected`, React Native ne rend aucun attribut
      // utilisable : un lecteur d'écran annonçait « garder en favori » sans
      // jamais dire si le cœur était posé ou non, sur le seul geste de cet
      // écran qui a deux états.
      //
      // Trouvé par un parcours de bout en bout qui cherchait un cœur non posé
      // et les prenait tous : l'attribut n'existait pas, donc le filtre ne
      // filtrait rien. Un test qui n'a pas su lire l'état a dit la même chose
      // qu'un lecteur d'écran qui ne l'entend pas.
      //
      // **Et `accessibilityState` ne suffisait pas non plus.** Cette version de
      // React Native Web ne le lit **pas du tout** : `createDOMProps` n'en
      // contient aucune mention, il lit `aria-checked` en propriété de premier
      // rang. Passer de `selected` à `checked` dans l'objet ne changeait donc
      // rien — le DOM ne portait toujours aucun attribut.
      //
      // Les deux sont posées : `aria-checked` pour le web, où elle est la seule
      // lue, et `accessibilityState` pour le natif, qui ne connaît qu'elle.
      // Vingt fichiers du dépôt utilisent la seconde seule ; voir `TASKS.md`.
      {...etatAccessible({ checked: actif })}
      accessibilityLabel={t(actif ? 'favoris.retirer' : 'favoris.garder', { nom: offre.name })}
      hitSlop={6}
      onPress={() =>
        favoris.basculer(offre.catalog_item_id, !actif, offre.est_favori, offre.name)
      }
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Icone nom="coeur" couleur={actif ? 'brand.700' : 'ink.default'} taille={20} rempli={actif} />
    </Pressable>
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
        backgroundColor: c['bg.inset'],
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
