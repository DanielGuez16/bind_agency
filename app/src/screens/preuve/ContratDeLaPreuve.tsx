/**
 * Ce que le commerce attend, sur l'écran où l'on publie.
 *
 * **Ces trois lignes descendent de la liste des réservations**, et c'est le
 * partage que la planche v3 pose : la liste sert à décider d'agir, le détail
 * sert à agir. Le format, la mention et le lieu ne servent qu'au moment où l'on
 * compose la publication — les lire trois écrans plus tôt, c'est les avoir
 * oubliés en arrivant ici.
 *
 * **La mention et le lieu se copient, et c'est la correction la moins visible
 * de cet écran.** Le premier motif de reprise du produit est une mention
 * manquante ou mal écrite : un bouton de copie retire la faute de frappe du
 * chemin. Retaper `@velanailstudio` à la main est une occasion de se tromper
 * qu'aucune relecture ne rattrape.
 *
 * **L'échéance est calculée, pas exprimée en délai.** « Avant jeudi 21, 14:30 »
 * plutôt que « sous 48 h », qui demande de compter depuis une date qu'on ne
 * regarde plus.
 *
 * **Deux lignes de la planche manquent, et c'est un champ qui manque, pas une
 * décision.** `Collaboration` — ce que l'écran lit — ne porte ni le nom du
 * salon ni celui de la prestation : la tête du panneau et la ligne du lieu ne
 * peuvent donc pas se rendre. Le lieu est le cas gênant : `required_geotag` dit
 * qu'il en faut un, mais **ce qu'on tape dans la plateforme est le nom de
 * l'établissement**, et une ligne « identifiez le lieu » sans rien à copier
 * rate exactement ce que cette planche corrige. Les deux props existent et
 * valent `null` en attendant ; le jour où le champ arrive, c'est un argument
 * de plus à l'appel. Voir `TASKS.md`.
 */
import * as Presse from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import type { Collaboration } from '../../api';
import { Icone, LigneDeContrepartie, Texte, vibration } from '../../components';
import { nomDeJour } from '../../format';
import { useI18n } from '../../i18n';
import { elevationDeCarte, radius, useTheme } from '../../theme';

export function ContratDeLaPreuve({
  contrepartie,
  plateforme,
  timezone,
  nomDuSalon,
  nomDeLaPrestation,
}: {
  contrepartie: Collaboration;
  /** Le réseau. Nul tant que `Collaboration` ne le porte pas. */
  plateforme: string | null;
  timezone: string;
  /** Nul tant que `Collaboration` ne le porte pas. Voir l'en-tête. */
  nomDuSalon: string | null;
  /** Nul pour la même raison. */
  nomDeLaPrestation: string | null;
}) {
  const { t, locale } = useI18n();
  const { color: c } = useTheme();

  return (
    <View
      testID="contrat-de-la-preuve"
      style={{
        borderRadius: radius['radius.lg'],
        backgroundColor: c['bg.surface'],
        borderWidth: 1,
        borderColor: c['line.default'],
        overflow: 'hidden',
        // « Un coin de 18 px sans ombre flotte au lieu de se poser » : passation §2.
        ...elevationDeCarte(),
      }}
    >
      {nomDeLaPrestation ? (
        <Ligne premiere testID="contrat-prestation">
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Texte variante="type.bodyStrong">{nomDeLaPrestation}</Texte>
            {nomDuSalon ? (
              <Texte variante="type.caption" couleur="ink.mute" ellipseSurNomPropre>
                {nomDuSalon}
              </Texte>
            ) : null}
          </View>
        </Ligne>
      ) : null}

      {/* **Le format exact, qui n'était affiché que sur la liste.** Il en part
          avec cette planche : c'est ici qu'on en a besoin, au moment de
          publier. Le palier en gras dans la phrase, le réseau par sa marque —
          la même forme que sur la fiche, pour que « une story sur Instagram »
          se lise partout pareil. */}
      {/* **Le réseau n'est pas nommé, faute d'être servi.** La planche écrit
          « une story sur Instagram » ; `Collaboration` ne porte pas la
          plateforme, et la deviner depuis le palier serait faux — le même
          palier existe sur les trois réseaux. La forme courte de la
          contrepartie est employée telle quelle, et elle dit déjà le format et
          le délai. `plateforme` attend son champ. */}
      <Ligne glyphe="paliers" premiere={!nomDeLaPrestation} testID="contrat-format">
        <LigneDeContrepartie
          tier={contrepartie.required_format}
          plateforme={plateforme ?? undefined}
        />
      </Ligne>

      {contrepartie.required_mention ? (
        <LigneCopiable
          valeur={contrepartie.required_mention}
          mono
          testID="contrat-mention"
        />
      ) : null}

      {/* **Le lieu porte le nom du salon, pas un booléen.** `required_geotag`
          dit qu'il en faut un ; ce qu'on tape dans l'application de la
          plateforme est le nom de l'établissement, et c'est lui qui se copie. */}
      {contrepartie.required_geotag && nomDuSalon ? (
        <LigneCopiable valeur={nomDuSalon} testID="contrat-lieu" />
      ) : null}

      <Ligne glyphe="horloge" testID="contrat-echeance">
        <Texte variante="type.body" couleur="ink.soft">
          {t('parcours.preuveEcheanceAvant')}
          <Texte variante="type.bodyStrong" couleur="ink.default">
            {echeance(contrepartie.deadline_at, locale, timezone)}
          </Texte>
        </Texte>
      </Ligne>
    </View>
  );
}

