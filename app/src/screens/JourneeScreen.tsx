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
import { Pressable, View } from 'react-native';

import { useApi, type JourneeDuCommerce, type ReservationDuCommerce } from '../api';
import {
  Apparition,
  Button,
  DataRow,
  EmptyState,
  Filet,
  LigneDeContrepartie,
  TierBadge,
  StatusMessage,
  TextField,
  Texte,
  vibration,
} from '../components';
import { formatDateTime, formatHeure } from '../format';
import { useI18n, type SupportedLocale } from '../i18n';
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

        /**
         * Une section de la liste. Deux au plus : ce qui attend, puis le jour.
         *
         * **Le même registre pour les deux.** Ce qui attend une décision se
         * signale par une pastille et sa place en tête, jamais par un relief
         * qui en ferait un autre type d'objet. Deux formes physiques pour deux
         * états de la même chose obligent à réapprendre la lecture à chaque
         * section.
         */
        const section = (titre: string, lignes: ReservationDuCommerce[], marque: boolean) =>
          lignes.length === 0 ? null : (
            <View style={{ gap: 4 }} testID={marque ? 'a-trancher' : 'planning'}>
              <Texte
                variante="type.label"
                couleur="ink.soft"
                style={{ paddingHorizontal: 12, paddingBottom: 4 }}
              >
                {titre}
              </Texte>
              {lignes.map((reservation, rang) => (
                <Apparition key={reservation.booking_id} rang={rang}>
                  <Pressable
                    onPress={large ? () => setChoisie(reservation.booking_id) : undefined}
                    accessibilityRole={large ? 'button' : undefined}
                    testID={`ligne-${reservation.booking_id}`}
                    style={{
                      borderRadius: radius['radius.none'],
                      // La ligne ouverte porte deux marques, comme dans la
                      // barre latérale : un fond et une barre. Jamais la
                      // couleur seule.
                      backgroundColor:
                        large && reservation.booking_id === ouverte?.booking_id
                          ? c['brand.50']
                          : 'transparent',
                      borderLeftWidth: 3,
                      borderLeftColor:
                        large && reservation.booking_id === ouverte?.booking_id
                          ? c['brand.700']
                          : 'transparent',
                    }}
                  >
                    <Ligne
                      reservation={reservation}
                      timezone={journee.timezone}
                      onFait={requete.recharger}
                      // En grand écran la ligne ne fait que désigner : les
                      // gestes vivent dans le panneau, une seule fois.
                      avecGestes={!large}
                    />
                  </Pressable>
                </Apparition>
              ))}
            </View>
          );

        const colonneListe = (
          <View
            testID="colonne-liste"
            style={{ gap: 16, width: large ? breakpoint.listWidthMerchant : undefined }}
          >
            {section(t('commerce.aTrancher', { count: aTrancher.length }), aTrancher, true)}
            {aTrancher.length > 0 && planning.length > 0 ? <Filet marge={4} /> : null}
            {section(t('commerce.journeePlanning'), planning, false)}
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
                <Texte couleur="ink.mute" testID="aucune-ligne-ouverte">
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
        {reservation.creator_handle ? (
          <Texte variante="type.caption" couleur="ink.mute">
            {reservation.creator_handle}
          </Texte>
        ) : null}
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
          <Gestes reservation={reservation} onFait={onFait} />
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
 * Les trois gestes du comptoir, groupés.
 *
 * Accorder et refuser sur une demande, se désister sur une place confirmée. Les
 * deux jeux ne coexistent jamais : un état, un jeu de gestes.
 */
function Gestes({
  reservation,
  onFait,
}: {
  reservation: ReservationDuCommerce;
  onFait: () => void;
}) {
  const { api, messageDErreur } = useApi();
  const { t } = useI18n();

  // Comparé ici pour l'affichage seulement : c'est le serveur qui tranche, et
  // il refuse. Attendre son refus ferait appuyer sur un bouton pour apprendre
  // qu'il ne servait à rien.
  const echeance = reservation.starts_at ?? reservation.valid_until;
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
    return (
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
        onValider={(motif, client) => client.refuserLaReservation(reservation.booking_id, motif)}
        onFait={onFait}
      />
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
        borderRadius: radius['radius.none'],
        // **Un seul registre.** La ligne portait un fond et une bordure tant
        // qu'elle n'était pas passée : dans une colonne où le bloc « à
        // trancher » était déjà en relief, cela faisait trois épaisseurs pour
        // trois états de la même chose. Le passé s'efface, le reste est plat,
        // et ce qui attend se signale par sa pastille — jamais par la couleur
        // seule, le mot d'état est là.
        opacity: passe ? 0.62 : 1,
      }}
    >
      <DataRow
        label={heureDe(reservation, timezone, t('commerce.journeeSansCreneau'), locale)}
        value={nomDe(reservation)}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Texte variante="type.caption" couleur="ink.soft" style={{ flexShrink: 1 }}>
          {reservation.item_name}
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
          <Gestes reservation={reservation} onFait={onFait} />
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
