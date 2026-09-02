/**
 * L'annuaire des créateurs, côté commerce abonné.
 *
 * **C'est ce que BIND vend.** Un salon paie pour l'accès à un réseau ; sans cet
 * écran, il ne voit que ce qui est déjà réservable autour de lui, et
 * l'abonnement n'a rien à montrer avant la première collaboration.
 *
 * **Aucun score de fiabilité, et l'écran n'en parle pas — c'est un
 * renversement.** Cet écran portait une ligne qui expliquait l'absence de note :
 * « nous ne vous montrons jamais de note, et nous ne classons jamais les
 * créatrices entre elles ». L'intention était bonne et l'effet inverse.
 * **Écrire qu'on ne montre pas la note apprend qu'une note existe**, et installe
 * un salon à la chercher ailleurs — chez la créatrice, ou en la demandant. La
 * ligne est retirée, et l'absence de mention est délibérée.
 *
 * Ce qui rend le silence tenable : le palier accessible **est** le signal. Un
 * score dégradé plafonne mécaniquement, donc une créatrice ouverte au palier
 * reel tient ses engagements — l'information passe sans être nommée, et sans
 * qu'un nombre permette de classer.
 *
 * **L'absence de contact, elle, s'explique**, et c'est l'exact inverse du cas
 * précédent. Un salon **cherchera** ce bouton, parce que tous les annuaires
 * qu'il connaît en ont un ; ne rien dire le laisse conclure au défaut. Une
 * absence qu'on ne cherche pas se tait, une absence qu'on cherche se dit.
 *
 * **Lecture seule.** On atteint une créatrice en ouvrant une prestation à son
 * palier — c'est le mécanisme du produit, et un raccourci ici en créerait un
 * second, hors du système de paliers.
 */
import React, { useEffect, useState } from 'react';

import { Linking, Pressable, View } from 'react-native';

import {
  useApi,
  type AnnuaireDuCommerce,
  type CreateurDeLAnnuaire,
  type PorteeLocale,
} from '../api';
import {
  Apparition,
  Button,
  EmptyState,
  Filet,
  Icone,
  PiluleDeProfil,
  SkeletonLignes,
  StatusMessage,
  Texte,
} from '../components';
import { Photo } from '../components';
import { formatDistance, formatNumber } from '../format';
import { useI18n } from '../i18n';
import { useGabarit } from '../shell/gabarit';
import { elevationDeCarte, radius, useColors } from '../theme';
import { Ecran } from './Ecran';
import { nomDePlateforme } from './obstacle';
import { useRequete } from './useRequete';

/** Le code que le serveur rend à un commerce sans abonnement vivant. */
const SANS_ABONNEMENT = 'subscription_required';

/**
 * Combien de créatrices par page.
 *
 * Vingt : de quoi remplir plusieurs rangées de la grille sans faire attendre
 * la première, et assez peu pour que « voir plus » reste un geste qui répond.
 * Le serveur plafonne à deux cents ; demander tout d'un coup ferait payer le
 * chargement de cent vingt-huit vignettes à qui n'en regarde que six.
 */
const PAGE = 20;

/**
 * L'instant d'une réponse qui n'a rien à dater.
 *
 * Le refus d'abonnement ne vieillit pas : il ne dépend d'aucune lecture, et la
 * mention « vu il y a deux minutes » n'aurait pas d'objet. Zéro dit « pas de
 * fraîcheur à annoncer » plutôt qu'une date inventée.
 */
const DEJA_SU = 0;

