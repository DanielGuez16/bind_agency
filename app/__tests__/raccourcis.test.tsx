/**
 * Les raccourcis d'arbitrage, et surtout les moments où ils doivent se taire.
 *
 * **Ce qu'ils réparent.** `DecisionBar` dessinait une pastille « A », « R »,
 * « N » à côté de chaque décision depuis le début, et rien n'écoutait le
 * clavier. Une pastille est une promesse : qui traite vingt dossiers à la
 * chaîne la croit, appuie, n'obtient rien, puis cesse d'y croire et clique — ce
 * qui est plus lent que s'il n'y avait jamais eu de pastille.
 *
 * **Le vrai sujet de ce fichier est « N ».** L'arbitre écrit un motif dans un
 * champ de texte avant de clore un dossier en non honoré. Un raccourci qui
 * écouterait sans discernement clôrait le dossier — la seule décision du
 * produit qui ne se rouvre pas — au premier caractère de « non conforme ».
 *
 * La garde n'est donc pas éprouvée sur la forme qu'on avait en tête, mais sur
 * les quatre façons d'écrire la même faute : `input`, `textarea`, `select`, et
 * l'élément éditable qui n'est aucun des trois.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';

import { DecisionBar } from '../src/components';
import { I18nProvider } from '../src/i18n';
import { ThemeProvider } from '../src/theme';
import { frappeDansUneSaisie } from '../src/shell/useRaccourcis';

// --------------------------------------------------------------------------
// la garde, éprouvée seule
// --------------------------------------------------------------------------

describe('frappe dans une saisie', () => {
  it.each([
    ['INPUT', { tagName: 'INPUT' }],
    ['TEXTAREA', { tagName: 'TEXTAREA' }],
    ['SELECT', { tagName: 'SELECT' }],
    // La casse du nom de balise n'est pas garantie selon le document : un
    // garde-fou qui ne comparerait qu'en majuscules laisserait passer celle-ci.
    ['textarea en minuscules', { tagName: 'textarea' }],
    // Ni `input` ni `textarea`, et pourtant quelqu'un y écrit.
    ['élément éditable', { tagName: 'DIV', isContentEditable: true }],
  ])('se tait sur %s', (_nom, cible) => {
    expect(frappeDansUneSaisie(cible)).toBe(true);
  });

  it.each([
    ['un bouton', { tagName: 'BUTTON' }],
    ['une division ordinaire', { tagName: 'DIV', isContentEditable: false }],
    ['rien du tout', null],
    ['une valeur qui n’est pas un objet', 'DIV'],
  ])('laisse passer %s', (_nom, cible) => {
    // Le sens inverse, et il compte autant : une garde qui refuserait tout
    // passerait les cinq cas ci-dessus sans qu'aucun raccourci ne marche
    // jamais — et la pastille redeviendrait la promesse vide qu'on répare.
    expect(frappeDansUneSaisie(cible)).toBe(false);
  });
});

// --------------------------------------------------------------------------
// la barre de décision, au clavier
// --------------------------------------------------------------------------

/**
 * Un document de substitution, et le clavier qui va avec.
 *
 * L'environnement de test est celui de React Native : il n'a ni `document` ni
 * `KeyboardEvent`. On en pose un minimal — juste ce que le hook appelle — et on
 * bascule `Platform.OS` sur `web`, parce que c'est le seul endroit où le
 * raccourci a un sens.
 *
 * Ce document sert aussi de garde : s'il reste un écouteur après un démontage,
 * `ecouteurs` le dit.
 */
const ecouteurs: ((evenement: unknown) => void)[] = [];

beforeAll(() => {
  (require('react-native') as typeof import('react-native')).Platform.OS = 'web';
  (globalThis as Record<string, unknown>).document = {
    addEventListener: (_type: string, ecouteur: (evenement: unknown) => void) => {
      ecouteurs.push(ecouteur);
    },
    removeEventListener: (_type: string, ecouteur: (evenement: unknown) => void) => {
      const rang = ecouteurs.indexOf(ecouteur);
      if (rang >= 0) ecouteurs.splice(rang, 1);
    },
  };
});

function frapper(touche: string, extra: Record<string, unknown> = {}) {
  // Une copie : un écouteur retiré pendant la boucle décalerait le tableau.
  for (const ecouteur of [...ecouteurs]) ecouteur({ key: touche, ...extra });
}

function monter(noeud: React.ReactElement) {
  return render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="admin">{noeud}</ThemeProvider>
    </I18nProvider>,
  );
}

const approuver = jest.fn();
const redemander = jest.fn();
const clore = jest.fn();

