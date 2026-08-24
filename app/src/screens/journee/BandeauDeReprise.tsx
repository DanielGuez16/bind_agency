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
 * **« L'accès s'ouvre sans permission et se ferme sans discussion. »** La
 * seconde moitié ne tenait pas : seule la porte d'administration savait se
 * refermer, si bien que le gérant qui n'était pas d'accord n'avait qu'un numéro
 * à appeler. Une garantie qui suppose qu'on décroche n'en est pas une. Le
 * bouton est là, il coupe **toutes** les reprises qui courent — lui demander
 * laquelle serait lui demander de savoir combien de personnes sont entrées.
 *
 * **Le bouton ne demande pas de confirmation**, et c'est délibéré. Une question
 * de plus entre le gérant et la porte est une négociation, et il n'a personne à
 * convaincre. Le geste se répare tout seul : rien n'est effacé, la liste garde
 * les reprises avec leur motif, et l'administration peut en rouvrir une en le
 * disant.
 *
 * **La portée est écrite**, parce qu'elle est vraie : une requête hors de ces
 * écrans est refusée, pas seulement mal vue. Un gérant qui lit « la fiche et le
 * catalogue » lit une borne, pas une intention.
 */
import { useState } from 'react';
import { View } from 'react-native';

import { useApi, type RepriseDuCompte } from '../../api';
import { Button, Texte } from '../../components';
import { useI18n } from '../../i18n';
import { formatDateTime } from '../../format';
import { radius, useColors } from '../../theme';
import { useRequete } from '../useRequete';
import { nomDeLEcran } from '../reprise/portee';
import { repriseEnCours } from './reprise';

export function BandeauDeReprise({
  businessId,
  timezone,
}: {
  businessId: string;
  timezone: string;
}) {
  const { api, messageDErreur } = useApi();
  const { t, locale } = useI18n();
  const c = useColors();
  const [envoi, setEnvoi] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);

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

  async function refermer() {
    setEchec(null);
    setEnvoi(true);
    try {
      await api.refermerLaReprise(businessId);
      requete.recharger();
    } catch (erreur) {
      setEchec(messageDErreur(erreur));
    } finally {
      setEnvoi(false);
    }
  }

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

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          {/* **La portée avant l'heure.** « Ce qui est ouvert » se lit avant
              « jusqu'à quand » : un gérant qui apprend qu'on est chez lui
              demande d'abord jusqu'où, pas jusqu'à quand. */}
          <Texte variante="type.dataLabel" couleur="ink.onDark" testID="reprise-portee-journee">
            {/* Les mêmes mots que la liste des réglages, par le même
                aiguillage : deux jeux pour les mêmes écrans finiraient par se
                contredire, et c'est le gérant qui lirait la contradiction.

                **Sans capitales.** Celle-ci portait une phrase entière, liste
                d'écrans comprise ; celle du dessous, deux dates. Les capitales
                détruisent la silhouette des mots, donc ce qui permet de lire
                sans épeler — et le bandeau d'une reprise est justement ce qu'on
                lit vite. Le mono capitales désigne une étiquette, pas une
                phrase. */}
            {t('commerce.repriseOuvre', {
              ecrans: (reprise.scope ?? [])
                .map((ecran) => nomDeLEcran(ecran, t))
                .join(t('reglages.porteeSeparateur')),
            })}
          </Texte>
          <Texte variante="type.dataLabel" couleur="ink.onDark" testID="reprise-quand">
            {t('commerce.repriseDepuisJusqua', {
              debut: formatDateTime(reprise.started_at, locale, timezone),
              fin: formatDateTime(reprise.expires_at, locale, timezone),
            })}
          </Texte>
        </View>

        {/* **Aucune confirmation.** Une question de plus entre le gérant et la
            porte est une négociation, et il n'a personne à convaincre. */}
        <Button
          label={t('commerce.repriseRefermer')}
          fullWidth={false}
          loading={envoi}
          onPress={() => void refermer()}
          testID="reprise-refermer-journee"
        />
      </View>

      {echec ? (
        <Texte variante="type.caption" couleur="ink.onDark" testID="reprise-echec">
          {echec}
        </Texte>
      ) : null}
    </View>
  );
}
