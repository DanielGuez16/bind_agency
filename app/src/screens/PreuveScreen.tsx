/**
 * 07 · Contrepartie : soumission, contrôle, nouvelle demande, non honorée.
 *
 * Un seul écran pour les quatre situations, parce que c'est un seul objet dont
 * l'état change. En faire quatre écrans obligerait à savoir lequel ouvrir avant
 * d'avoir lu l'état.
 *
 * **Aucune validation automatique n'existe.** Une échéance dépassée produit
 * « non honorée », jamais « approuvée » par défaut : le commerce a donné une
 * prestation contre une publication qui n'existe pas.
 *
 * **Un refus de conformité rouvre avec une nouvelle échéance.** Il ne clôt
 * pas ; le dire autrement ferait croire à un dossier perdu.
 *
 * **La sélection de média vit ici, dépliée sur place.** Le bouton n'ouvrait
 * rien : c'était le maillon final de la boucle, et il manquait. La déplier
 * plutôt que d'ouvrir un écran garde l'échéance et le format exigé sous les
 * yeux pendant qu'on choisit ce qu'on envoie.
 */
import { useState } from 'react';
import { View } from 'react-native';

import { useApi, type Collaboration } from '../api';
import { Button, StatusMessage, Texte, TierBadge } from '../components';
import { useI18n } from '../i18n';
import { Ecran } from './Ecran';
import { EnvoiDePreuve } from './EnvoiDePreuve';
import { useRequete } from './useRequete';

export function PreuveScreen({
  collaborationId,
  onRetour,
}: {
  collaborationId: string;
  /** Le retour de la pile. Sur le web il n'y a ni geste ni bouton système :
   * sans lui, on ne quitte l'écran qu'en changeant d'onglet. */
  onRetour?: () => void;
}) {
  const { api } = useApi();
  const { t } = useI18n();
  const [choisit, setChoisit] = useState(false);

  const requete = useRequete<Collaboration>(
    (signal) => api.contrepartie(collaborationId, signal),
    { estVide: () => false, dependances: [collaborationId] },
  );

  return (
    <Ecran
      onRetour={onRetour} requete={requete} titre={t('parcours.preuveTitre')} testID="ecran-preuve">
      {(contrepartie) => (
        <View style={{ gap: 12 }}>
          <TierBadge tier={contrepartie.required_format} />

          {/* Le délai qui court s'affiche en date d'échéance ; le temps restant
              se calcule à l'affichage, il ne se stocke pas. */}
          <Texte variante="type.mono" testID="echeance">
            {t('parcours.preuveEcheance', {
              date: new Date(contrepartie.deadline_at).toLocaleString(),
            })}
          </Texte>

          {contrepartie.status === 'under_review' || contrepartie.status === 'submitted' ? (
            // Aucune promesse de délai : on dit que c'est en cours, pas quand
            // ce sera fini.
            <StatusMessage
              level="neutral"
              body={t('parcours.preuveEnControle')}
              testID="en-controle"
            />
          ) : null}

          {contrepartie.status === 'resubmit_requested' ? (
            <StatusMessage
              level="warning"
              body={t('parcours.preuveANouveau')}
              testID="nouvelle-soumission"
            />
          ) : null}

          {contrepartie.status === 'unfulfilled' ? (
            // Annoncé une fois, sans badge ni marque permanente sur le profil.
            <StatusMessage
              level="danger"
              body={t('parcours.preuveNonHonoree')}
              testID="non-honoree"
            />
          ) : null}

          {/* Le bouton n'existe que quand une soumission est attendue. Il est
              retiré, pas grisé, dans tous les autres cas. */}
          {contrepartie.status === 'pending' || contrepartie.status === 'resubmit_requested' ? (
            choisit ? (
              <EnvoiDePreuve
                collaborationId={collaborationId}
                onEnvoye={() => {
                  setChoisit(false);
                  requete.recharger();
                }}
              />
            ) : (
              <Button
                label={t('parcours.preuveEnvoyer')}
                size="lg"
                onPress={() => setChoisit(true)}
                testID="envoyer"
              />
            )
          ) : null}
        </View>
      )}
    </Ecran>
  );
}
