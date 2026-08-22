/**
 * La prise en main d'une fiche préparée, et le mode terrain qui l'émet.
 *
 * **Ce que ce fichier garde : le lien ne demande jamais plus que ce qu'il faut
 * pour s'engager.** Le gérant arrive sans compte, voit ce qui a été préparé en
 * son nom, et donne trois choses — une adresse, un mot de passe, un accord. Un
 * écran qui lui redemanderait son adresse postale ou ses horaires referait au
 * comptoir la demi-heure que ce dispositif existe pour lui épargner.
 *
 * **Un `fireEvent` non attendu fait échouer le test suivant.** Quatre tests
 * passaient, tous ceux d'après restaient bloqués en chargement — sur des écrans
 * parfaitement sains. J'ai cherché du côté d'un client partagé, d'un plafond de
 * rendus, de l'ordre des tests ; c'était une mise à jour d'état qui tombait
 * hors de `act` et se rejouait dans le test d'après. Le garde-fou de discipline
 * du dépôt le dit en une ligne, et c'est lui qui a fini par le trouver.
 *
 * Trois autres propriétés comptent. **Un lien mort ne dit pas pourquoi** — le
 * serveur ne distingue pas inconnu, expiré, consommé et révoqué, et l'écran non
 * plus. **La version des conditions repart telle qu'elle a été montrée**, sans
 * quoi on écrirait au journal une acceptation que personne n'a produite. Et
 * **assumer une fiche ne la publie pas** : l'écran le dit, faute de quoi un
 * salon chercherait ses réservations pendant deux jours.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { SessionProvider } from '../src/session';
import { en } from '../src/i18n/en';
import { PriseEnMainScreen } from '../src/screens/PriseEnMainScreen';
import { ThemeProvider } from '../src/theme';

const coffre = { lire: async () => null, ecrire: async () => {} };

const APERCU = {
  business_name: 'Salon Ocean',
  address: '100 Ocean Drive, Miami',
  phone: null,
  prestations_preparees: 12,
  plages_preparees: 6,
  terms_version: '2026-01',
};

function clientDe(
  table: Record<string, unknown>,
  espion?: (chemin: string, corps: unknown) => void,
): ApiClient {
  return new ApiClient({
    baseUrl: 'https://api.test',
    coffre,
    fetchImpl: async (url, init) => {
      const chemin = String(url);
      if (init?.body) espion?.(chemin, JSON.parse(String(init.body)));
      const trouve = Object.entries(table).find(([fragment]) => chemin.includes(fragment));
      if (!trouve) throw new Error(`route non simulée : ${chemin}`);
      return { ok: true, status: 200, json: async () => trouve[1] } as Response;
    },
  });
}

/**
 * Un client neuf par appel, et non une instance partagée.
 *
 * Un `ApiClient` porte l'état de sa dernière rotation de jeton ; partagé entre
 * deux tests, il fait échouer le second sur un écran parfaitement sain, et
 * l'échec se lit comme un défaut de l'écran. Trouvé en écrivant ce fichier :
 * trois tests tombaient d'affilée à cause d'une constante de module.
 */
function clientQuiRefuseLeJeton() {
  return new ApiClient({
    baseUrl: 'https://api.test',
    coffre,
    fetchImpl: async () =>
      ({ ok: false, status: 404, json: async () => ({ detail: 'handover_invalid' }) }) as Response,
  });
}

/**
 * Asynchrone, comme partout ailleurs dans cette suite.
 *
 * Un rendu non attendu laisse ses mises à jour d'état tomber dans le test
 * *suivant* : React se plaint d'un rendu hors `act`, et c'est le test d'après
 * qui échoue, sur un écran parfaitement sain. Un garde-fou du dépôt cherche
 * précisément cette forme.
 */
/**
 * Le compte que `/me` rendra, ou `null` pour rester anonyme.
 *
 * **La session est fournie par son vrai fournisseur**, avec un coffre et une
 * réponse à `/me` : exporter le contexte pour le poser à la main aurait fait
 * fuir dans le code de production une prise réservée aux tests.
 */
type CompteSimule = { id: string; email: string; role: string } | null;

/** Un gérant déjà connecté : celui qui ouvre le lien de son second salon. */
const GERANT: CompteSimule = {
  id: 'u1',
  email: 'gerant@salon.example',
  role: 'business_member',
};

/** Une créatrice : le rôle qui ne peut pas assumer une fiche. */
const CREATRICE: CompteSimule = { id: 'u2', email: 'lea@bind.example', role: 'creator' };

