/**
 * L'en-tête du mur, et le filtre qu'il commande.
 *
 * Deux choses s'éprouvent ici, et elles ne se séparent pas : ce que l'en-tête
 * **dit** — l'endroit, le rayon, son compte — et ce qu'il **fait**, c'est-à-dire
 * passer une catégorie au serveur. Une chip qui s'allume sans changer la requête
 * est exactement le défaut que le produit poursuit ailleurs : un réglage qui ne
 * commande rien fait douter de ceux qui commandent quelque chose.
 *
 * Le filtre est donc vérifié **sur l'URL réellement appelée**, jamais sur
 * l'apparence de la chip. Trois couches étaient prêtes — la route l'accepte, le
 * client sait l'envoyer, le serveur rend les comptes — et rien ne les appelait :
 * c'est précisément le genre de manque qu'aucune assertion visuelle ne trouve.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { ApiClient, ApiProvider, type Fil } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { FilScreen } from '../src/screens/FilScreen';
import { ThemeProvider } from '../src/theme';

function salon(rang: number, categorie = 'beauty') {
  return {
    business_id: `b${rang}`,
    name: `Salon ${rang}`,
    category: categorie,
    address: null,
    cover_photo_key: null,
    cover_portrait_key: null,
    neighborhood: 'wynwood',
    distance_metres: 100 * rang,
    items: [
      {
        tier_offer_id: `o${rang}`,
        catalog_item_id: `i${rang}`,
        tier_id: 't1',
        social_account_id: 's1',
        name: 'Gel manicure',
        description: null,
        price_cents: 4500,
        currency: 'USD',
        duration_minutes: 45,
        requires_booking: true,
        photo_key: null,
        platform: 'instagram',
        content_format: 'story',
        value_ratio: null,
      },
    ],
  };
}

/**
 * Deux catégories par défaut : sous deux, la rangée ne s'affiche pas, et un
 * montage à une seule catégorie ferait passer sans rien couvrir tous les tests
 * qui suivent.
 */
function fil(extra: Partial<Fil> = {}): Fil {
  return {
    commerces: [salon(1), salon(2), salon(3)],
    obstacles: [],
    rayon_metres: 15_000,
    total_prestations: 3,
    categories: [
      { categorie: 'beauty', commerces: 5, prestations: 9 },
      { categorie: 'fitness', commerces: 4, prestations: 6 },
    ],
    rayons: [],
    quartiers: [
      { quartier: 'wynwood', commerces: 2, prestations: 3, distance_metres: 200 },
      { quartier: 'brickell', commerces: 1, prestations: 1, distance_metres: 900 },
    ],
    prochain_palier: null,
    ...extra,
  } as unknown as Fil;
}

/** Monte l'écran et rend la liste des URL appelées, dans l'ordre. */
async function monter(donnees: Fil = fil()) {
  const appels: string[] = [];
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: async (url: RequestInfo | URL) => {
      appels.push(String(url));
      return { ok: true, status: 200, json: async () => donnees } as Response;
    },
  });

  const vue = await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={api}>
          <FilScreen
            position={{ longitude: -80.19, latitude: 25.76 }}
            onDemanderLaPosition={() => {}}
            onVoirMesFavoris={() => {}}
            onOuvrirLeCommerce={() => {}}
          />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
  return { vue, appels };
}

