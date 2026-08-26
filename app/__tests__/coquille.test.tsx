/**
 * La coquille : session, aiguillage par rôle, erreur globale.
 *
 * Ce qui est éprouvé ici n'est pas la mise en page, c'est ce qui arrive quand
 * les choses tournent mal. **Une session expirée ramène à la connexion avec un
 * message** — pas un écran blanc, pas un écran de chargement infini. **Un
 * compte suspendu le dit** plutôt que de laisser croire à un mot de passe
 * oublié. **Une trace technique n'atteint jamais l'écran.**
 *
 * Et l'aiguillage : chaque rôle n'a que ses onglets. Ce n'est pas une garantie
 * de sécurité — l'API refuse, et c'est elle qui décide — mais un onglet qui
 * répondrait 403 est pire qu'un onglet absent.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { ApiProvider } from '../src/api';
import { ecrireAuCache, lireDuCache } from '../src/screens/cacheDesReponses';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { AuthScreen } from '../src/screens/AuthScreen';
import { ReglagesScreen } from '../src/screens/ReglagesScreen';
import { SessionProvider, themeDuRole, useSession, type Utilisateur } from '../src/session';
import { FrontiereDErreur } from '../src/shell/FrontiereDErreur';
import { Navigation } from '../src/shell/Navigation';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider, couleurs } from '../src/theme';
import { ZoneSure } from '../src/shell/ZoneSure';

// --------------------------------------------------------------------------
// plomberie
// --------------------------------------------------------------------------

function coffreDeTest(initial: { access_token: string; refresh_token: string } | null = null) {
  let contenu = initial;
  return {
    lire: async () => contenu,
    ecrire: async (jetons: typeof contenu) => {
      contenu = jetons;
    },
    get contenu() {
      return contenu;
    },
  };
}

const UTILISATEUR: Utilisateur = {
  id: 'u1',
  email: 'rebecca@bind.example',
  role: 'creator',
  status: 'active',
  locale: 'en',
  email_verified_at: '2026-08-01T10:00:00Z',
  favoris_me_previennent: true,
  deletion_effective_at: null,
};

/** Un serveur simulé, route par route. */
function serveur(table: Record<string, { status?: number; corps: unknown }>) {
  return async (url: RequestInfo | URL) => {
    const chemin = String(url);
    const trouve = Object.entries(table).find(([fragment]) => chemin.includes(fragment));
    if (!trouve) throw new TypeError(`route non simulée : ${chemin}`);
    const { status = 200, corps } = trouve[1];
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => corps,
    } as Response;
  };
}

/** Un iPhone à encoche : 47 points en haut, 34 pour l'indicateur d'accueil. */
const IPHONE_A_ENCOCHE = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function styleAplati(element: { props: { style?: unknown } }): Record<string, unknown> {
  const empile = (valeur: unknown): Record<string, unknown> =>
    Array.isArray(valeur)
      ? Object.assign({}, ...valeur.map(empile))
      : ((valeur as Record<string, unknown>) ?? {});
  return empile(element.props.style);
}

