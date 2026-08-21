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
 * **Neuf événements, lus et non récités.** L'écran portait sa liste en dur : la
 * planche en nommait quatre, la grille de pondération en comptait sept qui
 * bougeaient le score, et les signes venaient de `reliability_weights`, qui est
 * de la configuration. Un poids inversé en exploitation aurait rendu l'écran
 * faux sans qu'aucun test ne tombe. Le serveur sert désormais les neuf
 * événements avec le sens du jour ; l'écran les range par sens et les nomme.
 *
 * **Y compris les neutres, et c'est une section à part entière.** Un
 * signalement écarté ne coûte rien, délibérément. Taire les poids nuls ferait
 * disparaître de l'écran quelque chose qui existe et qui peut réapparaître au
 * premier réglage : « ce qui affecte le score » doit pouvoir dire « ceci ne
 * l'affecte pas », sans quoi la liste ment par omission le jour où elle est la
 * plus utile.
 *
 * **L'ordre vient du serveur**, qui va du plus favorable au plus coûteux.
 * L'écran regroupe, il ne retrie pas : un second tri ici et le jour où le
 * produit change l'ordre des événements, deux endroits en décideraient.
 */
import { View } from 'react-native';

import { useApi, type SensDuScore, type VueDesPaliers } from '../api';
import { Icone, SkeletonLignes, Texte } from '../components';
import { useI18n } from '../i18n';
import { en } from '../i18n/en';
import { Ecran } from './Ecran';
import { useRequete } from './useRequete';
import { elevationDeCarte, radius, useColors } from '../theme';

/** Le tiret cadratin des valeurs qui n'existent pas encore. Jamais un zéro. */
const TIRET = '—';

/**
 * Les libellés que l'interface sait écrire.
 *
 * **Un code sans libellé ne s'affiche pas brut.** « resubmit_required » posé
 * tel quel sur un écran d'explication se lit comme une chaîne oubliée — parce
 * que c'en serait une. Il ne se tait pas non plus en silence : une garde
 * éprouve que les neuf codes du serveur ont tous leur phrase, et c'est elle qui
 * doit tomber le jour où un dixième arrive.
 */
const LIBELLES = new Set(Object.keys(en.parcours.evenementsDuScore));

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

            {(
              [
                ['up', t('parcours.scoreCeQuiMonte'), 'ce-qui-monte'],
                ['down', t('parcours.scoreCeQuiDescend'), 'ce-qui-descend'],
                ['neutral', t('parcours.scoreSansEffet'), 'sans-effet'],
              ] as const
            ).map(([sens, titre, id]) => {
              // **`?? []` et non une lecture directe.** Une réponse d'avant
              // le champ, ou un décor qui ne le pose pas, le laisse absent :
              // `undefined.filter` fait tomber l'écran entier là où la bonne
              // réponse est « aucune section ». Troisième fois que la même
              // distinction se paie — la nullité est portée par le contrat,
              // l'absence par l'appelant.
              const causes = (vue.fiabilite.composantes ?? []).filter(
                (composante) => composante.sens === sens && LIBELLES.has(composante.evenement),
              );
              // Une section vide ne se rend pas : un intitulé au-dessus du vide
              // est une promesse qui ne mène nulle part, et le jour où le
              // produit n'a plus aucun événement neutre, la section doit
              // disparaître d'elle-même.
              if (causes.length === 0) return null;
              return (
                <Bloc key={id} titre={titre} testID={id}>
                  {causes.map((composante) => (
                    <LigneDeCause
                      key={composante.evenement}
                      sens={sens}
                      texte={t(`parcours.evenementsDuScore.${composante.evenement}`)}
                      testID={`${id}-${composante.evenement}`}
                    />
                  ))}
                </Bloc>
              );
            })}

            {/* **Rien n'est permanent, et c'est dit sous les listes.** Une
                énumération de ce qui fait baisser, laissée seule, se lit comme
                un casier. */}
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
  sens: SensDuScore;
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
          nom={sens === 'up' ? 'monte' : sens === 'down' ? 'descend' : 'croix'}
          couleur={
            sens === 'up'
              ? 'status.success.text'
              : sens === 'down'
                ? 'status.danger.text'
                : 'ink.mute'
          }
          taille={18}
        />
      </View>
      <Texte variante="type.body" couleur="ink.soft" style={{ flex: 1 }}>
        {texte}
      </Texte>
    </View>
  );
}
