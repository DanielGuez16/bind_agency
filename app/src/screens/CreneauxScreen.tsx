/**
 * 05a · Choix du créneau, 05b · confirmation.
 *
 * **Un jour d'abord, puis ses créneaux.** L'API rend l'horizon entier — trente
 * jours, plusieurs centaines de départs possibles. Les empiler dans une seule
 * liste donnait un écran qu'on fait défiler sans savoir quel jour on regarde,
 * et un bouton de confirmation hors de vue. On choisit un jour, on ne voit que
 * lui.
 *
 * **Matin et après-midi, séparés.** Midi est la coupure que tout le monde a en
 * tête quand il choisit une heure ; deux groupes courts se lisent d'un coup
 * d'œil là où trente chips à la file demandent de compter.
 *
 * **Un créneau pris reste visible.** Il donne le rythme du salon ; une grille
 * où ne restent que les trous laisse croire à un commerce vide.
 *
 * **Le bouton est fixé en bas, toujours visible.** C'est la seule action de
 * l'écran, et la faire descendre avec la liste oblige à défiler pour valider ce
 * qu'on vient de choisir.
 */
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { useApi, type Creneau as CreneauApi, type FichePublique, type OffreDeLaFiche } from '../api';
import { Button, DayPicker, EmptyState, SlotPicker, StatusMessage, Texte } from '../components';
import { useI18n } from '../i18n';
import { Ecran } from './Ecran';
import { useRequete } from './useRequete';
import { useTheme } from '../theme';

/** Le nombre de jours proposés à la fois. Au-delà, la rangée ne tient plus. */
const JOURS_VISIBLES = 7;

/** Ce qui sépare le matin de l'après-midi, dans le fuseau du commerce. */
const MIDI = 12;

type Jour = { cle: string; jourCourt: string; numero: string; disponible: boolean };

/**
 * Regroupe les départs par journée **du commerce**, pas du téléphone.
 *
 * Un créneau de 23 h à Miami tombe le lendemain en UTC : classer sur la date
 * brute placerait des rendez-vous du soir au jour suivant, et le salon ne les
 * verrait pas où il les attend.
 */
function parJour(creneaux: CreneauApi[], timezone: string) {
  const jours = new Map<string, CreneauApi[]>();
  for (const creneau of creneaux) {
    const cle = new Date(creneau.starts_at).toLocaleDateString('en-CA', { timeZone: timezone });
    const liste = jours.get(cle);
    if (liste) liste.push(creneau);
    else jours.set(cle, [creneau]);
  }
  return jours;
}

function heureLocale(iso: string, timezone: string): number {
  return Number(
    new Date(iso).toLocaleString('en-US', { timeZone: timezone, hour: '2-digit', hour12: false }),
  );
}

