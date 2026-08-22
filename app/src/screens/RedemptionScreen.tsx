/**
 * Caisse : reconnaître un code, puis le servir.
 *
 * **Le scan est le chemin de premier rang**, la saisie son secours.
 *
 * L'inverse avait été retenu, et l'argument tenait : une caméra sale, un écran
 * fissuré, une lumière rasante arrivent dans un salon. Mais ce sont les mauvais
 * jours, et le geste ordinaire est de présenter un téléphone à un autre. Mettre
 * le secours au centre faisait taper six caractères à chaque passage pour se
 * prémunir d'un cas rare — et un scan qui échoue laisse toujours l'onglet
 * d'à côté, à un geste.
 *
 * Le secours reste donc **visible et à un seul geste** : c'est ce qui rend la
 * bascule acceptable. Ce n'est pas le scan seul avec un lien caché.
 *
 * **Vérifier et servir sont deux gestes.** La caisse voit ce qu'elle doit
 * servir, sert, puis confirme. Les fondre ferait déclarer servi ce qui ne l'est
 * pas encore, et `consumed` ne se défait pas.
 *
 * Le scanner est injecté. Le composant réel s'appuie sur la caméra, que ni un
 * test ni un simulateur ne fournissent : le rendre remplaçable est ce qui
 * permet d'éprouver tout le reste sans appareil.
 */
import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { Button } from '../components/Button';
import { PaveDeSaisie } from '../components/PaveDeSaisie';
import { SegmentedTabs } from '../components/SegmentedTabs';
import { EnTeteDEcran } from '../components';
import { Texte } from '../components/Texte';
import { TextField } from '../components/TextField';
import { useI18n } from '../i18n';
import { translateErrorCode } from '../i18n/errors';
import {
  ApiError,
  useApi,
  type JourneeDuCommerce,
  type ReservationDuCommerce,
  type Verification,
} from '../api';
import { formatDateTime } from '../format';
import { useGabarit } from '../shell/gabarit';
import { elevationDeCarte, radius, spacing, useColors } from '../theme';
import { useRequete } from './useRequete';

export type { Verification } from '../api';

type Etat =
  | { state: 'saisie' }
  | { state: 'verification' }
  | { state: 'reconnu'; verification: Verification }
  | { state: 'servi'; verification: Verification }
  // `injoignable` : la requête n'est jamais arrivée. Ce n'est pas un code
  // refusé, et le dire évite qu'un commerçant redemande dix fois son code à un
  // client alors que c'est le réseau ou l'adresse de l'API qui est en cause.
  | { state: 'refuse'; code: string | null; injoignable: boolean };

/** Ce que le scanner doit savoir faire. Rien de plus : une lecture, un texte. */
export type Scanner = ComponentType<{
  onCode: (valeur: string) => void;
  indisponible: () => void;
}>;

