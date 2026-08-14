/**
 * Pourquoi cet écran est vide.
 *
 * **Le défaut n'était pas le vide, c'était le silence.** Un créateur dont le
 * compte est en vérification, un créateur sans relevé et un créateur au milieu
 * d'un désert voyaient tous les trois la même page presque nue. Les trois
 * appellent une action différente ; deux d'entre elles n'ont rien à voir avec
 * la distance, et l'écran proposait pourtant d'élargir le rayon.
 *
 * **Une seule raison à la fois, la plus en amont.** Les obstacles s'empilent —
 * un compte neuf en porte trois — et les afficher tous côte à côte donnerait
 * trois actions dont deux ne servent à rien tant que la première n'est pas
 * levée. L'ordre du catalogue est celui de la chaîne : sans compte, pas de
 * relevé ; sans relevé, pas de palier ; sans palier, la distance ne veut rien
 * dire.
 *
 * **Le détail reste dessous.** La raison principale porte l'action, les autres
 * obstacles se lisent en dessous, dans l'ordre du serveur. Les masquer ferait
 * combler le premier pour découvrir le second.
 *
 * **Aucun texte improvisé.** Un code inconnu — serveur en avance sur l'app —
 * retombe sur la formulation générique, jamais sur une phrase inventée.
 */
import { View } from 'react-native';

import type { Obstacle } from '../api';
import { Apparition, Button, Icone, Texte, type NomIcone } from '../components';
import { useI18n } from '../i18n';
import { en } from '../i18n/en';
import { radius, useTheme, type ColorName } from '../theme';
import { messageDObstacle } from './obstacle';

const CODES_CONNUS = new Set(Object.keys(en.errors));

/** Ce qu'un cas propose de faire. Sans issue, le bouton n'existe pas. */
export type IssuesDuVide = {
  onConnecterUnReseau?: () => void;
  onVoirMonAudience?: () => void;
  onVoirMesPaliers?: () => void;
  /** Élargir n'a de sens que quand rien d'autre ne bloque. */
  elargir?: { label: string; onPress: () => void }[];
};

type Cas = {
  cle: string;
  icone: NomIcone;
  teinte: ColorName;
  /** L'issue, ou rien quand il n'y a rien à faire qu'attendre. */
  issue?: (issues: IssuesDuVide) => (() => void) | undefined;
  labelIssue?: string;
};

/**
 * Le catalogue, dans l'ordre de la chaîne.
 *
 * Fermé, et aligné sur les codes du serveur : il n'y a pas de branche
 * « sinon » qui inventerait une explication pour un code ajouté demain.
 */
const CAS: Cas[] = [
  {
    cle: 'no_social_account',
    icone: 'etincelle',
    teinte: 'brand.700',
    issue: (i) => i.onConnecterUnReseau,
    labelIssue: 'tiers.connectAction',
  },
  {
    cle: 'account_rejected',
    icone: 'croix',
    teinte: 'status.danger.text',
  },
  {
    cle: 'account_token_invalid',
    icone: 'etincelle',
    teinte: 'status.warning.text',
    issue: (i) => i.onConnecterUnReseau,
    labelIssue: 'tiers.connectAction',
  },
  {
    cle: 'account_under_review',
    icone: 'horloge',
    teinte: 'status.warning.text',
    issue: (i) => i.onVoirMesPaliers,
    labelIssue: 'vide.voirPaliers',
  },
  {
    cle: 'no_metrics',
    icone: 'rapport',
    teinte: 'brand.700',
    issue: (i) => i.onVoirMonAudience,
    labelIssue: 'vide.voirAudience',
  },
  {
    cle: 'metrics_stale',
    icone: 'rapport',
    teinte: 'brand.700',
    issue: (i) => i.onVoirMonAudience,
    labelIssue: 'vide.voirAudience',
  },
];

/** Les conditions chiffrées : elles se résument toutes en « aucun palier ouvert ». */
const CONDITIONS = new Set([
  'not_enough_followers',
  'not_enough_completed_collabs',
  'reliability_too_low',
]);

/**
 * La raison qui commande, et celles qui restent.
 *
 * Séparé du rendu : c'est une règle produit, et elle se teste sans écran.
 */
