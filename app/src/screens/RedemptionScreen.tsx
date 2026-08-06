/**
 * Caisse : reconnaître un code, puis le servir.
 *
 * **La saisie manuelle est le chemin de premier rang**, pas un secours dégradé.
 * Dans un salon, une caméra sale, un écran fissuré ou une lumière rasante
 * arrivent tous les jours ; un écran qui met le scanner au centre et la saisie
 * derrière un lien fait perdre du temps à la caisse précisément les jours où
 * elle en a le moins. Le champ est donc visible et utilisable d'emblée, et le
 * scanner est l'autre onglet.
 *
 * **Vérifier et servir sont deux gestes.** La caisse voit ce qu'elle doit
 * servir, sert, puis confirme. Les fondre ferait déclarer servi ce qui ne l'est
 * pas encore, et `consumed` ne se défait pas.
 *
 * Le scanner est injecté. Le composant réel s'appuie sur la caméra, que ni un
 * test ni un simulateur ne fournissent : le rendre remplaçable est ce qui
 * permet d'éprouver tout le reste sans appareil.
 */
import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useI18n } from '../i18n';
import { errorCodeFromResponse, translateErrorCode } from '../i18n/errors';

const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL;

export type Verification = {
  booking_id: string;
  redemption_code_id: string;
  creator_name: string | null;
  item_name: string;
  item_photo_key: string | null;
  starts_at: string | null;
  valid_until: string;
  status: string;
  par_secours: boolean;
};

type Etat =
  | { state: 'saisie' }
  | { state: 'verification' }
  | { state: 'reconnu'; verification: Verification }
  | { state: 'servi'; verification: Verification }
  | { state: 'refuse'; code: string | null };

/** Ce que le scanner doit savoir faire. Rien de plus : une lecture, un texte. */
export type Scanner = ComponentType<{
  onCode: (valeur: string) => void;
  indisponible: () => void;
}>;

export function RedemptionScreen({
  apiUrl = DEFAULT_API_URL,
  accessToken,
  scanner,
}: {
  apiUrl?: string;
  accessToken: string;
  scanner?: Scanner;
}) {
  const { t } = useI18n();
  const [etat, setEtat] = useState<Etat>({ state: 'saisie' });
  const [saisi, setSaisi] = useState('');
  const [ongletScan, setOngletScan] = useState(false);

  const monte = useRef(true);
  useEffect(() => {
    monte.current = true;
    return () => {
      monte.current = false;
    };
  }, []);

  const appeler = useCallback(
    async (chemin: string, corps: object) => {
      const reponse = await fetch(`${apiUrl}${chemin}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(corps),
      });
      return { reponse, corps: await reponse.json() };
    },
    [apiUrl, accessToken],
  );

  const verifier = useCallback(
    async (code: string) => {
      if (!code.trim()) return;
      setEtat({ state: 'verification' });
      try {
        const { reponse, corps } = await appeler('/redemptions/verify', { code });
        if (!monte.current) return;
        setEtat(
          reponse.ok
            ? { state: 'reconnu', verification: corps as Verification }
            : { state: 'refuse', code: errorCodeFromResponse(corps) },
        );
      } catch {
        if (monte.current) setEtat({ state: 'refuse', code: null });
      }
    },
    [appeler],
  );

  const servir = useCallback(
    async (verification: Verification) => {
      setEtat({ state: 'verification' });
      try {
        const { reponse, corps } = await appeler('/redemptions/consume', {
          redemption_code_id: verification.redemption_code_id,
        });
        if (!monte.current) return;
        setEtat(
          reponse.ok
            ? { state: 'servi', verification }
            : { state: 'refuse', code: errorCodeFromResponse(corps) },
        );
      } catch {
        if (monte.current) setEtat({ state: 'refuse', code: null });
      }
    },
    [appeler],
  );

  const Scan = scanner;

  return (
    <View style={styles.page}>
      <Text style={styles.titre}>{t('redemption.title')}</Text>

      <View style={styles.onglets}>
        {/* La saisie d'abord, et sélectionnée par défaut. L'ordre n'est pas
            cosmétique : c'est lui qui dit quel chemin est le principal. */}
        <Pressable
          accessibilityRole="button"
          onPress={() => setOngletScan(false)}
          style={[styles.onglet, !ongletScan && styles.ongletActif]}
        >
          <Text>{t('redemption.manualTab')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => setOngletScan(true)}
          style={[styles.onglet, ongletScan && styles.ongletActif]}
        >
          <Text>{t('redemption.scanTab')}</Text>
        </Pressable>
      </View>

      {!ongletScan || !Scan ? (
        <View style={styles.bloc}>
          <Text style={styles.libelle}>{t('redemption.manualLabel')}</Text>
          <TextInput
            accessibilityLabel={t('redemption.manualLabel')}
            value={saisi}
            onChangeText={setSaisi}
            // Le code est en majuscules sans caractères ambigus : forcer la
            // casse et couper la correction évitent des refus absurdes.
            autoCapitalize="characters"
            autoCorrect={false}
            style={styles.champ}
          />
          <Text style={styles.aide}>{t('redemption.manualHint')}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => verifier(saisi)}
            style={styles.bouton}
          >
            <Text>{t('redemption.manualSubmit')}</Text>
          </Pressable>
          {ongletScan && !Scan ? (
            <Text style={styles.aide}>{t('redemption.cameraUnavailable')}</Text>
          ) : null}
        </View>
      ) : (
        <View style={styles.bloc}>
          <Text style={styles.aide}>{t('redemption.scanHint')}</Text>
          <Scan onCode={verifier} indisponible={() => setOngletScan(false)} />
        </View>
      )}

      {etat.state === 'verification' ? (
        <View style={styles.bloc} accessibilityRole="progressbar">
          <ActivityIndicator />
          <Text>{t('redemption.verifying')}</Text>
        </View>
      ) : null}

      {etat.state === 'refuse' ? (
        <Text style={styles.erreur}>{translateErrorCode(t, etat.code)}</Text>
      ) : null}

      {etat.state === 'reconnu' ? (
        <View style={styles.bloc}>
          <Text style={styles.item}>{etat.verification.item_name}</Text>
          {etat.verification.creator_name ? (
            <Text>
              {t('redemption.creator')} : {etat.verification.creator_name}
            </Text>
          ) : null}
          {/* La caisse a le droit de savoir qu'elle n'a pas scanné : c'est le
              chemin le moins fort des deux. */}
          {etat.verification.par_secours ? (
            <Text style={styles.aide}>{t('redemption.usedManualCode')}</Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => servir(etat.verification)}
            style={styles.bouton}
          >
            <Text>{t('redemption.serve')}</Text>
          </Pressable>
        </View>
      ) : null}

      {etat.state === 'servi' ? (
        <Text style={styles.servi}>
          {t('redemption.served')} — {etat.verification.item_name}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 24, gap: 16 },
  titre: { fontSize: 22, fontWeight: '600' },
  onglets: { flexDirection: 'row', gap: 8 },
  onglet: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, backgroundColor: '#eee' },
  ongletActif: { backgroundColor: '#dde' },
  bloc: { gap: 8 },
  libelle: { fontWeight: '600' },
  champ: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 20 },
  aide: { fontSize: 13, color: '#555' },
  bouton: { padding: 14, borderRadius: 8, backgroundColor: '#dde', alignItems: 'center' },
  item: { fontSize: 18, fontWeight: '600' },
  erreur: { color: '#a11' },
  servi: { color: '#136c3a', fontWeight: '600', fontSize: 18 },
});
