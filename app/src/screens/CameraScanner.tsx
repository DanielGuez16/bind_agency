/**
 * Le scanner réel, celui qui parle à la caméra.
 *
 * **Non vérifié.** Ni un test ni un simulateur ne fournissent de caméra : ce
 * fichier ne peut être éprouvé que sur un appareil. Il est donc volontairement
 * mince, et tout ce qui pouvait être testé — la saisie, la vérification, le
 * service, l'enchaînement — vit ailleurs, derrière l'interface `Scanner`.
 *
 * Ce qu'il reste à valider à la main : l'autorisation refusée puis accordée, un
 * QR lu à contre-jour, et le fait qu'une seule lecture parte par présentation.
 */
import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

import { useI18n } from '../i18n';

export function CameraScanner({
  onCode,
  indisponible,
}: {
  onCode: (valeur: string) => void;
  indisponible: () => void;
}) {
  const { t } = useI18n();
  const [permission, demander] = useCameraPermissions();

  // Un QR reste dans le champ plusieurs dizaines d'images : sans cette garde,
  // la caisse enverrait une rafale de vérifications pour une seule
  // présentation, et la limite de tentatives se refermerait toute seule.
  const dejaLu = useRef(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      void demander();
    }
  }, [permission, demander]);

  if (!permission) {
    return <View style={styles.cadre} />;
  }

  if (!permission.granted) {
    // On ne bloque pas : la saisie manuelle est le chemin de premier rang, et
    // c'est vers elle qu'on renvoie.
    return (
      <View style={styles.cadre}>
        <Text style={styles.aide}>{t('redemption.cameraDenied')}</Text>
      </View>
    );
  }

  return (
    <CameraView
      style={styles.cadre}
      barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      onMountError={indisponible}
      onBarcodeScanned={({ data }) => {
        if (dejaLu.current) return;
        dejaLu.current = true;
        onCode(data);
      }}
    />
  );
}

const styles = StyleSheet.create({
  cadre: { height: 280, borderRadius: 12, overflow: 'hidden', backgroundColor: '#111' },
  aide: { color: '#eee', padding: 16 },
});
