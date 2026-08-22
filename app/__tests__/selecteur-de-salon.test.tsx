/**
 * Choisir entre deux salons.
 *
 * **Le rattachement d'une fiche a rendu ce cas réel.** Un gérant qui assume un
 * second salon depuis un lien de prise en main l'obtient pour de bon : il est
 * réservable par les créatrices. Mais la coquille prenait le premier de la
 * liste d'appartenance et n'offrait aucun choix — le second existait sans que
 * son gérant puisse l'ouvrir.
 *
 * Ce qui s'éprouve ici tient en trois points : la règle qui décide ce qu'on
 * regarde, le fait qu'un seul salon n'ouvre aucun contrôle, et surtout que les
 * quatre appelants de `useMonCommerce` voient le **même** salon.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { commerceRetenu } from '../src/shell/commerceChoisi';
import { BarreLaterale } from '../src/shell/BarreLaterale';
import { CommerceProvider, useMonCommerce } from '../src/shell/useMonCommerce';
import { identiteDuSalon, SelecteurDeSalon } from '../src/shell/SelecteurDeSalon';
import { ThemeProvider } from '../src/theme';
import { Texte } from '../src/components';

const coffre = { lire: async () => null, ecrire: async () => {} };

/**
 * **Deux salons d'une même enseigne**, et c'est le décor qui compte.
 *
 * Ils portent le **même nom** : « Vela Nail Studio » deux fois ne distingue
 * rien, et c'est précisément le cas que le sélecteur existe pour traiter. Un
 * décor à deux noms différents laisserait passer une implémentation qui titre
 * le nom — la faute qu'on corrige.
 */
const OCEAN = {
  id: 'b1',
  name: 'Vela Nail Studio',
  timezone: 'America/New_York',
  neighborhood: 'wynwood',
  address: '120 NE 41st St',
};
const WYNWOOD = {
  id: 'b2',
  name: 'Vela Nail Studio',
  timezone: 'America/New_York',
  neighborhood: 'little_havana',
  address: '1450 SW 8th St',
};

function clientDe(commerces: unknown[]) {
  return new ApiClient({
    baseUrl: 'https://api.test',
    coffre,
    fetchImpl: async (url) => {
      if (!String(url).includes('/me/businesses')) {
        throw new Error(`route non simulée : ${String(url)}`);
      }
      return { ok: true, status: 200, json: async () => commerces } as Response;
    },
  });
}

