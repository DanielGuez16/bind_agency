/**
 * Quelqu'un de l'administration est dans le compte, et le salon le lit.
 *
 * **Un accès de support silencieux est un accès dont personne ne peut demander
 * compte.** Le service le promet depuis le début — « le salon en est prévenu »
 * — et rien ne le montrait : la reprise s'ouvrait, le salon voyait ses horaires
 * changer, et aucun écran ne disait qui ni pourquoi.
 *
 * **Le motif est cité, jamais reformulé.** Entre guillemets, mot pour mot, tel
 * que l'administrateur l'a tapé. Le résumer ou le catégoriser retirerait
 * précisément ce qui retient : quelqu'un qui sait que le gérant lira sa phrase
 * exacte l'écrit autrement. Ce n'est pas un champ de journal, c'est une lettre.
 *
 * **Sur encre**, comme la mise en ligne : les seuls moments où l'état du compte
 * n'est pas normal partagent une surface, et c'est ce qui les rend lisibles
 * sans titre. Une seule encre claire — le système n'en porte qu'une, calibrée
 * pour ce fond, et la hiérarchie vient des variantes de type. La planche en
 * dessine trois ; en inventer deux ici les poserait hors du système, où rien
 * ne garantit plus leur contraste.
 *
 * **Ce que la planche demande et que le serveur ne permet pas encore.** Elle
 * pose un bouton « End it » sur ce bandeau — « l'accès s'ouvre sans permission
 * et se ferme sans discussion ». La fermeture est aujourd'hui une route
 * d'administration : le salon ne peut pas refermer ce qu'on a ouvert chez lui.
 * Le bouton n'est donc pas dessiné, parce qu'un bouton qui ne coupe rien serait
 * pire que son absence sur cet écran-là. Demandé, voir `TASKS.md`.
 *
 * La portée n'est pas rendue non plus — rien ne borne la reprise à un ensemble
 * d'écrans — donc le bandeau ne peut pas écrire « hours and capacity only ».
 * Il dit ce qu'il sait : qui, pourquoi, depuis quand, et jusqu'à quand.
 */
import { View } from 'react-native';

import { useApi, type RepriseDuCompte } from '../../api';
import { Texte } from '../../components';
import { useI18n } from '../../i18n';
import { formatDateTime } from '../../format';
import { radius, useColors } from '../../theme';
import { useRequete } from '../useRequete';
import { repriseEnCours } from './reprise';

export function BandeauDeReprise({
  businessId,
  timezone,
}: {
  businessId: string;
  timezone: string;
}) {
  const { api, } = useApi();
  const { t, locale } = useI18n();
  const c = useColors();

  // Sa propre requête, comme la pause du commerce : la journée n'a pas de
  // raison de porter une donnée qui ne la concerne qu'à travers ce bandeau, et
  // l'y ajouter la ferait recharger pour rien à chaque passage.
  const requete = useRequete<RepriseDuCompte[]>(
    (signal) => api.mesReprises(businessId, signal),
    { estVide: () => false, dependances: [businessId] },
  );

  // Tant qu'on ne sait pas, rien. Un bandeau qui apparaît une seconde après le
  // reste de l'écran fait sursauter, et celui-ci dit une chose grave.
  if (requete.etat !== 'pret') return null;

  const reprise = repriseEnCours(requete.donnees);
  if (reprise === null) return null;

  return (
    <View
      testID="bandeau-reprise"
      style={{
        gap: 10,
        padding: 20,
        borderRadius: radius['radius.lg'],
        backgroundColor: c['bg.inverse'],
      }}
    >
      <Texte variante="type.section" couleur="ink.onDark">
        {t('commerce.repriseEnCours')}
      </Texte>

      {/* **Le motif, entre guillemets et intact.** Les chevrons sont dans la
          traduction et non collés ici : l'espagnol ne cite pas comme
          l'anglais, et le signe fait partie de la phrase. */}
      <Texte variante="type.body" couleur="ink.onDark" testID="reprise-motif">
        {t('commerce.repriseMotif', { motif: reprise.reason })}
      </Texte>

      <Texte variante="type.monoSmall" couleur="ink.onDark" testID="reprise-quand">
        {t('commerce.repriseDepuisJusqua', {
          debut: formatDateTime(reprise.started_at, locale, timezone),
          fin: formatDateTime(reprise.expires_at, locale, timezone),
        }).toUpperCase()}
      </Texte>
    </View>
  );
}