function decisions() {
  return [
    { cle: 'approve', label: 'Approve', touche: 'A', approbation: true, onPress: approuver },
    { cle: 'resubmit', label: 'Ask again', touche: 'R', onPress: redemander },
    { cle: 'unfulfilled', label: 'Close unfulfilled', touche: 'N', onPress: clore },
  ];
}

beforeEach(() => {
  approuver.mockClear();
  redemander.mockClear();
  clore.mockClear();
});

describe('raccourcis de la barre de décision', () => {
  it('la touche déclenche la décision qu’elle affiche', async () => {
    await monter(<DecisionBar decisions={decisions()} motif="not_visible" />);

    frapper('a');
    frapper('r');
    frapper('n');

    expect(approuver).toHaveBeenCalledTimes(1);
    expect(redemander).toHaveBeenCalledTimes(1);
    expect(clore).toHaveBeenCalledTimes(1);
  });

  it('la minuscule et la majuscule ouvrent la même porte', async () => {
    // Exiger la majuscule demanderait de tenir Maj, donc une touche de
    // modification, donc le raccourci ne se déclencherait jamais.
    await monter(<DecisionBar decisions={decisions()} motif="not_visible" />);

    frapper('A');

    expect(approuver).toHaveBeenCalledTimes(1);
  });

  it('**« non conforme » ne clôt aucun dossier**', async () => {
    // Le défaut que la garde existe pour empêcher, écrit tel qu'il se
    // produirait : l'arbitre tape son motif, et la lettre « n » arrive.
    await monter(<DecisionBar decisions={decisions()} motif="not_visible" />);

    for (const lettre of 'non conforme') {
      frapper(lettre, { target: { tagName: 'TEXTAREA' } });
    }

    expect(clore).not.toHaveBeenCalled();
    expect(approuver).not.toHaveBeenCalled();
    expect(redemander).not.toHaveBeenCalled();
  });

  it('ne vole pas un raccourci du système', async () => {
    // `Cmd+R` recharge la page, `Ctrl+N` ouvre une fenêtre. Les intercepter
    // ferait d'un geste du navigateur une décision définitive.
    await monter(<DecisionBar decisions={decisions()} motif="not_visible" />);

    frapper('r', { metaKey: true });
    frapper('n', { ctrlKey: true });
    frapper('a', { altKey: true });

    expect(redemander).not.toHaveBeenCalled();
    expect(clore).not.toHaveBeenCalled();
    expect(approuver).not.toHaveBeenCalled();
  });

  it('sans motif, seul le raccourci de l’approbation répond', async () => {
    // **Le raccourci suit le bouton.** Les décisions non approbatives sont
    // retirées tant qu'aucun motif n'est choisi ; un raccourci qui leur
    // survivrait ferait exactement ce que la barre refuse de laisser cliquer.
    await monter(<DecisionBar decisions={decisions()} motif={undefined} />);

    frapper('a');
    frapper('r');
    frapper('n');

    expect(approuver).toHaveBeenCalledTimes(1);
    expect(redemander).not.toHaveBeenCalled();
    expect(clore).not.toHaveBeenCalled();
  });

  it('la touche s’ouvre dès que le motif est choisi', async () => {
    // Le sens inverse du test précédent : une barre qui n'écouterait jamais les
    // décisions motivées le passerait sans rien garantir.
    function Cadre() {
      const [motif, setMotif] = useState<string | undefined>(undefined);
      return (
        <>
          <DecisionBar decisions={decisions()} motif={motif} />
          {/* Le clic qui choisit un motif, réduit à ce qu'il change. */}
          <DecisionBar
            testID="choisir"
            decisions={[
              {
                cle: 'motif',
                label: 'Pick a reason',
                touche: 'M',
                approbation: true,
                onPress: () => setMotif('not_visible'),
              },
            ]}
          />
        </>
      );
    }

    await monter(<Cadre />);
    frapper('n');
    expect(clore).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByLabelText('Pick a reason'));
    frapper('n');

    expect(clore).toHaveBeenCalledTimes(1);
  });

  it('n’écoute plus une fois démonté', async () => {
    // Un écouteur laissé derrière lui ferait trancher un dossier fermé, depuis
    // un écran qu'on a quitté.
    const vue = await monter(<DecisionBar decisions={decisions()} motif="not_visible" />);
    // `unmount` est asynchrone comme `render` depuis la version 14 : sans
    // l''attendre, on frappe avant que le nettoyage de l''effet ait tourné, et le
    // test échoue en accusant le hook.
    await vue.unmount();

    frapper('n');

    expect(clore).not.toHaveBeenCalled();
  });
});
