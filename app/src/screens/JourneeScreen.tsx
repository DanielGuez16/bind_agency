/**
 * 12a · La journée du comptoir.
 *
 * **L'heure est celle du commerce, découpée dans son fuseau.** Le serveur rend
 * les bornes qu'il a réellement utilisées ; l'écran les affiche telles quelles
 * plutôt que de recalculer, sinon deux découpages coexisteraient et l'un des
 * deux serait faux.
 *
 * **Les droits sans créneau figurent dans la liste**, après le planning. Ils se
 * présentent au comptoir ce jour-là comme les autres ; les omettre ferait
 * arriver quelqu'un qui n'est sur aucune liste.
 *
 * **Ce qui attend une décision passe devant.** Une réservation en attente tient
 * une place et bloque une créatrice qui ne peut rien faire d'autre que patienter
 * ; la laisser au milieu du planning, dans l'ordre des heures, la ferait
 * découvrir en la cherchant. Le bloc disparaît quand il est vide.
 *
 * **Une demande dont l'heure est passée ne se propose plus.** Il est 11 h 35,
 * la demande porte sur 10 h 45 : accepter produirait une réservation confirmée
 * pour un rendez-vous qui n'aura pas lieu, et un code de retrait pour un
 * créneau écoulé. Le serveur refuse, et l'écran cesse de le proposer plutôt que
 * de laisser découvrir le refus en appuyant. Refuser reste offert — un commerce
 * qui répond en retard dit quand même ce qu'il en était.
 *
 * **Se désister n'est pas constater une absence.** Deux actions distinctes,
 * jamais deux libellés de la même : l'une ne pénalise personne, l'autre inscrit
 * un événement négatif au dossier de la créatrice. Les réunir sous un même
 * bouton ferait de la pénalité une case à cocher.
 *
 * **Aucun montant.** L'écran de journée n'est pas un état de caisse.
 *
 * **Une liste sélectionne, un panneau agit** (campagne 2). La colonne de gauche
 * mêlait deux registres — des cartes en relief pour ce qui attend une décision,
 * des lignes plates pour le planning — et portait elle-même les boutons. Le
 * panneau de droite se contentait alors de **redessiner la ligne choisie**, ce
 * qui se lisait comme un doublon : la même réservation deux fois, et rien à y
 * faire. Un seul registre à gauche, marqué par une pastille et non par un
 * relief ; les gestes et le contexte à droite, où il y a la place de les poser.
 */
import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';

import {
  useApi,
  type JourneeDuCommerce,
  type ReservationDuCommerce,
  type VueDActivation,
} from '../api';
import {
  Apparition,
  Button,
  DataRow,
  EmptyState,
  Filet,
  Icone,
  LigneDeContrepartie,
  SkeletonLignes,
  StatusMessage,
  Texte,
  TextField,
  TierBadge,
  vibration,
} from '../components';
import { formatDateTime, formatHeure, formatNumber, jourCivil } from '../format';
import { useI18n, type SupportedLocale } from '../i18n';
import { breakpoint, elevationDeCarte, radius, size, useTheme, type ColorName } from '../theme';
import { ECART_DES_COLONNES, useGabarit } from '../shell/gabarit';
import { Ecran } from './Ecran';
import { nomDePlateforme } from './obstacle';
import { BandeauDeMiseEnLigne } from './journee/BandeauDeMiseEnLigne';
import { BandeauDeReprise } from './journee/BandeauDeReprise';
import { ExceptionDuJour } from './journee/ExceptionDuJour';
import { horairesDuJour, jourEnToutesLettres, limiteTombeAujourdhui } from './journee/entete';
import { useRequete } from './useRequete';

