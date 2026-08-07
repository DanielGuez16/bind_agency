/**
 * 06 · Code de retrait. **Hors thème.**
 *
 * **Un seul appel par rotation.** Le serveur rend le code et le nombre de
 * secondes qui restent ; le décompte se pilote ici, à partir de cet instant, et
 * un nouvel appel n'a lieu qu'à l'expiration. La première version rappelait
 * l'API à chaque seconde écoulée à zéro et depuis un *updater* d'état — que
 * React exécute deux fois en développement — ce qui produisait une quinzaine
 * d'appels et remettait le décompte à zéro sans arrêt.
 *
 * **Rien ne tourne quand l'écran n'est pas visible.** Un onglet quitté laisse
 * l'écran monté ; sans cette garde, le minuteur continue et l'API reçoit des
 * appels pour un écran que personne ne regarde.
 *
 * **Le code tourne tout seul.** Il n'existe donc ni bouton de renouvellement —
 * en proposer un donnerait à croire qu'il faut agir, devant un écran qui se met
 * déjà à jour — ni état « expiré » : un code périmé est remplacé par le
 * suivant. Ce qui expire est le droit de consommer, et cela se dit ailleurs.
 *
 * **Hors ligne, le code reste affiché et valide.** La vérification se fait côté
 * salon. Effacer l'écran sur une perte de réseau laisserait quelqu'un devant
 * une caisse sans rien à montrer.
 */
import { useIsFocused } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { useApi, type CodeDeRetrait } from '../api';
import {
  CodeGlyphs,
  Countdown,
  ManualCode,
  PickupCodeSurface,
  QrBlock,
  SkeletonBox,
  Texte,
} from '../components';
import { useI18n } from '../i18n';
import { codeColors } from '../theme';

export function CodeScreen({
  bookingId,
  /** Injectés pour les tests, et pour le web où ils n'existent pas. */
  garderEveille,
}: {
  bookingId: string;
  garderEveille?: { activer: () => void; desactiver: () => void };
}) {
  const { api } = useApi();
  const { t } = useI18n();
  const visible = useIsFocused();

  const [code, setCode] = useState<CodeDeRetrait | null>(null);
  const [restant, setRestant] = useState(0);

  /**
   * L'instant où le code affiché cesse d'être le bon, en horloge locale.
   *
   * C'est lui qui décide de rappeler, pas un compteur qui descend : un
   * compteur se remet à zéro à chaque rendu, une échéance non.
   */
  const expireA = useRef<number>(0);
  /** Empêche deux relectures concurrentes de se croiser. */
  const enCours = useRef(false);

  const relire = useCallback(async () => {
    if (enCours.current) return;
    enCours.current = true;
    try {
      const frais = await api.codeDeRetrait(bookingId);
      expireA.current = Date.now() + frais.seconds_remaining * 1000;
      setCode(frais);
      setRestant(frais.seconds_remaining);
    } catch {
      // Hors ligne : on garde ce qui est à l'écran. Le code affiché reste
      // valide côté salon jusqu'à sa rotation, et c'est le seul endroit du
      // produit où avaler une erreur est le bon comportement.
    } finally {
      enCours.current = false;
    }
  }, [api, bookingId]);

  useEffect(() => {
    if (!visible) return;
    garderEveille?.activer();
    return () => garderEveille?.desactiver();
  }, [garderEveille, visible]);

  useEffect(() => {
    if (!visible) return;

    // Un seul appel à l'ouverture, et à l'expiration seulement ensuite.
    if (Date.now() >= expireA.current) void relire();

    const battement = setInterval(() => {
      const reste = Math.max(0, Math.ceil((expireA.current - Date.now()) / 1000));
      setRestant(reste);
      if (reste === 0) void relire();
    }, 1000);

    return () => clearInterval(battement);
  }, [relire, visible]);

  return (
    <PickupCodeSurface>
      {code === null ? (
        <View testID="etat-chargement" style={{ gap: 20, alignItems: 'center' }}>
          <SkeletonBox width={260} height={80} />
        </View>
      ) : (
        <View testID="etat-nominal" style={{ gap: 24 }}>
          <Texte
            variante="type.caption"
            align="center"
            style={{ color: codeColors.fg }}
            testID="titre-code"
          >
            {t('parcours.codeTitre')}
          </Texte>
          <CodeGlyphs code={code.code} testID="chiffres" />
          <Countdown secondes={restant} testID="compte-a-rebours" />
          <QrBlock contenu={`${bookingId}:${code.code}`} testID="qr" />
          <ManualCode code={code.manual_code} label={t('parcours.codeSecours')} testID="secours" />
        </View>
      )}
    </PickupCodeSurface>
  );
}