export function AnnuaireScreen({
  businessId,
  onRetour,
  retourVers,
  onVoirLAbonnement,
}: {
  businessId: string;
  onRetour?: () => void;
  /** Le nom de la destination du retour. Voir `BarreDeTitre`. */
  retourVers?: string;
  /**
   * Le chemin vers l'abonnement, depuis le mur qui le réclame.
   *
   * **Le refus menait nulle part.** L'écran interceptait bien le 402 et
   * expliquait qu'un abonnement manque — puis s'arrêtait là. C'est ce que BIND
   * vend, et le seul endroit où un commerce le rencontre.
   *
   * Optionnel : absent, la phrase reste et le bouton disparaît. Un bouton qui
   * ne mène nulle part vaut moins que pas de bouton.
   */
  onVoirLAbonnement?: () => void;
}) {
  const { api } = useApi();
  const { t, locale } = useI18n();
  // Lu ici et non dans le corps de rendu d'`Ecran` : ce corps est une fonction
  // appelée pendant le rendu d'un **autre** composant, et un hook y serait
  // appelé hors de son propre composant. Le gabarit est lu ici pour la même
  // raison, et il décide entre la grille et la pile virtualisée.
  const c = useColors();
  const { large } = useGabarit();

  const requete = useRequete<AnnuaireDuCommerce>(
    (signal) => api.annuaireDesCreateurs(businessId, { limite: PAGE }, signal),
    { estVide: (annuaire) => annuaire.createurs.length === 0, dependances: [businessId] },
  );

  // Les pages suivantes vivent à côté de la première, et non dans la requête :
  // recharger la requête entière pour une page de plus ferait clignoter tout
  // l'écran, compte compris, alors que seul le bas s'allonge.
  const [suite, setSuite] = useState<CreateurDeLAnnuaire[]>([]);
  const [enCours, setEnCours] = useState(false);

  // La première page change quand le salon change : la suite doit repartir de
  // zéro, sinon les créatrices d'un autre salon restent collées dessous.
  useEffect(() => {
    setSuite([]);
  }, [businessId]);

  // **Le refus d'abonnement n'est pas une panne.** L'écran d'erreur générique
  // proposerait « réessayer », ce qui ne mène nulle part : il n'y a rien à
  // réessayer, il y a un abonnement à prendre. On l'intercepte donc avant.
  const sansAbonnement =
    requete.etat === 'erreur' &&
    typeof requete.erreur === 'object' &&
    requete.erreur !== null &&
    'code' in requete.erreur &&
    (requete.erreur as { code?: string }).code === SANS_ABONNEMENT;

  if (sansAbonnement) {
    // Une réponse **prête**, dont le contenu est l'explication. Réutiliser
    // l'état d'erreur donnerait « réessayer », qui ne mène nulle part : il n'y
    // a rien à réessayer, il y a un abonnement à prendre.
    return (
      <Ecran
        requete={{
          etat: 'pret',
          donnees: { portee: PORTEE_INCONNUE, createurs: [], total: 0 },
          vide: false,
          rechargement: false,
          vuA: DEJA_SU,
          recharger: requete.recharger,
        }}
        onRetour={onRetour}
        retourVers={retourVers}
        titre={t('annuaire.titre')}
        nature="creator"
        testID="ecran-annuaire"
      >
        {() => (
          <View style={{ gap: 12 }}>
            <StatusMessage
              level="neutral"
              title={t('annuaire.abonnementRequis')}
              body={t('annuaire.abonnementRequisAide')}
              testID="annuaire-sans-abonnement"
            />
            {onVoirLAbonnement ? (
              <View style={{ alignSelf: 'flex-start' }}>
                <Button
                  label={t('annuaire.voirLesPlans')}
                  onPress={onVoirLAbonnement}
                  testID="voir-les-plans"
                />
              </View>
            ) : null}
          </View>
        )}
      </Ecran>
    );
  }

  /**
   * Les trois morceaux de l'écran, construits une fois pour les deux chemins.
   *
   * **La grille et la pile montrent la même chose.** Ce qui change entre elles
   * est la façon de poser les fiches, pas ce qu'elles portent — les écrire deux
   * fois les ferait diverger, et c'est celle que personne ne regarde qui
   * dériverait.
   *
   * Les éléments sont des **descripteurs** : la fonction de `FicheDeCreateur`
   * ne s'exécute — et son portrait ne se monte — que lorsque le rendu décide
   * d'afficher la rangée. Les construire en avance ne coûte que leur
   * allocation.
   */
  const decouper = (annuaire: AnnuaireDuCommerce) => {
    const createurs = [...annuaire.createurs, ...suite];
    const reste = annuaire.total - createurs.length;

    return {
      entete: (
        <View style={{ gap: 16 }}>
          {/* **Le compte, avant la liste.** C'est le renversement de la v3 : à
              deux mille créatrices un salon ne cherche pas, il ne connaît aucun
              nom. */}
          <Portee portee={annuaire.portee} />

          {/* **L'ordre se dit, il ne se devine pas.** Une grille triée sans
              l'annoncer se lit comme un ordre arbitraire, et le premier réflexe
              est de chercher un moyen de la trier — qui n'existe pas, puisque le
              seul ordre utile est déjà celui-là. */}
          {/* **Décrire un ordre demande un verbe, donc une phrase.** « Sorted
              by access, then distance » compte trente et un signes : au-delà de
              vingt-quatre, la passation (§13 ter) dit que ce n'est plus une
              étiquette mais du texte. Une étiquette nomme une catégorie ; ceci
              énonce une règle de tri, et les capitales espacées le faisaient
              lire deux fois. */}
          <Texte variante="type.caption" couleur="ink.soft" testID="ordre-de-la-grille">
            {t('annuaire.trieePar')}
          </Texte>
        </View>
      ),
      elements: createurs.map((createur) => ({
        cle: createur.creator_id,
        rendu: <FicheDeCreateur key={createur.creator_id} createur={createur} />,
      })),
      pied: (
        /* **« 20 sur 128 » demande de connaître le total.** Une page pleine ne
           dit pas s'il en reste, et une grille qui s'arrête sans le dire se lit
           comme la fin de l'annuaire. */
        <View style={{ gap: 8, alignItems: 'center' }}>
          <Texte variante="type.caption" couleur="ink.mute" testID="compte-affiche">
            {t('annuaire.affichees', {
              combien: formatNumber(createurs.length, locale),
              total: formatNumber(annuaire.total, locale),
            })}
          </Texte>
          {reste > 0 ? (
            <Pressable
              testID="voir-plus"
              accessibilityRole="button"
              disabled={enCours}
              onPress={() => {
                setEnCours(true);
                void api
                  .annuaireDesCreateurs(businessId, {
                    limite: PAGE,
                    decalage: createurs.length,
                  })
                  .then((page) => setSuite((avant) => [...avant, ...page.createurs]))
                  .finally(() => setEnCours(false));
              }}
              style={({ pressed }) => ({
                opacity: pressed || enCours ? 0.7 : 1,
                minHeight: 44,
                justifyContent: 'center',
                paddingHorizontal: 18,
                borderRadius: radius['radius.pill'],
                borderWidth: 1,
                borderColor: c['line.solo'],
              })}
            >
              <Texte variante="type.label">
                {t(enCours ? 'annuaire.chargement' : 'annuaire.voirPlus')}
              </Texte>
            </Pressable>
          ) : null}
        </View>
      ),
    };
  };

  return (
    <Ecran
      requete={requete}
      onRetour={onRetour}
      retourVers={retourVers}
      titre={t('annuaire.titre')}
      nature="creator"
      squelette={<SkeletonLignes combien={6} testID="squelette-annuaire" />}
      testID="ecran-annuaire"
      /**
       * **Virtualisée sur le téléphone, bloc sur les grands écrans.**
       *
       * « Voir plus » empile vingt créatrices par appui : après quatre appuis,
       * quatre-vingts portraits sont montés d'un coup. `Image` décode avant de
       * réduire — la vignette réduit ce que chacun coûte, la virtualisation
       * réduit combien en coûtent à la fois, et les deux se cumulent.
       *
       * **Au-dessus du seuil, la grille reste un bloc.** Trois colonnes en
       * `flexWrap` ne sont pas une liste, et le contrat de `liste` rend un
       * élément par rangée sans notion de colonnes. Le jour où quelqu'un mesure
       * la grille large, `FlatList` porte déjà `numColumns` — ce sera une ligne,
       * et elle ne sera pas plus chère plus tard.
       *
       * **Pas de crochet de fin de liste, et il n'en faut pas** : « voir plus »
       * est un appui explicite, donc il vit dans `pied` et défile sous la
       * dernière fiche.
       */
      liste={(annuaire) => {
        const morceaux = decouper(annuaire);
        return {
          entete: morceaux.entete,
          // **Une fiche par cellule, et la cellule prend sa part.** En bloc,
          // chaque fiche portait sa largeur en pourcentage ; en grille
          // virtualisée, c'est la liste qui répartit et l'élément n'a qu'à
          // remplir ce qu'on lui donne.
          elements: large
            ? morceaux.elements.map((element) => ({
                cle: element.cle,
                rendu: <View style={{ flex: 1, minWidth: 0 }}>{element.rendu}</View>,
              }))
            : morceaux.elements,
          pied: morceaux.pied,
          colonnes: large ? COLONNES : undefined,
        };
      }}
      vide={
        <EmptyState
          title={t('annuaire.videTitre')}
          body={t('annuaire.vide')}
          testID="annuaire-vide"
        />
      }
    >
      {/* **Le bloc sert l'état d'erreur, et lui seul.** `liste` couvre les deux
          gabarits ; ce corps-ci ne se rend que quand un rechargement échoue et
          qu'on avait déjà quelque chose — une liste datée sous un bandeau, qui
          n'a rien à virtualiser puisqu'on ne la parcourt pas, on la relit. */}
      {(annuaire) => {
        const morceaux = decouper(annuaire);

        return (
          <View style={{ gap: 16 }}>
            {morceaux.entete}
            {/* La même disposition qu'en liste, en bloc : trois colonnes en
                `flexWrap` au-dessus du seuil, une pile en dessous. */}
            <Grille>{morceaux.elements.map((element) => element.rendu)}</Grille>
            {morceaux.pied}
          </View>
        );
      }}
    </Ecran>
  );
}

