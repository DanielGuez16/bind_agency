/**
 * Le mur, monté.
 *
 * `le-cycle-du-mur` éprouve le placement et `les-regles-du-mur` les trois
 * arbitrages ; ni l'un ni l'autre ne dit ce que l'écran **montre**. C'est le
 * défaut qu'on a déjà payé deux fois sur ce projet : une garde qui lit un
 * fichier ou un module et jamais l'arbre rendu.
 */
import { render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider, type CommerceDuFil, type Fil } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { Mur, MurEnChargement } from '../src/screens/mur/Mur';
import { CYCLE } from '../src/screens/mur/cycle';
import { ThemeProvider } from '../src/theme';

function salon(rang: number, extra: Partial<CommerceDuFil> = {}): CommerceDuFil {
  return {
    business_id: `b${rang}`,
    name: `Salon ${rang}`,
    category: 'beauty',
    address: null,
    cover_photo_key: `photos/paysage/${rang}`,
    cover_portrait_key: `photos/portrait/${rang}`,
    neighborhood: 'wynwood',
    distance_metres: 100 * (rang + 1),
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
    ...extra,
  };
}

function filAvec(commerces: CommerceDuFil[], quartiers: Fil['quartiers'] = []): Fil {
  return {
    commerces,
    obstacles: [],
    rayon_metres: 15000,
    total_prestations: commerces.length,
    categories: [],
    rayons: [],
    quartiers,
  } as unknown as Fil;
}

async function monter(fil: Fil) {
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => fil }) as Response,
  });
  return render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={api}>
          <Mur fil={fil} onOuvrir={() => {}} />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

const salons = (nombre: number) => Array.from({ length: nombre }, (_, rang) => salon(rang));

describe('ce que le mur montre', () => {
  it('sert l’original de la couverture verticale, jamais la vignette', async () => {
    // **Le piège du fil d'avant.** La vignette est bornée à 480 px sur le grand
    // côté : sur un héros de 520 points à fond perdu, elle serait agrandie trois
    // fois. Et une seule source pour tous les formats — deux donneraient deux
    // cadrages du même salon selon sa position dans le cycle.
    await monter(filAvec(salons(1)));
    await waitFor(() => expect(screen.getByTestId('salon-b0-photo')).toBeTruthy());

    const uri = String(screen.getByTestId('salon-b0-photo').props.source.uri);
    expect(uri).toContain('photos/portrait/0');
    expect(uri).not.toContain('vignette');
  });

  it('retombe sur la couverture paysage quand la verticale manque', async () => {
    await monter(filAvec([salon(0, { cover_portrait_key: null })]));
    await waitFor(() => expect(screen.getByTestId('salon-b0-photo')).toBeTruthy());

    expect(String(screen.getByTestId('salon-b0-photo').props.source.uri)).toContain(
      'photos/paysage/0',
    );
  });

  it('le triptyque porte le nom seul, sans prestation', async () => {
    // Cinq salons précèdent le triptyque ; les trois suivants y tombent.
    await monter(filAvec(salons(8)));
    await waitFor(() => expect(screen.getByTestId('salon-b5')).toBeTruthy());

    expect(screen.getByTestId('salon-b5-nom')).toBeTruthy();
    expect(screen.queryByTestId('salon-b5-prestation')).toBeNull();
    // Et le héros, lui, la porte.
    expect(screen.getByTestId('salon-b0-prestation')).toBeTruthy();
  });

  it('l’aperçu de galerie n’est que sur le héros de position 4', async () => {
    await monter(filAvec(salons(8)));
    await waitFor(() => expect(screen.getByTestId('salon-b0')).toBeTruthy());

    // b0 est le héros de position 1, b4 celui de position 4.
    expect(screen.queryByTestId('salon-b0-galerie')).toBeNull();
    expect(screen.getByTestId('salon-b4-galerie')).toBeTruthy();
    expect(screen.getAllByTestId(/-galerie$/)).toHaveLength(1);
  });

  it('la prestation dit la durée et la contrepartie, jamais un montant', async () => {
    // « Ce qui tiendrait la place d'un prix ailleurs est ici la durée et la
    // contrepartie. » Le montant existe dans le type et ne sort pas.
    await monter(filAvec(salons(1)));
    await waitFor(() => expect(screen.getByTestId('salon-b0-prestation')).toBeTruthy());

    const texte = screen.getByTestId('salon-b0-prestation');
    expect(texte).toHaveTextContent(/45 min/);
    expect(texte).toHaveTextContent(new RegExp(en.parcours.murUnStory));
    expect(texte).not.toHaveTextContent(/\d[.,]\d{2}|\$|45\s?00/);
  });
});