export function JourneeScreen({ businessId, jour }: { businessId: string; jour?: string }) {
  const { api } = useApi();
  const { t, locale } = useI18n();
  const { color: c } = useTheme();
  const { large } = useGabarit();
  // La ligne que l'on a **touchée**. Nulle tant qu'on n'a rien touché : le
  // panneau s'ouvre alors sur ce qui attend une décision, et à défaut sur la
  // première ligne du jour.
  const [choisie, setChoisie] = useState<string | null>(null);

  const requete = useRequete<JourneeDuCommerce & { activation: VueDActivation | null }>(
    async (signal) => {
      const [journee, activation] = await Promise.all([
        api.journeeDuCommerce(businessId, jour, signal),
        // **L'état de publication, avec la journée.** Il ne concerne pas la
        // journée et c'est pourtant ici qu'il doit se voir : c'est l'écran du
        // matin, et un salon invisible n'a aucune raison d'aller le chercher
        // dans un onglet dont les testeurs ne comprenaient pas l'objet.
        //
        // Un échec ne remonte pas : l'état de publication qui manque ne doit
        // pas empêcher la journée de s'afficher. Le bandeau se tait alors,
        // ce qui est le bon défaut — voir `miseEnLigne`.
        api.etapesDActivation(businessId, signal).catch(() => null),
      ]);
      return { ...journee, activation };
    },
    {
      // **Vide veut dire « rien du tout », et les demandes en font partie.**
      // Le vide ne regardait que les rendez-vous du jour ; or `a_trancher` est
      // servi toutes dates confondues, précisément pour qu'une décision à
      // prendre pour après-demain ne se perde pas. Un salon sans rendez-vous
      // aujourd'hui et deux demandes en attente voyait donc « aucun
      // rendez-vous » — la seule chose urgente du produit, invisible.
      estVide: (journee) => journee.items.length === 0 && journee.a_trancher.length === 0,
      dependances: [businessId, jour],
    },
  );

  // **Le titre compte les décisions, et il se lit avant les données.** Il vient
  // donc de la requête directement plutôt que du rendu : la barre est posée
  // hors des quatre états — c'est ce qui empêche la page de sauter à chaque
  // rafraîchissement — et un titre calculé dans le corps n'y arriverait jamais.
  const chargee = requete.etat === 'pret' ? requete.donnees : null;
  const enAttente = chargee?.a_trancher.length ?? 0;

  // **Le bandeau de reprise se pose hors des quatre états**, comme le titre.
  // Une journée sans rendez-vous rend l'état vide, qui ne rend pas ses enfants
  // — et c'est précisément le jour où une reprise est la plus probable : on
  // entre dans un compte pour débloquer une configuration, pas un jour chargé.
  // Le laisser dans le corps l'aurait éteint le seul jour qui compte.
  const repriseEnCours = chargee ? (
    <BandeauDeReprise businessId={businessId} timezone={chargee.timezone} />
  ) : null;

  return (
    <Ecran
      requete={requete}
      // **Deux clés plutôt qu'un pluriel de bibliothèque.** `count` traverse
      // `formaterLesNombres`, qui le rend en chaîne pour le séparateur de
      // milliers : i18n-js ne le voit plus comme un nombre et sa pluralisation
      // ne se déclenche pas. Le choix se fait donc ici, où il se lit.
      titre={
        enAttente === 0
          ? t('commerce.journeeRienAAnswer')
          : enAttente === 1
            ? t('commerce.journeeDecisionUne')
            : t('commerce.journeeDecisions', { count: enAttente })
      }
      // **Le jour descend, et les horaires n'y sont pas.** La planche écrit
      // « open 09:00 to 19:00 » ; `debut` et `fin` sont les bornes de la
      // journée *comptée*, pas les heures d'ouverture — les rendre comme telles
      // annoncerait « de 00:00 à 00:00 ». Les horaires vivent sur une autre
      // ressource, et les chercher ici coûterait une seconde requête à l'écran
      // le plus ouvert du produit pour une ligne qui situe. Voir `TASKS.md`.
      sousTitre={
        chargee
          ? [
              jourEnToutesLettres(chargee.jour, locale),
              // **Les horaires, enfin, et ils viennent de leur propre champ.**
              // Cette ligne est restée muette une version durant parce que
              // `debut` et `fin` de la journée passaient pour des heures
              // d'ouverture : ce sont les bornes de la journée comptée, et les
              // écrire aurait annoncé « de 00:00 à 00:00 ».
              horairesDuJour(chargee.horaires) ??
                // Fermé se dit : un jour creux ne se lit pas pareil selon qu'on
                // était fermé ou que personne n'est venu.
                t('commerce.journeeFerme'),
            ].join(' · ')
          : null
      }
      nature="merchantListeDetail"
      squelette={<SkeletonLignes combien={6} testID="squelette-journee" />}
      testID="ecran-journee"
      vide={
        <>
        {repriseEnCours}
        {/* **Plus de cercle.** Il ne disait rien et occupait la place du titre.
            Une journée sans rendez-vous est une information, pas une page qui
            n'a pas chargé — et c'est le titre qui doit le dire. */}
        <EmptyState
          title={t('commerce.journeeVideTitre')}
          body={t('commerce.journeeVide')}
          testID="journee-vide"
        />
        </>
      }
    >
      {(journee) => {
        // La file vient du serveur, pas d'un filtre sur la journée : une
        // décision à prendre pour après-demain n'est dans aucune journée qu'on
        // ouvre, et la filtrer ici l'aurait laissée invisible.
        const aTrancher = journee.a_trancher;
        const planning = journee.items.filter((r) => r.status !== 'awaiting_business');

        /**
         * **La liste se coupe par ce qu'elle demande, pas par des statuts.**
         *
         * Le tri par statut mélangeait ce qui attend une action et ce qui n'en
         * attend plus : une absence à constater et une prestation servie la
         * veille se lisaient dans la même colonne, au même poids. Un statut ne
         * devient une section que **s'il change ce que la vendeuse doit
         * faire** — sinon c'est une nuance, et elle vit dans la ligne.
         *
         * Trois groupes, donc. Ce qui attend quelqu'un — la décision à prendre
         * et la personne qui va arriver — passe en tête. Ce qui est servi
         * attend sa publication et n'attend rien du salon. Ce qui est clos ne
         * se rouvre pas.
         */
        /**
         * **Trois natures, du plus urgent au plus froid.** Le tri par statut
         * mélangeait ce qui attend une action et ce qui n'en attend plus : une
         * absence à constater et une prestation servie la veille se lisaient
         * dans la même colonne, au même poids. Un statut ne devient une section
         * que **s'il change ce que la vendeuse doit faire** — sinon c'est une
         * nuance, et elle vit dans la ligne.
         *
         * **Servi et clos n'en font plus qu'un**, et c'est la v3 qui les
         * rassemble. Ils étaient séparés parce qu'une contrepartie court encore
         * dans un cas et plus dans l'autre — vrai, mais c'est une différence
         * pour la créatrice, pas pour le comptoir : des deux côtés il n'y a
         * plus rien à faire aujourd'hui. La nuance reste écrite sur la ligne.
         */
        const attendues = planning.filter((r) => !TERMINES.has(r.status));
        const finies = planning.filter((r) => TERMINES.has(r.status));
        /**
         * Ce que le panneau montre à l'ouverture.
         *
         * **Il ne s'ouvrait sur rien**, au motif que pré-ouvrir une ligne
         * ferait croire qu'elle demande quelque chose. C'était raisonner à
         * l'envers : les deux tiers de l'écran restaient occupés par une seule
         * phrase, « choisissez une réservation à gauche », et c'est ce qu'un
         * commerçant voyait chaque matin.
         *
         * S'il y a une décision en attente, elle passe devant : c'est la seule
         * chose de cette journée qui réclame un geste. Sinon la première ligne
         * du planning, qui remplit le panneau sans rien réclamer.
         */
        const parDefaut = aTrancher[0]?.booking_id ?? attendues[0]?.booking_id ?? planning[0]?.booking_id ?? null;
        const ouverte =
          [...aTrancher, ...planning].find((r) => r.booking_id === (choisie ?? parDefaut)) ?? null;

        /**
         * Une section de la liste, et sa forme dit sa nature.
         *
         * **Seule la première porte des cartes.** Une demande est un objet
         * qu'on soupèse — de quoi il s'agit, avec qui, jusqu'à quand — et les
         * trois faits doivent tenir ensemble sous les yeux. Les deux autres
         * sections se parcourent : une heure, un nom, on passe. Donner le
         * relief aux trois aurait rendu la colonne uniformément dense, ce qui
         * revient à ne rien mettre en avant.
         */
        const section = (
          titre: string,
          lignes: ReservationDuCommerce[],
          nom: string,
          forme: 'carte' | 'ligne' = 'ligne',
        ) =>
          lignes.length === 0 ? null : (
            <View style={{ gap: forme === 'carte' ? 10 : 4 }} testID={nom}>
              <Texte
                variante="type.label"
                couleur={forme === 'carte' ? 'brand.700' : 'ink.soft'}
                style={{ paddingHorizontal: 12, paddingBottom: 4 }}
              >
                {titre}
              </Texte>
              {lignes.map((reservation, rang) => {
                const active = large && reservation.booking_id === ouverte?.booking_id;
                return (
                  <Apparition key={reservation.booking_id} rang={rang}>
                    <Pressable
                      onPress={large ? () => setChoisie(reservation.booking_id) : undefined}
                      accessibilityRole={large ? 'button' : undefined}
                      testID={`ligne-${reservation.booking_id}`}
                      style={({ pressed }) =>
                        forme === 'carte'
                          ? { opacity: pressed ? 0.7 : 1 }
                          : {
                              borderRadius: radius['radius.lg'],
                              // La ligne ouverte porte deux marques, comme dans
                              // la barre latérale : un fond et une barre.
                              // Jamais la couleur seule.
                              backgroundColor: active ? c['brand.50'] : 'transparent',
                              borderLeftWidth: 3,
                              borderLeftColor: active ? c['brand.700'] : 'transparent',
                              opacity: pressed ? 0.7 : 1,
                            }
                      }
                    >
                      {forme === 'carte' ? (
                        <CarteDeDemande
                          reservation={reservation}
                          timezone={journee.timezone}
                          active={active}
                          onFait={requete.recharger}
                          avecGestes={!large}
                        />
                      ) : (
                        <Ligne
                          reservation={reservation}
                          timezone={journee.timezone}
                          onFait={requete.recharger}
                          // En grand écran la ligne ne fait que désigner : les
                          // gestes vivent dans le panneau, une seule fois.
                          avecGestes={!large}
                        />
                      )}
                    </Pressable>
                  </Apparition>
                );
              })}
            </View>
          );

        const colonneListe = (
          <View
            testID="colonne-liste"
            style={{ gap: 16, width: large ? breakpoint.listWidthMerchant : undefined }}
          >
            {/* Ce que personne d'autre ne peut faire, et rien d'autre en tête. */}
            {section(
              t('commerce.aTrancher', { count: aTrancher.length }),
              aTrancher,
              'a-trancher',
              'carte',
            )}
            {section(
              t('commerce.journeeAttendues', { count: attendues.length }),
              attendues,
              'planning',
            )}
            {finies.length > 0 && (aTrancher.length > 0 || attendues.length > 0) ? (
              <Filet marge={4} />
            ) : null}
            {/* Ce dont il n'y a plus rien à faire aujourd'hui : servi, annulé,
                manqué. La nuance est sur la ligne. */}
            {section(t('commerce.journeeFinies', { count: finies.length }), finies, 'finies')}
          </View>
        );

        // **Le bandeau passe avant tout, dans les deux dispositions.** C'est
        // la seule chose de l'écran qui empêche le salon d'exister ; le poser
        // sous la liste le ferait lire après ce qu'il rend impossible.
        // **L'exception ne vaut que pour aujourd'hui.** Sur un jour passé le
        // geste n'a rien à couper, et sur un jour à venir il se prendra le
        // matin venu — c'est la définition même d'une exception décidée en
        // marchant. La date du salon vient du serveur, jamais de l'horloge de
        // la machine : à Miami, minuit UTC est encore la veille.
        const aujourdhui = jourCivil(new Date(), journee.timezone) === journee.jour.slice(0, 10);

        const bandeau = (
          <BandeauDeMiseEnLigne
            businessId={businessId}
            activation={journee.activation}
            onPublie={requete.recharger}
          />
        );

        const exception = aujourdhui ? (
          <ExceptionDuJour
            businessId={businessId}
            jour={journee.jour.slice(0, 10)}
            // Les postes réellement ouverts, tels que le serveur les a calculés.
            postesEffectifs={journee.horaires?.[0]?.postes ?? null}
            onFait={requete.recharger}
          />
        ) : null;

        // En compact, une seule colonne : la liste, comme avant. Le détail y
        // vit déjà dans la ligne elle-même, et une seconde colonne de 720 ne
        // tiendrait nulle part.
        if (!large) {
          return (
            <View style={{ gap: 16 }}>
              {repriseEnCours}
              {bandeau}
              {exception}
              {colonneListe}
            </View>
          );
        }

        return (
          <View style={{ gap: 16 }}>
            {repriseEnCours}
            {bandeau}
            <View style={{ flexDirection: 'row', gap: ECART_DES_COLONNES }}>
              <View style={{ gap: 16, width: breakpoint.listWidthMerchant }}>
                {exception}
                {colonneListe}
              </View>
            <View style={{ flex: 1, maxWidth: breakpoint.contentMaxMerchant }}>
              {ouverte ? (
                <Detail
                  reservation={ouverte}
                  timezone={journee.timezone}
                  onFait={requete.recharger}
                />
              ) : (
                <Texte couleur="ink.mute" testID="aucune-ligne-ouverte">
                  {t('commerce.choisirUneLigne')}
                </Texte>
              )}
              </View>
            </View>
          </View>
        );
      }}
    </Ecran>
  );
}

