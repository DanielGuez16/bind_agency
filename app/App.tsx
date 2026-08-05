import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

// Écran d'amorçage : il ne sert qu'à prouver que l'app parle à l'API.
// Aucune chaîne d'interface ne doit rester en dur ici une fois la tâche
// d'internationalisation de la phase 1 faite.

const API_URL = process.env.EXPO_PUBLIC_API_URL;

type Health = {
  status: 'ok' | 'unavailable';
  dependencies: Record<string, string>;
  failed: string[];
};

type Probe =
  | { state: 'loading' }
  | { state: 'reachable'; httpStatus: number; body: Health }
  | { state: 'unreachable'; detail: string };

export default function App() {
  const [probe, setProbe] = useState<Probe>({ state: 'loading' });

  const check = useCallback(async () => {
    setProbe({ state: 'loading' });

    if (!API_URL) {
      setProbe({ state: 'unreachable', detail: 'EXPO_PUBLIC_API_URL is not set' });
      return;
    }

    try {
      const response = await fetch(`${API_URL}/health`);
      const body: Health = await response.json();
      setProbe({ state: 'reachable', httpStatus: response.status, body });
    } catch (error) {
      setProbe({ state: 'unreachable', detail: String(error) });
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  return (
    <View style={styles.container}>
      <StatusBar style="auto" />
      <Text style={styles.title}>BIND</Text>
      <Text style={styles.subtitle}>{API_URL ?? 'no API url'}</Text>

      {probe.state === 'loading' && <ActivityIndicator />}

      {probe.state === 'reachable' && (
        <View style={styles.card}>
          <Text style={probe.body.status === 'ok' ? styles.ok : styles.down}>
            {probe.httpStatus} · {probe.body.status}
          </Text>
          {Object.entries(probe.body.dependencies).map(([name, state]) => (
            <Text key={name} style={styles.dependency}>
              {name} · {state}
            </Text>
          ))}
        </View>
      )}

      {probe.state === 'unreachable' && (
        <View style={styles.card}>
          <Text style={styles.down}>API unreachable</Text>
          <Text style={styles.dependency}>{probe.detail}</Text>
        </View>
      )}

      <Pressable style={styles.button} onPress={check}>
        <Text style={styles.buttonLabel}>Check again</Text>
      </Pressable>
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
  subtitle: { fontSize: 12, color: '#666' },
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
});
