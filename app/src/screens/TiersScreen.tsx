/**
 * Écran des paliers accessibles.
 *
 * Il affiche **tous** les paliers actifs, pas seulement ceux qui sont ouverts :
 * un créateur qui débute verrait sinon un écran vide, sans rien savoir de ce
 * qui l'attend. C'est l'inverse du fil, où un palier inaccessible ne doit
 * justement pas apparaître — là-bas il encombrerait, ici il oriente.
 *
 * Aucune chaîne d'interface n'est écrite en dur, et aucune raison de refus
 * n'est reformulée ici : l'API renvoie un code, le catalogue le traduit.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../i18n';
import { errorCodeFromResponse, translateErrorCode } from '../i18n/errors';

const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL;

export type Obstacle = {
  raison: string;
  requis: number | null;
  constate: number | null;
  ecart: number | null;
};

export type Palier = {
  tier_id: string;
  platform: string;
  content_format: string;
  min_followers: number;
  value_ratio_hint: string | null;
  accessible: boolean;
  obstacles: Obstacle[];
};

export type VueDesPaliers = {
  creator_id: string;
  is_new_creator: boolean;
  paliers: Palier[];
};

type Etat =
  | { state: 'loading' }
  | { state: 'ready'; vue: VueDesPaliers }
  | { state: 'failed'; code: string | null };

export function TiersScreen({
  apiUrl = DEFAULT_API_URL,
  accessToken,
}: {
  apiUrl?: string;
  accessToken: string;
}) {
  const { t } = useI18n();
  const [etat, setEtat] = useState<Etat>({ state: 'loading' });

  // La requête est asynchrone : sans cette garde, une réponse qui arrive après
  // un démontage écrit dans un composant qui n'existe plus.
  const monte = useRef(true);
  useEffect(() => {
    monte.current = true;
    return () => {
      monte.current = false;
    };
  }, []);

  const charger = useCallback(async () => {
    if (!apiUrl) {
      if (monte.current) setEtat({ state: 'failed', code: null });
      return;
    }
    try {
      const reponse = await fetch(`${apiUrl}/me/tiers`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const corps = await reponse.json();
      if (!monte.current) return;
      setEtat(
        reponse.ok
          ? { state: 'ready', vue: corps as VueDesPaliers }
          : { state: 'failed', code: errorCodeFromResponse(corps) },
      );
    } catch {
      if (monte.current) setEtat({ state: 'failed', code: null });
    }
  }, [apiUrl, accessToken]);

  useEffect(() => {
    void charger();
  }, [charger]);

  if (etat.state === 'loading') {
    return (
      <View style={styles.centre} accessibilityRole="progressbar">
        <ActivityIndicator />
        <Text>{t('common.loading')}</Text>
      </View>
    );
  }

  if (etat.state === 'failed') {
    return (
      <View style={styles.centre}>
        <Text style={styles.erreur}>{translateErrorCode(t, etat.code)}</Text>
      </View>
    );
  }

  const { vue } = etat;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.titre}>{t('tiers.title')}</Text>

      {vue.is_new_creator ? (
        <View style={styles.badge}>
          <Text style={styles.badgeTexte}>{t('tiers.newCreatorBadge')}</Text>
          <Text style={styles.aide}>{t('tiers.newCreatorHelp')}</Text>
        </View>
      ) : null}

      {vue.paliers.length === 0 ? <Text>{t('tiers.empty')}</Text> : null}

      {vue.paliers.map((palier) => (
        <View key={palier.tier_id} style={styles.carte}>
          <Text style={styles.nom}>
            {palier.platform} · {palier.content_format}
          </Text>
          <Text>{t('tiers.minFollowers', { count: palier.min_followers })}</Text>
          {palier.value_ratio_hint ? (
            <Text>{t('tiers.valueHint', { ratio: palier.value_ratio_hint })}</Text>
          ) : null}
          <Text style={palier.accessible ? styles.ouvert : styles.ferme}>
            {palier.accessible ? t('tiers.unlocked') : t('tiers.locked')}
          </Text>

          {/* Chaque obstacle est traduit depuis son code. Les rendre tous, et
              pas seulement le premier : dire « pas assez d'abonnés » à quelqu'un
              qui en gagne, puis « pas assez de collaborations », c'est le mal
              traiter deux fois. */}
          {palier.obstacles.map((obstacle) => (
            <Text key={obstacle.raison} style={styles.obstacle}>
              {translateErrorCode(t, obstacle.raison)}
              {obstacle.raison === 'not_enough_followers' && obstacle.ecart !== null
                ? ` — ${t('tiers.missingFollowers', { count: obstacle.ecart })}`
                : ''}
            </Text>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 24, gap: 16 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  titre: { fontSize: 22, fontWeight: '600' },
  badge: { padding: 12, borderRadius: 8, backgroundColor: '#eef', gap: 4 },
  badgeTexte: { fontWeight: '600' },
  aide: { fontSize: 13 },
  carte: { padding: 16, borderRadius: 8, borderWidth: 1, borderColor: '#ddd', gap: 4 },
  nom: { fontWeight: '600' },
  ouvert: { color: '#136c3a', fontWeight: '600' },
  ferme: { color: '#8a6d00', fontWeight: '600' },
  obstacle: { fontSize: 13, color: '#555' },
  erreur: { color: '#a11' },
});
