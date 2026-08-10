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
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { Button } from '../components/Button';
import { SegmentedTabs } from '../components/SegmentedTabs';
import { Texte } from '../components/Texte';
import { TextField } from '../components/TextField';
import { useI18n } from '../i18n';
import { errorCodeFromResponse, translateErrorCode } from '../i18n/errors';
import { adresseDeLApi } from '../shell/adresseDeLApi';
import { radius, spacing, useColors } from '../theme';

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
  // `injoignable` : la requête n'est jamais arrivée. Ce n'est pas un code
  // refusé, et le dire évite qu'un commerçant redemande dix fois son code à un
  // client alors que c'est le réseau ou l'adresse de l'API qui est en cause.
  | { state: 'refuse'; code: string | null; injoignable: boolean };

/** L'API n'a pas d'adresse : rien n'a été tenté. */
class ApiInjoignable extends Error {}

/** Ce que le scanner doit savoir faire. Rien de plus : une lecture, un texte. */
export type Scanner = ComponentType<{
  onCode: (valeur: string) => void;
  indisponible: () => void;
}>;

export function RedemptionScreen({
  apiUrl,
  accessToken,
  scanner,
}: {
  apiUrl?: string;
  accessToken: string;
  scanner?: Scanner;
}) {
  const { t } = useI18n();
  const c = useColors();

  // `adresseDeLApi()` et non `EXPO_PUBLIC_API_URL` : sur un téléphone en
  // développement, la variable n'est pas posée et l'adresse se déduit de
  // l'hôte du bundler — c'est ce que fait tout le reste de l'app. Lire la
  // variable directement donnait `undefined/redemptions/verify`, un `fetch`
  // qui échoue avant d'atteindre quoi que ce soit, et « Something went wrong »
  // à la caisse pour tous les codes du monde.
  const racine = apiUrl ?? adresseDeLApi();
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
      if (!racine) throw new ApiInjoignable();
      const reponse = await fetch(`${racine}${chemin}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(corps),
      });
      return { reponse, corps: await reponse.json() };
    },
    [racine, accessToken],
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
            : { state: 'refuse', code: errorCodeFromResponse(corps), injoignable: false },
        );
      } catch {
        if (monte.current) setEtat({ state: 'refuse', code: null, injoignable: true });
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
            : { state: 'refuse', code: errorCodeFromResponse(corps), injoignable: false },
        );
      } catch {
        if (monte.current) setEtat({ state: 'refuse', code: null, injoignable: true });
      }
    },
    [appeler],
  );

  const Scan = scanner;
  const refus = etat.state === 'refuse' ? etat : null;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c['bg.canvas'] }}
      contentContainerStyle={{ padding: spacing['space.6'], gap: spacing['space.4'] }}
    >
      <Texte variante="type.heading">{t('redemption.title')}</Texte>

      {/* La saisie d'abord, et sélectionnée par défaut. L'ordre n'est pas
          cosmétique : c'est lui qui dit quel chemin est le principal. */}
      <SegmentedTabs
        items={[{ label: t('redemption.manualTab') }, { label: t('redemption.scanTab') }]}
        index={ongletScan ? 1 : 0}
        onChange={(i) => setOngletScan(i === 1)}
        testID="onglets-caisse"
      />

      {!ongletScan || !Scan ? (
        <View style={{ gap: spacing['space.3'] }}>
          <TextField
            label={t('redemption.manualLabel')}
            value={saisi}
            onChangeText={setSaisi}
            helpText={t('redemption.manualHint')}
            testID="champ-code"
          />
          <Button
            label={t('redemption.manualSubmit')}
            onPress={() => verifier(saisi)}
            testID="valider-code"
          />
          {ongletScan && !Scan ? (
            <Texte variante="type.caption" couleur="text.secondary">
              {t('redemption.cameraUnavailable')}
            </Texte>
          ) : null}
        </View>
      ) : (
        <View style={{ gap: spacing['space.3'] }}>
          <Texte variante="type.caption" couleur="text.secondary">
            {t('redemption.scanHint')}
          </Texte>
          <Scan onCode={verifier} indisponible={() => setOngletScan(false)} />
        </View>
      )}

      {etat.state === 'verification' ? (
        <View
          style={{ gap: spacing['space.2'], alignItems: 'center' }}
          accessibilityRole="progressbar"
        >
          <ActivityIndicator color={c['accent.default']} />
          <Texte couleur="text.secondary">{t('redemption.verifying')}</Texte>
        </View>
      ) : null}

      {refus ? (
        <View
          testID="refus"
          style={{
            gap: spacing['space.1'],
            padding: spacing['space.4'],
            borderRadius: radius['radius.md'],
            backgroundColor: c['status.danger.subtle'],
          }}
        >
          <Texte variante="type.label" style={{ color: c['status.danger'] }}>
            {refus.injoignable ? t('errors.network') : translateErrorCode(t, refus.code)}
          </Texte>
          {/* Un code refusé dit quoi faire, pas seulement que c'est refusé :
              c'est un commerçant devant un client qui le lit. */}
          <Texte variante="type.caption" couleur="text.secondary">
            {refus.injoignable ? t('redemption.unreachableHint') : t('redemption.refusedHint')}
          </Texte>
        </View>
      ) : null}

      {etat.state === 'reconnu' ? (
        <View
          testID="reconnu"
          style={{
            gap: spacing['space.3'],
            padding: spacing['space.4'],
            borderRadius: radius['radius.md'],
            backgroundColor: c['bg.raised'],
          }}
        >
          <Texte variante="type.title">{etat.verification.item_name}</Texte>
          {etat.verification.creator_name ? (
            <Texte couleur="text.secondary">
              {t('redemption.creator')} : {etat.verification.creator_name}
            </Texte>
          ) : null}
          {/* La caisse a le droit de savoir qu'elle n'a pas scanné : c'est le
              chemin le moins fort des deux. */}
          {etat.verification.par_secours ? (
            <Texte variante="type.caption" couleur="text.secondary">
              {t('redemption.usedManualCode')}
            </Texte>
          ) : null}
          <Button
            label={t('redemption.serve')}
            onPress={() => servir(etat.verification)}
            testID="servir"
          />
        </View>
      ) : null}

      {etat.state === 'servi' ? (
        <View
          testID="servi"
          style={{
            padding: spacing['space.4'],
            borderRadius: radius['radius.md'],
            backgroundColor: c['status.success.subtle'],
          }}
        >
          <Texte variante="type.label" style={{ color: c['status.success'] }}>
            {t('redemption.served')} — {etat.verification.item_name}
          </Texte>
        </View>
      ) : null}
    </ScrollView>
  );
}
