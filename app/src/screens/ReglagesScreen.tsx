/**
 * Réglages du créateur : deux préférences, deux façons de partir.
 *
 * **Ce que la revue a dit.** « C'est moche, il y a trop de réglages, les
 * boutons sont colorés pour rien. » Les trois reproches ont la même cause :
 * l'écran empilait des choses de natures différentes dans une seule colonne,
 * au même poids, et coloriait des commandes pour compenser l'absence de
 * hiérarchie. La couleur remplaçait la structure.
 *
 * **Deux natures, donc deux régions.** Ce qu'on règle — la langue — se change
 * dix fois sans conséquence. Ce qui met fin — se déconnecter, supprimer son
 * compte — sort de l'application. Les empiler demandait à la lectrice de trier
 * elle-même à chaque passage. Un filet les sépare, et il porte à lui seul la
 * hiérarchie que quatre boutons colorés n'arrivaient pas à dire.
 *
 * **Un seul cramoisi, et il n'est pas sur un bouton.** La suppression est la
 * seule décision du produit qui ne se rouvre pas ; elle est donc la seule
 * teintée. Mais la teinte est sur le bloc, pas sur la commande — c'est
 * exactement le défaut relevé, un bouton coloré qui crie sans rien dire de
 * plus. Le bloc porte la nature, le bouton porte l'action. La déconnexion, qui
 * se défait en se reconnectant, reste neutre.
 *
 * **La bascule de thème a disparu avec la v1.0, et elle ne revient pas.** La
 * direction BIND AGENCY ne livre qu'un jeu de couleurs et met les trois rôles
 * en clair ; les deux seuls écrans qui restent sombres — le code de retrait et
 * la galerie plein écran — sont déclarés hors système et portent leurs couleurs
 * eux-mêmes. Un interrupteur qui ne commande rien fait douter des trois autres
 * réglages de cet écran, et c'est précisément le doute que la revue a exprimé.
 * Le réglage a été retiré des jetons dans la foulée — `theme.$userOverrideRetire`
 * en garde la trace — donc le remettre reviendrait à recréer la cause du
 * reproche en croyant le corriger.
 *
 * **Le diagnostic de connexion n'est plus un réglage.** C'est un outil de
 * développement, et il occupait à lui seul plus de place que les préférences
 * qu'une créatrice vient réellement changer : une bonne moitié du « trop de
 * réglages » tenait là. Il reste atteignable — un appui long sur la ligne de
 * stockage, en pied d'écran — parce qu'il sert le jour où un écran reste vide
 * et qu'il faut savoir si l'appareil joint BIND. Non découvrable et non perdu.
 *
 * **Le stockage des jetons est affiché, et il ne l'était pas.** L'en-tête de la
 * version précédente l'affirmait ; aucune ligne ne le rendait. Sur le web il
 * n'y a pas de trousseau, et le dire vaut mieux que de laisser croire que le
 * navigateur protège comme un téléphone.
 */
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Button, Chip, DataRow, Filet, RangeeDeChips, Texte } from '../components';
import { useI18n, type SupportedLocale } from '../i18n';
import { trousseauDisponible, useSession } from '../session';
import { useTheme } from '../theme';
import { HealthScreen } from './HealthScreen';