export function CreneauxScreen({
  fiche,
  offre,
  onReserve,
  onRetour,
}: {
  fiche: FichePublique;
  offre: OffreDeLaFiche;
  onReserve: (bookingId: string) => void;
  /** Le retour de la pile. Sur le web il n'y a ni geste ni bouton système :
   * sans lui, on ne quitte l'écran qu'en changeant d'onglet. */
  onRetour?: () => void;
}) {
  const { api, messageDErreur } = useApi();
  const { t, locale } = useI18n();
  const { color: c, density } = useTheme();

  const [jourChoisi, setJourChoisi] = useState<string | null>(null);
  const [choisi, setChoisi] = useState<string | undefined>();
  const [envoi, setEnvoi] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);

  const requete = useRequete<CreneauApi[]>(
    (signal) => api.disponibilite(fiche.business_id, offre.catalog_item_id, signal),
    { estVide: (creneaux) => creneaux.length === 0, dependances: [offre.catalog_item_id] },
  );

  const creneaux = requete.etat === 'pret' ? requete.donnees : [];

  const groupes = useMemo(() => parJour(creneaux, fiche.timezone), [creneaux, fiche.timezone]);

  const jours: Jour[] = useMemo(
    () =>
      [...groupes.keys()]
        .sort()
        .slice(0, JOURS_VISIBLES)
        .map((cle) => {
          // `cle` est une date nue ; on la lit à midi UTC pour que le nom du
          // jour ne bascule pas d'un fuseau à l'autre.
          const date = new Date(`${cle}T12:00:00Z`);
          return {
            cle,
            jourCourt: date.toLocaleDateString(locale, { weekday: 'short' }),
            numero: String(date.getUTCDate()),
            disponible: (groupes.get(cle) ?? []).some((x) => x.places_restantes > 0),
          };
        }),
    [groupes, locale],
  );

  // Le premier jour qui a encore une place. Ouvrir sur un jour complet
  // demanderait un geste avant de voir quoi que ce soit.
  const jour = jourChoisi ?? jours.find((j) => j.disponible)?.cle ?? jours[0]?.cle ?? null;
  const duJour = jour ? (groupes.get(jour) ?? []) : [];

  const matin = duJour.filter((x) => heureLocale(x.starts_at, fiche.timezone) < MIDI);
  const apresMidi = duJour.filter((x) => heureLocale(x.starts_at, fiche.timezone) >= MIDI);

  async function reserver() {
    if (!offre.social_account_id) return;
    setEnvoi(true);
    setEchec(null);
    try {
      const booking = await api.reserver({
        tier_offer_id: offre.tier_offer_id,
        social_account_id: offre.social_account_id,
        starts_at: offre.requires_booking ? choisi : null,
      });
      await api.confirmerLaReservation(booking.id);
      onReserve(booking.id);
    } catch (erreur) {
      setEchec(messageDErreur(erreur));
      // La place a peut-être été prise pendant l'hésitation : on relit.
      setChoisi(undefined);
      requete.recharger();
    } finally {
      setEnvoi(false);
    }
  }

  const pretAReserver = Boolean(choisi) || !offre.requires_booking;

  return (
    <View style={{ flex: 1, backgroundColor: c['bg.canvas'] }} testID="ecran-creneaux">
      <Ecran
      onRetour={onRetour}
        requete={requete}
        titre={t('parcours.creneauxTitre')}
        vide={<EmptyState title={t('parcours.creneauxTitre')} body={t('parcours.creneauxVide')} />}
      >
        {() => (
          <View style={{ gap: 16 }}>
            <Texte variante="type.heading">{offre.name}</Texte>

            <DayPicker
              testID="jours"
              jours={jours}
              selection={jour ?? ''}
              onChange={(cle) => {
                setJourChoisi(cle);
                // Le créneau choisi appartenait au jour précédent : le garder
                // ferait confirmer une heure qu'on ne voit plus.
                setChoisi(undefined);
              }}
            />

            <Groupe
              titre={t('parcours.creneauxMatin')}
              creneaux={matin}
              timezone={fiche.timezone}
              selection={choisi}
              onChange={setChoisi}
              testID="matin"
            />
            <Groupe
              titre={t('parcours.creneauxApresMidi')}
              creneaux={apresMidi}
              timezone={fiche.timezone}
              selection={choisi}
              onChange={setChoisi}
              testID="apres-midi"
            />

            {duJour.length === 0 ? (
              <Texte variante="type.caption" couleur="text.secondary" testID="jour-vide">
                {t('parcours.creneauxJourVide')}
              </Texte>
            ) : null}

            {echec ? (
              <StatusMessage level="danger" body={echec} testID="echec-reservation" />
            ) : null}
          </View>
        )}
      </Ecran>

      {/* Fixé sous la liste, hors du défilement. Retiré tant qu'aucun créneau
          n'est choisi : le griser demanderait de deviner ce qui manque. */}
      {requete.etat === 'pret' && pretAReserver ? (
        <View
          testID="barre-de-confirmation"
          style={{
            padding: density.screenPadding,
            paddingTop: 12,
            borderTopWidth: 1,
            borderTopColor: c['border.subtle'],
            backgroundColor: c['bg.surface'],
          }}
        >
          <Button
            label={t('parcours.confirmer')}
            size="lg"
            loading={envoi}
            onPress={reserver}
            testID="confirmer"
          />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Un groupe d'heures, matin ou après-midi.
 *
 * Absent quand il est vide plutôt que rendu avec un titre seul : un intitulé
 * « Après-midi » suivi de rien laisse croire à un chargement inachevé.
 */
function Groupe({
  titre,
  creneaux,
  timezone,
  selection,
  onChange,
  testID,
}: {
  titre: string;
  creneaux: CreneauApi[];
  timezone: string;
  selection: string | undefined;
  onChange: (cle: string) => void;
  testID: string;
}) {
  if (creneaux.length === 0) return null;

  return (
    <View style={{ gap: 8 }} testID={testID}>
      <Texte variante="type.label" couleur="text.secondary">
        {titre}
      </Texte>
      <SlotPicker
        creneaux={creneaux.map((creneau) => ({
          cle: creneau.starts_at,
          heure: new Date(creneau.starts_at).toLocaleTimeString([], {
            timeZone: timezone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }),
          pris: creneau.places_restantes <= 0,
        }))}
        selection={selection}
        onChange={onChange}
      />
    </View>
  );
}
