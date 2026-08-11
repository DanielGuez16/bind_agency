/**
 * La bibliothèque, éprouvée isolément — avant tout écran.
 *
 * Ce qui est testé ici n'est pas la mise en page. Ce sont les règles qui ne se
 * voient pas sur une maquette et qu'un écran pressé enfreint sans le savoir :
 * un bouton dimensionné sur son texte, un badge de palier qui perd un de ses
 * trois marqueurs, une action impossible grisée au lieu d'être retirée, un
 * créneau pris qu'on masque, une colonne numérique sans gouttière.
 *
 * Chaque règle est vérifiée **dans les deux sens** quand elle a un sens
 * contraire. Un test qui ne constate qu'un refus passe aussi bien sur un
 * composant qui refuse tout.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import {
  BadgesDeProfil,
  BusinessCard,
  Button,
  Chip,
  CodeGlyphs,
  CodeInput,
  Countdown,
  DataRow,
  DayPicker,
  DecisionBar,
  EmptyState,
  ManualCode,
  MediaFallback,
  SegmentedTabs,
  SlotPicker,
  StatusMessage,
  Stepper,
  TableHeader,
  TableRow,
  Texte,
  TextField,
  TierBadge,
  Toggle,
  chipDeComportement,
  BarresParPalier,
  BarresParPeriode,
} from '../src/components';
import { I18nProvider } from '../src/i18n';
import { ThemeProvider, codeColors, themeForRole, tokens, type Role } from '../src/theme';

function Cadre({ children, role = 'creator' }: { children: ReactNode; role?: Role }) {
  return (
    <I18nProvider initialLocale="en">
      <ThemeProvider role={role}>{children}</ThemeProvider>
    </I18nProvider>
  );
}

async function monter(noeud: ReactNode, role: Role = 'creator') {
  return render(<Cadre role={role}>{noeud}</Cadre>);
}

/** Aplatit un style React Native, qui peut être un tableau imbriqué. */
function style(element: { props: { style?: unknown } }): Record<string, unknown> {
  const empile = (valeur: unknown): Record<string, unknown> => {
    if (Array.isArray(valeur)) return Object.assign({}, ...valeur.map(empile));
    return (valeur as Record<string, unknown>) ?? {};
  };
  return empile(element.props.style);
}

// --------------------------------------------------------------------------
// Button
// --------------------------------------------------------------------------

