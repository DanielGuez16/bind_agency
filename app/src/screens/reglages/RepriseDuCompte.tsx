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
 * **Le nom, et la spontanéité, servis depuis.** La planche nommait
 * l'administrateur — « Amélie R. » — et marquait les reprises qu'aucune
 * demande du salon n'a précédées. Les deux existent maintenant côté serveur :
 * le nom est recopié à l'ouverture, donc il ne bouge plus après ; la
 * spontanéité est déclarée, et son défaut est le sens inconfortable.
 *
 * **Et la porte se referme d'ici.** Le gérant n'a personne à convaincre : une
 * garantie qui suppose qu'on décroche n'est pas une garantie. Le bouton ne
 * paraît que si quelqu'un est dedans — proposer de fermer une porte close
 * ferait douter qu'elle le soit.
 */
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import {
  useApi,
  type PorteeDeReprise,
  type RepriseDuCompte as Reprise,
} from '../../api';
import { Button, Filet, Texte } from '../../components';
import { useI18n } from '../../i18n';
import { formatDateTime } from '../../format';
import { useMonCommerce } from '../../shell/useMonCommerce';
import { useRequete } from '../useRequete';
import { etatDeLaReprise, repriseEnCours } from '../journee/reprise';

/**
 * Le nom d'un écran ouvert, en toutes lettres.
 *
 * **Un aiguillage et non une clé composée.** `t(`…${ecran}`)` se lirait mieux
 * et ne se vérifierait nulle part : la garde des traductions ne résout pas les
 * clés composées, elle les compte. Écrit ainsi, TypeScript exige les sept cas —
 * une portée ajoutée côté serveur ne compile plus tant que personne ne l'a
 * nommée, ce qui est exactement le moment où il faut y penser.
 */
function nomDeLEcran(ecran: PorteeDeReprise, t: (cle: string) => string): string {
  switch (ecran) {
    case 'fiche':
      return t('reglages.porteeFiche');
    case 'catalogue':
      return t('reglages.porteeCatalogue');
    case 'agenda':
      return t('reglages.porteeAgenda');
    case 'contreparties':
      return t('reglages.porteeContreparties');
    case 'annuaire':
      return t('reglages.porteeAnnuaire');
    case 'abonnement':
      return t('reglages.porteeAbonnement');
    case 'chiffres':
      return t('reglages.porteeChiffres');
  }
}

export function RepriseDuCompte() {
  const { api } = useApi();
  const { t, locale } = useI18n();
  const { businessId, timezone } = useMonCommerce();
  const [fermeture, setFermeture] = useState(false);

  const requete = useRequete<Reprise[] | null>(
    async (signal) => (businessId ? api.mesReprises(businessId, signal) : null),
    { estVide: () => false, dependances: [businessId] },
  );
  const { recharger } = requete;

  const refermer = useCallback(async () => {
    if (!businessId) return;
    setFermeture(true);
    try {
      await api.refermerLaReprise(businessId);
      recharger();
    } finally {
      setFermeture(false);
    }
  }, [api, businessId, recharger]);

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
              {/* **Le nom d'abord, et le fait qu'on soit venu tout seul.** Un
                  gérant qui relit doit pouvoir dire qui, et savoir s'il avait
                  appelé. Les deux sur la même ligne : ils répondent à la même
                  question. */}
              <Texte variante="type.body" testID={`reprise-qui-${reprise.id}`}>
                {reprise.spontaneous
                  ? t('reglages.repriseParSpontanee', { qui: reprise.admin_name })
                  : t('reglages.repriseParDemandee', { qui: reprise.admin_name })}
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
              {/* **Ce qu'elle ouvrait, en toutes lettres.** La liste est vraie :
                  le serveur refuse toute requête qui en sort. L'afficher sans
                  cela serait une promesse ; avec, c'est une borne. */}
              <Texte
                variante="type.caption"
                couleur="ink.soft"
                testID={`reprise-portee-${reprise.id}`}
              >
                {t('reglages.repriseEcrans', {
                  ecrans: reprise.scope
                    .map((ecran) => nomDeLEcran(ecran, t))
                    .join(t('reglages.porteeSeparateur')),
                })}
              </Texte>
            </View>
          );
        })}

        {repriseEnCours(reprises) ? (
          <Button
            label={t('reglages.repriseRefermerAction')}
            variant="danger"
            size="sm"
            loading={fermeture}
            loadingLabel={t('reglages.repriseRefermerEnCours')}
            onPress={refermer}
            testID="reprise-refermer"
          />
        ) : null}
      </View>
    </>
  );
}
