import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';

import { useApi, type ReservationDuCreateur } from '../../api';
import { Button, Texte } from '../../components';
import { useI18n } from '../../i18n';
import { formatDateTime, formatHeure } from '../../format';
import { elevationDeCarte, radius, useColors } from '../../theme';
import { delaiAvantLeCreneau, porteeDeLAnnulation } from './annulation';

/**
 * Annuler une réservation, et le dire de la manière qui fait annuler.
 *
 * **La formulation est le sujet, pas le mécanisme.** Passé la fenêtre, annuler
 * et ne pas venir coûtent la même chose au score. Le score ne départage donc
 * rien, et le mentionner ne fait qu'une chose : donner à croire qu'on peut
 * encore l'éviter. Ce qui diffère est ailleurs — **la place repart, et le salon
 * sait**. Un salon prévenu à 11 h peut remplir 14 h 30 ; un salon qui l'apprend
 * à 14 h 45 a perdu son créneau et son après-midi.
 *
 * Donc jamais « annuler coûtera à ton score ». Toujours « ça compte comme une
 * absence, mais le salon peut encore donner ta place ». Les deux phrases
 * décrivent exactement les mêmes conséquences ; la première fait renoncer, la
 * seconde fait annuler. La version précédente de cet écran écrivait la
 * première.
 *
 * **Trois règles, et elles sont vérifiées par les tests.**
 *
 * Le coût ne se chiffre jamais : « tu perdras huit points » transforme une
 * décision en calcul, et un calcul se reporte à demain. Le score se dit en
 * mots, et sa mécanique reste sur l'écran qui l'explique.
 *
 * La réversibilité s'écrit. Le score est gradué et réparable depuis la v0.7 :
 * une conséquence définitive fait fuir, une conséquence qui se répare fait
 * agir.
 *
 * **Le bouton reste au même endroit à toute heure**, de la même forme, à la
 * même distance du pouce — y compris cinq minutes avant. Rendre l'annulation
 * difficile ne produit pas des présences, ça produit des absences
 * silencieuses. Il n'y a donc pas de bouton grisé ici, et il n'y en aura pas.
 *
 * **La fenêtre se nomme par une heure, jamais par une durée.** « Jusqu'à
 * 11:00 » se vérifie d'un coup d'œil ; « 24 h avant » demande un calcul.
 * L'instant vient du serveur : le seuil est un réglage, et un écran qui le
 * déduirait d'une horloge locale fausse annoncerait « gratuit » sur une
 * annulation qui coûte.
 *
 * **Ce qui manque encore, et qui est de produit.** Si une annulation tardive et
 * une absence coûtent exactement la même chose, rien n'incite à prévenir
 * plutôt qu'à disparaître — sauf la bonne volonté, qui n'est pas un mécanisme.
 * La décision est prise : une annulation tardive coûtera moins. Le jour où le
 * service la porte, elle s'écrit ici en une ligne de plus, et c'est la seule
 * incitation réelle à prévenir. Voir `TASKS.md`.
 */
