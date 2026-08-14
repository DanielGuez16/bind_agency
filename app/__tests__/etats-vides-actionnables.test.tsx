/**
 * Deux états vides qui ne menaient nulle part.
 *
 * **Le même défaut, deux fois, aux deux portes d'entrée du produit.** `Ecran`
 * rend son état vide *à la place* du contenu. Un écran dont la seule action
 * vit dans le contenu perd donc cette action exactement dans le cas où elle
 * sert — celui du compte neuf, qui n'a rien.
 *
 * - **Le commerce qui s'inscrit seul.** `POST /business` existait depuis la
 *   première phase et rien ne l'appelait : l'onglet d'attente affichait
 *   « votre commerce n'est pas encore en ligne » et rien d'autre. Le seul
 *   chemin vers un commerce passait par le mode terrain, c'est-à-dire par
 *   quelqu'un d'autre.
 * - **Le mode terrain.** Le formulaire de préparation était complet, et rendu
 *   dans le corps de l'écran. Tant qu'aucune fiche n'existait — soit à la
 *   toute première tournée, celle pour laquelle l'écran a été écrit — l'état
 *   vide le remplaçait. La fondatrice voyait « aucune fiche préparée » et
 *   n'avait aucun moyen d'en préparer une.
 *
 * **Pourquoi les tests d'écran existants ne l'ont pas vu.** Ils montent chaque
 * écran dans ses quatre états et vérifient, pour le vide, que le texte du vide
 * s'affiche. C'est exactement ce que faisait le produit. Une garde qui
 * n'éprouve que ce qu'on avait en tête laisse passer ce qu'on n'y avait pas :
 * ce fichier vérifie qu'un état vide **porte son action**, pas qu'il porte sa
 * phrase.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { ThemeProvider } from '../src/theme';
import { CreationDuCommerceScreen } from '../src/screens/CreationDuCommerceScreen';
import { TerrainScreen } from '../src/screens/TerrainScreen';
import { useMonCommerce } from '../src/shell/useMonCommerce';

const coffre = { lire: async () => null, ecrire: async () => {} };

/**
 * Un client qui note ce qui part.
 *
 * L'envoi compte autant que le rendu : un formulaire qui s'affiche et
 * n'appelle rien est le même cul-de-sac, une capture d'écran plus loin.
 */
function clientEspion(
  table: Record<string, unknown>,
  envois: { chemin: string; methode: string; corps: unknown }[],
): ApiClient {
  return new ApiClient({
    baseUrl: 'https://api.test',
    coffre,
    fetchImpl: async (url, init) => {
      const chemin = String(url);
      envois.push({
        chemin,
        methode: init?.method ?? 'GET',
        corps: init?.body ? JSON.parse(String(init.body)) : null,
      });
      const trouve = Object.entries(table).find(([fragment]) => chemin.includes(fragment));
      if (!trouve) throw new Error(`route non simulée : ${chemin}`);
      return { ok: true, status: 200, json: async () => trouve[1] } as Response;
    },
  });
}

/**
 * `render` et `fireEvent` sont asynchrones depuis la version 14 de la
 * bibliothèque : l'arbre n'est à jour qu'une fois leur promesse résolue. Un
 * garde-fou du dépôt le vérifie ligne à ligne, et c'est lui qui a été écrit
 * après huit exécutions rouges.
 */
async function monter(noeud: ReactElement, client: ApiClient) {
  function Cadre({ children }: { children: ReactNode }) {
    return (
      <I18nProvider initialLocale="en">
        <ThemeProvider role="merchant">
          <ApiProvider client={client}>{children}</ApiProvider>
        </ThemeProvider>
      </I18nProvider>
    );
  }
  return render(<Cadre>{noeud}</Cadre>);
}

// --------------------------------------------------------------------------
// le commerce qui s'inscrit seul
// --------------------------------------------------------------------------