/**
 * Ce que le refus d'abonnement laisse comme portée : rien de chiffrable.
 *
 * Zéro partout **n'est pas un compte à zéro** — c'est l'absence de compte. La
 * carte ne se rend pas dans ce cas, et ces valeurs ne sont jamais lues ; elles
 * existent pour que la réponse simulée ait la forme d'une réponse.
 */
const PORTEE_INCONNUE: PorteeLocale = {
  createurs: 0,
  peuvent_reserver: 0,
  rayon_metres: 0,
  gains_par_palier: [],
};

/**
 * Le compte, et ce qu'un palier de plus ouvrirait.
 *
 * **C'est par là que l'écran commence, et c'est la décision de la v3.** Un champ
 * de recherche ne sert qu'à qui sait déjà quoi taper — c'est-à-dire à personne,
 * ici. Ce qu'un salon veut savoir tient en une question : combien de gens
 * peuvent réserver ce que j'ai ouvert, et est-ce que j'en aurais plus en
 * ouvrant davantage.
 *
 * **Le gain n'est pas un total, et c'est la faute à ne pas commettre.**
 * `createurs_en_plus` compte ce que l'ouverture *ajoute* : les populations se
 * recouvrent — une créatrice qui ouvre le reel ouvre le story — et additionner
 * des totaux par palier annoncerait un marché qui n'existe pas. La phrase se
 * compose donc `peuvent_reserver + createurs_en_plus`.
 *
 * **Jamais « 128 créatrices » tout court.** Celles qui n'ont pas renseigné de
 * position ne sont comptées nulle part : le nombre est celui des créatrices
 * dont on peut affirmer qu'elles sont dans le rayon. « Autour de vous » est
 * donc obligatoire dans la phrase, pas décoratif.
 */
