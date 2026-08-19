/**
 * 05a · Choix du créneau, 05b · confirmation.
 *
 * **Une bande de quatorze jours, pas une grille de trente.** La grille serait
 * vide aux trois quarts, et un calendrier vide ne dit pas « tu regardes trop
 * loin », il dit « ce salon n'a rien ». À 64 points, chaque jour porte son
 * compte de créneaux ou le mot qui dit qu'il n'y en a pas : on choisit sans
 * ouvrir.
 *
 * **Les jours sans place gardent leur place.** La version précédente listait
 * les jours **qui avaient des créneaux** : un salon fermé le jeudi voyait son
 * jeudi disparaître, et la bande passait du mercredi au vendredi sans rien
 * dire. Ils se sélectionnent, et répondent — ils disent ce qu'ils ont à dire,
 * puis proposent les deux jours ouverts les plus proches. Refuser l'appui sans
 * rien dire était l'autre façon de les faire disparaître.
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
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import {
  useApi,
  type Creneau as CreneauApi,
  type FichePublique,
  type JourDeDisponibilite,
  type OffreDeLaFiche,
} from '../api';
import {
  Button,
  EmptyState,
  SkeletonGrille,
  SlotPicker,
  StatusMessage,
  Texte,
  vibration,
} from '../components';
import { formatNumber } from '../format';
import { useI18n } from '../i18n';
import { Ecran } from './Ecran';
import { useRequete } from './useRequete';
import { radius, useTheme } from '../theme';
import { BandeDeJours } from './creneau/BandeDeJours';
import {
  etatDuJour,
  JOURS_DE_LA_BANDE,
  joursProches,
  premierJourUtile,
} from './creneau/bande';

/** Ce qui sépare le matin de l'après-midi, dans le fuseau du commerce. */
const MIDI = 12;

type Jour = { cle: string; jourCourt: string; numero: string; disponible: boolean };

