/**
 * 06 · Code de retrait. **Hors thème.**
 *
 * **Le code tourne tout seul toutes les 30 secondes.** Il n'existe donc ni
 * bouton de renouvellement — en proposer un donnerait à croire qu'il faut agir,
 * devant un écran qui se met déjà à jour — ni état « expiré » : un code périmé
 * est remplacé par le suivant. Ce qui expire est le droit de consommer, et cela
 * se dit sur l'écran de réservation.
 *
 * **Hors ligne, le code reste affiché et valide.** La vérification se fait côté
 * salon. Effacer l'écran sur une perte de réseau laisserait quelqu'un devant
 * une caisse sans rien à montrer.
 *
 * **Luminosité au maximum, veille désactivée.** Restaurées à la sortie.
 */
import { useEffect, useRef, useState } from 'react';
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
  /** Injectés pour les tests, et pour la plateforme web où ils n'existent pas. */
  garderEveille,
}: {
  bookingId: string;
  garderEveille?: { activer: () => void; desactiver: () => void };
}) {
  const { api } = useApi();
  const { t } = useI18n();
  const [code, setCode] = useState<CodeDeRetrait | null>(null);
  const [restant, setRestant] = useState(0);

  // Le dernier code obtenu reste affiché quoi qu'il arrive ensuite : une
  // requête qui échoue ne doit pas vider l'écran, le code affiché est encore
  // valide côté salon jusqu'à sa rotation.
  const dernier = useRef<CodeDeRetrait | null>(null);

  useEffect(() => {
    garderEveille?.activer();
    return () => garderEveille?.desactiver();
  }, [garderEveille]);

  useEffect(() => {
    let vivant = true;

    async function relire() {
      try {
        const frais = await api.codeDeRetrait(bookingId);
        if (!vivant) return;
        dernier.current = frais;
        setCode(frais);
        setRestant(frais.seconds_remaining);
      } catch {
        // Hors ligne : on garde ce qui est à l'écran. Le silence est correct
        // ici, et c'est le seul endroit du produit où il l'est.
      }
    }

    void relire();
    const battement = setInterval(() => {
      setRestant((secondes) => {
        if (secondes > 1) return secondes - 1;
        // Le compte est à zéro : on demande le code suivant. Personne n'a rien
        // à presser.
        void relire();
        return dernier.current?.rotation_seconds ?? 0;
      });
    }, 1000);

    return () => {
      vivant = false;
      clearInterval(battement);
    };
  }, [api, bookingId]);

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
