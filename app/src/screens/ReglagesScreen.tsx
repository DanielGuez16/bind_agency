/**
 * Réglages : langue, thème, session, et le diagnostic de connexion.
 *
 * **L'écran de santé vit ici**, plus dans la navigation principale. Il sert à
 * répondre à « est-ce que ça marche », question qu'on se pose quand quelque
 * chose ne marche pas — pas un onglet permanent.
 *
 * **La bascule de thème a disparu avec la v1.0.** La direction BIND AGENCY ne
 * livre qu'un jeu de couleurs et met les trois rôles en clair ; les deux seuls
 * écrans qui restent sombres — le code de retrait et la galerie plein écran —
 * sont déclarés hors système et portent leurs couleurs eux-mêmes. Un
 * interrupteur qui ne commande rien fait douter des trois autres réglages de
 * cet écran, et c'est pour la même raison qu'on vérifie ailleurs que chaque
 * genre de notification est commandé par au moins une clé. `tokens.json` porte
 * encore `theme.userOverride: true` : la contradiction est remontée à la
 * direction artistique, pas tranchée ici.
 *
 * **Le stockage des jetons est affiché.** Sur le web il n'y a pas de trousseau,
 * et le dire à l'écran vaut mieux que de laisser croire que le navigateur
 * protège comme un téléphone.
 */
import { ScrollView, View } from 'react-native';

import { Button, Chip, DataRow, RangeeDeChips, Texte } from '../components';
import { useI18n, type SupportedLocale } from '../i18n';
import { useSession } from '../session';
import { radius, useTheme } from '../theme';
import { HealthScreen } from './HealthScreen';
import { PreferencesDeNotification } from './PreferencesDeNotification';

export function ReglagesScreen() {
  const { t, locale, setLocale } = useI18n();
  const { color: c, density } = useTheme();
  const session = useSession();

  const email = session.etat === 'connecte' ? (session.utilisateur.email ?? '') : '';
  const role = session.etat === 'connecte' ? session.utilisateur.role : '';

  return (
    <ScrollView
      testID="ecran-reglages"
      style={{ flex: 1, backgroundColor: c['bg.page'] }}
      contentContainerStyle={{ padding: density.screenPadding, gap: 20 }}
    >
      <Texte variante="type.screenTitle">{t('reglages.titre')}</Texte>

      <View>
        <Texte variante="type.label" couleur="ink.soft">
          {t('reglages.compte')}
        </Texte>
        <DataRow label={t('auth.email')} value={email} />
        {/* Le rôle traduit, jamais son code. « business_member » sous les yeux
            d'un commerçant est une chaîne oubliée — c'en était une. */}
        <DataRow label={t('auth.role')} value={role ? t(`roles.${role}`) : ''} />
      </View>

      {/* **Les notifications se règlent ici**, à côté de la langue et du
          thème : ce sont les trois choses qu'on vient chercher dans un écran
          de réglages. Le composant ne rend rien pour un rôle qui n'a aucun
          genre — l'administration n'en reçoit pas. */}
      <PreferencesDeNotification role={role} />

      <View style={{ gap: 8 }}>
        <Texte variante="type.label" couleur="ink.soft">
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
        <Texte variante="type.label" couleur="ink.soft">
          {t('reglages.diagnostic')}
        </Texte>
        {/* Le titre seul ne disait pas à quoi il sert. Un bloc dont on ne
            comprend pas l'usage vaut moins que pas de bloc du tout. */}
        <Texte variante="type.caption" couleur="ink.mute">
          {t('reglages.diagnosticAide')}
        </Texte>
        {/* L'écran de santé, relégué ici. Il n'a jamais eu sa place dans une
            navigation quotidienne. */}
        <View style={{ borderRadius: radius['radius.none'], overflow: 'hidden' }} testID="diagnostic">
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
