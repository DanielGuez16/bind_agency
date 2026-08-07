/**
 * La frontière d'erreur globale.
 *
 * **Une trace technique n'atteint jamais l'écran.** Elle est journalisée — on
 * en a besoin — mais ce que voit l'utilisateur est une phrase et une issue.
 * Afficher `TypeError: Cannot read properties of undefined` à quelqu'un qui
 * voulait réserver un soin ne lui apprend rien et lui fait croire que le
 * produit est cassé partout.
 *
 * **Une issue, toujours.** Sans bouton, un plantage d'écran demande de tuer
 * l'application et de la relancer. Le bouton remonte la frontière, ce qui suffit
 * dans l'immense majorité des cas — un rendu raté sur une donnée inattendue ne
 * se reproduit pas forcément au second essai.
 *
 * Écrite en composant de classe : React n'expose `componentDidCatch` que là.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { View } from 'react-native';

import { Button, StatusMessage } from '../components';
import { useI18n } from '../i18n';
import { useTheme } from '../theme';

type Props = { children: ReactNode; onReinitialiser?: () => void };
type Etat = { tombe: boolean };

class Frontiere extends Component<Props & { rendu: (rejouer: () => void) => ReactNode }, Etat> {
  state: Etat = { tombe: false };

  static getDerivedStateFromError(): Etat {
    return { tombe: true };
  }

  componentDidCatch(erreur: Error, infos: ErrorInfo): void {
    // La trace part dans la console, pas à l'écran. C'est le seul endroit du
    // produit où l'on veut la pile entière.
    console.error('écran tombé', erreur, infos.componentStack);
  }

  render(): ReactNode {
    if (!this.state.tombe) return this.props.children;
    return this.props.rendu(() => {
      this.setState({ tombe: false });
      this.props.onReinitialiser?.();
    });
  }
}

/** L'écran montré quand une frontière attrape. Traduit, sans trace. */
function EcranTombe({ rejouer }: { rejouer: () => void }) {
  const { t } = useI18n();
  const { color: c, density } = useTheme();

  return (
    <View
      testID="ecran-erreur-globale"
      style={{
        flex: 1,
        backgroundColor: c['bg.canvas'],
        padding: density.screenPadding,
        justifyContent: 'center',
        gap: 16,
      }}
    >
      <StatusMessage
        level="danger"
        title={t('global.erreurTitre')}
        body={t('global.erreurCorps')}
      />
      <Button label={t('global.erreurAction')} onPress={rejouer} testID="rejouer" />
    </View>
  );
}

export function FrontiereDErreur({ children, onReinitialiser }: Props) {
  return (
    <Frontiere
      onReinitialiser={onReinitialiser}
      rendu={(rejouer) => <EcranTombe rejouer={rejouer} />}
    >
      {children}
    </Frontiere>
  );
}
