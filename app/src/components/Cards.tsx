/**
 * Rangées de liste, et les deux surfaces qu'une photo demande.
 *
 * **La carte de salon a été retirée**, et ce fichier ne décrit plus qu'un
 * voile, un repli d'image et deux rangées. Elle occupait la largeur, donnait à
 * la couverture la moitié de la hauteur, et posait le nom du salon dessus —
 * c'est-à-dire la composition que la revue v3 a désignée comme le défaut : le
 * lieu en titre, la prestation en légende. Le fil rend maintenant des aperçus
 * de prestation sans chrome, et la carte n'avait plus aucun appelant.
 *
 * **Elle est partie plutôt que d'attendre.** Une carte qui survit sans écran
 * finit par resservir en portant une composition périmée ; c'est arrivé au
 * monogramme vert, qui a traversé un remplacement complet du système en gardant
 * sa forme et se trouvait encore en tête de l'accueil quand tout le reste avait
 * changé.
 *
 * **Le voile est un dégradé, pas un rectangle.** Un aplat sombre sur le bas
 * d'une image la salit ; un dégradé qui part de rien et finit opaque garde la
 * photo lisible et le texte détaché, quelle que soit la photo dessous. Ses
 * trois arrêts viennent des jetons.
 *
 * **La rangée de prestation est partie avec la fiche v3.** Elle portait cinq
 * informations sur une ligne, dont deux codées — c'est la cause que Design a
 * trouvée, et la fiche pose maintenant deux questions en deux lignes. Elle
 * n'avait plus d'appelant : une rangée qui survit sans écran finit par
 * resservir en portant une composition périmée.
 *
 * **Le repli d'image ne se commente pas côté créateur.** Un monogramme neutre.
 * Côté commerce, il devient une tâche — « Photo manquante · ajouter » — parce
 * que c'est quelqu'un qui peut la faire qui la lit.
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { useColors } from '../theme';
import { Texte } from './Texte';

/**
 * Le voile de lisibilité posé sur une photo.
 *
 * Transparent en haut, opaque en bas : la photo reste visible sans que le fond
 * du texte devienne quelconque. Les arrêts sont des jetons — un dégradé écrit
 * en dur ne suit pas le système.
 *
 * **Ce voile adoucit, il ne garantit rien.** C'est une distinction qui a coûté
 * un défaut : sur un dégradé, l'opacité sous un texte dépend de l'endroit exact
 * où ce texte tombe, donc de la hauteur de la carte, donc du terminal. Mesuré
 * sur la pire photo possible — une blanche —, `ink.onScrim` ne tient qu'à
 * partir d'un voile à 0,61 et `ink.onScrimMuted` qu'à 0,735 ; des trois arrêts
 * du système, **seul `scrim.photoBottom` les dépasse**. Un texte posé ailleurs
 * que sur cet arrêt-là est illisible sur une photo claire, et le prouver
 * demanderait de connaître une mise en page qu'on ne connaît pas.
 *
 * D'où le partage : le dégradé fait la transition, et le texte porte **sa
 * propre bande** à `scrim.photoBottom` — voir `BandeDeTexteSurPhoto`. La
 * lisibilité cesse alors de dépendre d'une hauteur.
 */
export function VoileDeLisibilite({ hauteur }: { hauteur?: number }) {
  const c = useColors();
  return (
    <LinearGradient
      pointerEvents="none"
      // S'arrête à `modal` : ce qui suit est la bande du texte, qui porte son
      // fond elle-même. Descendre jusqu'à `photoBottom` ici ferait deux
      // couches sombres empilées, et la photo perdrait son dernier tiers pour
      // rien.
      colors={[c['scrim.photoTop'], c['scrim.modal']]}
      locations={[0, 1]}
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: hauteur ?? '70%' }}
    />
  );
}

/**
 * La bande sur laquelle un texte se pose, au-dessus d'une photo.
 *
 * **Un fond, pas un dégradé.** C'est tout l'intérêt : `scrim.photoBottom` donne
 * 12,10:1 à `ink.onScrim` et 7,72:1 à `ink.onScrimMuted` sur une photo blanche,
 * et ces deux nombres ne dépendent ni de la hauteur de la carte, ni du
 * terminal, ni de l'endroit où la ligne tombe. Un dégradé, lui, donne un
 * chiffre différent à chaque pixel — et sur les cartes du fil, les deux lignes
 * tombaient à 0,65 et 0,76 d'opacité, c'est-à-dire à la limite pour l'une et
 * en dessous pour l'autre selon la taille de l'écran.
 */
export function BandeDeTexteSurPhoto({
  children,
  testID,
}: {
  children: ReactNode;
  testID?: string;
}) {
  const c = useColors();
  return (
    <View testID={testID} style={{ padding: 14, gap: 2, backgroundColor: c['scrim.photoBottom'] }}>
      {children}
    </View>
  );
}

// --------------------------------------------------------------------------

export type MediaFallbackProps = {
  /** Deux lettres, tirées du nom. Jamais une icône générique. */
  monogramme: string;
  /** Une hauteur fixe, ou `'100%'` pour épouser une boîte au rapport imposé. */
  height: number | '100%';
  /** Côté commerce, l'absence de photo est une tâche, pas un défaut. */
  commeTache?: boolean;
  labelTache?: string;
  testID?: string;
};

export function MediaFallback({
  monogramme,
  height,
  commeTache,
  labelTache,
  testID,
}: MediaFallbackProps) {
  const c = useColors();
  return (
    <View
      testID={testID}
      style={{
        height,
        backgroundColor: c['media.placeholder'],
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
      }}
    >
      <Texte variante="type.section" couleur="media.placeholderText">
        {monogramme.slice(0, 2).toUpperCase()}
      </Texte>
      {/* Un libellé de tâche n'est pas une alerte : il portait la teinte
          d'avertissement, qui ne distingue rien sans son glyphe. */}
      {commeTache && labelTache ? (
        <Texte variante="type.caption" couleur="ink.soft">
          {labelTache}
        </Texte>
      ) : null}
    </View>
  );
}

// --------------------------------------------------------------------------

// --------------------------------------------------------------------------

export type DataRowProps = {
  label: string;
  value: string;
  /** Les chiffres passent en `type.data` : ils s'alignent d'une ligne à l'autre. */
  chiffre?: boolean;
  testID?: string;
};

export function DataRow({ label, value, chiffre, testID }: DataRowProps) {
  const c = useColors();
  return (
    <View
      testID={testID}
      style={{
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: c['line.default'],
      }}
    >
      <Texte variante="type.caption" couleur="ink.soft" style={{ flexShrink: 1 }}>
        {label}
      </Texte>
      <Texte variante={chiffre ? 'type.data' : 'type.body'} align="right" style={{ flexShrink: 1 }}>
        {value}
      </Texte>
    </View>
  );
}
