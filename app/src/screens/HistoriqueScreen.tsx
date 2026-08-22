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
import { useMemo, useState } from 'react';
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
  SegmentedTabs,
  SkeletonLignes,
  StatusMessage,
  Texte,
} from '../components';
import { elevationDeCarte, radius, useColors, type ColorName } from '../theme';
import { useI18n, type SupportedLocale } from '../i18n';
import { formatDateTime, formatMois, formatQuantieme } from '../format';
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

    const dernier = groupes.at(-1);
    if (dernier?.mois === mois) dernier.items.push(item);
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

/** Les trois onglets, et les statuts que chacun couvre. */
const ONGLETS: { cle: string; libelle: string; statuts: BookingStatus[] }[] = [
  {
    cle: 'a-venir',
    libelle: 'parcours.ongletAVenir',
    // `awaiting_business` est à venir, pas en cours : la place est tenue et le
    // rendez-vous existe. Le ranger ailleurs le ferait disparaître de l'onglet
    // où on le cherche, pendant les quelques heures qui comptent.
    statuts: ['held', 'awaiting_business', 'confirmed'],
  },
  { cle: 'en-cours', libelle: 'parcours.ongletEnCours', statuts: ['consumed'] },
  {
    cle: 'terminees',
    libelle: 'parcours.ongletTerminees',
    // `expired`, `cancelled` et `no_show` sont des fins, pas des absences. Les
    // omettre ferait disparaître de l'écran des réservations dont quelqu'un se
    // souvient.
    statuts: ['cancelled', 'no_show', 'expired'],
  },
];

