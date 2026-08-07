/**
 * La session : qui est connecté, et ce qu'il a le droit de voir.
 *
 * **Le rôle vient du serveur, jamais du client.** Après connexion on relit
 * `/me` : le jeton porte un identifiant, pas des droits, et déduire le rôle
 * d'un jeton décodé côté client reviendrait à laisser l'appareil se déclarer
 * administrateur. La navigation qui en découle n'est qu'un confort ; c'est
 * l'API qui refuse.
 *
 * **Une session perdue ramène à la connexion avec un message.** Jeton de
 * rafraîchissement mort, compte suspendu : dans les deux cas l'écran de
 * connexion réapparaît en disant pourquoi. Un écran blanc laisserait quelqu'un
 * relancer l'app trois fois avant de comprendre.
 *
 * **Le compte suspendu se distingue de la session expirée.** L'API répond 401
 * dans les deux cas — elle relit le statut à chaque requête et ne veut pas dire
 * lequel des deux — mais la **connexion**, elle, répond `account_not_active`.
 * C'est là qu'on l'apprend, et c'est là qu'on le dit.
 *
 * **Le rétablissement au démarrage a son propre état.** Tant qu'on n'a pas lu
 * le trousseau, on ne sait pas s'il y a une session : afficher l'écran de
 * connexion pendant ce temps ferait clignoter l'app à chaque ouverture pour
 * quelqu'un de déjà connecté.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { ApiClient, ApiError, NetworkError, type CoffreDeJetons } from '../api';
import type { Role } from '../theme';

/**
 * Le rôle tel que l'API le nomme.
 *
 * Volontairement distinct de `Role` du thème, qui dit `merchant` là où l'API
 * dit `business_member`. Ce sont deux vocabulaires : l'un décrit une densité et
 * un thème, l'autre une ligne de la table `app_user`. Les confondre obligerait
 * à renommer l'un des deux pour plaire à l'autre, et c'est toujours le mauvais
 * qu'on renomme.
 */
export type RoleApi = 'creator' | 'business_member' | 'admin';

/** Les rôles qu'un formulaire public peut demander. Pas `admin`. */
export type RoleInscriptible = Extract<RoleApi, 'creator' | 'business_member'>;

const THEME_PAR_ROLE_API: Record<RoleApi, Role> = {
  creator: 'creator',
  business_member: 'merchant',
  admin: 'admin',
};

export function themeDuRole(role: RoleApi): Role {
  return THEME_PAR_ROLE_API[role];
}

export type Utilisateur = {
  id: string;
  email: string | null;
  role: RoleApi;
  status: 'active' | 'suspended' | 'deleted';
  locale: 'en' | 'es';
};

export type EtatDeSession =
  /** On lit le trousseau. On ne sait pas encore. */
  | { etat: 'retablissement' }
  | { etat: 'anonyme'; motif: MotifDeSortie | null }
  | { etat: 'connecte'; utilisateur: Utilisateur };

/** Pourquoi on se retrouve devant l'écran de connexion. */
export type MotifDeSortie = 'session_expiree' | 'compte_suspendu' | 'deconnexion';