/**
 * **Le regroupement par journée a quitté ce fichier.** Il classait les départs
 * sur le fuseau du commerce — un créneau de 23 h à Miami tombe le lendemain en
 * UTC — et c'était juste, mais c'était au serveur de le faire : lui seul sait
 * distinguer un jour fermé d'un jour complet, et il fallait de toute façon
 * qu'il rende les journées entières pour ça.
 */

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
  const [feuilleOuverte, setFeuilleOuverte] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);

  /**
   * **Deux lectures, et elles ne demandent pas la même chose.** La bande veut
   * un état et un compte par journée — quatorze lignes. Les heures du jour
   * choisi veulent les instants. Les fondre dans une seule route ferait payer
   * le parcours complet des règles de capacité pour dessiner des chiffres.
   *
   * Elles partent ensemble : l'écran n'a rien à montrer sans les deux, et les
   * enchaîner doublerait l'attente sur le geste le plus fréquent du parcours.
   */
  const requete = useRequete<{ bande: JourDeDisponibilite[]; creneaux: CreneauApi[] }>(
    async (signal) => {
      const [bande, creneaux] = await Promise.all([
        api.resumeDeLaBande(fiche.business_id, offre.catalog_item_id, JOURS_DE_LA_BANDE, signal),
        api.disponibilite(fiche.business_id, offre.catalog_item_id, signal, JOURS_DE_LA_BANDE),
      ]);
      return { bande, creneaux };
    },
    // **Vide veut dire « cet item ne se propose plus »**, jamais « aucune
    // place ». La bande rend toujours ses quatorze journées, fermées comprises.
    { estVide: ({ bande }) => bande.length === 0, dependances: [offre.catalog_item_id] },
  );

  const jours = requete.etat === 'pret' ? requete.donnees.bande : [];
  const creneaux = requete.etat === 'pret' ? requete.donnees.creneaux : [];

  const jour = jourChoisi ?? premierJourUtile(jours);
  const jourCourant = jours.find((j) => j.jour === jour) ?? null;
  // Les heures du jour choisi, prises dans la liste complète. Le regroupement
  // se fait sur la date **locale du commerce** : un créneau de 23 h à Miami
  // tombe le lendemain en UTC, et le classer sur la date brute le placerait un
  // jour trop loin.
  const duJour = jour
    ? creneaux.filter(
        (creneau) =>
          new Intl.DateTimeFormat('en-CA', {
            timeZone: fiche.timezone,
            dateStyle: 'short',
          }).format(new Date(creneau.starts_at)) === jour,
      )
    : [];

  const matin = duJour.filter((x) => heureLocale(x.starts_at, fiche.timezone) < MIDI);
  const apresMidi = duJour.filter((x) => heureLocale(x.starts_at, fiche.timezone) >= MIDI);

  /**
   * Choisir un créneau, avec le cran qui va avec.
   *
   * **Le geste central du parcours créateur, et il ne renvoyait rien.** Le
   * doigt appuyait, la pastille ne changeait de couleur qu'au rendu suivant, et
   * rien dans la main ne disait que le choix était pris. `action` est le même
   * retour que celui des envois : léger, une fois, jamais une célébration.
   */
  function choisir(cle: string | undefined) {
    vibration.action();
    setChoisi(cle);
  }

  async function reserver() {
    if (!offre.social_account_id) return;
    setEnvoi(true);
    setEchec(null);
    // Le seul geste de tout le parcours qui engage la créatrice auprès d'un
    // salon : il se sent, et son issue se sent aussi.
    vibration.action();
    try {
      const booking = await api.reserver({
        tier_offer_id: offre.tier_offer_id,
        social_account_id: offre.social_account_id,
        starts_at: offre.requires_booking ? choisi : null,
      });
      await api.confirmerLaReservation(booking.id);
      vibration.reussite();
      onReserve(booking.id);
    } catch (erreur) {
      vibration.echec();
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
    <View style={{ flex: 1, backgroundColor: c['bg.page'] }} testID="ecran-creneaux">
      <Ecran
      onRetour={onRetour}
        requete={requete}
        titre={t('parcours.creneauxTitre')}
        vide={<EmptyState title={t('parcours.creneauxTitre')} body={t('parcours.creneauxVide')} />}
        squelette={<SkeletonGrille testID="squelette-creneaux" />}
      >
        {() => (
          <View style={{ gap: 16 }}>
            <Texte variante="type.bodyStrong">{offre.name}</Texte>

            <BandeDeJours
              jours={jours}
              selection={jour}
              onChoisir={(cle: string) => {
                setJourChoisi(cle);
                // Le créneau choisi appartenait au jour précédent : le garder
                // ferait confirmer une heure qu'on ne voit plus.
                setChoisi(undefined);
              }}
              onToutesLesDates={() => setFeuilleOuverte(true)}
              testID="jours"
            />

            {jourCourant && etatDuJour(jourCourant) !== 'ouvert' ? (
              <JourSansPlace
                jour={jourCourant}
                proches={joursProches(jours, jourCourant.jour)}
                nomDuSalon={fiche.name}
                onChoisir={(cle: string) => {
                  setJourChoisi(cle);
                  setChoisi(undefined);
                }}
              />
            ) : null}

            <Groupe
              titre={t('parcours.creneauxMatin')}
              creneaux={matin}
              timezone={fiche.timezone}
              selection={choisi}
              onChange={choisir}
              testID="matin"
            />
            <Groupe
              titre={t('parcours.creneauxApresMidi')}
              creneaux={apresMidi}
              timezone={fiche.timezone}
              selection={choisi}
              onChange={choisir}
              testID="apres-midi"
            />

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
            borderTopColor: c['line.default'],
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
      <Texte variante="type.label" couleur="ink.soft">
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

/**
 * Un jour sans place, qui répond au lieu de refuser l'appui.
 *
 * **C'est la moitié de la correction que la planche demande.** Un jour grisé et
 * inerte fait deviner pourquoi ; il disparaît de l'écran sans quitter la bande.
 * Celui-ci dit ce qu'il sait, puis propose les deux jours ouverts les plus
 * proches — un geste au lieu d'un retour en arrière.
 *
 * **Il ne dit pas « fermé », et c'est délibéré.** La planche distingue « ouvert
 * mais complet » de « fermé », et elle a raison de le faire : les deux mots ne
 * sont pas interchangeables. Le serveur ne rend que les créneaux **libres**, et
 * leur absence ne dit pas sa cause. Écrire l'un des deux serait affirmer ce
 * qu'on ne sait pas — annoncer un salon fermé qui ouvre est exactement la
 * classe de défaut que ce dépôt poursuit. La phrase employée est vraie des deux
 * cas, et elle se scindera le jour où l'état du jour sera servi.
 */
function JourSansPlace({
  jour,
  proches,
  nomDuSalon,
  onChoisir,
}: {
  jour: JourDeDisponibilite;
  proches: JourDeDisponibilite[];
  nomDuSalon: string;
  onChoisir: (cle: string) => void;
}) {
  const { t, locale } = useI18n();
  const { color: c } = useTheme();
  const etat = etatDuJour(jour);

  const nomDuJour = (cle: string) =>
    new Date(`${cle}T12:00:00Z`).toLocaleDateString(locale, {
      weekday: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    });

  return (
    <View
      testID="jour-sans-place"
      style={{
        borderRadius: radius['radius.lg'],
        backgroundColor: c['bg.surface'],
        borderWidth: 1,
        borderColor: c['line.default'],
        padding: 20,
        gap: 14,
      }}
    >
      <View style={{ gap: 6 }}>
        {/* **Une phrase par état, et c'est le cœur de la correction.**
            « Fermé » n'est pas « complet », et « écoulé » n'est ni l'un ni
            l'autre : à 20 h, aujourd'hui n'a plus de créneau sans que le salon
            ait été pris d'assaut, et lire « complet » ferait renoncer quelqu'un
            qui devrait revenir demain matin. */}
        <Texte variante="type.section" testID={`sans-place-${etat}`}>
          {t(`parcours.creneauxSansPlaceTitre.${etat}`, { jour: nomDuJour(jour.jour) })}
        </Texte>
        <Texte variante="type.body" couleur="ink.soft">
          {t(`parcours.creneauxSansPlaceCorps.${etat}`, {
            salon: nomDuSalon,
            jour: nomDuJour(jour.jour),
          })}
        </Texte>
      </View>

      {/* **Les propositions n'existent que s'il y en a.** Une rangée de boutons
          vide sous « aucune place » serait une promesse de plus qui ne mène
          nulle part, sur l'écran qui vient précisément d'en refuser une. */}
      {proches.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {proches.map((proche, rang) => (
            <Button
              key={proche.jour}
              label={nomDuJour(proche.jour)}
              // Le plus proche porte l'aplat, le second le contour : deux
              // aplats côte à côte demanderaient de choisir entre deux
              // recommandations, alors qu'il n'y en a qu'une.
              variant={rang === 0 ? 'primary' : 'secondary'}
              fullWidth={false}
              onPress={() => onChoisir(proche.jour)}
              testID={`proche-${proche.jour}`}
            />
          ))}
        </View>
      ) : (
        <Texte variante="type.caption" couleur="ink.mute" testID="aucun-jour-proche">
          {t('parcours.creneauxAucunJourProche', {
            count: formatNumber(JOURS_DE_LA_BANDE, locale),
          })}
        </Texte>
      )}
    </View>
  );
}