export function HistoriqueScreen({
  onOuvrir,
}: {
  onOuvrir: (reservation: ReservationDuCreateur) => void;
}) {
  const { api } = useApi();
  const { t, locale } = useI18n();
  const [index, setIndex] = useState(0);

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
      source === null
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
          {/* **Seul l'onglet des terminées est groupé** (cadre 08c). Les deux
              autres portent deux ou trois lignes : un intertitre y coûterait
              plus qu'il ne rend, et découperait une liste qui se lit d'un
              coup. */}
          {/* **Terminées : des lignes nues.** Le « moche » venait d'un
              traitement d'action appliqué à de l'histoire — des cartes à ombre
              pour une liste qui ne demande rien. Le quantième à gauche, le mois
              en séparateur, le résultat en pastille : un historique se balaie,
              il ne se lit pas. */}
          {ONGLETS[index].cle === 'terminees'
            ? grouperParMois(vue.items, locale).map((groupe) => (
                <View key={groupe.mois} style={{ gap: 0 }} testID={`mois-${groupe.mois}`}>
                  <Texte
                    variante="type.monoSmall"
                    couleur="ink.mute"
                    style={{ paddingBottom: 10 }}
                  >
                    {groupe.mois}
                  </Texte>
                  {groupe.items.map((reservation, rang) => (
                    <Apparition key={reservation.booking_id} rang={rang}>
                      <LigneNue reservation={reservation} />
                    </Apparition>
                  ))}
                </View>
              ))
            : null}

          {/* **À venir : deux sections nommées par leur verbe.** L'onglet
              mêlait les réservations acceptées, où il faut venir, et celles qui
              attendent la décision du salon, où il faut attendre. Deux verbes
              dans une liste unique, et l'on ne savait pas en la parcourant s'il
              y avait quelque chose à faire. */}
          {ONGLETS[index].cle === 'a-venir'
            ? (['moi', 'salon'] as const).map((qui) => {
                const lignes = vue.items.filter((r) => sectionAVenir(r) === qui);
                if (lignes.length === 0) return null;
                return (
                  <View key={qui} style={{ gap: 11 }} testID={`section-${qui}`}>
                    <Texte variante="type.monoSmall" couleur="ink.mute">
                      {t(qui === 'moi' ? 'parcours.sectionMontreTonCode' : 'parcours.sectionLeSalonDecide')}
                    </Texte>
                    {lignes.map((reservation, rang) => (
                      <Apparition key={reservation.booking_id} rang={rang}>
                        <CarteDeReservation
                          reservation={reservation}
                          onglet="a-venir"
                          onOuvrir={onOuvrir}
                          onRelire={requete.recharger}
                        />
                      </Apparition>
                    ))}
                  </View>
                );
              })
            : null}
          {ONGLETS[index].cle !== 'en-cours' ? null : vue.items.map((reservation, rang) => {
            // **Pressable exactement quand la ligne attend un geste.** Une
            // ligne en contrôle ouvrait l'écran de preuve alors qu'elle dit
            // « rien à faire de votre côté » : la ligne et son texte se
            // contredisaient, et c'est le texte qui a raison.
            const ouvrable = attenteDe(reservation) === 'creatrice';
            return (
              <Apparition key={reservation.booking_id} rang={rang}>
              <CarteDeReservation
                reservation={reservation}
                onglet="en-cours"
                onOuvrir={onOuvrir}
                onRelire={requete.recharger}
              />
              </Apparition>
            );
          })}
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
        variante="type.monoSmall"
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
        <Texte variante="type.monoSmall" couleur={issue.encre}>
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
  return { libelle: 'parcours.issueAnnulee', fond: 'bg.deep', encre: 'ink.soft' };
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
function CarteDeReservation({
  reservation,
  onglet,
  onOuvrir,
  onRelire,
}: {
  reservation: ReservationDuCreateur;
  /** Décide la surface : une carte demande ou informe selon son onglet. */
  onglet: string;
  onOuvrir: (reservation: ReservationDuCreateur) => void;
  /** Relit la liste : une réservation annulée quitte l'onglet « à venir ». */
  onRelire: () => void;
}) {
  const c = useColors();
  const surface = surfaceDe(reservation, onglet);

  const ouvrable = attenteDe(reservation) === 'creatrice';

  return (
    <Pressable
      testID={`reservation-${reservation.booking_id}`}
      accessibilityRole={ouvrable ? 'button' : undefined}
      accessibilityLabel={ouvrable ? reservation.business_name : undefined}
      // Pressable seulement quand il y a quelque chose derrière : une carte qui
      // répond au doigt sans rien ouvrir apprend à ne plus essayer.
      disabled={!ouvrable}
      onPress={() => onOuvrir(reservation)}
      style={({ pressed }) => ({
        opacity: pressed ? 0.7 : 1,
        borderRadius: radius['radius.lg'],
        backgroundColor: c['bg.surface'],
        padding: 16,
        // **La grammaire, posée ici et nulle part ailleurs.** Une carte à ombre
        // demande quelque chose, un contour d'encre dit qu'on lui reproche
        // quelque chose, une carte à filet informe. Aucun des trois ne se
        // cumule : une ombre sous un filet fort les annule l'une l'autre et
        // rend la hiérarchie illisible.
        ...(surface === 'reprise'
          ? { borderWidth: 1, borderColor: c['line.ink'] }
          : surface === 'demande'
            ? elevationDeCarte()
            : { borderWidth: 1, borderColor: c['line.default'] }),
      })}
    >
      <LigneDeReservation
        reservation={reservation}
        onOuvrir={onOuvrir}
        onRelire={onRelire}
      />
    </Pressable>
  );
}

function LigneDeReservation({
  reservation,
  onOuvrir,
  onRelire,
}: {
  reservation: ReservationDuCreateur;
  onOuvrir: (reservation: ReservationDuCreateur) => void;
  onRelire: () => void;
}) {
  const { t, locale } = useI18n();
  const c = useColors();
  const attente = attenteDe(reservation);
  const contrepartie = reservation.contrepartie;
  const quand = reservation.starts_at ?? reservation.valid_until;

  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 12,
        // **Le filet d'encre à gauche des lignes qui attendent un geste.** Il
        // n'y a pas de couleur ici : la matière suffit, et l'ambre serait lu
        // comme la marque.
        borderLeftWidth: 3,
        borderLeftColor: attente === 'creatrice' ? c['line.ink'] : 'transparent',
        paddingLeft: 12,
      }}
    >
      <View style={{ width: 52, gap: 2 }} testID={`quand-${reservation.booking_id}`}>
        <Texte variante="type.monoSmall" couleur="ink.mute">
          {formatDateTime(quand, locale, reservation.business_timezone)}
        </Texte>
      </View>

      <View style={{ flex: 1, gap: 4 }}>
        <Texte variante="type.bodyStrong">{reservation.item_name}</Texte>
        <Texte variante="type.caption" couleur="ink.soft">
          {/* **L'adresse, que le cadre 08a affiche et que l'écran taisait.**
              Une réservation dont on ne sait pas où aller ne se tient pas. */}
          {[reservation.business_name, reservation.business_address]
            .filter(Boolean)
            .join(' · ')}
        </Texte>
        {/* Le palier **et** le réseau : la même prestation peut exister sur
            deux comptes, et publier sur le mauvais ne compte pas. */}
        <Texte variante="type.monoSmall" couleur="ink.mute" testID={`palier-${reservation.booking_id}`}>
          {`${reservation.content_format} · ${reservation.platform}`.toUpperCase()}
        </Texte>

        {reservation.status === 'awaiting_business' ? (
          <StatusMessage
            level="neutral"
            body={
              reservation.approval_expires_at
                ? `${t('parcours.enAttenteDuSalon')} ${t('parcours.enAttenteJusquA', {
                    quand: formatDateTime(
                      reservation.approval_expires_at,
                      locale,
                      reservation.business_timezone,
                    ),
                  })}`
                : t('parcours.enAttenteDuSalon')
            }
            testID={`en-attente-${reservation.booking_id}`}
          />
        ) : null}

        {/* **Un droit périmé se dit, il ne se tait pas.** Une réservation
            confirmée que personne n'a servie garde son statut pour toujours :
            la ligne restait identique à celle d'un rendez-vous à venir, avec
            son bouton, et le code répondait par une erreur. La dire close vaut
            mieux qu'un bouton qui ne mène nulle part — et mieux qu'un silence,
            qui laisserait chercher où est passé le bouton. */}
        {reservation.status === 'confirmed' && !droitEncoreValide(reservation) ? (
          <StatusMessage
            level="neutral"
            body={t('parcours.droitPerime')}
            testID={`droit-perime-${reservation.booking_id}`}
          />
        ) : null}

        {contrepartie ? (
          <>
            {/* **L'échéance était servie et rendue nulle part.** Le statut
                seul — « en attente de votre publication » — ne dit pas jusqu'à
                quand, et c'est la seule chose qui décide s'il faut agir ce
                soir ou la semaine prochaine. */}
            {/* **Ce qui reste, avant la date à laquelle cela finit.** Le cadre
                08b porte « 31 H LEFT » à côté du nom, et l'écran ne donnait
                que la date d'échéance. Une date demande de compter ; un temps
                restant se comprend sans calcul, et c'est lui qui décide si
                l'on publie ce soir ou demain. La date reste dessous — elle
                seule dit *quand*, à l'heure du salon. */}
            {tempsRestant(contrepartie.deadline_at) ? (
              <Texte
                variante="type.monoSmall"
                testID={`reste-${reservation.booking_id}`}
              >
                {t('parcours.contrepartieReste', {
                  reste: tempsRestant(contrepartie.deadline_at),
                }).toUpperCase()}
              </Texte>
            ) : null}
            <Texte
              variante="type.monoSmall"
              couleur="ink.soft"
              testID={`echeance-${reservation.booking_id}`}
            >
              {t('parcours.contrepartieEcheance', {
                quand: formatDateTime(
                  contrepartie.deadline_at,
                  locale,
                  reservation.business_timezone,
                ),
              }).toUpperCase()}
            </Texte>
            {/* La tentative, à partir de la seconde : « 2 sur 3 » dit ce qui
                reste, et la troisième lève une revue humaine. */}
            {/* **L'attente change de nature, et personne ne le disait.** Passé
                en revue humaine, le dossier n'attend plus le salon mais un
                arbitre : le délai n'a plus le même sens, et relancer le salon
                ne sert à rien. Le champ était rendu depuis toujours. */}
            {contrepartie.needs_human_review ? (
              <Texte
                variante="type.caption"
                couleur="ink.soft"
                testID={`en-arbitrage-${reservation.booking_id}`}
              >
                {t('parcours.contrepartieEnArbitrage')}
              </Texte>
            ) : null}
            {contrepartie.attempts_count > 1 ? (
              <Texte
                variante="type.caption"
                couleur="ink.soft"
                testID={`tentative-${reservation.booking_id}`}
              >
                {t('parcours.contrepartieTentative', {
                  n: String(contrepartie.attempts_count),
                })}
              </Texte>
            ) : null}
          </>
        ) : null}

        {/* **Le seul onglet qui agit porte son bouton ici.** Une ligne en
            contrôle le dit en mots plutôt que de griser une action : un bouton
            gris se presse quand même, et ne répond pas. */}
        {attente === 'creatrice' ? (
          // **`fullWidth={false}`, dans une rangée.** Le bouton du système est
          // déjà une pilule ; il s'étirait sur toute la carte parce que
          // `fullWidth` vaut `true` par défaut et que personne ne l'avait dit
          // non. Même correction qu'à la fiche. La rangée est nécessaire : en
          // colonne, `alignSelf` non posé retombe sur l'étirement du parent, et
          // le bouton reprendrait toute la largeur sans que le `false` se voie.
          <View style={{ flexDirection: 'row' }}>
            <Button
              label={t(`parcours.action_${destination(reservation)}`)}
              onPress={() => onOuvrir(reservation)}
              fullWidth={false}
              testID={`agir-${reservation.booking_id}`}
            />
          </View>
        ) : attente === 'controle' ? (
          <Texte
            variante="type.caption"
            couleur="ink.soft"
            testID={`rien-a-faire-${reservation.booking_id}`}
          >
            {t('parcours.contrepartieRienAFaire')}
          </Texte>
        ) : null}

        {/* **Annuler est le geste qu'on ne peut pas faire depuis le salon.**
            Il vivait dans le client d'API sans écran : la seule sortie d'une
            réservation qu'on ne peut plus honorer était de ne pas venir, ce
            que le produit compte comme une absence. Le composant se tait de
            lui-même sur les états terminaux — il n'y a pas de condition à
            écrire ici, et en écrire une la ferait diverger du diagramme. */}
        <AnnulerLaReservation reservation={reservation} onAnnulee={onRelire} />
      </View>
    </View>
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
