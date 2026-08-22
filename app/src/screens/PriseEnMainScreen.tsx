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
 *
 * ## Le gérant qui a déjà un compte
 *
 * **C'est le propriétaire de deux adresses, et l'écran le renvoyait s'inventer
 * une seconde identité.** La branche du jeton se rend **avant** la porte
 * d'authentification, quelle que soit la session : un gérant déjà connecté, qui
 * ouvre le lien de son second salon, recevait le formulaire de création de
 * compte. Lui refuser le lien parce que son adresse est connue l'obligeait à
 * s'en trouver une autre, et à tenir deux comptes pour deux salons.
 *
 * La route existait depuis le début — `POST /handover/{jeton}/attach`, un
 * compte commerce qui assume la fiche — et n'avait aucun appelant. Ce n'était
 * pas une capacité à écrire, c'était un écran à brancher.
 *
 * **Le compte se lit, il ne se demande pas.** Quand la session est celle d'un
 * commerce, l'écran montre la même fiche préparée et propose de la rattacher,
 * en nommant le compte : sans le nom, « rattacher à mon compte » demande de
 * deviner auquel. Les conditions restent — c'est le serveur qui les exige, et
 * la version montrée est celle qu'on accepte.
 *
 * **Un créateur ou un administrateur ne voit pas ce chemin**, et l'écran le dit
 * plutôt que d'offrir un bouton qui rendrait 403. Le lien est fait pour un
 * salon ; se déconnecter est le geste qui reste, et il est nommé.
 */
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { useApi, type ApercuDeLaFiche } from '../api';
import { Button, Marque, StatusMessage, TextField, Texte, Toggle } from '../components';
import { useI18n } from '../i18n';
import { useSession } from '../session';
import { elevationDeCarte, radius, useColors } from '../theme';
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

  const session = useSession();

  /**
   * Le compte en session, quand c'en est un de commerce.
   *
   * Nul dans les deux autres cas — anonyme, ou connecté sous un rôle qui ne
   * peut pas assumer une fiche. Les deux ne se traitent pas pareil : le premier
   * crée un compte, le second n'a rien à faire ici.
   */
  const commerceEnSession =
    session.etat === 'connecte' && session.utilisateur.role === 'business_member'
      ? session.utilisateur
      : null;
  const autreRole =
    session.etat === 'connecte' && session.utilisateur.role !== 'business_member';

  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [accepte, setAccepte] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);

  /** Rattacher : le compte existe, il n'y a que les conditions à recueillir. */
  async function rattacher(apercu: ApercuDeLaFiche) {
    setEchec(null);
    setEnCours(true);
    try {
      await api.rattacherLaFiche(jeton, apercu.terms_version);
      // Pas d'adresse à transmettre : la session est déjà ouverte, et l'appelant
      // ne fait qu'oublier le jeton pour laisser l'application reprendre.
      onTermine('');
    } catch (erreur) {
      setEchec(messageDErreur(erreur));
    } finally {
      setEnCours(false);
    }
  }

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
        <Texte variante="type.body" couleur="ink.soft">
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
        <Texte variante="type.section">{t('priseEnMain.lienMort')}</Texte>
        <Texte variante="type.body" couleur="ink.soft">
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
            borderRadius: radius['radius.lg'],
            backgroundColor: c['bg.surface'],
            borderWidth: 1,
            borderColor: c['line.default'],
            // « Un coin de 18 px sans ombre flotte au lieu de se poser » : passation §2.
            ...elevationDeCarte(),
          }}
        >
          <Texte variante="type.label" couleur="ink.soft">
            {t('priseEnMain.preparePourVous')}
          </Texte>
          <Texte variante="type.section">{apercu.business_name}</Texte>
          {apercu.address ? (
            <Texte variante="type.body" couleur="ink.soft">
              {apercu.address}
            </Texte>
          ) : null}
          {/* **L'écran ne dit jamais avoir lu ce qu'il n'a pas lu.**
              Un seul bloc, deux rendus selon ce que le dépouillement renvoie.
              La phrase unique annonçait « 0 prestation et 0 plage sont déjà
              là » à un gérant dont rien n'avait été relevé : elle affirmait une
              lecture qui n'avait pas eu lieu, sur le premier écran qu'il voit
              de BIND, et le seul qui doit lui donner envie de continuer.

              Les deux comptes sont traités séparément : une carte relevée sans
              horaires est le cas courant — la carte des prix est affichée au
              mur, les horaires sont sur la porte, et on ne photographie pas
              toujours les deux. */}
          <Texte variante="type.caption" couleur="ink.mute" testID="ce-qui-est-pret">
            {apercu.prestations_preparees > 0
              ? t('priseEnMain.prestationsPretes', {
                  prestations: apercu.prestations_preparees,
                })
              : t('priseEnMain.prestationsAVenir')}
          </Texte>
          {apercu.plages_preparees > 0 ? (
            <Texte variante="type.caption" couleur="ink.mute" testID="plages-pretes">
              {t('priseEnMain.plagesPretes', { plages: apercu.plages_preparees })}
            </Texte>
          ) : null}
        </View>

        {/* **Un rôle qui ne peut pas assumer une fiche le lit, plutôt que de
            découvrir un 403.** Le lien est fait pour un salon ; se déconnecter
            est le geste qui reste, et il est nommé plutôt que sous-entendu. */}
        {autreRole ? (
          <StatusMessage
            level="neutral"
            title={t('priseEnMain.mauvaisRoleTitre')}
            body={t('priseEnMain.mauvaisRoleCorps')}
            testID="mauvais-role"
          />
        ) : null}

        <Texte variante="type.body" couleur="ink.soft">
          {commerceEnSession ? t('priseEnMain.introductionRattachement') : t('priseEnMain.introduction')}
        </Texte>

        {echec ? (
          <StatusMessage level="danger" body={echec} testID="echec-prise-en-main" />
        ) : null}

        {commerceEnSession || autreRole ? null : (
        <>
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
        </>
        )}

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

        {/* **Le compte est nommé.** « Rattacher à mon compte » sans dire lequel
            demande de deviner — et c'est précisément la situation de quelqu'un
            qui en a deux. */}
        {commerceEnSession ? (
          <>
            <Texte variante="type.caption" couleur="ink.mute" testID="compte-en-session">
              {t('priseEnMain.connecteEnTantQue', { email: commerceEnSession.email ?? '' })}
            </Texte>
            <Button
              label={t('priseEnMain.rattacher')}
              onPress={() => void rattacher(apercu)}
              disabled={!accepte}
              loading={enCours}
              loadingLabel={t('priseEnMain.enCours')}
              fullWidth
              testID="rattacher-la-fiche"
            />
          </>
        ) : autreRole ? (
          // Ni l'un ni l'autre : le message ci-dessus dit ce qu'il faut faire,
          // et un formulaire sous lui ferait croire qu'il y a un moyen de
          // passer outre.
          null
        ) : (
          <Button
            label={t('priseEnMain.assumer')}
            onPress={() => void assumer(apercu)}
            disabled={!complet}
            loading={enCours}
            loadingLabel={t('priseEnMain.enCours')}
            fullWidth
            testID="valider-prise-en-main"
          />
        )}

        {/* Ce que la fiche ne fait **pas** encore. Un salon qui croirait être
            en ligne chercherait ses réservations pendant deux jours. */}
        <Texte variante="type.caption" couleur="ink.mute">
          {t('priseEnMain.pasEncoreEnLigne')}
        </Texte>
      </View>
    </ScrollView>
  );
}
