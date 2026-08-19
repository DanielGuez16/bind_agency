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
  ApercuDePrestation,
  BadgesDeProfil,
  BarresParPalier,
  BarresParPeriode,
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
  ServiceRow,
  SlotPicker,
  StatusMessage,
  Stepper,
  TableHeader,
  TableRow,
  TextField,
  Texte,
  TierBadge,
  Toggle,
  chipDeComportement,
  groupesDeRangs,
} from '../src/components';
import { I18nProvider } from '../src/i18n';
import {
  ThemeProvider,
  codeColors,
  couleurs,
  matiereDePalier,
  produit,
  size,
  tokens,
  type Role,
} from '../src/theme';

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
    expect(size.row).toBe(36);
    expect(style(screen.getByTestId('b')).minHeight).toBe(size.hit);
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

  it('masque un secret, et le révèle sur demande', async () => {
    // Le mot de passe s'affichait en clair : douze caractères en grand, sur le
    // premier écran du produit. Et le masquer sans donner le moyen de relire
    // fait ressaisir trois fois la même chaîne sur un clavier de téléphone.
    await monter(
      <TextField
        label="Contraseña"
        value="un-mot-de-passe"
        secret
        labelRevelation={{ montrer: 'Mostrar', masquer: 'Ocultar' }}
        testID="champ"
      />,
    );

    expect(screen.getByTestId('champ').props.secureTextEntry).toBe(true);

    await fireEvent.press(screen.getByTestId('champ-revelation'));
    expect(screen.getByTestId('champ').props.secureTextEntry).toBe(false);

    // Et il se remasque : une bascule à sens unique laisserait le mot de passe
    // à l'écran jusqu'à la fin de la saisie.
    await fireEvent.press(screen.getByTestId('champ-revelation'));
    expect(screen.getByTestId('champ').props.secureTextEntry).toBe(true);
  });

  it('dit lequel des deux états il est en train de montrer', async () => {
    // Un œil sans état laisse deviner si le mot de passe est visible.
    await monter(
      <TextField
        label="Contraseña"
        value="x"
        secret
        labelRevelation={{ montrer: 'Mostrar', masquer: 'Ocultar' }}
        testID="champ"
      />,
    );

    const bascule = screen.getByTestId('champ-revelation');
    expect(bascule.props.accessibilityLabel).toBe('Mostrar');
    expect(bascule.props.accessibilityState.selected).toBe(false);

    await fireEvent.press(bascule);
    expect(screen.getByTestId('champ-revelation').props.accessibilityLabel).toBe('Ocultar');
    expect(screen.getByTestId('champ-revelation').props.accessibilityState.selected).toBe(true);
  });

  it('n’ajoute ni masque ni bascule à un champ ordinaire', async () => {
    // Le pendant : un champ qui masquerait tout passerait les tests ci-dessus
    // sans rien prouver, et rendrait l'e-mail illisible.
    await monter(<TextField label="Email" value="rebecca@bind.example" testID="champ" />);

    expect(screen.getByTestId('champ').props.secureTextEntry).toBeFalsy();
    expect(screen.queryByTestId('champ-revelation')).toBeNull();
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

  it('le compte d’une chip s’entend autant qu’il se voit', async () => {
    // Le nombre est ce qui décide du geste : rendu en mono à côté du mot, il
    // n'existerait que pour qui voit s'il ne passait pas aussi par le libellé
    // d'accessibilité. Un lecteur d'écran annoncerait « Nails », bouton, et
    // rien de ce qui distingue cette chip des quatre autres.
    await monter(<Chip label="Nails" compte={5} onPress={jest.fn()} testID="chip" />);
    expect(screen.getByTestId('chip-compte')).toHaveTextContent('5');
    expect(screen.getByTestId('chip').props.accessibilityLabel).toContain('5');
  });

  it('et une chip sans compte n’en annonce pas un', async () => {
    // Le sens inverse. `0` s'écrirait, lui : c'est à l'appelant de ne pas
    // proposer une chip qui n'ouvre rien, pas au composant de le masquer.
    await monter(<Chip label="Nails" onPress={jest.fn()} testID="chip" />);
    expect(screen.queryByTestId('chip-compte')).toBeNull();
    expect(screen.getByTestId('chip').props.accessibilityLabel).toBe('Nails');
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
    // 3. la matière : reel est un aplat, et c'est le troisième marqueur.
    //
    // Lue dans la table de matière plutôt qu'écrite en dur : la direction
    // artistique a déjà changé une fois, et une valeur transcrite ici ferait
    // échouer ce test pour une raison qui n'a rien à voir avec les trois
    // marqueurs.
    expect(style(screen.getByTestId('badge')).backgroundColor).toBe(
      couleurs[matiereDePalier('reel').surface],
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
      expect(screen.queryByText(String(produit.tier[tier].level))).toBeNull();
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
    expect(produit.badge.priority).toEqual(['behaviour', 'newcomer']);
    expect(produit.badge.maxVisible).toBe(2);
    expect(Object.keys(couleurs)).not.toContain('badge.wave');
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
    expect(screen.getByText(produit.tier.story.counterpart.en)).toBeTruthy();
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
    expect(produit.code.chars).toBe(6);
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

  it("s'inverse au dernier tiers, pas à un nombre de secondes", async () => {
    // Le seuil de 60 s valait pour un code qui expirait. Celui-ci tourne — et
    // **l'urgence est une part de la cadence, pas un nombre de secondes** : à
    // trente secondes de rotation, le comportement est exactement celui d'hier.
    const onze = await monter(<Countdown secondes={11} rotationSecondes={30} testID="c" />);
    expect(style(screen.getByTestId('c')).backgroundColor).toBe(codeColors.bg);
    await onze.unmount();

    const neuf = await monter(<Countdown secondes={9} rotationSecondes={30} testID="c" />);
    expect(style(screen.getByTestId('c')).backgroundColor).toBe(codeColors.fg);
    await neuf.unmount();

    // **Et le seuil suit le serveur.** Neuf secondes sur quinze sont plus de la
    // moitié du tour : rouge en permanence, un signal d'urgence permanent
    // cesse d'être un signal. Le seuil absolu se retournait exactement ainsi.
    await monter(<Countdown secondes={9} rotationSecondes={15} testID="c" />);
    expect(style(screen.getByTestId('c')).backgroundColor).toBe(codeColors.bg);
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
      expect(produit.code.alphabet).not.toContain(ambigu);
    }
  });

  it('groupe la saisie comme le créateur lit son code', async () => {
    // Six caractères d'affilée se recomptent à chaque fois qu'on lève les
    // yeux : la créatrice dicte « PAP EDB », la caissière tapait « PAPEDB ».
    await monter(
      <CodeInput
        value="4H2"
        onChange={() => {}}
        labelEffacer="Delete"
        accessibilityLabel="Code"
        testID="saisie"
      />,
    );

    // Deux groupes, du même découpage que `ManualCode` côté créateur.
    expect(screen.getByTestId('saisie-groupe-0')).toBeTruthy();
    expect(screen.getByTestId('saisie-groupe-1')).toBeTruthy();
    expect(screen.queryByTestId('saisie-groupe-2')).toBeNull();
    expect(produit.code.manualChars / produit.code.manualGroupSize).toBe(2);
  });

  it('groupe les emplacements et non ce qui est déjà tapé', async () => {
    // Grouper la valeur ferait changer le champ de forme à chaque touche, et
    // les caractères déjà saisis glisseraient sous les doigts.
    expect(groupesDeRangs(6, 3)).toEqual([
      [0, 1, 2],
      [3, 4, 5],
    ]);
    // Un découpage qui ne tombe pas juste ne perd pas le reste.
    expect(groupesDeRangs(6, 4)).toEqual([
      [0, 1, 2, 3],
      [4, 5],
    ]);
  });

  it('épelle le code plutôt que de le prononcer', async () => {
    // « PAP EDB » se lirait comme deux mots. Le groupement est une aide à
    // l'œil, jamais à l'oreille.
    await monter(
      <CodeInput
        value="4H2A"
        onChange={() => {}}
        labelEffacer="Delete"
        accessibilityLabel="Code"
      />,
    );
    expect(screen.getByLabelText('Code').props.accessibilityValue.text).toBe('4 H 2 A');
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

/**
 * La ligne de prestation de la fiche : le même défaut, corrigé au même endroit.
 */
describe('la ligne de prestation de la fiche', () => {
  it('donne au nom de la prestation la même variante que l’aperçu du fil', async () => {
    // **La revue a signalé deux fois le même défaut.** Sur le fil, le salon
    // portait le titre et la prestation la légende ; sur la fiche, le nom de la
    // prestation était en `type.label` — onze points, la taille d'une étiquette
    // — sous une durée en mono de douze, plus grosse que lui. Dans les deux
    // cas, l'objet qu'on réserve était subordonné à ce qui l'entoure.
    //
    // **Le test compare les deux écrans plutôt que de figer un nombre.** C'est
    // la même règle aux deux endroits, et l'écrire deux fois en points les
    // laisserait diverger sans que rien ne le dise — c'est exactement comment
    // le défaut est né.
    await monter(
      <>
        <ServiceRow name="Manucure gel" meta="45 min" tier="story" testID="ligne" />
        <ApercuDePrestation
          nom="Gel manicure"
          salon="Vela"
          dureeMinutes={45}
          contrepartie="story"
          testID="apercu-fil"
        />
      </>,
    );

    // Deux libellés différents : le même sur les deux composants rendrait
    // `getByText` ambigu, et le contourner par un index rendrait le test
    // dépendant de l'ordre du montage.
    const surLaFiche = screen.getByText('Manucure gel', { exact: true });
    const nomDuFil = screen.getByTestId('apercu-fil-nom');
    expect(style(surLaFiche).fontSize).toBe(style(nomDuFil).fontSize);
    expect(style(surLaFiche).fontWeight ?? style(surLaFiche).fontFamily).toBe(
      style(nomDuFil).fontWeight ?? style(nomDuFil).fontFamily,
    );
  });

  it('et la durée redevient plus petite que le nom', async () => {
    // Le sens qui manquait : la durée était en mono de douze **au-dessus** d'un
    // nom de onze. Grossir le nom sans redescendre la durée aurait laissé deux
    // lignes de même poids, c'est-à-dire aucune hiérarchie.
    await monter(<ServiceRow name="Gel manicure" meta="45 min" tier="story" testID="ligne" />);

    const nom = screen.getByText('Gel manicure', { exact: true });
    const duree = screen.getByText('45 min', { exact: true });
    expect(Number(style(nom).fontSize)).toBeGreaterThan(Number(style(duree).fontSize));
  });
});

/**
 * L'aperçu de prestation : la hiérarchie, et la case qui tient la grille.
 */
describe('l’aperçu de prestation', () => {
  it('donne le titre à la prestation et l’attribution au salon', async () => {
    // C'est la correction entière de la revue, en deux nœuds : le nom de la
    // prestation porte la variante de titre, le salon et la durée la légende.
    // L'inverse est exactement ce que la v2.1 rendait.
    await monter(
      <ApercuDePrestation
        nom="Gel manicure"
        salon="Vela Nail Studio"
        dureeMinutes={45}
        contrepartie="story"
        testID="apercu"
      />,
    );

    expect(screen.getByTestId('apercu-nom')).toHaveTextContent('Gel manicure');
    expect(screen.getByTestId('apercu-attribution')).toHaveTextContent(
      'Vela Nail Studio · 45 min',
    );
    // Le titre est strictement plus gros que son attribution. Comparer aux deux
    // nombres écrits en dur ferait passer le test le jour où l'échelle bouge
    // sans que la hiérarchie tienne ; c'est le rapport qui est la règle.
    expect(Number(style(screen.getByTestId('apercu-nom')).fontSize)).toBeGreaterThan(
      Number(style(screen.getByTestId('apercu-attribution')).fontSize),
    );
  });

  it('et « salon » seul quand le catalogue ne porte pas de durée', async () => {
    // Le séparateur appartient à la jointure : un « · » orphelin en fin de ligne
    // est le défaut qu'une concaténation produit et qu'aucun montage à durée
    // pleine ne révèle.
    await monter(
      <ApercuDePrestation
        nom="Balayage"
        salon="Rótulo Hair"
        dureeMinutes={null}
        contrepartie={null}
        testID="sans-duree"
      />,
    );

    // **La chaîne exacte pour le positif, l'expression régulière pour la
    // négation.** `toHaveTextContent` compare le contenu entier quand on lui
    // donne une chaîne : `not.toHaveTextContent('·')` aurait été vrai de toute
    // ligne qui ne dit pas *uniquement* « · », c'est-à-dire de toutes. La
    // négation qui compte est celle qui cherche le caractère où qu'il soit.
    expect(screen.getByTestId('sans-duree-attribution')).toHaveTextContent('Rótulo Hair');
    expect(screen.getByTestId('sans-duree-attribution')).not.toHaveTextContent(/·/);
  });

  it('garde la case de contrepartie à la même hauteur, occupée ou vide', async () => {
    // **La règle de Design, et le montage qui la met en défaut.** « La case du
    // badge a une hauteur fixe, occupée ou vide » : sans elle, une rangée dont
    // les aperçus portent une contrepartie mesure plus haut que la même sans,
    // les deux colonnes se décalent, et la hauteur du mur dépend de la donnée.
    //
    // **Il faut les deux dans le même rendu.** Un aperçu avec badge, seul,
    // passerait aussi bien avec une case dimensionnée par son contenu — les
    // deux implémentations rendent la même hauteur quand la case est pleine.
    // C'est le couple plein/vide qui les sépare, et c'est donc lui qu'on écrit.
    await monter(
      <>
        <ApercuDePrestation
          nom="Gel manicure"
          salon="Vela"
          dureeMinutes={45}
          contrepartie="story"
          testID="avec"
        />
        <ApercuDePrestation
          nom="Balayage"
          salon="Rótulo"
          dureeMinutes={120}
          contrepartie={null}
          testID="sans"
        />
      </>,
    );

    const pleine = style(screen.getByTestId('avec-case-contrepartie')).height;
    const vide = style(screen.getByTestId('sans-case-contrepartie')).height;

    expect(vide).toBe(pleine);
    expect(Number(pleine)).toBeGreaterThan(0);
    // Et la case vide l'est vraiment : une case qui garderait son badge à
    // l'opacité nulle tiendrait la hauteur sans dire la vérité au lecteur
    // d'écran.
    expect(screen.queryByTestId('sans-contrepartie')).toBeNull();
    expect(screen.getByTestId('avec-contrepartie')).toBeTruthy();
  });

  it('ne pose aucun chrome : ni fond, ni bordure, ni ombre', async () => {
    // Ce que la carte perd, et ce qui permet d'en montrer deux par ligne. Les
    // trois ensemble : retirer la bordure en gardant l'ombre laisserait une
    // carte, et c'est la forme que la revue vise.
    await monter(
      <ApercuDePrestation
        nom="Signature facial"
        salon="Casa Bruma"
        dureeMinutes={60}
        contrepartie="post"
        testID="nu"
      />,
    );

    const pose = style(screen.getByTestId('nu'));
    expect(pose.backgroundColor).toBeUndefined();
    expect(pose.borderWidth ?? 0).toBe(0);
    expect(pose.boxShadow ?? pose.shadowOpacity).toBeUndefined();
  });
});

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
    // la marque, le mouvement, l'en-tête d'écran. Deux de plus avec la v1.0 :
    // le titre accentué, qui porte les règles du mot plutôt que de les laisser
    // à l'appelant, et le filet segmenté, repris des carrousels de la
    // fondatrice pour dire une progression sans écrire « 2 sur 4 ». Puis le
    // satin, quand les trois images sont arrivées. Et l'aperçu de prestation,
    // avec le fil v3 : la carte de fil montrait le salon en titre et la
    // prestation dessous, ce que les testeurs lisaient comme « un lieu ». La
    // famille existe pour porter la hiérarchie inverse au même endroit pour
    // tout le monde — un aperçu écrit à la main dans un écran la respecterait
    // le jour où on l'écrit, et plus le mois suivant.
    const { readdirSync } = require('fs') as typeof import('fs');
    const { join } = require('path') as typeof import('path');
    const fichiers = readdirSync(join(__dirname, '..', 'src', 'components'))
      .filter((f) => f.endsWith('.tsx'))
      .sort();

    expect(fichiers).toEqual([
      'Admin.tsx',
      'ApercuDePrestation.tsx',
      'Badges.tsx',
      'Button.tsx',
      'Cards.tsx',
      'Chip.tsx',
      'CodeInput.tsx',
      'EmptyState.tsx',
      'EnTete.tsx',
      'FiletSegmente.tsx',
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
      // Le satin. Sa place dans cette liste est ce qui rappelle qu'il est un
      // composant et non un fond : trois surfaces cuites, et trois refus.
      'SurfaceSatin.tsx',
      'TextField.tsx',
      'Texte.tsx',
      'TierBadge.tsx',
      'TitreAccentue.tsx',
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

describe('état vide, v0.6', () => {
  it('ne dessine plus le cercle qui ne disait rien', async () => {
    // Il occupait la place du titre, qui est ce qu'on vient lire.
    const { toJSON } = await monter(<EmptyState title="Rien ici" body="Pour l’instant." />);
    const rendu = JSON.stringify(toJSON());
    expect(rendu).not.toContain('"borderRadius":999');
  });

  it('porte les chiffres en mono, plus gros que le corps', async () => {
    // Quand rien ne s'est passé, ce sont eux qu'on vient chercher.
    await monter(
      <EmptyState
        title="Rien en attente"
        body="Personne n’attend un humain."
        chiffres={[
          { valeur: '18', label: 'settled in 7 days' },
          { valeur: '4 h', label: 'median time to decide' },
        ]}
      />,
    );

    expect(screen.getByTestId('etat-vide-chiffres')).toBeTruthy();
    expect(style(screen.getByText('18')).fontSize).toBe(44);
  });

  it('garde chaque issue avec son gain chiffré', async () => {
    // Une issue sans chiffre demande de tenter pour voir, et personne ne
    // tente deux fois.
    await monter(
      <EmptyState
        title="Rien à 15 km"
        body="Élargissez."
        actions={[{ label: 'Widen to 30 km · 9 salons', onPress: () => {} }]}
      />,
    );

    expect(screen.getByText(/9 salons/)).toBeTruthy();
  });
});

// --------------------------------------------------------------------------
// Le satin
// --------------------------------------------------------------------------

describe('le satin, et ses trois refus', () => {
  it('rend les trois variantes, et chacune la sienne', async () => {
    const { SurfaceSatin } = require('../src/components');
    const sources = new Set<unknown>();
    for (const variante of ['drape', 'fold', 'ember'] as const) {
      const vue = await monter(
        <SurfaceSatin variante={variante} testID="satin">
          <Texte variante="type.heading">Titre</Texte>
        </SurfaceSatin>,
      );
      // L'image est masquée aux lecteurs d'écran — elle ne porte aucun sens —
      // et la requête doit donc la demander explicitement.
      sources.add(
        JSON.stringify(
          screen.getByTestId('satin-image', { includeHiddenElements: true }).props.source,
        ),
      );
      await vue.unmount();
    }
    // Trois images distinctes : une variante qui retomberait sur la même
    // ferait trois écrans de seuil identiques, et personne ne le verrait sans
    // les ouvrir côte à côte.
    expect(sources.size).toBe(3);
  });

  it('refuse de descendre sous la hauteur minimale', async () => {
    // « Il vit sur une surface de 240 px de haut au minimum. » En dessous, les
    // plis se serrent et le dégradé se lit comme une bande sale. Lever plutôt
    // que corriger en silence : une surface remontée sans prévenir déplacerait
    // la mise en page de l'appelant, qui chercherait ailleurs.
    const { SurfaceSatin, HAUTEUR_MINIMALE_DU_SATIN } = require('../src/components');
    expect(HAUTEUR_MINIMALE_DU_SATIN).toBe(240);

    const silence = jest.spyOn(console, 'error').mockImplementation(() => {});
    const trop = (
      <SurfaceSatin variante="drape" hauteurMin={180}>
        <Texte variante="type.heading">Titre</Texte>
      </SurfaceSatin>
    );
    await expect(() => monter(trop)).rejects.toThrow(/240/);
    silence.mockRestore();
  });

  it('refuse un texte trop fin au-dessus de lui', async () => {
    // « Jamais sous un texte de moins de 24 px. » Un dégradé derrière de la
    // donnée rend la donnée illisible et le dégradé bon marché. `type.section`
    // est à 22 : il est dehors, et c'est le cas limite qui compte.
    const { SurfaceSatin } = require('../src/components');
    const silence = jest.spyOn(console, 'error').mockImplementation(() => {});
    const fin = (
      <SurfaceSatin variante="fold">
        <Texte variante="type.section">Trop fin</Texte>
      </SurfaceSatin>
    );
    await expect(() => monter(fin)).rejects.toThrow(/24 px/);
    silence.mockRestore();
  });

  it('accepte les quatre variantes qui tiennent au-dessus du seuil', async () => {
    // Une garde se vérifie aussi dans l'autre sens : celle qui refuse tout
    // passerait le test de refus sans rien garantir.
    const { SurfaceSatin } = require('../src/components');
    for (const variante of [
      'type.display',
      'type.displayAccent',
      'type.heading',
      'type.headingAccent',
    ] as const) {
      const vue = await monter(
        <SurfaceSatin variante="ember" testID="satin">
          <Texte variante={variante}>Titre</Texte>
        </SurfaceSatin>,
      );
      expect(screen.getByTestId('satin')).toBeTruthy();
      await vue.unmount();
    }
  });

  it('pose le titre là où l’image le laisse lire, et le prouve des deux côtés', () => {
    // **Un satin n'est ni clair ni sombre : il a des plis.** L'ancrage et
    // l'encre sont une propriété de l'image, mesurée à la cuisson et déposée
    // dans `contrastes.json`. Ce test compare ce que le composant déclare à ce
    // que la mesure dit — **dans les deux sens**, parce qu'un ancrage qui
    // passerait des deux côtés ne prouverait rien : ce serait un satin plat,
    // c'est-à-dire une pente, c'est-à-dire ce que la direction refuse.
    const { POSE_DU_SATIN } = require('../src/components');
    const { mesures } = require('../assets/satin/contrastes.json');

    for (const [variante, pose] of Object.entries(POSE_DU_SATIN) as [
      string,
      { ancrage: 'haut' | 'bas'; encre: string },
    ][]) {
      const bandes = mesures[`satin-${variante}`];
      const autre = pose.ancrage === 'haut' ? 'bas' : 'haut';

      expect({
        variante,
        ou: pose.ancrage,
        contraste: bandes[pose.ancrage][pose.encre] >= 4.5,
      }).toEqual({ variante, ou: pose.ancrage, contraste: true });

      expect({
        variante,
        ou: autre,
        contraste: bandes[autre][pose.encre] >= 4.5,
      }).toEqual({ variante, ou: autre, contraste: false });
    }
  });

  it('ancre en haut ou en bas selon le pli, jamais toujours au même endroit', async () => {
    const { SurfaceSatin } = require('../src/components');
    const alignement = async (variante: string) => {
      const vue = await monter(
        <SurfaceSatin variante={variante} testID="satin">
          <Texte variante="type.heading">Titre</Texte>
        </SurfaceSatin>,
      );
      const aligne = style(screen.getByTestId('satin')).justifyContent;
      await vue.unmount();
      return aligne;
    };

    expect(await alignement('drape')).toBe('flex-start');
    expect(await alignement('ember')).toBe('flex-end');
  });
});

describe('le nom d’une carte est sur une bande, pas sur une queue de dégradé', () => {
  it('porte le plus opaque des arrêts, et non une opacité de hasard', async () => {
    // **Le défaut que ça ferme.** Sur un dégradé, l'opacité sous un texte
    // dépend de l'endroit exact où ce texte tombe — donc de la hauteur de la
    // carte, donc du terminal. Les deux lignes tombaient autour de 0,65 et
    // 0,76 : au-dessus du seuil pour l'une, en dessous pour l'autre, et
    // impossible à prouver dans les deux cas.
    //
    // Sur une bande, les deux nombres sont fixes : 12,10:1 et 7,72:1 sur une
    // photo blanche, sur n'importe quel écran.
    const { couleurs, opaciteMinimaleDuVoile } = require('../src/theme');
    await monter(
      <BusinessCard
        name="Salón Ocean"
        meta="Beauty · 1,2 km"
        serviceName="Gel nails"
        serviceDuration="45 min"
        tier="story"
      />,
    );

    expect(style(screen.getByTestId('bande-du-nom')).backgroundColor).toBe(
      couleurs['scrim.photoBottom'],
    );

    // Et cette bande dépasse ce que la plus exigeante des deux encres demande.
    const opacite = Number(/,\s*([\d.]+)\)/.exec(couleurs['scrim.photoBottom'])![1]);
    expect(opacite).toBeGreaterThanOrEqual(opaciteMinimaleDuVoile('ink.onScrimMuted'));
  });
});
