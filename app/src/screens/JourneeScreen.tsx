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
 */
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { useApi, type JourneeDuCommerce, type ReservationDuCommerce } from '../api';
import {
  Apparition,
  Button,
  DataRow,
  EmptyState,
  Filet,
  TierBadge,
  StatusMessage,
  TextField,
  Texte,
  vibration,
} from '../components';
import { useI18n } from '../i18n';
import { breakpoint, radius, useTheme, type ColorName } from '../theme';
import { ECART_DES_COLONNES, useGabarit } from '../shell/gabarit';
import { Ecran } from './Ecran';
import { useRequete } from './useRequete';

export function JourneeScreen({ businessId, jour }: { businessId: string; jour?: string }) {
  const { api } = useApi();
  const { t } = useI18n();
  const { color: c } = useTheme();
  const { large } = useGabarit();
  // La ligne que l'on a **touchée**. Nulle tant qu'on n'a rien touché : le
  // panneau s'ouvre alors sur ce qui attend une décision, et à défaut sur la
  // première ligne du jour.
  const [choisie, setChoisie] = useState<string | null>(null);

  const requete = useRequete<JourneeDuCommerce>(
    (signal) => api.journeeDuCommerce(businessId, jour, signal),
    { estVide: (journee) => journee.items.length === 0, dependances: [businessId, jour] },
  );

  return (
    <Ecran
      requete={requete}
      titre={t('commerce.journeeTitre')}
      nature="merchantListeDetail"
      testID="ecran-journee"
      vide={
        // **Plus de cercle.** Il ne disait rien et occupait la place du titre.
        // Une journée sans rendez-vous est une information, pas une page qui
        // n'a pas chargé — et c'est le titre qui doit le dire.
        <EmptyState
          title={t('commerce.journeeVideTitre')}
          body={t('commerce.journeeVide')}
          testID="journee-vide"
        />
      }
    >
      {(journee) => {
        // La file vient du serveur, pas d'un filtre sur la journée : une
        // décision à prendre pour après-demain n'est dans aucune journée qu'on
        // ouvre, et la filtrer ici l'aurait laissée invisible.
        const aTrancher = journee.a_trancher;
        const planning = journee.items.filter((r) => r.status !== 'awaiting_business');
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
        const parDefaut = aTrancher[0]?.booking_id ?? planning[0]?.booking_id ?? null;
        const ouverte =
          [...aTrancher, ...planning].find((r) => r.booking_id === (choisie ?? parDefaut)) ?? null;

        const colonneListe = (
          <View style={{ gap: 16, width: large ? breakpoint.listWidthMerchant : undefined }}>
            {aTrancher.length > 0 ? (
              <View style={{ gap: 10 }} testID="a-trancher">
                <Texte variante="type.label" couleur="text.secondary">
                  {t('commerce.aTrancher', { count: aTrancher.length })}
                </Texte>
                {aTrancher.map((reservation, rang) => (
                  <Apparition key={reservation.booking_id} rang={rang}>
                    <Decision
                      reservation={reservation}
                      timezone={journee.timezone}
                      onFait={requete.recharger}
                    />
                  </Apparition>
                ))}
                <Filet marge={4} />
              </View>
            ) : null}

            <View style={{ gap: 4 }}>
              {planning.map((reservation) => (
                <Pressable
                  key={reservation.booking_id}
                  onPress={large ? () => setChoisie(reservation.booking_id) : undefined}
                  accessibilityRole={large ? 'button' : undefined}
                  testID={`ligne-${reservation.booking_id}`}
                  style={{
                    borderRadius: radius['radius.md'],
                    // La ligne ouverte porte deux marques, comme dans la barre
                    // latérale : un fond et une barre. Jamais la couleur seule.
                    backgroundColor:
                      large && reservation.booking_id === ouverte?.booking_id
                        ? c['accent.subtle']
                        : 'transparent',
                    borderLeftWidth: 3,
                    borderLeftColor:
                      large && reservation.booking_id === ouverte?.booking_id
                        ? c['accent.default']
                        : 'transparent',
                  }}
                >
                  <Ligne
                    reservation={reservation}
                    timezone={journee.timezone}
                    onFait={requete.recharger}
                  />
                </Pressable>
              ))}
            </View>
          </View>
        );

        // En compact, une seule colonne : la liste, comme avant. Le détail y
        // vit déjà dans la ligne elle-même, et une seconde colonne de 720 ne
        // tiendrait nulle part.
        if (!large) return colonneListe;

        return (
          <View style={{ flexDirection: 'row', gap: ECART_DES_COLONNES }}>
            {colonneListe}
            <View style={{ flex: 1, maxWidth: breakpoint.contentMaxMerchant }}>
              {ouverte ? (
                <Detail
                  reservation={ouverte}
                  timezone={journee.timezone}
                  onFait={requete.recharger}
                />
              ) : (
                <Texte couleur="text.muted" testID="aucune-ligne-ouverte">
                  {t('commerce.choisirUneLigne')}
                </Texte>
              )}
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
function heureDe(reservation: ReservationDuCommerce, timezone: string, sansCreneau: string) {
  return reservation.starts_at
    ? new Date(reservation.starts_at).toLocaleTimeString([], {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : sansCreneau;
}

function nomDe(reservation: ReservationDuCommerce) {
  return (
    [reservation.creator_first_name, reservation.creator_last_name].filter(Boolean).join(' ') ||
    reservation.creator_handle ||
    ''
  );
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
  no_show: 'status.danger',
  cancelled: 'text.muted',
  expired: 'text.muted',
  consumed: 'status.success',
};

/**
 * Le panneau de droite : ce qu'il faut savoir avant de servir.
 *
 * **Il reprend la ligne et lui ajoute ce qu'elle ne porte pas.** La ligne sait
 * déjà présenter l'heure, la prestation, la personne et les gestes du
 * comptoir : la redessiner ici en ferait deux à tenir d'accord. Ce que le
 * panneau ajoute, c'est la contrepartie engagée — ce pour quoi la place est
 * donnée, et qu'aucune ligne de planning n'a la place de dire.
 *
 * **Trois données de la maquette manquent à l'API** et ne sont donc pas
 * inventées : le nombre de publications déjà livrées par le créateur, la
 * mention attendue, et le lieu à identifier. Les deux dernières vivent sur
 * l'offre de palier, que la journée ne rend pas. Les afficher vides aurait
 * meublé le panneau d'un cadre que rien ne remplit.
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
  const { t } = useI18n();

  return (
    <View style={{ gap: 16 }} testID="detail-de-la-ligne">
      <Ligne reservation={reservation} timezone={timezone} onFait={onFait} />

      <Filet marge={4} />

      <View style={{ gap: 6 }}>
        <Texte variante="type.label" couleur="text.secondary">
          {t('commerce.contrepartieAttendue')}
        </Texte>
        <TierBadge tier={reservation.content_format} />
      </View>

      {/* Ce que le salon devra vérifier sur la publication. Au comptoir et pas
          sur un autre écran : c'est ici qu'on sert, et c'est en servant qu'on
          rappelle ce qui est attendu. */}
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
    </View>
  );
}

function Ligne({
  reservation,
  timezone,
  onFait,
}: {
  reservation: ReservationDuCommerce;
  timezone: string;
  onFait: () => void;
}) {
  const { t } = useI18n();
  const { color: c } = useTheme();
  const passe = TERMINES.has(reservation.status);

  return (
    <View
      testID={`reservation-${reservation.booking_id}`}
      style={{
        gap: 2,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 10,
        // Le passé s'efface sans disparaître : il reste lisible, il cesse
        // d'attirer l'œil. Jamais par la couleur seule — le mot d'état est là.
        opacity: passe ? 0.62 : 1,
        backgroundColor: passe ? 'transparent' : c['bg.surface'],
        borderWidth: 1,
        borderColor: passe ? 'transparent' : c['border.subtle'],
      }}
    >
      <DataRow
        label={heureDe(reservation, timezone, t('commerce.journeeSansCreneau'))}
        value={nomDe(reservation)}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Texte variante="type.caption" couleur="text.secondary" style={{ flexShrink: 1 }}>
          {reservation.item_name}
        </Texte>
        {/* Le statut traduit, jamais son code. `awaiting_business` affiché tel
            quel se lisait comme une chaîne oubliée — parce que c'en était une. */}
        <Texte
          variante="type.caption"
          couleur={TEINTE[reservation.status] ?? 'text.secondary'}
          testID={`statut-${reservation.booking_id}`}
        >
          {t(`commerce.statut_${reservation.status}`)}
        </Texte>
      </View>
      {reservation.status === 'confirmed' ? (
        <MotifPuisAction
          libelle={t('commerce.seDesister')}
          aide={t('commerce.seDesisterAide')}
          variante="danger"
          testID={`desister-${reservation.booking_id}`}
          onValider={(motif, api) => api.seDesisterDeLaReservation(reservation.booking_id, motif)}
          onFait={onFait}
        />
      ) : null}
    </View>
  );
}

/** Une réservation en attente : la créatrice, l'heure, et les deux issues. */
function Decision({
  reservation,
  timezone,
  onFait,
}: {
  reservation: ReservationDuCommerce;
  timezone: string;
  onFait: () => void;
}) {
  // Comparé ici pour l'affichage seulement : c'est le serveur qui tranche, et
  // il refuse. Attendre son refus ferait appuyer sur un bouton pour apprendre
  // qu'il ne servait à rien.
  const echeance = reservation.starts_at ?? reservation.valid_until;
  const depassee = echeance !== null && new Date(echeance) <= new Date();
  const { api, messageDErreur } = useApi();
  const { t } = useI18n();
  const { color: c } = useTheme();

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

  return (
    <View
      testID={`decision-${reservation.booking_id}`}
      style={{
        gap: 10,
        padding: 14,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: c['border.default'],
        backgroundColor: c['bg.surface'],
      }}
    >
      <DataRow
        label={heureDe(reservation, timezone, t('commerce.journeeSansCreneau'))}
        value={nomDe(reservation)}
      />
      <Texte variante="type.caption" couleur="text.secondary">
        {reservation.item_name}
      </Texte>

      {echec ? <StatusMessage level="danger" body={echec} testID="echec-decision" /> : null}

      {depassee ? (
        <StatusMessage
          level="warning"
          body={t('commerce.decisionDepassee')}
          testID={`depassee-${reservation.booking_id}`}
        />
      ) : (
        <Button
          label={t('commerce.accorder')}
          loading={envoi}
          onPress={() => void accorder()}
          testID={`accorder-${reservation.booking_id}`}
        />
      )}
      <MotifPuisAction
        libelle={t('commerce.refuser')}
        aide={t('commerce.refuserAide')}
        variante="secondary"
        testID={`refuser-${reservation.booking_id}`}
        onValider={(motif, api) => api.refuserLaReservation(reservation.booking_id, motif)}
        onFait={onFait}
      />
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
  onValider,
  onFait,
}: {
  libelle: string;
  aide: string;
  variante: 'secondary' | 'danger';
  testID: string;
  onValider: (motif: string, api: ReturnType<typeof useApi>['api']) => Promise<unknown>;
  onFait: () => void;
}) {
  const { api, messageDErreur } = useApi();
  const { t } = useI18n();

  const [ouvert, setOuvert] = useState(false);
  const [motif, setMotif] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);

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
      onFait();
    } catch (erreur) {
      vibration.echec();
      setEchec(messageDErreur(erreur));
    } finally {
      setEnvoi(false);
    }
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
      {echec ? <StatusMessage level="danger" body={echec} testID="echec-decision" /> : null}
      {suffisant ? (
        <Button
          label={t('commerce.envoyerLeMotif')}
          variant={variante}
          loading={envoi}
          onPress={() => void valider()}
          testID={`${testID}-valider`}
        />
      ) : null}
      <Button
        label={t('common.annuler')}
        variant="ghost"
        onPress={() => {
          setOuvert(false);
          setMotif('');
          setEchec(null);
        }}
        testID={`${testID}-renoncer`}
      />
    </View>
  );
}
