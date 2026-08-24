/**
 * Ce que le salon reproche, sur l'écran de celui à qui on le reproche.
 *
 * **L'écran invitait à resoumettre sans dire quoi corriger.** « Une nouvelle
 * soumission a été demandée » : rien d'autre. Le motif existait pourtant depuis
 * le début — le commerce le choisit dans une liste fermée, il est écrit au
 * journal d'audit, et la file du commerce l'affiche. Le seul écran qui doit
 * porter le reproche était le seul à ne pas l'avoir.
 *
 * **Le ton est celui de la planche : un changement, pas une faute.** Le fond
 * est neutre et non une couleur d'alerte, le titre dit « le salon demande un
 * changement » plutôt que « votre publication est refusée », et le manque tient
 * dans un encart blanc qu'on lit d'un regard. Un refus rouvre avec une nouvelle
 * échéance ; l'écrire comme une sanction ferait croire à un dossier perdu.
 *
 * **Et il dit ce qui allait.** Voir `reprise.ts` : c'est la règle de la planche,
 * et elle change ce que la créatrice croit avoir à refaire.
 */
import { View } from 'react-native';

import type { Collaboration } from '../../api';
import { Icone, Texte } from '../../components';
import { useI18n } from '../../i18n';
import { radius, useTheme } from '../../theme';
import type { MotifDeDecision } from '../motifs';
import { lireLaReprise, type ExigenceIntacte } from './reprise';

/** Le manque, nommé comme un objet et non comme un verdict. « La mention »
 * plutôt que « la mention manque » : le titre de l'encart dit déjà le manque,
 * et le répéter en dessous fait lire deux fois la même chose. */
const MANQUE: Record<MotifDeDecision, string> = {
  missing_mention: 'parcours.repriseManqueMention',
  missing_location: 'parcours.repriseManqueLieu',
  wrong_format: 'parcours.repriseManqueFormat',
  low_quality: 'parcours.repriseManqueQualite',
};

/** Ce qu'il reste à faire, dit en un geste. */
const ACTION: Record<MotifDeDecision, string> = {
  missing_mention: 'parcours.repriseActionMention',
  missing_location: 'parcours.repriseActionLieu',
  wrong_format: 'parcours.repriseActionFormat',
  low_quality: 'parcours.repriseActionQualite',
};

const INTACTES: Record<string, string> = {
  mention: 'parcours.repriseIntacteMention',
  lieu: 'parcours.repriseIntacteLieu',
  'mention,lieu': 'parcours.repriseIntactesLesDeux',
};

export function CeQuiManquait({ contrepartie }: { contrepartie: Collaboration }) {
  const { t } = useI18n();
  const { color: c } = useTheme();

  const reprise = lireLaReprise(contrepartie.dernier_motif, contrepartie);
  if (reprise === null) return null;

  // Un motif inconnu est une phrase écrite avant le vocabulaire fermé. Elle se
  // rend telle quelle — c'est la raison d'une reprise, et la taire serait pire
  // que de l'afficher dans la langue de qui l'a écrite — mais rien ne s'en
  // déduit : ni ce qui allait, ni le geste à faire.
  const manque =
    reprise.motif === null
      ? (contrepartie.dernier_motif as string)
      : t(MANQUE[reprise.motif]);
  const suite =
    reprise.motif === null
      ? null
      : [libelleDesIntactes(t, reprise.intactes), t(ACTION[reprise.motif])]
          .filter(Boolean)
          .join(' ');

  return (
    <View
      testID="reprise-motif"
      style={{
        borderRadius: radius['radius.lg'],
        backgroundColor: c['bg.inset'],
        padding: 18,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        {/* Le glyphe est en encre, pas en couleur d'alerte : il ponctue, il
            n'alarme pas. La planche est explicite là-dessus. */}
        <View style={{ marginTop: 3 }}>
          <Icone nom="alerte" couleur="ink.default" taille={22} />
        </View>
        <Texte variante="type.section" style={{ flex: 1 }}>
          {t('parcours.repriseTitre')}
        </Texte>
      </View>

      <View
        testID="reprise-manque"
        style={{
          borderRadius: radius['radius.md'],
          backgroundColor: c['bg.surface'],
          paddingHorizontal: 16,
          paddingVertical: 14,
          gap: 4,
        }}
      >
        <Texte variante="type.monoSmall" couleur="ink.mute">
          {t('parcours.repriseCeQuiManquait').toUpperCase()}
        </Texte>
        <Texte variante="type.bodyStrong">{manque}</Texte>
        {suite ? (
          <Texte variante="type.caption" couleur="ink.soft" testID="reprise-suite">
            {suite}
          </Texte>
        ) : null}
      </View>

      {/* **Le rang de la tentative, sans son plafond.** La planche écrit
          « attempt 2 of 3 » ; le plafond est un seuil de configuration, il
          n'est pas servi, et l'écrire en dur dans l'écran est précisément ce
          que le dépôt interdit. Le rang seul reste vrai. Voir `TASKS.md`. */}
      {contrepartie.attempts_count > 0 ? (
        <Texte variante="type.caption" couleur="ink.soft" testID="reprise-tentative">
          {t('parcours.repriseTentative', { n: contrepartie.attempts_count + 1 })}
        </Texte>
      ) : null}
    </View>
  );
}

/** La phrase de ce qui allait, ou rien quand il n'y a rien à rassurer. */
function libelleDesIntactes(t: (cle: string) => string, intactes: ExigenceIntacte[]): string {
  const cle = INTACTES[intactes.join(',')];
  return cle ? t(cle) : '';
}
