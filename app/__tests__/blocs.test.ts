/**
 * Le comptage des blocs orange, écran par écran.
 *
 * **La passation dit que la règle se vérifie à l'œil nu, et c'est précisément
 * ce qui ne tient pas.** Un bloc de plus n'arrive jamais le jour où l'on écrit
 * l'écran : il arrive six semaines après, par un sous-titre ajouté dans un
 * fichier que personne ne rouvre, et il ne se voit qu'en ouvrant les huit
 * écrans côte à côte — ce que personne ne fait non plus. La règle du bloc est
 * la seule du système qui se compte, donc la seule qu'une machine peut tenir.
 *
 * ## Ce qui est compté, et ce qui ne l'est pas
 *
 * Le bloc est **le rectangle plein derrière le mot accentué d'un titre**, et
 * lui seul. Ni le bouton principal, ni le filet d'onglet actif, ni l'aplat du
 * palier reel : la passation les autorise explicitement, et son propre tableau
 * du §13 le confirme — « Journée du commerce : 0 », « Caisse : 0 », alors que
 * ces écrans portent tous deux un bouton principal orange. Ce qui est banni des
 * écrans de travail quotidien est **la signature**, pas la teinte. « On les
 * ouvre dix fois par jour ; une signature vue dix fois par jour est du bruit. »
 *
 * ## Deux règles, et la seconde est celle qui tiendra dans la durée
 *
 * La première compte les blocs déclarés. La seconde interdit à un **écran** de
 * peindre `brand.500` lui-même : les surfaces orange légitimes vivent toutes
 * dans un composant — le bouton, le badge de palier, la barre latérale, le
 * titre accentué, le filet segmenté — et un écran qui en peint une court-
 * circuite la bibliothèque. C'est par là qu'arriveraient la ligne de liste, la
 * carte de fil et la pastille de statut que le §5 refuse, et aucune d'elles ne
 * ressemble à un bloc dans le code.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const ECRANS = join(__dirname, '..', 'src', 'screens');

/**
 * Combien de blocs chaque écran a le droit de porter.
 *
 * **La table est exhaustive**, et un test le vérifie : un écran ajouté sans
 * ligne ici fait tomber la garde plutôt que de passer à zéro par défaut. Un
 * défaut silencieux serait le pire des deux mondes — la règle paraîtrait tenue
 * partout et ne le serait nulle part.
 *
 * Les quatre écrans à 1 sont ceux que le §13 nomme : ceux où la marque **se
 * présente**. Tout le reste est à 0, et les écrans de travail quotidien y sont
 * à 0 pour une raison écrite, pas par défaut.
 */
const BLOCS: Record<string, number> = {
  // --- la marque se présente : un bloc, sur le mot accentué du plus grand titre
  //
  // L'accueil avant inscription et les deux portes de connexion sont les seuls
  // écrans qu'on voit une fois. C'est là que la signature a un sens.
  // **Ces deux-là ne s'additionnent pas**, et la garde ne peut pas le voir :
  // elle lit un fichier à la fois. L'accueil porte les portes ; quand il montre
  // son satin, il leur retire leur en-tête et prend le bloc à son compte, et
  // quand il montre une vidéo il le leur laisse. Un et un seul dans les deux
  // branches — c'est un test de rendu qui le compte, sur l'écran monté.
  AccueilScreen: 1,
  ChoixDeLaPorte: 1,
  // Le franchissement d'un palier, et lui seul : l'écran des paliers ne porte
  // son bloc que le jour où quelque chose s'ouvre.
  PaliersScreen: 1,
  // La confirmation d'une réservation est un seuil : on vient d'obtenir
  // quelque chose, et l'écran ne se revoit pas.
  CreneauxScreen: 1,

  // --- travail quotidien : zéro, et c'est une décision
  //
  // « On les ouvre dix fois par jour ; une signature vue dix fois par jour est
  // du bruit. » L'orange y reste, en filet actif et en bouton principal.
  JourneeScreen: 0,
  RedemptionScreen: 0,
  ArbitrageScreen: 0,
  HistoriqueScreen: 0,
  PublicationsScreen: 0,
  CatalogueScreen: 0,
  HorairesScreen: 0,
  ConfigurationScreen: 0,
  // La création d'un commerce est un formulaire, pas un seuil : la marque n'y
  // présente rien, elle enregistre des faits.
  CreationDuCommerceScreen: 0,
  AnnuaireScreen: 0,
  TerrainScreen: 0,
  ReportingScreen: 0,
  PlansScreen: 0,
  MenuReviewScreen: 0,
  CameraScanner: 0,

  // --- parcours créateur : la découverte et la fiche ne se signent pas
  //
  // « Ni sur une carte dans un fil » : le fil est fait de cartes, et une
  // signature répétée y devient une nappe.
  FilScreen: 0,
  FicheScreen: 0,
  // L'abonnement : le prix et ce qu'il ouvre. Aucune matière de marque —
  // c'est un écran où l'on paie, pas où l'on se présente.
  AbonnementScreen: 0,
  AudienceScreen: 0,
  // Le score en détail : que de l'explication, et deux garanties. Aucune
  // matière de marque n'a rien à y faire.
  FavorisScreen: 0,
  FiabiliteScreen: 0,
  // La liste de ce qu'un palier ouvre : de l'information, pas une
  // présentation de la marque. Le badge de palier y porte la seule matière.
  PrestationsDuPalierScreen: 0,
  CarteDuCommerce: 0,
  GalerieDuCommerce: 0,
  // Les deux visionneuses plein écran. Zéro par nature : ce qu'on y regarde
  // est la photo ou la page, et une signature posée dessus serait la seule
  // chose que la marque aurait à dire par-dessus le travail d'un salon.
  Visionneuses: 0,
  PreuveScreen: 0,
  EnvoiDePreuve: 0,
  Preuve: 0,
  ReglagesScreen: 0,
  ReglesScreen: 0,
  ReglesDesPaliers: 0,
  RaisonDuVide: 0,
  BienvenueScreen: 0,
  AuthScreen: 0,
  PriseEnMainScreen: 0,
  HealthScreen: 0,

  // --- hors système, ou sans titre du tout
  //
  // L'écran de code est blanc pur sur noir pur, sans marque ni orange.
  CodeScreen: 0,
  // L'enveloppe des quatre états n'a pas de titre à elle.
  Ecran: 0,
};