function Portee({ portee }: { portee: PorteeLocale }) {
  const { t, locale } = useI18n();
  const c = useColors();

  // Rien autour : la carte se tait plutôt que d'afficher « 0 des 0 ». L'écran
  // a déjà son état vide, qui dit la même chose en mieux.
  if (portee.createurs === 0) return null;

  // Le meilleur candidat, un seul. La planche montre une phrase, pas une liste
  // de paliers à comparer — et un gain nul ne se propose pas.
  const meilleur = portee.gains_par_palier.reduce<PorteeLocale['gains_par_palier'][number] | null>(
    (garde, gain) =>
      gain.createurs_en_plus > 0 && (garde === null || gain.createurs_en_plus > garde.createurs_en_plus)
        ? gain
        : garde,
    null,
  );

  return (
    <View
      testID="portee-du-salon"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 18,
        padding: 18,
        borderRadius: radius['radius.lg'],
        backgroundColor: c['brand.100'],
      }}
    >
      <View style={{ gap: 2 }}>
        <Texte variante="type.figure" testID="peuvent-reserver">
          {formatNumber(portee.peuvent_reserver, locale)}
        </Texte>
        <Texte variante="type.caption" couleur="ink.soft">
          {t('annuaire.porteeSur', {
            total: formatNumber(portee.createurs, locale),
            km: String(Math.round(portee.rayon_metres / 1000)),
          })}
        </Texte>
      </View>

      <View style={{ flex: 1, gap: 4 }}>
        <Texte variante="type.body">{t('annuaire.porteePeuvent')}</Texte>
        {meilleur ? (
          <Texte variante="type.body" testID="gain-de-palier">
            {t('annuaire.porteeGain', {
              palier: t(`parcours.format_${meilleur.content_format}`),
              total: formatNumber(portee.peuvent_reserver + meilleur.createurs_en_plus, locale),
            })}
          </Texte>
        ) : null}
      </View>
    </View>
  );
}