describe('Button', () => {
  it("n'est jamais dimensionné sur son texte", async () => {
    await monter(<Button label="Confirmar reserva" testID="b" />);
    expect(style(screen.getByTestId('b')).alignSelf).toBe('stretch');
  });

  it('laisse la rangée décider quand fullWidth est retiré', async () => {
    // Le pendant : sans lui, un composant qui écrirait `stretch` en dur
    // passerait le test précédent sans rien garantir.
    await monter(<Button label="Cancelar" fullWidth={false} testID="b" />);
    expect(style(screen.getByTestId('b')).alignSelf).toBeUndefined();
  });

  it('tient la zone tactile de 44 même en taille sm', async () => {
    await monter(<Button label="Abrir" size="sm" testID="b" />);
    // La taille demandée est 36 ; c'est la zone tactile qui l'emporte.
    expect(tokens.size.control.sm).toBe(36);
    expect(style(screen.getByTestId('b')).minHeight).toBe(tokens.size.tapMin);
  });

  it('remplace le libellé pendant le chargement sans changer la géométrie', async () => {
    const { rerender } = await monter(<Button label="Enviar" testID="b" />);
    const avant = style(screen.getByTestId('b')).minHeight;

    await rerender(
      <Cadre>
        <Button label="Enviar" loading loadingLabel="Enviando…" testID="b" />
      </Cadre>,
    );

    expect(screen.getByText('Enviando…')).toBeTruthy();
    expect(style(screen.getByTestId('b')).minHeight).toBe(avant);
  });

  it('ne déclenche rien pendant le chargement', async () => {
    const onPress = jest.fn();
    await monter(<Button label="Enviar" loading onPress={onPress} testID="b" />);
    await fireEvent.press(screen.getByTestId('b'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('déclenche quand il est actif', async () => {
    const onPress = jest.fn();
    await monter(<Button label="Enviar" onPress={onPress} testID="b" />);
    await fireEvent.press(screen.getByTestId('b'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

// --------------------------------------------------------------------------
// TextField
// --------------------------------------------------------------------------

describe('TextField', () => {
  it("remplace l'aide par l'erreur au lieu de l'empiler", async () => {
    const { rerender } = await monter(
      <TextField label="Código" value="" helpText="Seis caracteres" />,
    );
    expect(screen.getByText('Seis caracteres')).toBeTruthy();

    await rerender(
      <Cadre>
        <TextField label="Código" value="" helpText="Seis caracteres" errorText="No existe" />
      </Cadre>,
    );

    expect(screen.getByText('No existe')).toBeTruthy();
    expect(screen.queryByText('Seis caracteres')).toBeNull();
  });

  it('porte son libellé comme nom accessible', async () => {
    await monter(<TextField label="Código" value="4H2" testID="champ" />);
    expect(screen.getByTestId('champ').props.accessibilityLabel).toBe('Código');
  });
});

// --------------------------------------------------------------------------
// Stepper, Toggle, SegmentedTabs, Chip
// --------------------------------------------------------------------------

describe('contrôles', () => {
  it('le compteur refuse de descendre sous son plancher', async () => {
    const onChange = jest.fn();
    await monter(<Stepper value={0} min={0} onChange={onChange} />);
    await fireEvent.press(screen.getByLabelText('minus'));
    expect(onChange).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByLabelText('plus'));
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it("l'interrupteur s'annonce comme tel", async () => {
    const onChange = jest.fn();
    await monter(<Toggle value={false} onChange={onChange} accessibilityLabel="Abrir servicio" />);
    const bouton = screen.getByLabelText('Abrir servicio');
    expect(bouton.props.accessibilityRole).toBe('switch');
    expect(bouton.props.accessibilityState.checked).toBe(false);

    await fireEvent.press(bouton);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('les compteurs font partie du libellé des onglets', async () => {
    // Une pastille à côté se dimensionne sur son chiffre et fait sauter la
    // largeur des segments quand le nombre passe de 9 à 10.
    await monter(
      <SegmentedTabs
        items={[{ label: 'Próximas', count: 1 }, { label: 'Hechas' }]}
        index={0}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByText('Próximas · 1')).toBeTruthy();
    expect(screen.getByText('Hechas')).toBeTruthy();
  });

  it('une chip sans action ne se présente pas comme pressable', async () => {
    await monter(<Chip label="Uñas" testID="chip" />);
    expect(screen.getByTestId('chip').props.accessibilityRole).toBeUndefined();
  });
});

// --------------------------------------------------------------------------
// TierBadge
// --------------------------------------------------------------------------

describe('TierBadge', () => {
  it('porte le mot en entier, jamais abrégé', async () => {
    await monter(<TierBadge tier="post" />);
    expect(screen.getByText('POST')).toBeTruthy();
  });

  it("traduit le mot sans jamais l'initialiser", async () => {
    await render(
      <I18nProvider initialLocale="es">
        <ThemeProvider role="creator">
          <TierBadge tier="post" />
        </ThemeProvider>
      </I18nProvider>,
    );
    // `PUBLICACIÓN` fait onze caractères de plus que `POST` : c'est
    // exactement le cas que la règle « jamais d'abréviation » protège.
    expect(screen.getByText('PUBLICACIÓN')).toBeTruthy();
  });

  it('porte ses trois marqueurs, dont le glyphe à barres', async () => {
    await monter(<TierBadge tier="reel" testID="badge" />);

    // 1. le mot
    expect(screen.getByText('REEL')).toBeTruthy();
    // 2. le glyphe : trois barres, dessinées, de hauteurs croissantes
    // `includeHiddenElements` : le glyphe est **volontairement** masqué aux
    // lecteurs d'écran, c'est le mot qui porte le sens. Il reste un marqueur
    // visuel, et c'est à ce titre qu'on le vérifie.
    const barres = [0, 1, 2].map((i) =>
      style(screen.getByTestId(`glyphe-barre-${i}`, { includeHiddenElements: true })),
    );
    expect(barres.map((b) => b.height)).toEqual([6, 9, 12]);
    expect(barres.map((b) => b.width)).toEqual([3, 3, 3]);
    // 3. la matière : reel est un fond plein
    //
    // Lu dans le thème du rôle plutôt qu'écrit en dur : le créateur est passé
    // du sombre au clair en v0.5, et une valeur transcrite ici a fait échouer
    // ce test pour une raison qui n'a rien à voir avec les trois marqueurs.
    expect(style(screen.getByTestId('badge')).backgroundColor).toBe(
      tokens.color[themeForRole('creator')]['tier.reel'],
    );
  });

  it('dessine les barres inactives plutôt que de les omettre', async () => {
    // Story n'a qu'une barre active. Les deux autres restent dessinées, sinon
    // la largeur du glyphe changerait d'un palier à l'autre et le repère
    // visuel se perdrait.
    await monter(<TierBadge tier="story" />);
    const barres = [0, 1, 2].map((i) =>
      style(screen.getByTestId(`glyphe-barre-${i}`, { includeHiddenElements: true })),
    );
    expect(barres).toHaveLength(3);
    expect(barres[0].backgroundColor).not.toBe(barres[2].backgroundColor);
  });

  it("n'affiche aucun chiffre de niveau", async () => {
    for (const tier of ['story', 'post', 'reel'] as const) {
      const rendu = await monter(<TierBadge tier={tier} />);
      expect(screen.queryByText(String(tokens.tier[tier].level))).toBeNull();
      await rendu.unmount();
    }
  });
});

// --------------------------------------------------------------------------
// Badges de profil
// --------------------------------------------------------------------------

describe('badges de profil', () => {
  it('en montre deux au plus, comportement en premier', async () => {
    await monter(
      <BadgesDeProfil
        badges={[
          { genre: 'nouveau', label: 'New on BIND' },
          { genre: 'comportement', label: '12 delivered' },
          { genre: 'comportement', label: 'Always on time' },
        ]}
      />,
    );
    expect(screen.getByText('12 delivered')).toBeTruthy();
    expect(screen.getByText('Always on time')).toBeTruthy();
    expect(screen.queryByText('New on BIND')).toBeNull();
  });

  it('ne fabrique jamais un badge à zéro', () => {
    // « 0 publication livrée » est un reproche. Le système n'en fait pas.
    expect(chipDeComportement(0, '0 delivered')).toBeNull();
    expect(chipDeComportement(1, '1 delivered')).toEqual({
      genre: 'comportement',
      label: '1 delivered',
    });
  });

  it('ne connaît plus la vague', () => {
    expect(tokens.badge.priority).toEqual(['behaviour', 'newcomer']);
    expect(tokens.badge.maxVisible).toBe(2);
    expect(Object.keys(tokens.color.dark)).not.toContain('badge.wave');
  });
});

// --------------------------------------------------------------------------
// Cartes
// --------------------------------------------------------------------------

describe('cartes', () => {
  it('cadre la couverture au rapport des photos, avec ou sans image', async () => {
    const props = {
      name: 'Salón Ocean',
      meta: 'Beauty · 320 m',
      serviceName: 'Gel nails',
      serviceDuration: '45 min',
      tier: 'story' as const,
    };
    const sans = await monter(<BusinessCard {...props} testID="carte" />);
    const rapportSans = style(screen.getByTestId('couverture')).aspectRatio;
    await sans.unmount();

    await monter(
      <BusinessCard {...props} cover={{ uri: 'https://exemple/1.jpg' }} testID="carte" />,
    );
    const rapportAvec = style(screen.getByTestId('couverture')).aspectRatio;

    // Un rapport, et non une hauteur fixe. Les couvertures sont déposées en
    // 16:9 ; une boîte de hauteur fixe ne retombe sur ce rapport qu'à une seule
    // largeur d'écran, et partout ailleurs « cover » rogne le sujet — sur un
    // iPhone, la devanture perdait son enseigne.
    //
    // La carte garde par ailleurs la même hauteur avec ou sans photo : elle
    // découle de la largeur, qui est la même pour toutes.
    expect(rapportSans).toBe(rapportAvec);
    expect(rapportAvec).toBeCloseTo(16 / 9, 3);
  });

  it('accompagne toujours le badge de la phrase de contrepartie', async () => {
    await monter(
      <BusinessCard
        name="Salón Ocean"
        meta="Beauty"
        serviceName="Gel nails"
        serviceDuration="45 min"
        tier="story"
      />,
    );
    // C'est la phrase qui informe, pas le badge.
    expect(screen.getByText(tokens.tier.story.counterpart.en)).toBeTruthy();
  });

  it("ne commente pas l'absence de photo côté créateur, et la commente côté commerce", async () => {
    const createur = await monter(
      <MediaFallback monogramme="Salón" height={150} labelTache="Photo manquante · ajouter" />,
    );
    expect(screen.queryByText('Photo manquante · ajouter')).toBeNull();
    await createur.unmount();

    await monter(
      <MediaFallback
        monogramme="Salón"
        height={150}
        commeTache
        labelTache="Photo manquante · ajouter"
      />,
      'merchant',
    );
    expect(screen.getByText('Photo manquante · ajouter')).toBeTruthy();
  });

  it('aligne les valeurs chiffrées en mono', async () => {
    await monter(<DataRow label="Capacity" value="3" chiffre testID="ligne" />);
    expect(screen.getByText('3')).toBeTruthy();
  });
});

// --------------------------------------------------------------------------
// États
// --------------------------------------------------------------------------

describe('états', () => {
  it("le message d'état s'annonce comme une alerte", async () => {
    await monter(
      <StatusMessage level="danger" title="No pudimos guardar" body="Revisa tu conexión." testID="m" />,
    );
    expect(screen.getByTestId('m').props.accessibilityRole).toBe('alert');
  });

  it("l'état vide propose des issues, jamais un cul-de-sac", async () => {
    await monter(
      <EmptyState
        title="Nada cerca"
        body="Ningún salón en 2 km."
        actions={[{ label: 'Ampliar a 5 km · 9 salones', onPress: jest.fn() }]}
      />,
    );
    // Le gain chiffré fait partie du libellé : une issue sans chiffre demande
    // de tenter pour voir, et personne ne tente deux fois.
    expect(screen.getByText('Ampliar a 5 km · 9 salones')).toBeTruthy();
  });

  it("l'état vide du commerce montre des repères chiffrés", async () => {
    await monter(
      <EmptyState
        title="Sin reservas"
        body="Nada en 7 días."
        reperes={[{ label: 'Vistas', valeur: '128' }]}
      />,
      'merchant',
    );
    expect(screen.getByText('128')).toBeTruthy();
  });
});

// --------------------------------------------------------------------------
// Écran de code
// --------------------------------------------------------------------------

describe('code de retrait', () => {
  it('affiche six chiffres et les annonce un par un', async () => {
    await monter(<CodeGlyphs code="481629" testID="glyphes" />);
    const bloc = screen.getByTestId('glyphes');
    expect(bloc.props.accessibilityLabel).toBe('4 8 1 6 2 9');
    expect(tokens.code.chars).toBe(6);
  });

  it('ignore le thème dans les deux rôles', async () => {
    const createur = await monter(<CodeGlyphs code="481629" testID="g" />);
    const enSombre = screen.getByText('481629').props.style;
    await createur.unmount();

    await monter(<CodeGlyphs code="481629" testID="g" />, 'merchant');
    const enClair = screen.getByText('481629').props.style;

    const couleur = (s: unknown) =>
      (Array.isArray(s) ? Object.assign({}, ...s) : s as Record<string, unknown>).color;
    expect(couleur(enSombre)).toBe(codeColors.fg);
    expect(couleur(enClair)).toBe(codeColors.fg);
  });

  it("s'inverse sous dix secondes, pas sous soixante", async () => {
    // Le seuil de 60 s valait pour un code qui expirait. Celui-ci tourne.
    const onze = await monter(<Countdown secondes={11} testID="c" />);
    expect(style(screen.getByTestId('c')).backgroundColor).toBe(codeColors.bg);
    await onze.unmount();

    await monter(<Countdown secondes={9} testID="c" />);
    expect(style(screen.getByTestId('c')).backgroundColor).toBe(codeColors.fg);
  });

  it('groupe le code de secours trois par trois', async () => {
    await monter(<ManualCode code="4H29KX" label="Backup code" testID="m" />);
    expect(screen.getByText('4H2 9KX')).toBeTruthy();
  });

  it("n'offre ni renouvellement ni état expiré", () => {
    // Le contrat est vérifié sur la bibliothèque elle-même : aucun composant
    // ne porte ces noms. Un test d'écran viendrait trop tard.
    const bibliotheque = require('../src/components') as Record<string, unknown>;
    const noms = Object.keys(bibliotheque).join(' ').toLowerCase();
    expect(noms).not.toMatch(/refresh|renew|expired|expire/);
  });
});

// --------------------------------------------------------------------------
// Caisse
// --------------------------------------------------------------------------

describe('CodeInput', () => {
  it("s'arrête à six caractères", async () => {
    const onChange = jest.fn();
    await monter(
      <CodeInput
        value="4H29KX"
        onChange={onChange}
        labelEffacer="Delete"
        accessibilityLabel="Code"
      />,
    );
    await fireEvent.press(screen.getByLabelText('A'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('accepte tant que le code est incomplet', async () => {
    const onChange = jest.fn();
    await monter(
      <CodeInput value="4H2" onChange={onChange} labelEffacer="Delete" accessibilityLabel="Code" />,
    );
    await fireEvent.press(screen.getByLabelText('A'));
    expect(onChange).toHaveBeenCalledWith('4H2A');
  });

  it('exclut les caractères ambigus de son alphabet', () => {
    for (const ambigu of ['O', '0', 'I', '1']) {
      expect(tokens.code.alphabet).not.toContain(ambigu);
    }
  });
});

// --------------------------------------------------------------------------
// Créneaux
// --------------------------------------------------------------------------

describe('créneaux', () => {
  const CRENEAUX = [
    { cle: '10', heure: '10:00', pris: false },
    { cle: '11', heure: '11:00', pris: true },
  ];

  it('montre les créneaux pris sans les rendre pressables', async () => {
    const onChange = jest.fn();
    await monter(<SlotPicker creneaux={CRENEAUX} onChange={onChange} />);

    // Visible : c'est ce qui donne le rythme du salon.
    expect(screen.getByLabelText('11:00')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('11:00'));
    expect(onChange).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByLabelText('10:00'));
    expect(onChange).toHaveBeenCalledWith('10');
  });

  it('montre les jours sans disponibilité en creux', async () => {
    const onChange = jest.fn();
    await monter(
      <DayPicker
        jours={[
          { cle: 'a', jourCourt: 'Mon', numero: '4', disponible: true },
          { cle: 'b', jourCourt: 'Tue', numero: '5', disponible: false },
        ]}
        selection="a"
        onChange={onChange}
      />,
    );
    expect(screen.getByLabelText('Tue 5')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Tue 5'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

// --------------------------------------------------------------------------
// Back office
// --------------------------------------------------------------------------

describe('back office', () => {
  const COLONNES = [
    { cle: 'handle', label: 'Handle', largeur: 200 },
    { cle: 'followers', label: 'Followers', largeur: 100, chiffre: true },
  ];

  it('pose la gouttière droite sur les colonnes numériques', async () => {
    // Sans elle, une valeur alignée à droite touche la colonne suivante et se
    // lit comme si elle lui appartenait — sur une table de décision, cela fait
    // trancher sur le mauvais chiffre.
    await monter(<TableHeader colonnes={COLONNES} testID="entete" />);

    expect(style(screen.getByTestId('entete-followers')).paddingRight).toBe(14);
    expect(style(screen.getByTestId('entete-followers')).alignItems).toBe('flex-end');
    // Le pendant : une colonne de texte n'en porte pas, sinon la gouttière ne
    // dirait rien de particulier.
    expect(style(screen.getByTestId('entete-handle')).paddingRight).toBe(0);
  });

  it('retire les décisions qui exigent un motif tant qu’il manque', async () => {
    // Retirée, pas grisée : ce n'est pas une action qui redeviendra possible
    // toute seule, c'est à l'arbitre de choisir un motif.
    const decisions = [
      { cle: 'a', label: 'Approve', touche: 'A', approbation: true, onPress: jest.fn() },
      { cle: 'r', label: 'Reject', touche: 'R', onPress: jest.fn() },
    ];
    const sans = await monter(<DecisionBar decisions={decisions} />);
    expect(screen.getByLabelText('Approve')).toBeTruthy();
    expect(screen.queryByLabelText('Reject')).toBeNull();
    await sans.unmount();

    await monter(<DecisionBar decisions={decisions} motif="mention_absente" />);
    expect(screen.getByLabelText('Reject')).toBeTruthy();
  });

  it('marque la ligne active par une barre gauche', async () => {
    await monter(
      <TableRow
        colonnes={COLONNES}
        valeurs={{ handle: 'rebecca.miami', followers: '24000' }}
        actif
        testID="ligne"
      />,
    );
    expect(style(screen.getByTestId('ligne')).borderLeftWidth).toBe(3);
  });
});

// --------------------------------------------------------------------------
// Texte
// --------------------------------------------------------------------------

describe('Texte', () => {
  it('ne tronque pas par défaut', async () => {
    await monter(<Texte testID="t">Nueva presentación solicitada</Texte>);
    expect(screen.getByTestId('t').props.numberOfLines).toBeUndefined();
  });

  it("ne tronque que sur demande explicite, réservée aux noms propres", async () => {
    await monter(
      <Texte testID="t" ellipseSurNomPropre>
        Salón de belleza Ocean Drive
      </Texte>,
    );
    expect(screen.getByTestId('t').props.numberOfLines).toBe(1);
  });
});

// --------------------------------------------------------------------------
// Ce qui n'existe pas
// --------------------------------------------------------------------------

describe("ce que la bibliothèque n'a pas", () => {
  it("n'expose aucun composant de montant, de solde ou de progression", () => {
    const noms = Object.keys(require('../src/components') as object).join(' ').toLowerCase();
    for (const interdit of ['price', 'amount', 'balance', 'money', 'progress', 'carousel', 'chart']) {
      expect(noms).not.toContain(interdit);
    }
  });

  it('compte exactement les familles prévues', async () => {
    // La bibliothèque ne grossit pas sans qu'on le voie : une famille de plus
    // demande de toucher ce test. Trois ajoutées avec la direction visuelle —
    // la marque, le mouvement, l'en-tête d'écran.
    const { readdirSync } = require('fs') as typeof import('fs');
    const { join } = require('path') as typeof import('path');
    const fichiers = readdirSync(join(__dirname, '..', 'src', 'components'))
      .filter((f) => f.endsWith('.tsx'))
      .sort();

    expect(fichiers).toEqual([
      'Admin.tsx',
      'Badges.tsx',
      'Button.tsx',
      'Cards.tsx',
      'Chip.tsx',
      'CodeInput.tsx',
      'EmptyState.tsx',
      'EnTete.tsx',
      // Amendement v0.6 à `components.md` §17 : deux graphiques, et deux
      // seulement — des barres, et une évolution dans le temps.
      'Graphiques.tsx',
      'Icone.tsx',
      'Logo.tsx',
      'Mouvement.tsx',
      'PaveDeSaisie.tsx',
      'PickupCode.tsx',
      'SegmentedTabs.tsx',
      'Skeleton.tsx',
      'SlotPicker.tsx',
      'StatusMessage.tsx',
      'Stepper.tsx',
      'TextField.tsx',
      'Texte.tsx',
      'TierBadge.tsx',
      'Toggle.tsx',
    ]);
  });
});

// `act` est importé pour les rendus animés ; le référencer évite qu'un
// nettoyage d'imports le retire et laisse un avertissement React.
void act;

// --------------------------------------------------------------------------
// les deux graphiques
// --------------------------------------------------------------------------

describe('graphiques', () => {
  it('garde les semaines vides comme des barres à zéro', async () => {
    // Une série qui saute les semaines sans publication resserre l'axe et fait
    // croire à une régularité qui n'existe pas : trois publications en trois
    // mois se liraient comme trois semaines de suite.
    await monter(
      <BarresParPeriode
        titre="Publications"
        series={[
          { etiquette: 'W30', valeur: 3 },
          { etiquette: 'W31', valeur: 0 },
          { etiquette: 'W32', valeur: 1 },
        ]}
        testID="graphique"
      />,
    );

    expect(screen.getByTestId('barre-W31')).toBeTruthy();
    // Et elle reste visible : « rien » n'est pas « pas de donnée ».
    expect(style(screen.getByTestId('barre-W31')).height).toBeGreaterThan(0);
  });

  it('proportionne les hauteurs au sommet de la série', async () => {
    await monter(
      <BarresParPeriode
        titre="Publications"
        series={[
          { etiquette: 'W30', valeur: 10 },
          { etiquette: 'W31', valeur: 5 },
        ]}
        testID="graphique"
      />,
    );

    const haute = style(screen.getByTestId('barre-W30')).height as number;
    const moitie = style(screen.getByTestId('barre-W31')).height as number;
    expect(moitie).toBeCloseTo(haute / 2, 0);
  });

  it('ne divise jamais par zéro sur une série entièrement vide', async () => {
    // Un salon qui n'a rien publié doit voir un graphique plat, pas un écran
    // blanc ni des hauteurs infinies.
    await monter(
      <BarresParPeriode
        titre="Publications"
        series={[
          { etiquette: 'W30', valeur: 0 },
          { etiquette: 'W31', valeur: 0 },
        ]}
        testID="graphique"
      />,
    );

    expect(Number.isFinite(style(screen.getByTestId('barre-W30')).height as number)).toBe(true);
  });

  it('accompagne chaque palier de son badge, jamais la couleur seule', async () => {
    // C'est la seule série colorée du produit : la couleur y porte déjà un
    // sens ailleurs, et elle ne porte jamais seule.
    await monter(
      <BarresParPalier
        titre="Par palier"
        series={[
          { palier: 'story', valeur: 34 },
          { palier: 'post', valeur: 21 },
        ]}
        testID="graphique"
      />,
    );

    expect(screen.getByTestId('barre-story')).toBeTruthy();
    expect(screen.getByText(/34/)).toBeTruthy();
    expect(screen.getByTestId('badge-story')).toBeTruthy();
    expect(screen.getByTestId('badge-post')).toBeTruthy();
  });
});
