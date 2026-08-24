/**
 * L'écran des rapports quand il n'y a rien à rapporter.
 *
 * **Il change de nature, pas de contenu.** Aucun zéro, aucun graphique plat,
 * aucun sélecteur de période — il n'y a aucune période à comparer. L'écran
 * répond à la seule question du moment : qu'est-ce qui me manque pour être
 * trouvé ?
 *
 * **Son propre chargement, et c'est voulu.** Les trois listes qu'il lit — le
 * catalogue, les paliers offerts, les règles d'ouverture — ne concernent pas
 * les rapports et ne sont demandées que dans ce cas. Un salon qui a de
 * l'histoire ne paie pas ces trois appels.
 *
 * **Le panneau du bas est le seul chiffre qui ne parle pas du salon.** « 128
 * dans le rayon, dont 41 peuvent déjà réserver » répond à la question que le
 * gérant se pose vraiment à ce moment-là — est-ce qu'il y a quelqu'un ? — et
 * c'est ce qui rend les quatre points au-dessus dignes d'être faits. Il arrive
 * avec la réponse des rapports, sans appel de plus.
 */
import { View } from 'react-native';

import { useApi, type PorteeLocale } from '../../api';
import { Button, Icone, SkeletonLignes, StatusMessage, Texte } from '../../components';
import { formatNumber } from '../../format';
import { useI18n } from '../../i18n';
import { elevationDeCarte, radius, useColors } from '../../theme';
import { useRequete } from '../useRequete';
import { premiersPas, type PointDePremierPas } from './pointsDePremierPas';

type Composition = {
  points: PointDePremierPas[];
};

export type PorteDeComposition = 'catalogue' | 'paliers' | 'horaires';

