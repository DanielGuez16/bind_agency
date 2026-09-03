/**
 * Composants du back office. Web dense, conçu pour 1360.
 *
 * **La gouttière droite des colonnes numériques est obligatoire.** Sans ses
 * 14 points, une valeur alignée à droite touche la colonne suivante et se lit
 * comme si elle lui appartenait — ce qui, sur une table de décision, fait
 * trancher sur le mauvais chiffre.
 *
 * **Un motif choisi dans une liste fermée est obligatoire pour toute décision
 * autre qu'une approbation.** La barre de décision le refuse structurellement :
 * `DecisionBar` demande un motif à chaque action qui n'est pas une approbation,
 * et ne peut pas être appelée sans.
 */
import { useMemo, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { useRaccourcis } from '../shell/useRaccourcis';

import { breakpoint, radius, useColors, type ColorName } from '../theme';
import { Texte } from './Texte';
import { etatAccessible } from './etatAccessible';

export type Colonne = {
  cle: string;
  label: string;
  largeur: number;
  /**
   * Aligné à droite, avec la gouttière. **Plus en mono.**
   *
   * Le mono disait « donnée technique » ; dans une rangée il disait surtout
   * « lis-moi caractère par caractère », ce qui est le contraire de ce qu'on
   * fait d'une table qu'on survole. Les chiffres gardent leur alignement à
   * droite et prennent des chiffres tabulaires, ce qui suffit à les faire
   * colonne.
   */
  chiffre?: boolean;
  /**
   * La cellule qui **nomme** la rangée. La première, sauf mention contraire.
   *
   * Un seul échelon de nom par rangée : deux cellules en 600 rendent deux
   * lectures possibles de la même ligne, et l'œil hésite sur laquelle est
   * l'objet.
   */
  nom?: boolean;
  /**
   * La valeur de cette colonne est un état, rendu en cartouche.
   *
   * La rangée reçoit alors sa nature dans `natures`, à côté de sa valeur : le
   * libellé reste une chaîne traduite, et c'est l'appelant qui sait si l'état
   * qu'il nomme vit, attend ou dort.
   */
  etat?: boolean;
};

/** Les chiffres d'une même colonne mesurent pareil, sans passer par le mono. */
const TABULAIRE = { fontVariant: ['tabular-nums' as const] };

const GOUTTIERE = 14;

export function TableHeader({ colonnes, testID }: { colonnes: Colonne[]; testID?: string }) {
  const c = useColors();
  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        height: 34,
        alignItems: 'center',
        paddingHorizontal: 12,
        borderBottomWidth: 1,
        borderBottomColor: c['line.default'],
      }}
    >
      {colonnes.map((colonne) => (
        <View
          key={colonne.cle}
          testID={`entete-${colonne.cle}`}
          style={{
            width: colonne.largeur,
            alignItems: colonne.chiffre ? 'flex-end' : 'flex-start',
            // **La gouttière vaut pour toutes les colonnes.** Elle n'existait
            // qu'à droite des chiffres, au motif qu'elle les désignait : deux
            // colonnes de texte voisines se touchaient donc. Ce qui désigne une
            // colonne de chiffres est son alignement à droite ; le creux, lui,
            // empêche une valeur de se lire comme appartenant à la colonne
            // suivante, et ce besoin est le même pour du texte.
            paddingRight: GOUTTIERE,
          }}
        >
          {/* **Label, et c'est le premier des trois échelons.** La tête était
              en `type.caption`, c'est-à-dire à la même graisse que ses propres
              valeurs : une colonne dont le titre pèse autant que son contenu
              ne se survole pas, elle se lit ligne à ligne. */}
          <Texte variante="type.label" couleur="ink.mute" ellipseSurNomPropre>
            {colonne.label}
          </Texte>
        </View>
      ))}
    </View>
  );
}

/**
 * Les trois natures d'un état, et rien de plus.
 *
 * **Un état se lit à sa matière, pas à sa teinte.** Les cinq écrans écrivaient
 * leurs états en texte simple, chacun avec sa couleur d'encre : « LIVE » en
 * vert ici, « Activated » en encre là, et l'œil devait lire le mot pour savoir
 * s'il était bon. Un cartouche se voit avant d'être lu.
 *
 * Trois natures et non un cartouche par état : `vivant` pour ce qui tourne,
 * `attente` pour ce qui appelle un geste, `dormant` pour ce qui n'en appelle
 * aucun. Un quatrième obligerait à décider ce qu'il veut dire, et c'est ainsi
 * qu'on se retrouve avec sept couleurs qui n'en signifient plus qu'une.
 */
export type NatureDEtat = 'vivant' | 'attente' | 'dormant';