/**
 * La grille de la planche : trois par rangée en bureau, une colonne en compact.
 *
 * **`flexWrap` et non une liste à colonnes.** Le nombre de cartes varie, et un
 * découpage en colonnes fixes laisse un trou au bout de la dernière rangée ou
 * force à répartir soi-même — deux façons de se tromper pour un résultat que
 * l'enroulement donne sans calcul. La largeur en pourcentage tient la rangée
 * même quand la dernière est incomplète.
 */
/**
 * Trois colonnes au-dessus du seuil.
 *
 * Nommé plutôt qu'écrit deux fois : la grille en bloc et la grille virtualisée
 * doivent tomber d'accord, et deux constantes finiraient par diverger — c'est
 * la largeur des fiches qui changerait sans que la disposition suive.
 */
const COLONNES = 3;

function Grille({ children }: { children: React.ReactNode }) {
  const { large } = useGabarit();

  if (!large) return <View style={{ gap: 14 }}>{children}</View>;

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
      {React.Children.map(children, (enfant) => (
        <View style={{ width: `${100 / COLONNES}%`, flexGrow: 1, flexBasis: 260, maxWidth: 420 }}>
          {enfant}
        </View>
      ))}
    </View>
  );
}

/**
 * Une fiche de la grille, dans l'ordre de la planche.
 *
 * **La photo d'abord, le pseudonyme ensuite, l'accès en dernier.** C'est
 * l'ordre dans lequel un salon lit une carte : il reconnaît un compte à son
 * image, il en note le nom, puis il regarde ce qu'il peut en faire. L'écran
 * mettait le nom en tête d'une rangée horizontale, ce qui donnait trois
 * colonnes de texte et une photo de cinquante-six points perdue à gauche.
 *
 * **La distance est sur la même ligne que le pseudonyme**, alignée à droite :
 * c'est le second critère du tri, et le lire à côté du premier fait comprendre
 * l'ordre de la grille sans qu'on l'explique.
 *
 * **Ce qu'elle ouvre ici, et rien de ce qu'elle ouvre ailleurs.** Le serveur
 * sert `palier_accessible` pour ce salon, et non l'éligibilité de la créatrice
 * contre tous les paliers du produit — une version antérieure faisait cela, et
 * répondait « elle se qualifie quelque part », ce qu'un salon ne peut ni
 * utiliser ni avoir à connaître.
 *
 * **Mais la donnée juste s'écrivait avec le mauvais mot.** La carte portait un
 * `TierBadge` marqué « post », et le mot est celui du système de paliers, qui
 * appartient à l'autre côté du produit. Un gérant lit « post » sur une fiche et
 * comprend « son palier est post » : la valeur désignait son propre catalogue,
 * la lecture désignait une personne. C'est ce qui est arrivé, en campagne, et
 * c'est le seul défaut qu'il y avait — la donnée n'a pas bougé, le mot si.
 *
 * La carte dit maintenant ce que le salon peut en faire : « elle peut réserver
 * chez vous », ou ce qu'il n'a pas ouvert pour elle. C'est aussi exactement le
 * premier critère du tri, donc la phrase explique l'ordre de la liste, ce que
 * le badge ne faisait qu'indirectement.
 *
 * Une créatrice qui n'ouvre rien ici garde sa carte entière — elle n'est pas
 * atténuée, le tri l'a déjà mise en fin de liste, et l'effacer reviendrait à
 * cacher la moitié du marché que l'abonnement fait voir.
 */
/** Le côté de l'avatar, rond : une photo de profil arrive ronde. */
const AVATAR = 56;

