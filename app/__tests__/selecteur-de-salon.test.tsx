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
import { CommerceProvider, useMonCommerce } from '../src/shell/useMonCommerce';
import { SelecteurDeSalon } from '../src/shell/SelecteurDeSalon';
import { ThemeProvider } from '../src/theme';
import { Texte } from '../src/components';

const coffre = { lire: async () => null, ecrire: async () => {} };

const OCEAN = { id: 'b1', name: 'Salón Ocean', timezone: 'America/New_York' };
const WYNWOOD = { id: 'b2', name: 'Wynwood Nails', timezone: 'America/New_York' };

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
    await waitFor(() => expect(screen.getByTestId('sonde-a')).toHaveTextContent(/Ocean/));

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

    await waitFor(() => expect(screen.getByTestId('sonde-a')).toHaveTextContent(/b2 · Wynwood/));
    // La seconde sonde suit sans qu'on la touche : c'est ce qu'un contexte
    // garantit et qu'une requête par appelant ne garantit pas.
    expect(screen.getByTestId('sonde-b')).toHaveTextContent(/b2 · Wynwood/);
  });
});