export function Cartouche({
  libelle,
  nature,
  testID,
}: {
  libelle: string;
  nature: NatureDEtat;
  testID?: string;
}) {
  const c = useColors();
  // L'ambre du cartouche est **pâle**, jamais l'aplat de marque : celui-ci est
  // réservé à l'unique décision de l'écran, et un état n'est pas une décision.
  const matiere = {
    vivant: { fond: 'status.success.surface', encre: 'status.success.text' },
    attente: { fond: 'brand.100', encre: 'brand.900' },
    dormant: { fond: 'bg.inset', encre: 'ink.mute' },
  }[nature] as { fond: ColorName; encre: ColorName };

  return (
    <View
      testID={testID}
      style={{
        alignSelf: 'flex-start',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: radius['radius.sm'],
        backgroundColor: c[matiere.fond],
      }}
    >
      <Texte variante="type.label" couleur={matiere.encre}>
        {libelle}
      </Texte>
    </View>
  );
}

export function TableRow({
  colonnes,
  valeurs,
  natures,
  rendus,
  actif,
  onPress,
  fin,
  testID,
}: {
  colonnes: Colonne[];
  valeurs: Record<string, string>;
  /** La nature de chaque cellule déclarée `etat`. */
  natures?: Record<string, NatureDEtat>;
  /**
   * Ce qu'une cellule porte quand ce n'est pas du texte.
   *
   * **La rangée garde sa géométrie, l'appelant fournit le contenu.** Un glyphe
   * de plateforme ou une pastille ne se dit pas en chaîne ; les faire entrer
   * dans `valeurs` aurait demandé à la rangée de savoir les reconnaître, et
   * c'est ainsi qu'une fonction partagée redevient cinq fonctions.
   */
  rendus?: Record<string, ReactNode>;
  actif?: boolean;
  onPress?: () => void;
  /**
   * Ce que porte la fin de rangée, quand la valeur ne suffit pas.
   *
   * **Une fente plutôt qu'une seconde table.** L'annuaire d'administration
   * pose un unique mot cliquable au bout de chaque ligne ; recopier la
   * géométrie des colonnes à côté pour l'obtenir est exactement ainsi que deux
   * tables finissent par ne plus s'aligner. La colonne correspondante se
   * déclare dans `colonnes`, avec un libellé vide.
   */
  fin?: ReactNode;
  testID?: string;
}) {
  const c = useColors();

  /**
   * **Sans geste, ce n'est pas un bouton.** La rangée était un `Pressable` de
   * rôle « button » même sans `onPress` : un lecteur d'écran annonçait donc un
   * bouton sur chaque ligne d'une table qui n'en portait aucun. C'est le
   * contraire de la retenue qu'on cherche — la retenue s'obtient en n'offrant
   * qu'une porte, pas en offrant une porte qui ne s'ouvre pas.
   */
  /**
   * **Le style se calcule à part, et c'est obligatoire.** Un `View` ne résout
   * pas une fonction de style : la lui passer laisse la fonction telle quelle,
   * donc une rangée sans bordure, sans fond et sans hauteur — et rien ne lève.
   * Seul le `Pressable` sait appeler la fonction pour connaître `pressed`.
   */
  const cellules = colonnes.map((colonne, index) => (
    <View
      key={colonne.cle}
      style={{
        width: colonne.largeur,
        alignItems: colonne.chiffre ? 'flex-end' : 'flex-start',
        paddingRight: GOUTTIERE,
      }}
    >
      {/* **Une cellule ne passe jamais à la ligne.** `ellipseSurNomPropre`
          n'était posé que sur les colonnes de texte : une valeur trop longue
          dans une colonne de chiffres cassait la rangée en deux ou trois
          lignes — « Sep 2, » au-dessus de « 2026 », « Not taken » au-dessus de
          « yet ». Une table dont les rangées n'ont pas la même hauteur cesse
          d'être une table : l'œil ne suit plus une colonne, il déchiffre des
          blocs.

          Le remède de fond est la largeur, pas l'ellipse — une donnée coupée
          ne se lit pas mieux qu'une donnée cassée, et les deux colonnes
          fautives ont été élargies là où elles sont déclarées. Ceci est le
          filet qui empêche la prochaine de casser la grille en silence. */}
      {rendus?.[colonne.cle] !== undefined ? (
        rendus[colonne.cle]
      ) : colonne.etat && natures?.[colonne.cle] ? (
        <Cartouche
          libelle={valeurs[colonne.cle] ?? ''}
          nature={natures[colonne.cle]}
          testID={testID ? `${testID}-${colonne.cle}` : undefined}
        />
      ) : (
      <>
      {/* **Trois échelons, pas six.** La tête en label, le nom en 600, la
          valeur en 400 — et rien d'autre dans une rangée. Chaque écran de
          l'administration avait été réparé séparément, donc chacun avait fini
          avec sa propre échelle ; c'est cette dérive-là que la grammaire
          commune ferme, et elle ne peut se rouvrir qu'ici. */}
      <Texte
        variante={colonne.nom ?? index === 0 ? 'type.bodyStrong' : 'type.body'}
        couleur={colonne.nom ?? index === 0 ? 'ink.default' : 'ink.soft'}
        style={colonne.chiffre ? TABULAIRE : undefined}
        ellipseSurNomPropre
      >
        {valeurs[colonne.cle] ?? ''}
      </Texte>
      </>
      )}
    </View>
  ));

  const assiette = {
    flexDirection: 'row' as const,
    minHeight: 44,
    alignItems: 'center' as const,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: c['line.default'],
    /**
     * **Un filet ambre et un fond crème, jamais un aplat.**
     *
     * Cette ligne portait un filet d'encre et un creux gris, sur l'argument
     * qu'une sélection ambre mettrait onze occurrences de la couleur de marque
     * sur une table de quinze lignes. L'argument visait le bon défaut et
     * traitait le mauvais objet : ce qui use l'orange est l'**aplat**, qui
     * ressemble à un bouton, pas le filet.
     *
     * La règle de la v15 sépare les deux. Un seul aplat orange par écran, et
     * c'est toujours une décision ; le filet, lui, est un repère, il ne
     * s'appuie pas, et il n'y en a jamais qu'un puisqu'une seule rangée est
     * ouverte à la fois.
     */
    backgroundColor: actif ? c['brand.50'] : 'transparent',
    borderLeftWidth: 3,
    borderLeftColor: actif ? c['brand.500'] : 'transparent',
  };

  if (!onPress) {
    return (
      <View testID={testID} style={assiette}>
        {cellules}
        {fin}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      {...etatAccessible({ selected: actif })}
      onPress={onPress}
      style={({ pressed }) => ({ ...assiette, opacity: pressed ? 0.7 : 1 })}
    >
      {cellules}
      {fin}
    </Pressable>
  );
}

export function KeyHint({ touche }: { touche: string }) {
  const c = useColors();
  return (
    <View
      style={{
        paddingHorizontal: 5,
        // **Un rayon de pastille, pas de carte.** Ce badge porte le nom d'une
        // touche sur quatorze points de haut ; les jetons réservent `sm` aux
        // chips et aux pastilles, et `lg` aux cartes, feuilles et panneaux. À
        // cette taille les deux se ressemblent à l'œil, ce qui est exactement
        // pourquoi le mauvais a survécu — mais l'inventaire des cartes le
        // comptait comme une surface qui devait porter une ombre.
        paddingVertical: 1,
        borderRadius: radius['radius.sm'],
        backgroundColor: c['bg.surface'],
      }}
    >
      <Texte variante="type.data" couleur="ink.soft" style={{ fontSize: 10 }}>
        {touche}
      </Texte>
    </View>
  );
}

export function DetailPanel({
  titre,
  identifiant,
  children,
  testID,
}: {
  titre: string;
  /** L'identifiant technique reste en anglais brut, jamais traduit. */
  identifiant: string;
  children: React.ReactNode;
  testID?: string;
}) {
  const c = useColors();
  return (
    <View
      testID={testID}
      style={{
        // La passation v0.6 fixe 440, dans la fourchette 400–470. La valeur
        // était écrite ici ; elle vient maintenant du jeton.
        width: breakpoint.detailPanelAdmin,
        borderLeftWidth: 1,
        borderLeftColor: c['line.default'],
        backgroundColor: c['bg.surface'],
      }}
    >
      <View
        style={{
          height: 36,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 12,
          borderBottomWidth: 1,
          borderBottomColor: c['line.default'],
        }}
      >
        <Texte variante="type.label">{titre}</Texte>
        <Texte variante="type.data" couleur="ink.mute" style={{ fontSize: 11 }}>
          {identifiant}
        </Texte>
      </View>
      <ScrollView>{children}</ScrollView>
    </View>
  );
}

export type Decision = {
  cle: string;
  label: string;
  touche: string;
  /**
   * Le nom accessible, quand le libellé ne suffit pas à désigner l'objet.
   *
   * « Approve » ne dit pas ce qu'on approuve. À l'œil, le panneau ouvert au-
   * dessus le dit ; à l'oreille, la barre arrive seule, et trois boutons
   * identiques d'un dossier à l'autre ne se distinguent plus.
   */
  accessibilityLabel?: string;
  /** Vrai pour une approbation seulement. Toute autre décision exige un motif. */
  approbation?: boolean;
  onPress: () => void;
};

export function DecisionBar({
  decisions,
  /** Le motif choisi. Sans lui, les décisions non approbatives sont retirées. */
  motif,
  testID,
}: {
  decisions: Decision[];
  motif?: string;
  testID?: string;
}) {
  const c = useColors();

  // Le bouton est **retiré**, pas grisé : une action impossible ne se grise que
  // si elle redeviendra possible d'elle-même, ce qui n'est pas le cas ici —
  // c'est à l'arbitre de choisir un motif.
  const offertes = decisions.filter((decision) => decision.approbation || motif);

  // **La pastille tenait une promesse que rien n'écoutait.** Elle dessinait
  // « A », « R », « N » depuis le début, et le clavier ne servait à rien : qui
  // traite vingt dossiers à la chaîne y croit, appuie, n'obtient rien, puis
  // cesse d'y croire. Les raccourcis suivent exactement les décisions offertes —
  // un raccourci qui survivrait à son bouton ferait ce que le bouton refuse.
  useRaccourcis(
    useMemo(
      () => offertes.map(({ touche, onPress }) => ({ touche, action: onPress })),
      // La liste se reconstruit à chaque rendu ; c'est son contenu qui compte.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [offertes.map((d) => d.touche).join(''), ...offertes.map((d) => d.onPress)],
    ),
  );

  return (
    <View testID={testID} style={{ flexDirection: 'row', gap: 6, padding: 12 }}>
      {offertes
        .map((decision) => (
          <Pressable
            key={decision.cle}
            accessibilityRole="button"
            accessibilityLabel={decision.accessibilityLabel ?? decision.label}
            onPress={decision.onPress}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 34,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              borderRadius: radius['radius.lg'],
              borderWidth: 1,
              borderColor: c['line.default'],
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <KeyHint touche={decision.touche} />
            <Texte variante="type.caption" style={{ flexShrink: 1 }}>
              {decision.label}
            </Texte>
          </Pressable>
        ))}
    </View>
  );
}

export function Toolbar({
  children,
  compteurSelection,
  actionsDeMasse,
  testID,
}: {
  children?: React.ReactNode;
  compteurSelection?: string;
  /**
   * Permises **uniquement** sur les approbations et les relances de jobs.
   * L'appelant en porte la responsabilité ; le composant ne les invente pas.
   */
  actionsDeMasse?: React.ReactNode;
  testID?: string;
}) {
  const c = useColors();
  return (
    <View
      testID={testID}
      style={{
        height: 40,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 12,
        borderBottomWidth: 1,
        borderBottomColor: c['line.default'],
      }}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, flex: 1 }}>{children}</View>
      {compteurSelection ? (
        <Texte variante="type.caption" couleur="ink.soft">
          {compteurSelection}
        </Texte>
      ) : null}
      {actionsDeMasse}
    </View>
  );
}