export function RedemptionScreen({
  scanner,
  businessId,
}: {
  scanner?: Scanner;
  /**
   * Le commerce dont on tient la caisse. Sert au panneau des validations du
   * jour, qui n'existe qu'en grand écran ; sans lui la caisse fonctionne
   * exactement comme avant.
   */
  businessId?: string;
}) {
  const { t } = useI18n();
  const c = useColors();
  const { large } = useGabarit();
  const { api } = useApi();

  const [etat, setEtat] = useState<Etat>({ state: 'saisie' });
  const [saisi, setSaisi] = useState('');
  // Le scan par défaut : c'est le geste ordinaire de la caisse. La saisie reste
  // l'onglet d'à côté, à un seul geste, pour les jours où la caméra ne suit pas.
  const [ongletScan, setOngletScan] = useState(true);

  const monte = useRef(true);
  useEffect(() => {
    monte.current = true;
    return () => {
      monte.current = false;
    };
  }, []);

  /**
   * Traduit ce qui a été levé en état d'écran.
   *
   * **Une erreur d'API et une panne de transport ne se disent pas pareil.** La
   * première nomme un refus — code déjà servi, code expiré — et la caisse doit
   * le lire. La seconde n'a rien appris du code : redemander dix fois le sien à
   * une cliente parce que le réseau du salon est tombé est ce que `injoignable`
   * existe pour éviter.
   *
   * **Un 401 ne passe plus par ici.** Le client fait tourner les jetons, rejoue,
   * et ferme la session s'il reprend un 401 : l'écran de connexion s'affiche
   * par-dessus la caisse. Avant, l'écran construisait ses requêtes avec un jeton
   * brut lu une fois à l'ouverture — au bout de quinze minutes il expirait, et
   * la caisse affichait « authentification requise » sans aucune issue.
   */
  const echoue = useCallback((cause: unknown): Etat => {
    if (cause instanceof ApiError) {
      return { state: 'refuse', code: cause.code, injoignable: false };
    }
    return { state: 'refuse', code: null, injoignable: true };
  }, []);

  const verifier = useCallback(
    async (code: string) => {
      if (!code.trim()) return;
      setEtat({ state: 'verification' });
      try {
        const verification = await api.verifierUnCode(code);
        if (monte.current) setEtat({ state: 'reconnu', verification });
      } catch (cause) {
        if (monte.current) setEtat(echoue(cause));
      }
    },
    [api, echoue],
  );

  const servir = useCallback(
    async (verification: Verification) => {
      setEtat({ state: 'verification' });
      try {
        await api.consommerUnCode(verification.redemption_code_id);
        if (monte.current) setEtat({ state: 'servi', verification });
      } catch (cause) {
        if (monte.current) setEtat(echoue(cause));
      }
    },
    [api, echoue],
  );

  const Scan = scanner;
  const refus = etat.state === 'refuse' ? etat : null;

  /**
   * La barre de caisse, sur encre.
   *
   * C'est le seul écran commerce qui se lit debout, à un mètre, entre deux
   * clientes : le contraste maximal y est un choix de lisibilité, pas de
   * décoration. Elle n'existe qu'en grand — sur un téléphone tenu en main, la
   * distance de lecture est celle de tous les autres écrans.
   */
  const barreDeCaisse = (
    <View
      testID="barre-de-caisse"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing['space.4'],
        padding: spacing['space.5'],
        borderRadius: radius['radius.lg'],
        backgroundColor: c['bg.inverse'],
      }}
    >
      {/* **La bande ne répète pas le titre, elle dit le moment.** Elle se lit
          debout à un mètre, entre deux clientes : ce qui sert à cette distance
          n'est pas le nom de la page — on est dessus — mais le geste qui
          commence. Le titre, lui, est au-dessus et répond à « où suis-je ». */}
      <Texte variante="type.bodyStrong" style={{ color: c['ink.onDark'] }}>
        {t('redemption.aLArrivee')}
      </Texte>
      {Scan ? (
        <Button
          label={t('redemption.scanTab')}
          variant="secondary"
          fullWidth={false}
          onPress={() => setOngletScan(true)}
          testID="ouvrir-le-scan"
        />
      ) : null}
    </View>
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c['bg.page'] }}
      contentContainerStyle={{ padding: spacing['space.6'], gap: spacing['space.4'] }}
    >
      {/* **Un titre, et ce que la page sert à faire.** La revue n'arrivait pas
          à dire si l'écran était l'arrivée ou le départ — « redeem a booking »
          nomme une mécanique interne, pas un moment du comptoir, et l'onglet
          disait « checkout », le mot qui en anglais veut dire *partir*. Les
          deux ensemble décrivaient la fin d'une visite là où c'est le début.
          Le titre dit maintenant le moment, et la ligne dessous dit les trois
          gestes dans leur ordre. */}
      <EnTeteDEcran titre={t('redemption.title')} testID="entete-caisse" />
      <Texte variante="type.body" couleur="ink.soft" testID="a-quoi-sert-la-caisse">
        {t('redemption.aQuoiSertCettePage')}
      </Texte>

      {large ? barreDeCaisse : null}

      {/* En grand écran, la caisse et son journal côte à côte. Le pavé occupait
          le tiers gauche et le reste était vide : la passation prévoyait ce
          panneau, il n'avait jamais été posé. */}
      <View style={{ flexDirection: large ? 'row' : 'column', gap: spacing['space.6'] }}>
      <View style={{ flex: 1, minWidth: 0, gap: spacing['space.4'] }}>

      {/* Le scan d'abord, et sélectionné par défaut. L'ordre n'est pas
          cosmétique : c'est lui qui dit quel chemin est le principal. */}
      <SegmentedTabs
        items={[{ label: t('redemption.scanTab') }, { label: t('redemption.manualTab') }]}
        index={ongletScan ? 0 : 1}
        onChange={(i) => setOngletScan(i === 0)}
        testID="onglets-caisse"
      />

      {!ongletScan || !Scan ? (
        <View style={{ gap: spacing['space.3'] }}>
          <TextField
            label={t('redemption.manualLabel')}
            value={saisi}
            onChangeText={setSaisi}
            helpText={t('redemption.manualHint')}
            testID="champ-code"
          />
          {/* **Le pavé est conservé même là où un clavier existe.** Au
              comptoir on tape d'une main, souvent sans regarder ses doigts.
              La saisie clavier reste branchée en parallèle, et l'aide sous le
              champ le dit. */}
          {large ? (
            <PaveDeSaisie
              onTouche={(caractere) => setSaisi((precedent) => precedent + caractere)}
              onEffacer={() => setSaisi('')}
              desactive={etat.state === 'verification'}
            />
          ) : null}

          <View style={{ flexDirection: 'row', gap: spacing['space.2'] }}>
            {large ? (
              <Button
                label={t('redemption.effacer')}
                variant="ghost"
                fullWidth={false}
                onPress={() => setSaisi('')}
                testID="effacer-code"
              />
            ) : null}
            <View style={{ flex: 1 }}>
              <Button
                label={t('redemption.manualSubmit')}
                onPress={() => verifier(saisi)}
                testID="valider-code"
              />
            </View>
          </View>
          {ongletScan && !Scan ? (
            <Texte variante="type.caption" couleur="ink.soft">
              {t('redemption.cameraUnavailable')}
            </Texte>
          ) : null}
        </View>
      ) : (
        <View style={{ gap: spacing['space.3'] }}>
          <Texte variante="type.caption" couleur="ink.soft">
            {t('redemption.scanHint')}
          </Texte>
          <Scan onCode={verifier} indisponible={() => setOngletScan(false)} />
        </View>
      )}

      {etat.state === 'verification' ? (
        <View
          style={{ gap: spacing['space.2'], alignItems: 'center' }}
          accessibilityRole="progressbar"
        >
          <ActivityIndicator color={c['brand.700']} />
          <Texte couleur="ink.soft">{t('redemption.verifying')}</Texte>
        </View>
      ) : null}

      {refus ? (
        <View
          testID="refus"
          style={{
            gap: spacing['space.1'],
            padding: spacing['space.4'],
            borderRadius: radius['radius.lg'],
            backgroundColor: c['status.danger.surface'],
          }}
        >
          <Texte variante="type.label" style={{ color: c['status.danger.text'] }}>
            {refus.injoignable ? t('errors.network') : translateErrorCode(t, refus.code)}
          </Texte>
          {/* Un code refusé dit quoi faire, pas seulement que c'est refusé :
              c'est un commerçant devant un client qui le lit. */}
          <Texte variante="type.caption" couleur="ink.soft">
            {refus.injoignable ? t('redemption.unreachableHint') : t('redemption.refusedHint')}
          </Texte>
        </View>
      ) : null}

      {etat.state === 'reconnu' ? (
        <View
          testID="reconnu"
          // **Une carte, et elle demande quelque chose.** C'est ce que le
          // comptoir lit avant de servir : la réservation reconnue, et le geste
          // qui la clôt. Elle portait le rayon et le fond sans l'ombre —
          // invisible à l'inventaire, dont la définition exigeait un filet
          // qu'une surface pleine n'a pas.
          style={{
            gap: spacing['space.3'],
            padding: spacing['space.4'],
            borderRadius: radius['radius.lg'],
            backgroundColor: c['bg.surface'],
            ...elevationDeCarte(),
          }}
        >
          <Texte variante="type.section">{etat.verification.item_name}</Texte>
          {etat.verification.creator_handle ? (
            <Texte couleur="ink.soft">
              {t('redemption.creator')} : {etat.verification.creator_handle}
            </Texte>
          ) : null}
          {/* La caisse a le droit de savoir qu'elle n'a pas scanné : c'est le
              chemin le moins fort des deux. */}
          {etat.verification.par_secours ? (
            <Texte variante="type.caption" couleur="ink.soft">
              {t('redemption.usedManualCode')}
            </Texte>
          ) : null}
          <Button
            label={t('redemption.serve')}
            onPress={() => servir(etat.verification)}
            testID="servir"
          />
        </View>
      ) : null}

      {etat.state === 'servi' ? (
        <View
          testID="servi"
          style={{
            padding: spacing['space.4'],
            borderRadius: radius['radius.lg'],
            backgroundColor: c['status.success.surface'],
          }}
        >
          <Texte variante="type.label" style={{ color: c['status.success.text'] }}>
            {t('redemption.served')} — {etat.verification.item_name}
          </Texte>
        </View>
      ) : null}
      </View>

      {/* Le journal du jour. `etat` le fait se recharger : ce qu'on vient de
          servir doit y apparaître, sinon le panneau ment d'une ligne. */}
      {large && businessId ? <ServisDuJour businessId={businessId} depuis={etat.state} /> : null}
      </View>
    </ScrollView>
  );
}

