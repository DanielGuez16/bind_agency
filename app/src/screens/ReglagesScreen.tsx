/**
 * Réglages : langue, thème, session, et le diagnostic de connexion.
 *
 * **L'écran de santé vit ici**, plus dans la navigation principale. Il sert à
 * répondre à « est-ce que ça marche », question qu'on se pose quand quelque
 * chose ne marche pas — pas un onglet permanent.
 *
 * **La bascule de thème existe mais ne change pas la densité.** Quelqu'un peut
 * préférer le sombre au comptoir ; il n'en devient pas créateur pour autant, et
 * les listes restent denses.
 *
 * **Le stockage des jetons est affiché.** Sur le web il n'y a pas de trousseau,
 * et le dire à l'écran vaut mieux que de laisser croire que le navigateur
 * protège comme un téléphone.
 */
import { ScrollView, View } from 'react-native';

import { Button, Chip, DataRow, RangeeDeChips, Texte } from '../components';
import { useI18n, type SupportedLocale } from '../i18n';
import { trousseauDisponible, useSession } from '../session';
import { useTheme, type ThemeName } from '../theme';
import { adresseDeLApi, origineDeLAdresse } from '../shell/adresseDeLApi';
import { HealthScreen } from './HealthScreen';

export function ReglagesScreen() {
  const { t, locale, setLocale } = useI18n();
  const { name, override, setOverride, color: c, density } = useTheme();
  const session = useSession();

  const email = session.etat === 'connecte' ? (session.utilisateur.email ?? '') : '';
  const role = session.etat === 'connecte' ? session.utilisateur.role : '';

  return (
    <ScrollView
      testID="ecran-reglages"
      style={{ flex: 1, backgroundColor: c['bg.canvas'] }}
      contentContainerStyle={{ padding: density.screenPadding, gap: 20 }}
    >
      <Texte variante="type.display">{t('reglages.titre')}</Texte>

      <View>
        <Texte variante="type.label" couleur="text.secondary">
          {t('reglages.compte')}
        </Texte>
        <DataRow label={t('auth.email')} value={email} />
        <DataRow label={t('auth.role')} value={role} />
        <DataRow label={t('reglages.adresse')} value={adresseDeLApi() ?? '—'} />
        <DataRow label={t('reglages.adresseOrigine')} value={origineDeLAdresse()} />
        <DataRow
          label={t('reglages.stockage')}
          value={
            trousseauDisponible ? t('reglages.stockageSecurise') : t('reglages.stockageWeb')
          }
        />
      </View>

      <View style={{ gap: 8 }}>
        <Texte variante="type.label" couleur="text.secondary">
          {t('reglages.langue')}
        </Texte>
        <RangeeDeChips>
          {(['en', 'es'] as SupportedLocale[]).map((code) => (
            <Chip
              key={code}
              label={t(code === 'en' ? 'reglages.langueEn' : 'reglages.langueEs')}
              selected={locale === code}
              onPress={() => setLocale(code)}
            />
          ))}
        </RangeeDeChips>
      </View>

      <View style={{ gap: 8 }}>
        <Texte variante="type.label" couleur="text.secondary">
          {t('reglages.theme')}
        </Texte>
        <RangeeDeChips>
          <Chip
            label={t('reglages.themeRole')}
            selected={override === null}
            onPress={() => setOverride(null)}
          />
          {(['dark', 'light'] as ThemeName[]).map((theme) => (
            <Chip
              key={theme}
              label={t(theme === 'dark' ? 'reglages.themeDark' : 'reglages.themeLight')}
              selected={override === theme && name === theme}
              onPress={() => setOverride(theme)}
            />
          ))}
        </RangeeDeChips>
      </View>

      <View style={{ gap: 8 }}>
        <Texte variante="type.label" couleur="text.secondary">
          {t('reglages.diagnostic')}
        </Texte>
        {/* Le titre seul ne disait pas à quoi il sert. Un bloc dont on ne
            comprend pas l'usage vaut moins que pas de bloc du tout. */}
        <Texte variante="type.caption" couleur="text.muted">
          {t('reglages.diagnosticAide')}
        </Texte>
        {/* L'écran de santé, relégué ici. Il n'a jamais eu sa place dans une
            navigation quotidienne. */}
        <View style={{ borderRadius: 12, overflow: 'hidden' }} testID="diagnostic">
          <HealthScreen />
        </View>
      </View>

      <Button
        label={t('reglages.seDeconnecter')}
        variant="danger"
        onPress={() => void session.deconnecter()}
        testID="se-deconnecter"
      />
    </ScrollView>
  );
}