function FicheDeCreateur({ createur }: { createur: CreateurDeLAnnuaire }) {
  const { api } = useApi();
  const { t, locale } = useI18n();
  const c = useColors();

  const nom = createur.comptes.find((compte) => compte.handle)?.handle ?? t('annuaire.sansNom');

  // **La vignette, sauf sur un aperçu flouté.** L'original partait pour tous, et
  // `Image` décode avant de réduire : vingt portraits de pleine taille tenaient
  // leur pleine taille en mémoire dans des cadres de 132 points.
  //
  // La clé nue n'était pas un choix contre la vignette — celle-ci existait
  // depuis la veille et le repli de la route depuis huit jours quand cette
  // grille a été écrite. C'était la forme juste dans le cas dangereux, prise
  // faute de séparer les deux. `urlDuPortrait` les sépare.
  const portrait = api.urlDuPortrait(
    createur.comptes.find((compte) => compte.avatar_key)?.avatar_key ?? null,
  );

  /**
   * Le compte qui mène quelque part, et le seul geste de la ligne.
   *
   * **Aucun compte d'abonnés.** La table des retraits l'a tranché en v9 :
   * l'audience appartient à la fiche qu'on ouvre pour décider, pas à une liste
   * qu'on parcourt. Ce qui sert ici est de savoir *sur quel réseau* et *où ça
   * mène*.
   */
  const profil = createur.comptes.find((compte) => compte.profil_url) ?? null;

  // « Wynwood, 320 m » : la virgule et non le point médian, qui est le
  // séparateur de champs — la ville et la distance forment une seule situation.
  const situation = [
    createur.city,
    createur.distance_metres === null ? null : formatDistance(createur.distance_metres, locale),
  ]
    .filter(Boolean)
    .join(', ');

  return (
    /**
     * **Une ligne, et l'avatar y est rond.** Une photo de profil arrive ronde ;
     * la poser dans un cadre carré de 132 la recadrait en la coupant — la
     * composition imposait une forme au lieu de la recevoir. Un cercle de 56 en
     * tête de ligne la reçoit entière, et six créatrices tiennent là où deux
     * cartes tenaient.
     *
     * **La ligne entière est la cible, et rien d'autre dedans ne l'est.** Le
     * geste de cet écran est unique — aller voir son travail chez elle — et
     * c'est ce qui permet aux deux glyphes de droite de n'être que des marques.
     */
    <Pressable
      testID={`createur-${createur.creator_id}`}
      accessibilityRole={profil ? 'link' : undefined}
      /**
       * **Ce que le salon peut en faire, dit et non peint.**
       *
       * L'anneau d'encre porte le premier critère du tri à l'œil ; seul, il
       * ferait reposer un état sur la couleur, ce que le produit refuse
       * ailleurs. Le libellé le dit donc en toutes lettres — et il dit ce que
       * *le salon* peut en faire, jamais le palier de la créatrice, qui est un
       * fait de son compte et non de cette relation.
       */
      accessibilityLabel={[
        nom,
        situation,
        t(createur.peut_reserver_ici ? 'annuaire.paliersOuverts' : 'annuaire.aucunPalier'),
        profil ? t('annuaire.voirLeProfil', { reseau: nomDePlateforme(profil.platform) }) : null,
      ]
        .filter(Boolean)
        .join(' — ')}
      disabled={!profil}
      onPress={() => profil && void Linking.openURL(profil.profil_url as string)}
      style={({ pressed }) => ({
        opacity: pressed ? 0.7 : 1,
        minHeight: 76,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        borderBottomWidth: 1,
        borderBottomColor: c['line.default'],
      })}
    >
      {/* **Le cercle porte le premier critère du tri.** Le contour d'encre
          disait « celle-ci peut réserver chez vous » sur la carte ; il tient le
          même rôle sur l'anneau, sans coûter une ligne de texte par rangée. */}
      <View
        testID={`portrait-${createur.creator_id}`}
        style={{
          width: AVATAR,
          height: AVATAR,
          borderRadius: radius['radius.pill'],
          overflow: 'hidden',
          backgroundColor: c['media.placeholder'],
          borderWidth: createur.peut_reserver_ici ? 2 : 0,
          borderColor: c['line.solo'],
        }}
      >
        <Photo uri={portrait} style={{ flex: 1 }} testID={`photo-${createur.creator_id}`} />
      </View>

      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Texte variante="type.bodyStrong" ellipseSurNomPropre>
          {nom}
        </Texte>
        {/* **La ville avec la distance, jointes par une virgule.** « Wynwood »
            situe, « 320 m » mesure : la distance seule ne dit pas de quel côté.
            Nulle veut dire « on ne sait pas », jamais « loin » — la ligne se
            tait alors plutôt que d'écrire un tiret. */}
        {situation ? (
          <Texte
            variante="type.body"
            couleur="ink.soft"
            ellipseSurNomPropre
            testID={`ville-${createur.creator_id}`}
          >
            {situation}
          </Texte>
        ) : null}
      </View>

      {/* **De quel réseau, puis où ça mène** : c'est l'ordre de lecture, et les
          deux sont des marques. La cible est la rangée. */}
      {profil ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Icone
            nom={profil.platform === 'tiktok' ? 'tiktok' : 'instagram'}
            couleur="ink.default"
            taille={20}
          />
          <Icone nom="sortie" couleur="ink.soft" taille={18} />
        </View>
      ) : null}
    </Pressable>
  );
}
