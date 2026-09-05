/**
 * Le panneau d'un refus de position — le seul état qui a plus à proposer
 * qu'un message et un bouton.
 *
 * **Trois défauts trouvés au même audit, réparés ensemble.**
 *
 * Le texte décrivait un cadenas de bureau à quelqu'un sur Safari mobile :
 * l'icône n'existe pas là où Rebecca regardait. `messageDePosition` distingue
 * maintenant quatre plateformes web au lieu d'une seule — voir
 * `shell/plateformeWeb.ts` — et ce panneau ajoute un schéma pour les deux
 * variantes iOS, où « l'icône Aa » ne dit rien tant qu'on ne l'a pas vue.
 *
 * Le message ne disait pas que le réglage général du téléphone et celui, par
 * site, du navigateur sont deux interrupteurs différents — Rebecca avait
 * activé le premier et butait sur le second, sans que rien ne le distingue.
 * L'explication vit dans le texte lui-même (`filReactiverIos*Web`), pas ici :
 * un panneau qui la répéterait la traduirait deux fois.
 *
 * **Il n'existe aucune redirection automatique vers les réglages depuis le
 * web sur iOS — vérifié, pas supposé.** `prefs:root=...` est un schéma privé
 * qu'Apple bloque explicitement depuis Safari, et de plus en plus même
 * depuis une app native. Ce panneau ne prétend donc pas ouvrir les réglages :
 * il facilite le geste manuel — un schéma qui montre où regarder, un bouton
 * qui copie la marche à suivre pour la garder sous les yeux en changeant
 * d'application.
 */
import { useEffect, useState } from 'react';
import * as Presse from 'expo-clipboard';
import { View } from 'react-native';

import { Button, StatusMessage, Texte, vibration } from '../../components';
import { useI18n } from '../../i18n';
import { messageDePosition } from '../../shell/messageDePosition';
import type { EtatDePosition } from '../../shell/usePosition';

/** Le même délai que le bouton de copie de la preuve : une copie ne se fête pas. */
const RETOUR_DU_BOUTON_MS = 2_000;

export function BlocPositionRefusee({
  etat,
  onReessayer,
  testID,
}: {
  etat: Extract<EtatDePosition, { etat: 'refusee' }>;
  onReessayer: () => void;
  testID?: string;
}) {
  const { t } = useI18n();
  const [copie, setCopie] = useState(false);
  // **Ce que le bouton « réessayer » ne disait pas.** Sur un refus déjà acquis
  // le navigateur répond sans rien afficher, et l'écran revient exactement là
  // où il était : l'appui est indiscernable d'un bouton mort. Une ligne le
  // dit, le temps qu'on la lise, puis s'efface — la même mécanique que le
  // retour du bouton de copie juste au-dessus.
  const [essaiSansEffet, setEssaiSansEffet] = useState(false);

  useEffect(() => {
    if (!copie) return;
    const minuteur = setTimeout(() => setCopie(false), RETOUR_DU_BOUTON_MS);
    return () => clearTimeout(minuteur);
  }, [copie]);

  useEffect(() => {
    if (!essaiSansEffet) return;
    const minuteur = setTimeout(() => setEssaiSansEffet(false), RETOUR_DU_BOUTON_MS);
    return () => clearTimeout(minuteur);
  }, [essaiSansEffet]);

  const message = messageDePosition(etat);
  // Ne peut pas arriver : `etat.etat` vaut toujours `'refusee'` ici, et
  // `messageDePosition` ne rend `null` que sur `'accordee'`. Le contrôle
  // reste pour que TypeScript n'ait pas à le croire sur parole.
  if (!message) return null;

  const corps = [message.corps, message.ouReactiver]
    .filter((cle): cle is string => cle !== null)
    .map((cle) => t(cle))
    .join('\n\n');

  async function copier() {
    await Presse.setStringAsync(corps);
    vibration.action();
    setCopie(true);
  }

  return (
    <View testID={testID} style={{ gap: 12 }}>
      <StatusMessage level="neutral" body={corps} testID="fil-sans-position" />
      {essaiSansEffet ? (
        <Texte variante="type.caption" couleur="ink.soft" testID="fil-essai-sans-effet">
          {t('parcours.filToujoursBloque')}
        </Texte>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button
            label={t('parcours.filReessayer')}
            onPress={() => {
              // Marqué avant l'appel : si le refus tient, l'état ne change pas
              // et rien d'autre ne signalerait que le bouton a répondu.
              setEssaiSansEffet(true);
              onReessayer();
            }}
            testID="fil-reessayer"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            variant="secondary"
            label={
              copie
                ? t('parcours.filInstructionsCopiees')
                : t('parcours.filCopierLesInstructions')
            }
            onPress={() => void copier()}
            testID="fil-copier-instructions"
          />
        </View>
      </View>
    </View>
  );
}
