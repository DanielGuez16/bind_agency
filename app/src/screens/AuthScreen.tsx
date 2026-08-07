/**
 * Connexion et inscription, sur le même écran.
 *
 * **Un seul écran plutôt que deux.** Ce sont les mêmes deux champs, et la seule
 * différence est un rôle à choisir. Deux écrans obligeraient à naviguer entre
 * eux au moment précis où quelqu'un s'est trompé de porte.
 *
 * **Le rôle administrateur ne se choisit pas.** L'API l'accepte, mais l'offrir
 * dans un formulaire public ferait de « administrateur » une case à cocher.
 * Ces comptes se créent autrement.
 *
 * **Le motif de sortie s'affiche ici**, parce que c'est ici qu'on revient :
 * session expirée, compte suspendu, déconnexion. Un écran de connexion muet
 * après une expiration laisse croire à un bug.
 */
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { useApi } from '../api';
import {
  Apparition,
  Button,
  Chip,
  Marque,
  RangeeDeChips,
  StatusMessage,
  TextField,
  Texte,
} from '../components';
import { useI18n } from '../i18n';
import { useSession, type MotifDeSortie, type RoleInscriptible } from '../session';
import { useTheme } from '../theme';

const MESSAGE_DE_SORTIE: Record<MotifDeSortie, { cle: string; niveau: 'danger' | 'neutral' }> = {
  session_expiree: { cle: 'auth.sessionExpiree', niveau: 'neutral' },
  compte_suspendu: { cle: 'auth.compteSuspendu', niveau: 'danger' },
  deconnexion: { cle: 'auth.deconnexion', niveau: 'neutral' },
};

export function AuthScreen({ motif }: { motif: MotifDeSortie | null }) {
  const { t } = useI18n();
  const { color: c, density } = useTheme();
  const { messageDErreur } = useApi();
  const { connecter, inscrire } = useSession();

  const [inscription, setInscription] = useState(false);
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [role, setRole] = useState<RoleInscriptible>('creator');
  const [envoi, setEnvoi] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);

  async function valider() {
    setEnvoi(true);
    setEchec(null);
    try {
      if (inscription) await inscrire(email.trim(), motDePasse, role);
      else await connecter(email.trim(), motDePasse);
    } catch (erreur) {
      // Le catalogue traduit : `invalid_credentials` dit « identifiants
      // incorrects », jamais « 401 ».
      setEchec(messageDErreur(erreur));
    } finally {
      setEnvoi(false);
    }
  }

  const sortie = motif ? MESSAGE_DE_SORTIE[motif] : null;
  const complet = email.includes('@') && motDePasse.length >= 12;

  return (
    <ScrollView
      testID="ecran-auth"
      style={{ flex: 1, backgroundColor: c['bg.canvas'] }}
      contentContainerStyle={{
        padding: density.screenPadding,
        gap: 16,
        flexGrow: 1,
        justifyContent: 'center',
        maxWidth: 480,
        width: '100%',
        alignSelf: 'center',
      }}
      keyboardShouldPersistTaps="handled"
    >
      {/* La marque en grand : c'est le premier écran, et le seul endroit où
          l'on a la place de la montrer. Ailleurs, le signe seul suffit. */}
      <Apparition>
        <View style={{ alignItems: 'flex-start', gap: 18, paddingBottom: 6 }}>
          <Marque taille={44} />
          <Texte variante="type.display">
            {inscription ? t('auth.titreInscription') : t('auth.titreConnexion')}
          </Texte>
        </View>
      </Apparition>

      {/* Pourquoi on est revenu ici. Effacé dès qu'on saisit quelque chose. */}
      {sortie && !echec && email === '' ? (
        <StatusMessage level={sortie.niveau} body={t(sortie.cle)} testID="motif-de-sortie" />
      ) : null}

      <TextField
        label={t('auth.email')}
        value={email}
        onChangeText={setEmail}
        keyboard="default"
        testID="champ-email"
      />
      <TextField
        label={t('auth.motDePasse')}
        value={motDePasse}
        onChangeText={setMotDePasse}
        helpText={t('auth.motDePasseAide')}
        testID="champ-mot-de-passe"
      />

      {inscription ? (
        <View style={{ gap: 6 }}>
          <Texte variante="type.label" couleur="text.secondary">
            {t('auth.role')}
          </Texte>
          <RangeeDeChips>
            <Chip
              label={t('auth.roleCreator')}
              selected={role === 'creator'}
              onPress={() => setRole('creator')}
            />
            <Chip
              label={t('auth.roleMerchant')}
              selected={role === 'business_member'}
              onPress={() => setRole('business_member')}
            />
          </RangeeDeChips>
        </View>
      ) : null}

      {echec ? <StatusMessage level="danger" body={echec} testID="echec-auth" /> : null}

      {/* Retiré tant que la saisie est incomplète : le griser demanderait de
          deviner ce qui manque, et l'aide sous le champ le dit déjà. */}
      {complet ? (
        <Button
          label={inscription ? t('auth.sInscrire') : t('auth.seConnecter')}
          loadingLabel={
            inscription ? t('auth.inscriptionEnCours') : t('auth.connexionEnCours')
          }
          size="lg"
          loading={envoi}
          onPress={valider}
          testID="valider"
        />
      ) : null}

      <Button
        label={inscription ? t('auth.versConnexion') : t('auth.versInscription')}
        variant="ghost"
        onPress={() => {
          setInscription(!inscription);
          setEchec(null);
        }}
        testID="basculer"
      />
    </ScrollView>
  );
}
