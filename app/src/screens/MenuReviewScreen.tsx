/**
 * Relecture d'une carte importée.
 *
 * **Rien n'entre au catalogue tant que le commerce n'a pas validé.** L'écran
 * ne fait que proposer : chaque ligne est modifiable, écartable, et rien ne
 * part avant le bouton final. Une extraction qui créerait des items
 * directement peuplerait un catalogue de prix faux que personne ne relirait.
 *
 * **La durée est saisie ici, et l'écran dit pourquoi.** Une carte affiche des
 * prix, pas des temps de poste — et quand elle affiche une durée, c'est celle
 * annoncée au client, pas celle que le commerce bloque. Les deux diffèrent
 * souvent d'un quart d'heure de remise en état.
 *
 * Les lignes de faible confiance sont signalées. Tout relire avec la même
 * attention revient à ne rien relire.
 */
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { useI18n } from '../i18n';
import { errorCodeFromResponse, translateErrorCode } from '../i18n/errors';

const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL;

/** En dessous, la ligne est signalée à la relecture. */
export const CONFIANCE_BASSE = 0.7;

export type LigneExtraite = {
  name: string;
  price_cents: number;
  description: string | null;
  confidence: string;
};

type LigneRevue = {
  name: string;
  price_cents: string;
  duration_minutes: string;
  requires_booking: boolean;
  retenue: boolean;
  confidence: number;
};

function depuis(ligne: LigneExtraite): LigneRevue {
  return {
    name: ligne.name,
    price_cents: String(ligne.price_cents),
    // Volontairement vide : l'extraction ne la fournit pas, et la préremplir
    // avec un chiffre plausible ferait valider une durée que personne n'a
    // choisie.
    duration_minutes: '',
    requires_booking: true,
    retenue: true,
    confidence: Number(ligne.confidence),
  };
}

export function MenuReviewScreen({
  apiUrl = DEFAULT_API_URL,
  accessToken,
  businessId,
  importId,
  lignesExtraites,
}: {
  apiUrl?: string;
  accessToken: string;
  businessId: string;
  importId: string;
  lignesExtraites: LigneExtraite[];
}) {
  const { t } = useI18n();
  const [lignes, setLignes] = useState<LigneRevue[]>(() => lignesExtraites.map(depuis));
  const [etat, setEtat] = useState<
    | { state: 'saisie' }
    | { state: 'envoi' }
    | { state: 'fait'; count: number }
    | { state: 'refuse'; code: string | null }
  >({ state: 'saisie' });

  const modifier = useCallback((index: number, champ: Partial<LigneRevue>) => {
    setLignes((actuelles) =>
      actuelles.map((ligne, i) => (i === index ? { ...ligne, ...champ } : ligne)),
    );
  }, []);

  const valider = useCallback(async () => {
    setEtat({ state: 'envoi' });
    try {
      const reponse = await fetch(
        `${apiUrl}/business/${businessId}/menu-imports/${importId}/validate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({
            lignes: lignes.map((ligne) => ({
              name: ligne.name,
              price_cents: Number(ligne.price_cents) || 0,
              duration_minutes: ligne.duration_minutes ? Number(ligne.duration_minutes) : null,
              requires_booking: ligne.requires_booking,
              retenue: ligne.retenue,
            })),
          }),
        },
      );
      const corps = await reponse.json();
      setEtat(
        reponse.ok
          ? { state: 'fait', count: corps.items_crees }
          : { state: 'refuse', code: errorCodeFromResponse(corps) },
      );
    } catch {
      setEtat({ state: 'refuse', code: null });
    }
  }, [apiUrl, accessToken, businessId, importId, lignes]);

  if (lignesExtraites.length === 0) {
    return (
      <View style={styles.page}>
        <Text style={styles.titre}>{t('menuImport.title')}</Text>
        <Text>{t('menuImport.empty')}</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.titre}>{t('menuImport.title')}</Text>
      <Text style={styles.aide}>{t('menuImport.intro')}</Text>

      {lignes.map((ligne, index) => (
        <View key={`${ligne.name}-${index}`} style={styles.carte}>
          {ligne.confidence < CONFIANCE_BASSE ? (
            <Text style={styles.alerte}>{t('menuImport.lowConfidence')}</Text>
          ) : null}

          <Text style={styles.libelle}>{t('menuImport.nameLabel')}</Text>
          <TextInput
            accessibilityLabel={`${t('menuImport.nameLabel')} ${index + 1}`}
            value={ligne.name}
            onChangeText={(valeur) => modifier(index, { name: valeur })}
            style={styles.champ}
          />

          <Text style={styles.libelle}>{t('menuImport.priceLabel')}</Text>
          <TextInput
            accessibilityLabel={`${t('menuImport.priceLabel')} ${index + 1}`}
            value={ligne.price_cents}
            onChangeText={(valeur) => modifier(index, { price_cents: valeur })}
            keyboardType="number-pad"
            style={styles.champ}
          />

          <View style={styles.ligne}>
            <Text>{t('menuImport.bookable')}</Text>
            <Switch
              accessibilityLabel={`${t('menuImport.bookable')} ${index + 1}`}
              value={ligne.requires_booking}
              onValueChange={(valeur) => modifier(index, { requires_booking: valeur })}
            />
          </View>

          {ligne.requires_booking ? (
            <>
              <Text style={styles.libelle}>{t('menuImport.durationLabel')}</Text>
              <TextInput
                accessibilityLabel={`${t('menuImport.durationLabel')} ${index + 1}`}
                value={ligne.duration_minutes}
                onChangeText={(valeur) => modifier(index, { duration_minutes: valeur })}
                keyboardType="number-pad"
                style={styles.champ}
              />
              <Text style={styles.aide}>{t('menuImport.durationHint')}</Text>
            </>
          ) : null}

          <View style={styles.ligne}>
            <Text>{ligne.retenue ? t('menuImport.keep') : t('menuImport.drop')}</Text>
            <Switch
              accessibilityLabel={`${t('menuImport.keep')} ${index + 1}`}
              value={ligne.retenue}
              onValueChange={(valeur) => modifier(index, { retenue: valeur })}
            />
          </View>
        </View>
      ))}

      {etat.state === 'refuse' ? (
        <Text style={styles.erreur}>{translateErrorCode(t, etat.code)}</Text>
      ) : null}

      {etat.state === 'fait' ? (
        <Text style={styles.fait}>{t('menuImport.validated', { count: etat.count })}</Text>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={valider}
          style={({ pressed }) => [styles.bouton, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Text>{t('menuImport.validate')}</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 24, gap: 16 },
  titre: { fontSize: 22, fontWeight: '600' },
  aide: { fontSize: 13, color: '#555' },
  carte: { padding: 16, borderRadius: 8, borderWidth: 1, borderColor: '#ddd', gap: 8 },
  alerte: { color: '#8a6d00', fontWeight: '600' },
  libelle: { fontWeight: '600' },
  champ: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10 },
  ligne: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bouton: { padding: 14, borderRadius: 8, backgroundColor: '#dde', alignItems: 'center' },
  erreur: { color: '#a11' },
  fait: { color: '#136c3a', fontWeight: '600' },
});
