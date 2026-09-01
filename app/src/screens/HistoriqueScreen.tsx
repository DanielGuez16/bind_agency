/**
 * 08 · Historique du créateur.
 *
 * **Les compteurs d'onglets arrivent avant la liste.** Ils viennent de la même
 * réponse, calculés sur tout l'historique et non sur la page : un onglet qui
 * annonce « 3 » parce que la première page en contient trois ment dès la
 * seconde.
 *
 * **Chaque onglet a son propre état vide.** Un historique où seul l'onglet
 * « à venir » est vide n'est pas un historique vide, et lui montrer le même
 * message serait faux.
 *
 * **L'heure s'affiche dans le fuseau du commerce.** Un rendez-vous se prend là
 * où il a lieu ; l'afficher dans le fuseau du téléphone ferait rater des
 * rendez-vous à quiconque voyage.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import {
  useApi,
  type BookingStatus,
  type HistoriqueDuCreateur,
  type ReservationDuCreateur,
} from '../api';
import {
  Apparition,
  EmptyState,
  Button,
  Icone,
  SegmentedTabs,
  SkeletonLignes,
  StatusMessage,
  Texte,
} from '../components';
import { elevationDeCarte, radius, useColors, type ColorName } from '../theme';
import { useI18n, type SupportedLocale } from '../i18n';
import { formatDateTime, formatMois, formatQuantieme, repereDuCreneau } from '../format';
import { glypheDePlateforme } from './obstacle';
import { AnnulerLaReservation } from './reservations/AnnulerLaReservation';
import { Ecran } from './Ecran';
import { useRequete } from './useRequete';

/**
 * Les mois d'une liste, dans son ordre.
 *
 * **Le cadre 08c groupe les réservations terminées par mois**, et l'écran les
 * empilait à plat. Sur douze lignes, une date par ligne oblige à lire chaque
 * date pour savoir où l'on en est ; un intertitre le dit une fois pour cinq
 * lignes. Les deux autres onglets ne sont pas groupés — ils portent deux ou
 * trois lignes, et un intertitre y coûterait plus qu'il ne rend.
 *
 * Le regroupement suit l'ordre **reçu**, il ne trie pas : le serveur a déjà
 * décidé, et retrier ici ferait diverger l'écran de sa pagination.
 */
export function grouperParMois(
  items: ReservationDuCreateur[],
  locale: SupportedLocale,
): { mois: string; items: ReservationDuCreateur[] }[] {
  const groupes: { mois: string; items: ReservationDuCreateur[] }[] = [];

  for (const item of items) {
    const quand = item.starts_at ?? item.valid_until;
    // Le fuseau du commerce, pas celui du téléphone : une réservation du
    // 1er août à Miami ne bascule pas en juillet parce qu'on la lit d'ailleurs.
    const mois = formatMois(quand, locale, item.business_timezone).toUpperCase();

    // **Le mois retrouvé, où qu'il soit, et pas seulement le dernier.**
    //
    // Ne fusionner que le voisin supposait que la liste soit triée par date.
    // Elle ne l'est pas : le serveur range les réservations sans créneau en
    // dernier — `nullslast` —, et leur `valid_until` retombe souvent dans un
    // mois déjà passé. La liste faisait donc AOÛT, SEPTEMBRE, puis AOÛT de
    // nouveau, et deux `<View key={groupe.mois}>` portaient la même clé.
    //
    // **Sur le web cela ne fait qu'un avertissement ; en natif l'écran se
    // grise.** C'est ce qui a vidé « à venir » et « terminées ». Une seule
    // section par mois, dans l'ordre où le mois apparaît d'abord.
    const existant = groupes.find((groupe) => groupe.mois === mois);
    if (existant) existant.items.push(item);
    else groupes.push({ mois, items: [item] });
  }

  return groupes;
}