function Cadre({ children, commerces }: { children: ReactNode; commerces: unknown[] }) {
  return (
    <I18nProvider initialLocale="en">
      <ThemeProvider role="merchant">
        <ApiProvider client={clientDe(commerces)}>
          <CommerceProvider>{children}</CommerceProvider>
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

/** Deux lecteurs indépendants du même contexte, comme la coquille en a quatre. */
function Sonde({ nom }: { nom: string }) {
  const { businessId, nom: salon } = useMonCommerce();
  return (
    <Texte testID={`sonde-${nom}`}>{`${businessId ?? 'aucun'} · ${salon ?? 'aucun'}`}</Texte>
  );
}

function Controle() {
  const { commerces, businessId, choisir } = useMonCommerce();
  return <SelecteurDeSalon commerces={commerces} choisi={businessId} onChoisir={choisir} />;
}

describe('la règle qui décide ce qu’on regarde', () => {
  it('prend le salon retenu quand il est encore dans la liste', () => {
    expect(commerceRetenu([OCEAN, WYNWOOD], 'b2')).toBe(WYNWOOD);
  });

  it('retombe sur le premier quand la mémoire ment', () => {
    // **Un identifiant retenu ne fait jamais autorité.** Un salon qu'on a
    // quitté, révoqué, ou dont on a perdu l'accès ne doit pas rester choisi ;
    // le premier est le comportement d'avant le sélecteur, donc rien ne
    // s'aggrave. La divergence est ici : `b9` n'existe pas, et pourtant on rend
    // un salon.
    expect(commerceRetenu([OCEAN, WYNWOOD], 'b9')).toBe(OCEAN);
    expect(commerceRetenu([OCEAN, WYNWOOD], null)).toBe(OCEAN);
  });

  it('ne rend rien sans appartenance', () => {
    expect(commerceRetenu([], 'b1')).toBeNull();
  });
});

describe('le sélecteur', () => {
  it('ne se rend pas quand il n’y a qu’un salon', async () => {
    // Un contrôle qui n'offre aucun choix occupe la place et fait douter :
    // c'est la règle du bouton qu'on retire plutôt que de griser.
    await render(
      <Cadre commerces={[OCEAN]}>
        <Controle />
        <Sonde nom="a" />
      </Cadre>,
    );
    await waitFor(() => expect(screen.getByTestId('sonde-a')).toHaveTextContent(/b1/));

    expect(screen.queryByTestId('selecteur-de-salon')).toBeNull();
  });

  it('se rend à partir de deux, et marque celui qu’on regarde', async () => {
    await render(
      <Cadre commerces={[OCEAN, WYNWOOD]}>
        <Controle />
      </Cadre>,
    );
    await waitFor(() => expect(screen.getByTestId('selecteur-de-salon')).toBeTruthy());

    // Le courant est marqué, pas retiré : le retirer ferait lire la liste comme
    // « les autres », et on ne saurait plus lequel on regarde en l'ouvrant.
    expect(screen.getByTestId('salon-b1')).toBeTruthy();
    expect(screen.getByTestId('salon-b2')).toBeTruthy();
    // **Sur l'état d'accessibilité et non sur un glyphe.** C'est ce qu'un
    // lecteur d'écran annonce, et c'est ce qui dit « celui-ci » à quelqu'un qui
    // ne voit pas la coche. Vérifier l'icône éprouverait le dessin ; vérifier
    // l'état éprouve ce que l'écran affirme.
    expect(screen.getByTestId('salon-b1').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('salon-b2').props.accessibilityState.selected).toBe(false);
  });

  it('change de salon pour TOUS les lecteurs à la fois', async () => {
    // **Le point de tout ce lot.** `useMonCommerce` est appelé par quatre
    // endroits — la navigation, la pause du commerce, la reprise du compte —
    // et chacun montait sa propre requête. Tant que la règle était « le premier
    // de la liste », les quatre tombaient d'accord par hasard. Avec un choix,
    // quatre copies indépendantes divergent : la barre afficherait un salon
    // pendant qu'un autre écran en met un second en pause.
    await render(
      <Cadre commerces={[OCEAN, WYNWOOD]}>
        <Controle />
        <Sonde nom="a" />
        <Sonde nom="b" />
      </Cadre>,
    );
    await waitFor(() => expect(screen.getByTestId('sonde-a')).toHaveTextContent(/b1/));
    expect(screen.getByTestId('sonde-b')).toHaveTextContent(/b1/);

    await fireEvent.press(screen.getByTestId('salon-b2'));

    await waitFor(() => expect(screen.getByTestId('sonde-a')).toHaveTextContent(/b2/));
    // La seconde sonde suit sans qu'on la touche : c'est ce qu'un contexte
    // garantit et qu'une requête par appelant ne garantit pas.
    expect(screen.getByTestId('sonde-b')).toHaveTextContent(/b2/);
  });
});


/**
 * Ce qui identifie un salon dans la liste.
 *
 * **Le quartier, et non le nom.** Deux salons d'une enseigne portent le même
 * nom ; c'est le quartier qui dit lequel, donc c'est lui qui titre.
 */
describe('l’identité d’un salon dans la liste', () => {
  const t = (cle: string) => (cle === 'quartiers.wynwood' ? 'Wynwood' : cle);

  it('titre du quartier, et met l’enseigne dessous', () => {
    expect(identiteDuSalon(OCEAN, t)).toEqual({
      titre: 'Wynwood',
      dessous: 'Vela Nail Studio',
    });
  });

  it('retombe sur le nom quand il n’y a pas de quartier, et situe par l’adresse', () => {
    // **Un salon hors des quartiers ouverts n'en a pas** — le champ est
    // nullable, et l'adresse identifie mieux que rien. Elle ne titre pas pour
    // autant : une rue en gras se lit comme une consigne, pas comme un lieu.
    expect(identiteDuSalon({ ...OCEAN, neighborhood: null }, t)).toEqual({
      titre: 'Vela Nail Studio',
      dessous: '120 NE 41st St',
    });
  });

  it('ne rend rien dessous quand il n’y a ni quartier ni adresse', () => {
    // La divergence : sans ce cas, une implémentation qui écrirait toujours une
    // seconde ligne — vide — passerait les deux précédents.
    expect(identiteDuSalon({ ...OCEAN, neighborhood: null, address: null }, t)).toEqual({
      titre: 'Vela Nail Studio',
      dessous: null,
    });
  });
});

/**
 * À la caisse, le nom cesse d'être un contrôle.
 *
 * **C'est la décision qui compte de toute la planche v3**, et elle a survécu à
 * sa première mutation : rien n'éprouvait que la barre retire l'affordance sur
 * cet écran. Servir un code du mauvais salon est la seule erreur de ce parcours
 * qu'on ne peut pas défaire — elle consomme la réservation de quelqu'un
 * d'autre, et `consumed` est terminal.
 *
 * Pas grisé : la règle du produit l'interdit, un bouton grisé demande de deviner
 * ce qui le débloque. **Pas un contrôle du tout**, donc rien à refuser. On
 * quitte la caisse, on change, on revient — un geste de plus, et c'est le but.
 */
describe('le nom du salon, selon l’écran', () => {
  const routes = ['journee', 'caisse'].map((name) => ({ key: name, name, params: undefined }));

  const barre = (ecranCourant: 'journee' | 'caisse') => (
    <I18nProvider initialLocale="en">
      <ThemeProvider role="merchant">
        <BarreLaterale
          state={
            { index: routes.findIndex((r) => r.name === ecranCourant), routes } as never
          }
          descriptors={
            Object.fromEntries(routes.map((r) => [r.key, { options: { title: r.name } }])) as never
          }
          navigation={{ emit: () => ({ defaultPrevented: false }), navigate: () => {} } as never}
          // Requis par `BottomTabBarProps`. La barre latérale ne les lit pas —
          // la zone sûre est traitée une fois par la coquille — mais le type
          // les exige, et les omettre ne casse qu'à la compilation.
          insets={{ top: 0, right: 0, bottom: 0, left: 0 }}
          intitule="Wynwood"
          salons={[OCEAN, WYNWOOD]}
          choisi="b1"
          onChoisir={() => {}}
        />
      </ThemeProvider>
    </I18nProvider>
  );

  it('est un contrôle partout ailleurs', async () => {
    await render(barre('journee'));
    expect(screen.getByTestId('changer-de-salon')).toBeTruthy();
  });

  it('n’en est plus un à la caisse', async () => {
    // **La divergence est l'écran courant, et rien d'autre.** Mêmes salons,
    // même intitulé, même callback : seul le nom de la route change. Un test
    // qui ne monterait que la caisse passerait sur une barre qui n'offrirait
    // jamais le contrôle.
    await render(barre('caisse'));

    expect(screen.queryByTestId('changer-de-salon')).toBeNull();
    // Le nom reste lisible : c'est le seul écran où savoir quel salon on sert
    // compte le plus.
    expect(screen.getByText('Wynwood')).toBeTruthy();
  });
});
