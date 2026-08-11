/**
 * Les règles des paliers : ce qui ouvre, ce qui referme, et le score.
 *
 * **Elles n'existaient nulle part.** L'écran citait `reliability_score_too_low`
 * comme condition, sans jamais dire ce qu'était ce score ni où le créateur se
 * situait. Une règle qu'on subit sans pouvoir la lire n'est pas une règle,
 * c'est une décision opaque.
 *
 * **Le score vient en premier.** C'est la condition que personne ne connaît, et
 * les deux blocs suivants s'y réfèrent : « votre score de fiabilité, ci-dessus »
 * n'a de sens que s'il est au-dessus.
 *
 * **Chaque bloc se termine par ce qui ne compte pas.** C'est la première
 * question posée — « est-ce qu'un salon qui annule me pénalise ? » — et y
 * répondre coûte une ligne. Ne pas y répondre laisse chacun supposer le pire.
 *
 * **Pas de chiffre inventé.** Sans score, on montre la définition et on dit
 * qu'il n'y en a pas encore ; jamais une barre à zéro, qui ferait d'un débutant
 * quelqu'un de peu fiable.
 *
 * Composant et non écran : sur grand écran c'est la colonne de droite de
 * l'échelle, sur mobile le corps d'un écran empilé. Le même contenu, deux
 * emplacements — en faire deux copies les ferait diverger.
 */
import { View } from 'react-native';

import type { FiabiliteDuCreateur } from '../api';
import { Filet, Icone, Texte } from '../components';
import { useI18n } from '../i18n';
import { radius, useColors, type ColorName } from '../theme';

/** La borne du score. Cent, comme côté serveur — jamais recalculée ici. */
const MAXIMUM = 100;

export function ReglesDesPaliers({
  fiabilite,
  testID,
}: {
  /**
   * Nulle tant que la vue n'est pas chargée. Le bloc du score se rend alors
   * avec sa définition seule : une définition sans chiffre reste vraie, un
   * chiffre sans donnée serait faux.
   */
  fiabilite: FiabiliteDuCreateur | null;
  testID?: string;
}) {
  const { t } = useI18n();

  return (
    <View style={{ gap: 14 }} testID={testID}>
      <BlocDeFiabilite fiabilite={fiabilite} />

      <Bloc titre={t('tiers.rulesUp')} icone="monte" teinte="status.success">
        {[t('tiers.rulesUpOne'), t('tiers.rulesUpTwo'), t('tiers.rulesUpThree')].map(
          (ligne, index) => (
            <View key={ligne} style={{ flexDirection: 'row', gap: 10 }}>
              <Texte variante="type.mono" couleur="text.muted" style={{ width: 14, fontSize: 12 }}>
                {String(index + 1)}
              </Texte>
              <Texte variante="type.label" style={{ flex: 1, fontWeight: '400' }}>
                {ligne}
              </Texte>
            </View>
          ),
        )}
        <Texte variante="type.caption" couleur="text.muted">
          {t('tiers.rulesUpNot')}
        </Texte>
      </Bloc>

      <Bloc titre={t('tiers.rulesDown')} icone="descend" teinte="status.warning">
        <Texte variante="type.label" style={{ fontWeight: '400' }}>
          {t('tiers.rulesDownOne')}
        </Texte>
        <Texte variante="type.label" style={{ fontWeight: '400' }}>
          {t('tiers.rulesDownTwo')}
        </Texte>
        <Filet />
        {/* Ce qui **ne** compte **pas**. Reprend mot pour mot la promesse faite
            au commerce quand il se désiste : les deux côtés doivent lire la
            même règle, sinon l'un des deux se croit lésé. */}
        <Texte variante="type.caption" couleur="text.muted" testID="regles-sans-consequence">
          {t('tiers.rulesDownNot')}
        </Texte>
      </Bloc>
    </View>
  );
}

