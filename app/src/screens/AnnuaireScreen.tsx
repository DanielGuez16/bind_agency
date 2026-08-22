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
  SkeletonLignes,
  StatusMessage,
  Texte,
  TierBadge,
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
  onVoirLAbonnement,
}: {
  businessId: string;
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
  // appelé hors de son propre composant.
  const c = useColors();

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

  return (
    <Ecran
      requete={requete}
      titre={t('annuaire.titre')}
      nature="creator"
      squelette={<SkeletonLignes combien={6} testID="squelette-annuaire" />}
      testID="ecran-annuaire"
      vide={
        <EmptyState
          title={t('annuaire.videTitre')}
          body={t('annuaire.vide')}
          testID="annuaire-vide"
        />
      }
    >
      {(annuaire) => {
        const createurs = [...annuaire.createurs, ...suite];
        const reste = annuaire.total - createurs.length;

        return (
          <View style={{ gap: 16 }}>
            {/* **Le compte, avant la liste.** C'est le renversement de la v3 : à
                deux mille créatrices un salon ne cherche pas, il ne connaît
                aucun nom. */}
            <Portee portee={annuaire.portee} />

            {/* **L'ordre se dit, il ne se devine pas.** Une grille triée sans
                l'annoncer se lit comme un ordre arbitraire, et le premier
                réflexe est de chercher un moyen de la trier — qui n'existe pas,
                puisque le seul ordre utile est déjà celui-là. */}
            <Texte variante="type.label" couleur="ink.mute" testID="ordre-de-la-grille">
              {t('annuaire.trieePar')}
            </Texte>

            <Grille>
              {createurs.map((createur) => (
                <FicheDeCreateur key={createur.creator_id} createur={createur} />
              ))}
            </Grille>

            {/* **« 20 sur 128 » demande de connaître le total.** Une page pleine
                ne dit pas s'il en reste, et une grille qui s'arrête sans le dire
                se lit comme la fin de l'annuaire. */}
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
                    borderColor: c['line.ink'],
                  })}
                >
                  <Texte variante="type.label">
                    {t(enCours ? 'annuaire.chargement' : 'annuaire.voirPlus')}
                  </Texte>
                </Pressable>
              ) : null}
            </View>
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
function Grille({ children }: { children: React.ReactNode }) {
  const { large } = useGabarit();

  if (!large) return <View style={{ gap: 14 }}>{children}</View>;

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
      {React.Children.map(children, (enfant) => (
        <View style={{ width: `${100 / 3}%`, flexGrow: 1, flexBasis: 260, maxWidth: 420 }}>
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
 * **Ce qu'elle ouvre ici, et rien de ce qu'elle ouvre ailleurs.** Le badge
 * porte `palier_accessible`, servi par le serveur pour ce salon. Une créatrice
 * qui n'ouvre rien ici garde sa carte entière — elle n'est pas atténuée, le tri
 * l'a déjà mise en fin de liste, et l'effacer reviendrait à cacher la moitié du
 * marché que l'abonnement fait voir.
 */
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

  const compte = createur.comptes.find((c) => c.followers !== null) ?? createur.comptes[0];

  return (
    // **Le contour d'encre dit « celle-ci peut réserver chez vous ».** C'est le
    // seul trait de la grille, et il porte le premier critère du tri — la même
    // grammaire qu'aux réservations, où l'encre marque ce qui engage. Les
    // autres gardent le filet clair : présentes, pas mises en avant.
    //
    // L'ombre suit la règle du système : « un coin de 18 px sans ombre flotte
    // au lieu de se poser », passation §2. La planche dessine les cartes à
    // plat ; le produit ne le fait nulle part ailleurs, et une grille qui
    // flotte au milieu d'écrans qui se posent se remarque plus que la fidélité.
    //
    // **Les commentaires sont ici et non dans le bloc de style, et ce n'est pas
    // cosmétique.** L'inventaire des cartes lit un bloc sur neuf cents
    // caractères ; quatre lignes de prose à l'intérieur ont suffi à faire
    // sortir cette carte de l'inventaire — sans erreur, sans avertissement, la
    // garde cessant simplement de la voir. Le trou est documenté dans
    // `TASKS.md` ; en attendant, la prose reste dehors.
    <View
      testID={`createur-${createur.creator_id}`}
      style={{
        borderRadius: radius['radius.lg'],
        backgroundColor: c['bg.surface'],
        overflow: 'hidden',
        borderWidth: createur.peut_reserver_ici ? 1.5 : 1,
        borderColor: createur.peut_reserver_ici ? c['line.ink'] : c['line.default'],
        ...elevationDeCarte(),
      }}
    >
      <View
        testID={`portrait-${createur.creator_id}`}
        style={{ height: 132, backgroundColor: c['bg.sunken'] }}
      >
        <Photo
          uri={portrait}
          style={{ flex: 1 }}
          testID={`photo-${createur.creator_id}`}
        />
      </View>

      <View style={{ padding: 14, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
          <Texte variante="type.bodyStrong" style={{ flex: 1, minWidth: 0 }} ellipseSurNomPropre>
            {nom}
          </Texte>
          {/* **Nulle veut dire « on ne sait pas », jamais « loin ».** Un tiret
              se lirait comme une absence de proximité ; la ligne se tait. */}
          {createur.distance_metres !== null ? (
            <Texte
              variante="type.monoSmall"
              couleur="ink.mute"
              testID={`distance-${createur.creator_id}`}
            >
              {formatDistance(createur.distance_metres, locale)}
            </Texte>
          ) : null}
        </View>

        {/* **La ville avec la distance, comme la planche les pose.** « Wynwood ·
            320 m » situe ; la distance seule ne dit pas de quel côté. Elle
            manquait de ma première grille, et c'est la garde des champs servis
            qui l'a dit — un champ que le serveur rend et que l'écran cesse de
            lire est un défaut, pas une simplification. */}
        {createur.city ? (
          <Texte
            variante="type.caption"
            couleur="ink.soft"
            testID={`ville-${createur.creator_id}`}
          >
            {createur.city}
          </Texte>
        ) : null}

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          {compte ? (
            <>
              <Icone nom={compte.platform === 'tiktok' ? 'tiktok' : 'instagram'} taille={18} />
              <Texte variante="type.monoSmall" style={{ flex: 1 }}>
                {compte.followers === null
                  ? nomDePlateforme(compte.platform)
                  : formatNumber(compte.followers, locale)}
              </Texte>
            </>
          ) : null}
          {createur.palier_accessible ? (
            <TierBadge
              tier={createur.palier_accessible.content_format}
              size="sm"
              testID={`palier-${createur.creator_id}`}
            />
          ) : null}
        </View>

        {createur.peut_reserver_ici ? null : (
          <Texte
            variante="type.caption"
            couleur="ink.mute"
            testID={`sans-palier-${createur.creator_id}`}
          >
            {t('annuaire.aucunPalier')}
          </Texte>
        )}

        {/* Le pseudonyme mène au profil public : le seul geste de l'écran, et
            il sort du produit — on va voir son travail chez elle. */}
        {createur.comptes
          .filter((c) => c.profil_url)
          .map((c) => (
            <Pressable
              key={`${c.platform}-${c.handle}`}
              accessibilityRole="link"
              onPress={() => void Linking.openURL(c.profil_url as string)}
              testID={`profil-${createur.creator_id}-${c.platform}`}
              style={({ pressed }) => ({
                opacity: pressed ? 0.7 : 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
              })}
            >
              <Texte variante="type.caption" couleur="brand.700">
                {t('annuaire.voirLeProfil', { reseau: nomDePlateforme(c.platform) })}
              </Texte>
              <Icone nom="sortie" taille={13} couleur="brand.700" />
            </Pressable>
          ))}

        {/* **L'absence de contact se dit.** Un salon cherchera ce bouton — tous
            les annuaires qu'il connaît en ont un — et ne rien dire le laisse
            conclure au défaut. C'est l'inverse du score, qu'on tait justement
            parce que personne ne le cherche. */}
        <Texte
          variante="type.caption"
          couleur="ink.mute"
          testID={`pas-de-contact-${createur.creator_id}`}
        >
          {t('annuaire.pasDeContact')}
        </Texte>
      </View>
    </View>
  );
}