async function monter(noeud: ReactElement, client: ApiClient, compte: CompteSimule = null) {
  const coffreDeSession = compte
    ? { lire: async () => ({ access_token: 'a', refresh_token: 'r' }), ecrire: async () => {} }
    : { lire: async () => null, ecrire: async () => {} };

  const repondAuCompte = (async (url: RequestInfo | URL) => {
    if (String(url).includes('/me')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ...compte,
          status: 'active',
          locale: 'en',
          email_verified_at: '2026-08-01T10:00:00Z',
          deletion_effective_at: null,
        }),
      } as Response;
    }
    throw new TypeError(`route de session non simulée : ${String(url)}`);
  }) as unknown as typeof fetch;

  function Cadre({ children }: { children: ReactNode }) {
    return (
      <I18nProvider initialLocale="en">
        <ThemeProvider role="merchant">
          {/* **L'écran lit la session, tout en se rendant avant la porte
              d'authentification.** Un gérant déjà connecté qui ouvre le lien de
              son second salon doit pouvoir le rattacher plutôt que d'inventer
              un second compte. */}
          <SessionProvider
            baseUrl="https://api.test"
            coffre={coffreDeSession}
            fetchImpl={repondAuCompte}
          >
            <ApiProvider client={client}>{children}</ApiProvider>
          </SessionProvider>
        </ThemeProvider>
      </I18nProvider>
    );
  }
  return render(<Cadre>{noeud}</Cadre>);
}
// --------------------------------------------------------------------------
// on montre avant de demander
// --------------------------------------------------------------------------