describe('ce que l’en-tête dit', () => {
  it('ne nomme ni la ville ni le lieu où l’on est', async () => {
    // **La règle tient, et la v3 en déplace la frontière d'un cran.** On ne
    // nomme toujours pas le quartier **où l'on est** : rien ne sait le
    // résoudre — pas de géocodage inverse, et la ville du profil dit où l'on
    // habite. Le quartier du salon le plus proche avait été rendu à sa place,
    // et c'était plausible, invérifiable de l'autre côté, donc jamais relevé.
    //
    // **Et le marché non plus ne s'écrit plus.** L'en-tête portait « MIAMI »,
    // ce qui était vrai et n'informait personne : le fil est local par
    // construction, donc tout ce qu'il montre est à Miami. Ce qui reste est le
    // titre, et le compte une fois filtré.
    //
    // Le montage porte deux quartiers nommables : sans eux, ce test passerait
    // sans rien vérifier.
    await monter();
    await waitFor(() => expect(screen.getByTestId('entete-titre')).toBeTruthy());

    // **Sur le nœud qui porte le texte, et par `queryByText` pour l'absence.**
    // `toHaveTextContent` sur le conteneur de l'en-tête rend une chaîne vide —
    // il n'agrège pas ses descendants — et les trois négations passaient donc
    // sans rien lire. Le défaut était déjà là avant la v3 : un test qui
    // n'interroge rien ne tombe jamais. `queryByText` cherche dans tout l'arbre
    // rendu, ce qui est précisément ce qu'on veut dire par « nulle part ».
    expect(screen.queryByText('Miami')).toBeNull();
    // **Borné à l'en-tête, et c'est la moitié utile de la règle.** Le mur
    // nomme ses quartiers en tête de section — ceux des salons, que le serveur
    // déclare — et le chercher dans tout l'écran ferait tomber ce test sur la
    // seule chose qui a le droit de les nommer.
    const dansLEntete = within(screen.getByTestId('entete-du-mur'));
    expect(dansLEntete.queryByText(en.quartiers.wynwood)).toBeNull();
    expect(dansLEntete.queryByText(en.quartiers.brickell)).toBeNull();
    expect(screen.queryByTestId('entete-quartier')).toBeNull();
  });

  it('titre « Discover » sans filtre, et la catégorie une fois filtré', async () => {
    // **Le titre nomme ce qu'on regarde.** Il nommait l'écran — « Near you » —
    // puis plus rien du tout, l'en-tête ne portant que le rayon. La v3 lui rend
    // un titre, et le fait dépendre du filtre : c'est le seul endroit où la
    // catégorie choisie s'écrit en toutes lettres.
    await monter();
    await waitFor(() => expect(screen.getByTestId('categorie-beauty')).toBeTruthy());
    expect(screen.getByTestId('entete-titre')).toHaveTextContent(en.parcours.filDecouvrir);
    // Sans filtre, aucune ligne du tout : le total d'une ville ne se compare à
    // rien, et il ne restait rien d'autre à écrire là une fois « Miami » parti.
    expect(screen.queryByTestId('entete-marche')).toBeNull();

    await fireEvent.press(screen.getByTestId('categorie-beauty'));
    await waitFor(() =>
      expect(screen.getByTestId('entete-titre')).toHaveTextContent(en.categories.beauty),
    );
    // Filtré, le compte apparaît et dit ce que le filtre ouvre.
    expect(screen.getByTestId('entete-marche')).toHaveTextContent(/\d/);
  });

  it('et les porte déjà avant que le fil réponde, sans son compte', async () => {
    // **La navigation n'attend pas la donnée.** Le rayon est un état local : le
    // taire jusqu'à la réponse ferait apparaître l'en-tête d'un coup, ce qui
    // est le défaut que l'accueil a déjà coûté.
    // **La requête est suspendue, pas abandonnée** : c'est l'état de
    // chargement qu'on veut voir. Elle est relâchée à la fin du test — une
    // promesse laissée pendante garde Jest éveillé, et ce fichier coûtait
    // dix-sept secondes au lieu de deux, dans chaque boucle de mutation.
    let relacher: (reponse: Response) => void = () => {};
    const suspendue = new Promise<Response>((resoudre) => {
      relacher = resoudre;
    });
    const api = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: { lire: async () => null, ecrire: async () => {} },
      fetchImpl: (() => suspendue) as unknown as typeof fetch,
    });
    await render(
      <I18nProvider initialLocale="en">
        <ThemeProvider role="creator">
          <ApiProvider client={api}>
            <FilScreen
              position={{ longitude: -80.19, latitude: 25.76 }}
              onDemanderLaPosition={() => {}}
              onVoirMesFavoris={() => {}}
              onOuvrirLeCommerce={() => {}}
            />
          </ApiProvider>
        </ThemeProvider>
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('etat-chargement')).toBeTruthy());
    // **Ce qui ne dépend pas de la donnée est déjà là.** Le titre est connu
    // avant le premier appel ; le compte, lui, n'apparaît qu'avec la réponse
    // et seulement une fois filtré. Le logotype a quitté l'en-tête avec la v3,
    // le nom de la ville avec la v9 : reste le titre.
    expect(screen.queryByTestId('entete-marche')).toBeNull();
    expect(screen.getByTestId('entete-titre')).toHaveTextContent(en.parcours.filDecouvrir);

    relacher({ ok: true, status: 200, json: async () => fil() } as Response);
    await waitFor(() => expect(screen.getByTestId('etat-nominal')).toBeTruthy());
  });

  it('une seule pilule est pleine à la fois', async () => {
    // **Le soulignement est devenu une pilule pleine.** Sur une ligne qui
    // défile, un soulignement se perd au bord du champ ; une pilule pleine se
    // reconnaît à moitié sortie. Ce qu'il dit n'a pas changé : lequel des sept
    // est en vigueur, et rien d'autre — aucun compte n'y revient.
    //
    // Le test vérifie **l'unicité** et pas seulement la présence : deux pilules
    // pleines à la fois est l'état que produirait une comparaison fautive, et
    // « la bonne est pleine » ne l'attraperait pas.
    await monter();
    await waitFor(() => expect(screen.getByTestId('categorie-beauty')).toBeTruthy());

    const choisie = (id: string) =>
      screen.getByTestId(id).props.accessibilityState?.selected === true;

    expect(choisie('categorie-toutes')).toBe(true);
    expect(choisie('categorie-beauty')).toBe(false);
    expect(choisie('categorie-fitness')).toBe(false);

    await fireEvent.press(screen.getByTestId('categorie-beauty'));
    await waitFor(() => expect(choisie('categorie-beauty')).toBe(true));
    expect(choisie('categorie-toutes')).toBe(false);
    expect(choisie('categorie-fitness')).toBe(false);

    // Et aucun compte nulle part : c'est ce qu'on a retiré.
    expect(screen.queryByTestId('categorie-beauty-compte')).toBeNull();
  });

  it('retire la rangée entière quand il n’y a qu’une catégorie', async () => {
    // Une chip seule à côté d'« All » est un interrupteur qui ne commande
    // rien : les deux états rendent le même mur.
    await monter(fil({ categories: [{ categorie: 'beauty', commerces: 5, prestations: 9 }] as Fil['categories'] }));
    await waitFor(() => expect(screen.getByTestId('entete-du-mur')).toBeTruthy());

    expect(screen.queryByTestId('bande-des-categories')).toBeNull();
    expect(screen.queryByTestId('categorie-toutes')).toBeNull();
  });

  it('garde l’en-tête sur un fil vide, d’où le filtre se relâche', async () => {
    // C'est la seule sortie d'un filtre trop étroit : si l'en-tête tombait avec
    // le contenu, un filtre qui ne rend rien serait sans retour.
    await monter(fil({ commerces: [] }));
    await waitFor(() => expect(screen.getByTestId('fil-vide')).toBeTruthy());

    expect(screen.getByTestId('categorie-toutes')).toBeTruthy();
  });
});

