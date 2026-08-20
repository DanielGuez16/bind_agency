/**
 * Le score de fiabilité, en détail : ce qu'il mesure, ce qui le bouge, ce qu'il
 * ne fait jamais.
 *
 * **Les garanties sont sur l'écran, pas dans les conditions d'utilisation.**
 * « Jamais comparé aux autres » et « jamais montré à un commerce » se lisent à
 * côté du nombre, en clair. Une promesse enterrée dans un document n'est pas une
 * promesse, c'est une clause — et une note de 0 à 100 sans ces deux phrases se
 * lit comme un classement, ce qui est précisément ce qu'elle n'est pas.
 *
 * **Une définition avant toute mécanique, puis ce qui monte avant ce qui
 * descend.** Une créatrice qui ne sait pas ce qui l'affecte ne peut ni le
 * protéger ni le réparer, et commencer par les pénalités transforme une
 * explication en avertissement.
 *
 * **Sept événements et non quatre, et c'est un écart assumé avec la planche.**
 * Design en nomme deux par côté ; la grille de pondération en compte sept qui
 * bougent le score, dont « publier en retard » et « une reprise demandée » du
 * côté qui descend. Une liste qui promet de dire ce qui affecte le score et en
 * tait deux se retourne contre elle le jour où il baisse pour une raison
 * absente de l'écran. Les mots de Design sont gardés pour les quatre qu'elle
 * nomme, l'ordre aussi ; les trois autres suivent.
 *
 * **Ce que l'écran ne sait pas, et qui est écrit dans `TASKS.md`.** Les signes
 * viennent de `reliability_weights`, qui est de la configuration : un
 * exploitant qui inverserait un poids rendrait cette liste fausse sans qu'aucun
 * test ne tombe. La planche demande d'ailleurs à l'API de servir les
 * composantes du score « pour que l'écran nomme ce qui monte et ce qui descend
 * sans les déduire ». Il ne les déduit pas — il les récite, ce qui est le même
 * risque sous un autre nom.
 */
import { View } from 'react-native';

import { useApi, type VueDesPaliers } from '../api';
import { Icone, SkeletonLignes, Texte } from '../components';
import { useI18n } from '../i18n';
import { Ecran } from './Ecran';
import { useRequete } from './useRequete';
import { elevationDeCarte, radius, useColors } from '../theme';

/** Le tiret cadratin des valeurs qui n'existent pas encore. Jamais un zéro. */
const TIRET = '—';

const MONTE = [
  'parcours.scoreMonteCollaboration',
  'parcours.scoreMonteDansLesTemps',
  'parcours.scoreMonteDuPremierCoup',
] as const;

const DESCEND = [
  'parcours.scoreDescendAbsence',
  'parcours.scoreDescendNonHonoree',
  'parcours.scoreDescendEnRetard',
  'parcours.scoreDescendReprise',
] as const;

