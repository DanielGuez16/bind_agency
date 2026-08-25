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
import { Button, SkeletonFiche, StatusMessage, Texte } from '../components';
import { useI18n } from '../i18n';
import { Ecran } from './Ecran';
import { CeQuiManquait } from './preuve/CeQuiManquait';
import { ContratDeLaPreuve } from './preuve/ContratDeLaPreuve';
import { EnvoiDePreuve } from './EnvoiDePreuve';
import { useRequete } from './useRequete';

/**
 * Le fuseau dans lequel s'écrit une échéance de publication.
 *
 * **Celui du produit, faute de mieux, et c'est dit plutôt que caché.** Le bon
 * fuseau est celui du commerce — une échéance se compte depuis un service rendu
 * quelque part — et `Collaboration` ne le porte pas plus qu'il ne porte le nom
 * du salon. L'écran affichait `UTC`, c'est-à-dire le fuseau de personne, ce qui
 * décalait l'heure de quatre heures à Miami. Le marché est unique au
 * lancement ; le jour où il ne l'est plus, ce constant devient le champ qui
 * manque.
 */
const FUSEAU_DU_PRODUIT = 'America/New_York';

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
  const { t, locale } = useI18n();
  const [choisit, setChoisit] = useState(false);

  const requete = useRequete<Collaboration>(
    (signal) => api.contrepartie(collaborationId, signal),
    { estVide: () => false, dependances: [collaborationId] },
  );

  return (
    <Ecran
      onRetour={onRetour} requete={requete} titre={t('parcours.preuveTitre')} squelette={<SkeletonFiche testID="squelette-preuve" />} testID="ecran-preuve">
      {(contrepartie) => (
        <View style={{ gap: 12 }}>
          {/* **Le badge et l'échéance nue sont remplacés par le contrat.** Le
              badge disait le palier en trois barres — la même chose codée que
              la fiche v3 a retirée — et l'échéance s'écrivait en date de
              machine sur `UTC`, c'est-à-dire dans le fuseau de personne. Le
              panneau dit les deux en toutes lettres, et il porte en plus ce que
              la liste des réservations laisse tomber : le format exact, la
              mention et le lieu, copiables. */}
          <ContratDeLaPreuve
            contrepartie={contrepartie}
            plateforme={null}
            timezone={FUSEAU_DU_PRODUIT}
            nomDuSalon={null}
            nomDeLaPrestation={null}
          />

          {/* **Un arbitre a la main, et l'attente change de nature.** Le champ
              était rendu depuis toujours et affiché nulle part : on attendait
              le salon sans savoir qu'il ne décidait plus. */}
          {contrepartie.needs_human_review ? (
            <StatusMessage
              level="neutral"
              body={t('parcours.contrepartieEnArbitrage')}
              testID="en-arbitrage"
            />
          ) : null}
          {contrepartie.status === 'under_review' || contrepartie.status === 'submitted' ? (
            // Aucune promesse de délai : on dit que c'est en cours, pas quand
            // ce sera fini.
            <StatusMessage
              level="neutral"
              body={t('parcours.preuveEnControle')}
              testID="en-controle"
            />
          ) : null}

          {/* **Une reprise dit ce qu'elle reproche, ou elle n'apprend rien.**
              Le bandeau ne disait que « une nouvelle soumission a été
              demandée » : il renvoyait recommencer sans dire quoi corriger,
              sur le seul écran qui devait porter le reproche. La carte le
              porte, et dit aussi ce qui allait.

              **Le bandeau reste en second**, pour les dossiers sans motif
              codé : le motif est obligatoire depuis que le vocabulaire est
              fermé, mais une reprise demandée avant ne le porte pas, et un
              écran muet vaudrait moins que la phrase générique. */}
          {contrepartie.status === 'resubmit_requested' ? (
            contrepartie.dernier_motif ? (
              <CeQuiManquait contrepartie={contrepartie} />
            ) : (
              <StatusMessage
                level="warning"
                body={t('parcours.preuveANouveau')}
                testID="nouvelle-soumission"
              />
            )
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
                // **Ce qui a été compté, et le plafond.** Un échec réseau n'en
                // fait pas partie : l'écran écrit « toujours 1 sur 3 » parce
                // que c'est la seule phrase qu'on ne peut pas déduire de ce
                // qu'il montre.
                tentatives={contrepartie.attempts_count}
                echeance={contrepartie.deadline_at}
                timezone={FUSEAU_DU_PRODUIT}
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
