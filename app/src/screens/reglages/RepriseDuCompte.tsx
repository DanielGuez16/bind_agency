/**
 * Ce que le salon lit des reprises faites chez lui.
 *
 * **C'est ce qui fait la différence entre un accès déclaré et un accès qu'on
 * découvre.** La liste garde les reprises closes : n'afficher que celles en
 * cours dirait « personne n'est entré » à quelqu'un chez qui on est entré trois
 * fois. Le service tenait déjà cette route ; personne ne l'appelait, et la
 * promesse « le salon en est prévenu » ne se vérifiait nulle part.
 *
 * **Le motif est cité, jamais reformulé.** Mot pour mot, entre guillemets, tel
 * qu'il a été tapé. C'est le mécanisme lui-même, pas sa présentation : un
 * administrateur qui sait que le gérant lira sa phrase exacte l'écrit
 * autrement. La résumer la désarmerait.
 *
 * **« Expirée toute seule » se distingue de « refermée ».** Le service écrit
 * que c'est la seconde qui devrait gêner — une porte laissée ouverte jusqu'au
 * bout n'est pas une porte qu'on a fermée. Les confondre effacerait exactement
 * ce que le gérant a besoin de remarquer.
 *
 * **Ce que la planche demande et qui n'est pas servi.** Elle nomme
 * l'administrateur — « Amélie R. » — là où la réponse ne porte qu'un
 * identifiant, et marque en rouge et pour toujours les reprises « spontanées »,
 * celles qu'aucun message du salon n'a précédées. Ni le nom ni la distinction
 * n'existent. Les inventer serait pire que leur absence : un identifiant
 * technique affiché à un gérant ne nomme personne, et un mot posé au hasard
 * accuserait. Demandés, voir `TASKS.md`.
 */
import { View } from 'react-native';

import { useApi, type RepriseDuCompte as Reprise } from '../../api';
import { Filet, Texte } from '../../components';
import { useI18n } from '../../i18n';
import { formatDateTime } from '../../format';
import { useMonCommerce } from '../../shell/useMonCommerce';
import { useRequete } from '../useRequete';
import { etatDeLaReprise } from '../journee/reprise';

export function RepriseDuCompte() {
  const { api } = useApi();
  const { t, locale } = useI18n();
  const { businessId, timezone } = useMonCommerce();

  const requete = useRequete<Reprise[] | null>(
    async (signal) => (businessId ? api.mesReprises(businessId, signal) : null),
    { estVide: () => false, dependances: [businessId] },
  );

  // Rien tant qu'on ne sait pas, et rien quand il n'y a rien : une section
  // vide intitulée « accès de l'administration » apprendrait à un gérant qu'il
  // existe une porte, sans qu'aucune ne se soit jamais ouverte chez lui.
  // `timezone` et `businessId` viennent de la même requête : l'un sans l'autre
  // n'arrive pas. Les exiger tous les deux évite un repli sur le fuseau de
  // l'appareil, qui ferait tomber une reprise un jour à côté pour un gérant en
  // voyage — et ce qu'il lit ici est daté chez lui.
  if (!businessId || !timezone || requete.etat !== 'pret') return null;
  const reprises = requete.donnees;
  if (!reprises || reprises.length === 0) return null;

  return (
    <>
      <Filet />
      <View style={{ gap: 14 }} testID="reprises-du-compte">
        <Texte variante="type.label" couleur="ink.soft">
          {t('reglages.reprisesTitre')}
        </Texte>
        <Texte variante="type.caption" couleur="ink.soft">
          {t('reglages.reprisesAide')}
        </Texte>

        {reprises.map((reprise) => {
          const etat = etatDeLaReprise(reprise);
          return (
            <View key={reprise.id} style={{ gap: 3 }} testID={`reprise-${reprise.id}`}>
              <Texte variante="type.monoSmall" couleur="ink.mute">
                {formatDateTime(reprise.started_at, locale, timezone).toUpperCase()}
              </Texte>
              {/* Le motif d'abord : c'est ce qui se lit, le reste le date. */}
              <Texte variante="type.body" testID={`reprise-motif-${reprise.id}`}>
                {t('reglages.repriseMotif', { motif: reprise.reason })}
              </Texte>
              <Texte
                variante="type.caption"
                couleur="ink.soft"
                testID={`reprise-etat-${reprise.id}`}
              >
                {etat === 'en-cours'
                  ? t('reglages.repriseEnCours')
                  : etat === 'refermee'
                    ? t('reglages.repriseRefermee', {
                        quand: formatDateTime(
                          reprise.ended_at as string,
                          locale,
                          timezone,
                        ),
                      })
                    : // Expirée : personne n'a refermé, la porte est restée
                      // ouverte jusqu'au bout de son plafond.
                      t('reglages.repriseExpiree')}
              </Texte>
            </View>
          );
        })}
      </View>
    </>
  );
}