describe('création d’un commerce', () => {
  it('envoie le nom, la catégorie choisie et la devise, et prévient l’appelant', async () => {
    const envois: { chemin: string; methode: string; corps: unknown }[] = [];
    const client = clientEspion({ '/business': { id: 'b1', name: 'Ocean Nails' } }, envois);
    const cree = jest.fn();

    await monter(<CreationDuCommerceScreen onCree={cree} />, client);

    await fireEvent.changeText(screen.getByTestId('champ-nom-du-commerce'), 'Ocean Nails');
    // La catégorie n'est pas devinée : un commerce mal classé ne remonte dans
    // aucun filtre du fil, et le défaut ne se voit que côté créateur.
    await fireEvent.press(screen.getByTestId('categorie-fitness'));
    await fireEvent.changeText(screen.getByTestId('champ-adresse-du-commerce'), '120 Ocean Dr');
    await fireEvent.press(screen.getByTestId('creer-le-commerce'));

    await waitFor(() => expect(cree).toHaveBeenCalledTimes(1));

    const envoi = envois.find((e) => e.methode === 'POST');
    expect(envoi).toBeDefined();
    expect(envoi?.chemin).toContain('/business');
    expect(envoi?.corps).toEqual({
      name: 'Ocean Nails',
      category: 'fitness',
      currency: 'USD',
      address: '120 Ocean Dr',
      phone: null,
    });
  });

  it('n’envoie rien tant que le nom est vide', async () => {
    // Le serveur refuserait un nom vide, mais un aller-retour pour l'apprendre
    // est un aller-retour pendant lequel on ne sait pas ce qui se passe.
    const envois: { chemin: string; methode: string; corps: unknown }[] = [];
    await monter(
      <CreationDuCommerceScreen onCree={jest.fn()} />,
      clientEspion({ '/business': { id: 'b1', name: 'x' } }, envois),
    );

    await fireEvent.press(screen.getByTestId('creer-le-commerce'));

    expect(envois.filter((e) => e.methode === 'POST')).toHaveLength(0);
  });

  it('garde la saisie quand le serveur refuse', async () => {
    // Retaper trois champs parce qu'une adresse n'a pas été trouvée est la
    // façon la plus sûre de faire abandonner à la deuxième tentative.
    const client = new ApiClient({
      baseUrl: 'https://api.test',
      coffre,
      fetchImpl: async () =>
        ({ ok: false, status: 422, json: async () => ({ detail: 'validation_error' }) }) as Response,
    });
    const cree = jest.fn();

    await monter(<CreationDuCommerceScreen onCree={cree} />, client);
    await fireEvent.changeText(screen.getByTestId('champ-nom-du-commerce'), 'Ocean Nails');
    await fireEvent.press(screen.getByTestId('creer-le-commerce'));

    await waitFor(() => expect(screen.getByTestId('echec-creation-commerce')).toBeTruthy());
    expect(cree).not.toHaveBeenCalled();
    expect(screen.getByTestId('champ-nom-du-commerce').props.value).toBe('Ocean Nails');
  });

  it('dit que créer ne met pas en ligne', async () => {
    // La phrase est la seule chose qui empêche d'attendre des réservations le
    // soir même. Elle a un test parce qu'elle se supprime en une seconde.
    await monter(
      <CreationDuCommerceScreen onCree={jest.fn()} />,
      clientEspion({ '/business': {} }, []),
    );
    expect(screen.getByText(en.creationCommerce.ensuite)).toBeTruthy();
  });
});

// --------------------------------------------------------------------------
// l'onglet d'attente : là où le formulaire doit apparaître
// --------------------------------------------------------------------------

/**
 * Le formulaire branché à sa place.
 *
 * Sans ce montage, les tests ci-dessus prouvent qu'un écran de création
 * fonctionne **et rien de plus** : c'est exactement le genre de couverture qui
 * reste verte pendant qu'aucun onglet ne le monte. Ce qu'on éprouve ici est le
 * chemin, pas l'écran.
 */
function OngletDAttente() {
  return useMonCommerce().ecranDAttente;
}