/**
 * Ce qu'il reste avant l'échéance, en heures ou en jours.
 *
 * **Nul quand l'échéance est passée.** Une contrepartie en retard est déjà
 * close par le balayage, et « −3 H » sur une ligne encore ouverte se lirait
 * comme une dette. Le cas se produit dans la seconde qui sépare l'échéance du
 * passage du balayage : rien à afficher vaut mieux qu'un nombre négatif.
 *
 * En heures sous deux jours, en jours au-delà. « 47 H » est exact et illisible
 * quand « 2 J » suffit à décider ; l'inverse est vrai à six heures près de la
 * fin, où le jour arrondi ferait manquer la soirée.
 */
export function tempsRestant(echeance: string, maintenant = Date.now()): string | null {
  const heures = Math.floor((new Date(echeance).getTime() - maintenant) / 3_600_000);
  if (heures < 0) return null;
  return heures < 48 ? `${heures} h` : `${Math.floor(heures / 24)} j`;
}

/**
 * Qui attend, sur une réservation à venir.
 *
 * **L'onglet mêlait deux choses sans le dire** : les réservations acceptées, où
 * il faut venir, et celles qui attendent la décision du salon, où il faut
 * attendre. Deux verbes différents dans une liste unique, et l'on ne savait pas
 * en la parcourant s'il y avait quelque chose à faire.
 *
 * La coupure porte sur **qui est attendu**, pas sur le statut : c'est la seule
 * question que la créatrice se pose en ouvrant l'écran.
 */
export function sectionAVenir(reservation: ReservationDuCreateur): 'moi' | 'salon' {
  return reservation.status === 'awaiting_business' ? 'salon' : 'moi';
}

/**
 * Le verbe d'une contrepartie en cours.
 *
 * **Le titre est le verbe**, et la prestation passe en attribution. La ligne
 * disait « Gel manicure » — ce que c'était — là où la question est ce qu'on
 * attend de moi. « Post a story » le dit en trois mots, et « Gel manicure ·
 * Vela Nail Studio » vient dessous, en petit, parce qu'il faut bien savoir
 * pour quoi.
 *
 * Nul quand la contrepartie est close : une ligne terminée n'attend aucun
 * verbe, et lui en donner un la ferait paraître ouverte.
 */
export function verbeDeLaContrepartie(
  reservation: ReservationDuCreateur,
): 'publier' | 'corriger' | 'controle' | null {
  const contrepartie = reservation.contrepartie;
  if (!contrepartie) return null;
  if (contrepartie.status === 'pending') return 'publier';
  if (contrepartie.status === 'resubmit_requested') return 'corriger';
  if (contrepartie.status === 'submitted' || contrepartie.status === 'under_review') {
    return 'controle';
  }
  return null;
}

/**
 * La grammaire des surfaces, et c'est elle qui remplace le fouillis.
 *
 * Une carte à ombre **demande quelque chose**, une carte à filet informe, une
 * ligne nue est de l'histoire. Trois traitements pour trois rapports à
 * l'action — et le « moche » de l'onglet des terminées venait précisément d'un
 * traitement d'action appliqué à de l'histoire.
 *
 * **Et une quatrième, pour ce qui revient.** Une reprise n'est pas une demande
 * de plus : le salon a regardé, refusé, et dit pourquoi. Sous le même traitement
 * que les autres, elle se perd dans une pile où tout demande également — alors
 * que c'est la seule ligne de l'écran qui porte un reproche. Elle prend le
 * contour d'encre, qui est le trait le plus fort du système.
 *
 * **Le contour remplace l'ombre, il ne s'y ajoute pas.** Une ombre sous un filet
 * fort les annule l'une l'autre et rend la hiérarchie illisible ; c'est la règle
 * qui vaut déjà entre l'ombre et le filet clair, et une reprise ne mérite pas
 * une exception qui abîmerait les deux.
 */
export type Surface = 'demande' | 'reprise' | 'informe' | 'histoire';