/**
 * Les écrans que le §5 nomme explicitement, et qui doivent rester à zéro.
 *
 * Redondant avec la table ci-dessus, et délibérément : la table se modifie
 * ligne à ligne sans qu'on relise le reste, et un jour quelqu'un passera la
 * journée du commerce à 1 en pensant bien faire. Cette liste-là porte la
 * raison, et elle tombe avant la table.
 */
const TRAVAIL_QUOTIDIEN = ['JourneeScreen', 'RedemptionScreen', 'ArbitrageScreen', 'HistoriqueScreen'];

/**
 * Compte les blocs d'un fichier source.
 *
 * **Quatre façons d'armer le prop, et la garde les prend toutes.** `bloc` nu
 * est la forme évidente ; `bloc={true}` et `bloc={condition}` sont celles
 * qu'on écrit vraiment, et la balise passe sur plusieurs lignes dès qu'elle a
 * trois props. Une garde calée sur la première ferait croire que la question
 * est réglée.
 *
 * `bloc={false}` ne compte pas : c'est une désactivation explicite, et la
 * refuser interdirait d'écrire la règle dans le code.
 */
export function compterLesBlocs(source: string): number {
  const balises = source.match(/<TitreAccentue[\s\S]*?\/>/g) ?? [];
  return balises.filter((balise) => {
    const arme = /\bbloc(\s*=\s*\{(?!false\s*\})[^}]*\})?(?=[\s/>])/.exec(balise);
    return arme !== null;
  }).length;
}

function fichiersDEcran(): string[] {
  return readdirSync(ECRANS)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => f.replace(/\.tsx$/, ''))
    .sort();
}

describe('le compteur lui-même', () => {
  it('attrape les quatre façons d’armer le bloc', () => {
    // L'exemple qui a motivé la garde, puis les trois autres façons d'écrire la
    // même chose.
    expect(compterLesBlocs('<TitreAccentue texte="x" motAccentue="y" bloc />')).toBe(1);
    expect(compterLesBlocs('<TitreAccentue texte="x" bloc={true} />')).toBe(1);
    expect(compterLesBlocs('<TitreAccentue texte="x" bloc={vientDeFranchir} />')).toBe(1);
    expect(
      compterLesBlocs(`<TitreAccentue
        texte={t('accueil.titre')}
        motAccentue={t('accueil.accent')}
        bloc
      />`),
    ).toBe(1);
  });

  it('ne compte ni le titre sans bloc ni la désactivation explicite', () => {
    // Une garde qui crie sur tout se désactive au bout d'une semaine.
    expect(compterLesBlocs('<TitreAccentue texte="x" motAccentue="y" />')).toBe(0);
    expect(compterLesBlocs('<TitreAccentue texte="x" bloc={false} />')).toBe(0);
    expect(compterLesBlocs('<Texte variante="type.heading">bloc</Texte>')).toBe(0);
    // Un prop dont le nom commence par « bloc » n'est pas le prop `bloc`.
    expect(compterLesBlocs('<TitreAccentue texte="x" blocage={vrai} />')).toBe(0);
  });

  it('compte deux blocs quand il y en a deux', () => {
    // Le cas que la règle vise : un dans le titre, un dans le sous-titre.
    const deux = `
      <TitreAccentue texte="a" motAccentue="a" bloc />
      <TitreAccentue texte="b" motAccentue="b" bloc />
    `;
    expect(compterLesBlocs(deux)).toBe(2);
  });
});