describe('le rayon se règle dans les deux sens', () => {
  it('élargir puis revenir : le retour existe, et il ramène', async () => {
    // **C'était une régression.** Les chips de rayon sont parties avec leur
    // ligne quand les catégories ont pris leur place, et `rayons` ne rend
    // jamais un rayon plus étroit que celui en vigueur : on partait à 30 km
    // pour la session entière. Provisoire — le rayon appartient à la feuille de
    // filtres, qui n'existe pas encore.
    const { appels } = await monter(
      fil({ rayons: [{ rayon_metres: 30_000, commerces: 9, prestations: 12 }] as Fil['rayons'] }),
    );
    await waitFor(() => expect(screen.getByTestId('sortie-elargir')).toBeTruthy());

    // Au rayon de départ, il n'y a rien à annuler.
    expect(screen.queryByTestId('sortie-resserrer')).toBeNull();

    await fireEvent.press(screen.getByTestId('sortie-elargir'));
    await waitFor(() => expect(appels[appels.length - 1]).toContain('rayon_metres=30000'));

    await waitFor(() => expect(screen.getByTestId('sortie-resserrer')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('sortie-resserrer'));
    await waitFor(() => expect(appels[appels.length - 1]).toContain('rayon_metres=15000'));

    // Et le retour disparaît une fois revenu : il n'annulerait plus rien.
    await waitFor(() => expect(screen.queryByTestId('sortie-resserrer')).toBeNull());
  });
});

describe('ce que l’en-tête fait', () => {
  it('passe la catégorie choisie au serveur', async () => {
    const { appels } = await monter();
    await waitFor(() => expect(screen.getByTestId('categorie-fitness')).toBeTruthy());
    const avant = appels.length;

    await fireEvent.press(screen.getByTestId('categorie-fitness'));

    await waitFor(() => expect(appels.length).toBeGreaterThan(avant));
    expect(appels[appels.length - 1]).toContain('categorie=fitness');
  });

  it('ne l’envoie pas tant qu’on n’a rien choisi', async () => {
    // Le sens inverse : sans lui, une implémentation qui enverrait toujours la
    // première catégorie passerait le test d'à côté.
    const { appels } = await monter();
    await waitFor(() => expect(screen.getByTestId('categorie-fitness')).toBeTruthy());

    expect(appels.every((url) => !url.includes('categorie='))).toBe(true);
  });

  it('et réappuyer sur la catégorie en vigueur la retire', async () => {
    // Le « Clear » du cadre 03b, posé sur la chip elle-même : le geste qui a
    // filtré est celui qu'on refait pour défiltrer.
    const { appels } = await monter();
    await waitFor(() => expect(screen.getByTestId('categorie-fitness')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('categorie-fitness'));
    await waitFor(() => expect(appels[appels.length - 1]).toContain('categorie=fitness'));

    await fireEvent.press(screen.getByTestId('categorie-fitness'));
    await waitFor(() => expect(appels[appels.length - 1]).not.toContain('categorie='));
  });
});
