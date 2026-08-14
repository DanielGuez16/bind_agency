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
 * s'inscrire, et l'onglet lui donne alors le formulaire de création.
 *
 * **L'état vide était un cul-de-sac.** Il annonçait « votre commerce n'est pas
 * encore en ligne » et n'offrait rien : `POST /business` existait, aucun écran
 * ne l'appelait, et un gérant inscrit seul restait bloqué là indéfiniment. Le
 * seul chemin vers un commerce passait par le mode terrain — c'est-à-dire par
 * quelqu'un d'autre.
 */
import { useApi } from '../api';
import { useI18n } from '../i18n';
import { CreationDuCommerceScreen } from '../screens/CreationDuCommerceScreen';
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
    /** Le nom, pour la barre latérale : c'est lui qui situe la session. */
    nom: requete.etat === 'pret' && !requete.vide ? requete.donnees[0].name : null,
    /**
     * Ce qu'on montre tant qu'il n'y a pas de commerce : le chargement,
     * l'erreur, ou **le formulaire de création**. `Ecran` rend les quatre états
     * — un écran d'attente qui n'aurait pas d'état d'erreur serait exactement
     * l'écran blanc qu'on cherche à éviter.
     *
     * `recharger` en sortie de création, et non un identifiant remonté à la
     * main : c'est la même requête d'appartenance qui décide partout ailleurs,
     * et lui faire dire deux choses différentes selon le chemin emprunté est
     * exactement ce qui fait apparaître un commerce dans la barre latérale
     * pendant que les onglets croient encore n'en avoir aucun.
     */
    ecranDAttente: (
      <Ecran
        requete={requete}
        // Le titre de ce que l'écran fait, et non celui de l'onglet.
        // « Aujourd'hui » au-dessus d'un formulaire de création annonçait une
        // journée de rendez-vous à quelqu'un qui n'a pas encore de commerce.
        titre={t('creationCommerce.titre')}
        testID="ecran-sans-commerce"
        vide={<CreationDuCommerceScreen onCree={requete.recharger} />}
      >
        {() => null}
      </Ecran>
    ),
  };
}
