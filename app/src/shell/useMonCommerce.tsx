/**
 * À quel commerce appartient l'utilisateur connecté.
 *
 * Tous les écrans commerce prennent un `businessId`, et le résolveur
 * d'appartenance ne sert qu'à vérifier celui qu'on lui donne — il ne dit pas
 * lequel demander. `GET /me/businesses` le dit.
 *
 * **Le choix vit dans un contexte, et c'est obligatoire.** Ce module est appelé
 * par quatre endroits — la navigation, la pause du commerce, la reprise du
 * compte — et chacun montait sa propre requête. Tant que la règle était « le
 * premier de la liste », les quatre tombaient d'accord par hasard. Dès qu'un
 * choix existe, quatre copies indépendantes divergent : la barre latérale
 * afficherait un salon pendant qu'un autre écran en met un second en pause.
 * Le fournisseur porte la liste **et** le choix, une fois pour toute la
 * coquille.
 *
 * **Le premier reste le défaut**, et c'est le comportement d'avant : un
 * identifiant retenu qui ne figure plus dans la liste d'appartenance ne fait
 * pas autorité — un salon qu'on a quitté ne doit pas rester choisi.
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
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { useApi } from '../api';
import { useI18n } from '../i18n';
import { CreationDuCommerceScreen } from '../screens/CreationDuCommerceScreen';
import { Ecran } from '../screens/Ecran';
import { useRequete } from '../screens/useRequete';
import { commerceRetenu, lireLeChoix, retenirLeChoix } from './commerceChoisi';

type Commerce = { id: string; name: string; timezone: string };

type ValeurDuCommerce = {
  commerces: readonly Commerce[];
  choisi: string | null;
  choisir: (businessId: string) => void;
  requete: ReturnType<typeof useRequete<Commerce[]>>;
};

const Contexte = createContext<ValeurDuCommerce | null>(null);

/**
 * La liste d'appartenance et le salon regardé, pour toute la coquille.
 *
 * Posé autour des onglets commerce : au-dessus, la session n'est pas encore
 * établie ; en dessous, chaque écran remonterait sa propre requête.
 */
export function CommerceProvider({ children }: { children: React.ReactNode }) {
  const { api } = useApi();
  const [choisi, setChoisi] = useState<string | null>(null);

  const requete = useRequete<Commerce[]>(
    (signal) => api.mesCommerces(signal),
    { estVide: (commerces) => commerces.length === 0 },
  );

  // Le choix retenu de l'appareil, lu une fois. Il ne fait pas autorité : la
  // liste tranche, et `commerceRetenu` retombe sur le premier s'il ment.
  useEffect(() => {
    let vivant = true;
    void lireLeChoix().then((retenu) => {
      if (vivant && retenu) setChoisi(retenu);
    });
    return () => {
      vivant = false;
    };
  }, []);

  const choisir = useCallback((businessId: string) => {
    setChoisi(businessId);
    void retenirLeChoix(businessId);
  }, []);

  const commerces = requete.etat === 'pret' && !requete.vide ? requete.donnees : [];

  const valeur = useMemo<ValeurDuCommerce>(
    () => ({ commerces, choisi, choisir, requete }),
    [commerces, choisi, choisir, requete],
  );

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

export function useMonCommerce() {
  const { t } = useI18n();
  const contexte = useContext(Contexte);
  if (contexte === null) {
    // Lever plutôt que retomber sur une requête locale : une seconde source
    // de vérité est précisément ce que le fournisseur existe pour empêcher.
    throw new Error('useMonCommerce hors de CommerceProvider');
  }
  const { commerces, choisi, choisir, requete } = contexte;

  const commerce = commerceRetenu(commerces, choisi);

  return {
    businessId: commerce?.id ?? null,
    /** Tous les salons, pour le sélecteur. Vide tant que rien n'est chargé. */
    commerces,
    /** Change de salon. Retenu par appareil. */
    choisir,
    /** Le nom, pour la barre latérale : c'est lui qui situe la session. */
    nom: commerce?.name ?? null,
    /**
     * Le fuseau du salon, pour tout ce qui s'affiche en heure locale.
     *
     * **Servi depuis toujours et lu nulle part.** La règle du produit convertit
     * sur le fuseau du commerce parce que tout ce qu'il lit s'y passe ; sans
     * lui, chaque écran retombait sur celui de l'appareil, ce qui n'a de
     * conséquence visible que le jour où le gérant voyage.
     */
    timezone: commerce?.timezone ?? null,
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