export function surfaceDe(
  reservation: ReservationDuCreateur,
  onglet: string,
): Surface {
  if (onglet === 'terminees') return 'histoire';
  if (attenteDe(reservation) !== 'creatrice') return 'informe';
  return verbeDeLaContrepartie(reservation) === 'corriger' ? 'reprise' : 'demande';
}

/**
 * Les trois onglets, et les statuts que chacun couvre.
 *
 * **L'ordre est celui de ce qu'on doit faire, pas celui du cycle de vie.** Une
 * prestation consommée dont la contrepartie n'est pas envoyée est la seule
 * chose de cet écran qui court contre une échéance ; elle passe donc devant un
 * rendez-vous de la semaine prochaine, qui n'attend rien de personne. Le cycle
 * de vie mettait « à venir » en tête parce que c'est le début de l'histoire —
 * une raison de modèle, pas une raison de lecteur.
 */
const ONGLETS: { cle: string; libelle: string; statuts: BookingStatus[] }[] = [
  {
    cle: 'a-venir',
    libelle: 'parcours.ongletAVenir',
    // `awaiting_business` est à venir, pas en cours : la place est tenue et le
    // rendez-vous existe. Le ranger ailleurs le ferait disparaître de l'onglet
    // où on le cherche, pendant les quelques heures qui comptent.
    statuts: ['held', 'awaiting_business', 'confirmed'],
  },
  {
    cle: 'en-cours',
    libelle: 'parcours.ongletEnCours',
    statuts: ['consumed'],
  },
  {
    cle: 'terminees',
    libelle: 'parcours.ongletTerminees',
    // `expired`, `cancelled` et `no_show` sont des fins, pas des absences. Les
    // omettre ferait disparaître de l'écran des réservations dont quelqu'un se
    // souvient.
    statuts: ['cancelled', 'no_show', 'expired'],
  },
];

/**
 * **Le seul onglet qui porte un compte.** Un chiffre sur un onglet est un appel
 * permanent : il demande qu'on s'en occupe, et il le demande sans fin sur ce
 * qui est fini. « À venir » se parcourt, « terminées » se consulte ; seul
 * l'envoi attend quelque chose de vous.
 */
const ONGLET_QUI_COMPTE = 'en-cours';

/**
 * L'index d'un onglet, **et le défaut est l'envoi**.
 *
 * **La v10 range les onglets dans l'ordre du temps** — ce qui vient, ce qui
 * attend de moi, ce qui est fini — et « à envoyer » n'est donc plus le premier.
 * Le défaut ne suit pas ce déplacement : l'ordre de lecture et l'onglet
 * d'arrivée répondent à deux questions différentes, et retomber sur zéro aurait
 * ouvert l'écran sur une liste qui n'attend personne. C'est aussi le seul
 * onglet qui porte un compte, pour la même raison.
 */
function indexDOnglet(cle: string | undefined): number {
  const trouve = ONGLETS.findIndex((onglet) => onglet.cle === cle);
  return trouve === -1 ? ONGLETS.findIndex((onglet) => onglet.cle === ONGLET_QUI_COMPTE) : trouve;
}

