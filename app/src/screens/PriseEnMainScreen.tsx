/**
 * La prise en main d'une fiche préparée au comptoir.
 *
 * **Le seul écran du produit qui s'ouvre sans compte.** Le gérant arrive par un
 * lien — un QR scanné sur la tablette de la fondatrice, ou un message reçu
 * parce qu'il n'était pas au salon ce jour-là. Il n'a rien, pas même une
 * adresse enregistrée quelque part : c'est le jeton qui autorise, et lui seul.
 *
 * **On montre avant de demander.** Ce qui a été préparé en son nom s'affiche
 * d'abord — le nom du salon, l'adresse, combien de prestations ont été relevées
 * de sa carte. Demander un mot de passe avant d'avoir prouvé qu'on parle bien
 * de *son* salon, c'est demander à quelqu'un de s'engager envers une page qu'il
 * ne reconnaît pas.
 *
 * **Trois champs, pas un de plus.** Adresse, mot de passe, conditions. Tout le
 * reste a été saisi au comptoir, et le redemander ferait exactement ce que ce
 * dispositif existe pour éviter.
 *
 * **Il ne repart pas connecté.** La prise en main rend la fiche, pas une
 * session : un lien qui ouvrirait une session serait un mot de passe qui
 * circule dans un SMS. Il se connecte ensuite, avec ce qu'il vient de choisir —
 * et le premier geste dans l'application est celui qu'il refera tous les jours.
 */
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { useApi, type ApercuDeLaFiche } from '../api';
import { Button, Marque, StatusMessage, TextField, Texte, Toggle } from '../components';
import { useI18n } from '../i18n';
import { radius, useColors } from '../theme';
import { useRequete } from './useRequete';

/** Le minimum imposé par l'API. */
const CARACTERES_REQUIS = 8;

const FORMULAIRE = 480;

export function PriseEnMainScreen({
  jeton,
  onTermine,
}: {
  jeton: string;
  /** Vers la connexion, avec l'adresse déjà remplie. */
  onTermine: (email: string) => void;
}) {
  const { t } = useI18n();
  const c = useColors();
  const { api, messageDErreur } = useApi();

  const requete = useRequete<ApercuDeLaFiche>(
    (signal) => api.apercuDeLaPriseEnMain(jeton, signal),
    { estVide: () => false, dependances: [jeton] },
  );

  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [accepte, setAccepte] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);

  async function assumer(apercu: ApercuDeLaFiche) {
    setEchec(null);
    setEnCours(true);
    try {
      await api.prendreEnMain(jeton, {
        email: email.trim(),
        motDePasse,
        // **La version que cet écran a montrée**, pas celle en vigueur au
        // moment de l'envoi. Un lien ouvert la semaine dernière montre les
        // conditions de la semaine dernière, et le serveur refuse l'écart.
        versionDesConditions: apercu.terms_version,
      });
      onTermine(email.trim());
    } catch (erreur) {
      setEchec(messageDErreur(erreur));
    } finally {
      setEnCours(false);
    }
  }

  if (requete.etat === 'chargement') {
    return (
      <View
        testID="prise-en-main-chargement"
        style={{ flex: 1, justifyContent: 'center', padding: 24 }}
      >
        <Texte variante="type.body" couleur="text.secondary">
          {t('priseEnMain.chargement')}
        </Texte>
      </View>
    );
  }

  /**
   * **Un lien mort ne dit pas pourquoi il est mort.** Inconnu, expiré, déjà
   * utilisé, révoqué : le serveur ne les distingue pas, et l'écran non plus.
   * Ce qu'il donne à la place est la seule chose utile — à qui redemander.
   */
  if (requete.etat === 'erreur' || !requete.donnees) {
    return (
      <View
        testID="prise-en-main-lien-mort"
        style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 12 }}
      >
        <Marque />
        <Texte variante="type.title">{t('priseEnMain.lienMort')}</Texte>
        <Texte variante="type.body" couleur="text.secondary">
          {t('priseEnMain.lienMortAide')}
        </Texte>
      </View>
    );
  }

  const apercu = requete.donnees;
  const complet =
    email.trim().length > 3 && motDePasse.length >= CARACTERES_REQUIS && accepte;

  return (
    <ScrollView
      testID="ecran-prise-en-main"
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
      }}
    >
      <View style={{ width: '100%', maxWidth: FORMULAIRE, gap: 20 }}>
        <Marque />

        {/* Ce qui a été préparé. **Avant tout ce qu'on demande.** */}
        <View
          testID="fiche-preparee"
          style={{
            gap: 8,
            padding: 16,
            borderRadius: radius['radius.md'],
            backgroundColor: c['bg.surface'],
            borderWidth: 1,
            borderColor: c['border.subtle'],
          }}
        >
          <Texte variante="type.label" couleur="text.secondary">
            {t('priseEnMain.preparePourVous')}
          </Texte>
          <Texte variante="type.title">{apercu.business_name}</Texte>
          {apercu.address ? (
            <Texte variante="type.body" couleur="text.secondary">
              {apercu.address}
            </Texte>
          ) : null}
          <Texte variante="type.caption" couleur="text.muted" testID="ce-qui-est-pret">
            {t('priseEnMain.ceQuiEstPret', {
              prestations: apercu.prestations_preparees,
              plages: apercu.plages_preparees,
            })}
          </Texte>
        </View>

        <Texte variante="type.body" couleur="text.secondary">
          {t('priseEnMain.introduction')}
        </Texte>

        {echec ? (
          <StatusMessage level="danger" body={echec} testID="echec-prise-en-main" />
        ) : null}

        <TextField
          label={t('auth.email')}
          value={email}
          onChangeText={setEmail}
          testID="champ-email"
        />
        <TextField
          label={t('auth.motDePasse')}
          value={motDePasse}
          onChangeText={setMotDePasse}
          secret
          labelRevelation={{
            montrer: t('auth.montrerLeMotDePasse'),
            masquer: t('auth.masquerLeMotDePasse'),
          }}
          helpText={t('priseEnMain.aideMotDePasse', { minimum: CARACTERES_REQUIS })}
          testID="champ-mot-de-passe"
        />

        {/* **Une bascule, pas une case pré-cochée.** Ce qui est accepté ici est
            écrit au journal avec la version et l'instant ; une acceptation
            posée d'avance n'aurait aucune valeur le jour où on la produit. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            minHeight: 44,
          }}
        >
          <Texte style={{ flex: 1 }} variante="type.body">
            {t('priseEnMain.conditions', { version: apercu.terms_version })}
          </Texte>
          <Toggle
            value={accepte}
            onChange={setAccepte}
            accessibilityLabel={t('priseEnMain.conditions', { version: apercu.terms_version })}
            testID="bascule-conditions"
          />
        </View>

        <Button
          label={t('priseEnMain.assumer')}
          onPress={() => void assumer(apercu)}
          disabled={!complet}
          loading={enCours}
          loadingLabel={t('priseEnMain.enCours')}
          fullWidth
          testID="valider-prise-en-main"
        />

        {/* Ce que la fiche ne fait **pas** encore. Un salon qui croirait être
            en ligne chercherait ses réservations pendant deux jours. */}
        <Texte variante="type.caption" couleur="text.muted">
          {t('priseEnMain.pasEncoreEnLigne')}
        </Texte>
      </View>
    </ScrollView>
  );
}