describe('prise en main', () => {
  it('montre ce qui a été préparé avant de demander quoi que ce soit', async () => {
    await monter(
      <PriseEnMainScreen jeton="j1" onTermine={jest.fn()} />,
      clientDe({ '/handover/j1': APERCU }),
    );

    await waitFor(() => expect(screen.getByTestId('fiche-preparee')).toBeTruthy());
    expect(screen.getByText('Salon Ocean')).toBeTruthy();
    expect(screen.getByText('100 Ocean Drive, Miami')).toBeTruthy();
    // Les nombres, pas la liste : le gérant reconnaît son salon sans que le
    // lien devienne une lecture complète de sa fiche.
    expect(screen.getByTestId('ce-qui-est-pret')).toHaveTextContent(/12/);
    // Les deux comptes vivent dans deux lignes : une carte relevée sans
    // horaires est le cas courant, et une phrase unique forcerait à écrire un
    // zéro pour celui des deux qui manque.
    expect(screen.getByTestId('plages-pretes')).toHaveTextContent(/6/);
  });

  it('ne demande que trois choses', async () => {
    await monter(
      <PriseEnMainScreen jeton="j1" onTermine={jest.fn()} />,
      clientDe({ '/handover/j1': APERCU }),
    );
    await waitFor(() => expect(screen.getByTestId('fiche-preparee')).toBeTruthy());

    // **Le cœur du dispositif.** Tout le reste a été saisi au comptoir ; le
    // redemander referait la demi-heure qu'on vient d'économiser.
    expect(screen.getByTestId('champ-email')).toBeTruthy();
    expect(screen.getByTestId('champ-mot-de-passe')).toBeTruthy();
    expect(screen.getByTestId('bascule-conditions')).toBeTruthy();
    expect(screen.queryByTestId('champ-adresse')).toBeNull();
    expect(screen.queryByTestId('champ-telephone')).toBeNull();
  });

  it('dit que prendre la fiche ne la publie pas', async () => {
    await monter(
      <PriseEnMainScreen jeton="j1" onTermine={jest.fn()} />,
      clientDe({ '/handover/j1': APERCU }),
    );

    await waitFor(() => expect(screen.getByTestId('fiche-preparee')).toBeTruthy());
    expect(screen.getByText(en.priseEnMain.pasEncoreEnLigne)).toBeTruthy();
  });

  it('n’ouvre pas avant que les conditions soient acceptées', async () => {
    await monter(
      <PriseEnMainScreen jeton="j1" onTermine={jest.fn()} />,
      clientDe({ '/handover/j1': APERCU }),
    );
    await waitFor(() => expect(screen.getByTestId('fiche-preparee')).toBeTruthy());

    await fireEvent.changeText(screen.getByTestId('champ-email'), 'gerant@salon.example');
    await fireEvent.changeText(screen.getByTestId('champ-mot-de-passe'), 'un-mot-de-passe');

    expect(screen.getByTestId('valider-prise-en-main').props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });
  it('un lien mort ne dit pas pourquoi il est mort', async () => {
    await monter(<PriseEnMainScreen jeton="j1" onTermine={jest.fn()} />, clientQuiRefuseLeJeton());

    await waitFor(() => expect(screen.getByTestId('prise-en-main-lien-mort')).toBeTruthy());
    // **Un seul message pour les quatre raisons.** Le message énumère les
    // possibilités — « expiré, ou déjà utilisé » — sans dire laquelle
    // s'applique : c'est le serveur qui refuse de les distinguer, et l'écran
    // n'a rien de plus à montrer.
    expect(screen.getByText(en.priseEnMain.lienMortAide)).toBeTruthy();
    // Et jamais le code technique, qui ne dit rien à un gérant.
    expect(screen.queryByText(/handover_invalid/)).toBeNull();
  });
  it('renvoie la version des conditions telle qu’elle a été montrée', async () => {
    const partis: { chemin: string; corps: unknown }[] = [];
    const client = clientDe(
      { '/handover/j1': APERCU },
      (chemin, corps) => partis.push({ chemin, corps }),
    );
    const termine = jest.fn();
    await monter(<PriseEnMainScreen jeton="j1" onTermine={termine} />, client);
    await waitFor(() => expect(screen.getByTestId('fiche-preparee')).toBeTruthy());

    await fireEvent.changeText(screen.getByTestId('champ-email'), 'gerant@salon.example');
    await fireEvent.changeText(screen.getByTestId('champ-mot-de-passe'), 'un-mot-de-passe');
    // `fireEvent(nœud, 'press')` et non `fireEvent.press` : la seconde forme
    // remonte l'arbre à la recherche d'un gestionnaire et n'atteint pas la
    // bascule, dont le `Pressable` porte le sien directement.
    await fireEvent(screen.getByTestId('bascule-conditions'), 'press');
    await fireEvent(screen.getByTestId('valider-prise-en-main'), 'press');

    await waitFor(() => expect(partis).toHaveLength(1));
    expect(partis[0].corps).toMatchObject({
      email: 'gerant@salon.example',
      terms_version: '2026-01',
    });
    // **Attendre la fin, et pas seulement le départ.** Sans cette ligne, les
    // dernières mises à jour d'état tombent après la fin du test, dans le
    // suivant — qui échoue alors sur un écran parfaitement sain.
    await waitFor(() => expect(termine).toHaveBeenCalledWith('gerant@salon.example'));
  });

});

describe('l’écran ne dit jamais avoir lu ce qu’il n’a pas lu', () => {
  it('n’annonce pas « 0 prestation » quand rien n’a été relevé', async () => {
    // **Le défaut relevé par Design.** La phrase unique annonçait « 0
    // prestation et 0 plage sont déjà là » à un gérant dont rien n'avait été
    // relevé : elle affirmait une lecture qui n'avait pas eu lieu, sur le
    // premier écran qu'il voit de BIND et le seul qui doit lui donner envie de
    // continuer.
    await monter(
      <PriseEnMainScreen jeton="j1" onTermine={jest.fn()} />,
      clientDe({ '/handover/j1': { ...APERCU, prestations_preparees: 0, plages_preparees: 0 } }),
    );
    await waitFor(() => expect(screen.getByTestId('ce-qui-est-pret')).toBeTruthy());

    expect(screen.getByTestId('ce-qui-est-pret')).toHaveTextContent(
      en.priseEnMain.prestationsAVenir,
    );
    expect(screen.getByTestId('ce-qui-est-pret')).not.toHaveTextContent(/\b0\b/);
    // Et pas de ligne vide à la place : rien du tout.
    expect(screen.queryByTestId('plages-pretes')).toBeNull();
  });

  it('traite les deux comptes séparément', async () => {
    // Une carte relevée sans horaires est le cas courant : la carte des prix
    // est affichée au mur, les horaires sont sur la porte, et on ne
    // photographie pas toujours les deux.
    await monter(
      <PriseEnMainScreen jeton="j1" onTermine={jest.fn()} />,
      clientDe({ '/handover/j1': { ...APERCU, prestations_preparees: 4, plages_preparees: 0 } }),
    );
    await waitFor(() => expect(screen.getByTestId('ce-qui-est-pret')).toBeTruthy());

    expect(screen.getByTestId('ce-qui-est-pret')).toHaveTextContent(/4/);
    expect(screen.queryByTestId('plages-pretes')).toBeNull();
  });
});

/**
 * Le gérant qui a déjà un compte.
 *
 * **C'est le propriétaire de deux adresses**, et l'écran le renvoyait s'inventer
 * une seconde identité. La branche du jeton se rend avant la porte
 * d'authentification, quelle que soit la session : un gérant déjà connecté qui
 * ouvrait le lien de son second salon recevait le formulaire de création de
 * compte. La route `attach` existait depuis le début et n'avait aucun appelant —
 * ce n'était pas une capacité à écrire, c'était un écran à brancher.
 */
describe('rattacher à un compte qui existe', () => {
  it('propose de rattacher, et ne redemande ni adresse ni mot de passe', async () => {
    await monter(
      <PriseEnMainScreen jeton="j1" onTermine={jest.fn()} />,
      clientDe({ '/handover/j1': APERCU }),
      GERANT,
    );
    await waitFor(() => expect(screen.getByTestId('rattacher-la-fiche')).toBeTruthy());

    // **La divergence tient au même décor à une session près.** Sans elle, un
    // écran qui n'afficherait jamais le formulaire passerait aussi.
    expect(screen.queryByTestId('champ-email')).toBeNull();
    expect(screen.queryByTestId('champ-mot-de-passe')).toBeNull();
    expect(screen.queryByTestId('valider-prise-en-main')).toBeNull();

    // Et la fiche préparée reste montrée : on assume ce qu'on a sous les yeux.
    expect(screen.getByTestId('fiche-preparee')).toBeTruthy();
  });

  it('nomme le compte, parce qu’il peut y en avoir deux', async () => {
    // « Rattacher à mon compte » sans dire lequel demande de deviner — et c'est
    // exactement la situation de quelqu'un qui en a deux.
    await monter(
      <PriseEnMainScreen jeton="j1" onTermine={jest.fn()} />,
      clientDe({ '/handover/j1': APERCU }),
      GERANT,
    );
    await waitFor(() => expect(screen.getByTestId('compte-en-session')).toBeTruthy());

    expect(screen.getByTestId('compte-en-session')).toHaveTextContent(/gerant@salon\.example/);
  });

  it('exige les conditions, et envoie la version montrée', async () => {
    const envois: { chemin: string; corps: unknown }[] = [];
    const api = clientDe({ '/handover/j1': APERCU, '/attach': { id: 'b9', name: 'Vela', status: 'draft' } }, (chemin, corps) =>
      envois.push({ chemin, corps }),
    );

    await monter(<PriseEnMainScreen jeton="j1" onTermine={jest.fn()} />, api, GERANT);
    await waitFor(() => expect(screen.getByTestId('rattacher-la-fiche')).toBeTruthy());

    // Tant que la bascule est fermée, rien ne part : c'est le serveur qui
    // exige la version, et une acceptation posée d'avance n'aurait aucune
    // valeur le jour où on la produit.
    await fireEvent.press(screen.getByTestId('rattacher-la-fiche'));
    expect(envois).toHaveLength(0);

    // `press` et non `valueChange` : la bascule porte son gestionnaire sur son
    // propre `Pressable`, comme le note le test voisin.
    await fireEvent(screen.getByTestId('bascule-conditions'), 'press');
    await fireEvent(screen.getByTestId('rattacher-la-fiche'), 'press');

    await waitFor(() => expect(envois).toHaveLength(1));
    expect(envois[0].chemin).toContain('/attach');
    // **La version que cet écran a montrée**, pas celle en vigueur à l'envoi.
    expect(envois[0].corps).toEqual({ terms_version: APERCU.terms_version });
  });

  it('dit à une créatrice que le lien n’est pas pour elle, au lieu d’un 403', async () => {
    // Le serveur refuse tout rôle qui n'est pas un commerce. Offrir le bouton
    // quand même ferait découvrir le refus après le geste.
    await monter(
      <PriseEnMainScreen jeton="j1" onTermine={jest.fn()} />,
      clientDe({ '/handover/j1': APERCU }),
      CREATRICE,
    );
    await waitFor(() => expect(screen.getByTestId('mauvais-role')).toBeTruthy());

    expect(screen.queryByTestId('rattacher-la-fiche')).toBeNull();
    expect(screen.queryByTestId('valider-prise-en-main')).toBeNull();
  });
});