export function AnnulerLaReservation({
  reservation,
  onAnnulee,
}: {
  reservation: ReservationDuCreateur;
  onAnnulee: () => void;
}) {
  const { api, messageDErreur } = useApi();
  const { t, locale } = useI18n();
  const c = useColors();
  const [feuille, setFeuille] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);

  const portee = porteeDeLAnnulation(reservation);
  if (portee === 'close') return null;

  const echeance = reservation.annulation_sans_frais_jusqu_a;
  const heureLimite = echeance
    ? formatHeure(echeance, locale, reservation.business_timezone)
    : null;

  async function annuler() {
    setEchec(null);
    setEnvoi(true);
    try {
      await api.annulerLaReservation(reservation.booking_id);
      setFeuille(false);
      onAnnulee();
    } catch (erreur) {
      setEchec(messageDErreur(erreur));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <>
      {/* **La ligne change, le bouton non.** Ce qui distingue les deux états
          est une ligne de texte ; le bouton garde sa forme, sa place et sa
          distance au pouce. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          {portee === 'dans-la-fenetre' && heureLimite ? (
            <Texte
              variante="type.caption"
              couleur="ink.soft"
              testID={`annuler-fenetre-${reservation.booking_id}`}
            >
              {t('parcours.annulerLibreJusqua', { heure: heureLimite })}
            </Texte>
          ) : portee === 'passe-la-fenetre' && heureLimite ? (
            // **Un fait au passé, sans conséquence annoncée.** « La fenêtre
            // s'est fermée à 11:00 » dit ce qui est ; la conséquence appartient
            // à la feuille, où la comparaison avec l'alternative existe.
            <Texte
              variante="type.caption"
              couleur="ink.soft"
              testID={`annuler-fenetre-${reservation.booking_id}`}
            >
              {t('parcours.annulerFenetreClose', { heure: heureLimite })}
            </Texte>
          ) : null}
        </View>

        <Button
          label={t('parcours.annuler')}
          size="sm"
          variant="secondary"
          fullWidth={false}
          onPress={() => setFeuille(true)}
          testID={`annuler-${reservation.booking_id}`}
        />
      </View>

      <Modal
        visible={feuille}
        transparent
        animationType="slide"
        onRequestClose={() => setFeuille(false)}
      >
        {/* **Par-dessus la réservation qu'elle annule**, et non sur un écran à
            part : la carte reste visible derrière, et la feuille nomme le
            rendez-vous. On annule quelque chose qu'on a sous les yeux. */}
        <Pressable
          testID="voile-de-la-feuille"
          style={{ flex: 1, backgroundColor: c['scrim.modal'] }}
          accessibilityLabel={t('parcours.annulerGarder')}
          onPress={() => setFeuille(false)}
        />
        <View
          testID={`feuille-annulation-${reservation.booking_id}`}
          style={{
            backgroundColor: c['bg.surface'],
            borderTopLeftRadius: radius['radius.lg'],
            borderTopRightRadius: radius['radius.lg'],
            padding: 20,
            gap: 16,
            // La feuille porte l'ombre des cartes, comme les douze autres
            // surfaces du produit. Au bord haut, elle la détache du voile —
            // et la règle des rayons ne souffre pas d'exception par écran.
            ...elevationDeCarte(),
          }}
        >
          <View style={{ gap: 6 }}>
            <Texte variante="type.screenTitle">
              {t('parcours.annulerTitre', {
                // Le jour **et** l'heure : « annuler 14:30 ? » ne situe rien
                // sur un écran qui liste plusieurs rendez-vous. Sans créneau,
                // c'est la prestation qui nomme — il n'y a pas d'heure.
                quand: reservation.starts_at
                  ? formatDateTime(reservation.starts_at, locale, reservation.business_timezone)
                  : reservation.item_name,
              })}
            </Texte>

            {/* **Le coût comparé à l'alternative, jamais seul.** Dit seul il
                fait renoncer ; mis en face de « ne pas venir » il fait
                annuler — et l'alternative est toujours pire, ce qui est
                précisément la vérité qu'une mise en garde cache. */}
            <Texte
              variante="type.body"
              couleur="ink.soft"
              testID={`annulation-consequence-${reservation.booking_id}`}
            >
              {portee === 'passe-la-fenetre' || portee === 'sans-echeance'
                ? t('parcours.annulerCommeUneAbsence', { salon: reservation.business_name })
                : t('parcours.annulerRienARetenir', { salon: reservation.business_name })}
            </Texte>
          </View>

          {portee === 'passe-la-fenetre' || portee === 'sans-echeance' ? (
            <View
              testID={`annulation-vaut-mieux-${reservation.booking_id}`}
              style={{
                gap: 6,
                padding: 16,
                paddingLeft: 13,
                borderRadius: radius['radius.lg'],
                backgroundColor: c['bg.inset'],
                borderLeftWidth: 3,
                borderLeftColor: c['line.solo'],
              }}
            >
              <Texte variante="type.bodyStrong">{t('parcours.annulerVautMieux')}</Texte>
              <Texte variante="type.body" couleur="ink.soft">
                {/* **Le seul nombre de l'écran, et ce n'est pas le coût.** Il
                    dit ce que prévenir donne au salon. Rendu comme un fait —
                    « ça leur laisse trois heures » — et non comme une promesse
                    de remplissage, qui serait fausse à cinq minutes. */}
                {[
                  ceQueCaLeurLaisse(reservation, t),
                  t('parcours.annulerFiabiliteRemonte'),
                ]
                  .filter(Boolean)
                  .join(' ')}
              </Texte>
            </View>
          ) : null}

          {echec ? (
            <Texte
              variante="type.caption"
              couleur="status.danger.text"
              testID={`annulation-echec-${reservation.booking_id}`}
            >
              {echec}
            </Texte>
          ) : null}

          <View style={{ gap: 10 }}>
            {/* **« et prévenir Vela ».** C'est un geste envers quelqu'un, pas
                un renoncement — et c'est le nom du bouton qui le dit. */}
            <Button
              label={t('parcours.annulerEtPrevenir', { salon: reservation.business_name })}
              loading={envoi}
              onPress={() => void annuler()}
              testID={`annuler-oui-${reservation.booking_id}`}
            />
            <Button
              label={t('parcours.annulerGarder')}
              variant="secondary"
              onPress={() => {
                setFeuille(false);
                setEchec(null);
              }}
              testID={`annuler-non-${reservation.booking_id}`}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

/**
 * « Ça leur laisse trois heures pour la remplir. »
 *
 * Nul quand le créneau est passé ou illisible : une phrase qui annonce un délai
 * négatif ferait douter du reste, et le titre du bloc — « les prévenir
 * maintenant vaut mieux que ne pas venir » — reste vrai sans elle.
 */
function ceQueCaLeurLaisse(
  reservation: ReservationDuCreateur,
  t: (cle: string, valeurs?: Record<string, string>) => string,
): string | null {
  const delai = delaiAvantLeCreneau(reservation.starts_at);
  if (delai === null) return null;

  // Deux branches écrites à la main. `formaterLesNombres` rend `count` en
  // chaîne, et la pluralisation de la bibliothèque ne se déclenche donc jamais.
  const duree =
    delai.heures === 0
      ? t('parcours.dureeMinutes', { n: String(delai.minutes) })
      : t('parcours.dureeHeuresMinutes', {
          h: String(delai.heures),
          m: String(delai.minutes),
        });

  return t('parcours.annulerCaLeurLaisse', { duree });
}
