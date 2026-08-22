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

import { ApiError, useApi } from '../api';
import { Button, Chip, DataRow, Filet, RangeeDeChips, Texte } from '../components';
import { formatDate } from '../format';
import { useI18n, type SupportedLocale } from '../i18n';
import { trousseauDisponible, useSession } from '../session';
import { useTheme } from '../theme';
import { SelecteurDeSalon } from '../shell/SelecteurDeSalon';
import { useMonCommerce } from '../shell/useMonCommerce';
import { HealthScreen } from './HealthScreen';

/** Le fuseau du téléphone, résolu une fois. */
const FUSEAU_DE_L_APPAREIL = Intl.DateTimeFormat().resolvedOptions().timeZone;
import { NotificationsDeCetAppareil } from './reglages/NotificationsDeCetAppareil';
import { PauseDuCommerce } from './reglages/PauseDuCommerce';
import { RepriseDuCompte } from './reglages/RepriseDuCompte';
import { compterOuRien, PAGE } from './reglages/suppression';

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

      {/* **Le choix du salon, pour qui en a deux.** La barre latérale le porte
          aussi, mais elle n'existe qu'en bureau : sur un téléphone, ce serait
          le seul endroit où changer de salon. Un gérant qui rattache une
          seconde adresse doit pouvoir l'ouvrir depuis l'appareil qu'il a en
          main, et c'est le comptoir qui décide lequel. */}
      <SelecteurDeSalonDeCeCompte />

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

      {/* **La vitrine, et rien d'autre du commerce.** Composer son offre reste
          dans la configuration ; fermer sa vitrine appartient à la famille des
          gestes qui engagent le compte, avec la déconnexion et la suppression.
          Elle a atterri ici parce que la v3 retire la section qui la portait. */}
      {/* **Les notifications de cet appareil, pour tout le monde.** Créatrice
          ou salon, c'est le même téléphone et le même besoin : pouvoir les
          couper sans passer par les réglages du système. */}
      <NotificationsDeCetAppareil />

      {role === 'business_member' ? <PauseDuCommerce /> : null}

      {/* **Ce que le salon lit des reprises faites chez lui.** La route
          existait, personne ne l'appelait, et la promesse « le salon en est
          prévenu » ne se vérifiait nulle part. */}
      {role === 'business_member' ? <RepriseDuCompte /> : null}

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
 * Le choix du salon, quand la session est celle d'un commerce.
 *
 * **Rendu seulement là où il a un sens.** Une créatrice n'a pas de salon, et un
 * gérant qui n'en a qu'un n'a rien à choisir — le sélecteur se tait de
 * lui-même dans les deux cas, plutôt que d'occuper la place d'un réglage.
 */
function SelecteurDeSalonDeCeCompte() {
  const session = useSession();
  const commerce = session.etat === 'connecte' && session.utilisateur.role === 'business_member';
  if (!commerce) return null;
  return <SelecteurDansLesReglages />;
}

function SelecteurDansLesReglages() {
  const { commerces, businessId, choisir } = useMonCommerce();
  return (
    <SelecteurDeSalon
      commerces={commerces}
      choisi={businessId}
      onChoisir={choisir}
      testID="selecteur-de-salon-reglages"
    />
  );
}

/**
 * La suppression de compte, branchée.
 *
 * **Deux états, et le second n'est pas un message d'erreur.** Aucune demande en
 * cours : les conséquences, puis le bouton. Une demande ouverte : l'échéance, et
 * de quoi revenir. Le second n'est pas une variante du premier — le compte est
 * toujours actif, tout marche encore, et c'est précisément ce que le délai de
 * trente jours existe pour offrir.
 *
 * **Rien ne demande de confirmer, et c'est le délai qui le permet.** Une boîte
 * « êtes-vous sûre ? » par-dessus une décision déjà réversible pendant un mois
 * ajouterait une friction là où la vraie garantie est ailleurs : les
 * conséquences se lisent au-dessus du bouton, et le retour reste ouvert
 * jusqu'à l'échéance. C'est le report qui tient lieu de confirmation.
 *
 * **Le refus dit combien il en reste.** Le 409 porte le code seul ; l'écran
 * compte les contreparties depuis la liste qu'il sait déjà lire. « Il vous
 * reste deux publications » se traite ; « vous avez des contreparties » se
 * subit. Quand la page est pleine — donc possiblement tronquée — on retombe sur
 * la phrase du catalogue plutôt que d'annoncer un nombre faux.
 */
function BlocDeSuppression() {
  const { t, locale } = useI18n();
  const { color: c } = useTheme();
  const session = useSession();
  const { api, messageDErreur } = useApi();

  const [enCours, setEnCours] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);

  const echeance = session.etat === 'connecte' ? session.utilisateur.deletion_effective_at : null;

  /**
   * Ce que le 409 ne dit pas. Nul quand on ne peut pas l'affirmer : une page
   * pleine peut en cacher d'autres, et un nombre faux vaut moins que pas de
   * nombre.
   */
  const compterLesRestantes = async (): Promise<number | null> => {
    try {
      const historique = await api.mesReservations({ limite: PAGE });
      return compterOuRien(historique.items);
    } catch {
      return null;
    }
  };

  const agir = async (quoi: 'demander' | 'annuler') => {
    setEchec(null);
    setEnCours(true);
    try {
      if (quoi === 'demander') await session.demanderLaSuppression();
      else await session.annulerLaSuppression();
    } catch (cause) {
      const bloquee =
        cause instanceof ApiError && cause.code === 'deletion_blocked_by_collaboration';
      const restantes = bloquee ? await compterLesRestantes() : null;
      setEchec(
        restantes === null
          ? messageDErreur(cause)
          : restantes === 1
            ? t('reglages.supprimerBloqueUne')
            : t('reglages.supprimerBloque', { count: restantes }),
      );
    } finally {
      setEnCours(false);
    }
  };

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
        {t(echeance ? 'reglages.supprimerEnCoursTitre' : 'reglages.supprimerTitre')}
      </Texte>

      <Texte variante="type.caption" couleur="ink.soft" testID="suppression-consequences">
        {echeance
          ? t('reglages.supprimerEnCoursCorps', {
              // **Le fuseau de l'appareil, et non celui d'un commerce.** La
              // règle du produit convertit sur le fuseau du salon parce que
              // tout le reste s'y passe ; cette échéance-ci n'appartient à
              // aucun salon, elle appartient au compte. La lire à Miami quand
              // on est à Madrid ferait tomber la date un jour à côté.
              quand: formatDate(echeance, locale, FUSEAU_DE_L_APPAREIL),
            })
          : t('reglages.supprimerCorps')}
      </Texte>

      {echeance ? (
        // Le retour est neutre : c'est la commande qui **ne** supprime pas, et
        // la peindre en cramoisi mettrait la même alarme sur les deux gestes.
        <Button
          label={t('reglages.supprimerAnnuler')}
          variant="secondary"
          loading={enCours}
          onPress={() => void agir('annuler')}
          testID="annuler-la-suppression"
        />
      ) : (
        <Button
          label={t('reglages.supprimerAction')}
          variant="danger"
          loading={enCours}
          onPress={() => void agir('demander')}
          testID="supprimer-mon-compte"
        />
      )}

      {echec ? (
        <Texte variante="type.caption" couleur="status.danger.text" testID="suppression-echec">
          {echec}
        </Texte>
      ) : null}
    </View>
  );
}