/** Une ligne du contrat : son glyphe s'il en a un, et ce qu'elle dit. */
function Ligne({
  glyphe,
  children,
  premiere = false,
  testID,
}: {
  glyphe?: 'paliers' | 'horloge';
  children: React.ReactNode;
  premiere?: boolean;
  testID?: string;
}) {
  const { color: c } = useTheme();
  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        paddingHorizontal: 16,
        paddingVertical: 13,
        borderTopWidth: premiere ? 0 : 1,
        borderTopColor: c['line.default'],
      }}
    >
      {glyphe ? (
        <View style={{ marginTop: 4 }}>
          <Icone nom={glyphe} couleur="ink.soft" taille={18} />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
    </View>
  );
}

/**
 * Une valeur à recopier dans une autre application, et son bouton.
 *
 * **Le bouton dit ce qui vient de se passer, puis revient.** Une copie ne
 * produit rien de visible — ni le presse-papier, ni l'écran — et un bouton qui
 * ne change pas laisse appuyer trois fois sans savoir si ça a marché. Deux
 * secondes suffisent : au-delà, on a déjà quitté l'application.
 *
 * **Et le retour est un effet, plus un minuteur posé dans le geste.** Posé là,
 * rien ne l'éteignait : quitter l'écran dans les deux secondes écrivait dans un
 * composant démonté, et le minuteur tenait le processus ouvert jusqu'au bout —
 * c'est l'une des trois causes qui faisaient forcer la sortie d'un worker Jest
 * à chaque exécution de la suite.
 */
/** Combien de temps le bouton dit « copié » avant de redevenir un bouton. */
const RETOUR_DU_BOUTON_MS = 2_000;

function LigneCopiable({
  valeur,
  mono = false,
  testID,
}: {
  valeur: string;
  /** La mention s'écrit en mono : c'est une chaîne à recopier exactement. */
  mono?: boolean;
  testID: string;
}) {
  const { t } = useI18n();
  const { color: c } = useTheme();
  const [copie, setCopie] = useState(false);

  useEffect(() => {
    if (!copie) return;
    const minuteur = setTimeout(() => setCopie(false), RETOUR_DU_BOUTON_MS);
    return () => clearTimeout(minuteur);
  }, [copie]);

  async function copier() {
    await Presse.setStringAsync(valeur);
    // Le même cran que les autres gestes du parcours : léger, une fois. Une
    // copie réussie n'est pas une célébration.
    vibration.action();
    setCopie(true);
  }

  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 16,
        paddingVertical: 13,
        borderTopWidth: 1,
        borderTopColor: c['line.default'],
      }}
    >
      <Texte
        variante={mono ? 'type.data' : 'type.body'}
        style={{ flex: 1 }}
        ellipseSurNomPropre
      >
        {valeur}
      </Texte>
      <Texte
        variante="type.label"
        couleur={copie ? 'status.success.text' : 'ink.default'}
        onPress={() => void copier()}
        testID={`${testID}-copier`}
        style={{
          borderRadius: radius['radius.sm'],
          backgroundColor: c['bg.inset'],
          paddingHorizontal: 11,
          paddingVertical: 6,
          overflow: 'hidden',
        }}
      >
        {(copie ? t('parcours.preuveCopie') : t('parcours.preuveCopier')).toUpperCase()}
      </Texte>
    </View>
  );
}

/** L'échéance, en jour nommé et heure. Jamais un délai à compter. */
function echeance(isoUtc: string, locale: 'en' | 'es', timezone: string): string {
  const jourNu = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, dateStyle: 'short' }).format(
    new Date(isoUtc),
  );
  const heure = new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone: timezone }).format(
    new Date(isoUtc),
  );
  return `${nomDeJour(jourNu, locale, 'long')}, ${heure}`;
}
