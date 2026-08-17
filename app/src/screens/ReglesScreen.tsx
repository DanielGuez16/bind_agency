/**
 * « How tiers work », sur mobile.
 *
 * Sur grand écran les règles sont la colonne de droite de l'échelle : elles se
 * lisent en même temps que ce qu'elles expliquent. En compact il n'y a pas de
 * seconde colonne, et les empiler sous trois barreaux les enterrerait — l'écran
 * empilé est le seul emplacement qui reste.
 *
 * **Il recharge la vue plutôt que de recevoir le score en paramètre.** Un
 * paramètre de navigation se perd au rechargement de la page et à l'ouverture
 * d'un lien : l'écran afficherait alors sa définition sans chiffre, sans
 * qu'aucune donnée ne manque réellement. Un appel de plus sur un écran qu'on
 * ouvre rarement coûte moins cher que cette incohérence.
 */
import { useApi, type VueDesPaliers } from '../api';
import { SkeletonLignes } from '../components';
import { useI18n } from '../i18n';
import { Ecran } from './Ecran';
import { ReglesDesPaliers } from './ReglesDesPaliers';
import { useRequete } from './useRequete';

export function ReglesScreen({ onRetour }: { onRetour?: () => void }) {
  const { api } = useApi();
  const { t } = useI18n();

  const requete = useRequete<VueDesPaliers>((signal) => api.mesPaliers(signal), {
    // **Jamais vide.** Les règles existent même sans un seul palier configuré :
    // ce sont elles qu'on vient lire quand rien ne s'ouvre. Un état vide ici
    // renverrait « rien à afficher » à la question « pourquoi rien ne s'ouvre ».
    estVide: () => false,
  });

  return (
    <Ecran
      requete={requete}
      testID="ecran-regles"
      squelette={<SkeletonLignes combien={8} testID="squelette-regles" />}
      nature="creator"
      titre={t('tiers.rulesEntry')}
      onRetour={onRetour}
    >
      {(vue) => <ReglesDesPaliers fiabilite={vue.fiabilite} testID="regles-en-ecran" />}
    </Ecran>
  );
}