describe('l’onglet d’attente du commerce', () => {
  it('monte le formulaire de création quand l’utilisateur n’a aucun commerce', async () => {
    const envois: { chemin: string; methode: string; corps: unknown }[] = [];
    await monter(<OngletDAttente />, clientEspion({ '/me/businesses': [] as unknown[] }, envois));

    await waitFor(() => expect(screen.getByTestId('creation-du-commerce')).toBeTruthy());
    expect(screen.getByTestId('creer-le-commerce')).toBeTruthy();
  });

  it('relit l’appartenance une fois le commerce créé', async () => {
    // **Le geste qui fait apparaître les onglets.** Sans ce rechargement,
    // le commerce existe côté serveur et l'application continue d'afficher le
    // formulaire qui vient de le créer — l'utilisateur en crée un deuxième.
    const envois: { chemin: string; methode: string; corps: unknown }[] = [];
    let cree = false;
    const client = new ApiClient({
      baseUrl: 'https://api.test',
      coffre,
      fetchImpl: async (url, init) => {
        const chemin = String(url);
        const methode = init?.method ?? 'GET';
        envois.push({ chemin, methode, corps: null });
        if (methode === 'POST') {
          cree = true;
          return { ok: true, status: 201, json: async () => ({ id: 'b1', name: 'Ocean' }) } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => (cree ? [{ id: 'b1', name: 'Ocean' }] : []),
        } as Response;
      },
    });

    await monter(<OngletDAttente />, client);
    await waitFor(() => expect(screen.getByTestId('creation-du-commerce')).toBeTruthy());

    await fireEvent.changeText(screen.getByTestId('champ-nom-du-commerce'), 'Ocean');
    await fireEvent.press(screen.getByTestId('creer-le-commerce'));

    // Deux lectures de l'appartenance : celle du montage, puis celle qui suit
    // la création. La seconde est ce qui manquerait.
    await waitFor(() =>
      expect(
        envois.filter((e) => e.methode === 'GET' && e.chemin.includes('/me/businesses')),
      ).toHaveLength(2),
    );
    // Et le formulaire cède la place : la requête n'est plus vide.
    await waitFor(() => expect(screen.queryByTestId('creation-du-commerce')).toBeNull());
  });
});

// --------------------------------------------------------------------------
// le mode terrain, sur un compte neuf
// --------------------------------------------------------------------------

describe('mode terrain sans aucune fiche', () => {
  it('offre le formulaire dans l’état vide, et le lie au serveur', async () => {
    // **Le défaut exact.** L'état vide remplaçait le corps de l'écran : la
    // fondatrice lisait « aucune fiche préparée » et n'avait rien pour en
    // préparer une. Le mode terrain était inutilisable au premier usage,
    // c'est-à-dire au seul qui compte pour une démonstration.
    const envois: { chemin: string; methode: string; corps: unknown }[] = [];
    const client = clientEspion(
      { '/admin/prospects': [] as unknown[] },
      envois,
    );

    await monter(<TerrainScreen />, client);

    await waitFor(() => expect(screen.getByTestId('etat-vide')).toBeTruthy());
    // La phrase du vide reste : elle explique pourquoi la liste est nue.
    expect(screen.getByText(en.terrain.videTitre)).toBeTruthy();
    // Et l'action est là, ce qui était le manque.
    expect(screen.getByTestId('formulaire-de-fiche')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('champ-nom'), 'Salon Ocean');
    await fireEvent.press(screen.getByTestId('enregistrer-la-fiche'));

    await waitFor(() => expect(envois.some((e) => e.methode === 'POST')).toBe(true));
    expect(envois.find((e) => e.methode === 'POST')?.corps).toMatchObject({
      name: 'Salon Ocean',
      category: 'beauty',
      currency: 'USD',
    });
  });

  it('garde le formulaire une fois qu’il y a des fiches', async () => {
    // Le sens inverse. Un formulaire déplacé dans le seul état vide
    // disparaîtrait dès la première fiche enregistrée — et la deuxième visite
    // de la journée n'aurait plus de porte.
    const envois: { chemin: string; methode: string; corps: unknown }[] = [];
    await monter(
      <TerrainScreen />,
      clientEspion(
        {
          '/admin/prospects': [
            {
              business_id: 'p1',
              name: 'Salon Ocean',
              status: 'draft',
              address: null,
              prepared_at: '2026-08-01T10:00:00Z',
              issued_at: null,
              expires_at: null,
              used_at: null,
              revoked_at: null,
              channel: null,
            },
          ],
        },
        envois,
      ),
    );

    await waitFor(() => expect(screen.getByTestId('fiche-p1')).toBeTruthy());
    expect(screen.getByTestId('formulaire-de-fiche')).toBeTruthy();
  });
});