export function ReglagesScreen() {
  const { t, locale, setLocale } = useI18n();
  const { color: c, density } = useTheme();
  const session = useSession();

  // Le diagnostic, replié par défaut et sans affordance visible. L'état vit
  // ici et non dans une route : il n'a pas à survivre à la sortie de l'écran.
  const [diagnostic, setDiagnostic] = useState(false);

  const email = session.etat === 'connecte' ? (session.utilisateur.email ?? '') : '';
  const role = session.etat === 'connecte' ? session.utilisateur.role : '';

  return (
    <ScrollView
      testID="ecran-reglages"
      style={{ flex: 1, backgroundColor: c['bg.page'] }}
      contentContainerStyle={{ padding: density.screenPadding, gap: 28 }}
    >
      <Texte variante="type.screenTitle">{t('reglages.titre')}</Texte>

      {/* **Le compte n'est pas un réglage**, c'est ce qui dit dans quel compte
          on se trouve. Il ouvre l'écran pour cette raison : les deux régions
          qui suivent n'ont de sens qu'une fois cette question réglée. */}
      <View>
        <Texte variante="type.label" couleur="ink.soft">
          {t('reglages.compte')}
        </Texte>
        <DataRow label={t('auth.email')} value={email} />
        {/* Le rôle traduit, jamais son code. « business_member » sous les yeux
            d'un commerçant est une chaîne oubliée — c'en était une. */}
        <DataRow label={t('auth.role')} value={role ? t(`roles.${role}`) : ''} />
      </View>

      <View style={{ gap: 10 }} testID="preferences">
        <Texte variante="type.label" couleur="ink.soft">
          {t('reglages.preferences')}
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

      <Filet />

      <View style={{ gap: 14 }} testID="partir">
        <Texte variante="type.label" couleur="ink.soft">
          {t('reglages.partir')}
        </Texte>

        {/* Neutre, et c'est le sens de la commande : se déconnecter se défait
            en se reconnectant. La version précédente la peignait en `danger`,
            ce qui mettait la sortie de séance et la suppression définitive au
            même niveau d'alarme. */}
        <Button
          label={t('reglages.seDeconnecter')}
          variant="secondary"
          onPress={() => void session.deconnecter()}
          testID="se-deconnecter"
        />

        <BlocDeSuppression />
      </View>

      {/* Le pied. Technique, discret, et porteur du geste qui ouvre le
          diagnostic. Un appui long ne s'annonce pas : c'est ce qui le garde
          hors du chemin d'une créatrice tout en le laissant à portée du
          support. */}
      <View style={{ gap: 10 }}>
        <Pressable
          onLongPress={() => setDiagnostic((ouvert) => !ouvert)}
          delayLongPress={800}
          testID="ligne-stockage"
          // Le doigt reçoit une réponse, comme partout ailleurs. Huit cents
          // millisecondes sans rien qui bouge n'apprennent pas qu'on tient le
          // bon endroit — et l'appui bref, lui, n'ouvre rien. Ça ne rend pas le
          // geste découvrable pour autant : ce qui le cache, c'est l'apparence
          // au repos d'une ligne de pied en encre pâle, pas l'absence de retour.
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Texte variante="type.caption" couleur="ink.mute">
            {t('reglages.stockage')} ·{' '}
            {t(trousseauDisponible ? 'reglages.stockageSecurise' : 'reglages.stockageWeb')}
          </Texte>
        </Pressable>

        {diagnostic ? (
          <View testID="diagnostic">
            <HealthScreen />
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

/**
 * La suppression de compte.
 *
 * **Le bouton est inactif parce que la route n'existe pas encore.** Le service
 * d'anonymisation est écrit ; aucun routeur ne l'expose. `Button` réserve
 * `disabled` aux actions qui redeviendront possibles, et c'est le cas ici —
 * mais sa réserve tient à ce qu'un bouton grisé demande de deviner ce qui le
 * débloque. La phrase au-dessous supprime la devinette : elle dit que l'action
 * arrive. Sans elle, retirer le bouton vaudrait mieux que le griser.
 *
 * **Ce que la suppression fera est écrit maintenant**, avant d'être branché.
 * Une décision irréversible se lit avant d'être prise, pas dans la boîte de
 * confirmation qui la suit ; et les trois règles — anonymiser plutôt que
 * détruire, trente jours pour revenir, refus tant qu'une contrepartie court —
 * sont ce que la créatrice a besoin de savoir pour décider, pas des détails
 * d'implémentation.
 */
function BlocDeSuppression() {
  const { t } = useI18n();
  const { color: c } = useTheme();

  return (
    <View
      testID="bloc-suppression"
      style={{
        borderWidth: 1,
        borderColor: c['status.danger.rule'],
        backgroundColor: c['status.danger.surface'],
        padding: 14,
        gap: 10,
      }}
    >
      <Texte variante="type.bodyStrong" couleur="status.danger.text">
        {t('reglages.supprimerTitre')}
      </Texte>

      <Texte variante="type.caption" couleur="ink.soft" testID="suppression-consequences">
        {t('reglages.supprimerCorps')}
      </Texte>

      <Button
        label={t('reglages.supprimerAction')}
        variant="danger"
        disabled
        onPress={() => undefined}
        testID="supprimer-mon-compte"
      />

      <Texte variante="type.caption" couleur="ink.mute" testID="suppression-indisponible">
        {t('reglages.supprimerBientot')}
      </Texte>
    </View>
  );
}