export function HistoriqueScreen({
  onOuvrir,
  ongletDemande,
  onOngletApplique,
}: {
  onOuvrir: (reservation: ReservationDuCreateur) => void;
  /**
   * L'onglet sur lequel s'ouvrir, quand on arrive d'ailleurs.
   *
   * **Le défaut reste « en cours », et ce n'est pas une omission.** L'ordre des
   * onglets est celui de ce qu'on doit faire : une prestation consommée dont la
   * contrepartie n'est pas envoyée court contre une échéance, un rendez-vous de
   * la semaine prochaine n'attend personne. Ce classement vaut pour qui ouvre
   * l'onglet des réservations de lui-même.
   *
   * Il ne vaut pas pour qui vient de réserver. Celui-là cherche **la place
   * qu'il vient de prendre**, et elle est en `held` ou `awaiting_business` —
   * c'est-à-dire dans « à venir », jamais dans « en cours ». Il atterrissait
   * donc sur un onglet qui ne contenait pas ce qu'il venait de faire, souvent
   * vide, juste après le geste le plus engageant du parcours.
   */
  ongletDemande?: string;
  /**
   * Dit à la route que la demande est consommée.
   *
   * Sans cela, le paramètre resterait posé : quelqu'un qui réserve, passe à
   * « terminées », puis réserve de nouveau verrait la seconde demande ignorée —
   * la valeur n'aurait pas changé, et rien ne se déclencherait.
   */
  onOngletApplique?: () => void;
}) {
  const { api } = useApi();
  const { t, locale } = useI18n();
  const [index, setIndex] = useState(() => indexDOnglet(ongletDemande));

  // Par une référence, pour que l'effet ne dépende que de la demande : la
  // fonction est écrite à l'appel et change d'identité à chaque rendu.
  const appliquer = useRef(onOngletApplique);
  appliquer.current = onOngletApplique;

  // **Et non le seul état initial.** Les onglets du bas gardent leurs écrans
  // montés : qui a déjà ouvert ses réservations une fois y revient sur un
  // composant vivant, dont l'état initial a été calculé il y a longtemps.
  useEffect(() => {
    if (ongletDemande === undefined) return;
    setIndex(indexDOnglet(ongletDemande));
    appliquer.current?.();
  }, [ongletDemande]);

  const statuts = ONGLETS[index].statuts;
  const requete = useRequete<HistoriqueDuCreateur>(
    (signal) => api.mesReservations({ statuts }, signal),
    { estVide: (vue) => vue.items.length === 0, dependances: [index] },
  );

  // Les compteurs sont ceux de la réponse, quel que soit l'onglet lu : ils
  // portent sur tout l'historique.
  const compteurs = useMemo(() => {
    const source =
      requete.etat === 'pret'
        ? requete.donnees.compteurs
        : requete.etat === 'erreur' && requete.donnees
          ? requete.donnees.compteurs
          : null;
    return ONGLETS.map((onglet) =>
      source === null || onglet.cle !== ONGLET_QUI_COMPTE
        ? undefined
        : onglet.statuts.reduce((total, statut) => total + (source[statut] ?? 0), 0),
    );
  }, [requete]);

  return (
    <Ecran
      requete={requete}
      titre={t('parcours.historiqueTitre')}
      squelette={<SkeletonLignes combien={6} testID="squelette-historique" />}
      testID="ecran-historique"
      vide={
        <View style={{ gap: 12 }}>
          <Onglets index={index} onChange={setIndex} compteurs={compteurs} />
          <EmptyState
            title={t(ONGLETS[index].libelle)}
            body={t('parcours.historiqueVide')}
            testID="onglet-vide"
          />
        </View>
      }
    >
      {(vue) => (
        <View style={{ gap: 12 }}>
          <Onglets index={index} onChange={setIndex} compteurs={compteurs} />
          {/* **Le libellé nomme le geste, la ligne nomme la situation.** Aucun
              libellé de deux mots ne peut dire « tu as déjà publié, il reste à
              le prouver » : « à faire » couvrait publier, corriger et attendre,
              et « to send » seul ne dit pas qu'on a déjà publié. */}
          {ONGLETS[index].cle === ONGLET_QUI_COMPTE ? (
            <Texte variante="type.body" couleur="ink.soft" testID="aide-a-envoyer">
              {t('parcours.ongletAEnvoyerAide')}
            </Texte>
          ) : null}
          {vue.items.map((reservation, rang) => (
            <Apparition key={reservation.booking_id} rang={rang}>
              <CarteDeReservation
                reservation={reservation}
                onglet={ONGLETS[index].cle}
                onOuvrir={onOuvrir}
                onRelire={requete.recharger}
              />
            </Apparition>
          ))}
        </View>
      )}
    </Ecran>
  );
}