export function PremiersPas({
  businessId,
  portee,
  onOuvrir,
}: {
  businessId: string;
  /**
   * Qui est autour, et qui peut déjà réserver. Vient de la réponse des
   * rapports, que l'écran a déjà : le redemander ici ferait un second appel
   * pour une donnée déjà sur la table.
   */
  portee?: PorteeLocale;
  /**
   * Le passage vers la composition. Absent, le point garde son libellé et perd
   * son bouton : un bouton qui ne mène nulle part vaut moins que pas de bouton,
   * et c'est la règle que le fil applique déjà à sa ligne de paliers.
   */
  onOuvrir?: (porte: PorteDeComposition) => void;
}) {
  const { api } = useApi();
  const { t, locale } = useI18n();
  const c = useColors();

  // Les créatrices du rayon qui ne peuvent rien réserver de ce qui est ouvert.
  // Nul quand la portée n'est pas là : le point garde alors sa phrase générale.
  const manquants = portee ? portee.createurs - portee.peuvent_reserver : null;

  const requete = useRequete<Composition>(
    async (signal) => {
      const [items, offres, regles] = await Promise.all([
        api.itemsDuCatalogue(businessId, signal),
        api.offresDePalier(businessId, signal),
        api.reglesDeCapacite(businessId, signal),
      ]);
      return { points: premiersPas({ items, offres, regles }) };
    },
    // **Jamais vide.** Un salon sans rien du tout est celui qui a le plus besoin
    // de cette liste : c'est alors que les quatre points sont tous à faire.
    { estVide: () => false, dependances: [businessId] },
  );

  // Les photos mènent au catalogue : c'est là qu'on les pose.
  const porte: Record<PointDePremierPas['cle'], PorteDeComposition> = {
    catalogue: 'catalogue',
    photos: 'catalogue',
    paliers: 'paliers',
    horaires: 'horaires',
  };

  if (requete.etat === 'chargement') {
    return <SkeletonLignes combien={4} testID="squelette-premiers-pas" />;
  }

  // **L'échec se dit, il ne se tait pas.** Une première version rendait `null`
  // quand une des trois listes manquait : le salon voyait alors un écran de
  // rapports **entièrement vide**, sans titre ni explication, ce qui est pire
  // que l'état vide qu'on vient de remplacer. La phrase d'accueil reste dans
  // tous les cas — elle ne dépend d'aucune des trois requêtes.
  const composition = requete.etat === 'pret' ? requete.donnees : null;

  return (
    <View style={{ gap: 26 }} testID="premiers-pas">
      <View style={{ gap: 10 }}>
        <Texte variante="type.display">{t('reporting.videTitre')}</Texte>
        <Texte variante="type.body" couleur="ink.soft">
          {t('reporting.videAmorce')}
        </Texte>
      </View>

      {composition === null ? (
        <StatusMessage
          level="warning"
          body={t('etats.detailIndisponible')}
          testID="premiers-pas-indisponible"
        />
      ) : (
      <View
        style={{
          borderRadius: radius['radius.lg'],
          backgroundColor: c['bg.surface'],
          borderWidth: 1,
          borderColor: c['line.default'],
          overflow: 'hidden',
          ...elevationDeCarte(),
        }}
      >
        {composition.points.map((point, rang) => (
          <View
            key={point.cle}
            testID={`pas-${point.cle}`}
            style={{
              minHeight: 66,
              paddingVertical: 14,
              paddingHorizontal: 20,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 16,
              borderTopWidth: rang === 0 ? 0 : 1,
              borderTopColor: c['line.default'],
            }}
          >
            {/* **La coche verte ou la case vide**, et la case n'est pas une
                croix : rien n'est reproché, quelque chose reste à faire. */}
            {point.fait ? (
              <Icone nom="coche" couleur="status.success.text" taille={22} />
            ) : (
              <View
                testID={`pas-${point.cle}-a-faire`}
                style={{
                  width: 22,
                  height: 22,
                  // **`radius.sm` et non les 7 px de la planche.** Aucun rayon
                  // ne s'écrit en dur, et l'échelle n'a rien entre 0 et 10 :
                  // trois pixels d'écart valent mieux qu'une valeur hors
                  // système, qui se recopierait ailleurs sans qu'on la voie.
                  borderRadius: radius['radius.sm'],
                  borderWidth: 2,
                  borderColor: c['line.strong'],
                }}
              />
            )}

            <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
              <Texte variante="type.bodyStrong">
                {t(`reporting.pas.${point.cle}.${point.fait ? 'fait' : 'aFaire'}`, {
                  compte: point.compte ?? 0,
                })}
              </Texte>
              <Texte variante="type.caption" couleur="ink.soft">
                {/* **Le levier chiffré quand il est connu, et jamais un
                    encouragement.** Ce que le serveur sait dire est l'écart
                    entre les créatrices du rayon et celles qui peuvent déjà
                    réserver : c'est le gain d'ouvrir des paliers, pris
                    ensemble. Le gain d'un palier **précis** n'est pas servi, et
                    « ouvrir le palier post toucherait 62 créatrices de plus »
                    ne s'invente pas. */}
                {point.cle === 'paliers' && !point.fait && manquants !== null
                  ? t('reporting.pas.paliers.levier', { compte: manquants })
                  : t(`reporting.pas.${point.cle}.pourquoi`)}
              </Texte>
            </View>

            {!point.fait && onOuvrir ? (
              <Button
                label={t(`reporting.pas.${point.cle}.geste`)}
                // **Un seul ambre dans la liste**, sur le premier manque. Quatre
                // aplats de marque à la suite ne désignent plus rien, et le
                // premier manque est celui qu'on veut voir régler.
                variant={
                  composition.points.findIndex((autre) => !autre.fait) === rang
                    ? 'primary'
                    : 'secondary'
                }
                onPress={() => onOuvrir(porte[point.cle])}
                testID={`geste-${point.cle}`}
              />
            ) : null}
          </View>
        ))}
      </View>
      )}

      {/* **Le seul chiffre qui ne parle pas du salon.** Il ferme la page parce
          qu'il répond à la question qui a fait ouvrir les quatre points
          au-dessus : est-ce qu'il y a quelqu'un ? Un zéro sur un total non nul
          dit que les paliers sont trop hauts, pas que le quartier est vide —
          c'est la même population, filtrée, et la phrase le dit ainsi. */}
      {portee ? (
        <View
          testID="portee-locale"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 22,
            padding: 20,
            paddingHorizontal: 24,
            borderRadius: radius['radius.lg'],
            backgroundColor: c['brand.50'],
          }}
        >
          <View style={{ gap: 2 }}>
            <Texte variante="type.figureSmall" testID="portee-createurs">
              {formatNumber(portee.createurs, locale)}
            </Texte>
            <Texte variante="type.caption" couleur="ink.soft">
              {t('reporting.porteeCreateurs', {
                rayon: Math.round(portee.rayon_metres / 1000),
              })}
            </Texte>
          </View>
          <View style={{ width: 1, height: 44, backgroundColor: c['brand.200'] }} />
          <Texte variante="type.body" couleur="ink.soft" style={{ flex: 1 }}>
            {t('reporting.porteePeuventReserver', { compte: portee.peuvent_reserver })}
          </Texte>
        </View>
      ) : null}
    </View>
  );
}