/**
 * L'heure du rendez-vous, dans le fuseau du commerce.
 *
 * Sur un droit sans créneau il n'y a pas d'heure. En inventer une ferait
 * attendre quelqu'un à une heure que personne ne lui a donnée.
 */
function heureDe(
  reservation: ReservationDuCommerce,
  timezone: string,
  sansCreneau: string,
  locale: SupportedLocale,
) {
  return reservation.starts_at
    ? formatHeure(reservation.starts_at, locale, timezone)
    : sansCreneau;
}

/**
 * **Le pseudonyme, et lui seul.** Cette fonction composait « Léa Moreau » et ne
 * retombait sur `@lea.mrl` qu'à défaut : le salon lisait donc l'état civil de
 * quelqu'un à qui il rend un service, ce que le produit ne promet nulle part.
 * Le serveur ne sert plus le nom ; l'écran ne le compose plus.
 */
function nomDe(reservation: ReservationDuCommerce) {
  return reservation.creator_handle ?? '';
}

/**
 * Ce qui est derrière nous, et ce qui reste à faire.
 *
 * Une absence et un rendez-vous de 15 h se lisaient identiques : deux lignes de
 * texte, même poids, même couleur. Un planning où le passé et le présent se
 * ressemblent oblige à lire chaque ligne pour savoir où l'on en est.
 */