/**
 * Une ligne nue : l'historique, qui ne demande rien.
 *
 * Le quantième à gauche en mono, la prestation et son attribution au milieu, le
 * résultat en pastille à droite. Aucune ombre, aucun filet de carte : un seul
 * trait qui sépare des lignes, comme un relevé.
 *
 * **La pastille dit le résultat, jamais l'état technique.** « Honoured » et
 * « Not honoured » sont ce qui compte pour elle ; `no_show` et `expired` sont
 * des mots de machine, et la créatrice n'a pas à traduire.
 */
function LigneNue({ reservation }: { reservation: ReservationDuCreateur }) {
  const { t, locale } = useI18n();
  const c = useColors();
  const quand = reservation.starts_at ?? reservation.valid_until;
  const issue = issueDe(reservation);

  return (
    <View
      testID={`reservation-${reservation.booking_id}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 13,
        borderTopWidth: 1,
        borderTopColor: c['line.default'],
      }}
    >
      <Texte
        variante="type.dataLabel"
        couleur="ink.mute"
        style={{ width: 26 }}
        testID={`quand-${reservation.booking_id}`}
      >
        {formatQuantieme(quand, locale, reservation.business_timezone)}
      </Texte>

      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Texte variante="type.bodyStrong">{reservation.item_name}</Texte>
        <Texte variante="type.caption" couleur="ink.soft">
          {`${reservation.business_name} · ${t(`parcours.format_${reservation.content_format}`)}`}
        </Texte>
      </View>

      <View
        testID={`issue-${reservation.booking_id}`}
        style={{
          paddingVertical: 5,
          paddingHorizontal: 10,
          borderRadius: radius['radius.sm'],
          backgroundColor: c[issue.fond],
        }}
      >
        <Texte variante="type.dataLabel" couleur={issue.encre}>
          {t(issue.libelle).toUpperCase()}
        </Texte>
      </View>
    </View>
  );
}

/** Ce qu'une réservation close a produit, du point de vue de la créatrice. */
function issueDe(reservation: ReservationDuCreateur): {
  libelle: string;
  fond: ColorName;
  encre: ColorName;
} {
  const contrepartie = reservation.contrepartie;
  if (contrepartie?.status === 'approved') {
    return {
      libelle: 'parcours.issueHonoree',
      fond: 'status.success.surface',
      encre: 'status.success.text',
    };
  }
  if (contrepartie?.status === 'unfulfilled' || reservation.status === 'no_show') {
    return {
      libelle: 'parcours.issueNonHonoree',
      fond: 'status.danger.surface',
      encre: 'status.danger.text',
    };
  }
  // Annulée, expirée : ni tenue ni manquée. La ranger en « non honorée »
  // l'inscrirait au passif d'une créatrice qui n'a rien fait de mal.
  return { libelle: 'parcours.issueAnnulee', fond: 'bg.inset', encre: 'ink.soft' };
}

/**
 * Une ligne de réservation, dans l'ordre du cadre 08.
 *
 * **La prestation d'abord, le salon ensuite.** L'écran mettait le nom du salon
 * en tête : c'est ce dont on se souvient le moins. Ce qu'on cherche dans une
 * liste de dix lignes est ce qu'on a réservé.
 *
 * **La date est un bloc mono à gauche, pas une ligne de texte.** Elle se balaie
 * du regard sur dix lignes ; en texte, il faut lire chacune.
 *
 * **Le badge porte le palier et le réseau**, parce que la même prestation peut
 * exister sur deux comptes — « one story » ne dit pas sur lequel publier.
 */
/**
 * Une réservation, dans les trois onglets. **Une seule carte, trois variantes.**
 *
 * **Le réseau et le format ouvrent la carte**, sur la ligne qui portait
 * l'échéance. Un coup d'œil suffit alors à savoir *où* et *quoi* avant de lire
 * le nom — c'est la question qu'on se pose d'abord dans une liste où la même
 * prestation peut exister sur deux comptes.
 *
 * **La droite de cette ligne dit l'état, et il change avec l'onglet** : rien à
 * venir, l'échéance en cours d'envoi, l'acceptation une fois fini. Trois choses
 * qui répondent à la même question — *où j'en suis* — donc une seule place.
 *
 * **Une action par carte, en pilule fine à droite.** Le bouton pleine largeur
 * mangeait la largeur du nom et faisait de chaque carte un appel. La carte sans
 * action n'en porte aucune, plutôt qu'un bouton gris : un bouton gris se presse
 * quand même, et ne répond pas.
 *
 * **Aucune ligne sous 16 px, et plus de mono.** Une durée et une date sont des
 * phrases ; `type.data` en faisait des données de système, et les capitales
 * espacées détruisent la silhouette des mots — c'est-à-dire ce qui permet de
 * balayer une liste sans la lire.
 */
function CarteDeReservation({
  reservation,
  onglet,
  onOuvrir,
  onRelire,
}: {
  reservation: ReservationDuCreateur;
  onglet: string;
  onOuvrir: (reservation: ReservationDuCreateur) => void;
  /** Relit la liste : une réservation annulée quitte l'onglet « à venir ». */
  onRelire: () => void;
}) {
  const { t, locale } = useI18n();
  const c = useColors();
  const attente = attenteDe(reservation);
  const agit = attente === 'creatrice';
  const contrepartie = reservation.contrepartie;
  const reste = contrepartie ? tempsRestant(contrepartie.deadline_at) : null;
  const glyphe = glypheDePlateforme(reservation.platform);
  const repere = repereDuCreneau(
    reservation.starts_at ?? reservation.valid_until,
    locale,
    reservation.business_timezone,
  );

  /**
   * L'attribution, et **le moment n'y entre que s'il vaut encore quelque
   * chose**. À venir il situe le rendez-vous, terminé il date le souvenir ; en
   * cours d'envoi c'est l'échéance qui compte, et redire le créneau passé
   * ferait deux temps dans une carte qui n'en a qu'un.
   */
  const attribution =
    onglet === ONGLET_QUI_COMPTE
      ? reservation.business_name
      : t('parcours.verbePour', {
          prestation: t(`parcours.moment_${repere.quand}`, {
            jour: repere.libelle,
            heure: repere.heure,
          }),
          salon: reservation.business_name,
        });

  return (
    <Pressable
      testID={`reservation-${reservation.booking_id}`}
      accessibilityRole={agit ? 'button' : undefined}
      accessibilityLabel={agit ? reservation.business_name : undefined}
      // Pressable seulement quand il y a quelque chose derrière : une carte qui
      // répond au doigt sans rien ouvrir apprend à ne plus essayer.
      disabled={!agit}
      onPress={() => onOuvrir(reservation)}
      style={({ pressed }) => ({
        opacity: pressed ? 0.7 : 1,
        borderRadius: radius['radius.lg'],
        backgroundColor: c['bg.surface'],
        borderWidth: 1,
        borderColor: c['line.default'],
        padding: 16,
        gap: 11,
        // « Un coin de 18 px sans ombre flotte au lieu de se poser » : la règle
        // vaut des douze surfaces du produit, et la planche la dessine à plat
        // parce qu'une planche est plate.
        ...elevationDeCarte(),
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        {glyphe ? <Icone nom={glyphe} couleur="ink.default" taille={18} /> : null}
        <Texte
          variante="type.body"
          couleur="ink.soft"
          style={{ flex: 1, minWidth: 0 }}
          testID={`palier-${reservation.booking_id}`}
        >
          {t(`parcours.format_${reservation.content_format}`)}
        </Texte>

        {/* L'échéance, là où l'onglet la rend utile : pendant l'envoi. */}
        {onglet === ONGLET_QUI_COMPTE && reste ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icone nom="horloge" couleur="brand.700" taille={15} />
            <Texte
              variante="type.bodyStrong"
              couleur="brand.700"
              testID={`reste-${reservation.booking_id}`}
            >
              {t('parcours.contrepartieReste', { reste })}
            </Texte>
          </View>
        ) : null}

        {/* Terminé, l'état prend la place de l'action : il n'y a plus rien à
            faire, et c'est ce qu'on vient vérifier. */}
        {onglet === 'terminees' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icone nom="coche" couleur="status.success.text" taille={17} />
            <Texte
              variante="type.body"
              couleur="status.success.text"
              testID={`etat-${reservation.booking_id}`}
            >
              {t('parcours.reservationAcceptee')}
            </Texte>
          </View>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Texte variante="type.titreDApercu" ellipseSurNomPropre>
            {reservation.item_name}
          </Texte>
          <Texte
            variante="type.body"
            couleur="ink.soft"
            ellipseSurNomPropre
            testID={`quand-${reservation.booking_id}`}
          >
            {attribution}
          </Texte>
        </View>
        {agit ? (
          <Button
            label={t(`parcours.action_${destination(reservation)}`)}
            onPress={() => onOuvrir(reservation)}
            fullWidth={false}
            testID={`agir-${reservation.booking_id}`}
          />
        ) : null}
      </View>

      {/* **Ce qui n'est pas une action reste écrit, jamais grisé.** Une ligne
          en contrôle, un droit périmé, une demande que le salon n'a pas encore
          tranchée : trois situations où il n'y a rien à faire, et où se taire
          ferait chercher le bouton disparu. */}
      {attente === 'controle' ? (
        <Texte
          variante="type.body"
          couleur="ink.soft"
          testID={`rien-a-faire-${reservation.booking_id}`}
        >
          {t('parcours.contrepartieRienAFaire')}
        </Texte>
      ) : null}

      {reservation.status === 'awaiting_business' ? (
        <StatusMessage
          level="neutral"
          body={t('parcours.enAttenteDuSalon')}
          testID={`en-attente-${reservation.booking_id}`}
        />
      ) : null}

      {reservation.status === 'confirmed' && !droitEncoreValide(reservation) ? (
        <StatusMessage
          level="neutral"
          body={t('parcours.droitPerime')}
          testID={`droit-perime-${reservation.booking_id}`}
        />
      ) : null}

      {/* **Annuler est le geste qu'on ne peut pas faire depuis le salon.** Le
          composant se tait de lui-même sur les états terminaux — il n'y a pas
          de condition à écrire ici, et en écrire une la ferait diverger du
          diagramme. */}
      <AnnulerLaReservation reservation={reservation} onAnnulee={onRelire} />
    </Pressable>
  );
}

function Onglets({
  index,
  onChange,
  compteurs,
}: {
  index: number;
  onChange: (i: number) => void;
  compteurs: (number | undefined)[];
}) {
  const { t } = useI18n();
  return (
    <SegmentedTabs
      testID="onglets"
      index={index}
      onChange={onChange}
      items={ONGLETS.map((onglet, i) => ({
        label: t(onglet.libelle),
        count: compteurs[i],
      }))}
    />
  );
}

/**
 * Ce qu'une ligne ouvre, ou rien.
 *
 * **Une réservation confirmée mène à son code de retrait.** C'est le geste
 * principal du produit, et il n'était atteignable qu'immédiatement après la
 * confirmation : fermer l'application faisait perdre le code jusqu'au rendez-
 * vous. Une prestation consommée mène à sa contrepartie, où l'on envoie la
 * preuve. Le reste ne mène nulle part, et ne se prétend donc pas pressable.
 *
 * **Confirmée seulement, ni retenue ni en attente du salon.** Le code naît à la
 * confirmation ; une réservation retenue n'en a pas, et une réservation que le
 * salon n'a pas encore acceptée non plus — le serveur refuse dans les deux cas.
 * La ligne proposait « voir le code » sur une réservation qui n'en avait aucun.
 */
/**
 * Ce que la ligne attend, et de qui.
 *
 * **C'est la règle du cadre 08b, et elle décide de la forme.** Une ligne qui
 * attend quelque chose de la créatrice porte un filet d'encre à gauche et un
 * bouton ; une ligne en contrôle n'en a pas et le dit en mots — « rien à faire
 * de votre côté ». Sans cette distinction, trois lignes se ressemblent et on
 * relit les trois pour trouver laquelle demande un geste.
 *
 * Isolée du rendu pour la même raison que le cycle du mur : ce qui se promet
 * s'éprouve sans monter un écran.
 */
export function attenteDe(
  reservation: ReservationDuCreateur,
): 'creatrice' | 'controle' | null {
  // Le code de retrait est un geste, au comptoir : la ligne le porte — tant
  // que le droit court. Périmé, elle n'attend plus personne.
  if (reservation.status === 'confirmed') return droitEncoreValide(reservation) ? 'creatrice' : null;
  const contrepartie = reservation.contrepartie;
  if (!contrepartie) return null;
  if (contrepartie.status === 'pending' || contrepartie.status === 'resubmit_requested') {
    return 'creatrice';
  }
  if (contrepartie.status === 'submitted' || contrepartie.status === 'under_review') {
    return 'controle';
  }
  // Approuvée ou non honorée : la ligne est close, elle n'attend plus personne.
  return null;
}

/**
 * Le droit court-il encore ?
 *
 * **`confirmed` ne veut pas dire consommable.** Une réservation confirmée que
 * personne n'a servie garde son statut pour toujours : le diagramme n'a pas de
 * flèche de `confirmed` vers `expired`, et rien ne la déplace. Passé
 * `valid_until`, le serveur refuse le code — `redemption_booking_not_redeemable`
 * — et l'écran continuait de proposer « Voir le code ».
 *
 * C'est ce qui a été trouvé en campagne, et c'est le pire endroit possible pour
 * ce défaut : le code est la seule chose à montrer au comptoir, et le message
 * d'erreur qui s'affichait à sa place — « aucun code de retrait pour l'instant »
 * — se lit comme une panne de la plateforme le jour du rendez-vous.
 *
 * **La comparaison sert à ne pas proposer, jamais à autoriser.** C'est le
 * serveur qui refuse, et l'horloge du téléphone n'est pas une preuve : elle
 * évite seulement d'appuyer sur un bouton pour apprendre qu'il ne servait à
 * rien. Le même partage que pour l'échéance d'accord côté commerce.
 */
export function droitEncoreValide(
  reservation: ReservationDuCreateur,
  maintenant: number = Date.now(),
): boolean {
  return new Date(reservation.valid_until).getTime() > maintenant;
}

export function destination(
  reservation: ReservationDuCreateur,
): 'code' | 'preuve' | null {
  if (reservation.status === 'confirmed') {
    // Le droit périmé n'ouvre rien. La contrepartie, elle, garde sa porte :
    // une publication reste à envoyer même si le rendez-vous est passé.
    if (droitEncoreValide(reservation)) return 'code';
    return reservation.contrepartie ? 'preuve' : null;
  }
  if (reservation.contrepartie) return 'preuve';
  return null;
}

/**
 * L'heure du rendez-vous, dans le fuseau du commerce.
 *
 * Sur un item sans créneau, il n'y a pas d'heure : c'est une fenêtre de
 * validité. En inventer une afficherait un rendez-vous qui n'existe pas.
 */
function heureLocaleDuCommerce(
  reservation: ReservationDuCreateur,
  locale: SupportedLocale,
): string {
  const instant = reservation.starts_at ?? reservation.valid_until;
  // `toLocaleString` sans options rendait « 11/08/2026 16:45:00 » : un mois en
  // chiffres, que la moitié du monde lit à l'envers, et des secondes sur un
  // rendez-vous en salon. `formatDateTime` porte le format de la maison —
  // mois en lettres, heure à la minute.
  return formatDateTime(instant, locale, reservation.business_timezone);
}