type SessionValue = EtatDeSession & {
  /**
   * Le jeton d'accès brut.
   *
   * **Uniquement pour les écrans écrits avant le client d'API**, qui
   * construisent leurs requêtes eux-mêmes. Tout le reste passe par `useApi`,
   * qui attache le jeton et le fait tourner. Ce champ disparaît avec la dette.
   *
   * Il suit la rotation : relu à chaque changement d'état de session, il ne se
   * fige pas sur celui de la connexion.
   */
  jetonDAcces: string | null;
  connecter: (email: string, motDePasse: string) => Promise<void>;
  inscrire: (email: string, motDePasse: string, role: RoleInscriptible) => Promise<void>;
  deconnecter: () => Promise<void>;
  /** Le client, déjà porteur du coffre. Les écrans passent par `useApi`. */
  client: ApiClient;
};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({
  children,
  baseUrl,
  coffre,
  fetchImpl,
}: {
  children: ReactNode;
  baseUrl: string;
  coffre: CoffreDeJetons;
  /**
   * Injecté par les tests, qui ne touchent aucun réseau. En production, absent :
   * le client prend le `fetch` global.
   */
  fetchImpl?: typeof fetch;
}) {
  const [etat, setEtat] = useState<EtatDeSession>({ etat: 'retablissement' });

  // Le client est construit une fois. Le reconstruire à chaque rendu perdrait
  // la rotation de jeton en cours, et trois écrans qui chargent ensemble
  // relanceraient trois rotations.
  const clientRef = useRef<ApiClient | null>(null);
  if (clientRef.current === null) {
    clientRef.current = new ApiClient({
      baseUrl,
      coffre,
      // Appelé par le client quand le rafraîchissement a définitivement
      // échoué. Il ne navigue pas lui-même : il prévient, on décide ici.
      surSessionPerdue: () => setEtat({ etat: 'anonyme', motif: 'session_expiree' }),
      fetchImpl,
    });
  }
  const client = clientRef.current;

  const relireLUtilisateur = useCallback(async (): Promise<Utilisateur> => {
    return client.request<Utilisateur>('/api/v1/me');
  }, [client]);

  // Rétablissement au démarrage : s'il y a un jeton, on vérifie qu'il vaut
  // encore quelque chose plutôt que de faire confiance à sa présence.
  useEffect(() => {
    let vivant = true;

    void (async () => {
      const jetons = await coffre.lire();
      if (!vivant) return;
      if (!jetons) {
        setEtat({ etat: 'anonyme', motif: null });
        return;
      }

      try {
        const utilisateur = await relireLUtilisateur();
        if (vivant) setEtat({ etat: 'connecte', utilisateur });
      } catch (erreur) {
        if (!vivant) return;
        // Une panne réseau n'est pas une session morte : on ne jette pas
        // quelqu'un dehors parce qu'il passe sous un tunnel au démarrage.
        if (erreur instanceof NetworkError) {
          setEtat({ etat: 'anonyme', motif: null });
          return;
        }
        await coffre.ecrire(null);
        setEtat({ etat: 'anonyme', motif: 'session_expiree' });
      }
    })();

    return () => {
      vivant = false;
    };
  }, [coffre, relireLUtilisateur]);

  const connecter = useCallback(
    async (email: string, motDePasse: string) => {
      try {
        await client.connecter(email, motDePasse);
      } catch (erreur) {
        // `account_not_active` est le seul endroit où l'on apprend qu'un
        // compte est suspendu : l'API ne le dit pas sur les autres routes,
        // qui répondent 401 sans distinguer.
        if (erreur instanceof ApiError && erreur.code === 'account_not_active') {
          setEtat({ etat: 'anonyme', motif: 'compte_suspendu' });
        }
        throw erreur;
      }
      setEtat({ etat: 'connecte', utilisateur: await relireLUtilisateur() });
    },
    [client, relireLUtilisateur],
  );

  const inscrire = useCallback(
    async (email: string, motDePasse: string, role: RoleInscriptible) => {
      await client.request('/api/v1/auth/register', {
        methode: 'POST',
        corps: { email, password: motDePasse, role },
        publique: true,
      });
      // L'inscription ne rend pas de jetons : on enchaîne sur une connexion,
      // parce que demander deux fois le mot de passe qu'on vient de saisir
      // n'apporte rien.
      await connecter(email, motDePasse);
    },
    [client, connecter],
  );

  // Relu depuis le coffre plutôt que retenu à la connexion : le client le fait
  // tourner, et un jeton figé serait périmé au bout de quinze minutes.
  const [jetonDAcces, setJetonDAcces] = useState<string | null>(null);
  useEffect(() => {
    let vivant = true;
    void coffre.lire().then((jetons) => {
      if (vivant) setJetonDAcces(jetons?.access_token ?? null);
    });
    return () => {
      vivant = false;
    };
  }, [coffre, etat]);

  const deconnecter = useCallback(async () => {
    await client.deconnecter();
    setEtat({ etat: 'anonyme', motif: 'deconnexion' });
  }, [client]);

  const value = useMemo<SessionValue>(
    () => ({ ...etat, jetonDAcces, connecter, inscrire, deconnecter, client }),
    [etat, jetonDAcces, connecter, inscrire, deconnecter, client],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (value === null) {
    throw new Error('useSession hors de SessionProvider');
  }
  return value;
}

export { coffreSecurise, trousseauDisponible } from './coffre';