const TERMINES = new Set(['consumed', 'cancelled', 'no_show', 'expired']);

/** Ce dont l'état mérite d'être teinté. Le reste reste neutre. */
const TEINTE: Record<string, ColorName> = {
  no_show: 'status.danger.text',
  cancelled: 'ink.mute',
  expired: 'ink.mute',
  consumed: 'status.success.text',
};

/**
 * Le panneau de droite : le rendez-vous, ce qu'il engage, et les gestes.
 *
 * **Il ne redessine plus la ligne.** Il commençait par un `<Ligne>`, le même
 * composant que la colonne de gauche : le panneau s'ouvrait donc sur une copie
 * exacte de la carte qu'on venait de choisir, et se lisait comme un doublon.
 * Il reprend maintenant les mêmes faits **sous une autre forme** — un en-tête
 * qui porte l'heure en grand, puis des lignes de données — parce que ce n'est
 * pas la même lecture : à gauche on cherche, à droite on se prépare à servir.
 *
 * **C'est ici qu'on agit.** Accorder, refuser, se désister vivaient dans la
 * liste ; le panneau n'avait alors rien à faire et tenait sur un tiers de sa
 * hauteur. Les gestes descendent ici, où il y a la place de les nommer et de
 * poser leur motif.
 *
 * **Une seule donnée de la maquette manque encore** et n'est donc pas inventée :
 * le nombre de publications déjà livrées par la créatrice. La mention et le lieu
 * attendus, eux, sont arrivés depuis.
 */
function Detail({
  reservation,
  timezone,
  onFait,
}: {
  reservation: ReservationDuCommerce;
  timezone: string;
  onFait: () => void;
}) {
  const { t, locale } = useI18n();
  const { color: c } = useTheme();

  const heure = heureDe(reservation, timezone, t('commerce.journeeSansCreneau'), locale);
  const gestes =
    reservation.status === 'awaiting_business' || reservation.status === 'confirmed';

  return (
    <View style={{ gap: 20 }} testID="detail-de-la-ligne">
      {/* L'en-tête : l'heure en grand, la personne, l'état. La même matière
          qu'à gauche, une autre échelle — on ne cherche plus, on se prépare. */}
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12 }}>
          <Texte variante="type.screenTitle" testID="detail-heure">
            {heure}
          </Texte>
          <Texte
            variante="type.label"
            couleur={TEINTE[reservation.status] ?? 'ink.soft'}
            testID="detail-statut"
          >
            {t(`commerce.statut_${reservation.status}`)}
          </Texte>
        </View>
        <Texte variante="type.bodyStrong">{nomDe(reservation)}</Texte>
        <ReseauxDeLaCreatrice reservation={reservation} />
      </View>

      <View style={{ gap: 8 }}>
        <Texte variante="type.label" couleur="ink.soft">
          {t('commerce.journeeRendezVous')}
        </Texte>
        <DataRow label={t('commerce.journeeCreatrice')} value={nomDe(reservation)} />
        <DataRow label={t('commerce.journeePlanning')} value={reservation.item_name} />
        {reservation.duration_minutes ? (
          <DataRow
            label={t('commerce.journeeDuree', { count: reservation.duration_minutes })}
            value={heure}
            testID="detail-duree"
          />
        ) : null}
      </View>

      <Filet marge={0} />

      {/* Ce pour quoi la place est donnée. Aucune ligne de planning n'a la
          place de le dire, et c'est pourtant la seule raison de servir. */}
      <View style={{ gap: 8 }}>
        <Texte variante="type.label" couleur="ink.soft">
          {t('commerce.contrepartieAttendue')}
        </Texte>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <TierBadge tier={reservation.content_format} />
          <LigneDeContrepartie tier={reservation.content_format} />
        </View>
        {reservation.required_mention ? (
          <DataRow
            label={t('commerce.mentionAttendue')}
            value={reservation.required_mention}
            testID="mention-attendue"
          />
        ) : null}
        {reservation.required_geotag ? (
          <DataRow
            label={t('commerce.lieuAttendu')}
            value={t('commerce.lieuAttenduOui')}
            testID="lieu-attendu"
          />
        ) : null}
        {/* L'échéance n'existe qu'une fois la place consommée : avant, il n'y a
            pas encore de contrepartie à tenir, et annoncer une date la ferait
            croire due. */}
        {reservation.contrepartie ? (
          <DataRow
            label={t('commerce.journeeEcheance')}
            value={formatDateTime(reservation.contrepartie.deadline_at, locale, timezone)}
            testID="detail-echeance"
          />
        ) : null}
      </View>

      <Filet marge={0} />

      <View style={{ gap: 10 }}>
        <Texte variante="type.label" couleur="ink.soft">
          {t('commerce.journeeGestes')}
        </Texte>
        {gestes ? (
          <Gestes reservation={reservation} timezone={timezone} onFait={onFait} />
        ) : (
          // Un rendez-vous servi, annulé ou manqué n'appelle plus rien du
          // comptoir. Le dire vaut mieux qu'un bloc vide, qui laisse chercher
          // le bouton qu'on aurait oublié.
          <Texte variante="type.caption" couleur="ink.mute" testID="detail-sans-geste">
            {t('commerce.journeeRienAFaire')}
          </Texte>
        )}
      </View>
    </View>
  );
}

