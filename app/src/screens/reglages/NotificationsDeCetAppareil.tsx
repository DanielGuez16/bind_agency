/**
 * Les notifications de cet appareil, et le geste qui les coupe.
 *
 * **Une capacité de sécurité qui n'avait pas d'écran.** `revoquerUnTerminal`
 * existait, documentée, appelant la bonne route — et personne ne l'appelait. La
 * garde des méthodes sans appelant la portait, nommée.
 *
 * **Couper ici coupe *ici*, et l'écran ne prétend pas autre chose.** Révoquer un
 * jeton exige de le posséder, et on ne le possède que sur l'appareil qui l'a
 * obtenu. Couper les notifications d'un téléphone perdu depuis un autre demande
 * de les énumérer, et aucune route ne liste les terminaux. La phrase le dit
 * plutôt que de laisser croire — quelqu'un qui vient de perdre son téléphone est
 * la dernière personne à qui l'on doit une demi-vérité.
 *
 * **Et le refus tient au relancement.** Le jeton se réenregistre à chaque
 * session ; sans mémoire du choix, le geste s'annulerait tout seul.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { useApi } from '../../api';
import { Button, StatusMessage, Texte, Toggle } from '../../components';
import { useI18n } from '../../i18n';
import {
  noterLeRefus,
  refuseesSurCetAppareil,
} from '../../shell/notificationsDeCetAppareil';
import { enregistrerCeTerminal, jetonDeCetAppareil } from '../../shell/useNotificationsPush';

export function NotificationsDeCetAppareil() {
  const { api, messageDErreur } = useApi();
  const { t } = useI18n();
  const [refusees, setRefusees] = useState<boolean | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);

  useEffect(() => {
    let vivant = true;
    void refuseesSurCetAppareil().then((valeur) => {
      if (vivant) setRefusees(valeur);
    });
    return () => {
      vivant = false;
    };
  }, []);

  // Tant qu'on ne sait pas, on ne propose rien : un interrupteur qui part du
  // mauvais côté se lit comme un réglage qu'on n'a pas fait.
  if (refusees === null) return null;

  async function basculer(couper: boolean) {
    setEchec(null);
    setEnvoi(true);
    try {
      if (couper) {
        // **Le serveur d'abord, la mémoire ensuite.** Si la révocation échoue,
        // noter le refus ferait croire que c'est coupé alors que le serveur
        // continue d'envoyer.
        const jeton = await jetonDeCetAppareil();
        if (jeton) await api.revoquerUnTerminal(jeton);
        await noterLeRefus(true);
      } else {
        await noterLeRefus(false);
        await enregistrerCeTerminal(api);
      }
      setRefusees(couper);
    } catch (erreur) {
      setEchec(messageDErreur(erreur));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <View style={{ gap: 10 }} testID="notifications-de-cet-appareil">
      <Texte variante="type.label" couleur="ink.soft">
        {t('reglages.notificationsTitre')}
      </Texte>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <Texte variante="type.body" style={{ flex: 1 }}>
          {t('reglages.notificationsSurCetAppareil')}
        </Texte>
        <Toggle
          value={!refusees}
          onChange={(actives: boolean) => void basculer(!actives)}
          accessibilityLabel={t('reglages.notificationsSurCetAppareil')}
          disabled={envoi}
          testID="notifications-actives"
        />
      </View>

      {/* **Ce que le geste ne fait pas, dit là où on le fait.** Quelqu'un qui
          cherche à couper un téléphone perdu doit l'apprendre ici, pas après
          avoir cru que c'était réglé. */}
      <Texte variante="type.caption" couleur="ink.soft" testID="notifications-portee">
        {t('reglages.notificationsPortee')}
      </Texte>

      {echec ? <StatusMessage level="danger" body={echec} testID="echec-notifications" /> : null}
    </View>
  );
}
