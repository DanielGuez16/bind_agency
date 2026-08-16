/**
 * Les sept genres de notification, et leur interrupteur.
 *
 * **Toutes les lignes du rôle, toujours**, y compris celles que personne n'a touchées. La
 * réponse du serveur les porte toutes : un écran qui ne dessinerait que les
 * refus stockés serait vide pour tout le monde le premier jour, et laisserait
 * croire qu'il n'y a rien à régler.
 *
 * **Le genre qui ne concerne pas le rôle n'apparaît pas.** « Une réservation
 * attend votre décision » ne veut rien dire pour un créateur, et les six du
 * créateur ne veulent rien dire pour un salon. Le serveur les rend tous — il ne connaît
 * pas l'écran — et c'est ici qu'on choisit lesquels montrer. Un interrupteur
 * qui ne commande rien est pire qu'un interrupteur absent.
 *
 * **Chaque bascule part seule et se corrige seule.** Un bouton « enregistrer »
 * pour sept interrupteurs ferait perdre six réglages quand le septième échoue.
 * En cas de refus du serveur, l'interrupteur revient où il était et le dit.
 */
import { useState } from 'react';
import { View } from 'react-native';

import {
  useApi,
  type GenreDeNotification,
  type PreferencesDeNotification as Vue,
} from '../api';
import { SkeletonBox, StatusMessage, Texte, Toggle } from '../components';
import { useI18n } from '../i18n';
import { useRequete } from './useRequete';

/**
 * Qui voit quel genre.
 *
 * Les trois derniers ne remontent que vers le commerce ; les six autres ne
 * descendent que vers le créateur. L'administration ne reçoit rien : elle
 * travaille sur une file, pas sur des événements qui la concernent
 * personnellement.
 */
const GENRES_PAR_ROLE: Record<string, GenreDeNotification[]> = {
  creator: [
    'booking_approved',
    'booking_declined',
    'booking_cancelled_by_business',
    'publication_reminder',
    'publication_approved',
    'publication_resubmit',
    'collaboration_opened',
    'collaboration_unfulfilled',
  ],
  business_member: [
    'booking_to_review',
    'subscription_grace_ending',
    'subscription_ended',
    'support_access_started',
  ],
  admin: [],
};

export function PreferencesDeNotification({ role }: { role: string }) {
  const { api, messageDErreur } = useApi();
  const { t } = useI18n();
  const [echec, setEchec] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<GenreDeNotification | null>(null);

  const genres = GENRES_PAR_ROLE[role] ?? [];

  const requete = useRequete<Vue>((signal) => api.mesPreferencesDeNotification(signal), {
    estVide: () => false,
    actif: genres.length > 0,
  });

  // L'état affiché suit la réponse du serveur, et l'optimisme est local : on
  // bascule tout de suite — un interrupteur qui attend un aller-retour se
  // presse deux fois — puis on remet en place si le serveur refuse.
  const [local, setLocal] = useState<Partial<Record<GenreDeNotification, boolean>>>({});

  if (genres.length === 0) return null;

  /**
   * L'état d'un interrupteur, **une fois la réponse là** : le local d'abord,
   * la réponse ensuite, « oui » à défaut.
   *
   * **Lu prudemment, jusqu'au champ.** Une réponse sans `preferences` faisait
   * tomber l'écran entier — et un écran de réglages qui plante emporte la
   * langue et le thème avec lui. « Oui » est aussi le défaut du serveur : une
   * préférence absente vaut accord, ici comme là-bas.
   *
   * **Ce défaut ne vaut que pour une préférence absente d'une réponse reçue.**
   * Il servait aussi tant qu'aucune réponse n'était arrivée : les sept
   * interrupteurs s'affichaient alors sur « activé », c'est-à-dire un état
   * inventé montré comme un fait. Quelqu'un qui en coupait un à cet instant
   * n'avait aucun moyen de savoir qu'il coupait peut-être ce qui était déjà
   * coupé — et l'écran redessinait sous ses doigts quand la réponse arrivait.
   * Une valeur qu'on ne connaît pas ne se devine pas, elle s'attend.
   *
   * Elle n'est appelée que depuis la branche `pret` — l'interrupteur n'existe
   * pas avant, et `basculer` ne part que d'un interrupteur.
   */
  const recues = requete.etat === 'pret' ? requete.donnees : null;
  const etat = (genre: GenreDeNotification): boolean =>
    local[genre] ?? recues?.preferences?.[genre] ?? true;

  async function basculer(genre: GenreDeNotification) {
    const voulu = !etat(genre);
    setLocal((avant) => ({ ...avant, [genre]: voulu }));
    setEchec(null);
    setEnCours(genre);
    try {
      await api.reglerUnePreference(genre, voulu);
    } catch (erreur) {
      // Remis où il était : laisser l'interrupteur sur une valeur que le
      // serveur ignore ferait croire à un réglage qui n'existe pas.
      setLocal((avant) => ({ ...avant, [genre]: !voulu }));
      setEchec(messageDErreur(erreur));
    } finally {
      setEnCours(null);
    }
  }

  return (
    <View style={{ gap: 8 }} testID="preferences-de-notification">
      <Texte variante="type.label" couleur="ink.soft">
        {t('reglages.notifications')}
      </Texte>
      <Texte variante="type.caption" couleur="ink.mute">
        {t('reglages.notificationsAide')}
      </Texte>

      {echec ? <StatusMessage level="danger" body={echec} testID="echec-preference" /> : null}

      {genres.map((genre, rang) => (
        <View
          key={genre}
          testID={`preference-${genre}`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            minHeight: 44,
          }}
        >
          <Texte style={{ flex: 1 }}>{t(`notifications.${genre}`)}</Texte>
          {requete.etat === 'pret' ? (
            <Toggle
              value={etat(genre)}
              disabled={enCours === genre}
              onChange={() => void basculer(genre)}
              accessibilityLabel={t(`notifications.${genre}`)}
              testID={`bascule-${genre}`}
            />
          ) : (
            // **Une silhouette à la place d'une valeur.** Aux dimensions exactes
            // de l'interrupteur — 40 × 22 — pour que rien ne se déplace quand la
            // réponse arrive. Le libellé, lui, reste : il ne dépend d'aucune
            // réponse, et le faire disparaître ferait clignoter tout le bloc.
            <SkeletonBox
              width={40}
              height={22}
              rayon={11}
              decalage={rang * 60}
              testID={`bascule-en-attente-${genre}`}
            />
          )}
        </View>
      ))}

      {/* Une réponse qui n'arrive pas se dit. Sans cela l'écran garderait ses
          silhouettes indéfiniment, ce qui se lit comme une page qui n'a pas
          fini de charger — alors qu'elle a fini, et qu'elle a échoué. */}
      {requete.etat === 'erreur' ? (
        <StatusMessage
          level="warning"
          body={messageDErreur(requete.erreur)}
          action={{
            label: t('common.retry'),
            onPress: requete.recharger,
            variant: 'secondary',
          }}
          testID="preferences-illisibles"
        />
      ) : null}
    </View>
  );
}
