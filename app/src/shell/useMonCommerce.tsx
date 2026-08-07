/**
 * À quel commerce appartient l'utilisateur connecté.
 *
 * Tous les écrans commerce prennent un `businessId`, et le résolveur
 * d'appartenance ne sert qu'à vérifier celui qu'on lui donne — il ne dit pas
 * lequel demander. `GET /me/businesses` le dit.
 *
 * **Le premier, par ordre alphabétique.** Rien n'interdit d'appartenir à deux
 * commerces ; choisir entre eux est un écran qui n'existe pas encore, et
 * inventer un sélecteur ici serait le concevoir en passant. Le premier suffit
 * tant que le cas ne se présente pas, et la route rend bien une liste.
 *
 * **Aucun rattachement n'est une erreur.** C'est l'état d'un membre qui vient de
 * s'inscrire. L'onglet dit quoi faire au lieu d'afficher un refus.
 */
import { useApi } from '../api';
import { EmptyState } from '../components';
import { useI18n } from '../i18n';
import { Ecran } from '../screens/Ecran';
import { useRequete } from '../screens/useRequete';

type Commerce = { id: string; name: string };

export function useMonCommerce() {
  const { api } = useApi();
  const { t } = useI18n();

  const requete = useRequete<Commerce[]>(
    (signal) => api.mesCommerces(signal),
    { estVide: (commerces) => commerces.length === 0 },
  );

  const businessId =
    requete.etat === 'pret' && !requete.vide ? requete.donnees[0].id : null;

  return {
    businessId,
    /**
     * Ce qu'on montre tant qu'il n'y a pas de commerce : le chargement,
     * l'erreur ou l'invitation à en créer un. `Ecran` rend les quatre états —
     * un écran d'attente qui n'aurait pas d'état d'erreur serait exactement
     * l'écran blanc qu'on cherche à éviter.
     */
    ecranDAttente: (
      <Ecran
        requete={requete}
        titre={t('onglets.journee')}
        testID="ecran-sans-commerce"
        vide={<EmptyState title={t('commerce.activationTitre')} body={t('etats.videCorps')} />}
      >
        {() => null}
      </Ecran>
    ),
  };
}