function Cadre({
  children,
  coffre,
  fetchImpl,
}: {
  children: ReactNode;
  coffre: ReturnType<typeof coffreDeTest>;
  fetchImpl: typeof fetch;
}) {
  return (
    // Les marges système sont fournies ici comme dans `App` : la barre
    // d'onglets les lit pour poser son décalage du bas, et sans fournisseur
    // elle lève — ce qui est le bon comportement, une barre qui ignore
    // l'indicateur d'accueil coupe ses libellés.
    <SafeAreaProvider initialMetrics={IPHONE_A_ENCOCHE}>
      <I18nProvider initialLocale="en">
        <SessionProvider baseUrl="https://api.test" coffre={coffre} fetchImpl={fetchImpl}>
          <Sous>{children}</Sous>
        </SessionProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

/** Reproduit l'ordre de `App.tsx` : thème depuis le rôle, puis client d'API. */
function Sous({ children }: { children: ReactNode }) {
  const session = useSession();
  const role = session.etat === 'connecte' ? session.utilisateur.role : 'creator';
  return (
    <ThemeProvider role={themeDuRole(role)}>
      <ApiProvider client={session.client}>{children}</ApiProvider>
    </ThemeProvider>
  );
}

/** Affiche l'état de session, pour l'observer sans monter la navigation. */
function Sonde() {
  const session = useSession();
  return (
    <View>
      <Text testID="etat">{session.etat}</Text>
      <Text testID="motif">
        {session.etat === 'anonyme' ? (session.motif ?? 'aucun') : ''}
      </Text>
      <Text testID="role">
        {session.etat === 'connecte' ? session.utilisateur.role : ''}
      </Text>
      <Text testID="jeton">{session.jetonDAcces ?? ''}</Text>
    </View>
  );
}

// --------------------------------------------------------------------------
// rétablissement au démarrage
// --------------------------------------------------------------------------

describe('rétablissement', () => {
  it('sans jeton, va directement à la connexion sans motif', async () => {
    const coffre = coffreDeTest(null);
    await render(
      <Cadre coffre={coffre} fetchImpl={serveur({}) as typeof fetch}>
        <Sonde />
      </Cadre>,
    );

    await waitFor(() => expect(screen.getByTestId('etat')).toHaveTextContent('anonyme'));
    expect(screen.getByTestId('motif')).toHaveTextContent('aucun');
  });

  it('avec un jeton valide, rétablit la session et son rôle', async () => {
    const coffre = coffreDeTest({ access_token: 'a', refresh_token: 'r' });
    await render(
      <Cadre
        coffre={coffre}
        fetchImpl={serveur({ '/me': { corps: UTILISATEUR } }) as typeof fetch}
      >
        <Sonde />
      </Cadre>,
    );

    await waitFor(() => expect(screen.getByTestId('etat')).toHaveTextContent('connecte'));
    expect(screen.getByTestId('role')).toHaveTextContent('creator');
  });

  it('avec un jeton mort, efface la session et dit pourquoi', async () => {
    // Le cas qui produisait un écran blanc : le jeton existe, il ne vaut plus
    // rien, et personne ne le disait.
    const coffre = coffreDeTest({ access_token: 'mort', refresh_token: 'mort' });
    await render(
      <Cadre
        coffre={coffre}
        fetchImpl={
          serveur({
            '/auth/refresh': { status: 401, corps: { detail: 'invalid_refresh_token' } },
            '/me': { status: 401, corps: { detail: 'authentication_required' } },
          }) as typeof fetch
        }
      >
        <Sonde />
      </Cadre>,
    );

    await waitFor(() => expect(screen.getByTestId('etat')).toHaveTextContent('anonyme'));
    expect(screen.getByTestId('motif')).toHaveTextContent('session_expiree');
    expect(coffre.contenu).toBeNull();
  });

  it('garde la session quand c’est le réseau qui manque', async () => {
    // On ne jette pas quelqu'un dehors parce qu'il ouvre l'app sous un tunnel.
    const coffre = coffreDeTest({ access_token: 'a', refresh_token: 'r' });
    await render(
      <Cadre
        coffre={coffre}
        fetchImpl={
          (async () => {
            throw new TypeError('offline');
          }) as unknown as typeof fetch
        }
      >
        <Sonde />
      </Cadre>,
    );

    await waitFor(() => expect(screen.getByTestId('etat')).toHaveTextContent('anonyme'));
    expect(screen.getByTestId('motif')).toHaveTextContent('aucun');
    expect(coffre.contenu).not.toBeNull();
  });
});

// --------------------------------------------------------------------------
// connexion
// --------------------------------------------------------------------------

describe('connexion', () => {
  async function monterAuth(fetchImpl: typeof fetch, coffre = coffreDeTest(null)) {
    function AvecAuth() {
      const session = useSession();
      if (session.etat === 'retablissement') return null;
      return (
        <>
          <Sonde />
          {session.etat === 'anonyme' ? <AuthScreen motif={session.motif} /> : null}
        </>
      );
    }
    await render(
      <Cadre coffre={coffre} fetchImpl={fetchImpl}>
        <AvecAuth />
      </Cadre>,
    );
    // L'entrée est l'accueil, avec sa vidéo en fond ; le formulaire ne vient
    // qu'après une porte. On attend donc l'un **ou** l'autre plutôt que de
    // supposer lequel — le montage sert les deux parcours.
    await waitFor(() =>
      expect(
        screen.queryByTestId('ecran-accueil') ?? screen.getByTestId('ecran-auth'),
      ).toBeTruthy(),
    );
    return coffre;
  }

  /**
   * Monte l'écran **et va au formulaire de connexion**.
   *
   * L'entrée est désormais le choix de la porte, comme la maquette le veut :
   * on demandait de se connecter à quelqu'un qui n'a pas encore de compte. Les
   * tests qui éprouvent la connexion franchissent donc le lien de coin, comme
   * la personne qu'ils imitent.
   */
  async function monterConnexion(fetchImpl: typeof fetch, coffre = coffreDeTest(null)) {
    const rendu = await monterAuth(fetchImpl, coffre);
    if (screen.queryByTestId('vers-connexion')) {
      await fireEvent.press(screen.getByTestId('vers-connexion'));
    }
    await waitFor(() => expect(screen.getByTestId('champ-email')).toBeTruthy());
    return rendu;
  }

  it('ouvre une session et relit le rôle depuis le serveur', async () => {
    // Le rôle ne se déduit pas d'un jeton décodé côté client : ce serait
    // laisser l'appareil se déclarer administrateur.
    const coffre = await monterConnexion(
      serveur({
        '/auth/login': { corps: { access_token: 'a', refresh_token: 'r' } },
        '/me': { corps: { ...UTILISATEUR, role: 'admin' } },
      }) as typeof fetch,
    );

    await fireEvent.changeText(screen.getByTestId('champ-email'), 'admin@bind.example');
    await fireEvent.changeText(screen.getByTestId('champ-mot-de-passe'), 'un-mot-de-passe-long');
    await fireEvent.press(screen.getByTestId('valider'));

    await waitFor(() => expect(screen.getByTestId('role')).toHaveTextContent('admin'));
    expect(coffre.contenu).toEqual({ access_token: 'a', refresh_token: 'r' });
  });

  it('garde le bouton visible et désactivé tant que la saisie est incomplète', async () => {
    // **Il était retiré, il est maintenant grisé.** `components.md` §1 fait
    // disparaître l'action impossible ; la passation v0.6 nomme cette
    // exception — c'est une action qui redeviendra possible dès qu'on aura
    // fini de taper. Le retirer laissait un écran sans issue visible.
    await monterConnexion(serveur({}) as typeof fetch);
    expect(screen.getByTestId('valider').props.accessibilityState.disabled).toBe(true);

    await fireEvent.changeText(screen.getByTestId('champ-email'), 'a@b.example');
    expect(screen.getByTestId('valider').props.accessibilityState.disabled).toBe(true);

    await fireEvent.changeText(screen.getByTestId('champ-mot-de-passe'), 'douze-caracteres');
    expect(screen.getByTestId('valider').props.accessibilityState.disabled).toBe(false);
  });

  it('exige la confirmation du mot de passe, à l’inscription seulement', async () => {
    /**
     * **Un mot de passe masqué se saisit à l'aveugle.** Une faute de frappe
     * crée un compte auquel personne ne peut se connecter, et le seul recours
     * est de recommencer avec une autre adresse.
     *
     * Éprouvé dans les deux sens : le bouton reste fermé tant que les deux
     * saisies diffèrent, et s'ouvre quand elles se rejoignent. Une garde qui
     * refuserait toujours passerait la première moitié sans rien garantir.
     */
    await monterConnexion(serveur({}) as typeof fetch);
    await fireEvent.press(screen.getByTestId('basculer'));
    await fireEvent.press(screen.getByTestId('choisir-creator'));

    await fireEvent.changeText(screen.getByTestId('champ-email'), 'a@b.example');
    await fireEvent.changeText(screen.getByTestId('champ-mot-de-passe'), 'douze-caracteres');
    // Le mot de passe est complet, la confirmation est vide : rien ne part.
    expect(screen.getByTestId('valider').props.accessibilityState.disabled).toBe(true);

    await fireEvent.changeText(screen.getByTestId('champ-confirmation'), 'douze-caracteree');
    expect(screen.getByTestId('valider').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText(en.auth.confirmationDiscordante)).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('champ-confirmation'), 'douze-caracteres');
    expect(screen.getByTestId('valider').props.accessibilityState.disabled).toBe(false);
  });

  it('ne demande aucune confirmation à la connexion', async () => {
    // Elle n'y a aucun sens : le serveur dit déjà si c'est le bon. L'exiger
    // ferait taper deux fois un mot de passe qu'on connaît.
    await monterConnexion(serveur({}) as typeof fetch);

    expect(screen.queryByTestId('champ-confirmation')).toBeNull();
  });

  it('dit ce qui manque au mot de passe, en clair et en chiffres', async () => {
    // Un bouton grisé sans explication ne vaut pas mieux qu'un bouton absent.
    await monterConnexion(serveur({}) as typeof fetch);
    await fireEvent.press(screen.getByTestId('basculer'));
    await fireEvent.press(screen.getByTestId('choisir-creator'));

    await fireEvent.changeText(screen.getByTestId('champ-mot-de-passe'), 'six123');
    expect(screen.getByTestId('jauge')).toHaveTextContent('6 / 12');
    expect(screen.getByText(/Six to go|6 to go/)).toBeTruthy();

    // Et la jauge disparaît une fois le compte atteint : elle n'a plus rien
    // à dire, et la laisser ferait douter.
    await fireEvent.changeText(screen.getByTestId('champ-mot-de-passe'), 'douze-caracteres');
    expect(screen.queryByTestId('jauge')).toBeNull();
  });

  it('masque le mot de passe, et l’œil le relit', async () => {
    // Il s'affichait en clair : douze caractères en grand, sur le premier
    // écran du produit. Éprouvé sur l'écran et pas seulement sur le composant
    // — `TextField` sait masquer depuis toujours si on le lui demande, et
    // personne ne le lui demandait.
    await monterConnexion(serveur({}) as typeof fetch);

    expect(screen.getByTestId('champ-mot-de-passe').props.secureTextEntry).toBe(true);
    // L'e-mail, lui, reste lisible : un masque posé partout se relirait comme
    // un succès dans un test et comme une régression à l'écran.
    expect(screen.getByTestId('champ-email').props.secureTextEntry).toBeFalsy();

    await fireEvent.press(screen.getByTestId('champ-mot-de-passe-revelation'));
    expect(screen.getByTestId('champ-mot-de-passe').props.secureTextEntry).toBe(false);
  });

  it('traduit un refus, sans jamais montrer le code', async () => {
    await monterConnexion(
      serveur({
        '/auth/login': { status: 401, corps: { detail: 'invalid_credentials' } },
      }) as typeof fetch,
    );

    await fireEvent.changeText(screen.getByTestId('champ-email'), 'a@b.example');
    await fireEvent.changeText(screen.getByTestId('champ-mot-de-passe'), 'mauvais-mot-de-passe');
    await fireEvent.press(screen.getByTestId('valider'));

    await waitFor(() => expect(screen.getByTestId('echec-auth')).toBeTruthy());
    expect(screen.getByText(en.errors.invalid_credentials)).toBeTruthy();
    expect(screen.queryByText('invalid_credentials')).toBeNull();
  });

  it('dit qu’un compte est suspendu, et le distingue d’une session expirée', async () => {
    // L'API répond 401 partout ailleurs sans distinguer ; la connexion, elle,
    // rend `account_not_active`. C'est le seul endroit où on l'apprend.
    await monterConnexion(
      serveur({
        '/auth/login': { status: 403, corps: { detail: 'account_not_active' } },
      }) as typeof fetch,
    );

    await fireEvent.changeText(screen.getByTestId('champ-email'), 'a@b.example');
    await fireEvent.changeText(screen.getByTestId('champ-mot-de-passe'), 'un-mot-de-passe-long');
    await fireEvent.press(screen.getByTestId('valider'));

    await waitFor(() => expect(screen.getByTestId('motif')).toHaveTextContent('compte_suspendu'));
  });

  it('ouvre deux portes à l’inscription, et jamais celle de l’administration', async () => {
    // L'API accepte le rôle administrateur ; l'offrir dans un formulaire
    // public en ferait une case à cocher. Les pastilles ont disparu, la
    // garantie non.
    await monterAuth(serveur({}) as typeof fetch);

    // **Les portes sont l'entrée**, pas une étape derrière un lien : on
    // demandait de se connecter à quelqu'un qui n'a pas encore de compte.
    expect(screen.getByTestId('porte-createur')).toBeTruthy();
    expect(screen.getByTestId('porte-commerce')).toBeTruthy();
    expect(screen.queryByText(/admin/i)).toBeNull();
  });

  it('demande la porte avant le formulaire, et la retient', async () => {
    // Le rôle se choisissait entre le mot de passe et le bouton : au moment
    // où l'on remplit, pas au moment où l'on décide.
    await monterAuth(serveur({}) as typeof fetch);

    // Aucun champ tant que la porte n'est pas franchie.
    expect(screen.queryByTestId('champ-email')).toBeNull();

    await fireEvent.press(screen.getByTestId('choisir-business_member'));
    expect(screen.getByTestId('champ-email')).toBeTruthy();
    expect(screen.getByText(en.auth.autrePorteCommerce)).toBeTruthy();

    // Et l'on peut revenir choisir l'autre.
    await fireEvent.press(screen.getByTestId('revenir-aux-portes'));
    expect(screen.getByTestId('porte-createur')).toBeTruthy();
  });
});

// --------------------------------------------------------------------------
// déconnexion
// --------------------------------------------------------------------------

describe('déconnexion', () => {
  it('ferme la session localement même si le serveur ne répond pas', async () => {
    // Un serveur injoignable ne doit pas laisser quelqu'un connecté sur un
    // téléphone qu'il vient de rendre.
    const coffre = coffreDeTest({ access_token: 'a', refresh_token: 'r' });
    let premierAppel = true;

    await render(
      <Cadre
        coffre={coffre}
        fetchImpl={
          (async (url: RequestInfo | URL) => {
            if (String(url).includes('/me') && premierAppel) {
              premierAppel = false;
              return { ok: true, status: 200, json: async () => UTILISATEUR } as Response;
            }
            throw new TypeError('offline');
          }) as unknown as typeof fetch
        }
      >
        <Sonde />
        <ReglagesScreen />
      </Cadre>,
    );

    await waitFor(() => expect(screen.getByTestId('etat')).toHaveTextContent('connecte'));
    await fireEvent.press(screen.getByTestId('se-deconnecter'));

    await waitFor(() => expect(screen.getByTestId('etat')).toHaveTextContent('anonyme'));
    expect(screen.getByTestId('motif')).toHaveTextContent('deconnexion');
    expect(coffre.contenu).toBeNull();
  });

  it('et les réponses en cache partent avec elle', async () => {
    // **Une réponse en cache est de la donnée personnelle.** Un fil, une
    // appartenance, un catalogue : les laisser survivre à une déconnexion les
    // rendrait lisibles au suivant, sur un téléphone prêté comme sur un poste
    // partagé. Le décor pose une entrée **et** une préférence d'appareil : sans
    // la seconde, une purge qui viderait tout le stockage passerait ce test en
    // dépréglant l'application de quelqu'un qui se contente de sortir.
    await ecrireAuCache('fil.10.toutes', { rien: true }, Date.now());
    await AsyncStorage.setItem('bind.commerce.choisi', 'b1');

    const coffre = coffreDeTest({ access_token: 'a', refresh_token: 'r' });
    let premierAppel = true;
    await render(
      <Cadre
        coffre={coffre}
        fetchImpl={
          (async (url: RequestInfo | URL) => {
            if (String(url).includes('/me') && premierAppel) {
              premierAppel = false;
              return { ok: true, status: 200, json: async () => UTILISATEUR } as Response;
            }
            throw new TypeError('offline');
          }) as unknown as typeof fetch
        }
      >
        <Sonde />
        <ReglagesScreen />
      </Cadre>,
    );

    await waitFor(() => expect(screen.getByTestId('etat')).toHaveTextContent('connecte'));
    await fireEvent.press(screen.getByTestId('se-deconnecter'));

    await waitFor(() => expect(screen.getByTestId('etat')).toHaveTextContent('anonyme'));
    expect(await lireDuCache('fil.10.toutes')).toBeNull();
    expect(await AsyncStorage.getItem('bind.commerce.choisi')).toBe('b1');
  });
});

// --------------------------------------------------------------------------
// thème par rôle
// --------------------------------------------------------------------------

describe('thème', () => {
  it('associe chaque rôle de l’API à son thème', () => {
    // Deux vocabulaires : `business_member` en base, `merchant` au design.
    expect(themeDuRole('creator')).toBe('creator');
    expect(themeDuRole('business_member')).toBe('merchant');
    expect(themeDuRole('admin')).toBe('admin');
  });
});

// --------------------------------------------------------------------------
// erreur globale
// --------------------------------------------------------------------------

describe('frontière d’erreur', () => {
  function Tombe(): never {
    throw new Error('TypeError: Cannot read properties of undefined (reading « offres »)');
  }

  it('n’affiche jamais la trace technique', async () => {
    const bruit = jest.spyOn(console, 'error').mockImplementation(() => {});

    await render(
      <I18nProvider initialLocale="en">
        <ThemeProvider role="creator">
          <FrontiereDErreur>
            <Tombe />
          </FrontiereDErreur>
        </ThemeProvider>
      </I18nProvider>,
    );

    expect(screen.getByTestId('ecran-erreur-globale')).toBeTruthy();
    expect(screen.getByText(en.global.erreurCorps)).toBeTruthy();
    // Rien de la trace ne remonte à l'écran.
    expect(screen.queryByText(/TypeError/)).toBeNull();
    expect(screen.queryByText(/undefined/)).toBeNull();

    // Elle est journalisée, en revanche : c'est le seul endroit du produit où
    // l'on veut la pile entière.
    expect(bruit).toHaveBeenCalled();
    bruit.mockRestore();
  });

  it('offre une issue plutôt qu’un cul-de-sac', async () => {
    const bruit = jest.spyOn(console, 'error').mockImplementation(() => {});

    await render(
      <I18nProvider initialLocale="en">
        <ThemeProvider role="creator">
          <FrontiereDErreur>
            <Tombe />
          </FrontiereDErreur>
        </ThemeProvider>
      </I18nProvider>,
    );

    // Sans bouton, un plantage demande de tuer l'application et de la relancer.
    expect(screen.getByTestId('rejouer')).toBeTruthy();
    bruit.mockRestore();
  });

  it('laisse passer ce qui ne tombe pas', async () => {
    // Le pendant : une frontière qui afficherait toujours son écran d'erreur
    // passerait les deux tests précédents.
    await render(
      <I18nProvider initialLocale="en">
        <ThemeProvider role="creator">
          <FrontiereDErreur>
            <Text testID="contenu">tout va bien</Text>
          </FrontiereDErreur>
        </ThemeProvider>
      </I18nProvider>,
    );

    expect(screen.getByTestId('contenu')).toBeTruthy();
    expect(screen.queryByTestId('ecran-erreur-globale')).toBeNull();
  });
});

// --------------------------------------------------------------------------
// aiguillage par rôle
// --------------------------------------------------------------------------

describe('aiguillage par rôle', () => {
  /**
   * Monte la navigation réelle pour un rôle donné.
   *
   * Le serveur simulé répond à tout par une réponse vide : ce qui est vérifié
   * n'est pas le contenu des écrans — ils ont leurs propres tests — mais quels
   * onglets existent.
   */
  /**
   * Les chemins réellement demandés au serveur pendant le dernier montage.
   *
   * Un onglet absent ne prouve pas qu'aucun écran de l'autre rôle ne tourne :
   * un écran monté hors de la barre demanderait sa route sans rien afficher.
   * Ce que le serveur reçoit le dit, et rien d'autre.
   */
  let chemins: string[] = [];

  async function monterPour(role: Utilisateur['role']) {
    chemins = [];
    // Certaines routes rendent une liste, d'autres un objet. Servir la
    // mauvaise forme ferait tomber un écran et le test accuserait la
    // navigation d'un défaut qui serait le sien.
    // `/support-access` rend une liste, comme `/creators` trois lignes plus
    // bas : deuxième fois que le repli générique de ce double — un objet vide —
    // fait tomber une garde sur un défaut du double et non du produit.
    const LISTES = [
      '/me/audience',
      '/me/verification',
      '/admin/',
      '/collaborations',
      '/support-access',
      // Le lieu et les prestations chargent des listes : sans elles, le repli
      // générique rend un objet vide et l'écran lève sur un `.filter` — un
      // défaut du double, pas du produit. Troisième fois dans ce fichier.
      '/catalog-items',
      '/photos',
      '/menu',
      '/tiers',
      '/tier-offers',
      '/capacity-rules',
      '/capacity-exceptions',
    ];
    const OBJETS: Record<string, unknown> = {
      // **Le score vit dans la réponse des paliers**, et l'audience le lit :
      // sans lui, l'écran lève avant d'atteindre la ligne qu'on éprouve.
      '/me/tiers': {
        creator_id: 'u1',
        is_new_creator: true,
        paliers: [],
        fiabilite: { reliability_score: null, composantes: null },
      },
      '/me/bookings': { items: [], compteurs: {} },
      // **Avant `/businesses`, et c'est tout le sujet.** La table se lit par
      // fragment, dans l'ordre d'insertion : `/admin/businesses` contient
      // `/businesses`, donc le fragment le plus court gagnait et rendait un
      // objet là où l'écran attend une liste. Le repli générique n'y pouvait
      // rien — il n'était jamais atteint. Le même piège que `/me/audience`,
      // d'un cran plus bas : ce n'est pas la table contre le repli, c'est un
      // fragment de la table contre un autre.
      '/admin/businesses': [],
      '/businesses': { commerces: [], obstacles: [] },
      '/bookings': {
        jour: '2026-08-08',
        timezone: 'UTC',
        debut: '',
        fin: '',
        items: [],
        a_trancher: [],
      },
      '/reporting': { reservations: 0, par_palier: [], par_item: [], par_semaine: [] },
      '/activation': [],
      // L'annuaire rend une liste. Le repli générique de ce double est un
      // objet vide, sur lequel l'écran appelait `.map` — la garde tombait sur
      // un défaut du double, pas du produit.
      '/creators': [],
      // **L'audience doit porter un compte**, sans quoi l'écran rend son état
      // vide et la ligne vers les paliers n'existe pas. Un double qui rend une
      // liste vide partout monte un écran qui n'est pas celui qu'on éprouve.
      '/me/audience': [
        {
          social_account_id: 's1',
          platform: 'instagram',
          handle: '@lea.mrl',
          status: 'connected',
          verification_status: 'approved',
          followers_count: 4200,
          following_count: 300,
          media_count: 120,
          avg_views: 900,
          engagement_rate: '3.10',
          captured_at: '2026-08-22T09:00:00Z',
          reconnectable: false,
          token_expires_at: null,
        },
      ],
    };

    const fetchImpl = (async (url: RequestInfo | URL) => {
      const chemin = String(url);
      chemins.push(chemin);
      const rendre = (corps: unknown) =>
        ({ ok: true, status: 200, json: async () => corps }) as Response;

      if (chemin.includes('/me/businesses')) {
        return rendre([{ id: 'b1', name: 'Ocean Beauty Studio' }]);
      }
      if (chemin.endsWith('/me')) return rendre({ ...UTILISATEUR, role });
      // **La table nommée avant le repli générique.** `/me/audience` est dans
      // les deux : sans cet ordre, la liste vide gagnerait et le décor
      // n'aurait aucun effet.
      const trouve = Object.entries(OBJETS).find(([fragment]) => chemin.includes(fragment));
      if (trouve) return rendre(trouve[1]);
      if (LISTES.some((fragment) => chemin.includes(fragment))) return rendre([]);

      return rendre({});
    }) as unknown as typeof fetch;

    function AvecNavigation() {
      const session = useSession();
      if (session.etat !== 'connecte') return null;
      return <Navigation role={session.utilisateur.role} />;
    }

    await render(
      <Cadre coffre={coffreDeTest({ access_token: 'a', refresh_token: 'r' })} fetchImpl={fetchImpl}>
        <AvecNavigation />
      </Cadre>,
    );
    // **Le premier onglet du rôle, et non « Settings ».** Celui-ci était le
    // repère commode tant que les trois rôles le portaient en barre ; le
    // commerce ne l'y a plus sur un téléphone — quatre onglets en bas, le reste
    // sous « More » — et l'attente expirait sur une absence qui est le nouveau
    // comportement voulu.
    const premier = role === 'creator' ? en.onglets.fil : role === 'admin' ? en.onglets.arbitrage : en.onglets.journee;
    await waitFor(() => expect(screen.getAllByText(premier).length).toBeGreaterThan(0));
  }

  /** Les libellés d'onglets présents à l'écran. */
  function onglets(): string[] {
    return Object.values(en.onglets).filter((libelle) => screen.queryAllByText(libelle).length > 0);
  }

  it('la ligne de l’audience mène vraiment aux paliers', async () => {
    /**
     * **Le seul chemin vers les paliers depuis qu'ils ont quitté le fil**, et
     * il ne menait nulle part : `navigate('paliers')` désignait un onglet qui
     * n'a jamais existé. L'appui partait, React Navigation ignorait le nom, et
     * rien ne bougeait — ce qui se lit exactement comme un texte non cliquable.
     *
     * **La garde des noms ne suffit pas à elle seule.** Elle dit que la
     * destination est déclarée quelque part ; elle ne dit pas qu'on y arrive.
     * Celle-ci appuie et regarde l'écran qui vient.
     */
    await monterPour('creator');

    await fireEvent.press(screen.getAllByText(en.onglets.audience)[0]);
    await waitFor(() => expect(screen.getByTestId('ecran-audience')).toBeTruthy());

    await fireEvent.press(await screen.findByTestId('voir-mes-paliers'));

    await waitFor(() => expect(screen.getByTestId('ecran-paliers')).toBeTruthy());
  });

  it('le créateur voit ses quatre onglets, et aucun autre', async () => {
    await monterPour('creator');
    const vus = onglets();

    // **Quatre, et non plus cinq.** Les paliers ont quitté la barre : un onglet
    // répond à une question qu'on se pose en ouvrant l'application, et « quel
    // est mon palier » n'en est pas une. Ce qu'on veut savoir, c'est ce qu'on
    // peut réserver — le fil répond, et les paliers l'expliquent depuis une
    // ligne du fil.
    expect(vus).toEqual([
      en.onglets.fil,
      en.onglets.reservations,
      en.onglets.audience,
      en.onglets.reglages,
    ]);
    // Écrit en égalité stricte et non en « contient » : la version d'avant
    // laissait passer un onglet de plus sans rien dire, ce qui est exactement
    // la faute qu'on vient de corriger à la main.
    expect(vus).not.toContain(en.onglets.paliers);
    // Un onglet qui répondrait 403 est pire qu'un onglet absent.
    for (const interdit of [en.onglets.journee, en.onglets.arbitrage, en.onglets.plans]) {
      expect(vus).not.toContain(interdit);
    }
  });

  it('le commerce voit les siens, et pas ceux du créateur', async () => {
    await monterPour('business_member');
    const vus = onglets();

    // **Quatre en barre, et quatre sous le menu.** Les huit venaient de la
    // barre latérale de bureau, où 240 points les portent sans effort ;
    // transposées en bas d'un iPhone elles font des cibles de 48. Le tri est
    // celui de la fréquence : ce qui porte une échéance reste en bas, ce qu'on
    // a composé une fois passe sous « More ».
    expect(vus).toEqual(
      expect.arrayContaining([
        en.onglets.journee,
        // La caisse est un onglet, et non un écran atteint depuis une ligne de
        // réservation : une journée vide la rendait inaccessible, et le salon
        // ne pouvait valider aucun code.
        en.onglets.caisse,
        en.onglets.publications,
        en.onglets.menu,
      ]),
    );
    for (const interdit of [en.onglets.paliers, en.onglets.audience, en.onglets.arbitrage]) {
      expect(vus).not.toContain(interdit);
    }
  });

  /**
   * Les routes qui n'appartiennent qu'au créateur.
   *
   * `/me` et `/me/businesses` n'en sont pas : la première dit qui l'on est,
   * la seconde est la route du commerce.
   */
  const ROUTES_DU_CREATEUR = ['/me/bookings', '/me/tiers', '/me/audience', '/me/verification'];

  /**
   * Ouvre chaque onglet du rôle, l'un après l'autre.
   *
   * **Le montage seul ne prouve rien.** Les onglets sont paresseux : seul le
   * premier existe tant qu'on n'a pas pressé les autres. Un écran de créateur
   * rangé sur le troisième onglet ne demanderait donc rien pendant tout un
   * test qui se contente de monter, et la garde annoncerait « aucune route de
   * créateur » sur un arbre qui en contient un.
   */
  async function parcourirLesOnglets() {
    for (const libelle of onglets()) {
      await fireEvent.press(screen.getAllByText(libelle)[0]);
    }
  }

  it('le commerce ne demande aucune route de créateur, sur aucun de ses onglets', async () => {
    // `GET /me/bookings` partait en étant connecté en commerce, où ce rôle n'a
    // rien à faire. Compter les onglets ne l'aurait pas vu : un écran monté
    // sous un libellé d'onglet du commerce demande sa route sans rien annoncer,
    // et la réponse — un 403, ou le 500 que cette route rendait — n'apparaît
    // que dans la console de quelqu'un qui regardait.
    await monterPour('business_member');
    await parcourirLesOnglets();

    const fautives = chemins.filter((chemin) =>
      ROUTES_DU_CREATEUR.some((route) => chemin.includes(route)),
    );
    expect(fautives).toEqual([]);
  });

  it('l’administrateur non plus', async () => {
    await monterPour('admin');
    await parcourirLesOnglets();

    const fautives = chemins.filter((chemin) =>
      ROUTES_DU_CREATEUR.some((route) => chemin.includes(route)),
    );
    expect(fautives).toEqual([]);
  });

  it('le créateur, lui, la demande bien', async () => {
    // Le pendant, sur la même route et par le même geste. Sans lui, une
    // navigation qui ne monterait plus aucun écran passerait le test précédent
    // en ne demandant rien du tout.
    await monterPour('creator');
    await fireEvent.press(screen.getAllByText(en.onglets.reservations)[0]);

    await waitFor(() =>
      expect(chemins.some((chemin) => chemin.includes('/me/bookings'))).toBe(true),
    );
  });

  it('l’administrateur ne voit ni fil ni caisse', async () => {
    await monterPour('admin');
    const vus = onglets();

    expect(vus).toEqual(
      expect.arrayContaining([en.onglets.arbitrage, en.onglets.plans, en.onglets.reglages]),
    );
    for (const interdit of [
      en.onglets.fil,
      en.onglets.journee,
      en.onglets.caisse,
      en.onglets.paliers,
    ]) {
      expect(vus).not.toContain(interdit);
    }
  });

  it('la barre d’onglets laisse la place à l’indicateur d’accueil', async () => {
    await monterPour('creator');

    // Les libellés se lisaient « Nearbv », « Bookinas », « Settinas » : la
    // barre s'arrêtait au bord de l'écran et l'indicateur d'accueil recouvrait
    // leur dernière ligne de pixels. La marge du bas ne peut pas venir de
    // `ZoneSure` — la barre est collée au bord, et l'y remonter laisserait une
    // bande de fond dessous.
    const barre = screen.getByText(en.onglets.fil);
    const marges = IPHONE_A_ENCOCHE.insets;

    // On remonte jusqu'au conteneur qui porte la hauteur : le libellé lui-même
    // n'a que sa typographie.
    type Noeud = { parent: Noeud | null; props: { style?: unknown } };
    let noeud: Noeud | null = barre as unknown as Noeud;
    let trouve: Record<string, unknown> | null = null;
    while (noeud !== null && trouve === null) {
      const style = styleAplati(noeud);
      if (typeof style.paddingBottom === 'number') trouve = style;
      noeud = noeud.parent;
    }

    expect(trouve).not.toBeNull();
    expect(trouve!.paddingBottom as number).toBeGreaterThanOrEqual(marges.bottom);
  });

  it('les réglages sont joignables depuis les trois rôles', async () => {
    // C'est le seul chemin vers la déconnexion : l'oublier dans un arbre
    // enfermerait quelqu'un dans une session qu'il ne peut pas quitter.
    for (const role of ['creator', 'admin'] as const) {
      const rendu = await monterPour(role);
      expect(screen.queryAllByText(en.onglets.reglages).length).toBeGreaterThan(0);
      void rendu;
    }

  });

  /**
   * **Le commerce y arrive par le menu, et il faut le prouver en appuyant.**
   *
   * Un écran retiré de la barre reste une destination — c'est exactement ce
   * qu'on peut casser sans qu'aucune autre garde ne bouge, puisque le nom reste
   * déclaré et que la garde des destinations se contente de le trouver. Et les
   * réglages sont le seul chemin vers la déconnexion : les perdre enfermerait
   * un gérant dans une session qu'il ne peut pas quitter.
   *
   * Son propre `it` plutôt que la suite du précédent : trois montages de la
   * coquille entière dans un même test dépassaient le budget de cinq secondes,
   * et un test qui expire ne dit pas ce qu'il éprouvait.
   */
  it('et le commerce les atteint par le menu, où ils sont rangés', async () => {
    await monterPour('business_member');
    await fireEvent.press(screen.getAllByText(en.onglets.menu)[0]);
    // eslint-disable-next-line no-console
    await fireEvent.press(await screen.findByTestId('menu-reglages'));
    await waitFor(() => expect(screen.getByTestId('ecran-reglages')).toBeTruthy());
    // Quinze secondes, écrites parce que ce test monte la coquille entière puis
    // traverse deux écrans : le budget d'usine de cinq expirait avant la fin du
    // parcours, sur une machine chargée, et un test qui expire ne dit pas ce
    // qu'il éprouvait.
  }, 15_000);
});

// --------------------------------------------------------------------------
// zone sûre
// --------------------------------------------------------------------------

describe('zone sûre', () => {
  /**
   * Les marges d'un iPhone à encoche.
   *
   * `initialMetrics` est le seul moyen de les éprouver hors appareil : un
   * navigateur ne rend pas `env(safe-area-inset-top)`, et un simulateur
   * n'entre pas dans une suite de tests. Ces valeurs sont celles d'un
   * iPhone 13.
   */

  it('décale le contenu sous l’encoche, au niveau de la coquille', async () => {
    // Le titre passait dessous et se coupait, sur **tous** les écrans. Traité
    // ici plutôt qu'écran par écran : un écran qui l'oublierait rouvrirait le
    // défaut, et l'oubli ne se voit que sur un appareil à encoche.
    await render(
      <SafeAreaProvider initialMetrics={IPHONE_A_ENCOCHE}>
        <I18nProvider initialLocale="en">
          <ThemeProvider role="creator">
            <ZoneSure>
              <Text testID="contenu">titre</Text>
            </ZoneSure>
          </ThemeProvider>
        </I18nProvider>
      </SafeAreaProvider>,
    );

    const zone = screen.getByTestId('zone-sure');
    expect(styleAplati(zone).paddingTop).toBe(47);
    // Le bas est laissé à la barre d'onglets, qui pose le sien : l'ajouter ici
    // la ferait flotter au-dessus du bord.
    expect(styleAplati(zone).paddingBottom ?? 0).toBe(0);
  });

  it('ne laisse pas la bande d’encoche transparente', async () => {
    // Sans couleur, elle laisse voir la racine et coupe l'écran d'une bande
    // qui ne suit pas le thème. Le défaut se voyait surtout en sombre, où la
    // racine blanche tranchait ; il existe dans les deux sens.
    await render(
      <SafeAreaProvider initialMetrics={IPHONE_A_ENCOCHE}>
        <I18nProvider initialLocale="en">
          <ThemeProvider role="creator">
            <ZoneSure>
              <Text>titre</Text>
            </ZoneSure>
          </ThemeProvider>
        </I18nProvider>
      </SafeAreaProvider>,
    );

    expect(styleAplati(screen.getByTestId('zone-sure')).backgroundColor).toBe(
      couleurs['bg.page'],
    );
  });
});
