/**
 * 14a · Activation du commerce.
 *
 * **Pas de pourcentage.** « 2 étapes sur 4 » se comprend ; « 50 % » ne dit pas
 * laquelle manque, et une barre de progression transforme une liste de choses à
 * faire en jauge qu'on regarde monter.
 *
 * **Le caractère bloquant est rendu, pas deviné.** Deux étapes refusent
 * l'activation ; les quatre autres ne la refusent pas mais décident de la
 * **visibilité** — un commerce actif sans offre n'apparaît dans aucun fil.
 * Présenter comme obligatoire une étape qui ne l'est pas ferait renoncer des
 * commerces qui pouvaient déjà ouvrir ; taire les quatre autres produirait un
 * commerce « activé » que personne ne voit.
 *
 * **Le bouton d'ouverture est retiré tant qu'une étape bloquante manque.** Il
 * redeviendra possible dès qu'elle sera faite, mais le griser demanderait de
 * deviner laquelle.
 *
 * **Un commerce ouvert ne se voit pas proposer d'ouvrir.** L'écran ne lisait que
 * les étapes : six faites, donc « ouvrir mon commerce » — à un salon ouvert
 * depuis des semaines. Les étapes disent ce qui est prêt, elles ne disent pas
 * ce qui a été décidé. Le statut vient avec elles, et c'est lui qui commande la
 * dernière ligne : ouvrir, ou se mettre en pause.
 *
 * **La pause n'efface rien.** Catalogue, horaires, historique et réservations
 * déjà prises restent ; seule la visibilité s'arrête. C'est ce qu'un salon veut
 * pendant des congés, et c'est réversible d'un geste.
 */
import { useState } from 'react';
import { View } from 'react-native';

import { useApi, type EtapeActivation, type VueDActivation } from '../api';
import { Button, DataRow, SkeletonLine, StatusMessage, Texte } from '../components';
import { useI18n } from '../i18n';
import { Ecran } from './Ecran';
import { useRequete } from './useRequete';

/** Le libellé de chaque étape. Les clés viennent du serveur, jamais recopiées. */
const LIBELLES: Record<EtapeActivation['cle'], string> = {
  address: 'commerce.etapeAddress',
  coordinates: 'commerce.etapeCoordinates',
  cover_photo: 'commerce.etapeCoverPhoto',
  catalog_item: 'commerce.etapeCatalogItem',
  tier_offer: 'commerce.etapeTierOffer',
  capacity_rule: 'commerce.etapeCapacityRule',
};

export function ActivationScreen({
  businessId,
  onActive,
}: {
  businessId: string;
  onActive: () => void;
}) {
  const { api, messageDErreur } = useApi();
  const { t } = useI18n();
  const [envoi, setEnvoi] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);

  const requete = useRequete<VueDActivation>(
    (signal) => api.etapesDActivation(businessId, signal),
    { estVide: (vue) => vue.etapes.length === 0, dependances: [businessId] },
  );

  async function agir(action: () => Promise<unknown>, apres: () => void) {
    setEnvoi(true);
    setEchec(null);
    try {
      await action();
      apres();
    } catch (erreur) {
      // Le refus nomme la condition qui manque : le serveur rend un code du
      // catalogue, pas un « ça n'a pas marché ».
      setEchec(messageDErreur(erreur));
      requete.recharger();
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Ecran
      requete={requete}
      titre={t('commerce.activationTitre')}
      testID="ecran-activation"
      // Le squelette par défaut promettait trois cartes à grande image ;
      // l'écran rend une liste de lignes. Un squelette qui ressemble à autre
      // chose fait attendre ce qui ne viendra pas.
      squelette={
        <View style={{ gap: 10 }}>
          <SkeletonLine width={120} />
          {[0, 1, 2, 3, 4, 5].map((rang) => (
            <SkeletonLine key={rang} width={rang % 2 ? 220 : 260} />
          ))}
        </View>
      }
    >
      {(vue) => {
        const { etapes } = vue;
        const bloquantes = etapes.filter((etape) => etape.blocking);
        const visibilite = etapes.filter((etape) => !etape.blocking);
        const restantes = bloquantes.filter((etape) => !etape.done);
        const faites = etapes.filter((etape) => etape.done).length;
        const ouvert = vue.status === 'active';

        return (
          <View style={{ gap: 16 }}>
            {/* Un compte, pas un pourcentage. */}
            <Texte variante="type.caption" couleur="text.secondary" testID="compte-etapes">
              {t('commerce.activationCompte', { faites, total: etapes.length })}
            </Texte>

            <Groupe titre={t('commerce.activationBloquant')} etapes={bloquantes} />
            <Groupe titre={t('commerce.activationVisibilite')} etapes={visibilite} />

            {echec ? <StatusMessage level="danger" body={echec} testID="echec" /> : null}

            {ouvert ? (
              <View style={{ gap: 10 }} testID="deja-ouvert">
                <StatusMessage
                  level="neutral"
                  title={t('commerce.activationOuvertTitre')}
                  body={
                    visibilite.some((etape) => !etape.done)
                      ? t('commerce.activationOuvertMaisInvisible')
                      : t('commerce.activationOuvertCorps')
                  }
                />
                <Button
                  label={t('commerce.activationMettreEnPause')}
                  variant="secondary"
                  loading={envoi}
                  onPress={() =>
                    agir(() => api.mettreEnPauseLeCommerce(businessId), requete.recharger)
                  }
                  testID="mettre-en-pause"
                />
              </View>
            ) : restantes.length === 0 ? (
              <Button
                label={t('commerce.activationOuvrir')}
                size="lg"
                loading={envoi}
                onPress={() => agir(() => api.activerLeCommerce(businessId), onActive)}
                testID="ouvrir"
              />
            ) : null}
          </View>
        );
      }}
    </Ecran>
  );
}

function Groupe({ titre, etapes }: { titre: string; etapes: EtapeActivation[] }) {
  const { t } = useI18n();
  if (!etapes.length) return null;

  return (
    <View style={{ gap: 4 }}>
      <Texte variante="type.label" couleur="text.secondary">
        {titre}
      </Texte>
      {etapes.map((etape) => (
        <DataRow
          key={etape.cle}
          testID={`etape-${etape.cle}`}
          label={t(LIBELLES[etape.cle])}
          // Un mot, jamais une couleur seule : « fait » et « à faire » se
          // lisent en noir et blanc comme en couleur.
          value={etape.done ? t('commerce.activationFait') : t('commerce.activationAFaire')}
        />
      ))}
    </View>
  );
}