/** La largeur du panneau, fixée par la passation v0.6 §5. */
const LARGEUR_DU_JOURNAL = 440;

/**
 * Les validations du jour, à droite de la caisse.
 *
 * **Le panneau que la passation prévoyait et qui n'avait jamais été posé.** Le
 * pavé occupait le tiers gauche et les deux autres tiers restaient blancs —
 * relevé en campagne 2. Ce qu'on y met n'est pas du remplissage : au comptoir,
 * la question qui suit « servi » est toujours la même, « et avant elle,
 * combien, et quoi ».
 *
 * **La plus récente porte l'échéance de publication.** C'est la seule chose que
 * le commerce doit retenir d'une place qu'il vient de donner : quand la
 * contrepartie est attendue. Elle n'existe qu'une fois la place consommée, et
 * elle vient du serveur — jamais recalculée ici, sinon deux dates coexisteraient
 * et l'une des deux serait fausse.
 */
function ServisDuJour({ businessId, depuis }: { businessId: string; depuis: string }) {
  const { api } = useApi();
  const { t, locale } = useI18n();
  const c = useColors();

  const requete = useRequete<JourneeDuCommerce>(
    (signal) => api.journeeDuCommerce(businessId, undefined, signal),
    { estVide: () => false, dependances: [businessId, depuis] },
  );

  // `donnees` n'existe que sur les états qui en portent : en chargement il
  // n'y a rien, et le panneau se rend alors avec sa phrase de début de journée
  // plutôt qu'avec un squelette — c'est un journal, pas le contenu de l'écran.
  const journee = 'donnees' in requete ? requete.donnees : null;
  const servis = (journee?.items ?? []).filter(
    (r: ReservationDuCommerce) => r.status === 'consumed',
  );

  return (
    <View style={{ width: LARGEUR_DU_JOURNAL, gap: spacing['space.3'] }} testID="servis-du-jour">
      <Texte variante="type.label" couleur="ink.soft">
        {t('redemption.servisDuJour')}
      </Texte>

      {servis.length === 0 ? (
        // Un panneau vide est une information : c'est le début de journée. Le
        // dire vaut mieux qu'un cadre blanc, qui se lit comme un chargement.
        <Texte variante="type.caption" couleur="ink.mute" testID="servis-aucun">
          {t('redemption.servisAucun')}
        </Texte>
      ) : null}

      {servis.map((reservation: ReservationDuCommerce, rang: number) => (
        <View
          key={reservation.booking_id}
          testID={`servi-${reservation.booking_id}`}
          style={{
            gap: 4,
            padding: spacing['space.4'],
            borderRadius: radius['radius.lg'],
            // La plus récente se distingue : c'est celle dont on vient de
            // s'occuper, et celle dont l'échéance compte encore.
            backgroundColor: rang === 0 ? c['status.success.surface'] : c['bg.surface'],
            borderWidth: 1,
            borderColor: rang === 0 ? c['status.success.surface'] : c['line.default'],
            // « Un coin de 18 px sans ombre flotte au lieu de se poser » : passation §2.
            ...elevationDeCarte(),
          }}
        >
          {rang === 0 ? (
            <Texte variante="type.caption" style={{ color: c['status.success.text'] }}>
              {t('redemption.servisDernier')}
            </Texte>
          ) : null}
          <Texte variante="type.bodyStrong">{reservation.item_name}</Texte>
          <Texte variante="type.caption" couleur="ink.soft">
            {/* Le pseudonyme, jamais l'état civil. Au comptoir comme
                ailleurs : c'est le code de retrait qui autorise, pas le nom,
                et le compte qui publiera est celui que le pseudonyme nomme. */}
            {reservation.creator_handle}
          </Texte>
          <Texte variante="type.caption" couleur="ink.mute">
            {reservation.contrepartie
              ? t('redemption.servisEcheance', {
                  quand: formatDateTime(
                    reservation.contrepartie.deadline_at,
                    locale,
                    journee?.timezone ?? 'UTC',
                  ),
                })
              : t('redemption.servisSansEcheance')}
          </Texte>
        </View>
      ))}
    </View>
  );
}
