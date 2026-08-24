/**
 * 06 · Code de retrait. **Hors thème.**
 *
 * **Un seul appel par rotation.** Le serveur rend le code et le nombre de
 * secondes qui restent ; le décompte se pilote ici, à partir de cet instant, et
 * un nouvel appel n'a lieu qu'à l'expiration. La première version rappelait
 * l'API à chaque seconde écoulée à zéro et depuis un *updater* d'état — que
 * React exécute deux fois en développement — ce qui produisait une quinzaine
 * d'appels et remettait le décompte à zéro sans arrêt.
 *
 * **Rien ne tourne quand l'écran n'est pas visible.** Un onglet quitté laisse
 * l'écran monté ; sans cette garde, le minuteur continue et l'API reçoit des
 * appels pour un écran que personne ne regarde.
 *
 * **Le code affiché porte le nom de sa réservation.** Il n'est rendu que si
 * cette réservation est celle qu'on regarde. La première version gardait le
 * code et l'échéance dans deux emplacements séparés du numéro de réservation :
 * ouvrir une autre réservation depuis la liste réutilise l'écran sans le
 * démonter, l'échéance précédente n'était pas passée, donc rien n'était
 * redemandé — et toutes les réservations montraient le même code et le même QR.
 * Lier les trois dans une seule valeur rend l'erreur impossible à réécrire.
 *
 * **Le code tourne tout seul.** Il n'existe donc ni bouton de renouvellement —
 * en proposer un donnerait à croire qu'il faut agir, devant un écran qui se met
 * déjà à jour — ni état « expiré » : un code périmé est remplacé par le
 * suivant. Ce qui expire est le droit de consommer, et cela se dit ailleurs.
 *
 * **Hors ligne, le code reste affiché et valide.** La vérification se fait côté
 * salon. Effacer l'écran sur une perte de réseau laisserait quelqu'un devant
 * une caisse sans rien à montrer.
 *
 * **Mais un écran qui n'a rien à garder dit pourquoi.** La règle précédente
 * valait pour un code déjà à l'écran ; appliquée à l'ouverture, elle laissait
 * l'attente tourner sans fin — c'est ce qu'on voit sur une réservation dont le
 * droit a expiré, où le serveur refuse et où rien ne l'expliquait.
 */
import { useIsFocused } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { useApi, type CodeDeRetrait } from '../api';
import {
  Icone,
  Countdown,
  ManualCode,
  PickupCodeSurface,
  QrBlock,
  SkeletonBox,
  Texte,
} from '../components';
import { useI18n } from '../i18n';
import { codeColors } from '../theme';

