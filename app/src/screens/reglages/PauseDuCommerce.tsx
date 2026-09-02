/**
 * Mettre le commerce en pause, et le rouvrir.
 *
 * **Il fallait lui donner un toit avant de retirer sa section.** Ce geste vivait
 * sur « profil et mise en ligne », que la v3 supprime : la mise en ligne n'est
 * pas un lieu mais un état, et son bandeau vit désormais sur la journée. Mais un
 * bandeau qui s'efface à la publication ne peut pas porter la pause, qui n'a de
 * sens qu'une fois publié — les deux gestes sont symétriques dans le mot et
 * opposés dans le moment.
 *
 * **Les réglages, donc**, où vivent déjà les gestes qui engagent le compte : se
 * déconnecter, supprimer. Fermer sa vitrine appartient à cette famille-là, pas à
 * la composition de l'offre.
 *
 * **Réservé au commerce, et il se tait chez la créatrice.** Le rendre pour tout
 * le monde ferait une requête inutile et un titre incompréhensible sur l'écran
 * de quelqu'un qui n'a pas de vitrine.
 */
import { useState } from 'react';
import { View } from 'react-native';

import { useApi } from '../../api';
import { Button, StatusMessage, Texte } from '../../components';
import { useI18n } from '../../i18n';
import { useMonCommerce } from '../../shell/useMonCommerce';
import { useRequete } from '../useRequete';
import type { VueDActivation } from '../../api';

export function PauseDuCommerce() {
  const { api, messageDErreur } = useApi();
  const { t } = useI18n();
  const { businessId } = useMonCommerce();
  const [envoi, setEnvoi] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);

  const requete = useRequete<VueDActivation | null>(
    async (signal) => (businessId ? api.etapesDActivation(businessId, signal) : null),
    { estVide: () => false, dependances: [businessId] },
  );

  // Tant qu'on ne sait pas dans quel état est la vitrine, on ne propose rien :
  // un bouton « mettre en pause » sur un commerce déjà en pause fait douter de
  // ce qu'on lit.
  if (!businessId || requete.etat !== 'pret' || requete.donnees === null) return null;

  const ouvert = requete.donnees.status === 'active';

  async function basculer() {
    setEchec(null);
    setEnvoi(true);
    try {
      await (ouvert
        ? api.mettreEnPauseLeCommerce(businessId as string)
        : api.activerLeCommerce(businessId as string));
      requete.recharger();
    } catch (erreur) {
      setEchec(messageDErreur(erreur));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <View style={{ gap: 10 }} testID="pause-du-commerce">
      {/* **L'intertitre est parti, il est celui de la section.** « Your
          storefront » au-dessus de la seule pause en faisait un rang à part,
          à côté d'un « Subscription » de même taille : deux titres pour deux
          gestes que le salon lit comme un seul sujet, son commerce.

          Ce que la pause fait, et surtout ce qu'elle ne fait pas : c'est la
          question qu'on se pose avant d'appuyer, et ne pas y répondre fait
          renoncer au geste ou le fait faire à tort. */}
      <Texte variante="type.caption" couleur="ink.soft" testID="pause-consequences">
        {ouvert ? t('commerce.pauseCorps') : t('commerce.pauseRepriseCorps')}
      </Texte>
      {echec ? <StatusMessage level="danger" body={echec} testID="echec-pause" /> : null}
      <View style={{ alignSelf: 'flex-start' }}>
        <Button
          label={ouvert ? t('commerce.activationMettreEnPause') : t('commerce.pauseReprendre')}
          variant="secondary"
          loading={envoi}
          onPress={() => void basculer()}
          testID={ouvert ? 'mettre-en-pause' : 'reprendre-le-commerce'}
        />
      </View>
    </View>
  );
}