/**
 * La bande de chiffres de tête, mesurée sur la planche.
 *
 * **Un cartouche, pas une rangée flottante.** Card bordée, chaque cellule
 * séparée par un filet à droite sauf la dernière — c'est ce que « Reviews »,
 * « Salons », « Plans », « Outreach » et « Creators » ont en commun dès qu'un
 * écran ouvre sur des nombres avant sa table. `Toolbar` et `TableHeader` sont
 * la grammaire des lignes ; celle-ci est la grammaire de l'en-tête.
 */
export function BandeDeChiffres({
  children,
  testID,
}: {
  children: ReactNode;
  testID?: string;
}) {
  const c = useColors();
  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        borderRadius: radius['radius.lg'],
        borderWidth: 1,
        borderColor: c['line.default'],
        backgroundColor: c['bg.surface'],
        overflow: 'hidden',
      }}
    >
      {children}
    </View>
  );
}

/**
 * Un chiffre de tête et sa légende, dans `type.figureSmall` — le corps
 * ajouté au 2026-08-19 précisément pour « le chiffre d'un cartouche », comme
 * celui-ci. Le filet de droite sépare les cellules ; la dernière n'en porte
 * pas, une bordure fermerait la carte sur elle-même une deuxième fois.
 */
export function Chiffre({
  valeur,
  legende,
  dernier = false,
  testID,
}: {
  valeur: string;
  legende: string;
  dernier?: boolean;
  testID?: string;
}) {
  const c = useColors();
  return (
    <View
      testID={testID}
      style={{
        flex: 1,
        // 18/20, relevés sur la planche : ni l'un ni l'autre n'a de jeton
        // d'espacement exact, et une carte de tête n'a qu'un exemplaire par
        // écran — l'écart avec la grille de 4 ne se voit nulle part ailleurs.
        paddingVertical: 18,
        paddingHorizontal: 20,
        gap: 2,
        borderRightWidth: dernier ? 0 : 1,
        borderRightColor: c['line.default'],
      }}
    >
      <Texte variante="type.figureSmall">{valeur}</Texte>
      <Texte variante="type.body" couleur="ink.soft">
        {legende}
      </Texte>
    </View>
  );
}
