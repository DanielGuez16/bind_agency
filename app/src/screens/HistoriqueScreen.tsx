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
import { useColors } from '../theme';
import { useI18n, type SupportedLocale } from '../i18n';
import { formatDateTime } from '../format';
import { Ecran } from './Ecran';
import { useRequete } from './useRequete';

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
          {vue.items.map((reservation, rang) => {
            // **Pressable exactement quand la ligne attend un geste.** Une
            // ligne en contrôle ouvrait l'écran de preuve alors qu'elle dit
            // « rien à faire de votre côté » : la ligne et son texte se
            // contredisaient, et c'est le texte qui a raison.
            const ouvrable = attenteDe(reservation) === 'creatrice';
            return (
              <Apparition key={reservation.booking_id} rang={rang}>
              <Pressable
                testID={`reservation-${reservation.booking_id}`}
                accessibilityRole={ouvrable ? 'button' : undefined}
                accessibilityLabel={ouvrable ? reservation.business_name : undefined}
                // Pressable seulement quand il y a quelque chose derrière. Une
                // ligne qui répond au doigt sans rien ouvrir apprend à ne plus
                // essayer, et c'est tout l'écran qui devient inerte.
                disabled={!ouvrable}
                onPress={() => onOuvrir(reservation)}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
              >
                <LigneDeReservation reservation={reservation} onOuvrir={onOuvrir} />
              </Pressable>
              </Apparition>
            );
          })}
        </View>
      )}
    </Ecran>
  );
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
function LigneDeReservation({
  reservation,
  onOuvrir,
}: {
  reservation: ReservationDuCreateur;
  onOuvrir: (reservation: ReservationDuCreateur) => void;
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
          <Button
            label={t(`parcours.action_${destination(reservation)}`)}
            onPress={() => onOuvrir(reservation)}
            testID={`agir-${reservation.booking_id}`}
          />
        ) : attente === 'controle' ? (
          <Texte
            variante="type.caption"
            couleur="ink.soft"
            testID={`rien-a-faire-${reservation.booking_id}`}
          >
            {t('parcours.contrepartieRienAFaire')}
          </Texte>
        ) : null}
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