export function CodeScreen({
  bookingId,
  onRetour,
  /** Injectés pour les tests, et pour le web où ils n'existent pas. */
  presentationAuComptoir,
}: {
  bookingId: string;
  /**
   * L'issue. Cet écran est hors thème et hors grille — pas de barre latérale,
   * pas de barre de titre, c'est voulu — mais « hors grille » ne veut pas dire
   * « sans sortie » : sur le web, où il n'y a ni geste de balayage ni bouton
   * système, on n'en sortait qu'en changeant d'onglet. Le contrôle vit donc sur
   * la surface elle-même, dans ses deux couleurs.
   */
  onRetour?: () => void;
  /**
   * Ce que l'appareil fait pendant qu'on présente le code : veille désactivée,
   * luminosité au maximum, et **les deux rendus en sortant**.
   *
   * Injecté plutôt qu'importé : c'est ce qui permet de l'éprouver sans
   * plateforme, et de ne rien allumer dans les écrans qui montent celui-ci
   * pour une autre raison. Le nom dit la situation et non l'un des deux
   * réglages — il s'appelait `garderEveille` et n'en couvrait donc que la
   * moitié.
   */
  presentationAuComptoir?: { activer: () => void; desactiver: () => void };
}) {
  const { api, messageDErreur } = useApi();
  const { t } = useI18n();
  const visible = useIsFocused();

  /**
   * Le code, sa réservation et son échéance, ensemble.
   *
   * L'échéance est dans la même valeur que le code parce qu'elle n'a de sens
   * que pour lui : séparées, l'une survivait à l'autre. `expireA` est un
   * instant d'horloge locale — un compteur qui descend se remet à zéro à
   * chaque rendu, une échéance non.
   */
  const [affiche, setAffiche] = useState<{
    bookingId: string;
    code: CodeDeRetrait;
    expireA: number;
  } | null>(null);
  const [restant, setRestant] = useState(0);

  /** Rien n'est affiché tant que le code n'est pas celui de cette réservation. */
  const courant = affiche?.bookingId === bookingId ? affiche : null;
  const code = courant?.code ?? null;

  /** Le refus du serveur, tant qu'aucun code n'est affiché. */
  const [echec, setEchec] = useState<string | null>(null);

  /** La réservation dont une lecture est en vol. Empêche de la doubler. */
  const enCours = useRef<string | null>(null);

  const relire = useCallback(async () => {
    if (enCours.current === bookingId) return;
    enCours.current = bookingId;
    try {
      const frais = await api.codeDeRetrait(bookingId);
      setEchec(null);
      setAffiche({
        bookingId,
        code: frais,
        // Une seconde au minimum : un serveur qui rendrait zéro ferait
        // redemander en boucle serrée, ce qui ne se voit pas en test.
        expireA: Date.now() + Math.max(1, frais.seconds_remaining) * 1000,
      });
      setRestant(frais.seconds_remaining);
    } catch (erreur) {
      // Hors ligne, un code déjà affiché reste valide côté salon jusqu'à sa
      // rotation : on ne l'efface pas. Le message n'est rendu que s'il n'y a
      // rien à garder — c'est le rendu qui tranche, pas la capture.
      setEchec(messageDErreur(erreur));
    } finally {
      if (enCours.current === bookingId) enCours.current = null;
    }
  }, [api, bookingId]);

  useEffect(() => {
    if (!visible) return;
    presentationAuComptoir?.activer();
    return () => presentationAuComptoir?.desactiver();
  }, [presentationAuComptoir, visible]);

  useEffect(() => {
    if (!visible) return;

    // Un seul appel à l'ouverture, à l'expiration ensuite — et à l'ouverture
    // d'une autre réservation, où `courant` redevient nul.
    if (courant === null || Date.now() >= courant.expireA) void relire();

    const battement = setInterval(() => {
      if (courant === null) return;
      const reste = Math.max(0, Math.ceil((courant.expireA - Date.now()) / 1000));
      setRestant(reste);
      if (reste === 0) void relire();
    }, 1000);

    return () => clearInterval(battement);
  }, [courant, relire, visible]);

  return (
    // **`ecran-code` n'existait nulle part**, et le parcours de bout en bout
    // vérifiait pourtant qu'on n'y atterrit pas :
    // `expect(page.getByTestId('ecran-code')).toHaveCount(0)`. L'assertion ne
    // pouvait pas échouer — elle constatait l'absence de ce qui n'existe sur
    // aucun écran. Le même défaut que celui qui a motivé cette règle, une
    // seconde fois, et trouvé en la passant sur la suite.
    <PickupCodeSurface testID="ecran-code">
      {onRetour ? (
        <Pressable
          testID="retour"
          accessibilityRole="button"
          accessibilityLabel={t('common.retour')}
          hitSlop={16}
          onPress={onRetour}
          style={({ pressed }) => ({ position: 'absolute', top: 20, left: 20, flexDirection: 'row', gap: 6,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Icone nom="retour" teinte={codeColors.fg} taille={20} />
        </Pressable>
      ) : null}
      {code === null && echec !== null ? (
        <View testID="etat-refus" style={{ gap: 12, paddingHorizontal: 24 }}>
          <Texte variante="type.bodyStrong" align="center" style={{ color: codeColors.fg }}>
            {t('parcours.codeIndisponible')}
          </Texte>
          <Texte variante="type.body" align="center" style={{ color: codeColors.fg }}>
            {echec}
          </Texte>
        </View>
      ) : code === null ? (
        <View testID="etat-chargement" style={{ gap: 20, alignItems: 'center' }}>
          <SkeletonBox width={260} height={80} />
        </View>
      ) : (
        <View testID="etat-nominal" style={{ gap: 24 }}>
          <Texte
            variante="type.caption"
            align="center"
            style={{ color: codeColors.fg }}
            testID="titre-code"
          >
            {t('parcours.codeTitre')}
          </Texte>
          {/* **Le salon, et comment y aller.** L'écran ne disait rien de
              l'endroit : on y arrivait depuis une liste qui portait l'adresse,
              et cette adresse en est partie parce qu'elle y coûtait une ligne
              sur chaque carte pour un usage qui n'a lieu qu'ici. */}
          <View style={{ gap: 2 }} testID="ou-aller">
            <Texte variante="type.bodyStrong" align="center" style={{ color: codeColors.fg }}>
              {code.business_name}
            </Texte>
            {code.business_address ? (
              <Texte
                variante="type.caption"
                align="center"
                style={{ color: codeColors.fg, opacity: 0.7 }}
                testID="adresse"
              >
                {code.business_address}
              </Texte>
            ) : null}
          </View>
          {/* **Le nombre à six chiffres ne s'affiche plus.**
              Il ne se saisit pas, il ne désigne rien seul — il ne vaut qu'avec
              l'identifiant que porte le QR — et c'est précisément ce qui le
              faisait confondre avec le code de secours, qui se dicte : un
              commerçant a essayé de le taper. Une légende sous les chiffres ne
              suffisait pas ; ce qui trompe, c'est la forme, pas l'absence
              d'explication.

              Le QR le porte déjà. Ce qui reste à montrer, c'est que le code est
              **vivant** — et le décompte le dit sans ressembler à une saisie. */}
          <Countdown
            secondes={restant}
            // **`rotation_seconds` était servi et lu nulle part.** Sans lui, le
            // seuil d'urgence était un nombre de secondes fixe : le serveur
            // pouvait changer de cadence et le compte à rebours virer au rouge
            // en permanence, ou jamais.
            rotationSecondes={code.rotation_seconds}
            testID="compte-a-rebours"
          />
          {/* `code.payload` et non une composition locale : l'identifiant est
              celui du code, pas celui de la réservation, et l'API le forme
              déjà. Deux façons de l'assembler finissent par diverger — c'est
              arrivé, et le QR était refusé sans que rien ne le dise. */}
          <QrBlock contenu={code.payload} testID="qr" />
          <ManualCode code={code.manual_code} label={t('parcours.codeSecours')} testID="secours" />
          <Texte variante="type.caption" align="center" style={{ color: codeColors.fg }}>
            {t('parcours.codeSecoursAide')}
          </Texte>
        </View>
      )}
    </PickupCodeSurface>
  );
}
