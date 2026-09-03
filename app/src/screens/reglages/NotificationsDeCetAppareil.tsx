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
import { pushDisponible } from '../../shell/pushDisponible';
import type { IssueDuJeton } from '../../shell/useNotificationsPush';
import { enregistrerCeTerminal, jetonDeCetAppareil } from '../../shell/useNotificationsPush';

/**
 * Ce qu'on dit de chaque issue qui n'a rien enregistré.
 *
 * Dérivée d'`IssueDuJeton` plutôt qu'écrite à côté : une issue ajoutée au hook
 * sans sa phrase ne compilerait pas, là où un `Record<string, string>` l'aurait
 * laissée passer et rendu un interrupteur muet.
 */
const MESSAGE_DE_L_ECHEC: Record<Exclude<IssueDuJeton['issue'], 'enregistre'>, string> = {
  refusee: 'reglages.notificationsEchecRefusee',
  indisponible: 'reglages.notificationsEchecIndisponible',
  // **Ne devrait pas arriver** — on vient d'effacer le refus local — mais le
  // type l'inclut, et une panne d'écriture du stockage le rendrait possible.
  // « Réessayez » est alors la seule phrase honnête.
  'refusee-ici': 'reglages.notificationsEchecEnvoi',
  echec: 'reglages.notificationsEchecEnvoi',
};

export function NotificationsDeCetAppareil() {
  const { api, messageDErreur } = useApi();
  const { t } = useI18n();
  const [refusees, setRefusees] = useState<boolean | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);

  /**
   * **Le plus profond des deux mensonges de cet écran.** L'interrupteur se
   * dessinait sur `!refusees` seul : sans rien en mémoire — le cas de tout
   * navigateur, où rien n'a jamais pu s'enregistrer — il s'affichait donc
   * « activé » dès le premier rendu, avant qu'on y touche. Il annonçait des
   * notifications qu'aucun jeton ne pouvait porter.
   *
   * Une plateforme qui ne peut pas rendre de jeton n'a pas de réglage à
   * offrir : l'interrupteur est éteint, inerte, et la phrase dit pourquoi.
   */
  const disponible = pushDisponible();

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
        setRefusees(true);
        return;
      }

      // **L'interrupteur suit l'issue réelle, jamais le geste.** Il se posait
      // sur « activé » sans lire ce que `enregistrerCeTerminal` avait rendu :
      // sur le web, où aucun jeton n'est obtenable, il annonçait des
      // notifications que rien n'avait enregistrées. Un interrupteur qui dit
      // le contraire de l'état est pire qu'un interrupteur absent — celui qui
      // le lit cesse de vérifier.
      await noterLeRefus(false);
      const issue = await enregistrerCeTerminal(api);
      if (issue.issue === 'enregistre') {
        setRefusees(false);
        return;
      }

      // Rien n'est enregistré : on remet la mémoire comme on l'a trouvée,
      // sans quoi le prochain lancement croirait à un refus local — celui de
      // l'écran — là où c'est le système ou la plateforme qui a dit non.
      await noterLeRefus(true);
      setRefusees(true);
      setEchec(t(MESSAGE_DE_L_ECHEC[issue.issue]));
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
          value={disponible && !refusees}
          onChange={(actives: boolean) => void basculer(!actives)}
          accessibilityLabel={t('reglages.notificationsSurCetAppareil')}
          disabled={envoi || !disponible}
          testID="notifications-actives"
        />
      </View>

      {/* **Ce que le geste ne fait pas, dit là où on le fait.** Quelqu'un qui
          cherche à couper un téléphone perdu doit l'apprendre ici, pas après
          avoir cru que c'était réglé. */}
      <Texte variante="type.caption" couleur="ink.soft" testID="notifications-portee">
        {t('reglages.notificationsPortee')}
      </Texte>

      {/* **La raison de l'inertie, dite sans qu'on ait à appuyer.** Un
          interrupteur éteint et bloqué sans explication se lit comme une
          panne ; ici ce n'en est pas une, et rien dans les réglages du
          téléphone n'y changerait quoi que ce soit. */}
      {!disponible ? (
        <StatusMessage
          level="neutral"
          body={t('reglages.notificationsEchecIndisponible')}
          testID="notifications-indisponibles"
        />
      ) : null}

      {echec ? <StatusMessage level="danger" body={echec} testID="echec-notifications" /> : null}
    </View>
  );
}