export function raisonPrincipale(obstacles: Obstacle[]): {
  cas: Cas | 'aucun_palier' | 'rien_autour';
  autres: Obstacle[];
} {
  for (const cas of CAS) {
    if (obstacles.some((o) => o.raison === cas.cle)) {
      return { cas, autres: obstacles.filter((o) => o.raison !== cas.cle) };
    }
  }
  if (obstacles.some((o) => CONDITIONS.has(o.raison))) {
    return { cas: 'aucun_palier', autres: obstacles };
  }
  // Aucun obstacle : les paliers sont ouverts, il n'y a simplement rien ici.
  return { cas: 'rien_autour', autres: [] };
}

export function RaisonDuVide({
  obstacles,
  issues,
  rayonKm,
  testID,
}: {
  obstacles: Obstacle[];
  issues: IssuesDuVide;
  /** Rendu dans le seul cas où la distance est en cause. */
  rayonKm?: number;
  testID?: string;
}) {
  const { t, locale } = useI18n();
  const { color: c } = useTheme();
  const { cas, autres } = raisonPrincipale(obstacles);

  const cle = typeof cas === 'string' ? cas : cas.cle;
  const icone: NomIcone =
    typeof cas === 'string' ? (cas === 'aucun_palier' ? 'paliers' : 'lieu') : cas.icone;
  // Les deux cas nommés en clair partageaient une teinte de palier et une
  // teinte d'accent ; la v1.0 n'a plus qu'une encre de marque, et le glyphe
  // porte déjà la distinction que la couleur faisait.
  const teinte: ColorName = typeof cas === 'string' ? 'brand.700' : cas.teinte;

  const surIssue = typeof cas === 'string' ? undefined : cas.issue?.(issues);
  const labelIssue =
    typeof cas === 'string'
      ? cas === 'aucun_palier'
        ? 'vide.voirPaliers'
        : undefined
      : cas.labelIssue;
  const action =
    cas === 'aucun_palier' ? issues.onVoirMesPaliers : surIssue;

  return (
    <Apparition testID={testID ?? `vide-${cle}`}>
      <View style={{ gap: 18, paddingVertical: 24 }}>
        {/* Le halo : une composition, pas un paragraphe centré sur du noir.
            La teinte vient du cas, ce qui donne à chaque situation sa
            couleur — l'attente est ocre, un compte refusé est rouge. */}
        <View
          style={{
            width: 88,
            height: 88,
            borderRadius: radius['radius.pill'],
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: c['bg.surface'],
            borderWidth: 2,
            borderColor: c[teinte],
          }}
          testID="halo"
        >
          <Icone nom={icone} couleur={teinte} taille={38} />
        </View>

        <View style={{ gap: 8 }}>
          {/* Le rayon est passé aux deux : il figure dans le titre comme dans
              le corps, et un seul des deux interpolé laisse « Nothing within
              {{rayon}} km » à l'écran. */}
          <Texte variante="type.section">{t(`vide.${cle}Titre`, { rayon: rayonKm })}</Texte>
          <Texte variante="type.body" couleur="ink.soft">
            {t(`vide.${cle}Corps`, { rayon: rayonKm })}
          </Texte>
        </View>

        {action && labelIssue ? (
          <View style={{ alignItems: 'flex-start' }}>
            <Button label={t(labelIssue)} onPress={action} testID="issue-du-vide" />
          </View>
        ) : null}

        {/* Élargir : proposé seulement quand la distance est bien la cause. */}
        {cle === 'rien_autour' && issues.elargir?.length ? (
          <View style={{ gap: 8, alignItems: 'flex-start' }} testID="elargir">
            {issues.elargir.map((issue) => (
              <Button
                key={issue.label}
                label={issue.label}
                variant="secondary"
                onPress={issue.onPress}
              />
            ))}
          </View>
        ) : null}

        {/* Le détail, dans l'ordre du serveur. */}
        {autres.length > 0 ? (
          <View style={{ gap: 4 }} testID="autres-obstacles">
            <Texte variante="type.label" couleur="ink.mute">
              {t('vide.aussi')}
            </Texte>
            {autres.map((obstacle, index) => (
              <Texte
                key={`${obstacle.raison}-${index}`}
                variante="type.caption"
                couleur="ink.soft"
                testID={`obstacle-${obstacle.raison}`}
              >
                {messageDObstacle(t, obstacle, CODES_CONNUS, undefined, locale)}
              </Texte>
            ))}
          </View>
        ) : null}
      </View>
    </Apparition>
  );
}
