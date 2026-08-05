/**
 * Écran d'amorçage : il ne sert qu'à prouver que l'app parle à l'API.
 * Aucune chaîne d'interface n'y est écrite en dur.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { SUPPORTED_LOCALES, useI18n, type SupportedLocale } from '../i18n';
import { errorCodeFromResponse, translateErrorCode } from '../i18n/errors';

// Les variables EXPO_PUBLIC_ sont inlinées à la compilation : elles n'existent
// pas hors bundler. L'URL est donc une propriété, avec l'environnement pour
// valeur par défaut — ce qui la rend aussi injectable en test.
const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL;

type Health = {
  status: 'ok' | 'unavailable';
  dependencies: Record<string, string>;
  failed: string[];
};

type Probe =
  | { state: 'loading' }
  | { state: 'answered'; httpStatus: number; body: Health }
  | { state: 'failed'; code: string | null };

export function HealthScreen({ apiUrl = DEFAULT_API_URL }: { apiUrl?: string }) {
  const { t, locale, setLocale } = useI18n();
  const [probe, setProbe] = useState<Probe>({ state: 'loading' });

  // La sonde est asynchrone : sans cette garde, une réponse qui arrive après
  // un démontage écrit dans un composant qui n'existe plus.
  const monte = useRef(true);
  useEffect(() => {
    monte.current = true;
    return () => {
      monte.current = false;
    };
  }, []);

  const publie = useCallback((resultat: Probe) => {
    if (monte.current) setProbe(resultat);
  }, []);

  const check = useCallback(async () => {
    publie({ state: 'loading' });

    if (!apiUrl) {
      publie({ state: 'failed', code: null });
      return;
    }

    try {
      const response = await fetch(`${apiUrl}/health`);
      const body = await response.json();

      if (response.status >= 400) {
        // Le corps peut porter un code du catalogue, ou rien d'exploitable.
        publie({ state: 'failed', code: errorCodeFromResponse(body) });
        return;
      }

      publie({ state: 'answered', httpStatus: response.status, body });
    } catch {
      publie({ state: 'failed', code: null });
    }
  }, [apiUrl, publie]);

  useEffect(() => {
    void check();
  }, [check]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('common.appName')}</Text>
      <Text style={styles.subtitle}>{t('health.title')}</Text>

      {probe.state === 'loading' && (
        <View style={styles.card}>
          <ActivityIndicator />
          <Text style={styles.dependency}>{t('common.loading')}</Text>
        </View>
      )}

      {probe.state === 'answered' && (
        <View style={styles.card}>
          <Text style={probe.body.status === 'ok' ? styles.ok : styles.down}>
            {probe.body.status === 'ok' ? t('health.reachable') : t('health.unreachable')}
          </Text>
          {Object.entries(probe.body.dependencies).map(([name, state]) => (
            <Text key={name} style={styles.dependency}>
              {/* `name` vient du serveur et n'est pas un libellé d'interface. */}
              {name} ·{' '}
              {state === 'ok' ? t('health.dependencyOk') : t('health.dependencyDown')}
            </Text>
          ))}
        </View>
      )}

      {probe.state === 'failed' && (
        <View style={styles.card}>
          <Text style={styles.down}>
            {apiUrl ? t('health.unreachable') : t('health.missingApiUrl')}
          </Text>
          <Text style={styles.dependency}>{translateErrorCode(t, probe.code)}</Text>
        </View>
      )}

      <Pressable style={styles.button} onPress={check} accessibilityRole="button">
        <Text style={styles.buttonLabel}>{t('common.retry')}</Text>
      </Pressable>

      <View style={styles.languages}>
        <Text style={styles.dependency}>{t('common.language')}</Text>
        {SUPPORTED_LOCALES.map((code: SupportedLocale) => (
          <Pressable
            key={code}
            onPress={() => setLocale(code)}
            accessibilityRole="button"
            style={[styles.chip, code === locale && styles.chipActive]}
          >
            <Text style={code === locale ? styles.chipLabelActive : styles.chipLabel}>
              {code.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    gap: 12,
    padding: 24,
  },
  title: { fontSize: 32, fontWeight: '700', letterSpacing: 4 },
  subtitle: { fontSize: 13, color: '#666' },
  card: { alignItems: 'center', gap: 4, paddingVertical: 8 },
  ok: { fontSize: 18, fontWeight: '600', color: '#0a7d33' },
  down: { fontSize: 18, fontWeight: '600', color: '#b00020' },
  dependency: { fontSize: 13, color: '#444' },
  button: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#111',
  },
  buttonLabel: { color: '#fff', fontWeight: '600' },
  languages: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#ccc',
  },
  chipActive: { backgroundColor: '#111', borderColor: '#111' },
  chipLabel: { color: '#444', fontWeight: '600' },
  chipLabelActive: { color: '#fff', fontWeight: '600' },
});