/**
 * Les réseaux de la créatrice, celui qui manque compris.
 *
 * **L'absence est une information.** Savoir qu'il n'y a pas de TikTok fait
 * partie de la décision autant que le nombre d'abonnés Instagram : un salon qui
 * cherche une portée sur une plateforme précise a besoin de le lire, et un
 * réseau simplement omis se lit comme un oubli de l'écran.
 *
 * **Celui qui a un profil public y mène, et il est le seul lien sortant du
 * produit.** Il porte donc le glyphe de sortie : la différence se voit avant
 * l'appui, pas après. L'adresse vient du serveur — nulle quand la plateforme
 * n'a pas de profil public connu, et on n'affiche alors pas de lien plutôt
 * qu'un lien mort.
 *
 * **Un compte sans relevé n'affiche pas zéro.** « 0 abonné » à quelqu'un qui en
 * a douze mille est la pire chose que cet écran puisse dire au moment où le
 * salon décide.
 */
function ReseauxDeLaCreatrice({ reservation }: { reservation: ReservationDuCommerce }) {
  const { t, locale } = useI18n();
  const { color: c } = useTheme();

  // Les réseaux servis, et à défaut celui de la demande seule : une réponse
  // d'avant le champ ne doit pas faire disparaître le pseudonyme.
  const comptes =
    reservation.comptes?.length > 0
      ? reservation.comptes
      : reservation.creator_handle
        ? [
            {
              platform: reservation.platform,
              handle: reservation.creator_handle,
              followers: null,
            },
          ]
        : [];

  if (comptes.length === 0) return null;

  return (
    <View
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 2 }}
      testID={`reseaux-${reservation.booking_id}`}
    >
      {comptes.map((compte) => {
        const rattache = compte.handle !== null;
        const mene = rattache && reservation.creator_profil_url !== null
          && compte.platform === reservation.platform;
        const corps = (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 9,
              minHeight: size.touchMin,
              paddingHorizontal: 16,
              borderRadius: radius['radius.pill'],
              borderWidth: rattache ? 1.5 : 1,
              borderColor: rattache ? c['line.ink'] : c['line.default'],
            }}
          >
            <Icone
              nom={compte.platform === 'tiktok' ? 'tiktok' : 'instagram'}
              couleur={rattache ? 'ink.default' : 'ink.mute'}
              taille={18}
            />
            <Texte
              variante={rattache ? 'type.bodyStrong' : 'type.body'}
              couleur={rattache ? 'ink.default' : 'ink.mute'}
            >
              {rattache
                ? compte.followers === null
                  ? nomDePlateforme(compte.platform)
                  : t('commerce.reseauAvecAbonnes', {
                      reseau: nomDePlateforme(compte.platform),
                      abonnes: formatNumber(compte.followers, locale),
                    })
                : t('commerce.reseauAbsent', { reseau: nomDePlateforme(compte.platform) })}
            </Texte>
            {mene ? <Icone nom="sortie" taille={15} /> : null}
          </View>
        );

        return mene ? (
          <Pressable
            key={compte.platform}
            accessibilityRole="link"
            onPress={() => void Linking.openURL(reservation.creator_profil_url as string)}
            testID={`profil-${reservation.booking_id}`}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            {corps}
          </Pressable>
        ) : (
          <View key={compte.platform} testID={`reseau-${compte.platform}`}>
            {corps}
          </View>
        );
      })}
    </View>
  );
}

/**
 * Les trois gestes du comptoir, groupés.
 *
 * Accorder et refuser sur une demande, se désister sur une place confirmée. Les
 * deux jeux ne coexistent jamais : un état, un jeu de gestes.
 */
