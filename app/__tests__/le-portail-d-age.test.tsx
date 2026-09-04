/**
 * La saisie de la date de naissance, et ce qu'un champ unique laisse passer.
 *
 * **Le portail est neutre, et ça se vérifie sur les textes.** Un libellé qui
 * annonce « vous devez avoir 18 ans » apprend quoi taper à qui n'a pas l'âge —
 * c'est la forme que la FTC a sanctionnée. Le refus, lui, doit dire la règle :
 * il arrive après la saisie, quand elle ne peut plus être ajustée pour passer.
 */
import { render, screen } from '@testing-library/react-native';

import { DATE_VIDE, DateDeNaissance, dateIso } from '../src/screens/auth/DateDeNaissance';
import { en } from '../src/i18n/en';
import { es } from '../src/i18n/es';
import { I18nProvider } from '../src/i18n';
import { ThemeProvider } from '../src/theme';

describe('la date se compose de trois champs', () => {
  it('rend une date ISO quand les trois sont formés', () => {
    expect(dateIso({ jour: '4', mois: '9', annee: '1992' })).toBe('1992-09-04');
    expect(dateIso({ jour: '17', mois: '12', annee: '2001' })).toBe('2001-12-17');
  });

  it('rend null tant que la saisie est incomplète', () => {
    expect(dateIso(DATE_VIDE)).toBeNull();
    expect(dateIso({ jour: '4', mois: '9', annee: '' })).toBeNull();
    // Deux chiffres d'année ne sont pas une année : `92` vaut 1992 ou 2092.
    expect(dateIso({ jour: '4', mois: '9', annee: '92' })).toBeNull();
  });

  it("refuse une date qui n'existe pas, plutôt que de la décaler", () => {
    // **Le cas qui fait diverger les deux implémentations.** `new Date(2026, 1,
    // 31)` rend le 3 mars sans se plaindre : une version qui construirait la
    // date sans la relire accepterait le 31 février et enverrait au serveur une
    // date que personne n'a tapée.
    expect(dateIso({ jour: '31', mois: '2', annee: '1992' })).toBeNull();
    expect(dateIso({ jour: '31', mois: '4', annee: '1992' })).toBeNull();
    // Et le 29 février existe une année sur quatre : les deux sens.
    expect(dateIso({ jour: '29', mois: '2', annee: '1992' })).toBe('1992-02-29');
    expect(dateIso({ jour: '29', mois: '2', annee: '1993' })).toBeNull();
  });

  it('refuse un mois hors des douze', () => {
    expect(dateIso({ jour: '4', mois: '0', annee: '1992' })).toBeNull();
    expect(dateIso({ jour: '4', mois: '13', annee: '1992' })).toBeNull();
  });
});

describe('le portail reste neutre', () => {
  /**
   * **La garde qui compte.** Le libellé et l'aide du champ ne doivent annoncer
   * ni l'âge minimal ni la majorité : ce sont les deux seuls textes qu'on lit
   * *avant* de taper. Une implémentation qui écrirait « 18+ » dans l'aide
   * passerait tous les tests de rendu et raterait la seule chose qui compte.
   */
  it.each([
    ['en', en],
    ['es', es],
  ])("n'annonce pas la règle avant la saisie (%s)", (_, catalogue) => {
    const avantLaSaisie = [
      catalogue.auth.naissanceTitre,
      catalogue.auth.naissanceAide,
      catalogue.auth.naissanceJour,
      catalogue.auth.naissanceMois,
      catalogue.auth.naissanceAnnee,
    ].join(' ');

    expect(avantLaSaisie).not.toMatch(/18|adult|mayor de edad|majeur/i);
  });

  it('mais le refus, lui, dit la règle', () => {
    // Le pendant, et sans lui la garde ci-dessus serait satisfaite par un
    // produit qui ne dirait jamais son seuil, nulle part.
    expect(en.errors.age_below_minimum).toMatch(/18/);
    expect(es.errors.age_below_minimum).toMatch(/18/);
  });
});

describe("l'ordre des champs suit la langue", () => {
  async function poser(locale: 'en' | 'es') {
    await render(
      <I18nProvider initialLocale={locale}>
        <ThemeProvider role="creator">
          <DateDeNaissance valeur={DATE_VIDE} onChange={() => {}} />
        </ThemeProvider>
      </I18nProvider>,
    );
  }

  it('met le mois en tête en anglais, le jour en espagnol', async () => {
    await poser('en');
    const enAnglais = screen.getByTestId('date-de-naissance');
    const ordreAnglais = JSON.stringify(enAnglais).indexOf('date-de-naissance-mois');
    const jourAnglais = JSON.stringify(enAnglais).indexOf('date-de-naissance-jour');
    expect(ordreAnglais).toBeLessThan(jourAnglais);

    screen.unmount();
    await poser('es');
    const enEspagnol = screen.getByTestId('date-de-naissance');
    const jourEspagnol = JSON.stringify(enEspagnol).indexOf('date-de-naissance-jour');
    const moisEspagnol = JSON.stringify(enEspagnol).indexOf('date-de-naissance-mois');
    expect(jourEspagnol).toBeLessThan(moisEspagnol);
  });
});
