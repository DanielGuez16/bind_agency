/**
 * L'entrée de la configuration du commerce.
 *
 * Trois portes, et rien d'autre : le catalogue, les horaires, le profil. Les
 * mettre côte à côte dans la barre d'onglets aurait ajouté deux onglets à une
 * barre qui en a déjà cinq, pour des écrans qu'on ouvre le premier jour puis
 * une fois par saison.
 *
 * **Chaque porte dit ce qu'elle ouvre.** Un libellé seul obligerait à entrer
 * pour savoir — sur un téléphone posé sur un comptoir, entre deux clientes,
 * c'est un aller-retour de trop.
 */
import { Pressable, View } from 'react-native';

import { Icone, Texte } from '../components';
import { useI18n } from '../i18n';
import { radius, useTheme } from '../theme';

export type PorteDeConfiguration = 'catalogue' | 'horaires' | 'activation';

const PORTES: { cle: PorteDeConfiguration; titre: string; corps: string }[] = [
  {
    cle: 'catalogue',
    titre: 'composition.entreeCatalogue',
    corps: 'composition.entreeCatalogueCorps',
  },
  {
    cle: 'horaires',
    titre: 'composition.entreeHoraires',
    corps: 'composition.entreeHorairesCorps',
  },
  {
    cle: 'activation',
    titre: 'composition.entreeActivation',
    corps: 'composition.entreeActivationCorps',
  },
];

export function ConfigurationScreen({
  onOuvrir,
}: {
  onOuvrir: (porte: PorteDeConfiguration) => void;
}) {
  const { t } = useI18n();
  const { color: c, density } = useTheme();

  return (
    <View
      style={{ flex: 1, backgroundColor: c['bg.canvas'] }}
      testID="ecran-configuration"
    >
      <View style={{ height: 3, backgroundColor: c['role.merchant'] }} />
      <View style={{ padding: density.screenPadding, gap: density.gap }}>
        <Texte variante="type.display">{t('composition.titre')}</Texte>

        {PORTES.map((porte) => (
          <Pressable
            key={porte.cle}
            accessibilityRole="button"
            onPress={() => onOuvrir(porte.cle)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              padding: 16,
              borderRadius: radius['radius.lg'],
              backgroundColor: c['bg.surface'],
              borderWidth: 1,
              borderColor: c['border.default'],
            }}
            testID={`ouvrir-${porte.cle}`}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Texte variante="type.label">{t(porte.titre)}</Texte>
              <Texte variante="type.caption" couleur="text.secondary">
                {t(porte.corps)}
              </Texte>
            </View>
            <Icone nom="chevron" couleur="text.muted" taille={18} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}
