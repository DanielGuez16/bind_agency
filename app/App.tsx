import { StatusBar } from 'expo-status-bar';

import { I18nProvider } from './src/i18n';
import { HealthScreen } from './src/screens/HealthScreen';

export default function App() {
  return (
    <I18nProvider>
      <StatusBar style="auto" />
      <HealthScreen />
    </I18nProvider>
  );
}