function Gestes({
  reservation,
  timezone,
  onFait,
}: {
  reservation: ReservationDuCommerce;
  /** Le fuseau du commerce : l'échéance s'y lit, pas dans celui du téléphone. */
  timezone: string;
  onFait: () => void;
}) {
  const { api, messageDErreur } = useApi();
  const { t, locale } = useI18n();

  // Comparé ici pour l'affichage seulement : c'est le serveur qui tranche, et
  // il refuse. Attendre son refus ferait appuyer sur un bouton pour apprendre
  // qu'il ne servait à rien.
  //
  // **`approval_expires_at` d'abord, et c'est la vraie échéance.** L'écran
  // lisait `starts_at ?? valid_until` — l'heure du rendez-vous, qui n'était pas
  // un délai de réponse : une demande posée trois semaines à l'avance semblait
  // ouverte trois semaines. Le repli reste pour les lignes qui n'ont pas encore
  // d'échéance, le temps que la migration passe partout.
  const echeance =
    reservation.approval_expires_at ?? reservation.starts_at ?? reservation.valid_until;
  const depassee = echeance !== null && new Date(echeance) <= new Date();

  const [envoi, setEnvoi] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);

  async function accorder() {
    setEnvoi(true);
    setEchec(null);
    vibration.action();
    try {
      await api.accorderLaReservation(reservation.booking_id);
      vibration.reussite();
      onFait();
    } catch (erreur) {
      vibration.echec();
      setEchec(messageDErreur(erreur));
    } finally {
      setEnvoi(false);
    }
  }

  if (reservation.status === 'confirmed') {
    /**
     * **L'heure d'ouverture vient du serveur, jamais d'un délai recopié.**
     * `absence_signalable_a` est l'instant à partir duquel l'absence se
     * constate. Le recopier ici — « vingt minutes après l'heure » — le ferait
     * dériver le jour où le réglage bouge côté serveur, et cette dérive se lit
     * comme un bouton fermé qui devrait être ouvert.
     *
     * `null` veut dire **jamais** : un droit sans créneau n'a pas d'heure à
     * laquelle ne pas se présenter, et `SPEC.md` §4.1 dit que `no_show`
     * n'existe pas dans ce cas. On ne propose donc rien du tout, plutôt qu'un
     * bouton qui se ferait refuser.
     *
     * La comparaison ci-dessous **n'autorise rien** : elle décide de ce qu'on
     * affiche. C'est le serveur qui refuse avant l'heure, et l'horloge du
     * téléphone n'est pas une preuve — elle sert seulement à ne pas faire
     * appuyer sur un bouton pour apprendre qu'il ne servait à rien.
     */
    const ouvertureDeLAbsence = reservation.absence_signalable_a;
    const absenceOuverte =
      ouvertureDeLAbsence !== null && new Date(ouvertureDeLAbsence) <= new Date();

    return (
      <View style={{ gap: 10 }}>
        <MotifPuisAction
          libelle={t('commerce.seDesister')}
          aide={t('commerce.seDesisterAide')}
          variante="danger"
          testID={`desister-${reservation.booking_id}`}
          onValider={(motif, client) =>
            client.seDesisterDeLaReservation(reservation.booking_id, motif)
          }
          onFait={onFait}
        />

        {/* **Se désister n'est pas constater une absence**, et les deux ne se
            confondent pas sous un même bouton : l'un ne pénalise personne,
            l'autre inscrit un événement négatif au dossier de la créatrice.
            Ils sont donc voisins et nommés séparément. */}
        {ouvertureDeLAbsence === null ? null : absenceOuverte ? (
          <MotifPuisAction
            libelle={t('commerce.constaterLAbsence')}
            aide={t('commerce.constaterLAbsenceAide')}
            variante="danger"
            testID={`absence-${reservation.booking_id}`}
            // **Irréversible, donc confirmée.** `no_show` est un état terminal
            // et l'événement de fiabilité qu'il écrit ne se retire pas. Un
            // motif suffisant ne vaut pas accord : on nomme la conséquence,
            // puis on la fait confirmer par un second geste.
            avertissement={t('commerce.absenceEstDefinitive')}
            confirmation={t('commerce.absenceConfirmer')}
            onValider={(motif, client) => client.marquerAbsent(reservation.booking_id, motif)}
            onFait={onFait}
          />
        ) : (
          /* **Avant l'heure, on dit laquelle — et pourquoi.** Un bouton absent
             sans explication se lit comme une fonction manquante ; l'heure
             seule, elle, se lit comme une lenteur arbitraire. Depuis que
             l'absence attend la fermeture de la fenêtre de recours, ce sont
             plusieurs heures, et un commerçant honnête a le droit de savoir ce
             qu'il attend plutôt que de conclure à un défaut. Dans le fuseau du
             commerce, comme tout le reste de cet écran. */
          <View style={{ gap: 4 }}>
            <DataRow
              label={t('commerce.absencePasEncore')}
              value={formatDateTime(ouvertureDeLAbsence, locale, timezone)}
              testID={`absence-pas-encore-${reservation.booking_id}`}
            />
            <Texte
              variante="type.caption"
              couleur="ink.mute"
              testID={`absence-pourquoi-${reservation.booking_id}`}
            >
              {t('commerce.absencePasEncorePourquoi')}
            </Texte>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={{ gap: 10 }}>
      {echec ? <StatusMessage level="danger" body={echec} testID="echec-decision" /> : null}
      {depassee ? (
        <StatusMessage
          level="warning"
          body={t('commerce.decisionDepassee')}
          testID={`depassee-${reservation.booking_id}`}
        />
      ) : (
        <>
          {/* **Le temps qu'il reste, avant les boutons.** Rien ne disait que
              cette décision avait une fin : la demande semblait pouvoir
              attendre indéfiniment, et elle le pouvait — c'est ce qu'on vient
              de corriger côté serveur. L'heure est absolue et dans le fuseau du
              salon, pas un compte à rebours : sur vingt-quatre heures, « avant
              mardi 10 h » se retient, « dans 21 h 14 min » demande de refaire
              le calcul et oblige l'écran à battre la seconde pour rien. */}
          {reservation.approval_expires_at ? (
            <DataRow
              label={t('commerce.decisionAvant', {
                quand: formatDateTime(reservation.approval_expires_at, locale, timezone),
              })}
              value={t('commerce.decisionAvantAide')}
              testID={`echeance-decision-${reservation.booking_id}`}
            />
          ) : null}
          <Button
            label={t('commerce.accorder')}
            loading={envoi}
            onPress={() => void accorder()}
            testID={`accorder-${reservation.booking_id}`}
          />
          {/* **Ce qui rassure au moment exact où le doute se pose.** Le
              commerce s'apprête à donner une prestation sans contrepartie
              immédiate. Que le manquement coûte quelque chose est vrai —
              `unfulfilled` pèse −30 au dossier — et c'était construit sans que
              rien ne le lui dise. Sous le bouton d'accord et nulle part
              ailleurs : dans un écran d'aide, personne ne le lirait. */}
          <Texte
            variante="type.caption"
            couleur="ink.mute"
            testID={`garantie-score-${reservation.booking_id}`}
          >
            {t('commerce.decisionSiElleNePubliePas')}
          </Texte>
        </>
      )}
      <MotifPuisAction
        libelle={t('commerce.refuser')}
        aide={t('commerce.refuserAide')}
        variante="secondary"
        testID={`refuser-${reservation.booking_id}`}
        onValider={(motif, client) => client.refuserLaReservation(reservation.booking_id, motif)}
        onFait={onFait}
      />
    </View>
  );
}

/**
 * Une demande qui attend une réponse : de quoi il s'agit, avec qui, jusqu'à quand.
 *
 * **Une carte et non une ligne, parce qu'on la soupèse.** Les trois faits
 * décident ensemble : une prestation de quarante-cinq minutes vendredi
 * après-midi, pour quelqu'un dont on va regarder le profil, avec une réponse
 * due avant ce soir. Empilés sur trois lignes plates au milieu du planning, ils
 * se lisaient comme trois lignes de plus.
 *
 * **Le contour ambre ne se donne qu'à la limite du jour**, et il est le seul de
 * l'écran. Voir `entete.ts` : il dit « répondez aujourd'hui », ce qui est le
 * seul fait qui change la conduite de la journée. En donner à toutes les
 * demandes reviendrait à n'en donner à aucune.
 *
 * **Ce que la planche met ici et que le serveur ne sert pas** : le nombre
 * d'abonnés de la créatrice, à côté de son pseudonyme.
 * `ReservationDuCommerce` ne le porte pas, et il n'est pas inventé. Voir
 * `TASKS.md`.
 */
function CarteDeDemande({
  reservation,
  timezone,
  active,
  onFait,
  avecGestes,
}: {
  reservation: ReservationDuCommerce;
  timezone: string;
  /** La carte ouverte dans le panneau, en grand écran. */
  active: boolean;
  onFait: () => void;
  /**
   * Les deux gestes, dans la carte elle-même.
   *
   * **Vrai en compact, et c'est une correction attrapée par les tests.** En
   * grand écran le panneau les porte, une seule fois ; en compact il n'y a pas
   * de panneau, et une carte sans boutons rendait la décision *injoignable* —
   * la seule chose que cet écran existe pour faire.
   */
  avecGestes: boolean;
}) {
  const { t, locale } = useI18n();
  const { color: c } = useTheme();
  const urgente = limiteTombeAujourdhui(reservation.approval_expires_at, timezone);

  return (
    <View
      testID={`demande-${reservation.booking_id}`}
      style={{
        gap: 7,
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: radius['radius.lg'],
        backgroundColor: urgente || active ? c['brand.50'] : c['bg.surface'],
        borderWidth: 1,
        borderColor: urgente ? c['brand.500'] : c['line.default'],
        // « Un coin de 18 px sans ombre flotte au lieu de se poser » : §2.
        ...elevationDeCarte(),
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12 }}>
        <Texte variante="type.bodyStrong" style={{ flex: 1 }} ellipseSurNomPropre>
          {reservation.item_name}
        </Texte>
        <Texte variante="type.mono">
          {reservation.starts_at
            ? formatDateTime(reservation.starts_at, locale, timezone)
            : t('commerce.journeeSansCreneau')}
        </Texte>
      </View>

      <Texte variante="type.caption" couleur="ink.soft" ellipseSurNomPropre>
        {reservation.creator_handle ?? nomDe(reservation)}
      </Texte>

      {/* **La limite, écrite en heure et jamais en règle.** Elle est double
          côté serveur — vingt-quatre heures, ou l'heure du créneau si elle
          arrive avant — et l'écran n'a pas à l'expliquer : ce qui sert est
          l'instant, pas la façon dont il a été obtenu. */}
      {reservation.approval_expires_at ? (
        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
          testID={`limite-${reservation.booking_id}`}
        >
          <Icone nom="horloge" couleur={urgente ? 'brand.700' : 'ink.mute'} taille={16} />
          <Texte
            variante={urgente ? 'type.captionStrong' : 'type.caption'}
            couleur={urgente ? 'brand.700' : 'ink.soft'}
            style={{ flex: 1 }}
          >
            {t('commerce.repondreAvant', {
              quand: formatDateTime(reservation.approval_expires_at, locale, timezone),
            })}
          </Texte>
        </View>
      ) : null}

      {avecGestes ? (
        <View style={{ paddingTop: 4 }}>
          <Gestes reservation={reservation} timezone={timezone} onFait={onFait} />
        </View>
      ) : null}
    </View>
  );
}

function Ligne({
  reservation,
  timezone,
  onFait,
  avecGestes = true,
}: {
  reservation: ReservationDuCommerce;
  timezone: string;
  onFait: () => void;
  /** Faux en grand écran : le panneau porte les gestes, une seule fois. */
  avecGestes?: boolean;
}) {
  const { t, locale } = useI18n();
  const passe = TERMINES.has(reservation.status);

  return (
    <View
      testID={`reservation-${reservation.booking_id}`}
      style={{
        gap: 2,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: radius['radius.lg'],
        // **Un seul registre.** La ligne portait un fond et une bordure tant
        // qu'elle n'était pas passée : dans une colonne où le bloc « à
        // trancher » était déjà en relief, cela faisait trois épaisseurs pour
        // trois états de la même chose. Le passé s'efface, le reste est plat,
        // et ce qui attend se signale par sa pastille — jamais par la couleur
        // seule, le mot d'état est là.
        opacity: passe ? 0.62 : 1,
      }}
    >
      {/* **L'heure, la prestation, la personne — dans cet ordre.** La ligne
          portait le nom de la créatrice en tête et la prestation en dessous :
          on parcourt cette colonne pour savoir *ce qui* arrive et quand, et le
          nom sert à reconnaître qui entre, pas à trouver la ligne. */}
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 14 }}>
        <Texte variante="type.mono" couleur={passe ? 'ink.mute' : 'ink.default'}>
          {heureDe(reservation, timezone, t('commerce.journeeSansCreneau'), locale)}
        </Texte>
        <Texte variante="type.body" style={{ flex: 1 }} ellipseSurNomPropre>
          {reservation.item_name}
        </Texte>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Texte
          variante="type.caption"
          couleur="ink.mute"
          style={{ flexShrink: 1 }}
          ellipseSurNomPropre
        >
          {reservation.creator_handle ?? nomDe(reservation)}
        </Texte>
        {/* Le statut traduit, jamais son code. `awaiting_business` affiché tel
            quel se lisait comme une chaîne oubliée — parce que c'en était une. */}
        <Texte
          variante="type.caption"
          couleur={TEINTE[reservation.status] ?? 'ink.soft'}
          testID={`statut-${reservation.booking_id}`}
        >
          {t(`commerce.statut_${reservation.status}`)}
        </Texte>
      </View>
      {avecGestes && reservation.status !== 'consumed' ? (
        <View style={{ paddingTop: 6 }}>
          <Gestes reservation={reservation} timezone={timezone} onFait={onFait} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Une action qui exige un motif : le bouton ouvre le champ, le champ valide.
 *
 * En deux temps et non en une boîte de dialogue : la créatrice lira ce texte,
 * et une saisie obligatoire posée devant quelqu'un qui voulait juste refuser se
 * remplit de « ok ». Le bouton de validation reste absent tant que le motif est
 * trop court — retiré, jamais grisé.
 */
function MotifPuisAction({
  libelle,
  aide,
  variante,
  testID,
  avertissement,
  confirmation,
  onValider,
  onFait,
}: {
  libelle: string;
  aide: string;
  variante: 'secondary' | 'danger';
  testID: string;
  /**
   * Ce que le geste fait de définitif, dit avant de le faire. Absent quand il
   * n'y a rien d'irréversible à annoncer — un refus ou un désistement se
   * regrettent, ils ne s'inscrivent au dossier de personne.
   */
  avertissement?: string;
  /**
   * Le libellé du second geste. **Sa présence est ce qui rend l'action
   * confirmée** : sans lui, un motif suffisant mène directement à l'envoi.
   */
  confirmation?: string;
  onValider: (motif: string, api: ReturnType<typeof useApi>['api']) => Promise<unknown>;
  onFait: () => void;
}) {
  const { api, messageDErreur } = useApi();
  const { t } = useI18n();

  const [ouvert, setOuvert] = useState(false);
  const [motif, setMotif] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);
  /**
   * Armé : le motif est écrit, la conséquence est lue, il reste à confirmer.
   *
   * **Deux gestes et non une case à cocher.** Une case se coche sans lire, et
   * se retrouve cochée par la paume sur un comptoir. Un second bouton, qui dit
   * ce qu'il fait, demande de viser une seconde fois.
   */
  const [arme, setArme] = useState(false);

  /** Trois caractères : le serveur exige la même chose, et refuse « no ». */
  const suffisant = motif.trim().length >= 3;

  async function valider() {
    setEnvoi(true);
    setEchec(null);
    vibration.action();
    try {
      await onValider(motif.trim(), api);
      vibration.reussite();
      setOuvert(false);
      setMotif('');
      setArme(false);
      onFait();
    } catch (erreur) {
      vibration.echec();
      setEchec(messageDErreur(erreur));
      // **Désarmé après un échec.** Le refus vient souvent du serveur — trop
      // tôt, état changé sous nos pieds — et laisser le bouton de confirmation
      // en place inviterait à le represser jusqu'à ce que ça passe.
      setArme(false);
    } finally {
      setEnvoi(false);
    }
  }

  function refermer() {
    setOuvert(false);
    setMotif('');
    setEchec(null);
    setArme(false);
  }

  if (!ouvert) {
    return (
      <Button
        label={libelle}
        variant={variante}
        onPress={() => setOuvert(true)}
        testID={testID}
      />
    );
  }

  return (
    <View style={{ gap: 8 }} testID={`${testID}-motif`}>
      <TextField
        label={libelle}
        value={motif}
        onChangeText={setMotif}
        helpText={aide}
        testID={`${testID}-champ`}
      />
      {/* La conséquence se lit **au-dessus** du bouton qui la produit, et dès
          l'ouverture du champ : la mettre après reviendrait à l'annoncer à
          quelqu'un qui a déjà décidé. */}
      {avertissement ? (
        <StatusMessage
          level="warning"
          body={avertissement}
          testID={`${testID}-avertissement`}
        />
      ) : null}
      {echec ? <StatusMessage level="danger" body={echec} testID="echec-decision" /> : null}
      {suffisant ? (
        <Button
          label={confirmation && arme ? confirmation : t('commerce.envoyerLeMotif')}
          variant={variante}
          loading={envoi}
          // Sans `confirmation`, le premier appui envoie — c'est le
          // comportement de toujours pour un refus ou un désistement. Avec
          // elle, le premier appui arme et le second envoie.
          onPress={() => (confirmation && !arme ? setArme(true) : void valider())}
          testID={arme ? `${testID}-confirmer` : `${testID}-valider`}
        />
      ) : null}
      <Button
        label={t('common.annuler')}
        variant="ghost"
        onPress={refermer}
        testID={`${testID}-renoncer`}
      />
    </View>
  );
}