export function FiabiliteScreen({ onRetour }: { onRetour?: () => void }) {
  const { api } = useApi();
  const { t } = useI18n();
  const c = useColors();

  const requete = useRequete<VueDesPaliers>((signal) => api.mesPaliers({}, signal), {
    estVide: () => false,
  });

  return (
    <Ecran
      onRetour={onRetour}
      requete={requete}
      titre={t('parcours.scoreTitre')}
      squelette={<SkeletonLignes combien={4} testID="squelette-fiabilite" />}
      testID="ecran-fiabilite"
    >
      {(vue) => {
        const brut = vue.fiabilite.reliability_score;
        const score = brut === null ? null : Number(brut);
        const lisible = score !== null && Number.isFinite(score);

        return (
          <View style={{ gap: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 14 }}>
              {/* Le chiffre sujet de l'écran : c'est exactement l'emploi de
                  monoDisplay, et il n'existait pas avant cette planche. */}
              <Texte
                variante="type.monoDisplay"
                couleur={lisible ? 'ink.default' : 'ink.mute'}
                testID="score-en-grand"
              >
                {lisible ? String(score) : TIRET}
              </Texte>
              {lisible ? (
                <Texte
                  variante="type.body"
                  couleur="ink.mute"
                  style={{ paddingBottom: 6 }}
                  testID="score-sur-cent"
                >
                  {t('parcours.scoreSur')}
                </Texte>
              ) : null}
            </View>

            <Texte variante="type.section">{t('parcours.scoreDefinition')}</Texte>

            {/* Sans historique, la même phrase que la carte : l'absence de
                score ne coûte rien, et le dire est ce qui empêche le tiret de
                se lire comme une porte fermée. */}
            {lisible ? null : (
              <View
                testID="score-pas-encore-detail"
                style={{
                  gap: 4,
                  padding: 16,
                  borderRadius: radius['radius.md'],
                  backgroundColor: c['bg.deep'],
                }}
              >
                <Texte variante="type.bodyStrong">{t('parcours.audiencePasEncoreDeScore')}</Texte>
                <Texte variante="type.caption" couleur="ink.soft">
                  {t('parcours.audiencePasEncoreDeScoreDetail')}
                </Texte>
              </View>
            )}

            <Bloc titre={t('parcours.scoreCeQuiMonte')} testID="ce-qui-monte">
              {MONTE.map((cle) => (
                <LigneDeCause key={cle} sens="monte" texte={t(cle)} testID={`monte-${cle}`} />
              ))}
            </Bloc>

            <Bloc titre={t('parcours.scoreCeQuiDescend')} testID="ce-qui-descend">
              {DESCEND.map((cle) => (
                <LigneDeCause key={cle} sens="descend" texte={t(cle)} testID={`descend-${cle}`} />
              ))}
            </Bloc>

            {/* **Rien n'est permanent, et c'est dit sous les pénalités.** Une
                liste de ce qui fait baisser, laissée seule, se lit comme un
                casier. */}
            <Texte variante="type.caption" couleur="ink.soft" testID="score-se-repare">
              {t('parcours.scoreSeRepare')}
            </Texte>

            <View
              testID="ce-qu-il-ne-fait-jamais"
              style={{
                gap: 9,
                padding: 16,
                borderRadius: radius['radius.lg'],
                backgroundColor: c['bg.deep'],
              }}
            >
              <Texte variante="type.label">{t('parcours.scoreJamais')}</Texte>
              {[
                ['parcours.scoreJamaisCompare', 'jamais-compare'],
                ['parcours.scoreJamaisMontre', 'jamais-montre'],
              ].map(([cle, id]) => (
                <View
                  key={id}
                  style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}
                  testID={id}
                >
                  <View style={{ marginTop: 4 }}>
                    <Icone nom="croix" taille={18} />
                  </View>
                  <Texte variante="type.body" couleur="ink.soft" style={{ flex: 1 }}>
                    {t(cle)}
                  </Texte>
                </View>
              ))}
            </View>
          </View>
        );
      }}
    </Ecran>
  );
}

/** Un bloc de causes : son intitulé, puis ses lignes dans une carte. */
function Bloc({
  titre,
  children,
  testID,
}: {
  titre: string;
  children: React.ReactNode;
  testID: string;
}) {
  const c = useColors();
  return (
    <View style={{ gap: 10 }} testID={testID}>
      <Texte variante="type.label" couleur="ink.mute">
        {titre}
      </Texte>
      <View
        style={{
          borderRadius: radius['radius.lg'],
          backgroundColor: c['bg.surface'],
          borderWidth: 1,
          borderColor: c['line.default'],
          overflow: 'hidden',
          // « Un coin de 18 px sans ombre flotte au lieu de se poser » : §2.
          ...elevationDeCarte(),
        }}
      >
        {children}
      </View>
    </View>
  );
}

/**
 * Une cause, et la flèche qui dit son sens.
 *
 * **La flèche porte la couleur, jamais le texte.** Un libellé en rouge se lit
 * comme une erreur en cours ; ces lignes décrivent une mécanique, pas un état.
 */
function LigneDeCause({
  sens,
  texte,
  testID,
}: {
  sens: 'monte' | 'descend';
  texte: string;
  testID: string;
}) {
  const c = useColors();
  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        paddingHorizontal: 16,
        paddingVertical: 13,
        borderTopWidth: 1,
        borderTopColor: c['line.default'],
      }}
    >
      <View style={{ marginTop: 4 }}>
        <Icone
          nom={sens === 'monte' ? 'monte' : 'descend'}
          couleur={sens === 'monte' ? 'status.success.text' : 'status.danger.text'}
          taille={18}
        />
      </View>
      <Texte variante="type.body" couleur="ink.soft" style={{ flex: 1 }}>
        {texte}
      </Texte>
    </View>
  );
}