describe('la respiration annonce le quartier qui vient', () => {
  const NEUF = [
    ...Array.from({ length: 8 }, (_, rang) => salon(rang)),
    salon(8, { neighborhood: 'coral_gables' }),
  ];

  it('nomme le quartier du salon qui la suit, s’il n’a pas été croisé', async () => {
    // La planche : « il tient une promesse chiffrée — trois salons, dix
    // kilomètres — et le salon juste dessous en vient ».
    await monter(
      filAvec(NEUF, [
        { quartier: 'coral_gables', commerces: 3, prestations: 5, distance_metres: 9800 },
      ]),
    );
    await waitFor(() => expect(screen.getByTestId('respiration-0')).toBeTruthy());

    expect(screen.getByTestId('respiration-0-quartier')).toHaveTextContent(
      en.quartiers.coral_gables,
    );
    expect(screen.getByTestId('respiration-0-promesse')).toHaveTextContent(/\b3\b/);
  });

  it('se tait quand le quartier a déjà été vu au-dessus', async () => {
    // **« Tu n'as rien vu dans » se dit de ce qui est au-dessus**, pas de ce
    // qui est hors du rayon. Annoncer un quartier déjà croisé serait faux.
    await monter(filAvec(salons(9)));
    await waitFor(() => expect(screen.getByTestId('respiration-0')).toBeTruthy());

    expect(screen.queryByTestId('respiration-0-quartier')).toBeNull();
  });

  it('garde sa hauteur même muette : la géométrie ne se négocie pas', async () => {
    const { toJSON } = await monter(filAvec(salons(9)));
    await waitFor(() => expect(screen.getByTestId('respiration-0')).toBeTruthy());

    const hauteurs = JSON.stringify(toJSON());
    expect(hauteurs).toContain('"height":212');
  });
});

describe('le chargement tient la place, sans l’annoncer', () => {
  it('rend la géométrie exacte du cycle', async () => {
    // « Les blocs gris ont la géométrie exacte du cycle, donc rien ne saute
    // quand les images arrivent. »
    await render(
      <I18nProvider initialLocale="en">
        <ThemeProvider role="creator">
          <MurEnChargement />
        </ThemeProvider>
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('mur-en-chargement')).toBeTruthy());

    for (const [rang, position] of CYCLE.entries()) {
      const bloc = screen.getByTestId(`chargement-${rang}-${position.format}`);
      const style = Object.assign({}, ...[bloc.props.style].flat());
      expect({ format: position.format, hauteur: style.height }).toEqual({
        format: position.format,
        hauteur: position.hauteur,
      });
    }
  });

  it('et ne pulse pas', async () => {
    // Sur des aplats de cette taille, une pulsation donne le tournis. Le
    // squelette du système en porte une, justifiée sur des lignes de texte.
    const { toJSON } = await render(
      <I18nProvider initialLocale="en">
        <ThemeProvider role="creator">
          <MurEnChargement />
        </ThemeProvider>
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('mur-en-chargement')).toBeTruthy());

    expect(JSON.stringify(toJSON())).not.toContain('opacity');
  });
});