describe('un bloc par écran, au maximum', () => {
  it('la table couvre exactement les écrans du dépôt', () => {
    // Sans cela, un écran neuf passerait à zéro par défaut : la règle
    // paraîtrait tenue partout et ne le serait nulle part.
    expect(Object.keys(BLOCS).sort()).toEqual(fichiersDEcran());
  });

  it.each(fichiersDEcran())('%s ne dépasse pas ce qu’il déclare', (nom) => {
    const source = readFileSync(join(ECRANS, `${nom}.tsx`), 'utf-8');
    expect({ ecran: nom, blocs: compterLesBlocs(source) }).toEqual({
      ecran: nom,
      blocs: Math.min(compterLesBlocs(source), BLOCS[nom]),
    });
  });

  it('aucun écran ne déclare plus d’un bloc', () => {
    const trop = Object.entries(BLOCS).filter(([, n]) => n > 1);
    expect(trop).toEqual([]);
  });

  it('les écrans de travail quotidien déclarent zéro', () => {
    // Nommés une seconde fois, avec leur raison : la table se modifie ligne à
    // ligne sans qu'on relise le reste.
    for (const nom of TRAVAIL_QUOTIDIEN) {
      expect({ ecran: nom, blocs: BLOCS[nom] }).toEqual({ ecran: nom, blocs: 0 });
    }
  });
});

describe('un écran ne peint jamais la teinte de marque lui-même', () => {
  /**
   * Les surfaces orange légitimes, chacune avec le composant qui la porte.
   *
   * Aucune n'est un écran. C'est ce qui empêche la ligne de liste, la carte de
   * fil et la pastille de statut que le §5 refuse : elles n'arriveraient pas
   * sous la forme d'un bloc, mais sous celle d'un `backgroundColor` écrit à la
   * main dans un écran.
   *
   * **Il n'y en a plus qu'une, et la seconde est partie avec ce qu'elle
   * couvrait.** Le mur en mosaïque posait une pastille de distance et un badge
   * en aplat de marque sur ses photos ; la v3 n'a plus ni voile ni pastille sur
   * l'image, et sa contrepartie est de l'ambre clair à encre ambre foncé. Une
   * tolérance qui survit à son motif est une permission qu'on ne relit plus —
   * c'est le test du dessous qui l'a dit, pas une relecture.
   */
  const TOLERES: Record<string, string> = {
    'src/screens/PaliersScreen.tsx':
      "la pastille « next for you » : components.md §3 la prescrit en brand.500 à texte encre. " +
      "C'est une désignation — le prochain palier — et non un état : le §5 ne bannit le bloc " +
      "que sur ce qui rapporte un statut, où il ferait croire à une promotion.",
  };

  function sources(dossier: string, trouves: string[] = []): string[] {
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      const chemin = join(dossier, entree.name);
      if (entree.isDirectory()) sources(chemin, trouves);
      else if (/\.tsx$/.test(entree.name)) trouves.push(chemin);
    }
    return trouves;
  }

  it('ni fond, ni bordure pleine, hors des tolérances nommées', () => {
    const fautifs: string[] = [];
    for (const chemin of sources(join(__dirname, '..', 'src', 'screens'))) {
      const relatif = chemin.slice(chemin.indexOf('src/'));
      if (TOLERES[relatif]) continue;
      readFileSync(chemin, 'utf-8')
        .split('\n')
        .forEach((ligne, index) => {
          if (/^\s*(\/\/|\*|\/\*)/.test(ligne)) return;
          if (/backgroundColor:[^,;]*brand\.500/.test(ligne)) {
            fautifs.push(`${relatif}:${index + 1} → ${ligne.trim()}`);
          }
        });
    }

    expect(fautifs).toEqual([]);
  });

  it('la garde attrape la forme qu’elle vise, et rien d’autre', () => {
    const attrape = (l: string) =>
      /backgroundColor:[^,;]*brand\.500/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l);

    expect(attrape("        backgroundColor: c['brand.500'],")).toBe(true);
    expect(attrape("  backgroundColor: actif ? c['brand.500'] : 'transparent',")).toBe(true);
    expect(attrape("        borderLeftColor: c['brand.500'],")).toBe(false);
    expect(attrape("  // backgroundColor: c['brand.500'] — expliqué plus haut")).toBe(false);
    expect(attrape("        backgroundColor: c['brand.50'],")).toBe(false);
  });

  it('chaque tolérance nomme un fichier qui existe et qui s’en sert encore', () => {
    // Une tolérance qui ne sert plus fait croire que la règle a une exception
    // là où elle n'en a plus.
    for (const [relatif, raison] of Object.entries(TOLERES)) {
      const source = readFileSync(join(__dirname, '..', relatif), 'utf-8');
      expect({ relatif, sert: /backgroundColor:[^,;]*brand\.500/.test(source) }).toEqual({
        relatif,
        sert: true,
      });
      expect(raison.length).toBeGreaterThan(40);
    }
  });
});