function BlocDeFiabilite({ fiabilite }: { fiabilite: FiabiliteDuCreateur | null }) {
  const { t } = useI18n();
  const c = useColors();

  const score = fiabilite?.reliability_score == null ? null : Number(fiabilite.reliability_score);
  // Non fini : le serveur a renvoyé quelque chose qui n'est pas un nombre. On
  // retombe sur « pas encore de score » plutôt que d'afficher `NaN / 100`.
  const chiffrable = score !== null && Number.isFinite(score);

  return (
    <View
      testID="bloc-fiabilite"
      style={{
        borderRadius: radius['radius.md'],
        borderWidth: 1,
        borderColor: c['border.subtle'],
        backgroundColor: c['bg.surface'],
        overflow: 'hidden',
      }}
    >
      <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: c['border.subtle'] }}>
        <Texte variante="type.bodyStrong">{t('tiers.reliabilityTitle')}</Texte>
      </View>

      <View style={{ padding: 14, gap: 10 }}>
        {chiffrable ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <Texte variante="type.mono" testID="score-de-fiabilite" style={{ fontSize: 34, lineHeight: 38 }}>
                {String(Math.round(score))}
              </Texte>
              <Texte variante="type.mono" couleur="text.muted">
                {t('tiers.reliabilityOutOf')}
              </Texte>
            </View>
            <Jauge part={score / MAXIMUM} teinte="status.success" hauteur={10} />
            <Texte variante="type.label" couleur="text.secondary" style={{ fontWeight: '400' }}>
              {t('tiers.reliabilityMeaning', { count: fiabilite?.completed_collabs_count ?? 0 })}
            </Texte>
          </>
        ) : (
          // Ni chiffre ni barre. Une barre vide se lit comme un zéro, et zéro
          // n'est pas ce que dit l'absence d'historique.
          <Texte variante="type.label" couleur="text.secondary" testID="fiabilite-sans-score" style={{ fontWeight: '400' }}>
            {t('tiers.reliabilityNone')}
          </Texte>
        )}

        {/* Les deux garanties. Elles ne sont pas décoratives : sans elles, le
            score se lit comme une note publique, et c'est la crainte
            spontanée de toutes celles à qui on l'a montré. */}
        <Texte variante="type.caption" couleur="text.muted" testID="garanties-du-score">
          {t('tiers.reliabilityGuarantee')}
        </Texte>
      </View>
    </View>
  );
}

function Bloc({
  titre,
  icone,
  teinte,
  children,
}: {
  titre: string;
  icone: 'monte' | 'descend';
  teinte: 'status.success' | 'status.warning';
  children: React.ReactNode;
}) {
  const c = useColors();

  return (
    <View
      style={{
        borderRadius: radius['radius.md'],
        borderWidth: 1,
        borderColor: c['border.subtle'],
        backgroundColor: c['bg.surface'],
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          padding: 12,
          borderBottomWidth: 1,
          borderBottomColor: c['border.subtle'],
          backgroundColor: c[`${teinte}.subtle` as ColorName],
        }}
      >
        <Icone nom={icone} couleur={teinte} taille={18} />
        <Texte variante="type.bodyStrong" couleur={teinte}>
          {titre}
        </Texte>
      </View>
      <View style={{ padding: 12, gap: 10 }}>{children}</View>
    </View>
  );
}

/**
 * Une jauge pleine largeur.
 *
 * Partagée par le score et par l'écart au seuil : ce sont deux fois la même
 * chose — une position sur un chemin — et deux dessins pour une même idée
 * demanderaient au lecteur de vérifier qu'ils disent bien la même.
 */
export function Jauge({
  part,
  teinte,
  hauteur = 8,
  testID,
}: {
  part: number;
  teinte: ColorName;
  hauteur?: number;
  testID?: string;
}) {
  const c = useColors();
  // Bornée : un serveur qui renvoie un constaté supérieur au requis ne doit pas
  // faire déborder la barre hors de sa piste.
  const pourcentage = Math.min(100, Math.max(0, part * 100));

  return (
    <View style={{ height: hauteur, backgroundColor: c['bg.sunken'], overflow: 'hidden' }}>
      <View
        testID={testID}
        accessibilityLabel={`${Math.round(pourcentage)}%`}
        style={{ width: `${pourcentage}%`, height: hauteur, backgroundColor: c[teinte] }}
      />
    </View>
  );
}
